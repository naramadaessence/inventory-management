// Daily Operations Issue Stock / Request Stock window: searchable picker,
// "Any <category>" lines (knowledge-base/category-issue.md), stock checks, and
// the admin Approve Issue modal for a staff request with an Any line.
// Demo seed: category 2 = Smart Diffuser (5: 8 pcs, 6: 6 pcs), category 3 =
// Dispenser Refill (products 7–16, 219 pcs in all; 7 = Black Touch 40, 10 =
// Green Apple 3, 15 = Rose 15).

import { describe, it, expect, beforeEach } from 'vitest';
import { db, auth } from '../js/supabase.js';
import { renderDailyOps } from '../js/pages/daily-operations.js';

const REFILLS = 3;
const DIFFUSERS = 2;
const BLACK_TOUCH = 7;
const GREEN_APPLE = 10;

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

// Closed modals fade for 200ms before removal; the live one is the last non-faded overlay.
function currentModal() {
  const open = [...document.querySelectorAll('.modal-overlay')].filter(o => o.style.opacity !== '0');
  return open[open.length - 1];
}

function setValue(el, value, eventName = 'input') {
  el.value = value;
  el.dispatchEvent(new Event(eventName, { bubbles: true }));
}

async function signIn(id) {
  const { data: profiles } = await db.getAll('profiles');
  auth.currentUser = profiles.find(p => p.id === id);
}

async function stockOf(id) {
  return Number((await db.getById('products', id)).data.current_stock);
}

async function openIssueModal() {
  await renderDailyOps(document.getElementById('body'), document.getElementById('header'));
  document.getElementById('btn-new-checkout').click();
  await settle();
  return currentModal();
}

const row = (modal, kind, id) => modal.querySelector(`.sp-row[data-kind="${kind}"][data-id="${id}"]`);
const lineEls = modal => [...modal.querySelectorAll('.co-line')];

