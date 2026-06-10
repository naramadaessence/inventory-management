## Current Status
**Last Updated**: 2026-06-10
**Last Agent Session**: Asset valuation — Free-to-Use deployed machines now included in Total Asset Value on dashboard and reports.
**Test Suite Status**: Pass — `npm test` 21/21 and `npm run build` pass on 2026-06-10.

## In Progress
- None.

## Pending User Action
- Run `migrations/010_data_consistency_hardening.sql` in the live Supabase project before relying on the deployed UI. If migration 009 was already run, still run 010; it supersedes 009 for the full consistency fix.
- If live Sales still shows the 7 rows totaling 18070 and the client wants all current sales data removed while preserving stock/party data, run `supabase-scripts/clear-all-sales-data-preserve-stock.sql` after previewing the rows.
- After Vercel deploys the pushed commit and migration 010 is applied, smoke test production with admin login: create a small sale, edit it, delete it, and confirm totals/stock behave as expected.

## Recently Completed
- **Data consistency hardening**: Added migration 010 with validated sales/edit/delete RPCs, followup-safe delete, business RPCs for stock workflows, payment followup atomicity, RLS tightening, and data guard constraints.
- **UI stock-flow cleanup**: Moved product stock adjustment, stock intake, damage/loss, rentals, returns, and admin immediate checkout away from direct browser stock writes.
- **Collections atomicity**: Replaced browser-side followup insert plus sale update with `record_payment_followup`.
- **Error handling**: Wrapped remaining admin save handlers in `dbOp` or RPC calls before showing success.
- **AMC fixed-rate bills**: Sales now sends adjusted line prices so the database-computed sale total matches the AMC fixed total.
- **Tests**: Expanded `tests/demo-rpc.test.js` from 11 to 21 tests covering invalid sales, followup-safe delete, payment followups, payment/sale party mismatch rejection, stock intake, damage/loss, rentals, admin issue, and stock adjustment.
- **Knowledge base**: Added `stock-workflows.md` and updated architecture, sales-billing, testing, decisions, known issues, README, changelog, and this active context.

## Next Steps
1. Apply migration 010 in live Supabase.
2. Re-run the sales cleanup script if the client still wants all old sales removed.
3. Smoke test the deployed app after Vercel finishes deploying the pushed commit.

## Do Not Touch
- Do not manually edit `products.current_stock` from browser code; use intent-specific RPCs.
- Do not re-enable direct authenticated writes to `sale_items`; sale item changes belong in `record_sale` and `update_sale`.
- Do not run sales cleanup scripts without previewing the rows first.

## House Style Reminders (for future agents)
- New save handlers: use `withSaving(e.currentTarget, async () => { ... })` from `helpers.js`.
- Currency math: round at DB-write boundaries via `roundCurrency()`. Display via `formatCurrency()`.
- Stock mutations: never `db.update('products', ..., { current_stock: ... })` directly. Use one of the higher-level RPCs documented in `stock-workflows.md`.
- Aggregations over high-volume tables: use `db.fetchAllPaged()` or a Postgres aggregate RPC when one exists.
- Magic thresholds: extend `CONFIG` in `helpers.js` rather than inlining.
- User-derived strings in toasts/modal titles: use `textContent`; helper utilities handle this.
- New business logic in demo mode parity: mirror production RPCs in `demoRpc` and add tests in `tests/demo-rpc.test.js`.
- Errors that should reach the operator: surface via `dbOp` or call `reportError` directly.
- Stable lookups (categories, profiles): `db.getAll(table)` is cached for 60s; mutating writes auto-invalidate. Do not pass options if you want the cache.
- Deferred items: edit `knowledge-base/future-scope.md` rather than letting them drift.
- New page render: show `skeletonHTML(...)` while data loads.
- New keyboard shortcut: extend `js/keyboard-shortcuts.js`; avoid ad-hoc keydown listeners.
- Sales bill edits: use `db.rpc('update_sale', ...)`; do not update `sales`, `sale_items`, or `products.current_stock` directly from the client.
