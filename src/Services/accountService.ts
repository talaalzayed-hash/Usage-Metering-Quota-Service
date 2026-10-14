import { createHash, randomBytes } from "node:crypto";
import { pool } from "../Config/database.js";

interface CreateAccountInput {
  name: string;
  planId: string;
}

export async function createAccount(input: CreateAccountInput) {
  const { name, planId } = input;
  // Ensure the selected plan is an account plan.
  const planResult = await pool.query(
    `SELECT id
     FROM plans
     WHERE id = $1 AND scope = $2`,
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