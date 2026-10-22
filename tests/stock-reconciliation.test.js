// Contract tests for the stock reconciliation RPCs (migration 016):
// record_purchase, submit_return, approve_return (with resolutions),
// reject_return, request_stock_adjustment, review_stock_adjustment.
// Demo seed: product 1 = machine (Automatic Dispenser, 25 pcs),
// 7 = Black Touch Refill (40 pcs), 17 = Cool Water Diffuser Oil (liquid).

import { describe, it, expect, beforeEach } from 'vitest';
import { db, auth } from '../js/supabase.js';

async function freshStore() {
  localStorage.clear();
  await auth.getSession(); // triggers initStore()
}

async function product(id) {
  return (await db.getById('products', id)).data;
}

async function rows(table, filter = () => true) {
  return (await db.getAll(table)).data.filter(filter);
}

// Issue items to seller-1 immediately (stock deducted) and return the session.
async function issue(items) {
  const { data: sessionId, error } = await db.rpc('admin_issue_stock', {
    p_seller_id: 'seller-1', p_items: items, p_approver_id: 'admin-1',
  });
  expect(error).toBeNull();
  const sessionItems = await rows('checkout_items', i => i.session_id === sessionId);
  const itemFor = productId => sessionItems.find(i => i.product_id === productId);
  return { sessionId, itemFor };
}

function submit(sessionId, items, submittedBy = 'seller-1') {
  return db.rpc('submit_return', { p_session_id: sessionId, p_items: items, p_notes: '', p_submitted_by: submittedBy });
}

describe('record_purchase', () => {
  beforeEach(freshStore);

  it('adds stock and stores supplier, rate, total, bill and date', async () => {
    const { data: id, error } = await db.rpc('record_purchase', {
      p_product_id: 7, p_quantity: 10, p_purchase_rate: 180.5, p_supplier: ' Aroma Traders ',
      p_bill_number: 'B-77', p_purchase_date: '2026-10-19', p_notes: '', p_received_by: 'admin-1',
    });
    expect(error).toBeNull();
    expect((await product(7)).current_stock).toBe(50);
    const [intake] = await rows('stock_intakes', r => r.id === id);
    expect(intake).toMatchObject({ supplier: 'Aroma Traders', purchase_rate: 180.5, total_amount: 1805, bill_number: 'B-77', purchase_date: '2026-10-19' });
    const [txn] = await rows('inventory_transactions', t => t.reference_type === 'stock_intake' && t.reference_id === id);
    expect(txn).toMatchObject({ type: 'stock_in', quantity: 10, notes: 'Purchase from Aroma Traders (bill B-77)' });
  });

  it('requires a supplier and a non-negative rate', async () => {
    const base = { p_product_id: 7, p_quantity: 1, p_bill_number: null, p_purchase_date: null, p_notes: null, p_received_by: 'admin-1' };
    expect((await db.rpc('record_purchase', { ...base, p_purchase_rate: 10, p_supplier: '  ' })).error.message).toMatch(/Supplier/);
    expect((await db.rpc('record_purchase', { ...base, p_purchase_rate: -1, p_supplier: 'X' })).error.message).toMatch(/rate/);
    expect((await db.rpc('record_purchase', { ...base, p_purchase_rate: null, p_supplier: 'X' })).error.message).toMatch(/rate/);
    expect((await product(7)).current_stock).toBe(40);
  });

  it('is admin-only', async () => {
    const { error } = await db.rpc('record_purchase', {
      p_product_id: 7, p_quantity: 1, p_purchase_rate: 1, p_supplier: 'X', p_received_by: 'seller-1',
    });
    expect(error.message).toMatch(/Only admins/);
  });
});

