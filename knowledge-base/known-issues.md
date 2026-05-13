# Known Issues

## ISSUE-001: Demo Mode sale_items Cascade Delete
**Status**: Accepted Risk
**Severity**: Low
**Discovered**: 2026-05-12
**Symptom**: In demo mode (localStorage), deleting a sale does not automatically cascade-delete its `sale_items` entries because localStorage has no FK constraints.
**Root Cause**: localStorage `db.delete()` only deletes from the specified table, not related tables.
**Workaround**: Demo mode is for testing only. In production Supabase, `ON DELETE CASCADE` handles this correctly.
**Fix**: Would need to add manual cascade logic in `supabase.js` demo delete — not worth the complexity for a demo-only feature.
