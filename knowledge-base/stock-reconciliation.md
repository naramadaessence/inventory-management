# Stock Reconciliation (Purchases, Usage, Cross-Check, Approvals)

## What This Subsystem Does
Implements the client's 2026-10-20 feature request: purchase entry with rates, daily issue → return with **usage entry**, automatic **cross-check** (Difference = Issued − Returned − Used), **mismatch alerts**, **manager (admin) approval** of discrepancies and stock adjustments, **staff-wise / product-wise / fragrance-wise** records, and full history. Built on the existing Daily Operations issue/return flow and stock RPC pattern (see `stock-workflows.md`).

## Decisions (owner-confirmed 2026-10-20)
| Topic | Decision |
|---|---|
| Fragrance | New `products.fragrance` text tag (pre-filled from product names; machines have none). Products stay one-per-fragrance. |
| Usage entry | Entered on the **return form**, per item: Returned qty + Used qty split by reason (customer service / installation / other) with optional customer. |
| Mismatch | Return can be submitted; if any item's \|Difference\| > tolerance the admin must classify it (type + note) before approving. Matching returns approve as before. |
| Tolerance | `app_settings`: `liquid_tolerance_kg` = 0.010, `unit_tolerance` = 0. Editable in Settings → Stock Rules. |
| Approver | Any admin. Requester and approver are both recorded. |
| Stock adjustments | Editing a product's stock creates an **adjustment request**; an admin approves/rejects. Approval applies the *delta* (requested − stock at request time) so movements in between are kept. New products' opening stock is still set directly. |
| Purchases | Same unit as stock (kg / pcs). Rate required, total = qty × rate, supplier required, bill no. optional, purchase date. Purchases page with supplier/product/fragrance totals. Selling price & valuation unchanged. |
| Installations | Usage reason "installation" on a **machine** with a customer: on approval the unit is counted back into Total Stock, `installed_qty` += qty and an `installations` row is created (keeps Total Stock = all owned machines, Current Stock = in warehouse). Installation usage of refills/oils is just consumption. |
| Return "Flag" | Replaced by **Send back** (`reject_return`): the return goes back to the staff member to correct; nothing is lost. (Old Flag on pending returns silently dropped returned stock.) |
| Legacy returns | Returns submitted before migration 016 have `used_quantity = NULL` and `has_mismatch = false`; they approve as before and reports show Used as "—", never a fake mismatch. |

## Data Model (migration `016_stock_reconciliation.sql`)
- `products.fragrance TEXT NULL`
- `stock_intakes` + `purchase_date DATE DEFAULT current_date`, `purchase_rate NUMERIC(12,2) CHECK >= 0`, `total_amount NUMERIC(12,2)`, `bill_number TEXT` (legacy rows NULL)
- `checkout_items` + `used_quantity NUMERIC(12,3)`, `difference NUMERIC(12,3)`, `has_mismatch BOOLEAN DEFAULT false`, `discrepancy_type TEXT CHECK IN (wastage, loss, staff_shortage, counting_error, excess_return, other)`, `discrepancy_note TEXT`
- `checkout_sessions` + `has_discrepancy BOOLEAN DEFAULT false`
- `checkout_usage` (new): `id, item_id → checkout_items ON DELETE CASCADE, session_id, product_id, reason CHECK IN (customer_service, installation, other), quantity NUMERIC(12,3) > 0, party_id → parties NULL, notes, created_at`
- `stock_adjustments` (new): `id, product_id, stock_at_request, requested_stock, delta, reason, status CHECK IN (pending, approved, rejected), requested_by, reviewed_by, reviewed_at, review_note, created_at`
- `app_settings` (new): `id, key UNIQUE, value NUMERIC` — rows `liquid_tolerance_kg`, `unit_tolerance`
- `inventory_transactions.type` adds `'installed'`

## RPC Contract (demo: `js/supabase.js` `demoRpc`; prod: migration 016)
All business RPCs: SECURITY DEFINER, check `auth.uid()`, REVOKE from PUBLIC/anon, GRANT to authenticated.

