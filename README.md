# Usage Metering and Quota Service

A backend service that other applications call before a user performs a
metered action. It checks the calling **account's** shared plan and the
**user's** own plan, records the decision, and counts the units only if the
request is accepted.

Stack: TypeScript, Express 5, PostgreSQL 16. Example client: Docs Co (React + a
small Express backend).

- [Quick start](#quick-start)
- [The example client (Docs Co)](#the-example-client-docs-co)
- [Concepts: accounts, users, plans](#concepts-accounts-users-plans)
- [API keys](#api-keys)
- [API reference](#api-reference)
- [Rules and how a request is decided](#rules-and-how-a-request-is-decided)
- [Plan changes](#plan-changes)
- [Retries and idempotency](#retries-and-idempotency)
- [Concurrency and correctness](#concurrency-and-correctness)
- [Database design](#database-design)
- [Product assumptions](#product-assumptions)
- [Tests](#tests)
- [Performance](#performance)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)

---

## Quick start

Requirements: Docker Desktop (or Docker Engine with Compose v2).

```bash
docker compose up --build
```

| What | URL |
|---|---|
| Docs Co example client | http://localhost:8080 |
| Metering API | http://localhost:3000 |
| PostgreSQL (for `psql` or the tests) | `localhost:5434`, user / password / db `metering` |

On the first start Postgres runs `db/*.sql` in order: the schema, the
predefined plans, then a later migration. No manual step is needed. Data is
kept in the `pgdata` volume, so it survives restarts.

```bash
docker compose down      # stop, keep the data
docker compose down -v   # stop and delete the data (fresh start)
```

### Configuration

Everything has a default, so no `.env` file is needed.

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `ADMIN_API_KEY` | api, client | `local-admin-key` | Key for creating accounts (`x-admin-key`). Compose reads it from `.env` if present. |
| `DATABASE_URL` | api | set by Compose | Postgres connection string |
| `PORT` | api | `3000` | API port |
| `CLIENT_PORT` | client | `8080` | Docs Co port |
| `METERING_URL` | client | set by Compose | Where the client finds the API |
| `DEMO_API_KEY` | client | (none) | Reuse an existing account instead of creating a demo account |

### Running without Docker (development)

Needs Node 20+ and a Postgres database with `db/*.sql` applied.

```bash
npm install
npm run dev            # API on :3000, reads DATABASE_URL and ADMIN_API_KEY from .env
cd client && npm install && npm run dev   # Docs Co on :5173 (Vite) with its backend on :8080
```

---

## The example client (Docs Co)

Docs Co is an imaginary document-processing company. Processing a document
costs **one unit per page**. Its backend calls the metering service with Docs
Co's API key; the browser never sees the key.

On start the client creates a demo account:

| Who | Plan | Limits |
|---|---|---|
| Docs Co (account) | custom **Docs Co Team** | 100 units / month, 50 per request |
| Alice | predefined **Basic** | 1,000 / month, 20 per request, 100 per day |
| Carol | predefined **Basic** (same plan as Alice, separate totals) | same as Alice |
| Bob | predefined **Premium** | 5,000 / month, 100 per request |

The team plan is deliberately small so the shared limit is easy to reach.

### Walkthrough

Open http://localhost:8080.

1. **User view**, pick **Alice**, process **10** pages → ✅ accepted. Both the
   team and Alice go from 0 to 10 used.
2. Alice processes **25** pages → ❌ rejected by **Alice's user plan**
   (max 20 per request). Nothing is counted.
3. Pick **Bob** (Premium), process **50** pages → ✅ accepted (team: 60 / 100).
4. Bob processes **50** again → ❌ rejected by the **account's** monthly
   allowance (only 40 left), even though Bob has 4,950 of his own units left.
5. Switch to **Account admin**: move Alice to **Premium** (or create a custom
   plan and assign it, or edit the team plan).
6. Back in the **User view**, Alice processes **25** → ✅ accepted. The client
   code did not change; only the plan did.

Every decision card shows which rule decided it, whether it belongs to the
account or the user, and the remaining allowance at both levels. **Reset demo**
in the admin view starts over with a brand-new demo account.

---

### Predefined plans

Created at startup by `db/002_seed.sql`:

| Plan | Scope | Monthly allowance | Max per request | Daily allowance |
|---|---|---:|---:|---:|
| Starter | account | 10,000 | 100 | – |
| Pro | account | 100,000 | 1,000 | – |
| Basic | user | 1,000 | 20 | 100 |
| Premium | user | 5,000 | 100 | – |

The limits follow the brief's example (an account of 10,000 / month and 100 per
request; a user of 1,000 / month and 20 per request). Pro and Premium are
roughly 10× and 5× larger. Basic also has a daily cap, to show the extra rule.

---

## API keys

1. An operator creates an account with the **admin key**
   (`x-admin-key: <ADMIN_API_KEY>`). The response contains the account's API
   key. **It is shown only once**: the database stores only its SHA-256 hash.
2. The application sends that key as **`x-api-key`** on every other request.

The key identifies the account. Every query is scoped by that account, so an
account can only see and change its own users, plans, usage and history.
Unknown users, and plans owned by other accounts, answer `404` / `400`, so
another account's ids cannot be probed.

| Situation | Response |
|---|---|
| No `x-api-key` header | `401 {"message":"Missing API key"}` |
| Unknown key | `401 {"message":"Invalid API key"}` |
| Wrong or missing admin key on `POST /admin/accounts` | `401 {"message":"Unauthorized"}` |

---

## API reference

**Full reference with every endpoint, field, response and error:
[docs/API.md](docs/API.md).** Summary:

Base URL `http://localhost:3000`. JSON in and out. All routes except
`GET /plans/predefined` and `POST /admin/accounts` need `x-api-key`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/plans/predefined` | Predefined plans (no key needed) |
| `POST` | `/admin/accounts` | Create an account, get its API key (admin key) |
| `GET` | `/account` | The calling account and its plan |
| `PUT` | `/account/plan` | Switch the account's plan |
| `GET` | `/plans` | Predefined plans plus this account's custom plans |
| `POST` | `/plans` | Create a custom plan |
| `GET` | `/plans/:id` | One plan |
| `PATCH` | `/plans/:id` | Update a custom plan (predefined → `403`) |
| `POST` | `/users` | Register a user |
| `GET` | `/users` | List users (paginated) |
| `GET` | `/users/:externalId` | One user and their plan |
| `PUT` | `/users/:externalId/plan` | Switch a user's plan |
| `GET` | `/users/:externalId/limits` | Both plans, usage, remaining, and the effective limit |
| `GET` | `/users/:externalId/usage` | One user's usage for a month |
| `POST` | `/consume` | **Ask to consume units** |
| `GET` | `/usage` | Account usage for a month |
| `GET` | `/usage/users` | Account usage plus each user's usage (paginated) |
| `GET` | `/requests` | Request history (filtered, paginated) |
| `GET` | `/requests/:requestId` | One decision with the full response and the limits it used |

Pagination: `?limit=` (1–100, default 50) and `?offset=` (default 0).
Months: `?month=YYYY-MM` (UTC); without it, the current month.

### Create an account

```bash
curl -X POST http://localhost:3000/admin/accounts \
  -H "content-type: application/json" -H "x-admin-key: local-admin-key" \
  -d '{"name": "Docs Co", "planId": 1}'
```

```json
{
  "message": "Account created successfully",
  "account": { "id": "106", "name": "Docs Co", "plan_id": "1", "created_at": "2026-10-19T10:55:01.900Z" },
  "apiKey": "3f9c…64 hex characters…"
}
```

`planId` must be a predefined account plan. To use a custom account plan, create
it with `POST /plans` and switch with `PUT /account/plan`.

### Plans

```bash
# create a custom user plan (dailyAllowance optional; null or absent = no daily rule)
curl -X POST http://localhost:3000/plans -H "content-type: application/json" -H "x-api-key: $KEY" \
  -d '{"scope": "user", "name": "Intern", "monthlyAllowance": 200, "maxPerRequest": 5}'

# change any subset of fields; dailyAllowance: null removes the daily rule
curl -X PATCH http://localhost:3000/plans/214 -H "content-type: application/json" -H "x-api-key: $KEY" \
  -d '{"maxPerRequest": 10}'

# assign
curl -X PUT http://localhost:3000/account/plan -H "content-type: application/json" -H "x-api-key: $KEY" -d '{"planId": 215}'
curl -X PUT http://localhost:3000/users/alice/plan -H "content-type: application/json" -H "x-api-key: $KEY" -d '{"planId": 214}'
```

```json
{
  "plan": {
    "id": "214", "owner_account_id": "106", "scope": "user", "name": "Intern",
    "monthly_allowance": "200", "max_per_request": "5", "daily_allowance": null,
    "version": 1, "created_at": "…", "updated_at": "…"
  }
}
```

Validation: `monthlyAllowance` ≥ 0, `maxPerRequest` ≥ 1, `dailyAllowance` ≥ 0
or `null`, all whole numbers. An account plan can only be assigned to an
account and a user plan only to users (enforced by the database too). Names are
unique per account and scope.

### Users

```bash
curl -X POST http://localhost:3000/users -H "content-type: application/json" -H "x-api-key: $KEY" \
  -d '{"externalId": "alice", "planId": 3}'
```

```json
{
  "user": {
    "externalId": "alice", "createdAt": "2026-10-19T10:55:02.795Z",
    "plan": { "id": 3, "name": "Basic", "scope": "user", "isPredefined": true, "version": 1,
              "monthlyAllowance": 1000, "maxPerRequest": 20, "dailyAllowance": 100 }
  }
}
```

A duplicate `externalId` in the same account answers `409`. The same
`externalId` may exist under different accounts.

### Consume units

```bash
curl -X POST http://localhost:3000/consume -H "content-type: application/json" -H "x-api-key: $KEY" \
  -d '{"userId": "alice", "units": 10, "requestId": "doc-1"}'
```

| Field | Rule |
|---|---|
| `userId` | The user's `externalId`, 1–200 characters |
| `units` | Positive whole number |
| `requestId` | Caller-chosen retry key, 1–200 characters, unique per account |

**Accepted** (`200`):

```json
{
  "requestId": "doc-1",
  "accepted": true,
  "replayed": false,
  "decidedAt": "2026-10-19T10:55:03.047Z",
  "units": 10,
  "rejection": null,
  "violations": [],
  "account": {
    "plan": { "id": 1, "name": "Starter", "version": 1, "isPredefined": true,
              "monthlyAllowance": 10000, "maxPerRequest": 100, "dailyAllowance": null },
    "monthly": { "limit": 10000, "used": 10, "remaining": 9990 },
    "daily": null
  },
  "user": {
    "externalId": "alice",
    "plan": { "id": 3, "name": "Basic", "version": 1, "isPredefined": true,
              "monthlyAllowance": 1000, "maxPerRequest": 20, "dailyAllowance": 100 },
    "monthly": { "limit": 1000, "used": 10, "remaining": 990 },
    "daily": { "limit": 100, "used": 10, "remaining": 90 }
  }
}
```

**Rejected** is also `200`, because a rejection is a valid decision, not an error:

```json
{
  "requestId": "doc-2",
  "accepted": false,
  "replayed": false,
  "units": 25,
  "rejection": { "rule": "max_per_request", "level": "user", "limit": 20, "used": null,
                 "requested": 25, "resetsAt": null },
  "violations": [ { "rule": "max_per_request", "level": "user", "limit": 20, "used": null, "requested": 25 } ],
  "account": { "…": "same shape as above, unchanged usage" },
  "user": { "…": "same shape as above, unchanged usage" }
}
```

- `rejection` is the main reason (see [rule order](#rules-and-how-a-request-is-decided)):
  which `rule`, at which `level` (`account` or `user`), and `resetsAt`, when it
  could pass again (start of the next UTC month or day; `null` for a
  per-request limit, which never passes on retry).
- `violations` lists **every** rule the request broke, so a caller can tell
  "the user is over and so is the account".
- `account` and `user` show the plans that were applied and the usage **after**
  the decision.

| Error | Status |
|---|---|
| Missing or invalid `userId`, `units`, `requestId` | `400` |
| User not registered under this account | `404 {"message":"User not found"}` |
| `requestId` already used with a different user or amount | `409` |

### Limits, usage and history

```bash
curl http://localhost:3000/users/alice/limits -H "x-api-key: $KEY"
```

```json
{
  "externalId": "alice",
  "account": { "plan": { "…": "…" }, "monthly": { "limit": 10000, "used": 10, "remaining": 9990 }, "daily": null },
  "user": { "plan": { "…": "…" }, "monthly": { "limit": 1000, "used": 10, "remaining": 990 },
            "daily": { "limit": 100, "used": 10, "remaining": 90 } },
  "effective": { "maxPerRequest": 20, "monthlyRemaining": 990, "dailyRemaining": 90, "maxUnitsNow": 20 }
}
```

`effective.maxUnitsNow` is the largest request that would be accepted right now.

```bash
curl "http://localhost:3000/usage?month=2026-10" -H "x-api-key: $KEY"
curl "http://localhost:3000/usage/users?limit=50&offset=0" -H "x-api-key: $KEY"
curl "http://localhost:3000/users/alice/usage?month=2026-09" -H "x-api-key: $KEY"
```

```json
{
  "account": { "month": "2026-10", "isCurrentMonth": true, "used": 10, "limit": 10000,
               "remaining": 9990, "requests": { "accepted": 1, "rejected": 1 } }
}
```

For a past month, `limit` and `remaining` are `null`: plans may have changed
since, and judging an old month against today's plan would mislead.

```bash
curl "http://localhost:3000/requests?userId=alice&outcome=rejected&month=2026-10&limit=20&offset=0" -H "x-api-key: $KEY"
curl http://localhost:3000/requests/doc-2 -H "x-api-key: $KEY"
```

```json
{
  "requests": [
    { "requestId": "doc-2", "userId": "alice", "units": 25, "accepted": false,
      "rejection": { "rule": "max_per_request", "level": "user" }, "decidedAt": "2026-10-19T10:55:03.449Z" },
    { "requestId": "doc-1", "userId": "alice", "units": 10, "accepted": true,
      "rejection": null, "decidedAt": "2026-10-19T10:55:03.047Z" }
  ],
  "hasMore": false, "limit": 20, "offset": 0
}
```

History is newest first. All filters are optional. `GET /requests/:requestId`
also returns the exact `response` that was sent and a `limitsSnapshot`: the
plans (with their version) and the usage the decision was made against.

### Other errors

All errors are JSON `{"message": "..."}`: `400` for invalid input or malformed
JSON, `404` for unknown routes or resources, `409` for duplicates, `500` only
for unexpected failures (logged, never with internal details).

---

## Rules and how a request is decided

Every plan has three rules. Each one is checked at **both** levels:

| Rule | Meaning |
|---|---|
| `monthly_allowance` | Units per UTC calendar month (required) |
| `max_per_request` | Largest single request (required) |
| `daily_allowance` | Units per UTC day (**additional rule**, optional; `null` = none) |

A request is accepted only if **all six checks** pass (3 rules × account and
user). Then the units are added to the user's and the account's month **and**
day counters in the same transaction. A rejection changes no counter.

Examples with an account of 10,000 / month and 100 per request, and a user of
1,000 / month and 20 per request:

| Request | Result |
|---|---|
| 25 units | ❌ `max_per_request` / `user`, even with plenty of monthly allowance |
| 10 units, both have room | ✅ +10 to the user **and** +10 to the account |
| 10 units, account has 5 left | ❌ `monthly_allowance` / `account`, even if the user has plenty |

### Which rule is reported

When several rules fail, `rejection` is the one that **blocks longest**:
`max_per_request` (never passes on retry), then `monthly_allowance` (next
month), then `daily_allowance` (tomorrow). For the same rule, `account` comes
before `user`, because an exhausted account blocks all of its users. The full
list is still in `violations`.

### How the daily rule interacts

The daily rule is a cap inside the monthly allowance. It never adds units: a
user with 100 / day and 1,000 / month still stops at 1,000 for the month. On
an account plan, it limits the whole account's combined usage per day. It
exists to stop one user (or the whole account) from burning the month's
allowance in a single day.

The rules live in one pure function, `src/Rules/evaluate.ts`, with no database
access, so they're unit tested from plain numbers. Adding a rule means adding a
column, a case in `check()` and a place in `RULE_ORDER`.

---

## Plan changes

- **Take effect immediately, no redeploy.** Plans are read from the database on
  every request. A request that starts after an update has returned uses the
  new limits.
- **Editing a custom plan** affects every account or user assigned to it. Each
  update bumps the plan's `version`, which is recorded with every decision.
- **Switching plans keeps usage.** Counters belong to the account or user and
  the period, not to the plan, so switching never grants a fresh allowance.
- **Allowance below usage.** If a limit is lowered below what is already used,
  `remaining` shows `0` (never negative) and further requests at that level
  are rejected until the next period or a higher limit.
- **History is preserved.** Request rows are never updated. Each stores the
  limits and plan versions it was decided with.
- **Predefined plans are read-only** (`403`), so one account can't change
  another's limits.

---

## Retries and idempotency

`requestId` is the retry key, unique per account.

- Sending the **same** `requestId`, user and units again returns the **stored
  decision**, unchanged, with `"replayed": true`. Units are never counted
  twice. This holds even if the plan or the month changed in between: a retry
  repeats the original answer instead of making a new decision.
- The same `requestId` with a **different** user or amount is a client bug and
  gets `409`.
- Two copies of a new `requestId` arriving at the same moment are handled too:
  one decides, and the other waits for the lock and replays it. If both slip
  through, the database's unique index makes the loser replay the winner's
  decision.

So a client can safely retry on timeouts or `5xx`. The Docs Co client does
exactly that (3 attempts, same `requestId`).

---

## Concurrency and correctness

A consume runs in **one transaction** (`src/Services/consumeService.ts`):

1. Load the user, both plans and any earlier decision for this `requestId`
   (one query). A known `requestId` replays.
2. If the request is over either **per-request** limit, reject without locking
   anything, because the answer can't depend on usage.
3. Otherwise **lock the four counter rows** (account month, account day, user
   month, user day), always in that order so concurrent requests can't
   deadlock. Missing rows are created by the same statement.
4. **Reload the plans and the `requestId` check after the lock.** Under READ
   COMMITTED this sees any plan change or duplicate committed while waiting.
5. Evaluate, add the units if accepted, store the decision, commit.

The account month row acts as a per-account lock. Two requests for the same
account are decided one after the other, so the last units can never be
overspent. Different accounts never wait for each other. The current month and
day come from the database clock at transaction start, so a request near
midnight is counted entirely in one period.

Proven by tests and the load test: with 64 requests racing for an allowance of
1,000, exactly 1,000 are accepted, and the account counter equals both the sum
of the user counters and the accepted units in the history.

---

## Database design

Schema in `db/001_init.sql`.

| Table | Holds | Notes |
|---|---|---|
| `plans` | Predefined (`owner_account_id IS NULL`) and custom plans | `scope` account/user, 3 rule columns, `version`. Unique names per owner and scope. |
| `accounts` | Name, **hash** of the API key, current plan | A composite FK `(plan_id, plan_scope)` makes sure an account only points at an account plan. |
| `users` | `externalId` per account, current plan | Same composite-FK trick for user plans. `UNIQUE (account_id, external_id)`. |
| `usage_counters` | Units used per subject (account or user) per period (UTC month or day) | Primary key `(subject_type, subject_id, period_type, period_start)`. `CHECK used >= 0`. |
| `requests` | Every decision, accepted or rejected | `UNIQUE (account_id, request_id)` is the idempotency key. Stores the response and a limits snapshot. Insert-only. |

Main choices:

- **Counters instead of summing history.** The hot path reads and locks four
  small rows instead of aggregating the history table, so a decision costs the
  same at the first request and the millionth.
- **The account total is its own row**, updated in the same transaction as the
  user's, rather than being summed from users on read. The account check then
  needs one locked row, and "account = sum of its users" is checked by tests
  and the load test.
- **Old months stay** as separate counter rows, so past usage is a simple lookup.
- **Rules as columns** (not a generic rules table). With three well-defined
  rules this keeps validation and constraints in the database. A generic rules
  table would pay off only with many rule types.

---

## Product assumptions

Things the brief left open, and what I chose:

| Question | Decision | Why |
|---|---|---|
| Is a rejection an HTTP error? | No, `200` with `accepted: false`. Errors are for bad input. | A caller should handle "not allowed" as a normal outcome, not an exception. |
| Which reason to report when several rules fail? | The one that blocks longest (see above), plus the full list | Tells the user the most useful thing: when they can try again. |
| What counts toward the daily rule? | Same units as the monthly rule, per UTC day | One resource, one clock. |
| Can a monthly allowance be 0? | Yes (`>= 0`) | A useful "suspended" plan. `maxPerRequest` must be ≥ 1. |
| Retry with the same key after a plan change or new month? | Replays the original decision | A retry is the *same* request; it must not be decided twice. |
| Same key, different body? | `409` | Silently picking one would hide a client bug. |
| Who creates accounts? | An operator with the admin key | The brief has no self-signup. Account creation is the only cross-account operation. |
| Initial account plan | Must be predefined; custom ones are assigned afterwards | Custom plans belong to an account, which doesn't exist yet at creation. |
| Can accounts edit predefined plans? | No (`403`) | They're shared by every account. |
| Can an account use another account's custom plan? | No | Isolation. |
| What about usage in past months? | Kept and queryable. `limit`/`remaining` are `null` for closed months | Plans may have changed since. |
| Time zone | UTC for all periods, from the database clock | One source of truth, independent of the API server's clock. |
| Units | Positive whole numbers; one resource ("pages" in the demo) | As the brief says. |
| Deleting users, accounts, plans | Not supported | Not required, and deleting would complicate history. |

---

## Tests

73 automated tests (Vitest), in `tests/`:

- **`unit/evaluate.test.ts`**: every rule at both levels, rule order,
  remaining never negative.
- **`api/auth-isolation.test.ts`**: missing and invalid keys, admin key,
  account isolation (no reading or using another account's users, plans,
  usage or history).
- **`api/consume.test.ts`**: the brief's examples, plan changes and switches,
  allowances lowered below usage, retries and `409`, validation, and
  concurrency (parallel requests never overspend; parallel retries count once).
- **`api/plans-users.test.ts`**: predefined and custom plans, users.
- **`api/usage-history.test.ts`**: limits, usage, history, pagination and filters.

The API tests start the real app in-process against a real Postgres. Every test
creates its own account, so tests are independent. With the Docker stack
running, from the project folder:

PowerShell:
```powershell
$env:DATABASE_URL="postgres://metering:metering@localhost:5434/metering"; $env:ADMIN_API_KEY="test-admin-key"; npm test
```

bash:
```bash
DATABASE_URL=postgres://metering:metering@localhost:5434/metering ADMIN_API_KEY=test-admin-key npm test
```

(`npm install` first. `ADMIN_API_KEY` can be any value here, because the tests
start their own copy of the app with it.)

---

## Performance

Load and concurrency tests are in [`perf/`](perf/README.md), with the script,
how to run it, the results and what was learned. In short:

```bash
docker compose --profile perf run --rm perf
```

| Scenario | Req/s | p95 ms | Correctness |
|---|---:|---:|---|
| Load spread over 20 accounts | 385 | 242 | ✅ |
| All load on one account | 115 | 881 | ✅ |
| 3,000 requests racing for 1,000 units | 148 | 689 | ✅ exactly 1,000 accepted |
| 500 requestIds × 4 concurrent retries | 248 | 407 | ✅ each counted once |
| Plan changes during load | 262 | 603 | ✅ new rules applied at once |

All 39 correctness checks passed (Docker Desktop on Windows, 64 requests in
flight). Each account is serialized on purpose to keep its totals exact, so one
busy account is slower than many quiet ones. See `perf/README.md` for the
bottleneck analysis.

---

## Project layout

```
src/
  server.ts, app.ts       Express setup
  Routers/                URL → controller
  Controllers/            HTTP: validate input, map errors to status codes
  Services/               Database work; consumeService.ts is the decision path
  Rules/evaluate.ts       Pure rule evaluation (no I/O)
  Middleware/             API key auth, JSON error handler
  Utils/validation.ts     Shared input parsing
db/                       Schema, predefined plans, migration (run by Postgres on first start)
tests/                    Unit + API tests
perf/                     Load test, its Dockerfile and results
client/                   Docs Co example: React page + Express backend holding the API key
docker-compose.yml        db, api, client (+ perf on request)
```

---

## Known limitations

- **One busy account is serialized.** Exactness costs throughput on a single
  very busy account (~115 req/s here). Options if that mattered: move the
  decision into one database function (fewer round trips while the lock is
  held), or pre-allocate chunks of allowance per API instance.
- **Plan responses aren't normalized.** `/plans` endpoints and
  `POST /admin/accounts` return database rows (snake_case, numbers as strings),
  while every other endpoint returns camelCase numbers. The client converts them.
- **API key lookup on every request.** One indexed query, no cache. A cache
  would make key revocation slower to take effect.
- **No key rotation, and no deletion** of accounts, users or plans.
- **Offset pagination** for history. Fine at this scale; keyset pagination
  (`created_at, id` is already indexed) would be better for deep pages.
- **The history table grows forever.** Partitioning by month or archiving
  would be the next step.
- **No rate limiting** of the API itself (as opposed to quotas).
- **Each start of the example client creates a new Docs Co account** (old ones
  stay in the database). Set `DEMO_API_KEY` to reuse one.
- **Out of scope** per the brief: billing, refunds, multiple resource types,
  end-user login, roles, distributed deployment.
