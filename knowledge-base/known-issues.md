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
**Status**: Open
**Severity**: High
**Discovered**: 2026-05-29
**Resolved**:
**Symptom**: Admin attempts to delete a bill and receives a database error instead of the bill being removed.
**Root Cause**: `delete_sale` writes `inventory_transactions.type = 'sale_delete'`, but production schema before migration 009 may only allow checkout/checkin/sale/rental/damage/stock/adjustment values.
**Workaround**: Run `migrations/009_edit_bill_and_delete_fix.sql` before using Delete Bill in production.
**Fix**: Migration 009 widens the transaction type check constraint and recreates `delete_sale`.
**Regression Test**: `tests/demo-rpc.test.js`

---

## ISSUE-004: Bill Delete Still Fails When Payment Followups Reference The Sale
**Status**: Open
**Severity**: High
**Discovered**: 2026-05-29
**Resolved**:
**Symptom**: Admin Delete Bill can still fail for bills that have collection/payment follow-up rows.
**Root Cause**: `payment_followups.sale_id` references `sales(id)` without `ON DELETE CASCADE` or `ON DELETE SET NULL`, while `delete_sale` deletes the sale row without first deleting or detaching followups.
**Workaround**: For one-off cleanup, use the cleanup script pattern that deletes `payment_followups` before deleting `sales`. Avoid using app Delete Bill on bills with followups until the RPC/FK is fixed.
**Fix**:
**Regression Test**: Add a demo/prod contract test for deleting a sale that has a linked payment followup.

---

## ISSUE-005: Non-Sales Stock Flows Still Use Direct Client-Side Stock Updates
**Status**: Open
**Severity**: High
**Discovered**: 2026-05-29
**Resolved**:
**Symptom**: Stock can become inconsistent under concurrent admin actions or partial network/database failures outside the Sales RPC path.
**Root Cause**: Daily admin checkout, damage/loss, rentals, returns, product edit stock changes, and stock intake still update `products.current_stock` directly from the browser and then separately insert audit rows.
**Workaround**: Keep concurrent warehouse operations low and manually reconcile product stock against `inventory_transactions` after any failed save. Sales edit/create/delete use RPCs and are safer than these older flows.
**Fix**:
**Regression Test**: Add RPC contract tests for stock intake, damage/loss, rental out/return, and admin immediate checkout once those flows move server-side.

---

## ISSUE-006: Production `record_sale` RPC Lacks Server-Side Input Validation
**Status**: Open
**Severity**: High
**Discovered**: 2026-05-29
**Resolved**:
**Symptom**: A direct RPC call can create zero-item sales, negative-quantity sales that increase stock, or sales where `amount_received` exceeds the computed total.
**Root Cause**: `migrations/006_atomic_operations.sql` trusts the client for `p_items`, quantities, prices, and `p_amount_received`; the demo RPC has stricter validation than the production SQL.
**Workaround**: Use only the app UI for normal sales entry; it performs client-side validation. This is not a complete protection because authenticated users can call RPCs directly.
**Fix**:
**Regression Test**: Add SQL/integration coverage or mirrored demo contract tests for empty items, negative quantity, negative price, and overpaid sales, then update production RPC.

---

## ISSUE-007: Collection Payment Updates Are Not Atomic With Followup Inserts
**Status**: Open
**Severity**: Medium
**Discovered**: 2026-05-29
**Resolved**:
**Symptom**: Concurrent collection entries, or a failure between followup insert and sale update, can leave `payment_followups` and `sales.amount_received` out of sync.
**Root Cause**: Collections inserts `payment_followups` and then updates `sales.amount_received` in separate browser-side operations using a stale sale value.
**Workaround**: Avoid simultaneous collection updates against the same bill and manually reconcile if a collection save errors.
**Fix**:
**Regression Test**: Add a `record_payment_followup` RPC contract test that inserts the followup and increments/caps the sale payment fields in one transaction.

---

## ISSUE-008: Some Admin Save Handlers Ignore Supabase Error Objects
**Status**: Open
**Severity**: Medium
**Discovered**: 2026-05-29
**Resolved**:
**Symptom**: The UI can show success even when Supabase returned `{ error }`, especially in settings/product/refill handlers that do not use `dbOp`.
**Root Cause**: Several handlers await `db.insert` / `db.update` directly; Supabase client failures return an error object instead of throwing, so local `try/catch` does not catch them.
**Workaround**: Prefer flows already wrapped in `dbOp`. Manually verify critical admin changes after saving until all handlers are wrapped or moved to RPCs.
**Fix**:
**Regression Test**: Add UI/helper tests or refactor tests proving save handlers stop after a returned Supabase error.
