# Changelog

## 2026-04-24 — Production Deployment & Supabase Go-Live
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
