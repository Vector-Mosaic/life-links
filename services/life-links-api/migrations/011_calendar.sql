ALTER TABLE users ADD COLUMN agent_tool_catalog_id text;
UPDATE users
SET agent_tool_catalog_id = 'life-links-page-webmcp-v1'
WHERE agent_connected_at IS NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_agent_tool_catalog_id_check
  CHECK (agent_tool_catalog_id IS NULL OR agent_tool_catalog_id IN ('life-links-page-webmcp-v1', 'life-links-calendar-v2'));
ALTER TABLE users ADD CONSTRAINT users_agent_connection_catalog_pair_check
  CHECK ((agent_connected_at IS NULL) = (agent_tool_catalog_id IS NULL));

CREATE TABLE calendars (
  id text PRIMARY KEY CHECK (id ~ '^calendar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (title ~ '[^[:space:]]' AND char_length(title) <= 120),
  color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  time_zone text NOT NULL CHECK (time_zone ~ '[^[:space:]]' AND char_length(time_zone) <= 100),
  source text NOT NULL DEFAULT 'native' CHECK (source IN ('native', 'external')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  UNIQUE (id, owner_id),
  UNIQUE (id, owner_id, source)
);

CREATE UNIQUE INDEX uq_calendars_owner_live_default
  ON calendars(owner_id) WHERE is_default AND deleted_at IS NULL;
CREATE INDEX idx_calendars_owner_order
  ON calendars(owner_id, deleted_at, lower(title), id);

CREATE TABLE calendar_events (
  id text PRIMARY KEY CHECK (id ~ '^calendar-event-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  calendar_id text NOT NULL,
  current_revision_id text NOT NULL,
  lineage_kind text NOT NULL CHECK (lineage_kind IN ('standalone', 'recurrence_master', 'recurrence_exception')),
  recurrence_master_event_id text,
  original_occurrence jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  UNIQUE (id, owner_id),
  UNIQUE (id, calendar_id, owner_id),
  FOREIGN KEY (calendar_id, owner_id) REFERENCES calendars(id, owner_id),
  FOREIGN KEY (recurrence_master_event_id, owner_id)
    REFERENCES calendar_events(id, owner_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (lineage_kind IN ('standalone', 'recurrence_master')
      AND recurrence_master_event_id IS NULL
      AND original_occurrence IS NULL)
    OR
    (lineage_kind = 'recurrence_exception'
      AND recurrence_master_event_id IS NOT NULL
      AND jsonb_typeof(original_occurrence) = 'object')
  ),
  CHECK (recurrence_master_event_id IS NULL OR recurrence_master_event_id <> id)
);

CREATE UNIQUE INDEX uq_calendar_event_exception_occurrence
  ON calendar_events(owner_id, recurrence_master_event_id, original_occurrence)
  WHERE lineage_kind = 'recurrence_exception';
CREATE INDEX idx_calendar_events_calendar_order
  ON calendar_events(owner_id, calendar_id, deleted_at, updated_at DESC, id);
CREATE INDEX idx_calendar_events_recurrence_master
  ON calendar_events(owner_id, recurrence_master_event_id, deleted_at, id)
  WHERE recurrence_master_event_id IS NOT NULL;

CREATE TABLE calendar_event_revisions (
  id text PRIMARY KEY CHECK (id ~ '^calendar-event-revision-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  event_id text NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  title text NOT NULL CHECK (title ~ '[^[:space:]]' AND char_length(title) <= 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  location text NOT NULL DEFAULT '' CHECK (char_length(location) <= 500),
  status text NOT NULL CHECK (status IN ('confirmed', 'tentative', 'canceled')),
  span jsonb NOT NULL CHECK (jsonb_typeof(span) = 'object'),
  recurrence jsonb CHECK (recurrence IS NULL OR jsonb_typeof(recurrence) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (id, owner_id),
  UNIQUE (id, event_id, owner_id),
  UNIQUE (event_id, revision_number),
  FOREIGN KEY (event_id, owner_id) REFERENCES calendar_events(id, owner_id) ON DELETE CASCADE
);

ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_current_revision_fk
  FOREIGN KEY (current_revision_id, id, owner_id)
  REFERENCES calendar_event_revisions(id, event_id, owner_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_calendar_event_revisions_history
  ON calendar_event_revisions(owner_id, event_id, revision_number DESC);

CREATE TABLE calendar_event_subject_links (
  owner_id text NOT NULL,
  event_revision_id text NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('life_link', 'collection', 'routine', 'routine_schedule', 'routine_occurrence', 'routine_session')),
  routine_id text,
  schedule_id text,
  subject_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (event_revision_id, subject_type, subject_id),
  UNIQUE (event_revision_id, position),
  FOREIGN KEY (event_revision_id, owner_id)
    REFERENCES calendar_event_revisions(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (routine_id, owner_id) REFERENCES routines(id, owner_id),
  FOREIGN KEY (schedule_id, owner_id) REFERENCES routine_schedules(id, owner_id),
  CHECK ((subject_type IN ('life_link', 'collection') AND routine_id IS NULL)
      OR (subject_type IN ('routine', 'routine_schedule', 'routine_occurrence', 'routine_session') AND routine_id IS NOT NULL)),
  CHECK ((subject_type = 'routine_occurrence' AND schedule_id IS NOT NULL)
      OR (subject_type <> 'routine_occurrence' AND schedule_id IS NULL))
);

CREATE INDEX idx_calendar_event_subject_links_target
  ON calendar_event_subject_links(owner_id, subject_type, subject_id);

CREATE FUNCTION guard_calendar_event_subject_link() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.subject_type = 'life_link' THEN
    IF NOT EXISTS (SELECT 1 FROM life_links WHERE id = NEW.subject_id AND owner_id = NEW.owner_id) THEN
      RAISE EXCEPTION 'Calendar subject Life Link is unavailable' USING ERRCODE = '23503';
    END IF;
  ELSIF NEW.subject_type = 'collection' THEN
    IF NOT EXISTS (SELECT 1 FROM collections WHERE id = NEW.subject_id AND owner_id = NEW.owner_id) THEN
      RAISE EXCEPTION 'Calendar subject Collection is unavailable' USING ERRCODE = '23503';
    END IF;
  ELSIF NEW.subject_type = 'routine' THEN
    IF NEW.subject_id <> NEW.routine_id THEN
      RAISE EXCEPTION 'Calendar subject Routine is unavailable' USING ERRCODE = '23503';
    END IF;
  ELSIF NEW.subject_type = 'routine_schedule' THEN
    IF NOT EXISTS (SELECT 1 FROM routine_schedules WHERE id = NEW.subject_id AND routine_id = NEW.routine_id AND owner_id = NEW.owner_id) THEN
      RAISE EXCEPTION 'Calendar subject Routine Schedule is unavailable' USING ERRCODE = '23503';
    END IF;
  ELSIF NEW.subject_type = 'routine_occurrence' THEN
    IF NOT EXISTS (SELECT 1 FROM routine_occurrences WHERE id = NEW.subject_id AND schedule_id = NEW.schedule_id AND routine_id = NEW.routine_id AND owner_id = NEW.owner_id) THEN
      RAISE EXCEPTION 'Calendar subject Routine Occurrence is unavailable' USING ERRCODE = '23503';
    END IF;
  ELSIF NEW.subject_type = 'routine_session' THEN
    IF NOT EXISTS (SELECT 1 FROM routine_sessions WHERE id = NEW.subject_id AND routine_id = NEW.routine_id AND owner_id = NEW.owner_id) THEN
      RAISE EXCEPTION 'Calendar subject Routine Session is unavailable' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER calendar_event_subject_link_guard
BEFORE INSERT OR UPDATE ON calendar_event_subject_links
FOR EACH ROW EXECUTE FUNCTION guard_calendar_event_subject_link();

CREATE TABLE calendar_event_tombstones (
  id text PRIMARY KEY CHECK (id ~ '^calendar-event-tombstone-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  calendar_id text NOT NULL,
  event_id text NOT NULL,
  last_revision_id text NOT NULL,
  lineage jsonb NOT NULL CHECK (jsonb_typeof(lineage) = 'object'),
  deleted_at timestamptz NOT NULL,
  UNIQUE (id, owner_id),
  FOREIGN KEY (event_id, calendar_id, owner_id)
    REFERENCES calendar_events(id, calendar_id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (last_revision_id, event_id, owner_id)
    REFERENCES calendar_event_revisions(id, event_id, owner_id)
);

CREATE INDEX idx_calendar_event_tombstones_owner_deleted
  ON calendar_event_tombstones(owner_id, deleted_at DESC, event_id);
CREATE INDEX idx_calendar_event_tombstones_event_history
  ON calendar_event_tombstones(owner_id, event_id, deleted_at DESC, id);

CREATE FUNCTION reject_immutable_calendar_row_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('life_links.allow_calendar_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '23514';
END $$;

CREATE TRIGGER calendar_event_revisions_immutable
BEFORE UPDATE OR DELETE ON calendar_event_revisions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_calendar_row_change();

CREATE TRIGGER calendar_event_subject_links_immutable
BEFORE UPDATE OR DELETE ON calendar_event_subject_links
FOR EACH ROW EXECUTE FUNCTION reject_immutable_calendar_row_change();

CREATE TRIGGER calendar_event_tombstones_immutable
BEFORE UPDATE OR DELETE ON calendar_event_tombstones
FOR EACH ROW EXECUTE FUNCTION reject_immutable_calendar_row_change();

-- External-provider state is server-owned. The canonical Calendar identity
-- remains calendars.id; provider bindings may only target rows whose source is
-- external and never introduce a second application Calendar identity.
CREATE TABLE calendar_provider_connections (
  connection_id text PRIMARY KEY CHECK (connection_id ~ '[^[:space:]]' AND char_length(connection_id) <= 512),
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_key text NOT NULL CHECK (provider_key ~ '[^[:space:]]' AND char_length(provider_key) <= 512),
  provider_account_id text NOT NULL CHECK (provider_account_id ~ '[^[:space:]]' AND char_length(provider_account_id) <= 512),
  status text NOT NULL CHECK (status IN ('provisioning', 'active', 'disconnected')),
  credential_handle text CHECK (credential_handle IS NULL OR (credential_handle ~ '[^[:space:]]' AND char_length(credential_handle) <= 256)),
  connected_at timestamptz NOT NULL,
  disconnected_at timestamptz,
  remote_revocation_status text NOT NULL CHECK (remote_revocation_status IN ('not_required', 'pending', 'succeeded', 'failed')),
  remote_revocation_attempted_at timestamptz,
  remote_revocation_error_code text CHECK (remote_revocation_error_code IS NULL OR remote_revocation_error_code = 'provider_revoke_failed'),
  UNIQUE (connection_id, owner_id),
  UNIQUE (connection_id, owner_id, provider_account_id),
  UNIQUE (connection_id, owner_id, provider_key, provider_account_id),
  CHECK ((status = 'disconnected') = (disconnected_at IS NOT NULL)),
  CHECK ((remote_revocation_status = 'failed') = (remote_revocation_error_code IS NOT NULL))
);

CREATE INDEX idx_calendar_provider_connections_owner
  ON calendar_provider_connections(owner_id, status, provider_key, connection_id);

CREATE TABLE calendar_provider_bindings (
  connection_id text NOT NULL,
  owner_id text NOT NULL,
  provider_key text NOT NULL,
  provider_account_id text NOT NULL,
  calendar_id text NOT NULL,
  canonical_source text NOT NULL DEFAULT 'external' CHECK (canonical_source = 'external'),
  provider_calendar_id text NOT NULL CHECK (provider_calendar_id ~ '[^[:space:]]' AND char_length(provider_calendar_id) <= 512),
  provider_display_name text NOT NULL CHECK (provider_display_name ~ '[^[:space:]]' AND char_length(provider_display_name) <= 512),
  capabilities jsonb NOT NULL CHECK (
    jsonb_typeof(capabilities) = 'object'
    AND capabilities ?& ARRAY['read', 'create', 'update', 'delete']
    AND jsonb_typeof(capabilities->'read') = 'boolean'
    AND jsonb_typeof(capabilities->'create') = 'boolean'
    AND jsonb_typeof(capabilities->'update') = 'boolean'
    AND jsonb_typeof(capabilities->'delete') = 'boolean'
  ),
  agent_grant text NOT NULL CHECK (agent_grant IN ('none', 'read', 'write')),
  visible boolean NOT NULL,
  PRIMARY KEY (connection_id, calendar_id),
  UNIQUE (connection_id, owner_id, calendar_id),
  UNIQUE (connection_id, owner_id, provider_calendar_id),
  UNIQUE (connection_id, owner_id, calendar_id, provider_calendar_id),
  UNIQUE (owner_id, calendar_id),
  FOREIGN KEY (connection_id, owner_id, provider_key, provider_account_id)
    REFERENCES calendar_provider_connections(connection_id, owner_id, provider_key, provider_account_id) ON DELETE CASCADE,
  FOREIGN KEY (calendar_id, owner_id, canonical_source)
    REFERENCES calendars(id, owner_id, source) ON DELETE CASCADE,
  CHECK (agent_grant = 'none' OR (capabilities->>'read')::boolean),
  CHECK (agent_grant <> 'write' OR (
    (capabilities->>'read')::boolean
    AND ((capabilities->>'create')::boolean OR (capabilities->>'update')::boolean OR (capabilities->>'delete')::boolean)
  ))
);

CREATE INDEX idx_calendar_provider_bindings_owner
  ON calendar_provider_bindings(owner_id, visible, calendar_id);

CREATE TABLE calendar_provider_sync_states (
  connection_id text NOT NULL,
  calendar_id text NOT NULL,
  owner_id text NOT NULL,
  provider_calendar_id text NOT NULL,
  sync_cursor text,
  last_reconciled_at timestamptz,
  last_recovery_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  PRIMARY KEY (connection_id, calendar_id),
  FOREIGN KEY (connection_id, owner_id, calendar_id, provider_calendar_id)
    REFERENCES calendar_provider_bindings(connection_id, owner_id, calendar_id, provider_calendar_id) ON DELETE CASCADE
);

CREATE TABLE calendar_provider_event_projections (
  connection_id text NOT NULL,
  calendar_id text NOT NULL,
  owner_id text NOT NULL,
  provider_key text NOT NULL,
  provider_account_id text NOT NULL,
  provider_calendar_id text NOT NULL,
  provider_event_id text NOT NULL CHECK (provider_event_id ~ '[^[:space:]]' AND char_length(provider_event_id) <= 512),
  provider_revision text NOT NULL CHECK (provider_revision ~ '[^[:space:]]' AND char_length(provider_revision) <= 512),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  synchronized_at timestamptz NOT NULL,
  PRIMARY KEY (connection_id, calendar_id, provider_event_id),
  FOREIGN KEY (connection_id, owner_id, calendar_id, provider_calendar_id)
    REFERENCES calendar_provider_bindings(connection_id, owner_id, calendar_id, provider_calendar_id) ON DELETE CASCADE
);

CREATE INDEX idx_calendar_provider_event_projections_window
  ON calendar_provider_event_projections(owner_id, calendar_id, synchronized_at DESC, provider_event_id);

CREATE TABLE calendar_provider_event_projection_revisions (
  connection_id text NOT NULL,
  calendar_id text NOT NULL,
  owner_id text NOT NULL,
  provider_calendar_id text NOT NULL,
  provider_event_id text NOT NULL,
  provider_revision text NOT NULL,
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  synchronized_at timestamptz NOT NULL,
  PRIMARY KEY (connection_id, calendar_id, provider_event_id, provider_revision),
  FOREIGN KEY (connection_id, owner_id, calendar_id, provider_calendar_id)
    REFERENCES calendar_provider_bindings(connection_id, owner_id, calendar_id, provider_calendar_id) ON DELETE CASCADE
);

CREATE TABLE calendar_provider_event_tombstones (
  connection_id text NOT NULL,
  calendar_id text NOT NULL,
  owner_id text NOT NULL,
  provider_key text NOT NULL,
  provider_account_id text NOT NULL,
  provider_calendar_id text NOT NULL,
  provider_event_id text NOT NULL CHECK (provider_event_id ~ '[^[:space:]]' AND char_length(provider_event_id) <= 512),
  deleted_provider_revision text NOT NULL CHECK (deleted_provider_revision ~ '[^[:space:]]' AND char_length(deleted_provider_revision) <= 512),
  deleted_at timestamptz NOT NULL,
  cause text NOT NULL CHECK (cause IN ('provider_delta', 'expired_cursor_recovery_missing', 'life_links_command')),
  PRIMARY KEY (connection_id, calendar_id, provider_event_id),
  FOREIGN KEY (connection_id, owner_id, calendar_id, provider_calendar_id)
    REFERENCES calendar_provider_bindings(connection_id, owner_id, calendar_id, provider_calendar_id) ON DELETE CASCADE
);

CREATE TABLE calendar_provider_event_tombstone_history (
  connection_id text NOT NULL,
  calendar_id text NOT NULL,
  owner_id text NOT NULL,
  provider_calendar_id text NOT NULL,
  provider_event_id text NOT NULL,
  deleted_provider_revision text NOT NULL,
  deleted_at timestamptz NOT NULL,
  cause text NOT NULL CHECK (cause IN ('provider_delta', 'expired_cursor_recovery_missing', 'life_links_command')),
  PRIMARY KEY (connection_id, calendar_id, provider_event_id, deleted_provider_revision),
  FOREIGN KEY (connection_id, owner_id, calendar_id, provider_calendar_id)
    REFERENCES calendar_provider_bindings(connection_id, owner_id, calendar_id, provider_calendar_id) ON DELETE CASCADE
);

CREATE TABLE calendar_provider_outbox (
  command_id text PRIMARY KEY CHECK (command_id ~ '[^[:space:]]' AND char_length(command_id) <= 512),
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id text NOT NULL,
  calendar_id text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  command jsonb NOT NULL CHECK (jsonb_typeof(command) = 'object'),
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'conflict')),
  attempts integer NOT NULL CHECK (attempts >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  lease_owner text CHECK (lease_owner IS NULL OR (lease_owner ~ '[^[:space:]]' AND char_length(lease_owner) <= 512)),
  lease_expires_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code IN ('provider_transient', 'provider_unknown')),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  conflict_revision text,
  FOREIGN KEY (connection_id, owner_id, calendar_id)
    REFERENCES calendar_provider_bindings(connection_id, owner_id, calendar_id) ON DELETE CASCADE,
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK (status = 'processing' OR (lease_owner IS NULL AND lease_expires_at IS NULL)),
  CHECK (command->>'commandId' = command_id),
  CHECK (command->>'ownerId' = owner_id),
  CHECK (command->>'connectionId' = connection_id),
  CHECK (command->>'calendarId' = calendar_id)
);

CREATE INDEX idx_calendar_provider_outbox_dispatch
  ON calendar_provider_outbox(status, next_attempt_at, lease_expires_at, created_at);

CREATE TABLE calendar_provider_webhook_hints (
  hint_id text PRIMARY KEY CHECK (hint_id ~ '[^[:space:]]' AND char_length(hint_id) <= 512),
  owner_id text NOT NULL,
  connection_id text NOT NULL,
  provider_account_id text NOT NULL,
  provider_calendar_id text,
  received_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'reconciled')),
  reconciled_at timestamptz,
  FOREIGN KEY (connection_id, owner_id)
    REFERENCES calendar_provider_connections(connection_id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id, owner_id, provider_account_id)
    REFERENCES calendar_provider_connections(connection_id, owner_id, provider_account_id) ON DELETE CASCADE,
  CHECK ((status = 'reconciled') = (reconciled_at IS NOT NULL))
);

CREATE INDEX idx_calendar_provider_webhook_hints_pending
  ON calendar_provider_webhook_hints(connection_id, status, received_at, hint_id);

CREATE TRIGGER calendar_provider_event_projection_revisions_immutable
BEFORE UPDATE OR DELETE ON calendar_provider_event_projection_revisions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_calendar_row_change();

CREATE TRIGGER calendar_provider_event_tombstone_history_immutable
BEFORE UPDATE OR DELETE ON calendar_provider_event_tombstone_history
FOR EACH ROW EXECUTE FUNCTION reject_immutable_calendar_row_change();
