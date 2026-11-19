import { createClient } from '@supabase/supabase-js';
import { showToast } from './utils/helpers.js';

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    // localStorage caps at ~5MB — surface the failure so it's not silent.
    if (err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 'QUOTA_EXCEEDED_ERR')) {
      console.error('[demo-store] localStorage quota exceeded — clear demo data via DevTools > Application > Local Storage.', err);
      // Warn the user once per session.
      if (typeof window !== 'undefined' && !window.__demoQuotaWarned) {
        window.__demoQuotaWarned = true;
        try { showToast('Demo storage full — clear localStorage to continue.', 'error'); } catch { /* swallow */ }
      }
    }
    throw err;
  }
}

// Default matching tolerances for the daily return cross-check
// (app_settings rows; editable in Settings → Stock Rules).
const DEFAULT_APP_SETTINGS = [
  { id: 1, key: 'liquid_tolerance_kg', value: 0.010 },
  { id: 2, key: 'unit_tolerance', value: 0 },
];

function isMachineProduct(store, product) {
  const cat = (store.categories || []).find(c => c.id === product?.category_id);
  if (!cat || cat.type === 'liquid') return false;
  return !/refill|oil/i.test(cat.name || '');
}

// Same rule as the fragrance pre-fill in migration 016: strip leading
// non-letters and a trailing "Diffuser Oil" / "Refill" / "Oil", title-case.
function deriveFragrance(name) {
  const base = String(name || '')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/\s*(diffuser\s+oil|refill|oil)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return base ? base.replace(/\b[a-z]/g, ch => ch.toUpperCase()) : null;
}

// Bring a demo store saved by an older app version up to the current shape.
// Returns true when something was added.
function ensureStoreShape(store) {
  let changed = false;
  const tables = ['checkout_usage', 'stock_adjustments', 'installations', 'app_settings'];
  for (const table of tables) {
    if (!Array.isArray(store[table])) {
      store[table] = table === 'app_settings' ? DEFAULT_APP_SETTINGS.map(s => ({ ...s })) : [];
      changed = true;
    }
  }
  store._nextId = store._nextId || {};
  for (const table of tables) {
    if (store._nextId[table] == null) {
      store._nextId[table] = store[table].reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
      changed = true;
    }
  }
  for (const product of store.products || []) {
    if (product.fragrance === undefined) {
      product.fragrance = isMachineProduct(store, product) ? null : deriveFragrance(product.name);
      changed = true;
    }
  }
  return changed;
}

function initStore() {
  const existing = getStore();
  if (existing) {
    if (ensureStoreShape(existing)) saveStore(existing);
    return;
  }
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
      { id: 1, name: 'NE 001 — Automatic Fragrance Dispenser', category_id: 1, type: 'unit', model_number: 'NE-001', unit_price: 1200, current_stock: 25, sell_qty: 0, installed_qty: 0, min_stock_threshold: 5, max_daily_consumption: 3, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 2, name: 'NE 002 — Modern Fragrance Dispenser', category_id: 1, type: 'unit', model_number: 'NE-002', unit_price: 1400, current_stock: 18, sell_qty: 0, installed_qty: 0, min_stock_threshold: 5, max_daily_consumption: 3, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 3, name: 'NE 003 — Refined Dispenser', category_id: 1, type: 'unit', model_number: 'NE-003', unit_price: 1800, current_stock: 12, sell_qty: 0, installed_qty: 0, min_stock_threshold: 4, max_daily_consumption: 2, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 4, name: 'NE 004 — Luxe Dispenser', category_id: 1, type: 'unit', model_number: 'NE-004', unit_price: 2000, current_stock: 15, sell_qty: 0, installed_qty: 0, min_stock_threshold: 4, max_daily_consumption: 2, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 5, name: 'NE 005 — Premium Living Diffuser', category_id: 2, type: 'unit', model_number: 'NE-005', unit_price: 20000, current_stock: 8, sell_qty: 0, installed_qty: 0, min_stock_threshold: 2, max_daily_consumption: 1, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 6, name: 'NE 006 — Luxury Smart Diffuser', category_id: 2, type: 'unit', model_number: 'NE-006', unit_price: 22000, current_stock: 6, sell_qty: 0, installed_qty: 0, min_stock_threshold: 2, max_daily_consumption: 1, expiry_date: null, is_active: true, created_at: now, updated_at: now },
      { id: 7, name: 'Black Touch Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 40, sell_qty: 0, installed_qty: 0, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 8, name: 'Pleasure Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 35, sell_qty: 0, installed_qty: 0, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 9, name: 'Lavender Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 30, sell_qty: 0, installed_qty: 0, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 10, name: 'Green Apple Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 3, sell_qty: 0, installed_qty: 0, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 11, name: 'Expression Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 28, sell_qty: 0, installed_qty: 0, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-05-20', is_active: true, created_at: now, updated_at: now },
      { id: 12, name: 'Mischief Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 22, sell_qty: 0, installed_qty: 0, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-07-10', is_active: true, created_at: now, updated_at: now },
      { id: 13, name: 'Cool Water Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 8, sell_qty: 0, installed_qty: 0, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-04-30', is_active: true, created_at: now, updated_at: now },
      { id: 14, name: 'Decor Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 20, sell_qty: 0, installed_qty: 0, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 15, name: 'Rose Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 15, sell_qty: 0, installed_qty: 0, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-08-20', is_active: true, created_at: now, updated_at: now },
      { id: 16, name: 'Sandal Refill', category_id: 3, type: 'unit', model_number: null, unit_price: 450, current_stock: 18, sell_qty: 0, installed_qty: 0, min_stock_threshold: 10, max_daily_consumption: 5, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 17, name: 'Cool Water Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 8000, current_stock: 5, sell_qty: 0, installed_qty: 0, min_stock_threshold: 1, max_daily_consumption: 0.2, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 18, name: 'Western Lavender Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 8000, current_stock: 4.5, sell_qty: 0, installed_qty: 0, min_stock_threshold: 1, max_daily_consumption: 0.2, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 19, name: 'Gucci Oud Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 10000, current_stock: 0.8, sell_qty: 0, installed_qty: 0, min_stock_threshold: 1, max_daily_consumption: 0.15, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 20, name: 'White Musk 3N Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 9000, current_stock: 3.5, sell_qty: 0, installed_qty: 0, min_stock_threshold: 1, max_daily_consumption: 0.2, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
      { id: 21, name: 'Royal Oud Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 12000, current_stock: 2, sell_qty: 0, installed_qty: 0, min_stock_threshold: 1, max_daily_consumption: 0.15, expiry_date: '2028-08-01', is_active: true, created_at: now, updated_at: now },
      { id: 22, name: 'Cherry Blossom Diffuser Oil', category_id: 4, type: 'liquid', model_number: null, unit_price: 7000, current_stock: 6, sell_qty: 0, installed_qty: 0, min_stock_threshold: 1, max_daily_consumption: 0.2, expiry_date: '2028-06-15', is_active: true, created_at: now, updated_at: now },
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
    payment_followups: [],
    refill_completions: [],
    _nextId: { checkout_sessions: 1, checkout_items: 1, sales: 1, sale_items: 1, rentals: 1, inventory_transactions: 1, damage_reports: 1, stock_intakes: 1, payment_followups: 1, refill_completions: 1, parties: 4, products: 23, categories: 6 }
  });
  const seeded = getStore();
  ensureStoreShape(seeded);
  saveStore(seeded);
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
    // A caller-supplied text id (profiles, like Supabase auth UUIDs) is kept; otherwise use the counter.
    const keepId = typeof record.id === 'string' && record.id !== '';
    const newRecord = { ...record, id: keepId ? record.id : nextId, created_at: new Date().toISOString() };
    if (!Array.isArray(store[table])) store[table] = [];
    store[table].push(newRecord);
    if (!keepId) store._nextId[table] = nextId + 1;
    saveStore(store);
    return newRecord;
  },
  update(table, id, updates) {
    const store = getStore();
    if (!Array.isArray(store[table])) return null;
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

function roundMoney(amount) {
  return Math.round(Number(amount || 0) * 100) / 100;
}

function normalizeSaleItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Sale must have at least one item');
  }
  return items.map(item => {
    const productId = Number(item.product_id);
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error('Invalid sale item');
    }
    return {
      product_id: productId,
      quantity,
      unit_price: unitPrice,
      line_total: roundMoney(quantity * unitPrice),
    };
  });
}