describe('submit_return / approve_return cross-check', () => {
  beforeEach(freshStore);

  it('a matching return needs no classification and restores only the returned quantity', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 5 }]);
    expect((await product(7)).current_stock).toBe(35);

    const { data, error } = await submit(sessionId, [{
      item_id: itemFor(7).id, returned_quantity: 3,
      usage: [{ reason: 'customer_service', quantity: 2, party_id: 1 }],
    }]);
    expect(error).toBeNull();
    expect(data).toEqual({ has_discrepancy: false });
    const [item] = await rows('checkout_items', i => i.session_id === sessionId);
    expect(item).toMatchObject({ checkin_quantity: 3, used_quantity: 2, difference: 0, has_mismatch: false });

    expect((await db.rpc('approve_return', { p_session_id: sessionId, p_approver_id: 'admin-1' })).error).toBeNull();
    expect((await product(7)).current_stock).toBe(38);
    const [session] = await rows('checkout_sessions', s => s.id === sessionId);
    expect(session.status).toBe('checked_in');
  });

  it('flags a shortage and blocks approval until it is classified with a note', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 5 }]);
    const { data } = await submit(sessionId, [{ item_id: itemFor(7).id, returned_quantity: 2, usage: [{ reason: 'other', quantity: 1 }] }]);
    expect(data.has_discrepancy).toBe(true);
    const [item] = await rows('checkout_items', i => i.session_id === sessionId);
    expect(item).toMatchObject({ difference: 2, has_mismatch: true, is_flagged: true, flag_reason: 'Shortage of 2 pcs' });

    const blocked = await db.rpc('approve_return', { p_session_id: sessionId, p_approver_id: 'admin-1' });
    expect(blocked.error.message).toMatch(/Classify the difference/);
    const noNote = await db.rpc('approve_return', {
      p_session_id: sessionId, p_approver_id: 'admin-1',
      p_resolutions: [{ item_id: item.id, discrepancy_type: 'loss', note: ' ' }],
    });
    expect(noNote.error.message).toMatch(/Classify the difference/);
    expect((await product(7)).current_stock).toBe(35);

    const ok = await db.rpc('approve_return', {
      p_session_id: sessionId, p_approver_id: 'admin-1',
      p_resolutions: [{ item_id: item.id, discrepancy_type: 'staff_shortage', note: 'Raj to account for 2 refills' }],
    });
    expect(ok.error).toBeNull();
    expect((await product(7)).current_stock).toBe(37);
    const [resolved] = await rows('checkout_items', i => i.id === item.id);
    expect(resolved).toMatchObject({ discrepancy_type: 'staff_shortage', discrepancy_note: 'Raj to account for 2 refills' });
  });

  it('rejects a blank returned quantity instead of treating it as zero', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 2 }]);
    const { error } = await submit(sessionId, [{ item_id: itemFor(7).id, returned_quantity: null }]);
    expect(error.message).toMatch(/Invalid returned quantity/);
  });

  it('reports an excess return as a mismatch', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 2 }]);
    await submit(sessionId, [{ item_id: itemFor(7).id, returned_quantity: 3, usage: [] }]);
    const [item] = await rows('checkout_items', i => i.session_id === sessionId);
    expect(item).toMatchObject({ difference: -1, has_mismatch: true, flag_reason: 'Excess of 1 pcs' });
  });

  it('treats a liquid difference within 10 g as matching and beyond it as a mismatch', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 17, quantity: 1 }]);
    await submit(sessionId, [{ item_id: itemFor(17).id, returned_quantity: 0.5, usage: [{ reason: 'customer_service', quantity: 0.492 }] }]);
    let [item] = await rows('checkout_items', i => i.session_id === sessionId);
    expect(item.difference).toBe(0.008);
    expect(item.has_mismatch).toBe(false);

    const second = await issue([{ product_id: 17, quantity: 1 }]);
    await submit(second.sessionId, [{ item_id: second.itemFor(17).id, returned_quantity: 0.5, usage: [{ reason: 'customer_service', quantity: 0.48 }] }]);
    [item] = await rows('checkout_items', i => i.session_id === second.sessionId);
    expect(item.difference).toBe(0.02);
    expect(item.has_mismatch).toBe(true);
  });

  it('uses the tolerance from app_settings', async () => {
    const [unitTol] = await rows('app_settings', s => s.key === 'unit_tolerance');
    await db.update('app_settings', unitTol.id, { value: 1 });
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 5 }]);
    await submit(sessionId, [{ item_id: itemFor(7).id, returned_quantity: 4, usage: [] }]);
    const [item] = await rows('checkout_items', i => i.session_id === sessionId);
    expect(item.has_mismatch).toBe(false);
  });

  it('requires every issued item exactly once and only lets the staff member or an admin submit', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 2 }, { product_id: 8, quantity: 2 }]);
    expect((await submit(sessionId, [{ item_id: itemFor(7).id, returned_quantity: 2 }])).error.message).toMatch(/Every issued item/);
    const both = [{ item_id: itemFor(7).id, returned_quantity: 2 }, { item_id: itemFor(8).id, returned_quantity: 2 }];
    expect((await submit(sessionId, both, 'seller-2')).error.message).toMatch(/assigned staff member/);
    expect((await submit(sessionId, both, 'admin-1')).error).toBeNull();
  });

  it('records a machine installation: needs a customer, then moves the unit to Installed Qty and Installations', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 1, quantity: 2 }]);
    expect((await product(1)).current_stock).toBe(23);

    const noParty = await submit(sessionId, [{ item_id: itemFor(1).id, returned_quantity: 1, usage: [{ reason: 'installation', quantity: 1 }] }]);
    expect(noParty.error.message).toMatch(/Choose the customer/);

    const { error } = await submit(sessionId, [{ item_id: itemFor(1).id, returned_quantity: 1, usage: [{ reason: 'installation', quantity: 1, party_id: 2 }] }]);
    expect(error).toBeNull();
    expect((await db.rpc('approve_return', { p_session_id: sessionId, p_approver_id: 'admin-1' })).error).toBeNull();

    const machine = await product(1);
    expect(machine.current_stock).toBe(25); // Total Stock = all owned machines
    expect(machine.installed_qty).toBe(1);  // Current Stock = 25 − 1 = 24 in warehouse
    const installs = await rows('installations', r => r.product_id === 1);
    expect(installs).toHaveLength(1);
    expect(installs[0]).toMatchObject({ party_id: 2, quantity: 1, status: 'active' });
    const [txn] = await rows('inventory_transactions', t => t.type === 'installed');
    expect(txn).toMatchObject({ product_id: 1, quantity: 1, reference_id: sessionId });
  });

  it('does not create installations for consumables used at an installation', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 2 }]);
    await submit(sessionId, [{ item_id: itemFor(7).id, returned_quantity: 1, usage: [{ reason: 'installation', quantity: 1 }] }]);
    await db.rpc('approve_return', { p_session_id: sessionId, p_approver_id: 'admin-1' });
    expect(await rows('installations')).toHaveLength(0);
    expect((await product(7)).current_stock).toBe(39);
  });

  it('approves a legacy return (submitted before usage entry) without classification', async () => {
    const { data: session } = await db.insert('checkout_sessions', { seller_id: 'seller-1', status: 'pending_approval', checkout_time: new Date().toISOString() });
    await db.insert('checkout_items', { session_id: session.id, product_id: 7, checkout_quantity: 5, checkin_quantity: 4, is_flagged: false });
    await db.update('products', 7, { current_stock: 35 });
    expect((await db.rpc('approve_return', { p_session_id: session.id, p_approver_id: 'admin-1' })).error).toBeNull();
    expect((await product(7)).current_stock).toBe(39);
  });

  it('only admins can approve', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 1 }]);
    await submit(sessionId, [{ item_id: itemFor(7).id, returned_quantity: 1 }]);
    const { error } = await db.rpc('approve_return', { p_session_id: sessionId, p_approver_id: 'seller-1' });
    expect(error.message).toMatch(/Only admins/);
  });
});

