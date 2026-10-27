# Progress log

One entry per implementation phase, in the order the brief specified. Each phase was built, then
verified (`lint` + `typecheck` + `test` + `build`) before moving on.

---

## Phase 0 — Setup ✅

* Next.js 16 (App Router) + React 19 + TypeScript (strict) + Tailwind CSS 4, ESLint (flat config),
  Prettier, Vitest, Playwright, Docker + Compose, `.env.example`, folder structure, `docs/`.
* Adopted the repository's existing conventions (Next 16, Prisma 6, the same ESLint/Tailwind setup)
  and read the bundled Next 16 docs before writing code (async `params`/`searchParams`,
  `proxy.ts` instead of `middleware.ts`, top-level `serverExternalPackages`, `next lint` removal).
* The project was created on `D:\sales-erp` because `C:` had no free space; npm's cache was pointed
  at `D:\npm-cache`.

## Phase 1 — Foundation ✅

* Prisma schema: 18 tables (users, sessions, products, customers, warehouses, rates, orders,
  order_items, delivery_orders, delivery_order_items, dispatches, dispatch_items, stock_balances,
  stock_ledger, stock_transfers, stock_counts, audit_logs, system_settings, sequences).
* Migration `20261015045019_init` extended by hand with: 15 `CHECK` constraints (non-negative stock,
  `reserved <= on_hand`, `allocated/delivered <= qty`, positive quantities and rates, transfers
  between different warehouses), two **append-only triggers** on `audit_logs` and four indexes for
  the hot queue queries.
* Auth (bcrypt + signed httpOnly cookie + revocable `sessions` rows), login rate limiting, CSRF
  origin check, the central role→permission map, the audit helper, the Asia/Dhaka date layer, the
  Decimal layer, document numbering, state machines, Zod schemas.
* Admin CRUD for users, products, customers, warehouses, settings; role-aware shell and navigation.

## Phase 2 — Rate and Order ✅

* Finance: publish rate (append-only, supersedes the previous one), current rates, full history with
  filters and a 30-day rate chart.
* Sales: new-order form with live locked-rate display, order list with search/filter/sort/pagination,
  order detail with lines, timeline, progress bar and printable confirmation.
* The rate is copied and locked at creation; `order_seq` per customer is allocated under the customer
  row lock.

## Phase 3 — Approval and Delivery Orders ✅

* Approval queue with the four checks on screen (rate validity, quantity, customer active, credit
  limit with reason-override), reject with reason, Sales-Ops-only rate override, cancel and
  short-close flows.
* `assertCustomerPriority()` (customer `FOR UPDATE` lock → queue head) used by **both** DO creation
  and dispatch, with the documented `PRIORITY_BLOCKED` message.
* DO creation with manual warehouse choice, `available = on_hand − reserved` validation, reservation,
  priority override with mandatory reason, DO list/detail and cancellation with release.
* Customer priority queue screen showing blockers per customer.

## Phase 4 — Warehouse and Dispatch ✅

* Stock service: locked balance rows, immutable ledger, reserve/unreserve, inward, opening,
  adjustment, dispatch-out.
* Dispatch entry (truck, driver, challan, loading/dispatch dates, partial quantities), duplicate
  challan and over-dispatch rejection, automatic DO and order status updates, multi-warehouse
  delivery, dispatch register.
* Stock transfers (request → approve/reserve → in transit → receive) and physical counts with
  approved adjustments; stock balances, ledger viewer, transfers and counts screens.

## Phase 5 — Dashboard and Reports ✅

* Role-aware dashboard (KPIs, today's rates, rate chart, stock chart, pending approvals, pending MT
  by product, top customers, salesperson performance).
* 12 reports with a single definition feeding the screen, Excel (`exceljs`), PDF (`pdfkit`) and CSV.
* Printable order confirmation, DO copy and dispatch challan — the same payload drives the HTML print
  page and the server-rendered PDF. Audit log viewer with filters and before/after JSON.

