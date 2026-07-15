// Tests for the demoRpc business-logic layer in js/supabase.js.
//
// These tests exercise the same call shape (db.rpc('name', { params }))
// that production uses, so they validate both demo-mode behavior AND the
// interface contract that the production Postgres functions must satisfy.
//
// Strategy:
//   - Each test runs in a fresh localStorage (cleared in beforeEach).
//   - We trigger initStore() by calling auth.getSession(), which populates
//     the demo dataset (3 sellers, 5 categories, 22 products, 3 parties).
//   - All assertions go through the public db API (db.getAll, db.rpc).

import { describe, it, expect, beforeEach } from 'vitest';
import { db, auth } from '../js/supabase.js';

// Convenience helpers used across tests.
async function freshStore() {
  localStorage.clear();
  await auth.getSession(); // triggers initStore()
}

async function getProduct(id) {
  const { data } = await db.getById('products', id);
  return data;
}

async function getStockChangeTxns(productId) {
  const { data } = await db.getAll('inventory_transactions');
  return data.filter(t => t.product_id === productId);
}

describe('demoRpc.record_sale', () => {
  beforeEach(freshStore);

  it('inserts a sale + sale_items + deducts stock + logs a transaction', async () => {
    const before = await getProduct(7); // Black Touch Refill, 40 in stock
    expect(before.current_stock).toBe(40);

    const { data: saleId, error } = await db.rpc('record_sale', {
      p_party_id: 1,
      p_items: [{ product_id: 7, quantity: 3, unit_price: 450 }],
      p_payment_status: 'paid',
      p_payment_method: 'cash',
      p_amount_received: 1350,
      p_expected_payment_date: null,
      p_sale_date: '2026-05-14',
      p_notes: 'test sale',
      p_recorded_by: 'admin-1',
    });

    expect(error).toBeNull();
    expect(saleId).toBeGreaterThan(0);

    const { data: sales } = await db.getAll('sales');
    expect(sales).toHaveLength(1);
    expect(sales[0].total_amount).toBe(1350);
    expect(sales[0].payment_status).toBe('paid');

    const { data: items } = await db.getAll('sale_items');
    expect(items).toHaveLength(1);
    expect(items[0].sale_id).toBe(saleId);
    expect(items[0].quantity).toBe(3);

    const after = await getProduct(7);
    expect(after.current_stock).toBe(37);

    const txns = await getStockChangeTxns(7);
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe('sale');
    expect(txns[0].quantity).toBe(-3);
    expect(txns[0].reference_id).toBe(saleId);
  });

  it('rejects a sale with insufficient stock and leaves no orphan rows', async () => {
    // Product 10 (Green Apple Refill) has stock = 3.
    const before = await getProduct(10);
    expect(before.current_stock).toBe(3);

    const { data, error } = await db.rpc('record_sale', {
      p_party_id: 1,
      p_items: [{ product_id: 10, quantity: 100, unit_price: 450 }],
      p_payment_status: 'paid',
      p_payment_method: 'cash',
      p_amount_received: 45000,
      p_expected_payment_date: null,
      p_sale_date: '2026-05-14',
      p_notes: '',
      p_recorded_by: 'admin-1',
    });

    expect(error).not.toBeNull();
    expect(error.message).toMatch(/insufficient stock/i);
    expect(data).toBeNull();

    // Atomicity: stock unchanged, no orphan sale or sale_item.
    const after = await getProduct(10);
    expect(after.current_stock).toBe(3);
    const { data: sales } = await db.getAll('sales');
    const { data: items } = await db.getAll('sale_items');
    expect(sales).toHaveLength(0);
    expect(items).toHaveLength(0);
  });

  it('rejects invalid item and payment shapes before writing rows', async () => {
    const invalidCalls = [
      {
        p_items: [],
        p_payment_status: 'paid',
        p_amount_received: 0,
      },
      {
        p_items: [{ product_id: 7, quantity: -1, unit_price: 450 }],
        p_payment_status: 'paid',
        p_amount_received: 0,
      },
      {
        p_items: [{ product_id: 7, quantity: 1, unit_price: 450 }],
        p_payment_status: 'partial',
        p_amount_received: 500,
      },
    ];

    for (const call of invalidCalls) {
      const { error } = await db.rpc('record_sale', {
        p_party_id: 1,
        p_payment_method: 'cash',
        p_expected_payment_date: null,
        p_sale_date: '2026-05-14',
        p_notes: '',
        p_recorded_by: 'admin-1',
        ...call,
      });
      expect(error).not.toBeNull();
    }

    const { data: sales } = await db.getAll('sales');
    const { data: items } = await db.getAll('sale_items');
    expect(sales).toHaveLength(0);
    expect(items).toHaveLength(0);
    expect((await getProduct(7)).current_stock).toBe(40);
  });

  it('multi-item sale deducts each line item from stock', async () => {
    const { data: saleId } = await db.rpc('record_sale', {
      p_party_id: 1,
      p_items: [
        { product_id: 7, quantity: 2, unit_price: 450 },
        { product_id: 8, quantity: 1, unit_price: 450 },
      ],
      p_payment_status: 'paid',
      p_payment_method: 'cash',
      p_amount_received: 1350,
      p_expected_payment_date: null,
      p_sale_date: '2026-05-14',
      p_notes: '',
      p_recorded_by: 'admin-1',
    });

    expect(saleId).toBeGreaterThan(0);

    const p7 = await getProduct(7);
    const p8 = await getProduct(8);
    expect(p7.current_stock).toBe(38); // 40 - 2
    expect(p8.current_stock).toBe(34); // 35 - 1

    const { data: items } = await db.getAll('sale_items');
    expect(items).toHaveLength(2);
  });
});

