// Screenshot spec for the "Products & Stock" help section (js/help/sections/inventory.js).
// Run: node shoot.mjs specs/inventory.mjs [--only a,b]

const openCard = (name) => async (h) => {
  await h.clickText(name, '.product-card');
};


export const shots = [
  // ---------- Products ----------
  { name: 'products-overview-page', login: 'admin', page: 'products' },
  {
    name: 'products-overview-table', login: 'admin', page: 'products',
    // The 14-column table is wider than the page; zoom out so every column fits in one picture.
    run: async (h) => {
      await h.select('#product-view', 'table');
      await h.selectText('#product-filter-cat', 'Dispenser Refill');
      await h.eval(() => { document.body.style.zoom = '0.72'; window.scrollTo(0, 0); });
      await h.wait(300);
    },
  },
  {
    name: 'products-stock-numbers-machines', login: 'admin', page: 'products',
    run: async (h) => {
      await h.select('#product-view', 'table');
      await h.selectText('#product-filter-cat', 'Automatic Dispenser');
      await h.eval(() => { document.body.style.zoom = '0.72'; window.scrollTo(0, 0); });
      await h.wait(300);
    },
    target: '#products-container',
  },
  {
    name: 'products-find-product-search', login: 'admin', page: 'products',
    run: async (h) => { await h.type('#product-search', 'rose'); await h.wait(600); await h.highlight('#product-search'); },
  },
  {
    name: 'products-add-product-button', login: 'admin', page: 'products',
    run: async (h) => { await h.highlight('#btn-add-product'); },
  },
  {
    name: 'products-add-product-form', login: 'admin', page: 'products',
    run: async (h) => {
      await h.click('#btn-add-product');
      await h.type('#prod-name', 'Jasmine Refill');
      await h.type('#prod-fragrance', 'Jasmine');
      await h.selectText('#prod-category', 'Refill');
      await h.type('#prod-price', '450');
      await h.type('#prod-stock', '24');
      await h.type('#prod-threshold', '10');
      await h.eval(() => document.getElementById('prod-stock').dispatchEvent(new Event('input')));
    },
    target: 'modal',
  },
  {
    name: 'products-edit-product-form', login: 'admin', page: 'products',
    run: async (h) => {
      await h.clickText('Lavender Refill', '.product-card');
      await h.type('#prod-price', '475');
      await h.highlight('#prod-save-btn');
    },
  },
  {
    name: 'products-add-product-create', login: 'admin', page: 'products',
    run: async (h) => {
      await h.click('#btn-add-product');
      await h.type('#prod-name', 'Jasmine Refill');
      await h.type('#prod-fragrance', 'Jasmine');
      await h.selectText('#prod-category', 'Refill');
      await h.type('#prod-price', '450');
      await h.type('#prod-stock', '24');
      await h.eval(() => document.getElementById('prod-stock').dispatchEvent(new Event('input')));
      await h.type('#prod-expiry', '15062028');
      await h.eval(() => document.activeElement.blur());
      await h.highlight('#prod-save-btn');
    },
  },
  {
    name: 'products-request-adjustment-locked', login: 'admin', page: 'products',
    run: openCard('Royal Oud Diffuser Oil'),
    target: 'modal',
  },
  {
    name: 'products-request-adjustment-badge', login: 'admin', page: 'products',
    run: async (h) => { await h.scrollTo('.adj-pending-badge'); },
    target: '.product-card:has(.adj-pending-badge)',
  },
  {
    name: 'products-low-stock-dashboard', login: 'admin', page: 'dashboard',
    run: async (h) => { await h.scrollTo('#low-stock-list'); },
    target: '.card:has(#low-stock-list)',
  },
  {
    name: 'products-liquid-product-form', login: 'admin', page: 'products',
    run: openCard('Cool Water Diffuser Oil'),
    target: 'modal',
  },
  {
    name: 'products-request-adjustment-form', login: 'admin', page: 'products',
    run: async (h) => {
      await h.clickText('Sandal Refill', '.product-card');
      const cur = await h.eval(() => Number(document.getElementById('prod-stock').value));
      await h.type('#prod-stock', String(cur + 3));
      await h.eval(() => document.getElementById('prod-stock').dispatchEvent(new Event('input')));
      await h.type('#prod-stock-reason', 'Physical count found 3 extra pieces');
    },
    target: 'modal',
  },
  {
    name: 'products-approve-adjustment-panel', login: 'admin', page: 'products',
    target: '#pending-adjustments',
  },
  {
    name: 'products-approve-adjustment-window', login: 'admin', page: 'products',
    run: async (h) => { await h.click('.adj-approve-btn'); await h.type('#adj-review-note', 'Checked the shelf, count is correct'); },
    target: 'modal',
  },
  {
    name: 'products-approve-adjustment-reject-window', login: 'admin', page: 'products',
    run: async (h) => { await h.click('.adj-reject-btn'); await h.type('#adj-review-note', 'Recount first, the number looks too high'); },
    target: 'modal',
  },
  {
    name: 'products-adjustment-history-window', login: 'admin', page: 'products',
    run: async (h) => { await h.click('#btn-adjustment-history'); },
    target: 'modal',
  },
  {
    name: 'products-deactivate-product-button', login: 'admin', page: 'products',
    run: async (h) => { await h.clickText('Decor Refill', '.product-card'); await h.highlight('#prod-delete-btn'); },
  },
  {
    name: 'products-export-csv-button', login: 'admin', page: 'products',
    run: async (h) => { await h.highlight('#btn-export-csv'); },
  },
  {
    name: 'products-manage-categories-window', login: 'admin', page: 'products',
    run: async (h) => { await h.click('#btn-manage-cats'); },
    target: 'modal',
  },

  // ---------- Purchases ----------
  { name: 'purchases-overview-page', login: 'admin', page: 'purchases' },
  {
    name: 'purchases-record-purchase-button', login: 'admin', page: 'purchases',
    run: async (h) => { await h.highlight('#btn-record-purchase'); },
  },
  {
    name: 'purchases-export-csv-button', login: 'admin', page: 'purchases',
    run: async (h) => { await h.highlight('#btn-export-purchases'); },
  },
  {
    name: 'purchases-record-purchase-form', login: 'admin', page: 'purchases',
    run: async (h) => {
      await h.click('#btn-record-purchase');
      await h.selectText('#purchase-product', 'Cool Water Diffuser Oil');
      await h.eval(() => document.getElementById('purchase-product').dispatchEvent(new Event('change')));
      await h.type('#purchase-qty', '5');
      await h.type('#purchase-rate', '6000');
      await h.eval(() => document.getElementById('purchase-rate').dispatchEvent(new Event('input')));
      await h.type('#purchase-supplier', 'Essence Oils Co');
      await h.type('#purchase-bill', 'EO-602');
    },
    target: 'modal',
  },
  {
    name: 'purchases-totals-fragrance', login: 'admin', page: 'purchases',
    run: async (h) => { await h.clickText('Fragrance', '.purchase-group-btn'); },
    target: '#purchase-results .card',
  },
  {
    name: 'purchases-filter-supplier', login: 'admin', page: 'purchases',
    run: async (h) => {
      await h.selectText('#pf-supplier', 'Essence Oils');
      await h.eval(() => document.getElementById('pf-supplier').dispatchEvent(new Event('change')));
      await h.wait(300);
      await h.highlight('#pf-supplier');
    },
  },

  // ---------- Inventory Log ----------
  { name: 'inventory-log-overview-page', login: 'admin', page: 'inventory-log' },
  {
    name: 'inventory-log-filter-adjustment', login: 'admin', page: 'inventory-log',
    run: async (h) => {
      await h.select('#log-filter-type', 'adjustment');
      await h.eval(() => document.getElementById('log-filter-type').dispatchEvent(new Event('change')));
      await h.settle();
      await h.highlight('#log-filter-type');
    },
  },
  {
    name: 'inventory-log-paging', login: 'admin', page: 'inventory-log',
    target: '.toolbar',
  },

  // ---------- Damage & Loss ----------
  { name: 'damage-loss-overview-page', login: 'admin', page: 'damage-loss' },
  {
    name: 'damage-loss-report-button', login: 'admin', page: 'damage-loss',
    run: async (h) => { await h.highlight('#btn-report-damage'); },
  },
  {
    name: 'damage-loss-report-form', login: 'admin', page: 'damage-loss',
    run: async (h) => {
      await h.click('#btn-report-damage');
      await h.selectText('#dmg-product', 'Rose Refill');
      await h.type('#dmg-qty', '2');
      await h.type('#dmg-reason', 'Two bottles broke when the carton fell in the warehouse');
    },
    target: 'modal',
  },
];
