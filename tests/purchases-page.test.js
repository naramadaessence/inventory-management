// Purchases page (js/pages/purchases.js) and Settings → Stock Rules,
// rendered against the demo store as admin.

import { describe, it, expect, beforeEach } from 'vitest';
import { db, auth } from '../js/supabase.js';
import { renderPurchases } from '../js/pages/purchases.js';
import { renderSettings } from '../js/pages/settings.js';

const tick = () => new Promise(r => setTimeout(r, 0));

// Poll until the condition holds; fails the test instead of hanging.
async function waitFor(check, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const value = check();
    if (value) return value;
    await tick();
  }
  throw new Error('waitFor: condition never became true');
}

let admin;

beforeEach(async () => {
  localStorage.clear();
  await auth.getSession(); // seeds the demo store
  const { data: profiles } = await db.getAll('profiles');
  admin = profiles.find(p => p.role === 'admin');
  auth.currentUser = admin;
  document.body.innerHTML = '<div id="sidebar"></div><div id="header"></div><div id="body"></div>';
});

function purchase(overrides) {
  return db.rpc('record_purchase', {
    p_product_id: 13,
    p_quantity: 10,
    p_purchase_rate: 300,
    p_supplier: 'Aroma Traders',
    p_bill_number: 'B-1',
    p_purchase_date: '2026-10-01',
    p_notes: null,
    p_received_by: admin.id,
    ...overrides,
  });
}

async function render() {
  await renderPurchases(document.getElementById('body'), document.getElementById('header'));
}

const rowsText = () => [...document.querySelectorAll('#purchase-table tbody tr')].map(tr => tr.textContent);
const groupRow = key => document.querySelector(`.purchase-group-row[data-group-key="${key}"]`);