describe('reject_return', () => {
  beforeEach(freshStore);

  it('sends the return back to the staff member with nothing lost', async () => {
    const { sessionId, itemFor } = await issue([{ product_id: 7, quantity: 5 }]);
    await submit(sessionId, [{ item_id: itemFor(7).id, returned_quantity: 1, usage: [{ reason: 'other', quantity: 1 }] }]);

    expect((await db.rpc('reject_return', { p_session_id: sessionId, p_reason: '', p_approver_id: 'admin-1' })).error.message).toMatch(/reason/);
    const { error } = await db.rpc('reject_return', { p_session_id: sessionId, p_reason: 'Recount the refills', p_approver_id: 'admin-1' });
    expect(error).toBeNull();

    const [session] = await rows('checkout_sessions', s => s.id === sessionId);
    expect(session).toMatchObject({ status: 'checked_out', checkin_time: null, has_discrepancy: false });
    expect(session.notes).toContain('Return sent back: Recount the refills');
    const [item] = await rows('checkout_items', i => i.session_id === sessionId);
    expect(item).toMatchObject({ checkin_quantity: null, used_quantity: null, has_mismatch: false });
    expect(await rows('checkout_usage', u => u.session_id === sessionId)).toHaveLength(0);
    expect((await product(7)).current_stock).toBe(35);

    // Can be resubmitted, and the send-back reason stays in the history.
    const { error: resubmitError } = await db.rpc('submit_return', {
      p_session_id: sessionId, p_items: [{ item_id: itemFor(7).id, returned_quantity: 5 }],
      p_notes: 'Recounted: all 5 back', p_submitted_by: 'seller-1',
    });
    expect(resubmitError).toBeNull();
    const [resubmitted] = await rows('checkout_sessions', s => s.id === sessionId);
    expect(resubmitted.notes).toBe('Return sent back: Recount the refills\nRecounted: all 5 back');
  });
});

