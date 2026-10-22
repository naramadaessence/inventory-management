// The ?demo=week simulation (js/demo/demo-week.js): runs a full working week
// through the demo RPCs and must leave a consistent store.

import { describe, it, expect, beforeAll } from 'vitest';
import { db, auth } from '../js/supabase.js';
import { simulateDemoWeek, lastWorkingDays, DEMO_WEEK_ACCOUNTS } from '../js/demo/demo-week.js';

const TODAY = new Date(2026, 9, 22, 15, 0); // Thursday 22 Oct 2026, 3 pm
const all = async table => (await db.getAll(table)).data;
const localDay = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

describe('demo week simulation', () => {
  let result;
  let openingStock;

  beforeAll(async () => {
    localStorage.clear();
    await auth.getSession();
    openingStock = Object.fromEntries((await all('products')).map(p => [p.id, Number(p.current_stock)]));
    result = await simulateDemoWeek({ db, auth, today: TODAY });
  });

  it('covers the last 5 working days, skipping Sunday', () => {
    expect(result.days).toEqual(['2026-10-17', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']);
    expect(lastWorkingDays(new Date(2026, 9, 19), 2).map(d => d.getDate())).toEqual([17, 19]);
  });

  it('restores the real clock and logs nobody in', () => {
    expect(Date.now()).toBeGreaterThan(TODAY.getTime() - 365 * 86400000);
    expect(auth.currentUser).toBeNull();
    expect(localStorage.getItem('narmada_user')).toBeNull();
  });

  it('creates the five accounts and each can log in with its role password', async () => {
    for (const account of DEMO_WEEK_ACCOUNTS) {
      const { user, error } = await auth.login(account.email, account.role === 'admin' ? 'admin123' : 'seller123');
      expect(error).toBeNull();
      expect(user.full_name).toBe(account.full_name);
    }
    await auth.logout();
  });

  it('keeps every product\'s stock equal to opening stock plus the logged movements', async () => {
    const txns = await all('inventory_transactions');
    for (const product of await all('products')) {
      const moved = txns.filter(t => t.product_id === product.id).reduce((s, t) => s + Number(t.quantity), 0);
      const expected = Math.round(((openingStock[product.id] ?? 0) + moved) * 1000) / 1000;
      expect(Math.round(Number(product.current_stock) * 1000) / 1000, product.name).toBe(expected);
      expect(Number(product.current_stock), product.name).toBeGreaterThanOrEqual(0);
    }
  });

  it('dates purchases and sessions on their simulated days', async () => {
    const intakes = (await all('stock_intakes')).filter(i => i.purchase_rate != null);
    expect(intakes).toHaveLength(9);
    for (const i of intakes) expect(localDay(i.created_at)).toBe(i.purchase_date);
    const sessionDays = new Set((await all('checkout_sessions')).map(s => localDay(s.checkout_time)));
    expect([...sessionDays].sort()).toEqual(result.days);
  });

  it('uses the reconciliation features: usage, classified mismatches, send back, pending work for today', async () => {
    const sessions = await all('checkout_sessions');
    const items = await all('checkout_items');
    const count = status => sessions.filter(s => s.status === status).length;
    expect(count('flagged')).toBe(1);           // rejected oversized request
    expect(count('pending_issue')).toBe(1);     // Kunal's request today
    expect(count('checked_out')).toBe(1);       // Sonal still out since yesterday
    const pendingReturn = sessions.filter(s => s.status === 'pending_approval');
    expect(pendingReturn).toHaveLength(1);
    expect(pendingReturn[0].has_discrepancy).toBe(true);

    expect(items.filter(i => i.discrepancy_type).map(i => i.discrepancy_type).sort())
      .toEqual(['excess_return', 'staff_shortage', 'wastage']);
    for (const i of items.filter(i => i.used_quantity != null)) {
      expect(Math.round((i.checkout_quantity - i.checkin_quantity - i.used_quantity) * 1000) / 1000).toBe(i.difference);
    }
    expect(sessions.some(s => /Return sent back/.test(s.notes || ''))).toBe(true);
    const reasons = new Set((await all('checkout_usage')).map(u => u.reason));
    expect([...reasons].sort()).toEqual(['customer_service', 'installation', 'other']);
  });

  it('books machine installations to customers and Installed Qty', async () => {
    const installs = await all('installations');
    expect(installs).toHaveLength(4);
    const machines = await all('products');
    expect(machines.find(p => p.id === 1).installed_qty).toBe(3);
    expect(machines.find(p => p.id === 2).installed_qty).toBe(1);
  });

  it('uses sales, collections, rentals, damage, adjustments, AMC refills and product edits', async () => {
    const sales = await all('sales');
    expect(sales).toHaveLength(5); // 6 recorded, 1 deleted
    expect(sales.some(s => s.sale_type === 'cash') && sales.some(s => s.sale_type === 'gst')).toBe(true);
    expect(sales.find(s => /\+1 added later/.test(s.notes)).total_amount).toBe(2250);
    expect(sales.find(s => s.payment_status === 'paid' && s.total_amount === 1350)).toBeTruthy(); // Orbit bill fully collected

    expect((await all('payment_followups')).length).toBeGreaterThanOrEqual(3);
    const [rental] = await all('rentals');
    expect(rental.status).toBe('returned');
    expect((await all('damage_reports')).map(d => d.damage_type).sort()).toEqual(['damaged', 'expired', 'lost']);
    expect((await all('stock_adjustments')).map(a => a.status).sort()).toEqual(['approved', 'pending', 'rejected']);
    expect(await all('refill_completions')).toHaveLength(1);
    const products = await all('products');
    expect(products.find(p => p.name === 'Oud Royale Refill')).toBeTruthy();
    expect(products.find(p => p.id === 20).fragrance).toBe('White Musk 3N');
  });

  it('refuses to run outside demo mode', async () => {
    await expect(simulateDemoWeek({ db: { ...db, isDemoMode: false }, auth })).rejects.toThrow(/demo mode/);
  });
});
