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
