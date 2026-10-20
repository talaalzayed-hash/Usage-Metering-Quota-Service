// Load and concurrency test for the metering service.
//
// Runs against a live stack (by default the Docker Compose one) and checks
// correctness as well as speed: after each scenario it reads the usage
// counters and the request history straight from PostgreSQL and verifies that
// they agree with each other and with what the client saw.
//
//   docker compose up --build -d
//   npm run perf
//
// Settings (environment variables, all optional):
//   BASE_URL      http://localhost:3000
//   ADMIN_API_KEY from .env, else local-admin-key (the Compose default)
//   DATABASE_URL  postgres://metering:metering@localhost:5434/metering
//   CONCURRENCY   64     requests in flight at once
//   DURATION      20     seconds for the time-based scenarios
//   OUT           perf/results/latest.json

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import dotenv from "dotenv";
import pg from "pg";

// Docker Compose takes ADMIN_API_KEY from .env, so use the same one. Only that
// key is read: DATABASE_URL in .env points at the local dev database.
const envFile = existsSync(".env") ? dotenv.parse(readFileSync(".env")) : {};

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? envFile.ADMIN_API_KEY ?? "local-admin-key";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://metering:metering@localhost:5434/metering";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 64);
const DURATION_MS = Number(process.env.DURATION ?? 20) * 1000;
const OUT = process.env.OUT ?? "perf/results/latest.json";

const db = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

// ---------------------------------------------------------------------------
// HTTP

interface Reply {
  status: number;
  body: any;
  ms: number;
  startedAt: number;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const startedAt = performance.now();
  const response = await fetch(BASE_URL + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const ms = performance.now() - startedAt;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, ms, startedAt };
}

function expectStatus(reply: Reply, status: number, what: string) {
  if (reply.status !== status) {
    throw new Error(`${what}: expected ${status}, got ${reply.status} ${JSON.stringify(reply.body)}`);
  }
}

interface Limits {
  monthlyAllowance: number;
  maxPerRequest: number;
  dailyAllowance?: number | null;
}

class Account {
  constructor(
    readonly id: number,
    readonly key: string,
    readonly accountPlanId: number,
    readonly userPlanIds: Map<string, number>,
  ) {}

  send(method: string, path: string, body?: unknown) {
    return call(method, path, body, { "x-api-key": this.key });
  }

  consume(userId: string, units: number, requestId: string = randomUUID()) {
    return this.send("POST", "/consume", { userId, units, requestId });
  }

  async updatePlan(planId: number, limits: Partial<Limits>) {
    expectStatus(await this.send("PATCH", `/plans/${planId}`, limits), 200, "update plan");
  }
}

async function createPlan(key: string, scope: "account" | "user", limits: Limits) {
  const reply = await call(
    "POST",
    "/plans",
    { scope, name: `perf-${scope}-${randomUUID()}`, ...limits },
    { "x-api-key": key },
  );
  expectStatus(reply, 201, "create plan");
  return Number(reply.body.plan.id);
}

// A fresh account on its own custom account plan, with `users` users that all
// share one custom user plan (each still has its own usage total).
async function setupAccount(accountLimits: Limits, userLimits: Limits, users: number) {
  const predefined = await call("GET", "/plans/predefined");
  const starter = predefined.body.plans.find((p: any) => p.scope === "account");
  const created = await call(
    "POST",
    "/admin/accounts",
    { name: `perf-${randomUUID()}`, planId: starter.id },
    { "x-admin-key": ADMIN_API_KEY },
  );
  expectStatus(created, 201, "create account (is ADMIN_API_KEY right?)");
  const key: string = created.body.apiKey;
  const auth = { "x-api-key": key };

  const accountPlanId = await createPlan(key, "account", accountLimits);
  expectStatus(await call("PUT", "/account/plan", { planId: accountPlanId }, auth), 200, "assign plan");

  const userPlanId = await createPlan(key, "user", userLimits);
  const userPlanIds = new Map<string, number>();
  for (let i = 0; i < users; i++) {
    const externalId = `user-${i}`;
    expectStatus(
      await call("POST", "/users", { externalId, planId: userPlanId }, auth),
      201,
      "create user",
    );
    userPlanIds.set(externalId, userPlanId);
  }
  return new Account(Number(created.body.account.id), key, accountPlanId, userPlanIds);
}

