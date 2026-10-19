# User guide — step by step, per role

Sign in at `/login`. After signing in you land on the screen your role needs most.
Every quantity is in **MT** (3 decimals), every amount in **BDT (৳)**, every time in **Asia/Dhaka**.
The **Sign out** button and **Change password** are in the top bar (desktop) or the top menu (phone).

---

## 1. Finance — publish the daily selling rates

**Finance → Publish rates**

1. Choose the **Product**.
2. Enter the **Selling rate (৳ per MT)**.
3. Set **Effective from** (date and time). A later time means the rate starts applying then.
4. Optionally add a **Note** (market reference) and press **Publish rate**.

What happens next:

* **As soon as the rate is published, sales can create orders at that rate** — there is no approval
  step before ordering.
* The previous rate becomes history (`Superseded`); nothing is edited in place.
* An order created earlier keeps its own rate forever, even if you publish a new one a minute later.

**How long does a rate stay valid?**

* **By default: until the next rate is published.** You do not have to type an end date. The moment
  Finance publishes a newer rate, the previous one is marked `Superseded` and is no longer offered to
  sales; orders that were already created keep the rate that was locked into them.
* **Optional end date.** If a rate must stop on a fixed date even when nobody publishes a new one,
  fill **Valid until**. After that moment the rate is no longer used and an order attempt fails with
  *“The rate for \<product> expired on \<date>. Finance must publish a new rate.”*
* **Future-dated rate.** If the latest rate's **Effective from** is still in the future, it is not used
  yet and ordering fails with *“The next rate for \<product> starts on \<date>.”*

**Finance → Rate history** shows every publication with product, amount, publisher and time, with
product and date filters. The dashboard also charts the last 30 days.

**Finance → Rate history** shows every publication with product, amount, publisher and time, with
product and date filters. The dashboard also charts the last 30 days.

> If a product shows **“Not published”** in the dashboard, sales will be blocked with
> *“No published rate for product X”* until you publish one.

**Document numbers** are generated for you — nothing is typed:
`sales order SO-19-10-2026-001` → its delivery orders `SO-19-10-2026-001-DO-01`, `-DO-02` → each
dispatch gets a dated challan `CH-19-10-2026-001`. The date part is always the **Asia/Dhaka** date, so
a back-dated order or a dispatch loaded after midnight gets the correct day.

---

## 2. Salesperson — create and track orders

**Sales → New order**

1. Pick the **Customer** (only active customers appear).
2. Leave **Order date & time** as it is unless you are back-dating the entry — it decides which
   rate applies and the delivery priority.
3. For each line choose the **Product** and type the **Quantity (MT)**. Use **Add line** for more
   products. The **Locked rate** is shown read-only and the line value and order total update live.
4. Add **Remarks** if needed and press **Submit order for approval**.

What happens next:

* The order gets a unique reference like `ORD-2026-000123` and status **Pending approval**.
* The rate is now **locked** to your order. You cannot change it; only Sales Operations can override
  it (with a written reason, before approval).
* Sales Operations approves or rejects it. If rejected you see the reason on the order.

**Sales → Orders** lists your orders with search, status filter, sorting and pagination. Each row
shows ordered / delivered / remaining quantity and a progress bar.

**Order detail** shows the lines with locked rates, the delivery orders raised against them, every
dispatch and a status timeline. **Print / PDF** opens the printable order confirmation.

> Delivery priority: if this customer already has an older active order, the warehouse cannot deliver
> this one until the older order is fully delivered. You do not need to manage that — the system
> blocks it and shows which order is in front.

---

## 3. Sales Operations — approve, allocate, control priority

### 3.1 Approval queue — **Sales Ops → Approval queue**

Each pending order is listed with the checks the brief requires:

* **Rate valid at order time** — the line's rate existed when the order was created.
* **Quantities** — number of lines and total MT.
* **Customer active**.
* **Credit limit** — exposure (open orders + this order) against the customer's limit. If it is
  exceeded you must tick **Override the credit limit** and write a reason.

Press **Approve order**, or **Reject** (a reason is mandatory and shown to the salesperson).
You can also **Override rate** on a line before approving (reason mandatory, audited).

**Fixed a typo instead of rejecting?** Use **Edit order** (top-right of the card, or on the order
detail). Sales Operations can correct the **quantity**, the **rate** and the **remarks** of a pending
order — a missing zero, a wrong MT figure, a wrong instruction. A written reason is mandatory, the
total is recalculated and every changed line is written to the audit trail. Only pending orders can be
edited: once approved (or once a delivery order exists) the numbers are frozen. The customer and the
product lines cannot be swapped — reject and recreate for that.

