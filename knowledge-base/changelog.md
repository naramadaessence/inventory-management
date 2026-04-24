# Changelog

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
