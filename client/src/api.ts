// Calls to the Docs Co backend. The page never talks to the metering
// service directly and never holds the API key.

import type {
  Account,
  AdminUser,
  Decision,
  DemoUser,
  HistoryEntry,
  HistoryFilters,
  HistoryPage,
  Limits,
  Plan,
  PlanInput,
  UsageReport,
} from "./types.ts";

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message ?? `Request failed (${response.status})`);
  }
  return data as T;
}

const user = (id: string) => `/api/users/${encodeURIComponent(id)}`;

function queryString(values: Record<string, string | number>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

// What an end user does.
export const api = {
  users: () => request<{ users: DemoUser[] }>("/api/users").then((r) => r.users),
  limits: (id: string) => request<Limits>(`${user(id)}/limits`),
  history: (id: string) =>
    request<{ requests: HistoryEntry[] }>(`${user(id)}/requests`).then((r) => r.requests),
  process: (id: string, pages: number) =>
    request<{ decision: Decision }>(`${user(id)}/documents`, "POST", { pages }).then(
      (r) => r.decision,
    ),
};

// What Docs Co's admin does.
export const adminApi = {
  account: () => request<{ account: Account }>("/api/admin/account").then((r) => r.account),
  setAccountPlan: (planId: number) => request("/api/admin/account/plan", "PUT", { planId }),
  users: () => request<{ users: AdminUser[] }>("/api/admin/users").then((r) => r.users),
  setUserPlan: (userId: string, planId: number) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/plan`, "PUT", { planId }),
  plans: () => request<{ plans: Plan[] }>("/api/admin/plans").then((r) => r.plans),
  createPlan: (scope: Plan["scope"], input: PlanInput) =>
    request<{ plan: Plan }>("/api/admin/plans", "POST", { scope, ...input }),
  updatePlan: (planId: number, input: PlanInput) =>
    request<{ plan: Plan }>(`/api/admin/plans/${planId}`, "PATCH", input),
  usage: (month: string) => request<UsageReport>(`/api/admin/usage${queryString({ month })}`),
  requests: (filters: HistoryFilters, offset: number, limit = 10) =>
    request<HistoryPage>(`/api/admin/requests${queryString({ ...filters, offset, limit })}`),
  reset: () => request("/api/admin/reset", "POST"),
};