// ---------------------------------------------------------------------------
// Load runner

interface Run {
  replies: Reply[];
  elapsedMs: number;
}

// Keeps `concurrency` requests in flight until `next` returns null or the
// deadline passes.
async function runLoad(
  concurrency: number,
  next: (i: number) => (() => Promise<Reply>) | null,
  durationMs = Infinity,
): Promise<Run> {
  const replies: Reply[] = [];
  const start = performance.now();
  let index = 0;

  async function worker() {
    while (performance.now() - start < durationMs) {
      const job = next(index++);
      if (!job) return;
      try {
        replies.push(await job());
      } catch (error) {
        replies.push({ status: 0, body: String(error), ms: 0, startedAt: performance.now() });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { replies, elapsedMs: performance.now() - start };
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

interface Stats {
  requests: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  accepted: number;
  rejected: number;
  errors: number; // non-200 or network failure
}

function stats(run: Run): Stats {
  const ms = run.replies.map((r) => r.ms).sort((a, b) => a - b);
  const ok = run.replies.filter((r) => r.status === 200);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    requests: run.replies.length,
    rps: Math.round(run.replies.length / (run.elapsedMs / 1000)),
    p50: round(percentile(ms, 50)),
    p95: round(percentile(ms, 95)),
    p99: round(percentile(ms, 99)),
    max: round(ms[ms.length - 1] ?? 0),
    accepted: ok.filter((r) => r.body.accepted).length,
    rejected: ok.filter((r) => !r.body.accepted).length,
    errors: run.replies.length - ok.length,
  };
}

// ---------------------------------------------------------------------------
// Database checks

interface Totals {
  accountCounter: number; // the account's monthly counter
  userCounters: number; // sum of its users' monthly counters
  acceptedUnits: number; // sum of accepted units in the request history
  historyRows: number;
}

async function totals(accountId: number): Promise<Totals> {
  const month = `date_trunc('month', now() AT TIME ZONE 'UTC')::date`;
  const { rows } = await db.query(
    `SELECT
       (SELECT COALESCE(sum(used), 0) FROM usage_counters
         WHERE subject_type = 'account' AND subject_id = $1
           AND period_type = 'month' AND period_start = ${month}) AS account_counter,
       (SELECT COALESCE(sum(c.used), 0) FROM usage_counters c
          JOIN users u ON u.id = c.subject_id
         WHERE c.subject_type = 'user' AND u.account_id = $1
           AND c.period_type = 'month' AND c.period_start = ${month}) AS user_counters,
       (SELECT COALESCE(sum(units) FILTER (WHERE accepted), 0) FROM requests
         WHERE account_id = $1) AS accepted_units,
       (SELECT count(*) FROM requests WHERE account_id = $1) AS history_rows`,
    [accountId],
  );
  const row = rows[0];
  return {
    accountCounter: Number(row.account_counter),
    userCounters: Number(row.user_counters),
    acceptedUnits: Number(row.accepted_units),
    historyRows: Number(row.history_rows),
  };
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

function check(name: string, actual: unknown, expected: unknown): Check {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  return { name, pass, detail: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
}

// Counters, history and what the client was told must all agree.
async function ledgerChecks(account: Account, clientAcceptedUnits: number): Promise<Check[]> {
  const t = await totals(account.id);
  return [
    check("account counter = units the client saw accepted", t.accountCounter, clientAcceptedUnits),
    check("account counter = sum of user counters", t.userCounters, t.accountCounter),
    check("account counter = accepted units in history", t.acceptedUnits, t.accountCounter),
  ];
}

function acceptedUnits(run: Run) {
  return run.replies
    .filter((r) => r.status === 200 && r.body.accepted && !r.body.replayed)
    .reduce((sum, r) => sum + r.body.units, 0);
}

// ---------------------------------------------------------------------------
// Scenarios

interface ScenarioResult {
  name: string;
  description: string;
  stats: Stats;
  checks: Check[];
}

const BIG: Limits = { monthlyAllowance: 1_000_000_000, maxPerRequest: 1000, dailyAllowance: null };
const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)]!;
const units1to10 = () => 1 + Math.floor(Math.random() * 10);

// 1. Throughput when load is spread over many accounts: little lock contention.
async function spreadAccounts(): Promise<ScenarioResult> {
  const accounts = await Promise.all(
    Array.from({ length: 20 }, () => setupAccount(BIG, BIG, 5)),
  );
  const users = [...accounts[0]!.userPlanIds.keys()];
  const run = await runLoad(
    CONCURRENCY,
    () => {
      const account = pick(accounts);
      return () => account.consume(pick(users), units1to10());
    },
    DURATION_MS,
  );

  const checks: Check[] = [];
  const s = stats(run);
  checks.push(check("no errors", s.errors, 0), check("every request accepted", s.rejected, 0));
  // Per-account ledger: group what the client saw by API key.
  const seen = new Map<number, number>();
  run.replies.forEach((r) => {
    if (r.status !== 200 || !r.body.accepted) return;
    // The response does not name the account, so match on the plan id.
    const account = accounts.find((a) => a.accountPlanId === r.body.account.plan.id)!;
    seen.set(account.id, (seen.get(account.id) ?? 0) + r.body.units);
  });
  let mismatched = 0;
  for (const account of accounts) {
    const results = await ledgerChecks(account, seen.get(account.id) ?? 0);
    mismatched += results.filter((c) => !c.pass).length;
  }
  checks.push(check("ledger agrees for all 20 accounts", mismatched, 0));

  return {
    name: "spread",
    description: `20 accounts x 5 users, random 1-10 units, ${CONCURRENCY} in flight for ${DURATION_MS / 1000}s`,
    stats: s,
    checks,
  };
}

// 2. Every request hits one account: all consumes serialize on its counter row.
async function hotAccount(): Promise<ScenarioResult> {
  const account = await setupAccount(BIG, BIG, 20);
  const users = [...account.userPlanIds.keys()];
  const run = await runLoad(
    CONCURRENCY,
    () => () => account.consume(pick(users), units1to10()),
    DURATION_MS,
  );
  const s = stats(run);
  return {
    name: "hot-account",
    description: `1 account x 20 users, random 1-10 units, ${CONCURRENCY} in flight for ${DURATION_MS / 1000}s`,
    stats: s,
    checks: [
      check("no errors", s.errors, 0),
      check("every request accepted", s.rejected, 0),
      ...(await ledgerChecks(account, acceptedUnits(run))),
    ],
  };
}

// 3. Racing for the last units of a shared allowance: no overspend.
async function exhaustAccount(): Promise<ScenarioResult> {
  const allowance = 1000;
  const total = 3000;
  const account = await setupAccount(
    { monthlyAllowance: allowance, maxPerRequest: 10, dailyAllowance: null },
    BIG,
    20,
  );
  const users = [...account.userPlanIds.keys()];
  const run = await runLoad(CONCURRENCY, (i) =>
    i < total ? () => account.consume(pick(users), 1) : null,
  );
  const s = stats(run);
  const wrongRule = run.replies.filter(
    (r) =>
      r.status === 200 &&
      !r.body.accepted &&
      !(r.body.rejection.rule === "monthly_allowance" && r.body.rejection.level === "account"),
  ).length;
  const usage = await account.send("GET", "/usage");
  return {
    name: "exhaust-account",
    description: `${total} x 1-unit requests from 20 users against an account allowance of ${allowance}, ${CONCURRENCY} in flight`,
    stats: s,
    checks: [
      check("no errors", s.errors, 0),
      check("accepted exactly the allowance", s.accepted, allowance),
      check("rejected the rest", s.rejected, total - allowance),
      check("every rejection is the account monthly allowance", wrongRule, 0),
      check("GET /usage shows 0 remaining", usage.body.account.remaining, 0),
      ...(await ledgerChecks(account, acceptedUnits(run))),
    ],
  };
}

// 4. One user racing for their own allowance while the account has plenty.
async function exhaustUser(): Promise<ScenarioResult> {
  const allowance = 500;
  const total = 1500;
  const account = await setupAccount(
    BIG,
    { monthlyAllowance: allowance, maxPerRequest: 10, dailyAllowance: null },
    1,
  );
  const run = await runLoad(CONCURRENCY, (i) =>
    i < total ? () => account.consume("user-0", 1) : null,
  );
  const s = stats(run);
  const wrongRule = run.replies.filter(
    (r) =>
      r.status === 200 &&
      !r.body.accepted &&
      !(r.body.rejection.rule === "monthly_allowance" && r.body.rejection.level === "user"),
  ).length;
  return {
    name: "exhaust-user",
    description: `${total} x 1-unit requests from 1 user with a user allowance of ${allowance}, ${CONCURRENCY} in flight`,
    stats: s,
    checks: [
      check("no errors", s.errors, 0),
      check("accepted exactly the allowance", s.accepted, allowance),
      check("every rejection is the user monthly allowance", wrongRule, 0),
      ...(await ledgerChecks(account, acceptedUnits(run))),
    ],
  };
}

// 5. Retries: every requestId is sent 4 times at once. Each counts once.
async function retries(): Promise<ScenarioResult> {
  const ids = 500;
  const copies = 4;
  const account = await setupAccount(BIG, BIG, 10);
  const users = [...account.userPlanIds.keys()];
  const jobs: { requestId: string; userId: string }[] = [];
  for (let i = 0; i < ids; i++) {
    const job = { requestId: randomUUID(), userId: pick(users) };
    for (let c = 0; c < copies; c++) jobs.push(job);
  }
  // Copies stay close together so they really race each other.
  const run = await runLoad(CONCURRENCY, (i) => {
    const job = jobs[i];
    return job ? () => account.consume(job.userId, 3, job.requestId) : null;
  });
  const s = stats(run);
  const fresh = run.replies.filter((r) => r.status === 200 && !r.body.replayed).length;
  const t = await totals(account.id);
  return {
    name: "retries",
    description: `${ids} requestIds x ${copies} concurrent copies, 3 units each, ${CONCURRENCY} in flight`,
    stats: s,
    checks: [
      check("no errors (no 500 from duplicate inserts)", s.errors, 0),
      check("one fresh decision per requestId", fresh, ids),
      check("other copies replayed", s.requests - fresh, ids * (copies - 1)),
      check("one history row per requestId", t.historyRows, ids),
      check("units counted once per requestId", t.accountCounter, ids * 3),
      ...(await ledgerChecks(account, ids * 3)),
    ],
  };
}

// 6. Plan changes during load apply to every request that starts afterwards.
async function planChanges(): Promise<ScenarioResult> {
  const account = await setupAccount(
    { monthlyAllowance: 1_000_000, maxPerRequest: 100, dailyAllowance: null },
    { monthlyAllowance: 1_000_000, maxPerRequest: 20, dailyAllowance: null },
    10,
  );
  const users = [...account.userPlanIds.keys()];
  const userPlanId = account.userPlanIds.get("user-0")!;
  const third = DURATION_MS / 3;

  // Phase 1: 10-unit requests pass. Phase 2: the user plan's per-request limit
  // drops to 5. Phase 3: the account allowance drops below what is used.
  // A request that overlaps an update may see either version, so each check
  // only looks at requests that ran entirely inside one phase.
  let maxChangedAt = Infinity;
  let allowanceChangeStartedAt = Infinity;
  let allowanceChangedAt = Infinity;
  const changes = (async () => {
    await new Promise((r) => setTimeout(r, third));
    await account.updatePlan(userPlanId, { maxPerRequest: 5 });
    maxChangedAt = performance.now();
    await new Promise((r) => setTimeout(r, third));
    allowanceChangeStartedAt = performance.now();
    await account.updatePlan(account.accountPlanId, { monthlyAllowance: 1, maxPerRequest: 100 });
    // Raise the user limit again so only the account allowance can reject.
    await account.updatePlan(userPlanId, { maxPerRequest: 20 });
    allowanceChangedAt = performance.now();
  })();

  const run = await runLoad(
    CONCURRENCY,
    () => () => account.consume(pick(users), 10),
    DURATION_MS,
  );
  await changes;
  const s = stats(run);
  const ok = run.replies.filter((r) => r.status === 200);
  const afterMax = ok.filter(
    (r) => r.startedAt > maxChangedAt && r.startedAt + r.ms < allowanceChangeStartedAt,
  );
  const afterAllowance = ok.filter((r) => r.startedAt > allowanceChangedAt);
  const isRule = (r: Reply, rule: string, level: string) =>
    !r.body.accepted && r.body.rejection.rule === rule && r.body.rejection.level === level;
  const usage = await account.send("GET", "/usage");

  return {
    name: "plan-changes",
    description: `10 users, 10-unit requests, ${CONCURRENCY} in flight for ${DURATION_MS / 1000}s; user max/request 20 -> 5 after 1/3, account allowance -> 1 after 2/3`,
    stats: s,
    checks: [
      check("no errors", s.errors, 0),
      check("accepted before any change", ok.some((r) => r.body.accepted), true),
      check("requests ran in the max-change phase", afterMax.length > 0, true),
      check(
        "every request between the max change and the next change is rejected by the user max_per_request",
        afterMax.filter((r) => !isRule(r, "max_per_request", "user")).length,
        0,
      ),
      check(
        "every request started after the allowance cut is rejected by the account allowance",
        afterAllowance.filter((r) => !isRule(r, "monthly_allowance", "account")).length,
        0,
      ),
      check("allowance below usage shows 0 remaining", usage.body.account.remaining, 0),
      ...(await ledgerChecks(account, acceptedUnits(run))),
    ],
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const health = await call("GET", "/plans/predefined").catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(`The service is not answering at ${BASE_URL}. Start it with: docker compose up --build -d`);
  }

  // Warm up connections and the JIT so the first scenario is not penalised.
  const warm = await setupAccount(BIG, BIG, 1);
  await runLoad(CONCURRENCY, (i) => (i < 500 ? () => warm.consume("user-0", 1) : null));

  const scenarios = [spreadAccounts, hotAccount, exhaustAccount, exhaustUser, retries, planChanges];
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    process.stdout.write(`running ${scenario.name}... `);
    const result = await scenario();
    results.push(result);
    const failed = result.checks.filter((c) => !c.pass).length;
    console.log(failed === 0 ? "ok" : `${failed} check(s) FAILED`);
  }

  console.log("\n| Scenario | Requests | Req/s | p50 ms | p95 ms | p99 ms | Max ms | Accepted | Rejected | Errors |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const { name, stats: s } of results) {
    console.log(
      `| ${name} | ${s.requests} | ${s.rps} | ${s.p50} | ${s.p95} | ${s.p99} | ${s.max} | ${s.accepted} | ${s.rejected} | ${s.errors} |`,
    );
  }

  console.log("\nCorrectness checks:");
  for (const { name, checks } of results) {
    for (const c of checks) {
      console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${name}: ${c.name}${c.pass ? "" : ` (${c.detail})`}`);
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      { ranAt: new Date().toISOString(), baseUrl: BASE_URL, concurrency: CONCURRENCY, durationSeconds: DURATION_MS / 1000, results },
      null,
      2,
    ),
  );
  console.log(`\nSaved to ${OUT}`);

  const failed = results.flatMap((r) => r.checks).filter((c) => !c.pass).length;
  await db.end();
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await db.end().catch(() => {});
  process.exitCode = 1;
});
