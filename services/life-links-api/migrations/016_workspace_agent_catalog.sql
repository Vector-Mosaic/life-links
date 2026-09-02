-- Existing connections retain their exact grant; only explicit owner consent selects v3.
ALTER TABLE users DROP CONSTRAINT users_agent_tool_catalog_id_check;
ALTER TABLE users ADD CONSTRAINT users_agent_tool_catalog_id_check
  CHECK (agent_tool_catalog_id IS NULL OR agent_tool_catalog_id IN (
    'life-links-page-webmcp-v1', 'life-links-calendar-v2', 'life-links-workspace-v3'
  ));
