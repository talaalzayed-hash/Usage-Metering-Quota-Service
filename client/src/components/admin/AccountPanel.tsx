import type { Account, MonthUsage, Plan } from "../../types.ts";
import { AllowanceBar } from "../AllowanceBar.tsx";
import { PlanSelect } from "./PlanSelect.tsx";

// The account's shared plan and this month's shared usage.
export function AccountPanel({
  account,
  usage,
  plans,
  busy,
  onChangePlan,
  onReset,
}: {
  account: Account;
  usage: MonthUsage | null;
  plans: Plan[];
  busy: boolean;
  onChangePlan: (planId: number) => void;
  onReset: () => void;
}) {
  return (
    <section className="card">
      <header className="card-header">
        <h2>{account.name} · team plan</h2>
        <button type="button" className="link" onClick={onReset} disabled={busy}>
          Reset demo
        </button>
      </header>
      <p className="muted">Shared by every user: each accepted document counts here and on the user's plan.</p>
      <div className="row">
        <PlanSelect
          label="Account plan"
          plans={plans.filter((p) => p.scope === "account")}
          value={account.plan.id}
          disabled={busy}
          onChange={onChangePlan}
        />
      </div>
      {usage && usage.limit !== null && usage.remaining !== null && (
        <AllowanceBar
          label="This month"
          allowance={{ limit: usage.limit, used: usage.used, remaining: usage.remaining }}
        />
      )}
    </section>
  );
}
