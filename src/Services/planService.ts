
import { pool } from "../Config/database.js";

interface CreatePlanInput {
  scope: "account" | "user";
  name: string;
  monthlyAllowance: number;
  maxPerRequest: number;
  dailyAllowance: number | null;
}

interface UpdatePlanInput {
  name?: string;
  monthlyAllowance?: number;
  maxPerRequest?: number;
  // null removes the daily rule; undefined leaves it unchanged
  dailyAllowance?: number | null;
}

const PLAN_COLUMNS = `id, owner_account_id, scope, name,
  monthly_allowance, max_per_request, daily_allowance,
  version, created_at, updated_at`;

export async function getPredefinedPlans() {
  const result = await pool.query(
    `SELECT ${PLAN_COLUMNS}
     FROM plans
     WHERE owner_account_id IS NULL
     ORDER BY scope, monthly_allowance`,
  );

  return result.rows;
}

export async function getPlans(accountId: string) {
  const result = await pool.query(
    `SELECT ${PLAN_COLUMNS}
     FROM plans
     WHERE owner_account_id IS NULL
        OR owner_account_id = $1
     ORDER BY scope, name`,
    [accountId],
  );

  return result.rows;
}

export async function getPlanById(
  accountId: string,
  planId: string,
) {
  const result = await pool.query(
    `SELECT ${PLAN_COLUMNS}
     FROM plans
     WHERE id = $1
       AND (
         owner_account_id IS NULL
         OR owner_account_id = $2
       )`,
    [planId, accountId],
  );

  return result.rows[0] ?? null;
}

export async function createPlan(
  accountId: string,
  input: CreatePlanInput,
) {
  const result = await pool.query(
    `INSERT INTO plans (
       owner_account_id,
       scope,
       name,
       monthly_allowance,
       max_per_request,
       daily_allowance
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${PLAN_COLUMNS}`,
    [
      accountId,
      input.scope,
      input.name,
      input.monthlyAllowance,
      input.maxPerRequest,
      input.dailyAllowance,
    ],
  );

  return result.rows[0];
}


export async function updatePlan(
  accountId: string,
  planId: string,
  updates: {
    name?: string;
    monthlyAllowance?: number;
    maxPerRequest?: number;
    dailyAllowance?: number | null;
  },
) {
  const result = await pool.query(
    `UPDATE plans
     SET
       name = COALESCE($1, name),
       monthly_allowance = COALESCE($2, monthly_allowance),
       max_per_request = COALESCE($3, max_per_request),
       daily_allowance = CASE
         WHEN $4::boolean THEN $5::bigint
         ELSE daily_allowance
       END,
       version = version + 1,
       updated_at = now()
     WHERE id = $6
       AND owner_account_id = $7
     RETURNING *`,
    [
      updates.name ?? null,
      updates.monthlyAllowance ?? null,
      updates.maxPerRequest ?? null,
      updates.dailyAllowance !== undefined,
      updates.dailyAllowance ?? null,
      planId,
      accountId,
    ],
  );

  return result.rows[0] ?? null;
}