### 3.2 Priority queue — **Sales Ops → Priority queue**

Per customer it shows the order **delivering now** and the orders **blocked behind it**, with the
remaining quantity of the blocker. Different customers never block each other.

### 3.3 Delivery orders — **Sales Ops → Delivery orders → New delivery order**

1. Choose the **approved order** (the list is oldest first).
2. Read the **customer delivery queue** panel. If this order is not at the head of the queue the
   screen warns you with `PRIORITY_BLOCKED` and names the blocking order and its remaining MT.
3. Choose the **Warehouse manually**. The table then shows, per line, the ordered, delivered,
   allocatable and **available here** quantities.
4. Enter the **DO quantity** per line. The form refuses to submit more than can be allocated or more
   than the warehouse has available.
5. Only if you must break the queue for this delivery: tick **Priority override** and write the
   reason. It is recorded, audited and appears in the *Priority override* report.
6. **Create delivery order & reserve stock** — the quantity is now **reserved** in that warehouse.

From the DO detail you can **Print DO / PDF** and, while nothing has been dispatched, **Edit
quantities** (correct the amount — the warehouse reservation is adjusted automatically, a reason is
mandatory and the change is audited) or **Cancel DO** (the reservation is released).

> **The warehouse can never change these quantities.** It only records the vehicle, driver, challan
> and dates, and dispatches exactly what Sales Operations decided. Need a smaller shipment? Create a
> second DO for the balance.

### Case: one order, two products, stock in two warehouses

Customer orders **Urea 50 MT + Coal 20 MT**. At delivery time Dhaka has the Urea but no Coal, while
Chattogram has the Coal.

1. **Create two delivery orders — one per warehouse.** Choose Dhaka, enter only the Urea line (the
   *Available here* column shows 0 for Coal, so the form refuses it anyway).
2. Repeat with Chattogram for the Coal line.
3. Each DO reserves only its own warehouse's stock. The order's remaining quantity is the sum of both
   lines, and the progress bar shows the combined progress.
4. The order becomes `COMPLETED` only when **both** DOs are dispatched. Until then it stays at the head
   of the customer's queue — so that customer's *next* order waits, no matter which warehouse is slow.

**Do not split the order itself.** Two separate orders do not help here: the older order would block
the newer one anyway (Rule 3). Split into separate orders only when the customer really wants two
independent deals.

Alternative to consider: if a single truck/challan is important, move the missing product with a
**stock transfer** (Warehouse → Stock transfers) and deliver everything from one warehouse — usually
worth it only for large quantities, because it adds a second handling step.

Other order actions on the order detail screen: **Cancel order** (only while nothing is delivered)
and **Short close** (closes the remaining quantity with a reason and unblocks the customer's next
order).

### 3.4 Transfers & counts

* **Warehouse → Stock transfers** — approve a request (the quantity is reserved at the source),
  reject with a reason, or confirm receipt.
* **Warehouse → Physical counts** — approve a submitted count; approving a non-zero difference
  requires a reason and writes an `ADJUSTMENT` ledger entry.

---

## 4. Warehouse — load, dispatch and keep stock true

You only ever see **your own warehouse**. You cannot create or change a delivery order.

### 4.1 Dispatch — **Warehouse → My delivery orders**

1. Open a DO (or press **Dispatch** in the list). The screen shows the DO, its customer, the
   warehouse, the dispatch progress and (if one was granted) the priority override reason.
2. **The quantity is not yours to change.** Sales Operations decides it when creating the delivery
   order; the screen shows it (e.g. `30.000 MT`) read-only. For a smaller shipment, ask Sales
   Operations to create a separate delivery order.
3. Fill **Truck / vehicle number**, **Challan number** (leave it empty and the system generates a
   dated one, `CH-19-10-2026-001`; type a value only if a physical challan already carries its own
   number), **Driver name**, **Driver phone**, **Loading date**, **Dispatch date**.
   * The **dispatch date can never be earlier than the loading date** — the picker will not offer an
     earlier day, and the form blocks it.
4. Press **Record dispatch**. The system re-checks the customer priority queue at this moment.

What happens next: reserved stock is released, on-hand stock drops, the delivered quantity increases
and the order moves to *Partially delivered* or *Completed* (depending on how much of the order this
DO covered). The challan is available as a printable copy (**Challan** link, or **Print challan**).

