import { useState, type FormEvent } from "react";
import type { PlanInput } from "../../types.ts";

const asInt = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : null);

// Name and limits of a plan. An empty daily field means "no daily rule".
export function PlanForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: PlanInput;
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: PlanInput) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [monthly, setMonthly] = useState(String(initial.monthlyAllowance));
  const [perRequest, setPerRequest] = useState(String(initial.maxPerRequest));
  const [daily, setDaily] = useState(initial.dailyAllowance === null ? "" : String(initial.dailyAllowance));

  const monthlyValue = asInt(monthly);
  const perRequestValue = asInt(perRequest);
  const dailyValue = daily.trim() === "" ? null : asInt(daily);
  const valid =
    name.trim() !== "" &&
    monthlyValue !== null &&
    perRequestValue !== null &&
    perRequestValue > 0 &&
    (daily.trim() === "" || dailyValue !== null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      monthlyAllowance: monthlyValue!,
      maxPerRequest: perRequestValue!,
      dailyAllowance: dailyValue,
    });
  };

  return (
    <form className="plan-form" onSubmit={submit}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Per month
        <input inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
      </label>
      <label>
        Per request
        <input inputMode="numeric" value={perRequest} onChange={(e) => setPerRequest(e.target.value)} />
      </label>
      <label>
        Per day
        <input
          inputMode="numeric"
          placeholder="none"
          value={daily}
          onChange={(e) => setDaily(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={!valid || busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="link" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
