-- Preserve existing fixed-window counts/expiry. Rolling reservations retain
-- only times under the existing opaque key, never a contact, code or message.
ALTER TABLE contact_verification_limits
  ADD COLUMN reserved_at timestamptz[] NOT NULL DEFAULT '{}';
