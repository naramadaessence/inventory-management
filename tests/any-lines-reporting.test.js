// Reporting and stock screens with "Any <category>" issue lines
// (knowledge-base/category-issue.md): an Any line counts once — as one
// "Any <Category>" row while out, as its per-product child rows after the
// return — and stock held by open Any lines is shown on Products/Dashboard.
// Demo seed: category 3 = Dispenser Refill (unit; products 7–16, 7 = Black
// Touch Refill, 9 = Lavender Refill, 15 = Rose Refill). seller-1 = Raj Patel.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, auth } from '../js/supabase.js';
import { renderReports } from '../js/pages/reports.js';
import { renderProducts } from '../js/pages/products.js';
import { renderDashboard } from '../js/pages/dashboard.js';

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

async function issueAny(quantity, { yesterday = true } = {}) {
  const { data: sessionId, error } = await db.rpc('admin_issue_stock', {
    p_seller_id: 'seller-1', p_items: [{ category_id: 3, quantity }], p_approver_id: 'admin-1',
  });
  expect(error).toBeNull();
  if (yesterday) await db.update('checkout_sessions', sessionId, { checkout_time: yesterdayNoon().toISOString() });
  const { data: items } = await db.getAll('checkout_items');
  return { sessionId, anyLine: items.find(i => i.session_id === sessionId) };
}

async function submit(sessionId, items) {
  const { error } = await db.rpc('submit_return', { p_session_id: sessionId, p_items: items, p_notes: '', p_submitted_by: 'seller-1' });
  expect(error).toBeNull();
}

async function approve(sessionId, resolutions = []) {
  const { error } = await db.rpc('approve_return', { p_session_id: sessionId, p_approver_id: 'admin-1', p_resolutions: resolutions });
  expect(error).toBeNull();
}

async function childOf(anyLineId, productId) {
  const { data } = await db.getAll('checkout_items');
  return data.find(i => i.parent_item_id === anyLineId && i.product_id === productId);
}

// Any 10 refills: 4 Black Touch used, 2 Lavender used, Rose 3 back + 1 lost.
const MIXED_RETURN = anyLine => [{
  item_id: anyLine.id,
  breakdown: [
    { product_id: 7, returned_quantity: 0, lost_quantity: 0, usage: [{ reason: 'customer_service', quantity: 4 }] },
    { product_id: 9, returned_quantity: 0, lost_quantity: 0, usage: [{ reason: 'customer_service', quantity: 2 }] },
    { product_id: 15, returned_quantity: 3, lost_quantity: 1, usage: [] },
  ],
}];

async function openReportTab(tab) {
  const body = document.getElementById('body');
  await renderReports(body, document.getElementById('header'));
  await vi.waitFor(() => expect(body.textContent).toContain('Total Revenue'));
  body.querySelector(`.tab-btn[data-tab="${tab}"]`).click();
  return body;
}

async function openLedger() {
  const body = await openReportTab('ledger');
  await vi.waitFor(() => expect(document.getElementById('ledger-body')).not.toBeNull());
  return body;
}

function ledgerRow(key) {
  return document.querySelector(`tr[data-ledger-row][data-staff="seller-1"][data-day="${DAY}"][data-key="${key}"]`);
}
const cell = (row, col) => row.querySelector(`td[data-col="${col}"]`);
const dayTotal = () => document.querySelector(`.ledger-staff[data-staff="seller-1"] tr.ledger-day-total[data-day="${DAY}"]`);