function assertStockAvailableForSale(store, newItems, restoreByProduct = {}) {
  const qtyByProduct = {};
  for (const item of newItems) {
    const product = store.products.find(p => p.id === item.product_id);
    if (!product) throw new Error(`Product ${item.product_id} not found`);
    qtyByProduct[item.product_id] = (qtyByProduct[item.product_id] || 0) + item.quantity;
  }

  for (const [rawProductId, quantity] of Object.entries(qtyByProduct)) {
    const productId = Number(rawProductId);
    const product = store.products.find(p => p.id === productId);
    const available = Number(product?.current_stock || 0) + Number(restoreByProduct[productId] || 0);
    if (available - quantity < 0) {
      throw new Error(`Insufficient stock for ${product?.name || `product ${productId}`}`);
    }
  }
}

function applyStockDelta(store, productId, delta) {
  const pIdx = store.products.findIndex(p => p.id === productId);
  if (pIdx === -1) throw new Error(`Product ${productId} not found`);
  const newStock = Number(store.products[pIdx].current_stock || 0) + Number(delta || 0);
  if (newStock < 0) throw new Error(`Insufficient stock for ${store.products[pIdx].name}`);
  store.products[pIdx].current_stock = newStock;
  store.products[pIdx].updated_at = new Date().toISOString();
  return newStock;
}

function normalizePaymentAmount(paymentStatus, amountReceived, total) {
  const amount = paymentStatus === 'paid'
    ? roundMoney(total)
    : roundMoney(amountReceived || 0);
  if (amount < 0 || amount > total) {
    throw new Error('Amount received cannot exceed sale total');
  }
  return amount;
}

// Issue lines: { product_id, quantity } or an "Any <category>" line
// { category_id, quantity } (migration 018).
function normalizeCheckoutItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one checkout item is required');
  }
  return items.map(item => {
    const productId = item.product_id ? Number(item.product_id) : null;
    const categoryId = item.category_id ? Number(item.category_id) : null;
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || (!productId && !categoryId) || (productId && categoryId)) {
      throw new Error('Invalid checkout item');
    }
    return { product_id: productId, category_id: categoryId, quantity };
  });
}

// --- "Any <category>" lines and field-stock bills (mirror of migration 018) ---
const EPS = 1e-9;
const isAnyLine = item => item.product_id == null && item.parent_item_id == null;

function heldQty(store, categoryId, excludeSessionId = null) {
  const open = new Set(store.checkout_sessions
    .filter(s => ['checked_out', 'pending_approval'].includes(s.status) && s.id !== excludeSessionId)
    .map(s => s.id));
  return round3(store.checkout_items
    .filter(i => isAnyLine(i) && i.category_id === categoryId && open.has(i.session_id))
    .reduce((sum, i) => sum + Number(i.checkout_quantity || 0), 0));
}

// A product line counts against its product's category, even if the row also
// carries a category_id.
function lineCategoryId(store, item) {
  if (item.product_id != null) return store.products.find(p => p.id === item.product_id)?.category_id ?? item.category_id ?? null;
  return item.category_id ?? null;
}

