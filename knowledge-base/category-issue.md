# "Any <category>" Issues and Bills From Field Stock

## What This Subsystem Does
Client request 2026-11-19: staff can take stock out by **category** without naming products ("any 10 refills"), and inventory must stay correct per product. Rule agreed with the owner (refined the same day, migration 019): on the return the staff member says **how many came back** — no types needed, those pieces were never taken off a product — and **names only the pieces that did not come back** (used, sold or lost), so every piece that leaves stock is tied to a product and nothing is ever "unknown". Also: a staff member can **bill a customer from the stock they carry** ("Sold"), and that bill does not take the stock off a second time (settles ISSUE-023 for bills linked this way). Builds on `stock-reconciliation.md` (return cross-check) and `stock-workflows.md` (RPC rules).

## Owner Decisions (2026-11-19)
| Topic | Decision |
|---|---|
| Which categories | **Any category**, machines included. Machines named on return follow the existing installation rules (customer + whole numbers). |
| Who | Admin **New Issue** and seller **Request Stock** (admin approves as today). |
| Unknown pieces | Not allowed for pieces that did not come back: came back (one number) + named used / sold / lost must equal the issued quantity exactly. A lost piece is entered as Lost on its product and classified by the admin like any mismatch. |
| Returned pieces | **No type needed** (owner, 2026-11-19, migration 019): "How many came back?" is one number on the Any line. They move no stock, so their type doesn't matter for inventory. |
| Field sales | Record Sale gets a **"From field stock"** option linked to the staff member's open session. The bill moves no warehouse stock; the return shows it as **Sold** (auto-filled, read-only). |

## Data Model (migration `018_category_issue_and_field_sales.sql`)
- `checkout_items.category_id` (FK categories), `checkout_items.parent_item_id` (FK checkout_items, ON DELETE CASCADE). Constraint: `product_id IS NOT NULL OR (category_id IS NOT NULL AND parent_item_id IS NULL)`.
  - **Product line**: `product_id` set, `parent_item_id` NULL (as before).
  - **Any line**: `product_id` NULL, `category_id` set, `parent_item_id` NULL. `checkout_quantity` = issued.
  - **Child row** (written by `submit_return`): `product_id` set, `category_id` = the Any line's category, `parent_item_id` = Any line id. `checkout_quantity` = taken by that product (returned + used + sold + lost), `checkin_quantity` = returned, `used_quantity` = used + sold, `difference` = lost, `has_mismatch` = lost > tolerance.
  - After submission the Any line itself carries a summary (`checkin_quantity` Σ ALL returned = unnamed "came back" + any named returned, `used_quantity` Σ used+sold, `difference` Σ lost, `has_mismatch` false). Pieces that came back without a type = `unnamedReturned(anyLine, children)` = Any `checkin_quantity` − Σ children `checkin_quantity`. **Never count both**: use `reportableItems()` — it replaces an Any line that has children by one row for the unnamed returned pieces only (Issued = Returned = that number), or drops it when there are none.
- `checkout_usage.sale_id` (FK sales, ON DELETE SET NULL); `reason` adds `'sold'` (only written by `submit_return` from linked bills; clients never send it).
- `sales.checkout_session_id` (FK checkout_sessions) — set = bill from field stock.
- RLS: sellers may insert `checkout_items` only into their own `pending_issue` session and never child rows.

## Stock Rules
| Moment | Product line | Any line |
|---|---|---|
| Issue (`admin_issue_stock` / `approve_issue`) | stock −qty, txn `checkout` | **no stock change**; qty is **held** against the category |
| Held | — | `held(c)` = Σ Any qty in sessions `checked_out` / `pending_approval`. Free on shelf = Σ stock of products in c − held(c) |
| Field bill (`record_sale` with session) | no stock change | no stock change |
| Return submitted | no stock change | child rows written; still held |
| Return approved | +returned (txn `checkin`) | per child: stock += returned − taken (txns `checkout` −taken "Issued as Any …", `checkin` +returned); hold released |
| Machine installation usage | as before: +qty back, `installed_qty` += qty, installations row | same, on the child |

