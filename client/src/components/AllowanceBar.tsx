import type { Allowance } from "../types.ts";

// used / limit as a bar; turns amber near the limit and red when nothing is left.
export function AllowanceBar({ label, allowance }: { label: string; allowance: Allowance }) {
  const { limit, used, remaining } = allowance;
  const percent = limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  const tone = remaining === 0 ? "empty" : percent >= 80 ? "low" : "ok";

  return (
    <div className="bar">
      <div className="bar-label">
        <span>{label}</span>
        <span className="muted">
          {used} / {limit} used · <strong>{remaining} left</strong>
        </span>
      </div>
      <div className="bar-track" role="progressbar" aria-valuenow={used} aria-valuemax={limit}>
        <div className={`bar-fill ${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
