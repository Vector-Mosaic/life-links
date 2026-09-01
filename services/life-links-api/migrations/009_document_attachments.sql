-- Attachments retain the canonical Life Link-owned media row and byte identity.
ALTER TABLE link_media DROP CONSTRAINT link_media_kind_check;
ALTER TABLE link_media ADD CONSTRAINT link_media_kind_check
  CHECK (kind IN ('image', 'video', 'document'));
