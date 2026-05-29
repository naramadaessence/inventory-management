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
