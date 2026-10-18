import { describe, expect, it } from "vitest";
import { monthlyUsed, pool, setupAccount, url, useTestServer } from "../helpers.js";

useTestServer();

describe("POST /consume decisions", () => {
  it("accepts and adds the units to both the user and the account", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 10_000, maxPerRequest: 100 },
      { alice: { monthlyAllowance: 1_000, maxPerRequest: 20 } },
    );

    const reply = await acct.consume("alice", 10);

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      accepted: true,
      replayed: false,
      units: 10,
      rejection: null,
      violations: [],
      account: { monthly: { limit: 10_000, used: 10, remaining: 9_990 }, daily: null },
      user: { externalId: "alice", monthly: { limit: 1_000, used: 10, remaining: 990 } },
    });
    expect(await monthlyUsed(acct.id)).toEqual({ account: 10, users: { alice: 10 } });
  });

  it("rejects on the user's per-request limit and consumes nothing", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 10_000, maxPerRequest: 100 },
      { alice: { monthlyAllowance: 1_000, maxPerRequest: 20 } },
    );

    const reply = await acct.consume("alice", 25);

    expect(reply.body.accepted).toBe(false);
    expect(reply.body.rejection).toEqual({
      rule: "max_per_request",
      level: "user",
      limit: 20,
      used: null,
      requested: 25,
      resetsAt: null,
    });
    expect(reply.body.user.monthly.used).toBe(0);
    expect(await monthlyUsed(acct.id)).toEqual({ account: 0, users: {} });
  });

  it("rejects on the shared account allowance while the user has plenty left", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 15, maxPerRequest: 100 },
      {
        alice: { monthlyAllowance: 1_000, maxPerRequest: 20 },
        bob: { monthlyAllowance: 1_000, maxPerRequest: 20 },
      },
    );
    expect((await acct.consume("alice", 10)).body.accepted).toBe(true);

    const reply = await acct.consume("bob", 10);

    expect(reply.body.accepted).toBe(false);
    expect(reply.body.rejection).toMatchObject({
      rule: "monthly_allowance",
      level: "account",
      limit: 15,
      used: 10,
      requested: 10,
    });
    expect(reply.body.rejection.resetsAt).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(reply.body.user.monthly.remaining).toBe(1_000);
    expect(await monthlyUsed(acct.id)).toEqual({ account: 10, users: { alice: 10, bob: 0 } });
  });

  it("keeps separate totals for users that share one plan", async () => {
    const acct = await setupAccount({ monthlyAllowance: 1_000, maxPerRequest: 100 });
    const shared = await acct.createPlan("user", { monthlyAllowance: 10, maxPerRequest: 10 });
    await acct.addUser("alice", shared);
    await acct.addUser("bob", shared);

    expect((await acct.consume("alice", 10)).body.accepted).toBe(true);
    expect((await acct.consume("alice", 1)).body.rejection.level).toBe("user");
    expect((await acct.consume("bob", 10)).body.accepted).toBe(true);
  });

  it("enforces a daily allowance and reports when it resets", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 1_000, maxPerRequest: 100 },
      { alice: { monthlyAllowance: 1_000, maxPerRequest: 100, dailyAllowance: 30 } },
    );
    expect((await acct.consume("alice", 30)).body.user.daily).toEqual({
      limit: 30,
      used: 30,
      remaining: 0,
    });

    const reply = await acct.consume("alice", 1);

    expect(reply.body.rejection).toMatchObject({ rule: "daily_allowance", level: "user" });
    expect(reply.body.rejection.resetsAt).toMatch(/T00:00:00\.000Z$/);
  });

  it("records every decision in the request history", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 100, maxPerRequest: 100 },
      { alice: { monthlyAllowance: 100, maxPerRequest: 20 } },
    );
    await acct.consume("alice", 5, "ok-1");
    await acct.consume("alice", 50, "too-big");

    const rows = await pool.query(
      `SELECT request_id, units, accepted, failed_rule, failed_level
       FROM requests WHERE account_id = $1 ORDER BY id`,
      [acct.id],
    );
    expect(rows.rows).toEqual([
      { request_id: "ok-1", units: "5", accepted: true, failed_rule: null, failed_level: null },
      { request_id: "too-big", units: "50", accepted: false, failed_rule: "max_per_request", failed_level: "user" },
    ]);
  });
});

describe("POST /consume plan changes", () => {
  it("applies an updated custom plan to the next request", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 1_000, maxPerRequest: 100 },
      { alice: { monthlyAllowance: 1_000, maxPerRequest: 20 } },
    );
    expect((await acct.consume("alice", 50)).body.rejection.rule).toBe("max_per_request");

    const userPlan = (await acct.get("/users/alice")).body.user.plan.id;
    await acct.updatePlan(userPlan, { maxPerRequest: 50 });

    const reply = await acct.consume("alice", 50);
    expect(reply.body.accepted).toBe(true);
    expect(reply.body.user.plan.maxPerRequest).toBe(50);
  });

  it("shows zero remaining and rejects when the allowance drops below usage", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 100, maxPerRequest: 100 },
      { alice: { monthlyAllowance: 100, maxPerRequest: 100 } },
    );
    await acct.consume("alice", 60);
    await acct.updatePlan(acct.accountPlanId, { monthlyAllowance: 40 });

    const reply = await acct.consume("alice", 1);

    expect(reply.body.accepted).toBe(false);
    expect(reply.body.account.monthly).toEqual({ limit: 40, used: 60, remaining: 0 });
  });

  it("keeps the units already used when a user switches plans", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 1_000, maxPerRequest: 100 },
      { alice: { monthlyAllowance: 50, maxPerRequest: 50 } },
    );
    await acct.consume("alice", 40);
    const bigger = await acct.createPlan("user", { monthlyAllowance: 100, maxPerRequest: 100 });
    await acct.setUserPlan("alice", bigger);

    const reply = await acct.consume("alice", 70);

    expect(reply.body.rejection).toMatchObject({ rule: "monthly_allowance", level: "user", used: 40 });
    expect((await acct.consume("alice", 60)).body.user.monthly).toEqual({
      limit: 100,
      used: 100,
      remaining: 0,
    });
  });
});

