# Future Scope

Items intentionally deferred. Each entry includes the rationale for deferral and a *trigger condition* — the signal that says "now's the time."

This file is the dumping ground for "we know about it, we're not doing it yet." If you find yourself thinking *"didn't we discuss X?"* — search here first.

---

## 📋 Operations / Process

### Setup / Deployment Runbook
- **What**: Single-page `SETUP.md` covering env vars, Supabase setup steps, migration order (`supabase-schema.sql` then 002 → 003 → 004 → 005 → 006), demo-mode toggle, build/deploy commands, Vercel project settings, where Sentry DSN goes.
- **Why deferred**: Knowledge-base captures most of this; works for the current 1-developer setup.
- **Trigger**: First time a second developer (or successor) needs to run this themselves. Or when handing the project to the client's IT team.
- **Effort**: ~30 minutes.

### Backup Strategy Documentation
- **What**: Document the actual Supabase tier in use, automatic backup window (free = 7 days PITR), how to manually export schema + data, image bucket backup procedure for `product-images` storage bucket, restore drill notes.
- **Why deferred**: Single warehouse, low-volume; data loss has been zero so far.
- **Trigger**: First "we deleted X by mistake, can we recover?" incident — or before any major migration.
- **Effort**: ~1 hour for write-up; budget for backup-restore drill separately.

### CI Pipeline
- **What**: GitHub Actions workflow on push/PR — runs `npm run build` and `npm test`, blocks merge if either fails. Optional: lint step (once eslint config exists).
- **Why deferred**: Solo developer pushing to main; build verification happens locally + via Vercel deploy.
- **Trigger**: Second contributor, or first regression that the test suite would have caught.
- **Effort**: ~30 minutes for a basic workflow.

### Linter / Formatter Config
- **What**: ESLint + Prettier with shared config; pre-commit hook (husky + lint-staged) optional.
- **Why deferred**: Code style is consistent by convention rather than enforcement, and consistent enough to read.
- **Trigger**: Style drift starts to bother someone, or a second contributor with different defaults joins.
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
- **What**: Walk through seller's day on a real mid-range Android (Surat, ~360 px width). Fix touch-target sizes, party combobox dropdown positioning on small screens, modal sizing, table horizontal scroll behavior.
- **Why deferred**: Untested but possibly working fine; hard to prioritize without observed user pain.
- **Trigger**: Any seller complaint mentioning "I can't tap" / "screen too small" / "form moved while typing." Or before adding more sellers.
- **Effort**: ~half a day to test + minor fixes; longer if it needs design rework.

