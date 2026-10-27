# Integrated Sales, Order, Inventory & Delivery Management System

A production-ready ERP for a **bulk-commodity trading business** (Fertilizer, Coal, Grain…).
Quantities are in **MT (metric tons)**, currency is **BDT (৳)** and every date boundary is
evaluated in **Asia/Dhaka**.

Five job functions work on **one database**, each seeing and doing only what its role allows:

| Role | Main job |
|---|---|
| `FINANCE` | Publish daily product-wise selling rates |
| `SALES` | Create and track customer orders |
| `SALES_OPS` | Approve/reject orders, create Delivery Orders, control priority |
| `WAREHOUSE` | Stock entry, loading, dispatch, delivery update |
| `MANAGEMENT` | Read-only access to all dashboards and reports |
| `ADMIN` | Manage users, roles, products, customers, warehouses, configuration |

---

## 1. Run it in one command

```bash
docker compose up          # db + app (migrations + demo data run automatically)
# open http://localhost:3001
```

Optional database UI:

```bash
docker compose --profile tools up -d pgadmin   # http://localhost:5050
```

### Demo logins (created by the seed script, password `demo1234`)

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@sales-erp.local` | `demo1234` |
| Finance | `finance@sales-erp.local` | `demo1234` |
| Salesperson | `sales@sales-erp.local` | `demo1234` |
| Sales Operations | `salesops@sales-erp.local` | `demo1234` |
| Warehouse (Dhaka) | `warehouse.dhk@sales-erp.local` | `demo1234` |
| Warehouse (Chattogram) | `warehouse.ctg@sales-erp.local` | `demo1234` |
| Management | `management@sales-erp.local` | `demo1234` |

> Change `SEED_DEFAULT_PASSWORD`, `AUTH_SECRET` and the database password before using this
> with real data. `SEED_ON_START=false` disables the demo seed after the first run.

---

## 2. Local development (without Docker)

```bash
# 1. PostgreSQL (any 14+, 16/17 recommended)
docker run -d --name sales-erp-postgres \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sales_erp \
  -p 5433:5432 -v sales_erp_pgdata:/var/lib/postgresql/data postgres:17-alpine

# 2. install + configure
npm install
cp .env.example .env          # DATABASE_URL already points at localhost:5433

# 3. database
npm run db:deploy             # apply migrations (or `npm run db:migrate` while developing)
npm run db:seed               # demo users, products, warehouses, customers, stock, rates

# 4. run
npm run dev                   # http://localhost:3001
```

### Quality gates (all must pass)

```bash
npm run lint         # ESLint (flat config, eslint-config-next)
npm run typecheck    # tsc --noEmit, strict mode
npm run test         # Vitest: 100 unit + integration + concurrency tests against real Postgres
npm run build        # next build (Turbopack)
npm run test:e2e     # Playwright journeys (uses your installed Chrome/Edge via PW_CHANNEL)
```

The integration tests create and migrate their **own** database (`sales_erp_test`) automatically —
override with `DATABASE_URL_TEST`.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run db:migrate` | Create + apply a migration during development |
| `npm run db:deploy` | Apply pending migrations (used by the container entrypoint) |
| `npm run db:seed` | Idempotent demo data |
| `npm run db:reset` | Drop, recreate and (re)seed the development database |
| `npm run db:studio` | Prisma Studio |
| `npm run seed:load` | Create 10 000 orders for performance checks (`ORDER_COUNT=50000` to go bigger) |
| `./scripts/backup.sh` | Compressed `pg_dump` + retention + restore instructions |

---

## 3. The business rules that are enforced in code

Everything below is impossible to bypass from the UI, from the API, and (for quantities) from raw
SQL.

1. **Rate workflow** — Finance publishes a rate with an effective date/time. The rate is copied into
   the order at creation and **locked permanently**; later rate changes never touch existing orders.
   Rates are never edited in place (full history, one `ACTIVE` rate per product).
2. **Approval** — A Delivery Order cannot be created for an order that is not `APPROVED`. The
   approval screen shows the checks (rate validity at order time, quantity, customer active,
   credit limit) and the credit limit needs a written Sales Ops override.
