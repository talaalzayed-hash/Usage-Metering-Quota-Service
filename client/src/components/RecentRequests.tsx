import { reasonLabel } from "../explain.ts";
import type { HistoryEntry } from "../types.ts";

const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });

export function RecentRequests({ entries }: { entries: HistoryEntry[] }) {
  return (
    <section className="card">
      <header className="card-header">
        <h2>My recent requests</h2>
      </header>
      {entries.length === 0 ? (
        <p className="muted">No documents processed yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Pages</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.requestId}>
                <td>{time(entry.decidedAt)}</td>
                <td>{entry.units}</td>
                <td>
                  {entry.accepted ? (
                    <span className="badge ok">Processed</span>
                  ) : (
                    <span className="badge no">
                      Rejected · {reasonLabel(entry.rejection!.rule, entry.rejection!.level)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
