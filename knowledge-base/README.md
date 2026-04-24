# Narmada Essence — Inventory Management Platform

## Overview
Web-based inventory management system for **Narmada Essence**, a fragrance company in Surat, Gujarat. Manages a single warehouse operation tracking daily seller checkouts, sales, rentals, damage/loss, and stock levels for 48+ SKUs (dispensers, diffusers, refills, oils).

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS (SPA), Vite |
| Styling | Custom CSS design system (light theme, amber accents) |
| Backend | Supabase (PostgreSQL + Auth + RLS) |
| Charts | Chart.js |
| Hosting | Vercel (Hobby tier) |
| Repo | github.com/naramadaessence/inventory-management |

## Directory Structure
```
├── index.html                 # Entry point
├── vite.config.js            # Vite configuration
├── package.json
├── catalog_data.json          # Product seed data (48+ SKUs)
├── css/
│   └── styles.css            # Full design system
├── js/
│   ├── main.js               # SPA router + app shell
│   ├── supabase.js           # DB client + demo mode (localStorage)
│   ├── utils/
│   │   └── helpers.js        # Formatters, toasts, modals, date ranges
│   └── pages/
│       ├── login.js
│       ├── dashboard.js      # Stats, low-stock alerts, expiry alerts
│       ├── products.js       # CRUD, grid/table view, search, categories
│       ├── daily-operations.js # Checkout/checkin workflow + flagging
│       ├── sales.js          # Record sales, revenue tracking
│       ├── parties.js        # Customer directory
│       ├── rentals.js        # Machine rental tracking
│       ├── damage-loss.js    # Damage/loss reporting
│       ├── inventory-log.js  # Full audit trail
│       ├── reports.js        # Date-range reports + Chart.js charts
│       └── settings.js       # Users, categories, stock intake
├── assets/products/          # Product images (user-supplied)
└── knowledge-base/           # This folder
```

## Reading Order
| # | File | Purpose |
|---|------|---------|
| 1 | README.md | This file — project overview |
| 2 | changelog.md | Chronological history of changes |
| 3 | architecture.md | Data model, security, workflows |

## Critical Rules
- **Demo mode**: App works fully without Supabase via localStorage. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars for production.
- **XSS prevention**: All user data rendered via `escapeHtml()` / `esc()` — never raw innerHTML with user strings.
- **Stock consistency**: Every stock change (checkout, checkin, sale, rental, damage) creates a corresponding `inventory_transactions` entry for full audit trail.
- **Role-based access**: Admin sees all pages. Seller only sees their own checkout history.
- **Input validation**: All forms validate on client side. Supabase RLS enforces on server side.
- **Soft deletes**: Products are deactivated (`is_active: false`), never hard-deleted.

## Quick Facts
| Key | Value |
|-----|-------|
| Domain | narmadaessence.com |
| Client Location | Surat, Gujarat |
| Product Count | 48+ SKUs |
| Categories | Dispensers, Diffusers, Refills, Oils, Room Cream |
| Tracking Types | Unit (pieces) and Liquid (grams) |
| Demo Login | admin@narmadaessence.com / admin123 |
| Seller Login | seller1@narmadaessence.com / seller123 |
