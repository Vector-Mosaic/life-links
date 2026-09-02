-- One canonical per-Calendar agent permission. Native defaults retain the
-- existing explicit Calendar-v2 grant behavior; external defaults deny access.
ALTER TABLE calendars ADD COLUMN agent_access text;

UPDATE calendars SET agent_access = CASE WHEN source = 'native' THEN 'write' ELSE 'none' END;
UPDATE calendars AS calendar
SET agent_access = binding.agent_grant
FROM calendar_provider_bindings AS binding
WHERE binding.calendar_id = calendar.id AND binding.owner_id = calendar.owner_id;

-- Old writers may briefly coexist during the forward deployment. Missing
-- permissions fail closed; current native writers explicitly supply write.
ALTER TABLE calendars ALTER COLUMN agent_access SET DEFAULT 'none';
ALTER TABLE calendars ALTER COLUMN agent_access SET NOT NULL;
ALTER TABLE calendars ADD CONSTRAINT calendars_agent_access_check
  CHECK (agent_access IN ('none', 'read', 'write'));

-- The provider binding keeps provider capability limits, but no second grant.
ALTER TABLE calendar_provider_bindings DROP COLUMN agent_grant;
