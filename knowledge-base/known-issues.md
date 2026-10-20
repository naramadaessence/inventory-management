# Known Issues

## ISSUE-001: Demo Mode sale_items Cascade Delete
**Status**: ✅ Resolved (2026-05-14)
**Severity**: Low
**Discovered**: 2026-05-12
**Resolved**: 2026-05-14 via `demoRpc.delete_sale` in `js/supabase.js`
**Symptom**: In demo mode (localStorage), deleting a sale did not automatically cascade-delete its `sale_items` entries because localStorage has no FK constraints.
**Root Cause**: localStorage `db.delete()` only deleted from the specified table, not related tables.
**Resolution**: Replaced the manual two-step delete with `db.rpc('delete_sale', { p_sale_id, p_performer_id })`. The demo handler explicitly cascades `sale_items` in localStorage before deleting the sale row, mirroring the Postgres `ON DELETE CASCADE` behavior used in production.

---

## ISSUE-002: Demo Mode record_sale Does Not Fully Roll Back Mid-Loop Failures
**Status**: Resolved
**Severity**: Low
**Discovered**: 2026-05-29
**Resolved**: 2026-05-29
**Symptom**: In demo mode, a multi-item `record_sale` failure after the sale row is inserted can leave a sale header without matching line items. Production Postgres RPCs run in a transaction and roll back the full operation.
**Root Cause**: The localStorage `demoRpc.record_sale` implementation is not truly transactional; it inserts the sale header before all stock checks and item writes have completed.
**Workaround**: None needed after fix.
**Fix**: Demo mode now validates all line items and stock availability before inserting the sale header or sale_items.
**Regression Test**: `tests/demo-rpc.test.js`

---

## ISSUE-003: Bill Delete Fails Before Sale Delete Audit Type Migration
**Status**: Resolved
**Severity**: High
**Discovered**: 2026-05-29
**Resolved**: 2026-05-29
**Symptom**: Admin attempts to delete a bill and receives a database error instead of the bill being removed.
**Root Cause**: `delete_sale` writes `inventory_transactions.type = 'sale_delete'`, but production schema before migration 009 may only allow checkout/checkin/sale/rental/damage/stock/adjustment values.
**Workaround**: Run `migrations/010_data_consistency_hardening.sql` before using Delete Bill in production.
**Fix**: Migration 010 widens the transaction type check constraint, recreates `delete_sale`, and supersedes migration 009 for this path.
**Regression Test**: `tests/demo-rpc.test.js`

---

## ISSUE-004: Bill Delete Still Fails When Payment Followups Reference The Sale
**Status**: Resolved
**Severity**: High
**Discovered**: 2026-05-29
**Resolved**: 2026-05-29
**Symptom**: Admin Delete Bill can still fail for bills that have collection/payment follow-up rows.
**Root Cause**: `payment_followups.sale_id` references `sales(id)` without `ON DELETE CASCADE` or `ON DELETE SET NULL`, while `delete_sale` deletes the sale row without first deleting or detaching followups.
**Workaround**: Run migration 010 in production before relying on app Delete Bill for bills with followups.
**Fix**: Migration 010 changes `payment_followups.sale_id` to `ON DELETE SET NULL` and updates `delete_sale` to detach followups before deleting the sale.
**Regression Test**: `tests/demo-rpc.test.js`

---

## ISSUE-005: Non-Sales Stock Flows Still Use Direct Client-Side Stock Updates
**Status**: Resolved
**Severity**: High
**Discovered**: 2026-05-29
**Resolved**: 2026-05-29
**Symptom**: Stock can become inconsistent under concurrent admin actions or partial network/database failures outside the Sales RPC path.
**Root Cause**: Daily admin checkout, damage/loss, rentals, returns, product edit stock changes, and stock intake still update `products.current_stock` directly from the browser and then separately insert audit rows.
**Workaround**: Run migration 010 before using the updated deployed UI.
**Fix**: Added transactional RPCs for stock intake, damage/loss, rental out/return, admin immediate checkout, and product stock adjustment; updated UI call sites to use them.
**Regression Test**: `tests/demo-rpc.test.js`