### Offline Support
- **What**: Local action queue; record sales / mark refills offline, sync when online. Conflict resolution (last-write-wins or timestamp-based merge). Service Worker for asset caching.
- **Why deferred**: Real engineering effort. Demo mode is localStorage-based but it's a separate mode (not offline-first).
- **Trigger**: Confirmed connectivity-loss complaints from sellers, especially on customer visits in poor-coverage areas.
- **Effort**: 3–5 days for a non-trivial implementation. Recommended: research existing libraries (Replicache, RxDB, or Supabase's offline plans) before building from scratch.

### Aggregation RPCs
- **What**: Move specific aggregations to Postgres functions that return scalars/small result sets — `revenue_by_product(start, end)`, `total_revenue(start, end)`, `fast_movers(start, end, limit)`, `slow_movers(start, end, limit)`.
- **Why deferred**: Current `db.fetchAllPaged()` chunked-fetch approach is correct, just less efficient. At single-warehouse volume the cost is invisible.
- **Trigger**: `sales` or `inventory_transactions` crosses ~10k rows, or reports page becomes noticeably slow (>2s).
- **Effort**: ~half a day per aggregation, including client refactor and test.

---

## 🔒 Security / Compliance

### Rate Limiting on `/api/create-user`
- **What**: Vercel middleware-based rate limit (e.g., 5 requests / minute / IP) on the user-creation endpoint. Belt-and-suspenders alongside the existing admin JWT check.
- **Why deferred**: Endpoint already requires admin auth; the realistic abuse vector is a stolen admin token, which rate-limiting only partially mitigates.
- **Trigger**: Any unexpected user-creation traffic in logs, or before opening the project to wider operator access.
- **Effort**: ~1 hour.

### Server-Side Image Upload Validation
- **What**: Configure Supabase Storage bucket policies for `product-images` to enforce max file size + allowed MIME types at the bucket level (currently only client-side checks; bypass-able).
- **Why deferred**: Low practical risk (bucket is public-read but write requires auth); attacker would need a valid session to upload garbage.
- **Trigger**: Any storage abuse, or before public sign-up if that ever opens up.
- **Effort**: ~30 minutes (configure via Supabase Dashboard or SQL).

### Content Security Policy (CSP)
- **What**: Set CSP header in `vercel.json` (or via meta tag) restricting script-src, style-src, connect-src to known origins.
- **Why deferred**: Several `onclick="window.navigateTo(...)"` patterns require `unsafe-inline` for scripts, which defeats most of CSP's value. Refactor to event delegation first.
- **Trigger**: Any XSS scare, or before pursuing security certifications.
- **Effort**: ~half a day (event delegation refactor) + ~1 hour (CSP rules tuning).

### Session Expiry Handling
- **What**: Detect 401 responses on `db.*` calls (JWT expired); attempt refresh-token; on failure, redirect to login with a "Session expired" toast. Currently silent.
- **Why deferred**: Default Supabase session is 1 hour with auto-refresh; users rarely hit expiry in normal use.
- **Trigger**: First "the app stopped responding to my clicks" complaint, especially for users who leave the tab open all day.
- **Effort**: ~1 hour.

---

## 🧱 Technical Debt

### `products.current_stock` precision: `DECIMAL(12,2)` → `DECIMAL(12,3)`
- **What**: Liquid stock is in kg with 3-decimal display (`formatWeight` does `.toFixed(3)`). DB is `DECIMAL(12,2)` so 4.567 kg → 4.57 kg = 7g lost per row. Same applies to `min_stock_threshold`, `max_daily_consumption`, and a few other DECIMAL columns.
- **Why deferred**: Drift is sub-gram per operation; not yet observable.
- **Trigger**: Inventory reconciliation discrepancy that traces to rounding, or before adding higher-precision products.
- **Effort**: ~1 hour migration + audit of related columns.

### Dashboard Query Batching
- **What**: Dashboard does ~9 sequential `db.getAll(...)` round trips per render, including duplicate fetches of `parties`. Batch with `Promise.all` and dedupe.
- **Why deferred**: Under 1s on current data sizes; not a UX problem yet.
- **Trigger**: Dashboard render time exceeds 2s, or anyone reports slowness.
- **Effort**: ~1 hour.

### Client-Side Caching
- **What**: Cache `products`, `parties`, `categories`, `profiles` in memory (TanStack Query, SWR, or hand-rolled module-level cache). Invalidate on mutation. Reduces re-fetches on navigation.
- **Why deferred**: Page transitions are <500ms currently; over-engineering for a small SPA.
- **Trigger**: Navigation feels sluggish, or backend egress costs become non-trivial.
- **Effort**: ~half a day for hand-rolled; ~1 day for TanStack Query integration.

### TypeScript Migration
- **What**: Convert codebase from JS to TS. Type the DB row shapes from a single source (e.g., `supabase gen types typescript`). Catch column-name typos at compile time.
- **Why deferred**: Big refactor cost, low payoff at current code volume; vanilla JS is readable and works.
- **Trigger**: Codebase grows past ~5k LOC, or a typo-driven bug bites and test coverage isn't enough.
- **Effort**: 2–3 days for full migration with type generation; can be incremental.

### `generateId()` deprecated `substr`
- **What**: `helpers.js:generateId()` uses `String.prototype.substr` which is deprecated. Switch to `slice` or `crypto.randomUUID()`.
- **Why deferred**: Functional in all browsers; not visible to users.
- **Trigger**: Adding ESLint, since it would flag this.
- **Effort**: 30 seconds.

### Demo Mode `localStorage` Quota
- **What**: Demo mode stores everything in `localStorage`, capped at ~5MB. Eventually `inventory_transactions` grows large enough to fail saves silently (catch-all `catch {}` swallows the QuotaExceededError).
- **Why deferred**: Demo mode is for development/testing only.
- **Trigger**: A developer hits "save failed" silently in dev. (Or migrate demo mode to IndexedDB.)
- **Effort**: ~half a day for IndexedDB migration; or ~10 minutes to surface a quota-exceeded warning.

---

## 🎨 UX / Accessibility

### Keyboard Shortcuts
- **What**: `Cmd/Ctrl+K` for global search, `n` for new sale, `Esc` for close (already done in modals — extend to drawers/dropdowns), `?` for shortcut help.
- **Why deferred**: Power-user convenience; not blocking.
- **Trigger**: Repeated power-user request, or onboarding more admins.
- **Effort**: ~half a day for a basic shortcut system.

### Keyboard Navigation Beyond Modals
- **What**: Tab-order audit of main page (sidebar, page headers, table rows). Roving-tabindex for tables. Skip-to-content link.
- **Why deferred**: Modal focus-trap was the highest-impact a11y fix; rest is incremental.
- **Trigger**: Accessibility audit, or any keyboard-only user feedback.
- **Effort**: ~half a day per page.

### Loading / Skeleton States
- **What**: Replace the spinner-only loading state with content-shaped skeletons during data fetch. Reduces layout shift.
- **Why deferred**: Spinner works; data loads quickly enough that skeleton-vs-spinner is academic.
- **Trigger**: Visible page jumps on slow connections.
- **Effort**: ~1 hour per page.

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

*Last updated: 2026-05-14*

When you complete an item, move it from this file into `changelog.md` with a normal dated entry.
