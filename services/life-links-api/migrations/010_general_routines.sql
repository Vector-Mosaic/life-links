CREATE FUNCTION life_links_jsonb_object_length(value jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT count(*)::integer FROM jsonb_object_keys(value);
$$;

CREATE FUNCTION valid_routine_value(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  kind text;
BEGIN
  IF jsonb_typeof(value) <> 'object'
     OR jsonb_typeof(value->'key') IS DISTINCT FROM 'string'
     OR value->>'key' !~ '^[a-z][a-z0-9_-]{0,63}$'
     OR jsonb_typeof(value->'label') IS DISTINCT FROM 'string'
     OR value->>'label' !~ '[^[:space:]]'
     OR char_length(value->>'label') > 120
     OR jsonb_typeof(value->'kind') IS DISTINCT FROM 'string' THEN
    RETURN false;
  END IF;
  kind := value->>'kind';
  IF kind = 'number' THEN
    RETURN life_links_jsonb_object_length(value) = 4
      AND (value - 'key' - 'label' - 'kind' - 'value') = '{}'::jsonb
      AND jsonb_typeof(value->'value') IS NOT DISTINCT FROM 'number';
  ELSIF kind = 'quantity' THEN
    RETURN life_links_jsonb_object_length(value) = 5
      AND (value - 'key' - 'label' - 'kind' - 'amount' - 'unit') = '{}'::jsonb
      AND jsonb_typeof(value->'amount') IS NOT DISTINCT FROM 'number'
      AND jsonb_typeof(value->'unit') IS NOT DISTINCT FROM 'string'
      AND value->>'unit' ~ '[^[:space:]]'
      AND char_length(value->>'unit') <= 32;
  ELSIF kind = 'duration' THEN
    RETURN life_links_jsonb_object_length(value) = 4
      AND (value - 'key' - 'label' - 'kind' - 'seconds') = '{}'::jsonb
      AND jsonb_typeof(value->'seconds') IS NOT DISTINCT FROM 'number'
      AND (value->>'seconds')::numeric >= 0
      AND trunc((value->>'seconds')::numeric) = (value->>'seconds')::numeric;
  ELSIF kind = 'text' THEN
    RETURN life_links_jsonb_object_length(value) = 4
      AND (value - 'key' - 'label' - 'kind' - 'text') = '{}'::jsonb
      AND jsonb_typeof(value->'text') IS NOT DISTINCT FROM 'string'
      AND char_length(value->>'text') <= 4000;
  ELSIF kind = 'boolean' THEN
    RETURN life_links_jsonb_object_length(value) = 4
      AND (value - 'key' - 'label' - 'kind' - 'value') = '{}'::jsonb
      AND jsonb_typeof(value->'value') IS NOT DISTINCT FROM 'boolean';
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END $$;

CREATE FUNCTION valid_routine_values(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) <= 32
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(value) item WHERE NOT valid_routine_value(item))
    AND (SELECT count(*) FROM jsonb_array_elements(value)) =
        (SELECT count(DISTINCT item->>'key') FROM jsonb_array_elements(value) item);
$$;

CREATE FUNCTION valid_routine_schedule_rule(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  kind text;
BEGIN
  IF jsonb_typeof(value) <> 'object' OR jsonb_typeof(value->'kind') IS DISTINCT FROM 'string' THEN
    RETURN false;
  END IF;
  kind := value->>'kind';
  IF jsonb_typeof(value->'localTime') IS DISTINCT FROM 'string'
     OR value->>'localTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     OR jsonb_typeof(value->'timeZone') IS DISTINCT FROM 'string'
     OR value->>'timeZone' !~ '[^[:space:]]' THEN
    RETURN false;
  END IF;
  IF kind = 'once' THEN
    RETURN life_links_jsonb_object_length(value) = 4
      AND (value - 'kind' - 'localDate' - 'localTime' - 'timeZone') = '{}'::jsonb
      AND jsonb_typeof(value->'localDate') IS NOT DISTINCT FROM 'string'
      AND value->>'localDate' ~ '^\d{4}-\d{2}-\d{2}$';
  ELSIF kind = 'daily' THEN
    RETURN life_links_jsonb_object_length(value) = 6
      AND (value - 'kind' - 'startDate' - 'endDate' - 'intervalDays' - 'localTime' - 'timeZone') = '{}'::jsonb
      AND jsonb_typeof(value->'startDate') IS NOT DISTINCT FROM 'string'
      AND value->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$'
      AND (value->'endDate' = 'null'::jsonb OR (jsonb_typeof(value->'endDate') IS NOT DISTINCT FROM 'string' AND value->>'endDate' ~ '^\d{4}-\d{2}-\d{2}$'))
      AND jsonb_typeof(value->'intervalDays') IS NOT DISTINCT FROM 'number'
      AND (value->>'intervalDays')::numeric BETWEEN 1 AND 366
      AND trunc((value->>'intervalDays')::numeric) = (value->>'intervalDays')::numeric;
  ELSIF kind = 'weekly' THEN
    RETURN life_links_jsonb_object_length(value) = 7
      AND (value - 'kind' - 'startDate' - 'endDate' - 'intervalWeeks' - 'weekdays' - 'localTime' - 'timeZone') = '{}'::jsonb
      AND jsonb_typeof(value->'startDate') IS NOT DISTINCT FROM 'string'
      AND value->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$'
      AND (value->'endDate' = 'null'::jsonb OR (jsonb_typeof(value->'endDate') IS NOT DISTINCT FROM 'string' AND value->>'endDate' ~ '^\d{4}-\d{2}-\d{2}$'))
      AND jsonb_typeof(value->'intervalWeeks') IS NOT DISTINCT FROM 'number'
      AND (value->>'intervalWeeks')::numeric BETWEEN 1 AND 366
      AND trunc((value->>'intervalWeeks')::numeric) = (value->>'intervalWeeks')::numeric
      AND jsonb_typeof(value->'weekdays') IS NOT DISTINCT FROM 'array'
      AND jsonb_array_length(value->'weekdays') BETWEEN 1 AND 7
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(value->'weekdays') weekday
        WHERE weekday NOT IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
      )
      AND (SELECT count(*) FROM jsonb_array_elements_text(value->'weekdays')) =
          (SELECT count(DISTINCT weekday) FROM jsonb_array_elements_text(value->'weekdays') weekday);
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END $$;

CREATE FUNCTION valid_routine_context_snapshot(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) <= 100
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) item
      WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
        OR life_links_jsonb_object_length(item) <> 7
        OR (item - 'bindingId' - 'routineStepId' - 'targetType' - 'targetId' - 'targetTitle' - 'targetSourceUpdatedAt' - 'resolvedLifeLinks') <> '{}'::jsonb
        OR jsonb_typeof(item->'bindingId') IS DISTINCT FROM 'string'
        OR NOT (item->'routineStepId' = 'null'::jsonb OR jsonb_typeof(item->'routineStepId') IS NOT DISTINCT FROM 'string')
        OR COALESCE(item->>'targetType' NOT IN ('life_link', 'collection'), true)
        OR jsonb_typeof(item->'targetId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'targetTitle') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'targetSourceUpdatedAt') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'resolvedLifeLinks') IS DISTINCT FROM 'array'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(item->'resolvedLifeLinks') link
          WHERE jsonb_typeof(link) IS DISTINCT FROM 'object'
            OR life_links_jsonb_object_length(link) <> 3
            OR (link - 'lifeLinkId' - 'title' - 'sourceUpdatedAt') <> '{}'::jsonb
            OR jsonb_typeof(link->'lifeLinkId') IS DISTINCT FROM 'string'
            OR jsonb_typeof(link->'title') IS DISTINCT FROM 'string'
            OR jsonb_typeof(link->'sourceUpdatedAt') IS DISTINCT FROM 'string'
        )
    );
