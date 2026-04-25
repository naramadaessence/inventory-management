import { db, auth } from '../supabase.js';
import { formatStock, formatDateTime, showToast, createModal, esc, dbOp } from '../utils/helpers.js';

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

async function renderSessionsList(body, isAdmin) {
  const { data: sessions } = await db.getAll('checkout_sessions', { orderBy: ['created_at', 'desc'] });
  const { data: profiles } = await db.getAll('profiles');
  const { data: items } = await db.getAll('checkout_items');
  const { data: products } = await db.getAll('products');
  const sellerMap = Object.fromEntries(profiles.map(p => [p.id, p]));
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
  const vis = isAdmin ? sessions : sessions.filter(s => s.seller_id === auth.currentUser.id);

  const counts = { pending_issue: 0, checked_out: 0, pending_approval: 0, flagged: 0 };
  vis.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });

  body.innerHTML = `
    <div class="tabs">
      <button class="tab-btn" data-tab="pending_issue">Pending Issue (${counts.pending_issue})</button>
      <button class="tab-btn active" data-tab="checked_out">In Field (${counts.checked_out})</button>
      <button class="tab-btn" data-tab="pending_approval">Pending Return (${counts.pending_approval})</button>
      <button class="tab-btn" data-tab="checked_in">Completed</button>
      <button class="tab-btn" data-tab="flagged">Flagged (${counts.flagged})</button>
    </div>
    ${(counts.pending_issue + counts.pending_approval > 0) ? `<div style="background:var(--accent-soft);border:1px solid var(--accent);border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">
      <i class="fas fa-bell" style="color:var(--accent);font-size:1.1rem;"></i>
      <span>${isAdmin ? `<strong>${counts.pending_issue + counts.pending_approval}</strong> session(s) awaiting your action.` : `<strong>${counts.pending_issue + counts.pending_approval}</strong> of your request(s) are pending admin approval.`}</span>
    </div>` : ''}
    <div id="sessions-list"></div>`;

  let activeTab = 'checked_out';

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
          actions += `<button class="btn btn-sm btn-danger flag-btn" data-id="${s.id}"><i class="fas fa-flag"></i> Flag</button>`;
        }
        actions += ` <button class="btn btn-sm btn-ghost view-btn" data-id="${s.id}"><i class="fas fa-eye"></i></button>`;

        const colors = { pending_issue: 'purple', checked_out: 'blue', pending_approval: 'amber', checked_in: 'green', flagged: 'red' };
        const labels = { pending_issue: 'Pending Issue', checked_out: 'In Field', pending_approval: 'Pending Return', checked_in: 'Approved', flagged: 'Flagged' };
        const highlight = (s.status === 'pending_issue' || s.status === 'pending_approval') ? ' style="background:var(--accent-soft);"' : '';

        return `<tr${highlight}>
          <td><strong>${esc(seller?.full_name || 'Unknown')}</strong></td>
          <td>${formatDateTime(s.checkout_time)}</td>
          <td>${s.checkin_time ? formatDateTime(s.checkin_time) : '<span style="color:var(--text-muted);">—</span>'}</td>
          <td>${sItems.length} items</td>
          <td><span class="badge-status ${colors[s.status]}">${labels[s.status]}</span></td>
          <td>${actions}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;

    container.querySelectorAll('.approve-issue-btn').forEach(el => el.addEventListener('click', () => approveIssue(parseInt(el.dataset.id), body, items, prodMap)));
    container.querySelectorAll('.checkin-btn').forEach(el => el.addEventListener('click', () => openCheckinModal(parseInt(el.dataset.id), body, isAdmin)));
    container.querySelectorAll('.approve-return-btn').forEach(el => el.addEventListener('click', () => openApproveReturnModal(parseInt(el.dataset.id), body, items, prodMap)));
    container.querySelectorAll('.flag-btn').forEach(el => el.addEventListener('click', () => flagSession(parseInt(el.dataset.id), body, isAdmin)));
    container.querySelectorAll('.view-btn').forEach(el => el.addEventListener('click', () => viewSession(parseInt(el.dataset.id), items, prodMap)));
  }

  body.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
    body.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    renderTab();
  }));
  renderTab();
}

function viewSession(sessionId, allItems, prodMap) {
  const sItems = allItems.filter(i => i.session_id === sessionId);
  if (!sItems.length) { createModal('Session', '<p style="color:var(--text-muted);">No items.</p>'); return; }
  const content = `<div class="table-wrapper"><table class="data-table">
    <thead><tr><th>Product</th><th>Issued</th><th>Returned</th><th>Consumed</th><th>Flag</th></tr></thead>
    <tbody>${sItems.map(i => {
      const p = prodMap[i.product_id];
      const consumed = (i.checkout_quantity||0) - (i.checkin_quantity||0);
      return `<tr style="${i.is_flagged?'background:var(--red-soft);':''}">
        <td>${esc(p?.name||'Unknown')}</td>
        <td>${formatStock(i.checkout_quantity,p?.type)}</td>
        <td>${i.checkin_quantity!=null?formatStock(i.checkin_quantity,p?.type):'—'}</td>
        <td style="${i.is_flagged?'color:var(--red);font-weight:700;':''}">${i.checkin_quantity!=null?formatStock(consumed,p?.type):'—'}</td>
        <td>${i.is_flagged?'<span class="badge-status red">⚠</span>':'<span class="badge-status green">OK</span>'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
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
      <i class="fas fa-info-circle"></i> ${isSeller ? 'Enter weight/quantity you are taking. Admin will approve before stock is deducted.' : 'For liquid items enter weight in grams. For unit items enter piece count.'}
    </div>`;
  const footer = `<button class="btn btn-secondary" id="co-cancel">Cancel</button>
    <button class="btn btn-primary" id="co-submit"><i class="fas fa-check"></i> ${isSeller ? 'Request Stock' : 'Confirm Issue'}</button>`;
  const { close } = createModal(isSeller ? 'Request Stock' : 'Issue Stock', content, { footer, large: true });
  const checkoutItems = [];

  document.getElementById('co-product-select').addEventListener('change', (e) => {
    const prodId = parseInt(e.target.value);
    if (!prodId || checkoutItems.find(i => i.product_id === prodId)) { e.target.value = ''; return; }
    const prod = activeProducts.find(p => p.id === prodId);
    checkoutItems.push({ product_id: prodId, product: prod, quantity: prod.type === 'liquid' ? 100 : 1 });
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
          <div class="checkout-item-type">${item.product.type==='liquid'?'Liquid (grams)':'Unit (pieces)'} · Stock: ${formatStock(item.product.current_stock,item.product.type)}</div>
        </div>
        <input class="form-input co-qty" type="number" data-idx="${idx}" value="${item.quantity}" min="${item.product.type==='liquid'?'0.1':'1'}" step="${item.product.type==='liquid'?'0.1':'1'}" style="width:100px;" />
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
    }

    // Seller: pending_issue (no stock deduction). Admin: checked_out (deduct immediately).
    const status = isSeller ? 'pending_issue' : 'checked_out';
    const session = await dbOp(db.insert('checkout_sessions', {
      seller_id: sellerId, checkout_time: new Date().toISOString(), checkin_time: null, status, notes: ''
    }), 'Failed to create session');
    if (!session) return;

    for (const item of checkoutItems) {
      await dbOp(db.insert('checkout_items', {
        session_id: session.data.id, product_id: item.product_id,
        checkout_quantity: item.quantity, checkin_quantity: null, is_flagged: false, flag_reason: null
      }), 'Failed to add item');

      // Only deduct stock if admin is creating (immediate approval)
      if (isAdmin) {
        const newStock = item.product.current_stock - item.quantity;
        await dbOp(db.update('products', item.product_id, { current_stock: Math.max(0, newStock) }), 'Failed to update stock');
        await dbOp(db.insert('inventory_transactions', {
          product_id: item.product_id, type: 'checkout', quantity: -item.quantity,
          reference_type: 'checkout_session', reference_id: session.data.id,
          performed_by: auth.currentUser.id, notes: 'Issued to seller'
        }), 'Failed to log transaction');
      }
    }

    showToast(isSeller ? 'Stock request submitted — waiting for admin approval' : 'Stock issued successfully', 'success');
    close();
    await renderSessionsList(body, isAdmin);
  };
}

// ============================================
// APPROVE ISSUE (Admin: deduct stock, set checked_out)
// ============================================
async function approveIssue(sessionId, body, allItems, prodMap) {
  const sItems = allItems.filter(i => i.session_id === sessionId);
  const { data: products } = await db.getAll('products');
  const freshMap = Object.fromEntries(products.map(p => [p.id, p]));

  const content = `<p style="margin-bottom:12px;font-size:0.9rem;">Review items the seller wants to take:</p>
    <div class="table-wrapper"><table class="data-table">
    <thead><tr><th>Product</th><th>Requested Qty</th><th>Current Stock</th><th>Status</th></tr></thead>
    <tbody>${sItems.map(i => {
      const p = freshMap[i.product_id] || prodMap[i.product_id];
      const ok = (p?.current_stock || 0) >= i.checkout_quantity;
      return `<tr style="${!ok?'background:var(--red-soft);':''}">
        <td><strong>${esc(p?.name||'Unknown')}</strong></td>
        <td>${formatStock(i.checkout_quantity,p?.type)}</td>
        <td>${formatStock(p?.current_stock||0,p?.type)}</td>
        <td>${ok?'<span class="badge-status green">OK</span>':'<span class="badge-status red">Low Stock</span>'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>
    <div style="margin-top:14px;padding:12px;background:var(--green-soft);border:1px solid var(--green);border-radius:var(--radius);font-size:0.85rem;">
      <i class="fas fa-info-circle" style="color:var(--green);"></i> On approval, stock will be deducted from inventory.
    </div>`;
  const footer = `<button class="btn btn-secondary" id="ai-cancel">Cancel</button>
    <button class="btn btn-danger" id="ai-reject"><i class="fas fa-times"></i> Reject</button>
    <button class="btn btn-primary" id="ai-approve" style="background:var(--green);border-color:var(--green);"><i class="fas fa-check"></i> Approve Issue</button>`;
  const { close } = createModal('Approve Stock Issue', content, { footer, large: true });

  document.getElementById('ai-cancel').onclick = close;
  document.getElementById('ai-reject').onclick = async () => { close(); await flagSession(sessionId, body, true); };
  document.getElementById('ai-approve').onclick = async () => {
    for (const item of sItems) {
      const p = freshMap[item.product_id];
      if (!p) continue;
      const newStock = Math.max(0, (p.current_stock || 0) - item.checkout_quantity);
      await dbOp(db.update('products', item.product_id, { current_stock: newStock }), 'Failed to deduct stock');
      await dbOp(db.insert('inventory_transactions', {
        product_id: item.product_id, type: 'checkout', quantity: -item.checkout_quantity,
        reference_type: 'checkout_session', reference_id: sessionId,
        performed_by: auth.currentUser.id, notes: 'Approved issue to seller'
      }), 'Failed to log transaction');
    }
    await dbOp(db.update('checkout_sessions', sessionId, {
      status: 'checked_out', approved_by: auth.currentUser.id, approved_at: new Date().toISOString()
    }), 'Failed to approve');
    showToast('Issue approved — stock deducted', 'success');
    close();
    await renderSessionsList(body, true);
  };
}

// ============================================
// SUBMIT RETURN (Seller/Admin: set pending_approval, NO stock restore)
// ============================================
async function openCheckinModal(sessionId, body, isAdmin) {
  const { data: items } = await db.getAll('checkout_items');
  const sessionItems = items.filter(i => i.session_id === sessionId);
  const { data: products } = await db.getAll('products');
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

  const content = `
    <div style="padding:12px 16px;background:var(--blue-soft);border:1px solid var(--blue);border-radius:var(--radius);margin-bottom:16px;font-size:0.85rem;">
      <i class="fas fa-info-circle" style="color:var(--blue);"></i> Stock will be held until admin approves the return.
    </div>
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Product</th><th>Issued Qty</th><th>Return Qty</th></tr></thead>
      <tbody>${sessionItems.map(i => {
        const p = prodMap[i.product_id];
        return `<tr><td>${esc(p?.name||'Unknown')}<br><small style="color:var(--text-muted);">${p?.type==='liquid'?'grams':'pieces'}</small></td>
          <td>${formatStock(i.checkout_quantity,p?.type)}</td>
          <td><input class="form-input ci-rq" type="number" data-item-id="${i.id}" value="${i.checkout_quantity}" min="0" max="${i.checkout_quantity}" step="${p?.type==='liquid'?'0.1':'1'}" style="width:120px;" /></td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="form-group" style="margin-top:16px;"><label class="form-label">Notes</label>
      <textarea class="form-textarea" id="ci-notes" placeholder="Any observations..." maxlength="500"></textarea></div>`;
  const footer = `<button class="btn btn-secondary" id="ci-cancel">Cancel</button>
    <button class="btn btn-primary" id="ci-submit"><i class="fas fa-paper-plane"></i> Submit Return</button>`;
  const { close } = createModal('Submit Return', content, { footer, large: true });
  document.getElementById('ci-cancel').onclick = close;

  document.getElementById('ci-submit').onclick = async () => {
    const returnData = [];
    document.querySelectorAll('.ci-rq').forEach(inp => {
      const itemId = parseInt(inp.dataset.itemId), rq = parseFloat(inp.value);
      const item = sessionItems.find(i => i.id === itemId);
      const p = prodMap[item.product_id];
      const consumed = (item.checkout_quantity||0) - rq;
      const flagged = consumed > (p?.max_daily_consumption || 30);
      if (isNaN(rq)||rq<0) { showToast(`Invalid qty for ${p?.name}`,'error'); return; }
      returnData.push({ itemId, rq, consumed, flagged, item, p });
    });
    if (returnData.length !== sessionItems.length) return;

    for (const rd of returnData) {
      await dbOp(db.update('checkout_items', rd.itemId, {
        checkin_quantity: rd.rq, is_flagged: rd.flagged,
        flag_reason: rd.flagged ? `Consumed ${rd.consumed} exceeds threshold` : null
      }), 'Failed to update item');
    }
    await dbOp(db.update('checkout_sessions', sessionId, {
      checkin_time: new Date().toISOString(), status: 'pending_approval',
      notes: document.getElementById('ci-notes').value.trim()
    }), 'Failed to update session');

    showToast('Return submitted — waiting for admin approval', 'success');
    close();
    await renderSessionsList(body, isAdmin);
  };
}

// ============================================
// APPROVE RETURN (Admin: restore stock, set checked_in)
// ============================================
async function openApproveReturnModal(sessionId, body, allItems, prodMap) {
  const sItems = allItems.filter(i => i.session_id === sessionId);
  const { data: products } = await db.getAll('products');
  const freshMap = Object.fromEntries(products.map(p => [p.id, p]));
  const anyFlagged = sItems.some(i => i.is_flagged);

  const content = `
    ${anyFlagged?`<div style="padding:12px 16px;background:var(--red-soft);border:1px solid var(--red);border-radius:var(--radius);margin-bottom:16px;font-size:0.85rem;">
      <i class="fas fa-exclamation-triangle" style="color:var(--red);"></i> Some items exceed consumption threshold.</div>`:''}
    <div class="table-wrapper"><table class="data-table">
    <thead><tr><th>Product</th><th>Issued</th><th>Returned</th><th>Consumed</th><th>Status</th></tr></thead>
    <tbody>${sItems.map(i => {
      const p = freshMap[i.product_id]||prodMap[i.product_id];
      const c = (i.checkout_quantity||0)-(i.checkin_quantity||0);
      return `<tr style="${i.is_flagged?'background:var(--red-soft);':''}">
        <td><strong>${esc(p?.name||'?')}</strong></td>
        <td>${formatStock(i.checkout_quantity,p?.type)}</td><td>${formatStock(i.checkin_quantity,p?.type)}</td>
        <td style="${i.is_flagged?'color:var(--red);font-weight:700;':''}">${formatStock(c,p?.type)}</td>
        <td>${i.is_flagged?'<span class="badge-status red">⚠ Over</span>':'<span class="badge-status green">OK</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>
    <div style="margin-top:14px;padding:12px;background:var(--green-soft);border:1px solid var(--green);border-radius:var(--radius);font-size:0.85rem;">
      <i class="fas fa-shield-check" style="color:var(--green);"></i> On approval, returned stock will be added back to inventory.</div>`;
  const footer = `<button class="btn btn-secondary" id="ar-cancel">Cancel</button>
    <button class="btn btn-danger" id="ar-flag"><i class="fas fa-flag"></i> Flag</button>
    <button class="btn btn-primary" id="ar-approve" style="background:var(--green);border-color:var(--green);"><i class="fas fa-check-double"></i> Approve & Restore</button>`;
  const { close } = createModal('Approve Return', content, { footer, large: true });

  document.getElementById('ar-cancel').onclick = close;
  document.getElementById('ar-flag').onclick = async () => { close(); await flagSession(sessionId, body, true); };
  document.getElementById('ar-approve').onclick = async () => {
    for (const item of sItems) {
      if (item.checkin_quantity > 0) {
        const p = freshMap[item.product_id];
        await dbOp(db.update('products', item.product_id, { current_stock: (p?.current_stock||0) + item.checkin_quantity }), 'Failed to restore stock');
        await dbOp(db.insert('inventory_transactions', {
          product_id: item.product_id, type: 'checkin', quantity: item.checkin_quantity,
          reference_type: 'checkout_session', reference_id: sessionId,
          performed_by: auth.currentUser.id, notes: 'Approved return — stock restored'
        }), 'Failed to log');
      }
    }
    await dbOp(db.update('checkout_sessions', sessionId, {
      status: 'checked_in', approved_by: auth.currentUser.id, approved_at: new Date().toISOString()
    }), 'Failed to approve');
    showToast('Return approved — stock restored', 'success');
    close();
    await renderSessionsList(body, true);
  };
}

async function flagSession(sessionId, body, isAdmin) {
  if (!confirm('Flag this session? Stock will NOT be affected.')) return;
  await dbOp(db.update('checkout_sessions', sessionId, {
    status: 'flagged', approved_by: auth.currentUser.id, approved_at: new Date().toISOString()
  }), 'Failed to flag');
  showToast('Session flagged', 'warning');
  await renderSessionsList(body, isAdmin);
}
