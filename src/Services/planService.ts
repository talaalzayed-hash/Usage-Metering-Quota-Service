
import { pool } from "../Config/database.js";

interface CreatePlanInput {
  scope: "account" | "user";
  name: string;
  monthlyAllowance: number;
  maxPerRequest: number;
}

interface UpdatePlanInput {
  name?: string;
  monthlyAllowance?: number;
  maxPerRequest?: number;
}

export async function getPlans(accountId: string) {
  const result = await pool.query(
    `SELECT id, owner_account_id, scope, name,
            monthly_allowance, max_per_request, updated_at
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
    `SELECT id, owner_account_id, scope, name,
            monthly_allowance, max_per_request, updated_at
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
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id, owner_account_id, scope, name,
               monthly_allowance, max_per_request, updated_at`,
    [
      accountId,
      input.scope,
      input.name,
      input.monthlyAllowance,
      input.maxPerRequest,
    ],
  );

  return result.rows[0];
}

export async function updatePlan(
  accountId: string,
  planId: string,
  input: UpdatePlanInput,
) {
  const result = await pool.query(
    `UPDATE plans
     SET name = COALESCE($3, name),
         monthly_allowance = COALESCE($4, monthly_allowance),
         max_per_request = COALESCE($5, max_per_request),
         updated_at = NOW()
     WHERE id = $1
       AND owner_account_id = $2
     RETURNING id, owner_account_id, scope, name,
               monthly_allowance, max_per_request, updated_at`,
    [
      planId,
      accountId,
      input.name ?? null,
      input.monthlyAllowance ?? null,
      input.maxPerRequest ?? null,
    ],
  );

  return result.rows[0] ?? null;
}