describe('demoRpc.adjust_stock', () => {
  beforeEach(freshStore);

  it('returns new stock value on positive delta', async () => {
    const { data, error } = await db.rpc('adjust_stock', { p_product_id: 7, p_delta: 10 });
    expect(error).toBeNull();
    expect(data).toBe(50); // 40 + 10
  });

  it('raises on negative result instead of silently going negative', async () => {
    // Product 10 has stock = 3.
    const { data, error } = await db.rpc('adjust_stock', { p_product_id: 10, p_delta: -100 });
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/insufficient stock/i);
    expect(data).toBeNull();

    const after = await getProduct(10);
    expect(after.current_stock).toBe(3); // unchanged
  });
});

describe('demoRpc.approve_issue / approve_return', () => {
  beforeEach(freshStore);

  it('approve_issue deducts stock and flips status to checked_out', async () => {
    // Set up a pending_issue session manually via db.insert.
    const { data: session } = await db.insert('checkout_sessions', {
      seller_id: 'seller-1',
      checkout_time: new Date().toISOString(),
      checkin_time: null,
      status: 'pending_issue',
      notes: '',
    });
    await db.insert('checkout_items', {
      session_id: session.id,
      product_id: 7,
      checkout_quantity: 4,
      checkin_quantity: null,
      is_flagged: false,
      flag_reason: null,
    });

    const { error } = await db.rpc('approve_issue', {
      p_session_id: session.id,
      p_approver_id: 'admin-1',
    });
    expect(error).toBeNull();

    const after = await getProduct(7);
    expect(after.current_stock).toBe(36); // 40 - 4

    const { data: updatedSession } = await db.getById('checkout_sessions', session.id);
    expect(updatedSession.status).toBe('checked_out');
    expect(updatedSession.approved_by).toBe('admin-1');

    const txns = await getStockChangeTxns(7);
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe('checkout');
    expect(txns[0].quantity).toBe(-4);
  });

  it('approve_return restores stock and flips status to checked_in', async () => {
    // Set up a pending_approval session with checkin_quantity set.
    const { data: session } = await db.insert('checkout_sessions', {
      seller_id: 'seller-1',
      checkout_time: new Date().toISOString(),
      checkin_time: new Date().toISOString(),
      status: 'pending_approval',
      notes: '',
    });
    await db.insert('checkout_items', {
      session_id: session.id,
      product_id: 7,
      checkout_quantity: 5,
      checkin_quantity: 3, // 2 consumed
      is_flagged: false,
      flag_reason: null,
    });
    // Manually pre-deduct stock as if approve_issue had run.
    await db.update('products', 7, { current_stock: 35 }); // 40 - 5

    const { error } = await db.rpc('approve_return', {
      p_session_id: session.id,
      p_approver_id: 'admin-1',
    });
    expect(error).toBeNull();

    const after = await getProduct(7);
    expect(after.current_stock).toBe(38); // 35 + 3 returned

    const { data: updatedSession } = await db.getById('checkout_sessions', session.id);
    expect(updatedSession.status).toBe('checked_in');

    const txns = await getStockChangeTxns(7);
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe('checkin');
    expect(txns[0].quantity).toBe(3);
  });

  it('approve_issue raises on insufficient stock and leaves session unchanged', async () => {
    const { data: session } = await db.insert('checkout_sessions', {
      seller_id: 'seller-1',
      checkout_time: new Date().toISOString(),
      checkin_time: null,
      status: 'pending_issue',
      notes: '',
    });
    // Product 10 has stock = 3; ask for 100.
    await db.insert('checkout_items', {
      session_id: session.id,
      product_id: 10,
      checkout_quantity: 100,
      checkin_quantity: null,
      is_flagged: false,
      flag_reason: null,
    });

    const { error } = await db.rpc('approve_issue', {
      p_session_id: session.id,
      p_approver_id: 'admin-1',
    });
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/insufficient stock/i);

    const after = await getProduct(10);
    expect(after.current_stock).toBe(3); // unchanged
  });
});

