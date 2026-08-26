CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);

CREATE TABLE IF NOT EXISTS export_batches (
  id text PRIMARY KEY,
  batch_key text NOT NULL UNIQUE,
  qr_base_url text NOT NULL,
  count integer NOT NULL CHECK (count BETWEEN 1 AND 10000),
  created_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_export_batches_created_by ON export_batches(created_by);

CREATE TABLE IF NOT EXISTS qr_codes (
  id text PRIMARY KEY,
  url text NOT NULL,
  status text NOT NULL CHECK (status IN ('unclaimed', 'claimed')),
  batch_id text REFERENCES export_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  claimed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_qr_codes_batch_id ON qr_codes(batch_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_status ON qr_codes(status);

CREATE TABLE IF NOT EXISTS links (
  qr_id text PRIMARY KEY REFERENCES qr_codes(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  project_id text REFERENCES projects(id) ON DELETE SET NULL,
  privacy text NOT NULL CHECK (privacy IN ('public', 'private')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_links_owner_id ON links(owner_id);
CREATE INDEX IF NOT EXISTS idx_links_project_id ON links(project_id);

CREATE TABLE IF NOT EXISTS claim_events (
  command_id text PRIMARY KEY,
  qr_id text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result text NOT NULL CHECK (result IN ('claimed', 'already_owned', 'owned_by_other', 'not_found')),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claim_events_qr_id ON claim_events(qr_id);
