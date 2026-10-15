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

## Verification snapshot

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ clean (0 errors, 0 warnings) |
| Types | `npm run typecheck` | ✅ clean (strict mode) |
| Tests | `npm run test` | ✅ **74 passed / 74** across 9 files (run against a real PostgreSQL) |
| Build | `npm run build` | ✅ all 38 routes compiled with Turbopack |
| E2E | `npm run test:e2e` | ⚠️ specs implemented (auth, order lifecycle, warehouse, exports). The first execution surfaced a Next 16 dev-origin restriction on `127.0.0.1`, which was fixed (`allowedDevOrigins` + `localhost` base URL); the confirmation run is pending a working database — see the note below. |
| Docker | `docker compose config` | ✅ compose file validated (exit 0) |
| Docker | `docker compose up --build` | ⚠️ **not verified on this machine** — see the note below. |

### Environment note (2026-10-15)

Two environment failures happened on the build machine and are **not** code defects:

1. **Drive `C:` ran out of space** (0 bytes free at the worst point). The image build needs
   several GB, and Docker Desktop stores its data on `C:`. The build aborted with
   `TAR_ENTRY_ERROR EIO` / `rpc error: code = Unavailable`.
2. Docker Desktop then failed to restart —
   `mounting WSL VHDX: Wsl/Service/AttachDisk/CreateVm/ERROR_TIMEOUT`. The existing images and
   volumes (including the other projects' databases) are intact on disk; WSL simply could not
   attach the data disk. A Windows restart (or a Docker Desktop repair) restores it.

Everything that does **not** need the container engine was verified before and after the outage:
lint, typecheck, the 74-test suite, the production build and `docker compose config`.

**To finish verification after the machine is restarted:**

```powershell
# 1. space (the build needs several GB free on C:)
docker system df ; docker builder prune -f

# 2. the one-command start required by the Definition of Done
docker compose up --build -d
docker compose ps            # db + app must both be healthy
curl http://localhost:3001/api/health

# 3. quality gates against the bundled database
npm run test                 # 74/74
npm run test:e2e             # Playwright journeys (PW_CHANNEL=chrome|msedge picks a local browser)
npm run seed:load            # 10 000 orders, then check the list/report screens stay fast
```
