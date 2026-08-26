LOCK TABLE projects, links, qr_codes, link_media, claim_events IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM links l
    LEFT JOIN projects p ON p.id = l.project_id
    WHERE l.project_id IS NOT NULL
      AND (p.id IS NULL OR p.owner_id <> l.owner_id)
  ) THEN
    RAISE EXCEPTION 'recursive migration rejected: dangling or cross-owner project placement';
  END IF;

  IF EXISTS (
    SELECT 1 FROM links l LEFT JOIN qr_codes q ON q.id = l.qr_id WHERE q.id IS NULL
  ) THEN
    RAISE EXCEPTION 'recursive migration rejected: link without QR inventory';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM qr_codes q
    LEFT JOIN links l ON l.qr_id = q.id
    WHERE (q.status = 'claimed') <> (l.qr_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'recursive migration rejected: QR status and link ownership disagree';
  END IF;

  IF EXISTS (
    SELECT 1 FROM links WHERE body_doc IS NULL OR body_doc_version IS NULL
  ) THEN
    RAISE EXCEPTION 'recursive migration rejected: incomplete rich body state';
  END IF;

  IF EXISTS (SELECT 1 FROM projects WHERE char_length(name) > 80) THEN
    RAISE EXCEPTION 'recursive migration rejected: Project title exceeds compatibility limit';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM link_media lm
    LEFT JOIN links l ON l.qr_id = lm.qr_id
    WHERE l.qr_id IS NULL
       OR l.owner_id <> lm.owner_id
       OR octet_length(lm.data) <> lm.size_bytes
  ) THEN
    RAISE EXCEPTION 'recursive migration rejected: inconsistent media row';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM projects p
    JOIN links l ON p.id = 'legacy-life-link:' || l.qr_id
  ) THEN
    RAISE EXCEPTION 'recursive migration rejected: deterministic Life Link identity collision';
  END IF;
END $$;

