// Products page: fragrance field/filter and stock adjustments that need
// admin approval (request_stock_adjustment / review_stock_adjustment).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, auth } from '../js/supabase.js';
import { renderProducts } from '../js/pages/products.js';

const ROSE_REFILL = 15; // demo product: Rose Refill, 15 pcs, fragrance "Rose"

async function getProduct(id) {
  const { data } = await db.getById('products', id);
  return data;
}

async function adjustmentsFor(productId) {
  const { data } = await db.getAll('stock_adjustments');
  return data.filter(a => a.product_id === productId);
}

async function renderPage() {
  await renderProducts(document.getElementById('page-body'), document.getElementById('page-header'));
}

function setValue(el, value, event = 'input') {
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

function toastTexts() {
  return Array.from(document.querySelectorAll('.toast')).map(t => t.textContent.trim());
}

function visibleCardNames() {
  return Array.from(document.querySelectorAll('#products-container .product-card h4')).map(h => h.textContent);
}

describe('products page — fragrance and stock adjustments', () => {
  beforeEach(async () => {
    localStorage.clear();
    await auth.getSession(); // seeds the demo store
    const { data: profiles } = await db.getAll('profiles');
    auth.currentUser = profiles.find(p => p.role === 'admin');
    // Keep the toast container (created once by helpers.js); drop everything else from earlier tests.
    document.querySelectorAll('#test-root, .modal-overlay, .toast').forEach(el => el.remove());
    const root = document.createElement('div');
    root.id = 'test-root';
    root.innerHTML = '<div id="page-header"></div><div id="page-body"></div>';
    document.body.appendChild(root);
  });

  it('shows fragrance on cards and in the table, and the fragrance filter narrows the list', async () => {
    await renderPage();
    const roseCard = document.querySelector(`.product-card[data-id="${ROSE_REFILL}"]`);
    expect(roseCard.querySelector('.product-fragrance').textContent).toBe('Rose');

    const filter = document.getElementById('product-filter-fragrance');
    const options = Array.from(filter.options).map(o => o.value);
    expect(options[0]).toBe('');
    expect(options).toContain('Rose');
    expect(options).toContain('Lavender');
    expect(options.filter(v => v === '')).toHaveLength(1); // machines (no fragrance) add no blank option

    const before = visibleCardNames().length;
    setValue(filter, 'Rose', 'change');
    expect(visibleCardNames()).toEqual(['Rose Refill']);
    expect(before).toBeGreaterThan(1);

    setValue(document.getElementById('product-view'), 'table', 'change');
    const headers = Array.from(document.querySelectorAll('#products-container thead th')).map(th => th.textContent);
    expect(headers.indexOf('Fragrance')).toBe(headers.indexOf('Product') + 1);
    expect(document.querySelector(`#products-container tr[data-id="${ROSE_REFILL}"] .product-fragrance`).textContent).toBe('Rose');
  });

  it('saves a fragrance typed in the edit modal (trimmed, null when empty)', async () => {
    await renderPage();
    document.querySelector('.product-card[data-id="1"]').click();
    setValue(document.getElementById('prod-fragrance'), '  Ocean Breeze  ');
    document.getElementById('prod-save-btn').click();
    await vi.waitFor(async () => expect((await getProduct(1)).fragrance).toBe('Ocean Breeze'));

    await vi.waitFor(() => expect(document.querySelectorAll('.modal-overlay')).toHaveLength(0));
    document.querySelector('.product-card[data-id="1"]').click();
    setValue(document.getElementById('prod-fragrance'), '   ');
    document.getElementById('prod-save-btn').click();
    await vi.waitFor(async () => expect((await getProduct(1)).fragrance).toBeNull());
  });

  it('editing Total Stock asks for a reason and creates a pending request without changing stock', async () => {
    await renderPage();
    document.querySelector(`.product-card[data-id="${ROSE_REFILL}"]`).click();

    const reasonGroup = document.getElementById('prod-stock-reason-group');
    expect(reasonGroup.style.display).toBe('none');
    setValue(document.getElementById('prod-stock'), '20');
    expect(reasonGroup.style.display).toBe('');

    // No reason: nothing is saved.
    document.getElementById('prod-save-btn').click();
    await vi.waitFor(() => expect(toastTexts()).toContain('Give a reason for the stock change'));
    expect(await adjustmentsFor(ROSE_REFILL)).toHaveLength(0);

    setValue(document.getElementById('prod-stock-reason'), 'Physical count found 5 extra');
    document.getElementById('prod-save-btn').click();
    await vi.waitFor(() => expect(toastTexts()).toContain('Product saved — stock change sent for approval'));

    const [request] = await adjustmentsFor(ROSE_REFILL);
    expect(request).toMatchObject({ status: 'pending', stock_at_request: 15, requested_stock: 20, delta: 5, reason: 'Physical count found 5 extra', requested_by: 'admin-1' });
    expect((await getProduct(ROSE_REFILL)).current_stock).toBe(15);

    // Page re-renders with the pending panel and a badge on the product.
    await vi.waitFor(() => expect(document.getElementById('pending-adjustments')).not.toBeNull());
    expect(document.querySelector('#pending-adjustments h3').textContent).toContain('Stock adjustments awaiting approval (1)');
    expect(document.querySelector(`.product-card[data-id="${ROSE_REFILL}"] .adj-pending-badge`)).not.toBeNull();
  });

  it('approving from the pending panel applies the change and records it in history', async () => {
    await db.rpc('request_stock_adjustment', { p_product_id: ROSE_REFILL, p_new_stock: 20, p_reason: 'Recount', p_requested_by: 'admin-1' });
    await renderPage();

    const row = document.querySelector('#pending-adjustments tbody tr');
    expect(row.textContent).toContain('Rose Refill');
    expect(row.textContent).toContain('+5 pcs');
    expect(row.textContent).toContain('Warehouse Admin');
    row.querySelector('.adj-approve-btn').click();
    setValue(document.getElementById('adj-review-note'), 'Checked shelf');
    document.getElementById('adj-review-confirm').click();

    await vi.waitFor(async () => expect((await getProduct(ROSE_REFILL)).current_stock).toBe(20));
    const [adjustment] = await adjustmentsFor(ROSE_REFILL);
    expect(adjustment).toMatchObject({ status: 'approved', reviewed_by: 'admin-1', review_note: 'Checked shelf' });

    await vi.waitFor(() => expect(document.getElementById('pending-adjustments')).toBeNull());
    expect(document.querySelector(`.product-card[data-id="${ROSE_REFILL}"] .adj-pending-badge`)).toBeNull();

    document.getElementById('btn-adjustment-history').click();
    const history = document.getElementById('adjustment-history-table').textContent;
    expect(history).toContain('Rose Refill');
    expect(history).toContain('Approved');
    expect(history).toContain('Checked shelf');
  });

  it('rejecting requires a note and leaves stock unchanged', async () => {
    await db.rpc('request_stock_adjustment', { p_product_id: ROSE_REFILL, p_new_stock: 10, p_reason: 'Recount', p_requested_by: 'admin-1' });
    await renderPage();

    document.querySelector('#pending-adjustments .adj-reject-btn').click();
    document.getElementById('adj-review-confirm').click();
    await vi.waitFor(() => expect(toastTexts()).toContain('Give a reason for rejecting'));
    expect((await adjustmentsFor(ROSE_REFILL))[0].status).toBe('pending');

    setValue(document.getElementById('adj-review-note'), 'Count was wrong');
    document.getElementById('adj-review-confirm').click();
    await vi.waitFor(async () => expect((await adjustmentsFor(ROSE_REFILL))[0].status).toBe('rejected'));
    expect((await adjustmentsFor(ROSE_REFILL))[0].review_note).toBe('Count was wrong');
    expect((await getProduct(ROSE_REFILL)).current_stock).toBe(15);
    await vi.waitFor(() => expect(document.getElementById('pending-adjustments')).toBeNull());
  });
});
