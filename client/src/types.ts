// Shapes returned by the metering service (passed through by our backend).

export type Level = "account" | "user";
export type Rule = "max_per_request" | "monthly_allowance" | "daily_allowance";

export interface Plan {
  id: number;
  scope: Level;
  name: string;
  isPredefined: boolean;
  version: number;
  monthlyAllowance: number;
  maxPerRequest: number;
  dailyAllowance: number | null;
}

export interface PlanInput {
  name: string;
  monthlyAllowance: number;
  maxPerRequest: number;
  dailyAllowance: number | null;
}

export interface MonthUsage {
  month: string; // YYYY-MM
  isCurrentMonth: boolean;
  used: number;
  limit: number | null; // null for past months
  remaining: number | null;
  requests: { accepted: number; rejected: number };
}

export interface UsageReport {
  account: MonthUsage;
  users: (MonthUsage & { externalId: string })[];
}

export interface Account {
  id: number;
  name: string;
  plan: Plan;
}

export interface AdminUser {
  externalId: string;
  planId: number;
  planName: string;
}

export interface HistoryPage {
  requests: (HistoryEntry & { userId: string })[];
  hasMore: boolean;
  limit: number;
  offset: number;
}

export interface HistoryFilters {
  userId: string;
  outcome: "" | "accepted" | "rejected";
  month: string;
}

export interface Allowance {
  limit: number;
  used: number;
  remaining: number;
}

export interface LevelLimits {
  plan: Plan;
  monthly: Allowance;
  daily: Allowance | null;
}

export interface Limits {
  externalId: string;
  account: LevelLimits;
  user: LevelLimits;
  effective: { maxPerRequest: number; maxUnitsNow: number };
}

export interface Rejection {
  rule: Rule;
  level: Level;
  limit: number;
  used: number | null;
  requested: number;
  resetsAt: string | null;
}

export interface Decision {
  requestId: string;
  accepted: boolean;
  replayed: boolean;
  units: number;
  decidedAt: string;
  rejection: Rejection | null;
  account: LevelLimits;
  user: LevelLimits & { externalId: string };
}

export interface HistoryEntry {
  requestId: string;
  units: number;
  accepted: boolean;
  rejection: { rule: Rule; level: Level } | null;
  decidedAt: string;
}

export interface DemoUser {
  externalId: string;
  planName: string;
}
