// Contract tests for "Any <category>" issue lines and bills from field stock
// (migration 018, knowledge-base/category-issue.md).
// Demo seed: category 3 = Dispenser Refill (unit; products 7–16, 7 = Black
// Touch 40 pcs, 8 = Pleasure 35, 9 = Lavender 30, 15 = Rose 15),
// category 1 = Automatic Dispenser (machines 1–4), category 4 = Diffuser Oil (liquid).

import { describe, it, expect, beforeEach } from 'vitest';
import { db, auth } from '../js/supabase.js';

async function freshStore() {
  localStorage.clear();
  await auth.getSession(); // triggers initStore()
}

async function stockOf(id) {
  return Number((await db.getById('products', id)).data.current_stock);
}

async function rows(table, filter = () => true) {
  return (await db.getAll(table)).data.filter(filter);
}

async function issue(items, seller = 'seller-1') {
  const { data: sessionId, error } = await db.rpc('admin_issue_stock', {
    p_seller_id: seller, p_items: items, p_approver_id: 'admin-1',
  });
  expect(error).toBeNull();
  const lines = await rows('checkout_items', i => i.session_id === sessionId);
  return { sessionId, lines };
}

function submit(sessionId, items, submittedBy = 'seller-1') {
  return db.rpc('submit_return', { p_session_id: sessionId, p_items: items, p_notes: '', p_submitted_by: submittedBy });
}

function approve(sessionId, resolutions = []) {
  return db.rpc('approve_return', { p_session_id: sessionId, p_approver_id: 'admin-1', p_resolutions: resolutions });
}

function fieldSale(sessionId, items, recordedBy = 'seller-1') {
  return db.rpc('record_sale', {
    p_party_id: 1, p_items: items, p_payment_status: 'paid', p_payment_method: 'cash',
    p_amount_received: 0, p_expected_payment_date: null, p_sale_date: '2026-11-19', p_notes: '',
    p_recorded_by: recordedBy, p_sale_type: 'gst', p_checkout_session_id: sessionId,
  });
}

function editSale(saleId, items, status = 'paid', received = 0) {
  return db.rpc('update_sale', {
    p_sale_id: saleId, p_party_id: 1, p_items: items, p_payment_status: status, p_payment_method: 'cash',
    p_amount_received: received, p_expected_payment_date: null, p_sale_date: '2026-11-19', p_notes: 'edited',
    p_performer_id: 'admin-1', p_sale_type: 'gst',
  });
}

function deleteSale(saleId) {
  return db.rpc('delete_sale', { p_sale_id: saleId, p_performer_id: 'admin-1' });
}

function reject(sessionId, reason) {
  return db.rpc('reject_return', { p_session_id: sessionId, p_reason: reason, p_approver_id: 'admin-1' });
}

async function holds() {
  return (await db.rpc('get_category_holds', {})).data.sort((a, b) => a.category_id - b.category_id);
}

// A seller's "Request Stock": a pending_issue session with lines inserted directly.
async function request(lines, seller = 'seller-2') {
  const { data: session } = await db.insert('checkout_sessions', {
    seller_id: seller, status: 'pending_issue', checkout_time: new Date().toISOString(), notes: '',
  });
  for (const l of lines) {
    await db.insert('checkout_items', {
      session_id: session.id, product_id: l.product_id ?? null, category_id: l.category_id ?? null,
      parent_item_id: null, checkout_quantity: l.quantity, checkin_quantity: null,
    });
  }
  return session.id;
}

async function children(sessionId) {
  return (await rows('checkout_items', i => i.session_id === sessionId && i.parent_item_id != null))
    .map(c => [c.product_id, c.checkout_quantity, c.checkin_quantity, c.used_quantity, c.difference, c.has_mismatch]);
}

async function soldUsage(sessionId) {
  const items = await rows('checkout_items', i => i.session_id === sessionId);
  return (await rows('checkout_usage', u => u.session_id === sessionId && u.reason === 'sold'))
    .map(u => [u.product_id, u.quantity, u.sale_id, items.find(i => i.id === u.item_id)?.parent_item_id != null]);
}

async function sessionTxns(sessionId) {
  return (await rows('inventory_transactions', t => t.reference_type === 'checkout_session' && t.reference_id === sessionId))
    .map(t => [t.product_id, t.type, t.quantity]);
}

