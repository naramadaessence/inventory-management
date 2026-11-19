// Daily Operations return flow UI: Submit Return (Returned + usage → submit_return),
// Mismatch badge, Approve Return classification gate, Send back (reject_return).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, auth } from '../js/supabase.js';
import { renderDailyOps } from '../js/pages/daily-operations.js';

const OIL = 17;      // Cool Water Diffuser Oil — liquid, tolerance 0.010 kg
const MACHINE = 1;   // NE 001 dispenser — machine (whole numbers, customer for installation)

// Let pending promise chains (demo db calls are async) run to completion.
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

async function issue(items) {
  const { data: sessionId } = await db.rpc('admin_issue_stock', {
    p_seller_id: 'seller-1',
    p_items: items.map(([product_id, quantity]) => ({ product_id, quantity })),
    p_approver_id: 'admin-1',
  });
  return sessionId;
}

async function itemsOf(sessionId) {
  const { data } = await db.getAll('checkout_items', { eq: { session_id: sessionId } });
  return data;
}

async function submitViaRpc(sessionId, returned, used) {
  const [item] = await itemsOf(sessionId);
  const { error } = await db.rpc('submit_return', {
    p_session_id: sessionId,
    p_items: [{ item_id: item.id, returned_quantity: returned, usage: used ? [{ reason: 'customer_service', quantity: used }] : [] }],
    p_notes: '',
    p_submitted_by: 'admin-1',
  });
  expect(error).toBeNull();
}

async function renderPage() {
  await renderDailyOps(document.getElementById('body'), document.getElementById('header'));
}

async function openTab(tab) {
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).click();
}

function sessionRow(sessionId) {
  return document.querySelector(`#sessions-list tr[data-session-id="${sessionId}"]`);
}

