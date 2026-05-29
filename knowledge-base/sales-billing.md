# Sales & Billing

## What This Subsystem Does
Sales is the bill/invoice workflow for Narmada Essence. Sellers/admins can record multi-item product sales, track payment status, and deduct stock. Admins can edit or delete existing bills. Every stock effect is mirrored in `inventory_transactions` so the warehouse audit trail stays explainable.

## How It Is Structured
- `js/pages/sales.js` renders the Sales page, sales table, Record Sale modal, Edit Bill modal, and delete actions.
- `sales` is the bill header table: party, total, payment status, amount received, expected payment date, sale date, notes, and recorder.
- `sale_items` is the bill line-item table: sale id, product id, quantity, unit price, line total.
- `js/supabase.js` contains demo-mode RPC handlers for `record_sale`, `update_sale`, and `delete_sale`.
- `migrations/006_atomic_operations.sql` introduced the original sale/delete RPCs.
- `migrations/009_edit_bill_and_delete_fix.sql` adds `update_sale` and fixes the audit type constraint needed by bill deletion.
- `supabase-scripts/clear-18000-sales-data.sql` is a one-off data cleanup script for removing exact 18000-total sales without changing product stock.
- `supabase-scripts/clear-all-sales-data-preserve-stock.sql` is the broader cleanup option when the client means all current sales data totaling roughly 18000 should be removed without changing stock.

## Conventions And Rules
- Never edit `products.current_stock` directly from the Sales page.
- Sale creation, edit, and delete must go through RPCs so stock and audit rows stay atomic.
- Admins can edit/delete bills; sellers can record sales and view their own sales according to the UI and RLS/RPC contract.
- Edited bills replace the full line-item set. The RPC restores old item stock, deletes old `sale_items`, inserts the edited items, deducts new stock, and updates the sale header in one transaction.
- Deleting a bill via `delete_sale` restores stock and logs `sale_delete` audit rows.
- The one-off sales cleanup scripts intentionally do not call `delete_sale`, because that client request is sales-data-only cleanup with stock left unchanged.

## Known Gotchas
- Production must have migration 009 applied before the deployed UI calls `update_sale`; otherwise Edit Bill will fail with an unknown RPC error.
- Production delete errors before migration 009 are likely caused by `inventory_transactions.type` rejecting `sale_delete`.
- Even after migration 009, app Delete Bill can fail for bills with linked `payment_followups` because the FK does not cascade and `delete_sale` does not delete/detach those followups yet.
- Production `record_sale` in migration 006 needs stronger server-side validation; the demo RPC currently rejects some bad item shapes that the SQL RPC still trusts.
- If the client wants a removed sale to restore stock, use the app's Delete Bill option. If they want sales data removed while stock stays as-is, use the one-off cleanup script pattern.
- Live read-only QA on 2026-05-29 showed production Sales total as 18070 across 7 transactions; confirm whether cleanup should target exact 18000 rows or all current sales data.
- The bill total is calculated from line items. Payment received cannot exceed the computed bill total.

## How It Is Tested
- `tests/demo-rpc.test.js` covers:
  - `record_sale` atomic creation and insufficient-stock rollback
  - `update_sale` item replacement, stock rebalancing, audit rows, and insufficient-stock rollback
  - `delete_sale` cascade delete and stock restoration
- Run `npm test` for the automated suite.
- Run `npm run build` after UI/RPC changes.
- Browser smoke tested on `http://127.0.0.1:5173`: record sale, visible Edit Bill action, edit quantity, and save updated bill total.

## Related KB Files
- `architecture.md` - tables, stock flow, RPC list
- `testing.md` - test commands and coverage rules
- `known-issues.md` - production migration caveats
- `future-scope.md` - invoice/PDF generation is deferred
