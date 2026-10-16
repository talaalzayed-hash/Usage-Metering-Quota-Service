// Pure rule evaluation: no database access, so every decision can be unit
// tested from plain numbers.

export type Level = "account" | "user";
export type RuleType = "max_per_request" | "monthly_allowance" | "daily_allowance";

export interface PlanLimits {
  monthlyAllowance: number;
  maxPerRequest: number;
  dailyAllowance: number | null; // null = no daily rule
}

// Units already used in the current UTC month and day, before this request.
export interface Usage {
  monthly: number;
  daily: number;
}

export interface Subject {
  plan: PlanLimits;
  usage: Usage;
}

export interface Violation {
  rule: RuleType;
  level: Level;
  limit: number;
  used: number | null; // null for max_per_request, which does not depend on usage
  requested: number;
}

// Reported order: the rule that blocks longest comes first. A per-request
// limit never passes on retry, a monthly allowance resets next month, a daily
// one tomorrow. For the same rule the account comes before the user, because
// an exhausted account blocks every one of its users.
const RULE_ORDER: RuleType[] = ["max_per_request", "monthly_allowance", "daily_allowance"];
const LEVEL_ORDER: Level[] = ["account", "user"];

function check(rule: RuleType, level: Level, subject: Subject, units: number): Violation | null {
  const { plan, usage } = subject;
  switch (rule) {
    case "max_per_request":
      return units > plan.maxPerRequest
        ? { rule, level, limit: plan.maxPerRequest, used: null, requested: units }
        : null;
    case "monthly_allowance":
      return usage.monthly + units > plan.monthlyAllowance
        ? { rule, level, limit: plan.monthlyAllowance, used: usage.monthly, requested: units }
        : null;
    case "daily_allowance":
      return plan.dailyAllowance !== null && usage.daily + units > plan.dailyAllowance
        ? { rule, level, limit: plan.dailyAllowance, used: usage.daily, requested: units }
        : null;
  }
}

// Every violated rule, most blocking first. An empty list means accepted.
export function evaluate(account: Subject, user: Subject, units: number): Violation[] {
  const subjects: Record<Level, Subject> = { account, user };
  const violations: Violation[] = [];
  for (const rule of RULE_ORDER) {
    for (const level of LEVEL_ORDER) {
      const violation = check(rule, level, subjects[level], units);
      if (violation) violations.push(violation);
    }
  }
  return violations;
}

// Never negative: a plan reduced below current usage shows zero remaining.
export function remaining(limit: number, used: number): number {
  return Math.max(0, limit - used);
}
