import type { Pool, PoolClient } from "pg";
import { pool } from "../Config/database.js";
import {
  evaluate,
  remaining,
  type Level,
  type PlanLimits,
  type Usage,
  type Violation,
} from "../Rules/evaluate.js";

// How a consume request is decided (all inside one transaction):
//
//  1. Load the user, both plans and any earlier request with the same
//     requestId. A known requestId replays the stored decision.
//  2. A request over either per-request limit is rejected without locking the
//     counters: the answer does not depend on usage.
//  3. Otherwise lock the four counters (account month, account day, user month,
//     user day), always in that order so concurrent requests cannot deadlock.
//     The account month row serializes all consumes of one account.
//  4. Reload plans and the requestId check after the lock. Under READ COMMITTED
//     this sees every plan change and duplicate committed while we waited.
//  5. Evaluate, add the units if accepted, record the decision, commit.
//
// The month and day come from the database clock (transaction start, UTC), so
// every statement in the transaction agrees on which period it is counting.

export interface ConsumeInput {
  externalId: string;
  units: number;
  requestId: string;
}

interface PlanInfo extends PlanLimits {
  id: number;
  name: string;
  version: number;
  isPredefined: boolean;
}

interface Allowance {
  limit: number;
  used: number;
  remaining: number;
}

interface SubjectSummary {
  plan: PlanInfo;
  monthly: Allowance;
  daily: Allowance | null; // null when the plan has no daily rule
}

export interface ConsumeResult {
  requestId: string;
  accepted: boolean;
  replayed: boolean;
  decidedAt: string;
  units: number;
  rejection: (Violation & { resetsAt: string | null }) | null;
  violations: Violation[];
  account: SubjectSummary;
  user: SubjectSummary & { externalId: string };
}

interface Periods {
  month: string; // 'YYYY-MM-DD', first day of the UTC month
  day: string; // 'YYYY-MM-DD', the UTC day
}

interface Context {
  userId: string;
  externalId: string;
  decidedAt: string;
  periods: Periods;
  accountPlan: PlanInfo;
  userPlan: PlanInfo;
  existing: { userId: string; units: number; response: ConsumeResult } | null;
}

type Queryable = Pool | PoolClient;

// ---------------------------------------------------------------------------
// Queries

const CONTEXT_SQL = `
  SELECT u.id AS user_id, u.external_id,
         now() AS decided_at,
         date_trunc('month', now() AT TIME ZONE 'UTC')::date::text AS month_start,
         (now() AT TIME ZONE 'UTC')::date::text AS day_start,
         ap.id AS a_id, ap.name AS a_name, ap.owner_account_id AS a_owner, ap.version AS a_version,
         ap.monthly_allowance AS a_monthly, ap.max_per_request AS a_max, ap.daily_allowance AS a_daily,
         up.id AS u_id, up.name AS u_name, up.owner_account_id AS u_owner, up.version AS u_version,
         up.monthly_allowance AS u_monthly, up.max_per_request AS u_max, up.daily_allowance AS u_daily,
         r.user_id AS existing_user_id, r.units AS existing_units, r.response AS existing_response
  FROM users u
  JOIN accounts a ON a.id = u.account_id
  JOIN plans ap ON ap.id = a.plan_id
  JOIN plans up ON up.id = u.plan_id
  LEFT JOIN requests r ON r.account_id = u.account_id AND r.request_id = $3
  WHERE u.account_id = $1 AND u.external_id = $2`;

// BIGINT columns arrive as strings; units and limits fit safely in a number.
function toPlan(row: Record<string, unknown>, prefix: "a" | "u"): PlanInfo {
  const daily = row[`${prefix}_daily`];
  return {
    id: Number(row[`${prefix}_id`]),
    name: String(row[`${prefix}_name`]),
    version: Number(row[`${prefix}_version`]),
    isPredefined: row[`${prefix}_owner`] === null,
    monthlyAllowance: Number(row[`${prefix}_monthly`]),
    maxPerRequest: Number(row[`${prefix}_max`]),
    dailyAllowance: daily === null ? null : Number(daily),
  };
}