describe('reports with Any lines', () => {
  beforeEach(async () => {
    localStorage.clear();
    await auth.getSession(); // seeds the demo store
    const { data: profiles } = await db.getAll('profiles');
    auth.currentUser = profiles.find(p => p.role === 'admin');
    document.querySelectorAll('.modal-overlay, .toast').forEach(el => el.remove());
    document.body.innerHTML = '<div id="header"></div><div id="body"></div>';
  });

  afterEach(() => vi.restoreAllMocks());

  it('ledger shows an Any line still in the field as one "Any <Category>" row', async () => {
    await issueAny(10);
    await openLedger();
    const row = ledgerRow('c:3');
    expect(row.textContent).toContain('Any Dispenser Refill');
    expect(cell(row, 'issued').dataset.value).toBe('10');
    expect(cell(row, 'returned').textContent).toBe('—');
    expect(row.dataset.status).toBe('in_field');
    expect(cell(dayTotal(), 'issued').textContent).toBe('10 pcs');

    // Fragrance-wise: it has no fragrance, so it keeps its own row.
    document.getElementById('ledger-group-fragrance').click();
    expect(ledgerRow('c:3')).not.toBeNull();

    // A fragrance filter excludes it.
    const filter = document.getElementById('ledger-fragrance');
    filter.value = 'Rose';
    filter.dispatchEvent(new Event('change'));
    expect(ledgerRow('c:3')).toBeNull();
  });

  it('ledger counts a returned Any line once, as its product rows, with the lost piece as a mismatch', async () => {
    const { sessionId, anyLine } = await issueAny(10);
    await submit(sessionId, MIXED_RETURN(anyLine));

    await openLedger();
    expect(ledgerRow('c:3')).toBeNull();
    const blackTouch = ledgerRow('p:7');
    expect(cell(blackTouch, 'issued').dataset.value).toBe('4');
    expect(cell(blackTouch, 'used').dataset.value).toBe('4');
    expect(cell(blackTouch, 'difference').dataset.value).toBe('0');

    const rose = ledgerRow('p:15');
    expect(cell(rose, 'issued').dataset.value).toBe('4');
    expect(cell(rose, 'returned').dataset.value).toBe('3');
    expect(cell(rose, 'used').dataset.value).toBe('0');
    expect(cell(rose, 'difference').dataset.value).toBe('1');
    expect(rose.dataset.status).toBe('awaiting');
    expect(rose.textContent).toContain('Awaiting approval · Shortage');
    expect(rose.classList.contains('ledger-mismatch')).toBe(true);

    // Never counted twice: the day still adds up to the 10 issued.
    expect(cell(dayTotal(), 'issued').textContent).toBe('10 pcs');
    expect(cell(dayTotal(), 'returned').textContent).toBe('3 pcs');
    expect(cell(dayTotal(), 'used').textContent).toBe('6 pcs');
    expect(document.getElementById('ledger-mismatch-count').textContent).toBe('1');
  });

  it('ledger keeps pieces that came back without a type as one "Any" row (migration 019)', async () => {
    const { sessionId, anyLine } = await issueAny(10);
    await submit(sessionId, [{ item_id: anyLine.id, returned_quantity: 8, breakdown: [{ product_id: 15, lost_quantity: 2, usage: [] }] }]);

    await openLedger();
    const anyRow = ledgerRow('c:3');
    expect(anyRow.textContent).toContain('Any Dispenser Refill');
    expect([cell(anyRow, 'issued').dataset.value, cell(anyRow, 'returned').dataset.value, cell(anyRow, 'difference').dataset.value]).toEqual(['8', '8', '0']);
    const rose = ledgerRow('p:15');
    expect([cell(rose, 'issued').dataset.value, cell(rose, 'returned').dataset.value, cell(rose, 'difference').dataset.value]).toEqual(['2', '0', '2']);
    // Still adds up to the 10 issued, nothing counted twice.
    expect(cell(dayTotal(), 'issued').textContent).toBe('10 pcs');
    expect(cell(dayTotal(), 'returned').textContent).toBe('8 pcs');
  });

  it('ledger shows the resolution of a lost Any piece after approval', async () => {
    const { sessionId, anyLine } = await issueAny(10);
    await submit(sessionId, MIXED_RETURN(anyLine));
    const rose = await childOf(anyLine.id, 15);
    await approve(sessionId, [{ item_id: rose.id, discrepancy_type: 'loss', note: 'Dropped at site' }]);

    await openLedger();
    expect(ledgerRow('c:3')).toBeNull();
    const row = ledgerRow('p:15');
    expect(cell(row, 'difference').dataset.value).toBe('1');
    expect(row.dataset.status).toBe('resolved');
    expect(row.textContent).toContain('Resolved: Lost');
    expect(cell(dayTotal(), 'issued').textContent).toBe('10 pcs');
    expect(document.getElementById('ledger-mismatch-count').textContent).toBe('0');
  });

  it('ledger usage breakdown shows a bill from field stock as "Sold (bill)"', async () => {
    const { sessionId, anyLine } = await issueAny(5);
    const { error } = await db.rpc('record_sale', {
      p_party_id: 1, p_items: [{ product_id: 7, quantity: 2, unit_price: 450 }], p_payment_status: 'paid', p_payment_method: 'cash',
      p_amount_received: 0, p_expected_payment_date: null, p_sale_date: DAY, p_notes: '',
      p_recorded_by: 'seller-1', p_sale_type: 'gst', p_checkout_session_id: sessionId,
    });
    expect(error).toBeNull();
    await submit(sessionId, [{ item_id: anyLine.id, breakdown: [{ product_id: 8, returned_quantity: 3, lost_quantity: 0, usage: [] }] }]);

    await openLedger();
    const sold = ledgerRow('p:7');
    expect(cell(sold, 'issued').dataset.value).toBe('2');
    expect(cell(sold, 'used').dataset.value).toBe('2');
    expect(cell(sold, 'used').textContent).toContain('Sold (bill): 2 pcs');
    expect(cell(sold, 'difference').dataset.value).toBe('0');
    expect(cell(ledgerRow('p:8'), 'returned').dataset.value).toBe('3');
  });

  it('seller performance counts a returned Any line once', async () => {
    const { sessionId, anyLine } = await issueAny(10);
    await submit(sessionId, MIXED_RETURN(anyLine));

    const body = await openReportTab('sellers');
    await vi.waitFor(() => expect(body.textContent).toContain('Items Handled'));
    const row = [...body.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('Raj Patel'));
    const cells = row.querySelectorAll('td');
    expect(cells[1].textContent).toBe('1'); // sessions
    expect(cells[2].textContent).toBe('3'); // items: 3 products named, not the Any line too
    expect(cells[4].textContent).toBe('1'); // mismatches: the lost Rose Refill
    expect(cells[5].textContent).toBe('1 pcs'); // shortage
  });
});