Issue validation (`check_issue_availability`, also `issueProblem()` client-side): per product Σ product lines ≤ stock; per category touched Σ all lines ≤ Σ category stock − held by **other** sessions; Any qty > 0, whole pieces for unit categories, at most one Any line per category per session.

## RPC Contract (prod: migration 018, demo: `js/supabase.js` demoRpc)
| RPC | Change |
|---|---|
| `admin_issue_stock(p_seller_id, p_items, p_approver_id)` | `p_items` entries are `{product_id, quantity}` **or** `{category_id, quantity}`. |
| `approve_issue(p_session_id, p_approver_id)` | Validates availability (incl. holds), deducts product lines only. |
| `get_category_holds()` | New. Rows `{category_id, held}` for open Any lines. Any signed-in user (sellers can't see other sessions). |
| `record_sale(..., p_sale_type, p_checkout_session_id DEFAULT NULL)` | **New 11th param.** With a session: session must be `checked_out` and the actor's own (or actor is admin); `recorded_by` becomes the session's staff member; no stock change / no txn; capacity check (below). Old 10-arg version dropped. |
| `update_sale` (same signature) | Field bill: no stock moves. Session `checked_out`: items may change (capacity re-checked). Session `pending_approval`: products/quantities locked ("Send the return back first"). Session `checked_in`: products/quantities locked. Prices, payment, party, notes always editable. |
| `delete_sale` (same) | Field bill: no stock moves. Blocked while the session is `pending_approval`. |
| `submit_return(p_session_id, p_items, p_notes, p_submitted_by)` | One entry per **top-level** line. Product line: `{item_id, returned_quantity, usage:[{reason, quantity, party_id?, notes?}]}` (as before). Any line (migration 019): `{item_id, returned_quantity, breakdown?:[{product_id, returned_quantity?, lost_quantity, usage:[...]}]}` — line-level `returned_quantity` = pieces that came back without a type (default 0); `breakdown` names only what did not come back (may be omitted; named per-product `returned_quantity` is still accepted, the UI no longer sends it). Products of the category must belong to it, no duplicates, whole pieces for unit categories. Sold usage is added automatically. came back + Σ(named returned + used + sold + lost) must equal the Any qty exactly → else error "Any X: N issued but M accounted for…". Migration 019 replaces only `submit_return` (same signature). |
| `approve_return(p_session_id, p_approver_id, p_resolutions)` | Mismatch resolutions now include child rows (lost). Applies the stock rules above. Errors if a child would take a product below 0 ("Correct the stock first"). |
| `reject_return` | Also deletes child rows. |

Field-bill capacity (`check_field_sale_capacity`, client `fieldBillProblem()`): for each product, sold beyond its own product lines must come from an Any line of its category; per category that overflow ≤ the Any qty.

Sold allocation on the return (`allocateSold()` mirrors `submit_return`): bills in id order; a product's own lines first (up to their issued qty), the rest to the Any line of its category.

## Shared Client Code
`js/utils/field-stock.js`: `isAnyLine`, `isChildLine`, `reportableItems`, `anyLineLabel`, `holdsMap`, `categoryFreeStock`, `issueProblem`, `fieldStockRemaining`, `fieldBillProblem`, `allocateSold`, `OPEN_SESSION_STATUSES`. `USAGE_REASONS` in `helpers.js` gains `sold: 'Sold (bill)'` for display only — usage reason pickers must not offer it.

## Known Gotchas
- While an Any line is out, each product's `current_stock` still includes pieces that are physically with staff. Only the category total is protected (holds). Product pages show held quantities per category.
- Field bills write no `inventory_transactions` row; the stock movement appears when the return is approved (as `checkout` −taken for Any children, or via the product line's issue/return).
- Old sellers' RLS still allows them to update their own `checkout_items` / `checkout_sessions` rows directly (pre-existing, see `known-issues.md`).

## Screens
- **Issue / Request Stock** (`js/pages/daily-operations.js` + `js/utils/stock-picker.js`): search box + category chips, results grouped by category with an **Any <Category>** row (free stock = Σ stock − held) on top of each group; out-of-stock greyed out for admins (sellers may still request with a warning); picking again adds to the quantity; per line stepper (pieces) or kg input with a "= 200 g" hint, "Stock/Free before → after", red when over; summary "N lines · X pcs + Y kg"; Confirm disabled while `issueProblem()` reports a problem (admin).
- **Submit Return** (Any line, migration 019): **Step 1 "How many came back?"** — one number, starts at issued − sold, no types. **Step 2** appears only when fewer came back: "N did not come back — which <Category>, and what happened?" with one row per product + outcome (*Used — customer service / installation / other work*, or *Lost / missing*) + qty (+ customer/note for Used; customer required for a machine installation); an empty row is added automatically while pieces are still unnamed and removed again when the count is complete. Read-only **Sold · Bill #N** rows from `allocateSold()`. Counter "X came back + Y named = Z of N" with plain messages (still to name / pick which / choose what happened / too many / came back > issued); Submit locked until "✓ All accounted for". Product lines unchanged (Returned + usage + Sold lines). The usage pickers never offer `sold`.
- **Approve Return / View Session**: Any line as a header row (Issued, Returned "N · any type", "Did not come back — named below:") with the named product rows indented; lost pieces need a classification like any mismatch. Before the return: "Not returned yet. Only pieces that don't come back are named on the return."
- **Record Sale**: **Stock source** (Warehouse / Field stock of an open session; sellers see only their own) with what is left to bill; Edit Bill locks products/quantities once the return is submitted or approved; "Field stock" badge in the list, Source column in CSV. Warehouse bills call `record_sale` without the 11th argument (works before and after 018).
- **Products**: notice "Out with staff as Any … N out, M free on shelf" (+ chip when filtered to that category). **Dashboard**: info line "N pcs <Category> out with staff as Any" in the Stock Reconciliation card — information only, not counted in "to review" or Alerts. Both hide silently if `get_category_holds` fails.
- **Staff Daily Ledger**: an Any line still out is one row "Any <Category>" (key `c:<categoryId>`, status In field); once returned its child rows plus one "Any <Category>" row for the pieces that came back without a type replace it (via `reportableItems()`). `buildStaffLedger` takes an optional `categories` list.

## How It Is Tested
- `tests/category-issue.test.js` — demo RPC contract for everything above (26 tests, incl. "unnamed returned pieces (migration 019)").
- `tests/daily-ops-issue.test.js`, `tests/daily-ops-return.test.js` (Any return, Sold lines, lost-piece approval), `tests/sales-field-stock.test.js`, `tests/any-lines-reporting.test.js` (ledger, seller report, Products notice, Dashboard line), `tests/demo-week.test.js` (Any day + field bills in the simulated week, stock conservation).
- Migration 018 checked on PGlite (real Postgres) with a throwaway harness kept in the session scratchpad (`pglite-018/run.mjs`, 170 checks incl. migration 019, RLS as `authenticated` and stock conservation) — not part of `npm test`. Applied: base schema + 004–007, 009–019 (002/003 old-shape data migrations and 008 storage skipped); base `inventory_transactions_quantity_check` and `payment_followups_amount_collected_check` dropped to match production.
- Bugs that verification found and fixed (SQL + demo): Sold allocation followed the order of the request instead of item id order; a seller request row carrying a misleading `category_id` could bypass the category hold; a machine installed from an Any line could be refused at approval (installation now counted back before the Any stock step).
- Not covered: two admins issuing from the same category at the same instant (category row lock is untested; PGlite has one connection).

## Related KB Files
`stock-reconciliation.md`, `stock-workflows.md`, `sales-billing.md`, `known-issues.md` (ISSUE-023), `testing.md`