describe('purchases page', () => {
  it('denies non-admins', async () => {
    const { data: profiles } = await db.getAll('profiles');
    auth.currentUser = profiles.find(p => p.role === 'seller');
    await render();
    expect(document.getElementById('body').textContent).toContain('Access Denied');
  });

  it('lists a recorded purchase with rate, total, supplier and bill number, escaping text', async () => {
    const { error } = await purchase({ p_supplier: '<b>Aroma</b> Traders', p_bill_number: 'INV-77' });
    expect(error).toBeNull();
    await render();

    const rows = rowsText();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Cool Water Refill');
    expect(rows[0]).toContain('Cool Water'); // fragrance
    expect(rows[0]).toContain('+10 pcs');
    expect(rows[0]).toContain('₹300/pc');
    expect(rows[0]).toContain('₹3,000');
    expect(rows[0]).toContain('<b>Aroma</b> Traders');
    expect(rows[0]).toContain('INV-77');
    expect(document.querySelector('#purchase-table b')).toBeNull();
    expect(document.getElementById('purchase-total-value').textContent).toBe('₹3,000');
    expect(document.getElementById('purchase-entry-count').textContent).toBe('1');
  });

  it('shows legacy intakes without a rate as "—" and leaves them out of the value', async () => {
    await purchase({});
    const { data: legacy } = await db.insert('stock_intakes', { product_id: 7, quantity: 5, supplier: 'Old Supplier', notes: 'legacy' });
    await db.update('stock_intakes', legacy.id, { created_at: '2026-01-05T06:00:00.000Z' });
    await render();

    const legacyRow = [...document.querySelectorAll('#purchase-table tbody tr')].find(tr => tr.textContent.includes('Black Touch Refill'));
    expect(legacyRow.querySelector('.purchase-rate').textContent).toBe('—');
    expect(legacyRow.querySelector('.purchase-value').textContent).toBe('—');
    expect(document.getElementById('purchase-total-value').textContent).toBe('₹3,000');
    expect(document.getElementById('purchase-entry-count').textContent).toBe('2');
    // Newest purchase date first.
    expect(rowsText()[0]).toContain('Cool Water Refill');
  });

  it('records a purchase from the modal with a live total and the record_purchase payload', async () => {
    await render();
    document.getElementById('btn-record-purchase').click();

    const select = document.getElementById('purchase-product');
    select.value = '17'; // Cool Water Diffuser Oil (liquid)
    select.dispatchEvent(new Event('change'));
    expect(document.getElementById('purchase-qty-label').textContent).toBe('Quantity (kg) *');
    expect(document.getElementById('purchase-rate-label').textContent).toBe('Purchase Rate (₹ per kg) *');

    const qty = document.getElementById('purchase-qty');
    const rate = document.getElementById('purchase-rate');
    qty.value = '2.5'; qty.dispatchEvent(new Event('input'));
    rate.value = '800'; rate.dispatchEvent(new Event('input'));
    expect(document.getElementById('purchase-total').textContent).toBe('₹2,000');

    document.getElementById('purchase-supplier').value = 'Oil House';
    document.getElementById('purchase-bill').value = 'OH-9';
    document.getElementById('purchase-date').value = '2026-10-05';
    document.getElementById('purchase-save').click();

    await waitFor(() => rowsText().length === 1);
    const { data: intakes } = await db.getAll('stock_intakes');
    expect(intakes).toHaveLength(1);
    expect(intakes[0]).toMatchObject({
      product_id: 17, quantity: 2.5, purchase_rate: 800, total_amount: 2000,
      supplier: 'Oil House', bill_number: 'OH-9', purchase_date: '2026-10-05', received_by: admin.id,
    });
    const { data: product } = await db.getById('products', 17);
    expect(product.current_stock).toBe(7.5);
    expect(rowsText()[0]).toContain('+2.500 kg');
  });

  it('rejects a purchase without a supplier', async () => {
    await render();
    document.getElementById('btn-record-purchase').click();
    document.getElementById('purchase-qty').value = '3';
    document.getElementById('purchase-rate').value = '100';
    document.getElementById('purchase-save').click();
    await tick(); await tick();
    const { data: intakes } = await db.getAll('stock_intakes');
    expect(intakes).toHaveLength(0);
  });

  it('totals by supplier', async () => {
    await purchase({ p_supplier: 'Aroma Traders', p_quantity: 10, p_purchase_rate: 300 });  // 3,000
    // Same supplier typed differently; older, so the newest spelling labels the group.
    await purchase({ p_supplier: 'aroma traders ', p_product_id: 9, p_quantity: 4, p_purchase_rate: 250, p_purchase_date: '2026-09-20' }); // 1,000
    await purchase({ p_supplier: 'Oil House', p_product_id: 17, p_quantity: 2.5, p_purchase_rate: 800 }); // 2,000
    await render();

    const aroma = groupRow('aroma traders');
    expect(aroma.textContent).toContain('Aroma Traders');
    expect(aroma.children[1].textContent).toBe('2');
    expect(aroma.querySelector('.group-pcs').textContent).toBe('14 pcs');
    expect(aroma.querySelector('.group-kg').textContent).toBe('—');
    expect(aroma.querySelector('.group-value').textContent).toBe('₹4,000');
    expect(groupRow('oil house').querySelector('.group-kg').textContent).toBe('2.500 kg');
    expect(document.getElementById('purchase-total-value').textContent).toBe('₹6,000');
  });

  it('totals by fragrance across unit types, and filters by fragrance', async () => {
    await purchase({ p_product_id: 13, p_quantity: 10, p_purchase_rate: 300 });  // Cool Water Refill, 3,000
    await purchase({ p_product_id: 17, p_quantity: 2.5, p_purchase_rate: 800 }); // Cool Water Diffuser Oil, 2,000
    await purchase({ p_product_id: 9, p_quantity: 4, p_purchase_rate: 250 });    // Lavender Refill, 1,000
    await purchase({ p_product_id: 1, p_quantity: 2, p_purchase_rate: 900 });    // machine, no fragrance
    await render();

    document.querySelector('.purchase-group-btn[data-group="fragrance"]').click();
    const coolWater = groupRow('Cool Water');
    expect(coolWater.querySelector('.group-kg').textContent).toBe('2.500 kg');
    expect(coolWater.querySelector('.group-pcs').textContent).toBe('10 pcs');
    expect(coolWater.querySelector('.group-value').textContent).toBe('₹5,000');
    expect(groupRow('Lavender').querySelector('.group-value').textContent).toBe('₹1,000');
    expect(groupRow('__none__').textContent).toContain('No fragrance');

    const filter = document.getElementById('pf-fragrance');
    filter.value = 'Cool Water';
    filter.dispatchEvent(new Event('change'));
    expect(rowsText()).toHaveLength(2);
    expect(document.getElementById('purchase-total-value').textContent).toBe('₹5,000');
  });

  it('filters by date range and supplier', async () => {
    await purchase({ p_purchase_date: '2026-09-01', p_supplier: 'Aroma Traders' });
    await purchase({ p_purchase_date: '2026-10-10', p_supplier: 'Oil House' });
    await render();

    const from = document.getElementById('pf-from');
    from.value = '2026-10-01';
    from.dispatchEvent(new Event('change'));
    expect(rowsText()).toHaveLength(1);
    expect(rowsText()[0]).toContain('Oil House');

    document.getElementById('pf-clear').click();
    const supplier = document.getElementById('pf-supplier');
    supplier.value = 'aroma traders';
    supplier.dispatchEvent(new Event('change'));
    expect(rowsText()).toHaveLength(1);
    expect(rowsText()[0]).toContain('Aroma Traders');
  });
});

describe('settings → stock rules', () => {
  async function openStockRules() {
    await renderSettings(document.getElementById('body'), document.getElementById('header'));
    expect(document.querySelector('.tab-btn[data-tab="stock"]')).toBeNull(); // Stock Intake tab removed
    document.querySelector('.tab-btn[data-tab="stock-rules"]').click();
    return waitFor(() => document.getElementById('btn-save-stock-rules'));
  }

  async function settingValue(key) {
    const { data } = await db.getAll('app_settings');
    return data.find(s => s.key === key).value;
  }

  it('shows the current tolerances', async () => {
    await openStockRules();
    expect(document.getElementById('rule-liquid_tolerance_kg').value).toBe('0.01');
    expect(document.getElementById('rule-unit_tolerance').value).toBe('0');
    expect(document.getElementById('settings-content').textContent).toContain('|Issued − Returned − Used|');
  });

  it('saves an edited tolerance', async () => {
    const save = await openStockRules();
    document.getElementById('rule-liquid_tolerance_kg').value = '0.025';
    document.getElementById('rule-unit_tolerance').value = '1';
    save.click();
    await waitFor(() => !save.isConnected);
    expect(await settingValue('liquid_tolerance_kg')).toBe(0.025);
    expect(await settingValue('unit_tolerance')).toBe(1);
  });

  it('rejects a negative tolerance', async () => {
    const save = await openStockRules();
    document.getElementById('rule-unit_tolerance').value = '-1';
    save.click();
    await tick(); await tick();
    expect(await settingValue('unit_tolerance')).toBe(0);
  });
});
