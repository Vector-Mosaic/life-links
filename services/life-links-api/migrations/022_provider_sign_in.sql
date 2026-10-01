-- Provider-only accounts have no password. Existing IDs and password hashes stay intact.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Mailbox/display metadata never decides which canonical owner an identity can access.
CREATE TABLE provider_sign_in_identities (
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 1024),
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 1024),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 1024),
  owner_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  CHECK (octet_length(provider) + octet_length(issuer) + octet_length(client_id) + octet_length(subject) <= 2048),
  PRIMARY KEY (provider, issuer, client_id, subject)
);
CREATE INDEX idx_provider_sign_in_identities_owner ON provider_sign_in_identities(owner_id);

-- Only opaque browser/state fingerprints and authenticated ciphertext are retained.
CREATE TABLE provider_sign_in_attempts (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  browser_hash text NOT NULL CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  encrypted_payload text NOT NULL CHECK (length(encrypted_payload) BETWEEN 1 AND 65536),
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_provider_sign_in_attempts_expiry ON provider_sign_in_attempts(expires_at);