CREATE TABLE life_links (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id text,
  title text NOT NULL,
  body text NOT NULL,
  body_doc jsonb NOT NULL,
  body_doc_version integer NOT NULL CHECK (body_doc_version > 0),
  privacy text NOT NULL CHECK (privacy IN ('public', 'private')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT life_links_id_owner_key UNIQUE (id, owner_id),
  CONSTRAINT life_links_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT life_links_title_length_check CHECK (char_length(title) <= 120),
  CONSTRAINT life_links_body_length_check CHECK (char_length(body) <= 4000),
  CONSTRAINT life_links_body_doc_size_check CHECK (octet_length(body_doc::text) <= 131072),
  CONSTRAINT life_links_parent_owner_fkey
    FOREIGN KEY (parent_id, owner_id)
    REFERENCES life_links(id, owner_id)
    ON DELETE RESTRICT
);

CREATE TABLE life_link_qr_bindings (
  qr_id text PRIMARY KEY REFERENCES qr_codes(id) ON DELETE RESTRICT,
  life_link_id text NOT NULL UNIQUE REFERENCES life_links(id) ON DELETE RESTRICT,
  bound_at timestamptz NOT NULL
);

CREATE TABLE life_link_project_compat (
  project_id text PRIMARY KEY,
  life_link_id text NOT NULL UNIQUE REFERENCES life_links(id) ON DELETE CASCADE
);

INSERT INTO life_links (
  id, owner_id, parent_id, title, body, body_doc, body_doc_version,
  privacy, created_at, updated_at
)
SELECT
  p.id,
  p.owner_id,
  NULL,
  p.name,
  '',
  '{"type":"doc","content":[]}'::jsonb,
  1,
  'private',
  p.created_at,
  p.created_at
FROM projects p;

INSERT INTO life_link_project_compat (project_id, life_link_id)
SELECT id, id FROM projects;

INSERT INTO life_links (
  id, owner_id, parent_id, title, body, body_doc, body_doc_version,
  privacy, created_at, updated_at
)
SELECT
  'legacy-life-link:' || l.qr_id,
  l.owner_id,
  l.project_id,
  l.title,
  l.body,
  l.body_doc,
  l.body_doc_version,
  l.privacy,
  l.created_at,
  l.updated_at
FROM links l;

INSERT INTO life_link_qr_bindings (qr_id, life_link_id, bound_at)
SELECT
  l.qr_id,
  'legacy-life-link:' || l.qr_id,
  COALESCE(q.claimed_at, l.created_at)
FROM links l
JOIN qr_codes q ON q.id = l.qr_id;

ALTER TABLE claim_events
  ADD COLUMN mode text,
  ADD COLUMN requested_life_link_id text,
  ADD COLUMN resolved_life_link_id text;

UPDATE claim_events ce
SET
  mode = 'create',
  requested_life_link_id = NULL,
  resolved_life_link_id = CASE WHEN ce.result = 'not_found' THEN NULL ELSE b.life_link_id END
FROM life_link_qr_bindings b
WHERE b.qr_id = ce.qr_id;

UPDATE claim_events
SET mode = 'create'
WHERE mode IS NULL;

ALTER TABLE claim_events
  ALTER COLUMN mode SET NOT NULL,
  ADD CONSTRAINT claim_events_mode_check CHECK (mode IN ('create', 'attach')),
  ADD CONSTRAINT claim_events_request_mode_check CHECK (
    (mode = 'create' AND requested_life_link_id IS NULL)
    OR (mode = 'attach' AND requested_life_link_id IS NOT NULL)
  ),
  ADD CONSTRAINT claim_events_resolution_check CHECK (
    (result = 'not_found' AND resolved_life_link_id IS NULL)
    OR (result <> 'not_found' AND resolved_life_link_id IS NOT NULL)
  ),
  ADD CONSTRAINT claim_events_requested_life_link_fkey
    FOREIGN KEY (requested_life_link_id) REFERENCES life_links(id) ON DELETE RESTRICT,
  ADD CONSTRAINT claim_events_resolved_life_link_fkey
    FOREIGN KEY (resolved_life_link_id) REFERENCES life_links(id) ON DELETE RESTRICT;

ALTER TABLE link_media ADD COLUMN life_link_id text;

UPDATE link_media
SET life_link_id = 'legacy-life-link:' || qr_id;

ALTER TABLE link_media
  ALTER COLUMN life_link_id SET NOT NULL,
  DROP CONSTRAINT link_media_qr_id_fkey,
  DROP COLUMN qr_id,
  ADD CONSTRAINT link_media_size_matches_data_check CHECK (octet_length(data) = size_bytes),
  ADD CONSTRAINT link_media_size_limit_check CHECK (size_bytes <= 26214400),
  ADD CONSTRAINT link_media_life_link_owner_fkey
    FOREIGN KEY (life_link_id, owner_id)
    REFERENCES life_links(id, owner_id)
    ON DELETE CASCADE;

DO $$
DECLARE
  project_count integer;
  link_count integer;
  binding_count integer;
  compatibility_count integer;
  media_count integer;
  migrated_media_count integer;
BEGIN
  SELECT count(*) INTO project_count FROM projects;
  SELECT count(*) INTO link_count FROM links;
  SELECT count(*) INTO binding_count FROM life_link_qr_bindings;
  SELECT count(*) INTO compatibility_count FROM life_link_project_compat;
  SELECT count(*) INTO media_count FROM link_media;
  SELECT count(*) INTO migrated_media_count
  FROM link_media lm
  JOIN life_links ll ON ll.id = lm.life_link_id AND ll.owner_id = lm.owner_id;

  IF (SELECT count(*) FROM life_links) <> project_count + link_count
     OR binding_count <> link_count
     OR compatibility_count <> project_count
     OR migrated_media_count <> media_count THEN
    RAISE EXCEPTION 'recursive migration rejected: row-count conservation failed';
  END IF;

  IF EXISTS (
    (SELECT p.id, p.owner_id, NULL::text AS parent_id, p.name, ''::text AS body,
            '{"type":"doc","content":[]}'::jsonb AS body_doc, 1 AS body_doc_version,
            'private'::text AS privacy, p.created_at, p.created_at AS updated_at
     FROM projects p
     EXCEPT
     SELECT id, owner_id, parent_id, title, body, body_doc, body_doc_version, privacy, created_at, updated_at
     FROM life_links)
    UNION ALL
    (SELECT 'legacy-life-link:' || l.qr_id, l.owner_id, l.project_id, l.title, l.body,
            l.body_doc, l.body_doc_version, l.privacy, l.created_at, l.updated_at
     FROM links l
     EXCEPT
     SELECT id, owner_id, parent_id, title, body, body_doc, body_doc_version, privacy, created_at, updated_at
     FROM life_links)
  ) THEN
    RAISE EXCEPTION 'recursive migration rejected: canonical row identity or content mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM claim_events ce
    LEFT JOIN life_link_qr_bindings b ON b.qr_id = ce.qr_id
    WHERE ce.mode <> 'create'
       OR ce.requested_life_link_id IS NOT NULL
       OR ce.resolved_life_link_id IS DISTINCT FROM
          CASE WHEN ce.result = 'not_found' THEN NULL ELSE b.life_link_id END
  ) THEN
    RAISE EXCEPTION 'recursive migration rejected: claim-event compatibility mismatch';
  END IF;
