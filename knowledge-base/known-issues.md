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

(No other known issues at this time.)
