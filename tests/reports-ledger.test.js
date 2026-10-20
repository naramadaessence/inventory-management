// Reports → Staff Daily Ledger: per staff, per day, per product / fragrance
// Issued, Returned, Used and Difference (= Issued − Returned − Used).
// Data is created through the public demo RPCs, then the page is rendered.
// Demo seed: 7 = Black Touch Refill (40 pcs), 8 = Pleasure Refill (35 pcs),
// 17 = Cool Water Diffuser Oil (liquid). seller-1 = Raj Patel, seller-2 = Amit Shah.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, auth } from '../js/supabase.js';
import { renderReports } from '../js/pages/reports.js';

// Yesterday at noon local time: always inside the default "Last 30 Days"
// range, whatever the time zone or time of day the suite runs at.
function yesterdayNoon() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d;
}
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const DAY = localISO(yesterdayNoon());

async function issue(items, sellerId = 'seller-1') {
  const { data: sessionId, error } = await db.rpc('admin_issue_stock', { p_seller_id: sellerId, p_items: items, p_approver_id: 'admin-1' });
  expect(error).toBeNull();
  await db.update('checkout_sessions', sessionId, { checkout_time: yesterdayNoon().toISOString() });
  const { data: all } = await db.getAll('checkout_items');
  const itemFor = productId => all.find(i => i.session_id === sessionId && i.product_id === productId);
  return { sessionId, itemFor };
}

async function submit(sessionId, items, by = 'seller-1') {
  const { error } = await db.rpc('submit_return', { p_session_id: sessionId, p_items: items, p_notes: '', p_submitted_by: by });
  expect(error).toBeNull();
}

async function approve(sessionId, resolutions = []) {
  const { error } = await db.rpc('approve_return', { p_session_id: sessionId, p_approver_id: 'admin-1', p_resolutions: resolutions });
  expect(error).toBeNull();
}

async function openLedger() {
  const body = document.getElementById('body');
  await renderReports(body, document.getElementById('header'));
  await vi.waitFor(() => expect(body.textContent).toContain('Total Revenue'));
  body.querySelector('.tab-btn[data-tab="ledger"]').click();
  await vi.waitFor(() => expect(document.getElementById('ledger-body')).not.toBeNull());
  return body;
}

function ledgerRow(staffId, key) {
  return document.querySelector(`tr[data-ledger-row][data-staff="${staffId}"][data-day="${DAY}"][data-key="${key}"]`);
}

function cell(row, col) {
  return row.querySelector(`td[data-col="${col}"]`);
}

