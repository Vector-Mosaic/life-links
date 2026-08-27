ALTER TABLE users
  ADD COLUMN IF NOT EXISTS agent_connected_at timestamptz;