---

## ISSUE-006: Production `record_sale` RPC Lacks Server-Side Input Validation
**Status**: Resolved
**Severity**: High
**Discovered**: 2026-05-29
**Resolved**: 2026-05-29
**Symptom**: A direct RPC call can create zero-item sales, negative-quantity sales that increase stock, or sales where `amount_received` exceeds the computed total.
**Root Cause**: `migrations/006_atomic_operations.sql` trusts the client for `p_items`, quantities, prices, and `p_amount_received`; the demo RPC has stricter validation than the production SQL.
**Workaround**: Run migration 010 before relying on production validation.
**Fix**: Migration 010 recreates `record_sale` with server-side validation for authentication, payment status, non-empty items, positive quantities, non-negative prices, existing products, and amount-received bounds.
**Regression Test**: `tests/demo-rpc.test.js`

---

## ISSUE-007: Collection Payment Updates Are Not Atomic With Followup Inserts
**Status**: Resolved
**Severity**: Medium
**Discovered**: 2026-05-29
**Resolved**: 2026-05-29
**Symptom**: Concurrent collection entries, or a failure between followup insert and sale update, can leave `payment_followups` and `sales.amount_received` out of sync.
**Root Cause**: Collections inserts `payment_followups` and then updates `sales.amount_received` in separate browser-side operations using a stale sale value.
**Workaround**: Run migration 010 before relying on the deployed Collections flow.
**Fix**: Added `record_payment_followup` RPC and updated Collections to use it for followup insert + locked sale payment update in one call.
**Regression Test**: `tests/demo-rpc.test.js`

---

## ISSUE-008: Some Admin Save Handlers Ignore Supabase Error Objects
**Status**: Resolved
**Severity**: Medium
**Discovered**: 2026-05-29
**Resolved**: 2026-05-29
**Symptom**: The UI can show success even when Supabase returned `{ error }`, especially in settings/product/refill handlers that do not use `dbOp`.
**Root Cause**: Several handlers await `db.insert` / `db.update` directly; Supabase client failures return an error object instead of throwing, so local `try/catch` does not catch them.
**Workaround**: None needed after deploying this code.
**Fix**: Updated dashboard refill completions, settings users/categories/stock intake, product save/delete, and stock-related flows to use `dbOp` or RPC results before showing success.
**Regression Test**: `npm run build`; behavior also covered indirectly by demo RPC tests for the new RPC-backed flows.

---

## ISSUE-009: Production Site Down — Vercel Hobby Team Paused
**Status**: Resolved
**Resolved**: 2026-10-20 — live at https://narmada-inventory.pages.dev; admin confirmed login and Settings → Create User work in production
**Severity**: Critical
**Discovered**: 2026-10-20
**Symptom**: `inventory-management-pi-opal.vercel.app` and `/api/create-user` return `402 Payment Required` (`X-Vercel-Error: DEPLOYMENT_DISABLED`) since 2026-07-23.
**Root Cause**: The Vercel Hobby team exceeded Fluid Provisioned Memory fair use (most likely another project in the team, "broadcast", since deleted — not confirmed). Paused Hobby teams do not auto-resume.
**Workaround**: None on Vercel without upgrading to Pro.
**Fix**: Code moved to Cloudflare Pages + Supabase Edge Function on 2026-10-20 (see `deployment.md`). Mark resolved once the Cloudflare site is live and Create User is smoke-tested.
**Regression Test**: `tests/create-user-function.test.js` (function logic); deploy smoke test is manual.

---

