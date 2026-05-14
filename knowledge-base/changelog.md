# Changelog

## 2026-05-14 — Review Round 2 Polish: CONFIG, currency rounding, withSaving, focus-trap
**What**: Closed the four near-term follow-ups left in `active-context.md` after the main review batch.
**Why**: Consistency, double-click protection, accessibility, and removing magic numbers from business logic.
**Impact**: No DB changes. No behavioral changes for existing data. Save buttons now disabled while a request is in flight (no more duplicate sales from double-clicks). Modal keyboard navigation now works.
**Files Changed**: `js/utils/helpers.js`, `js/supabase.js`, `js/pages/{dashboard,collections,daily-operations,sales,settings,damage-loss,installations,parties,rentals,products}.js`

### CONFIG object
- `helpers.js` exports `CONFIG` with 5 named thresholds:
  - `EXPIRY_WARN_DAYS` (60), `UPCOMING_REFILL_DAYS` (7),
  - `PAYMENT_DUE_SOON_DAYS` (7), `PAYMENT_URGENT_DAYS` (3),
  - `DEFAULT_DAILY_CONSUMPTION` (30)
- 7 magic-number sites replaced in dashboard, collections, daily-operations

### Currency rounding (`roundCurrency`)
- New helper: `Math.round(n * 100) / 100` — matches DB `DECIMAL(12,2)`
- Applied at DB-write boundaries: sale-save (grandTotal + amtRcvd), edit-sale-save (totalAmount + amountReceived), visit-save (newReceived), fu-save (newReceived)
- `demoRpc.record_sale` rounds the computed total inline so demo + production stay byte-equal

### Save-button consistency (`withSaving`)
- New helper: disables button + shows spinner for the duration of an async save, then restores. `btn.isConnected` check in `finally` handles the modal-close case cleanly.
- Applied to **all 13 save handlers** across 8 page files (sales ×2, collections ×2, settings ×4, damage-loss, installations, parties, rentals, products)
- Removes the double-click → duplicate sale class of bugs entirely
- Stripped manual `saveBtn.disabled = true` / `saveBtn.innerHTML = ...` reassignment from 4 places that were managing this themselves

### Modal accessibility (focus-trap in `createModal`)
- Captures previously-focused element on open; restores it on close
- Autofocuses first text input after a one-tick layout delay
- Traps Tab / Shift+Tab inside the modal
- Closes on Escape (document-level listener cleaned up on close)
- Adds `role="dialog"`, `aria-modal="true"`, `tabindex="-1"` to the modal element

---

## 2026-05-14 — Code Review Round 2: Atomicity, Pagination, Security
**What**: Actioned a thorough code review pass. Closed five critical issues spanning security, correctness under concurrency, and silent data truncation.
**Why**: Pre-scaling hardening — before adding more concurrent users or growing past the Supabase 1000-row REST default.
**Impact**: Required running `migrations/005_refill_completions_rls.sql` and `migrations/006_atomic_operations.sql` in Supabase (both applied). Stock writes are now race-safe; multi-step sale/approval/return operations commit as a single transaction.
**Files Changed**: `api/create-user.js`, `js/main.js`, `js/supabase.js`, `js/utils/helpers.js`, `js/pages/{dashboard,sales,collections,inventory-log,reports,daily-operations}.js`, `supabase-schema.sql`, `migrations/005_refill_completions_rls.sql` (NEW), `migrations/006_atomic_operations.sql` (NEW)

