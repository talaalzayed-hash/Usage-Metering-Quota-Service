import type { LevelLimits } from "../types.ts";
import { AllowanceBar } from "./AllowanceBar.tsx";

// One level (you, or your team): plan name, per-request limit and allowances.
export function PlanCard({ title, limits }: { title: string; limits: LevelLimits }) {
  const { plan, monthly, daily } = limits;
  return (
    <section className="card">
      <header className="card-header">
        <h2>{title}</h2>
        <span className="plan-tag">
          {plan.name}
          {plan.isPredefined ? "" : " · custom"}
        </span>
      </header>
      <p className="muted">Up to {plan.maxPerRequest} pages per document</p>
      <AllowanceBar label="This month" allowance={monthly} />
      {daily && <AllowanceBar label="Today" allowance={daily} />}
    </section>
  );
}
