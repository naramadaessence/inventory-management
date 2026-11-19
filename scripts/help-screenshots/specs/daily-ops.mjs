// Screenshots for the Help section "Daily Operations (Issue & Return)".
// Demo-week states used: Kunal = pending stock request, Raj (seller) = return
// awaiting approval with a 1 pc Lavender shortage, Sonal = stock still out from
// a previous day, Imran = one rejected (Flagged) request + a sent-back return +
// an approved "Any Dispenser Refill" return with 1 lost Green Apple (day 4),
// Neha = in field today with Any Dispenser Refill × 6 and one field-stock bill.

const SONAL = 'sonal@narmadaessence.com';
const KUNAL = 'kunal@narmadaessence.com';
const IMRAN = 'imran@narmadaessence.com';
const NEHA = 'neha@narmadaessence.com';

// Set an input/select value and fire the events the page listens to.
async function setVal(h, selector, value, index = 0) {
  await h.page.waitForSelector(selector, { timeout: 8000 });
  await h.eval((sel, v, i) => {
    const el = document.querySelectorAll(sel)[i];
    if (!el) throw new Error(`setVal: no ${sel}[${i}]`);
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value, index);
  await h.wait(120);
}

async function clickNth(h, selector, index = 0) {
  await h.page.waitForSelector(selector, { timeout: 8000 });
  await h.eval((sel, i) => {
    const el = document.querySelectorAll(sel)[i];
    if (!el) throw new Error(`clickNth: no ${sel}[${i}]`);
    // No scrollIntoView: on phones it shifts the (too wide) page sideways.
    el.click();
  }, selector, index);
  await h.settle();
}

// Mark the newest window so it can be cropped even when two are open.
async function markTopModal(h) {
  await h.eval(() => {
    const all = [...document.querySelectorAll('.modal-overlay')];
    all.forEach(o => o.classList.remove('shot-top'));
    all.at(-1)?.classList.add('shot-top');
  });
}
const TOP = '.modal-overlay.shot-top .modal';

// Long windows: make the screen taller so the whole window (with its buttons) fits.
async function tall(h) {
  await h.page.setViewport({ width: 1366, height: 1250, deviceScaleFactor: 1 });
  await h.wait(200);
}

// Phones: the page is wider than the screen, so clicks can scroll it sideways.
async function left(h) {
  await h.eval(() => window.scrollTo(0, window.scrollY));
  await h.wait(150);
}

async function tab(h, key) {
  await clickNth(h, `.tab-btn[data-tab="${key}"]`);
}

// Issue / Request Stock window: search the picker, click the row, set its quantity.
// `keepSearch` leaves the search text in the box (for shots of the search).
async function pickRow(h, rowSelector, search, qty, keepSearch = false) {
  await setVal(h, '.sp-search', search);
  await h.eval(sel => {
    const row = typeof sel === 'string' ? document.querySelector(sel) : null;
    if (!row) throw new Error(`pickRow: no ${sel}`);
    row.click();
  }, rowSelector);
  await h.wait(150);
  const count = await h.eval(() => document.querySelectorAll('.co-line').length);
  if (qty != null) await setVal(h, '.co-qty', qty, count - 1);
  if (!keepSearch) await setVal(h, '.sp-search', '');
}

async function addProduct(h, name, qty, keepSearch = false) {
  await setVal(h, '.sp-search', name);
  const id = await h.eval(name => {
    const row = [...document.querySelectorAll('.sp-row[data-kind="product"]')]
      .find(r => r.querySelector('.sp-row-name').textContent.trim().startsWith(name));
    return row ? row.dataset.id : null;
  }, name);
  if (!id) throw new Error(`addProduct: no picker row for ${name}`);
  await pickRow(h, `.sp-row[data-kind="product"][data-id="${id}"]`, name, qty, keepSearch);
}

// "Any <category>" line (category 3 = Dispenser Refill in the demo).
async function addAny(h, categoryId, qty, search = 'any refill', keepSearch = false) {
  await pickRow(h, `.sp-row[data-kind="any"][data-id="${categoryId}"]`, search, qty, keepSearch);
}
const REFILLS = 3;

async function relogin(h, email, password) {
  await clickNth(h, '#btn-logout');
  await h.page.waitForSelector('#login-form', { timeout: 10000 });
  await h.page.type('#login-email', email);
  await h.page.type('#login-password', password);
  await h.page.click('#login-btn');
  await h.page.waitForSelector('#sidebar-nav .nav-item', { timeout: 15000 });
  await h.eval(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await h.settle();
}

// Admin: issue stock directly to a seller (lands on the In Field tab).
async function adminIssue(h, seller, products) {
  await clickNth(h, '#btn-new-checkout');
  await h.selectText('#co-seller', seller);
  for (const [name, qty] of products) await addProduct(h, name, qty);
  await clickNth(h, '#co-submit');
  await h.wait(400);
}

// Open the return form of the newest In Field session in the list.
async function openFirstReturn(h) {
  await clickNth(h, '.checkin-btn', 0);
  await h.page.waitForSelector('.ci-item');
}

// Add a usage line to item `idx` and fill it.
async function addUsage(h, idx, { reason, qty, party, note }) {
  await clickNth(h, `.ci-add-usage[data-idx="${idx}"]`);
  const line = await h.eval(i => document.querySelectorAll(`.ci-u-reason[data-idx="${i}"]`).length - 1, idx);
  if (reason) await setVal(h, `.ci-u-reason[data-idx="${idx}"][data-line="${line}"]`, reason);
  if (party) {
    const value = await h.eval((i, l, p) => {
      const el = document.querySelector(`.ci-u-party[data-idx="${i}"][data-line="${l}"]`);
      return [...el.options].find(o => o.textContent.includes(p))?.value;
    }, idx, line, party);
    await setVal(h, `.ci-u-party[data-idx="${idx}"][data-line="${line}"]`, value);
  }
  if (qty != null) await setVal(h, `.ci-u-qty[data-idx="${idx}"][data-line="${line}"]`, qty);
  if (note) await setVal(h, `.ci-u-notes[data-idx="${idx}"][data-line="${line}"]`, note);
}

async function setReturned(h, idx, value) {
  await setVal(h, `.ci-returned[data-idx="${idx}"]`, value);
}

// ---------- "Any <category>" return block ----------
// Neha (demo week, today): item 0 = Any Dispenser Refill × 6 with a field bill
// for 1 Black Touch Refill (fixed entry 0, Sold), item 1 = Western Lavender Oil 0.3 kg.
const anyEntry = (cls, idx, entry) => `.${cls}[data-idx="${idx}"][data-entry="${entry}"]`;

async function addAnyProduct(h, idx, productName) {
  await clickNth(h, `.ci-any-add[data-idx="${idx}"]`);
  const entry = await h.eval(i => document.querySelectorAll(`.ci-item[data-idx="${i}"] .ci-any-entry`).length - 1, idx);
  const value = await h.eval((sel, name) => {
    const el = document.querySelector(sel);
    return [...el.options].find(o => o.textContent.includes(name))?.value;
  }, anyEntry('ci-a-product', idx, entry), productName);
  if (!value) throw new Error(`addAnyProduct: no option ${productName}`);
  await setVal(h, anyEntry('ci-a-product', idx, entry), value);
  return entry;
}

async function addAnyUsage(h, idx, entry, { reason, qty, party }) {
  await clickNth(h, anyEntry('ci-add-usage', idx, entry));
  const base = `[data-idx="${idx}"][data-entry="${entry}"]`;
  const line = await h.eval(b => document.querySelectorAll(`.ci-u-reason${b}`).length - 1, base);
  const at = cls => `.${cls}${base}[data-line="${line}"]`;
  if (reason) await setVal(h, at('ci-u-reason'), reason);
  if (party) {
    const value = await h.eval((sel, p) => [...document.querySelector(sel).options].find(o => o.textContent.includes(p))?.value, at('ci-u-party'), party);
    await setVal(h, at('ci-u-party'), value);
  }
  if (qty != null) await setVal(h, at('ci-u-qty'), qty);
}

// Black Touch: 1 sold + 1 back; Rose: 2 back.  → Accounted 3 of 6.
async function fillNehaPartial(h) {
  await openFirstReturn(h);
  await setVal(h, anyEntry('ci-a-returned', 0, 0), 1);
  const rose = await addAnyProduct(h, 0, 'Rose Refill');
  await setVal(h, anyEntry('ci-a-returned', 0, rose), 2);
}

// …then Pleasure: 1 used at Sahara Darbar; Green Apple: 1 lost → 6 of 6. Oil matches.
async function fillNehaComplete(h) {
  await fillNehaPartial(h);
  const pleasure = await addAnyProduct(h, 0, 'Pleasure Refill');
  await addAnyUsage(h, 0, pleasure, { reason: 'customer_service', qty: 1, party: 'Sahara Darbar' });
  const apple = await addAnyProduct(h, 0, 'Green Apple Refill');
  await setVal(h, anyEntry('ci-a-lost', 0, apple), 1);
  await setReturned(h, 1, 0.1);
  await addUsage(h, 1, { reason: 'customer_service', qty: 0.2, party: 'Sahara Darbar' });
  await setVal(h, '#ci-notes', 'One Green Apple refill missing from the bag');
}

// Sonal: Sandal Refill (5 pcs) is item 0, Decor Refill (3 pcs) is item 1.
async function fillSonalMatching(h) {
  await openFirstReturn(h);
  await setReturned(h, 0, 1);
  await addUsage(h, 0, { reason: 'customer_service', qty: 4, party: 'Grand Bhagwati' });
  await setReturned(h, 1, 1);
  await addUsage(h, 1, { reason: 'customer_service', qty: 2, party: 'Fern Spa' });
  await setVal(h, '#ci-notes', 'Two visits, both refills changed');
}

const rawShots = [
  // ---------- Overview / tabs ----------
  { name: 'daily-ops-overview-admin', login: 'admin', page: 'daily-ops' },
  { name: 'daily-ops-overview-seller-mobile', login: KUNAL, page: 'daily-ops', mobile: true },
  { name: 'daily-ops-tabs-in-field', login: 'admin', page: 'daily-ops', run: async h => { await tab(h, 'checked_out'); } },
  { name: 'daily-ops-tabs-completed', login: 'admin', page: 'daily-ops', run: async h => { await tab(h, 'checked_in'); } },
  { name: 'daily-ops-flagged-admin', login: 'admin', page: 'daily-ops', run: async h => { await tab(h, 'flagged'); } },
  { name: 'daily-ops-flagged-seller', login: IMRAN, page: 'daily-ops', run: async h => { await h.go('daily-ops'); await tab(h, 'flagged'); } },

  // ---------- Seller requests stock ----------
  { name: 'daily-ops-request-stock-button', login: SONAL, page: 'daily-ops', run: async h => { await h.go('daily-ops'); await h.highlight('#btn-new-checkout'); } },
  { name: 'daily-ops-request-stock-button-mobile', login: KUNAL, page: 'daily-ops', mobile: true, run: async h => { await h.highlight('#btn-new-checkout'); } },
  {
    name: 'daily-ops-request-stock-form', login: 'seller', page: 'daily-ops', target: 'modal',
    run: async h => {
      await tall(h);
      await clickNth(h, '#btn-new-checkout');
      await addProduct(h, 'Lavender Refill', 4);
      await addProduct(h, 'Cool Water Diffuser Oil', 0.3);
    },
  },
  {
    name: 'daily-ops-request-stock-low-stock', login: 'seller', page: 'daily-ops', target: TOP,
    run: async h => {
      await clickNth(h, '#btn-new-checkout');
      await addProduct(h, 'Gucci Oud Diffuser Oil', 10);
      await clickNth(h, '#co-submit');
      await markTopModal(h);
    },
  },
  { name: 'daily-ops-request-stock-submitted', login: KUNAL, page: 'daily-ops', run: async h => { await h.go('daily-ops'); } },

  // ---------- Admin approves / rejects a request ----------
  { name: 'daily-ops-approve-issue-list', login: 'admin', page: 'daily-ops', run: async h => { await h.highlight('.approve-issue-btn'); } },
  { name: 'daily-ops-approve-issue-window', login: 'admin', page: 'daily-ops', target: 'modal', run: async h => { await clickNth(h, '.approve-issue-btn'); } },
  {
    name: 'daily-ops-approve-issue-insufficient', login: KUNAL, page: 'daily-ops', target: 'modal',
    run: async h => {
      await clickNth(h, '#btn-new-checkout');
      await addProduct(h, 'Green Apple Refill', 50);
      await addProduct(h, 'Rose Refill', 3);
      await clickNth(h, '#co-submit');
      await h.clickText('Submit anyway');
      await relogin(h, 'admin@narmadaessence.com', 'admin123');
      await h.go('daily-ops');
      await h.eval(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
      await clickNth(h, '.approve-issue-btn', 0);
    },
  },
  { name: 'daily-ops-reject-issue-confirm', login: 'admin', page: 'daily-ops', target: 'modal', run: async h => { await clickNth(h, '.flag-btn'); } },

  // ---------- Admin issues stock directly ----------
  { name: 'daily-ops-issue-stock-button', login: 'admin', page: 'daily-ops', run: async h => { await h.highlight('#btn-new-checkout'); } },
  {
    name: 'daily-ops-issue-stock-form', login: 'admin', page: 'daily-ops', target: 'modal',
    run: async h => {
      await tall(h);
      await clickNth(h, '#btn-new-checkout');
      await h.selectText('#co-seller', 'Neha');
      await addProduct(h, 'Pleasure Refill', 5);
      await addProduct(h, 'Cherry Blossom Diffuser Oil', 0.4);
    },
  },
  {
    name: 'daily-ops-issue-stock-search', login: 'admin', page: 'daily-ops', target: 'modal',
    run: async h => {
      await tall(h);
      await clickNth(h, '#btn-new-checkout');
      await h.selectText('#co-seller', 'Kunal');
      await setVal(h, '.sp-search', 'oud');
    },
  },
  {
    name: 'daily-ops-issue-stock-over', login: 'admin', page: 'daily-ops', target: 'modal',
    run: async h => {
      await tall(h);
      await clickNth(h, '#btn-new-checkout');
      await h.selectText('#co-seller', 'Kunal');
      await addProduct(h, 'Gucci Oud Diffuser Oil', 10);
      await addProduct(h, 'Rose Refill', 2);
    },
  },

  // ---------- "Any <category>" lines ----------
  {
    name: 'daily-ops-any-issue-form', login: 'admin', page: 'daily-ops', target: 'modal',
    run: async h => {
      await tall(h);
      await clickNth(h, '#btn-new-checkout');
      await h.selectText('#co-seller', 'Kunal');
      await clickNth(h, `.sp-chip[data-cat="${REFILLS}"]`);
      await h.eval(id => document.querySelector(`.sp-row[data-kind="any"][data-id="${id}"]`).click(), REFILLS);
      await h.wait(150);
      await setVal(h, '.co-qty', 10, 0);
      await addProduct(h, 'Rose Refill', 2);
      await h.eval(() => { document.querySelector('.sp-results').scrollTop = 0; });
    },
  },
  {
    name: 'daily-ops-any-request-form', login: 'seller', page: 'daily-ops', target: 'modal',
    run: async h => {
      await tall(h);
      await clickNth(h, '#btn-new-checkout');
      await addAny(h, REFILLS, 10, 'any refill', true);
      await addProduct(h, 'Cool Water Diffuser Oil', 0.3);
      await setVal(h, '.sp-search', 'any refill');
    },
  },
  {
    name: 'daily-ops-any-approve-issue', login: KUNAL, page: 'daily-ops', target: 'modal',
    run: async h => {
      await clickNth(h, '#btn-new-checkout');
      await addAny(h, REFILLS, 10);
      await addProduct(h, 'Rose Refill', 2);
      await clickNth(h, '#co-submit');
      await relogin(h, 'admin@narmadaessence.com', 'admin123');
      await h.go('daily-ops');
      await h.eval(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
      await clickNth(h, '.approve-issue-btn', 0);
    },
  },
  { name: 'daily-ops-any-return-partial', login: NEHA, page: 'daily-ops', target: 'modal', run: async h => { await tall(h); await fillNehaPartial(h); } },
  {
    name: 'daily-ops-any-return-complete', login: NEHA, page: 'daily-ops', target: 'modal',
    run: async h => { await h.page.setViewport({ width: 1366, height: 2000, deviceScaleFactor: 1 }); await fillNehaComplete(h); },
  },
  {
    name: 'daily-ops-any-approve-return', login: NEHA, page: 'daily-ops', target: 'modal',
    run: async h => {
      await h.page.setViewport({ width: 1366, height: 1400, deviceScaleFactor: 1 });
      await fillNehaComplete(h);
      await clickNth(h, '#ci-submit');
      await relogin(h, 'admin@narmadaessence.com', 'admin123');
      await h.go('daily-ops');
      await tab(h, 'pending_approval');
      await h.eval(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
      await h.eval(() => [...document.querySelectorAll('tr[data-session-id]')]
        .find(tr => tr.textContent.includes('Neha')).querySelector('.approve-return-btn').click());
      await h.settle();
      await setVal(h, '.ar-type', 'loss');
      await setVal(h, '.ar-note', 'Green Apple fell out of the bag — Neha to pay');
    },
  },
  {
    name: 'daily-ops-any-view-details', login: 'admin', page: 'daily-ops', target: 'modal',
    run: async h => {
      await tab(h, 'checked_in');
      const id = await h.eval(() => {
        const store = JSON.parse(localStorage.getItem('narmada_essence_data'));
        return store.checkout_items.find(i => i.parent_item_id != null && i.discrepancy_type).session_id;
      });
      await clickNth(h, `tr[data-session-id="${id}"] .view-btn`);
    },
  },

  // ---------- Seller submits a return ----------
  { name: 'daily-ops-submit-return-button', login: SONAL, page: 'daily-ops', run: async h => { await h.highlight('.checkin-btn'); } },
  { name: 'daily-ops-submit-return-button-mobile', login: SONAL, page: 'daily-ops', mobile: true, run: async h => { await h.highlight('.checkin-btn'); } },
  { name: 'daily-ops-submit-return-empty', login: SONAL, page: 'daily-ops', target: 'modal', run: async h => { await tall(h); await openFirstReturn(h); } },
  { name: 'daily-ops-submit-return-form', login: SONAL, page: 'daily-ops', target: 'modal', run: async h => { await tall(h); await fillSonalMatching(h); } },
  {
    name: 'daily-ops-submit-return-form-mobile', login: SONAL, page: 'daily-ops', mobile: true,
    run: async h => {
      await openFirstReturn(h);
      await setReturned(h, 0, 1);
      await addUsage(h, 0, { reason: 'customer_service', qty: 4, party: 'Grand Bhagwati' });
      // The wide table behind the window widens the phone page; hide it so the window fits.
      await h.eval(() => {
        document.getElementById('page-body').style.display = 'none';
        window.scrollTo(0, 0);
        document.querySelector('.modal-overlay .modal-body').scrollTop = 0;
      });
      await h.wait(200);
    },
  },
  {
    name: 'daily-ops-submit-return-mismatch', login: SONAL, page: 'daily-ops', target: 'modal',
    run: async h => {
      await openFirstReturn(h);
      await setReturned(h, 0, 1);
      await addUsage(h, 0, { reason: 'customer_service', qty: 3, party: 'Grand Bhagwati' });
      await setReturned(h, 1, 3);
    },
  },
  {
    name: 'daily-ops-submit-return-liquid', login: 'admin', page: 'daily-ops', target: 'modal',
    run: async h => {
      await adminIssue(h, 'Neha', [['Cool Water Diffuser Oil', 0.5]]);
      await openFirstReturn(h);
      await setReturned(h, 0, 0.2);
      await addUsage(h, 0, { reason: 'customer_service', qty: 0.295, party: 'City Pulse' });
    },
  },
  {
    name: 'daily-ops-submit-return-installation', login: 'admin', page: 'daily-ops', target: 'modal',
    run: async h => {
      await adminIssue(h, 'Imran', [['NE 001', 1]]);
      await openFirstReturn(h);
      await setReturned(h, 0, 0);
      await addUsage(h, 0, { reason: 'installation', qty: 1 });
    },
  },
  { name: 'daily-ops-submit-return-waiting', login: 'seller', page: 'daily-ops', run: async h => { await h.go('daily-ops'); } },

  // ---------- Admin approves a return ----------
  {
    name: 'daily-ops-approve-return-list', login: 'admin', page: 'daily-ops',
    run: async h => { await tab(h, 'pending_approval'); await h.highlight('.approve-return-btn'); },
  },
  {
    name: 'daily-ops-approve-return-window', login: 'admin', page: 'daily-ops', target: 'modal',
    run: async h => { await tall(h); await tab(h, 'pending_approval'); await clickNth(h, '.approve-return-btn'); },
  },
  {
    name: 'daily-ops-approve-return-classified', login: 'admin', page: 'daily-ops', target: 'modal',
    run: async h => { await tall(h);
      await tab(h, 'pending_approval');
      await clickNth(h, '.approve-return-btn');
      await setVal(h, '.ar-type', 'staff_shortage');
      await setVal(h, '.ar-note', 'Raj to pay for 1 Lavender refill');
    },
  },
  {
    name: 'daily-ops-approve-return-matching', login: SONAL, page: 'daily-ops', target: 'modal',
    run: async h => { await tall(h);
      await fillSonalMatching(h);
      await clickNth(h, '#ci-submit');
      await relogin(h, 'admin@narmadaessence.com', 'admin123');
      await h.go('daily-ops');
      await tab(h, 'pending_approval');
      await h.eval(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
      await h.eval(() => [...document.querySelectorAll('tr[data-session-id]')]
        .find(tr => tr.textContent.includes('Sonal')).querySelector('.approve-return-btn').click());
      await h.settle();
    },
  },
  {
    name: 'daily-ops-send-back-window', login: 'admin', page: 'daily-ops', target: 'modal',
    run: async h => {
      await tab(h, 'pending_approval');
      await clickNth(h, '.send-back-btn');
      await setVal(h, '#sb-reason', 'Lavender does not add up. Recount and enter where the 1 missing refill went.');
    },
  },

  // ---------- Details / history ----------
  {
    name: 'daily-ops-view-details-classified', login: 'admin', page: 'daily-ops', target: 'modal',
    run: async h => {
      await tab(h, 'checked_in');
      const id = await h.eval(() => {
        const store = JSON.parse(localStorage.getItem('narmada_essence_data'));
        const item = store.checkout_items.find(i => i.discrepancy_type === 'staff_shortage');
        return item.session_id;
      });
      await clickNth(h, `tr[data-session-id="${id}"] .view-btn`);
    },
  },
  {
    name: 'daily-ops-view-details-sent-back', login: IMRAN, page: 'daily-ops', target: 'modal',
    run: async h => {
      await tab(h, 'checked_in');
      const id = await h.eval(() => {
        const store = JSON.parse(localStorage.getItem('narmada_essence_data'));
        return store.checkout_sessions.find(s => (s.notes || '').includes('sent back')).id;
      });
      await clickNth(h, `tr[data-session-id="${id}"] .view-btn`);
    },
  },

  // ---------- Stock still out ----------
  { name: 'daily-ops-stock-still-out-alert', login: 'admin', page: 'dashboard', target: '#reconciliation-alerts' },
];

// The dashboard that opens after login can finish loading after we have moved
// to Daily Operations and replace it, so make sure we are really on the page.
async function ensureDailyOps(h) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await h.wait(500);
    const ok = await h.eval(() => !!document.querySelector('#btn-new-checkout') && !!document.querySelector('.tab-btn[data-tab="pending_issue"]'));
    if (ok) return;
    await h.go('daily-ops');
  }
  throw new Error('Daily Operations did not open');
}

export const shots = rawShots.map(shot => (shot.page !== 'daily-ops' ? shot : {
  ...shot,
  run: async h => { await ensureDailyOps(h); if (shot.run) await shot.run(h); },
}));
