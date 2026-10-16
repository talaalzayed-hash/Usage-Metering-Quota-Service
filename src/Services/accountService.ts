import { createHash, randomBytes } from "node:crypto";
import { pool } from "../Config/database.js";

interface CreateAccountInput {
  name: string;
  planId: string;
}

interface AccountRow {
  id: string;
  name: string;
  created_at: Date;
  plan_id: string;
  plan_name: string;
  plan_owner_account_id: string | null;
  monthly_allowance: string;
  max_per_request: string;
  daily_allowance: string | null;
  plan_version: number;
}

// Same shape as users: the account plus the plan currently applied to it.
const ACCOUNT_WITH_PLAN = `
  SELECT a.id, a.name, a.created_at,
         p.id AS plan_id, p.name AS plan_name,
         p.owner_account_id AS plan_owner_account_id,
         p.monthly_allowance, p.max_per_request, p.daily_allowance,
         p.version AS plan_version
  FROM accounts a
  JOIN plans p ON p.id = a.plan_id`;

function toAccount(row: AccountRow) {
  return {
    id: Number(row.id),
    name: row.name,
    createdAt: row.created_at,
    plan: {
      id: Number(row.plan_id),
      name: row.plan_name,
      scope: "account" as const,
      isPredefined: row.plan_owner_account_id === null,
      version: row.plan_version,
      monthlyAllowance: Number(row.monthly_allowance),
      maxPerRequest: Number(row.max_per_request),
      dailyAllowance:
        row.daily_allowance === null ? null : Number(row.daily_allowance),
    },
  };
}

export async function createAccount(input: CreateAccountInput) {
  const { name, planId } = input;
  // Ensure the selected plan is an account plan.
  const planResult = await pool.query(
    `SELECT id
     FROM plans
     WHERE id = $1
       AND scope = $2
       AND owner_account_id IS NULL`,
    [planId, "account"],
  );

  if (planResult.rowCount === 0) {
    throw new Error("ACCOUNT_PLAN_NOT_FOUND");
  }

  // Generate a high-entropy API key and store only its hash.
  const apiKey = randomBytes(32).toString("hex");
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

  const result = await pool.query(
    `INSERT INTO accounts (name, api_key_hash, plan_id)
     VALUES ($1, $2, $3)
     RETURNING id, name, plan_id, created_at`,
    [name, apiKeyHash, planId],
  );

  return {
    account: result.rows[0],
    apiKey,
  };
}

export async function getAccountById(accountId: string) {
  const result = await pool.query<AccountRow>(
    `${ACCOUNT_WITH_PLAN}
     WHERE a.id = $1`,
    [accountId],
  );
  const row = result.rows[0];
  return row ? toAccount(row) : null;
}

// The plan check and the update are one statement: the account moves only to
// an account plan that is predefined or owned by this account. Usage counters
// are keyed by account and period, so units already used this month carry over.
export async function changeAccountPlan(accountId: string, planId: string) {
  const result = await pool.query(
    `UPDATE accounts a
     SET plan_id = p.id
     FROM plans p
     WHERE a.id = $1::bigint
       AND p.id = $2::bigint
       AND p.scope = 'account'
       AND (p.owner_account_id IS NULL OR p.owner_account_id = $1::bigint)
     RETURNING a.id`,
    [accountId, planId],
  );

  // The account always exists here (apiKeyAuth found it), so 0 rows means
  // the plan is unknown, a user plan, or another account's custom plan.
  if (result.rowCount === 0) {
    throw new Error("ACCOUNT_PLAN_NOT_FOUND");
  }

  return getAccountById(accountId);
}