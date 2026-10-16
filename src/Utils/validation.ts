// Small input checks shared by controllers.

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// Database ids are BIGINT identity values. Accept them as a number or a
// numeric string and return the string form, or null when the value is not a
// valid id (so callers can answer 400/404 instead of letting Postgres fail).
export function parseId(value: unknown): string | null {
  if (typeof value === "number") {
    return isPositiveInteger(value) ? String(value) : null;
  }
  if (typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value)) {
    return value;
  }
  return null;
}

export const MAX_PAGE_SIZE = 100;

// ?limit=&offset= with defaults 50 and 0; null when either is invalid.
export function parsePaging(query: { limit?: unknown; offset?: unknown }) {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (
    !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE ||
    !Number.isSafeInteger(offset) || offset < 0
  ) {
    return null;
  }
  return { limit, offset };
}

// ?month=YYYY-MM as the first day of that month ('YYYY-MM-01').
// Absent means the current month (null); undefined means invalid.
export function parseMonth(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  if (typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return `${value}-01`;
  }
  return undefined;
}

// The retry key is used exactly as sent (no trimming), 1-200 characters.
export function parseRequestId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200
    ? value
    : null;
}

// The caller's own user id: 1–200 characters after trimming.
export function parseExternalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null;
}