describe('Any category issue → return → approve', () => {
  beforeEach(freshStore);

  it('holds stock at issue and takes it off the named products on approval', async () => {
    const before = { 7: await stockOf(7), 9: await stockOf(9), 15: await stockOf(15) };
    const { sessionId, lines } = await issue([{ category_id: 3, quantity: 10 }]);
    expect(lines).toHaveLength(1);
    expect(lines[0].product_id).toBeNull();
    expect(await stockOf(7)).toBe(before[7]);
    expect((await db.rpc('get_category_holds', {})).data).toEqual([{ category_id: 3, held: 10 }]);

    const { error } = await submit(sessionId, [{
      item_id: lines[0].id,
      breakdown: [
        { product_id: 7, returned_quantity: 0, lost_quantity: 0, usage: [{ reason: 'customer_service', quantity: 4, party_id: 1 }] },
        { product_id: 9, returned_quantity: 0, lost_quantity: 0, usage: [{ reason: 'customer_service', quantity: 2 }] },
        { product_id: 15, returned_quantity: 3, lost_quantity: 1, usage: [] },
      ],
    }]);
    expect(error).toBeNull();
    const children = await rows('checkout_items', i => i.parent_item_id === lines[0].id);
    expect(children.map(c => [c.product_id, c.checkout_quantity, c.checkin_quantity, c.difference])).toEqual([
      [7, 4, 0, 0], [9, 2, 0, 0], [15, 4, 3, 1],
    ]);
    const rose = children.find(c => c.product_id === 15);
    expect(rose.has_mismatch).toBe(true);

    expect((await approve(sessionId)).error).toBeTruthy(); // lost piece needs a classification
    const { error: approveError } = await approve(sessionId, [{ item_id: rose.id, discrepancy_type: 'loss', note: 'Dropped at site' }]);
    expect(approveError).toBeNull();
    expect(await stockOf(7)).toBe(before[7] - 4);
    expect(await stockOf(9)).toBe(before[9] - 2);
    expect(await stockOf(15)).toBe(before[15] - 1);
    expect((await db.rpc('get_category_holds', {})).data).toEqual([]);
  });

  it('refuses a return that does not account for every piece', async () => {
    const { sessionId, lines } = await issue([{ category_id: 3, quantity: 10 }]);
    const { error } = await submit(sessionId, [{
      item_id: lines[0].id,
      breakdown: [{ product_id: 7, returned_quantity: 9, lost_quantity: 0, usage: [] }],
    }]);
    expect(error?.message).toMatch(/10 issued but 9 accounted/);
  });

  it('a field bill moves no stock and appears as Sold on the return', async () => {
    const before7 = await stockOf(7);
    const { sessionId, lines } = await issue([{ category_id: 3, quantity: 5 }]);
    const { error: saleError } = await fieldSale(sessionId, [{ product_id: 7, quantity: 2, unit_price: 450 }]);
    expect(saleError).toBeNull();
    expect(await stockOf(7)).toBe(before7);

    expect((await fieldSale(sessionId, [{ product_id: 8, quantity: 4, unit_price: 450 }])).error?.message).toMatch(/only 5 were issued/);

    const { error } = await submit(sessionId, [{
      item_id: lines[0].id,
      breakdown: [{ product_id: 8, returned_quantity: 3, lost_quantity: 0, usage: [] }],
    }]);
    expect(error).toBeNull();
    const sold = await rows('checkout_usage', u => u.session_id === sessionId && u.reason === 'sold');
    expect(sold).toHaveLength(1);
    expect(sold[0]).toMatchObject({ product_id: 7, quantity: 2 });
    expect((await approve(sessionId)).error).toBeNull();
    expect(await stockOf(7)).toBe(before7 - 2);
  });
});

// The scenarios below are the same ones the PGlite check of migration 018 runs
// against Postgres (demo seed numbers here), so demo and SQL stay in step.

// Session for seller-1: Black Touch x2, Any Dispenser Refill 10, Any Diffuser
// Oil 0.5. Bills: A = 7 x1 (own line), B = 8 x3 by an admin, edited to
// 8 x2 + Rose 15 x1 (both from Any), C = 7 x2 (1 own line + 1 from Any).
async function fieldScenario() {
  const { sessionId, lines } = await issue([
    { product_id: 7, quantity: 2 }, { category_id: 3, quantity: 10 }, { category_id: 4, quantity: 0.5 },
  ]);
  const saleA = (await fieldSale(sessionId, [{ product_id: 7, quantity: 1, unit_price: 450 }])).data;
  const saleB = (await fieldSale(sessionId, [{ product_id: 8, quantity: 3, unit_price: 450 }], 'admin-1')).data;
  expect((await editSale(saleB, [{ product_id: 8, quantity: 2, unit_price: 450 }, { product_id: 15, quantity: 1, unit_price: 450 }])).error).toBeNull();
  const saleC = (await fieldSale(sessionId, [{ product_id: 7, quantity: 2, unit_price: 450 }])).data;
  const [l7, lAny, lOil] = lines;
  // rose = Rose pieces returned; 2 accounts for all 10 Any pieces.
  const items = (rose = 2) => [
    { item_id: l7.id, returned_quantity: 0, usage: [] },
    { item_id: lAny.id, breakdown: [
      { product_id: 7, returned_quantity: 2, lost_quantity: 0, usage: [] },
      { product_id: 9, returned_quantity: 0, lost_quantity: 1, usage: [{ reason: 'customer_service', quantity: 1, party_id: 2 }] },
      { product_id: 15, returned_quantity: rose, lost_quantity: 0, usage: [] },
    ] },
    { item_id: lOil.id, breakdown: [{ product_id: 17, returned_quantity: 0.2, lost_quantity: 0, usage: [{ reason: 'customer_service', quantity: 0.3 }] }] },
  ];
  return { sessionId, l7, lAny, lOil, saleA, saleB, saleC, items };
}

