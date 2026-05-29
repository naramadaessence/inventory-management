# Stock Workflows

## What This Subsystem Does
Stock workflows keep `products.current_stock` correct while preserving an audit trail in `inventory_transactions`. The subsystem covers sales, bill edits/deletes, daily checkout approvals, admin immediate checkout, stock intake, product stock adjustment, damage/loss, rentals, and rental returns.

## How It Is Structured
- `products.current_stock` is the source of current warehouse quantity.
- `inventory_transactions` is the append-only audit trail for stock movement.
- Production stock changes run through Supabase RPCs in `migrations/006_atomic_operations.sql`, `migrations/009_edit_bill_and_delete_fix.sql`, and `migrations/010_data_consistency_hardening.sql`.
- Demo mode mirrors those RPCs in `js/supabase.js` so the same `db.rpc(name, params)` call sites work in localStorage and Supabase.
- UI call sites live mainly in `js/pages/sales.js`, `daily-operations.js`, `products.js`, `settings.js`, `damage-loss.js`, and `rentals.js`.

## Conventions And Rules
- Never update `products.current_stock` directly from browser code.
- Prefer intent-specific RPCs over low-level primitives:
  - Sales: `record_sale`, `update_sale`, `delete_sale`
  - Daily operations: `approve_issue`, `approve_return`, `admin_issue_stock`
  - Products/settings: `set_product_stock`, `record_stock_intake`
  - Damage/loss: `record_damage_loss`
  - Rentals: `create_rental`, `return_rental`
- `adjust_stock` is an internal database primitive. Migration 010 revokes direct browser access and keeps stock checks inside business RPCs.
- Business RPCs are explicitly revoked from `PUBLIC`/`anon` and granted to `authenticated`; access control then happens inside each RPC with `auth.uid()` and role checks.
- Every stock RPC must write the matching `inventory_transactions` row in the same transaction.
- Add demo-mode RPC parity and Vitest coverage whenever adding a production stock RPC.

## Known Gotchas
- Seller stock requests do not mutate stock until admin approval. Admin-created immediate checkout uses `admin_issue_stock` and deducts stock right away.
- Sale cleanup scripts are intentionally different from Delete Bill: cleanup removes sales data while preserving current product stock, so it does not call `delete_sale`.
- Product edits should update descriptive product fields separately from stock. If stock changes, call `set_product_stock` after the product row is saved.
- Liquid stock is stored directly in kg, not grams.
- Live Supabase must run migration 010 before the deployed UI depends on the hardened RPCs and tightened RLS.

## How It Is Tested
- `tests/demo-rpc.test.js` covers the public `db.rpc(...)` contract for sales, checkout approvals, stock intake, damage/loss, rentals, admin immediate checkout, product stock adjustment, and payment followups.
- Run `npm test` for contract coverage.
- Run `npm run build` after changing UI call sites or RPC parameter shapes.
- Production SQL is validated by applying migrations manually in Supabase; this workspace does not currently have Supabase CLI access.

## Related KB Files
- `architecture.md` - data tables, RPC list, payment flow
- `sales-billing.md` - bill-specific create/edit/delete behavior
- `testing.md` - test commands and coverage expectations
- `known-issues.md` - resolved data consistency bugs and migration requirements