describe('demoRpc.update_sale', () => {
  beforeEach(freshStore);

  it('replaces bill items, rebalances stock, and keeps the same sale id', async () => {
    const { data: saleId } = await db.rpc('record_sale', {
      p_party_id: 1,
      p_items: [
        { product_id: 7, quantity: 2, unit_price: 450 },
        { product_id: 8, quantity: 1, unit_price: 450 },
      ],
      p_payment_status: 'paid',
      p_payment_method: 'cash',
      p_amount_received: 1350,
      p_expected_payment_date: null,
      p_sale_date: '2026-05-14',
      p_notes: '',
      p_recorded_by: 'admin-1',
    });

    expect((await getProduct(7)).current_stock).toBe(38);
    expect((await getProduct(8)).current_stock).toBe(34);

    const { error } = await db.rpc('update_sale', {
      p_sale_id: saleId,
      p_party_id: 2,
      p_items: [
        { product_id: 7, quantity: 1, unit_price: 500 },
        { product_id: 9, quantity: 4, unit_price: 450 },
      ],
      p_payment_status: 'partial',
      p_payment_method: 'upi',
      p_amount_received: 500,
      p_expected_payment_date: '2026-05-20',
      p_sale_date: '2026-05-15',
      p_notes: 'edited bill',
      p_performer_id: 'admin-1',
    });

    expect(error).toBeNull();

    const { data: sale } = await db.getById('sales', saleId);
    expect(sale.party_id).toBe(2);
    expect(sale.total_amount).toBe(2300);
    expect(sale.payment_status).toBe('partial');
    expect(sale.amount_received).toBe(500);
    expect(sale.notes).toBe('edited bill');

    const { data: items } = await db.getAll('sale_items');
    const editedItems = items.filter(i => i.sale_id === saleId);
    expect(editedItems).toHaveLength(2);
    expect(editedItems.map(i => i.product_id).sort()).toEqual([7, 9]);

    expect((await getProduct(7)).current_stock).toBe(39); // old 2 restored, new 1 deducted
    expect((await getProduct(8)).current_stock).toBe(35); // old 1 restored
    expect((await getProduct(9)).current_stock).toBe(26); // 30 - 4

    const { data: txns } = await db.getAll('inventory_transactions');
    expect(txns.filter(t => t.type === 'sale_edit_restore')).toHaveLength(2);
    expect(txns.filter(t => t.type === 'sale_edit')).toHaveLength(2);
  });

  it('rejects an edit with insufficient stock and leaves the old bill untouched', async () => {
    const { data: saleId } = await db.rpc('record_sale', {
      p_party_id: 1,
      p_items: [{ product_id: 10, quantity: 1, unit_price: 450 }],
      p_payment_status: 'paid',
      p_payment_method: 'cash',
      p_amount_received: 450,
      p_expected_payment_date: null,
      p_sale_date: '2026-05-14',
      p_notes: '',
      p_recorded_by: 'admin-1',
    });

    expect((await getProduct(10)).current_stock).toBe(2);

    const { error } = await db.rpc('update_sale', {
      p_sale_id: saleId,
      p_party_id: 1,
      p_items: [{ product_id: 10, quantity: 10, unit_price: 450 }],
      p_payment_status: 'paid',
      p_payment_method: 'cash',
      p_amount_received: 4500,
      p_expected_payment_date: null,
      p_sale_date: '2026-05-14',
      p_notes: 'bad edit',
      p_performer_id: 'admin-1',
    });

    expect(error).not.toBeNull();
    expect(error.message).toMatch(/insufficient stock/i);
    expect((await getProduct(10)).current_stock).toBe(2);

    const { data: sale } = await db.getById('sales', saleId);
    expect(sale.total_amount).toBe(450);
    expect(sale.notes).toBe('');
    const { data: items } = await db.getAll('sale_items');
    const originalItems = items.filter(i => i.sale_id === saleId);
    expect(originalItems).toHaveLength(1);
    expect(originalItems[0].quantity).toBe(1);
  });
});

