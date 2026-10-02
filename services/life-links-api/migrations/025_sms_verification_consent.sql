-- Minimal verification-only consent evidence. No raw phone, code, session,
-- browser/IP, owner, provider message or marketing consent is stored here.
CREATE TABLE sms_verification_consent_receipts (
  receipt_hash text PRIMARY KEY CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
  phone_hash text NOT NULL CHECK (phone_hash ~ '^[a-f0-9]{64}$'),
  consented_at timestamptz NOT NULL,
  disclosure_version text NOT NULL CHECK (disclosure_version = 'life-links-sms-verification-v2'),
  expires_at timestamptz NOT NULL CHECK (expires_at = consented_at + interval '2160 hours')
);
CREATE INDEX idx_sms_verification_consent_expiry ON sms_verification_consent_receipts(expires_at);
