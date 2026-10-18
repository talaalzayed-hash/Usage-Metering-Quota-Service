import { describe, expect, it } from "vitest";
import { evaluate, remaining, type Subject } from "../../src/Rules/evaluate.js";

// The brief's example: account 10,000/month and 100/request, user 1,000/month and 20/request.
function subject(
  monthlyAllowance: number,
  maxPerRequest: number,
  used = 0,
  dailyAllowance: number | null = null,
  usedToday = used,
): Subject {
  return {
    plan: { monthlyAllowance, maxPerRequest, dailyAllowance },
    usage: { monthly: used, daily: usedToday },
  };
}

describe("evaluate", () => {
  it("accepts when both plans allow the request", () => {
    expect(evaluate(subject(10_000, 100), subject(1_000, 20), 10)).toEqual([]);
  });

  it("rejects 25 units on the user's per-request limit even with allowance left", () => {
    expect(evaluate(subject(10_000, 100), subject(1_000, 20), 25)).toEqual([
      { rule: "max_per_request", level: "user", limit: 20, used: null, requested: 25 },
    ]);
  });

  it("rejects on the account allowance when only 5 units are left", () => {
    expect(evaluate(subject(10_000, 100, 9_995), subject(1_000, 20), 10)).toEqual([
      { rule: "monthly_allowance", level: "account", limit: 10_000, used: 9_995, requested: 10 },
    ]);
  });

  it("accepts a request that uses the allowance exactly", () => {
    expect(evaluate(subject(100, 100, 90), subject(100, 100, 90), 10)).toEqual([]);
  });

  it("rejects when the allowance was reduced below current usage", () => {
    const violations = evaluate(subject(100, 100), subject(50, 100, 80), 1);
    expect(violations.map((v) => [v.level, v.rule])).toEqual([["user", "monthly_allowance"]]);
  });

  it("applies the daily rule only when the plan has one", () => {
    expect(evaluate(subject(100, 100), subject(1_000, 100, 0, null), 50)).toEqual([]);
    expect(evaluate(subject(1_000, 100), subject(1_000, 100, 200, 100, 60), 50)).toEqual([
      { rule: "daily_allowance", level: "user", limit: 100, used: 60, requested: 50 },
    ]);
  });

  it("lists every violation, most blocking first and account before user", () => {
    const violations = evaluate(subject(10, 5, 10, 10, 10), subject(10, 5, 10, 10, 10), 6);
    expect(violations.map((v) => `${v.rule}:${v.level}`)).toEqual([
      "max_per_request:account",
      "max_per_request:user",
      "monthly_allowance:account",
      "monthly_allowance:user",
      "daily_allowance:account",
      "daily_allowance:user",
    ]);
  });
});

describe("remaining", () => {
  it("never goes below zero", () => {
    expect(remaining(100, 30)).toBe(70);
    expect(remaining(20, 30)).toBe(0);
  });
});
