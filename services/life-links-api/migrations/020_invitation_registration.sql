-- Existing owners are never merged, renamed, or password-reset by admission.
-- Acquire the table lock before preflight so concurrent inserts cannot race it.
LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users GROUP BY lower(email) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Account registration migration refused: case-insensitive email duplicates require owner review';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_case_insensitive ON users(lower(email));

-- Retain spent admission capacity even if account-retirement is added later.
-- A fingerprint is SHA-256 of a high-entropy invitation, never the invitation itself.
CREATE TABLE account_registrations (
  user_id text PRIMARY KEY REFERENCES users(id),
  invitation_fingerprint text NOT NULL CHECK (invitation_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_account_registrations_invitation ON account_registrations(invitation_fingerprint);
