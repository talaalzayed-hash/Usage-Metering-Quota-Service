// Turns a metering decision into words for the end user. The rejection's
// `level` decides whether it is about the user's own plan or the team's.

import type { Decision, Level, Rule } from "./types.ts";

const whose = (level: Level) => (level === "user" ? "your plan" : "your team's plan");

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export function explain(decision: Decision): { title: string; detail: string } {
  const { rejection, user, account, units } = decision;

  if (!rejection) {
    return {
      title: `Processed ${units} pages`,
      detail: `You have ${user.monthly.remaining} pages left this month · your team has ${account.monthly.remaining}.`,
    };
  }

  const { rule, level, limit, used, requested, resetsAt } = rejection;
  const resets = resetsAt ? ` It resets on ${shortDate(resetsAt)}.` : "";
  const left = used === null ? 0 : Math.max(0, limit - used);
  const owner = level === "user" ? "your" : "your team's";

  // "used up" only when nothing is left; otherwise the document is too big
  // for what remains.
  const allowanceTitle = (period: "monthly" | "daily") =>
    left === 0
      ? `Rejected: ${owner} ${period} allowance is used up`
      : `Rejected: not enough pages left in ${owner} ${period} allowance`;

  switch (rule) {
    case "max_per_request":
      return {
        title: `Rejected: ${whose(level)} allows at most ${limit} pages per request`,
        detail: `This document has ${requested} pages. Try a smaller one, or ask your admin for a bigger plan.`,
      };
    case "monthly_allowance":
      return {
        title: allowanceTitle("monthly"),
        detail: `${left} of ${limit} pages left this month; this document needs ${requested}.${resets}`,
      };
    case "daily_allowance":
      return {
        title: allowanceTitle("daily"),
        detail: `${left} of ${limit} pages left today; this document needs ${requested}.${resets}`,
      };
  }
}

// Short label for the history table.
export function reasonLabel(rule: Rule, level: Level): string {
  const who = level === "user" ? "Your" : "Team";
  const what = {
    max_per_request: "per-request limit",
    monthly_allowance: "monthly allowance",
    daily_allowance: "daily allowance",
  }[rule];
  return `${who} ${what}`;
}