describe("POST /consume retries", () => {
  it("replays the original decision for the same requestId without counting twice", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 100, maxPerRequest: 100 },
      { alice: { monthlyAllowance: 100, maxPerRequest: 100 } },
    );
    const first = await acct.consume("alice", 10, "retry-me");
    const second = await acct.consume("alice", 10, "retry-me");

    expect(second.body).toEqual({ ...first.body, replayed: true });
    expect(await monthlyUsed(acct.id)).toEqual({ account: 10, users: { alice: 10 } });
  });

  it("keeps a rejection rejected even after the plan would now allow it", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 100, maxPerRequest: 100 },
      { alice: { monthlyAllowance: 100, maxPerRequest: 5 } },
    );
    expect((await acct.consume("alice", 10, "rejected-once")).body.accepted).toBe(false);
    const userPlan = (await acct.get("/users/alice")).body.user.plan.id;
    await acct.updatePlan(userPlan, { maxPerRequest: 50 });

    const replay = await acct.consume("alice", 10, "rejected-once");

    expect(replay.body).toMatchObject({ accepted: false, replayed: true });
    expect((await acct.consume("alice", 10, "new-attempt")).body.accepted).toBe(true);
  });

  it("returns 409 when a requestId is reused with different units or user", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 100, maxPerRequest: 100 },
      {
        alice: { monthlyAllowance: 100, maxPerRequest: 100 },
        bob: { monthlyAllowance: 100, maxPerRequest: 100 },
      },
    );
    await acct.consume("alice", 10, "dup");

    expect((await acct.consume("alice", 11, "dup")).status).toBe(409);
    expect((await acct.consume("bob", 10, "dup")).status).toBe(409);
    expect(await monthlyUsed(acct.id)).toEqual({ account: 10, users: { alice: 10 } });
  });
});

describe("POST /consume validation", () => {
  it.each([
    ["zero units", { userId: "alice", units: 0, requestId: "x" }],
    ["negative units", { userId: "alice", units: -5, requestId: "x" }],
    ["fractional units", { userId: "alice", units: 1.5, requestId: "x" }],
    ["units as a string", { userId: "alice", units: "5", requestId: "x" }],
    ["missing requestId", { userId: "alice", units: 1 }],
    ["blank requestId", { userId: "alice", units: 1, requestId: "  " }],
    ["missing userId", { units: 1, requestId: "x" }],
  ])("returns 400 for %s", async (_name, body) => {
    const limits = { monthlyAllowance: 100, maxPerRequest: 100 };
    const acct = await setupAccount(limits, { alice: limits });
    expect((await acct.send("POST", "/consume", body)).status).toBe(400);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const acct = await setupAccount({ monthlyAllowance: 100, maxPerRequest: 100 });
    const response = await fetch(url("/consume"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": acct.key },
      body: "{ not json",
    });
    expect(response.status).toBe(400);
  });
});

describe("POST /consume under concurrency", () => {
  it("never accepts more than the shared allowance", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 30, maxPerRequest: 100 },
      {
        alice: { monthlyAllowance: 1_000, maxPerRequest: 100 },
        bob: { monthlyAllowance: 1_000, maxPerRequest: 100 },
        carol: { monthlyAllowance: 1_000, maxPerRequest: 100 },
      },
    );
    const users = ["alice", "bob", "carol"];

    const replies = await Promise.all(
      Array.from({ length: 90 }, (_, i) => acct.consume(users[i % 3]!, 1)),
    );

    expect(replies.every((r) => r.status === 200)).toBe(true);
    expect(replies.filter((r) => r.body.accepted)).toHaveLength(30);
    const usage = await monthlyUsed(acct.id);
    expect(usage.account).toBe(30);
    expect(Object.values(usage.users).reduce((a, b) => a + b, 0)).toBe(30);
  });

  it("counts concurrent retries of one requestId once", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 1_000, maxPerRequest: 100 },
      { alice: { monthlyAllowance: 1_000, maxPerRequest: 100 } },
    );

    const replies = await Promise.all(
      Array.from({ length: 20 }, () => acct.consume("alice", 7, "burst")),
    );

    expect(replies.every((r) => r.status === 200 && r.body.accepted)).toBe(true);
    expect(replies.filter((r) => !r.body.replayed)).toHaveLength(1);
    expect(await monthlyUsed(acct.id)).toEqual({ account: 7, users: { alice: 7 } });
  });

  it("keeps the user limit exact when one user sends many requests at once", async () => {
    const acct = await setupAccount(
      { monthlyAllowance: 1_000, maxPerRequest: 100 },
      { alice: { monthlyAllowance: 25, maxPerRequest: 5 } },
    );

    const replies = await Promise.all(Array.from({ length: 40 }, () => acct.consume("alice", 5)));

    expect(replies.filter((r) => r.body.accepted)).toHaveLength(5);
    expect(await monthlyUsed(acct.id)).toEqual({ account: 25, users: { alice: 25 } });
  });
});