### Security
- **CORS pinned** on `/api/create-user` (was `*`) — allowlist for Vercel prod URL + localhost variants
- **Hard-fail in production builds** if `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing — prevents silent fallback to demo mode with the public README credentials
- **Toast/modal XSS hardened**: `showToast` and `createModal` now use `textContent` for user-derived strings; `content`/`footer` remain HTML by design (caller responsibility — must `esc()` user data inside)
- **`refill_completions` RLS scoped** (migration 005): `WITH CHECK (true)` replaced with `completed_by = auth.uid()::text`; delete restricted to admin or row owner

### Atomicity (migration 006)
- Five Postgres functions added: `adjust_stock`, `record_sale`, `approve_issue`, `approve_return`, `delete_sale`
- Each runs in a single transaction — partial-write recovery is no longer needed
- `adjust_stock` enforces non-negative result atomically: TOCTOU races on `current_stock` are eliminated
- Client now calls `db.rpc(name, params)` which dispatches to `supabase.rpc()` in production or to local `demoRpc` handlers in demo mode (same call sites work in both)
- Refactored sites: `sales.js` record-sale (was 2N+1 round trips → 1), `sales.js` delete-sale, `daily-operations.js` approve-issue, `daily-operations.js` approve-return

### Reliability / Pagination
- Added `db.fetchAllPaged(table, options)` — chunked 1000-row fetch for aggregations that span a full table
- Applied to high-volume reads in `dashboard`, `sales`, `collections`, `inventory-log`, `reports`, `daily-operations`
- Dashboard recent-activity uses `limit:20` for display (no aggregation involved)
- `db.getAll` extended with `options.eq` for server-side equality filtering
- **Inventory Log** rewritten with server-side pagination: 50 rows/page, Prev/Next buttons, type filter via `.eq()`. Works correctly at 100k+ entries.

### Schema
- `supabase-schema.sql` synced with cumulative state: `image_url` on products, `sales` without dropped legacy `product_id`/`quantity`/`unit_price` columns, `sale_items` + `refill_completions` tables added with indexes, `installations` added to RLS ENABLE block + policy
- New deployments now succeed by running `supabase-schema.sql` followed by migrations 002→003→004→005→006 in order

---

## 2026-05-13 — Refill Completion Tracking (refill_completions table)
**What**: Refill reminders now persist until manually marked "Done". Overdue refills show in a red card above today's list.
**Why**: Client reported missed refills when sellers are outstation — reminders vanished when the date passed with no way to track.
**Impact**: Requires running `migrations/004_refill_completions.sql` in Supabase. Dashboard now shows 3 buckets: Overdue (red), Today (green), Upcoming (blue).
**Files Changed**: `dashboard.js` (both admin + seller views), `supabase.js` (demo store), `migrations/004_refill_completions.sql` (NEW)

- **refill_completions table**: `party_id + month + year` unique — one completion per party per month
- **Overdue bucket**: Parties where `amc_day < today` and no completion this month — shows "X days overdue" in red
- **Done button**: Both admin and seller get ✅ Done button on each refill. Inserts completion record and refreshes dashboard
- **Auto-clear on month rollover**: New month = no completions yet = all reminders reappear naturally
- **Seller view**: Call + Done buttons side by side on each refill item

## 2026-05-12 — Multi-Item Sales System (sale_items table)
**What**: Migrated from single-product-per-sale to multi-item bill/invoice architecture with new `sale_items` table.
**Why**: Client needs sellers to record full orders (multiple products per bill) on the spot, with same-product quantity merging.
**Impact**: Requires running `migrations/003_multi_item_sales.sql` in Supabase before deploying. `sales` table loses `product_id`, `quantity`, `unit_price` columns — data migrated to `sale_items`. Sellers now have Sales page access (add-only).
**Files Changed**: `sales.js` (major rewrite), `collections.js` (5 refs updated), `reports.js` (3 refs updated), `main.js` (+1 nav item), `supabase.js` (demo store), `migrations/003_multi_item_sales.sql` (NEW)

- **sale_items table**: `id, sale_id (FK→sales), product_id (FK→products), quantity, unit_price, line_total, created_at`
- **Sales modal**: Multi-item add flow with party info card (contact, machine, custom rates), running item list, grand total
- **Same product merging**: Adding same product at same price increments quantity (×2, ×3...) instead of duplicate rows
- **Party info card**: Shows phone, address, machine type, custom category rates when party selected
- **Seller access**: Sellers see Sales in nav, can add sales, see only their own sales, no edit/delete
- **Collections**: Updated 5 `product_id` references to use `sale_items` lookup with `saleProductName()` helper
- **Reports**: Revenue-by-product and fast/slow movers now iterate `sale_items` instead of `sales.product_id`
- **Stock deduction**: Consolidated per-product across all line items before deducting, with inventory_transactions per product
- **Edit modal**: Shows read-only items list, allows payment/date/total edits. Delete restores stock for all items

## 2026-05-10 — Seller Experience: Dashboard, Parties, Refills
**What**: Redesigned seller account with dedicated Dashboard (upcoming refills), Parties access (add-only), and kept Collections.
**Why**: Sellers need to see their daily refill schedule and add new parties on the field without admin involvement.
**Impact**: Seller sidebar now shows 4 items instead of 3. No DB changes required.
**Files Changed**: `main.js`, `dashboard.js`, `parties.js`

- **Dashboard**: Sellers see today's refills + next 7 days schedule with Call buttons (no checkout history)
- **Parties**: Sellers can view full party list + add new parties (simplified form: name, phone, address, notes)
- **Parties (admin)**: Edit button hidden for sellers. Admin-only fields (AMC, pricing, machine config) only shown to admins
- **Nav**: Seller sidebar: Dashboard → Daily Operations → Collections → Parties

## 2026-05-09 — Migrate Liquid Stock from Grams to KG (Direct Storage)
**What**: Switched all liquid product data from internal grams storage to direct KG storage. Removed all UI conversion logic.
**Why**: Conversion-at-boundary approach was error-prone (25+ conversion calls across 6 files). Direct KG storage is simpler — what you see = what's stored.
**Impact**: Requires running `migrations/002_grams_to_kg.sql` ONCE in Supabase before deploying. After migration, all liquid values in DB are in KG and ₹/kg.
**Files Changed**: `helpers.js`, `products.js`, `sales.js`, `daily-operations.js`, `parties.js`, `settings.js`, `migrations/002_grams_to_kg.sql` (NEW)

- Removed `kgToGrams()` and `gramsToKg()` helper functions entirely
- `formatWeight(kg)` now takes KG directly (no division)
- `formatPricePerUnit(price)` now takes ₹/kg directly (no multiplication)
- All form inputs/outputs pass values through without conversion
- Migration SQL handles: products, sales, checkout_items, stock_intakes, inventory_transactions, party custom_category_rates

## 2026-05-07 — Installations Page + Per-Category Machine Quantities
**What**: Added dedicated Installations page for tracking machines deployed at party locations. Also added per-category Qty inputs on party form.
**Why**: Client needs to track which machines are installed where, when they were installed, and how many — without price info.
**Files Changed**: `installations.js` (NEW), `main.js`, `parties.js`, `supabase-schema.sql`

### Features Added
- **Installations page**: New sidebar item under Operations. Shows: Party, Machine, Model Number, Qty, Installation Date, Status (Active/Removed/Replaced)
- **Add/Edit/Remove** installations with full CRUD
- **Stats cards**: Active Locations count + Total Machines Deployed
- **Per-category Qty on parties**: Every category row now has a Qty input (not just machines)

### DB Migration (run in Supabase SQL Editor)
```sql
CREATE TABLE installations (
  id SERIAL PRIMARY KEY,
  party_id INTEGER REFERENCES parties(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  installation_date DATE NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'removed', 'replaced')),
  removed_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE installations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON installations FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE parties ADD COLUMN IF NOT EXISTS machine_counts JSONB;
