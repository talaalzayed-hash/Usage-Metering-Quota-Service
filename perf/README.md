# Performance and concurrency tests

`perf/load-test.ts` drives the running service with many concurrent requests,
then checks correctness straight in PostgreSQL. For every scenario the account
counter must equal the units the client saw accepted, the sum of the user
counters, and the accepted units in the request history.

It has no dependencies beyond the project's own (`pg`, `dotenv`, `tsx`).

## How to run

Recommended: run inside the Compose network, so the numbers measure the
service and not Docker Desktop's port forwarding from the host.

```bash
docker compose up --build -d
docker compose --profile perf run --rm perf
```

From the host instead (needs `npm install`; the slower port forwarding adds latency):

```bash
npm run perf
```

Settings are environment variables: `CONCURRENCY` (default 64 requests in
flight), `DURATION` (20 seconds for the time-based scenarios), `BASE_URL`,
`DATABASE_URL`, `ADMIN_API_KEY` (read from `.env` when not set) and `OUT` (the
results file). The run exits with code 1 if any correctness check fails.

## Scenarios

| Scenario | What it does | What must hold |
|---|---|---|
| `spread` | 20 accounts × 5 users, random 1–10 units, 20 s | all accepted, ledger agrees for every account |
| `hot-account` | 1 account × 20 users, random 1–10 units, 20 s | all accepted, ledger agrees |
| `exhaust-account` | 3,000 one-unit requests from 20 users, account allowance 1,000 | exactly 1,000 accepted; every rejection is the **account** monthly allowance; `GET /usage` shows 0 remaining |
| `exhaust-user` | 1,500 one-unit requests from 1 user, user allowance 500 | exactly 500 accepted; every rejection is the **user** monthly allowance |
| `retries` | 500 requestIds, each sent 4 times concurrently | no 500s, one decision and one history row per requestId, units counted once |
| `plan-changes` | 10-unit requests for 20 s; after ⅓ the user plan's max per request drops 20 → 5; after ⅔ the account allowance drops below current usage | requests that ran between two changes all see the new rule; 0 remaining after the cut |

## Results

Run on 2026-10-19 with `docker compose --profile perf run --rm perf`: Windows 11,
8 CPUs, Docker Desktop, 64 requests in flight. Raw data: `results/docker-2026-10-19.json`.

| Scenario | Requests | Req/s | p50 ms | p95 ms | p99 ms | Accepted | Rejected | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| spread | 7,736 | 385 | 157 | 242 | 289 | 7,736 | 0 | 0 |
| hot-account | 2,355 | 115 | 524 | 881 | 1,207 | 2,355 | 0 | 0 |
| exhaust-account | 3,000 | 148 | 399 | 689 | 887 | 1,000 | 2,000 | 0 |
| exhaust-user | 1,500 | 160 | 363 | 620 | 752 | 500 | 1,000 | 0 |
| retries | 2,000 | 248 | 238 | 407 | 556 | 2,000 | 0 | 0 |
| plan-changes | 5,381 | 262 | 131 | 603 | 820 | 986 | 4,395 | 0 |

**All 39 correctness checks passed.** No overspend, no double counting, no errors.

## What we learned

- **Correctness held under contention.** With 64 requests racing for the last
  units, the account accepted exactly its allowance, and concurrent retries were
  counted exactly once.
- **One account is serialized by design.** Every consume of an account locks
  that account's monthly counter row, so a single busy account (`hot-account`,
  115 req/s) is slower than load spread over many accounts (`spread`, 385 req/s).
  This is the price of exact totals. Different accounts don't block each other.
- **Measure from the right place.** The same simple endpoint did 561 req/s from
  the Windows host but 1,910 req/s from inside the Docker network. Docker
  Desktop's port forwarding was the biggest cost, which is why the runner is a
  Compose service.
- **The database is the busy side.** During the runs the API used about 40% CPU
  while Postgres used 100–200%. A commit costs about 1 ms (measured with
  pgbench), so disk sync is not the limit. The work is the transaction's
  several round trips while the counter lock is held.
- **Tried and not adopted:** locking the counters with `SELECT … FOR UPDATE`
  instead of the no-op upsert. The upsert writes a new row version on every lock
  (`usage_counters` saw ~6 row updates per consume). The change raised
  `hot-account` from 115 to 153 req/s but made three other scenarios slower in
  the same run, so it was not a clear win and the original code was kept.

## Known limitations

- The load generator runs on the same machine as the stack, so they compete
  for CPU.
- Results come from Docker Desktop on Windows and would differ on a Linux server.
- One API process and the default `pg` pool of 10 connections. The pool size was
  not tuned.
