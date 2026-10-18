import { useEffect, useState } from "react";
import { adminApi } from "../../api.ts";
import { reasonLabel } from "../../explain.ts";
import type { AdminUser, HistoryFilters, HistoryPage } from "../../types.ts";

const PAGE_SIZE = 10;
const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });

// Every decision for the account, newest first, with filters and paging.
// `version` changes whenever something happened, so the list reloads.
export function HistoryPanel({ users, version }: { users: AdminUser[]; version: number }) {
  const [filters, setFilters] = useState<HistoryFilters>({ userId: "", outcome: "", month: "" });
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .requests(filters, offset, PAGE_SIZE)
      .then((next) => {
        setPage(next);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [filters, offset, version]);

  const update = (change: Partial<HistoryFilters>) => {
    setFilters((current) => ({ ...current, ...change }));
    setOffset(0);
  };

  return (
    <section className="card">
      <header className="card-header">
        <h2>Request history</h2>
      </header>
      <div className="filters">
        <select aria-label="User" value={filters.userId} onChange={(e) => update({ userId: e.target.value })}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.externalId} value={u.externalId}>
              {u.externalId}
            </option>
          ))}
        </select>
        <select
          aria-label="Outcome"
          value={filters.outcome}
          onChange={(e) => update({ outcome: e.target.value as HistoryFilters["outcome"] })}
        >
          <option value="">All outcomes</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
        <input
          type="month"
          aria-label="Month"
          value={filters.month}
          onChange={(e) => update({ month: e.target.value })}
        />
      </div>

      {error && <div className="error">{error}</div>}

      {page && page.requests.length === 0 ? (
        <p className="muted">No requests match.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th className="num">Units</th>
                <th>Outcome</th>
                <th>Request ID</th>
              </tr>
            </thead>
            <tbody>
              {page?.requests.map((r) => (
                <tr key={r.requestId}>
                  <td>{time(r.decidedAt)}</td>
                  <td>{r.userId}</td>
                  <td className="num">{r.units}</td>
                  <td>
                    {r.accepted ? (
                      <span className="badge ok">Accepted</span>
                    ) : (
                      <span className="badge no">
                        Rejected · {reasonLabel(r.rejection!.rule, r.rejection!.level)}
                      </span>
                    )}
                  </td>
                  <td className="mono small">{r.requestId.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pager">
        <button
          type="button"
          className="chip"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          ← Newer
        </button>
        <span className="muted small">
          {page && page.requests.length > 0 && `${offset + 1}–${offset + page.requests.length}`}
        </span>
        <button
          type="button"
          className="chip"
          disabled={!page?.hasMore}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Older →
        </button>
      </div>
    </section>
  );
}
