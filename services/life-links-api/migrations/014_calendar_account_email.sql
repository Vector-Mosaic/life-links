-- Optional provider-authenticated, owner-private display metadata only.
-- Existing stable provider account identities, credentials and grants are unchanged.
ALTER TABLE calendar_provider_connections
  ADD COLUMN account_email TEXT
  CHECK (account_email IS NULL OR char_length(account_email) BETWEEN 3 AND 320);
