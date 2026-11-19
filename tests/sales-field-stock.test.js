// Sales page: bills "From field stock" (knowledge-base/category-issue.md,
// Field sales). Record Sale's Stock source, the Field stock badge, and Edit /
// Delete of field bills, rendered against the demo store.
// Demo seed: category 3 = Dispenser Refill (7 = Black Touch 40 pcs,
// 8 = Pleasure 35, 9 = Lavender 30); product 17 = Cool Water Diffuser Oil.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, auth } from '../js/supabase.js';
import { renderSales } from '../js/pages/sales.js';

const BLACK_TOUCH = 7;
const PLEASURE = 8;
const OIL = 17;

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

// Closed modals fade for 200ms before removal; the live one is the last non-faded overlay.
function currentModal() {
  const open = [...document.querySelectorAll('.modal-overlay')].filter(o => o.style.opacity !== '0');
  return open[open.length - 1];
}

function setValue(el, value, eventName = 'input') {
  el.value = String(value);
  el.dispatchEvent(new Event(eventName, { bubbles: true }));
}

function toastTexts() {
  return [...document.querySelectorAll('.toast')].map(t => t.textContent.trim());
}

async function stockOf(id) {
  return Number((await db.getById('products', id)).data.current_stock);
}

async function profile(id) {
  const { data } = await db.getAll('profiles');
  return data.find(p => p.id === id);
}

async function issue(items, seller = 'seller-1') {
  const { data: sessionId, error } = await db.rpc('admin_issue_stock', {
    p_seller_id: seller, p_items: items, p_approver_id: 'admin-1',
  });
  expect(error).toBeNull();
  return sessionId;
}

async function linesOf(sessionId) {
  return (await db.getAll('checkout_items', { eq: { session_id: sessionId } })).data;
}

function fieldSale(sessionId, items, recordedBy = 'seller-1') {
  return db.rpc('record_sale', {
    p_party_id: 1, p_items: items, p_payment_status: 'paid', p_payment_method: 'cash',
    p_amount_received: 0, p_expected_payment_date: null, p_sale_date: '2026-11-19', p_notes: '',
    p_recorded_by: recordedBy, p_sale_type: 'gst', p_checkout_session_id: sessionId,
  });
}

async function submitAnyReturn(sessionId, breakdown) {
  const [line] = await linesOf(sessionId);
  const { error } = await db.rpc('submit_return', {
    p_session_id: sessionId, p_items: [{ item_id: line.id, breakdown }], p_notes: '', p_submitted_by: 'seller-1',
  });
  expect(error).toBeNull();
}

async function renderPage() {
  await renderSales(document.getElementById('page-body'), document.getElementById('page-header'));
}

async function openRecordSale() {
  await renderPage();
  document.getElementById('btn-new-sale').click();
  await settle();
  return currentModal();
}

function addItem(modal, productId, qty) {
  setValue(modal.querySelector('#add-item-product'), productId, 'change');
  setValue(modal.querySelector('#add-item-qty'), qty);
  modal.querySelector('#btn-add-item').click();
}

async function openEditBill(saleId) {
  await renderPage();
  document.querySelector(`.edit-sale-btn[data-id="${saleId}"]`).click();
  await settle();
  return currentModal();
}

