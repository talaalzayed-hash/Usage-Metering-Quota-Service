import { pool } from "../Config/database.js";

// Request history: every consume decision, accepted or rejected, newest first.
// Rows are never updated, so plan changes do not rewrite past outcomes.

export interface HistoryFilters {
  externalId: string | null;
  monthStart: string | null; // 'YYYY-MM-01', or null for all time
  accepted: boolean | null; // null for both outcomes
}

interface HistoryRow {
  request_id: string;
  external_id: string;
  units: string;
  accepted: boolean;
  failed_rule: string | null;
  failed_level: string | null;
  created_at: Date;
}

const HISTORY_COLUMNS = `
  r.request_id, u.external_id, r.units, r.accepted,
  r.failed_rule, r.failed_level, r.created_at`;

function toEntry(row: HistoryRow) {
  return {
    requestId: row.request_id,
    userId: row.external_id,
    units: Number(row.units),
    accepted: row.accepted,
    rejection:
      row.failed_rule === null ? null : { rule: row.failed_rule, level: row.failed_level },
    decidedAt: row.created_at,
  };
}

// Fetches one extra row to tell whether another page exists.
export async function listRequests(
  accountId: string,
  filters: HistoryFilters,
  limit: number,
  offset: number,
) {
  const result = await pool.query<HistoryRow>(
    `SELECT ${HISTORY_COLUMNS}
     FROM requests r
     JOIN users u ON u.id = r.user_id
     WHERE r.account_id = $1
       AND ($2::text IS NULL OR u.external_id = $2)
       AND ($3::date IS NULL OR (
             r.created_at >= $3::date::timestamp AT TIME ZONE 'UTC'
         AND r.created_at < ($3::date + interval '1 month') AT TIME ZONE 'UTC'))
       AND ($4::boolean IS NULL OR r.accepted = $4)
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $5 OFFSET $6`,
    [accountId, filters.externalId, filters.monthStart, filters.accepted, limit + 1, offset],
  );
  return {
    requests: result.rows.slice(0, limit).map(toEntry),
    hasMore: result.rows.length > limit,
  };
}

// One decision by its retry key, with the full response that was returned
// and the limits and usage it was evaluated against.
export async function getRequest(accountId: string, requestId: string) {
  const result = await pool.query<HistoryRow & { response: unknown; limits_snapshot: unknown }>(
    `SELECT ${HISTORY_COLUMNS}, r.response, r.limits_snapshot
     FROM requests r
     JOIN users u ON u.id = r.user_id
     WHERE r.account_id = $1 AND r.request_id = $2`,
    [accountId, requestId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...toEntry(row),
    response: row.response,
    limitsSnapshot: row.limits_snapshot,
  };
}
