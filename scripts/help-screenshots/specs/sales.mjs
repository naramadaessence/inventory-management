// Screenshot spec for the Help section "Sales & Collections" (js/help/sections/sales.js).
//   node shoot.mjs specs/sales.mjs [--only name1,name2]

const tall = (h, height = 1250) => h.page.setViewport({ width: 1366, height, deviceScaleFactor: 1 });
const tallPhone = (h, height = 1500) => h.page.setViewport({ width: 390, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// Set a date input (typing into date fields depends on the browser locale).
const setDate = (h, sel, value) => h.eval((sel, value) => {
  const el = document.querySelector(sel);
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, sel, value);

const pickParty = async (h, name) => {
  await h.click('#sale-party-input');
  await h.clickText(name, '.party-opt');
};

const addItem = async (h, productText, qty, price) => {
  await h.selectText('#add-item-product', productText);
  await h.type('#add-item-qty', qty);
  if (price !== undefined) await h.type('#add-item-price', price);
  await h.click('#btn-add-item');
};

// Create extra demo bills through the app's own sale/collection functions,
// so Collections shows pending, due-soon and overdue rows.
const seedBills = (h) => h.eval(async () => {
  const { db, auth } = await import('/js/supabase.js');
  const me = auth.currentUser.id;
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };
  await db.rpc('record_sale', {
    p_party_id: 2, p_items: [{ product_id: 8, quantity: 6, unit_price: 450 }, { product_id: 13, quantity: 4, unit_price: 450 }],
    p_payment_status: 'partial', p_payment_method: 'cash', p_amount_received: 2000, p_expected_payment_date: day(-4),
    p_sale_date: day(-9), p_notes: 'Half paid at delivery', p_recorded_by: 'demo-kunal', p_sale_type: 'gst',
  });
  await db.rpc('record_sale', {
    p_party_id: 5, p_items: [{ product_id: 18, quantity: 0.5, unit_price: 8000 }],
    p_payment_status: 'pending', p_payment_method: null, p_amount_received: 0, p_expected_payment_date: day(12),
    p_sale_date: day(-2), p_notes: '', p_recorded_by: 'demo-neha', p_sale_type: 'cash',
  });
  await db.rpc('record_sale', {
    p_party_id: 1, p_items: [{ product_id: 2, quantity: 2, unit_price: 1400 }],
    p_payment_status: 'pending', p_payment_method: null, p_amount_received: 0, p_expected_payment_date: day(1),
    p_sale_date: day(-1), p_notes: '', p_recorded_by: me, p_sale_type: 'gst',
  });
});

// Click without needing the element on screen (on phones some header buttons sit past the right edge).
const jsClick = async (h, sel) => { await h.eval((sel) => document.querySelector(sel).click(), sel); await h.settle(); };

// Click a button inside the table row whose text includes `rowText`.
const clickInRow = async (h, rowText, btnSel) => {
  await h.eval((rowText, btnSel) => {
    const row = [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes(rowText));
    row.querySelector(btnSel).click();
  }, rowText, btnSel);
  await h.settle();
};

const seedWalkIn = (h) => h.eval(async () => {
  const { db, auth } = await import('/js/supabase.js');
  await db.rpc('record_sale', {
    p_party_id: null, p_items: [{ product_id: 9, quantity: 3, unit_price: 450 }],
    p_payment_status: 'pending', p_payment_method: null, p_amount_received: 0, p_expected_payment_date: null,
    p_sale_date: new Date().toISOString().split('T')[0], p_notes: '', p_recorded_by: auth.currentUser.id, p_sale_type: 'cash',
  });
});

// A collection typed wrongly: ₹1,000 instead of ₹100 on the Hotel Grand Bhagwati dispenser bill (from seedBills).
const seedWrongCollection = (h) => h.eval(async () => {
  const { db, auth } = await import('/js/supabase.js');
  const { data: sales } = await db.getAll('sales');
  const bill = sales.find(s => s.party_id === 1 && s.total_amount === 2800);
  await db.rpc('record_payment_followup', {
    p_sale_id: bill.id, p_party_id: 1, p_status_update: 'partial', p_payment_method: 'cash',
    p_amount_collected: 1000, p_expected_payment_date: bill.expected_payment_date, p_notes: 'Collected at reception',
    p_visited_by: auth.currentUser.id,
  });
});

export const shots = [
  // ── Sales page ──
  {
    name: 'sales-overview-page', login: 'admin', page: 'sales',
    run: async (h) => { await seedBills(h); await h.go('sales'); },
  },
  {
    name: 'sales-record-bill-button', login: 'admin', page: 'sales',
    run: async (h) => { await h.highlight('#btn-new-sale'); },
  },
  {
    name: 'sales-record-bill-form', login: 'admin', page: 'sales', target: 'modal',
    run: async (h) => {
      await tall(h);
      await h.click('#btn-new-sale');
      await pickParty(h, 'Hotel Grand Bhagwati');
      await addItem(h, 'Black Touch Refill', 4);
      await addItem(h, 'Cool Water Diffuser Oil', 0.5);
      await h.select('#sale-type', 'gst');
      await h.select('#sale-payment', 'partial');
      await h.select('#sale-method', 'upi');
      await h.type('#sale-received', 3000);
      await setDate(h, '#sale-expected-date', '2026-11-10');
      await h.type('#sale-notes', 'Balance after month-end');
    },
  },
  {
    name: 'sales-record-bill-empty', login: 'admin', page: 'sales', target: 'modal',
    run: async (h) => { await tall(h); await h.click('#btn-new-sale'); },
  },
  {
    name: 'sales-walk-in-party-list', login: 'admin', page: 'sales', target: 'modal',
    run: async (h) => { await h.click('#btn-new-sale'); await h.click('#sale-party-input'); },
  },
  {
    name: 'sales-amc-bill-toggle', login: 'admin', page: 'sales', target: 'modal',
    run: async (h) => {
      await tall(h);
      await h.click('#btn-new-sale');
      await pickParty(h, 'Hotel Rivera');
      await addItem(h, 'Rose Refill', 4);
      await h.click('#sale-amc-toggle');
    },
  },
  {
    name: 'sales-credit-payment-fields', login: 'admin', page: 'sales', target: 'modal',
    run: async (h) => {
      await tall(h);
      await h.click('#btn-new-sale');
      await pickParty(h, 'Orbit Co-working');
      await addItem(h, 'Green Apple Refill', 10);
      await h.select('#sale-type', 'cash');
      await h.select('#sale-payment', 'pending');
      await setDate(h, '#sale-expected-date', '2026-11-15');
    },
  },
  {
    name: 'sales-record-bill-saved', login: 'admin', page: 'sales',
    run: async (h) => {
      await h.click('#btn-new-sale');
      await pickParty(h, 'Hotel Grand Bhagwati');
      await addItem(h, 'Black Touch Refill', 4);
      await addItem(h, 'Cool Water Diffuser Oil', 0.5);
      await h.select('#sale-payment', 'partial');
      await h.select('#sale-method', 'upi');
      await h.type('#sale-received', 3000);
      await setDate(h, '#sale-expected-date', '2026-11-10');
      await h.click('#sale-save');
      await h.wait(400);
      await h.highlight('.sale-row');
    },
  },
  {
    name: 'sales-filter-buttons', login: 'admin', page: 'sales',
    target: '#page-body',
    run: async (h) => { await h.click('#filter-cash'); await h.highlight('#filter-cash'); },
  },
  {
    name: 'sales-edit-bill-form', login: 'admin', page: 'sales', target: 'modal',
    run: async (h) => {
      await tall(h);
      await h.clickText('Edit Bill', '.edit-sale-btn');
    },
  },
  {
    name: 'sales-insufficient-stock-error', login: 'admin', page: 'sales', keepToasts: true,
    run: async (h) => {
      await h.click('#btn-new-sale');
      await addItem(h, 'Sandal Refill', 8);
      await h.click('#sale-save');
    },
  },
  // ── Seller (phone) ──
  {
    name: 'sales-seller-page-mobile', login: 'seller', page: 'sales', mobile: true,
  },
  {
    name: 'sales-seller-form-mobile', login: 'neha@narmadaessence.com', page: 'sales', mobile: true, target: 'modal',
    run: async (h) => {
      await tallPhone(h);
      await jsClick(h, '#btn-new-sale');
      await h.eval(() => document.getElementById('sale-party-input').focus());
      await h.clickText('Walk-in customer', '.party-opt');
      await h.selectText('#add-item-product', 'Lavender Refill');
      await h.type('#add-item-qty', 2);
      await jsClick(h, '#btn-add-item');
      await h.select('#sale-type', 'cash');
      await h.select('#sale-method', 'cash');
    },
  },
  // ── Collections ──
  {
    name: 'collections-overview-page', login: 'admin', page: 'collections',
    run: async (h) => { await seedBills(h); await h.go('collections'); },
  },
  {
    name: 'collections-pending-table', login: 'admin', page: 'collections', target: '.card:has(#collections-content)',
    run: async (h) => { await seedBills(h); await h.go('collections'); await h.scrollTo('#collections-content'); },
  },
  {
    name: 'collections-record-payment-form', login: 'admin', page: 'collections', target: 'modal',
    run: async (h) => {
      await seedBills(h); await h.go('collections');
      await h.click('.update-payment-btn');
      await h.select('#fu-status', 'partial');
      await h.select('#fu-method', 'upi');
      await h.type('#fu-amount', 1000);
      await h.type('#fu-notes', 'Paid 1,000 by UPI. Rest next week.');
    },
  },
  {
    name: 'collections-history-tab', login: 'admin', page: 'collections', target: '.card:has(#collections-content)',
    run: async (h) => { await h.clickText('All Visit History', '.tab-btn'); },
  },
  {
    name: 'collections-seller-mobile', login: 'kunal@narmadaessence.com', page: 'collections', mobile: true,
    run: async (h) => { await seedBills(h); await h.go('collections'); },
  },
  {
    name: 'collections-log-visit-mobile', login: 'kunal@narmadaessence.com', page: 'collections', mobile: true, target: 'modal',
    run: async (h) => {
      await seedBills(h); await h.go('collections');
      // Hide the wide table behind the window so the phone layout does not widen (shot shows only the window).
      await h.eval(() => { document.getElementById('page-body').style.display = 'none'; window.scrollTo(0, 0); });
      await tallPhone(h);
      await jsClick(h, '#btn-log-visit');
      await h.selectText('#visit-sale', 'Sahara Darbar');
      await h.select('#visit-status', 'partial');
      await h.select('#visit-method', 'cash');
      await h.type('#visit-amount', 1000);
      await h.type('#visit-notes', 'Met the manager. Paid 1,000 cash, rest on Friday.');
    },
  },
  {
    name: 'collections-payment-reminders-card', login: 'admin', page: 'dashboard', target: '.card:has(#payment-reminders)',
    run: async (h) => { await seedBills(h); await h.go('dashboard'); await h.scrollTo('#payment-reminders'); },
  },
  {
    name: 'sales-seller-button-mobile', login: 'seller', page: 'sales', mobile: true,
    run: async (h) => { await h.highlight('#btn-new-sale'); },
  },
  {
    name: 'sales-delete-bill-button', login: 'admin', page: 'sales',
    run: async (h) => { await h.highlight('.delete-sale-btn'); },
  },
  {
    name: 'sales-export-csv-button', login: 'admin', page: 'sales', target: '#page-body',
    run: async (h) => { await h.highlight('#btn-export-csv'); },
  },
  {
    name: 'collections-correct-payment-form', login: 'admin', page: 'sales', target: 'modal',
    run: async (h) => {
      await seedBills(h); await seedWrongCollection(h); await h.go('sales');
      await tall(h);
      await clickInRow(h, 'NE 002', '.edit-sale-btn');
      await h.type('#edit-sale-received', 100);
      await h.highlight('#edit-sale-received');
    },
  },
  {
    name: 'collections-correct-payment-history', login: 'admin', page: 'sales', target: '.card:has(#collections-content)',
    run: async (h) => {
      await seedBills(h); await seedWrongCollection(h); await h.go('sales');
      await clickInRow(h, 'NE 002', '.edit-sale-btn');
      await h.type('#edit-sale-received', 100);
      await h.click('#edit-sale-save');
      await h.go('collections');
      await h.clickText('All Visit History', '.tab-btn');
    },
  },
  {
    name: 'collections-promised-form', login: 'admin', page: 'collections', target: 'modal',
    run: async (h) => {
      await seedBills(h); await h.go('collections');
      await clickInRow(h, 'Hotel Rivera', '.update-payment-btn');
      await h.select('#fu-status', 'promised');
      await setDate(h, '#fu-expected-date', '2026-11-07');
      await h.type('#fu-notes', 'Accounts head will pay by NEFT on Saturday.');
    },
  },
  {
    name: 'collections-walk-in-error', login: 'admin', page: 'collections', keepToasts: true,
    run: async (h) => {
      await seedWalkIn(h); await h.go('collections');
      await clickInRow(h, 'Walk-in', '.update-payment-btn');
      await h.select('#fu-status', 'paid');
      await h.click('#fu-save');
    },
  },
];
