-- Invitation links bootstrap new private owners; they never authorize existing data.
CREATE TABLE member_invitations (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id),
  fingerprint text NOT NULL UNIQUE CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  revoked_at timestamptz,
  redeemed_at timestamptz
);
CREATE INDEX idx_member_invitations_owner ON member_invitations(owner_id, created_at DESC);
