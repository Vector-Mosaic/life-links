CREATE TABLE IF NOT EXISTS link_media (
  id text PRIMARY KEY,
  qr_id text NOT NULL REFERENCES links(qr_id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'video')),
  mime_type text NOT NULL,
  file_name text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_link_media_qr_id ON link_media(qr_id);
CREATE INDEX IF NOT EXISTS idx_link_media_owner_id ON link_media(owner_id);
