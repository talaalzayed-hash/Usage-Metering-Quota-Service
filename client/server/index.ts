// Docs Co backend: serves the page and forwards its requests to the usage
// metering service with the account's API key.
//
//   /api/users/...   what an end user does (user view)
//   /api/admin/...   what Docs Co's admin does (account view)

import "./env.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { consume, metering, MeteringError } from "./metering.js";
import { setupDemoAccount } from "./demo.js";

// Not PORT: in development the root .env sets PORT for the metering service.
const PORT = Number(process.env.CLIENT_PORT) || 8080;

// Created at startup and again on "Reset demo"; every route waits for it.
let apiKeyReady = setupDemoAccount();
apiKeyReady.catch((error) => console.error("Demo setup failed:", error));

// Calls the metering service as the Docs Co account.
async function asAccount<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  return metering<T>(method, path, { apiKey: await apiKeyReady, body });
}

const app = express();
app.use(express.json());

const param = (req: Request, name: string) => encodeURIComponent(String(req.params[name]));

// Keeps only the query parameters the service understands.
function query(req: Request, names: string[]): string {
  const params = new URLSearchParams();
  for (const name of names) {
    const value = req.query[name];
    if (typeof value === "string" && value !== "") params.set(name, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

// ---------------------------------------------------------------------------
// User view

// Users to pick from (stands in for logging in).
app.get("/api/users", async (_req, res) => {
  const { users } = await asAccount("GET", "/users?limit=100");
  res.json({
    users: users.map((u: any) => ({ externalId: u.externalId, planName: u.plan.name })),
  });
});

// The user's plan, the team's plan and what is left at each level.
app.get("/api/users/:userId/limits", async (req, res) => {
  res.json(await asAccount("GET", `/users/${param(req, "userId")}/limits`));
});

// "Process a document": one unit per page. Only processed when accepted.
app.post("/api/users/:userId/documents", async (req, res) => {
  const decision = await consume(await apiKeyReady, String(req.params.userId), req.body?.pages);
  res.json({ decision, processed: decision.accepted });
});

app.get("/api/users/:userId/requests", async (req, res) => {
  res.json(await asAccount("GET", `/requests?userId=${param(req, "userId")}&limit=10`));
});

// ---------------------------------------------------------------------------
// Account view

// The service returns plan rows as stored; the page gets camelCase numbers.
function toPlan(row: any) {
  return {
    id: Number(row.id),
    scope: row.scope,
    name: row.name,
    isPredefined: row.owner_account_id === null,
    version: row.version,
    monthlyAllowance: Number(row.monthly_allowance),
    maxPerRequest: Number(row.max_per_request),
    dailyAllowance: row.daily_allowance === null ? null : Number(row.daily_allowance),
  };
}

app.get("/api/admin/account", async (_req, res) => {
  res.json(await asAccount("GET", "/account"));
});

app.put("/api/admin/account/plan", async (req, res) => {
  res.json(await asAccount("PUT", "/account/plan", { planId: req.body?.planId }));
});

app.get("/api/admin/users", async (_req, res) => {
  const { users } = await asAccount("GET", "/users?limit=100");
  res.json({
    users: users.map((u: any) => ({
      externalId: u.externalId,
      planId: u.plan.id,
      planName: u.plan.name,
    })),
  });
});

app.put("/api/admin/users/:userId/plan", async (req, res) => {
  res.json(await asAccount("PUT", `/users/${param(req, "userId")}/plan`, { planId: req.body?.planId }));
});

app.get("/api/admin/plans", async (_req, res) => {
  const { plans } = await asAccount("GET", "/plans");
  res.json({ plans: plans.map(toPlan) });
});

app.post("/api/admin/plans", async (req, res) => {
  const { plan } = await asAccount("POST", "/plans", req.body);
  res.status(201).json({ plan: toPlan(plan) });
});

app.patch("/api/admin/plans/:planId", async (req, res) => {
  const { plan } = await asAccount("PATCH", `/plans/${param(req, "planId")}`, req.body);
  res.json({ plan: toPlan(plan) });
});

// Account total and every user's usage for one month.
app.get("/api/admin/usage", async (req, res) => {
  const month = query(req, ["month"]);
  const separator = month ? "&" : "?";
  res.json(await asAccount("GET", `/usage/users${month}${separator}limit=100`));
});

app.get("/api/admin/requests", async (req, res) => {
  res.json(
    await asAccount("GET", `/requests${query(req, ["userId", "outcome", "month", "limit", "offset"])}`),
  );
});

// Starts over with a brand-new demo account.
app.post("/api/admin/reset", async (_req, res) => {
  const next = setupDemoAccount();
  await next;
  apiKeyReady = next;
  res.json({ reset: true });
});

// ---------------------------------------------------------------------------

// The built React page, when present (production / Docker).
const webDist = fileURLToPath(new URL("../dist", import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(`${webDist}/index.html`));
}

// Service errors keep their status and message; anything else is a 502.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof MeteringError) {
    res.status(error.status).json(error.body ?? { message: "Metering service error" });
    return;
  }
  console.error(error);
  res.status(502).json({ message: "The metering service is not reachable" });
});

app.listen(PORT, () => {
  console.log(`Docs Co is running on http://localhost:${PORT}`);
});
