-- Private OAuth state and MSAL cache. Payload encryption is owned by the
-- application; only opaque handles enter provider connection records.
CREATE TABLE calendar_provider_secrets (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('authorization', 'credential')),
  encrypted_payload text NOT NULL,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);
CREATE INDEX idx_calendar_provider_secrets_expiry ON calendar_provider_secrets(expires_at)
  WHERE expires_at IS NOT NULL;
ALTER TABLE calendar_provider_outbox ADD COLUMN dispatch_evidence jsonb;
ALTER TABLE calendar_provider_outbox DROP CONSTRAINT calendar_provider_outbox_status_check;
ALTER TABLE calendar_provider_outbox ADD CONSTRAINT calendar_provider_outbox_status_check
  CHECK (status IN ('pending', 'processing', 'succeeded', 'conflict', 'rejected'));

-- Notification identity is server-only. Store only the nonce hash; notification
-- bodies are not calendar truth and their event content is never retained here.
CREATE TABLE calendar_provider_subscriptions (
  connection_id text PRIMARY KEY REFERENCES calendar_provider_connections(connection_id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_handle text NOT NULL,
  subscription_key uuid NOT NULL UNIQUE,
  provider_subscription_id text UNIQUE,
  client_state_hash text NOT NULL CHECK (client_state_hash ~ '^[a-f0-9]{64}$'),
  notification_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  renewal_required boolean NOT NULL DEFAULT false,
  hint_version bigint NOT NULL DEFAULT 0 CHECK (hint_version >= 0),
  handled_hint_version bigint NOT NULL DEFAULT 0 CHECK (handled_hint_version >= 0)
);
