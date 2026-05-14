## Current Status
**Last Updated**: 2026-05-14
**Last Agent Session**: Operational hardening — tests, error monitoring, dead-code cleanup, future-scope captured

## In Progress
(No active work-in-progress.)

## Recently Completed
- **This batch**:
  - Vitest 3 + happy-dom 20 set up; `tests/demo-rpc.test.js` with 9 passing tests covering record_sale (happy + insufficient stock + multi-item), adjust_stock (positive + negative guard), approve_issue (happy + insufficient), approve_return, delete_sale (cascade + restore + audit). Suite runs in ~11ms. `npm test` and `npm run test:watch` available.
  - `js/error-tracking.js`: env-gated Sentry integration. Activated by setting `VITE_SENTRY_DSN`; otherwise zero bundle cost (dynamic import). Wired into `dbOp` and `window.error` / `unhandledrejection`. User identified to Sentry on login.
  - `src/` Vite scaffolding (counter.js + assets) deleted — unused since the real entry is `js/main.js`.
  - `knowledge-base/future-scope.md` created — single source of truth for deferred items, organized by category (operations, functional, security, tech debt, UX, reporting). Each entry has rationale + trigger condition.
- **Earlier today (polish batch)**:
  - `CONFIG` object, `roundCurrency()`, `withSaving()`, modal focus-trap
- **Earlier today (review batch)**:
  - CORS pin, prod env hard-fail, toast XSS, schema sync, migration 005 (refill RLS scope), migration 006 (atomic RPCs), client wired to RPCs, pagination, server-side inventory log

## Next Steps (deferred)
See **`knowledge-base/future-scope.md`** for the full list with rationale + trigger conditions. Headlines:
- Setup runbook (`SETUP.md`)
- Mobile UX pass on real Android
- Invoice / PDF generation + GST compliance
- Aggregation RPCs (when sales table crosses ~10k rows)
- Backup strategy doc
- Offline support
- Data export (CSV / Excel / Tally)

## Do Not Touch
(Open territory — no active feature branches or in-progress edits.)

## House Style Reminders (for future agents)
- New save handlers: use `withSaving(e.currentTarget, async () => { ... })` from `helpers.js` — don't manually toggle `disabled` / `innerHTML`.
- Currency math: round at DB-write boundaries via `roundCurrency()`. Display via `formatCurrency()` (already 2dp).
- Stock mutations: never `db.update('products', ..., { current_stock: ... })` directly — use `db.rpc('adjust_stock', ...)` or one of the higher-level RPCs (`record_sale`, `approve_issue`, etc.).
- Aggregations over high-volume tables: use `db.fetchAllPaged()`, not `db.getAll()`, to avoid silent 1000-row truncation.
- Magic thresholds: extend `CONFIG` in `helpers.js` rather than inlining numbers.
- User-derived strings in toasts/modal titles: pass through `textContent` (already handled inside the helpers); don't pass HTML.
- New business logic in demo mode parity: when adding a new RPC to `migrations/006_atomic_operations.sql`, mirror it in `demoRpc` (`js/supabase.js`) and add a test in `tests/demo-rpc.test.js`.
- Errors that should reach the operator (not just the user): surface via `dbOp` (auto-routes to Sentry) or call `reportError` directly from `error-tracking.js`.
- Adding deferred items: edit `knowledge-base/future-scope.md` rather than letting them drift in code comments.
