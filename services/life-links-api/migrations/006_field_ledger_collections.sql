LOCK TABLE life_links IN ACCESS EXCLUSIVE MODE;

CREATE FUNCTION valid_life_link_context(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  field_name text;
  field_value jsonb;
  total_length integer := 0;
BEGIN
  IF jsonb_typeof(value) <> 'object' OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN
    RETURN false;
  END IF;
  FOR field_name, field_value IN SELECT * FROM jsonb_each(value) LOOP
    IF field_name = 'schemaVersion' THEN CONTINUE; END IF;
    IF field_name NOT IN ('summary', 'condition', 'experience', 'plan')
       OR jsonb_typeof(field_value) <> 'object'
       OR (field_value - 'text' - 'truthState') <> '{}'::jsonb
       OR jsonb_typeof(field_value->'text') IS DISTINCT FROM 'string'
       OR jsonb_typeof(field_value->'truthState') IS DISTINCT FROM 'string'
       OR field_value->>'text' !~ '[^[:space:]]'
       OR field_value->>'truthState' NOT IN ('owner_reported', 'agent_inference', 'planned', 'unknown') THEN
      RETURN false;
    END IF;
    total_length := total_length + char_length(field_value->>'text');
  END LOOP;
  RETURN total_length <= 4000;
END $$;

CREATE FUNCTION valid_life_link_public_fields(value text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT value <@ ARRAY['notes', 'summary', 'condition', 'experience', 'plan']::text[]
    AND array_position(value, NULL) IS NULL
    AND cardinality(value) = (SELECT count(DISTINCT field) FROM unnest(value) field);
$$;

ALTER TABLE life_links
  ADD COLUMN browsing_role text NOT NULL DEFAULT 'item'
    CHECK (browsing_role IN ('container', 'item')),
  ADD COLUMN context jsonb NOT NULL DEFAULT '{"schemaVersion":1}'::jsonb
    CHECK (valid_life_link_context(context)),
  ADD COLUMN placement_confirmed_at timestamptz,
  ADD COLUMN public_field_keys text[] NOT NULL DEFAULT ARRAY[]::text[]
    CHECK (valid_life_link_public_fields(public_field_keys));

UPDATE life_links parent SET browsing_role = 'container'
WHERE EXISTS (SELECT 1 FROM life_links child WHERE child.parent_id = parent.id);
UPDATE life_links SET public_field_keys = ARRAY['notes']::text[] WHERE privacy = 'public';

CREATE FUNCTION enforce_life_link_browsing_role() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.browsing_role = 'item'
     AND EXISTS (SELECT 1 FROM life_links WHERE parent_id = NEW.id) THEN
    RAISE EXCEPTION 'A Life Link with children must remain a container';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    UPDATE life_links
    SET browsing_role = 'container',
        updated_at = GREATEST(updated_at + interval '1 millisecond', NEW.updated_at)
    WHERE id = NEW.parent_id AND owner_id = NEW.owner_id AND browsing_role = 'item';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER life_links_browsing_role_trigger
BEFORE INSERT OR UPDATE OF parent_id, owner_id, browsing_role ON life_links
FOR EACH ROW EXECUTE FUNCTION enforce_life_link_browsing_role();

CREATE TABLE collections (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (title ~ '[^[:space:]]' AND char_length(title) <= 120),
  purpose text NOT NULL DEFAULT '' CHECK (char_length(purpose) <= 500),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, owner_id)
);

CREATE TABLE collection_memberships (
  owner_id text NOT NULL,
  collection_id text NOT NULL,
  life_link_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, collection_id, life_link_id),
  FOREIGN KEY (collection_id, owner_id) REFERENCES collections(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (life_link_id, owner_id) REFERENCES life_links(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE collection_sections (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  collection_id text NOT NULL,
  title text NOT NULL CHECK (title ~ '[^[:space:]]' AND char_length(title) <= 120),
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, owner_id, collection_id),
  FOREIGN KEY (collection_id, owner_id) REFERENCES collections(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE collection_section_assignments (
  owner_id text NOT NULL,
  collection_id text NOT NULL,
  life_link_id text NOT NULL,
  section_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, collection_id, life_link_id, section_id),
  FOREIGN KEY (owner_id, collection_id, life_link_id)
    REFERENCES collection_memberships(owner_id, collection_id, life_link_id) ON DELETE CASCADE,
  FOREIGN KEY (section_id, owner_id, collection_id)
    REFERENCES collection_sections(id, owner_id, collection_id) ON DELETE CASCADE
);

CREATE INDEX idx_collections_owner_title ON collections(owner_id, lower(title), id);
CREATE INDEX idx_collection_memberships_life_link ON collection_memberships(owner_id, life_link_id, collection_id);
CREATE INDEX idx_collection_sections_order ON collection_sections(owner_id, collection_id, position, id);
CREATE INDEX idx_collection_section_assignments_section ON collection_section_assignments(owner_id, collection_id, section_id, life_link_id);

ALTER TABLE claim_events
  ALTER COLUMN qr_id DROP NOT NULL,
  ADD COLUMN expected_updated_at text,
  DROP CONSTRAINT claim_events_mode_check,
  DROP CONSTRAINT claim_events_request_mode_check,
  DROP CONSTRAINT claim_events_result_check,
  ADD CONSTRAINT claim_events_mode_check CHECK (mode IN ('create', 'attach', 'set', 'clear')),
  ADD CONSTRAINT claim_events_request_mode_check CHECK (
    (mode = 'create' AND requested_life_link_id IS NULL AND qr_id IS NOT NULL AND expected_updated_at IS NULL)
    OR (mode = 'attach' AND requested_life_link_id IS NOT NULL AND qr_id IS NOT NULL AND expected_updated_at IS NULL)
    OR (mode = 'set' AND requested_life_link_id IS NOT NULL AND qr_id IS NOT NULL AND expected_updated_at IS NOT NULL)
    OR (mode = 'clear' AND requested_life_link_id IS NOT NULL AND qr_id IS NULL AND expected_updated_at IS NOT NULL)
  ),
  ADD CONSTRAINT claim_events_result_check CHECK (
    (mode IN ('create', 'attach') AND result IN ('claimed', 'already_owned', 'owned_by_other', 'not_found'))
    OR (mode = 'set' AND result = 'bound')
    OR (mode = 'clear' AND result = 'unbound')
  );