describe('demoRpc.delete_sale', () => {
  beforeEach(freshStore);

  it('cascades sale_items, restores stock, logs a sale_delete txn', async () => {
    // Record a sale first.
    const { data: saleId } = await db.rpc('record_sale', {
      p_party_id: 1,
      p_items: [
        { product_id: 7, quantity: 2, unit_price: 450 },
        { product_id: 8, quantity: 3, unit_price: 450 },
      ],
      p_payment_status: 'paid',
      p_payment_method: 'cash',
      p_amount_received: 2250,
      p_expected_payment_date: null,
      p_sale_date: '2026-05-14',
      p_notes: '',
      p_recorded_by: 'admin-1',
    });

    expect((await getProduct(7)).current_stock).toBe(38);
    expect((await getProduct(8)).current_stock).toBe(32);

    // Now delete it.
    const { error } = await db.rpc('delete_sale', {
      p_sale_id: saleId,
      p_performer_id: 'admin-1',
    });
    expect(error).toBeNull();

    // Sale gone, sale_items cascaded.
    const { data: salesAfter } = await db.getAll('sales');
    expect(salesAfter).toHaveLength(0);
    const { data: itemsAfter } = await db.getAll('sale_items');
    expect(itemsAfter).toHaveLength(0);

    // Stock restored to original seed values.
    expect((await getProduct(7)).current_stock).toBe(40);
    expect((await getProduct(8)).current_stock).toBe(35);

    // Two sale_delete txns logged (one per restored item).
    const { data: allTxns } = await db.getAll('inventory_transactions');
    const restoreTxns = allTxns.filter(t => t.type === 'sale_delete');
    expect(restoreTxns).toHaveLength(2);
    expect(restoreTxns.every(t => t.quantity > 0)).toBe(true);
  });

  it('detaches payment followups before deleting the sale', async () => {
    const { data: saleId } = await db.rpc('record_sale', {
      p_party_id: 1,
      p_items: [{ product_id: 7, quantity: 2, unit_price: 450 }],
      p_payment_status: 'partial',
      p_payment_method: 'cash',
      p_amount_received: 100,
      p_expected_payment_date: '2026-05-20',
      p_sale_date: '2026-05-14',
      p_notes: '',
      p_recorded_by: 'admin-1',
    });

    const { error: followupError } = await db.rpc('record_payment_followup', {
      p_sale_id: saleId,
      p_party_id: 1,
      p_status_update: 'partial',
      p_payment_method: 'cash',
      p_amount_collected: 200,
      p_expected_payment_date: '2026-05-21',
      p_notes: 'partial collection',
      p_visited_by: 'admin-1',
    });
    expect(followupError).toBeNull();

    const { error } = await db.rpc('delete_sale', {
      p_sale_id: saleId,
      p_performer_id: 'admin-1',
    });
    expect(error).toBeNull();

    const { data: followups } = await db.getAll('payment_followups');
    expect(followups).toHaveLength(1);
    expect(followups[0].sale_id).toBeNull();
  });
});

