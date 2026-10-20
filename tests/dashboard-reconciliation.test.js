// Dashboard stock-reconciliation alerts: returns awaiting discrepancy
// approval, stock still out from previous days, and pending stock
// adjustment requests. Each counts towards the ALERTS stat card.

import { describe, it, expect, beforeEach } from 'vitest';
import { db, auth } from '../js/supabase.js';
import { renderDashboard } from '../js/pages/dashboard.js';

function yesterdayNoon() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

async function issue(productId, quantity, sellerId = 'seller-1') {
  const { data: sessionId, error } = await db.rpc('admin_issue_stock', {
    p_seller_id: sellerId, p_items: [{ product_id: productId, quantity }], p_approver_id: 'admin-1',
  });
  expect(error).toBeNull();
  const { data: items } = await db.getAll('checkout_items');
  return { sessionId, itemId: items.find(i => i.session_id === sessionId).id };
}

async function submitReturn(sessionId, itemId, returned) {
  const { error } = await db.rpc('submit_return', {
    p_session_id: sessionId, p_items: [{ item_id: itemId, returned_quantity: returned, usage: [] }], p_notes: '', p_submitted_by: 'seller-1',
  });
  expect(error).toBeNull();
}

async function requestAdjustment(productId, newStock) {
  const { data, error } = await db.rpc('request_stock_adjustment', {
    p_product_id: productId, p_new_stock: newStock, p_reason: 'Recount', p_requested_by: 'admin-1',
  });
  expect(error).toBeNull();
  return data;
}

async function render() {
  await renderDashboard(document.getElementById('body'), document.getElementById('header'));
}

function alertsTotal() {
  const card = [...document.querySelectorAll('.stat-card')].find(c => c.querySelector('.stat-label')?.textContent === 'Alerts');
  return Number(card.querySelector('.stat-value').textContent);
}

describe('dashboard reconciliation alerts', () => {
  beforeEach(async () => {
    localStorage.clear();
    await auth.getSession(); // seeds the demo store
    const { data: profiles } = await db.getAll('profiles');
    auth.currentUser = profiles.find(p => p.role === 'admin');
    document.body.innerHTML = '<div id="header"></div><div id="body"></div>';
  });

  it('shows no reconciliation card when nothing needs review', async () => {
    await render();
    expect(document.getElementById('reconciliation-alerts')).toBeNull();
  });

  it('counts discrepancy returns, previous-day checkouts and pending adjustments, and adds them to ALERTS', async () => {
    await render();
    const baseline = alertsTotal();

    // Return with a shortage → pending_approval + has_discrepancy.
    const mismatch = await issue(7, 5);
    await submitReturn(mismatch.sessionId, mismatch.itemId, 3);
    // Matching return → pending, but no discrepancy.
    const matching = await issue(8, 2);
    await submitReturn(matching.sessionId, matching.itemId, 2);
    // Issued yesterday and still out; issued today and still out (not stale).
    const stale = await issue(9, 1, 'seller-2');
    await db.update('checkout_sessions', stale.sessionId, { checkout_time: yesterdayNoon() });
    await issue(11, 1, 'seller-2');
    // Two pending adjustment requests and one already rejected.
    await requestAdjustment(12, 20);
    await requestAdjustment(13, 10);
    const rejected = await requestAdjustment(14, 25);
    expect((await db.rpc('review_stock_adjustment', { p_adjustment_id: rejected, p_approve: false, p_note: 'No', p_reviewer_id: 'admin-1' })).error).toBeNull();

    await render();

    const discrepancy = document.getElementById('alert-discrepancy-returns');
    expect(discrepancy.dataset.count).toBe('1');
    expect(discrepancy.textContent).toContain('1 return awaiting discrepancy approval');
    expect(discrepancy.querySelector('button').getAttribute('onclick')).toContain("navigateTo('daily-ops')");

    const staleRow = document.getElementById('alert-stale-checkouts');
    expect(staleRow.dataset.count).toBe('1');
    expect(staleRow.textContent).toContain('Amit Shah');
    expect(staleRow.querySelector('button').getAttribute('onclick')).toContain("navigateTo('daily-ops')");

    const adjustments = document.getElementById('alert-pending-adjustments');
    expect(adjustments.dataset.count).toBe('2');
    expect(adjustments.textContent).toContain('2 stock adjustments awaiting approval');
    expect(adjustments.querySelector('button').getAttribute('onclick')).toContain("navigateTo('products')");

    // +2 pending returns (the discrepancy one is one of them, counted once),
    // +1 previous-day checkout, +2 pending adjustments.
    expect(alertsTotal()).toBe(baseline + 5);
  });
});