const SCENARIO_CHILDREN = [
  // [product, taken, returned, used (incl. sold), lost, mismatch]
  [7, 3, 2, 1, 0, false], [9, 2, 0, 1, 1, true], [15, 3, 2, 1, 0, false], [8, 2, 0, 2, 0, false], [17, 0.5, 0.2, 0.3, 0, false],
];

describe('issue rules (check_issue_availability)', () => {
  beforeEach(freshStore);

  it('takes a product line off stock now and only holds Any lines', async () => {
    const { sessionId, lines } = await issue([
      { product_id: 7, quantity: 2 }, { category_id: 3, quantity: 10 }, { category_id: 4, quantity: 0.5 },
    ]);
    expect(lines.map(l => [l.product_id, l.category_id, l.checkout_quantity])).toEqual([[7, null, 2], [null, 3, 10], [null, 4, 0.5]]);
    expect([await stockOf(7), await stockOf(8), await stockOf(17)]).toEqual([38, 35, 5]);
    expect(await holds()).toEqual([{ category_id: 3, held: 10 }, { category_id: 4, held: 0.5 }]);
    expect(await sessionTxns(sessionId)).toEqual([[7, 'checkout', -2]]);
  });

  it('counts stock held by other sessions and saves nothing when refused', async () => {
    await issue([{ product_id: 7, quantity: 2 }, { category_id: 3, quantity: 10 }]);
    // Dispenser Refill: 219 in stock - 2 issued = 217, 10 held -> 207 free.
    const tooMany = await db.rpc('admin_issue_stock', { p_seller_id: 'seller-2', p_items: [{ category_id: 3, quantity: 208 }], p_approver_id: 'admin-1' });
    expect(tooMany.error?.message).toMatch(/Not enough Dispenser Refill in the warehouse: 207 free \(10 out with staff as Any\), 208 asked/);
    const mixed = await db.rpc('admin_issue_stock', { p_seller_id: 'seller-2', p_items: [{ product_id: 8, quantity: 35 }, { category_id: 3, quantity: 173 }], p_approver_id: 'admin-1' });
    expect(mixed.error?.message).toMatch(/207 free .* 208 asked/);
    expect(await rows('checkout_sessions')).toHaveLength(1);
    expect(await stockOf(8)).toBe(35);
  });

  it('rejects a duplicate Any line, part pieces on a unit category and a line with both product and category', async () => {
    const run = items => db.rpc('admin_issue_stock', { p_seller_id: 'seller-2', p_items: items, p_approver_id: 'admin-1' });
    expect((await run([{ category_id: 3, quantity: 2 }, { category_id: 3, quantity: 3 }])).error?.message).toMatch(/Any Dispenser Refill is listed twice/);
    expect((await run([{ category_id: 3, quantity: 1.5 }])).error?.message).toMatch(/Any Dispenser Refill must be whole pieces/);
    expect((await run([{ product_id: 7, category_id: 3, quantity: 1 }])).error?.message).toMatch(/Invalid checkout item/);
    expect((await run([{ product_id: 10, quantity: 4 }])).error?.message).toMatch(/Insufficient stock for Green Apple Refill/);
    expect((await run([{ category_id: 999, quantity: 1 }])).error).toBeTruthy();
    expect((await run([{ category_id: 4, quantity: 0.5 }])).error).toBeNull(); // liquid Any may be part kg
  });

  it('approve_issue checks a seller request (holds included) and deducts only its product lines', async () => {
    const requestId = await request([{ category_id: 3, quantity: 4 }, { product_id: 9, quantity: 1 }]);
    expect(await holds()).toEqual([]); // a request holds nothing yet
    expect((await db.rpc('approve_issue', { p_session_id: requestId, p_approver_id: 'admin-1' })).error).toBeNull();
    expect([await stockOf(9), await stockOf(7)]).toEqual([29, 40]);
    expect(await holds()).toEqual([{ category_id: 3, held: 4 }]);

    const oilId = await request([{ category_id: 4, quantity: 21.9 }]);
    const { error } = await db.rpc('approve_issue', { p_session_id: oilId, p_approver_id: 'admin-1' });
    expect(error?.message).toMatch(/Not enough Diffuser Oil in the warehouse: 21.8 free \(0 out with staff as Any\), 21.9 asked/);
    expect((await db.getById('checkout_sessions', oilId)).data.status).toBe('pending_issue');

    const dupId = await request([{ category_id: 4, quantity: 1 }, { category_id: 4, quantity: 1 }]);
    expect((await db.rpc('approve_issue', { p_session_id: dupId, p_approver_id: 'admin-1' })).error?.message).toMatch(/Any Diffuser Oil is listed twice/);
  });

  it('counts a product line against its own category even if the row carries another category_id', async () => {
    await issue([{ category_id: 4, quantity: 21 }]); // Diffuser Oil: 21.8 - 21 held -> 0.8 free
    const requestId = await request([{ product_id: 18, category_id: 3, quantity: 1 }]); // product 18 alone has 4.5
    const { error } = await db.rpc('approve_issue', { p_session_id: requestId, p_approver_id: 'admin-1' });
    expect(error?.message).toMatch(/Not enough Diffuser Oil in the warehouse/);
  });
});

