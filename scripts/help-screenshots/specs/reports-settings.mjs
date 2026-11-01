// Screenshots for the Help section "Reports & Settings" (js/help/sections/reports-settings.js).
const tab = (name) => async (h) => { await h.click(`.tab-btn[data-tab="${name}"]`); await h.wait(600); };
// Tall element crops scroll the page; stop the sticky page header from covering them.
const unstickHeader = (h) => h.eval(() => { document.getElementById('page-header').style.position = 'static'; });
// Staff Daily Ledger filtered to one seller (by visible name).
const ledgerFor = (staff) => async (h) => {
  await tab('ledger')(h);
  await h.selectText('#ledger-staff', staff);
  await h.wait(400);
  await unstickHeader(h);
};

export const shots = [
  // ---------- Reports ----------
  { name: 'reports-overview-page', login: 'admin', page: 'reports', run: async (h) => { await h.wait(800); } },
  { name: 'reports-overview-toolbar', login: 'admin', page: 'reports',
    run: async (h) => { await h.select('#report-preset', 'custom'); await h.highlight('#report-apply'); },
    target: '.toolbar:has(#report-preset)' },
  { name: 'reports-sales-summary', login: 'admin', page: 'reports', run: async (h) => { await h.wait(800); }, target: '#report-content' },
  { name: 'reports-stock-valuation-page', login: 'admin', page: 'reports', run: tab('stock') },
  { name: 'reports-seller-performance-table', login: 'admin', page: 'reports', run: tab('sellers'), target: '#report-content' },
  { name: 'reports-staff-ledger-page', login: 'admin', page: 'reports', run: tab('ledger') },
  { name: 'reports-staff-ledger-card', login: 'admin', page: 'reports', run: ledgerFor('Imran'), target: '.ledger-staff' },
  { name: 'reports-staff-ledger-filters', login: 'admin', page: 'reports',
    run: async (h) => { await tab('ledger')(h); await h.highlight('#report-content > .toolbar .toolbar-left'); } },
  { name: 'reports-staff-ledger-awaiting', login: 'admin', page: 'reports', run: ledgerFor('Raj'), target: '.ledger-staff' },
  { name: 'reports-staff-ledger-used', login: 'admin', page: 'reports',
    run: async (h) => {
      await ledgerFor('Kunal')(h);
      await h.eval(() => { document.querySelector('.ledger-staff tr[data-ledger-row] details').open = true; });
      await h.wait(200);
    },
    target: '.ledger-staff' },
  { name: 'reports-staff-ledger-in-field', login: 'admin', page: 'reports', run: ledgerFor('Sonal'), target: '.ledger-staff' },
  { name: 'reports-staff-ledger-fragrance', login: 'admin', page: 'reports',
    run: async (h) => { await tab('ledger')(h); await h.click('#ledger-group-fragrance'); await h.wait(300); } },
  { name: 'reports-staff-ledger-export', login: 'admin', page: 'reports',
    run: async (h) => { await tab('ledger')(h); await h.highlight('#ledger-export'); } },
  { name: 'reports-movers-page', login: 'admin', page: 'reports', run: tab('movers') },

  // ---------- Settings ----------
  { name: 'settings-users-page', login: 'admin', page: 'settings' },
  { name: 'settings-add-user-button', login: 'admin', page: 'settings', run: async (h) => { await h.highlight('#btn-add-user'); } },
  { name: 'settings-add-user-form', login: 'admin', page: 'settings',
    run: async (h) => {
      await h.click('#btn-add-user');
      await h.type('#user-name', 'Rohan Verma');
      await h.type('#user-email', 'rohan.demo@example.com');
      await h.type('#user-phone', '9000000000');
      await h.type('#user-password', 'Field2026');
    },
    target: 'modal' },
  { name: 'settings-edit-user-form', login: 'admin', page: 'settings',
    run: async (h) => {
      await h.eval(() => {
        const row = [...document.querySelectorAll('#settings-content tbody tr')].find(r => r.textContent.includes('Imran'));
        row.querySelector('.edit-user-btn').click();
      });
      await h.settle();
    },
    target: 'modal' },
  { name: 'settings-user-actions', login: 'admin', page: 'settings',
    run: async (h) => {
      await h.eval(() => {
        const row = [...document.querySelectorAll('#settings-content tbody tr')].find(r => r.textContent.includes('Imran'));
        row.id = 'help-imran-row';
        row.querySelector('.toggle-user-btn').id = 'help-imran-toggle';
      });
      await h.highlight('#help-imran-toggle');
    } },
  { name: 'settings-user-inactive', login: 'admin', page: 'settings',
    run: async (h) => {
      await h.eval(() => {
        const row = [...document.querySelectorAll('#settings-content tbody tr')].find(r => r.textContent.includes('Imran'));
        row.querySelector('.toggle-user-btn').click();
      });
      await h.wait(800);
      await h.eval(() => {
        const row = [...document.querySelectorAll('#settings-content tbody tr')].find(r => r.textContent.includes('Imran'));
        row.querySelector('.toggle-user-btn').id = 'help-imran-toggle';
      });
      await h.highlight('#help-imran-toggle');
    },
    target: '#settings-content .table-wrapper' },
  { name: 'settings-categories-page', login: 'admin', page: 'settings', run: tab('categories') },
  { name: 'settings-add-category-form', login: 'admin', page: 'settings',
    run: async (h) => {
      await tab('categories')(h);
      await h.click('#btn-add-cat');
      await h.type('#cat-name', 'Car Perfume');
    },
    target: 'modal' },
  { name: 'settings-edit-category-form', login: 'admin', page: 'settings',
    run: async (h) => {
      await tab('categories')(h);
      await h.eval(() => {
        const row = [...document.querySelectorAll('#settings-content tbody tr')].find(r => r.textContent.includes('Smart Diffuser'));
        row.querySelector('.edit-cat-btn').click();
      });
      await h.settle();
    },
    target: 'modal' },
  { name: 'settings-stock-rules-page', login: 'admin', page: 'settings', run: tab('stock-rules') },
  { name: 'settings-stock-rules-card', login: 'admin', page: 'settings', run: tab('stock-rules'), target: '#settings-content .card' },
];
