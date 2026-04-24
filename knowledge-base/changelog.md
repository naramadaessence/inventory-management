# Changelog

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
