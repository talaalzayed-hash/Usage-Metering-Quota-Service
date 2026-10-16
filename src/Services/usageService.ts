import { pool } from "../Config/database.js";
import { remaining } from "../Rules/evaluate.js";

// Monthly usage for an account and its users. Totals come from the usage
// counters; request counts come from the request history of the same UTC
// month. limit/remaining are only given for the current month: the schema
// does not record which plan applied in a closed month, and measuring an old
// month against today's plan would be misleading.

interface UsageRow {
  month_start: string; // 'YYYY-MM-DD'
  is_current: boolean;
  monthly_allowance: string;
  used: string;
  accepted: string;
  rejected: string;
}

// $2 is the first day of the requested month, or NULL for the current month.
const MONTH = `(
  SELECT COALESCE($2::date, date_trunc('month', now() AT TIME ZONE 'UTC')::date) AS start,
         date_trunc('month', now() AT TIME ZONE 'UTC')::date AS current_start
)`;

// Requests decided inside the month (UTC bounds), for the matching rows of r.
const MONTH_REQUESTS = `
  count(*) FILTER (WHERE r.accepted) AS accepted,
  count(*) FILTER (WHERE NOT r.accepted) AS rejected`;
const IN_MONTH = `
  r.created_at >= m.start::timestamp AT TIME ZONE 'UTC'
  AND r.created_at < (m.start + interval '1 month') AT TIME ZONE 'UTC'`;

function toUsage(row: UsageRow) {
  const used = Number(row.used);
  const limit = Number(row.monthly_allowance);
  return {
    month: row.month_start.slice(0, 7),
    isCurrentMonth: row.is_current,
    used,
    limit: row.is_current ? limit : null,
    remaining: row.is_current ? remaining(limit, used) : null,
    requests: { accepted: Number(row.accepted), rejected: Number(row.rejected) },
  };
}

export async function getAccountUsage(accountId: string, monthStart: string | null) {
  const result = await pool.query<UsageRow>(
    `SELECT m.start::text AS month_start, m.start = m.current_start AS is_current,
            p.monthly_allowance, COALESCE(c.used, 0) AS used, rc.accepted, rc.rejected
     FROM accounts a
     JOIN plans p ON p.id = a.plan_id
     CROSS JOIN ${MONTH} m
     LEFT JOIN usage_counters c
       ON c.subject_type = 'account' AND c.subject_id = a.id
      AND c.period_type = 'month' AND c.period_start = m.start
     CROSS JOIN LATERAL (
       SELECT ${MONTH_REQUESTS} FROM requests r
       WHERE r.account_id = a.id AND ${IN_MONTH}
     ) rc
     WHERE a.id = $1`,
    [accountId, monthStart],
  );
  const row = result.rows[0];
  return row ? toUsage(row) : null;
}

// One user (externalId set) or a page of users (externalId null).
async function queryUserUsage(
  accountId: string,
  monthStart: string | null,
  externalId: string | null,
  limit: number,
  offset: number,
) {
  const result = await pool.query<UsageRow & { external_id: string }>(
    `SELECT u.external_id,
            m.start::text AS month_start, m.start = m.current_start AS is_current,
            p.monthly_allowance, COALESCE(c.used, 0) AS used, rc.accepted, rc.rejected
     FROM users u
     JOIN plans p ON p.id = u.plan_id
     CROSS JOIN ${MONTH} m
     LEFT JOIN usage_counters c
       ON c.subject_type = 'user' AND c.subject_id = u.id
      AND c.period_type = 'month' AND c.period_start = m.start
     CROSS JOIN LATERAL (
       SELECT ${MONTH_REQUESTS} FROM requests r
       WHERE r.account_id = u.account_id AND r.user_id = u.id AND ${IN_MONTH}
     ) rc
     WHERE u.account_id = $1
       AND ($3::text IS NULL OR u.external_id = $3)
     ORDER BY u.id
     LIMIT $4 OFFSET $5`,
    [accountId, monthStart, externalId, limit, offset],
  );
  return result.rows.map((row) => ({ externalId: row.external_id, ...toUsage(row) }));
}

export async function getUserUsage(
  accountId: string,
  externalId: string,
  monthStart: string | null,
) {
  const [user] = await queryUserUsage(accountId, monthStart, externalId, 1, 0);
  return user ?? null;
}

export async function listUserUsage(
  accountId: string,
  monthStart: string | null,
  limit: number,
  offset: number,
) {
  return queryUserUsage(accountId, monthStart, null, limit, offset);
}