// check_issue_availability: validate a session's issue lines before any deduction.
function checkIssueAvailability(store, sessionId) {
  const lines = store.checkout_items.filter(i => i.session_id === sessionId && i.parent_item_id == null);
  const anyCats = new Set();
  for (const line of lines.filter(isAnyLine)) {
    const cat = (store.categories || []).find(c => c.id === line.category_id);
    if (!cat) throw new Error('Invalid issue line: choose a product or a category');
    const qty = Number(line.checkout_quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Quantity for Any ${cat.name} must be greater than zero`);
    if (cat.type === 'unit' && !Number.isInteger(qty)) throw new Error(`Any ${cat.name} must be whole pieces`);
    if (anyCats.has(cat.id)) throw new Error(`Any ${cat.name} is listed twice; combine it into one line`);
    anyCats.add(cat.id);
  }

  const byProduct = {};
  for (const line of lines.filter(l => l.product_id != null)) {
    byProduct[line.product_id] = (byProduct[line.product_id] || 0) + Number(line.checkout_quantity || 0);
  }
  for (const [pid, qty] of Object.entries(byProduct)) {
    const product = store.products.find(p => p.id === Number(pid));
    if (!product) throw new Error(`Product ${pid} does not exist`);
    if (qty > Number(product.current_stock || 0) + EPS) throw new Error(`Insufficient stock for ${product.name}`);
  }

  const cats = new Set(lines.map(l => lineCategoryId(store, l)).filter(id => id != null));
  for (const catId of cats) {
    const cat = (store.categories || []).find(c => c.id === catId);
    const stock = store.products.filter(p => p.category_id === catId)
      .reduce((sum, p) => sum + Math.max(Number(p.current_stock || 0), 0), 0);
    const held = heldQty(store, catId, sessionId);
    const wanted = lines.filter(l => lineCategoryId(store, l) === catId)
      .reduce((sum, l) => sum + Number(l.checkout_quantity || 0), 0);
    if (wanted > stock - held + EPS) {
      throw new Error(`Not enough ${cat?.name || 'stock'} in the warehouse: ${round3(Math.max(stock - held, 0))} free (${held} out with staff as Any), ${round3(wanted)} asked`);
    }
  }
}

// check_field_sale_capacity: bills linked to a session sell only what it issued.
function checkFieldSaleCapacity(store, sessionId) {
  const saleIds = new Set(store.sales.filter(s => s.checkout_session_id === sessionId).map(s => s.id));
  const sold = {};
  store.sale_items.filter(si => saleIds.has(si.sale_id)).forEach(si => {
    sold[si.product_id] = (sold[si.product_id] || 0) + Number(si.quantity || 0);
  });
  const lines = store.checkout_items.filter(i => i.session_id === sessionId && i.parent_item_id == null);
  const overflowByCat = {};
  for (const [pid, qty] of Object.entries(sold)) {
    const product = store.products.find(p => p.id === Number(pid));
    const specific = lines.filter(l => l.product_id === Number(pid)).reduce((s, l) => s + Number(l.checkout_quantity || 0), 0);
    const overflow = Math.max(qty - specific, 0);
    if (overflow > EPS) {
      if (!lines.some(l => isAnyLine(l) && l.category_id === product?.category_id)) {
        throw new Error(`${product?.name || 'Product'} was not issued to this staff member (or more is billed than was issued)`);
      }
      overflowByCat[product.category_id] = (overflowByCat[product.category_id] || 0) + overflow;
    }
  }
  for (const [catId, overflow] of Object.entries(overflowByCat)) {
    const anyLine = lines.find(l => isAnyLine(l) && l.category_id === Number(catId));
    const cat = (store.categories || []).find(c => c.id === Number(catId));
    if (overflow > Number(anyLine.checkout_quantity) + EPS) {
      throw new Error(`Bills sell ${round3(overflow)} from Any ${cat?.name || 'category'}, but only ${anyLine.checkout_quantity} were issued`);
    }
  }
}

function assertOpenFieldSession(store, sessionId, actorId) {
  const session = store.checkout_sessions.find(s => s.id === Number(sessionId));
  if (!session) throw new Error(`Session ${sessionId} not found`);
  const actor = (store.profiles || []).find(p => p.id === actorId);
  if (actor?.role !== 'admin' && session.seller_id !== actorId) {
    throw new Error('You can only bill from your own field stock');
  }
  if (session.status !== 'checked_out') {
    throw new Error(`Field stock of session ${session.id} is not open (its return was already submitted)`);
  }
  return session;
}

function nextId(store, table) {
  const id = store._nextId[table] || 1;
  store._nextId[table] = id + 1;
  return id;
}

function addInventoryTransaction(store, { product_id, type, quantity, reference_type, reference_id, performed_by, notes, created_at }) {
  const txnId = store._nextId.inventory_transactions || 1;
  store.inventory_transactions.push({
    id: txnId,
    product_id,
    type,
    quantity,
    reference_type,
    reference_id,
    performed_by,
    notes,
    created_at,
  });
  store._nextId.inventory_transactions = txnId + 1;
}

// --- Daily return cross-check (mirror of migration 016) ---------------------
const USAGE_REASON_KEYS = ['customer_service', 'installation', 'other'];
const DISCREPANCY_TYPE_KEYS = ['wastage', 'loss', 'staff_shortage', 'counting_error', 'excess_return', 'other'];
// Fallback daily limit for products without max_daily_consumption (also in migration 016).
const DEFAULT_DAILY_CONSUMPTION = 30;

function round3(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

function todayISODate() {
  return new Date().toISOString().split('T')[0];
}

function assertDemoAdmin(store, userId, message) {
  const profile = (store.profiles || []).find(p => p.id === userId);
  if (profile?.role !== 'admin') throw new Error(message);
}

function toleranceFor(store, productType) {
  const key = productType === 'liquid' ? 'liquid_tolerance_kg' : 'unit_tolerance';
  const row = (store.app_settings || []).find(s => s.key === key);
  const value = Number(row?.value);
  if (Number.isFinite(value) && value >= 0) return value;
  return DEFAULT_APP_SETTINGS.find(s => s.key === key).value;
}

function formatQtyText(qty, productType) {
  return productType === 'liquid' ? `${Number(qty).toFixed(3)} kg` : `${qty} pcs`;
}

// ============================================
// DEMO RPC HANDLERS — mirror the Postgres functions in migration 006.
// Same signatures, same param names, so the same client code path works
// in both demo (localStorage) and production (supabase.rpc) modes.
// ============================================
const demoRpc = {
  // adjust_stock(product_id, delta) — atomic-ish stock change with negative guard.
  adjust_stock({ p_product_id, p_delta }) {
    const store = getStore();
    const newStock = applyStockDelta(store, p_product_id, p_delta);
    saveStore(store);
    return newStock;
  },

  // record_sale(...) — insert sale + line items + deduct stock + log transactions.
  // p_items: [{ product_id, quantity, unit_price }, ...]
  // p_checkout_session_id (migration 018): bill from the staff member's open
  // field stock — no warehouse stock change; the session's return books it.
  record_sale({ p_party_id, p_items, p_payment_status, p_payment_method, p_amount_received, p_expected_payment_date, p_sale_date, p_notes, p_recorded_by, p_sale_type, p_checkout_session_id = null }) {
    const store = getStore();
    const now = new Date().toISOString();
    const items = normalizeSaleItems(p_items);
    const fieldSession = p_checkout_session_id ? assertOpenFieldSession(store, p_checkout_session_id, p_recorded_by) : null;
    if (!fieldSession) assertStockAvailableForSale(store, items);
    const recordedBy = fieldSession ? fieldSession.seller_id : p_recorded_by;
    if (!['paid', 'partial', 'pending'].includes(p_payment_status)) {
      throw new Error('Invalid payment status');
    }
    const saleType = p_sale_type || 'gst';
    if (!['gst', 'cash'].includes(saleType)) {
      throw new Error('Invalid sale type');
    }

    // Round to 2 dp to match DECIMAL(12,2) in production.
    const total = roundMoney(items.reduce((s, i) => s + i.line_total, 0));
    const amountReceived = normalizePaymentAmount(p_payment_status, p_amount_received, total);

    const saleId = store._nextId.sales || 1;
    store.sales.push({
      id: saleId,
      party_id: p_party_id,
      total_amount: total,
      payment_status: p_payment_status,
      payment_method: p_payment_method,
      amount_received: amountReceived,
      expected_payment_date: p_payment_status === 'paid' ? null : p_expected_payment_date,
      sale_date: p_sale_date,
      notes: p_notes,
      recorded_by: recordedBy,
      sale_type: saleType,
      checkout_session_id: fieldSession ? fieldSession.id : null,
      created_at: now,
    });
    store._nextId.sales = saleId + 1;

    for (const item of items) {
      const siId = store._nextId.sale_items || 1;
      store.sale_items.push({
        id: siId,
        sale_id: saleId,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total,
        created_at: now,
      });
      store._nextId.sale_items = siId + 1;

      if (fieldSession) continue;
      applyStockDelta(store, item.product_id, -item.quantity);

      addInventoryTransaction(store, {
        product_id: item.product_id,
        type: 'sale',
        quantity: -item.quantity,
        reference_type: 'sale',
        reference_id: saleId,
        performed_by: recordedBy,
        notes: p_party_id ? 'Sale to party' : 'Sale to walk-in',
        created_at: now,
      });
    }

    if (fieldSession) checkFieldSaleCapacity(store, fieldSession.id);

    saveStore(store);
    return saleId;
  },

  // update_sale(...) — replace bill line items, re-balance stock, update payment metadata.
  update_sale({ p_sale_id, p_party_id, p_items, p_payment_status, p_payment_method, p_amount_received, p_expected_payment_date, p_sale_date, p_notes, p_performer_id, p_sale_type }) {
    const store = getStore();
    const saleIdx = store.sales.findIndex(s => s.id === p_sale_id);
    if (saleIdx === -1) throw new Error(`Sale ${p_sale_id} does not exist`);

    const now = new Date().toISOString();
    const newItems = normalizeSaleItems(p_items);
    if (!['paid', 'partial', 'pending'].includes(p_payment_status)) {
      throw new Error('Invalid payment status');
    }
    const saleType = p_sale_type || 'gst';
    if (!['gst', 'cash'].includes(saleType)) {
      throw new Error('Invalid sale type');
    }
    const oldItems = store.sale_items.filter(si => si.sale_id === p_sale_id);
    const restoreByProduct = {};
    for (const item of oldItems) {
      restoreByProduct[item.product_id] = (restoreByProduct[item.product_id] || 0) + item.quantity;
    }
    const fieldSessionId = store.sales[saleIdx].checkout_session_id || null;
    const fieldStatus = fieldSessionId ? store.checkout_sessions.find(s => s.id === fieldSessionId)?.status : null;
    if (fieldSessionId) {
      const net = { ...restoreByProduct };
      newItems.forEach(i => { net[i.product_id] = (net[i.product_id] || 0) - i.quantity; });
      const itemsChanged = Object.values(net).some(q => Math.abs(q) > EPS);
      if (itemsChanged && fieldStatus === 'pending_approval') {
        throw new Error(`Bill #${p_sale_id} is part of a submitted field return. Send the return back first, then change its items`);
      }
      if (itemsChanged && fieldStatus !== 'checked_out') {
        throw new Error(`Bill #${p_sale_id} was settled in an approved field return; its products and quantities can no longer change`);
      }
    } else {
      assertStockAvailableForSale(store, newItems, restoreByProduct);
    }
    const total = roundMoney(newItems.reduce((s, i) => s + i.line_total, 0));
    const amountReceived = normalizePaymentAmount(p_payment_status, p_amount_received, total);

    for (const item of oldItems) {
      if (fieldSessionId) break;
      applyStockDelta(store, item.product_id, item.quantity);
      addInventoryTransaction(store, {
        product_id: item.product_id,
        type: 'sale_edit_restore',
        quantity: item.quantity,
        reference_type: 'sale',
        reference_id: p_sale_id,
        performed_by: p_performer_id,
        notes: 'Sale edited - old item stock restored',
        created_at: now,
      });
    }

    store.sale_items = store.sale_items.filter(si => si.sale_id !== p_sale_id);
    store.sales[saleIdx] = {
      ...store.sales[saleIdx],
      party_id: p_party_id,
      total_amount: total,
      payment_status: p_payment_status,
      payment_method: p_payment_method,
      amount_received: amountReceived,
      expected_payment_date: p_payment_status === 'paid' ? null : p_expected_payment_date,
      sale_date: p_sale_date,
      notes: p_notes,
      sale_type: saleType,
      updated_at: now,
    };

    for (const item of newItems) {
      const siId = store._nextId.sale_items || 1;
      store.sale_items.push({
        id: siId,
        sale_id: p_sale_id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total,
        created_at: now,
      });
      store._nextId.sale_items = siId + 1;

      if (fieldSessionId) continue;
      applyStockDelta(store, item.product_id, -item.quantity);
      addInventoryTransaction(store, {
        product_id: item.product_id,
        type: 'sale_edit',
        quantity: -item.quantity,
        reference_type: 'sale',
        reference_id: p_sale_id,
        performed_by: p_performer_id,
        notes: 'Sale edited - new item stock deducted',
        created_at: now,
      });
    }

    if (fieldSessionId && fieldStatus === 'checked_out') checkFieldSaleCapacity(store, fieldSessionId);

    // Handle syncing with payment_followups
    const oldCollected = store.payment_followups
      .filter(f => f.sale_id === p_sale_id)
      .reduce((sum, f) => sum + (f.amount_collected || 0), 0);
    const diff = roundMoney(amountReceived - oldCollected);

    if (diff !== 0) {
      const fuId = store._nextId.payment_followups || 1;
      store.payment_followups.push({
        id: fuId,
        sale_id: p_sale_id,
        party_id: p_party_id,
        visited_by: p_performer_id,
        visit_date: now,
        status_update: p_payment_status,
        payment_method: p_payment_method || null,
        amount_collected: diff,
        expected_payment_date: p_payment_status === 'paid' ? null : p_expected_payment_date,
        notes: 'Admin edit bill correction',
        created_at: now,
      });
      store._nextId.payment_followups = fuId + 1;
    }

    saveStore(store);
    return null;
  },

  record_payment_followup({ p_sale_id, p_party_id, p_status_update, p_payment_method, p_amount_collected, p_expected_payment_date, p_notes, p_visited_by }) {
    const store = getStore();
    const now = new Date().toISOString();
    const amount = roundMoney(p_amount_collected || 0);
    if (amount < 0) throw new Error('Amount collected cannot be negative');

    let partyId = p_party_id ? Number(p_party_id) : null;
    if (p_sale_id) {
      const saleIdx = store.sales.findIndex(s => s.id === p_sale_id);
      if (saleIdx === -1) throw new Error(`Sale ${p_sale_id} does not exist`);
      const sale = store.sales[saleIdx];
      if (sale.party_id) {
        if (partyId && Number(partyId) !== Number(sale.party_id)) {
          throw new Error('Followup party must match linked sale party');
        }
        partyId = sale.party_id;
      }
      const balance = roundMoney((sale.total_amount || 0) - (sale.amount_received || 0));
      if (amount > balance) throw new Error('Amount collected cannot exceed sale balance');
      if (p_status_update === 'paid' && amount < balance) {
        throw new Error('Paid status requires collecting the remaining balance');
      }
      const newReceived = roundMoney((sale.amount_received || 0) + amount);
      const newStatus = newReceived >= sale.total_amount
        ? 'paid'
        : (newReceived > 0 || p_status_update === 'partial') ? 'partial' : 'pending';
      store.sales[saleIdx] = {
        ...sale,
        amount_received: newReceived,
        payment_status: newStatus,
        payment_method: p_payment_method || sale.payment_method,
        expected_payment_date: newStatus === 'paid' ? null : (p_expected_payment_date || sale.expected_payment_date),
        updated_at: now,
      };
    }

    if (!partyId) throw new Error('Party is required for a followup');
    const followupId = store._nextId.payment_followups || 1;
    store.payment_followups.push({
      id: followupId,
      sale_id: p_sale_id || null,
      party_id: partyId,
      visited_by: p_visited_by,
      visit_date: now,
      status_update: p_status_update,
      payment_method: p_payment_method || null,
      amount_collected: amount,
      expected_payment_date: p_expected_payment_date || null,
      notes: p_notes,
      created_at: now,
    });
    store._nextId.payment_followups = followupId + 1;
    saveStore(store);
    return followupId;
  },

  set_product_stock({ p_product_id, p_new_stock, p_performer_id, p_notes }) {
    const store = getStore();
    const product = store.products.find(p => p.id === p_product_id);
    if (!product) throw new Error(`Product ${p_product_id} not found`);
    const nextStock = Number(p_new_stock);
    if (!Number.isFinite(nextStock) || nextStock < 0) throw new Error('Stock cannot be negative');
    const delta = nextStock - Number(product.current_stock || 0);
    product.current_stock = nextStock;
    product.updated_at = new Date().toISOString();
    if (delta !== 0) {
      addInventoryTransaction(store, {
        product_id: p_product_id,
        type: 'adjustment',
        quantity: delta,
        reference_type: 'product',
        reference_id: p_product_id,
        performed_by: p_performer_id,
        notes: p_notes || 'Manual stock adjustment',
        created_at: new Date().toISOString(),
      });
    }
    saveStore(store);
    return nextStock;
  },

  record_stock_intake({ p_product_id, p_quantity, p_supplier, p_notes, p_received_by }) {
    const store = getStore();
    const now = new Date().toISOString();
    const quantity = Number(p_quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be greater than zero');
    const intakeId = store._nextId.stock_intakes || 1;
    store.stock_intakes.push({
      id: intakeId,
      product_id: p_product_id,
      quantity,
      supplier: p_supplier,
      notes: p_notes,
      received_by: p_received_by,
      created_at: now,
    });
    store._nextId.stock_intakes = intakeId + 1;
    applyStockDelta(store, p_product_id, quantity);
    addInventoryTransaction(store, {
      product_id: p_product_id,
      type: 'stock_in',
      quantity,
      reference_type: 'stock_intake',
      reference_id: intakeId,
      performed_by: p_received_by,
      notes: p_notes || 'Stock intake',
      created_at: now,
    });
    saveStore(store);
    return intakeId;
  },

  record_damage_loss({ p_product_id, p_damage_type, p_quantity, p_reason, p_report_date, p_reported_by }) {
    const store = getStore();
    const now = new Date().toISOString();
    const quantity = Number(p_quantity);
    if (!['damaged', 'lost', 'expired'].includes(p_damage_type)) throw new Error('Invalid damage type');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be greater than zero');
    const reportId = store._nextId.damage_reports || 1;
    store.damage_reports.push({
      id: reportId,
      product_id: p_product_id,
      damage_type: p_damage_type,
      quantity,
      reason: p_reason,
      report_date: p_report_date,
      reported_by: p_reported_by,
      created_at: now,
    });
    store._nextId.damage_reports = reportId + 1;
    applyStockDelta(store, p_product_id, -quantity);
    addInventoryTransaction(store, {
      product_id: p_product_id,
      type: 'damage',
      quantity: -quantity,
      reference_type: 'damage_report',
      reference_id: reportId,
      performed_by: p_reported_by,
      notes: `${p_damage_type}: ${p_reason || ''}`,
      created_at: now,
    });
    saveStore(store);
    return reportId;
  },

  create_rental({ p_product_id, p_party_id, p_quantity, p_rental_date, p_expected_return_date, p_rent_amount, p_notes, p_performer_id }) {
    const store = getStore();
    const now = new Date().toISOString();
    const quantity = Number(p_quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a whole number greater than zero');
    const rentalId = store._nextId.rentals || 1;
    store.rentals.push({
      id: rentalId,
      product_id: p_product_id,
      party_id: p_party_id,
      quantity,
      rental_date: p_rental_date,
      expected_return_date: p_expected_return_date,
      actual_return_date: null,
      rent_amount: p_rent_amount || 0,
      status: 'active',
      notes: p_notes,
      created_at: now,
    });
    store._nextId.rentals = rentalId + 1;
    applyStockDelta(store, p_product_id, -quantity);
    addInventoryTransaction(store, {
      product_id: p_product_id,
      type: 'rental_out',
      quantity: -quantity,
      reference_type: 'rental',
      reference_id: rentalId,
      performed_by: p_performer_id,
      notes: 'Rental out',
      created_at: now,
    });
    saveStore(store);
    return rentalId;
  },

  return_rental({ p_rental_id, p_performer_id }) {
    const store = getStore();
    const rentalIdx = store.rentals.findIndex(r => r.id === p_rental_id && r.status === 'active');
    if (rentalIdx === -1) throw new Error(`Active rental ${p_rental_id} does not exist`);
    const rental = store.rentals[rentalIdx];
    const now = new Date().toISOString();
    store.rentals[rentalIdx] = { ...rental, status: 'returned', actual_return_date: now, updated_at: now };
    applyStockDelta(store, rental.product_id, rental.quantity || 1);
    addInventoryTransaction(store, {
      product_id: rental.product_id,
      type: 'rental_return',
      quantity: rental.quantity || 1,
      reference_type: 'rental',
      reference_id: p_rental_id,
      performed_by: p_performer_id,
      notes: 'Rental returned',
      created_at: now,
    });
    saveStore(store);
    return null;
  },

  admin_issue_stock({ p_seller_id, p_items, p_approver_id }) {
    const store = getStore();
    const now = new Date().toISOString();
    const items = normalizeCheckoutItems(p_items);
    const sessionId = store._nextId.checkout_sessions || 1;
    store.checkout_sessions.push({
      id: sessionId,
      seller_id: p_seller_id,
      checkout_time: now,
      checkin_time: null,
      status: 'checked_out',
      approved_by: p_approver_id,
      approved_at: now,
      notes: '',
      created_at: now,
    });
    store._nextId.checkout_sessions = sessionId + 1;

    for (const item of items) {
      if (item.product_id && !store.products.some(p => p.id === item.product_id)) {
        throw new Error(`Product ${item.product_id} does not exist`);
      }
      store.checkout_items.push({
        id: nextId(store, 'checkout_items'),
        session_id: sessionId,
        product_id: item.product_id,
        category_id: item.category_id,
        parent_item_id: null,
        checkout_quantity: item.quantity,
        checkin_quantity: null,
        is_flagged: false,
        flag_reason: null,
        created_at: now,
      });
    }
    checkIssueAvailability(store, sessionId);

    // Product lines leave stock now; Any lines are held until the return.
    for (const item of items) {
      if (!item.product_id) continue;
      applyStockDelta(store, item.product_id, -item.quantity);
      addInventoryTransaction(store, {
        product_id: item.product_id,
        type: 'checkout',
        quantity: -item.quantity,
        reference_type: 'checkout_session',
        reference_id: sessionId,
        performed_by: p_approver_id,
        notes: 'Issued to seller',
        created_at: now,
      });
    }

    saveStore(store);
    return sessionId;
  },

  // approve_issue(session_id, approver_id) — admin approves a stock issue.
  approve_issue({ p_session_id, p_approver_id }) {
    const store = getStore();
    const sIdx = store.checkout_sessions.findIndex(s => s.id === p_session_id);
    if (sIdx === -1) throw new Error(`Session ${p_session_id} not found`);
    const session = store.checkout_sessions[sIdx];
    if (session.status !== 'pending_issue') throw new Error(`Session ${p_session_id} is not pending_issue`);

    checkIssueAvailability(store, p_session_id);
    const items = store.checkout_items.filter(i => i.session_id === p_session_id && i.product_id != null && i.parent_item_id == null);
    const now = new Date().toISOString();

    for (const item of items) {
      applyStockDelta(store, item.product_id, -item.checkout_quantity);
      addInventoryTransaction(store, {
        product_id: item.product_id,
        type: 'checkout',
        quantity: -item.checkout_quantity,
        reference_type: 'checkout_session',
        reference_id: p_session_id,
        performed_by: p_approver_id,
        notes: 'Approved issue to seller',
        created_at: now,
      });
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

  // submit_return(session_id, items, notes, submitted_by) — staff (or admin)
  // records the return. Product lines: Returned + Used (Difference = Issued −
  // Returned − Used, mismatch beyond the tolerance). Any lines (migration
  // 018): a breakdown naming the type of every piece (returned / used / lost),
  // written as child rows; the total must equal the issued quantity. "Sold"
  // usage comes from bills linked to the session, allocated to the product's
  // own lines first. No stock change until approve_return.
  submit_return({ p_session_id, p_items, p_notes, p_submitted_by }) {
    const store = getStore();
    const sIdx = store.checkout_sessions.findIndex(s => s.id === p_session_id);
    if (sIdx === -1) throw new Error(`Session ${p_session_id} not found`);
    const session = store.checkout_sessions[sIdx];
    if (session.status !== 'checked_out') throw new Error(`Session ${p_session_id} is not checked out`);
    const actor = (store.profiles || []).find(p => p.id === p_submitted_by);
    if (actor?.role !== 'admin' && session.seller_id !== p_submitted_by) {
      throw new Error('Only the assigned staff member or an admin can submit this return');
    }

    // Re-submission after "Send back": rebuild usage and child rows.
    store.checkout_items = store.checkout_items.filter(i => !(i.session_id === p_session_id && i.parent_item_id != null));
    store.checkout_usage = store.checkout_usage.filter(u => u.session_id !== p_session_id);

    const sessionItems = store.checkout_items.filter(i => i.session_id === p_session_id);
    if (!Array.isArray(p_items) || p_items.length !== sessionItems.length) {
      throw new Error('Every issued item must be included in the return');
    }

    const now = new Date().toISOString();
    const seen = new Set();
    const entries = p_items.map(input => {
      const item = sessionItems.find(i => i.id === Number(input.item_id));
      if (!item) throw new Error('Return item does not belong to this session');
      if (seen.has(item.id)) throw new Error('Return item listed twice');
      seen.add(item.id);
      return { input, item };
    });

    // Sold on bills linked to this session, per product and bill.
    const linkedSales = store.sales.filter(s => s.checkout_session_id === p_session_id).sort((a, b) => a.id - b.id);
    const soldLeft = [];
    for (const sale of linkedSales) {
      const byProduct = {};
      store.sale_items.filter(si => si.sale_id === sale.id).forEach(si => {
        byProduct[si.product_id] = (byProduct[si.product_id] || 0) + Number(si.quantity || 0);
      });
      Object.entries(byProduct).forEach(([pid, qty]) => soldLeft.push({ product_id: Number(pid), sale_id: sale.id, party_id: sale.party_id ?? null, qty }));
    }

    const usageRows = [];
    const parseUsage = (product, list) => {
      const isMachine = isMachineProduct(store, product);
      return (list || []).map(u => {
        if (!USAGE_REASON_KEYS.includes(u.reason)) throw new Error('Invalid usage reason');
        const quantity = round3(u.quantity);
        if (!Number.isFinite(Number(u.quantity)) || quantity <= 0) throw new Error('Usage quantity must be greater than zero');
        const partyId = u.party_id ? Number(u.party_id) : null;
        if (partyId && !(store.parties || []).some(p => p.id === partyId)) throw new Error(`Customer ${partyId} does not exist`);
        if (u.reason === 'installation' && isMachine) {
          if (!partyId) throw new Error(`Choose the customer where ${product.name} was installed`);
          if (!Number.isInteger(quantity)) throw new Error('Installed machines must be whole numbers');
        }
        return { reason: u.reason, quantity, party_id: partyId, notes: String(u.notes || '').trim() || null, sale_id: null };
      });
    };
    const takeSold = (productId, limit) => {
      const lines = [];
      let taken = 0;
      for (const row of soldLeft) {
        if (row.product_id !== productId || row.qty <= EPS) continue;
        const take = round3(Math.min(row.qty, limit - taken));
        if (take <= 0) break;
        lines.push({ reason: 'sold', quantity: take, party_id: row.party_id, notes: `Bill #${row.sale_id}`, sale_id: row.sale_id });
        row.qty = round3(row.qty - take);
        taken = round3(taken + take);
      }
      return lines;
    };
    const pushUsage = (item, productId, lines) => lines.forEach(u => usageRows.push({
      id: nextId(store, 'checkout_usage'), item_id: item.id, session_id: p_session_id, product_id: productId, ...u, created_at: now,
    }));
    const setItem = (id, updates) => {
      const idx = store.checkout_items.findIndex(i => i.id === id);
      store.checkout_items[idx] = { ...store.checkout_items[idx], ...updates, updated_at: now };
    };

    let hasDiscrepancy = false;

    // Pass 1: product lines, in item id order (same as allocateSold()).
    for (const { input, item } of entries.filter(e => e.item.product_id != null).sort((a, b) => a.item.id - b.item.id)) {
      const product = store.products.find(p => p.id === item.product_id);
      const rawReturned = input.returned_quantity;
      const returned = round3(rawReturned);
      if (rawReturned === null || rawReturned === undefined || rawReturned === '' || !Number.isFinite(Number(rawReturned)) || returned < 0) {
        throw new Error(`Invalid returned quantity for ${product?.name}`);
      }
      const issued = Number(item.checkout_quantity || 0);
      const usage = [...parseUsage(product, input.usage), ...takeSold(item.product_id, issued)];
      const used = round3(usage.reduce((s, u) => s + u.quantity, 0));
      const difference = round3(issued - returned - used);
      const hasMismatch = Math.abs(difference) > toleranceFor(store, product?.type) + EPS;
      const consumed = round3(issued - returned);
      const limit = Number(product?.max_daily_consumption || DEFAULT_DAILY_CONSUMPTION);
      const reasons = [];
      if (hasMismatch) {
        reasons.push(`${difference > 0 ? 'Shortage' : 'Excess'} of ${formatQtyText(Math.abs(difference), product?.type)}`);
      }
      if (consumed > limit) reasons.push(`Consumed ${consumed} exceeds daily limit ${limit}`);
      const flagReason = reasons.join('; ') || null;
      pushUsage(item, item.product_id, usage);
      setItem(item.id, {
        checkin_quantity: returned,
        used_quantity: used,
        difference,
        has_mismatch: hasMismatch,
        is_flagged: Boolean(flagReason),
        flag_reason: flagReason,
        discrepancy_type: null,
        discrepancy_note: null,
      });
      hasDiscrepancy = hasDiscrepancy || hasMismatch;
    }

    // Pass 2: Any lines — every piece named by type.
    for (const { input, item } of entries.filter(e => e.item.product_id == null)) {
      const category = (store.categories || []).find(c => c.id === item.category_id);
      const catName = category?.name || 'category';
      // Migration 019: pieces that came back need no type (one number on the
      // Any line); only pieces that did not come back are named (breakdown).
      if (input.breakdown != null && !Array.isArray(input.breakdown)) throw new Error(`Invalid list of ${catName} pieces`);
      const rawUnnamed = input.returned_quantity;
      const unnamed = rawUnnamed === null || rawUnnamed === undefined || rawUnnamed === '' ? 0 : round3(rawUnnamed);
      if (!Number.isFinite(Number(rawUnnamed ?? 0)) || unnamed < 0) throw new Error(`Enter how many ${catName} came back`);
      if (category?.type === 'unit' && !Number.isInteger(unnamed)) throw new Error(`Any ${catName} must be whole pieces`);

      const breakdown = [...(input.breakdown || [])];
      const listed = new Set(breakdown.map(b => Number(b.product_id)));
      [...new Set(soldLeft.filter(r => r.qty > EPS).map(r => r.product_id))]
        .filter(pid => !listed.has(pid) && store.products.find(p => p.id === pid)?.category_id === item.category_id)
        .forEach(pid => breakdown.push({ product_id: pid, returned_quantity: 0, lost_quantity: 0, usage: [] }));

      const seenProducts = new Set();
      let sumReturned = unnamed, sumUsed = 0, sumLost = 0;
      for (const entry of breakdown) {
        const product = store.products.find(p => p.id === Number(entry.product_id));
        if (!product || product.category_id !== item.category_id) throw new Error(`Choose a ${catName} product for every line`);
        if (seenProducts.has(product.id)) throw new Error(`${product.name} is listed twice`);
        seenProducts.add(product.id);

        const num = v => (v === null || v === undefined || v === '' ? 0 : Number(v));
        const returned = round3(num(entry.returned_quantity));
        const lost = round3(num(entry.lost_quantity));
        if (!Number.isFinite(returned) || returned < 0 || !Number.isFinite(lost) || lost < 0) {
          throw new Error(`Invalid quantity for ${product.name}`);
        }
        if (category?.type === 'unit' && (!Number.isInteger(returned) || !Number.isInteger(lost))) {
          throw new Error(`${product.name} must be whole pieces`);
        }
        const manual = parseUsage(product, entry.usage);
        const manualQty = round3(manual.reduce((s, u) => s + u.quantity, 0));
        if (category?.type === 'unit' && !Number.isInteger(manualQty)) throw new Error(`${product.name} must be whole pieces`);
        const usage = [...manual, ...takeSold(product.id, Infinity)];
        const used = round3(usage.reduce((s, u) => s + u.quantity, 0));
        if (returned + used + lost <= 0) continue;

        const hasMismatch = lost > toleranceFor(store, product.type) + EPS;
        const child = {
          id: nextId(store, 'checkout_items'),
          session_id: p_session_id,
          product_id: product.id,
          category_id: item.category_id,
          parent_item_id: item.id,
          checkout_quantity: round3(returned + used + lost),
          checkin_quantity: returned,
          used_quantity: used,
          difference: lost,
          has_mismatch: hasMismatch,
          is_flagged: hasMismatch,
          flag_reason: hasMismatch ? `Lost ${formatQtyText(lost, product.type)}` : null,
          discrepancy_type: null,
          discrepancy_note: null,
          created_at: now,
        };
        store.checkout_items.push(child);
        pushUsage(child, product.id, usage);
        sumReturned = round3(sumReturned + returned);
        sumUsed = round3(sumUsed + used);
        sumLost = round3(sumLost + lost);
        hasDiscrepancy = hasDiscrepancy || hasMismatch;
      }

      const accounted = round3(sumReturned + sumUsed + sumLost);
      const issued = Number(item.checkout_quantity || 0);
      if (Math.abs(accounted - issued) > EPS) {
        throw new Error(`Any ${catName}: ${issued} issued but ${accounted} accounted for. Say how many came back and name each piece that did not (used, sold or lost)`);
      }
      setItem(item.id, {
        checkin_quantity: sumReturned,
        used_quantity: sumUsed,
        difference: sumLost,
        has_mismatch: false,
        is_flagged: false,
        flag_reason: null,
        discrepancy_type: null,
        discrepancy_note: null,
      });
    }

    const leftover = soldLeft.find(r => r.qty > EPS);
    if (leftover) {
      const product = store.products.find(p => p.id === leftover.product_id);
      throw new Error(`Bills from this field stock sell more ${product?.name || 'product'} than was issued`);
    }

    store.checkout_usage.push(...usageRows);
    store.checkout_sessions[sIdx] = {
      ...session,
      status: 'pending_approval',
      checkin_time: now,
      // Keep earlier notes (e.g. "Return sent back: …") so the history survives a resubmit.
      notes: [session.notes, String(p_notes || '').trim()].filter(Boolean).join('\n'),
      has_discrepancy: hasDiscrepancy,
      updated_at: now,
    };
    saveStore(store);
    return { has_discrepancy: hasDiscrepancy };
  },

  // approve_return(session_id, approver_id, resolutions) — admin approves a
  // return. Every mismatched item needs { item_id, discrepancy_type, note }.
  // Product lines restore the returned quantity; Any children take stock off
  // each named product once (checkout −taken, checkin +returned). Machines
  // used for an installation are counted back into Total Stock and added to
  // Installed Qty + Installations.
  approve_return({ p_session_id, p_approver_id, p_resolutions }) {
    const store = getStore();
    assertDemoAdmin(store, p_approver_id, 'Only admins can approve returns');
    const sIdx = store.checkout_sessions.findIndex(s => s.id === p_session_id);
    if (sIdx === -1) throw new Error(`Session ${p_session_id} not found`);
    const session = store.checkout_sessions[sIdx];
    if (session.status !== 'pending_approval') throw new Error(`Session ${p_session_id} is not pending_approval`);

    const sessionItems = store.checkout_items.filter(i => i.session_id === p_session_id);
    const resolutions = new Map((p_resolutions || []).map(r => [Number(r.item_id), r]));
    for (const item of sessionItems.filter(i => i.has_mismatch)) {
      const product = store.products.find(p => p.id === item.product_id);
      const r = resolutions.get(item.id);
      if (!r || !DISCREPANCY_TYPE_KEYS.includes(r.discrepancy_type) || !String(r.note || '').trim()) {
        throw new Error(`Classify the difference for ${product?.name || 'item'} and add a note before approving`);
      }
    }

    const now = new Date().toISOString();
    const txn = (productId, type, quantity, notes) => addInventoryTransaction(store, {
      product_id: productId, type, quantity, reference_type: 'checkout_session', reference_id: p_session_id,
      performed_by: p_approver_id, notes, created_at: now,
    });

    for (const item of sessionItems) {
      if (item.parent_item_id == null && item.product_id != null && (item.checkin_quantity || 0) > 0) {
        applyStockDelta(store, item.product_id, item.checkin_quantity);
        txn(item.product_id, 'checkin', item.checkin_quantity, 'Approved return — stock restored');
      }
      if (item.has_mismatch) {
        const r = resolutions.get(item.id);
        const idx = store.checkout_items.findIndex(i => i.id === item.id);
        store.checkout_items[idx] = {
          ...store.checkout_items[idx],
          discrepancy_type: r.discrepancy_type,
          discrepancy_note: String(r.note).trim(),
          updated_at: now,
        };
      }
    }

    const staff = (store.profiles || []).find(p => p.id === session.seller_id);
    const installs = store.checkout_usage.filter(u => u.session_id === p_session_id && u.reason === 'installation');
    for (const u of installs) {
      const product = store.products.find(p => p.id === u.product_id);
      if (!isMachineProduct(store, product)) continue;
      const party = (store.parties || []).find(p => p.id === u.party_id);
      applyStockDelta(store, u.product_id, u.quantity);
      product.installed_qty = Number(product.installed_qty || 0) + u.quantity;
      txn(u.product_id, 'installed', u.quantity, `Installed at ${party?.name || 'customer'} — moved to Installed Qty`);
      store.installations.push({
        id: nextId(store, 'installations'),
        party_id: u.party_id,
        product_id: u.product_id,
        quantity: u.quantity,
        installation_date: todayISODate(),
        status: 'active',
        removed_date: null,
        notes: `Installed by ${staff?.full_name || 'staff'} (Daily Operations session #${p_session_id})`,
        created_at: now,
      });
    }

    // Any children run after the installations above, which count installed
    // machines back into Total Stock, so an installed machine is never refused here.
    for (const child of sessionItems.filter(i => i.parent_item_id != null)) {
      const product = store.products.find(p => p.id === child.product_id);
      const category = (store.categories || []).find(c => c.id === child.category_id);
      const returned = Number(child.checkin_quantity || 0);
      const taken = Number(child.checkout_quantity || 0);
      if (Number(product?.current_stock || 0) + returned - taken < -EPS) {
        throw new Error(`Stock of ${product?.name} is lower than this return takes (${product?.current_stock} in stock). Correct the stock first`);
      }
      applyStockDelta(store, child.product_id, round3(returned - taken));
      txn(child.product_id, 'checkout', -taken, `Issued as Any ${category?.name || 'category'} — type named on return`);
      if (returned > 0) txn(child.product_id, 'checkin', returned, 'Approved return — stock restored');
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

  // reject_return(session_id, reason, approver_id) — admin sends a submitted
  // return back to the staff member to correct. No stock change.
  reject_return({ p_session_id, p_reason, p_approver_id }) {
    const store = getStore();
    assertDemoAdmin(store, p_approver_id, 'Only admins can send a return back');
    const sIdx = store.checkout_sessions.findIndex(s => s.id === p_session_id);
    if (sIdx === -1) throw new Error(`Session ${p_session_id} not found`);
    const session = store.checkout_sessions[sIdx];
    if (session.status !== 'pending_approval') throw new Error(`Session ${p_session_id} is not pending_approval`);
    const reason = String(p_reason || '').trim();
    if (!reason) throw new Error('Give a reason for sending the return back');

    const now = new Date().toISOString();
    store.checkout_usage = store.checkout_usage.filter(u => u.session_id !== p_session_id);
    store.checkout_items = store.checkout_items
      .filter(i => !(i.session_id === p_session_id && i.parent_item_id != null))
      .map(i => (i.session_id !== p_session_id ? i : {
        ...i,
        checkin_quantity: null,
        used_quantity: null,
        difference: null,
        has_mismatch: false,
        is_flagged: false,
        flag_reason: null,
        discrepancy_type: null,
        discrepancy_note: null,
        updated_at: now,
      }));
    store.checkout_sessions[sIdx] = {
      ...session,
      status: 'checked_out',
      checkin_time: null,
      has_discrepancy: false,
      notes: [session.notes, `Return sent back: ${reason}`].filter(Boolean).join('\n'),
      updated_at: now,
    };
    saveStore(store);
    return null;
  },

  // get_category_holds() — quantity per category held by open Any lines.
  get_category_holds() {
    const store = getStore();
    const held = {};
    const open = new Set(store.checkout_sessions.filter(s => ['checked_out', 'pending_approval'].includes(s.status)).map(s => s.id));
    store.checkout_items.filter(i => isAnyLine(i) && open.has(i.session_id)).forEach(i => {
      held[i.category_id] = round3((held[i.category_id] || 0) + Number(i.checkout_quantity || 0));
    });
    return Object.entries(held).map(([category_id, qty]) => ({ category_id: Number(category_id), held: qty }));
  },

  // record_purchase(...) — purchase entry: supplier, rate and bill on a
  // stock_intakes row, stock added and logged as stock_in.
  record_purchase({ p_product_id, p_quantity, p_purchase_rate, p_supplier, p_bill_number, p_purchase_date, p_notes, p_received_by }) {
    const store = getStore();
    assertDemoAdmin(store, p_received_by, 'Only admins can record purchases');
    const product = store.products.find(p => p.id === p_product_id);
    if (!product) throw new Error(`Product ${p_product_id} does not exist`);
    const quantity = Number(p_quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be greater than zero');
    const rate = Number(p_purchase_rate);
    if (p_purchase_rate === null || p_purchase_rate === undefined || p_purchase_rate === '' || !Number.isFinite(rate) || rate < 0) {
      throw new Error('Purchase rate must be zero or more');
    }
    const supplier = String(p_supplier || '').trim();
    if (!supplier) throw new Error('Supplier name is required');
    const billNumber = String(p_bill_number || '').trim() || null;

    const now = new Date().toISOString();
    const intakeId = store._nextId.stock_intakes || 1;
    store.stock_intakes.push({
      id: intakeId,
      product_id: p_product_id,
      quantity,
      supplier,
      bill_number: billNumber,
      purchase_date: p_purchase_date || todayISODate(),
      purchase_rate: rate,
      total_amount: roundMoney(quantity * rate),
      notes: p_notes,
      received_by: p_received_by,
      created_at: now,
    });
    store._nextId.stock_intakes = intakeId + 1;
    applyStockDelta(store, p_product_id, quantity);
    addInventoryTransaction(store, {
      product_id: p_product_id,
      type: 'stock_in',
      quantity,
      reference_type: 'stock_intake',
      reference_id: intakeId,
      performed_by: p_received_by,
      notes: `Purchase from ${supplier}${billNumber ? ` (bill ${billNumber})` : ''}`,
      created_at: now,
    });
    saveStore(store);
    return intakeId;
  },

  // request_stock_adjustment(...) — stock corrections wait for approval.
  request_stock_adjustment({ p_product_id, p_new_stock, p_reason, p_requested_by }) {
    const store = getStore();
    assertDemoAdmin(store, p_requested_by, 'Only admins can request stock adjustments');
    const product = store.products.find(p => p.id === p_product_id);
    if (!product) throw new Error(`Product ${p_product_id} does not exist`);
    const newStock = Number(p_new_stock);
    if (!Number.isFinite(newStock) || newStock < 0) throw new Error('Stock cannot be negative');
    const reason = String(p_reason || '').trim();
    if (!reason) throw new Error('Give a reason for the stock adjustment');
    const current = Number(product.current_stock || 0);
    const delta = round3(newStock - current);
    if (delta === 0) throw new Error('New stock is the same as current stock');
    if (store.stock_adjustments.some(a => a.product_id === p_product_id && a.status === 'pending')) {
      throw new Error(`${product.name} already has a pending adjustment request`);
    }
    const id = store._nextId.stock_adjustments || 1;
    store.stock_adjustments.push({
      id,
      product_id: p_product_id,
      stock_at_request: current,
      requested_stock: newStock,
      delta,
      reason,
      status: 'pending',
      requested_by: p_requested_by,
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      created_at: new Date().toISOString(),
    });
    store._nextId.stock_adjustments = id + 1;
    saveStore(store);
    return id;
  },

  // review_stock_adjustment(...) — approve applies the requested change as a
  // delta (so sales/issues made in between are kept); reject changes nothing.
  review_stock_adjustment({ p_adjustment_id, p_approve, p_note, p_reviewer_id }) {
    const store = getStore();
    assertDemoAdmin(store, p_reviewer_id, 'Only admins can review stock adjustments');
    const idx = store.stock_adjustments.findIndex(a => a.id === p_adjustment_id);
    if (idx === -1 || store.stock_adjustments[idx].status !== 'pending') {
      throw new Error(`Adjustment ${p_adjustment_id} is not pending`);
    }
    const adjustment = store.stock_adjustments[idx];
    const now = new Date().toISOString();
    const note = String(p_note || '').trim() || null;
    if (p_approve) {
      applyStockDelta(store, adjustment.product_id, adjustment.delta);
      addInventoryTransaction(store, {
        product_id: adjustment.product_id,
        type: 'adjustment',
        quantity: adjustment.delta,
        reference_type: 'stock_adjustment',
        reference_id: adjustment.id,
        performed_by: p_reviewer_id,
        notes: `Approved adjustment: ${adjustment.reason}`,
        created_at: now,
      });
    }
    store.stock_adjustments[idx] = {
      ...adjustment,
      status: p_approve ? 'approved' : 'rejected',
      reviewed_by: p_reviewer_id,
      reviewed_at: now,
      review_note: note,
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

    // Field-stock bill: no stock moves (still with staff, or settled by the approved return).
    const fieldStatus = sale.checkout_session_id
      ? store.checkout_sessions.find(s => s.id === sale.checkout_session_id)?.status
      : null;
    if (fieldStatus === 'pending_approval') {
      throw new Error(`Bill #${p_sale_id} is part of a submitted field return. Send the return back first, then delete the bill`);
    }

    for (const item of items) {
      if (sale.checkout_session_id) break;
      applyStockDelta(store, item.product_id, item.quantity);

      addInventoryTransaction(store, {
        product_id: item.product_id,
        type: 'sale_delete',
        quantity: item.quantity,
        reference_type: 'sale',
        reference_id: p_sale_id,
        performed_by: p_performer_id,
        notes: 'Sale deleted — stock restored',
        created_at: now,
      });
    }

    // Cascade delete sale_items, then the sale itself.
    store.sale_items = store.sale_items.filter(si => si.sale_id !== p_sale_id);
    store.payment_followups = (store.payment_followups || []).map(f => (
      f.sale_id === p_sale_id ? { ...f, sale_id: null, updated_at: now } : f
    ));
    store.checkout_usage = (store.checkout_usage || []).map(u => (u.sale_id === p_sale_id ? { ...u, sale_id: null } : u));
    store.sales = store.sales.filter(s => s.id !== p_sale_id);

    saveStore(store);
    return null;
  },
};

// ============================================
// PUBLIC API — works in both demo & production
// ============================================

// Tiny module-level cache for stable-ish lookups. Saves repeated full-table
// fetches of categories + profiles on page navigation.
//   - Only caches plain `getAll(table)` calls (no eq/filter/limit/offset/orderBy).
//   - TTL is short (60s) so demo-mode + role changes aren't stuck.
//   - Invalidated on insert/update/delete to the same table.
const _lookupCache = new Map();
const _CACHEABLE = new Set(['categories', 'profiles']);
const _CACHE_TTL_MS = 60_000;
function _cacheKey(table) { return table; }
function _invalidate(table) {
  if (_CACHEABLE.has(table)) _lookupCache.delete(_cacheKey(table));
}

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
    // Cache: only the plain "fetch all" form (no filters / paging / ordering).
    const isPlain = !options.filter && !options.eq && options.limit == null && options.offset == null && !options.orderBy;
    if (isPlain && _CACHEABLE.has(table)) {
      const cached = _lookupCache.get(_cacheKey(table));
      if (cached && Date.now() - cached.t < _CACHE_TTL_MS) {
        return { data: cached.data, error: null };
      }
    }

    let result;
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
      result = { data, error: null };
    } else {
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
        q = q.range(options.offset, options.offset + 999);
      }
      result = await q;
    }

    if (isPlain && _CACHEABLE.has(table) && !result.error) {
      _lookupCache.set(_cacheKey(table), { data: result.data, t: Date.now() });
    }
    return result;
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
    _invalidate(table);
    if (isDemoMode) return { data: demo.insert(table, record), error: null };
    return await supabase.from(table).insert(record).select().single();
  },

  async update(table, id, updates) {
    _invalidate(table);
    if (isDemoMode) return { data: demo.update(table, id, updates), error: null };
    return await supabase.from(table).update(updates).eq('id', id).select().single();
  },

  async delete(table, id) {
    _invalidate(table);
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
