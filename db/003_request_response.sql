-- 003_request_response.sql
-- Store the exact decision body returned to the caller, so a retry with the
-- same requestId replays the original answer unchanged (even after the plan
-- or the month has changed).

BEGIN;

-- The temporary default only fills rows recorded before this migration.
ALTER TABLE requests
  ADD COLUMN response JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE requests
  ALTER COLUMN response DROP DEFAULT;

COMMIT;