async function loadContext(
  db: Queryable,
  accountId: string,
  input: ConsumeInput,
): Promise<Context> {
  const result = await db.query(CONTEXT_SQL, [accountId, input.externalId, input.requestId]);
  const row = result.rows[0];
  if (!row) {
    throw new Error("USER_NOT_FOUND");
  }
  return {
    userId: String(row.user_id),
    externalId: row.external_id,
    decidedAt: (row.decided_at as Date).toISOString(),
    periods: { month: row.month_start, day: row.day_start },
    accountPlan: toPlan(row, "a"),
    userPlan: toPlan(row, "u"),
    existing:
      row.existing_user_id === null
        ? null
        : {
            userId: String(row.existing_user_id),
            units: Number(row.existing_units),
            response: row.existing_response,
          },
  };
}

// Counter rows for this account and user in the current month and day.
const COUNTER_KEYS = `
  ((subject_type = 'account' AND subject_id = $1) OR (subject_type = 'user' AND subject_id = $2))
  AND ((period_type = 'month' AND period_start = $3::date) OR (period_type = 'day' AND period_start = $4::date))`;

function toUsage(rows: { subject_type: Level; period_type: "month" | "day"; used: string }[]) {
  const usage: Record<Level, Usage> = {
    account: { monthly: 0, daily: 0 },
    user: { monthly: 0, daily: 0 },
  };
  for (const row of rows) {
    usage[row.subject_type][row.period_type === "month" ? "monthly" : "daily"] = Number(row.used);
  }
  return usage;
}

// Unlocked read, used only when the decision does not depend on usage.
async function readUsage(client: PoolClient, accountId: string, ctx: Context) {
  const result = await client.query(
    `SELECT subject_type, period_type, used FROM usage_counters WHERE ${COUNTER_KEYS}`,
    [accountId, ctx.userId, ctx.periods.month, ctx.periods.day],
  );
  return toUsage(result.rows);
}

// Creates missing counters and row-locks all four in one statement. Rows of a
// multi-row INSERT are processed in VALUES order, which gives the fixed lock
// order. The no-op DO UPDATE is what takes the lock on an existing row.
async function lockUsage(client: PoolClient, accountId: string, ctx: Context) {
  const result = await client.query(
    `INSERT INTO usage_counters (subject_type, subject_id, period_type, period_start)
     VALUES ('account', $1, 'month', $3::date),
            ('account', $1, 'day',   $4::date),
            ('user',    $2, 'month', $3::date),
            ('user',    $2, 'day',   $4::date)
     ON CONFLICT (subject_type, subject_id, period_type, period_start)
     DO UPDATE SET used = usage_counters.used
     RETURNING subject_type, period_type, used`,
    [accountId, ctx.userId, ctx.periods.month, ctx.periods.day],
  );
  return toUsage(result.rows);
}

async function addUsage(client: PoolClient, accountId: string, ctx: Context, units: number) {
  await client.query(
    `UPDATE usage_counters
     SET used = used + $5, updated_at = now()
     WHERE ${COUNTER_KEYS}`,
    [accountId, ctx.userId, ctx.periods.month, ctx.periods.day, units],
  );
}

// ---------------------------------------------------------------------------
// Decision

function allowance(limit: number, used: number): Allowance {
  return { limit, used, remaining: remaining(limit, used) };
}

function summarize(plan: PlanInfo, usage: Usage): SubjectSummary {
  return {
    plan,
    monthly: allowance(plan.monthlyAllowance, usage.monthly),
    daily: plan.dailyAllowance === null ? null : allowance(plan.dailyAllowance, usage.daily),
  };
}

// When the rejecting rule can pass again (start of the next UTC month or day).
function resetsAt(violation: Violation, periods: Periods): string | null {
  const [year, month, day] = periods.day.split("-").map(Number) as [number, number, number];
  switch (violation.rule) {
    case "max_per_request":
      return null;
    case "monthly_allowance":
      return new Date(Date.UTC(year, month, 1)).toISOString(); // month is 1-based
    case "daily_allowance":
      return new Date(Date.UTC(year, month - 1, day + 1)).toISOString();
  }
}

