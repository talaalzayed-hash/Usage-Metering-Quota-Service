import { useState } from "react";
import type { Level, Plan, PlanInput } from "../../types.ts";
import { PlanForm } from "./PlanForm.tsx";

const NEW_PLAN: PlanInput = { name: "", monthlyAllowance: 1000, maxPerRequest: 50, dailyAllowance: null };

// Predefined plans are read-only; custom plans can be edited in place, and the
// change applies to the very next request of everyone on that plan.
export function PlansPanel({
  plans,
  usersOnPlan,
  busy,
  onCreate,
  onUpdate,
}: {
  plans: Plan[];
  usersOnPlan: (planId: number) => string[];
  busy: boolean;
  onCreate: (scope: Level, input: PlanInput) => Promise<boolean>;
  onUpdate: (planId: number, input: PlanInput) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [creating, setCreating] = useState<Level | null>(null);

  const section = (scope: Level, title: string) => (
    <div className="plan-group">
      <div className="plan-group-header">
        <h3>{title}</h3>
        {creating !== scope && (
          <button type="button" className="link" onClick={() => setCreating(scope)}>
            + New {scope} plan
          </button>
        )}
      </div>

      {creating === scope && (
        <div className="plan-row editing">
          <PlanForm
            initial={NEW_PLAN}
            submitLabel="Create"
            busy={busy}
            onCancel={() => setCreating(null)}
            onSubmit={async (input) => {
              if (await onCreate(scope, input)) setCreating(null);
            }}
          />
        </div>
      )}

      {plans
        .filter((p) => p.scope === scope)
        .map((plan) =>
          editing === plan.id ? (
            <div className="plan-row editing" key={plan.id}>
              <PlanForm
                initial={plan}
                submitLabel="Save"
                busy={busy}
                onCancel={() => setEditing(null)}
                onSubmit={async (input) => {
                  if (await onUpdate(plan.id, input)) setEditing(null);
                }}
              />
            </div>
          ) : (
            <div className="plan-row" key={plan.id}>
              <div>
                <strong>{plan.name}</strong>{" "}
                <span className={`plan-tag ${plan.isPredefined ? "" : "custom"}`}>
                  {plan.isPredefined ? "predefined" : `custom · v${plan.version}`}
                </span>
                <div className="muted small">
                  {plan.monthlyAllowance}/month · {plan.maxPerRequest}/request
                  {plan.dailyAllowance === null ? "" : ` · ${plan.dailyAllowance}/day`}
                  {usersOnPlan(plan.id).length > 0 && ` · used by ${usersOnPlan(plan.id).join(", ")}`}
                </div>
              </div>
              {plan.isPredefined ? (
                <span className="muted small">read-only</span>
              ) : (
                <button type="button" className="link" onClick={() => setEditing(plan.id)}>
                  Edit
                </button>
              )}
            </div>
          ),
        )}
    </div>
  );

  return (
    <section className="card">
      <header className="card-header">
        <h2>Plans</h2>
      </header>
      {section("account", "Team plans")}
      {section("user", "User plans")}
    </section>
  );
}
