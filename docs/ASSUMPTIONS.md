# Assumptions and decisions

The brief said: *"When something is ambiguous, choose the most sensible option, record it here and
continue."* This is that record. Nothing here changes a stated business rule — it only fills gaps.

## Product / scope

1. **Order = one customer + one or more product lines.** Priority, status and remaining quantity are
   tracked at **order** level (as specified); `order_items` holds the per-product detail.
2. **`do_allocated_mt`** count only **non-cancelled** delivery orders, and cancelling a DO or
   short-closing an order releases it, so "remaining to allocate" is always trustworthy.
3. **A DO cannot be amended** after creation (only cancelled while nothing has been dispatched).
   Quantities are corrected by cancelling and creating a new DO — simpler and fully audited.
4. **An order can be cancelled only while nothing has been delivered** (as specified). If a DO exists
   but nothing shipped, cancelling the order cancels that DO and releases its reservation
   automatically instead of forcing the user to clean up first.
5. **Short close** cancels the order's open (CREATED) DOs, releases their reservations and abandons
   the outstanding quantity; delivered quantity and its value are untouched.
6. **Rate override** (optional in the brief) is implemented for **Sales Ops only**, only while the
   order is `PENDING_APPROVAL`, with a mandatory reason, and it re-computes the line and order value.
7. **Credit limit check** is a *warning with override* (per the brief). Exposure = remaining value of
   all `APPROVED`/`PARTIALLY_DELIVERED` orders + this order's value. It is skipped when the customer
   has no limit, and can be switched off in Settings.
8. **Customer becomes inactive** → new orders and approval are blocked, historical documents still
   render. Master data is **deactivated, never deleted**; deactivation is refused while open
   documents exist.
9. **Stock transfers** reserve at the source on **approval** (so the goods cannot be allocated
   elsewhere while in transit) and consume the reservation on **release/in-transit**.
10. **Opening stock** is allowed once per warehouse+product; later corrections use inward entries or
    an approved physical count.
11. **Physical count approval** requires a reason whenever the difference is non-zero, and refuses an
    adjustment that would push on-hand stock below the reserved quantity.

## Technical choices

12. **Next.js 16 (App Router) + Turbopack**, React 19, TypeScript strict. `params`/`searchParams` are
    awaited (v16 requirement); caching is **off** for data pages (`export const dynamic =
    "force-dynamic"`) because every screen must show live data. `cacheComponents` is deliberately not
    enabled.
13. **`src/lib/auth.ts` implements sessions itself** (bcrypt + `jose`-signed cookie + a `sessions`
    table) instead of Auth.js: it keeps revocation, role checks and warehouse scoping explicit and
    dependency-light.
14. **shadcn/ui approach, hand-written.** The components in `src/components/ui` follow shadcn/ui
    conventions (Radix primitives + `class-variance-authority` + Tailwind tokens) but were written
    into the repo rather than generated, so the build has no CLI/network dependency. **Native
    `<select>`** is used instead of Radix Select: on mobile browsers it behaves better and data entry
    is faster.
15. **Tailwind CSS v4** via the documented `@tailwindcss/postcss` plugin (no `tailwind.config.js`;
    tokens live in `globals.css`).
16. **Prisma 6 + a hand-edited migration.** `prisma migrate dev` generated the schema, and the same
    migration file was extended (before applying) with the `CHECK` constraints, the audit-log
    triggers and the partial indexes — Prisma has no first-class syntax for those.
17. **`prisma.seed` still lives in `package.json`.** Prisma 6 warns that it will move to
    `prisma.config.ts` in Prisma 7; migrating immediately would add a config file with no benefit
    today.
18. **Fonts**: the UI loads *Noto Sans Bengali* via CSS `@import` with a system fallback stack
    (Nirmala UI on Windows, Noto on Android/Linux). This keeps the build working offline.
    **PDFKit cannot encode ৳ or Bengali with its built-in fonts**, so PDFs print `BDT` instead of ৳
    until `PDF_FONT_PATH` points at a Unicode TTF (see `HUMAN_TODO.md`). The HTML UI always shows ৳.
19. **Login rate limiting is in-process** (fixed window: 10 per account, 40 per IP, per 15 min).
    Correct for a single instance; documented as a Redis candidate for multi-instance deployments.
20. **`DATABASE_URL` pool settings** (`connection_limit`, `pool_timeout`) are part of the template:
    the concurrency rules only hold if the pool is not the bottleneck.
21. **Tests run against a real PostgreSQL** (`sales_erp_test`, created and migrated automatically)
    because row locking, CHECK constraints and triggers are part of the behaviour under test. A mock
    would prove nothing. `fileParallelism` is off because all files share one database.
22. **Ports**: the app listens on **3001** (3000 is commonly taken by other local projects) and the
    bundled Postgres maps to **5433** on the host for the same reason.
23. **E2E specs are written defensively** — if the demo database has no pending order or no open DO,
    the spec skips with an explicit reason instead of failing, so `npm run test:e2e` is meaningful on
    a fresh database and after a day of use.
24. **Order and DO numbering** is `ORD-<year>-<6 digits>` / `DO-<year>-<6 digits>` with year from
    Asia/Dhaka; the prefix is configurable via env (`ORDER_NO_PREFIX`, …).

## Environment note

25. The project lives at **`D:\sales-erp`** because drive `C:` had no free space when it was created.
    `D:\sales-erp\.npmrc` points npm's cache at `D:\npm-cache` and is git-ignored (it is
    machine-specific). Nothing else depends on the drive letter.
26. **Rate validity window (addition, 2026-10-17).** Rule 1 only defines an `effective_from`, so the
    default stays exactly as briefed: a rate is valid **until the next rate is published**. Because the
    product owner asked how to state "how long a rate stays active", an **optional** `effective_to` was
    added (nullable). Empty = the documented default; filled = the rate stops on that date and orders
    fail with `RATE_EXPIRED` until Finance publishes a new one. A future-dated `effective_from` is not
    used yet and produces its own message. Both behaviours are covered by `tests/rate-lock.test.ts`.
27. **Prisma drift and hand-written SQL.** Adding the `rates.effective_to` migration made Prisma drop
    one index that had only been created with raw SQL (`stock_ledger_created_at_desc_idx`). It was
    restored *and declared in `schema.prisma`* so Prisma manages it from now on; the CHECK constraints
    and the audit triggers live only in SQL and are intentionally invisible to Prisma.
