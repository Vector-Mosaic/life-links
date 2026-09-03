-- OAuth artifacts and remote approval receipts, never a second account/domain store.
CREATE TABLE remote_agent_protocol_state (
  kind text NOT NULL,
  id_hash text NOT NULL,
  encrypted_payload text NOT NULL,
  grant_hash text,
  uid_hash text,
  user_code_hash text,
  owner_id text,
  expires_at bigint,
  consumed_at bigint,
  PRIMARY KEY (kind,id_hash)
);
CREATE INDEX remote_agent_protocol_grant ON remote_agent_protocol_state(grant_hash);
CREATE INDEX remote_agent_protocol_uid ON remote_agent_protocol_state(kind,uid_hash);
CREATE INDEX remote_agent_protocol_user_code ON remote_agent_protocol_state(kind,user_code_hash);
CREATE INDEX remote_agent_protocol_expiry ON remote_agent_protocol_state(expires_at);
CREATE INDEX remote_agent_protocol_owner ON remote_agent_protocol_state(kind,owner_id);