describe('bills from field stock (record_sale / update_sale / delete_sale)', () => {
  beforeEach(freshStore);

  it('moves no stock, writes no transaction and is recorded for the session seller, also when an admin bills', async () => {
    const { sessionId } = await issue([{ product_id: 7, quantity: 2 }, { category_id: 3, quantity: 10 }]);
    const txns = (await rows('inventory_transactions')).length;
    const own = (await fieldSale(sessionId, [{ product_id: 7, quantity: 1, unit_price: 450 }])).data;
    const byAdmin = (await fieldSale(sessionId, [{ product_id: 8, quantity: 3, unit_price: 450 }], 'admin-1')).data;
    expect([await stockOf(7), await stockOf(8)]).toEqual([38, 35]);
    expect((await rows('inventory_transactions')).length).toBe(txns);
    const sales = await rows('sales', s => [own, byAdmin].includes(s.id));
    expect(sales.map(s => [s.recorded_by, s.checkout_session_id])).toEqual([['seller-1', sessionId], ['seller-1', sessionId]]);
  });

  it('refuses products not issued, overflow beyond the Any line, other sellers and sessions that are not open', async () => {
    const { sessionId } = await issue([{ product_id: 7, quantity: 2 }, { category_id: 3, quantity: 10 }]);
    expect((await fieldSale(sessionId, [{ product_id: 8, quantity: 3, unit_price: 450 }], 'admin-1')).error).toBeNull();
    expect((await fieldSale(sessionId, [{ product_id: 1, quantity: 1, unit_price: 1200 }])).error?.message).toMatch(/NE 001 .* was not issued/);
    expect((await fieldSale(sessionId, [{ product_id: 9, quantity: 8, unit_price: 450 }])).error?.message)
      .toMatch(/Bills sell 11 from Any Dispenser Refill, but only 10 were issued/);
    expect((await fieldSale(sessionId, [{ product_id: 7, quantity: 1, unit_price: 450 }], 'seller-2')).error?.message)
      .toMatch(/You can only bill from your own field stock/);
    const requestId = await request([{ category_id: 3, quantity: 1 }]);
    expect((await fieldSale(requestId, [{ product_id: 7, quantity: 1, unit_price: 450 }], 'seller-2')).error?.message).toMatch(/is not open/);
    const { sessionId: productOnly } = await issue([{ product_id: 1, quantity: 2 }], 'seller-2');
    expect((await fieldSale(productOnly, [{ product_id: 1, quantity: 3, unit_price: 1200 }], 'seller-2')).error?.message)
      .toMatch(/was not issued to this staff member \(or more is billed than was issued\)/);
    expect(await rows('sales')).toHaveLength(1);
  });

  it('lets an open field bill change items (capacity re-checked) without moving stock', async () => {
    const { sessionId } = await issue([{ category_id: 3, quantity: 10 }]);
    const saleId = (await fieldSale(sessionId, [{ product_id: 8, quantity: 3, unit_price: 450 }])).data;
    const txns = (await rows('inventory_transactions')).length;
    expect((await editSale(saleId, [{ product_id: 8, quantity: 2, unit_price: 450 }, { product_id: 15, quantity: 1, unit_price: 450 }])).error).toBeNull();
    expect([await stockOf(8), await stockOf(15), (await rows('inventory_transactions')).length]).toEqual([35, 15, txns]);
    expect((await editSale(saleId, [{ product_id: 8, quantity: 12, unit_price: 450 }])).error?.message).toMatch(/but only 10 were issued/);
    expect((await rows('sale_items', si => si.sale_id === saleId)).map(si => [si.product_id, si.quantity])).toEqual([[8, 2], [15, 1]]);
  });

  it('locks items once the return is submitted or approved; prices stay editable; delete only outside pending_approval', async () => {
    const s = await fieldScenario();
    expect((await submit(s.sessionId, s.items())).error).toBeNull();

    expect((await deleteSale(s.saleB)).error?.message).toMatch(/Send the return back first, then delete the bill/);
    expect((await editSale(s.saleB, [{ product_id: 8, quantity: 1, unit_price: 450 }, { product_id: 15, quantity: 1, unit_price: 450 }])).error?.message)
      .toMatch(/Send the return back first, then change its items/);
    expect((await editSale(s.saleB, [{ product_id: 8, quantity: 2, unit_price: 400 }, { product_id: 15, quantity: 1, unit_price: 450 }])).error).toBeNull();
    expect((await db.getById('sales', s.saleB)).data.total_amount).toBe(1250);
    expect((await fieldSale(s.sessionId, [{ product_id: 7, quantity: 1, unit_price: 450 }])).error?.message).toMatch(/is not open/);

    const lavender = (await rows('checkout_items', i => i.parent_item_id === s.lAny.id && i.product_id === 9))[0];
    expect((await approve(s.sessionId, [{ item_id: lavender.id, discrepancy_type: 'loss', note: 'Dropped' }])).error).toBeNull();
    expect((await editSale(s.saleA, [{ product_id: 7, quantity: 2, unit_price: 450 }])).error?.message).toMatch(/settled in an approved field return/);
    expect((await editSale(s.saleA, [{ product_id: 7, quantity: 1, unit_price: 500 }], 'partial', 100)).error).toBeNull();

    const stock7 = await stockOf(7);
    const txns = (await rows('inventory_transactions')).length;
    expect((await deleteSale(s.saleC)).error).toBeNull();
    expect([await stockOf(7), (await rows('inventory_transactions')).length]).toEqual([stock7, txns]);
    expect((await rows('checkout_usage', u => u.notes === `Bill #${s.saleC}`)).map(u => u.sale_id)).toEqual([null, null]);
  });

  it('deletes an open field bill without moving stock', async () => {
    const { sessionId } = await issue([{ category_id: 3, quantity: 2 }], 'seller-2');
    const saleId = (await fieldSale(sessionId, [{ product_id: 8, quantity: 1, unit_price: 450 }], 'seller-2')).data;
    const txns = (await rows('inventory_transactions')).length;
    expect((await deleteSale(saleId)).error).toBeNull();
    expect([await stockOf(8), (await rows('inventory_transactions')).length]).toEqual([35, txns]);
  });
});