describe('stock held by open Any lines', () => {
  beforeEach(async () => {
    localStorage.clear();
    await auth.getSession();
    const { data: profiles } = await db.getAll('profiles');
    auth.currentUser = profiles.find(p => p.role === 'admin');
    document.querySelectorAll('.modal-overlay, .toast').forEach(el => el.remove());
    document.body.innerHTML = '<div id="header"></div><div id="body"></div>';
  });

  async function refillStock() {
    const { data } = await db.getAll('products');
    return data.filter(p => p.category_id === 3).reduce((s, p) => s + Number(p.current_stock || 0), 0);
  }

  it('products page shows no held notice when nothing is out as Any', async () => {
    await renderProducts(document.getElementById('body'), document.getElementById('header'));
    expect(document.getElementById('category-holds-notice')).toBeNull();
  });

  it('products page shows stock held per category and the category free stock', async () => {
    const total = await refillStock();
    await issueAny(10, { yesterday: false });
    await renderProducts(document.getElementById('body'), document.getElementById('header'));

    const notice = document.getElementById('category-holds-notice');
    expect(notice.textContent).toContain('Out with staff as Any (pieces not returned are named on the return)');
    const hold = notice.querySelector('.category-hold[data-category-id="3"]');
    expect(hold.textContent).toContain('Dispenser Refill — 10 pcs out');
    expect(hold.textContent).toContain(`${total - 10} pcs free on shelf`);

    // Product stock is unchanged by the hold.
    expect(await refillStock()).toBe(total);

    const catFilter = document.getElementById('product-filter-cat');
    catFilter.value = '3';
    catFilter.dispatchEvent(new Event('change'));
    expect(document.getElementById('category-hold-chip').textContent).toContain('Any Dispenser Refill: 10 pcs out');
  });

  it('dashboard shows stock out as Any as an info line, not an alert', async () => {
    await renderDashboard(document.getElementById('body'), document.getElementById('header'));
    expect(document.getElementById('alert-category-holds')).toBeNull();
    const alertsCard = () => [...document.querySelectorAll('.stat-card')].find(c => c.querySelector('.stat-label')?.textContent === 'Alerts');
    const baseline = Number(alertsCard().querySelector('.stat-value').textContent);

    await issueAny(10, { yesterday: false });
    await renderDashboard(document.getElementById('body'), document.getElementById('header'));
    const row = document.getElementById('alert-category-holds');
    expect(row.textContent).toContain('10 pcs Dispenser Refill out with staff as Any');
    expect(row.textContent).toContain('named on the return');
    expect(document.getElementById('reconciliation-alerts').textContent).not.toContain('to review');
    expect(Number(alertsCard().querySelector('.stat-value').textContent)).toBe(baseline);
  });
});
