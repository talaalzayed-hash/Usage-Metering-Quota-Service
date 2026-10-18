import type { Plan } from "../../types.ts";

// Plans of one scope, predefined first, as a dropdown that saves on change.
export function PlanSelect({
  plans,
  value,
  disabled,
  onChange,
  label,
}: {
  plans: Plan[];
  value: number;
  disabled?: boolean;
  onChange: (planId: number) => void;
  label: string;
}) {
  const sorted = [...plans].sort(
    (a, b) => Number(b.isPredefined) - Number(a.isPredefined) || a.name.localeCompare(b.name),
  );
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {sorted.map((plan) => (
        <option key={plan.id} value={plan.id}>
          {plan.name}
          {plan.isPredefined ? "" : " (custom)"} · {plan.monthlyAllowance}/mo · {plan.maxPerRequest}/req
          {plan.dailyAllowance === null ? "" : ` · ${plan.dailyAllowance}/day`}
        </option>
      ))}
    </select>
  );
}