describe('demoRpc.record_payment_followup', () => {
  beforeEach(freshStore);

  it('updates sale payment fields and inserts the followup atomically', async () => {
    const { data: saleId } = await db.rpc('record_sale', {
      p_party_id: 1,
      p_items: [{ product_id: 7, quantity: 2, unit_price: 450 }],
      p_payment_status: 'pending',
      p_payment_method: null,
      p_amount_received: 0,
      p_expected_payment_date: '2026-05-20',
      p_sale_date: '2026-05-14',
      p_notes: '',
      p_recorded_by: 'seller-1',
    });

    const { error } = await db.rpc('record_payment_followup', {
      p_sale_id: saleId,
      p_party_id: 1,
      p_status_update: 'partial',
      p_payment_method: 'upi',
      p_amount_collected: 300,
      p_expected_payment_date: '2026-05-25',
      p_notes: 'collected part payment',
      p_visited_by: 'seller-1',
    });
    expect(error).toBeNull();

    const { data: sale } = await db.getById('sales', saleId);
    expect(sale.amount_received).toBe(300);
    expect(sale.payment_status).toBe('partial');
    expect(sale.payment_method).toBe('upi');

    const { data: followups } = await db.getAll('payment_followups');
    expect(followups).toHaveLength(1);
    expect(followups[0].amount_collected).toBe(300);
  });

  it('rejects over-collection and paid status without full balance', async () => {
    const { data: saleId } = await db.rpc('record_sale', {
      p_party_id: 1,
      p_items: [{ product_id: 7, quantity: 1, unit_price: 450 }],
      p_payment_status: 'pending',
      p_payment_method: null,
      p_amount_received: 0,
      p_expected_payment_date: null,
      p_sale_date: '2026-05-14',
      p_notes: '',
      p_recorded_by: 'seller-1',
    });

    const overpay = await db.rpc('record_payment_followup', {
      p_sale_id: saleId,
      p_party_id: 1,
      p_status_update: 'partial',
      p_payment_method: 'cash',
      p_amount_collected: 500,
      p_expected_payment_date: null,
      p_notes: 'too much',
      p_visited_by: 'seller-1',
    });
    expect(overpay.error).not.toBeNull();

    const fakePaid = await db.rpc('record_payment_followup', {
      p_sale_id: saleId,
      p_party_id: 1,
      p_status_update: 'paid',
      p_payment_method: 'cash',
      p_amount_collected: 100,
      p_expected_payment_date: null,
      p_notes: 'not full',
      p_visited_by: 'seller-1',
    });
    expect(fakePaid.error).not.toBeNull();

    const { data: sale } = await db.getById('sales', saleId);
    const { data: followups } = await db.getAll('payment_followups');
    expect(sale.amount_received).toBe(0);
    expect(sale.payment_status).toBe('pending');
    expect(followups).toHaveLength(0);
  });

  it('rejects a followup party that does not match the linked sale party', async () => {
    const { data: saleId } = await db.rpc('record_sale', {
      p_party_id: 1,
      p_items: [{ product_id: 7, quantity: 1, unit_price: 450 }],
      p_payment_status: 'pending',
      p_payment_method: null,
      p_amount_received: 0,
      p_expected_payment_date: null,
      p_sale_date: '2026-05-14',
      p_notes: '',
      p_recorded_by: 'seller-1',
    });

    const mismatch = await db.rpc('record_payment_followup', {
      p_sale_id: saleId,
      p_party_id: 2,
      p_status_update: 'partial',
      p_payment_method: 'cash',
      p_amount_collected: 100,
      p_expected_payment_date: null,
      p_notes: 'wrong party',
      p_visited_by: 'seller-1',
    });
    expect(mismatch.error).not.toBeNull();

    const { data: sale } = await db.getById('sales', saleId);
    const { data: followups } = await db.getAll('payment_followups');
    expect(sale.amount_received).toBe(0);
    expect(followups).toHaveLength(0);
  });
});

