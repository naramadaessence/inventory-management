import { db, auth } from '../supabase.js';
import {
  formatStock, formatDateTime, showToast, createModal, esc, dbOp, withSaving,
  USAGE_REASONS, DISCREPANCY_TYPES, isMachineCategory,
} from '../utils/helpers.js';

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
  const [itemsRes, usageRes, productsRes, partiesRes] = await Promise.all([
    db.getAll('checkout_items', { eq: { session_id: sessionId } }),
    db.getAll('checkout_usage', { eq: { session_id: sessionId } }),
    db.getAll('products'),
    db.getAll('parties'),
  ]);
  const items = (itemsRes.data || []).slice().sort((a, b) => a.id - b.id);
  return {
    items,
    usage: usageRes.data || [],
    prodMap: Object.fromEntries((productsRes.data || []).map(p => [p.id, p])),
    partyMap: Object.fromEntries((partiesRes.data || []).map(p => [p.id, p])),
  };
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
        const sItems = items.filter(i => i.session_id === s.id);
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
          <td>${sItems.length} items</td>
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
function itemStatusHTML(item) {
  if (item.checkin_quantity == null) return '<span style="color:var(--text-muted);">Not returned</span>';
  const state = storedState(item);
  if (!state) {
    return item.is_flagged ? '<span class="badge-status red">⚠ Over</span>' : '<span class="badge-status green">OK</span>';
  }
  const s = DIFF_STYLES[state];
  let html = `<span class="badge-status ${s.badge}">${s.label}</span>`;
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
  const { items, usage, prodMap, partyMap } = await loadReturnDetails(sessionId);
  const { data: session } = await db.getById('checkout_sessions', sessionId);
  if (!items.length) { createModal('Session', '<p style="color:var(--text-muted);">No items.</p>'); return; }
  const content = `<div class="table-wrapper"><table class="data-table">
    <thead><tr><th>Product</th><th>Issued</th><th>Returned</th><th>Used</th><th>Difference</th><th>Status</th></tr></thead>
    <tbody>${items.map(i => {
      const p = prodMap[i.product_id];
      const lines = usage.filter(u => u.item_id === i.id);
      return `<tr style="${i.has_mismatch ? 'background:var(--red-soft);' : ''}">
        <td>${esc(p?.name || 'Unknown')}</td>
        ${storedQtyCells(i, p?.type, lines, partyMap)}
        <td>${itemStatusHTML(i)}</td>
      </tr>`;
    }).join('')}</tbody></table></div>
    ${session?.notes ? `<div style="margin-top:14px;padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);font-size:0.85rem;">
      <strong>Notes</strong><div style="white-space:pre-wrap;margin-top:4px;">${esc(session.notes)}</div></div>` : ''}`;
  createModal('Session Details', content, { large: true });
}

