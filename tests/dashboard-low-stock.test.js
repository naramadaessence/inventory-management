// Low-stock logic: Dashboard alerts use "Current Stock"
// (Total Stock − Sell Qty − Installed Qty), matching the Products page.

import { describe, it, expect, beforeEach } from 'vitest';
import { db, auth } from '../js/supabase.js';
import { availableStock } from '../js/utils/helpers.js';
import { renderDashboard } from '../js/pages/dashboard.js';

describe('availableStock', () => {
  it('subtracts sold and installed quantities from total stock', () => {
    expect(availableStock({ current_stock: 389, sell_qty: 10, installed_qty: 50 })).toBe(329);
  });

  it('treats missing sell/installed quantities as zero', () => {
    expect(availableStock({ current_stock: 24 })).toBe(24);
  });
});

describe('dashboard low-stock alerts', () => {
  beforeEach(async () => {
    localStorage.clear();
    await auth.getSession(); // seeds the demo store
    const { data: profiles } = await db.getAll('profiles');
    auth.currentUser = profiles.find(p => p.role === 'admin');
    document.body.innerHTML = '<div id="header"></div><div id="body"></div>';
  });

  async function lowStockText() {
    await renderDashboard(document.getElementById('body'), document.getElementById('header'));
    return document.getElementById('low-stock-list').innerText;
  }

  it('alerts when installed machines push Current Stock to the threshold, even though Total Stock is above it', async () => {
    // Demo product 1: total 25, threshold 5. 21 installed leaves 4 in the warehouse.
    await db.update('products', 1, { installed_qty: 21 });
    const text = await lowStockText();
    expect(text).toContain('NE 001');
    expect(text).toContain('Stock: 4 pcs');
  });

  it('does not alert for a machine whose Current Stock is above the threshold', async () => {
    await db.update('products', 1, { installed_qty: 0 });
    expect(await lowStockText()).not.toContain('NE 001');
  });
});
