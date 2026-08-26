ALTER TABLE links
  ADD COLUMN IF NOT EXISTS body_doc jsonb,
  ADD COLUMN IF NOT EXISTS body_doc_version integer;

UPDATE links
SET
  body_doc = jsonb_build_object(
    'type', 'doc',
    'content', CASE
      WHEN body = '' THEN '[]'::jsonb
      ELSE jsonb_build_array(
        jsonb_build_object(
          'type', 'paragraph',
          'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', body))
        )
      )
    END
  ),
  body_doc_version = 1
WHERE body_doc IS NULL;

ALTER TABLE links
  ALTER COLUMN body_doc_version SET DEFAULT 1;
