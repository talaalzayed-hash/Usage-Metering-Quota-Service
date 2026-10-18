// Shared setup for the API tests. They run the real app against the database
// in DATABASE_URL. Every test creates its own account with custom plans, so
// tests are isolated and do not depend on the predefined plan values.

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect } from "vitest";
import app from "../src/app.js";
import { pool } from "../src/Config/database.js";

export { pool };

let server: Server;
let baseUrl: string;

// Call once at the top of each API test file.
export function useTestServer(): void {
  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });
}

export const url = (path: string) => baseUrl + path;

export interface Reply {
  status: number;
  body: any;
}

export async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

export const adminHeaders = () => ({ "x-admin-key": process.env.ADMIN_API_KEY ?? "" });

export interface Limits {
  monthlyAllowance: number;
  maxPerRequest: number;
  dailyAllowance?: number | null;
}

export interface TestAccount {
  id: number;
  key: string;
  accountPlanId: number;
  get(path: string): Promise<Reply>;
  send(method: string, path: string, body?: unknown): Promise<Reply>;
  consume(userId: string, units: number, requestId?: string): Promise<Reply>;
  createPlan(scope: "account" | "user", limits: Limits): Promise<number>;
  updatePlan(planId: number, limits: Partial<Limits>): Promise<void>;
  setUserPlan(userId: string, planId: number): Promise<void>;
  addUser(userId: string, planId: number): Promise<void>;
}

export async function predefinedPlanId(scope: "account" | "user"): Promise<number> {
  const plans = (await call("GET", "/plans/predefined")).body.plans;
  return Number(plans.find((p: any) => p.scope === scope).id);
}

// A new account moved onto a custom account plan, with one user per entry in
// `users`, each on its own custom user plan.
export async function setupAccount(
  accountLimits: Limits,
  users: Record<string, Limits> = {},
): Promise<TestAccount> {
  const created = await call(
    "POST",
    "/admin/accounts",
    { name: `test-${randomUUID()}`, planId: await predefinedPlanId("account") },
    adminHeaders(),
  );
  expect(created.status).toBe(201);
  const key: string = created.body.apiKey;
  const auth = { "x-api-key": key };

  const account: TestAccount = {
    id: Number(created.body.account.id),
    key,
    accountPlanId: 0,
    get: (path) => call("GET", path, undefined, auth),
    send: (method, path, body) => call(method, path, body, auth),
    consume: (userId, units, requestId = randomUUID()) =>
      call("POST", "/consume", { userId, units, requestId }, auth),
    async createPlan(scope, limits) {
      const reply = await call(
        "POST",
        "/plans",
        { scope, name: `${scope}-${randomUUID()}`, ...limits },
        auth,
      );
      expect(reply.status).toBe(201);
      return Number(reply.body.plan.id);
    },
    async updatePlan(planId, limits) {
      expect((await call("PATCH", `/plans/${planId}`, limits, auth)).status).toBe(200);
    },
    async setUserPlan(userId, planId) {
      expect((await call("PUT", `/users/${userId}/plan`, { planId }, auth)).status).toBe(200);
    },
    async addUser(userId, planId) {
      expect((await call("POST", "/users", { externalId: userId, planId }, auth)).status).toBe(201);
    },
  };

  account.accountPlanId = await account.createPlan("account", accountLimits);
  expect((await call("PUT", "/account/plan", { planId: account.accountPlanId }, auth)).status).toBe(200);

  for (const [userId, limits] of Object.entries(users)) {
    await account.addUser(userId, await account.createPlan("user", limits));
  }
  return account;
}

// This month's usage straight from the counters, independent of the API.
export async function monthlyUsed(accountId: number) {
  const result = await pool.query(
    `SELECT uc.subject_type, u.external_id, uc.used
     FROM usage_counters uc
     LEFT JOIN users u ON uc.subject_type = 'user' AND u.id = uc.subject_id
     WHERE uc.period_type = 'month'
       AND uc.period_start = date_trunc('month', now() AT TIME ZONE 'UTC')::date
       AND ((uc.subject_type = 'account' AND uc.subject_id = $1)
         OR (uc.subject_type = 'user' AND u.account_id = $1))`,
    [accountId],
  );
  const usage: { account: number; users: Record<string, number> } = { account: 0, users: {} };
  for (const row of result.rows) {
    if (row.subject_type === "account") usage.account = Number(row.used);
    else usage.users[row.external_id] = Number(row.used);
  }
  return usage;
}
