## Current Status
**Last Updated**: 2026-05-22
**Last Agent Session**: Sidebar logo swap + category stock summary bar on Products page

## In Progress
(No active work-in-progress.)

## Pending User Action
(None — migrations 007 and 008 already executed.)

## Recently Completed
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