END $$;

DROP TABLE links;
DROP TABLE projects;

ALTER TABLE qr_codes
  DROP COLUMN status,
  DROP COLUMN claimed_at;

CREATE INDEX idx_life_links_owner_parent ON life_links(owner_id, parent_id);
CREATE INDEX idx_life_links_owner_title ON life_links(owner_id, lower(title), created_at, id);
CREATE INDEX idx_life_link_qr_bindings_life_link_id ON life_link_qr_bindings(life_link_id);
CREATE INDEX idx_link_media_life_link_id ON link_media(life_link_id);
CREATE INDEX idx_claim_events_resolved_life_link_id ON claim_events(resolved_life_link_id);

CREATE FUNCTION enforce_life_link_acyclic() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_found boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id, ARRAY[id] AS visited
    FROM life_links
    WHERE id = NEW.parent_id AND owner_id = NEW.owner_id
    UNION ALL
    SELECT parent.id, parent.parent_id, ancestors.visited || parent.id
    FROM life_links parent
    JOIN ancestors ON parent.id = ancestors.parent_id
    WHERE parent.owner_id = NEW.owner_id
      AND NOT parent.id = ANY(ancestors.visited)
  )
  SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id) INTO cycle_found;
  IF cycle_found THEN
    RAISE EXCEPTION 'Life Link hierarchy cycle is not allowed';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER life_links_acyclic_trigger
AFTER INSERT OR UPDATE OF parent_id, owner_id ON life_links
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_life_link_acyclic();

CREATE FUNCTION enforce_project_compatibility_title() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_title text;
  target_parent_id text;
BEGIN
  SELECT title, parent_id INTO target_title, target_parent_id FROM life_links WHERE id = NEW.life_link_id;
  IF target_parent_id IS NOT NULL OR char_length(target_title) > 80 THEN
    RAISE EXCEPTION 'Project compatibility requires a root Life Link with an 80-character title limit';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER life_link_project_compat_valid_trigger
AFTER INSERT OR UPDATE ON life_link_project_compat
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_project_compatibility_title();

CREATE FUNCTION enforce_marked_project_title_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.parent_id IS NOT NULL OR char_length(NEW.title) > 80)
     AND EXISTS (SELECT 1 FROM life_link_project_compat WHERE life_link_id = NEW.id) THEN
    RAISE EXCEPTION 'Project-compatible Life Link must remain a root with an 80-character title limit';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER life_links_project_compat_update_trigger
AFTER UPDATE OF parent_id, title ON life_links
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_marked_project_title_update();