3. **Delivery priority (strict, per customer)** — For the same customer an older active order
   **across any product** must be fully delivered before a newer one can be delivered. Enforced when
   a DO is created **and** again when a dispatch is recorded, both inside a transaction that takes a
   `SELECT … FOR UPDATE` lock on the customer row. Different customers never block each other.
   Sales Ops can grant a **Priority Override** with a mandatory reason (audited + reported).
4. **Partial delivery** — one order can be delivered over many days, DOs and warehouses.
   `remaining = ordered − delivered`. Total DO quantity can never exceed the order quantity and total
   dispatched can never exceed the DO quantity — also enforced by DB `CHECK` constraints.
5. **Warehouse allocation** — Sales Ops chooses the warehouse; the system validates
   `available = on_hand − reserved`, blocks otherwise, and **reserves** the quantity. Cancelling a DO
   releases the reservation; dispatching reduces `on_hand`. **Only Sales Operations may create or
   change a DO quantity** (the warehouse sees it read-only).
6. **Dispatch control** — a warehouse sees only its own DOs and cannot create a DO or change
   quantities. Duplicate challan numbers and over-dispatch are rejected. Partial dispatch keeps the
   DO in `PARTIALLY_DISPATCHED`.
7. **Stock** — per warehouse/product: opening, inward, outward, transfers, adjustments, closing,
   reserved, available. Every movement is an **immutable ledger row**, and the balance table is
   updated in the same transaction.
8. **Audit trail** — every create/update/approve/reject/cancel/dispatch/override writes an
   `audit_logs` row. The table is append-only: a database trigger rejects `UPDATE`, `DELETE` and
   `TRUNCATE`.

### Document numbers (all generated, no typing)

| Document | Format | Example |
|---|---|---|
| Sales order (SO) | `SO` + `DDMMYYYY` + 3-digit daily counter | `SO19102026001` |
| Delivery order (DO) | `DO` + `DDMMYYYY` + 3-digit daily counter | `DO19102026002` |
| Challan | `CH` + `DDMMYYYY` + 3-digit daily counter (auto on dispatch) | `CH19102026004` |
| Customer code | `CUS-NNNNNN` (never editable) | `CUS-000001` |
| Transfer / stock count | `TRF-YYYY-NNNNNN` / `PC-YYYY-NNNNNN` | `TRF-2026-000007` |

The counters live in the `sequences` table and are incremented with one atomic
`INSERT … ON CONFLICT DO UPDATE … RETURNING`, so simultaneous users can never receive the same number.
The date part always comes from **Asia/Dhaka**.

---

## 4. Screens

| Area | Screens |
|---|---|
| Auth | Sign in (rate-limited), change password, sign out |
| Dashboard | Role-aware KPIs, today's rates, rate-history chart, stock chart, pending approvals, top customers, salesperson performance |
| Finance | Publish rate, current rates, full rate history + rate-change chart |
| Sales | New order (locked rate shown live), my orders, order detail with timeline, progress bar, printables |
| Sales Ops | Approval queue with checks, customer priority queue, DO creation (warehouse + availability + override), DO list/detail |
| Warehouse | My DOs, dispatch entry, dispatch register, stock & inward, opening stock, transfers, physical counts |
| Reports | 12 reports, each with filters and **Excel / PDF / CSV** export |
| Admin | Users & roles, products, customers, warehouses, settings, audit log viewer |
| Admin (bulk) | Bulk add for products / customers / warehouses - paste from Excel or load a CSV, check the rows, then import |
| Communication | Chat: 3 fixed rooms (Operation - Sales, Operation - Warehouse, Announcement), unread badge, order/DO tags, @mentions |
| Printables | Order confirmation, DO copy, dispatch challan (screen print + server-rendered PDF) |

Every list has search, filters, sorting and pagination. The UI is responsive and works on phones;
a Bangla language toggle can be added later because all copy lives in the page/component layer.

---

## 5. Architecture in one minute

