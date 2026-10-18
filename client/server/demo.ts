// Creates the Docs Co demo account the first time the backend starts.
//
// The account gets a small custom team plan so the shared limit is easy to
// reach, and three users: Alice and Carol share the predefined Basic plan
// (separate totals), Bob is on Premium.

import { metering } from "./metering.js";

export const TEAM_PLAN = { monthlyAllowance: 100, maxPerRequest: 50 };
export const DEMO_USERS = [
  { externalId: "alice", plan: "Basic" },
  { externalId: "bob", plan: "Premium" },
  { externalId: "carol", plan: "Basic" },
];

interface Plan {
  id: string;
  scope: "account" | "user";
  name: string;
}

// The service may still be starting (for example under Docker Compose).
async function waitForService(): Promise<Plan[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await metering<{ plans: Plan[] }>("GET", "/plans/predefined")).plans;
    } catch (error) {
      if (attempt >= 30) throw error;
      console.log("Waiting for the metering service...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function setupDemoAccount(): Promise<string> {
  if (process.env.DEMO_API_KEY) {
    console.log("Using the account from DEMO_API_KEY");
    return process.env.DEMO_API_KEY;
  }

  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    throw new Error("Set ADMIN_API_KEY (to create a demo account) or DEMO_API_KEY");
  }

  const plans = await waitForService();
  const planId = (scope: Plan["scope"], name: string) => {
    const plan = plans.find((p) => p.scope === scope && p.name === name);
    if (!plan) throw new Error(`Predefined ${scope} plan ${name} not found`);
    return plan.id;
  };

  const { apiKey } = await metering<{ apiKey: string }>("POST", "/admin/accounts", {
    adminKey,
    body: { name: "Docs Co", planId: planId("account", "Starter") },
  });

  const team = await metering<{ plan: Plan }>("POST", "/plans", {
    apiKey,
    body: { scope: "account", name: "Docs Co Team", ...TEAM_PLAN },
  });
  await metering("PUT", "/account/plan", { apiKey, body: { planId: team.plan.id } });

  for (const user of DEMO_USERS) {
    await metering("POST", "/users", {
      apiKey,
      body: { externalId: user.externalId, planId: planId("user", user.plan) },
    });
  }

  console.log("Created the Docs Co demo account");
  return apiKey;
}
