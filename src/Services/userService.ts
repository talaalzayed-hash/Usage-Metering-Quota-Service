import { pool } from "../Config/database.js";
import { remaining } from "../Rules/evaluate.js";

interface UserRow {
  external_id: string;
  created_at: Date;
  plan_id: string;
  plan_name: string;
  plan_owner_account_id: string | null;
  monthly_allowance: string;
  max_per_request: string;
  daily_allowance: string | null;
  plan_version: number;
}

// One query shape for every read, so all endpoints return the same user object.
const USER_WITH_PLAN = `
  SELECT u.external_id, u.created_at,
         p.id AS plan_id, p.name AS plan_name,
         p.owner_account_id AS plan_owner_account_id,
         p.monthly_allowance, p.max_per_request, p.daily_allowance,
         p.version AS plan_version
  FROM users u
  JOIN plans p ON p.id = u.plan_id`;

// BIGINT columns arrive from pg as strings; limits fit safely in a JS number.
function toUser(row: UserRow) {
  return {
    externalId: row.external_id,
    createdAt: row.created_at,
    plan: {
      id: Number(row.plan_id),
      name: row.plan_name,
      scope: "user" as const,
      isPredefined: row.plan_owner_account_id === null,
      version: row.plan_version,
      monthlyAllowance: Number(row.monthly_allowance),
      maxPerRequest: Number(row.max_per_request),
      dailyAllowance:
        row.daily_allowance === null ? null : Number(row.daily_allowance),
    },
  };
}

export async function getUserByExternalId(accountId: string, externalId: string) {
  const result = await pool.query<UserRow>(
    `${USER_WITH_PLAN}
     WHERE u.account_id = $1 AND u.external_id = $2`,
    [accountId, externalId],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

// Both plans that apply to a user's requests, this period's usage at each
// level, and the effective limits a request must fit (the tighter of the two).
export async function getUserLimits(accountId: string, externalId: string) {
  const result = await pool.query(
    `SELECT ap.id AS a_id, ap.name AS a_name, ap.owner_account_id AS a_owner, ap.version AS a_version,
            ap.monthly_allowance AS a_monthly, ap.max_per_request AS a_max, ap.daily_allowance AS a_daily,
            up.id AS u_id, up.name AS u_name, up.owner_account_id AS u_owner, up.version AS u_version,
            up.monthly_allowance AS u_monthly, up.max_per_request AS u_max, up.daily_allowance AS u_daily,
            COALESCE(am.used, 0) AS a_used_month, COALESCE(ad.used, 0) AS a_used_day,
            COALESCE(um.used, 0) AS u_used_month, COALESCE(ud.used, 0) AS u_used_day
     FROM users u
     JOIN accounts a ON a.id = u.account_id
     JOIN plans ap ON ap.id = a.plan_id
     JOIN plans up ON up.id = u.plan_id
     CROSS JOIN LATERAL (
       SELECT date_trunc('month', now() AT TIME ZONE 'UTC')::date AS month_start,
              (now() AT TIME ZONE 'UTC')::date AS day_start
     ) p
     LEFT JOIN usage_counters am ON am.subject_type = 'account' AND am.subject_id = a.id
       AND am.period_type = 'month' AND am.period_start = p.month_start
     LEFT JOIN usage_counters ad ON ad.subject_type = 'account' AND ad.subject_id = a.id
       AND ad.period_type = 'day' AND ad.period_start = p.day_start
     LEFT JOIN usage_counters um ON um.subject_type = 'user' AND um.subject_id = u.id
       AND um.period_type = 'month' AND um.period_start = p.month_start
     LEFT JOIN usage_counters ud ON ud.subject_type = 'user' AND ud.subject_id = u.id
       AND ud.period_type = 'day' AND ud.period_start = p.day_start
     WHERE u.account_id = $1 AND u.external_id = $2`,
    [accountId, externalId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const level = (prefix: "a" | "u", scope: "account" | "user") => {
    const plan = {
      id: Number(row[`${prefix}_id`]),
      name: row[`${prefix}_name`] as string,
      scope,
      isPredefined: row[`${prefix}_owner`] === null,
      version: row[`${prefix}_version`] as number,
      monthlyAllowance: Number(row[`${prefix}_monthly`]),
      maxPerRequest: Number(row[`${prefix}_max`]),
      dailyAllowance: row[`${prefix}_daily`] === null ? null : Number(row[`${prefix}_daily`]),
    };
    const usedMonth = Number(row[`${prefix}_used_month`]);
    const usedDay = Number(row[`${prefix}_used_day`]);
    return {
      plan,
      monthly: {
        limit: plan.monthlyAllowance,
        used: usedMonth,
        remaining: remaining(plan.monthlyAllowance, usedMonth),
      },
      daily:
        plan.dailyAllowance === null
          ? null
          : { limit: plan.dailyAllowance, used: usedDay, remaining: remaining(plan.dailyAllowance, usedDay) },
    };
  };

  const account = level("a", "account");
  const user = level("u", "user");
  const dailyRemaining = [account.daily, user.daily]
    .filter((d) => d !== null)
    .map((d) => d.remaining);

  return {
    externalId,
    account,
    user,
    // The most a single request could consume right now.
    effective: {
      maxPerRequest: Math.min(account.plan.maxPerRequest, user.plan.maxPerRequest),
      monthlyRemaining: Math.min(account.monthly.remaining, user.monthly.remaining),
      dailyRemaining: dailyRemaining.length ? Math.min(...dailyRemaining) : null,
      maxUnitsNow: Math.min(
        account.plan.maxPerRequest,
        user.plan.maxPerRequest,
        account.monthly.remaining,
        user.monthly.remaining,
        ...dailyRemaining,
      ),
    },
  };
}

export async function listUsers(accountId: string, limit: number, offset: number) {
  const result = await pool.query<UserRow>(
    `${USER_WITH_PLAN}
     WHERE u.account_id = $1
     ORDER BY u.id
     LIMIT $2 OFFSET $3`,
    [accountId, limit, offset],
  );
  return result.rows.map(toUser);
}

export async function createUser(accountId: string, externalId: string, planId: string) {
  const result = await pool.query(
    `INSERT INTO users (account_id, external_id, plan_id)
     SELECT $1::bigint, $2::text, p.id
     FROM plans p
     WHERE p.id = $3::bigint
       AND p.scope = 'user'
       AND (p.owner_account_id IS NULL OR p.owner_account_id = $1::bigint)
     RETURNING id`,
    [accountId, externalId, planId],
  );
  if (result.rowCount === 0) {
    throw new Error("USER_PLAN_NOT_FOUND");
  }
  return getUserByExternalId(accountId, externalId);
}

export async function changeUserPlan(accountId: string, externalId: string, planId: string) {
  const result = await pool.query(
    `UPDATE users u
     SET plan_id = p.id
     FROM plans p
     WHERE u.account_id = $1::bigint
       AND u.external_id = $2
       AND p.id = $3::bigint
       AND p.scope = 'user'
       AND (p.owner_account_id IS NULL OR p.owner_account_id = $1::bigint)
     RETURNING u.id`,
    [accountId, externalId, planId],
  );
  if (result.rowCount === 0) {
    // Tell "no such user" apart from "plan not usable".
    const user = await getUserByExternalId(accountId, externalId);
    throw new Error(user ? "USER_PLAN_NOT_FOUND" : "USER_NOT_FOUND");
  }
  return getUserByExternalId(accountId, externalId);
}