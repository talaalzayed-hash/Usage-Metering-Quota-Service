import { describe, expect, it } from "vitest";
import {
  adminHeaders,
  call,
  monthlyUsed,
  predefinedPlanId,
  setupAccount,
  useTestServer,
} from "../helpers.js";

useTestServer();

// Every route that acts on an account's data must require its API key.
const PROTECTED: [string, string, unknown?][] = [
  ["GET", "/account"],
  ["PUT", "/account/plan", { planId: 1 }],
  ["GET", "/plans"],
  ["POST", "/plans", { scope: "user", name: "x", monthlyAllowance: 1, maxPerRequest: 1 }],
  ["GET", "/plans/1"],
  ["PATCH", "/plans/1", { monthlyAllowance: 1 }],
  ["GET", "/users"],
  ["POST", "/users", { externalId: "alice", planId: 1 }],
  ["GET", "/users/alice"],
  ["PUT", "/users/alice/plan", { planId: 1 }],
  ["GET", "/users/alice/limits"],
  ["GET", "/users/alice/usage"],
  ["POST", "/consume", { userId: "alice", units: 1, requestId: "x" }],
  ["GET", "/usage"],
  ["GET", "/usage/users"],
  ["GET", "/requests"],
  ["GET", "/requests/x"],
];

describe("API key validation", () => {
  it.each(PROTECTED)("%s %s rejects a missing or invalid key", async (method, path, body) => {
    const missing = await call(method, path, body);
    const invalid = await call(method, path, body, { "x-api-key": "not-a-real-key" });

    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe("Missing API key");
    expect(invalid.status).toBe(401);
    expect(invalid.body.message).toBe("Invalid API key");
  });

  it("issues a working key when an account is created", async () => {
    const created = await call(
      "POST",
      "/admin/accounts",
      { name: "Key Test", planId: await predefinedPlanId("account") },
      adminHeaders(),
    );

    expect(created.status).toBe(201);
    expect(created.body.apiKey).toMatch(/^[0-9a-f]{64}$/);
    const me = await call("GET", "/account", undefined, { "x-api-key": created.body.apiKey });
    expect(me.body.account.name).toBe("Key Test");
  });

  it("requires the admin key to create accounts", async () => {
    const body = { name: "Nope", planId: await predefinedPlanId("account") };
    expect((await call("POST", "/admin/accounts", body)).status).toBe(401);
    expect((await call("POST", "/admin/accounts", body, { "x-admin-key": "wrong" })).status).toBe(401);
  });
});

describe("account isolation", () => {
  async function twoAccounts() {
    const limits = { monthlyAllowance: 100, maxPerRequest: 100 };
    const a = await setupAccount(limits, { alice: limits, shared: limits });
    const b = await setupAccount(limits, { bob: limits, shared: limits });
    return { a, b };
  }

  it("does not expose another account's users", async () => {
    const { b } = await twoAccounts();

    expect((await b.get("/users/alice")).status).toBe(404);
    expect((await b.get("/users/alice/usage")).status).toBe(404);
    expect((await b.get("/users/alice/limits")).status).toBe(404);
    const listed = (await b.get("/users")).body.users.map((u: any) => u.externalId);
    expect(listed.sort()).toEqual(["bob", "shared"]);
  });

  it("cannot consume for another account's user", async () => {
    const { a, b } = await twoAccounts();

    expect((await b.consume("alice", 1)).status).toBe(404);
    expect(await monthlyUsed(a.id)).toEqual({ account: 0, users: {} });
  });

  it("keeps usage separate for the same externalId in two accounts", async () => {
    const { a, b } = await twoAccounts();
    await a.consume("shared", 30);
    await b.consume("shared", 5);

    expect((await a.get("/users/shared/usage")).body.user.used).toBe(30);
    expect((await b.get("/users/shared/usage")).body.user.used).toBe(5);
    expect((await a.get("/usage")).body.account.used).toBe(30);
    expect((await b.get("/usage")).body.account.used).toBe(5);
  });

  it("does not let an account see, change or assign another account's plans", async () => {
    const { a, b } = await twoAccounts();
    const aUserPlan = await a.createPlan("user", { monthlyAllowance: 9, maxPerRequest: 9 });

    expect((await b.get(`/plans/${aUserPlan}`)).status).toBe(404);
    expect((await b.send("PATCH", `/plans/${aUserPlan}`, { monthlyAllowance: 1 })).status).toBe(404);
    expect((await b.send("PUT", "/users/bob/plan", { planId: aUserPlan })).status).toBe(400);
    expect((await b.send("PUT", "/account/plan", { planId: a.accountPlanId })).status).toBe(400);
    const listed = (await b.get("/plans")).body.plans.map((p: any) => Number(p.id));
    expect(listed).not.toContain(aUserPlan);
  });

  it("keeps request history and requestIds separate", async () => {
    const { a, b } = await twoAccounts();
    await a.consume("alice", 1, "same-id");

    expect((await b.get("/requests/same-id")).status).toBe(404);
    expect((await b.get("/requests")).body.requests).toEqual([]);
    // The same requestId in another account is a new request, not a replay.
    expect((await b.consume("bob", 1, "same-id")).body.replayed).toBe(false);
  });
});