describe('daily operations issue stock window', () => {
  beforeEach(async () => {
    localStorage.clear();
    await auth.getSession(); // seeds the demo store
    await signIn('admin-1');
    document.body.innerHTML = '<div id="header"></div><div id="body"></div>';
  });

  it('search filters the product list and keeps the Any row of the matching category', async () => {
    const modal = await openIssueModal();
    expect(modal.querySelectorAll('.sp-row[data-kind="product"]').length).toBe(22);

    setValue(modal.querySelector('.sp-search'), 'rose');
    const shown = [...modal.querySelectorAll('.sp-row[data-kind="product"]')].map(r => r.dataset.id);
    expect(shown).toEqual(['15']);
    expect(row(modal, 'any', REFILLS)).not.toBeNull();

    setValue(modal.querySelector('.sp-search'), 'zzz');
    expect(modal.querySelector('.sp-empty').textContent).toContain('No products match');
  });

  it('category chips limit the list to one category', async () => {
    const modal = await openIssueModal();
    modal.querySelector(`.sp-chip[data-cat="${DIFFUSERS}"]`).click();
    const shown = [...modal.querySelectorAll('.sp-row[data-kind="product"]')].map(r => r.dataset.id);
    expect(shown).toEqual(['5', '6']);
    expect(row(modal, 'any', DIFFUSERS).textContent).toContain('14 pcs free');
  });

  it('greys out an out-of-stock product so an admin cannot pick it', async () => {
    await db.update('products', GREEN_APPLE, { current_stock: 0 });
    const modal = await openIssueModal();
    const out = row(modal, 'product', GREEN_APPLE);
    expect(out.disabled).toBe(true);
    expect(out.textContent).toContain('Out of stock');
    out.click();
    expect(lineEls(modal)).toHaveLength(0);
  });

  it('lets a seller pick an out-of-stock product with a warning', async () => {
    await db.update('products', GREEN_APPLE, { current_stock: 0 });
    await signIn('seller-1');
    const modal = await openIssueModal();
    const out = row(modal, 'product', GREEN_APPLE);
    expect(out.disabled).toBe(false);
    expect(out.textContent).toContain('admin will review');
    out.click();
    expect(lineEls(modal)).toHaveLength(1);
    expect(lineEls(modal)[0].classList.contains('is-over')).toBe(true);
    expect(modal.querySelector('#co-problem').classList.contains('is-warning')).toBe(true);
    expect(modal.querySelector('#co-submit').disabled).toBe(false);
  });

  it('picking a product twice adds to its quantity instead of a second line', async () => {
    const modal = await openIssueModal();
    row(modal, 'product', BLACK_TOUCH).click();
    row(modal, 'product', BLACK_TOUCH).click();
    expect(lineEls(modal)).toHaveLength(1);
    expect(modal.querySelector('.co-qty').value).toBe('2');
    expect(modal.querySelector('.co-line-stock').textContent).toBe('Stock 40 pcs → 38 pcs');
    expect(modal.querySelector('#co-summary').textContent).toBe('1 line · 2 pcs');

    modal.querySelector('.co-inc').click();
    expect(modal.querySelector('.co-qty').value).toBe('3');
    modal.querySelector('.co-dec').click();
    expect(modal.querySelector('.co-qty').value).toBe('2');
  });

  it('shows a liquid line in kg with a gram hint and sums the summary', async () => {
    const modal = await openIssueModal();
    row(modal, 'product', 17).click();
    row(modal, 'product', BLACK_TOUCH).click();
    expect(modal.querySelector('.co-hint').textContent).toBe('= 200 g');
    setValue(modal.querySelector('.co-kg .co-qty'), '1.25');
    expect(modal.querySelector('.co-hint').textContent).toBe('= 1 kg 250 g');
    expect(modal.querySelector('#co-summary').textContent).toBe('2 lines · 1 pcs + 1.250 kg');
  });

  it('Any row shows the category free stock after holds', async () => {
    await db.rpc('admin_issue_stock', { p_seller_id: 'seller-2', p_items: [{ category_id: REFILLS, quantity: 10 }], p_approver_id: 'admin-1' });
    const modal = await openIssueModal();
    expect(row(modal, 'any', REFILLS).textContent).toContain('209 pcs free');
    row(modal, 'any', REFILLS).click();
    const line = lineEls(modal)[0];
    expect(line.querySelector('.co-line-name').textContent).toContain('Any Dispenser Refill');
    expect(line.querySelector('.co-any-badge').textContent).toContain('types named on return');
    expect(line.querySelector('.co-line-stock').textContent).toBe('Free 209 pcs → 208 pcs');
  });

  it('admin issue with an Any line creates a held line without moving its stock', async () => {
    const refillsBefore = {};
    for (let id = 7; id <= 16; id++) refillsBefore[id] = await stockOf(id);
    const modal = await openIssueModal();
    setValue(modal.querySelector('#co-seller'), 'seller-1', 'change');
    row(modal, 'any', REFILLS).click();
    setValue(modal.querySelector('.co-qty'), '5');
    row(modal, 'product', BLACK_TOUCH).click();
    modal.querySelector('#co-submit').click();
    await settle();

    const { data: sessions } = await db.getAll('checkout_sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ seller_id: 'seller-1', status: 'checked_out' });
    const { data: items } = await db.getAll('checkout_items', { eq: { session_id: sessions[0].id } });
    const anyLine = items.find(i => i.product_id == null);
    expect(anyLine).toMatchObject({ category_id: REFILLS, checkout_quantity: 5 });
    expect((await db.rpc('get_category_holds', {})).data).toEqual([{ category_id: REFILLS, held: 5 }]);
    // Only the Black Touch product line left the shelf.
    for (let id = 7; id <= 16; id++) {
      expect(await stockOf(id)).toBe(refillsBefore[id] - (id === BLACK_TOUCH ? 1 : 0));
    }
    expect(document.querySelector('.tab-btn.active').dataset.tab).toBe('checked_out');
    expect(document.querySelector(`#sessions-list tr[data-session-id="${sessions[0].id}"]`).textContent).toContain('2 items');
  });

  it('disables Confirm while an Any line asks for more than is free, or a quantity is invalid', async () => {
    const modal = await openIssueModal();
    row(modal, 'any', DIFFUSERS).click();
    const submit = modal.querySelector('#co-submit');
    setValue(modal.querySelector('.co-qty'), '15');
    expect(submit.disabled).toBe(true);
    expect(lineEls(modal)[0].classList.contains('is-over')).toBe(true);
    expect(modal.querySelector('#co-problem').hidden).toBe(false);
    expect(modal.querySelector('#co-problem').textContent).toContain('Not enough Smart Diffuser');

    setValue(modal.querySelector('.co-qty'), '14');
    expect(submit.disabled).toBe(false);
    expect(modal.querySelector('#co-problem').hidden).toBe(true);

    setValue(modal.querySelector('.co-qty'), '1.5');
    expect(submit.disabled).toBe(true);
    expect(modal.querySelector('.co-line-msg').textContent).toBe('Whole pieces only');
  });

  it('a seller request with an Any line is approved by the admin and held', async () => {
    const before7 = await stockOf(BLACK_TOUCH);
    await signIn('seller-1');
    const modal = await openIssueModal();
    row(modal, 'any', REFILLS).click();
    setValue(modal.querySelector('.co-qty'), '3');
    modal.querySelector('#co-submit').click();
    await settle();

    const { data: [session] } = await db.getAll('checkout_sessions');
    expect(session.status).toBe('pending_issue');
    const { data: [line] } = await db.getAll('checkout_items', { eq: { session_id: session.id } });
    expect(line).toMatchObject({ product_id: null, category_id: REFILLS, checkout_quantity: 3, checkin_quantity: null });

    await signIn('admin-1');
    await renderDailyOps(document.getElementById('body'), document.getElementById('header'));
    document.querySelector(`#sessions-list tr[data-session-id="${session.id}"] .approve-issue-btn`).click();
    await settle();
    const approveModal = currentModal();
    expect(approveModal.textContent).toContain('Any Dispenser Refill');
    expect(approveModal.textContent).toContain('219 pcs free');
    const approve = approveModal.querySelector('#ai-approve');
    expect(approve.disabled).toBe(false);
    approve.click();
    await settle();

    expect((await db.getById('checkout_sessions', session.id)).data.status).toBe('checked_out');
    expect((await db.rpc('get_category_holds', {})).data).toEqual([{ category_id: REFILLS, held: 3 }]);
    expect(await stockOf(BLACK_TOUCH)).toBe(before7);
  });

  it('keeps Approve Issue disabled when an Any request exceeds the free category stock', async () => {
    await signIn('seller-1');
    const modal = await openIssueModal();
    row(modal, 'any', DIFFUSERS).click();
    setValue(modal.querySelector('.co-qty'), '20');
    modal.querySelector('#co-submit').click();
    await settle();
    currentModal().querySelector('[data-role="confirm"]').click(); // "Submit anyway"
    await settle();
    const { data: [session] } = await db.getAll('checkout_sessions');
    expect(session.status).toBe('pending_issue');

    await signIn('admin-1');
    await renderDailyOps(document.getElementById('body'), document.getElementById('header'));
    document.querySelector(`#sessions-list tr[data-session-id="${session.id}"] .approve-issue-btn`).click();
    await settle();
    const approveModal = currentModal();
    expect(approveModal.querySelector('#ai-approve').disabled).toBe(true);
    expect(approveModal.querySelector('.ai-problem').textContent).toContain('Not enough Smart Diffuser');
  });
});
