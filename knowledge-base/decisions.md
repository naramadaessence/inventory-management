## Decision: Multi-Item Sales via sale_items Table (not JSONB)
**Date**: 2026-05-12
**Status**: Accepted
**Context**: Client needed sellers to record multiple products per sale (bill/invoice style). The old schema had `product_id`, `quantity`, `unit_price` directly on the `sales` row — 1 product per sale.
**Decision**: Created a proper `sale_items` child table with FK to `sales` and FK to `products`. Removed `product_id`, `quantity`, `unit_price` from `sales`.
**Alternatives Considered**:
- **JSONB `items` array on sales row**: Faster to implement (no new table), but no foreign keys, no server-side filtering, forces client-side JSON parsing in reports/collections, and data duplication. Rejected as a patch fix.
**Consequences**:
- All files that read `sales.product_id` needed updating (sales.js, collections.js, reports.js — 8 total references)
- Future queries like "sales by product" or "party purchase history" work natively via SQL
- Clean relational model for any future features (invoicing, returns, etc.)
- Demo mode localStorage needs `sale_items` array and nextId entry

## Decision: Seller Sales Access — Add-Only
**Date**: 2026-05-12
**Status**: Accepted
**Context**: Sellers need to record sales in the field but should not see other sellers' data or modify/delete existing records.
**Decision**: Removed `auth.isAdmin()` guard from `renderSales()`. Sellers see only their own sales (`recorded_by === userId`). Edit/delete buttons hidden for non-admin. Stats cards hidden for sellers.
**Alternatives Considered**:
- Full access for sellers: rejected — sellers should not see each other's data or business totals
- Separate "Record Sale" page without history: rejected — sellers need to verify their own recent entries
**Consequences**: Admin sees all sales with full edit/delete. Sellers see own sales with add-only access.
