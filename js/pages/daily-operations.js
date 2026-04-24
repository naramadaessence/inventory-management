import { db, auth } from '../supabase.js';
import { formatStock, formatDateTime, showToast, createModal, esc, dbOp } from '../utils/helpers.js';

export async function renderDailyOps(body, header) {
  if (!auth.isAdmin()) { body.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3></div>'; return; }

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Daily Operations</h1>
      <div class="page-header-subtitle">Seller checkout & checkin workflow</div>
    </div>
    <button class="btn btn-primary" id="btn-new-checkout"><i class="fas fa-arrow-right-from-bracket"></i> New Checkout</button>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  await renderSessionsList(body);

  document.getElementById('btn-new-checkout').addEventListener('click', () => openCheckoutModal(body));
}

async function renderSessionsList(body) {
  const { data: sessions } = await db.getAll('checkout_sessions', { orderBy: ['created_at', 'desc'] });
  const { data: profiles } = await db.getAll('profiles');
  const { data: items } = await db.getAll('checkout_items');
  const { data: products } = await db.getAll('products');
  const sellerMap = Object.fromEntries(profiles.map(p => [p.id, p]));
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

  body.innerHTML = `
    <div class="tabs">
      <button class="tab-btn active" data-tab="active">Active (${sessions.filter(s => s.status === 'checked_out').length})</button>
      <button class="tab-btn" data-tab="completed">Completed</button>
      <button class="tab-btn" data-tab="flagged">Flagged (${sessions.filter(s => s.status === 'flagged').length})</button>
    </div>
    <div id="sessions-list"></div>
  `;

  let activeTab = 'active';

  function renderTab() {
    const filtered = sessions.filter(s => {
      if (activeTab === 'active') return s.status === 'checked_out';
      if (activeTab === 'completed') return s.status === 'checked_in';
      if (activeTab === 'flagged') return s.status === 'flagged';
      return true;
    });

    const container = document.getElementById('sessions-list');
    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><h3>No ${activeTab} sessions</h3></div>`;
      return;
    }

    container.innerHTML = `<div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Seller</th><th>Checkout Time</th><th>Checkin Time</th><th>Items</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${filtered.map(s => {
        const seller = sellerMap[s.seller_id];
        const sItems = items.filter(i => i.session_id === s.id);
        return `<tr>
          <td><strong>${esc(seller?.full_name || 'Unknown')}</strong></td>
          <td>${formatDateTime(s.checkout_time)}</td>
          <td>${s.checkin_time ? formatDateTime(s.checkin_time) : '<span style="color:var(--text-muted);">Pending</span>'}</td>
          <td>${sItems.length} items</td>
          <td><span class="badge-status ${s.status === 'checked_in' ? 'green' : s.status === 'flagged' ? 'red' : 'amber'}">${esc(s.status.replace(/_/g, ' '))}</span></td>
          <td>
            ${s.status === 'checked_out' ? `<button class="btn btn-sm btn-primary checkin-btn" data-id="${s.id}"><i class="fas fa-sign-in-alt"></i> Check In</button>` : ''}
            <button class="btn btn-sm btn-ghost view-session-btn" data-id="${s.id}"><i class="fas fa-eye"></i></button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    container.querySelectorAll('.checkin-btn').forEach(el => el.addEventListener('click', () => openCheckinModal(parseInt(el.dataset.id), body)));
    container.querySelectorAll('.view-session-btn').forEach(el => el.addEventListener('click', () => viewSession(parseInt(el.dataset.id), items, prodMap, sellerMap)));
  }

  body.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderTab();
    });
  });

  renderTab();
}

function viewSession(sessionId, allItems, prodMap, sellerMap) {
  const sItems = allItems.filter(i => i.session_id === sessionId);
  const content = sItems.length === 0
    ? '<p style="color:var(--text-muted);">No items in this session.</p>'
    : `<div class="table-wrapper"><table class="data-table">
        <thead><tr><th>Product</th><th>Type</th><th>Checkout Qty</th><th>Checkin Qty</th><th>Consumed</th><th>Flag</th></tr></thead>
        <tbody>${sItems.map(i => {
          const prod = prodMap[i.product_id];
          const consumed = (i.checkout_quantity || 0) - (i.checkin_quantity || 0);
          const threshold = prod?.max_daily_consumption || 30;
          const flagged = i.is_flagged;
          return `<tr style="${flagged ? 'background:var(--red-soft);' : ''}">
            <td>${esc(prod?.name || 'Unknown')}</td>
            <td><span class="badge-status ${prod?.type === 'liquid' ? 'purple' : 'blue'}">${prod?.type || '—'}</span></td>
            <td>${formatStock(i.checkout_quantity, prod?.type)}</td>
            <td>${i.checkin_quantity != null ? formatStock(i.checkin_quantity, prod?.type) : '—'}</td>
            <td style="${flagged ? 'color:var(--red);font-weight:700;' : ''}">${i.checkin_quantity != null ? formatStock(consumed, prod?.type) : '—'}</td>
            <td>${flagged ? '<span class="badge-status red">⚠ Flagged</span>' : '<span class="badge-status green">OK</span>'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;

  createModal('Session Details', content, { large: true });
}

async function openCheckoutModal(body) {
  const { data: sellers } = await db.getAll('profiles');
  const activeSellers = sellers.filter(s => s.role === 'seller' && s.is_active);
  const { data: products } = await db.getAll('products');
  const activeProducts = products.filter(p => p.is_active);

  const content = `
    <div class="form-group">
      <label class="form-label">Seller *</label>
      <select class="form-select" id="co-seller">
        <option value="">Select seller...</option>
        ${activeSellers.map(s => `<option value="${s.id}">${esc(s.full_name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Add Products</label>
      <select class="form-select" id="co-product-select">
        <option value="">Select product to add...</option>
        ${activeProducts.map(p => `<option value="${p.id}">${esc(p.name)} (${p.type === 'liquid' ? 'liquid' : 'unit'} — stock: ${formatStock(p.current_stock, p.type)})</option>`).join('')}
      </select>
    </div>
    <div id="co-items-list" class="checkout-items-list" style="margin-top:12px;"></div>
    <div style="margin-top:12px;padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);font-size:0.8rem;color:var(--text-muted);">
      <i class="fas fa-info-circle"></i> For liquid items enter weight in grams. For unit items enter piece count.
    </div>
  `;

  const footer = `
    <button class="btn btn-secondary" id="co-cancel">Cancel</button>
    <button class="btn btn-primary" id="co-submit"><i class="fas fa-check"></i> Confirm Checkout</button>
  `;

  const { close } = createModal('New Checkout', content, { footer, large: true });
  const checkoutItems = [];

  document.getElementById('co-product-select').addEventListener('change', (e) => {
    const prodId = parseInt(e.target.value);
    if (!prodId || checkoutItems.find(i => i.product_id === prodId)) { e.target.value = ''; return; }
    const prod = activeProducts.find(p => p.id === prodId);
    checkoutItems.push({ product_id: prodId, product: prod, quantity: prod.type === 'liquid' ? 100 : 1 });
    e.target.value = '';
    renderCheckoutItems();
  });

  function renderCheckoutItems() {
    const list = document.getElementById('co-items-list');
    if (checkoutItems.length === 0) { list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No items added yet</p>'; return; }
    list.innerHTML = checkoutItems.map((item, idx) => `
      <div class="checkout-item">
        <div class="checkout-item-info">
          <div class="checkout-item-name">${esc(item.product.name)}</div>
          <div class="checkout-item-type">${item.product.type === 'liquid' ? 'Liquid (grams)' : 'Unit (pieces)'} · Stock: ${formatStock(item.product.current_stock, item.product.type)}</div>
        </div>
        <input class="form-input co-qty-input" type="number" data-idx="${idx}" value="${item.quantity}" min="${item.product.type === 'liquid' ? '0.1' : '1'}" step="${item.product.type === 'liquid' ? '0.1' : '1'}" style="width:100px;" />
        <button class="btn-remove co-remove-btn" data-idx="${idx}"><i class="fas fa-times"></i></button>
      </div>
    `).join('');

    list.querySelectorAll('.co-qty-input').forEach(inp => {
      inp.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        const i = parseInt(e.target.dataset.idx);
        if (isNaN(val) || val <= 0) { showToast('Quantity must be positive', 'error'); return; }
        if (val > checkoutItems[i].product.current_stock) { showToast('Cannot exceed current stock', 'error'); e.target.value = checkoutItems[i].quantity; return; }
        checkoutItems[i].quantity = val;
      });
    });
    list.querySelectorAll('.co-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => { checkoutItems.splice(parseInt(btn.dataset.idx), 1); renderCheckoutItems(); });
    });
  }

  renderCheckoutItems();
  document.getElementById('co-cancel').onclick = close;
  document.getElementById('co-submit').onclick = async () => {
    const sellerId = document.getElementById('co-seller').value;
    if (!sellerId) { showToast('Please select a seller', 'error'); return; }
    if (checkoutItems.length === 0) { showToast('Please add at least one product', 'error'); return; }

    // Validate stock
    for (const item of checkoutItems) {
      if (item.quantity > item.product.current_stock) {
        showToast(`Insufficient stock for ${item.product.name}`, 'error');
        return;
      }
      if (item.quantity <= 0) { showToast(`Invalid quantity for ${item.product.name}`, 'error'); return; }
    }

    // Create session
    const session = await dbOp(db.insert('checkout_sessions', {
      seller_id: sellerId,
      checkout_time: new Date().toISOString(),
      checkin_time: null,
      status: 'checked_out',
      notes: ''
    }), 'Failed to create checkout session');
    if (!session) return;

    // Create items and deduct stock atomically
    for (const item of checkoutItems) {
      await dbOp(db.insert('checkout_items', {
        session_id: session.data.id,
        product_id: item.product_id,
        checkout_quantity: item.quantity,
        checkin_quantity: null,
        is_flagged: false,
        flag_reason: null
      }), 'Failed to add checkout item');
      const newStock = item.product.current_stock - item.quantity;
      await dbOp(db.update('products', item.product_id, { current_stock: Math.max(0, newStock) }), 'Failed to update stock');
      await dbOp(db.insert('inventory_transactions', {
        product_id: item.product_id,
        type: 'checkout',
        quantity: -item.quantity,
        reference_type: 'checkout_session',
        reference_id: session.data.id,
        performed_by: auth.currentUser.id,
        notes: `Checkout to seller`
      }), 'Failed to log transaction');
    }

    showToast('Checkout created successfully', 'success');
    close();
    await renderSessionsList(body);
  };
}

async function openCheckinModal(sessionId, body) {
  const { data: items } = await db.getAll('checkout_items');
  const sessionItems = items.filter(i => i.session_id === sessionId);
  const { data: products } = await db.getAll('products');
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

  const content = `
    <p style="margin-bottom:16px;color:var(--text-secondary);font-size:0.85rem;">Enter the return quantities for each item. Consumption above threshold will be flagged.</p>
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Product</th><th>Checkout Qty</th><th>Return Qty</th></tr></thead>
      <tbody>${sessionItems.map(i => {
        const prod = prodMap[i.product_id];
        return `<tr>
          <td>${esc(prod?.name || 'Unknown')}<br><small style="color:var(--text-muted);">${prod?.type === 'liquid' ? 'grams' : 'pieces'}</small></td>
          <td>${formatStock(i.checkout_quantity, prod?.type)}</td>
          <td><input class="form-input ci-return-qty" type="number" data-item-id="${i.id}" value="${i.checkout_quantity}" min="0" max="${i.checkout_quantity}" step="${prod?.type === 'liquid' ? '0.1' : '1'}" style="width:120px;" /></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="form-group" style="margin-top:16px;">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="ci-notes" placeholder="Any observations..." maxlength="500"></textarea>
    </div>
  `;

  const footer = `
    <button class="btn btn-secondary" id="ci-cancel">Cancel</button>
    <button class="btn btn-primary" id="ci-submit"><i class="fas fa-check"></i> Confirm Check In</button>
  `;

  const { close } = createModal('Check In', content, { footer, large: true });
  document.getElementById('ci-cancel').onclick = close;

  document.getElementById('ci-submit').onclick = async () => {
    let anyFlagged = false;
    const returnData = [];

    document.querySelectorAll('.ci-return-qty').forEach(inp => {
      const itemId = parseInt(inp.dataset.itemId);
      const returnQty = parseFloat(inp.value);
      const item = sessionItems.find(i => i.id === itemId);
      const prod = prodMap[item.product_id];
      const consumed = (item.checkout_quantity || 0) - returnQty;
      const threshold = prod?.max_daily_consumption || 30;
      const flagged = consumed > threshold;
      if (flagged) anyFlagged = true;

      if (isNaN(returnQty) || returnQty < 0) {
        showToast(`Invalid return quantity for ${prod?.name}`, 'error');
        return;
      }

      returnData.push({ itemId, returnQty, consumed, flagged, item, prod });
    });

    if (returnData.length !== sessionItems.length) return;

    // Process each item
    for (const rd of returnData) {
      await dbOp(db.update('checkout_items', rd.itemId, {
        checkin_quantity: rd.returnQty,
        is_flagged: rd.flagged,
        flag_reason: rd.flagged ? `Consumed ${rd.consumed} exceeds threshold ${rd.prod.max_daily_consumption}` : null
      }), 'Failed to update checkout item');
      const newStock = (rd.prod.current_stock || 0) + rd.returnQty;
      await dbOp(db.update('products', rd.prod.id, { current_stock: newStock }), 'Failed to update stock');
      await dbOp(db.insert('inventory_transactions', {
        product_id: rd.prod.id,
        type: 'checkin',
        quantity: rd.returnQty,
        reference_type: 'checkout_session',
        reference_id: sessionId,
        performed_by: auth.currentUser.id,
        notes: rd.flagged ? `FLAGGED: consumed ${rd.consumed}` : `Normal return`
      }), 'Failed to log transaction');
    }

    // Update session status
    await dbOp(db.update('checkout_sessions', sessionId, {
      checkin_time: new Date().toISOString(),
      status: anyFlagged ? 'flagged' : 'checked_in',
      notes: document.getElementById('ci-notes').value.trim()
    }), 'Failed to update session');

    showToast(anyFlagged ? 'Checked in with flags — review consumption' : 'Checked in successfully', anyFlagged ? 'warning' : 'success');
    close();
    await renderSessionsList(body);
  };
}
