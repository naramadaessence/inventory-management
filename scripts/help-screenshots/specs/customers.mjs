// Screenshots for the "Parties, Installations & Rentals" help section (js/help/sections/customers.js).
// Run: node shoot.mjs specs/customers.mjs [--only name1,name2]

const TALL = { width: 1366, height: 1500, deviceScaleFactor: 1 };

// Click through the DOM (not by coordinates), after removing any message that could cover the target.
// Click a button until the window it opens shows the given field (the page may still be wiring up its buttons).
async function openWindow(h, buttonSel, readySel) {
  for (let i = 0; i < 20; i++) {
    const ready = await h.eval((b, r) => {
      if (document.querySelector(r)) return true;
      document.querySelectorAll('.toast').forEach(t => t.remove());
      document.querySelector(b)?.click();
      return false;
    }, buttonSel, readySel);
    if (ready) { await h.settle(); return; }
    await h.wait(300);
  }
  throw new Error(`openWindow: ${buttonSel} did not open ${readySel}`);
}

// Draw an amber outline on the element itself (stays in place even if the page scrolls).
async function mark(h, selector) {
  await h.page.waitForSelector(selector, { timeout: 8000 });
  await h.eval((sel) => {
    const el = document.querySelector(sel);
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    Object.assign(el.style, { outline: '3px solid #d97706', outlineOffset: '4px', boxShadow: '0 0 0 8px rgba(217,119,6,0.22)', borderRadius: '8px' });
  }, selector);
  await h.wait(300);
}

async function tap(h, selector) {
  await h.page.waitForSelector(selector, { timeout: 8000 });
  await h.eval((sel) => {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    document.querySelector(sel).click();
  }, selector);
  await h.settle();
}

// Click the pencil button on the Parties row whose name matches.
async function openPartyEdit(h, name) {
  const ok = await h.eval((name) => {
    const row = [...document.querySelectorAll('#party-table-container tbody tr')]
      .find(tr => tr.querySelector('td strong')?.textContent.trim() === name);
    const btn = row?.querySelector('.edit-party-btn');
    if (!btn) return false;
    btn.click();
    return true;
  }, name);
  if (!ok) throw new Error(`no edit button for party ${name}`);
  await h.page.waitForSelector('.modal-overlay .modal', { visible: true });
  await h.settle();
}

// Tick a category in the "Category-wise Fixed Rates" list and type the rate / machine qty.
async function setCategory(h, categoryId, { rate, qty } = {}) {
  if (rate !== undefined) {
    const checked = await h.eval((cid) => document.querySelector(`.cat-toggle[data-cid="${cid}"]`).checked, categoryId);
    if (!checked) await h.page.click(`.cat-toggle[data-cid="${categoryId}"]`);
    await h.type(`.cat-rate-input[data-cid="${categoryId}"]`, rate);
  }
  if (qty !== undefined) await h.type(`.machine-qty-input[data-cid="${categoryId}"]`, qty);
}

// Give an element a temporary id so it can be used as a screenshot target.
async function tag(h, id, finder) {
  const ok = await h.eval(new Function('id', `
    const el = (${finder})();
    if (!el) return false;
    el.id = id;
    return true;
  `), id);
  if (!ok) throw new Error(`tag: nothing found for ${id}`);
}

// Card on the dashboard whose header contains the given text.
const cardWithTitle = (text) => `() => [...document.querySelectorAll('#page-body .card')].find(c => c.querySelector('.card-header')?.textContent.includes(${JSON.stringify(text)}))`;

// As admin: set AMC so that one party is due today and one in two days.
async function scheduleRefills(h) {
  const today = await h.eval(() => new Date().getDate());
  const soon = await h.eval(() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.getMonth() === new Date().getMonth() ? d.getDate() : null; });
  await h.go('parties');
  await openPartyEdit(h, 'Fern Spa & Salon');
  await h.select('#party-amc-day', today);
  await tap(h, '#party-save');
  if (soon) {
    await openPartyEdit(h, 'Hotel Rivera');
    await h.select('#party-amc-day', soon);
    await tap(h, '#party-save');
  }
}