// ============================================
// SELLER/ADMIN: Request stock (pending_issue)
// ============================================
async function openCheckoutModal(body, isAdmin) {
  const { data: sellers } = await db.getAll('profiles');
  const activeSellers = sellers.filter(s => s.role === 'seller' && s.is_active);
  const { data: products } = await db.getAll('products');
  const activeProducts = products.filter(p => p.is_active);
  const isSeller = !isAdmin;

  const content = `
    ${isSeller ? '' : `<div class="form-group"><label class="form-label">Seller *</label>
      <select class="form-select" id="co-seller"><option value="">Select seller...</option>
        ${activeSellers.map(s => `<option value="${s.id}">${esc(s.full_name)}</option>`).join('')}
      </select></div>`}
    <div class="form-group"><label class="form-label">Add Products</label>
      <select class="form-select" id="co-product-select"><option value="">Select product to add...</option>
        ${activeProducts.map(p => `<option value="${p.id}">${esc(p.name)} (${p.type==='liquid'?'liquid':'unit'} — stock: ${formatStock(p.current_stock,p.type)})</option>`).join('')}
      </select></div>
    <div id="co-items-list" class="checkout-items-list" style="margin-top:12px;"></div>
    <div style="margin-top:12px;padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);font-size:0.8rem;color:var(--text-muted);">
      <i class="fas fa-info-circle"></i> ${isSeller ? 'Enter weight/quantity you are taking. Admin will approve before stock is deducted.' : 'For liquid items enter weight in KG (e.g., 0.200 for 200g). For unit items enter piece count.'}
    </div>`;
  const footer = `<button class="btn btn-secondary" id="co-cancel">Cancel</button>
    <button class="btn btn-primary" id="co-submit"><i class="fas fa-check"></i> ${isSeller ? 'Request Stock' : 'Confirm Issue'}</button>`;
  const { close } = createModal(isSeller ? 'Request Stock' : 'Issue Stock', content, { footer, large: true });
  const checkoutItems = [];

  document.getElementById('co-product-select').addEventListener('change', (e) => {
    const prodId = parseInt(e.target.value);
    if (!prodId || checkoutItems.find(i => i.product_id === prodId)) { e.target.value = ''; return; }
    const prod = activeProducts.find(p => p.id === prodId);
    checkoutItems.push({ product_id: prodId, product: prod, quantity: prod.type === 'liquid' ? 0.200 : 1 });
    e.target.value = '';
    renderItems();
  });

  function renderItems() {
    const list = document.getElementById('co-items-list');
    if (!checkoutItems.length) { list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No items added yet</p>'; return; }
    list.innerHTML = checkoutItems.map((item, idx) => `
      <div class="checkout-item">
        <div class="checkout-item-info">
          <div class="checkout-item-name">${esc(item.product.name)}</div>
          <div class="checkout-item-type">${item.product.type==='liquid'?'Liquid (kg)':'Unit (pieces)'} · Stock: ${formatStock(item.product.current_stock,item.product.type)}</div>
        </div>
        <input class="form-input co-qty" type="number" data-idx="${idx}" value="${item.quantity}" min="${item.product.type==='liquid'?'0.001':'1'}" step="${item.product.type==='liquid'?'0.001':'1'}" style="width:100px;" />
        <button class="btn-remove co-rm" data-idx="${idx}"><i class="fas fa-times"></i></button>
      </div>`).join('');
    list.querySelectorAll('.co-qty').forEach(inp => inp.addEventListener('change', e => {
      const v = parseFloat(e.target.value), i = parseInt(e.target.dataset.idx);
      if (isNaN(v)||v<=0) { showToast('Quantity must be positive','error'); return; }
      checkoutItems[i].quantity = v;
    }));
    list.querySelectorAll('.co-rm').forEach(b => b.addEventListener('click', () => { checkoutItems.splice(parseInt(b.dataset.idx),1); renderItems(); }));
  }
  renderItems();
  document.getElementById('co-cancel').onclick = close;

  document.getElementById('co-submit').onclick = async () => {
    const sellerId = isSeller ? auth.currentUser.id : document.getElementById('co-seller')?.value;
    if (!sellerId) { showToast('Please select a seller','error'); return; }
    if (!checkoutItems.length) { showToast('Please add at least one product','error'); return; }

    for (const item of checkoutItems) {
      if (item.quantity <= 0) { showToast(`Invalid quantity for ${item.product.name}`,'error'); return; }
      if (item.quantity > item.product.current_stock) {
        if (isAdmin) {
          showToast(`Insufficient stock for ${item.product.name} — only ${formatStock(item.product.current_stock, item.product.type)} available`, 'error');
          return;
        }
        const ok = await confirmModal('Low stock',
          `⚠ <strong>${esc(item.product.name)}</strong> only has ${formatStock(item.product.current_stock, item.product.type)} in stock. You are requesting ${item.product.type === 'liquid' ? item.quantity + ' kg' : item.quantity + ' pcs'}.<br><br>Submit anyway? Admin will review.`,
          'Submit anyway', 'btn-primary');
        if (!ok) return;
      }
    }

    if (isAdmin) {
      const result = await dbOp(db.rpc('admin_issue_stock', {
        p_seller_id: sellerId,
        p_items: checkoutItems.map(item => ({ product_id: item.product_id, quantity: item.quantity })),
        p_approver_id: auth.currentUser.id,
      }), 'Failed to issue stock');
      if (!result) return;

      showToast('Stock issued successfully', 'success');
      close();
      await renderSessionsList(body, isAdmin, 'checked_out');
      return;
    }

    const status = 'pending_issue';
    const session = await dbOp(db.insert('checkout_sessions', {
      seller_id: sellerId, checkout_time: new Date().toISOString(), checkin_time: null, status, notes: ''
    }), 'Failed to create session');
    if (!session) return;

    for (const item of checkoutItems) {
      await dbOp(db.insert('checkout_items', {
        session_id: session.data.id, product_id: item.product_id,
        checkout_quantity: item.quantity, checkin_quantity: null, is_flagged: false, flag_reason: null
      }), 'Failed to add item');
    }

    showToast('Stock request submitted — waiting for admin approval', 'success');
    close();
    await renderSessionsList(body, isAdmin, 'pending_issue');
  };
}

// ============================================
// APPROVE ISSUE (Admin: deduct stock, set checked_out)
// ============================================
async function approveIssue(sessionId, body, allItems, prodMap) {
  const sItems = allItems.filter(i => i.session_id === sessionId);
  const { data: products } = await db.getAll('products');
  const freshMap = Object.fromEntries(products.map(p => [p.id, p]));

  // Check if ANY item has insufficient stock
  const insufficientItems = sItems.filter(i => {
    const p = freshMap[i.product_id];
    return !p || (p.current_stock || 0) < i.checkout_quantity;
  });
  const canApprove = insufficientItems.length === 0;

  const content = `<p style="margin-bottom:12px;font-size:0.9rem;">Review items the seller wants to take:</p>
    <div class="table-wrapper"><table class="data-table">
    <thead><tr><th>Product</th><th>Requested Qty</th><th>Current Stock</th><th>Shortfall</th><th>Status</th></tr></thead>
    <tbody>${sItems.map(i => {
      const p = freshMap[i.product_id] || prodMap[i.product_id];
      const stock = p?.current_stock || 0;
      const ok = stock >= i.checkout_quantity;
      const shortfall = ok ? 0 : i.checkout_quantity - stock;
      return `<tr style="${!ok?'background:var(--red-soft);':''}">
        <td><strong>${esc(p?.name||'Unknown')}</strong></td>
        <td>${formatStock(i.checkout_quantity,p?.type)}</td>
        <td style="${!ok?'color:var(--red);font-weight:700;':''}">${formatStock(stock,p?.type)}</td>
        <td>${!ok ? `<span style="color:var(--red);font-weight:700;">-${formatStock(shortfall,p?.type)}</span>` : '—'}</td>
        <td>${ok?'<span class="badge-status green">OK</span>':'<span class="badge-status red">Insufficient</span>'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>
    ${!canApprove ? `<div style="margin-top:14px;padding:12px;background:var(--red-soft);border:1px solid var(--red);border-radius:var(--radius);font-size:0.85rem;">
      <i class="fas fa-exclamation-triangle" style="color:var(--red);"></i> <strong>Cannot approve:</strong> ${insufficientItems.length} item(s) have insufficient stock. Add stock first or reject this request.
    </div>` : `<div style="margin-top:14px;padding:12px;background:var(--green-soft);border:1px solid var(--green);border-radius:var(--radius);font-size:0.85rem;">
      <i class="fas fa-info-circle" style="color:var(--green);"></i> All items have sufficient stock. On approval, stock will be deducted.
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
async function openCheckinModal(sessionId, body, isAdmin) {
  const [itemsRes, productsRes, categoriesRes, partiesRes, tolerances] = await Promise.all([
    db.getAll('checkout_items', { eq: { session_id: sessionId } }),
    db.getAll('products'),
    db.getAll('categories'),
    db.getAll('parties'),
    loadTolerances(),
  ]);
  const prodMap = Object.fromEntries((productsRes.data || []).map(p => [p.id, p]));
  const catMap = Object.fromEntries((categoriesRes.data || []).map(c => [c.id, c]));
  const parties = (partiesRes.data || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  // Form state; quantities are kept as the raw input strings.
  const rows = (itemsRes.data || []).slice().sort((a, b) => a.id - b.id).map(item => {
    const product = prodMap[item.product_id];
    const issued = Number(item.checkout_quantity || 0);
    return {
      item, product, type: product?.type,
      isMachine: isMachineCategory(catMap[product?.category_id]),
      issued, returned: String(issued), usage: [],
    };
  });

  const qtyOf = raw => (String(raw ?? '').trim() === '' ? NaN : Number(raw));
  const usedOf = row => round3(row.usage.reduce((s, u) => s + (Number.isFinite(qtyOf(u.quantity)) ? qtyOf(u.quantity) : 0), 0));
  const stepOf = row => (row.type === 'liquid' ? '0.001' : '1');

  function usageLineHTML(row, idx, lineIdx) {
    const u = row.usage[lineIdx];
    const customerRequired = u.reason === 'installation' && row.isMachine;
    return `<div class="ci-usage-line" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;">
      <select class="form-select ci-u-reason" data-idx="${idx}" data-line="${lineIdx}" aria-label="Usage reason" style="width:auto;min-width:150px;">
        ${Object.entries(USAGE_REASONS).map(([key, label]) => `<option value="${key}" ${u.reason === key ? 'selected' : ''}>${esc(label)}</option>`).join('')}
      </select>
      <input class="form-input ci-u-qty" type="number" data-idx="${idx}" data-line="${lineIdx}" value="${esc(u.quantity)}" min="0" step="${stepOf(row)}" placeholder="Qty (${row.type === 'liquid' ? 'kg' : 'pcs'})" aria-label="Used quantity" style="width:120px;" />
      <select class="form-select ci-u-party" data-idx="${idx}" data-line="${lineIdx}" aria-label="Customer" style="width:auto;min-width:160px;${customerRequired && !u.party_id ? 'border-color:var(--red);' : ''}">
        <option value="">${customerRequired ? 'Customer (required)' : 'Customer (optional)'}</option>
        ${parties.map(p => `<option value="${p.id}" ${String(u.party_id) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <input class="form-input ci-u-notes" type="text" data-idx="${idx}" data-line="${lineIdx}" value="${esc(u.notes)}" maxlength="200" placeholder="Note (optional)" aria-label="Usage note" style="flex:1;min-width:120px;" />
      <button type="button" class="btn-remove ci-u-rm" data-idx="${idx}" data-line="${lineIdx}" aria-label="Remove usage line"><i class="fas fa-times"></i></button>
    </div>`;
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
          <input class="form-input ci-returned" type="number" data-idx="${idx}" value="${esc(row.returned)}" min="0" step="${stepOf(row)}" style="width:120px;" /></label>
        <div style="font-size:0.8rem;color:var(--text-secondary);">Used<br><strong class="ci-used" style="font-size:0.9rem;color:var(--text-primary);"></strong></div>
        <div style="font-size:0.8rem;color:var(--text-secondary);">Difference<br><span class="ci-diff"></span></div>
      </div>
      <div class="ci-usage-lines">${row.usage.map((_, lineIdx) => usageLineHTML(row, idx, lineIdx)).join('')}</div>
      <button type="button" class="btn btn-sm btn-ghost ci-add-usage" data-idx="${idx}" style="margin-top:8px;"><i class="fas fa-plus"></i> Add usage</button>
    </div>`;
  }

  const content = `
    <div style="padding:12px 16px;background:var(--blue-soft);border:1px solid var(--blue);border-radius:var(--radius);margin-bottom:16px;font-size:0.85rem;">
      <i class="fas fa-info-circle" style="color:var(--blue);"></i> Enter what you brought back and what you used (and why).
      <strong>Difference = Issued − Returned − Used</strong> should be zero. Any difference needs admin approval; stock is held until the admin approves.
    </div>
    <div id="ci-items"></div>
    <div class="form-group" style="margin-top:16px;"><label class="form-label">Notes</label>
      <textarea class="form-textarea" id="ci-notes" placeholder="Any observations..." maxlength="500"></textarea></div>`;
  const footer = `<button class="btn btn-secondary" id="ci-cancel">Cancel</button>
    <button class="btn btn-primary" id="ci-submit"><i class="fas fa-paper-plane"></i> Submit Return</button>`;
  const { overlay, close } = createModal('Submit Return', content, { footer, large: true });
  const list = overlay.querySelector('#ci-items');

  function updateComputed(idx) {
    const row = rows[idx];
    const block = list.querySelector(`.ci-item[data-idx="${idx}"]`);
    if (!block) return;
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
      ? rows.map(itemHTML).join('')
      : '<p style="color:var(--text-muted);text-align:center;padding:20px;">No items in this session.</p>';
    rows.forEach((_, idx) => updateComputed(idx));
  }

  list.addEventListener('input', e => {
    const t = e.target, idx = Number(t.dataset.idx), row = rows[idx];
    if (!row) return;
    if (t.classList.contains('ci-returned')) { row.returned = t.value; updateComputed(idx); }
    else if (t.classList.contains('ci-u-qty')) { row.usage[Number(t.dataset.line)].quantity = t.value; updateComputed(idx); }
    else if (t.classList.contains('ci-u-notes')) { row.usage[Number(t.dataset.line)].notes = t.value; }
  });
  list.addEventListener('change', e => {
    const t = e.target, row = rows[Number(t.dataset.idx)];
    if (!row) return;
    if (t.classList.contains('ci-u-reason')) { row.usage[Number(t.dataset.line)].reason = t.value; renderAll(); }
    else if (t.classList.contains('ci-u-party')) { row.usage[Number(t.dataset.line)].party_id = t.value; renderAll(); }
  });
  list.addEventListener('click', e => {
    const btn = e.target.closest('.ci-add-usage, .ci-u-rm');
    if (!btn) return;
    const row = rows[Number(btn.dataset.idx)];
    if (btn.classList.contains('ci-add-usage')) row.usage.push({ reason: 'customer_service', quantity: '', party_id: '', notes: '' });
    else row.usage.splice(Number(btn.dataset.line), 1);
    renderAll();
  });
  renderAll();

  // Returns the submit_return p_items payload, or null after showing a toast.
  function buildPayload() {
    const payload = [];
    for (const row of rows) {
      const name = row.product?.name || 'item';
      const returned = qtyOf(row.returned);
      if (!Number.isFinite(returned) || returned < 0) { showToast(`Enter the returned quantity for ${name}`, 'error'); return null; }
      if (row.isMachine && !Number.isInteger(returned)) { showToast(`Returned machines must be whole numbers (${name})`, 'error'); return null; }
      const usage = [];
      for (const u of row.usage) {
        const qty = qtyOf(u.quantity);
        if (!Number.isFinite(qty) || qty <= 0) { showToast(`Enter a used quantity above zero for ${name}`, 'error'); return null; }
        if (row.isMachine && !Number.isInteger(qty)) { showToast(`Machines must be whole numbers (${name})`, 'error'); return null; }
        if (u.reason === 'installation' && row.isMachine && !u.party_id) {
          showToast(`Choose the customer where ${name} was installed`, 'error'); return null;
        }
        usage.push({ reason: u.reason, quantity: qty, party_id: u.party_id ? Number(u.party_id) : null, notes: String(u.notes || '').trim() || null });
      }
      payload.push({ item_id: row.item.id, returned_quantity: returned, usage });
    }
    return payload;
  }

  overlay.querySelector('#ci-cancel').onclick = close;
  overlay.querySelector('#ci-submit').addEventListener('click', e => withSaving(e.currentTarget, async () => {
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
  }));
}

// ============================================
// APPROVE RETURN (Admin): classify mismatches, then approve_return RPC
// restores returned stock and records installations.
// ============================================
async function openApproveReturnModal(sessionId, body) {
  const { items, usage, prodMap, partyMap } = await loadReturnDetails(sessionId);
  const mismatched = items.filter(i => i.has_mismatch);

  const content = `
    ${mismatched.length ? `<div style="padding:12px 16px;background:var(--red-soft);border:1px solid var(--red);border-radius:var(--radius);margin-bottom:16px;font-size:0.85rem;">
      <i class="fas fa-exclamation-triangle" style="color:var(--red);"></i> ${mismatched.length} item(s) do not match (Issued − Returned − Used ≠ 0). Classify each difference and add a note to approve.</div>` : ''}
    <div class="table-wrapper"><table class="data-table">
    <thead><tr><th>Product</th><th>Issued</th><th>Returned</th><th>Used</th><th>Difference</th><th>Status</th></tr></thead>
    <tbody>${items.map(i => {
      const p = prodMap[i.product_id];
      const lines = usage.filter(u => u.item_id === i.id);
      return `<tr style="${i.has_mismatch ? 'background:var(--red-soft);' : ''}">
        <td><strong>${esc(p?.name || '?')}</strong></td>
        ${storedQtyCells(i, p?.type, lines, partyMap)}
        <td>${itemStatusHTML(i)}</td></tr>`;
    }).join('')}</tbody></table></div>
    ${mismatched.length ? `<div style="margin-top:16px;">
      <div class="form-label" style="margin-bottom:8px;">Classify each difference *</div>
      ${mismatched.map(i => {
        const p = prodMap[i.product_id];
        const state = storedState(i) || 'shortage';
        return `<div class="ar-resolution" data-item-id="${i.id}" style="border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:10px;">
          <div style="margin-bottom:8px;"><strong>${esc(p?.name || '?')}</strong> — ${differenceHTML(Number(i.difference), p?.type, state)}</div>
          <select class="form-select ar-type" data-item-id="${i.id}" aria-label="Difference classification" style="margin-bottom:8px;">
            <option value="">Select classification…</option>
            ${Object.entries(DISCREPANCY_TYPES).map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join('')}
          </select>
          <textarea class="form-textarea ar-note" data-item-id="${i.id}" maxlength="500" placeholder="What happened? (required)" aria-label="Difference note"></textarea>
        </div>`;
      }).join('')}
    </div>` : ''}
    <div style="margin-top:14px;padding:12px;background:var(--green-soft);border:1px solid var(--green);border-radius:var(--radius);font-size:0.85rem;">
      <i class="fas fa-shield-check" style="color:var(--green);"></i> On approval, the <strong>returned</strong> quantity goes back into stock.
      Machines used for an <strong>installation</strong> move to the product's Installed Qty and get an Installations record for that customer.
      Other usage is recorded as consumed.</div>`;
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