function buildResult(
  ctx: Context,
  input: ConsumeInput,
  usageBefore: Record<Level, Usage>,
  violations: Violation[],
): ConsumeResult {
  const accepted = violations.length === 0;
  const added = accepted ? input.units : 0;
  const after = (usage: Usage): Usage => ({
    monthly: usage.monthly + added,
    daily: usage.daily + added,
  });
  const first = violations[0];

  return {
    requestId: input.requestId,
    accepted,
    replayed: false,
    decidedAt: ctx.decidedAt,
    units: input.units,
    rejection: first ? { ...first, resetsAt: resetsAt(first, ctx.periods) } : null,
    violations,
    account: summarize(ctx.accountPlan, after(usageBefore.account)),
    user: { externalId: ctx.externalId, ...summarize(ctx.userPlan, after(usageBefore.user)) },
  };
}

// A known requestId returns the stored decision; the same key with a different
// user or amount is a client bug.
function replayFrom(ctx: Context, input: ConsumeInput): ConsumeResult | null {
  if (!ctx.existing) return null;
  if (ctx.existing.userId !== ctx.userId || ctx.existing.units !== input.units) {
    throw new Error("IDEMPOTENCY_CONFLICT");
  }
  return { ...ctx.existing.response, replayed: true };
}

async function record(
  client: PoolClient,
  accountId: string,
  ctx: Context,
  input: ConsumeInput,
  usageBefore: Record<Level, Usage>,
  violations: Violation[],
): Promise<ConsumeResult> {
  const result = buildResult(ctx, input, usageBefore, violations);
  await client.query(
    `INSERT INTO requests (account_id, user_id, request_id, units, accepted,
                           failed_rule, failed_level, limits_snapshot, response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      accountId,
      ctx.userId,
      input.requestId,
      input.units,
      result.accepted,
      result.rejection?.rule ?? null,
      result.rejection?.level ?? null,
      {
        account: { plan: ctx.accountPlan, usedBefore: usageBefore.account },
        user: { plan: ctx.userPlan, usedBefore: usageBefore.user },
      },
      result,
    ],
  );
  return result;
}

async function decide(
  client: PoolClient,
  accountId: string,
  input: ConsumeInput,
): Promise<ConsumeResult> {
  const first = await loadContext(client, accountId, input);
  const earlier = replayFrom(first, input);
  if (earlier) return earlier;

  if (
    input.units > first.accountPlan.maxPerRequest ||
    input.units > first.userPlan.maxPerRequest
  ) {
    const usage = await readUsage(client, accountId, first);
    const violations = evaluate(
      { plan: first.accountPlan, usage: usage.account },
      { plan: first.userPlan, usage: usage.user },
      input.units,
    );
    return record(client, accountId, first, input, usage, violations);
  }

  const usage = await lockUsage(client, accountId, first);

  const ctx = await loadContext(client, accountId, input);
  const duplicate = replayFrom(ctx, input);
  if (duplicate) return duplicate;

  const violations = evaluate(
    { plan: ctx.accountPlan, usage: usage.account },
    { plan: ctx.userPlan, usage: usage.user },
    input.units,
  );
  if (violations.length === 0) {
    await addUsage(client, accountId, ctx, input.units);
  }
  return record(client, accountId, ctx, input, usage, violations);
}

// Two concurrent requests with the same requestId that both skipped the lock
// meet at the unique index; the loser replays the winner's decision.
function isDuplicateRequestId(error: unknown): boolean {
  const err = error as { code?: string; constraint?: string };
  return err.code === "23505" && err.constraint === "requests_account_id_request_id_key";
}

export async function consume(accountId: string, input: ConsumeInput): Promise<ConsumeResult> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    const result = await decide(client, accountId, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      broken = true;
    });
    if (isDuplicateRequestId(error)) {
      const replay = replayFrom(await loadContext(pool, accountId, input), input);
      if (replay) return replay;
    }
    throw error;
  } finally {
    // A connection that could not roll back is discarded, not reused.
    client.release(broken);
  }
}
