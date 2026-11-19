import { db, auth } from '../supabase.js';
import {
  formatStock, formatDateTime, showToast, createModal, esc, dbOp, withSaving,
  USAGE_REASONS, DISCREPANCY_TYPES, isMachineCategory,
} from '../utils/helpers.js';
import {
  isAnyLine, isChildLine, anyLineLabel, holdsMap, categoryFreeStock, issueProblem, allocateSold,
} from '../utils/field-stock.js';
import { createStockPicker } from '../utils/stock-picker.js';

export async function renderDailyOps(body, header) {
  const isAdmin = auth.isAdmin();
  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Daily Operations</h1>
      <div class="page-header-subtitle">${isAdmin ? 'Issue, return & approval workflow' : 'Your field stock & returns'}</div>
    </div>
    <button class="btn btn-primary" id="btn-new-checkout"><i class="fas fa-arrow-right-from-bracket"></i> ${isAdmin ? 'New Issue' : 'Request Stock'}</button>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  await renderSessionsList(body, isAdmin);
  document.getElementById('btn-new-checkout').addEventListener('click', () => openCheckoutModal(body, isAdmin));
}

// ============================================
// RETURN CROSS-CHECK HELPERS (Difference = Issued − Returned − Used)
// ============================================
// Defaults match migration 016 / demo app_settings.
const DEFAULT_TOLERANCES = { liquid: 0.010, unit: 0 };