describe('daily operations returns', () => {
  beforeEach(async () => {
    localStorage.clear();
    await auth.getSession(); // seeds the demo store
    const { data: profiles } = await db.getAll('profiles');
    auth.currentUser = profiles.find(p => p.role === 'admin');
    document.body.innerHTML = '<div id="header"></div><div id="body"></div>';
  });

  async function openSubmitReturn(sessionId) {
    await renderPage();
    sessionRow(sessionId).querySelector('.checkin-btn').click();
    await settle();
    return currentModal();
  }

  it('submits a matching return (Returned + usage) through submit_return without a mismatch', async () => {
    const sessionId = await issue([[OIL, 1]]);
    const modal = await openSubmitReturn(sessionId);

    setValue(modal.querySelector('.ci-returned'), '0.7');
    modal.querySelector('.ci-add-usage').click();
    setValue(modal.querySelector('.ci-u-qty'), '0.295');
    // 1 − 0.7 − 0.295 = 0.005 kg, inside the 0.010 kg tolerance
    expect(modal.querySelector('.ci-used').textContent).toBe('0.295 kg');
    expect(modal.querySelector('.ci-item').dataset.state).toBe('match');
    expect(modal.querySelector('.ci-diff').textContent).toContain('Matches');

    modal.querySelector('#ci-submit').click();
    await settle();

    const { data: session } = await db.getById('checkout_sessions', sessionId);
    expect(session.status).toBe('pending_approval');
    expect(session.has_discrepancy).toBe(false);
    const [item] = await itemsOf(sessionId);
    expect(item.checkin_quantity).toBe(0.7);
    expect(item.used_quantity).toBe(0.295);
    expect(item.has_mismatch).toBe(false);
    const { data: usage } = await db.getAll('checkout_usage', { eq: { session_id: sessionId } });
    expect(usage).toHaveLength(1);
    expect(usage[0].reason).toBe('customer_service');

    await openTab('pending_approval');
    expect(sessionRow(sessionId)).not.toBeNull();
    expect(sessionRow(sessionId).querySelector('.mismatch-badge')).toBeNull();
  });

  it('shows a red Mismatch badge after a shortage return', async () => {
    const sessionId = await issue([[OIL, 1]]);
    const modal = await openSubmitReturn(sessionId);

    setValue(modal.querySelector('.ci-returned'), '0.5');
    expect(modal.querySelector('.ci-item').dataset.state).toBe('shortage');
    expect(modal.querySelector('.ci-diff').textContent).toContain('0.500 kg');
    modal.querySelector('#ci-submit').click();
    await settle();

    const { data: session } = await db.getById('checkout_sessions', sessionId);
    expect(session.has_discrepancy).toBe(true);
    await openTab('pending_approval');
    const badge = sessionRow(sessionId).querySelector('.mismatch-badge');
    expect(badge).not.toBeNull();
    expect(badge.classList.contains('red')).toBe(true);
    expect(badge.textContent).toContain('Mismatch');
  });

  it('requires a customer for an installed machine before submitting', async () => {
    const sessionId = await issue([[MACHINE, 2]]);
    const modal = await openSubmitReturn(sessionId);

    setValue(modal.querySelector('.ci-returned'), '1');
    modal.querySelector('.ci-add-usage').click();
    setValue(modal.querySelector('.ci-u-reason'), 'installation', 'change');
    setValue(modal.querySelector('.ci-u-qty'), '1');
    modal.querySelector('#ci-submit').click();
    await settle();

    let { data: session } = await db.getById('checkout_sessions', sessionId);
    expect(session.status).toBe('checked_out');

    setValue(modal.querySelector('.ci-u-party'), '1', 'change');
    modal.querySelector('#ci-submit').click();
    await settle();

    ({ data: session } = await db.getById('checkout_sessions', sessionId));
    expect(session.status).toBe('pending_approval');
    const { data: usage } = await db.getAll('checkout_usage', { eq: { session_id: sessionId } });
    expect(usage[0]).toMatchObject({ reason: 'installation', quantity: 1, party_id: 1 });
  });

  it('keeps Approve disabled until every mismatch is classified, then approves', async () => {
    const sessionId = await issue([[OIL, 1]]);
    await submitViaRpc(sessionId, 0.5, 0.2); // difference 0.300 kg shortage
    const { data: before } = await db.getById('products', OIL);

    await renderPage();
    await openTab('pending_approval');
    sessionRow(sessionId).querySelector('.approve-return-btn').click();
    await settle();
    const modal = currentModal();
    const approve = modal.querySelector('#ar-approve');

    expect(modal.textContent).toContain('Installed Qty');
    expect(approve.disabled).toBe(true);
    setValue(modal.querySelector('.ar-type'), 'wastage', 'change');
    expect(approve.disabled).toBe(true);
    setValue(modal.querySelector('.ar-note'), 'Spilled during refill');
    expect(approve.disabled).toBe(false);

    approve.click();
    await settle();

    const { data: session } = await db.getById('checkout_sessions', sessionId);
    expect(session.status).toBe('checked_in');
    const [item] = await itemsOf(sessionId);
    expect(item.discrepancy_type).toBe('wastage');
    expect(item.discrepancy_note).toBe('Spilled during refill');
    const { data: after } = await db.getById('products', OIL);
    expect(after.current_stock).toBeCloseTo(before.current_stock + 0.5, 6);
  });

  it('Send back returns the session to In Field with the reason in its notes', async () => {
    const sessionId = await issue([[OIL, 1]]);
    await submitViaRpc(sessionId, 0.5, 0);

    await renderPage();
    await openTab('pending_approval');
    sessionRow(sessionId).querySelector('.send-back-btn').click();
    await settle();
    const modal = currentModal();

    modal.querySelector('#sb-confirm').click(); // empty reason is refused
    await settle();
    let { data: session } = await db.getById('checkout_sessions', sessionId);
    expect(session.status).toBe('pending_approval');

    setValue(modal.querySelector('#sb-reason'), 'Recount the oil');
    modal.querySelector('#sb-confirm').click();
    await settle();

    ({ data: session } = await db.getById('checkout_sessions', sessionId));
    expect(session.status).toBe('checked_out');
    expect(session.notes).toContain('Recount the oil');
    // List re-rendered on the default In Field tab, with Submit Return available again.
    expect(sessionRow(sessionId).querySelector('.checkin-btn')).not.toBeNull();
  });

  it('shows Used and Difference as "—" for legacy returns without usage data', async () => {
    const sessionId = await issue([[OIL, 1]]);
    const [item] = await itemsOf(sessionId);
    await db.update('checkout_items', item.id, { checkin_quantity: 0.4 });
    await db.update('checkout_sessions', sessionId, { status: 'checked_in' });

    await renderPage();
    await openTab('checked_in');
    sessionRow(sessionId).querySelector('.view-btn').click();
    await settle();
    const cells = [...currentModal().querySelectorAll('tbody tr td')].map(td => td.textContent.trim());
    expect(cells.slice(1, 5)).toEqual(['1.000 kg', '0.400 kg', '—', '—']);
    expect(currentModal().querySelector('.badge-status.red')).toBeNull();
  });

  describe('Any <category> lines and bills from field stock', () => {
    const REFILLS = 3;     // Dispenser Refill (unit)
    const BLACK_TOUCH = 7; // 40 pcs
    const PLEASURE = 8;    // 35 pcs
    const LAVENDER = 9;    // 30 pcs
    const ROSE = 15;       // 15 pcs

    async function issueRaw(items) {
      const { data: sessionId, error } = await db.rpc('admin_issue_stock', { p_seller_id: 'seller-1', p_items: items, p_approver_id: 'admin-1' });
      expect(error).toBeNull();
      return sessionId;
    }
    const stockOf = async id => Number((await db.getById('products', id)).data.current_stock);
    const children = async sessionId => (await itemsOf(sessionId)).filter(i => i.parent_item_id != null)
      .map(c => [c.product_id, c.checkout_quantity, c.checkin_quantity, c.difference]);

    it('blocks Submit until every piece of an Any line is named, then writes child rows', async () => {
      const sessionId = await issueRaw([{ category_id: REFILLS, quantity: 4 }]);
      let modal = await openSubmitReturn(sessionId);
      const submit = modal.querySelector('#ci-submit');
      expect(modal.querySelector('.ci-any-counter').textContent).toBe('Accounted 0 pcs of 4 pcs');
      expect(modal.querySelector('.ci-any-left').textContent).toBe('4 pcs left to name');
      expect(submit.disabled).toBe(true);

      // Only this category's products can be chosen.
      const options = [...modal.querySelectorAll('.ci-a-product option')].map(o => o.value).filter(Boolean);
      expect(options).toHaveLength(10);
      setValue(modal.querySelector('.ci-a-product'), String(BLACK_TOUCH), 'change');
      setValue(modal.querySelector('.ci-a-returned'), '3');
      expect(modal.querySelector('.ci-any-counter').textContent).toBe('Accounted 3 pcs of 4 pcs');
      expect(modal.querySelector('.ci-any-count').dataset.state).toBe('short');
      expect(submit.disabled).toBe(true);

      modal.querySelector('.ci-any-add').click();
      setValue(modal.querySelectorAll('.ci-a-product')[1], String(ROSE), 'change');
      // Black Touch is taken by the first row, so it can't be chosen twice.
      expect(modal.querySelectorAll('.ci-a-product')[1].querySelector(`option[value="${BLACK_TOUCH}"]`).disabled).toBe(true);
      setValue(modal.querySelectorAll('.ci-a-lost')[1], '2');
      expect(modal.querySelector('.ci-any-left').textContent).toBe('1 pcs too many');
      expect(submit.disabled).toBe(true);
      setValue(modal.querySelectorAll('.ci-a-lost')[1], '1');
      expect(modal.querySelector('.ci-any-count').dataset.state).toBe('match');
      expect(modal.querySelector('.ci-any-left').textContent).toBe('All named');
      expect(submit.disabled).toBe(false);

      // Usage reasons never offer "sold" (it only comes from bills).
      modal.querySelector('.ci-any-entry .ci-add-usage').click();
      expect([...modal.querySelectorAll('.ci-u-reason option')].map(o => o.value)).not.toContain('sold');
      modal.querySelector('.ci-u-rm').click();

      modal.querySelector('#ci-submit').click();
      await settle();
      const { data: session } = await db.getById('checkout_sessions', sessionId);
      expect(session.status).toBe('pending_approval');
      expect(session.has_discrepancy).toBe(true); // the lost Rose Refill
      expect(await children(sessionId)).toEqual([[BLACK_TOUCH, 3, 3, 0], [ROSE, 1, 0, 1]]);
    });

    it('shows Sold lines from bills linked to the session and does not send them as usage', async () => {
      const sessionId = await issueRaw([{ product_id: BLACK_TOUCH, quantity: 2 }, { category_id: REFILLS, quantity: 5 }]);
      const { error } = await db.rpc('record_sale', {
        p_party_id: 1, p_items: [{ product_id: BLACK_TOUCH, quantity: 3, unit_price: 450 }, { product_id: PLEASURE, quantity: 1, unit_price: 450 }],
        p_payment_status: 'paid', p_payment_method: 'cash', p_amount_received: 0, p_expected_payment_date: null,
        p_sale_date: '2026-11-19', p_notes: '', p_recorded_by: 'seller-1', p_sale_type: 'gst', p_checkout_session_id: sessionId,
      });
      expect(error).toBeNull();

      const modal = await openSubmitReturn(sessionId);
      const [productBlock, anyBlock] = modal.querySelectorAll('.ci-item');
      // Black Touch's own line takes 2 of the 3 sold; the 3rd and the Pleasure come from the Any line.
      expect(productBlock.querySelector('.ci-sold-line').textContent.replace(/\s+/g, ' ')).toContain('Sold · Bill #1 · Hotel Grand Bhagwati · 2 pcs');
      expect(productBlock.querySelector('.ci-returned').value).toBe('0');
      expect(productBlock.querySelector('.ci-used').textContent).toBe('2 pcs');
      expect(productBlock.dataset.state).toBe('match');
      const fixed = [...anyBlock.querySelectorAll('.ci-any-entry-head > strong')].map(el => el.textContent);
      expect(fixed).toEqual(['Black Touch Refill', 'Pleasure Refill']);
      expect(anyBlock.querySelector('.ci-any-counter').textContent).toBe('Accounted 2 pcs of 5 pcs');

      anyBlock.querySelector('.ci-any-add').click();
      setValue(modal.querySelectorAll('.ci-a-product')[0], String(LAVENDER), 'change');
      setValue(modal.querySelectorAll('.ci-any-entry')[2].querySelector('.ci-a-returned'), '3');
      expect(modal.querySelectorAll('.ci-item')[1].dataset.state).toBe('match');

      const rpc = vi.spyOn(db, 'rpc');
      modal.querySelector('#ci-submit').click();
      await settle();
      const call = rpc.mock.calls.find(([name]) => name === 'submit_return');
      rpc.mockRestore();
      const [productEntry, anyEntry] = call[1].p_items;
      expect(productEntry).toMatchObject({ returned_quantity: 0, usage: [] });
      expect(anyEntry.breakdown).toEqual([{ product_id: LAVENDER, returned_quantity: 3, lost_quantity: 0, usage: [] }]);

      expect((await db.getById('checkout_sessions', sessionId)).data.status).toBe('pending_approval');
      const { data: usage } = await db.getAll('checkout_usage', { eq: { session_id: sessionId } });
      expect(usage.filter(u => u.reason === 'sold').map(u => [u.product_id, u.quantity, u.sale_id]).sort()).toEqual([
        [BLACK_TOUCH, 1, 1], [BLACK_TOUCH, 2, 1], [PLEASURE, 1, 1],
      ]);
    });

    it('Approve Return lists Any child rows and asks to classify a lost piece', async () => {
      const before = { 7: await stockOf(BLACK_TOUCH), 15: await stockOf(ROSE) };
      const sessionId = await issueRaw([{ category_id: REFILLS, quantity: 4 }]);
      const [anyLine] = await itemsOf(sessionId);
      const { error } = await db.rpc('submit_return', {
        p_session_id: sessionId,
        p_items: [{ item_id: anyLine.id, breakdown: [
          { product_id: BLACK_TOUCH, returned_quantity: 3, lost_quantity: 0, usage: [] },
          { product_id: ROSE, returned_quantity: 0, lost_quantity: 1, usage: [] },
        ] }],
        p_notes: '', p_submitted_by: 'seller-1',
      });
      expect(error).toBeNull();

      await renderPage();
      await openTab('pending_approval');
      expect(sessionRow(sessionId).textContent).toContain('1 item');
      sessionRow(sessionId).querySelector('.approve-return-btn').click();
      await settle();
      const modal = currentModal();
      expect(modal.querySelector('.ds-any-row').textContent).toContain('Any Dispenser Refill');
      const childRows = [...modal.querySelectorAll('.ds-child-row')];
      expect(childRows.map(r => r.cells[0].textContent.trim())).toEqual(['↳ Black Touch Refill', '↳ Rose Refill']);
      expect(childRows[1].textContent).toContain('Lost');
      const resolutions = modal.querySelectorAll('.ar-resolution');
      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].textContent.replace(/\s+/g, ' ')).toContain('Rose Refill — lost 1 pc (from Any Dispenser Refill)');
      expect(modal.textContent).toContain('Any lines take stock off each named product');

      const approve = modal.querySelector('#ar-approve');
      expect(approve.disabled).toBe(true);
      setValue(modal.querySelector('.ar-type'), 'loss', 'change');
      setValue(modal.querySelector('.ar-note'), 'Dropped at site');
      expect(approve.disabled).toBe(false);
      approve.click();
      await settle();

      expect((await db.getById('checkout_sessions', sessionId)).data.status).toBe('checked_in');
      expect(await stockOf(BLACK_TOUCH)).toBe(before[7]);
      expect(await stockOf(ROSE)).toBe(before[15] - 1);
    });

    it('View Session shows an Any line still in the field as types named on return', async () => {
      const sessionId = await issueRaw([{ category_id: REFILLS, quantity: 6 }]);
      await renderPage();
      sessionRow(sessionId).querySelector('.view-btn').click();
      await settle();
      const anyRow = currentModal().querySelector('.ds-any-row');
      expect(anyRow.textContent.replace(/\s+/g, ' ')).toContain('Any Dispenser Refill');
      expect(anyRow.textContent).toContain('6 pcs issued, types named on return');
    });
  });

  describe('which tab opens', () => {
    const activeTab = () => document.querySelector('.tab-btn.active')?.dataset.tab;

    it('opens on Pending Issue for an admin when a staff request is waiting', async () => {
      await db.insert('checkout_sessions', { seller_id: 'seller-1', status: 'pending_issue', checkout_time: new Date().toISOString() });
      await renderPage();
      expect(activeTab()).toBe('pending_issue');
    });

    it('opens on In Field for a staff member who has stock out', async () => {
      await issue([[OIL, 1]]);
      const { data: profiles } = await db.getAll('profiles');
      auth.currentUser = profiles.find(p => p.id === 'seller-1');
      await renderPage();
      expect(activeTab()).toBe('checked_out');
    });

    it('switches to Pending Return after a return is submitted', async () => {
      const sessionId = await issue([[OIL, 1]]);
      const modal = await openSubmitReturn(sessionId);
      modal.querySelector('#ci-submit').click();
      await settle();
      expect(activeTab()).toBe('pending_approval');
      expect(sessionRow(sessionId)).not.toBeNull();
    });
  });
});
