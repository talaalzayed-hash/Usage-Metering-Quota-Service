-- 002_seed.sql
-- Predefined plans, available to every account and read-only through the API.
-- Safe to run more than once.

BEGIN;

INSERT INTO plans (owner_account_id, scope, name, monthly_allowance, max_per_request, daily_allowance)
VALUES
  -- Account plans: shared by all users of the account.
  (NULL, 'account', 'Starter',  10000,  100, NULL),
  (NULL, 'account', 'Pro',     100000, 1000, NULL),
  -- User plans: individual limits per user.
  (NULL, 'user',    'Basic',     1000,   20,  100),
  (NULL, 'user',    'Premium',   5000,  100, NULL)
ON CONFLICT (scope, name) WHERE owner_account_id IS NULL DO NOTHING;

COMMIT;
