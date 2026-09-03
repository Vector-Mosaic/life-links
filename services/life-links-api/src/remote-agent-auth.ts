import { createHmac, generateKeyPairSync, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import express from "express";
import cookie from "cookie";
import Provider, { errors, interactionPolicy, type Configuration } from "oidc-provider";
import type { LifeLinksConfig } from "./config.js";
import type { LifeLinksStore } from "./store.js";
import type { Logger } from "./logger.js";
import { hashSessionToken, verifyPassword } from "./password.js";
import { RemoteAgentState } from "./remote-agent-state.js";
import { REMOTE_AGENT_SCOPES, RemoteAgentAccessError, assertRemoteScope,
  runWithRemoteAgentPrincipal, type RemoteAgentPrincipal, type RemoteAuthorization } from "./remote-agent-principal.js";

const html = (value: unknown) => String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const SESSION_COOKIE = "life_links_session";
const CLIENT_FIELDS = new Set(["redirect_uris", "client_name", "client_uri", "logo_uri", "policy_uri", "tos_uri", "software_id", "software_version",
  "grant_types", "response_types", "token_endpoint_auth_method", "application_type", "scope"]);
const OAUTH_ERRORS = new Set(["invalid_request", "invalid_client", "invalid_client_metadata", "invalid_redirect_uri", "invalid_grant", "invalid_scope", "invalid_target",
  "unauthorized_client", "unsupported_grant_type", "unsupported_response_type", "access_denied", "login_required", "consent_required", "interaction_required", "server_error"]);
const INTERACTION_ERRORS = new Set(["invalid_origin", "invalid_csrf", "invalid_redirect_uri", "remote_agent_access_denied"]);

async function browserSessionOwner(cookieHeader:string|undefined,store:LifeLinksStore,config:LifeLinksConfig){
  const token=cookie.parse(cookieHeader??"")[SESSION_COOKIE];
  return token?(await store.getSessionByTokenHash(hashSessionToken(token,config.sessionSecret)))?.user:null;
}

function publicClientRedirect(value: unknown): URL | undefined {
  if(typeof value!=="string" || value.length>2048 || value.includes("\\"))return;
  try {
    const url=new URL(value);
    if(url.username || url.password || url.hash ||
      (url.protocol!=="https:" && !(url.protocol==="http:" && /^http:\/\/(127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:[/?]|$)/.test(value))))return;
    return url;
  } catch { return; }
}

function validateClient(metadata: Record<string, unknown>, original?: unknown): void {
  const reject = () => { throw new errors.InvalidClientMetadata("Client metadata is not supported by Life Links"); };
  if (original && typeof original === "object" && Object.keys(original).some((key) => !CLIENT_FIELDS.has(key))) reject();
  if (metadata.token_endpoint_auth_method !== "none" || !["web", "native"].includes(String(metadata.application_type))) reject();
  const grants = metadata.grant_types;
  if (!Array.isArray(grants) || !grants.includes("authorization_code") || grants.length > 2 ||
    grants.some((value) => value !== "authorization_code" && value !== "refresh_token") || new Set(grants).size !== grants.length) reject();
  if (!Array.isArray(metadata.response_types) || metadata.response_types.length !== 1 || metadata.response_types[0] !== "code") reject();
  if (typeof metadata.scope === "string" && metadata.scope.split(" ").some((scope) => !["openid", "offline_access", ...REMOTE_AGENT_SCOPES].includes(scope))) reject();
  const redirects = metadata.redirect_uris;
  if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > 8) reject();
  for (const value of redirects as unknown[]) {
    if (!publicClientRedirect(value)) reject();
  }
  for (const field of ["client_name", "software_id", "software_version"]) {
    const value = metadata[field]; if (value !== undefined && (typeof value !== "string" || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value))) reject();
  }
  // Reject external key, signed-request and callback metadata even on a persisted
  // client load. Display-only links are never fetched or used as identity.
  for (const field of ["jwks", "jwks_uri", "sector_identifier_uri", "request_uris", "initiate_login_uri", "backchannel_logout_uri", "post_logout_redirect_uris"]) {
    if (metadata[field] !== undefined) reject();
  }
}