## Phase 6 — Hardening ✅

* **74 automated tests** in 9 files (Vitest, against a real PostgreSQL):
  all 12 must-pass scenarios from the brief, including concurrency (20 parallel dispatches on one DO,
  12 parallel DO creations on one order, parallel dispatches against a blocked order) and the
  append-only audit guarantees (UPDATE/DELETE/TRUNCATE rejected by the database).
* `npm run seed:load` creates 10 000 orders for the performance check; list screens are paginated and
  the stress run kept every page responsive.
* Mobile pass (sidebar collapses, tables scroll horizontally, forms are single-column on phones),
  accessibility basics (labels, `aria-invalid`, focus rings, `role="alert"` messages), error handling
  pass (every business error has a code and an exact message shown inline *and* as a toast).

## Phase 7 — Deployment and docs ✅

* Production `Dockerfile` (multi-stage) + `docker-entrypoint.sh` (wait for Postgres → `migrate
  deploy` → idempotent seed → serve), `docker-compose.yml` (db + app + optional pgadmin, health
  checks, persistent volumes).
* `scripts/backup.sh` (compressed `pg_dump`, retention, restore instructions), `.env.example`,
  `README.md`, `docs/ARCHITECTURE.md`, `docs/USER_GUIDE.md`, `docs/ASSUMPTIONS.md`,
  `docs/HUMAN_TODO.md`, this log.

---

## Post-build increments (2026-10-17, requested by the product owner)

These were added after the initial hand-over, each verified with tests and in the running app.

1. **Sales Ops can correct a pending order** (`order.editPending`) — quantity, rate and remarks, with a
   mandatory reason and line-by-line audit. Prevents "reject and re-enter" for a simple typo.
2. **Rate validity window** — `rates.effective_to` (optional). Default is unchanged: a rate stays
   active until the next one is published; an explicit end date makes it expire automatically
   (`RATE_EXPIRED`). Shown on Current rates, Rate history, the dashboard and the rate-history report.
3. **Dispatch date rule** — the dispatch date can never be earlier than the loading date (same day is
   fine). Enforced in the form (`min` + inline error), in Zod and in the service (Asia/Dhaka day).
4. **Quantities belong to Sales Operations** — new setting `warehouse_partial_dispatch` (default
   **false**): the warehouse records vehicle/challan/dates only and ships the full DO; a smaller
   shipment is a smaller DO. `do.edit` lets Sales Ops correct a DO's quantities before dispatch
   (reservation released and re-taken, audit + reason).
5. **Bug fixed** — a DO could only be dispatched twice; the second partial shipment failed as
   `PARTIALLY_DISPATCHED → PARTIALLY_DISPATCHED`. The DO and order rows are now re-read after their
   `FOR UPDATE` locks, and a repeated "still partial" status is a no-op instead of a transition.
6. **Bug fixed** — creating any non-warehouse user from the admin screen failed with a foreign-key
   violation (empty string instead of `NULL`).

## Verification snapshot

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASS - clean (0 errors, 0 warnings) |
| Types | `npm run typecheck` | PASS - clean (strict mode) |
| Tests | `npm run test` | PASS - **100 / 100** across 12 files, against a real PostgreSQL |
| Build | `npm run build` | PASS - all 38 routes compiled, no warnings |
| E2E | `npm run test:e2e` | PASS - **13 / 13** journeys against the running container |
| Docker | `docker compose config` | PASS - compose file validated (exit 0) |
| Docker | `docker compose up` | PASS - image builds, both services healthy, migrations and the idempotent seed run inside the container, `/api/health` returns `{"status":"ok","database":"up"}` |

### Verification notes (2026-10-17)

Everything above was re-run after the last code change, on this machine, against the real database.

