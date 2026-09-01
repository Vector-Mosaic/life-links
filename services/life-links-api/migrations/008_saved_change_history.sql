-- Receipts describe historical command identity, not a live-entity dependency.
ALTER TABLE claim_events
  DROP CONSTRAINT claim_events_requested_life_link_fkey,
  DROP CONSTRAINT claim_events_resolved_life_link_fkey;

CREATE TABLE life_link_change_previews (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preview jsonb NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_life_link_change_previews_owner ON life_link_change_previews(owner_id);

CREATE TABLE saved_changes (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id text NOT NULL UNIQUE,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  inverse_rows jsonb NOT NULL,
  reserved_qr_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_saved_changes_owner_sequence ON saved_changes(owner_id, sequence DESC);
CREATE INDEX idx_saved_changes_reserved_qr ON saved_changes USING gin(reserved_qr_ids);

CREATE TABLE life_link_change_receipts (
  command_id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('move', 'delete', 'undo')),
  request_id text NOT NULL,
  affected_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Identity-only tombstones survive ordinary deletion and history eviction.
-- Restores and controlled fixture replacement may reinsert the same identity;
-- public creation checks this ledger before admitting a new entity.
CREATE TABLE used_content_ids (
  entity_kind text NOT NULL CHECK (entity_kind IN ('life_links', 'collections', 'collection_sections')),
  id text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (entity_kind, id)
);
INSERT INTO used_content_ids SELECT 'life_links', id, owner_id FROM life_links;
INSERT INTO used_content_ids SELECT 'collections', id, owner_id FROM collections;
INSERT INTO used_content_ids SELECT 'collection_sections', id, owner_id FROM collection_sections;

CREATE FUNCTION remember_content_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO used_content_ids(entity_kind, id, owner_id)
    VALUES (TG_TABLE_NAME, NEW.id, NEW.owner_id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER life_links_identity_trigger AFTER INSERT ON life_links
  FOR EACH ROW EXECUTE FUNCTION remember_content_identity();
CREATE TRIGGER collections_identity_trigger AFTER INSERT ON collections
  FOR EACH ROW EXECUTE FUNCTION remember_content_identity();
CREATE TRIGGER collection_sections_identity_trigger AFTER INSERT ON collection_sections
  FOR EACH ROW EXECUTE FUNCTION remember_content_identity();
