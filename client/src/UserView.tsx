import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import type { Decision, DemoUser, HistoryEntry, Limits } from "./types.ts";
import { PlanCard } from "./components/PlanCard.tsx";
import { ProcessForm } from "./components/ProcessForm.tsx";
import { DecisionCard } from "./components/DecisionCard.tsx";
import { RecentRequests } from "./components/RecentRequests.tsx";

const SAVED_USER = "docs-co:user";

function savedUser(): string | null {
  try {
    return localStorage.getItem(SAVED_USER);
  } catch {
    return null;
  }
}

// What an end user of Docs Co sees. The dropdown stands in for logging in;
// every call goes through the Docs Co backend.
export function UserView() {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [userId, setUserId] = useState<string | null>(savedUser);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .users()
      .then((list) => {
        setUsers(list);
        setUserId((current) =>
          current && list.some((u) => u.externalId === current) ? current : list[0]?.externalId ?? null,
        );
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const refresh = useCallback(async (id: string) => {
    const [nextLimits, nextHistory] = await Promise.all([api.limits(id), api.history(id)]);
    setLimits(nextLimits);
    setHistory(nextHistory);
  }, []);

  useEffect(() => {
    if (!userId) return;
    try {
      localStorage.setItem(SAVED_USER, userId);
    } catch {
      // Remembering the user is only a convenience.
    }
    setDecision(null);
    setError(null);
    refresh(userId).catch((e: Error) => setError(e.message));
  }, [userId, refresh]);

  const process = async (pages: number) => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      setDecision(await api.process(userId, pages));
      await refresh(userId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <div className="view-bar">
        <label className="who">
          Signed in as
          <select value={userId ?? ""} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.externalId} value={u.externalId}>
                {u.externalId} ({u.planName})
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="error">{error}</div>}

      {limits && (
        <div className="grid">
          <PlanCard title="You" limits={limits.user} />
          <PlanCard title="Your team" limits={limits.account} />
        </div>
      )}

      <ProcessForm
        maxNow={limits ? limits.effective.maxUnitsNow : null}
        busy={busy}
        onProcess={process}
      />

      {decision && <DecisionCard decision={decision} />}

      <RecentRequests entries={history} />
    </main>
  );
}