* **End-to-end walkthrough by hand (browser):** login -> dashboard (rates 18,500 / 45,000 / 39,000 BDT)
  -> new order (rate locked live) -> approve (the four checks on screen) -> delivery order with
  warehouse availability and the queue panel -> dispatch -> order `PARTIALLY_DELIVERED`.
  Database cross-check: on-hand 5000 -> 4980 MT, `reserved` back to 0, ledger `RESERVE +20` /
  `OUTWARD -20`, audit rows for CREATE / APPROVE / DISPATCH, challan unique. Printables returned 200
  and the report exports produced a real `.xlsx` (PK magic, 7 283 B) and `.pdf` (%PDF, 2 113 B).
* **Two UI defects were found and fixed during that walkthrough** (money printed without thousands
  separators; `MT` repeated under headers that already say `(MT)`) - commit
  "fix(ui): money values keep their thousands separators and quantity cells stop repeating MT".
* **Docker build gotcha (Windows):** the build context once delivered **0-byte** copies of
  `next.config.ts`, `tsconfig.json` and `docker-entrypoint.sh`. The image died with
  `exec ./docker-entrypoint.sh: exec format error`, and an empty `next.config.ts` would have silently
  dropped `serverExternalPackages` (breaking the Excel/PDF routes). The `Dockerfile` now fails the
  build if those files arrive empty, and it strips CRLF from the entrypoint.
* **Machine note:** `C:` kept filling up and took the Docker engine down with it. Docker's 9.3 GB data
  disk was moved to `D:\docker\data` (`%LOCALAPPDATA%\Docker\wsl\disk` is a junction to it); all
  images and volumes were preserved and `C:` now has about 10.6 GB free. See `HUMAN_TODO.md` section 6.

## Document numbering (2026-10-19)

* **Sales order** is now date based: `SO-19-10-2026-001` (3-digit counter per Asia/Dhaka day,
  atomic in the `sequences` table). Prefix is still configurable (`ORDER_NO_PREFIX`).
* **Delivery order** is derived from its sales order: `SO-19-10-2026-001-DO-01`, `-DO-02`, so a DO
  always tells you which SO it belongs to.
* **Challan** is generated on dispatch, dated with the dispatch day: `CH-19-10-2026-001`. The
  warehouse field is now optional - type a value only when a physical challan already has a number;
  otherwise the system numbers it.
* Verified live in the container: order `SO-19-10-2026-001` -> DO `SO-19-10-2026-001-DO-01` ->
  dispatch with the challan box left empty produced `CH-19-10-2026-001`. Suite 115/115.

## Numbering, chat and bulk add (2026-10-19, second pass)

* **Number format simplified (owner request):** no separators inside the number.
  `SO19102026001` (sales order), `DO19102026001` (delivery order - its own daily counter, no longer
  derived from the SO number) and `CH19102026001` (challan, dated with the dispatch day). The old
  hyphenated numbers (`SO-19-10-2026-001`) were replaced in the existing rows as well, and the
  sequence keys were aligned so the next order continues correctly.
* **Chat module** (`/chat`): three fixed rooms - Operation - Sales, Operation - Warehouse,
  Announcement - and **no direct messages**. Room membership is a permission (`chat.sales`,
  `chat.warehouse`, `chat.announce`), so a salesperson cannot read or post in the warehouse room even
  by calling the API with a guessed room key. Messages are append-only (no PUT/DELETE endpoint), can
  be tagged with an order / DO, support @mentions (only members of that room can be mentioned) and
  every post writes a `CHAT_POST` audit row. Unread counts poll every 10s in the top bar, the open
  room polls every 7s. 11 tests.
* **Bulk add** for Products / Customers / Warehouses: paste from Excel (tab separated) or load a CSV,
  optional header row with column-name matching, "Check rows" preview (ready / duplicate / error with
  the reason), then "Import N row(s)". Existing codes and existing customer name+phone pairs are
  never overwritten. Each imported row is created through the normal service, so it is audited and
  customer codes stay system-generated. CSV template per entity.

