# Help Centre (in-app Help page)

## What it does
A searchable **Help** page inside the app (last item in the menu, for admins and sellers) with step-by-step guides and screenshots for every action in the system, plus "common questions" articles for when something looks wrong. Added 2026-11-01: 7 topics, 161 guides, 166 screenshots. Sellers only see guides whose `roles` include `seller`; admins see all of them.

## How it is structured
| Path | Role |
|---|---|
| `js/pages/help.js` | The page: start page (topic cards + "Guides for the page you were on"), topic view, search results, article view, screenshot zoom. Lazy-loaded from `main.js` (own ~270 kB chunk) so the guide text is not in the main bundle. |
| `js/help/index.js` | Content registry (`import.meta.glob('./sections/*.js')`), `SECTION_ORDER`, role filter (`canSee`, `visibleSections`), and search (`searchArticles`). |
| `js/help/sections/<id>.js` | One file per topic: `getting-started`, `daily-ops`, `sales`, `customers`, `inventory`, `reports-settings`, `help`. Plain data, no HTML. |
| `public/help/*.webp` | Screenshots (1366×820 desktop or 390×844 phone, WebP q82, ~4.8 MB total). Served at `/help/<name>.webp`, lazy-loaded. |
| `scripts/help-screenshots/shoot.mjs` + `specs/<id>.mjs` | Screenshot harness: headless Edge drives the demo build with `?demo=week` data, one fresh login per shot. |
| `tests/help-page.test.js` | Content integrity, search quality, role filtering, rendering. |

Page ids for "Open this page" are the router ids in `main.js` (`dashboard`, `daily-ops`, `sales`, …). `navigateTo` passes `{ from: previousPage }` so Help can list guides for the page the user came from (articles whose `page` equals it). Shortcut: `g` then `h`.

## Content format
```js
export default {
  id: 'sales', title: 'Sales & Collections', icon: 'fa-indian-rupee-sign', intro: '…',
  articles: [{
    id: 'sales-record-bill',            // page-based prefix: sales-, collections-, products-, …
    title: 'Record a sale (create a bill)', // task ("Record …") or question ("Why …?")
    roles: ['admin', 'seller'],
    page: 'sales',                      // router id or null
    summary: '…', keywords: ['invoice', 'udhaar', …],   // synonyms people type
    blocks: [ { type: 'p'|'h'|'tip'|'note'|'warning', text }, { type: 'steps'|'list', items: [] },
              { type: 'img', src: 'x.webp', alt, caption }, { type: 'table', head: [], rows: [[]] } ],
    related: ['collections-record-payment'],
  }],
};
```
Inline markup inside any string: `**bold**` (exact UI labels), `` `key` `` (keys / values to type), `[[article-id]]` or `[[article-id|words]]` (links). Everything is escaped first; raw HTML is not allowed (test enforces it).

## Conventions and rules
- Writing style (the contract the six writers followed): plain short sentences for second-language English readers, imperative steps, exact on-screen labels in bold, no developer words (no "modal", "RPC", "database"), vocabulary: admin / seller / party / bill / issue / return / request / approve / collection / current stock / window.
- One task or one question per article; each topic ends with common-questions articles.
- Anchor ids other topics link to (test-enforced): `getting-started-log-in|navigate|roles`, `dashboard-overview`, `daily-ops-request-stock|approve-issue|submit-return|approve-return`, `products-add-product|request-adjustment`, `purchases-record-purchase`, `inventory-log-overview`, `damage-loss-report`, `sales-record-bill|edit-bill`, `collections-record-payment`, `parties-add-party`, `installations-add-installation`, `rentals-add-rental`, `reports-overview|staff-ledger`, `settings-add-user|stock-rules`, `help-search`.
- Screenshot names start with the article id prefix. Use demo data only (never production screenshots — real party names and money).
- **When you change a screen, update its guide and re-shoot its screenshots** in the same change. Search `js/help/sections` for the page id / button label.

## Search
`searchArticles(query, role)`: drops stop words ("how do I …", also a few Hindi ones), matches word forms by prefix ("returns" ↔ "return"), scores title 10 / keywords 6 / summary 4 / body 1 per term (exact word > word-form), requires every term to match (falls back to best partial matches), and boosts titles that start with or contain the query as a phrase. Ties go to the shorter title.

## Regenerating screenshots
```
npm run dev                                   # demo mode, port 3000
npm i --no-save puppeteer-core@24             # not a project dependency on purpose
node scripts/help-screenshots/shoot.mjs scripts/help-screenshots/specs/sales.mjs [--only name1,name2]
```
Needs Microsoft Edge (or set `HELP_BROWSER`). Each shot logs in fresh on `/?demo=week`, so shots may submit forms freely. Then look at every regenerated image. Helper API is documented at the top of `shoot.mjs`.

## Known gotchas
- The demo week is relative to today: on some dates (e.g. the 1st of a month) cards like Overdue Refills are empty; some specs edit demo data in-shot to show them.
- Saving any file under `js/help/sections/` makes Vite reload every open page; shots taken at that moment fail with "Execution context was destroyed". Re-run.
- Many app pages overflow sideways at phone width, so phone shots are few and some guides tell sellers to scroll right (see `known-issues.md` ISSUE-024).
- Help state (query / open article) is kept in module memory, so returning to Help reopens the same guide; a full reload resets it.

## How it is tested
`npm test -- tests/help-page.test.js`: every section/anchor present, unique ids, required fields, valid roles and page ids, every `[[link]]`/`related` resolves, every image file exists, no raw HTML, search finds the right guide for common questions, sellers never get admin-only guides, page render (search → open article → steps, screenshot, highlighted terms), context card, topic view, empty-search message. Not covered: whether the guide text still matches the UI — that needs re-shooting and reading when screens change.

## Related
`README.md` (directory map), `testing.md`, `decisions.md` ("In-App Help Centre"), `known-issues.md` (ISSUE-020 – ISSUE-025 found while writing the guides).
