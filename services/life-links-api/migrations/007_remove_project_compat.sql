-- Contract only the obsolete marker. Canonical records and their relationships
-- survive unchanged; no purpose Collection is inferred from a former root.
DROP TRIGGER life_links_project_compat_update_trigger ON life_links;
DROP FUNCTION enforce_marked_project_title_update();
DROP TRIGGER life_link_project_compat_valid_trigger ON life_link_project_compat;
DROP FUNCTION enforce_project_compatibility_title();
DROP TABLE life_link_project_compat;