$$;

CREATE FUNCTION valid_routine_run_step_results(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) <= 100
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) item
      WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
        OR life_links_jsonb_object_length(item) <> 4
        OR (item - 'routineStepId' - 'actualValues' - 'proposedNextValues' - 'notes') <> '{}'::jsonb
        OR jsonb_typeof(item->'routineStepId') IS DISTINCT FROM 'string'
        OR NOT valid_routine_values(item->'actualValues')
        OR NOT valid_routine_values(item->'proposedNextValues')
        OR jsonb_typeof(item->'notes') IS DISTINCT FROM 'string'
        OR char_length(item->>'notes') > 4000
    )
    AND (SELECT count(*) FROM jsonb_array_elements(value)) =
        (SELECT count(DISTINCT item->>'routineStepId') FROM jsonb_array_elements(value) item);
$$;

CREATE TABLE routine_groups (
  id text PRIMARY KEY CHECK (id ~ '^routine-group-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (title ~ '[^[:space:]]' AND char_length(title) <= 120),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz,
  UNIQUE (id, owner_id)
);

CREATE TABLE routine_activities (
  id text PRIMARY KEY CHECK (id ~ '^activity-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (title ~ '[^[:space:]]' AND char_length(title) <= 120),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz,
  UNIQUE (id, owner_id)
);

CREATE TABLE routines (
  id text PRIMARY KEY CHECK (id ~ '^routine-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id text,
  current_revision_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz,
  UNIQUE (id, owner_id),
  FOREIGN KEY (group_id, owner_id) REFERENCES routine_groups(id, owner_id)
);

CREATE TABLE routine_revisions (
  id text PRIMARY KEY CHECK (id ~ '^routine-revision-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  routine_id text NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  title text NOT NULL CHECK (title ~ '[^[:space:]]' AND char_length(title) <= 120),
  purpose text NOT NULL DEFAULT '' CHECK (char_length(purpose) <= 500),
  instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 4000),
  created_at timestamptz NOT NULL,
  UNIQUE (id, owner_id),
  UNIQUE (id, routine_id, owner_id),
  UNIQUE (routine_id, revision_number),
  FOREIGN KEY (routine_id, owner_id) REFERENCES routines(id, owner_id) ON DELETE CASCADE
);

ALTER TABLE routines ADD CONSTRAINT routines_current_revision_fk
  FOREIGN KEY (current_revision_id, id, owner_id)
  REFERENCES routine_revisions(id, routine_id, owner_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE routine_steps (
  id text PRIMARY KEY CHECK (id ~ '^routine-step-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  routine_revision_id text NOT NULL,
  activity_id text NOT NULL,
  activity_title text NOT NULL CHECK (activity_title ~ '[^[:space:]]' AND char_length(activity_title) <= 120),
  position integer NOT NULL CHECK (position >= 0),
  instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 4000),
  optional boolean NOT NULL DEFAULT false,
  planned_values jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (valid_routine_values(planned_values)),
  UNIQUE (id, owner_id),
  UNIQUE (id, routine_revision_id, owner_id),
  UNIQUE (routine_revision_id, position),
  FOREIGN KEY (routine_revision_id, owner_id) REFERENCES routine_revisions(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id, owner_id) REFERENCES routine_activities(id, owner_id)
);

CREATE TABLE routine_context_bindings (
  id text PRIMARY KEY CHECK (id ~ '^routine-binding-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  routine_revision_id text NOT NULL,
  routine_step_id text,
  target_type text NOT NULL CHECK (target_type IN ('life_link', 'collection')),
  target_id text NOT NULL,
  UNIQUE (id, owner_id),
  UNIQUE (routine_revision_id, routine_step_id, target_type, target_id),
  FOREIGN KEY (routine_revision_id, owner_id) REFERENCES routine_revisions(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (routine_step_id, routine_revision_id, owner_id)
    REFERENCES routine_steps(id, routine_revision_id, owner_id)
);

CREATE TABLE routine_schedules (
  id text PRIMARY KEY CHECK (id ~ '^routine-schedule-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  routine_id text NOT NULL,
  routine_revision_id text NOT NULL,
  rule jsonb NOT NULL CHECK (valid_routine_schedule_rule(rule)),
  revision integer NOT NULL CHECK (revision >= 1),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, owner_id),
  FOREIGN KEY (routine_id, owner_id) REFERENCES routines(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (routine_revision_id, routine_id, owner_id)
    REFERENCES routine_revisions(id, routine_id, owner_id)
);

CREATE TABLE routine_occurrences (
  id text PRIMARY KEY CHECK (id ~ '^routine-occurrence-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  schedule_id text NOT NULL,
  schedule_revision integer NOT NULL CHECK (schedule_revision >= 1),
  routine_id text NOT NULL,
  routine_revision_id text NOT NULL,
  local_date date NOT NULL,
  planned_for timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('planned', 'canceled', 'skipped', 'started', 'completed')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, owner_id),
  UNIQUE (id, routine_id, routine_revision_id, owner_id),
  UNIQUE (owner_id, schedule_id, local_date),
  FOREIGN KEY (schedule_id, owner_id) REFERENCES routine_schedules(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (routine_revision_id, routine_id, owner_id)
    REFERENCES routine_revisions(id, routine_id, owner_id)
);

CREATE TABLE routine_runs (
  id text PRIMARY KEY CHECK (id ~ '^routine-run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  routine_id text NOT NULL,
  routine_revision_id text NOT NULL,
  occurrence_id text,
  status text NOT NULL CHECK (status IN ('active', 'finalized')),
  context_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (valid_routine_context_snapshot(context_snapshot)),
  step_results jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (valid_routine_run_step_results(step_results)),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, owner_id),
  UNIQUE (id, routine_id, routine_revision_id, owner_id),
  FOREIGN KEY (routine_revision_id, routine_id, owner_id)
    REFERENCES routine_revisions(id, routine_id, owner_id),
  FOREIGN KEY (occurrence_id, routine_id, routine_revision_id, owner_id)
    REFERENCES routine_occurrences(id, routine_id, routine_revision_id, owner_id)
);

CREATE UNIQUE INDEX uq_routine_runs_active_routine
  ON routine_runs(owner_id, routine_id) WHERE status = 'active';
CREATE UNIQUE INDEX uq_routine_runs_occurrence
  ON routine_runs(owner_id, occurrence_id) WHERE occurrence_id IS NOT NULL;

CREATE TABLE routine_sessions (
  id text PRIMARY KEY CHECK (id ~ '^routine-session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  routine_id text NOT NULL,
  routine_revision_id text NOT NULL,
  run_id text NOT NULL,
  occurrence_id text,
  context_snapshot jsonb NOT NULL CHECK (valid_routine_context_snapshot(context_snapshot)),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL CHECK (completed_at >= started_at),
  UNIQUE (id, owner_id),
  UNIQUE (id, routine_revision_id, owner_id),
  UNIQUE (run_id),
  FOREIGN KEY (run_id, routine_id, routine_revision_id, owner_id)
    REFERENCES routine_runs(id, routine_id, routine_revision_id, owner_id),
  FOREIGN KEY (occurrence_id, routine_id, routine_revision_id, owner_id)
    REFERENCES routine_occurrences(id, routine_id, routine_revision_id, owner_id)
);

CREATE TABLE routine_session_step_results (
  id text PRIMARY KEY CHECK (id ~ '^routine-session-result-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  session_id text NOT NULL,
  routine_revision_id text NOT NULL,
  routine_step_id text NOT NULL,
  actual_values jsonb NOT NULL CHECK (valid_routine_values(actual_values)),
  proposed_next_values jsonb NOT NULL CHECK (valid_routine_values(proposed_next_values)),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  UNIQUE (id, owner_id),
  UNIQUE (id, session_id, owner_id),
  UNIQUE (session_id, routine_step_id),
  FOREIGN KEY (session_id, routine_revision_id, owner_id)
    REFERENCES routine_sessions(id, routine_revision_id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (routine_step_id, routine_revision_id, owner_id)
    REFERENCES routine_steps(id, routine_revision_id, owner_id)
);

CREATE TABLE routine_session_amendments (
  id text PRIMARY KEY CHECK (id ~ '^routine-session-amendment-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  owner_id text NOT NULL,
  session_id text NOT NULL,
  step_result_id text,
  note text NOT NULL CHECK (note ~ '[^[:space:]]' AND char_length(note) <= 4000),
  corrected_actual_values jsonb CHECK (corrected_actual_values IS NULL OR valid_routine_values(corrected_actual_values)),
  corrected_proposed_next_values jsonb CHECK (corrected_proposed_next_values IS NULL OR valid_routine_values(corrected_proposed_next_values)),
  created_at timestamptz NOT NULL,
  UNIQUE (id, owner_id),
  FOREIGN KEY (session_id, owner_id) REFERENCES routine_sessions(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (step_result_id, session_id, owner_id)
    REFERENCES routine_session_step_results(id, session_id, owner_id),
  CHECK (step_result_id IS NOT NULL OR (corrected_actual_values IS NULL AND corrected_proposed_next_values IS NULL))
);

CREATE FUNCTION reject_immutable_routine_row_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('life_links.allow_routine_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '23514';
END $$;

CREATE TRIGGER routine_revisions_immutable BEFORE UPDATE OR DELETE ON routine_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_routine_row_change();
CREATE TRIGGER routine_steps_immutable BEFORE UPDATE OR DELETE ON routine_steps
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_routine_row_change();
CREATE TRIGGER routine_context_bindings_immutable BEFORE UPDATE OR DELETE ON routine_context_bindings
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_routine_row_change();
CREATE TRIGGER routine_sessions_immutable BEFORE UPDATE OR DELETE ON routine_sessions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_routine_row_change();
CREATE TRIGGER routine_session_step_results_immutable BEFORE UPDATE OR DELETE ON routine_session_step_results
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_routine_row_change();
CREATE TRIGGER routine_session_amendments_immutable BEFORE UPDATE OR DELETE ON routine_session_amendments
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_routine_row_change();

CREATE FUNCTION guard_finalized_routine_run() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('life_links.allow_routine_delete', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'routine_runs rows cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'finalized' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'finalized Routine Runs are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER routine_runs_finalized_guard BEFORE UPDATE OR DELETE ON routine_runs
  FOR EACH ROW EXECUTE FUNCTION guard_finalized_routine_run();

CREATE FUNCTION guard_current_routine_life_link_binding() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM routine_context_bindings binding
    JOIN routines routine
      ON routine.owner_id = binding.owner_id
     AND routine.current_revision_id = binding.routine_revision_id
    WHERE binding.owner_id = OLD.owner_id
      AND binding.target_type = 'life_link'
      AND binding.target_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Life Link is referenced by a current Routine revision'
      USING ERRCODE = '23503', CONSTRAINT = 'routine_current_life_link_binding';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER life_links_current_routine_binding_guard
BEFORE DELETE ON life_links
FOR EACH ROW EXECUTE FUNCTION guard_current_routine_life_link_binding();

CREATE INDEX idx_routine_groups_owner_order ON routine_groups(owner_id, archived_at, lower(title), id);
CREATE INDEX idx_routine_activities_owner_order ON routine_activities(owner_id, archived_at, lower(title), id);
CREATE INDEX idx_routines_owner_order ON routines(owner_id, archived_at, updated_at DESC, id);
CREATE INDEX idx_routine_revisions_history ON routine_revisions(owner_id, routine_id, revision_number DESC);
CREATE INDEX idx_routine_steps_revision_order ON routine_steps(owner_id, routine_revision_id, position, id);
CREATE INDEX idx_routine_context_bindings_revision ON routine_context_bindings(owner_id, routine_revision_id, routine_step_id, id);
CREATE INDEX idx_routine_context_bindings_target ON routine_context_bindings(owner_id, target_type, target_id);
CREATE UNIQUE INDEX uq_routine_context_bindings_routine_target
  ON routine_context_bindings(routine_revision_id, target_type, target_id) WHERE routine_step_id IS NULL;
CREATE INDEX idx_routine_schedules_routine ON routine_schedules(owner_id, routine_id, active, updated_at DESC, id);
CREATE INDEX idx_routine_occurrences_planned ON routine_occurrences(owner_id, local_date, planned_for, id);
CREATE INDEX idx_routine_sessions_routine ON routine_sessions(owner_id, routine_id, completed_at DESC, id);
CREATE INDEX idx_routine_session_results_session ON routine_session_step_results(owner_id, session_id, routine_step_id);
CREATE INDEX idx_routine_session_amendments_session ON routine_session_amendments(owner_id, session_id, created_at, id);
