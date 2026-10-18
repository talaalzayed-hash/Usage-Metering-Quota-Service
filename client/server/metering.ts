// Thin client for the usage metering service. Only this backend talks to the
// service; the browser never sees the API key.

const BASE_URL = process.env.METERING_URL ?? "http://localhost:3000";

export class MeteringError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Metering service answered ${status}`);
  }
}

interface CallOptions {
  apiKey?: string;
  adminKey?: string;
  body?: unknown;
}

export async function metering<T = any>(
  method: string,
  path: string,
  { apiKey, adminKey, body }: CallOptions = {},
): Promise<T> {
  const response = await fetch(BASE_URL + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(adminKey ? { "x-admin-key": adminKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new MeteringError(response.status, data);
  }
  return data as T;
}

// Asks the service to consume units for a user. The requestId is created once
// and reused on every retry, so a request whose answer was lost (network error
// or 5xx) is never counted twice: the service replays the first decision.
export async function consume(apiKey: string, userId: string, units: number) {
  const requestId = crypto.randomUUID();
  const attempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await metering("POST", "/consume", {
        apiKey,
        body: { userId, units, requestId },
      });
    } catch (error) {
      const retryable = !(error instanceof MeteringError) || error.status >= 500;
      if (!retryable || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}