ALTER TABLE parties DROP COLUMN IF EXISTS machine_count;
```

## 2026-04-28 — Machine Type, Sale Editing, Stock Validation & UI Fixes
**What**: Added machine type tracking (purchased/free-to-use) on parties, editable sale records, stock validation on issue approval, searchable party combobox, category management UI, and multiple bug fixes.
**Why**: Client requested machine deployment tracking, admin needed to edit sales, and stock approval had no checks allowing 0-stock approvals.
**Files Changed**: `parties.js`, `sales.js`, `daily-operations.js`, `products.js`, `rentals.js`, `supabase-schema.sql`

### Features Added
- **Machine Type on Parties**: Three options — No Machine, Purchased (green badge), Free to Use (blue badge = monthly visits required)
- **Editable Sale Records**: Click any sale row to edit qty, price, payment status, notes. Stock auto-adjusts on qty change. Delete restores stock.
- **Category Management UI**: "Categories" button on Products page opens modal to add/rename/delete categories
- **Searchable Party Combobox**: Sale modal party field is now typeable with autocomplete dropdown (supports walk-in customers)
- **Dynamic Stock Labels**: Product form shows "grams" or "pieces" based on selected category type

### Bug Fixes
- **Stock validation on issue approval**: Approve button is disabled + greyed out when insufficient stock. Shows shortfall per item. Re-checks at click time to prevent race conditions.
- **Admin direct issue blocked** when stock is 0 or insufficient
- **Seller request warns** if requesting more than available (can still submit for admin review)
- **Rental dropdown empty**: Was using hardcoded category_id 1/2 — now filters by category name pattern
- **Party dropdown z-index**: Dropdown was rendering behind form fields — fixed with z-index + solid white background

### DB Migration (run in Supabase SQL Editor)
```sql
ALTER TABLE parties ADD COLUMN IF NOT EXISTS machine_type TEXT DEFAULT 'none' CHECK (machine_type IN ('none', 'purchased', 'free_to_use'));
```

### Design Decision: Liquid Units
- All liquid products measured in **grams** everywhere (stock, checkout, sales, price)
- Price is ₹/gram (e.g., ₹0.80/g instead of ₹800/litre)
- Reason: sellers weigh on scales daily — grams is the natural unit, avoids gram↔litre conversion errors

## 2026-04-24 — Issue → Return → Admin Approval System
**What**: Complete rewrite of Daily Operations into a 4-step approval workflow
**Why**: Stock should only be deducted/restored with admin confirmation. Sellers need to track their own field stock.
**Files Changed**: `daily-operations.js`, `dashboard.js`, `main.js`, `supabase-schema.sql`

### Flow
1. **Seller requests stock** → status = `pending_issue` → stock NOT deducted
2. **Admin approves issue** → stock deducted → status = `checked_out`
3. **Seller submits return** (with weights) → status = `pending_approval` → stock NOT restored
4. **Admin approves return** → stock restored → status = `checked_in`

### Key Changes
- Sellers can now access Daily Operations page (see own sessions, request stock, submit returns)
- Admin-created issues are auto-approved (immediate stock deduction)
- New `pending_issue` and `pending_approval` statuses in `checkout_sessions`
- New `approved_by` UUID and `approved_at` TIMESTAMPTZ audit columns
- Dashboard shows "Pending Approvals" card with counts + Review buttons
- Flagging available at both issue and return stages

### DB Migration (run in Supabase SQL Editor)
```sql
ALTER TABLE checkout_sessions DROP CONSTRAINT IF EXISTS checkout_sessions_status_check;
ALTER TABLE checkout_sessions ADD CONSTRAINT checkout_sessions_status_check 
  CHECK (status IN ('pending_issue', 'checked_out', 'pending_approval', 'checked_in', 'flagged'));
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id);
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
```

---

## 2026-04-24 — Code Review Fixes: Error Handling + Schema Sync + DRY Cleanup
**What**: Added error handling to ALL DB write operations, centralized `esc()` into helpers.js, synced SQL schema with live database
**Why**: Code review found silent failures on DB errors, duplicate code in 10 files, and schema file was missing 8+ columns & 1 table
**Files Changed**: ALL 12 page files, `helpers.js`, `supabase-schema.sql`

### Error Handling
- Created `dbOp()` wrapper in helpers.js — catches errors, shows toast notification, logs to console
- Wrapped every `db.insert()`, `db.update()`, `db.delete()` call across all pages
- Save buttons re-enable on failure so users can retry

### DRY Cleanup
- Removed 10 duplicate `esc()` / `escapeHtml()` function definitions
- Now exported from `helpers.js` as `esc` and `escapeHtml` (alias)

### Schema Sync (supabase-schema.sql)
- Added `parties.amc_active`, `parties.amc_day`, `parties.amc_rate`, `parties.custom_category_rates`
- Added `sales.payment_method`, `sales.amount_received`, `sales.expected_payment_date`
- Added `payment_followups` table (12 columns)
- Added seller read access RLS for `parties`, `sales`, `payment_followups`
- Added seller insert policy for `payment_followups`

---

## 2026-04-24 — Category-Based Pricing (Replaces Per-Product Pricing)
**What**: Pricing is now set per-category, not per-product. Set "Diffuser Oil = ₹1500" and ALL oil fragrances auto-use ₹1500.
**Why**: Clients change fragrances monthly but the rate stays the same for the category
**Files Changed**: `parties.js`, `sales.js`

### How It Works
- Party modal: checkboxes for each category with rate input
- Sales modal: looks up product's `category_id` against party's `custom_category_rates` JSONB
- `custom_category_rates` format: `{"4": 1500, "3": 350}` (category_id → price)

---

## 2026-04-24 — Per-Party Custom Product Pricing
**What**: Each party can have custom AMC rate + custom product prices. Admin picks which products a party uses and sets individual rates.
**Why**: Different clients get different rates — not all parties use all products
**Files Changed**: `js/pages/parties.js`, `js/pages/sales.js`, `js/pages/collections.js`

### Features
- Party modal: AMC rate field + dynamic "Add Product" picker with per-product price input
- Only selected products get custom rates (others = not applicable)
- Sales page: auto-fills custom price when party+product selected (gold highlight = custom rate)
- Collections: auto-fills AMC rate when seller selects party in Log Visit
- Admin role: monitor-only in Collections (no Log Visit button)

### Database Changes
```sql
ALTER TABLE parties ADD COLUMN IF NOT EXISTS amc_rate NUMERIC DEFAULT 0;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS custom_product_rates JSONB;
```

---

## 2026-04-24 — RLS Policy Fix for Seller Access
**What**: Fixed Row-Level Security policies so sellers can read parties, sales, and write payment_followups
**Why**: Sellers couldn't see party dropdown or log visits because RLS was admin-only
**Files Changed**: Supabase SQL policies (no code changes)

### RLS Changes
- `parties`: Sellers can now READ (needed for Collections dropdowns), admin-only for write
- `sales`: All authenticated users can READ/INSERT/UPDATE (sellers log sales and update payments)
- `payment_followups`: All authenticated users can READ/INSERT
- `inventory_transactions`: All authenticated users can READ/INSERT

---

## 2026-04-24 — AMC Monthly Refill Scheduling
**What**: Added AMC mode to parties with monthly recurring refill reminders on dashboard
**Why**: Parties have fixed refill dates (e.g. A on 12th, B on 15th) — need automatic monthly reminders
**Files Changed**: `js/pages/parties.js`, `js/pages/dashboard.js`, `js/main.js`

### Features
- Party modal: AMC toggle + refill day selector (1st–28th)
- Parties table: Shows AMC day, highlights today's visits in green ("📍 TODAY")
- Dashboard: "Today's AMC Refill Worklist" card at top with party details
- Dashboard: "Upcoming Refills (7 Days)" card showing next week's schedule
- Seller nav: Added Collections to sidebar

### Database Changes
```sql
ALTER TABLE parties ADD COLUMN IF NOT EXISTS amc_active BOOLEAN DEFAULT false;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS amc_day INTEGER;
```

---

## 2026-04-24 — Payment Collections & Follow-up System
**What**: Full payment tracking module with visit-based follow-ups and dashboard reminders
**Why**: Sellers visit customers and need to log payment status (pending/received/promised) with due dates
**Files Changed**: `js/pages/collections.js` (NEW), `js/pages/sales.js`, `js/pages/dashboard.js`, `js/main.js`

### New: Collections Page (`collections.js`)
- 4 stat cards: Total Pending, Due Soon (3 days), Overdue, Collected Today
- 3 tabs: Pending Payments, Overdue, Follow-up History
- **Update Payment modal**: status (pending/partial/paid/promised), payment method (cash/UPI/bank/cheque), amount collected, expected date, visit notes
- Auto-calculates balance, prevents over-collection

### Updated: Sales Page
- Added fields: payment method, amount received, expected payment date
- Pending/partial fields auto-show/hide based on payment status selection
- New "Pending Amount" stat card
- Due date + overdue indicator in sales table

### Updated: Dashboard
- New "Payment Reminders" card between expiry alerts and recent activity
- Shows overdue (red), due soon (amber), and no-date-set payments
- "Collect" button links to Collections page

### Database Changes (run in Supabase SQL Editor)
```sql
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_received NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS expected_payment_date DATE;
CREATE TABLE payment_followups (...);
```

---

## 2026-04-24 — Product Image Upload
**What**: Added image upload to product create/edit via Supabase Storage
**Why**: Admin wants to see product photos in the catalog
**Files Changed**: `js/pages/products.js`

### Features
- Drag-and-drop or click-to-upload (max 5MB)
- Live preview before saving
- Stored in `product-images` Supabase bucket (public)
- Grid view shows product image instead of generic icon
- Table view shows 36x36 thumbnail
- Graceful fallback to flask/box icon if no image or load error

### Database Changes
```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true);
-- + RLS policies for public read, authenticated write
```

---


**What**: Deployed to Vercel + connected live Supabase database
**Why**: Move from demo localStorage to real persistent database
**Files Changed**: `api/create-user.js`, `js/pages/login.js`, `js/pages/settings.js`, `js/supabase.js`, `supabase-schema.sql`

### Deployment Details
- **Vercel URL**: `https://inventory-management-pi-opal.vercel.app/`
- **Supabase Project ID**: `jnfykpicpttvnihgsckt`
- **Region**: Mumbai (ap-south-1)
- **Admin login**: `admin@narmadaessence.com` / `12345678`