| RPC | Params | Who | Effect / returns |
|---|---|---|---|
| `record_purchase` | `p_product_id, p_quantity, p_purchase_rate, p_supplier, p_bill_number, p_purchase_date, p_notes, p_received_by` | admin | stock_intakes row (+rate/total/bill/date), stock += qty, txn `stock_in` ref `stock_intake`. Returns intake id. Errors: qty ≤ 0, rate missing/negative, supplier empty. |
| `submit_return` | `p_session_id, p_items: [{item_id, returned_quantity, usage: [{reason, quantity, party_id?, notes?}]}], p_notes, p_submitted_by` | session's staff or admin | Session must be `checked_out`; every item exactly once. Writes usage rows, sets `checkin_quantity, used_quantity, difference, has_mismatch, is_flagged, flag_reason` per item and `status='pending_approval', checkin_time, notes, has_discrepancy`. Machine + installation needs `party_id` and whole qty. No stock change. Returns `{ has_discrepancy }`. |
| `approve_return` | `p_session_id, p_approver_id, p_resolutions = [] ([{item_id, discrepancy_type, note}])` | admin | Every `has_mismatch` item needs a resolution with type + non-empty note, else error. Restores `checkin_quantity` (txn `checkin`), saves discrepancy fields, handles machine installations (stock += qty txn `installed`, `installed_qty` += qty, `installations` row), status `checked_in`. **Signature changed** — migration drops the old 2-arg version. |
| `reject_return` | `p_session_id, p_reason, p_approver_id` | admin | `pending_approval` → `checked_out`; clears return/usage/difference fields; appends "Return sent back: reason" to notes. No stock change. |
| `request_stock_adjustment` | `p_product_id, p_new_stock, p_reason, p_requested_by` | admin | Creates pending `stock_adjustments` row (delta = new − current). Errors: negative, same as current, reason empty, product already has a pending request. Returns id. |
| `review_stock_adjustment` | `p_adjustment_id, p_approve (bool), p_note, p_reviewer_id` | admin | Approve: stock += delta (error if it would go negative), txn `adjustment` ref `stock_adjustment`. Reject: no stock change. Records reviewer/time/note. |

Unchanged and still used: `approve_issue`, `admin_issue_stock`, `set_product_stock` (opening stock of a new product only), `record_stock_intake` (kept for compatibility; UI uses `record_purchase`).

Shared JS (in `js/utils/helpers.js`): `USAGE_REASONS`, `DISCREPANCY_TYPES` (key → label), `isMachineCategory(category)`, `availableStock(product)`.

## Screens
- **Purchases** page (`js/pages/purchases.js`, admin nav): record purchase, list with filters, totals by supplier / product / fragrance. Settings no longer has the Stock Intake tab; Settings → **Stock Rules** edits the tolerances.
- **Daily Operations** (`js/pages/daily-operations.js`): return form with Returned + usage lines and live Difference; approval modal with classification for mismatches; Send back; session view shows usage and resolution.
- **Products** (`js/pages/products.js`): Fragrance field + filter; editing stock submits an adjustment request; pending requests panel with Approve / Reject.
- **Reports** (`js/pages/reports.js`): Staff Daily Ledger (per staff per day, product- and fragrance-wise Issued / Returned / Used / Difference) and fragrance-wise view.
- **Dashboard** (`js/pages/dashboard.js`): alerts for returns awaiting discrepancy approval, stock still out from previous days, pending adjustment requests.
- **Inventory Log** (`js/pages/inventory-log.js`): labels for `installed` and adjustment-request references.

## Production Status
Migration 016 applied and verified by the owner on 2026-10-20 (11 new columns, 3 RLS tables, single 3-arg `approve_return`, 6 functions, tolerances 0.010 / 0, 79 products pre-filled with a fragrance).

## Known Gotchas
- Machine detection is name-based (ISSUE-018): Room Cream / accessories count as machines.
- Dates in the ledger and "stock still out" alert use the local day (`localDay` in helpers), while `getDateRange` presets use UTC-ish boundaries; early-morning IST entries can fall outside "today".
- Old Seller RLS still lets sellers update their own `checkout_items`/`checkout_sessions` directly; the UI no longer does, all return writes go through `submit_return`.
- Tolerance compares with a 1e-9 epsilon to avoid float noise.
- Approving an adjustment can fail if stock moved down so far that applying the delta would go negative.

## How It Is Tested
- `tests/stock-reconciliation.test.js` — demo RPC contract for all functions above.
- Page tests per screen (see `testing.md`).
- Migration 016 is syntax/behaviour-checked against PGlite during development; production verification is manual (queries in the migration footer).

## Related KB Files
`stock-workflows.md`, `architecture.md`, `sales-billing.md`, `decisions.md`, `known-issues.md`, `testing.md`