```
src/app/(app)/**            server components: screens (role-gated)
src/app/api/**              route handlers: health, logout, report export, printable PDFs
src/actions/**              server actions: Zod validation + permission check + service call
src/server/services/**      ALL business logic (orders, priority, DO, dispatch, stock, transfers,
                            counts, rates, reports, exports, printables, audit)
src/lib/**                  prisma, decimal, dates (Asia/Dhaka), auth, rbac, audit, errors,
                            numbering, settings, validation, state machines
prisma/schema.prisma        data model (+ raw CHECK constraints & audit triggers in the migration)
```

See `docs/ARCHITECTURE.md` for the full walkthrough (locking strategy, numbering, reporting engine),
`docs/USER_GUIDE.md` for per-role step-by-step instructions, `docs/ASSUMPTIONS.md` for every
decision made where the brief was open, and `docs/HUMAN_TODO.md` for the few things only a human
can do.

---

## 6. Deployment to an office server or cloud VM

```bash
git clone <repo> && cd sales-erp
cp .env.example .env
#  set POSTGRES_PASSWORD, AUTH_SECRET (openssl rand -base64 48) and DATABASE_URL
docker compose up -d --build
docker compose ps                  # both services must be healthy
curl http://localhost:3001/api/health
```

### Production hardening (already wired in)

* **Secrets are mandatory.** `docker compose` refuses to start without `AUTH_SECRET` and
  `POSTGRES_PASSWORD` (`${VAR:?message}`), and the app re-checks `AUTH_SECRET` at boot
  (`src/instrumentation.ts`): a missing, short or placeholder secret crashes the server instead
  of silently signing sessions with a public value.
* **No demo data.** `SEED_ON_START` defaults to `false`; even if it is enabled, the seed script
  skips any database that already contains orders. Demo users (`demo1234`) are never created in
  production.
* **The database is not exposed.** Port 5433 is published on `127.0.0.1` only (override with
  `DB_BIND_ADDRESS` for a deliberate maintenance window).
* **Password resets are enforced.** When an administrator resets a password the account is
  redirected to `/change-password` and cannot use the rest of the system until it is changed.
* **Error pages do not leak internals.** In production the error boundary shows a generic message
  plus a digest; the raw exception stays in the server log.
* **Report caps are visible.** A report that reaches 5 000 rows shows a warning on screen and the
  same warning is written into the Excel / PDF / CSV export, so a partial export is never mistaken
  for a complete one.

### Backups (do this before going live)

```bash
./scripts/install-backup-cron.sh    # daily 01:15 backup, keeps BACKUP_KEEP_DAYS (14)
./scripts/backup-docker.sh          # run one now and check the output
./scripts/restore-docker.sh backups/sales_erp_YYYY-MM-DD_HHMMSS.dump   # restore drill
```

`backup-docker.sh` dumps inside the db container (nothing to install on the host), writes to a
temporary file, verifies it with `pg_restore --list` and only then renames it. Copy `backups/` to
another disk or off-site storage - a backup on the same machine is not a backup.

### Go-live checklist

1. Fresh database (do **not** reuse the demo database) and a real `AUTH_SECRET`.
2. Create the real users (Admin -> Users & roles): at least one ADMIN, Finance, Sales Ops, one
   account per warehouse. Delete the demo accounts if they exist.
3. Master data: warehouses, products, customers, opening rates - all three screens have **Bulk add**.
4. Opening stock per warehouse/product (Warehouse -> Stock & inward -> **Bulk entry**).
5. One full test chain: order -> approve -> DO -> dispatch -> challan -> report/export.
6. Install the backup cron and **restore the dump into a scratch database once**.
7. Put TLS in front (Caddy/nginx) - passwords must never travel over plain HTTP.

### Scaling and operations

* The app is stateless apart from the database and the in-process login rate limiter. To run more
  than one instance, move the rate limiter to Redis (see `docs/ASSUMPTIONS.md`).
* Docker Hub is not required: `docker compose up --build` builds the image on the server.
* Health: `GET /api/health` reports the database latency; point an uptime monitor at it.

---

## 7. Tech stack

TypeScript (strict) · Next.js 16 App Router · React 19 · PostgreSQL 16/17 · Prisma 6 ·
Tailwind CSS 4 · shadcn/ui-style components (Radix primitives) · Recharts · Zod · bcryptjs +
jose (signed httpOnly session cookies) · ExcelJS + PDFKit · Vitest · Playwright · Docker Compose.
