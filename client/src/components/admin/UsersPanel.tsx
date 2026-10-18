import type { AdminUser, Plan, UsageReport } from "../../types.ts";
import { PlanSelect } from "./PlanSelect.tsx";

const fmt = (value: number | null) => (value === null ? "—" : value);

// Each user's plan (changeable) and their usage in the selected month.
export function UsersPanel({
  users,
  plans,
  usage,
  month,
  busy,
  onMonthChange,
  onChangePlan,
}: {
  users: AdminUser[];
  plans: Plan[];
  usage: UsageReport | null;
  month: string;
  busy: boolean;
  onMonthChange: (month: string) => void;
  onChangePlan: (userId: string, planId: number) => void;
}) {
  const userPlans = plans.filter((p) => p.scope === "user");
  const usageOf = (id: string) => usage?.users.find((u) => u.externalId === id);
  const past = usage !== null && !usage.account.isCurrentMonth;

  return (
    <section className="card">
      <header className="card-header">
        <h2>Users and usage</h2>
        <label className="inline">
          Month
          <input type="month" value={month} onChange={(e) => onMonthChange(e.target.value)} />
          {month && (
            <button type="button" className="link" onClick={() => onMonthChange("")}>
              This month
            </button>
          )}
        </label>
      </header>
      {past && (
        <p className="muted">
          Past month: limits are not shown because plans may have changed since then.
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Plan (now)</th>
              <th className="num">Used</th>
              <th className="num">Limit</th>
              <th className="num">Left</th>
              <th className="num">Accepted / rejected</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const u = usageOf(user.externalId);
              return (
                <tr key={user.externalId}>
                  <td>{user.externalId}</td>
                  <td>
                    <PlanSelect
                      label={`Plan for ${user.externalId}`}
                      plans={userPlans}
                      value={user.planId}
                      disabled={busy}
                      onChange={(planId) => onChangePlan(user.externalId, planId)}
                    />
                  </td>
                  <td className="num">{fmt(u?.used ?? null)}</td>
                  <td className="num">{fmt(u?.limit ?? null)}</td>
                  <td className="num">{fmt(u?.remaining ?? null)}</td>
                  <td className="num">
                    {u ? `${u.requests.accepted} / ${u.requests.rejected}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {usage && (
            <tfoot>
              <tr>
                <td>Team total</td>
                <td />
                <td className="num">{usage.account.used}</td>
                <td className="num">{fmt(usage.account.limit)}</td>
                <td className="num">{fmt(usage.account.remaining)}</td>
                <td className="num">
                  {usage.account.requests.accepted} / {usage.account.requests.rejected}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
