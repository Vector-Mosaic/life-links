-- Derived, owner-private text only. Original media bytes remain canonical;
-- reads/writes revalidate their exact owner, source bytes and extractor revision.
CREATE TABLE attachment_text_cache (
  media_id text PRIMARY KEY REFERENCES link_media(id) ON DELETE CASCADE,
  revision text NOT NULL CHECK (revision ~ '^[a-f0-9]{64}$'),
  -- Serialized UTF-8 JSON is bytea, not JSONB: valid document text can contain
  -- NUL or escaped lone surrogates that PostgreSQL text/JSONB cannot represent.
  -- The reader bounds extracted UTF-8 text to 8 MiB; JSON escaping can use 6x that.
  extraction bytea NOT NULL CHECK (octet_length(extraction) <= 50462720)
);

-- No existing connection is upgraded. Search is an explicit owner grant.
ALTER TABLE users DROP CONSTRAINT users_agent_tool_catalog_id_check;
ALTER TABLE users ADD CONSTRAINT users_agent_tool_catalog_id_check
  CHECK (agent_tool_catalog_id IS NULL OR agent_tool_catalog_id IN (
    'life-links-page-webmcp-v1', 'life-links-calendar-v2', 'life-links-workspace-v3', 'life-links-search-v4'
  ));
