import { describe, expect, it } from "vitest";
import { call, pool, setupAccount, useTestServer } from "../helpers.js";

useTestServer();

// alice: 10 accepted, 25 rejected (per-request). bob: 15 accepted.
async function setupWithActivity() {
  const acct = await setupAccount(
    { monthlyAllowance: 100, maxPerRequest: 100 },
    {
      alice: { monthlyAllowance: 50, maxPerRequest: 20, dailyAllowance: 30 },
      bob: { monthlyAllowance: 50, maxPerRequest: 20 },
    },
  );
  await acct.consume("alice", 10, "h1");
  await acct.consume("alice", 25, "h2");
  await acct.consume("bob", 15, "h3");
  return acct;
}

describe("GET /users/:externalId/limits", () => {
  it("shows both plans, current usage and the effective limits", async () => {
    const acct = await setupWithActivity();
    const reply = await acct.get("/users/alice/limits");

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      account: { plan: { scope: "account" }, monthly: { limit: 100, used: 25, remaining: 75 }, daily: null },
      user: { plan: { scope: "user" }, monthly: { used: 10, remaining: 40 }, daily: { used: 10, remaining: 20 } },
      effective: { maxPerRequest: 20, monthlyRemaining: 40, dailyRemaining: 20, maxUnitsNow: 20 },
    });
    expect((await acct.get("/users/nobody/limits")).status).toBe(404);
  });
});

describe("usage endpoints", () => {
  it("returns the account's current month with remaining allowance", async () => {
    const acct = await setupWithActivity();
    const reply = await acct.get("/usage");

    expect(reply.status).toBe(200);
    expect(reply.body.account).toMatchObject({
      isCurrentMonth: true,
      used: 25,
      limit: 100,
      remaining: 75,
      requests: { accepted: 2, rejected: 1 },
    });
    expect(reply.body.account.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("returns one user's usage and 404 for an unknown user", async () => {
    const acct = await setupWithActivity();

    expect((await acct.get("/users/alice/usage")).body.user).toMatchObject({
      externalId: "alice",
      used: 10,
      limit: 50,
      remaining: 40,
      requests: { accepted: 1, rejected: 1 },
    });
    expect((await acct.get("/users/nobody/usage")).status).toBe(404);
  });

  it("lists users whose usage adds up to the account total", async () => {
    const acct = await setupWithActivity();

    const page = await acct.get("/usage/users?limit=1");
    expect(page.body.users.map((u: any) => u.externalId)).toEqual(["alice"]);

    const all = (await acct.get("/usage/users")).body;
    const sum = all.users.reduce((total: number, u: any) => total + u.used, 0);
    expect(sum).toBe(all.account.used);
  });

  it("returns past months without a limit, and zero for months with no usage", async () => {
    const acct = await setupWithActivity();
    // Simulate an earlier month's usage directly in the counters.
    await pool.query(
      `INSERT INTO usage_counters (subject_type, subject_id, period_type, period_start, used)
       VALUES ('account', $1, 'month', '2026-01-01', 42)`,
      [acct.id],
    );

    expect((await acct.get("/usage?month=2026-01")).body.account).toEqual({
      month: "2026-01",
      isCurrentMonth: false,
      used: 42,
      limit: null,
      remaining: null,
      requests: { accepted: 0, rejected: 0 },
    });
    expect((await acct.get("/users/alice/usage?month=2025-12")).body.user.used).toBe(0);
  });

  it("rejects a malformed month", async () => {
    const acct = await setupWithActivity();
    expect((await acct.get("/usage?month=2026-13")).status).toBe(400);
    expect((await acct.get("/usage/users?month=oct")).status).toBe(400);
  });
});

describe("history endpoints", () => {
  it("lists decisions newest first with paging", async () => {
    const acct = await setupWithActivity();

    const first = await acct.get("/requests?limit=2");
    expect(first.status).toBe(200);
    expect(first.body.requests.map((r: any) => r.requestId)).toEqual(["h3", "h2"]);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.requests[1]).toMatchObject({
      userId: "alice",
      units: 25,
      accepted: false,
      rejection: { rule: "max_per_request", level: "user" },
    });

    const second = await acct.get("/requests?limit=2&offset=2");
    expect(second.body.requests.map((r: any) => r.requestId)).toEqual(["h1"]);
    expect(second.body.hasMore).toBe(false);
  });

  it("filters by user, outcome and month", async () => {
    const acct = await setupWithActivity();
    const ids = async (query: string) =>
      (await acct.get(`/requests?${query}`)).body.requests.map((r: any) => r.requestId);

    expect(await ids("userId=alice")).toEqual(["h2", "h1"]);
    expect(await ids("outcome=accepted")).toEqual(["h3", "h1"]);
    expect(await ids("userId=alice&outcome=rejected")).toEqual(["h2"]);
    expect(await ids("month=2020-01")).toEqual([]);
  });

  it("returns one decision with its original response and limits", async () => {
    const acct = await setupWithActivity();
    const reply = await acct.get("/requests/h1");

    expect(reply.status).toBe(200);
    expect(reply.body.request).toMatchObject({
      requestId: "h1",
      userId: "alice",
      accepted: true,
      response: { requestId: "h1", accepted: true, user: { monthly: { used: 10 } } },
      limitsSnapshot: { user: { plan: { maxPerRequest: 20 }, usedBefore: { monthly: 0 } } },
    });
    expect((await acct.get("/requests/missing")).status).toBe(404);
  });

  it("keeps past outcomes unchanged after a plan update", async () => {
    const acct = await setupWithActivity();
    const userPlan = (await acct.get("/users/alice")).body.user.plan.id;
    await acct.updatePlan(userPlan, { maxPerRequest: 100 });

    const h2 = (await acct.get("/requests/h2")).body.request;
    expect(h2.accepted).toBe(false);
    expect(h2.limitsSnapshot.user.plan.maxPerRequest).toBe(20);
  });

  it("rejects bad filters", async () => {
    const acct = await setupWithActivity();
    expect((await acct.get("/requests?outcome=maybe")).status).toBe(400);
    expect((await acct.get("/requests?outcome=constructor")).status).toBe(400);
    expect((await acct.get("/requests?month=2026-1")).status).toBe(400);
    expect((await acct.get("/requests?limit=0")).status).toBe(400);
    expect((await call("GET", "/requests?limit=500", undefined, { "x-api-key": acct.key })).status).toBe(400);
  });
});
