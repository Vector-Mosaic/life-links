import { createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import { errors, type AdapterConstructor } from "oidc-provider";
import { CalendarSecretCipher } from "./calendar-secret-store.js";
import { RemoteAgentAccessError, assertRemoteScope, type RemoteAgentPrincipal,
  type RemoteApproval, type RemoteApprovalService } from "./remote-agent-principal.js";

type Payload = Record<string, any>;
type Entry = { kind: string; key: string; encrypted: string; grant?: string; uid?: string; userCode?: string;
  owner?: string; expiresAt?: number; consumed?: number };

/** Private OAuth adapter state plus command-approval receipts in the existing DB.
 * No raw bearer, authorization code, user code, or private key is stored in cleartext. */
export class RemoteAgentState {
  private readonly cipher: CalendarSecretCipher;
  private readonly key: Buffer;
  private readonly memory = new Map<string, Entry>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly grantLease = new AsyncLocalStorage<<T>(action: () => Promise<T>) => Promise<T>>();
  private leases = 0;
  private readonly leaseWaiters: Array<() => void> = [];
  private nextPruneAt = 0;
  private readonly maxClients: number;
  constructor(sessionSecret: string, readonly pool?: Pool, limits: { registeredClients?: number } = {}) {
    this.maxClients = limits.registeredClients ?? 1024;
    if (!Number.isSafeInteger(this.maxClients) || this.maxClients < 1) throw new Error("invalid_remote_client_limit");
    this.key = Buffer.from(hkdfSync("sha256", sessionSecret, "life-links-remote-mcp", "protocol-state-v1", 32));
    this.cipher = new CalendarSecretCipher(this.key.toString("base64"), "life-links-remote-mcp-v1");
  }
  private hash(value: string): string { return createHmac("sha256", this.key).update(value).digest("hex"); }
  private seal(kind: string, key: string, payload: Payload): string {
    return this.cipher.seal({ id: `${kind}:${key}`, ownerId: "protocol", purpose: "authorization" }, payload);
  }
  private open(entry: Entry): Payload {
    const payload = this.cipher.open<Payload>({ id: `${entry.kind}:${entry.key}`, ownerId: "protocol",
      purpose: "authorization", encryptedPayload: entry.encrypted, expiresAt: null });
    return entry.consumed ? { ...payload, consumed: entry.consumed } : payload;
  }
  private decode(row: any): Entry { return { kind: row.kind, key: row.id_hash, encrypted: row.encrypted_payload,
    grant: row.grant_hash, uid: row.uid_hash, userCode: row.user_code_hash, owner: row.owner_id,
    expiresAt: row.expires_at == null ? undefined : Number(row.expires_at),
    consumed: row.consumed_at == null ? undefined : Number(row.consumed_at) }; }
  async put(kind: string, id: string, payload: Payload, expiresIn?: number): Promise<void> {
    if (Date.now() >= this.nextPruneAt) {
      this.nextPruneAt = Date.now() + 60_000;
      try { await this.pruneExpired(); } catch (error) { this.nextPruneAt = 0; throw error; }
    }
    const key = this.hash(id);
    const entry: Entry = { kind, key, encrypted: this.seal(kind,key,payload),
      grant: payload.grantId ? this.hash(payload.grantId) : undefined,
      uid: payload.uid ? this.hash(payload.uid) : undefined,
      userCode: payload.userCode ? this.hash(payload.userCode) : undefined,
      owner: payload.accountId ?? payload.ownerId,
      // An anonymous registration expires after a day. An accepted Grant
      // extends its exact client at least through that Grant's lifetime.
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : kind === "Client" ? Date.now() + 86400_000 : undefined };
    if (!this.pool) {
      entry.consumed = this.memory.get(`${kind}:${key}`)?.consumed;
      if (kind === "Client") {
        const prior = this.memory.get(`${kind}:${key}`);
        if (!prior && [...this.memory.values()].filter(row => row.kind === "Client").length >= this.maxClients) {
          throw new errors.InvalidClientMetadata("Registration capacity reached");
        }
        if (prior?.expiresAt) entry.expiresAt = Math.max(entry.expiresAt!, prior.expiresAt);
      }
      if (kind === "Grant" && typeof payload.clientId === "string") {
        const client = this.memory.get(`Client:${this.hash(payload.clientId)}`);
        if (!client || (client.expiresAt !== undefined && client.expiresAt <= Date.now())) throw new errors.InvalidClient("Registration expired; reconnect");
        client.expiresAt = Math.max(client.expiresAt ?? 0, entry.expiresAt ?? Date.now() + 90 * 86400_000);
      }
      this.memory.set(`${kind}:${key}`, entry);
      return;
    }
    const write = (connection: Pool | PoolClient) => connection.query(`INSERT INTO remote_agent_protocol_state
      (kind,id_hash,encrypted_payload,grant_hash,uid_hash,user_code_hash,owner_id,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(kind,id_hash) DO UPDATE SET
      encrypted_payload=EXCLUDED.encrypted_payload,grant_hash=EXCLUDED.grant_hash,uid_hash=EXCLUDED.uid_hash,
      user_code_hash=EXCLUDED.user_code_hash,owner_id=EXCLUDED.owner_id,expires_at=EXCLUDED.expires_at`,
    [kind,key,entry.encrypted,entry.grant,entry.uid,entry.userCode,entry.owner,entry.expiresAt]);
    if (kind !== "Client" && kind !== "Grant") { await write(this.pool); return; }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (kind === "Client") {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('life-links-remote-client-admission',0))");
        const prior = await client.query("SELECT expires_at FROM remote_agent_protocol_state WHERE kind='Client' AND id_hash=$1 FOR UPDATE", [key]);
        if (!prior.rowCount && Number((await client.query("SELECT count(*) FROM remote_agent_protocol_state WHERE kind='Client'")).rows[0].count) >= this.maxClients) {
          throw new errors.InvalidClientMetadata("Registration capacity reached");
        }
        if (prior.rowCount && prior.rows[0].expires_at != null) entry.expiresAt = Math.max(entry.expiresAt!, Number(prior.rows[0].expires_at));
      }
      if (kind === "Grant" && typeof payload.clientId === "string") {
        const retained = await client.query(`UPDATE remote_agent_protocol_state SET expires_at=GREATEST(expires_at,$2)
          WHERE kind='Client' AND id_hash=$1 AND (expires_at IS NULL OR expires_at>$3)`,
        [this.hash(payload.clientId), entry.expiresAt ?? Date.now() + 90 * 86400_000, Date.now()]);
        if (!retained.rowCount) throw new errors.InvalidClient("Registration expired; reconnect");
      }
      await write(client);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  /** Bounded lazy retention within the protocol store, with no background service. */
  async pruneExpired(): Promise<number> {
    if (this.pool) {
      const result = await this.pool.query(`WITH expired AS (
        SELECT kind,id_hash FROM remote_agent_protocol_state WHERE expires_at<=$1
        ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
      ) DELETE FROM remote_agent_protocol_state AS state USING expired
        WHERE state.kind=expired.kind AND state.id_hash=expired.id_hash`, [Date.now()]);
      return result.rowCount ?? 0;
    }
    let removed = 0;
    for (const [id, row] of this.memory) if (row.expiresAt !== undefined && row.expiresAt <= Date.now()) {
      this.memory.delete(id); if (++removed >= 500) break;
    }
    return removed;
  }
  async get(kind: string, id: string): Promise<Payload | undefined> { return this.find(kind,"key",this.hash(id)); }
  async findBy(kind: string, field: "uid" | "userCode", value: string): Promise<Payload | undefined> {
    return this.find(kind,field,this.hash(value));
  }
  private async find(kind: string, field: "key" | "uid" | "userCode", hashed: string): Promise<Payload | undefined> {
    const column = { key: "id_hash", uid: "uid_hash", userCode: "user_code_hash" }[field];
    const entry = this.pool ? (await this.pool.query(`SELECT * FROM remote_agent_protocol_state
      WHERE kind=$1 AND ${column}=$2 AND (expires_at IS NULL OR expires_at>$3)`,[kind,hashed,Date.now()])).rows[0]
      : [...this.memory.values()].find(row=>row.kind===kind && row[field]===hashed);
    if (!entry) return undefined;
    const decoded = this.pool ? this.decode(entry) : entry as Entry;
    if (decoded.expiresAt && decoded.expiresAt <= Date.now()) return undefined;
    return this.open(decoded);
  }
  async remove(kind: string, id: string): Promise<void> {
    const key = this.hash(id);
    if (this.pool) await this.pool.query("DELETE FROM remote_agent_protocol_state WHERE kind=$1 AND id_hash=$2",[kind,key]);
    else this.memory.delete(`${kind}:${key}`);
  }
  async consume(kind: string, id: string): Promise<void> {
    const key=this.hash(id), now=Math.floor(Date.now()/1000);
    if (this.pool) {
      const result = await this.pool.query("UPDATE remote_agent_protocol_state SET consumed_at=$3 WHERE kind=$1 AND id_hash=$2 AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at>$4)",[kind,key,now,Date.now()]);
      if (!result.rowCount) throw new errors.InvalidGrant("credential already consumed or expired");
    } else {
      const row=this.memory.get(`${kind}:${key}`);
      if (!row || row.consumed || (row.expiresAt && row.expiresAt <= Date.now())) throw new errors.InvalidGrant("credential already consumed or expired");
      row.consumed=now;
    }
  }
  async revokeGrant(grantId: string): Promise<void> {
    const hash=this.hash(grantId);
    if(this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        // Operations take the Grant lease before touching approval receipts.
        // Revocation must use the same lock order, never hold a child row while
        // waiting for an admitted operation to finish its Grant read lease.
        await client.query("SELECT 1 FROM remote_agent_protocol_state WHERE kind='Grant' AND id_hash=$1 FOR UPDATE", [hash]);
        await client.query("DELETE FROM remote_agent_protocol_state WHERE grant_hash=$1 OR (kind='Grant' AND id_hash=$1)",[hash]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    else for(const [key,row] of this.memory) if(row.grant===hash || (row.kind==="Grant" && row.key===hash)) this.memory.delete(key);
  }
  async listOwned(kind: string, ownerId: string): Promise<Payload[]> {
    const rows=this.pool ? (await this.pool.query("SELECT * FROM remote_agent_protocol_state WHERE kind=$1 AND owner_id=$2 AND (expires_at IS NULL OR expires_at>$3)",[kind,ownerId,Date.now()])).rows.map(r=>this.decode(r))
      : [...this.memory.values()].filter(r=>r.kind===kind && r.owner===ownerId && (!r.expiresAt || r.expiresAt>Date.now()));
    return rows.map(r=>this.open(r));
  }
  async locked<T>(kind: string, id: string, action:()=>Promise<T>, grantRead=false):Promise<T> {
    const key=`${kind}:${this.hash(id)}`;
    if(this.pool) {
      // Leave pool capacity for canonical store transactions and owner revocation.
      if (grantRead) {
        const maxLeases = Math.max(1, Math.floor(((this.pool.options.max ?? 10) - 2) / 3));
        if (this.leases >= maxLeases) await new Promise<void>(resolve => this.leaseWaiters.push(resolve));
        this.leases++;
      }
      let client: PoolClient | undefined;
      let transaction = false;
      const acquire = async () => {
        client ??= await this.pool!.connect();
        await client.query("BEGIN"); transaction = true;
        if(grantRead) {
          const row=await client.query("SELECT 1 FROM remote_agent_protocol_state WHERE kind='Grant' AND id_hash=$1 AND (expires_at IS NULL OR expires_at>$2) FOR SHARE",[this.hash(id),Date.now()]);
          if(!row.rowCount) throw new RemoteAgentAccessError("remote_agent_connection_revoked");
        } else await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[key]);
      };
      try {
        await acquire();
        const suspended = async <R>(prompt: () => Promise<R>): Promise<R> => {
          await client!.query("COMMIT"); transaction = false;
          client!.release(); client = undefined;
          try { return await prompt(); } finally { await acquire(); }
        };
        const result=await (grantRead ? this.grantLease.run(suspended, action) : action());
        await client!.query("COMMIT"); transaction = false; return result;
      } catch(error){if(transaction)await client?.query("ROLLBACK");throw error;}
      finally {
        client?.release();
        if (grantRead) { this.leases--; this.leaseWaiters.shift()?.(); }
      }
    }
    const previous=this.locks.get(key)??Promise.resolve(); let release!:()=>void;
    const current=new Promise<void>(resolve=>{release=resolve;}); this.locks.set(key,current); await previous;
    try{return await action();}finally{release();if(this.locks.get(key)===current)this.locks.delete(key);}
  }
  /** A human prompt cannot hold a grant read lock against owner revocation. */
  withoutGrantLease<T>(action: () => Promise<T>): Promise<T> {
    const suspend = this.grantLease.getStore();
    return suspend ? suspend(action) : action();
  }
  adapter(): AdapterConstructor {
    const state=this;
    return class {
      constructor(private readonly name:string){}
      upsert(id:string,payload:Payload,expiresIn?:number){return state.put(this.name,id,payload,expiresIn);}
      find(id:string){return state.get(this.name,id);}
      findByUid(uid:string){return state.findBy(this.name,"uid",uid);}
      findByUserCode(code:string){return state.findBy(this.name,"userCode",code);}
      destroy(id:string){return state.remove(this.name,id);}
      consume(id:string){return state.consume(this.name,id);}
      revokeByGrantId(id:string){return state.revokeGrant(id);}
    };
  }
}

export class PersistentRemoteApprovals implements RemoteApprovalService {
  constructor(private readonly state:RemoteAgentState){}
  async prepare(principal:RemoteAgentPrincipal,input:{operation:string;payload:Record<string,unknown>;effects:unknown;id?:string}):Promise<RemoteApproval>{
    assertRemoteScope(principal); const id=input.id??randomUUID();
    return this.state.locked("Approval",id,async()=>{
      const prior=await this.state.get("Approval",id);
      if(prior){const entry=await this.get(principal,id);if(entry.operation!==input.operation || !isDeepStrictEqual(entry.payload,input.payload) || !isDeepStrictEqual(entry.effects,input.effects))throw new RemoteAgentAccessError("remote_approval_conflict");return entry;}
      const row:RemoteApproval={...input,id,ownerId:principal.ownerId,clientId:principal.clientId,grantId:principal.grantId,
        status:"pending",createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+15*60_000).toISOString()};
      await this.state.put("Approval",id,row,24*60*60);return row;
    });
  }
  async get(principal:RemoteAgentPrincipal,id:string):Promise<RemoteApproval>{
    assertRemoteScope(principal); const row=await this.state.get("Approval",id) as RemoteApproval|undefined;
    if(!row || row.ownerId!==principal.ownerId || row.clientId!==principal.clientId || row.grantId!==principal.grantId)throw new RemoteAgentAccessError("remote_approval_unavailable");
    if(row.status==="pending" && Date.parse(row.expiresAt)<=Date.now())throw new RemoteAgentAccessError("remote_approval_expired");
    return row;
  }
  locked<T>(principal:RemoteAgentPrincipal,id:string,action:()=>Promise<T>):Promise<T>{
    return this.state.locked("Approval",id,async()=>{await this.get(principal,id);return action();});
  }
  /** The caller already holds the approval lock; never hold it while the user views the component. */
  async issueUiChallenge(principal:RemoteAgentPrincipal,id:string):Promise<string>{
    const row=await this.get(principal,id);
    if(row.status!=="pending")throw new RemoteAgentAccessError("confirmation_invalid");
    if(row.uiChallenge!==undefined){
      if(typeof row.uiChallenge!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(row.uiChallenge))throw new RemoteAgentAccessError("confirmation_invalid");
      return row.uiChallenge;
    }
    row.uiChallenge=randomBytes(32).toString("base64url");
    await this.state.put("Approval",id,row,24*60*60);
    return row.uiChallenge;
  }
  /** Validate only pending confirmation, without a separate consume/write that could strand a retry. */
  async validateUiChallenge(principal:RemoteAgentPrincipal,id:string,challenge:unknown):Promise<void>{
    const row=await this.get(principal,id);
    if(row.status!=="pending" || typeof row.uiChallenge!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(row.uiChallenge)
      || typeof challenge!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)
      || !timingSafeEqual(Buffer.from(row.uiChallenge,"utf8"),Buffer.from(challenge,"utf8"))){
      throw new RemoteAgentAccessError("confirmation_invalid");
    }
  }
  async approve(principal:RemoteAgentPrincipal,id:string,accepted:boolean):Promise<RemoteApproval>{
    const row=await this.get(principal,id); if(row.status!=="pending")return row;
    row.status=accepted?"approved":"declined";delete row.uiChallenge;
    await this.state.put("Approval",id,row,24*60*60);return row;
  }
  async complete(principal:RemoteAgentPrincipal,id:string,result:unknown):Promise<RemoteApproval>{
    const row=await this.get(principal,id);if(row.status==="applied")return row;
    if(row.status!=="approved")throw new RemoteAgentAccessError("remote_approval_required");
    row.status="applied";row.result=result;await this.state.put("Approval",id,row,24*60*60);return row;
  }
}
