## Current Status
**Last Updated**: 2026-05-29
**Last Agent Session**: Client sales request - Edit Bill, Delete Bill fix, and 18000 sales cleanup script
**Test Suite Status**: Pass - `npm test` passed 11/11 and `npm run build` passed on 2026-05-29

## In Progress
(No active work-in-progress.)

## Pending User Action
- Run `migrations/009_edit_bill_and_delete_fix.sql` in the live Supabase project before deploying the updated UI.
- Review and run either `supabase-scripts/clear-18000-sales-data.sql` for exact 18000-total bills or `supabase-scripts/clear-all-sales-data-preserve-stock.sql` for all current sales data. Live read-only QA showed total sales as 18070 across 7 transactions.

## Recently Completed
- **Edit Bill**: Admin Sales table now has visible Edit Bill buttons. Modal edits party/date/items/qty/price/payment/notes and saves via `update_sale`.
- **Delete Bill fix**: Added migration 009 to allow `sale_delete` audit rows and recreate `delete_sale`.
- **Sales cleanup**: Added one-off SQL scripts for exact-18000 cleanup and all-sales cleanup, both preserving product stock.
- **Knowledge-base review**: Read README, active context, decisions, known issues, architecture, future scope, and changelog to establish current project understanding.
- **Testing documentation**: Added `knowledge-base/testing.md`, linked it from README, and recorded the Vitest + happy-dom testing decision.
- **Known issue documentation**: Logged demo-mode `record_sale` rollback caveat as ISSUE-002; production Supabase RPC remains transactional.
- **Sidebar logo**: Replaced emoji+text branding with company `logo.png` (3:1 aspect ratio, served from `public/`).
- **Category stock summary**: Products page now shows a summary bar with total unit stock (pcs) and total liquid stock (kg) above the grid/table. Updates dynamically on category filter change. Client-requested feature.
- **Previous session**: Future-scope sweep — UX/A11y (skeletons, keyboard shortcuts, a11y), Tech Debt (DECIMAL precision, dashboard batching, cache), Security (session expiry, rate limit, storage bucket policy).

## Next Steps (deferred)
See **`knowledge-base/future-scope.md`** — items remaining there are now genuinely "later":
- Setup runbook (`SETUP.md`)
- Mobile UX pass on real Android
- Invoice / PDF generation + GST compliance
- Aggregation RPCs (when tables cross ~10k rows)
- Backup strategy doc
- Offline support
- Data export
- TypeScript migration
- i18n (Hindi / Gujarati)
- Content Security Policy (needs event-delegation refactor first)

## Do Not Touch
(Open territory — no active feature branches or in-progress edits.)

## House Style Reminders (for future agents)
- New save handlers: use `withSaving(e.currentTarget, async () => { ... })` from `helpers.js`.
- Currency math: round at DB-write boundaries via `roundCurrency()`. Display via `formatCurrency()` (already 2dp).
- Stock mutations: never `db.update('products', ..., { current_stock: ... })` directly — use `db.rpc('adjust_stock', ...)` or one of the higher-level RPCs.
- Aggregations over high-volume tables: use `db.fetchAllPaged()` (or query a Postgres aggregate when one exists).
- Magic thresholds: extend `CONFIG` in `helpers.js` rather than inlining.
- User-derived strings in toasts/modal titles: use `textContent` (the helpers handle this for you).
- New business logic in demo mode parity: when adding a new RPC to migration 006, mirror it in `demoRpc` and add a test in `tests/demo-rpc.test.js`.
- Errors that should reach the operator: surface via `dbOp` (auto-routes to Sentry) or call `reportError` directly.
- Stable lookups (categories, profiles): `db.getAll(table)` is cached for 60s; mutating writes auto-invalidate. Don't pass options if you want the cache.
- Deferred items: edit `knowledge-base/future-scope.md` rather than letting them drift.
- New page render: show `skeletonHTML(...)` while data loads — no blank screens.
- New keyboard shortcut: extend `js/keyboard-shortcuts.js` (don't add ad-hoc keydown listeners).
- Sales bill edits: use `db.rpc('update_sale', ...)`; do not update `sales`, `sale_items`, or `products.current_stock` directly from the client.
