import { useCallback, useEffect, useState } from "react";
import { adminApi } from "./api.ts";
import type { Account, AdminUser, Level, Plan, PlanInput, UsageReport } from "./types.ts";
import { AccountPanel } from "./components/admin/AccountPanel.tsx";
import { UsersPanel } from "./components/admin/UsersPanel.tsx";
import { PlansPanel } from "./components/admin/PlansPanel.tsx";
import { HistoryPanel } from "./components/admin/HistoryPanel.tsx";

// What Docs Co's admin sees: the team plan, users and their plans, custom
// plans, usage by month and request history. Nothing here changes how the
// user view works; changes only show up in the decisions it gets back.
export function AdminView() {
  const [account, setAccount] = useState<Account | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<UsageReport | null>(null);
  const [month, setMonth] = useState(""); // "" = current month
  const [selected, setSelected] = useState<UsageReport | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextAccount, nextUsers, nextPlans, nextCurrent] = await Promise.all([
      adminApi.account(),
      adminApi.users(),
      adminApi.plans(),
      adminApi.usage(""),
    ]);
    setAccount(nextAccount);
    setUsers(nextUsers);
    setPlans(nextPlans);
    setCurrent(nextCurrent);
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  // The users table shows the picked month; the current month is already loaded.
  useEffect(() => {
    if (!month) {
      setSelected(null);
      return;
    }
    adminApi
      .usage(month)
      .then(setSelected)
      .catch((e: Error) => setError(e.message));
  }, [month, version]);

  // Runs a change, reloads everything and reports the outcome.
  const run = async (action: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const planName = (id: number) => plans.find((p) => p.id === id)?.name ?? `plan ${id}`;
  const usersOnPlan = (planId: number) => [
    ...(account?.plan.id === planId ? ["the team"] : []),
    ...users.filter((u) => u.planId === planId).map((u) => u.externalId),
  ];

  if (!account) {
    return <main>{error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>}</main>;
  }

  return (
    <main>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <AccountPanel
        account={account}
        usage={current?.account ?? null}
        plans={plans}
        busy={busy}
        onChangePlan={(planId) =>
          run(() => adminApi.setAccountPlan(planId), `Team moved to ${planName(planId)}.`)
        }
        onReset={() => run(() => adminApi.reset(), "Started a fresh demo account.")}
      />

      <UsersPanel
        users={users}
        plans={plans}
        usage={month ? selected : current}
        month={month}
        busy={busy}
        onMonthChange={setMonth}
        onChangePlan={(userId, planId) =>
          run(() => adminApi.setUserPlan(userId, planId), `${userId} moved to ${planName(planId)}.`)
        }
      />

      <PlansPanel
        plans={plans}
        usersOnPlan={usersOnPlan}
        busy={busy}
        onCreate={(scope: Level, input: PlanInput) =>
          run(() => adminApi.createPlan(scope, input), `Created plan ${input.name}.`)
        }
        onUpdate={(planId, input) =>
          run(
            () => adminApi.updatePlan(planId, input),
            `Saved ${input.name}. It applies to the next request.`,
          )
        }
      />

      <HistoryPanel users={users} version={version} />
    </main>
  );
}