async function relogin(h, email, password) {
  await h.eval(() => document.getElementById('btn-logout').click());
  await h.page.waitForSelector('#login-form', { visible: true });
  await h.type('#login-email', email);
  await h.type('#login-password', password);
  await h.page.click('#login-btn');
  await h.page.waitForSelector('#sidebar-nav .nav-item', { timeout: 15000 });
  await h.eval(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await h.settle();
}

async function fillNewParty(h, { admin = true } = {}) {
  await h.wait(500);
  await h.eval(() => document.getElementById('btn-add-party').click());
  await h.page.waitForSelector('#party-name', { visible: true });
  await h.type('#party-name', 'Royal Orchid Banquets');
  await h.type('#party-phone', '9898300155');
  await h.type('#party-address', 'Piplod, Surat');
  await h.type('#party-notes', 'Two halls. Ask for Mr. Shah at reception.');
  if (!admin) return;
  await h.page.click('input[name="machine-type"][value="free_to_use"]');
  await h.type('#party-amc-rate', '2000');
  await h.page.click('#party-amc-active');
  await h.select('#party-amc-day', '5');
  await setCategory(h, 1, { qty: 2 });
  await setCategory(h, 3, { rate: 420 });
  await h.wait(200);
}

const acceptDialogs = (h) => h.page.on('dialog', d => d.accept());

export const shots = [
  // ---------------- Parties ----------------
  {
    name: 'parties-add-party-button',
    login: 'admin',
    page: 'parties',
    run: async (h) => { await mark(h, '#btn-add-party'); },
  },
  {
    name: 'parties-add-party-form',
    login: 'admin',
    page: 'parties',
    run: async (h) => {
      await h.page.setViewport(TALL);
      await fillNewParty(h);
      await h.eval(() => { const b = document.querySelector('.modal-body'); if (b) b.scrollTop = 0; });
    },
    target: 'modal',
  },
  {
    name: 'parties-add-party-result',
    login: 'admin',
    page: 'parties',
    run: async (h) => {
      await fillNewParty(h);
      await tap(h, '#party-save');
      await h.type('#pf-search', 'Royal');
      await h.settle();
    },
    target: '#party-table-container',
  },
  {
    name: 'parties-add-party-seller-mobile',
    login: 'kunal@narmadaessence.com',
    page: 'parties',
    mobile: true,
    run: async (h) => {
      // The wide party table stretches the phone layout; hide it behind the window so the form shows at phone width.
      await h.eval(() => { document.getElementById('party-table-container').style.display = 'none'; });
      await h.wait(300);
      await fillNewParty(h, { admin: false });
    },
    target: 'modal',
  },
  {
    name: 'parties-edit-button',
    login: 'admin',
    page: 'parties',
    run: async (h) => {
      await h.eval(() => {
        const row = [...document.querySelectorAll('#party-table-container tbody tr')]
          .find(tr => tr.querySelector('td strong')?.textContent.trim() === 'Hotel Grand Bhagwati');
        row.querySelector('.edit-party-btn').id = 'help-edit-target';
      });
      await mark(h, '#help-edit-target');
    },
  },
  {
    name: 'parties-edit-machine-amc',
    login: 'admin',
    page: 'parties',
    run: async (h) => {
      await h.page.setViewport(TALL);
      await openPartyEdit(h, 'Fern Spa & Salon');
      await tag(h, 'help-amc-box', `() => document.getElementById('party-amc-rate')?.closest('.modal-body > div')`);
    },
    target: '#help-amc-box',
  },
  {
    name: 'parties-edit-machine-type',
    login: 'admin',
    page: 'parties',
    run: async (h) => {
      await h.page.setViewport(TALL);
      await openPartyEdit(h, 'Fern Spa & Salon');
      await tag(h, 'help-machine-box', `() => document.querySelector('input[name="machine-type"]')?.closest('.modal-body > div')`);
    },
    target: '#help-machine-box',
  },
  {
    name: 'parties-custom-rates-section',
    login: 'admin',
    page: 'parties',
    run: async (h) => {
      await h.page.setViewport(TALL);
      await openPartyEdit(h, 'Hotel Grand Bhagwati');
      await setCategory(h, 3, { rate: 420 });
      await setCategory(h, 4, { rate: 2600 });
      await tag(h, 'help-rates-box', `() => document.querySelector('.cat-toggle')?.closest('.modal-body > div')`);
    },
    target: '#help-rates-box',
  },
  {
    name: 'parties-custom-rate-in-bill',
    login: 'admin',
    page: 'parties',
    run: async (h) => {
      await h.page.setViewport(TALL);
      await openPartyEdit(h, 'Hotel Grand Bhagwati');
      await setCategory(h, 3, { rate: 420 });
      await tap(h, '#party-save');
      await h.go('sales');
      await h.wait(1200);
      await tap(h, '#btn-new-sale');
      await h.page.waitForSelector('#sale-party-input', { visible: true });
      await h.page.click('#sale-party-input');
      await h.clickText('Hotel Grand Bhagwati', '.party-opt');
      await h.select('#add-item-product', '7');
      await h.wait(200);
      await mark(h, '#add-item-price');
    },
    target: 'modal',
  },
  {
    name: 'parties-search-filters',
    login: 'admin',
    page: 'parties',
    run: async (h) => {
      await h.select('#pf-amc', 'active');
      await h.wait(200);
    },
  },
  {
    name: 'parties-refill-worklist-admin',
    login: 'admin',
    run: async (h) => {
      await scheduleRefills(h);
      await h.go('dashboard');
      await tag(h, 'help-refill-cards', `() => {
        const today = (${cardWithTitle("Today's AMC Refill Worklist")})();
        const up = (${cardWithTitle('Upcoming Refills')})();
        if (!today) return null;
        const wrap = document.createElement('div');
        wrap.style.padding = '4px';
        today.parentNode.insertBefore(wrap, today);
        wrap.appendChild(today);
        if (up) wrap.appendChild(up);
        return wrap;
      }`);
    },
    target: '#help-refill-cards',
  },
  {
    name: 'parties-refill-seller-mobile',
    login: 'admin',
    mobile: true,
    run: async (h) => {
      await scheduleRefills(h);
      await relogin(h, 'kunal@narmadaessence.com', 'seller123');
      await h.go('dashboard');
    },
  },

  // ---------------- Installations ----------------
  {
    name: 'installations-overview-page',
    login: 'admin',
    page: 'installations',
    run: async (h) => { await mark(h, '#btn-add-install'); },
  },
  {
    name: 'installations-add-installation-form',
    login: 'admin',
    page: 'installations',
    run: async (h) => {
      await h.click('#btn-add-install');
      await h.selectText('#inst-party', 'Orbit Co-working');
      await h.selectText('#inst-product', 'NE 002');
      await h.type('#inst-qty', '2');
      await h.type('#inst-notes', 'Conference room A and B. Serial NE2-4471, NE2-4472.');
    },
    target: 'modal',
  },
  {
    name: 'installations-add-installation-result',
    login: 'admin',
    page: 'installations',
    run: async (h) => {
      await h.click('#btn-add-install');
      await h.selectText('#inst-party', 'Orbit Co-working');
      await h.selectText('#inst-product', 'NE 002');
      await h.type('#inst-qty', '2');
      await h.type('#inst-notes', 'Conference room A and B. Serial NE2-4471, NE2-4472.');
      await tap(h, '#inst-save');
    },
  },
  {
    name: 'installations-edit-form',
    login: 'admin',
    page: 'installations',
    run: async (h) => {
      await h.click('.edit-install');
    },
    target: 'modal',
  },
  {
    name: 'installations-remove-button',
    login: 'admin',
    page: 'installations',
    run: async (h) => {
      await mark(h, '.remove-install');
    },
  },
  {
    name: 'installations-removed-filter',
    login: 'admin',
    page: 'installations',
    run: async (h) => {
      acceptDialogs(h);
      await h.click('.remove-install');
      await h.wait(400);
      await h.settle();
      await h.select('#filter-status', 'removed');
    },
  },

  // ---------------- Rentals ----------------
  {
    name: 'rentals-overview-page',
    login: 'admin',
    page: 'rentals',
    run: async (h) => { await mark(h, '#btn-new-rental'); },
  },
  {
    name: 'rentals-add-rental-form',
    login: 'admin',
    page: 'rentals',
    run: async (h) => {
      await tap(h, '#btn-new-rental');
      await h.selectText('#rent-product', 'NE 001');
      await h.selectText('#rent-party', 'City Pulse Mall');
      await h.type('#rent-qty', '2');
      await h.type('#rent-amount', '1500');
      const ret = await h.eval(() => { const d = new Date(); d.setMonth(d.getMonth() + 3); return d.toISOString().split('T')[0]; });
      await h.eval((v) => { document.getElementById('rent-return').value = v; }, ret);
      await h.type('#rent-notes', 'Diwali exhibition, ground floor atrium.');
    },
    target: 'modal',
  },
  {
    name: 'rentals-active-list',
    login: 'admin',
    page: 'rentals',
    run: async (h) => {
      // One rental that is still running and one that is past its expected return date.
      const addRental = async (product, party, qty, amount, rentDaysAgo, returnInDays) => {
        await openWindow(h, '#btn-new-rental', '#rent-product');
        await h.selectText('#rent-product', product);
        await h.selectText('#rent-party', party);
        await h.type('#rent-qty', qty);
        await h.type('#rent-amount', amount);
        await h.eval((a, b) => {
          const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };
          document.getElementById('rent-date').value = iso(-a);
          document.getElementById('rent-return').value = iso(b);
        }, rentDaysAgo, returnInDays);
        await tap(h, '#rent-save');
        await h.page.waitForFunction(() => !document.querySelector('.modal-overlay'), { timeout: 8000 });
        await h.wait(500);
      };
      await addRental('NE 001', 'City Pulse Mall', 2, 1500, 0, 90);
      await addRental('NE 002', 'Sahara Darbar', 1, 1200, 20, -3);
      await mark(h, '.return-btn');
    },
  },
  {
    name: 'rentals-returned',
    login: 'admin',
    page: 'rentals',
    run: async (h) => {
      acceptDialogs(h);
      await tap(h, '#btn-new-rental');
      await h.selectText('#rent-product', 'NE 001');
      await h.selectText('#rent-party', 'City Pulse Mall');
      await h.type('#rent-qty', '2');
      await h.type('#rent-amount', '1500');
      await tap(h, '#rent-save');
      await h.click('.return-btn');
      await h.wait(400);
      await h.settle();
    },
  },
];