describe('submit_return / approve_return with Any lines and field bills', () => {
  beforeEach(freshStore);

  it('validates the Any breakdown and saves nothing when refused', async () => {
    const s = await fieldScenario();
    const variant = change => { const items = s.items(); change(items[1]); return items; };
    expect((await submit(s.sessionId, s.items(1))).error?.message).toMatch(/Any Dispenser Refill: 10 issued but 9 accounted for/);
    expect((await submit(s.sessionId, variant(a => a.breakdown.push({ product_id: 17, returned_quantity: 0, lost_quantity: 0, usage: [] })))).error?.message)
      .toMatch(/Choose a Dispenser Refill product for every line/);
    expect((await submit(s.sessionId, variant(a => a.breakdown.push({ product_id: 7, returned_quantity: 0, lost_quantity: 0, usage: [] })))).error?.message)
      .toMatch(/Black Touch Refill is listed twice/);
    expect((await submit(s.sessionId, variant(a => { a.breakdown[0].returned_quantity = 1.5; }))).error?.message).toMatch(/Black Touch Refill must be whole pieces/);
    // Migration 019: the list of named pieces may be left out, but the count must still add up.
    expect((await submit(s.sessionId, variant(a => { delete a.breakdown; }))).error?.message).toMatch(/Any Dispenser Refill: 10 issued but \d+ accounted for/);
    expect((await submit(s.sessionId, variant(a => { a.returned_quantity = 1.5; }))).error?.message).toMatch(/Any Dispenser Refill must be whole pieces/);
    expect((await submit(s.sessionId, variant(a => { a.returned_quantity = -1; }))).error?.message).toMatch(/Enter how many Dispenser Refill came back/);
    expect((await submit(s.sessionId, variant(a => { a.breakdown[0].usage = [{ reason: 'sold', quantity: 1 }]; }))).error?.message).toMatch(/Invalid usage reason/);
    expect((await submit(s.sessionId, s.items(), 'seller-2')).error?.message).toMatch(/Only the assigned staff member or an admin/);
    expect((await db.getById('checkout_sessions', s.sessionId)).data.status).toBe('checked_out');
    expect(await children(s.sessionId)).toEqual([]);
  });

  it('books linked bills as Sold (own line first, then the Any line) and writes one child per product', async () => {
    const s = await fieldScenario();
    const { data, error } = await submit(s.sessionId, s.items());
    expect(error).toBeNull();
    expect(data).toEqual({ has_discrepancy: true });
    expect(await children(s.sessionId)).toEqual(SCENARIO_CHILDREN);
    const any = (await db.getById('checkout_items', s.lAny.id)).data;
    expect([any.checkin_quantity, any.used_quantity, any.difference, any.has_mismatch]).toEqual([4, 5, 1, false]);
    const own = (await db.getById('checkout_items', s.l7.id)).data;
    expect([own.checkin_quantity, own.used_quantity, own.difference, own.has_mismatch]).toEqual([0, 2, 0, false]);
    expect(await soldUsage(s.sessionId)).toEqual([
      [7, 1, s.saleA, false], [7, 1, s.saleC, false], [7, 1, s.saleC, true], [15, 1, s.saleB, true], [8, 2, s.saleB, true],
    ]);
    expect([await stockOf(7), await stockOf(8), await stockOf(9), await stockOf(15), await stockOf(17)]).toEqual([38, 35, 30, 15, 5]);
    expect(await holds()).toEqual([{ category_id: 3, held: 10 }, { category_id: 4, held: 0.5 }]); // still held until approval
  });

  it('send back removes the children; the resubmit rebuilds them and keeps the notes history', async () => {
    const s = await fieldScenario();
    const send = notes => db.rpc('submit_return', { p_session_id: s.sessionId, p_items: s.items(), p_notes: notes, p_submitted_by: 'seller-1' });
    expect((await send('first try')).error).toBeNull();
    expect((await reject(s.sessionId, 'Recount lavender')).error).toBeNull();
    expect(await children(s.sessionId)).toEqual([]);
    expect(await rows('checkout_usage', u => u.session_id === s.sessionId)).toEqual([]);
    const any = (await db.getById('checkout_items', s.lAny.id)).data;
    expect([any.checkin_quantity, any.used_quantity, any.difference]).toEqual([null, null, null]);
    expect((await send('second try')).error).toBeNull();
    expect(await children(s.sessionId)).toEqual(SCENARIO_CHILDREN);
    expect(await soldUsage(s.sessionId)).toHaveLength(5);
    expect((await db.getById('checkout_sessions', s.sessionId)).data.notes).toBe('first try\nReturn sent back: Recount lavender\nsecond try');
  });

  it('approval moves stock once per child, releases the holds and keeps stock = opening + transactions', async () => {
    const opening = Object.fromEntries((await rows('products')).map(p => [p.id, p.current_stock]));
    const s = await fieldScenario();
    expect((await submit(s.sessionId, s.items())).error).toBeNull();
    const lavender = (await rows('checkout_items', i => i.parent_item_id === s.lAny.id && i.product_id === 9))[0];
    expect((await approve(s.sessionId)).error?.message).toMatch(/Classify the difference for Lavender Refill/);
    expect((await approve(s.sessionId, [{ item_id: lavender.id, discrepancy_type: 'loss', note: ' ' }])).error?.message).toMatch(/Classify the difference/);
    expect((await approve(s.sessionId, [{ item_id: lavender.id, discrepancy_type: 'loss', note: 'Dropped' }])).error).toBeNull();

    expect([await stockOf(7), await stockOf(8), await stockOf(9), await stockOf(15), await stockOf(17)]).toEqual([37, 33, 28, 14, 4.7]);
    expect(await sessionTxns(s.sessionId)).toEqual([
      [7, 'checkout', -2],
      [7, 'checkout', -3], [7, 'checkin', 2], [9, 'checkout', -2], [15, 'checkout', -3], [15, 'checkin', 2],
      [8, 'checkout', -2], [17, 'checkout', -0.5], [17, 'checkin', 0.2],
    ]);
    expect((await db.getById('checkout_items', lavender.id)).data).toMatchObject({ discrepancy_type: 'loss', discrepancy_note: 'Dropped' });
    expect(await holds()).toEqual([]);
    expect((await db.getById('checkout_sessions', s.sessionId)).data.status).toBe('checked_in');

    const txns = await rows('inventory_transactions');
    for (const p of await rows('products')) {
      const moved = txns.filter(t => t.product_id === p.id).reduce((sum, t) => sum + t.quantity, 0);
      expect(p.current_stock).toBeCloseTo(opening[p.id] + moved, 9);
    }
  });

  it('allocates Sold to product lines in item id order whatever order the return lists them', async () => {
    const { sessionId, lines: [first, second] } = await issue([{ product_id: 9, quantity: 1 }, { product_id: 9, quantity: 2 }], 'seller-2');
    expect((await fieldSale(sessionId, [{ product_id: 9, quantity: 1, unit_price: 450 }], 'seller-2')).error).toBeNull();
    expect((await submit(sessionId, [
      { item_id: second.id, returned_quantity: 2, usage: [] }, { item_id: first.id, returned_quantity: 0, usage: [] },
    ], 'seller-2')).error).toBeNull();
    const after = await rows('checkout_items', i => i.session_id === sessionId);
    expect(after.map(i => [i.used_quantity, i.difference, i.has_mismatch])).toEqual([[1, 0, false], [0, 0, false]]);
  });

  it('installs machines named on an Any line (customer and whole numbers required)', async () => {
    const { sessionId, lines: [anyLine] } = await issue([{ category_id: 1, quantity: 2 }], 'seller-2');
    const items = install => [{ item_id: anyLine.id, breakdown: [
      { product_id: 1, returned_quantity: 0, lost_quantity: 0, usage: [install] },
      { product_id: 2, returned_quantity: 1, lost_quantity: 0, usage: [] },
    ] }];
    expect((await submit(sessionId, items({ reason: 'installation', quantity: 1 }), 'seller-2')).error?.message).toMatch(/Choose the customer where NE 001/);
    expect((await submit(sessionId, [{ item_id: anyLine.id, breakdown: [
      { product_id: 1, returned_quantity: 0, lost_quantity: 0, usage: [{ reason: 'installation', quantity: 1.5, party_id: 1 }] },
      { product_id: 2, returned_quantity: 0, lost_quantity: 0, usage: [{ reason: 'other', quantity: 0.5 }] },
    ] }], 'seller-2')).error?.message).toMatch(/Installed machines must be whole numbers/);
    expect((await submit(sessionId, items({ reason: 'installation', quantity: 1, party_id: 1 }), 'seller-2')).error).toBeNull();
    expect((await approve(sessionId)).error).toBeNull();
    expect([await stockOf(1), (await db.getById('products', 1)).data.installed_qty, await stockOf(2)]).toEqual([25, 1, 18]);
    expect((await rows('installations', i => i.notes?.includes(`session #${sessionId})`)))
      .map(i => [i.party_id, i.product_id, i.quantity])).toEqual([[1, 1, 1]]);
  });

  it('approves a machine installed from an Any line even when its shelf stock reads 0', async () => {
    // Installed machines stay in Total Stock, so the installation is counted
    // back before the child's stock check (regression: it used to be refused).
    const { sessionId, lines: [anyLine] } = await issue([{ category_id: 1, quantity: 1 }], 'seller-2');
    expect((await db.rpc('set_product_stock', { p_product_id: 3, p_new_stock: 0, p_performer_id: 'admin-1', p_notes: 'count' })).error).toBeNull();
    expect((await submit(sessionId, [{ item_id: anyLine.id, breakdown: [
      { product_id: 3, returned_quantity: 0, lost_quantity: 0, usage: [{ reason: 'installation', quantity: 1, party_id: 2 }] },
    ] }], 'seller-2')).error).toBeNull();
    expect((await approve(sessionId)).error).toBeNull();
    expect([await stockOf(3), (await db.getById('products', 3)).data.installed_qty]).toEqual([0, 1]);
  });

  it('refuses approval while a child would take a product below zero', async () => {
    const { sessionId, lines: [anyLine] } = await issue([{ category_id: 3, quantity: 3 }]);
    expect((await submit(sessionId, [{ item_id: anyLine.id, breakdown: [
      { product_id: 10, returned_quantity: 0, lost_quantity: 0, usage: [{ reason: 'customer_service', quantity: 3 }] },
    ] }])).error).toBeNull();
    const setStock = n => db.rpc('set_product_stock', { p_product_id: 10, p_new_stock: n, p_performer_id: 'admin-1', p_notes: 'count' });
    expect((await setStock(1)).error).toBeNull();
    expect((await approve(sessionId)).error?.message).toMatch(/Stock of Green Apple Refill is lower than this return takes \(1 in stock\)\. Correct the stock first/);
    expect((await db.getById('checkout_sessions', sessionId)).data.status).toBe('pending_approval');
    expect((await setStock(3)).error).toBeNull();
    expect((await approve(sessionId)).error).toBeNull();
    expect(await stockOf(10)).toBe(0);
  });

  it('fails the return when bills sell more than was issued, and adds sold-only products itself', async () => {
    const { sessionId: oilLine, lines: [line] } = await issue([{ product_id: 18, quantity: 1 }]);
    expect((await fieldSale(oilLine, [{ product_id: 18, quantity: 1, unit_price: 8000 }])).error).toBeNull();
    await db.update('checkout_items', line.id, { checkout_quantity: 0.5 }); // e.g. a direct edit after billing
    expect((await submit(oilLine, [{ item_id: line.id, returned_quantity: 0, usage: [] }])).error?.message)
      .toMatch(/Bills from this field stock sell more Western Lavender Diffuser Oil than was issued/);

    const { sessionId, lines: [anyLine] } = await issue([{ category_id: 4, quantity: 0.4 }]);
    expect((await fieldSale(sessionId, [{ product_id: 17, quantity: 0.4, unit_price: 8000 }])).error).toBeNull();
    expect((await submit(sessionId, [{ item_id: anyLine.id, breakdown: [{ product_id: 17, returned_quantity: 0.1, lost_quantity: 0, usage: [] }] }])).error?.message)
      .toMatch(/Any Diffuser Oil: 0.4 issued but 0.5 accounted for/);
    expect((await submit(sessionId, [{ item_id: anyLine.id, breakdown: [] }])).error).toBeNull();
    expect(await children(sessionId)).toEqual([[17, 0.4, 0, 0.4, 0, false]]);
    expect((await approve(sessionId)).error).toBeNull();
    expect(await stockOf(17)).toBe(4.6);
  });

  it('drops empty breakdown rows; liquid lost within the tolerance is taken but is not a mismatch', async () => {
    const { sessionId, lines: [anyLine] } = await issue([{ category_id: 3, quantity: 2 }], 'seller-2');
    expect((await submit(sessionId, [{ item_id: anyLine.id, breakdown: [
      { product_id: 7, returned_quantity: 2, lost_quantity: 0, usage: [] }, { product_id: 8, returned_quantity: 0, lost_quantity: 0, usage: [] },
    ] }], 'seller-2')).error).toBeNull();
    expect(await children(sessionId)).toEqual([[7, 2, 2, 0, 0, false]]);

    const { sessionId: oil, lines: [oilLine] } = await issue([{ category_id: 4, quantity: 0.3 }], 'seller-2');
    expect((await submit(oil, [{ item_id: oilLine.id, breakdown: [
      { product_id: 17, returned_quantity: 0.295, lost_quantity: 0.005, usage: [] },
    ] }], 'seller-2')).error).toBeNull();
    expect(await children(oil)).toEqual([[17, 0.3, 0.295, 0, 0.005, false]]);
  });
});

