-- Reuse the owner change receipt/journal; NULL preserves legacy Life Link receipts.
ALTER TABLE life_link_change_receipts ADD COLUMN collection_ids text[];

CREATE FUNCTION guard_current_routine_collection_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM routine_context_bindings binding JOIN routines routine
      ON routine.owner_id = binding.owner_id AND routine.current_revision_id = binding.routine_revision_id
    WHERE binding.owner_id = OLD.owner_id AND binding.target_type = 'collection' AND binding.target_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Collection is referenced by a current Routine revision'
      USING ERRCODE = '23503', CONSTRAINT = 'routine_current_collection_binding';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER collections_current_routine_binding_guard BEFORE DELETE ON collections
FOR EACH ROW EXECUTE FUNCTION guard_current_routine_collection_binding();
