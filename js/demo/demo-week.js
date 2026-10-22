// Demo-mode only: fills the localStorage demo store with a realistic working
// week (the last 5 working days up to today) by calling the same db / RPC
// functions the screens call, with the clock set to each day's time.
// Loaded from main.js when the demo build is opened with ?demo=week.
// Never runs against Supabase.

const MINUTE = 60_000;

// New accounts. Demo login passwords follow the role: admin123 / seller123.
export const DEMO_WEEK_ACCOUNTS = [
  { id: 'demo-priya', email: 'priya@narmadaessence.com', full_name: 'Priya Mehta', role: 'admin', phone: '9825011001' },
  { id: 'demo-kunal', email: 'kunal@narmadaessence.com', full_name: 'Kunal Desai', role: 'seller', phone: '9825011002' },
  { id: 'demo-neha', email: 'neha@narmadaessence.com', full_name: 'Neha Joshi', role: 'seller', phone: '9825011003' },
  { id: 'demo-imran', email: 'imran@narmadaessence.com', full_name: 'Imran Shaikh', role: 'seller', phone: '9825011004' },
  { id: 'demo-sonal', email: 'sonal@narmadaessence.com', full_name: 'Sonal Trivedi', role: 'seller', phone: '9825011005' },
];

// Demo seed ids (js/supabase.js initStore).
const P = {
  NE001: 1, NE002: 2, NE004: 4, NE005: 5,
  BLACK_TOUCH: 7, PLEASURE: 8, LAVENDER: 9, GREEN_APPLE: 10, EXPRESSION: 11, MISCHIEF: 12,
  COOL_WATER_REFILL: 13, DECOR: 14, ROSE: 15, SANDAL: 16,
  COOL_WATER_OIL: 17, WESTERN_LAVENDER_OIL: 18, GUCCI_OUD_OIL: 19, WHITE_MUSK_OIL: 20, ROYAL_OUD_OIL: 21, CHERRY_OIL: 22,
};
const GRAND_BHAGWATI = 1, SAHARA_DARBAR = 2, CITY_PULSE = 3;
const ADMIN = 'admin-1', RAJ = 'seller-1';

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The last `count` days up to `today`, skipping Sundays (shop closed).
export function lastWorkingDays(today, count = 5) {
  const days = [];
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  while (days.length < count) {
    if (d.getDay() !== 0) days.unshift(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  return days;
}

export async function simulateDemoWeek({ db, auth, today = new Date() }) {
  if (!db.isDemoMode) throw new Error('The demo week can only be loaded in demo mode');

  const RealDate = globalThis.Date;
  const realNow = RealDate.now();
  const days = lastWorkingDays(today);
  let simMs = null;

  class SimDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [simMs ?? RealDate.now()])); }
    static now() { return simMs ?? RealDate.now(); }
  }

  // Set the clock to a time on a simulated day; today's times never pass the real clock.
  const at = (dayIndex, hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = days[dayIndex];
    let ms = new RealDate(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
    if (dayIndex === days.length - 1) ms = Math.min(ms, realNow - 5 * MINUTE);
    simMs = ms;
  };
  const tick = () => { simMs += MINUTE; };
  const dateOf = i => localDate(days[i]);

  const profiles = {};
  // Filled in once the accounts exist (an account created earlier keeps its own id).
  let PRIYA, KUNAL, NEHA, IMRAN, SONAL;
  const as = (userId) => { auth.currentUser = profiles[userId]; tick(); };

  async function rpc(name, params) {
    const { data, error } = await db.rpc(name, params);
    if (error) throw new Error(`${name}: ${error.message}`);
    tick();
    return data;
  }
  async function insert(table, row) {
    const { data, error } = await db.insert(table, row);
    if (error) throw new Error(`insert ${table}: ${error.message}`);
    tick();
    return data;
  }
  async function update(table, id, row) {
    const { data, error } = await db.update(table, id, row);
    if (error || !data) throw new Error(`update ${table} #${id} failed`);
    tick();
    return data;
  }
  async function itemsOf(sessionId) {
    const { data } = await db.getAll('checkout_items', { eq: { session_id: sessionId } });
    return data;
  }
  async function stockOf(productId) {
    const { data } = await db.getById('products', productId);
    return Number(data.current_stock);
  }

  // --- Daily Operations, the way the screens do it ---------------------------
  // Staff request (Request Stock inserts a pending session + items).
  async function request(staff, items) {
    as(staff);
    const session = await insert('checkout_sessions', {
      seller_id: staff, checkout_time: new Date().toISOString(), checkin_time: null, status: 'pending_issue', notes: '',
    });
    for (const [product_id, quantity] of items) {
      await insert('checkout_items', {
        session_id: session.id, product_id, checkout_quantity: quantity, checkin_quantity: null, is_flagged: false, flag_reason: null,
      });
    }
    return session.id;
  }
  async function approveIssue(approver, sessionId) {
    as(approver);
    await rpc('approve_issue', { p_session_id: sessionId, p_approver_id: approver });
  }
  async function rejectRequest(approver, sessionId) {
    as(approver);
    await update('checkout_sessions', sessionId, { status: 'flagged', approved_by: approver, approved_at: new Date().toISOString() });
  }
  async function issue(admin, staff, items) {
    as(admin);
    return rpc('admin_issue_stock', {
      p_seller_id: staff,
      p_items: items.map(([product_id, quantity]) => ({ product_id, quantity })),
      p_approver_id: admin,
    });
  }
  // spec: { [productId]: [returned, [[reason, qty, partyId?, note?], ...]] }
  async function submitReturn(staff, sessionId, spec, notes = '') {
    as(staff);
    const items = await itemsOf(sessionId);
    return rpc('submit_return', {
      p_session_id: sessionId,
      p_items: items.map(item => {
        const [returned, usage = []] = spec[item.product_id];
        return {
          item_id: item.id,
          returned_quantity: returned,
          usage: usage.map(([reason, quantity, party_id = null, note = null]) => ({ reason, quantity, party_id, notes: note })),
        };
      }),
      p_notes: notes,
      p_submitted_by: staff,
    });
  }
  // resolutions: { [productId]: [type, note] }
  async function approveReturn(approver, sessionId, resolutions = {}) {
    as(approver);
    const items = await itemsOf(sessionId);
    await rpc('approve_return', {
      p_session_id: sessionId,
      p_approver_id: approver,
      p_resolutions: Object.entries(resolutions).map(([productId, [discrepancy_type, note]]) => ({
        item_id: items.find(i => i.product_id === Number(productId)).id, discrepancy_type, note,
      })),
    });
  }
  async function sendBack(approver, sessionId, reason) {
    as(approver);
    await rpc('reject_return', { p_session_id: sessionId, p_reason: reason, p_approver_id: approver });
  }

  // --- Other screens ----------------------------------------------------------
  async function purchase(admin, productId, quantity, rate, supplier, bill, dayIndex, notes = '') {
    as(admin);
    return rpc('record_purchase', {
      p_product_id: productId, p_quantity: quantity, p_purchase_rate: rate, p_supplier: supplier,
      p_bill_number: bill, p_purchase_date: dateOf(dayIndex), p_notes: notes, p_received_by: admin,
    });
  }
  async function sale(user, dayIndex, { party = null, items, status = 'paid', method = 'cash', received = 0, due = null, type = 'gst', notes = '' }) {
    as(user);
    return rpc('record_sale', {
      p_party_id: party,
      p_items: items.map(([product_id, quantity, unit_price]) => ({ product_id, quantity, unit_price })),
      p_payment_status: status, p_payment_method: method, p_amount_received: received,
      p_expected_payment_date: due, p_sale_date: dateOf(dayIndex), p_notes: notes,
      p_recorded_by: user, p_sale_type: type,
    });
  }
  async function collect(user, saleId, partyId, status, amount, method, due, notes) {
    as(user);
    await rpc('record_payment_followup', {
      p_sale_id: saleId, p_party_id: partyId, p_status_update: status, p_payment_method: method,
      p_amount_collected: amount, p_expected_payment_date: due, p_notes: notes, p_visited_by: user,
    });
  }
  async function damage(user, productId, type, quantity, reason, dayIndex) {
    as(user);
    await rpc('record_damage_loss', {
      p_product_id: productId, p_damage_type: type, p_quantity: quantity, p_reason: reason,
      p_report_date: dateOf(dayIndex), p_reported_by: user,
    });
  }
  async function requestAdjustment(admin, productId, newStock, reason) {
    as(admin);
    return rpc('request_stock_adjustment', { p_product_id: productId, p_new_stock: newStock, p_reason: reason, p_requested_by: admin });
  }
  async function reviewAdjustment(admin, id, approve, note) {
    as(admin);
    await rpc('review_stock_adjustment', { p_adjustment_id: id, p_approve: approve, p_note: note, p_reviewer_id: admin });
  }
  const dueIn = (dayIndex, n) => { const d = new RealDate(days[dayIndex]); d.setDate(d.getDate() + n); return localDate(d); };

  globalThis.Date = SimDate;
  try {
    // ======================= DAY 1 =======================
    at(0, '08:30');
    const { data: existing } = await db.getAll('profiles');
    for (const p of existing) profiles[p.id] = p;
    as(ADMIN);
    // Settings → Users → Create Seller Account (demo mode inserts the profile).
    const accountIds = {};
    for (const account of DEMO_WEEK_ACCOUNTS) {
      const created = existing.find(p => p.email === account.email) || await insert('profiles', { ...account, is_active: true });
      profiles[created.id] = created;
      accountIds[account.id] = created.id;
    }
    ({ 'demo-priya': PRIYA, 'demo-kunal': KUNAL, 'demo-neha': NEHA, 'demo-imran': IMRAN, 'demo-sonal': SONAL } = accountIds);

    at(0, '08:45');
    // Parties: AMC + Free-to-Use customers, and one that bought its machines.
    const fernSpa = await insert('parties', {
      name: 'Fern Spa & Salon', phone: '9898200101', address: 'Vesu, Surat', notes: 'Reception + 2 washrooms',
      machine_type: 'free_to_use', machine_counts: { 1: 2 }, amc_active: true, amc_day: days[2].getDate(), amc_rate: 1800, custom_category_rates: null,
    });
    const orbit = await insert('parties', {
      name: 'Orbit Co-working', phone: '9898200102', address: 'Adajan, Surat', notes: 'Bought 3 dispensers in 2025',
      machine_type: 'purchased', machine_counts: { 1: 3 }, amc_active: false, amc_day: null, amc_rate: null, custom_category_rates: null,
    });
    const rivera = await insert('parties', {
      name: 'Hotel Rivera', phone: '9898200103', address: 'Athwa Gate, Surat', notes: 'Lobby diffuser on AMC',
      machine_type: 'free_to_use', machine_counts: { 2: 1 }, amc_active: true, amc_day: days[4].getDate(), amc_rate: 2500, custom_category_rates: null,
    });

    at(0, '08:55');
    // Products: a new refill line (opening stock set directly, as for any new product)
    // and a fragrance name corrected by hand.
    const oudRoyale = await insert('products', {
      name: 'Oud Royale Refill', model_number: null, fragrance: 'Oud Royale', category_id: 3, type: 'unit',
      unit_price: 480, current_stock: 0, sell_qty: 0, installed_qty: 0, min_stock_threshold: 8, max_daily_consumption: 5,
      expiry_date: dueIn(0, 540), is_active: true, image_url: null,
    });
    await rpc('set_product_stock', { p_product_id: oudRoyale.id, p_new_stock: 24, p_performer_id: ADMIN, p_notes: 'Initial product stock' });
    await update('products', P.WHITE_MUSK_OIL, { fragrance: 'White Musk 3N' });

    at(0, '09:05');
    await purchase(ADMIN, P.GREEN_APPLE, 40, 210, 'Aroma Traders', 'AT-1021', 0);
    await purchase(ADMIN, P.GUCCI_OUD_OIL, 3, 6200, 'Essence Oils Co', 'EO-552', 0);
    await purchase(ADMIN, P.NE001, 10, 850, 'Machine World', 'MW-88', 0, 'Spare dispensers for new installs');

    at(0, '09:30');
    const d1Raj = await request(RAJ, [[P.LAVENDER, 6], [P.COOL_WATER_OIL, 0.6], [P.NE001, 1]]);
    const d1Kunal = await request(KUNAL, [[P.PLEASURE, 5], [P.ROSE, 4]]);
    const d1Neha = await request(NEHA, [[P.BLACK_TOUCH, 6], [P.WESTERN_LAVENDER_OIL, 0.5]]);
    const d1ImranTooMuch = await request(IMRAN, [[P.GREEN_APPLE, 60]]);
    at(0, '09:45');
    await approveIssue(PRIYA, d1Raj);
    await approveIssue(PRIYA, d1Kunal);
    await approveIssue(PRIYA, d1Neha);
    await rejectRequest(PRIYA, d1ImranTooMuch);
    const d1Imran = await issue(PRIYA, IMRAN, [[P.GREEN_APPLE, 8], [P.MISCHIEF, 4]]);

    at(0, '11:10');
    const grandBill = await sale(ADMIN, 0, {
      party: GRAND_BHAGWATI, items: [[P.SANDAL, 4, 450]], status: 'paid', method: 'upi', type: 'gst', notes: 'Monthly refill pack',
    });
    await sale(RAJ, 0, { items: [[P.LAVENDER, 2, 450]], status: 'paid', method: 'cash', type: 'cash', notes: 'Walk-in at Vesu showroom' });
    at(0, '13:20');
    await damage(ADMIN, P.EXPRESSION, 'damaged', 1, 'Cap cracked in transit', 0);

    at(0, '18:00');
    await submitReturn(RAJ, d1Raj, {
      [P.LAVENDER]: [1, [['customer_service', 3, GRAND_BHAGWATI], ['customer_service', 2, CITY_PULSE]]],
      [P.COOL_WATER_OIL]: [0.25, [['customer_service', 0.345, GRAND_BHAGWATI]]],
      [P.NE001]: [0, [['installation', 1, fernSpa.id, 'Second washroom']]],
    });
    await submitReturn(KUNAL, d1Kunal, {
      [P.PLEASURE]: [2, [['customer_service', 3, SAHARA_DARBAR]]],
      [P.ROSE]: [4, []],
    });
    await submitReturn(NEHA, d1Neha, {
      [P.BLACK_TOUCH]: [2, [['customer_service', 4, CITY_PULSE]]],
      [P.WESTERN_LAVENDER_OIL]: [0.2, [['customer_service', 0.3, GRAND_BHAGWATI]]],
    });
    await submitReturn(IMRAN, d1Imran, {
      [P.GREEN_APPLE]: [3, [['customer_service', 5, orbit.id]]],
      [P.MISCHIEF]: [4, []],
    });
    at(0, '18:40');
    for (const s of [d1Raj, d1Kunal, d1Neha, d1Imran]) await approveReturn(PRIYA, s);

    // ======================= DAY 2 =======================
    at(1, '09:00');
    await purchase(ADMIN, P.COOL_WATER_REFILL, 30, 205, 'Aroma Traders', 'AT-1034', 1);
    await purchase(ADMIN, P.ROSE, 20, 210, 'Aroma Traders', 'AT-1034', 1);

    at(1, '09:20');
    const d2Raj = await issue(ADMIN, RAJ, [[P.COOL_WATER_REFILL, 6], [P.ROYAL_OUD_OIL, 0.4]]);
    const d2Kunal = await issue(ADMIN, KUNAL, [[P.DECOR, 5], [P.NE002, 1]]);
    const d2Neha = await issue(ADMIN, NEHA, [[P.BLACK_TOUCH, 5], [P.CHERRY_OIL, 0.5]]);
    const d2Imran = await issue(ADMIN, IMRAN, [[P.GREEN_APPLE, 6]]);
    const d2Sonal = await issue(ADMIN, SONAL, [[P.SANDAL, 4], [P.LAVENDER, 3]]);

    at(1, '11:30');
    // AMC customer: fixed monthly rate, line prices scaled so the bill equals the AMC rate.
    const riveraAmcBill = await sale(PRIYA, 1, {
      party: rivera.id, items: [[P.ROSE, 4, 625]], status: 'pending', method: 'bank_transfer', received: 0,
      due: dueIn(1, 7), type: 'gst', notes: 'AMC monthly refill (₹2,500 fixed)',
    });
    const orbitBill = await sale(ADMIN, 1, {
      party: orbit.id, items: [[P.PLEASURE, 3, 450]], status: 'partial', method: 'cash', received: 600,
      due: dueIn(1, 3), type: 'cash', notes: '',
    });

    at(1, '14:00');
    as(ADMIN);
    const rental = await rpc('create_rental', {
      p_product_id: P.NE004, p_party_id: orbit.id, p_quantity: 2, p_rental_date: dateOf(1),
      p_expected_return_date: dateOf(2), p_rent_amount: 1500, p_notes: 'Two Luxe dispensers for a weekend event',
      p_performer_id: ADMIN,
    });

    at(1, '16:00');
    const decorAdj = await requestAdjustment(ADMIN, P.DECOR, (await stockOf(P.DECOR)) - 1, 'Physical count: 1 short on the shelf');
    await reviewAdjustment(PRIYA, decorAdj, true, 'Checked the shelf myself');

    at(1, '18:05');
    await submitReturn(RAJ, d2Raj, {
      [P.COOL_WATER_REFILL]: [2, [['customer_service', 4, SAHARA_DARBAR]]],
      [P.ROYAL_OUD_OIL]: [0.1, [['customer_service', 0.3, GRAND_BHAGWATI]]],
    });
    await submitReturn(KUNAL, d2Kunal, {
      [P.DECOR]: [1, [['customer_service', 3, CITY_PULSE]]],
      [P.NE002]: [0, [['installation', 1, rivera.id, 'Lobby, near reception']]],
    });
    await submitReturn(NEHA, d2Neha, {
      [P.BLACK_TOUCH]: [0, [['customer_service', 5, fernSpa.id]]],
      [P.CHERRY_OIL]: [0.25, [['customer_service', 0.2, SAHARA_DARBAR]]],
    });
    await submitReturn(IMRAN, d2Imran, {
      [P.GREEN_APPLE]: [7, []],
    });
    await submitReturn(SONAL, d2Sonal, {
      [P.SANDAL]: [1, [['customer_service', 3, GRAND_BHAGWATI]]],
      [P.LAVENDER]: [3, []],
    });
    at(1, '18:45');
    await approveReturn(PRIYA, d2Raj);
    await approveReturn(PRIYA, d2Sonal);
    await approveReturn(PRIYA, d2Kunal, { [P.DECOR]: ['staff_shortage', 'Kunal to account for 1 Decor refill'] });
    await approveReturn(PRIYA, d2Neha, { [P.CHERRY_OIL]: ['wastage', 'Oil spilled while refilling at Sahara Darbar'] });
    await approveReturn(PRIYA, d2Imran, { [P.GREEN_APPLE]: ['excess_return', '1 Green Apple left in his bag from yesterday'] });
    at(1, '19:00');
    await collect(ADMIN, orbitBill, orbit.id, 'partial', 400, 'cash', dueIn(1, 3), 'Collected at Orbit front desk');

    // ======================= DAY 3 =======================
    at(2, '09:10');
    const d3Raj = await request(RAJ, [[P.LAVENDER, 4], [P.WESTERN_LAVENDER_OIL, 0.5]]);
    const d3Neha = await request(NEHA, [[P.PLEASURE, 5], [P.COOL_WATER_REFILL, 4]]);
    await approveIssue(PRIYA, d3Raj);
    await approveIssue(PRIYA, d3Neha);
    const d3Kunal = await issue(ADMIN, KUNAL, [[P.ROSE, 5]]);
    const d3Imran = await issue(ADMIN, IMRAN, [[P.MISCHIEF, 4], [P.GUCCI_OUD_OIL, 0.4]]);
    const d3Sonal = await issue(ADMIN, SONAL, [[P.EXPRESSION, 4], [oudRoyale.id, 2]]);

    at(2, '10:30');
    // Dashboard → AMC refill worklist → Done.
    as(RAJ);
    await insert('refill_completions', {
      party_id: fernSpa.id, month: days[2].getMonth() + 1, year: days[2].getFullYear(), completed_by: RAJ,
    });

    at(2, '11:15');
    // Sales → Edit Bill: Grand Bhagwati took one more Sandal refill.
    as(ADMIN);
    await rpc('update_sale', {
      p_sale_id: grandBill, p_party_id: GRAND_BHAGWATI, p_items: [{ product_id: P.SANDAL, quantity: 5, unit_price: 450 }],
      p_payment_status: 'paid', p_payment_method: 'upi', p_amount_received: 2250, p_expected_payment_date: null,
      p_sale_date: dateOf(0), p_notes: 'Monthly refill pack (+1 added later)', p_performer_id: ADMIN, p_sale_type: 'gst',
    });

    at(2, '12:30');
    as(ADMIN);
    await rpc('return_rental', { p_rental_id: rental, p_performer_id: ADMIN });
    at(2, '13:10');
    await damage(ADMIN, P.GUCCI_OUD_OIL, 'expired', 0.1, 'Batch past shelf life', 2);
    await damage(KUNAL, P.ROSE, 'lost', 1, 'Lost during delivery', 2);

    at(2, '17:50');
    await submitReturn(RAJ, d3Raj, {
      [P.LAVENDER]: [1, [['customer_service', 3, rivera.id]]],
      [P.WESTERN_LAVENDER_OIL]: [0.3, [['customer_service', 0.2, rivera.id]]],
    });
    await submitReturn(NEHA, d3Neha, {
      [P.PLEASURE]: [2, [['customer_service', 3, orbit.id]]],
      [P.COOL_WATER_REFILL]: [4, []],
    });
    await submitReturn(KUNAL, d3Kunal, {
      [P.ROSE]: [1, [['customer_service', 4, fernSpa.id]]],
    });
    // Imran forgets to enter usage for Mischief → sent back → corrected.
    await submitReturn(IMRAN, d3Imran, {
      [P.MISCHIEF]: [0, []],
      [P.GUCCI_OUD_OIL]: [0.2, [['customer_service', 0.2, GRAND_BHAGWATI]]],
    });
    await submitReturn(SONAL, d3Sonal, {
      [P.EXPRESSION]: [2, [['other', 2, orbit.id, 'Demo samples for new members']]],
      [oudRoyale.id]: [0, [['customer_service', 2, rivera.id]]],
    });
    at(2, '18:20');
    await sendBack(PRIYA, d3Imran, 'Usage not entered for Mischief — 4 refills missing');
    at(2, '18:35');
    await submitReturn(IMRAN, d3Imran, {
      [P.MISCHIEF]: [1, [['customer_service', 3, CITY_PULSE]]],
      [P.GUCCI_OUD_OIL]: [0.2, [['customer_service', 0.2, GRAND_BHAGWATI]]],
    }, 'Corrected: 3 Mischief used at City Pulse Mall');
    at(2, '18:50');
    for (const s of [d3Raj, d3Neha, d3Kunal, d3Imran, d3Sonal]) await approveReturn(PRIYA, s);
    await collect(PRIYA, riveraAmcBill, rivera.id, 'promised', 0, null, dueIn(2, 5), 'Accounts will transfer after month-end');

    // ======================= DAY 4 =======================
    at(3, '09:00');
    await purchase(ADMIN, P.COOL_WATER_OIL, 2, 6000, 'Essence Oils Co', 'EO-571', 3);
    await purchase(ADMIN, P.WESTERN_LAVENDER_OIL, 2, 5800, 'Essence Oils Co', 'EO-571', 3);
    await purchase(ADMIN, P.NE005, 2, 14500, 'Machine World', 'MW-93', 3);

    at(3, '09:25');
    const d4Raj = await issue(ADMIN, RAJ, [[P.BLACK_TOUCH, 5], [P.NE001, 2]]);
    const d4Kunal = await issue(ADMIN, KUNAL, [[P.LAVENDER, 4]]);
    const d4Neha = await issue(ADMIN, NEHA, [[P.COOL_WATER_OIL, 0.6]]);
    await issue(ADMIN, SONAL, [[P.SANDAL, 5], [P.DECOR, 3]]); // not returned: still out on day 5

    at(3, '11:40');
    const duplicateBill = await sale(NEHA, 3, {
      party: CITY_PULSE, items: [[P.COOL_WATER_REFILL, 2, 450]], status: 'pending', method: 'cash', received: 0, type: 'cash',
      notes: 'Entered twice by mistake',
    });
    await sale(ADMIN, 3, {
      party: CITY_PULSE, items: [[P.COOL_WATER_OIL, 0.5, 8000]], status: 'paid', method: 'bank_transfer', type: 'gst', notes: 'Diffuser oil top-up',
    });
    at(3, '12:05');
    as(ADMIN);
    await rpc('delete_sale', { p_sale_id: duplicateBill, p_performer_id: ADMIN });

    at(3, '13:30');
    const lavenderAdj = await requestAdjustment(ADMIN, P.LAVENDER, (await stockOf(P.LAVENDER)) + 2, 'Found 2 extra on the returns shelf');
    await reviewAdjustment(PRIYA, lavenderAdj, false, 'Recount — the returns shelf was already counted');

    at(3, '18:10');
    await submitReturn(RAJ, d4Raj, {
      [P.BLACK_TOUCH]: [1, [['customer_service', 4, SAHARA_DARBAR]]],
      [P.NE001]: [0, [['installation', 1, rivera.id, 'Banquet hall'], ['installation', 1, SAHARA_DARBAR, 'Family dining area']]],
    });
    await submitReturn(KUNAL, d4Kunal, {
      [P.LAVENDER]: [0, [['customer_service', 2, fernSpa.id], ['other', 2, fernSpa.id, 'Display stand at reception']]],
    });
    await submitReturn(NEHA, d4Neha, {
      [P.COOL_WATER_OIL]: [0.1, [['customer_service', 0.5, CITY_PULSE]]],
    });
    at(3, '18:40');
    for (const s of [d4Raj, d4Kunal, d4Neha]) await approveReturn(PRIYA, s);
    await collect(ADMIN, orbitBill, orbit.id, 'paid', 350, 'upi', null, 'Balance cleared');

    // ======================= DAY 5 (today) =======================
    at(4, '08:30');
    await purchase(ADMIN, P.PLEASURE, 30, 200, 'Aroma Traders', 'AT-1052', 4);
    at(4, '08:45');
    await request(KUNAL, [[P.ROSE, 5], [P.PLEASURE, 4]]); // left waiting: Pending Issue
    const d5Raj = await issue(PRIYA, RAJ, [[P.LAVENDER, 4], [P.COOL_WATER_OIL, 0.5]]);
    at(4, '09:30');
    const oudStock = await stockOf(P.ROYAL_OUD_OIL);
    await requestAdjustment(ADMIN, P.ROYAL_OUD_OIL, Math.round((oudStock - 0.05) * 1000) / 1000, 'Weighed bottle: 50 g evaporated'); // left pending
    at(4, '10:15');
    await submitReturn(RAJ, d5Raj, {
      [P.LAVENDER]: [1, [['customer_service', 2, GRAND_BHAGWATI]]],
      [P.COOL_WATER_OIL]: [0.2, [['customer_service', 0.3, GRAND_BHAGWATI]]],
    }, 'Short morning visit'); // shortage of 1 Lavender: awaiting approval
  } finally {
    globalThis.Date = RealDate;
    auth.currentUser = null;
  }

  return {
    days: days.map(localDate),
    accounts: DEMO_WEEK_ACCOUNTS.map(a => ({ email: a.email, role: a.role, name: a.full_name })),
  };
}
