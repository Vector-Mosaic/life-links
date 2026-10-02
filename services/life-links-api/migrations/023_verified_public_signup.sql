-- Public provider/phone owners may have no email. Existing nonnull email uniqueness remains intact.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
-- Only a completed native mailbox challenge sets this; provider claims and legacy owners stay unverified.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

CREATE TABLE contact_verification_attempts (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  browser_hash text NOT NULL CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
  address_hash text NOT NULL CHECK (address_hash ~ '^[a-f0-9]{64}$'),
  channel text NOT NULL CHECK (channel IN ('email', 'phone')),
  intent text NOT NULL CHECK (intent IN ('register', 'login', 'link')),
  phase text NOT NULL CHECK (phase IN ('send_pending', 'sent', 'send_unknown', 'send_rejected', 'verifying', 'verified', 'consumed')),
  encrypted_payload text NOT NULL CHECK (length(encrypted_payload) BETWEEN 1 AND 65536),
  expires_at timestamptz NOT NULL,
  resend_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  check_count integer NOT NULL CHECK (check_count BETWEEN 0 AND 5)
);
CREATE INDEX idx_contact_verification_attempts_expiry ON contact_verification_attempts(expires_at);
CREATE INDEX idx_contact_verification_attempts_address ON contact_verification_attempts(channel, address_hash, phase);

-- Fixed-window reservations are independent of external-provider status and survive restarts.
CREATE TABLE contact_verification_limits (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  count integer NOT NULL CHECK (count BETWEEN 1 AND 1000000),
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_contact_verification_limits_expiry ON contact_verification_limits(expires_at);

-- No raw telephone number or verification code is kept in a canonical credential binding.
CREATE TABLE phone_sign_in_identities (
  phone_hash text PRIMARY KEY CHECK (phone_hash ~ '^[a-f0-9]{64}$'),
  masked_number text NOT NULL CHECK (length(masked_number) BETWEEN 1 AND 32),
  owner_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_phone_sign_in_identities_owner ON phone_sign_in_identities(owner_id);
