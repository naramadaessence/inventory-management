// Screenshots for the "Getting Started & Dashboard" help section.
// node shoot.mjs specs/getting-started.mjs [--only a,b]

const ADMIN = 'priya@narmadaessence.com';
const SELLER = 'kunal@narmadaessence.com';

// The demo week has no AMC refills near today and no products near expiry.
// These set up the same state an admin would create on the Parties and
// Products pages, so the refill and expiry cards have something to show.
async function setupRefills(h) {
  await h.eval(async () => {
    const { db } = await import('/js/supabase.js');
    const today = new Date().getDate();
    await db.update('parties', 4, { amc_active: true, amc_day: today });
    await db.update('parties', 6, { amc_active: true, amc_day: today + 2 });
    await db.update('parties', 1, { amc_active: true, amc_day: today + 4 });
  });
}

async function setupExpiry(h) {
  const iso = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
  await h.eval(async (soon, past) => {
    const { db } = await import('/js/supabase.js');
    const { data } = await db.getAll('products');
    const withExpiry = data.filter(p => p.expiry_date && p.is_active);
    await db.update('products', withExpiry[0].id, { expiry_date: soon });
    await db.update('products', withExpiry[1].id, { expiry_date: past });
  }, iso(25), iso(-3));
}

async function tall(h) {
  await h.page.setViewport({ width: 1366, height: 1000, deviceScaleFactor: 1 });
  await h.wait(300);
}

export const shots = [
  // Logging in / out
  { name: 'getting-started-log-in-form', login: 'none', target: '.login-card' },
  {
    name: 'getting-started-log-in-error', login: 'none', target: '.login-card',
    run: async (h) => {
      await h.type('#login-email', 'raj@narmadaessence.com');
      await h.type('#login-password', 'wrongpass');
      await h.page.click('#login-btn');
      await h.page.waitForFunction(() => document.getElementById('login-error')?.style.display === 'block', { timeout: 8000 });
      await h.page.$eval('#login-password', el => { el.value = ''; });
      await h.wait(200);
    },
  },
  {
    name: 'getting-started-log-out-button', login: ADMIN, page: 'dashboard', target: '#sidebar',
    run: async (h) => { await tall(h); await h.highlight('#btn-logout'); },
  },

  // Roles
  {
    name: 'getting-started-roles-admin-menu', login: ADMIN, page: 'dashboard', target: '#sidebar',
    run: async (h) => { await tall(h); },
  },
  { name: 'getting-started-roles-seller-menu', login: SELLER, page: 'dashboard', target: '#sidebar' },
  { name: 'getting-started-roles-access-denied', login: SELLER, page: 'products', target: '#page-body' },

  // Navigation
  {
    name: 'getting-started-navigate-sidebar', login: ADMIN, page: 'sales',
    run: async (h) => { await h.highlight('#sidebar-nav .nav-item[data-page="sales"]'); },
  },
  {
    name: 'getting-started-navigate-mobile-button', login: SELLER, page: 'dashboard', mobile: true,
    run: async (h) => { await h.highlight('#page-header .mobile-toggle'); },
  },
  {
    name: 'getting-started-navigate-mobile-menu', login: SELLER, page: 'dashboard', mobile: true,
    run: async (h) => { await h.click('#page-header .mobile-toggle'); await h.wait(500); },
  },

  // Keyboard shortcuts
  {
    name: 'getting-started-keyboard-shortcuts-window', login: ADMIN, page: 'dashboard', target: 'modal',
    run: async (h) => {
      await h.eval(() => document.activeElement?.blur());
      await h.page.keyboard.type('?');
      await h.wait(400);
    },
  },

  // Admin dashboard
  { name: 'dashboard-overview-admin', login: ADMIN, page: 'dashboard' },
  { name: 'dashboard-summary-cards', login: ADMIN, page: 'dashboard', target: '#page-body .stats-grid' },
  { name: 'dashboard-reconciliation-card', login: ADMIN, page: 'dashboard', target: '#reconciliation-alerts' },
  {
    name: 'dashboard-pending-approvals-card', login: ADMIN, page: 'dashboard',
    target: '#page-body > .card:has(.fa-clipboard-check)',
  },
  {
    name: 'dashboard-low-stock-expiry', login: ADMIN, page: 'dashboard', target: '#page-body .grid-2',
    run: async (h) => { await setupExpiry(h); await h.go('dashboard'); },
  },
  {
    name: 'dashboard-payment-reminders-card', login: ADMIN, page: 'dashboard',
    target: '#page-body .card:has(#payment-reminders)',
  },
  {
    name: 'dashboard-recent-activity-card', login: ADMIN, page: 'dashboard',
    target: '#page-body .card:has(#recent-activity)',
  },
  {
    name: 'dashboard-refills-admin-today', login: ADMIN, page: 'dashboard',
    target: '#page-body > .card:has(.refill-complete-btn)',
    run: async (h) => { await setupRefills(h); await h.go('dashboard'); },
  },
  {
    name: 'dashboard-refills-admin-upcoming', login: ADMIN, page: 'dashboard',
    target: '#page-body > .card:has(.fa-calendar-alt)',
    run: async (h) => { await setupRefills(h); await h.go('dashboard'); },
  },

  // Seller dashboard
  {
    name: 'dashboard-seller-view', login: SELLER, page: 'dashboard',
    run: async (h) => { await setupRefills(h); await h.go('dashboard'); },
  },
  {
    name: 'dashboard-seller-view-mobile', login: SELLER, page: 'dashboard', mobile: true,
    run: async (h) => { await setupRefills(h); await h.go('dashboard'); },
  },
  {
    name: 'dashboard-seller-refill-done', login: SELLER, page: 'dashboard', mobile: true,
    run: async (h) => {
      await setupRefills(h);
      await h.go('dashboard');
      await h.highlight('.seller-refill-done');
    },
  },
  { name: 'dashboard-seller-empty', login: SELLER, page: 'dashboard', target: '#page-body' },
];
