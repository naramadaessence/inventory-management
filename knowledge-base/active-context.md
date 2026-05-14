## Current Status
**Last Updated**: 2026-05-14
**Last Agent Session**: Review Round 2 Polish — CONFIG, currency rounding, withSaving, modal focus-trap

## In Progress
(No active work-in-progress.)

## Recently Completed
- **Polish batch (this session)**:
  - `CONFIG` object in `helpers.js` with 5 named thresholds; 7 magic-number sites replaced
  - `roundCurrency()` helper applied at DB-write boundaries (sale-save, edit-sale-save, visit-save, fu-save)
  - `withSaving()` helper applied to all 13 save handlers across 8 page files (eliminates double-click duplicate sales)
  - Modal focus-trap in `createModal`: autofocus, Tab/Shift+Tab containment, Esc-to-close, return-focus-to-trigger
- **Earlier today (review batch)**:
  - Acted on code review findings: CORS pin on `/api/create-user`, prod env-var hard-fail, toast/modal XSS hardening, schema file resync
  - Migration 005 (`refill_completions` RLS scope) — applied
  - Migration 006 (atomic operation RPCs: `adjust_stock`, `record_sale`, `approve_issue`, `approve_return`, `delete_sale`) — applied
  - Client wired to use `db.rpc()` for sale recording, sale deletion, issue approval, return approval
  - `db.fetchAllPaged()` helper + applied to high-volume aggregation reads across dashboard, sales, collections, reports, daily-operations
  - Inventory Log: server-side pagination (50/page, Prev/Next, type filter via `.eq`)

## Next Steps (deferred)
- **Long-term**: convert specific aggregations (revenue-by-product, fast/slow movers, total revenue) to dedicated Postgres RPCs that return scalars/small result sets instead of pulling all rows via `fetchAllPaged`. Defer until `sales` / `inventory_transactions` tables cross ~10k rows.

## Do Not Touch
(Open territory — no active feature branches or in-progress edits.)

## House Style Reminders (for future agents)
- New save handlers: use `withSaving(e.currentTarget, async () => { ... })` from `helpers.js` — don't manually toggle `disabled` / `innerHTML`.
- Currency math: round at DB-write boundaries via `roundCurrency()`. Display via `formatCurrency()` (already 2dp).
- Stock mutations: never `db.update('products', ..., { current_stock: ... })` directly — use `db.rpc('adjust_stock', ...)` or one of the higher-level RPCs (`record_sale`, `approve_issue`, etc.).
- Aggregations over high-volume tables: use `db.fetchAllPaged()`, not `db.getAll()`, to avoid silent 1000-row truncation.
- Magic thresholds: extend `CONFIG` in `helpers.js` rather than inlining numbers.
- User-derived strings in toasts/modal titles: pass through `textContent` (already handled inside the helpers); don't pass HTML.
