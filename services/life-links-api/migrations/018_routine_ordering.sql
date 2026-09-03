-- Preserve every historical definition and its immutable-row trigger. PostgreSQL
-- supplies the constant for existing rows without updating their saved contents.
-- Old writers during cutover remain ordered; new writers explicitly supply mode.
ALTER TABLE routine_revisions
  ADD COLUMN ordering text NOT NULL DEFAULT 'ordered'
  CHECK (ordering IN ('unordered', 'ordered'));
