# Future Scope

Items intentionally deferred. Each entry includes the rationale for deferral and a *trigger condition* — the signal that says "now's the time."

This file is the dumping ground for "we know about it, we're not doing it yet." If you find yourself thinking *"didn't we discuss X?"* — search here first. Items get moved to `changelog.md` once completed.

---

## 📋 Operations / Process

### Setup / Deployment Runbook
- **What**: Single-page `SETUP.md` covering env vars, Supabase setup steps, migration order (`supabase-schema.sql` then 002 → 003 → 004 → 005 → 006 → 007 → 008), demo-mode toggle, build/deploy commands, Vercel project settings, where Sentry DSN goes.
- **Why deferred**: Knowledge-base captures most of this; works for the current 1-developer setup.
- **Trigger**: First time a second developer (or successor) needs to run this themselves.
- **Effort**: ~30 minutes.

### Backup Strategy Documentation
- **What**: Document the actual Supabase tier in use, automatic backup window (free = 7 days PITR), how to manually export schema + data, image bucket backup procedure for `product-images` storage bucket, restore drill notes.
- **Why deferred**: Single warehouse, low-volume; data loss has been zero so far.
- **Trigger**: First "we deleted X by mistake, can we recover?" incident — or before any major migration.
- **Effort**: ~1 hour for write-up; budget for backup-restore drill separately.

### CI Pipeline
- **What**: GitHub Actions workflow on push/PR — runs `npm run build` and `npm test`, blocks merge if either fails.
- **Why deferred**: Solo developer pushing to main; build verification happens locally + via Vercel deploy.
- **Trigger**: Second contributor, or first regression that the test suite would have caught.
- **Effort**: ~30 minutes.

### Linter / Formatter Config
- **What**: ESLint + Prettier with shared config; pre-commit hook (husky + lint-staged) optional.
- **Why deferred**: Code style is consistent by convention.
- **Trigger**: Second contributor with different defaults joins.
- **Effort**: ~1 hour.

---

## 🛒 Functional / Domain Features

### Invoice / Receipt / Challan Generation
- **What**: PDF invoice generation per sale — GSTIN field on parties, tax breakdown (CGST + SGST or IGST), HSN/SAC codes per product, "Print Invoice" button on sales page, optional WhatsApp/email send.
- **Why deferred**: Expectation may be that the accountant re-enters into Tally; no GST compliance ask yet.
- **Trigger**: Client confirms this app is the GST source of truth, or asks for "print bill" ability for any sale.
- **Effort**: ~2 days for basic invoice (jsPDF / react-pdf). Add another day for GST tax math.

### Data Export (CSV / Excel)
- **What**: Per-page export buttons on sales, collections, inventory log, parties. Generate CSV (or `.xlsx` via `sheetjs`) of filtered/visible rows. Special: GST-format export for Tally import.
- **Why deferred**: No explicit ask yet; manual SQL export possible via Supabase Dashboard.
- **Trigger**: First "send me last month's sales as Excel" request.
- **Effort**: ~half a day for generic CSV; Tally format is a separate research task.

### Mobile UX Pass
- **What**: Walk through seller's day on a real mid-range Android (~360 px width). Fix touch-target sizes, party combobox dropdown positioning on small screens, modal sizing, table horizontal scroll behavior.
- **Why deferred**: Untested but possibly working fine; hard to prioritize without observed user pain.
- **Trigger**: Any seller complaint mentioning "I can't tap" / "screen too small" / "form moved while typing."
- **Effort**: ~half a day to test + minor fixes; longer if it needs design rework.

### Offline Support
- **What**: Local action queue; record sales / mark refills offline, sync when online. Conflict resolution. Service Worker for asset caching.
- **Why deferred**: Real engineering effort. Demo mode is localStorage-based but it's a separate mode (not offline-first).
- **Trigger**: Confirmed connectivity-loss complaints from sellers.
- **Effort**: 3–5 days. Recommended: research existing libraries (Replicache, RxDB, Supabase offline plans) before building.