> If your business really needs the warehouse to split one DO over several trucks, an administrator can
> switch on **Admin → Settings → “Allow the warehouse to dispatch less than the DO quantity”**. Then a
> quantity box appears and partial dispatches are allowed again.

If the dispatch is refused with *“Order ORD-… of this customer must be completed first”*, tell Sales
Operations — only they can grant a priority override.

### 4.2 Stock — **Warehouse → Stock & inward**

* **Inward receipt** — quantity received with an optional reference (LC/challan). Writes an `INWARD`
  ledger row and increases on-hand stock.
* **Opening stock** — once per warehouse/product, for the initial load.
* The balances table shows opening, inward, outward, transfer in/out, adjustment, closing, reserved
  and **available** per product.

**Stock ledger** lists every movement with the balance after it, the reference and who did it.
Nothing in the ledger is ever edited or deleted.

### 4.3 Transfers and counts

* **Stock transfers** — request a transfer from your warehouse to another. Follow the status:
  `Requested → Approved → In transit → Received`. You release (in-transit) out of your warehouse and
  the destination confirms receipt.
* **Physical counts** — enter the counted quantity per product. The system computes the difference
  and sends it to Sales Operations for approval; on approval the stock is adjusted and audited.

---

## 5. Management — read-only everywhere

You can open every dashboard and report and nothing else changes:

* **Dashboard** — orders, pending approval, approved, pending delivery MT, delivered today/this
  month, sales value, stock by warehouse/product, open DOs, top customers, today's rates, rate
  history chart, salesperson performance.
* **Reports** — see section 6. **Audit log** — who did what, when, with before/after values.
* Any write action is refused by the server, not just hidden.

---

## 6. Reports and exports — **Reports**

Twelve reports, all filterable by date range, warehouse, customer and product, all exportable:

1. Order balance report
2. Customer-wise sales & delivery — **Breakdown: Customer only (totals) or Customer → Product** (what
   each customer bought, per product)
3. Product-wise sales — **Breakdown: Product only (totals) or Product → Customer** (who bought each
   product)
4. Pending delivery order report
5. Warehouse stock ledger
6. Stock summary (opening → closing, reserved, available)
7. Stock difference (physical vs system, with reasons)
8. Daily rate change history (with the validity window of every rate)
9. Delivery / dispatch register
10. Priority override report
11. Customer priority queue
12. Salesperson performance

Each report page has **Export Excel**, **Export PDF** and **CSV** buttons that download exactly what
is on screen — including the chosen breakdown.

---

## 7. Administrator

* **Users & roles** — create users, set the role, assign a warehouse to warehouse users, reset
  passwords (all sessions are revoked and the user must change the password at next sign-in),
  deactivate accounts. The screen also lists what each role can do.
* **Products / Customers / Warehouses** — create and edit. Records are **deactivated, never deleted**
  (deactivation is refused while open orders/DOs exist). Customers can carry a **credit limit**.
* **Settings** — enable/disable the credit-limit check and priority overrides, company name/address
  (used on printables) and the default warehouse.
* **Audit log** — read-only, filterable by entity, action, user and date; before/after values are
  shown per entry. The database itself rejects UPDATE/DELETE/TRUNCATE on this table.

---

## 8. Everyday troubleshooting

| Symptom | What it means / what to do |
|---|---|
| *“No published rate for product X”* | Finance has not published a rate for that product yet. |
| *“Order ORD-… of this customer must be completed first. Remaining: X MT”* | Strict per-customer priority. Deliver the older order first, or ask Sales Ops for a priority override with a reason. |
| *“only X MT is left to allocate”* | The order's remaining (undelivered, unallocated) quantity is smaller than the DO quantity you entered. |
| *“Only X MT of … is available at …”* | The warehouse's `on-hand − reserved` is smaller than requested. Enter inward stock, use another warehouse, or reduce the quantity. |
| *“Challan number … already exists”* | Challan numbers are unique — check the number, or use the one already recorded. |
| *“only X MT is left to dispatch”* | The DO line is already partly dispatched; the rest is at most that amount. |
| *“Cannot move order/delivery order from … to …”* | The status no longer allows that action (e.g. dispatching a cancelled DO). Reload the page. |
| Credit limit warning | Sales Ops must confirm the override with a written reason, or Finance/Admin can disable the check in Settings. |
| A page looks stale after a change | Press **Ctrl+Shift+R** (hard refresh); lists are always rendered from live data. |