## ISSUE-010: Production Admin Password Committed To A Public Repo
**Status**: Resolved
**Resolved**: 2026-10-20 — owner rotated the admin password; the old value remains in public git history but no longer works
**Severity**: Critical
**Discovered**: 2026-10-20
**Symptom**: `knowledge-base/changelog.md` (2026-04-24 entry) contained the live admin email and password in plain text. The GitHub repo is public (clones without auth).
**Root Cause**: Deployment notes were written into the KB with credentials.
**Workaround**: None — anyone can read git history.
**Fix**: Password removed from the current file on 2026-10-20. Still required: change the admin password in Supabase (Authentication → Users), and consider making the repo private. Rewriting git history is optional and does not help once a secret has been public.
**Regression Test**: None (process rule: never write credentials into the KB or code).

---

## ISSUE-011: SQL Migrations Are Not Re-Runnable And There Is No Migration History
**Status**: Accepted Risk
**Severity**: High
**Discovered**: 2026-10-20
**Symptom**: Re-running files in `migrations/` against production damages data or security: 002 divides liquid stock by 1000 again, 006 and 009 replace the hardened RPCs from 010–012 with unvalidated versions (006 also re-grants `adjust_stock`), 010 re-adds the non-negative followup constraint that 012 removed, 003/004 fail. A fresh database cannot be built by running `supabase-schema.sql` then 002–014 (002/003 reference dropped `sales` columns).
**Root Cause**: Migrations were written as one-shot SQL-editor scripts; `supabase-schema.sql` was edited in place; no `supabase_migrations` history.
**Workaround**: Apply only new migrations, once, by hand. Keep Supabase GitHub integration "Deploy to production" OFF and never place these files under `supabase/migrations/`.
**Fix**: Baseline with `supabase db pull` before adopting CLI/integration-managed migrations (see `deployment.md`).
**Regression Test**: None.

---

## ISSUE-012: "Current Stock" On Products Page May Double-Count Sales
**Status**: Open — needs client decision
**Severity**: Medium
**Discovered**: 2026-10-20
**Symptom**: Products page shows "Total Stock" = `current_stock` and "Current Stock" = `current_stock − sell_qty − installed_qty`. `current_stock` is already reduced automatically by every sale, so if staff also type sold quantities into Sell Qty they are subtracted twice. The Products page low-stock styling uses the derived figure while the Dashboard low-stock alert and sale stock checks use `current_stock`, so they can disagree.
**Root Cause**: `sell_qty`/`installed_qty` (migration 013) are manual numbers with no link to sales or installations; their intended meaning was not specified.
**Workaround**: Treat Sell Qty / Installed Qty as notes only; rely on Dashboard alerts.
**Fix**: Pending client answer on what Sell Qty / Installed Qty should mean.
**Regression Test**: None yet.

---

## ISSUE-013: Migration 012 May Not Remove The Base Schema's Followup Amount Check
**Status**: Accepted Risk — not present in production (verified 2026-10-20: `payment_followups` has no CHECK constraints; `parties_amc_day_check` is 1–31, so 014 is applied). Still affects a database rebuilt from `supabase-schema.sql`.
**Severity**: Medium
**Discovered**: 2026-10-20
**Symptom**: Editing a paid bill back to a lower amount could fail when `update_sale` inserts a negative correction row into `payment_followups`.
**Root Cause**: 012 drops `payment_followups_nonnegative_amount`, but `supabase-schema.sql` declares an inline `CHECK (amount_collected >= 0)` with an auto-generated name, which 012 does not drop. Only databases built from the base schema are affected; production may differ.
**Workaround**: Check live constraints with `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.payment_followups'::regclass and contype = 'c';`
**Fix**: If an auto-named non-negative check exists in prod, drop it in a new migration.
**Regression Test**: None (demo mode has no constraints).

---

## ISSUE-014: Signed-In User Name Rendered Unescaped In Sidebar
**Status**: Resolved
**Severity**: Low
**Discovered**: 2026-10-20
**Resolved**: 2026-10-20
**Symptom**: A profile `full_name` containing HTML was injected into the sidebar.
**Root Cause**: `renderShell()` in `js/main.js` interpolated `user.full_name`, initials and role without `esc()`.
**Fix**: Wrapped all three in `esc()`.
**Regression Test**: `tests/app-shell.test.js`