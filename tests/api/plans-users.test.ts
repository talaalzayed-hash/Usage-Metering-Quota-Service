import { describe, expect, it } from "vitest";
import { call, predefinedPlanId, setupAccount, useTestServer } from "../helpers.js";

useTestServer();

describe("predefined plans", () => {
  it("offers account and user plans without an API key", async () => {
    const reply = await call("GET", "/plans/predefined");

    expect(reply.status).toBe(200);
    const names = reply.body.plans.map((p: any) => `${p.scope}:${p.name}`);
    expect(names).toEqual(
      expect.arrayContaining(["account:Starter", "account:Pro", "user:Basic", "user:Premium"]),
    );
  });

  it("are read-only", async () => {
    const acct = await setupAccount({ monthlyAllowance: 100, maxPerRequest: 10 });
    const basic = await predefinedPlanId("user");

    const reply = await acct.send("PATCH", `/plans/${basic}`, { monthlyAllowance: 1 });

    expect(reply.status).toBe(403);
  });
});

describe("custom plans", () => {
  it("can be created, viewed and updated, bumping the version", async () => {
    const acct = await setupAccount({ monthlyAllowance: 100, maxPerRequest: 10 });
    const planId = await acct.createPlan("user", { monthlyAllowance: 50, maxPerRequest: 5 });

    const before = (await acct.get(`/plans/${planId}`)).body.plan;
    await acct.updatePlan(planId, { monthlyAllowance: 80, dailyAllowance: 20 });
    const after = (await acct.get(`/plans/${planId}`)).body.plan;

    expect(after).toMatchObject({ monthly_allowance: "80", daily_allowance: "20", max_per_request: "5" });
    expect(after.version).toBe(before.version + 1);
    const listed = (await acct.get("/plans")).body.plans.map((p: any) => Number(p.id));
    expect(listed).toContain(planId);
  });

  it("reject invalid limits", async () => {
    const acct = await setupAccount({ monthlyAllowance: 100, maxPerRequest: 10 });
    const bad = [
      { scope: "team", name: "x", monthlyAllowance: 1, maxPerRequest: 1 },
      { scope: "user", name: "", monthlyAllowance: 1, maxPerRequest: 1 },
      { scope: "user", name: "x", monthlyAllowance: -1, maxPerRequest: 1 },
      { scope: "user", name: "x", monthlyAllowance: 1, maxPerRequest: 0 },
    ];
    for (const body of bad) {
      expect((await acct.send("POST", "/plans", body)).status).toBe(400);
    }
  });

  it("must match the scope they are assigned to", async () => {
    const acct = await setupAccount({ monthlyAllowance: 100, maxPerRequest: 10 }, {
      alice: { monthlyAllowance: 10, maxPerRequest: 1 },
    });
    const userPlan = await acct.createPlan("user", { monthlyAllowance: 10, maxPerRequest: 1 });

    expect((await acct.send("PUT", "/account/plan", { planId: userPlan })).status).toBe(400);
    expect((await acct.send("PUT", "/users/alice/plan", { planId: acct.accountPlanId })).status).toBe(400);
  });
});

describe("users", () => {
  it("are registered, listed and moved between plans", async () => {
    const acct = await setupAccount({ monthlyAllowance: 100, maxPerRequest: 10 }, {
      alice: { monthlyAllowance: 10, maxPerRequest: 1 },
      bob: { monthlyAllowance: 10, maxPerRequest: 1 },
    });
    const premium = await acct.createPlan("user", { monthlyAllowance: 99, maxPerRequest: 9 });

    await acct.setUserPlan("bob", premium);

    expect((await acct.get("/users/bob")).body.user.plan).toMatchObject({ id: premium, monthlyAllowance: 99 });
    const page = (await acct.get("/users?limit=1&offset=1")).body;
    expect(page.users.map((u: any) => u.externalId)).toEqual(["bob"]);
  });

  it("reject a duplicate externalId and unknown plans", async () => {
    const acct = await setupAccount({ monthlyAllowance: 100, maxPerRequest: 10 }, {
      alice: { monthlyAllowance: 10, maxPerRequest: 1 },
    });
    const plan = await predefinedPlanId("user");

    expect((await acct.send("POST", "/users", { externalId: "alice", planId: plan })).status).toBe(409);
    expect((await acct.send("POST", "/users", { externalId: "carol", planId: 999999999 })).status).toBe(400);
    expect((await acct.send("PUT", "/users/nobody/plan", { planId: plan })).status).toBe(404);
  });
});
