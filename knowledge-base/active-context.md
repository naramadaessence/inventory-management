## Current Status
**Last Updated**: 2026-05-14
**Last Agent Session**: Future-scope sweep — UX/A11y, Tech Debt, Security (3 commits, 2 new migrations)

## In Progress
(No active work-in-progress.)

## Pending User Action
- **Run `migrations/007_decimal_precision.sql`** in Supabase SQL Editor (widens quantity columns to DECIMAL(12,3) so liquid stock keeps gram precision).
- **Run `migrations/008_storage_bucket_policy.sql`** in Supabase SQL Editor (locks down product-images bucket to 5MB + image MIME types only).

## Recently Completed
- **Security batch**: session-expiry detection in `dbOp` (toast + reload), rate limit on `/api/create-user` (5/IP/min), migration 008 for storage bucket policy. Deferred: CSP (needs window.navigateTo refactor).
- **Tech debt batch**: migration 007 (DECIMAL precision), `generateId` uses `crypto.randomUUID`, dashboard one-shot `Promise.all` batching, localStorage quota warning, lookup cache for categories + profiles. Deferred: TypeScript.
- **UX/A11y batch**: skeleton loading helper + dashboard usage, skip-to-content link, sidebar buttons with `aria-current`, keyboard shortcuts (`?` help, `n` new, `/` search, `g X` navigation). Deferred: i18n.
- **Earlier today**: Vitest setup with 9 demoRpc tests, env-gated Sentry integration, src/ scaffolding deleted, future-scope.md created, polish batch (CONFIG/roundCurrency/withSaving/focus-trap), main review batch (atomic RPCs, pagination, schema sync, security fixes).

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
