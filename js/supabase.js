import { createClient } from '@supabase/supabase-js';

// These will be set via environment variables in production
// For development, we'll use demo mode with localStorage
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isDemoMode = !SUPABASE_URL || !SUPABASE_ANON_KEY;

// Hard-fail in production if env vars are missing.
// Called at app init (from main.js) — kept out of module top-level so the
// bundler doesn't treat the exports below as dead code when statically
// evaluating the throw.
export function assertProductionConfig() {
  if (import.meta.env.PROD && isDemoMode) {
    throw new Error(
      'Missing Supabase configuration in production build. ' +
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.'
    );
  }
}

let supabase = null;
if (!isDemoMode) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export { supabase };

// ============================================
// DEMO MODE — localStorage-based data store
// Allows full app testing without Supabase
// ============================================
const STORAGE_KEY = 'narmada_essence_data';

function getStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveStore(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function initStore() {
  if (getStore()) return;
  const now = new Date().toISOString();
  saveStore({
    profiles: [
      { id: 'admin-1', email: 'admin@narmadaessence.com', full_name: 'Warehouse Admin', role: 'admin', phone: '9512950505', is_active: true, created_at: now },
      { id: 'seller-1', email: 'seller1@narmadaessence.com', full_name: 'Raj Patel', role: 'seller', phone: '9876543210', is_active: true, created_at: now },
      { id: 'seller-2', email: 'seller2@narmadaessence.com', full_name: 'Amit Shah', role: 'seller', phone: '9876543211', is_active: true, created_at: now }
    ],
    categories: [
      { id: 1, name: 'Automatic Dispenser', type: 'unit', created_at: now },
      { id: 2, name: 'Smart Diffuser', type: 'unit', created_at: now },
      { id: 3, name: 'Dispenser Refill', type: 'unit', created_at: now },
      { id: 4, name: 'Diffuser Oil', type: 'liquid', created_at: now },
      { id: 5, name: 'Room Cream', type: 'unit', created_at: now }
    ],
    products: [
      { id: 1, name: 'NE 001 — Automatic Fragrance Dispenser', category_id: 1, type: 'unit', model_number: 'NE-001', unit_price: 1200, current_stock: 25, min_stock_threshold: 5, max_daily_consumption: 3, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 2, name: 'NE 002 — Modern Fragrance Dispenser', category_id: 1, type: 'unit', model_number: 'NE-002', unit_price: 1400, current_stock: 18, min_stock_threshold: 5, max_daily_consumption: 3, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 3, name: 'NE 003 — Refined Dispenser', category_id: 1, type: 'unit', model_number: 'NE-003', unit_price: 1800, current_stock: 12, min_stock_threshold: 4, max_daily_consumption: 2, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 4, name: 'NE 004 — Luxe Dispenser', category_id: 1, type: 'unit', model_number: 'NE-004', unit_price: 2000, current_stock: 15, min_stock_threshold: 4, max_daily_consumption: 2, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 5, name: 'NE 005 — Premium Living Diffuser', category_id: 2, type: 'unit', model_number: 'NE-005', unit_price: 20000, current_stock: 8, min_stock_threshold: 2, max_daily_consumption: 1, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 6, name: 'NE 006 — Luxury Smart Diffuser', category_id: 2, type: 'unit', model_number: 'NE-006', unit_price: 22000, current_stock: 6, min_stock_threshold: 2, max_daily_consumption: 1, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 7, name: 'Black Touch Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 40, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 8, name: 'Pleasure Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 35, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 9, name: 'Lavender Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 30, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 10, name: 'Green Apple Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 3, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 11, name: 'Expression Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 28, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-05-20', is_active: true, created_at: now, updated_at: now },
      { id: 12, name: 'Mischief Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 22, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-07-10', is_active: true, created_at: now, updated_at: now },
      { id: 13, name: 'Cool Water Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 8, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-04-30', is_active: true, created_at: now, updated_at: now },
      { id: 14, name: 'Decor Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 20, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 15, name: 'Rose Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 15, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-08-20', is_active: true, created_at: now, updated_at: now },
      { id: 16, name: 'Sandal Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 18, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 17, name: 'Cool Water Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 8, current_stock: 5000, min_stock_threshold: 1000, max_daily_consumption: 200, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 18, name: 'Western Lavender Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 8, current_stock: 4500, min_stock_threshold: 1000, max_daily_consumption: 200, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 19, name: 'Gucci Oud Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 10, current_stock: 800, min_stock_threshold: 1000, max_daily_consumption: 150, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 20, name: 'White Musk 3N Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 9, current_stock: 3500, min_stock_threshold: 1000, max_daily_consumption: 200, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 21, name: 'Royal Oud Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 12, current_stock: 2000, min_stock_threshold: 1000, max_daily_consumption: 150, expiry_date: '2028-08-01', is_active: true, created_at: now, updated_at: now },
      { id: 22, name: 'Cherry Blossom Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 7, current_stock: 6000, min_stock_threshold: 1000, max_daily_consumption: 200, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
    ],
    checkout_sessions: [],
    checkout_items: [],
    parties: [
      { id: 1, name: 'Hotel Grand Bhagwati', phone: '9898123456', address: 'Ring Road, Surat', notes: 'Regular client', created_at: now },
      { id: 2, name: 'Sahara Darbar Restaurant', phone: '9898654321', address: 'Adajan, Surat', notes: '', created_at: now },
      { id: 3, name: 'City Pulse Mall', phone: '9898111222', address: 'Dumas Road, Surat', notes: 'Large order monthly', created_at: now }
    ],
    sales: [],
    sale_items: [],
    rentals: [],
    inventory_transactions: [],
    damage_reports: [],
    stock_intakes: [],
    refill_completions: [],
    _nextId: { checkout_sessions: 1, checkout_items: 1, sales: 1, sale_items: 1, rentals: 1, inventory_transactions: 1, damage_reports: 1, stock_intakes: 1, refill_completions: 1, parties: 4, products: 23, categories: 6 }
  });
}

// ============================================
// DEMO DATA ACCESS LAYER
// ============================================
const demo = {
  getAll(table) { return getStore()?.[table] || []; },
  getById(table, id) { return this.getAll(table).find(r => r.id === id) || null; },
  insert(table, record) {
    const store = getStore();
    const nextId = store._nextId[table] || 1;
    const newRecord = { ...record, id: nextId, created_at: new Date().toISOString() };
    store[table].push(newRecord);
    store._nextId[table] = nextId + 1;
    saveStore(store);
    return newRecord;
  },
  update(table, id, updates) {
    const store = getStore();
    const idx = store[table].findIndex(r => r.id === id);
    if (idx === -1) return null;
    store[table][idx] = { ...store[table][idx], ...updates, updated_at: new Date().toISOString() };
    saveStore(store);
    return store[table][idx];
  },
  delete(table, id) {
    const store = getStore();
    store[table] = store[table].filter(r => r.id !== id);
    saveStore(store);
  },
  query(table, filterFn) {
    return this.getAll(table).filter(filterFn);
  }
};

// ============================================
// DEMO RPC HANDLERS — mirror the Postgres functions in migration 006.
// Same signatures, same param names, so the same client code path works
// in both demo (localStorage) and production (supabase.rpc) modes.
// ============================================
const demoRpc = {
  // adjust_stock(product_id, delta) — atomic-ish stock change with negative guard.
  adjust_stock({ p_product_id, p_delta }) {
    const store = getStore();
    const idx = store.products.findIndex(p => p.id === p_product_id);
    if (idx === -1) throw new Error(`Product ${p_product_id} not found`);
    const newStock = (store.products[idx].current_stock || 0) + p_delta;
    if (newStock < 0) throw new Error(`Insufficient stock for ${store.products[idx].name}`);
    store.products[idx].current_stock = newStock;
    store.products[idx].updated_at = new Date().toISOString();
    saveStore(store);
    return newStock;
  },

  // record_sale(...) — insert sale + line items + deduct stock + log transactions.
  // p_items: [{ product_id, quantity, unit_price }, ...]
  record_sale({ p_party_id, p_items, p_payment_status, p_payment_method, p_amount_received, p_expected_payment_date, p_sale_date, p_notes, p_recorded_by }) {
    const store = getStore();
    const now = new Date().toISOString();
    const total = p_items.reduce((s, i) => s + (i.quantity * i.unit_price), 0);

    const saleId = store._nextId.sales || 1;
    store.sales.push({
      id: saleId,
      party_id: p_party_id,
      total_amount: total,
      payment_status: p_payment_status,
      payment_method: p_payment_method,
      amount_received: p_amount_received || 0,
      expected_payment_date: p_expected_payment_date,
      sale_date: p_sale_date,
      notes: p_notes,
      recorded_by: p_recorded_by,
      created_at: now,
    });
    store._nextId.sales = saleId + 1;

    for (const item of p_items) {
      const lineTotal = item.quantity * item.unit_price;
      const siId = store._nextId.sale_items || 1;
      store.sale_items.push({
        id: siId,
        sale_id: saleId,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: lineTotal,
        created_at: now,
      });
      store._nextId.sale_items = siId + 1;

      const pIdx = store.products.findIndex(p => p.id === item.product_id);
      if (pIdx === -1) throw new Error(`Product ${item.product_id} not found`);
      const newStock = (store.products[pIdx].current_stock || 0) - item.quantity;
      if (newStock < 0) throw new Error(`Insufficient stock for ${store.products[pIdx].name}`);
      store.products[pIdx].current_stock = newStock;
      store.products[pIdx].updated_at = now;

      const txnId = store._nextId.inventory_transactions || 1;
      store.inventory_transactions.push({
        id: txnId,
        product_id: item.product_id,
        type: 'sale',
        quantity: -item.quantity,
        reference_type: 'sale',
        reference_id: saleId,
        performed_by: p_recorded_by,
        notes: p_party_id ? 'Sale to party' : 'Sale to walk-in',
        created_at: now,
      });
      store._nextId.inventory_transactions = txnId + 1;
    }

    saveStore(store);
    return saleId;
  },

  // approve_issue(session_id, approver_id) — admin approves a stock issue.
  approve_issue({ p_session_id, p_approver_id }) {
    const store = getStore();
    const sIdx = store.checkout_sessions.findIndex(s => s.id === p_session_id);
    if (sIdx === -1) throw new Error(`Session ${p_session_id} not found`);
    const session = store.checkout_sessions[sIdx];
    if (session.status !== 'pending_issue') throw new Error(`Session ${p_session_id} is not pending_issue`);

    const items = store.checkout_items.filter(i => i.session_id === p_session_id);
    const now = new Date().toISOString();

    for (const item of items) {
      const pIdx = store.products.findIndex(p => p.id === item.product_id);
      if (pIdx === -1) continue;
      const newStock = (store.products[pIdx].current_stock || 0) - item.checkout_quantity;
      if (newStock < 0) throw new Error(`Insufficient stock for ${store.products[pIdx].name}`);
      store.products[pIdx].current_stock = newStock;
      store.products[pIdx].updated_at = now;

      const txnId = store._nextId.inventory_transactions || 1;
      store.inventory_transactions.push({
        id: txnId,
        product_id: item.product_id,
        type: 'checkout',
        quantity: -item.checkout_quantity,
        reference_type: 'checkout_session',
        reference_id: p_session_id,
        performed_by: p_approver_id,
        notes: 'Approved issue to seller',
        created_at: now,
      });
      store._nextId.inventory_transactions = txnId + 1;
    }

    store.checkout_sessions[sIdx] = {
      ...session,
      status: 'checked_out',
      approved_by: p_approver_id,
      approved_at: now,
      updated_at: now,
    };

    saveStore(store);
    return null;
  },

  // approve_return(session_id, approver_id) — admin approves a return.
  approve_return({ p_session_id, p_approver_id }) {
    const store = getStore();
    const sIdx = store.checkout_sessions.findIndex(s => s.id === p_session_id);
    if (sIdx === -1) throw new Error(`Session ${p_session_id} not found`);
    const session = store.checkout_sessions[sIdx];
    if (session.status !== 'pending_approval') throw new Error(`Session ${p_session_id} is not pending_approval`);

    const items = store.checkout_items.filter(i => i.session_id === p_session_id && (i.checkin_quantity || 0) > 0);
    const now = new Date().toISOString();

    for (const item of items) {
      const pIdx = store.products.findIndex(p => p.id === item.product_id);
      if (pIdx === -1) continue;
      store.products[pIdx].current_stock = (store.products[pIdx].current_stock || 0) + item.checkin_quantity;
      store.products[pIdx].updated_at = now;

      const txnId = store._nextId.inventory_transactions || 1;
      store.inventory_transactions.push({
        id: txnId,
        product_id: item.product_id,
        type: 'checkin',
        quantity: item.checkin_quantity,
        reference_type: 'checkout_session',
        reference_id: p_session_id,
        performed_by: p_approver_id,
        notes: 'Approved return — stock restored',
        created_at: now,
      });
      store._nextId.inventory_transactions = txnId + 1;
    }

    store.checkout_sessions[sIdx] = {
      ...session,
      status: 'checked_in',
      approved_by: p_approver_id,
      approved_at: now,
      updated_at: now,
    };

    saveStore(store);
    return null;
  },

  // delete_sale(sale_id, performer_id) — restore stock, cascade-delete the sale.
  // Also fixes ISSUE-001 (demo had no FK cascade for sale_items).
  delete_sale({ p_sale_id, p_performer_id }) {
    const store = getStore();
    const sale = store.sales.find(s => s.id === p_sale_id);
    if (!sale) throw new Error(`Sale ${p_sale_id} does not exist`);

    const items = store.sale_items.filter(si => si.sale_id === p_sale_id);
    const now = new Date().toISOString();

    for (const item of items) {
      const pIdx = store.products.findIndex(p => p.id === item.product_id);
      if (pIdx === -1) continue;
      store.products[pIdx].current_stock = (store.products[pIdx].current_stock || 0) + item.quantity;
      store.products[pIdx].updated_at = now;

      const txnId = store._nextId.inventory_transactions || 1;
      store.inventory_transactions.push({
        id: txnId,
        product_id: item.product_id,
        type: 'sale_delete',
        quantity: item.quantity,
        reference_type: 'sale',
        reference_id: p_sale_id,
        performed_by: p_performer_id,
        notes: 'Sale deleted — stock restored',
        created_at: now,
      });
      store._nextId.inventory_transactions = txnId + 1;
    }

    // Cascade delete sale_items, then the sale itself.
    store.sale_items = store.sale_items.filter(si => si.sale_id !== p_sale_id);
    store.sales = store.sales.filter(s => s.id !== p_sale_id);

    saveStore(store);
    return null;
  },
};

// ============================================
// PUBLIC API — works in both demo & production
// ============================================
export const db = {
  isDemoMode,

  // Single-page read.
  // options:
  //   orderBy: [field, 'asc'|'desc']
  //   filter: (row) => boolean      (demo mode only — Supabase ignores this)
  //   eq:     { col: val, ... }     (server-side equality filter; works in both modes)
  //   limit:  number                (caps rows returned)
  //   offset: number                (skips this many rows; uses .range() in prod)
  //
  // NOTE: Supabase REST defaults to a max of 1000 rows per request.
  // If you need ALL rows for an aggregation, use db.fetchAllPaged(...) instead.
  async getAll(table, options = {}) {
    if (isDemoMode) {
      let data = demo.getAll(table);
      if (options.filter) data = data.filter(options.filter);
      if (options.eq) {
        for (const [col, val] of Object.entries(options.eq)) {
          data = data.filter(r => r[col] === val);
        }
      }
      if (options.orderBy) {
        const [field, dir] = options.orderBy;
        data.sort((a, b) => {
          if (dir === 'desc') return a[field] > b[field] ? -1 : 1;
          return a[field] > b[field] ? 1 : -1;
        });
      }
      const offset = options.offset || 0;
      const end = options.limit != null ? offset + options.limit : undefined;
      data = data.slice(offset, end);
      return { data, error: null };
    }
    let q = supabase.from(table).select('*');
    if (options.eq) {
      for (const [col, val] of Object.entries(options.eq)) {
        q = q.eq(col, val);
      }
    }
    if (options.orderBy) q = q.order(options.orderBy[0], { ascending: options.orderBy[1] !== 'desc' });
    if (options.limit != null) {
      const offset = options.offset || 0;
      q = q.range(offset, offset + options.limit - 1);
    } else if (options.offset != null) {
      // offset without limit — use a big range
      q = q.range(options.offset, options.offset + 999);
    }
    return await q;
  },

  // Chunked full-table read for aggregations.
  // Pages through the table in CHUNK-sized requests so we don't silently
  // truncate at Supabase's 1000-row default. Use this anywhere code computes
  // sums, counts, or "all-time" stats over a high-volume table
  // (sales, inventory_transactions, payment_followups, sale_items).
  async fetchAllPaged(table, options = {}) {
    const CHUNK = 1000;
    if (isDemoMode) {
      // Demo mode is in-memory, no truncation risk — just delegate.
      return await this.getAll(table, options);
    }
    let all = [];
    let offset = 0;
    while (true) {
      let q = supabase.from(table).select('*');
      if (options.orderBy) q = q.order(options.orderBy[0], { ascending: options.orderBy[1] !== 'desc' });
      q = q.range(offset, offset + CHUNK - 1);
      const { data, error } = await q;
      if (error) return { data: null, error };
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < CHUNK) break;
      offset += CHUNK;
    }
    return { data: all, error: null };
  },

  async getById(table, id) {
    if (isDemoMode) return { data: demo.getById(table, id), error: null };
    return await supabase.from(table).select('*').eq('id', id).single();
  },

  async insert(table, record) {
    if (isDemoMode) return { data: demo.insert(table, record), error: null };
    return await supabase.from(table).insert(record).select().single();
  },

  async update(table, id, updates) {
    if (isDemoMode) return { data: demo.update(table, id, updates), error: null };
    return await supabase.from(table).update(updates).eq('id', id).select().single();
  },

  async delete(table, id) {
    if (isDemoMode) { demo.delete(table, id); return { error: null }; }
    return await supabase.from(table).delete().eq('id', id);
  },

  // Call a Postgres function (RPC).
  // In demo mode this dispatches to the local demoRpc handlers, which
  // mirror the Postgres functions in migration 006. Same call shape:
  //   await db.rpc('record_sale', { p_party_id: 1, p_items: [...], ... })
  // Returns { data, error } in both modes.
  async rpc(fnName, params) {
    if (isDemoMode) {
      const handler = demoRpc[fnName];
      if (!handler) {
        return { data: null, error: { message: `Unknown RPC in demo mode: ${fnName}` } };
      }
      try {
        return { data: handler(params || {}), error: null };
      } catch (err) {
        return { data: null, error: { message: err.message || String(err) } };
      }
    }
    return await supabase.rpc(fnName, params);
  },

  async query(table, filterFn) {
    if (isDemoMode) return { data: demo.query(table, filterFn), error: null };
    return await supabase.from(table).select('*');
  }
};

// ============================================
// AUTH
// ============================================
export const auth = {
  currentUser: null,

  async login(email, password) {
    if (isDemoMode) {
      initStore();
      const profiles = demo.getAll('profiles');
      // Demo login: admin@narmadaessence.com / admin123
      // seller1@narmadaessence.com / seller123
      const user = profiles.find(p => p.email === email);
      if (!user) return { user: null, error: { message: 'Invalid email or password' } };
      // Simple demo password check
      if ((user.role === 'admin' && password === 'admin123') ||
          (user.role === 'seller' && password === 'seller123')) {
        this.currentUser = user;
        localStorage.setItem('narmada_user', JSON.stringify(user));
        return { user, error: null };
      }
      return { user: null, error: { message: 'Invalid email or password' } };
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { user: null, error };
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    this.currentUser = profile;
    return { user: profile, error: null };
  },

  async logout() {
    if (isDemoMode) {
      this.currentUser = null;
      localStorage.removeItem('narmada_user');
      return;
    }
    await supabase.auth.signOut();
    this.currentUser = null;
  },

  async getSession() {
    if (isDemoMode) {
      initStore();
      const saved = localStorage.getItem('narmada_user');
      if (saved) {
        this.currentUser = JSON.parse(saved);
        return this.currentUser;
      }
      return null;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    this.currentUser = profile;
    return profile;
  },

  isAdmin() { return this.currentUser?.role === 'admin'; },
  isSeller() { return this.currentUser?.role === 'seller'; }
};

export default { db, auth };