### Supabase Setup Notes
- Creating users via raw SQL INSERT into `auth.users` does NOT work — missing `auth.identities` record causes 500 errors
- Always create users through **Supabase Dashboard → Authentication → Add User** or via the **admin API** (`auth.admin.createUser`)
- The `handle_new_user` trigger auto-creates a `profiles` row with default role `seller` — must manually UPDATE to `admin` if needed
- Trigger uses `ON CONFLICT DO NOTHING` and `SET search_path = public` to avoid schema errors

### Features Added
- **Serverless API** (`api/create-user.js`): Secure endpoint using `SUPABASE_SERVICE_ROLE_KEY` for admin-only seller account creation
- **Login page**: Removed demo credentials, replaced with "Contact your administrator" message
- **Settings → Users**: "Add Seller" button now calls the serverless API in production mode, falls back to localStorage in demo mode
- **Exported `supabase` client** from `supabase.js` so other modules can access auth session tokens

### Environment Variables (Vercel)
| Key | Purpose |
|-----|---------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon key (client-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret admin key (server-side only, for `api/create-user.js`) |

### Seeded Data
- 5 unit products (Decor, Black Touch, Lavender, Green Apple refills + White Automatic Dispenser)
- 3 liquid products (Cool Water, Royal Oud, Cherry Blossom diffuser oils)
- 5 categories (Automatic Dispenser, Smart Diffuser, Dispenser Refill, Diffuser Oil, Room Cream)

---

## 2026-04-24 — Initial Platform Build
**What**: Complete inventory management platform built from scratch
**Why**: Client (Narmada Essence, Surat) needed warehouse management for daily seller operations
**Files Changed**: All files created from scratch

### Features Implemented
- **Login** — Email/password auth with demo mode (localStorage)
- **Dashboard** — Stat cards, low stock alerts (configurable threshold per product), expiry tracking, recent activity feed
- **Products** — Full CRUD with grid/table view, search, category filter, soft delete
- **Daily Operations** — Seller checkout/checkin workflow with consumption flagging (>threshold alerts)
- **Sales** — Record sales with automatic stock deduction, payment status tracking (paid/partial/pending)
- **Parties** — Customer directory with total revenue per party
- **Rentals** — Machine rental tracking with overdue detection, return processing
- **Damage & Loss** — Report damaged/lost/expired inventory with stock deduction
- **Inventory Log** — Full audit trail of all stock movements, filterable by type
- **Reports** — Custom date range, 4 tabs: Sales Report (bar chart), Stock Valuation (doughnut), Seller Performance, Fast/Slow Movers
- **Settings** — User management (CRUD + activate/deactivate), category management, stock intake

### Architecture Decisions
- SPA router (vanilla JS) — no framework overhead for a simple app
- Demo mode with localStorage — allows full testing without Supabase setup
- Every stock mutation creates an `inventory_transactions` record for audit trail
- XSS prevention via `escapeHtml()` / `esc()` on all user-rendered data
- Role-based access: admin sees all pages, seller sees only their checkouts

### Theme Change
- Started with dark theme, switched to light mode per client preference
- Clean white backgrounds, amber/gold brand accents, subtle shadows
- Mobile responsive with sidebar toggle at 768px breakpoint

## 2026-04-24 — Cleanup
**What**: Removed old transcription scripts (transcribe.py, translate.py, transcript files)
**Why**: No longer needed — were used for initial client meeting transcription
**Files Changed**: Deleted transcribe.py, translate.py, transcript_*.txt