function interactionFormAction(response: Response, redirect: unknown, client: { redirectUriAllowed(value: string): boolean } | undefined): void {
  const url=publicClientRedirect(redirect);
  // Reuse oidc-provider's registered-client matching: exact web/HTTPS URI, or
  // only the loopback listener port may vary for a native client (RFC 8252).
  if(!url || typeof redirect!=="string" || !client?.redirectUriAllowed(redirect))throw new RemoteAgentAccessError("invalid_redirect_uri");
  // CSP accepts an origin/path source, not OAuth query parameters. Parse rather
  // than interpolate raw metadata: a semicolon, space or wildcard must never
  // become a new directive or a broader callback source.
  if(!/^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::\d+)?$/i.test(url.origin) || url.username || url.password || url.hash){
    throw new RemoteAgentAccessError("invalid_redirect_uri");
  }
  const path=url.pathname.replace(/[;,'"*\s]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const formAction=`form-action 'self' ${url.origin}${path}`;
  const current=response.getHeader("Content-Security-Policy");
  const directives=typeof current==="string"?current.split(";").map(value=>value.trim()).filter(Boolean):[];
  const index=directives.findIndex(value=>/^form-action(?:\s|$)/i.test(value));
  if(index<0)directives.push(formAction);else directives[index]=formAction;
  response.setHeader("Content-Security-Policy",directives.join("; "));
}

const issued = new WeakMap<RemoteAgentPrincipal,{token:string}>();
export class RemoteAgentAuth {
  readonly issuer: string;
  readonly resource: string;
  readonly router = Router();
  private constructor(readonly provider: Provider, readonly state:RemoteAgentState,
    private readonly store:LifeLinksStore,private readonly config:LifeLinksConfig,private readonly logger:Logger) {
    this.issuer=`${config.qrBaseUrl}/oauth`;this.resource=`${config.qrBaseUrl}/mcp`;
    this.mount();
  }
  static async create(state:RemoteAgentState,store:LifeLinksStore,config:LifeLinksConfig,logger:Logger):Promise<RemoteAgentAuth>{
    const issuer=`${config.qrBaseUrl}/oauth`,resource=`${config.qrBaseUrl}/mcp`;
    const keys=await state.locked("Configuration","signing-keys",async()=>{
      const existing=await state.get("Configuration","signing-keys");if(existing)return existing;
      const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
      const value={keys:[{...privateKey.export({format:"jwk"}),use:"sig",alg:"RS256",kid:"life-links-remote-1"}]};
      await state.put("Configuration","signing-keys",value);return value;
    });
    const policy=interactionPolicy.base();
    policy.get("login")!.checks.add(new interactionPolicy.Check("life_links_owner_changed",
      "The current Life Links account must confirm this connection", "login_required", async ctx=>{
        // The browser app and oidc-provider have independent session cookies.
        // Reconcile an explicit browser account switch through normal login,
        // never by changing a grant's owner or silently approving consent.
        const oauthOwner=ctx.oidc.session?.accountId;
        if(!oauthOwner)return interactionPolicy.Check.NO_NEED_TO_PROMPT;
        const browserOwner=await browserSessionOwner(ctx.req.headers.cookie,store,config);
        return Boolean(browserOwner && browserOwner.id!==oauthOwner);
      }));
    const configuration:Configuration={
      adapter:state.adapter(),jwks:keys as Configuration["jwks"],
      cookies:{keys:[createHmac("sha256",config.sessionSecret).update("remote-oauth-cookies-v1").digest("base64url")],
        long:{httpOnly:true,sameSite:"lax",secure:config.secureCookies},short:{httpOnly:true,sameSite:"lax",secure:config.secureCookies}},
      scopes:["openid","offline_access",...REMOTE_AGENT_SCOPES], claims:{openid:["sub"]},
      responseTypes:["code"],pkce:{required:()=>true},
      clientAuthMethods:["none"],
      clientDefaults:{grant_types:["authorization_code","refresh_token"],response_types:["code"],token_endpoint_auth_method:"none"},
      extraClientMetadata:{properties:["redirect_uris"],validator:(ctx,_key,_value,metadata)=>validateClient(metadata,ctx?.oidc.body)},
      fetch:async()=>{throw new errors.InvalidRequest("Remote metadata is not supported");},
      features:{devInteractions:{enabled:false},registration:{enabled:true,issueRegistrationAccessToken:false},registrationManagement:{enabled:false},revocation:{enabled:true},
        requestObjects:{enabled:false},clientCredentials:{enabled:false},rpInitiatedLogout:{enabled:false},
        resourceIndicators:{enabled:true,defaultResource:()=>resource,useGrantedResource:()=>true,
          getResourceServerInfo:async(_ctx,requested)=>{
            if(requested!==resource)throw new errors.InvalidTarget();
            return {scope:REMOTE_AGENT_SCOPES.join(" "),audience:resource,accessTokenTTL:3600,accessTokenFormat:"opaque"};
          }}},
      ttl:{AccessToken:3600,AuthorizationCode:120,Grant:90*86400,RefreshToken:30*86400,Interaction:600,Session:30*86400,IdToken:3600},
      issueRefreshToken:(_ctx,client)=>client.grantTypeAllowed("refresh_token"),
      // A deliberately consented remote grant is independent of the browser's
      // login session, including OAuth-only clients that do not request OIDC.
      expiresWithSession:()=>false,
      rotateRefreshToken:true,
      interactions:{policy,url:(_ctx,interaction)=>`${config.qrBaseUrl}/agent-authorize/${interaction.uid}`},
      findAccount:async(_ctx,id)=>await store.getUserById(id)?{accountId:id,claims:async()=>({sub:id})}:undefined,
      renderError:(_ctx)=>{_ctx.type="html";_ctx.body=page("Connection unsuccessful","<p>The authorization request could not be completed.</p><p>Return to your agent and connect Life Links again.</p>");},
    };
    const provider=new Provider(issuer,configuration);provider.proxy=config.trustProxy;
    // Keep machine-readable OAuth codes without echoing provider descriptions,
    // request bodies, redirect URIs, passwords or code/token values.
    provider.use(async(ctx,next)=>{
      ctx.res.setHeader("Cache-Control","no-store");
      await next();
      if(ctx.status>=400 && ctx.body && typeof ctx.body==="object" && "error" in ctx.body){
        const body=ctx.body as {error?:unknown};
        ctx.body={error:typeof body.error==="string" && OAUTH_ERRORS.has(body.error)?body.error:"invalid_request",
          error_description:"The OAuth request could not be completed."};
      }
    });
    for(const name of ["authorization.error","grant.error","server_error"] as const) provider.on(name as any,()=>{
      logger.warn("life_links.remote_oauth.rejected",{reason:"oauth_request_rejected"});
    });
    return new RemoteAgentAuth(provider,state,store,config,logger);
  }
  private async owner(request:Request){
    return browserSessionOwner(request.headers.cookie,this.store,this.config);
  }
  private csrf(id:string):string{return createHmac("sha256",this.config.sessionSecret).update(`remote-consent:${id}`).digest("base64url");}
  private checkPost(request:Request,id:string){
    if(request.get("origin")!==new URL(this.config.qrBaseUrl).origin)throw new RemoteAgentAccessError("invalid_origin");
    const actual=Buffer.from(typeof request.body.csrf==="string"?request.body.csrf:""),expected=Buffer.from(this.csrf(id));
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected))throw new RemoteAgentAccessError("invalid_csrf");
  }
  private mount(){
    const attempts=new Map<string,{count:number;until:number}>();
    this.router.use(["/oauth","/agent-authorize","/agent-connections"],(req,res,next)=>{
      res.setHeader("Cache-Control","no-store");
      if(!this.config.rateLimitEnabled){next();return;}
      const path=req.originalUrl.split("?")[0];
      const bucket=path==="/oauth/reg"?"registration":path.startsWith("/agent-authorize/") && req.method==="POST"?"login":"oauth";
      const max=bucket==="oauth"?Math.min(this.config.rateLimitMutationMax,120):this.config.rateLimitLoginMax;
      const now=Date.now(),window=Math.max(1000,this.config.rateLimitWindowMs);
      for(const [key,value] of attempts)if(value.until<=now)attempts.delete(key);
      const key=createHmac("sha256",this.config.sessionSecret).update(`${bucket}:${req.ip??req.socket.remoteAddress??"unknown"}`).digest("hex");
      const entry=attempts.get(key)??{count:0,until:now+window};
      if(entry.count>=max || (!attempts.has(key) && attempts.size>=4096)){
        res.setHeader("Retry-After",String(Math.max(1,Math.ceil((entry.until-now)/1000))));
        this.logger.warn("life_links.remote_oauth.rate_limited",{bucket});res.status(429).json({error:"rate_limited"});return;
      }
      entry.count++;attempts.set(key,entry);next();
    });
    const handler=(fn:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response)=>void fn(req,res).catch((error:unknown)=>{
      const reason=error instanceof RemoteAgentAccessError && INTERACTION_ERRORS.has(error.code)?error.code:"interaction_request_rejected";
      this.logger.warn("life_links.remote_oauth.rejected",{reason});
      if(!res.headersSent)res.status(400).type("html").send(page("Connection could not continue","<p>Return to your agent and start the connection again.</p>"));
    });
    const metadata={resource:this.resource,authorization_servers:[this.issuer],scopes_supported:[...REMOTE_AGENT_SCOPES],
      resource_name:"Life Links",resource_documentation:`${this.config.qrBaseUrl}/agent-connections`};
    this.router.get(["/.well-known/oauth-protected-resource","/.well-known/oauth-protected-resource/mcp"],(_req,res)=>res.json(metadata));
    this.router.get("/.well-known/oauth-authorization-server/oauth",(_req,res)=>res.redirect(302,`${this.issuer}/.well-known/openid-configuration`));
    // no-referrer makes a browser's navigate-mode form POST send Origin:null,
    // including to this same origin. Keep exact-Origin CSRF checks usable while
    // still withholding the interaction URL from external callback origins.
    this.router.use(["/agent-authorize","/agent-connections"],(_req,res,next)=>{res.setHeader("Cache-Control","no-store");res.setHeader("Referrer-Policy","same-origin");next();});
    this.router.get("/agent-authorize/:uid",handler(async(req,res)=>{
      const details=await this.provider.interactionDetails(req,res),browserOwner=await this.owner(req);
      const client=await this.provider.Client.find(String(details.params.client_id));
      const name=client?.clientName??"Your agent";
      const uid=details.uid;
      if(uid!==req.params.uid)throw new RemoteAgentAccessError();
      interactionFormAction(res,details.params.redirect_uri,client);
      const login=details.prompt.name==="login";
      const owner=login?browserOwner:details.session?.accountId?await this.store.getUserById(details.session.accountId):null;
      if(!login && (!owner || (browserOwner && browserOwner.id!==owner.id)))throw new RemoteAgentAccessError();
      const content=login && !owner?`<label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>`:
        `<p>${login?"Continue as":"Authorize"} ${html(owner?.email??"your Life Links account")}.</p>`;
      const scopes=String(details.params.scope??"").split(" ").filter(s=>(REMOTE_AGENT_SCOPES as readonly string[]).includes(s));
      const registrationAvailable=login && this.config.registration && await this.store.registrationAvailable(this.config.registration);
      const registrationLink=registrationAvailable?`<p>Have a private judge invitation? <a href="${html(`/register?returnTo=${encodeURIComponent(`/agent-authorize/${uid}`)}`)}">Create your private Life Links account</a>.</p>`:"";
      res.type("html").send(page(`Connect ${name} to Life Links`,`${content ? `<form method="post" action="/agent-authorize/${html(uid)}"><input type="hidden" name="csrf" value="${html(this.csrf(uid))}">${content}`:""}
        ${!login?`<p>This connection can work while Life Links is closed. Access stays private to this account.</p><ul>${scopes.map(s=>`<li>${html(s.replace(":",": "))}</li>`).join("")}</ul><p>Calendar access is additionally limited by each calendar's Agent access setting. Your agent cannot grant itself permissions.</p>`:""}
        <button name="action" value="approve">${login?"Continue":"Connect Life Links"}</button><button class="secondary" name="action" value="cancel">Cancel</button></form>${registrationLink}`));
    }));
    this.router.post("/agent-authorize/:uid",express.urlencoded({extended:false,limit:"12kb"}),handler(async(req,res)=>{
      const details=await this.provider.interactionDetails(req,res);if(details.uid!==req.params.uid)throw new RemoteAgentAccessError();this.checkPost(req,details.uid);
      const client=await this.provider.Client.find(String(details.params.client_id));
      interactionFormAction(res,details.params.redirect_uri,client);
      if(req.body.action!=="approve"){await this.provider.interactionFinished(req,res,{error:"access_denied"},{mergeWithLastSubmission:false});return;}
      if(details.prompt.name==="login"){
        let owner=await this.owner(req);
        if(!owner && typeof req.body.email==="string" && req.body.email.length<=254 && typeof req.body.password==="string" && req.body.password.length<=1024){
          const candidate=await this.store.getUserByEmail(req.body.email.trim().toLowerCase());
          if(candidate && await verifyPassword(req.body.password,candidate.passwordHash))owner=candidate;
        }
        if(!owner){res.status(401).type("html").send(page("Sign-in unsuccessful",`<p>The email or password was not accepted.</p><a href="/agent-authorize/${html(details.uid)}">Try again</a>`));return;}
        await this.provider.interactionFinished(req,res,{login:{accountId:owner.id,remember:true}},{mergeWithLastSubmission:false});return;
      }
      if(details.prompt.name!=="consent" || !details.session?.accountId)throw new RemoteAgentAccessError();
      if(!await this.store.getUserById(details.session.accountId))throw new RemoteAgentAccessError();
      const browserOwner=await this.owner(req);if(browserOwner && browserOwner.id!==details.session.accountId)throw new RemoteAgentAccessError();
      const grant=details.grantId?await this.provider.Grant.find(details.grantId):new this.provider.Grant({accountId:details.session.accountId,clientId:String(details.params.client_id)});
      if(!grant || grant.accountId!==details.session.accountId || grant.clientId!==details.params.client_id)throw new RemoteAgentAccessError();
      const missing=details.prompt.details as {missingOIDCScope?:string[];missingOIDCClaims?:string[];missingResourceScopes?:Record<string,string[]>};
      if(missing.missingOIDCScope)grant.addOIDCScope(missing.missingOIDCScope.join(" "));
      if(missing.missingOIDCClaims)grant.addOIDCClaims(missing.missingOIDCClaims);
      for(const [resource,scopes] of Object.entries(missing.missingResourceScopes??{})){
        if(resource!==this.resource || scopes.some(s=>!(REMOTE_AGENT_SCOPES as readonly string[]).includes(s)))throw new RemoteAgentAccessError();
        grant.addResourceScope(resource,scopes.join(" "));
      }
      const grantId=await grant.save();
      this.logger.info("life_links.remote_oauth.connected",{user_id:grant.accountId,client_id:grant.clientId});
      await this.provider.interactionFinished(req,res,{consent:{grantId}},{mergeWithLastSubmission:true});
    }));
    this.router.get("/agent-connections",handler(async(req,res)=>{
      const owner=await this.owner(req);if(!owner){res.status(401).type("html").send(page("Sign in to Life Links",'<p>Open Life Links and sign in to manage agent connections.</p><a href="/">Open Life Links</a>'));return;}
      const grants=await this.state.listOwned("Grant",owner.id);
      const cards=await Promise.all(grants.map(async g=>{const client=await this.provider.Client.find(g.clientId);return `<section><h2>${html(client?.clientName??"Agent connection")}</h2><p>${html(g.resources?.[this.resource]??"")}</p><form method="post" action="/agent-connections/revoke"><input type="hidden" name="grantId" value="${html(g.jti)}"><input type="hidden" name="csrf" value="${this.csrf(`revoke:${owner.id}:${g.jti}`)}"><button>Disconnect agent</button></form></section>`;}));
      res.type("html").send(page("Connected agents",`<p>Remote agents can use Life Links without an open website tab. Disconnecting revokes that client's access and refresh tokens; your records are preserved.</p>${cards.join("")||"<p>No remote agents connected.</p>"}<a href="/">Back to Life Links</a>`));
    }));
    this.router.post("/agent-connections/revoke",express.urlencoded({extended:false,limit:"4kb"}),handler(async(req,res)=>{
      const owner=await this.owner(req);if(!owner || typeof req.body.grantId!=="string")throw new RemoteAgentAccessError();
      this.checkPost(req,`revoke:${owner.id}:${req.body.grantId}`);
      const grant=await this.provider.Grant.find(req.body.grantId);if(!grant || grant.accountId!==owner.id)throw new RemoteAgentAccessError();
      await this.state.revokeGrant(req.body.grantId);this.logger.info("life_links.remote_oauth.disconnected",{user_id:owner.id,client_id:grant.clientId});
      res.redirect(303,"/agent-connections");
    }));
    this.router.use("/oauth",this.provider.callback());
    this.router.use(["/agent-authorize","/agent-connections"],(error:unknown,_req:Request,res:Response,_next:express.NextFunction)=>{
      if(res.headersSent)return;
      const status=typeof error==="object" && error!==null && "status" in error && error.status===413?413:400;
      res.status(status).type("html").send(page("Connection could not continue","<p>The request could not be accepted. Return to your agent and try again.</p>"));
    });
  }
  async authenticate(request:Request):Promise<RemoteAgentPrincipal>{
    const match=/^Bearer ([A-Za-z0-9._~-]{16,4096})$/i.exec(request.get("authorization")??"");
    if(!match)throw new RemoteAgentAccessError("remote_agent_authentication_required");
    const token=await this.provider.AccessToken.find(match[1]);
    if(!token || token.isExpired || token.aud!==this.resource || !token.accountId || !token.grantId || !token.clientId || !token.exp)throw new RemoteAgentAccessError("remote_agent_invalid_token");
    const principal:RemoteAgentPrincipal={ownerId:token.accountId,clientId:token.clientId,grantId:token.grantId,
      scopes:(token.scope??"").split(" "),expiresAt:token.exp!*1000};
    issued.set(principal,{token:match[1]});await this.authorize(principal);return principal;
  }
  async authorize(principal:RemoteAgentPrincipal,input?:RemoteAuthorization):Promise<void>{
    assertRemoteScope(principal,input);const credential=issued.get(principal);if(!credential)throw new RemoteAgentAccessError();
    const [token,grant,user]=await Promise.all([this.provider.AccessToken.find(credential.token),this.provider.Grant.find(principal.grantId),this.store.getUserById(principal.ownerId)]);
    if(!token || token.isExpired || token.aud!==this.resource || token.accountId!==principal.ownerId || token.clientId!==principal.clientId || token.grantId!==principal.grantId || !grant || grant.accountId!==principal.ownerId || grant.clientId!==principal.clientId || !user)throw new RemoteAgentAccessError("remote_agent_connection_revoked");
    if(input && !grant.getResourceScope(this.resource).split(" ").includes(`${input.capability}:${input.write?"write":"read"}`))throw new RemoteAgentAccessError("remote_agent_insufficient_scope");
    if(input?.capability==="calendar" && input.calendarId){
      const calendar=await runWithRemoteAgentPrincipal(principal,()=>this.store.getCalendar(principal.ownerId,input.calendarId!,"agent"));
      if(!calendar || (input.write && calendar.agentAccess!=="write"))throw new RemoteAgentAccessError("calendar_access_denied");
    }
  }
  async withPrincipal<T>(principal:RemoteAgentPrincipal,action:()=>Promise<T>):Promise<T>{
    return this.state.locked("Grant",principal.grantId,async()=>{
      await this.authorize(principal);return runWithRemoteAgentPrincipal(principal,async()=>{
        const result=await action();await this.authorize(principal);return result;
      });
    },true);
  }
}
function page(title:string,body:string):string{return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${html(title)} · Life Links</title><style>body{font:17px system-ui;background:#18231f;color:#edf4ef;margin:0;padding:24px}main{max-width:560px;margin:6vh auto;padding:28px;background:#222d28;border:1px solid #456055;border-radius:18px}h1{font-size:28px}h2{font-size:21px}p,li{line-height:1.5}label{display:block;margin:16px 0}input{display:block;box-sizing:border-box;width:100%;padding:12px;margin-top:8px;border:1px solid #70897c;border-radius:8px;background:#14201a;color:inherit;font:inherit}input[type=hidden]{display:none}button,a{font:inherit}button{padding:12px 18px;background:#80c8ae;color:#153a2c;border:0;border-radius:9px;cursor:pointer;margin:12px 10px 8px 0}.secondary{background:#3c4d44;color:inherit}a{color:#9adcbe}section{border-top:1px solid #4b6255;margin-top:20px}</style></head><body><main><h1>${html(title)}</h1>${body}</main></body></html>`;}