## Stock entry date + bulk stock entry (2026-10-27)

* **Entry date on stock movements.** `stock_ledger` gained `movement_date` (the day the stock actually
  moved) next to `created_at` (the day it was typed). The Inward and Opening forms have a date field:
  today by default, past days allowed (goods often arrive the evening before or are typed in the next
  morning), future dates refused. The ledger and the stock-ledger report filter and sort by
  **movement date** and still show the recorded time.
* **Bulk stock entry** on `/warehouse/stock`: paste from Excel / load a CSV, choose *Inward receipt* or
  *Opening stock*, the warehouse and one entry date for the batch, then check-then-import. Unknown or
  inactive product codes and repeats in the list are reported; an opening balance is refused for a
  product that already has movements. CSV template per mode. Same audited service path as the single
  entry forms, so every row lands in the ledger and the audit trail.
* Tests: `tests/stock-entry.test.ts` (movement date persisted and distinct from `created_at`, future
  date rejected, opening-once rule, bulk parser with/without header, column mapping). Suite 132/132.

## Production hardening (2026-10-27)

Going live 1 January. Audit findings that were fixed in code/config:

* **Secrets are mandatory**: `docker compose` uses `${AUTH_SECRET:?...}` and
  `${POSTGRES_PASSWORD:?...}` (no public fallback), and `src/instrumentation.ts` crashes the
  production server if `AUTH_SECRET` is missing, shorter than 32 chars or still a known placeholder.
* **No demo backdoor**: `SEED_ON_START` defaults to `false`; the seed script additionally refuses to
  run when the database already has orders (`SEED_FORCE=1` overrides, for demo machines only).
* **Database not on the LAN**: port 5433 is published on `127.0.0.1` (`DB_BIND_ADDRESS`).
* **Password reset enforced**: `/change-password` moved outside the `(app)` layout; that layout
  redirects there while `mustChangePassword` is true, so a reset password cannot be kept forever.
* **Error boundary** hides raw exception text in production (digest only); the details stay in the
  server log.
* **Report caps are visible**: `REPORT_ROW_LIMIT` (5000) truncation now sets a `truncated` flag -
  an amber warning on the report page and a warning line in Excel / PDF / CSV.
* **Order back-dating is super-admin only**: the order date picks the locked rate, so SALES cannot
  send one (`createOrder` rejects it); the form hides the field for them and the action strips it.
  Future dates are rejected for everyone. 4 new tests (`tests/production-rules.test.ts`).
* **Backups**: `scripts/backup-docker.sh` (dump inside the db container, verify with
  `pg_restore --list`, atomic rename, prune), `scripts/install-backup-cron.sh`,
  `scripts/restore-docker.sh`. README gained a go-live checklist.

## Rate floor: never below the published rate (2026-10-27)

Owner rule: *"rate er niche .00001 tk o allow na"*. Implemented as a hard floor in
`order.service`:

* `overrideOrderItemRate` and `editPendingOrder` compare the new rate with the rate Finance
  published for that product on the order date (falling back to the locked rate if the rate has
  since expired). Anything below it is rejected with
  *"The rate cannot be below the published rate of X - not even by 0.01. To sell lower, Finance must
  publish a new rate."* Raising a rate is allowed and stays audited (old + new value + reason).
* `getOrderDetail` now exposes `publishedRatePerMt` per line, so the override dialog shows the floor,
  sets `min` on the input and explains the rule; the "edit order" dialog carries the same warning.
* Two older tests that deliberately lowered a rate were rewritten (they now prove an upward
  correction; the downward case is covered by `tests/production-rules.test.ts`).
* Note: `docker compose` now publishes Postgres on `127.0.0.1` only, so local `DATABASE_URL`s use
  `127.0.0.1` instead of `localhost` (on Windows `localhost` resolves to IPv6 `::1`, which is no
  longer bound). Suite: 137/137.
