# Changelog

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