function round3(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

async function loadTolerances() {
  const { data } = await db.getAll('app_settings');
  const read = (key, fallback) => {
    const value = Number((data || []).find(s => s.key === key)?.value);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    liquid: read('liquid_tolerance_kg', DEFAULT_TOLERANCES.liquid),
    unit: read('unit_tolerance', DEFAULT_TOLERANCES.unit),
  };
}

// Same rule as submit_return: beyond the tolerance (with float epsilon) is a mismatch.
function differenceState(diff, type, tolerances) {
  const tol = type === 'liquid' ? tolerances.liquid : tolerances.unit;
  if (Math.abs(diff) <= tol + 1e-9) return 'match';
  return diff > 0 ? 'shortage' : 'excess';
}

const DIFF_STYLES = {
  match: { color: 'var(--green)', badge: 'green', label: 'Matches' },
  shortage: { color: 'var(--red)', badge: 'red', label: 'Shortage' },
  excess: { color: 'var(--accent)', badge: 'amber', label: 'Excess' },
};

function differenceHTML(diff, type, state) {
  const s = DIFF_STYLES[state];
  return `<span style="color:${s.color};font-weight:700;">${formatStock(round3(Math.abs(diff)), type)}</span>
    <span class="badge-status ${s.badge}">${s.label}</span>`;
}

// State of a stored (submitted) return item; null for legacy rows submitted
// before migration 016 (used_quantity NULL) — those are never a mismatch.
function storedState(item) {
  if (item.checkin_quantity == null || item.used_quantity == null) return null;
  if (!item.has_mismatch) return 'match';
  return Number(item.difference) > 0 ? 'shortage' : 'excess';
}

function usageLinesHTML(lines, type, partyMap) {
  if (!lines.length) return '';
  return lines.map(u => `<div style="font-size:0.78rem;color:var(--text-secondary);margin-top:2px;">
      ${esc(USAGE_REASONS[u.reason] || u.reason)}: <strong>${formatStock(Number(u.quantity), type)}</strong>${u.party_id ? ` · ${esc(partyMap[u.party_id]?.name || `Customer #${u.party_id}`)}` : ''}${u.notes ? ` <span style="color:var(--text-muted);">— ${esc(u.notes)}</span>` : ''}
    </div>`).join('');
}

// Issued / Returned / Used / Difference cells for a stored return item.
function storedQtyCells(item, type, lines, partyMap) {
  const returned = item.checkin_quantity != null ? formatStock(Number(item.checkin_quantity), type) : '—';
  const state = storedState(item);
  const used = state ? `${formatStock(Number(item.used_quantity), type)}${usageLinesHTML(lines, type, partyMap)}` : '—';
  const diff = state ? differenceHTML(Number(item.difference), type, state) : '—';
  return `<td>${formatStock(Number(item.checkout_quantity), type)}</td><td>${returned}</td><td>${used}</td><td>${diff}</td>`;
}

async function loadReturnDetails(sessionId) {
  const [itemsRes, usageRes, productsRes, partiesRes, categoriesRes] = await Promise.all([
    db.getAll('checkout_items', { eq: { session_id: sessionId } }),
    db.getAll('checkout_usage', { eq: { session_id: sessionId } }),
    db.getAll('products'),
    db.getAll('parties'),
    db.getAll('categories'),
  ]);
  const items = (itemsRes.data || []).slice().sort((a, b) => a.id - b.id);
  return {
    items,
    usage: usageRes.data || [],
    prodMap: Object.fromEntries((productsRes.data || []).map(p => [p.id, p])),
    partyMap: Object.fromEntries((partiesRes.data || []).map(p => [p.id, p])),
    catMap: Object.fromEntries((categoriesRes.data || []).map(c => [c.id, c])),
  };
}

// Table rows for a session: product lines as they are; an Any line as a header
// row with its child rows (one per named product, written on the return)
// indented under it. Columns: Product, Issued, Returned, Used, Difference, Status.
function sessionRowsHTML({ items, usage, prodMap, catMap, partyMap }, { bold = false } = {}) {
  const productRow = (i, isChild) => {
    const p = prodMap[i.product_id];
    const name = esc(p?.name || 'Unknown');
    return `<tr class="${isChild ? 'ds-child-row' : ''}" style="${i.has_mismatch ? 'background:var(--red-soft);' : ''}">
        <td>${isChild ? '<span class="ds-child-mark" aria-hidden="true">↳</span> ' : ''}${bold ? `<strong>${name}</strong>` : name}</td>
        ${storedQtyCells(i, p?.type, usage.filter(u => u.item_id === i.id), partyMap)}
        <td>${itemStatusHTML(i, isChild)}</td>
      </tr>`;
  };
  return items.filter(i => !isChildLine(i)).map(i => {
    if (!isAnyLine(i)) return productRow(i, false);
    const cat = catMap[i.category_id];
    const children = items.filter(c => c.parent_item_id === i.id);
    const issued = formatStock(Number(i.checkout_quantity || 0), cat?.type);
    return `<tr class="ds-any-row">
        <td><strong>${esc(anyLineLabel(cat))}</strong> <span class="co-any-badge">Any</span></td>
        <td>${issued}</td>
        <td colspan="4" class="ds-any-note">${children.length ? 'Types named on return:' : `${issued} issued, types named on return`}</td>
      </tr>${children.map(c => productRow(c, true)).join('')}`;
  }).join('');
}

// Small in-app confirmation (replaces native confirm()). Resolves true on confirm.
function confirmModal(title, messageHTML, confirmLabel, btnClass = 'btn-danger') {
  return new Promise(resolve => {
    const footer = `<button class="btn btn-secondary" data-role="cancel">Cancel</button>
      <button class="btn ${btnClass}" data-role="confirm">${esc(confirmLabel)}</button>`;
    const { overlay, close } = createModal(title, `<p style="font-size:0.9rem;">${messageHTML}</p>`, { footer });
    overlay.querySelector('[data-role="cancel"]').onclick = () => { close(); resolve(false); };
    overlay.querySelector('[data-role="confirm"]').onclick = () => { close(); resolve(true); };
  });
}

// Open on the tab that needs attention unless a caller asks for a specific one.
function defaultTab(counts, isAdmin) {
  const order = isAdmin
    ? ['pending_issue', 'pending_approval', 'checked_out']
    : ['checked_out', 'pending_issue', 'pending_approval'];
  return order.find(tab => counts[tab] > 0) || 'checked_out';
}

async function renderSessionsList(body, isAdmin, preferredTab) {
  const { data: sessions } = await db.fetchAllPaged('checkout_sessions', { orderBy: ['created_at', 'desc'] });
  const { data: profiles } = await db.getAll('profiles');
  const { data: items } = await db.fetchAllPaged('checkout_items');
  const { data: products } = await db.getAll('products');
  const sellerMap = Object.fromEntries(profiles.map(p => [p.id, p]));
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
  const vis = isAdmin ? sessions : sessions.filter(s => s.seller_id === auth.currentUser.id);

  const counts = { pending_issue: 0, checked_out: 0, pending_approval: 0, flagged: 0 };
  vis.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });

  body.innerHTML = `
    <div class="tabs">
      <button class="tab-btn" data-tab="pending_issue">Pending Issue (${counts.pending_issue})</button>
      <button class="tab-btn" data-tab="checked_out">In Field (${counts.checked_out})</button>
      <button class="tab-btn" data-tab="pending_approval">Pending Return (${counts.pending_approval})</button>
      <button class="tab-btn" data-tab="checked_in">Completed</button>
      <button class="tab-btn" data-tab="flagged">Flagged (${counts.flagged})</button>
    </div>
    ${(counts.pending_issue + counts.pending_approval > 0) ? `<div style="background:var(--accent-soft);border:1px solid var(--accent);border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">
      <i class="fas fa-bell" style="color:var(--accent);font-size:1.1rem;"></i>
      <span>${isAdmin ? `<strong>${counts.pending_issue + counts.pending_approval}</strong> session(s) awaiting your action.` : `<strong>${counts.pending_issue + counts.pending_approval}</strong> of your request(s) are pending admin approval.`}</span>
    </div>` : ''}
    <div id="sessions-list"></div>`;

  let activeTab = preferredTab || defaultTab(counts, isAdmin);
  body.querySelector(`.tab-btn[data-tab="${activeTab}"]`)?.classList.add('active');

  function renderTab() {
    const filtered = vis.filter(s => s.status === activeTab);
    const container = document.getElementById('sessions-list');
    if (!filtered.length) {
      const labels = { pending_issue: 'pending issue', checked_out: 'active', pending_approval: 'pending return', checked_in: 'completed', flagged: 'flagged' };
      container.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><h3>No ${labels[activeTab] || activeTab} sessions</h3></div>`;
      return;
    }

    container.innerHTML = `<div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Seller</th><th>Issue Time</th><th>Return Time</th><th>Items</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${filtered.map(s => {
        const seller = sellerMap[s.seller_id];
        // Issue lines only: child rows of an Any line are not extra items.
        const sItems = items.filter(i => i.session_id === s.id && !isChildLine(i));
        const isMine = s.seller_id === auth.currentUser.id;
        let actions = '';

        if (s.status === 'pending_issue' && isAdmin) {
          actions += `<button class="btn btn-sm btn-primary approve-issue-btn" data-id="${s.id}" style="background:var(--green);border-color:var(--green);"><i class="fas fa-check"></i> Approve Issue</button> `;
          actions += `<button class="btn btn-sm btn-danger flag-btn" data-id="${s.id}"><i class="fas fa-times"></i> Reject</button>`;
        }
        if (s.status === 'checked_out' && (isMine || isAdmin)) {
          actions += `<button class="btn btn-sm btn-primary checkin-btn" data-id="${s.id}"><i class="fas fa-arrow-left"></i> Submit Return</button>`;
        }
        if (s.status === 'pending_approval' && isAdmin) {
          actions += `<button class="btn btn-sm btn-primary approve-return-btn" data-id="${s.id}" style="background:var(--green);border-color:var(--green);"><i class="fas fa-check-double"></i> Approve Return</button> `;
          actions += `<button class="btn btn-sm btn-secondary send-back-btn" data-id="${s.id}"><i class="fas fa-rotate-left"></i> Send back</button>`;
        }
        actions += ` <button class="btn btn-sm btn-ghost view-btn" data-id="${s.id}" aria-label="View session"><i class="fas fa-eye"></i></button>`;

        const colors = { pending_issue: 'purple', checked_out: 'blue', pending_approval: 'amber', checked_in: 'green', flagged: 'red' };
        const labels = { pending_issue: 'Pending Issue', checked_out: 'In Field', pending_approval: 'Pending Return', checked_in: 'Approved', flagged: 'Flagged' };
        const highlight = (s.status === 'pending_issue' || s.status === 'pending_approval') ? ' style="background:var(--accent-soft);"' : '';
        const mismatch = s.has_discrepancy ? ' <span class="badge-status red mismatch-badge"><i class="fas fa-triangle-exclamation"></i> Mismatch</span>' : '';

        return `<tr${highlight} data-session-id="${s.id}">
          <td><strong>${esc(seller?.full_name || 'Unknown')}</strong></td>
          <td>${formatDateTime(s.checkout_time)}</td>
          <td>${s.checkin_time ? formatDateTime(s.checkin_time) : '<span style="color:var(--text-muted);">—</span>'}</td>
          <td>${sItems.length} item${sItems.length === 1 ? '' : 's'}</td>
          <td><span class="badge-status ${colors[s.status]}">${labels[s.status]}</span>${mismatch}</td>
          <td>${actions}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;

    container.querySelectorAll('.approve-issue-btn').forEach(el => el.addEventListener('click', () => approveIssue(parseInt(el.dataset.id), body, items, prodMap)));
    container.querySelectorAll('.checkin-btn').forEach(el => el.addEventListener('click', () => openCheckinModal(parseInt(el.dataset.id), body, isAdmin)));
    container.querySelectorAll('.approve-return-btn').forEach(el => el.addEventListener('click', () => openApproveReturnModal(parseInt(el.dataset.id), body)));
    container.querySelectorAll('.send-back-btn').forEach(el => el.addEventListener('click', () => openSendBackModal(parseInt(el.dataset.id), body)));
    container.querySelectorAll('.flag-btn').forEach(el => el.addEventListener('click', () => rejectIssue(parseInt(el.dataset.id), body, isAdmin)));
    container.querySelectorAll('.view-btn').forEach(el => el.addEventListener('click', () => viewSession(parseInt(el.dataset.id))));
  }

  body.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
    body.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    renderTab();
  }));
  renderTab();
}

// Status cell for a stored item: match / mismatch (+ classification once resolved) / legacy flag.
// Child rows of an Any line can only be short by their lost pieces: labelled "Lost".
function itemStatusHTML(item, isChild = false) {
  if (item.checkin_quantity == null) return '<span style="color:var(--text-muted);">Not returned</span>';
  const state = storedState(item);
  if (!state) {
    return item.is_flagged ? '<span class="badge-status red">⚠ Over</span>' : '<span class="badge-status green">OK</span>';
  }
  const s = DIFF_STYLES[state];
  let html = `<span class="badge-status ${s.badge}">${isChild && state === 'shortage' ? 'Lost' : s.label}</span>`;
  if (item.discrepancy_type) {
    html += `<div style="font-size:0.78rem;margin-top:4px;"><strong>${esc(DISCREPANCY_TYPES[item.discrepancy_type] || item.discrepancy_type)}</strong></div>`;
    if (item.discrepancy_note) html += `<div style="font-size:0.78rem;color:var(--text-secondary);">${esc(item.discrepancy_note)}</div>`;
  }
  if (!item.has_mismatch && item.is_flagged && item.flag_reason) {
    html += `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${esc(item.flag_reason)}</div>`;
  }
  return html;
}

async function viewSession(sessionId) {
  const details = await loadReturnDetails(sessionId);
  const { items } = details;
  const { data: session } = await db.getById('checkout_sessions', sessionId);
  if (!items.length) { createModal('Session', '<p style="color:var(--text-muted);">No items.</p>'); return; }
  const content = `<div class="table-wrapper"><table class="data-table">
    <thead><tr><th>Product</th><th>Issued</th><th>Returned</th><th>Used</th><th>Difference</th><th>Status</th></tr></thead>
    <tbody>${sessionRowsHTML(details)}</tbody></table></div>
    ${session?.notes ? `<div style="margin-top:14px;padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);font-size:0.85rem;">
      <strong>Notes</strong><div style="white-space:pre-wrap;margin-top:4px;">${esc(session.notes)}</div></div>` : ''}`;
  createModal('Session Details', content, { large: true });
}

// ============================================
// SELLER/ADMIN: Request stock (pending_issue)
// ============================================
// Issue lines: a product, or "Any <category>" (types named on return).
// Quantities are kept as the raw input strings.
const EPS = 1e-9;
const qtyOf = raw => (String(raw ?? '').trim() === '' ? NaN : Number(raw));
const defaultQty = type => (type === 'liquid' ? 0.2 : 1);
// Quantity input text: liquids always with 3 decimals (0.200 kg).
const qtyText = (qty, type) => (type === 'liquid' ? Number(qty).toFixed(3) : String(qty));
const pcs = n => `${n} pc${Number(n) === 1 ? '' : 's'}`;

// "= 200 g" / "= 1 kg 250 g" under a liquid quantity.
function gramsHint(kg) {
  if (!Number.isFinite(kg) || kg <= 0) return '';
  const grams = Math.round(kg * 1000);
  const whole = Math.floor(grams / 1000);
  const rest = grams % 1000;
  if (!whole) return `= ${rest} g`;
  return `= ${whole} kg${rest ? ` ${rest} g` : ''}`;
}

// "3 lines · 12 pcs + 0.400 kg"
function linesSummary(lines) {
  if (!lines.length) return 'No items added yet';
  let units = 0, kg = 0;
  lines.forEach(l => {
    const q = qtyOf(l.quantity);
    if (!Number.isFinite(q) || q <= 0) return;
    if (l.type === 'liquid') kg += q; else units += q;
  });
  const parts = [];
  if (units) parts.push(`${round3(units)} pcs`);
  if (kg) parts.push(formatStock(round3(kg), 'liquid'));
  return `${lines.length} line${lines.length === 1 ? '' : 's'}${parts.length ? ` · ${parts.join(' + ')}` : ''}`;
}

async function loadHolds() {
  const { data, error } = await db.rpc('get_category_holds', {});
  if (error) { console.warn('get_category_holds failed', error); return {}; }
  return holdsMap(data);
}

async function openCheckoutModal(body, isAdmin) {
  const [sellersRes, productsRes, categoriesRes, holds] = await Promise.all([
    db.getAll('profiles'), db.getAll('products'), db.getAll('categories'), loadHolds(),
  ]);
  const activeSellers = (sellersRes.data || [])
    .filter(s => s.role === 'seller' && s.is_active)
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  const products = productsRes.data || [];
  const activeProducts = products.filter(p => p.is_active);
  const categories = categoriesRes.data || [];
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
  const isSeller = !isAdmin;

  const content = `
    ${isSeller ? '' : `<div class="form-group"><label class="form-label" for="co-seller">Seller *</label>
      <select class="form-select" id="co-seller"><option value="">Select seller...</option>
        ${activeSellers.map(s => `<option value="${esc(s.id)}">${esc(s.full_name)}</option>`).join('')}
      </select></div>`}
    <div class="form-group"><label class="form-label">Add products</label>
      <div id="co-picker"></div></div>
    <div class="form-label" style="margin-top:4px;">Items to ${isSeller ? 'request' : 'issue'}</div>
    <div id="co-items-list" class="checkout-items-list"></div>
    <div id="co-problem" class="co-problem" hidden></div>
    <div style="margin-top:12px;padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);font-size:0.8rem;color:var(--text-muted);">
      <i class="fas fa-info-circle"></i> ${isSeller ? 'Admin approves your request before stock is deducted.' : 'Liquids in KG (0.200 = 200 g), units in pieces.'}
      <strong>Any &lt;category&gt;</strong> takes pieces without naming them; the types are named on the return.
    </div>`;
  const footer = `<div id="co-summary" class="co-summary"></div>
    <button class="btn btn-secondary" id="co-cancel">Cancel</button>
    <button class="btn btn-primary" id="co-submit"><i class="fas fa-check"></i> ${isSeller ? 'Request Stock' : 'Confirm Issue'}</button>`;
  const { overlay, close } = createModal(isSeller ? 'Request Stock' : 'Issue Stock', content, { footer, large: true });
  overlay.querySelector('.modal-footer').classList.add('co-footer');
  const list = overlay.querySelector('#co-items-list');
  const submitBtn = overlay.querySelector('#co-submit');

  // [{ product_id | null, category_id | null, type, quantity: string }]
  const lines = [];
  const lineFor = (kind, id) => lines.findIndex(l => (kind === 'any' ? l.product_id == null && l.category_id === id : l.product_id === id));
  const lineName = l => (l.product_id ? prodMap[l.product_id]?.name || 'Unknown' : anyLineLabel(catMap[l.category_id]));
  const lineCategory = l => (l.product_id ? prodMap[l.product_id]?.category_id : l.category_id);
  const toPayload = l => (l.product_id
    ? { product_id: l.product_id, quantity: qtyOf(l.quantity) }
    : { category_id: l.category_id, quantity: qtyOf(l.quantity) });

  const picker = createStockPicker(overlay.querySelector('#co-picker'), {
    products: activeProducts, allProducts: products, categories, holds,
    allowOut: isSeller,
    inList: (kind, id) => { const i = lineFor(kind, id); return i === -1 ? 0 : (qtyOf(lines[i].quantity) || 0); },
    onPick: ({ kind, id }) => {
      const type = kind === 'any' ? catMap[id]?.type : prodMap[id]?.type;
      const idx = lineFor(kind, id);
      if (idx !== -1) {
        // Picking again adds to the quantity.
        const current = qtyOf(lines[idx].quantity);
        lines[idx].quantity = qtyText(round3((Number.isFinite(current) ? current : 0) + defaultQty(type)), type);
      } else {
        lines.push({ product_id: kind === 'any' ? null : id, category_id: kind === 'any' ? id : null, type, quantity: qtyText(defaultQty(type), type) });
      }
      renderLines();
    },
  });

  // Per line: invalid quantity, or stock before → after (Any: free in the category).
  function lineState(line) {
    const qty = qtyOf(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return { invalid: 'Enter a quantity above zero' };
    if (line.type !== 'liquid' && !Number.isInteger(qty)) return { invalid: 'Whole pieces only' };
    const catId = lineCategory(line);
    const catFree = catId != null ? categoryFreeStock(catId, products, holds) : Infinity;
    const catAsked = round3(lines.filter(l => lineCategory(l) === catId)
      .reduce((s, l) => s + (Number.isFinite(qtyOf(l.quantity)) && qtyOf(l.quantity) > 0 ? qtyOf(l.quantity) : 0), 0));
    const catName = catMap[catId]?.name || 'this category';
    if (line.product_id) {
      const before = Number(prodMap[line.product_id]?.current_stock || 0);
      const after = round3(before - qty);
      if (after < -EPS) return { before, after, over: `Only ${formatStock(before, line.type)} in stock` };
      if (catAsked > catFree + EPS) return { before, after, over: `Only ${formatStock(Math.max(catFree, 0), line.type)} of ${catName} free (rest is out with staff as Any)` };
      return { before, after };
    }
    const before = catFree;
    const after = round3(catFree - catAsked);
    if (after < -EPS) return { before, after, free: true, over: `Only ${formatStock(Math.max(catFree, 0), line.type)} of ${catName} free` };
    return { before, after, free: true };
  }

  function lineHTML(line, idx) {
    const isAny = !line.product_id;
    const unit = line.type !== 'liquid';
    const qtyInput = `<input class="form-input co-qty" type="number" data-idx="${idx}" value="${esc(line.quantity)}" min="${unit ? 1 : 0.001}" step="${unit ? 1 : 0.001}" inputmode="${unit ? 'numeric' : 'decimal'}" aria-label="Quantity for ${esc(lineName(line))}" />`;
    return `<div class="co-line${isAny ? ' is-any' : ''}" data-idx="${idx}">
        <div class="co-line-main">
          <div class="co-line-name">${esc(lineName(line))}${isAny ? ' <span class="co-any-badge" title="Any pieces of this category; the staff member names each type on the return">Any · types named on return</span>' : ''}</div>
          <div class="co-line-meta">${isAny ? '' : `${esc(catMap[lineCategory(line)]?.name || '')} · `}<span class="co-line-stock"></span></div>
          <div class="co-line-msg"></div>
        </div>
        <div class="co-line-qty">
          ${unit
            ? `<div class="co-stepper"><button type="button" class="co-step co-dec" data-idx="${idx}" aria-label="One less">−</button>${qtyInput}<button type="button" class="co-step co-inc" data-idx="${idx}" aria-label="One more">+</button></div>`
            : `<div class="co-kg">${qtyInput}<span>kg</span></div><div class="co-hint"></div>`}
        </div>
        <button type="button" class="btn-remove co-rm" data-idx="${idx}" aria-label="Remove ${esc(lineName(line))}"><i class="fas fa-times"></i></button>
      </div>`;
  }

  function currentProblem() {
    if (!lines.length) return { blocking: true, message: null };
    const states = lines.map(lineState);
    if (states.some(s => s.invalid)) return { blocking: true, message: null };
    const message = issueProblem(lines.map(toPayload), { products, categories, holds });
    return { blocking: Boolean(message) && isAdmin, message };
  }

  function updateStates() {
    lines.forEach((line, idx) => {
      const row = list.querySelector(`.co-line[data-idx="${idx}"]`);
      if (!row) return;
      const s = lineState(line);
      row.classList.toggle('is-invalid', Boolean(s.invalid));
      row.classList.toggle('is-over', Boolean(s.over));
      row.querySelector('.co-line-stock').textContent = s.invalid ? ''
        : `${s.free ? 'Free' : 'Stock'} ${formatStock(round3(s.before), line.type)} → ${formatStock(s.after, line.type)}`;
      row.querySelector('.co-line-msg').textContent = s.invalid || s.over || '';
      const hint = row.querySelector('.co-hint');
      if (hint) hint.textContent = gramsHint(qtyOf(line.quantity));
    });
    overlay.querySelector('#co-summary').textContent = linesSummary(lines);
    const { blocking, message } = currentProblem();
    const box = overlay.querySelector('#co-problem');
    box.hidden = !message;
    box.classList.toggle('is-warning', Boolean(message) && !isAdmin);
    box.textContent = message
      ? (isAdmin ? `Cannot issue: ${message}.` : `${message}. You can still send the request; the admin approves it once stock is available.`)
      : '';
    submitBtn.disabled = blocking;
  }

  function renderLines() {
    list.innerHTML = lines.length
      ? lines.map(lineHTML).join('')
      : '<p style="color:var(--text-muted);text-align:center;padding:16px;">No items added yet — search or pick from the list above.</p>';
    updateStates();
    picker.refresh();
  }

  list.addEventListener('input', e => {
    if (!e.target.classList.contains('co-qty')) return;
    lines[Number(e.target.dataset.idx)].quantity = e.target.value;
    updateStates();
  });
  list.addEventListener('change', e => { if (e.target.classList.contains('co-qty')) picker.refresh(); });
  list.addEventListener('click', e => {
    const btn = e.target.closest('.co-dec, .co-inc, .co-rm');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (btn.classList.contains('co-rm')) { lines.splice(idx, 1); renderLines(); return; }
    const current = qtyOf(lines[idx].quantity);
    const base = Number.isFinite(current) ? Math.round(current) : 0;
    lines[idx].quantity = String(Math.max(1, base + (btn.classList.contains('co-inc') ? 1 : -1)));
    list.querySelector(`.co-qty[data-idx="${idx}"]`).value = lines[idx].quantity;
    updateStates();
    picker.refresh();
  });
  renderLines();
  overlay.querySelector('#co-cancel').onclick = close;

  submitBtn.addEventListener('click', e => withSaving(e.currentTarget, async () => {
    const sellerId = isSeller ? auth.currentUser.id : overlay.querySelector('#co-seller')?.value;
    if (!sellerId) { showToast('Please select a seller', 'error'); return; }
    if (!lines.length) { showToast('Please add at least one product', 'error'); return; }
    const invalid = lines.find(l => lineState(l).invalid);
    if (invalid) { showToast(`${lineState(invalid).invalid} (${lineName(invalid)})`, 'error'); return; }

    const items = lines.map(toPayload);
    const problem = issueProblem(items, { products, categories, holds });
    if (problem) {
      if (isAdmin) { showToast(problem, 'error'); return; }
      const ok = await confirmModal('Low stock',
        `⚠ ${esc(problem)}.<br><br>Submit anyway? Admin will review.`, 'Submit anyway', 'btn-primary');
      if (!ok) return;
    }

    if (isAdmin) {
      const result = await dbOp(db.rpc('admin_issue_stock', {
        p_seller_id: sellerId,
        p_items: items,
        p_approver_id: auth.currentUser.id,
      }), 'Failed to issue stock');
      if (!result) return;
      showToast('Stock issued successfully', 'success');
      close();
      await renderSessionsList(body, isAdmin, 'checked_out');
      return;
    }

    const session = await dbOp(db.insert('checkout_sessions', {
      seller_id: sellerId, checkout_time: new Date().toISOString(), checkin_time: null, status: 'pending_issue', notes: ''
    }), 'Failed to create session');
    if (!session) return;

    for (const item of items) {
      await dbOp(db.insert('checkout_items', {
        session_id: session.data.id,
        product_id: item.product_id ?? null,
        ...(item.category_id ? { category_id: item.category_id } : {}),
        checkout_quantity: item.quantity, checkin_quantity: null, is_flagged: false, flag_reason: null
      }), 'Failed to add item');
    }

    showToast('Stock request submitted — waiting for admin approval', 'success');
    close();
    await renderSessionsList(body, isAdmin, 'pending_issue');
  }).then(() => { if (submitBtn.isConnected) updateStates(); }));
}

// ============================================
// APPROVE ISSUE (Admin: deduct stock, set checked_out)
// ============================================
async function approveIssue(sessionId, body, allItems, prodMap) {
  const sItems = allItems.filter(i => i.session_id === sessionId && !isChildLine(i)).sort((a, b) => a.id - b.id);
  const [productsRes, categoriesRes, holds] = await Promise.all([db.getAll('products'), db.getAll('categories'), loadHolds()]);
  const products = productsRes.data || [];
  const categories = categoriesRes.data || [];
  const freshMap = Object.fromEntries(products.map(p => [p.id, p]));
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

  // This session is still pending_issue, so its Any lines are not in the holds.
  const lines = sItems.map(i => (isAnyLine(i)
    ? { category_id: i.category_id, quantity: Number(i.checkout_quantity) }
    : { product_id: i.product_id, quantity: Number(i.checkout_quantity) }));
  const problem = sItems.length ? issueProblem(lines, { products, categories, holds }) : 'This request has no items';
  const canApprove = !problem;

  const rowHTML = i => {
    const qty = Number(i.checkout_quantity || 0);
    if (isAnyLine(i)) {
      const cat = catMap[i.category_id];
      const free = categoryFreeStock(i.category_id, products, holds);
      const asked = round3(sItems.filter(o => (isAnyLine(o) ? o.category_id : freshMap[o.product_id]?.category_id) === i.category_id)
        .reduce((s, o) => s + Number(o.checkout_quantity || 0), 0));
      const ok = asked <= free + EPS;
      return `<tr style="${!ok ? 'background:var(--red-soft);' : ''}">
        <td><strong>${esc(anyLineLabel(cat))}</strong> <span class="co-any-badge">types named on return</span></td>
        <td>${formatStock(qty, cat?.type)}</td>
        <td style="${!ok ? 'color:var(--red);font-weight:700;' : ''}">${formatStock(Math.max(free, 0), cat?.type)} free</td>
        <td>${!ok ? `<span style="color:var(--red);font-weight:700;">-${formatStock(round3(asked - free), cat?.type)}</span>` : '—'}</td>
        <td>${ok ? '<span class="badge-status green">OK</span>' : '<span class="badge-status red">Insufficient</span>'}</td>
      </tr>`;
    }
    const p = freshMap[i.product_id] || prodMap[i.product_id];
    const stock = Number(p?.current_stock || 0);
    const ok = stock >= qty;
    return `<tr style="${!ok ? 'background:var(--red-soft);' : ''}">
      <td><strong>${esc(p?.name || 'Unknown')}</strong></td>
      <td>${formatStock(qty, p?.type)}</td>
      <td style="${!ok ? 'color:var(--red);font-weight:700;' : ''}">${formatStock(stock, p?.type)}</td>
      <td>${!ok ? `<span style="color:var(--red);font-weight:700;">-${formatStock(round3(qty - stock), p?.type)}</span>` : '—'}</td>
      <td>${ok ? '<span class="badge-status green">OK</span>' : '<span class="badge-status red">Insufficient</span>'}</td>
    </tr>`;
  };

  const content = `<p style="margin-bottom:12px;font-size:0.9rem;">Review items the seller wants to take:</p>
    <div class="table-wrapper"><table class="data-table">
    <thead><tr><th>Product</th><th>Requested Qty</th><th>Current Stock</th><th>Shortfall</th><th>Status</th></tr></thead>
    <tbody>${sItems.map(rowHTML).join('')}</tbody></table></div>
    ${!canApprove ? `<div class="ai-problem" style="margin-top:14px;padding:12px;background:var(--red-soft);border:1px solid var(--red);border-radius:var(--radius);font-size:0.85rem;">
      <i class="fas fa-exclamation-triangle" style="color:var(--red);"></i> <strong>Cannot approve:</strong> ${esc(problem)}. Add stock first or reject this request.
    </div>` : `<div style="margin-top:14px;padding:12px;background:var(--green-soft);border:1px solid var(--green);border-radius:var(--radius);font-size:0.85rem;">
      <i class="fas fa-info-circle" style="color:var(--green);"></i> All items have sufficient stock. On approval, product lines are deducted from stock${lines.some(l => l.category_id) ? '; <strong>Any</strong> lines are held against their category until the return names each type' : ''}.
    </div>`}`;
  const footer = `<button class="btn btn-secondary" id="ai-cancel">Cancel</button>
    <button class="btn btn-danger" id="ai-reject"><i class="fas fa-times"></i> Reject</button>
    <button class="btn btn-primary" id="ai-approve" style="background:${canApprove ? 'var(--green)' : 'var(--text-muted)'};border-color:${canApprove ? 'var(--green)' : 'var(--text-muted)'};${canApprove ? '' : 'cursor:not-allowed;opacity:0.6;'}" ${canApprove ? '' : 'disabled'}><i class="fas fa-check"></i> Approve Issue</button>`;
  const { close } = createModal('Approve Stock Issue', content, { footer, large: true });

  document.getElementById('ai-cancel').onclick = close;
  document.getElementById('ai-reject').onclick = async () => { close(); await rejectIssue(sessionId, body, true); };

  if (canApprove) {
    document.getElementById('ai-approve').onclick = async () => {
      // Atomic approve_issue: re-checks stock, deducts each item, logs
      // inventory_transactions, flips session status — all in one transaction.
      // The pre-flight check above is for UX; the RPC enforces correctness.
      const result = await dbOp(db.rpc('approve_issue', {
        p_session_id: sessionId,
        p_approver_id: auth.currentUser.id,
      }), 'Failed to approve issue');
      if (!result) {
        // Likely insufficient stock changed under us — refresh the list.
        close();
        await renderSessionsList(body, true);
        return;
      }
      showToast('Issue approved — stock deducted', 'success');
      close();
      await renderSessionsList(body, true);
    };
  }
}

// ============================================
// SUBMIT RETURN (Seller/Admin): Returned + usage per item → submit_return RPC.
// No stock change until an admin approves.
// ============================================
// Bills linked to a session (sales.checkout_session_id) as sold lines, one per
// bill and product: [{ product_id, sale_id, party_id, quantity }].
async function loadSoldLines(sessionId) {
  const { data: sales, error } = await db.getAll('sales', { eq: { checkout_session_id: sessionId } });
  if (error || !sales?.length) return [];
  const itemResults = await Promise.all(sales.map(s => db.getAll('sale_items', { eq: { sale_id: s.id } })));
  const soldLines = [];
  sales.forEach((sale, k) => {
    const byProduct = {};
    (itemResults[k].data || []).forEach(si => {
      byProduct[si.product_id] = round3((byProduct[si.product_id] || 0) + Number(si.quantity || 0));
    });
    Object.entries(byProduct).forEach(([pid, quantity]) => soldLines.push({
      product_id: Number(pid), sale_id: sale.id, party_id: sale.party_id ?? null, quantity,
    }));
  });
  return soldLines;
}

async function openCheckinModal(sessionId, body, isAdmin) {
  const [itemsRes, productsRes, categoriesRes, partiesRes, tolerances, soldLines] = await Promise.all([
    db.getAll('checkout_items', { eq: { session_id: sessionId } }),
    db.getAll('products'),
    db.getAll('categories'),
    db.getAll('parties'),
    loadTolerances(),
    loadSoldLines(sessionId),
  ]);
  const products = productsRes.data || [];
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
  const catMap = Object.fromEntries((categoriesRes.data || []).map(c => [c.id, c]));
  const partyMap = Object.fromEntries((partiesRes.data || []).map(p => [p.id, p]));
  const parties = (partiesRes.data || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  // Only issue lines (child rows are rebuilt by submit_return).
  const topItems = (itemsRes.data || []).filter(i => !isChildLine(i)).sort((a, b) => a.id - b.id);
  // Bills from this field stock, split across the lines like submit_return does.
  const { byItem: soldByItem, unallocated } = allocateSold({ items: topItems, soldLines, products });
  const sumQty = list => round3(list.reduce((s, l) => s + Number(l.quantity || 0), 0));

  // Form state; quantities are kept as the raw input strings.
  const blankEntry = () => ({ product_id: '', fixed: false, sold: [], returned: '', lost: '', usage: [] });
  const rows = topItems.map(item => {
    const issued = Number(item.checkout_quantity || 0);
    const sold = soldByItem[item.id] || [];
    if (isAnyLine(item)) {
      const category = catMap[item.category_id];
      // Products sold on bills are fixed rows; staff can still add returned/used/lost for them.
      const soldProducts = [...new Set(sold.map(s => s.product_id))];
      const entries = soldProducts.map(pid => ({ ...blankEntry(), product_id: String(pid), fixed: true, sold: sold.filter(s => s.product_id === pid) }));
      if (!entries.length) entries.push(blankEntry());
      return {
        kind: 'any', item, category, type: category?.type,
        isMachine: isMachineCategory(category), issued, entries,
      };
    }
    const product = prodMap[item.product_id];
    return {
      kind: 'product', item, product, type: product?.type,
      isMachine: isMachineCategory(catMap[product?.category_id]),
      issued, sold, returned: String(round3(Math.max(issued - sumQty(sold), 0))), usage: [],
    };
  });

  const num = raw => { const q = qtyOf(raw); return Number.isFinite(q) ? q : 0; };
  const usedOf = owner => round3(owner.usage.reduce((s, u) => s + num(u.quantity), 0) + sumQty(owner.sold));
  const stepOf = row => (row.type === 'liquid' ? '0.001' : '1');
  const unitLabel = row => (row.type === 'liquid' ? 'kg' : 'pcs');
  const entryTaken = e => round3(num(e.returned) + num(e.lost) + usedOf(e));
  const accountedOf = row => round3(row.entries.reduce((s, e) => s + entryTaken(e), 0));
  const anyBalanced = row => Math.abs(accountedOf(row) - row.issued) <= EPS;
  const dataAttrs = (idx, entry) => `data-idx="${idx}"${entry != null ? ` data-entry="${entry}"` : ''}`;

  function usageLineHTML(row, owner, idx, entry, lineIdx) {
    const u = owner.usage[lineIdx];
    const attrs = `${dataAttrs(idx, entry)} data-line="${lineIdx}"`;
    const customerRequired = u.reason === 'installation' && row.isMachine;
    return `<div class="ci-usage-line" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;">
      <select class="form-select ci-u-reason" ${attrs} aria-label="Usage reason" style="width:auto;min-width:150px;">
        ${Object.entries(USAGE_REASONS).filter(([key]) => key !== 'sold').map(([key, label]) => `<option value="${key}" ${u.reason === key ? 'selected' : ''}>${esc(label)}</option>`).join('')}
      </select>
      <input class="form-input ci-u-qty" type="number" ${attrs} value="${esc(u.quantity)}" min="0" step="${stepOf(row)}" inputmode="decimal" placeholder="Qty (${unitLabel(row)})" aria-label="Used quantity" style="width:120px;" />
      <select class="form-select ci-u-party" ${attrs} aria-label="Customer" style="width:auto;min-width:160px;max-width:100%;${customerRequired && !u.party_id ? 'border-color:var(--red);' : ''}">
        <option value="">${customerRequired ? 'Customer (required)' : 'Customer (optional)'}</option>
        ${parties.map(p => `<option value="${p.id}" ${String(u.party_id) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <input class="form-input ci-u-notes" type="text" ${attrs} value="${esc(u.notes)}" maxlength="200" placeholder="Note (optional)" aria-label="Usage note" style="flex:1;min-width:120px;" />
      <button type="button" class="btn-remove ci-u-rm" ${attrs} aria-label="Remove usage line"><i class="fas fa-times"></i></button>
    </div>`;
  }

  // Read-only "Sold · Bill #N · Party · qty" lines from linked bills.
  function soldLinesHTML(sold, type) {
    return sold.map(s => `<div class="ci-sold-line"><i class="fas fa-receipt" aria-hidden="true"></i>
        Sold · Bill #${s.sale_id} · ${esc(partyMap[s.party_id]?.name || (s.party_id ? `Customer #${s.party_id}` : 'Walk-in'))} · <strong>${formatStock(s.quantity, type)}</strong></div>`).join('');
  }

  function itemHTML(row, idx) {
    return `<div class="ci-item" data-idx="${idx}" style="border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div><strong>${esc(row.product?.name || 'Unknown')}</strong><br>
          <small style="color:var(--text-muted);">${row.type === 'liquid' ? 'Liquid (kg)' : 'Unit (pieces)'}${row.isMachine ? ' · Machine — whole numbers' : ''}</small></div>
        <div style="font-size:0.85rem;">Issued <strong>${formatStock(row.issued, row.type)}</strong></div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">
        <label style="font-size:0.8rem;color:var(--text-secondary);">Returned<br>
          <input class="form-input ci-returned" type="number" data-idx="${idx}" value="${esc(row.returned)}" min="0" step="${stepOf(row)}" inputmode="decimal" style="width:120px;" /></label>
        <div style="font-size:0.8rem;color:var(--text-secondary);">Used<br><strong class="ci-used" style="font-size:0.9rem;color:var(--text-primary);"></strong></div>
        <div style="font-size:0.8rem;color:var(--text-secondary);">Difference<br><span class="ci-diff"></span></div>
      </div>
      ${soldLinesHTML(row.sold, row.type)}
      <div class="ci-usage-lines">${row.usage.map((_, lineIdx) => usageLineHTML(row, row, idx, null, lineIdx)).join('')}</div>
      <button type="button" class="btn btn-sm btn-ghost ci-add-usage" data-idx="${idx}" style="margin-top:8px;"><i class="fas fa-plus"></i> Add usage</button>
    </div>`;
  }

  // Products a piece of an Any line can be named as: the category's products,
  // inactive ones only if they have stock or are already chosen.
  function productOptions(row, entryIdx) {
    const chosenElsewhere = new Set(row.entries.filter((_, k) => k !== entryIdx).map(e => String(e.product_id)).filter(Boolean));
    const chosenAnywhere = new Set(row.entries.map(e => String(e.product_id)));
    const current = String(row.entries[entryIdx].product_id);
    return products
      .filter(p => p.category_id === row.item.category_id && (p.is_active || Number(p.current_stock || 0) > 0 || chosenAnywhere.has(String(p.id))))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(p => `<option value="${p.id}" ${current === String(p.id) ? 'selected' : ''} ${chosenElsewhere.has(String(p.id)) ? 'disabled' : ''}>${esc(p.name)}</option>`)
      .join('');
  }

  function entryHTML(row, idx, entry, k) {
    const catName = row.category?.name || 'category';
    const attrs = dataAttrs(idx, k);
    const name = prodMap[Number(entry.product_id)]?.name || 'Unknown';
    return `<div class="ci-any-entry" ${attrs}>
      <div class="ci-any-entry-head">
        ${entry.fixed
          ? `<strong>${esc(name)}</strong>`
          : `<select class="form-select ci-a-product" ${attrs} aria-label="${esc(catName)} product"><option value="">Choose ${esc(catName)}…</option>${productOptions(row, k)}</select>`}
        <span class="ci-a-taken"></span>
        ${entry.fixed ? '' : `<button type="button" class="btn-remove ci-a-rm" ${attrs} aria-label="Remove product line"><i class="fas fa-times"></i></button>`}
      </div>
      ${soldLinesHTML(entry.sold, row.type)}
      <div class="ci-any-fields">
        <label>Returned<br><input class="form-input ci-a-returned" type="number" ${attrs} value="${esc(entry.returned)}" min="0" step="${stepOf(row)}" inputmode="decimal" placeholder="0" /></label>
        <label>Lost<br><input class="form-input ci-a-lost" type="number" ${attrs} value="${esc(entry.lost)}" min="0" step="${stepOf(row)}" inputmode="decimal" placeholder="0" /></label>
      </div>
      <div class="ci-usage-lines">${entry.usage.map((_, lineIdx) => usageLineHTML(row, entry, idx, k, lineIdx)).join('')}</div>
      <button type="button" class="btn btn-sm btn-ghost ci-add-usage" ${attrs}><i class="fas fa-plus"></i> Add usage</button>
    </div>`;
  }

  function anyHTML(row, idx) {
    return `<div class="ci-item ci-any" data-idx="${idx}">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div><strong>${esc(anyLineLabel(row.category))}</strong> <span class="co-any-badge">name every piece</span><br>
          <small style="color:var(--text-muted);">${row.type === 'liquid' ? 'Liquid (kg)' : 'Unit (pieces) — whole numbers'}${row.isMachine ? ' · Machines' : ''}</small></div>
        <div style="font-size:0.85rem;">Issued <strong>${formatStock(row.issued, row.type)}</strong></div>
      </div>
      <div class="ci-any-count"><span class="ci-any-counter"></span><span class="ci-any-left"></span></div>
      <div class="ci-any-entries">${row.entries.map((e, k) => entryHTML(row, idx, e, k)).join('')}</div>
      <button type="button" class="btn btn-sm btn-ghost ci-any-add" data-idx="${idx}"><i class="fas fa-plus"></i> Add product</button>
    </div>`;
  }

  const hasAny = rows.some(r => r.kind === 'any');
  const content = `
    <div style="padding:12px 16px;background:var(--blue-soft);border:1px solid var(--blue);border-radius:var(--radius);margin-bottom:16px;font-size:0.85rem;">
      <i class="fas fa-info-circle" style="color:var(--blue);"></i> Enter what you brought back and what you used (and why).
      <strong>Difference = Issued − Returned − Used</strong> should be zero. Any difference needs admin approval; stock is held until the admin approves.
      ${hasAny ? '<br><strong>Any lines:</strong> name every piece — pick the product, then enter how many came back, were used or were lost. The count must match what was issued.' : ''}
      ${soldLines.length ? '<br><strong>Sold</strong> lines come from bills you made from this stock; they count as used.' : ''}
    </div>
    ${unallocated.length ? `<div style="padding:12px 16px;background:var(--red-soft);border:1px solid var(--red);border-radius:var(--radius);margin-bottom:16px;font-size:0.85rem;">
      <i class="fas fa-exclamation-triangle" style="color:var(--red);"></i> Bills from this stock sell more than was issued:
      ${unallocated.map(l => `${esc(prodMap[l.product_id]?.name || 'product')} (Bill #${l.sale_id}, ${formatStock(l.quantity, prodMap[l.product_id]?.type)})`).join(', ')}. Correct the bill first.</div>` : ''}
    <div id="ci-items"></div>
    <div class="form-group" style="margin-top:16px;"><label class="form-label">Notes</label>
      <textarea class="form-textarea" id="ci-notes" placeholder="Any observations..." maxlength="500"></textarea></div>`;
  const footer = `<button class="btn btn-secondary" id="ci-cancel">Cancel</button>
    <button class="btn btn-primary" id="ci-submit"><i class="fas fa-paper-plane"></i> Submit Return</button>`;
  const { overlay, close } = createModal('Submit Return', content, { footer, large: true });
  const list = overlay.querySelector('#ci-items');
  const submitBtn = overlay.querySelector('#ci-submit');

  // Submit waits until every Any line names exactly what was issued.
  function refreshSubmit() {
    if (!submitBtn.isConnected || submitBtn.dataset.busy === '1') return;
    const pending = rows.find(r => r.kind === 'any' && !anyBalanced(r));
    submitBtn.disabled = Boolean(pending);
    submitBtn.title = pending ? `Name every piece of ${anyLineLabel(pending.category)} first` : '';
  }

  function updateComputed(idx) {
    const row = rows[idx];
    const block = list.querySelector(`.ci-item[data-idx="${idx}"]`);
    if (!block) return;
    if (row.kind === 'any') {
      const accounted = accountedOf(row);
      const gap = round3(row.issued - accounted);
      const state = Math.abs(gap) <= EPS ? 'match' : gap > 0 ? 'short' : 'over';
      const count = block.querySelector('.ci-any-count');
      count.dataset.state = state;
      block.dataset.state = state;
      block.querySelector('.ci-any-counter').textContent = `Accounted ${formatStock(accounted, row.type)} of ${formatStock(row.issued, row.type)}`;
      block.querySelector('.ci-any-left').textContent = state === 'match' ? 'All named'
        : state === 'short' ? `${formatStock(gap, row.type)} left to name` : `${formatStock(-gap, row.type)} too many`;
      row.entries.forEach((e, k) => {
        const el = block.querySelector(`.ci-any-entry[data-entry="${k}"] .ci-a-taken`);
        if (el) el.textContent = entryTaken(e) > 0 ? `Taken ${formatStock(entryTaken(e), row.type)}` : '';
      });
      refreshSubmit();
      return;
    }
    const used = usedOf(row);
    const returned = qtyOf(row.returned);
    block.querySelector('.ci-used').textContent = formatStock(used, row.type);
    if (!Number.isFinite(returned)) {
      block.querySelector('.ci-diff').innerHTML = '<span style="color:var(--text-muted);">Enter returned qty</span>';
      block.style.borderColor = 'var(--border)';
      return;
    }
    const diff = round3(row.issued - returned - used);
    const state = differenceState(diff, row.type, tolerances);
    block.querySelector('.ci-diff').innerHTML = differenceHTML(diff, row.type, state);
    block.dataset.state = state;
    block.style.borderColor = DIFF_STYLES[state].color;
  }

  function renderAll() {
    list.innerHTML = rows.length
      ? rows.map((row, idx) => (row.kind === 'any' ? anyHTML(row, idx) : itemHTML(row, idx))).join('')
      : '<p style="color:var(--text-muted);text-align:center;padding:20px;">No items in this session.</p>';
    rows.forEach((_, idx) => updateComputed(idx));
    refreshSubmit();
  }

  // The product row, or the Any entry an input belongs to (both carry .usage).
  const ownerOf = t => {
    const row = rows[Number(t.dataset.idx)];
    if (!row) return null;
    return t.dataset.entry != null ? row.entries[Number(t.dataset.entry)] : row;
  };

  list.addEventListener('input', e => {
    const t = e.target, idx = Number(t.dataset.idx), owner = ownerOf(t);
    if (!owner) return;
    if (t.classList.contains('ci-returned')) owner.returned = t.value;
    else if (t.classList.contains('ci-a-returned')) owner.returned = t.value;
    else if (t.classList.contains('ci-a-lost')) owner.lost = t.value;
    else if (t.classList.contains('ci-u-qty')) owner.usage[Number(t.dataset.line)].quantity = t.value;
    else if (t.classList.contains('ci-u-notes')) { owner.usage[Number(t.dataset.line)].notes = t.value; return; }
    else return;
    updateComputed(idx);
  });
  list.addEventListener('change', e => {
    const t = e.target, owner = ownerOf(t);
    if (!owner) return;
    if (t.classList.contains('ci-u-reason')) { owner.usage[Number(t.dataset.line)].reason = t.value; renderAll(); }
    else if (t.classList.contains('ci-u-party')) { owner.usage[Number(t.dataset.line)].party_id = t.value; renderAll(); }
    else if (t.classList.contains('ci-a-product')) { owner.product_id = t.value; renderAll(); }
  });
  list.addEventListener('click', e => {
    const btn = e.target.closest('.ci-add-usage, .ci-u-rm, .ci-any-add, .ci-a-rm');
    if (!btn) return;
    const row = rows[Number(btn.dataset.idx)];
    const owner = ownerOf(btn);
    if (btn.classList.contains('ci-add-usage')) owner.usage.push({ reason: 'customer_service', quantity: '', party_id: '', notes: '' });
    else if (btn.classList.contains('ci-u-rm')) owner.usage.splice(Number(btn.dataset.line), 1);
    else if (btn.classList.contains('ci-any-add')) row.entries.push(blankEntry());
    else if (btn.classList.contains('ci-a-rm')) row.entries.splice(Number(btn.dataset.entry), 1);
    renderAll();
  });
  renderAll();

  // Usage lines of a product row or Any entry → payload, or null after a toast.
  // Sold lines are never sent: submit_return adds them from the linked bills.
  function usagePayload(row, owner, name, wholeOnly) {
    const usage = [];
    for (const u of owner.usage) {
      const qty = qtyOf(u.quantity);
      if (!Number.isFinite(qty) || qty <= 0) { showToast(`Enter a used quantity above zero for ${name}`, 'error'); return null; }
      if (wholeOnly && !Number.isInteger(qty)) { showToast(`${row.isMachine ? 'Machines' : name} must be whole numbers${row.isMachine ? ` (${name})` : ''}`, 'error'); return null; }
      if (u.reason === 'installation' && row.isMachine && !u.party_id) {
        showToast(`Choose the customer where ${name} was installed`, 'error'); return null;
      }
      usage.push({ reason: u.reason, quantity: qty, party_id: u.party_id ? Number(u.party_id) : null, notes: String(u.notes || '').trim() || null });
    }
    return usage;
  }

  function anyPayload(row) {
    const label = anyLineLabel(row.category);
    const catName = row.category?.name || 'category';
    const whole = row.type !== 'liquid';
    const breakdown = [];
    const seen = new Set();
    for (const entry of row.entries) {
      const returned = qtyOf(entry.returned), lost = qtyOf(entry.lost);
      const r = Number.isFinite(returned) ? returned : 0;
      const l = Number.isFinite(lost) ? lost : 0;
      const name = prodMap[Number(entry.product_id)]?.name || label;
      if (r < 0 || l < 0 || (String(entry.returned).trim() && !Number.isFinite(returned)) || (String(entry.lost).trim() && !Number.isFinite(lost))) {
        showToast(`Returned and lost must be zero or more (${name})`, 'error'); return null;
      }
      if (whole && (!Number.isInteger(r) || !Number.isInteger(l))) { showToast(`${name} must be whole pieces`, 'error'); return null; }
      const usage = usagePayload(row, entry, name, whole || row.isMachine);
      if (!usage) return null;
      const manual = round3(r + l + usage.reduce((s, u) => s + u.quantity, 0));
      if (!entry.product_id) {
        if (manual > 0) { showToast(`Choose which ${catName} product for every line of ${label}`, 'error'); return null; }
        continue;
      }
      if (seen.has(String(entry.product_id))) { showToast(`${name} is listed twice in ${label}`, 'error'); return null; }
      seen.add(String(entry.product_id));
      if (manual > 0) breakdown.push({ product_id: Number(entry.product_id), returned_quantity: r, lost_quantity: l, usage });
    }
    if (!anyBalanced(row)) {
      showToast(`${label}: ${formatStock(row.issued, row.type)} issued but ${formatStock(accountedOf(row), row.type)} accounted for. Name every piece (returned, used, sold or lost)`, 'error');
      return null;
    }
    return { item_id: row.item.id, breakdown };
  }

  // Returns the submit_return p_items payload, or null after showing a toast.
  function buildPayload() {
    const payload = [];
    for (const row of rows) {
      if (row.kind === 'any') {
        const entry = anyPayload(row);
        if (!entry) return null;
        payload.push(entry);
        continue;
      }
      const name = row.product?.name || 'item';
      const returned = qtyOf(row.returned);
      if (!Number.isFinite(returned) || returned < 0) { showToast(`Enter the returned quantity for ${name}`, 'error'); return null; }
      if (row.isMachine && !Number.isInteger(returned)) { showToast(`Returned machines must be whole numbers (${name})`, 'error'); return null; }
      const usage = usagePayload(row, row, name, row.isMachine);
      if (!usage) return null;
      payload.push({ item_id: row.item.id, returned_quantity: returned, usage });
    }
    return payload;
  }

  overlay.querySelector('#ci-cancel').onclick = close;
  submitBtn.addEventListener('click', e => withSaving(e.currentTarget, async () => {
    const pItems = buildPayload();
    if (!pItems) return;
    const result = await dbOp(db.rpc('submit_return', {
      p_session_id: sessionId,
      p_items: pItems,
      p_notes: overlay.querySelector('#ci-notes').value.trim(),
      p_submitted_by: auth.currentUser.id,
    }), 'Failed to submit return');
    if (!result) return;
    if (result.data?.has_discrepancy) showToast('Return submitted with a difference — admin must review it', 'warning');
    else showToast('Return submitted — waiting for admin approval', 'success');
    close();
    await renderSessionsList(body, isAdmin, 'pending_approval');
  }).then(refreshSubmit));
}

// ============================================
// APPROVE RETURN (Admin): classify mismatches, then approve_return RPC
// restores returned stock and records installations.
// ============================================
async function openApproveReturnModal(sessionId, body) {
  const details = await loadReturnDetails(sessionId);
  const { items, prodMap, catMap } = details;
  // Includes child rows of Any lines with lost pieces.
  const mismatched = items.filter(i => i.has_mismatch);
  const hasAny = items.some(isAnyLine);

  // "Rose Refill — lost 1 pc (from Any Dispenser Refill)" for a child row.
  const mismatchTitle = i => {
    const p = prodMap[i.product_id];
    if (!isChildLine(i)) return `<strong>${esc(p?.name || '?')}</strong> — ${differenceHTML(Number(i.difference), p?.type, storedState(i) || 'shortage')}`;
    const lost = Number(i.difference || 0);
    const lostText = p?.type === 'liquid' ? formatStock(lost, 'liquid') : pcs(lost);
    return `<strong>${esc(p?.name || '?')}</strong> — <span style="color:var(--red);font-weight:700;">lost ${lostText}</span> <span style="color:var(--text-muted);">(from ${esc(anyLineLabel(catMap[i.category_id]))})</span>`;
  };

  const content = `
    ${mismatched.length ? `<div style="padding:12px 16px;background:var(--red-soft);border:1px solid var(--red);border-radius:var(--radius);margin-bottom:16px;font-size:0.85rem;">
      <i class="fas fa-exclamation-triangle" style="color:var(--red);"></i> ${mismatched.length} item(s) do not match (Issued − Returned − Used ≠ 0)${mismatched.some(isChildLine) ? ' or have lost pieces' : ''}. Classify each difference and add a note to approve.</div>` : ''}
    <div class="table-wrapper"><table class="data-table">
    <thead><tr><th>Product</th><th>Issued</th><th>Returned</th><th>Used</th><th>Difference</th><th>Status</th></tr></thead>
    <tbody>${sessionRowsHTML(details, { bold: true })}</tbody></table></div>
    ${mismatched.length ? `<div style="margin-top:16px;">
      <div class="form-label" style="margin-bottom:8px;">Classify each difference *</div>
      ${mismatched.map(i => `<div class="ar-resolution" data-item-id="${i.id}" style="border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:10px;">
          <div style="margin-bottom:8px;">${mismatchTitle(i)}</div>
          <select class="form-select ar-type" data-item-id="${i.id}" aria-label="Difference classification" style="margin-bottom:8px;">
            <option value="">Select classification…</option>
            ${Object.entries(DISCREPANCY_TYPES).map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join('')}
          </select>
          <textarea class="form-textarea ar-note" data-item-id="${i.id}" maxlength="500" placeholder="What happened? (required)" aria-label="Difference note"></textarea>
        </div>`).join('')}
    </div>` : ''}
    <div style="margin-top:14px;padding:12px;background:var(--green-soft);border:1px solid var(--green);border-radius:var(--radius);font-size:0.85rem;">
      <i class="fas fa-shield-check" style="color:var(--green);"></i> On approval, the <strong>returned</strong> quantity goes back into stock.
      Machines used for an <strong>installation</strong> move to the product's Installed Qty and get an Installations record for that customer.
      Other usage is recorded as consumed.${hasAny ? `
      <br><strong>Any lines</strong> take stock off each named product on approval (taken − returned), and release the hold on the category.` : ''}</div>`;
  const footer = `<button class="btn btn-secondary" id="ar-cancel">Cancel</button>
    <button class="btn btn-secondary" id="ar-send-back"><i class="fas fa-rotate-left"></i> Send back</button>
    <button class="btn btn-primary" id="ar-approve" style="background:var(--green);border-color:var(--green);"><i class="fas fa-check-double"></i> Approve & Restore</button>`;
  const { overlay, close } = createModal('Approve Return', content, { footer, large: true });
  const approveBtn = overlay.querySelector('#ar-approve');

  const readResolutions = () => mismatched.map(i => ({
    item_id: i.id,
    discrepancy_type: overlay.querySelector(`.ar-type[data-item-id="${i.id}"]`).value,
    note: overlay.querySelector(`.ar-note[data-item-id="${i.id}"]`).value.trim(),
  }));
  const isComplete = () => readResolutions().every(r => r.discrepancy_type && r.note);
  const refreshApprove = () => {
    const ready = isComplete();
    approveBtn.disabled = !ready;
    approveBtn.style.opacity = ready ? '' : '0.6';
    approveBtn.style.cursor = ready ? '' : 'not-allowed';
  };
  overlay.querySelectorAll('.ar-type, .ar-note').forEach(el => {
    el.addEventListener('input', refreshApprove);
    el.addEventListener('change', refreshApprove);
  });
  refreshApprove();

  overlay.querySelector('#ar-cancel').onclick = close;
  overlay.querySelector('#ar-send-back').onclick = () => { close(); openSendBackModal(sessionId, body); };
  approveBtn.addEventListener('click', e => {
    if (!isComplete()) { showToast('Classify every difference and add a note first', 'error'); return; }
    return withSaving(e.currentTarget, async () => {
      const result = await dbOp(db.rpc('approve_return', {
        p_session_id: sessionId,
        p_approver_id: auth.currentUser.id,
        p_resolutions: readResolutions(),
      }), 'Failed to approve return');
      if (!result) return;
      showToast('Return approved — stock restored', 'success');
      close();
      await renderSessionsList(body, true);
    });
  });
}

// ============================================
// SEND BACK (Admin): pending return → In Field so staff can correct it.
// ============================================
function openSendBackModal(sessionId, body) {
  const content = `
    <p style="font-size:0.9rem;margin-bottom:12px;">The return goes back to the staff member as <strong>In Field</strong> so they can correct and resubmit it. No stock changes.</p>
    <div class="form-group"><label class="form-label" for="sb-reason">Reason *</label>
      <textarea class="form-textarea" id="sb-reason" maxlength="500" placeholder="What needs correcting?"></textarea></div>`;
  const footer = `<button class="btn btn-secondary" id="sb-cancel">Cancel</button>
    <button class="btn btn-danger" id="sb-confirm"><i class="fas fa-rotate-left"></i> Send back</button>`;
  const { overlay, close } = createModal('Send Return Back', content, { footer });
  overlay.querySelector('#sb-cancel').onclick = close;
  overlay.querySelector('#sb-confirm').addEventListener('click', e => {
    const reason = overlay.querySelector('#sb-reason').value.trim();
    if (!reason) { showToast('Give a reason for sending the return back', 'error'); return; }
    return withSaving(e.currentTarget, async () => {
      const result = await dbOp(db.rpc('reject_return', {
        p_session_id: sessionId,
        p_reason: reason,
        p_approver_id: auth.currentUser.id,
      }), 'Failed to send return back');
      if (!result) return;
      showToast('Return sent back to staff', 'warning');
      close();
      await renderSessionsList(body, true);
    });
  });
}

// ============================================
// REJECT ISSUE (Admin): pending issue → flagged. No stock was deducted yet.
// ============================================
async function rejectIssue(sessionId, body, isAdmin) {
  const ok = await confirmModal('Reject Request', 'Reject this stock request? It moves to <strong>Flagged</strong>. Stock is not affected.', 'Reject');
  if (!ok) return;
  await dbOp(db.update('checkout_sessions', sessionId, {
    status: 'flagged', approved_by: auth.currentUser.id, approved_at: new Date().toISOString()
  }), 'Failed to reject');
  showToast('Request rejected', 'warning');
  await renderSessionsList(body, isAdmin);
}
