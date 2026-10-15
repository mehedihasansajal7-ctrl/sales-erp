# Architecture

## 1. Layers (and why)

```
request ─▶ src/app/**            screens (server components) & route handlers
           src/actions/**        server actions: Zod parse ─▶ permission ─▶ service ─▶ revalidate
           src/server/services/**  business rules, transactions, locking, audit
           src/lib/**            infrastructure (prisma, decimals, dates, auth, rbac, audit…)
           PostgreSQL            the last line of defence (CHECK constraints, triggers, unique keys)
```

* **No business rule lives in a component.** Screens call services (read paths) or server actions
  (write paths); actions never contain arithmetic or state transitions.
* **Two independent gates for every write**: `requirePermission()` in the action (authorisation) and
  the domain checks inside the service (validity). A hidden button is never the control.
* **Third gate in the database**: quantity limits, non-negative stock and the append-only audit log
  are enforced by constraints/triggers, so even a bug (or a person with psql) cannot corrupt an
  invariant.

## 2. Data model highlights

* `orders.order_seq` is **per customer** and is the delivery priority key.
* `order_items.locked_rate_per_mt` is the immutable rate; `rates` is append-only history.
* `order_items.do_allocated_mt` (in open DOs) and `delivered_mt` are counters updated inside the same
  transaction that changes the DO/dispatch, with `CHECK (… <= qty_mt)` behind them.
* `stock_balances` is the derived balance table (`on_hand_mt`, `reserved_mt`) and `stock_ledger` is
  the immutable movement log (`balance_after`, `reserved_after` on every row).
* `sequences` provides atomic, gap-free document numbers (`ORD-2026-000123`).
* `audit_logs` carries who/what/before/after/IP for every action; triggers reject UPDATE/DELETE/TRUNCATE.

## 3. Concurrency strategy (the heart of the system)

Rule 3 must hold even when two warehouses dispatch for the same customer at the same instant, and
Rules 4/5 must never over-allocate. The design:

```
BEGIN
  SELECT code FROM customers WHERE code = $1 FOR UPDATE   -- serialises one customer
  … assertCustomerPriority (queue head check)            -- same lock, same order, every time
  SELECT id FROM orders          WHERE id = $1 FOR UPDATE
  SELECT id FROM delivery_orders WHERE id = $1 FOR UPDATE
  SELECT on_hand, reserved FROM stock_balances WHERE … FOR UPDATE   -- per warehouse+product
  … validate remaining quantities, write, update counters, append ledger, append audit
COMMIT
```

* Lock order is always **customer → order → DO → stock row**, and stock rows are locked in
  `product_code` order, so no deadlock is possible.
* All delivery actions of one customer therefore run strictly one after another; different customers
  run in parallel.
* Every transaction is wrapped by Prisma with an explicit 30 s `timeout`/`maxWait`.
* The `available = on_hand − reserved` check happens *after* the row lock, never before.
* Stale-read protection does not depend on `SERIALIZABLE`: the row locks provide it under
  READ COMMITTED, which is what Prisma's interactive transactions use.

`tests/concurrency.test.ts` fires 20 parallel dispatches at one DO and 12 parallel DO creations for
one order, and asserts the limits hold and that the ledger, the counters and the balance table agree.

## 4. Document numbering

`sequences(key, value)` is incremented with a single atomic
`INSERT … ON CONFLICT DO UPDATE … RETURNING value`, so two concurrent requests can never receive the
same number and no `SELECT`-then-`UPDATE` race exists. Keys are `order:2026`, `do:2026`, … so the
year in the document number follows **Asia/Dhaka**, not UTC.

## 5. Time

`src/lib/dates.ts` is the only place that knows about timezones. `APP_TIMEZONE` (default
`Asia/Dhaka`) is used for: "today"/"this month" boundaries, overdue checks, document-number years and
every displayed timestamp. Wall-clock values from `datetime-local` inputs are converted with a
two-pass offset calculation so DST-style transitions stay correct.

## 6. Numeric policy

Quantities are `Decimal(18,3)`, money is `Decimal(18,2)` — never floats. All arithmetic goes through
`Prisma.Decimal` (`src/lib/decimal.ts`) with explicit half-up rounding at the edges (`qty()`,
`money()`), so a 0.1 + 0.2 style error is impossible. The DB `CHECK` constraints use the same scales.

## 7. Reporting engine

`src/server/services/report.service.ts` declares each report once:

```ts
{ key, title, description, columns: [{ key, label, kind, align }], run(filter, user) }
```

The same definition renders the on-screen table, the Excel sheet (`exceljs`), the PDF (`pdfkit`) and
the CSV — so exports can never drift from the screen. Reports respect the caller's scope
(a salesperson only sees their own orders; a warehouse user only their own warehouse).

## 8. Print pipeline

`print.service.ts` builds a `PrintablePayload` (key/value pairs, tables, notes, signatures) for the
order confirmation, DO copy and dispatch challan. The HTML print page and the server-rendered PDF
both consume that payload, so the screen copy and the PDF are identical by construction.

## 9. Error handling

`AppError(code, message, status)` carries a stable machine code and the exact business message
(`PRIORITY_BLOCKED`, `OVER_ALLOCATION`, `DUPLICATE_CHALLAN`, `ILLEGAL_TRANSITION`, …). Server actions
return `{ ok, code, message, fieldErrors }`; the UI shows the message inline **and** as a toast.
Unexpected errors are logged server-side and never leak a stack trace to the browser.

## 10. Security

* Passwords hashed with bcrypt (10 rounds); sessions are opaque rows referenced by a signed JWT in an
  `httpOnly`, `SameSite=Lax`, `Secure` (production) cookie — revocable per user.
* Login is rate-limited per IP and per account; failed sign-ins are audited.
* `assertSameOrigin()` on state-changing route handlers plus Next's Server Action origin check.
* Warehouse users are scoped to their warehouse in every list *and* every fetch/mutation.
* Zod validates every input; unknown fields are ignored, all numbers are normalised to Decimal strings.
* `AUTH_SECRET` must be set in production (the app refuses to start without it).
