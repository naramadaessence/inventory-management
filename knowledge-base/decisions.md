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


## Decision: Atomic Operations via Postgres RPCs (migration 006)
**Date**: 2026-05-14
**Status**: Accepted
**Context**: Stock mutations were read-modify-write — race conditions could silently overwrite concurrent updates. Multi-step writes (record sale, approve return, delete sale) had no atomicity guarantee — partial failures left the DB inconsistent (sale row with missing line items, or stock deducted without a matching `inventory_transactions` entry).
**Decision**: Move stock-mutating logic into Postgres functions called via `supabase.rpc()`. Each function runs in a single transaction. Five RPCs added: `adjust_stock`, `record_sale`, `approve_issue`, `approve_return`, `delete_sale`.
**Alternatives Considered**:
- **Client-side optimistic locking** (read-then-conditional-update): possible with Supabase `.eq('current_stock', expectedStock)` but messy for multi-step ops; doesn't solve cross-table atomicity.
- **Edge function with manual transactions**: same outcome but more moving parts; RPCs in the same project are cheaper and stay close to the data.
**Consequences**:
- Stock corruption under concurrency is no longer possible — `adjust_stock` enforces non-negative result atomically.
- Partial-write recovery code (compensating actions) is no longer needed.
- Demo mode required a parallel implementation — `demoRpc` table in `supabase.js` mirrors each Postgres function so the same call sites work in both modes.
- Future RPC additions need the same dual implementation; documented in `migrations/006_atomic_operations.sql` header.

## Decision: Server-Side Pagination for Aggregations
**Date**: 2026-05-14
**Status**: Accepted
**Context**: Supabase REST defaults to a max of 1000 rows per response. Code computing totals (revenue, transaction counts, stock-by-product) over the full `sales` / `inventory_transactions` tables was silently truncating once those tables crossed 1000 rows. No error surfaced — just wrong numbers in the UI.
**Decision**:
- Added `db.fetchAllPaged(table, options)` that pages through the table in 1000-row chunks for aggregations.
- Display lists use `db.getAll(..., { limit: N })`.
- Inventory Log uses true server-side pagination (`limit + offset` + Prev/Next buttons) since it's the only table expected to grow indefinitely (audit trail).
**Alternatives Considered**:
- **Move all aggregations to Postgres views/RPCs**: cleaner long-term but a bigger refactor; the chunked client-side approach is correct, just less efficient.
- **Increase the per-request limit on Supabase**: possible but doesn't scale, and the 1000 cap is there for a reason (latency + memory).
**Consequences**:
- Aggregations stay correct as data grows.
- Bandwidth scales linearly with table size — fine for current single-warehouse load; revisit when `sales`/`inventory_transactions` cross ~10k rows.
- Future improvement: convert specific aggregations (revenue-by-product, fast/slow movers) to Postgres RPCs that return scalars/small result sets.