describe('demoRpc stock workflow RPCs', () => {
  beforeEach(freshStore);

  it('records stock intake with a matching stock_in transaction', async () => {
    const { error } = await db.rpc('record_stock_intake', {
      p_product_id: 7,
      p_quantity: 5,
      p_supplier: 'test supplier',
      p_notes: 'new stock',
      p_received_by: 'admin-1',
    });
    expect(error).toBeNull();
    expect((await getProduct(7)).current_stock).toBe(45);
    const txns = await getStockChangeTxns(7);
    expect(txns.some(t => t.type === 'stock_in' && t.quantity === 5)).toBe(true);
  });

  it('rejects damage/loss that exceeds stock without persisting report or transaction', async () => {
    const { error } = await db.rpc('record_damage_loss', {
      p_product_id: 10,
      p_damage_type: 'lost',
      p_quantity: 10,
      p_reason: 'bad count',
      p_report_date: '2026-05-14',
      p_reported_by: 'admin-1',
    });
    expect(error).not.toBeNull();
    expect((await getProduct(10)).current_stock).toBe(3);
    const { data: reports } = await db.getAll('damage_reports');
    expect(reports).toHaveLength(0);
    const txns = await getStockChangeTxns(10);
    expect(txns).toHaveLength(0);
  });

  it('creates and returns rentals through atomic stock/audit updates', async () => {
    const { data: rentalId, error } = await db.rpc('create_rental', {
      p_product_id: 1,
      p_party_id: 1,
      p_quantity: 2,
      p_rental_date: '2026-05-14',
      p_expected_return_date: '2026-05-20',
      p_rent_amount: 1000,
      p_notes: 'test rental',
      p_performer_id: 'admin-1',
    });
    expect(error).toBeNull();
    expect((await getProduct(1)).current_stock).toBe(23);

    const returned = await db.rpc('return_rental', {
      p_rental_id: rentalId,
      p_performer_id: 'admin-1',
    });
    expect(returned.error).toBeNull();
    expect((await getProduct(1)).current_stock).toBe(25);

    const txns = await getStockChangeTxns(1);
    expect(txns.map(t => t.type)).toEqual(['rental_out', 'rental_return']);
  });

  it('issues admin checkout stock in one call', async () => {
    const { data: sessionId, error } = await db.rpc('admin_issue_stock', {
      p_seller_id: 'seller-1',
      p_items: [
        { product_id: 7, quantity: 2 },
        { product_id: 8, quantity: 1 },
      ],
      p_approver_id: 'admin-1',
    });
    expect(error).toBeNull();
    expect(sessionId).toBeGreaterThan(0);
    expect((await getProduct(7)).current_stock).toBe(38);
    expect((await getProduct(8)).current_stock).toBe(34);

    const { data: sessions } = await db.getAll('checkout_sessions');
    const { data: items } = await db.getAll('checkout_items');
    expect(sessions[0].status).toBe('checked_out');
    expect(items.filter(i => i.session_id === sessionId)).toHaveLength(2);
  });

  it('sets product stock via adjustment transaction', async () => {
    const { error } = await db.rpc('set_product_stock', {
      p_product_id: 7,
      p_new_stock: 42,
      p_performer_id: 'admin-1',
      p_notes: 'count correction',
    });
    expect(error).toBeNull();
    expect((await getProduct(7)).current_stock).toBe(42);
    const txns = await getStockChangeTxns(7);
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe('adjustment');
    expect(txns[0].quantity).toBe(2);
  });

  it('supports sell_qty and installed_qty fields on product creation and update', async () => {
    // Check initial seed values
    const p1 = await getProduct(1);
    expect(p1.sell_qty).toBe(0);
    expect(p1.installed_qty).toBe(0);

    // Insert new product with custom sell_qty and installed_qty
    const { data: created, error: insertErr } = await db.insert('products', {
      name: 'Test Dispenser With Qty',
      category_id: 1,
      type: 'unit',
      model_number: 'TST-001',
      unit_price: 1500,
      current_stock: 0,
      min_stock_threshold: 5,
      sell_qty: 12.5,
      installed_qty: 8,
      is_active: true
    });
    expect(insertErr).toBeNull();
    expect(created.sell_qty).toBe(12.5);
    expect(created.installed_qty).toBe(8);

    // Update product quantities
    const { data: updated, error: updateErr } = await db.update('products', created.id, {
      sell_qty: 25,
      installed_qty: 15
    });
    expect(updateErr).toBeNull();
    expect(updated.sell_qty).toBe(25);
    expect(updated.installed_qty).toBe(15);
  });
});

