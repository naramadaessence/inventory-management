// Daily Operations return flow UI: Submit Return (Returned + usage → submit_return),
// Mismatch badge, Approve Return classification gate, Send back (reject_return).

import { describe, it, expect, beforeEach } from 'vitest';
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
