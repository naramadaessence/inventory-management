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

## Decision: Business Mutations Through Intent-Specific RPCs
**Date**: 2026-05-29
**Status**: Accepted
**Context**: A data-consistency review found remaining browser-side multi-step writes for stock intake, damage/loss, rentals, admin immediate checkout, product stock adjustment, and collection followups. These flows could leave product stock, audit rows, followups, or sale payment totals out of sync under partial failures or concurrent use.
**Decision**: Extend the migration 006 RPC pattern with migration 010. Browser code now calls intent-specific business RPCs (`record_stock_intake`, `record_damage_loss`, `create_rental`, `return_rental`, `admin_issue_stock`, `set_product_stock`, and `record_payment_followup`) instead of updating related tables directly. `adjust_stock` remains an internal primitive, direct `sale_items` writes are removed from authenticated RLS policies, and business RPC execution is explicitly revoked from `PUBLIC`/`anon` before being granted to `authenticated`.
**Alternatives Considered**:
- Keep direct browser writes and add more `dbOp` wrapping: rejected because it improves error reporting but does not make multi-table writes transactional.
- Expose `adjust_stock` to the browser for all callers: rejected because business validation and audit semantics belong with each workflow.
- Move everything to Edge Functions: rejected for current scale because Postgres RPCs are simpler, transactional, and already established in this project.
**Consequences**: Data consistency is stronger and future stock/payment workflows have a clear pattern. Production must run migration 010 before deployed UI depends on the new RPCs. Demo mode must mirror every new RPC and tests must cover the public `db.rpc(...)` call shape.
**Superseded By**:

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

## Decision: Vitest + happy-dom for Demo RPC Contract Tests
**Date**: 2026-05-14
**Status**: Accepted
**Context**: Stock-mutating business logic moved into production Postgres RPCs, while demo mode mirrors those RPCs in localStorage. The project needed fast tests that can exercise the same `db.rpc(name, params)` shape without needing a live Supabase project.
**Decision**: Use Vitest with the happy-dom environment. Tests run against the public `db` and `auth` APIs, initialize the demo store via `auth.getSession()`, and verify demo RPC behavior as a contract proxy for production RPC call shapes.
**Alternatives Considered**: Browser E2E tests were deferred because they are heavier than needed for the current business-logic layer. Direct unit tests of private helpers were rejected because they would couple tests to implementation details instead of the app-facing DB contract.
**Consequences**: `npm test` is fast enough to run every session. New stock-mutating RPCs must be mirrored in demo mode and tested through the same public `db.rpc(...)` path. UI and real Supabase RLS behavior are not fully covered by this suite yet.
**Superseded By**:

## Decision: Edit Bills Through update_sale RPC
**Date**: 2026-05-29
**Status**: Accepted
**Context**: Client needs to edit bills after creation and delete bills reliably. Editing line items affects stock, sale_items, sale totals, payment state, and inventory audit rows, so a client-side multi-step update would reintroduce partial-write and race-condition risks.
**Decision**: Add a Postgres `update_sale` RPC and matching demo-mode handler. The RPC restores old sale-item stock, replaces line items, deducts edited quantities, updates the sale header, and writes audit rows in one transaction.
**Alternatives Considered**: Direct client updates to `sales`, `sale_items`, and `products.current_stock` were rejected because they bypass the atomic stock-write rule. Delete-and-recreate was rejected because it changes bill IDs and matches the client complaint.
**Consequences**: Production must run migration 009 before deploying the UI. Future bill-edit behavior belongs in `update_sale`, and each new stock-impacting edit path needs demo RPC parity plus tests.
**Superseded By**:

## Decision: Host on Cloudflare Pages + Supabase Edge Function (leave Vercel)
**Date**: 2026-10-20
**Status**: Accepted
**Context**: Vercel paused the whole Hobby team on 2026-07-23 for exceeding Fluid Provisioned Memory; it stayed paused for ~3 months and Vercel only lifts it via a Pro upgrade or support. Vercel Hobby is also non-commercial only, and this is a business app. The app is a static SPA with a single serverless endpoint (admin user creation).
**Decision**: Serve `dist/` from Cloudflare Pages (free plan, commercial use allowed, unlimited static bandwidth). Move `api/create-user.js` to a Supabase Edge Function `create-user` so the service role key never leaves Supabase and the frontend host has no server code. The client calls it with `supabase.functions.invoke`. Logic lives in a runtime-agnostic `handler.js` so it can be unit-tested in Vitest; `index.ts` is a one-line Deno entry.
**Alternatives Considered**:
- Vercel Pro ($20/user/month): fastest, no code change, but recurring cost for a static site.
- Cloudflare Pages Function for create-user: would put the service role key in Cloudflare and tie the code to one host.
- New Vercel Hobby team: still non-commercial and could count as evading limits.
**Consequences**: Hosting is free and host-independent (any static host works). Edge Function deploys are manual (CLI or dashboard) and `ALLOWED_ORIGINS` must list the production origin. Supabase's GitHub integration must stay off for migrations until the schema is baselined (see `deployment.md`).
**Superseded By**:
## Decision: Daily Stock Reconciliation On Top Of The Issue/Return Flow
**Date**: 2026-10-20
**Status**: Accepted
**Context**: Client asked for purchase entry, usage entry, automatic cross-checking of issued vs returned vs used stock, mismatch alerts, manager approval of discrepancies and adjustments, and staff-/product-/fragrance-wise records. The app already had an issue → return → admin approval flow, stock intake, and an audit log.
**Decision**: Extend the existing flow instead of building a parallel one (details in `stock-reconciliation.md`): fragrance as a product tag; usage captured on the return form; Difference = Issued − Returned − Used with a configurable tolerance (10 g liquids / 0 pcs); returns with a difference need an admin classification + note before approval; editing stock becomes an approval request applied as a delta; purchases extend `stock_intakes`; machine installations from usage keep Total Stock = all owned machines and add to Installed Qty. All writes are RPCs with demo parity (migration 016).
**Alternatives Considered**:
- Restructure products into type × fragrance variants: cleaner model but would migrate every product, sale and history row — rejected by owner.
- Separate usage log during the day: more taps for staff in the field; can be added later on top of `checkout_usage`.
- Blocking returns until they match: would push staff to fake numbers; approval with classification keeps the truth visible.
- New Manager role / maker-checker: owner chose "any admin" (requester and approver are recorded).
**Consequences**: Production needs migration 016 before the new screens work. The return Flag button (which silently dropped returned stock) is replaced by Send back. Reports can now show shortages per staff per day. Any future stock-changing flow must still go through an RPC and the audit log.
**Superseded By**:

## Decision: In-App Help Centre With Content As Data And Generated Screenshots
**Date**: 2026-11-01
**Status**: Accepted
**Context**: Owner wanted a tutorial for every action with screenshots, searchable and available to everyone: "if someone has a question how do I do this, they find the answer here". Users are sellers in the field (phones) and admins in the warehouse.
**Decision**: A Help page inside the app (`help-centre.md`) instead of an external document. Guides are plain JS data files per topic (`js/help/sections/`), rendered and searched client-side with a small custom scorer; the page module is lazy-loaded. Screenshots are WebP files in `public/help/`, generated from the demo build with `?demo=week` data by a headless-Edge harness kept in `scripts/help-screenshots/`. Six writer agents drafted one topic each against a shared style guide (vocabulary, format, anchor ids).
**Alternatives Considered**:
- External doc (Google Doc / PDF): not searchable in context, goes stale, sellers wouldn't find it. Rejected by the owner.
- Markdown files + a markdown/search library: adds dependencies for little gain; structured blocks give a consistent layout and testable links.
- Screenshots of production: would expose real parties and money; demo data is realistic and reproducible.
- puppeteer-core as a devDependency: the harness is run rarely; documented as `npm i --no-save` instead.
**Consequences**: Every UI change should update the matching guide and re-shoot its screenshots (no test can detect a guide that no longer matches the screen). `public/help` adds ~4.8 MB to the deploy, loaded lazily per image. Content integrity (links, images, anchors, roles) is test-enforced.
**Superseded By**:

## Decision: "Any <Category>" Issue Lines Held Against The Category, Named On Return
**Date**: 2026-11-19
**Status**: Accepted (refined the same day: pieces that came back need no type — see "Any Returns: Only Pieces That Did Not Come Back Are Named")
**Context**: Staff want to take stock out by category ("any 10 refills") without naming products. Stock is tracked per product, so at some point every piece has to be tied to a product, or per-product stock drifts. Owner's rule: the staff member names the type of every piece on the return (returned / used / sold / lost) — never "unknown". Same request: bills made in the field from issued stock must not take stock off twice (ISSUE-023).
**Decision** (details in `category-issue.md`, migration 018):
- An Any line is a `checkout_items` row with `product_id` NULL and `category_id` set. Issuing it does not change product stock; its quantity is **held** against the category (free = Σ category stock − held) and issue checks use the free amount.
- On the return the Any line must be accounted for exactly, by product; `submit_return` writes one **child** `checkout_items` row per product (`parent_item_id`), which then behaves like a normal product line (mismatch = lost, classified by the admin). `approve_return` takes stock off each product once (`checkout` −taken, `checkin` +returned).
- Field bills: `sales.checkout_session_id` links a bill to the staff member's open session; such bills move no stock; `submit_return` books them as `sold` usage (own product lines first, then the Any line of the category).
**Alternatives Considered**:
- Deduct at issue by a rule (FIFO / largest stock first) and correct on return: arbitrary numbers on the Products page and extra correction noise. Rejected.
- Allow "unknown" shortages booked to the category and resolved at the next stock count (with a shelf-count helper): designed, then rejected by the owner — staff can always say which piece it was.
- Separate breakdown table instead of child `checkout_items` rows: every report and the ledger would need a second code path; child rows let existing per-product logic work once Any lines are skipped (`reportableItems`).
- Field bills deducting stock and the return ignoring them: keeps ISSUE-023's double deduction.
**Consequences**: While an Any line is out, per-product `current_stock` still includes pieces that are physically with staff (only the category total is protected). Every reader of `checkout_items` must skip Any lines that have children. `record_sale` gained an 11th parameter (old overload dropped). Field bills write no inventory transaction; their movement shows when the return is approved. Production needs migration 018 before the new screens are deployed.
**Superseded By**:

## Decision: Any Returns: Only Pieces That Did Not Come Back Are Named
**Date**: 2026-11-19
**Status**: Accepted
**Context**: First version of the Any return asked staff to name the type of every piece, including the ones that came back. Testing it on production, the owner found it confusing ("where do I choose which 2 were those?") and pointed out that returned pieces never need a type.
**Decision**: "How many came back?" is one number on the Any line (`submit_return` line-level `returned_quantity`, migration 019); staff name only the pieces that did not come back, one row per product and outcome (used for… / lost). Any lines move no stock at issue, so returned pieces move no stock either and their type doesn't affect inventory; every piece that does leave stock is still tied to a product. Reports keep the unnamed returned pieces as one "Any <Category>" row (`reportableItems`).
**Alternatives Considered**:
- Keep naming every piece: correct but slower and confusing for staff; rejected by the owner.
- Per-product rows with Returned / Lost / usage inside one row (first UI): mixed "came back" with "what happened" and let a single row read "8 returned, 2 lost" without saying which pieces were lost; replaced by the two-step form.
**Consequences**: The Any line's `checkin_quantity` includes unnamed returned pieces; anything that reads child rows must use `unnamedReturned()` / `reportableItems()` to show them. Production must run 019 before the new form is deployed.
**Superseded By**:
