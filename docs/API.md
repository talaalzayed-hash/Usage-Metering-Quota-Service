# API Reference

Every endpoint of the usage metering service, with its request, response and
errors. All examples are real responses from the running service (timestamps
and ids will differ).

- [Conventions](#conventions)
- [Authentication](#authentication)
- **Accounts**: [Create an account](#post-adminaccounts) · [Get the account](#get-account) · [Switch the account plan](#put-accountplan)
- **Plans**: [Predefined plans](#get-planspredefined) · [List plans](#get-plans) · [Get a plan](#get-plansid) · [Create a plan](#post-plans) · [Update a plan](#patch-plansid)
- **Users**: [Register a user](#post-users) · [List users](#get-users) · [Get a user](#get-usersexternalid) · [Switch a user's plan](#put-usersexternalidplan) · [User limits](#get-usersexternalidlimits) · [User usage](#get-usersexternalidusage)
- **Consume**: [Consume units](#post-consume)
- **Usage**: [Account usage](#get-usage) · [Account and users usage](#get-usageusers)
- **History**: [List requests](#get-requests) · [Get one request](#get-requestsrequestid)
- [Errors](#errors)
- [Typical integration](#typical-integration)

---

## Conventions

| | |
|---|---|
| Base URL | `http://localhost:3000` |
| Format | JSON request and response bodies (`content-type: application/json`) |
| Units | Positive whole numbers |
| Months | `YYYY-MM`, UTC. When `?month=` is omitted, the current UTC month. |
| Pagination | `?limit=` 1–100 (default 50), `?offset=` ≥ 0 (default 0). The response echoes `limit` and `offset`. |
| Errors | Always `{"message": "..."}` with a 4xx/5xx status |
| User ids | The caller's own id for the user (`externalId`), 1–200 characters, trimmed |

> **Two response styles.** The plan endpoints (`/plans…`) and
> `POST /admin/accounts` return plan and account rows as stored: snake_case
> fields, and BIGINT values as **strings** (e.g. `"monthly_allowance": "10000"`).
> All other endpoints return camelCase fields with numbers. This is listed as a
> known limitation.

---

## Authentication

| Header | Used by | Meaning |
|---|---|---|
| `x-admin-key` | `POST /admin/accounts` only | The operator key (`ADMIN_API_KEY`, default `local-admin-key`) |
| `x-api-key` | Every other endpoint except `GET /plans/predefined` | The account's API key, issued when the account is created |

The API key identifies the account. Every endpoint only sees and changes **that
account's** users, plans, usage and history. Other accounts' resources answer
as if they didn't exist (`404` / `400`).

| Situation | Status | Body |
|---|---|---|
| No `x-api-key` | `401` | `{"message":"Missing API key"}` |
| Unknown `x-api-key` | `401` | `{"message":"Invalid API key"}` |
| Wrong or missing `x-admin-key` | `401` | `{"message":"Unauthorized"}` |

The key is shown only once, at creation. The database stores only its SHA-256 hash.

---

## Accounts

### `POST /admin/accounts`

Create an account and issue its API key. **Auth:** `x-admin-key`.

| Body field | Type | Required | Rule |
|---|---|---|---|
| `name` | string | yes | Not blank |
| `planId` | number or numeric string | yes | A **predefined account** plan (Starter or Pro) |

```bash
curl -X POST http://localhost:3000/admin/accounts \
  -H "content-type: application/json" -H "x-admin-key: local-admin-key" \
  -d '{"name": "Docs Co", "planId": 1}'
```

`201 Created`

```json
{
  "message": "Account created successfully",
  "account": { "id": "158", "name": "Docs Co", "plan_id": "1", "created_at": "2026-10-20T10:38:31.088Z" },
  "apiKey": "<64 hex characters>"
}
```

| Error | Status | Message |
|---|---|---|
| Wrong admin key | `401` | `Unauthorized` |
| Missing name or planId | `400` | `name and a numeric planId are required` |
| planId isn't a predefined account plan | `400` | `The specified account plan does not exist` |

To put the account on a custom plan, create it with
[`POST /plans`](#post-plans), then [`PUT /account/plan`](#put-accountplan).

### `GET /account`

The calling account and the plan currently applied to it. **Auth:** `x-api-key`.

```bash
curl http://localhost:3000/account -H "x-api-key: $KEY"
```

`200 OK`

```json
{
  "account": {
    "id": 158,
    "name": "Docs Co",
    "createdAt": "2026-10-20T10:38:31.088Z",
    "plan": {
      "id": 1, "name": "Starter", "scope": "account", "isPredefined": true, "version": 1,
      "monthlyAllowance": 10000, "maxPerRequest": 100, "dailyAllowance": null
    }
  }
}
```

### `PUT /account/plan`

Switch the account to another account plan: a predefined one, or one of its
own custom plans. Takes effect for the next request. **Usage already counted
this month is kept.** **Auth:** `x-api-key`.

| Body field | Type | Required |
|---|---|---|
| `planId` | number or numeric string | yes |

```bash
curl -X PUT http://localhost:3000/account/plan \
  -H "content-type: application/json" -H "x-api-key: $KEY" -d '{"planId": 342}'
```

`200 OK`: same shape as [`GET /account`](#get-account).

```json
{
  "account": {
    "id": 158, "name": "Docs Co", "createdAt": "2026-10-20T10:38:31.088Z",
    "plan": { "id": 342, "name": "Team", "scope": "account", "isPredefined": false, "version": 1,
              "monthlyAllowance": 500, "maxPerRequest": 50, "dailyAllowance": 200 }
  }
}
```

| Error | Status | Message |
|---|---|---|
| planId missing or not a number | `400` | `A numeric planId is required` |
| Unknown plan, a **user** plan, or another account's plan | `400` | `The specified account plan does not exist` |

---

## Plans

A plan has a `scope` (`account` or `user`) and three rules:

| Field (create/update) | Field (response) | Rule |
|---|---|---|
| `monthlyAllowance` | `monthly_allowance` | Units per UTC month, whole number ≥ 0 |
| `maxPerRequest` | `max_per_request` | Largest single request, whole number ≥ 1 |
| `dailyAllowance` | `daily_allowance` | Units per UTC day, whole number ≥ 0, or `null` for no daily rule |

`owner_account_id` is `null` for predefined plans and the owner's id for custom
plans. `version` starts at 1 and goes up by one on every update.

### `GET /plans/predefined`

The predefined plans. **No authentication**, so a new caller can choose one.
Ordered by scope, then monthly allowance.

```bash
curl http://localhost:3000/plans/predefined
```

`200 OK`

```json
{
  "plans": [
    { "id": "1", "owner_account_id": null, "scope": "account", "name": "Starter",
      "monthly_allowance": "10000", "max_per_request": "100", "daily_allowance": null,
      "version": 1, "created_at": "2026-10-19T08:43:26.629Z", "updated_at": "2026-10-19T08:43:26.629Z" },
    { "id": "2", "owner_account_id": null, "scope": "account", "name": "Pro",
      "monthly_allowance": "100000", "max_per_request": "1000", "daily_allowance": null, "version": 1, "…": "…" },
    { "id": "3", "owner_account_id": null, "scope": "user", "name": "Basic",
      "monthly_allowance": "1000", "max_per_request": "20", "daily_allowance": "100", "version": 1, "…": "…" },
    { "id": "4", "owner_account_id": null, "scope": "user", "name": "Premium",
      "monthly_allowance": "5000", "max_per_request": "100", "daily_allowance": null, "version": 1, "…": "…" }
  ]
}
```

### `GET /plans`

Every plan this account can use: the predefined plans plus its own custom
plans. Ordered by scope, then name. **Auth:** `x-api-key`.

```bash
curl http://localhost:3000/plans -H "x-api-key: $KEY"
```

`200 OK`: `{"plans": [ … ]}`, same plan shape as above. Another account's
custom plans never appear.

### `GET /plans/:id`

One plan: predefined, or owned by this account. **Auth:** `x-api-key`.

```bash
curl http://localhost:3000/plans/342 -H "x-api-key: $KEY"
```

`200 OK`

```json
{
  "plan": {
    "id": "342", "owner_account_id": "158", "scope": "account", "name": "Team",
    "monthly_allowance": "500", "max_per_request": "50", "daily_allowance": "200",
    "version": 1, "created_at": "2026-10-20T10:38:31.861Z", "updated_at": "2026-10-20T10:38:31.861Z"
  }
}
```

| Error | Status | Message |
|---|---|---|
| Unknown id, or another account's plan | `404` | `Plan not found` |

### `POST /plans`

Create a custom plan owned by this account. **Auth:** `x-api-key`.

| Body field | Type | Required | Rule |
|---|---|---|---|
| `scope` | `"account"` or `"user"` | yes | Where it can be assigned |
| `name` | string | yes | Not blank; unique per account and scope |
| `monthlyAllowance` | integer | yes | ≥ 0 |
| `maxPerRequest` | integer | yes | ≥ 1 |
| `dailyAllowance` | integer or `null` | no | ≥ 0. Absent or `null` = no daily rule |

```bash
curl -X POST http://localhost:3000/plans \
  -H "content-type: application/json" -H "x-api-key: $KEY" \
  -d '{"scope": "account", "name": "Team", "monthlyAllowance": 500, "maxPerRequest": 50, "dailyAllowance": 200}'
```

`201 Created`

```json
{
  "plan": {
    "id": "342", "owner_account_id": "158", "scope": "account", "name": "Team",
    "monthly_allowance": "500", "max_per_request": "50", "daily_allowance": "200",
    "version": 1, "created_at": "2026-10-20T10:38:31.861Z", "updated_at": "2026-10-20T10:38:31.861Z"
  }
}
```

Creating a plan doesn't assign it. Use [`PUT /account/plan`](#put-accountplan)
or [`PUT /users/:externalId/plan`](#put-usersexternalidplan).

| Error | Status | Message |
|---|---|---|
| Missing or invalid field | `400` | `scope ('account' or 'user'), name, non-negative integer monthlyAllowance, positive integer maxPerRequest are required; dailyAllowance is an optional non-negative integer or null` |
| Name already used by this account for this scope | `409` | `Resource already exists` |

### `PATCH /plans/:id`

Update any subset of a **custom** plan's fields. The change applies to the
next request of every account or user assigned to the plan. `version` goes up
by one. Past decisions are not changed. **Auth:** `x-api-key`.

| Body field | Rule |
|---|---|
| `name` | Not blank |
| `monthlyAllowance` | Integer ≥ 0 |
| `maxPerRequest` | Integer ≥ 1 |
| `dailyAllowance` | Integer ≥ 0, or `null` to **remove** the daily rule |

At least one field is required. `scope` can't be changed.

```bash
curl -X PATCH http://localhost:3000/plans/342 \
  -H "content-type: application/json" -H "x-api-key: $KEY" \
  -d '{"monthlyAllowance": 600, "dailyAllowance": null}'
```

`200 OK`

```json
{
  "plan": {
    "id": "342", "owner_account_id": "158", "scope": "account", "name": "Team",
    "monthly_allowance": "600", "max_per_request": "50", "daily_allowance": null,
    "version": 2, "created_at": "2026-10-20T10:38:31.861Z", "updated_at": "2026-10-20T10:38:32.897Z"
  }
}
```

Lowering an allowance below what is already used is allowed: `remaining`
becomes `0` and further requests at that level are rejected.

| Error | Status | Message |
|---|---|---|
| Empty body | `400` | `Provide at least one field to update` |
| Invalid value | `400` | `Invalid plan update fields` |
| Predefined plan | `403` | `Predefined plans cannot be modified` |
| Unknown id, or another account's plan | `404` | `Plan not found` |
| New name already used | `409` | `Resource already exists` |

---

## Users

### `POST /users`

Register a user under this account. **Auth:** `x-api-key`.

| Body field | Type | Required | Rule |
|---|---|---|---|
| `externalId` | string | yes | The caller's own user id, 1–200 characters. Unique within the account. |
| `planId` | number or numeric string | yes | A **user** plan: predefined, or this account's own |

```bash
curl -X POST http://localhost:3000/users \
  -H "content-type: application/json" -H "x-api-key: $KEY" \
  -d '{"externalId": "alice", "planId": 3}'
```

`201 Created`

```json
{
  "user": {
    "externalId": "alice",
    "createdAt": "2026-10-20T10:38:33.144Z",
    "plan": {
      "id": 3, "name": "Basic", "scope": "user", "isPredefined": true, "version": 1,
      "monthlyAllowance": 1000, "maxPerRequest": 20, "dailyAllowance": 100
    }
  }
}
```

| Error | Status | Message |
|---|---|---|
| Missing or invalid field | `400` | `externalId (1-200 characters) and a numeric planId are required` |
| Unknown plan, an **account** plan, or another account's plan | `400` | `The specified user plan does not exist` |
| externalId already registered in this account | `409` | `A user with this externalId already exists` |

The same `externalId` can exist in different accounts, as separate users.

### `GET /users`

This account's users with their plans, in creation order. **Auth:** `x-api-key`.

| Query | Default |
|---|---|
| `limit` | 50 (max 100) |
| `offset` | 0 |

```bash
curl "http://localhost:3000/users?limit=2" -H "x-api-key: $KEY"
```

`200 OK`

```json
{
  "users": [
    { "externalId": "alice", "createdAt": "2026-10-20T10:38:33.144Z",
      "plan": { "id": 3, "name": "Basic", "scope": "user", "isPredefined": true, "version": 1,
                "monthlyAllowance": 1000, "maxPerRequest": 20, "dailyAllowance": 100 } },
    { "externalId": "bob", "createdAt": "2026-10-20T10:38:33.248Z",
      "plan": { "id": 4, "name": "Premium", "scope": "user", "isPredefined": true, "version": 1,
                "monthlyAllowance": 5000, "maxPerRequest": 100, "dailyAllowance": null } }
  ],
  "limit": 2,
  "offset": 0
}
```

| Error | Status | Message |
|---|---|---|
| Bad limit or offset | `400` | `limit must be 1-100 and offset must be 0 or more` |

### `GET /users/:externalId`

One user and their plan. **Auth:** `x-api-key`.

```bash
curl http://localhost:3000/users/bob -H "x-api-key: $KEY"
```

`200 OK`: `{"user": { … }}`, same shape as in [`POST /users`](#post-users).

| Error | Status | Message |
|---|---|---|
| Not a user of this account | `404` | `User not found` |

### `PUT /users/:externalId/plan`

Switch a user to another user plan. Takes effect for the next request. **Usage
already counted this month is kept**: switching never grants a fresh
allowance. **Auth:** `x-api-key`.

| Body field | Type | Required |
|---|---|---|
| `planId` | number or numeric string | yes |

```bash
curl -X PUT http://localhost:3000/users/alice/plan \
  -H "content-type: application/json" -H "x-api-key: $KEY" -d '{"planId": 4}'
```

`200 OK`

```json
{
  "user": {
    "externalId": "alice", "createdAt": "2026-10-20T10:38:33.144Z",
    "plan": { "id": 4, "name": "Premium", "scope": "user", "isPredefined": true, "version": 1,
              "monthlyAllowance": 5000, "maxPerRequest": 100, "dailyAllowance": null }
  }
}
```

| Error | Status | Message |
|---|---|---|
| planId missing or not a number | `400` | `A numeric planId is required` |
| Unknown plan, an account plan, or another account's plan | `400` | `The specified user plan does not exist` |
| Not a user of this account | `404` | `User not found` |

### `GET /users/:externalId/limits`

Everything that applies to this user's next request: both plans, this period's
usage and remaining allowance at both levels, and the **effective** limits (the
tighter of the two). **Auth:** `x-api-key`.

```bash
curl http://localhost:3000/users/alice/limits -H "x-api-key: $KEY"
```

`200 OK`

```json
{
  "externalId": "alice",
  "account": {
    "plan": { "id": 1, "name": "Starter", "scope": "account", "isPredefined": true, "version": 1,
              "monthlyAllowance": 10000, "maxPerRequest": 100, "dailyAllowance": null },
    "monthly": { "limit": 10000, "used": 10, "remaining": 9990 },
    "daily": null
  },
  "user": {
    "plan": { "id": 3, "name": "Basic", "scope": "user", "isPredefined": true, "version": 1,
              "monthlyAllowance": 1000, "maxPerRequest": 20, "dailyAllowance": 100 },
    "monthly": { "limit": 1000, "used": 10, "remaining": 990 },
    "daily": { "limit": 100, "used": 10, "remaining": 90 }
  },
  "effective": {
    "maxPerRequest": 20,
    "monthlyRemaining": 990,
    "dailyRemaining": 90,
    "maxUnitsNow": 20
  }
}
```

| Field | Meaning |
|---|---|
| `daily` | `null` when that plan has no daily rule |
| `effective.maxPerRequest` | The smaller of the two plans' per-request limits |
| `effective.monthlyRemaining` / `dailyRemaining` | The smaller remaining at either level (`dailyRemaining` is `null` if neither plan has a daily rule) |
| `effective.maxUnitsNow` | **The largest request that would be accepted right now** |

| Error | Status | Message |
|---|---|---|
| Not a user of this account | `404` | `User not found` |

This is a snapshot. Another request may use units before yours arrives, so
`POST /consume` is always the final answer.

### `GET /users/:externalId/usage`

One user's usage for a month. **Auth:** `x-api-key`.

| Query | Default |
|---|---|
| `month` | Current UTC month (`YYYY-MM`) |

```bash
curl http://localhost:3000/users/alice/usage -H "x-api-key: $KEY"
curl "http://localhost:3000/users/alice/usage?month=2026-09" -H "x-api-key: $KEY"
```

`200 OK`, current month:

```json
{
  "user": {
    "externalId": "alice", "month": "2026-10", "isCurrentMonth": true,
    "used": 30, "limit": 5000, "remaining": 4970,
    "requests": { "accepted": 1, "rejected": 0 }
  }
}
```

Past month:

```json
{
  "user": {
    "externalId": "alice", "month": "2026-09", "isCurrentMonth": false,
    "used": 0, "limit": null, "remaining": null,
    "requests": { "accepted": 0, "rejected": 0 }
  }
}
```

For past months `limit` and `remaining` are `null`, because the plan may have
changed since. A month with no activity returns zeros, not `404`.

| Error | Status | Message |
|---|---|---|
| Bad month | `400` | `month must be YYYY-MM` |
| Not a user of this account | `404` | `User not found` |

---

## Consume

### `POST /consume`

**The main endpoint.** Ask to consume units for a user. The service checks
both the account plan and the user plan. If every rule passes, it adds the
units to both the user's and the account's totals. Otherwise it consumes
nothing. Either way the decision is recorded. **Auth:** `x-api-key`.

| Body field | Type | Required | Rule |
|---|---|---|---|
| `userId` | string | yes | The user's `externalId` in this account |
| `units` | integer | yes | ≥ 1 |
| `requestId` | string | yes | 1–200 characters, unique per account. The retry key. |

```bash
curl -X POST http://localhost:3000/consume \
  -H "content-type: application/json" -H "x-api-key: $KEY" \
  -d '{"userId": "alice", "units": 10, "requestId": "doc-1"}'
```

#### Accepted: `200 OK`

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

#### Rejected: also `200 OK`

A rejection is a valid decision, not an error. Example: 25 units against a
user plan with a maximum of 20 per request.

```json
{
  "requestId": "doc-2",
  "accepted": false,
  "replayed": false,
  "decidedAt": "2026-10-19T10:55:03.449Z",
  "units": 25,
  "rejection": {
    "rule": "max_per_request", "level": "user",
    "limit": 20, "used": null, "requested": 25, "resetsAt": null
  },
  "violations": [
    { "rule": "max_per_request", "level": "user", "limit": 20, "used": null, "requested": 25 }
  ],
  "account": { "plan": { "…": "…" }, "monthly": { "limit": 10000, "used": 10, "remaining": 9990 }, "daily": null },
  "user": { "externalId": "alice", "plan": { "…": "…" },
            "monthly": { "limit": 1000, "used": 10, "remaining": 990 },
            "daily": { "limit": 100, "used": 10, "remaining": 90 } }
}
```

A rejection by the shared account allowance looks like this (the account has
5 units left and the request asks for 10):

```json
"rejection": {
  "rule": "monthly_allowance", "level": "account",
  "limit": 10000, "used": 9995, "requested": 10,
  "resetsAt": "2026-11-01T00:00:00.000Z"
}
```

#### Response fields

| Field | Meaning |
|---|---|
| `accepted` | `true` if the units were counted |
| `replayed` | `true` if this is a stored decision returned for a retried `requestId` |
| `decidedAt` | When the decision was made (database clock, UTC) |
| `rejection` | `null` when accepted. Otherwise the **main** reason (see below). |
| `rejection.rule` | `max_per_request`, `monthly_allowance` or `daily_allowance` |
| `rejection.level` | `account` (the shared plan) or `user` (the user's own plan) |
| `rejection.limit` | The limit that was exceeded |
| `rejection.used` | Units used in that period before the request (`null` for `max_per_request`) |
| `rejection.requested` | The units asked for |
| `rejection.resetsAt` | When this rule could pass again: start of the next UTC month or day. `null` for `max_per_request`, which never passes on retry. |
| `violations` | **Every** rule the request broke, in the same order |
| `account`, `user` | The plan that was applied and the usage **after** this decision (`daily` is `null` when the plan has no daily rule) |

**Which rule is the main reason.** The one that blocks longest:
`max_per_request`, then `monthly_allowance`, then `daily_allowance`. For the
same rule, `account` comes before `user`.

#### Retries

| Situation | Result |
|---|---|
| Same `requestId`, same `userId` and `units` | `200` with the **original** decision and `"replayed": true`. Nothing is counted again, even if the plan or month changed. |
| Same `requestId`, different `userId` or `units` | `409` |
| Two copies sent at the same time | One decides, the other gets the replay |

Safe to retry on network errors, timeouts and `5xx`.

#### Errors

| Error | Status | Message |
|---|---|---|
| Missing or invalid `userId`, `units` (e.g. `0`, `-1`, `1.5`, `"5"`) or `requestId` | `400` | `userId (1-200 characters), a positive whole number of units and requestId (1-200 characters) are required` |
| Body isn't valid JSON | `400` | `Request body is not valid JSON` |
| User not registered in this account | `404` | `User not found` |
| `requestId` reused with a different user or amount | `409` | `requestId was already used with a different userId or units` |

---

## Usage

### `GET /usage`

The account's total usage for a month. **Auth:** `x-api-key`.

| Query | Default |
|---|---|
| `month` | Current UTC month (`YYYY-MM`) |

```bash
curl http://localhost:3000/usage -H "x-api-key: $KEY"
curl "http://localhost:3000/usage?month=2026-09" -H "x-api-key: $KEY"
```

`200 OK`

```json
{
  "account": {
    "month": "2026-10",
    "isCurrentMonth": true,
    "used": 10,
    "limit": 10000,
    "remaining": 9990,
    "requests": { "accepted": 1, "rejected": 1 }
  }
}
```

`used` is the sum of accepted units across all the account's users.
`requests` counts decisions in that month. `limit` and `remaining` are `null`
for past months.

| Error | Status | Message |
|---|---|---|
| Bad month | `400` | `month must be YYYY-MM` |

### `GET /usage/users`

The account total plus a page of its users' usage for the same month, so you
can see the account total is the sum of its users. **Auth:** `x-api-key`.

| Query | Default |
|---|---|
| `month` | Current UTC month |
| `limit` | 50 (max 100) |
| `offset` | 0 |

```bash
curl "http://localhost:3000/usage/users?limit=50" -H "x-api-key: $KEY"
```

`200 OK`

```json
{
  "account": { "month": "2026-10", "isCurrentMonth": true, "used": 10, "limit": 10000,
               "remaining": 9990, "requests": { "accepted": 1, "rejected": 1 } },
  "users": [
    { "externalId": "alice", "month": "2026-10", "isCurrentMonth": true, "used": 10,
      "limit": 1000, "remaining": 990, "requests": { "accepted": 1, "rejected": 1 } }
  ],
  "limit": 50,
  "offset": 0
}
```

Every user is listed, including those with no usage (`used: 0`).

| Error | Status | Message |
|---|---|---|
| Bad month, limit or offset | `400` | `month must be YYYY-MM; limit must be 1-100 and offset must be 0 or more` |

---

## History

### `GET /requests`

Every decision for this account, accepted or rejected, newest first.
**Auth:** `x-api-key`.

| Query | Default | Meaning |
|---|---|---|
| `userId` | all users | Only this user's requests |
| `outcome` | both | `accepted` or `rejected` |
| `month` | all time | Only requests decided in this UTC month (`YYYY-MM`) |
| `limit` | 50 | 1–100 |
| `offset` | 0 | |

```bash
curl "http://localhost:3000/requests?userId=alice&outcome=rejected&month=2026-10&limit=20" -H "x-api-key: $KEY"
```

`200 OK`

```json
{
  "requests": [
    { "requestId": "doc-2", "userId": "alice", "units": 25, "accepted": false,
      "rejection": { "rule": "max_per_request", "level": "user" },
      "decidedAt": "2026-10-19T10:55:03.449Z" },
    { "requestId": "doc-1", "userId": "alice", "units": 10, "accepted": true,
      "rejection": null, "decidedAt": "2026-10-19T10:55:03.047Z" }
  ],
  "hasMore": false,
  "limit": 20,
  "offset": 0
}
```

`hasMore` is `true` when another page exists (request the next one with
`offset + limit`). Retries aren't listed again: one row per `requestId`.

| Error | Status | Message |
|---|---|---|
| Empty or too long userId | `400` | `userId must be 1-200 characters` |
| Bad month | `400` | `month must be YYYY-MM` |
| Bad outcome | `400` | `outcome must be 'accepted' or 'rejected'` |
| Bad limit or offset | `400` | `limit must be 1-100 and offset must be 0 or more` |

### `GET /requests/:requestId`

One decision by its `requestId`, with the exact response that was returned and
the limits it was decided against. Useful to answer "why was this rejected?"
long after a plan has changed. **Auth:** `x-api-key`.

```bash
curl http://localhost:3000/requests/r-1 -H "x-api-key: $KEY"
```

`200 OK`

```json
{
  "request": {
    "requestId": "r-1",
    "userId": "alice",
    "units": 30,
    "accepted": true,
    "rejection": null,
    "decidedAt": "2026-10-20T10:38:33.716Z",
    "response": { "…": "the full POST /consume response that was returned" },
    "limitsSnapshot": {
      "account": {
        "plan": { "id": 342, "name": "Team", "version": 2, "isPredefined": false,
                  "monthlyAllowance": 600, "maxPerRequest": 50, "dailyAllowance": null },
        "usedBefore": { "monthly": 0, "daily": 0 }
      },
      "user": {
        "plan": { "id": 4, "name": "Premium", "version": 1, "isPredefined": true,
                  "monthlyAllowance": 5000, "maxPerRequest": 100, "dailyAllowance": null },
        "usedBefore": { "monthly": 0, "daily": 0 }
      }
    }
  }
}
```

`limitsSnapshot` records each plan **with its version** and the usage **before**
the request, so a decision can be re-checked by hand.

| Error | Status | Message |
|---|---|---|
| Unknown requestId (or another account's) | `404` | `Request not found` |

---

## Errors

Every error body is `{"message": "..."}`.

| Status | When |
|---|---|
| `400` | Invalid input, malformed JSON, plan of the wrong scope or not usable by this account |
| `401` | Missing or invalid `x-api-key`, wrong `x-admin-key` |
| `403` | Changing a predefined plan |
| `404` | Unknown route, user, plan or request (including other accounts' resources) |
| `409` | Duplicate user or plan name; `requestId` reused with a different body |
| `500` | Unexpected failure. Logged on the server; the body says only `Internal server error`. Safe to retry `POST /consume` with the same `requestId`. |

Note that a **rejected consume is `200`**, not an error. Check `accepted`.

---

## Typical integration

How an application (like the Docs Co example) uses the service:

```text
Setup (once)
  POST /admin/accounts           → save the apiKey in the app's backend config
  POST /plans                    → (optional) custom plans
  PUT  /account/plan             → (optional) use a custom account plan

When a user signs up in the app
  POST /users {externalId, planId}

Before every metered action
  requestId = new UUID for this action
  POST /consume {userId, units, requestId}
    accepted: true  → do the action
    accepted: false → show rejection.rule / level / resetsAt to the user
    timeout / 5xx   → retry with the SAME requestId

Showing a quota to a user
  GET /users/:externalId/limits  → effective.maxUnitsNow, remaining at both levels

Admin screens
  GET  /usage/users?month=…      → account total and per-user usage
  GET  /requests?…               → history
  PUT  /users/:externalId/plan   → upgrade or downgrade a user
  PATCH /plans/:id               → change limits, no redeploy
```