describe('sales page — bills from field stock', () => {
  beforeEach(async () => {
    localStorage.clear();
    await auth.getSession(); // seeds the demo store
    auth.currentUser = await profile('seller-1');
    // Keep the toast container (created once by helpers.js); drop everything else from earlier tests.
    document.querySelectorAll('#test-root, .modal-overlay, .toast').forEach(el => el.remove());
    const root = document.createElement('div');
    root.id = 'test-root';
    root.innerHTML = '<div id="page-header"></div><div id="page-body"></div>';
    document.body.appendChild(root);
  });

  afterEach(() => vi.restoreAllMocks());

  it('hides the stock source control when there is no open session', async () => {
    const modal = await openRecordSale();
    expect(modal.querySelector('#sale-source')).toBeNull();
  });

  it('hides another staff member\'s session from a seller', async () => {
    await issue([{ product_id: BLACK_TOUCH, quantity: 3 }], 'seller-2');
    const modal = await openRecordSale();
    expect(modal.querySelector('#sale-source')).toBeNull();
  });

  it('records a field bill without moving stock and shows the Field stock badge', async () => {
    const sessionId = await issue([{ product_id: BLACK_TOUCH, quantity: 3 }, { category_id: 3, quantity: 5 }]);
    const before = { [BLACK_TOUCH]: await stockOf(BLACK_TOUCH), [PLEASURE]: await stockOf(PLEASURE) };
    const modal = await openRecordSale();

    const source = modal.querySelector('#sale-source');
    expect([...source.options].map(o => o.value)).toEqual(['', String(sessionId)]);
    setValue(source, sessionId, 'change');

    const panel = modal.querySelector('#field-stock-panel');
    expect(panel.style.display).toBe('block');
    expect(panel.textContent).toContain('Black Touch');
    expect(panel.textContent).toContain('Any Dispenser Refill');
    // Only products on the session or in a category with an Any line can be billed.
    const offered = [...modal.querySelectorAll('#add-item-product option')].map(o => Number(o.value));
    expect(offered).toContain(BLACK_TOUCH);
    expect(offered).toContain(PLEASURE);
    expect(offered).not.toContain(OIL);

    addItem(modal, BLACK_TOUCH, 4); // 3 from its own line + 1 from Any Dispenser Refill
    addItem(modal, PLEASURE, 2);
    modal.querySelector('#sale-save').click();
    await settle();

    const { data: sales } = await db.getAll('sales');
    expect(sales).toHaveLength(1);
    expect(sales[0].checkout_session_id).toBe(sessionId);
    expect(sales[0].recorded_by).toBe('seller-1');
    expect(await stockOf(BLACK_TOUCH)).toBe(before[BLACK_TOUCH]);
    expect(await stockOf(PLEASURE)).toBe(before[PLEASURE]);
    expect(toastTexts().some(t => t.includes('from field stock') && t.includes('Sold on the return'))).toBe(true);

    const row = document.querySelector(`.sale-row[data-id="${sales[0].id}"]`);
    expect(row.querySelector('.field-stock-badge').textContent).toContain('Field stock');
  });

  it('refuses a field bill that sells more than was issued', async () => {
    const sessionId = await issue([{ category_id: 3, quantity: 5 }]);
    expect((await fieldSale(sessionId, [{ product_id: BLACK_TOUCH, quantity: 2, unit_price: 450 }])).error).toBeNull();
    const modal = await openRecordSale();
    setValue(modal.querySelector('#sale-source'), sessionId, 'change');
    // The 2 already billed are taken off what is left.
    expect(modal.querySelector(`#field-stock-panel [data-category-id="3"]`).textContent).toContain('3 pcs left');

    addItem(modal, PLEASURE, 4);
    modal.querySelector('#sale-save').click();
    await settle();

    expect(toastTexts().some(t => /only 5 were issued/.test(t))).toBe(true);
    const { data: sales } = await db.getAll('sales');
    expect(sales).toHaveLength(1);
    expect(currentModal()).toBe(modal);
  });

  it('lets an admin bill from another staff member\'s open session', async () => {
    const sessionId = await issue([{ product_id: BLACK_TOUCH, quantity: 3 }], 'seller-1');
    auth.currentUser = await profile('admin-1');
    const before = await stockOf(BLACK_TOUCH);
    const modal = await openRecordSale();

    const option = [...modal.querySelectorAll('#sale-source option')].find(o => o.value === String(sessionId));
    expect(option.textContent).toContain('Raj Patel');
    expect(option.textContent).toContain(`#${sessionId}`);
    setValue(modal.querySelector('#sale-source'), sessionId, 'change');
    expect(modal.querySelector('#field-stock-panel').textContent).toContain('recorded under Raj Patel');

    addItem(modal, BLACK_TOUCH, 2);
    modal.querySelector('#sale-save').click();
    await settle();

    const { data: sales } = await db.getAll('sales');
    expect(sales[0]).toMatchObject({ checkout_session_id: sessionId, recorded_by: 'seller-1' });
    expect(await stockOf(BLACK_TOUCH)).toBe(before);
  });

  it('keeps warehouse bills deducting stock when Warehouse is chosen', async () => {
    await issue([{ product_id: BLACK_TOUCH, quantity: 3 }]);
    const before = await stockOf(BLACK_TOUCH);
    const modal = await openRecordSale();
    expect(modal.querySelector('#sale-source').value).toBe('');
    addItem(modal, BLACK_TOUCH, 2);
    modal.querySelector('#sale-save').click();
    await settle();

    const { data: sales } = await db.getAll('sales');
    expect(sales[0].checkout_session_id).toBeNull();
    expect(await stockOf(BLACK_TOUCH)).toBe(before - 2);
  });

  it('checks an open field bill edit against the session, not the warehouse', async () => {
    const sessionId = await issue([{ category_id: 3, quantity: 5 }]);
    const { data: saleId } = await fieldSale(sessionId, [{ product_id: BLACK_TOUCH, quantity: 2, unit_price: 450 }]);
    await fieldSale(sessionId, [{ product_id: PLEASURE, quantity: 2, unit_price: 450 }]);
    auth.currentUser = await profile('admin-1');
    const modal = await openEditBill(saleId);

    const qty = modal.querySelector('.edit-item-qty');
    expect(qty.disabled).toBe(false);
    setValue(qty, 4, 'change'); // 4 + the other bill's 2 = 6 > 5 issued
    modal.querySelector('#edit-sale-save').click();
    await settle();
    expect(toastTexts().some(t => /only 5 were issued/.test(t))).toBe(true);
    expect((await db.getAll('sale_items', { eq: { sale_id: saleId } })).data[0].quantity).toBe(2);

    setValue(modal.querySelector('.edit-item-qty'), 3, 'change');
    modal.querySelector('#edit-sale-save').click();
    await settle();
    expect((await db.getAll('sale_items', { eq: { sale_id: saleId } })).data[0].quantity).toBe(3);
  });

  it('locks products and quantities of a field bill whose return is pending', async () => {
    const sessionId = await issue([{ category_id: 3, quantity: 5 }]);
    const { data: saleId } = await fieldSale(sessionId, [{ product_id: BLACK_TOUCH, quantity: 2, unit_price: 450 }]);
    await submitAnyReturn(sessionId, [{ product_id: PLEASURE, returned_quantity: 3, lost_quantity: 0, usage: [] }]);
    auth.currentUser = await profile('admin-1');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const modal = await openEditBill(saleId);

    expect(modal.querySelector('#edit-field-lock-note').textContent)
      .toContain('Part of a submitted field return — send the return back to change items');
    expect(modal.querySelector('.edit-item-qty').disabled).toBe(true);
    expect(modal.querySelector('.edit-rm-item')).toBeNull();
    expect(modal.querySelector('#edit-add-section').style.display).toBe('none');

    // Price and notes still save.
    setValue(modal.querySelector('.edit-item-price'), 500, 'change');
    setValue(modal.querySelector('#edit-sale-notes'), 'Price corrected');
    modal.querySelector('#edit-sale-save').click();
    await settle();
    const { data: sale } = await db.getById('sales', saleId);
    expect(sale.total_amount).toBe(1000);
    expect(sale.notes).toBe('Price corrected');

    // Delete is refused with the same message, without asking. Wait for the
    // closed modal's fade-out first: modals wire their buttons by id.
    await new Promise(r => setTimeout(r, 250));
    const again = await openEditBill(saleId);
    again.querySelector('#edit-sale-delete').click();
    await settle();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(toastTexts()).toContain(`Part of a submitted field return — send the return back to change items`);
    expect((await db.getById('sales', saleId)).data).toBeTruthy();
  });

  it('deletes an approved field bill without touching stock or promising a restore', async () => {
    const sessionId = await issue([{ category_id: 3, quantity: 5 }]);
    const { data: saleId } = await fieldSale(sessionId, [{ product_id: BLACK_TOUCH, quantity: 2, unit_price: 450 }]);
    await submitAnyReturn(sessionId, [{ product_id: PLEASURE, returned_quantity: 3, lost_quantity: 0, usage: [] }]);
    expect((await db.rpc('approve_return', { p_session_id: sessionId, p_approver_id: 'admin-1', p_resolutions: [] })).error).toBeNull();
    auth.currentUser = await profile('admin-1');
    const stockAfterApproval = await stockOf(BLACK_TOUCH);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const modal = await openEditBill(saleId);
    expect(modal.querySelector('#edit-field-lock-note').textContent).toContain('Settled by an approved return');
    expect(modal.querySelector('.edit-item-qty').disabled).toBe(true);

    modal.querySelector('#edit-sale-delete').click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).not.toMatch(/Stock will be restored/);
    expect((await db.getById('sales', saleId)).data).toBeFalsy();
    expect(await stockOf(BLACK_TOUCH)).toBe(stockAfterApproval);
  });

  it('adds a Source column to the CSV export', async () => {
    const sessionId = await issue([{ product_id: BLACK_TOUCH, quantity: 3 }]);
    await fieldSale(sessionId, [{ product_id: BLACK_TOUCH, quantity: 1, unit_price: 450 }]);
    let csv = '';
    const OrigBlob = globalThis.Blob;
    vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts, opts) { csv = parts.join(''); return new OrigBlob(parts, opts); });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await renderPage();
    document.getElementById('btn-export-csv').click();
    const [head, first] = csv.replace('﻿', '').split('\n');
    expect(head).toContain('"Source"');
    expect(first).toContain(`"Field stock (#${sessionId})"`);
  });
});