### Aggregation RPCs
- **What**: Move specific aggregations to Postgres functions that return scalars/small result sets — `revenue_by_product(start, end)`, `total_revenue(start, end)`, `fast_movers(start, end, limit)`, `slow_movers(start, end, limit)`.
- **Why deferred**: Current `db.fetchAllPaged()` chunked-fetch approach is correct, just less efficient. At single-warehouse volume the cost is invisible.
- **Trigger**: `sales` or `inventory_transactions` crosses ~10k rows, or reports page becomes noticeably slow (>2s).
- **Effort**: ~half a day per aggregation, including client refactor and test.

---

## 🔒 Security / Compliance

### Content Security Policy (CSP)
- **What**: Set CSP header in `vercel.json` (or via meta tag) restricting script-src, style-src, connect-src to known origins.
- **Why deferred**: Several `onclick="window.navigateTo(...)"` patterns require `unsafe-inline` for scripts, which defeats most of CSP's value. Refactor to event delegation first.
- **Trigger**: Any XSS scare, or before pursuing security certifications.
- **Effort**: ~half a day (event delegation refactor) + ~1 hour (CSP rules tuning).

---

## 🧱 Technical Debt

### TypeScript Migration
- **What**: Convert codebase from JS to TS. Type the DB row shapes from a single source (e.g., `supabase gen types typescript`). Catch column-name typos at compile time.
- **Why deferred**: Big refactor cost, low payoff at current code volume; vanilla JS is readable and works.
- **Trigger**: Codebase grows past ~5k LOC, or a typo-driven bug bites and test coverage isn't enough.
- **Effort**: 2–3 days for full migration with type generation; can be incremental.

---

## 🎨 UX / Accessibility

### Skeleton States Beyond Dashboard
- **What**: The `skeletonHTML()` helper exists but is only applied on the dashboard. Apply to products, sales, collections, reports, daily-operations, inventory-log on initial load.
- **Why deferred**: Dashboard was the highest-impact (heaviest queries); other pages load fast enough that skeleton vs spinner is academic.
- **Trigger**: Visible page jumps on slow connections, or feedback about blank screens.
- **Effort**: ~10 minutes per page.

### Keyboard Navigation Audit Per Page
- **What**: Tab-order audit of each page (sidebar already done in app shell). Roving-tabindex for tables; ensure all interactive elements are keyboard-reachable.
- **Why deferred**: Modal focus-trap + sidebar a11y were the highest-impact fixes. Per-page audits are incremental.
- **Trigger**: Accessibility audit, or any keyboard-only user feedback.
- **Effort**: ~half a day per page.

### Internationalization (Hindi / Gujarati)
- **What**: Extract user-facing strings to a translation file; add language toggle. Currently all English.
- **Why deferred**: Single client, English-comfortable users.
- **Trigger**: Expansion to non-English-comfortable sellers, or client request.
- **Effort**: 2–3 days for full extraction + Hindi translation.

---

## 📊 Reporting / Analytics

### Audit Activity Stream
- **What**: A dedicated "what changed today" view aggregating inventory_transactions + checkout sessions + sales + payment_followups into a single timeline. Filter by user.
- **Why deferred**: Inventory Log already shows transactions; the rest is reachable via per-page lists.
- **Trigger**: First "who did X and when?" investigation that takes more than 5 minutes.
- **Effort**: ~half a day.

### Charts on More Pages
- **What**: Trend chart on collections (collected over time), parties (revenue per party), products (stock movement over time).
- **Why deferred**: Reports page covers the main asks.
- **Trigger**: Specific request from operator/client.
- **Effort**: ~1 hour per chart.

---

*Last updated: 2026-05-14 — completed items in this sweep are recorded in `changelog.md`.*

When you complete an item, move it from this file into `changelog.md` with a normal dated entry.