describe('stock adjustment requests', () => {
  beforeEach(freshStore);

  const request = (newStock, reason = 'Physical count') => db.rpc('request_stock_adjustment', {
    p_product_id: 7, p_new_stock: newStock, p_reason: reason, p_requested_by: 'admin-1',
  });
  const review = (id, approve, note = null) => db.rpc('review_stock_adjustment', {
    p_adjustment_id: id, p_approve: approve, p_note: note, p_reviewer_id: 'admin-1',
  });

  it('does not change stock until approved, then applies the delta', async () => {
    const { data: id, error } = await request(36);
    expect(error).toBeNull();
    expect((await product(7)).current_stock).toBe(40);
    const [adj] = await rows('stock_adjustments', a => a.id === id);
    expect(adj).toMatchObject({ status: 'pending', stock_at_request: 40, requested_stock: 36, delta: -4 });

    expect((await review(id, true, 'Counted twice')).error).toBeNull();
    expect((await product(7)).current_stock).toBe(36);
    const [done] = await rows('stock_adjustments', a => a.id === id);
    expect(done).toMatchObject({ status: 'approved', reviewed_by: 'admin-1', review_note: 'Counted twice' });
    const [txn] = await rows('inventory_transactions', t => t.reference_type === 'stock_adjustment');
    expect(txn).toMatchObject({ type: 'adjustment', quantity: -4 });
  });

  it('keeps movements made between request and approval', async () => {
    const { data: id } = await request(45); // +5
    await issue([{ product_id: 7, quantity: 3 }]); // 40 → 37 meanwhile
    await review(id, true);
    expect((await product(7)).current_stock).toBe(42);
  });

  it('rejection leaves stock unchanged', async () => {
    const { data: id } = await request(10);
    expect((await review(id, false, 'Recount')).error).toBeNull();
    expect((await product(7)).current_stock).toBe(40);
    const [adj] = await rows('stock_adjustments', a => a.id === id);
    expect(adj.status).toBe('rejected');
    expect((await review(id, true)).error.message).toMatch(/not pending/);
  });

  it('validates the request', async () => {
    expect((await request(40)).error.message).toMatch(/same as current/);
    expect((await request(-1)).error.message).toMatch(/negative/);
    expect((await request(30, '')).error.message).toMatch(/reason/);
    await request(30);
    expect((await request(31)).error.message).toMatch(/pending adjustment/);
  });
});

describe('demo store upgrade', () => {
  it('adds the new tables and fragrance tags to a store saved by an older version', async () => {
    await freshStore();
    const raw = JSON.parse(localStorage.getItem('narmada_essence_data'));
    for (const t of ['checkout_usage', 'stock_adjustments', 'installations', 'app_settings']) {
      delete raw[t];
      delete raw._nextId[t];
    }
    raw.products.forEach(p => { delete p.fragrance; });
    raw.products.find(p => p.id === 13).name = 'Cool  Water   Refill'; // stray double spaces
    localStorage.setItem('narmada_essence_data', JSON.stringify(raw));

    await auth.getSession();
    expect((await rows('app_settings')).map(s => s.key).sort()).toEqual(['liquid_tolerance_kg', 'unit_tolerance']);
    expect((await product(7)).fragrance).toBe('Black Touch');
    expect((await product(17)).fragrance).toBe('Cool Water');
    expect((await product(13)).fragrance).toBe('Cool Water');
    expect((await product(1)).fragrance).toBeNull();
  });
});