describe('Staff Daily Ledger', () => {
  beforeEach(async () => {
    localStorage.clear();
    await auth.getSession(); // seeds the demo store
    const { data: profiles } = await db.getAll('profiles');
    auth.currentUser = profiles.find(p => p.role === 'admin');
    document.body.innerHTML = '<div id="header"></div><div id="body"></div>';
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows Issued, Returned, Used (by reason) and Difference per product for a staff member', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 10 }, { product_id: 17, quantity: 2 }]);
    await submit(sessionId, [
      { item_id: itemFor(7).id, returned_quantity: 6, usage: [{ reason: 'customer_service', quantity: 3 }] },
      { item_id: itemFor(17).id, returned_quantity: 1.5, usage: [{ reason: 'other', quantity: 0.5 }] },
    ]);
    await approve(sessionId, [{ item_id: itemFor(7).id, discrepancy_type: 'staff_shortage', note: 'Raj lost one' }]);

    await openLedger();
    const refill = ledgerRow('seller-1', 'p:7');
    expect(cell(refill, 'issued').dataset.value).toBe('10');
    expect(cell(refill, 'returned').dataset.value).toBe('6');
    expect(cell(refill, 'used').dataset.value).toBe('3');
    expect(cell(refill, 'difference').dataset.value).toBe('1');
    expect(cell(refill, 'difference').textContent).toContain('1 pcs short');
    expect(cell(refill, 'used').textContent).toContain('Customer service: 3 pcs');
    expect(refill.dataset.status).toBe('resolved');
    expect(refill.textContent).toContain('Resolved: Staff shortage');
    expect(refill.classList.contains('ledger-mismatch')).toBe(true);

    const oil = ledgerRow('seller-1', 'p:17');
    expect(cell(oil, 'difference').dataset.value).toBe('0');
    expect(oil.dataset.status).toBe('matching');
    expect(oil.classList.contains('ledger-mismatch')).toBe(false);

    // Day subtotal keeps pcs and kg apart.
    const dayTotal = document.querySelector(`.ledger-staff[data-staff="seller-1"] tr.ledger-day-total[data-day="${DAY}"]`);
    expect(cell(dayTotal, 'issued').textContent).toContain('10 pcs');
    expect(cell(dayTotal, 'issued').textContent).toContain('2.000 kg');
    expect(document.querySelector('.ledger-staff[data-staff="seller-1"] tr.ledger-staff-total')).not.toBeNull();
  });

  it('marks an unresolved mismatch awaiting approval and a session still in the field', async () => {
    const pending = await issue([{ product_id: 7, quantity: 5 }]);
    await submit(pending.sessionId, [{ item_id: pending.itemFor(7).id, returned_quantity: 2, usage: [] }]);
    await issue([{ product_id: 8, quantity: 4 }]); // never returned

    await openLedger();
    const awaiting = ledgerRow('seller-1', 'p:7');
    expect(awaiting.dataset.status).toBe('awaiting');
    expect(awaiting.textContent).toContain('Awaiting approval · Shortage');
    expect(awaiting.classList.contains('ledger-mismatch')).toBe(true);

    const inField = ledgerRow('seller-1', 'p:8');
    expect(inField.dataset.status).toBe('in_field');
    expect(cell(inField, 'returned').textContent).toBe('—');
    expect(document.getElementById('ledger-mismatch-count').textContent).toBe('1');
  });

  it('fragrance-wise grouping sums products that share a fragrance', async () => {
    await db.update('products', 8, { fragrance: 'Black Touch' }); // same fragrance as product 7
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 4 }, { product_id: 8, quantity: 6 }]);
    await submit(sessionId, [
      { item_id: itemFor(7).id, returned_quantity: 3, usage: [{ reason: 'customer_service', quantity: 1 }] },
      { item_id: itemFor(8).id, returned_quantity: 5, usage: [{ reason: 'customer_service', quantity: 1 }] },
    ]);
    await approve(sessionId);

    await openLedger();
    expect(ledgerRow('seller-1', 'p:7')).not.toBeNull();
    expect(ledgerRow('seller-1', 'p:8')).not.toBeNull();

    document.getElementById('ledger-group-fragrance').click();
    expect(ledgerRow('seller-1', 'p:7')).toBeNull();
    const row = ledgerRow('seller-1', 'f:black touch:unit');
    expect(row.textContent).toContain('Black Touch');
    expect(cell(row, 'issued').dataset.value).toBe('10');
    expect(cell(row, 'returned').dataset.value).toBe('8');
    expect(cell(row, 'used').dataset.value).toBe('2');
    expect(cell(row, 'difference').dataset.value).toBe('0');
    expect(row.dataset.status).toBe('matching');
  });

  it('shows Used and Difference as "—" for a legacy return and never counts it as a mismatch', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 5 }]);
    // A return approved before migration 016: checkin set, no usage fields.
    await db.update('checkout_items', itemFor(7).id, { checkin_quantity: 2 });
    await db.update('checkout_sessions', sessionId, { status: 'checked_in' });

    await openLedger();
    const row = ledgerRow('seller-1', 'p:7');
    expect(cell(row, 'returned').dataset.value).toBe('2');
    expect(cell(row, 'used').textContent).toBe('—');
    expect(cell(row, 'difference').textContent).toBe('—');
    expect(row.dataset.status).toBe('legacy');
    expect(row.classList.contains('ledger-mismatch')).toBe(false);
    expect(document.getElementById('ledger-mismatch-count').textContent).toBe('0');
  });

  it('filters by staff member and exports the visible rows as CSV', async () => {
    await issue([{ product_id: 7, quantity: 1 }], 'seller-1');
    await issue([{ product_id: 8, quantity: 2 }], 'seller-2');

    await openLedger();
    const staffSelect = document.getElementById('ledger-staff');
    staffSelect.value = 'seller-2';
    staffSelect.dispatchEvent(new Event('change'));
    expect(document.querySelector('.ledger-staff[data-staff="seller-1"]')).toBeNull();
    expect(ledgerRow('seller-2', 'p:8')).not.toBeNull();

    let blob;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(b => { blob = b; return 'blob:ledger'; });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    document.getElementById('ledger-export').click();
    const csv = await blob.text();
    expect(csv).toContain('"Staff","Date"');
    expect(csv).toContain(`"Amit Shah","${DAY}","Pleasure Refill"`);
    expect(csv).not.toContain('Raj Patel');
  });
});