// Migration 019: pieces that came back need no type; only the rest are named.
describe('Any return: unnamed returned pieces (migration 019)', () => {
  beforeEach(freshStore);

  it('everything came back: one number, no products named, no stock change, hold released', async () => {
    const before = await stockOf(7);
    const { sessionId, lines: [anyLine] } = await issue([{ category_id: 3, quantity: 10 }]);
    expect((await submit(sessionId, [{ item_id: anyLine.id, returned_quantity: 10 }])).error).toBeNull();
    expect(await rows('checkout_items', i => i.parent_item_id === anyLine.id)).toEqual([]);
    const parent = (await db.getById('checkout_items', anyLine.id)).data;
    expect([parent.checkin_quantity, parent.used_quantity, parent.difference, parent.has_mismatch]).toEqual([10, 0, 0, false]);
    expect((await approve(sessionId)).error).toBeNull();
    expect(await stockOf(7)).toBe(before);
    expect((await db.rpc('get_category_holds', {})).data).toEqual([]);
  });

  it('8 came back without types, 2 named as lost: only the lost product loses stock', async () => {
    const before = { 7: await stockOf(7), 8: await stockOf(8) };
    const txBefore = (await rows('inventory_transactions')).length;
    const { sessionId, lines: [anyLine] } = await issue([{ category_id: 3, quantity: 10 }]);
    const { error } = await submit(sessionId, [{
      item_id: anyLine.id, returned_quantity: 8,
      breakdown: [{ product_id: 8, lost_quantity: 2, usage: [] }],
    }]);
    expect(error).toBeNull();
    const kids = await rows('checkout_items', i => i.parent_item_id === anyLine.id);
    expect(kids.map(c => [c.product_id, c.checkout_quantity, c.checkin_quantity, c.difference, c.has_mismatch])).toEqual([[8, 2, 0, 2, true]]);
    const parent = (await db.getById('checkout_items', anyLine.id)).data;
    expect([parent.checkin_quantity, parent.difference]).toEqual([8, 2]);
    expect((await approve(sessionId, [{ item_id: kids[0].id, discrepancy_type: 'loss', note: 'Not found' }])).error).toBeNull();
    expect([await stockOf(7), await stockOf(8)]).toEqual([before[7], before[8] - 2]);
    // One checkout row for the lost pair; the 8 unnamed returned pieces move nothing.
    expect((await rows('inventory_transactions')).length).toBe(txBefore + 1);
  });

  it('a field bill and a used piece are named, the rest came back unnamed', async () => {
    const before = { 7: await stockOf(7), 9: await stockOf(9) };
    const { sessionId, lines: [anyLine] } = await issue([{ category_id: 3, quantity: 6 }]);
    expect((await fieldSale(sessionId, [{ product_id: 7, quantity: 1, unit_price: 450 }])).error).toBeNull();
    const { error } = await submit(sessionId, [{
      item_id: anyLine.id, returned_quantity: 4,
      breakdown: [{ product_id: 9, lost_quantity: 0, usage: [{ reason: 'customer_service', quantity: 1, party_id: 2 }] }],
    }]);
    expect(error).toBeNull();
    const kids = await rows('checkout_items', i => i.parent_item_id === anyLine.id);
    expect(kids.map(c => [c.product_id, c.checkout_quantity, c.used_quantity]).sort((a, b) => a[0] - b[0])).toEqual([[7, 1, 1], [9, 1, 1]]);
    expect((await approve(sessionId)).error).toBeNull();
    expect([await stockOf(7), await stockOf(9)]).toEqual([before[7] - 1, before[9] - 1]);
  });
});
