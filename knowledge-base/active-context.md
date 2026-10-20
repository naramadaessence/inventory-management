## Current Status
**Last Updated**: 2026-10-20
**Last Agent Session**: Production was down (Vercel Hobby team paused since 2026-07-23). Moved `create-user` to a Supabase Edge Function, prepared Cloudflare Pages hosting, escaped the sidebar user name, refreshed the whole KB, documented migration re-run risk and a leaked admin password.
**Test Suite Status**: Pass — `npm test` 34/34 and `npm run build` pass on 2026-10-20.

## In Progress
- [x] Cloudflare Pages project `narmada-inventory` live at https://narmada-inventory.pages.dev (Git-connected, branch main). Login page renders, no console errors.
- [x] Deploy Edge Function `create-user` to project `jnfykpicpttvnihgsckt` — done 2026-10-20 via CLI (v2, ACTIVE, verify_jwt false). Verified: OPTIONS from localhost → 204 + ACAO; POST without auth → 401 "Unauthorized"; bogus token → 401 "Invalid token".
- [x] `ALLOWED_ORIGINS=https://narmada-inventory.pages.dev` set; preflight from that origin verified. Add a custom domain here too if one is attached later.
- [x] Smoke test 2026-10-20: admin login and Create User confirmed working by the owner. Record/edit/delete sale not yet re-tested on the new host.

## Pending User Action
- **Rotate the production admin password** (ISSUE-010) — it was in the public repo.
- ~~Supabase GitHub integration "Deploy to production" OFF~~ — done by owner 2026-10-20.
- Paste `VITE_SUPABASE_ANON_KEY` into Cloudflare env vars (agents do not enter keys).
- Answer: what should Products "Sell Qty" / "Installed Qty" mean? (ISSUE-012)
- Run the read-only checks in ISSUE-013 and the migration-state queries below on the live DB, and record which of 010–014 are applied:
  ```sql
  select table_name, column_name from information_schema.columns where table_schema='public' and ((table_name='sales' and column_name='sale_type') or (table_name='products' and column_name in ('sell_qty','installed_qty')));
  select proname, pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname in ('record_sale','update_sale','record_payment_followup','set_product_stock','admin_issue_stock') order by 1,2;
  select conname, pg_get_constraintdef(oid) from pg_constraint where conname in ('payment_followups_nonnegative_amount','parties_amc_day_check') or (conrelid='public.payment_followups'::regclass and contype='c');
  ```
- ~~Supabase Auth Site URL → https://narmada-inventory.pages.dev~~ — done by owner 2026-10-20 (Redirect URLs left empty; the app only uses email/password sign-in).
- Optional: delete the Vercel project now that Cloudflare is live; tell staff the new URL.

## Next Steps
1. ISSUE-009 resolved (site live on Cloudflare). Remaining: Pending User Action items below.
2. Based on the live-DB query results, write a follow-up migration only for what is actually missing (and drop duplicate `record_sale`/`update_sale` overloads if both arg lists exist).
3. Decide on ISSUE-012 with the client.

## Do Not Touch
- Do not manually edit `products.current_stock` from browser code; use intent-specific RPCs.
- Do not re-enable direct authenticated writes to `sale_items`.
- Do not run sales cleanup scripts without previewing the rows first.
- Do not re-run anything in `migrations/` or move it under `supabase/migrations/` (ISSUE-011).
- Do not add a Free-to-Use price floor; below-price sales are allowed by client request (`sales-billing.md`).
- Never write credentials into the KB or code.

## House Style Reminders (for future agents)
- New save handlers: use `withSaving(e.currentTarget, async () => { ... })` from `helpers.js`.
- Currency math: round at DB-write boundaries via `roundCurrency()`. Display via `formatCurrency()`.
- Stock mutations: never `db.update('products', ..., { current_stock: ... })` directly. Use one of the higher-level RPCs documented in `stock-workflows.md`.
- Aggregations over high-volume tables: use `db.fetchAllPaged()` or a Postgres aggregate RPC when one exists.
- Magic thresholds: extend `CONFIG` in `helpers.js` rather than inlining.
- User-derived strings: always `esc()` in template HTML; toasts/modal titles use `textContent`.
- New business logic in demo mode parity: mirror production RPCs in `demoRpc` and add tests in `tests/demo-rpc.test.js`.
- Server-side code: Supabase Edge Functions under `supabase/functions/<name>/` with logic in a testable `handler.js`.
- Errors that should reach the operator: surface via `dbOp` or call `reportError` directly.
- Stable lookups (categories, profiles): `db.getAll(table)` is cached for 60s; mutating writes auto-invalidate.
- Deferred items: edit `knowledge-base/future-scope.md` rather than letting them drift.
- New page render: show `skeletonHTML(...)` while data loads.
- New keyboard shortcut: extend `js/keyboard-shortcuts.js`; avoid ad-hoc keydown listeners.
- Sales bill edits: use `db.rpc('update_sale', ...)`.
