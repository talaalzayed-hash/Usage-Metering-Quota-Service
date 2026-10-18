import { explain } from "../explain.ts";
import type { Decision } from "../types.ts";

export function DecisionCard({ decision }: { decision: Decision }) {
  const { title, detail } = explain(decision);
  const { rejection } = decision;

  return (
    <section className={`card decision ${decision.accepted ? "accepted" : "rejected"}`} aria-live="polite">
      <div className="decision-icon" aria-hidden>
        {decision.accepted ? "✓" : "✕"}
      </div>
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
        {rejection && (
          <p className="muted small">
            Rule: <code>{rejection.rule}</code> on the <code>{rejection.level}</code> plan
          </p>
        )}
      </div>
    </section>
  );
}
