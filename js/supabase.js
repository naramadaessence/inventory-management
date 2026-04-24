import { createClient } from '@supabase/supabase-js';

// These will be set via environment variables in production
// For development, we'll use demo mode with localStorage
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isDemoMode = !SUPABASE_URL || !SUPABASE_ANON_KEY;

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
    rentals: [],
    inventory_transactions: [],
    damage_reports: [],
    stock_intakes: [],
    _nextId: { checkout_sessions: 1, checkout_items: 1, sales: 1, rentals: 1, inventory_transactions: 1, damage_reports: 1, stock_intakes: 1, parties: 4, products: 23, categories: 6 }
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
// PUBLIC API — works in both demo & production
// ============================================
export const db = {
  isDemoMode,

  async getAll(table, options = {}) {
    if (isDemoMode) {
      let data = demo.getAll(table);
      if (options.filter) data = data.filter(options.filter);
      if (options.orderBy) {
        const [field, dir] = options.orderBy;
        data.sort((a, b) => {
          if (dir === 'desc') return a[field] > b[field] ? -1 : 1;
          return a[field] > b[field] ? 1 : -1;
        });
      }
      return { data, error: null };
    }
    let q = supabase.from(table).select('*');
    if (options.orderBy) q = q.order(options.orderBy[0], { ascending: options.orderBy[1] !== 'desc' });
    return await q;
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
