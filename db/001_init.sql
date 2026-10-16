-- 001_init.sql
-- Core schema for the usage metering and quota service.

BEGIN;

-- Enums ----------------------------------------------------------------------

CREATE TYPE plan_scope AS ENUM ('account', 'user');      -- where a plan can be assigned
CREATE TYPE period_type AS ENUM ('month', 'day');        -- counter window (UTC)
CREATE TYPE rule_type AS ENUM (
  'max_per_request',
  'daily_allowance',
  'monthly_allowance'
);

-- Plans ----------------------------------------------------------------------
-- owner_account_id NULL  = predefined plan, read-only, visible to every account.
-- owner_account_id set   = custom plan, visible and editable only by that account.

CREATE TABLE plans (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_account_id   BIGINT NULL,                       -- FK added after accounts exists
  scope              plan_scope  NOT NULL,
  name               TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  monthly_allowance  BIGINT      NOT NULL CHECK (monthly_allowance >= 0),
  max_per_request    BIGINT      NOT NULL CHECK (max_per_request > 0),
  daily_allowance    BIGINT      NULL     CHECK (daily_allowance >= 0),  -- NULL = no daily rule
  version            INT         NOT NULL DEFAULT 1,    -- bumped on every update
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- target for the composite FKs below, so an account can only point at an
  -- account-scoped plan and a user only at a user-scoped plan
  UNIQUE (id, scope)
);

-- Plan names are unique per owner and scope.
CREATE UNIQUE INDEX plans_predefined_name_uq
  ON plans (scope, name) WHERE owner_account_id IS NULL;
CREATE UNIQUE INDEX plans_custom_name_uq
  ON plans (owner_account_id, scope, name) WHERE owner_account_id IS NOT NULL;

-- Accounts -------------------------------------------------------------------

CREATE TABLE accounts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  api_key_hash  TEXT        NOT NULL UNIQUE,            -- sha256 hex of the raw key; raw key never stored
  plan_id       BIGINT      NOT NULL,
  plan_scope    plan_scope  NOT NULL DEFAULT 'account' CHECK (plan_scope = 'account'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (plan_id, plan_scope) REFERENCES plans (id, scope)
);

ALTER TABLE plans
  ADD CONSTRAINT plans_owner_fk
  FOREIGN KEY (owner_account_id) REFERENCES accounts (id) ON DELETE CASCADE;

-- Users ----------------------------------------------------------------------

CREATE TABLE users (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id   BIGINT      NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  external_id  TEXT        NOT NULL CHECK (length(trim(external_id)) > 0),  -- the caller's own user id
  plan_id      BIGINT      NOT NULL,
  plan_scope   plan_scope  NOT NULL DEFAULT 'user' CHECK (plan_scope = 'user'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (account_id, external_id),
  UNIQUE (account_id, id),                                 -- target for requests FK
  FOREIGN KEY (plan_id, plan_scope) REFERENCES plans (id, scope)
);

-- Usage counters -------------------------------------------------------------
-- One row per subject per window. Keyed by subject + period, not by plan,
-- so switching plans keeps the units already used this month.
-- Account usage is stored on its own row (not summed on read) because the
-- consume path locks and checks it on every request.

CREATE TABLE usage_counters (
  subject_type  plan_scope  NOT NULL,                 -- 'account' or 'user'
  subject_id    BIGINT      NOT NULL,                 -- accounts.id or users.id
  period_type   period_type NOT NULL,
  period_start  DATE        NOT NULL,                 -- first day of the UTC month, or the UTC day
  used          BIGINT      NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (subject_type, subject_id, period_type, period_start),
  CHECK (
    period_type = 'day'
    OR period_start = date_trunc('month', period_start)::date
  )
);

-- Request history ------------------------------------------------------------
-- Every consume decision, accepted or rejected. Never updated after insert,
-- so plan changes cannot rewrite history. limits_snapshot keeps the limits
-- that were in force when the decision was made.

CREATE TABLE requests (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id       BIGINT      NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  user_id          BIGINT      NOT NULL,
  request_id       TEXT        NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  units            BIGINT      NOT NULL CHECK (units > 0),
  accepted         BOOLEAN     NOT NULL,
  failed_rule      rule_type   NULL,
  failed_level     plan_scope  NULL,
  limits_snapshot  JSONB       NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (account_id, request_id),                     -- idempotency key
  FOREIGN KEY (account_id, user_id) REFERENCES users (account_id, id),
  CHECK (
    (accepted AND failed_rule IS NULL AND failed_level IS NULL)
    OR (NOT accepted AND failed_rule IS NOT NULL AND failed_level IS NOT NULL)
  )
);

-- History pages: newest first, filter by account (and optionally user).
CREATE INDEX requests_account_created_idx
  ON requests (account_id, created_at DESC, id DESC);
CREATE INDEX requests_user_created_idx
  ON requests (account_id, user_id, created_at DESC, id DESC);

COMMIT;
