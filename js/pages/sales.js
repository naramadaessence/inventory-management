import { db, auth } from '../supabase.js';
import { formatCurrency, formatDateTime, formatDate, formatWeight, formatStock, showToast, createModal, daysUntil, esc, dbOp } from '../utils/helpers.js';

// Helper: summarize sale items for table display
function itemsSummary(items, prodMap) {
  if (!items || items.length === 0) return '—';
  const first = prodMap[items[0].product_id];
  const firstName = first?.name || 'Unknown';
  const firstQty = items[0].quantity;
  let txt = `${esc(firstName)} ×${firstQty}`;
  if (items.length > 1) txt += ` & ${items.length - 1} more`;
  return txt;
}

export async function renderSales(body, header) {
  const isAdmin = auth.isAdmin();
  const userId = auth.currentUser.id;

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Sales</h1>
      <div class="page-header-subtitle">${isAdmin ? 'Record and track sales to parties' : 'Record new sales'}</div>
    </div>
    <button class="btn btn-primary" id="btn-new-sale"><i class="fas fa-plus"></i> Record Sale</button>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  const { data: allSales } = await db.fetchAllPaged('sales', { orderBy: ['created_at', 'desc'] });
  const { data: allSaleItems } = await db.fetchAllPaged('sale_items');
  const { data: parties } = await db.getAll('parties');
  const { data: products } = await db.getAll('products');
  const partyMap = Object.fromEntries(parties.map(p => [p.id, p]));
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

  // Group sale_items by sale_id
  const itemsBySale = {};
  allSaleItems.forEach(si => {
    if (!itemsBySale[si.sale_id]) itemsBySale[si.sale_id] = [];
    itemsBySale[si.sale_id].push(si);
  });

  // Sellers see only their own sales
  const sales = isAdmin ? allSales : allSales.filter(s => s.recorded_by === userId);

  const totalRevenue = sales.reduce((s, r) => s + (r.total_amount || 0), 0);
  const totalReceived = sales.reduce((s, r) => s + (r.amount_received || 0), 0);
  const totalPending = totalRevenue - totalReceived;

  body.innerHTML = `
    ${isAdmin ? `<div class="stats-grid">
      <div class="stat-card"><div class="stat-icon green"><i class="fas fa-indian-rupee-sign"></i></div><div class="stat-info"><div class="stat-label">Total Revenue</div><div class="stat-value">${formatCurrency(totalRevenue)}</div></div></div>
      <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-receipt"></i></div><div class="stat-info"><div class="stat-label">Total Transactions</div><div class="stat-value">${sales.length}</div></div></div>
      <div class="stat-card"><div class="stat-icon amber"><i class="fas fa-clock"></i></div><div class="stat-info"><div class="stat-label">Pending Amount</div><div class="stat-value">${formatCurrency(totalPending)}</div></div></div>
    </div>` : ''}
    ${sales.length === 0 ? '<div class="empty-state"><i class="fas fa-receipt"></i><h3>No sales recorded</h3><p>Click "Record Sale" to add your first sale.</p></div>' : `
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Date</th><th>Party</th><th>Items</th><th>Amount</th><th>Received</th><th>Payment</th><th>Due Date</th></tr></thead>
      <tbody>${sales.map(s => {
        const party = partyMap[s.party_id];
        const sItems = itemsBySale[s.id] || [];
        const balance = (s.total_amount || 0) - (s.amount_received || 0);
        const isOverdue = s.expected_payment_date && s.payment_status !== 'paid' && daysUntil(s.expected_payment_date) < 0;
        return `<tr class="sale-row" data-id="${s.id}" style="cursor:pointer;">
          <td>${formatDate(s.sale_date || s.created_at)}</td>
          <td><strong>${esc(party?.name || 'Walk-in')}</strong></td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;">${itemsSummary(sItems, prodMap)}</td>
          <td style="font-weight:600;color:var(--green);">${formatCurrency(s.total_amount)}</td>
          <td>${s.amount_received ? formatCurrency(s.amount_received) : '—'}</td>
          <td><span class="badge-status ${s.payment_status === 'paid' ? 'green' : s.payment_status === 'partial' ? 'amber' : 'red'}">${esc(s.payment_status || 'pending')}</span></td>
          <td style="${isOverdue ? 'color:var(--red);font-weight:600;' : ''}">${s.expected_payment_date ? formatDate(s.expected_payment_date) : '—'}${isOverdue ? ' ⚠' : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`}
  `;

  document.getElementById('btn-new-sale').addEventListener('click', () => openSaleModal(parties, products, body, header));
  // Edit: admin only
  if (isAdmin) {
    document.querySelectorAll('.sale-row').forEach(row => {
      row.addEventListener('click', () => {
        const sale = allSales.find(s => s.id == row.dataset.id);
        if (sale) openEditSaleModal(sale, itemsBySale[sale.id] || [], parties, products, body, header);
      });
    });
  }
}

function openSaleModal(parties, products, body, header) {
  const activeProducts = products.filter(p => p.is_active);
  let lineItems = [];
  let selectedCatRates = {};
  let selectedPartyId = null;

  const content = `
    <div class="form-row">
      <div class="form-group" style="position:relative;z-index:50;">
        <label class="form-label">Party / Customer *</label>
        <div style="position:relative;" id="party-combo">
          <input class="form-input" id="sale-party-input" placeholder="Type name or select..." autocomplete="off" />
          <input type="hidden" id="sale-party" value="" />
          <div id="party-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius) var(--radius);max-height:200px;overflow-y:auto;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,0.15);">
            <div class="party-opt" data-id="" data-catrates="{}" style="padding:10px 14px;cursor:pointer;font-size:0.9rem;color:var(--text-muted);">Walk-in customer</div>
            ${parties.map(p => `<div class="party-opt" data-id="${p.id}" data-catrates='${JSON.stringify(p.custom_category_rates || {})}' style="padding:10px 14px;cursor:pointer;font-size:0.9rem;">${esc(p.name)}</div>`).join('')}
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Sale Date *</label>
        <input class="form-input" type="date" id="sale-date" value="${new Date().toISOString().split('T')[0]}" required />
      </div>
    </div>
    <div id="party-info-card" style="display:none;background:var(--bg-secondary);border-radius:8px;padding:12px 16px;margin-bottom:16px;"></div>
    <div style="background:var(--bg-secondary);border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><i class="fas fa-cart-plus" style="color:var(--primary);"></i><strong style="font-size:0.9rem;">Add Item</strong></div>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
        <div style="flex:2;min-width:180px;">
          <label style="font-size:0.7rem;color:var(--text-muted);display:block;margin-bottom:4px;">Product</label>
          <select class="form-select" id="add-item-product" style="font-size:0.85rem;">${activeProducts.map(p => `<option value="${p.id}" data-price="${p.unit_price}" data-type="${p.type}" data-catid="${p.category_id}">${esc(p.name)}</option>`).join('')}</select>
        </div>
        <div style="width:80px;"><label style="font-size:0.7rem;color:var(--text-muted);display:block;margin-bottom:4px;" id="add-item-qty-label">Qty</label><input class="form-input" type="number" id="add-item-qty" value="1" min="0.001" step="1" style="font-size:0.85rem;" /></div>
        <div style="width:100px;"><label style="font-size:0.7rem;color:var(--text-muted);display:block;margin-bottom:4px;">Price (₹)</label><input class="form-input" type="number" id="add-item-price" value="${activeProducts[0]?.unit_price || 0}" min="0" step="0.01" style="font-size:0.85rem;" /></div>
        <button class="btn btn-primary btn-sm" id="btn-add-item" style="height:38px;"><i class="fas fa-plus"></i> Add</button>
      </div>
    </div>
    <div id="items-list" style="margin-bottom:16px;"></div>
    <div id="sale-grand-total" style="text-align:right;font-size:1.1rem;font-weight:700;color:var(--green);margin-bottom:16px;">Grand Total: ₹0</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Payment Status</label><select class="form-select" id="sale-payment"><option value="paid">Paid</option><option value="partial">Partial</option><option value="pending">Pending</option></select></div>
      <div class="form-group"><label class="form-label">Payment Method</label><select class="form-select" id="sale-method"><option value="">— Select —</option><option value="cash">Cash</option><option value="upi">UPI / Online</option><option value="bank_transfer">Bank Transfer</option><option value="cheque">Cheque</option></select></div>
    </div>
    <div class="form-row" id="pending-fields" style="display:none;">
      <div class="form-group"><label class="form-label">Amount Received (₹)</label><input class="form-input" type="number" id="sale-received" value="0" min="0" step="0.01" /></div>
      <div class="form-group"><label class="form-label">Expected Payment Date</label><input class="form-input" type="date" id="sale-expected-date" /></div>
    </div>
    <div class="form-group"><label class="form-label">Notes</label><textarea class="form-textarea" id="sale-notes" maxlength="500" placeholder="Additional details..."></textarea></div>
  `;
  const footer = `<button class="btn btn-secondary" id="sale-cancel">Cancel</button><button class="btn btn-primary" id="sale-save"><i class="fas fa-save"></i> Record Sale</button>`;
  const { close } = createModal('Record Sale', content, { footer });

  function renderItems() {
    const el = document.getElementById('items-list');
    if (lineItems.length === 0) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;"><i class="fas fa-inbox" style="font-size:1.2rem;margin-bottom:6px;display:block;"></i>No items added yet</div>'; }
    else {
      el.innerHTML = `<table class="data-table" style="font-size:0.85rem;"><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th><th></th></tr></thead><tbody>${lineItems.map((item, i) => `<tr><td>${esc(item.prodName)}</td><td>${item.prodType === 'liquid' ? formatWeight(item.quantity) : item.quantity + ' pcs'}</td><td>${formatCurrency(item.unit_price)}</td><td style="font-weight:600;color:var(--green);">${formatCurrency(item.line_total)}</td><td><button class="btn btn-sm btn-ghost rm-item" data-idx="${i}" style="color:var(--red);"><i class="fas fa-times"></i></button></td></tr>`).join('')}</tbody></table>`;
      el.querySelectorAll('.rm-item').forEach(b => b.addEventListener('click', () => { lineItems.splice(parseInt(b.dataset.idx), 1); renderItems(); }));
    }
    document.getElementById('sale-grand-total').textContent = `Grand Total: ${formatCurrency(lineItems.reduce((s, i) => s + i.line_total, 0))}`;
  }
  renderItems();

  // Party combobox
  const partyInput = document.getElementById('sale-party-input');
  const partyHidden = document.getElementById('sale-party');
  const partyDropdown = document.getElementById('party-dropdown');
  const allPartyOpts = partyDropdown.querySelectorAll('.party-opt');
  partyInput.addEventListener('focus', () => { partyDropdown.style.display = 'block'; filterP(); });
  partyInput.addEventListener('input', () => { partyHidden.value = ''; selectedCatRates = {}; selectedPartyId = null; document.getElementById('party-info-card').style.display = 'none'; filterP(); updPrice(); });
  document.addEventListener('click', (e) => { if (!document.getElementById('party-combo')?.contains(e.target)) partyDropdown.style.display = 'none'; });
  function filterP() { const t = partyInput.value.toLowerCase().trim(); allPartyOpts.forEach(o => { o.style.display = (!t || o.textContent.toLowerCase().includes(t)) ? 'block' : 'none'; }); }
  allPartyOpts.forEach(opt => {
    opt.addEventListener('mouseenter', () => { opt.style.background = 'var(--primary-soft)'; });
    opt.addEventListener('mouseleave', () => { opt.style.background = ''; });
    opt.addEventListener('click', () => {
      partyInput.value = opt.textContent.trim(); partyHidden.value = opt.dataset.id;
      selectedPartyId = opt.dataset.id ? parseInt(opt.dataset.id) : null;
      try { selectedCatRates = JSON.parse(opt.dataset.catrates || '{}'); } catch(e) { selectedCatRates = {}; }
      partyDropdown.style.display = 'none'; updPrice(); showPartyInfo();
    });
  });

  function showPartyInfo() {
    const card = document.getElementById('party-info-card');
    if (!selectedPartyId) { card.style.display = 'none'; return; }
    const p = parties.find(x => x.id === selectedPartyId);
    if (!p) { card.style.display = 'none'; return; }
    const ml = p.machine_type === 'purchased' ? '🟢 Purchased' : p.machine_type === 'free_to_use' ? '🔵 Free to Use' : 'No Machine';
    card.style.display = 'block';
    card.innerHTML = `<div style="display:flex;gap:16px;flex-wrap:wrap;"><div style="flex:1;min-width:140px;"><div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;">Contact</div><div style="font-size:0.85rem;">${esc(p.phone || '—')} · ${esc(p.address || '—')}</div></div><div><div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;">Machine</div><div style="font-size:0.85rem;">${ml}</div></div></div>`;
  }

  function updPrice() {
    const po = document.getElementById('add-item-product').selectedOptions[0];
    const catId = po?.dataset?.catid;
    // Check both string and numeric key variants for Supabase JSONB compatibility
    const custom = (catId && (selectedCatRates[catId] !== undefined || selectedCatRates[String(catId)] !== undefined))
      ? (selectedCatRates[catId] ?? selectedCatRates[String(catId)])
      : null;
    const def = parseFloat(po?.dataset?.price) || 0;
    const isLiq = po?.dataset?.type === 'liquid';
    const pi = document.getElementById('add-item-price');
    pi.value = (custom !== null ? custom : def).toFixed(2);
    document.getElementById('add-item-qty-label').textContent = isLiq ? 'Qty (kg)' : 'Qty (pcs)';
    // Preserve quantity value when changing step (browsers can reset it)
    const qtyEl = document.getElementById('add-item-qty');
    const curQty = qtyEl.value;
    qtyEl.step = isLiq ? '0.001' : '1';
    qtyEl.value = curQty;
    if (custom !== null) { pi.style.borderColor = 'var(--primary)'; pi.style.background = 'var(--primary-soft)'; }
    else { pi.style.borderColor = ''; pi.style.background = ''; }
  }
  document.getElementById('add-item-product').addEventListener('change', updPrice);
  updPrice();

  // Add item
  document.getElementById('btn-add-item').addEventListener('click', () => {
    const po = document.getElementById('add-item-product').selectedOptions[0];
    const pid = parseInt(po.value), qty = parseFloat(document.getElementById('add-item-qty').value), price = parseFloat(document.getElementById('add-item-price').value);
    if (!pid || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) { showToast('Invalid product, quantity or price', 'error'); return; }
    const ex = lineItems.find(i => i.product_id === pid && i.unit_price === price);
    if (ex) { ex.quantity += qty; ex.line_total = ex.quantity * ex.unit_price; }
    else { const pr = products.find(p => p.id === pid); lineItems.push({ product_id: pid, quantity: qty, unit_price: price, line_total: qty * price, prodName: pr?.name || '?', prodType: pr?.type || 'unit' }); }
    document.getElementById('add-item-qty').value = 1; renderItems();
  });

  document.getElementById('sale-payment').addEventListener('change', (e) => { document.getElementById('pending-fields').style.display = (e.target.value === 'pending' || e.target.value === 'partial') ? 'flex' : 'none'; });
  document.getElementById('sale-cancel').onclick = close;

  document.getElementById('sale-save').onclick = async () => {
    if (lineItems.length === 0) { showToast('Add at least one item', 'error'); return; }
    const partyId = partyHidden.value ? parseInt(partyHidden.value) : null;
    const payStatus = document.getElementById('sale-payment').value;
    const payMethod = document.getElementById('sale-method').value || null;
    const expDate = document.getElementById('sale-expected-date')?.value || null;
    const grandTotal = lineItems.reduce((s, i) => s + i.line_total, 0);
    const amtRcvd = payStatus === 'paid' ? grandTotal : parseFloat(document.getElementById('sale-received').value) || 0;

    // Client-side stock pre-check for fast UX. The RPC also enforces it
    // atomically, so this is just to fail before sending the request.
    const qtyByProd = {};
    lineItems.forEach(i => { qtyByProd[i.product_id] = (qtyByProd[i.product_id] || 0) + i.quantity; });
    for (const [pid, totalQty] of Object.entries(qtyByProd)) {
      const pr = products.find(p => p.id === parseInt(pid));
      if (pr && totalQty > pr.current_stock) { showToast(`Insufficient stock for ${pr.name} — only ${formatStock(pr.current_stock, pr.type)} available`, 'error'); return; }
    }

    // Atomic record_sale: inserts sale + sale_items + deducts stock + logs
    // inventory_transactions in one transaction (Postgres) or one demoRpc call.
    const result = await dbOp(db.rpc('record_sale', {
      p_party_id: partyId,
      p_items: lineItems.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })),
      p_payment_status: payStatus,
      p_payment_method: payMethod,
      p_amount_received: amtRcvd,
      p_expected_payment_date: expDate,
      p_sale_date: document.getElementById('sale-date').value,
      p_notes: document.getElementById('sale-notes').value.trim(),
      p_recorded_by: auth.currentUser.id,
    }), 'Failed to record sale');
    if (!result) return;

    showToast(`Sale recorded — ${lineItems.length} item${lineItems.length > 1 ? 's' : ''}`, 'success');
    close(); renderSales(body, header);
  };
}

// ============================================
// EDIT SALE MODAL (admin only, reads from sale_items)
// ============================================
function openEditSaleModal(sale, saleItems, parties, products, body, header) {
  const party = parties.find(p => p.id === sale.party_id);
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

  const itemsHtml = saleItems.length > 0 ? `<table class="data-table" style="font-size:0.85rem;margin-bottom:12px;"><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${saleItems.map(si => {
    const p = prodMap[si.product_id];
    return `<tr><td>${esc(p?.name || '?')}</td><td>${p?.type === 'liquid' ? formatWeight(si.quantity) : si.quantity + ' pcs'}</td><td>${formatCurrency(si.unit_price)}</td><td style="font-weight:600;color:var(--green);">${formatCurrency(si.line_total)}</td></tr>`;
  }).join('')}</tbody></table>` : '<p style="color:var(--text-muted);">No items (legacy sale)</p>';

  const content = `
    <div style="background:var(--bg-secondary);border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <strong>${esc(party?.name || 'Walk-in')}</strong>
      <div style="font-size:0.8rem;color:var(--text-muted);">Sale Date: ${formatDate(sale.sale_date || sale.created_at)} · Total: ${formatCurrency(sale.total_amount)}</div>
    </div>
    <div style="margin-bottom:16px;"><strong style="font-size:0.85rem;">Items</strong>${itemsHtml}</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Sale Date *</label><input class="form-input" type="date" id="edit-sale-date" value="${sale.sale_date || ''}" required /></div>
      <div class="form-group"><label class="form-label">Grand Total (₹)</label><input class="form-input" type="number" id="edit-sale-total" value="${sale.total_amount}" min="0" step="0.01" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Payment Status</label>
        <select class="form-select" id="edit-sale-payment">
          <option value="paid" ${sale.payment_status === 'paid' ? 'selected' : ''}>Paid</option>
          <option value="partial" ${sale.payment_status === 'partial' ? 'selected' : ''}>Partial</option>
          <option value="pending" ${sale.payment_status === 'pending' ? 'selected' : ''}>Pending</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Payment Method</label>
        <select class="form-select" id="edit-sale-method">
          <option value="">— Select —</option>
          <option value="cash" ${sale.payment_method === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="upi" ${sale.payment_method === 'upi' ? 'selected' : ''}>UPI / Online</option>
          <option value="bank_transfer" ${sale.payment_method === 'bank_transfer' ? 'selected' : ''}>Bank Transfer</option>
          <option value="cheque" ${sale.payment_method === 'cheque' ? 'selected' : ''}>Cheque</option>
        </select>
      </div>
    </div>
    <div class="form-row" id="edit-pending-fields" style="display:${sale.payment_status === 'pending' || sale.payment_status === 'partial' ? 'flex' : 'none'};">
      <div class="form-group"><label class="form-label">Amount Received (₹)</label><input class="form-input" type="number" id="edit-sale-received" value="${sale.amount_received || 0}" min="0" step="0.01" /></div>
      <div class="form-group"><label class="form-label">Expected Payment Date</label><input class="form-input" type="date" id="edit-sale-expected" value="${sale.expected_payment_date || ''}" /></div>
    </div>
    <div class="form-group"><label class="form-label">Notes</label><textarea class="form-textarea" id="edit-sale-notes" maxlength="500">${esc(sale.notes || '')}</textarea></div>
  `;

  const footer = `<button class="btn btn-danger" id="edit-sale-delete"><i class="fas fa-trash"></i> Delete</button><div style="flex:1;"></div><button class="btn btn-secondary" id="edit-sale-cancel">Cancel</button><button class="btn btn-primary" id="edit-sale-save"><i class="fas fa-save"></i> Update Sale</button>`;
  const { close } = createModal('Edit Sale', content, { footer });

  document.getElementById('edit-sale-payment').addEventListener('change', (e) => {
    document.getElementById('edit-pending-fields').style.display = (e.target.value === 'pending' || e.target.value === 'partial') ? 'flex' : 'none';
  });
  document.getElementById('edit-sale-cancel').onclick = close;

  document.getElementById('edit-sale-save').onclick = async () => {
    const totalAmount = parseFloat(document.getElementById('edit-sale-total').value) || 0;
    const paymentStatus = document.getElementById('edit-sale-payment').value;
    const paymentMethod = document.getElementById('edit-sale-method').value || null;
    const amountReceived = paymentStatus === 'paid' ? totalAmount : parseFloat(document.getElementById('edit-sale-received').value) || 0;

    await dbOp(db.update('sales', sale.id, {
      total_amount: totalAmount, payment_status: paymentStatus, payment_method: paymentMethod,
      amount_received: amountReceived,
      expected_payment_date: document.getElementById('edit-sale-expected')?.value || null,
      sale_date: document.getElementById('edit-sale-date').value,
      notes: document.getElementById('edit-sale-notes').value.trim()
    }), 'Failed to update sale');
    showToast('Sale updated', 'success'); close(); renderSales(body, header);
  };

  document.getElementById('edit-sale-delete').onclick = async () => {
    if (!confirm('Delete this sale? Stock will be restored for all items.')) return;
    // Atomic delete_sale: restores stock for every line item, logs txns,
    // cascades sale_items, deletes the sale row — all in one transaction.
    const result = await dbOp(db.rpc('delete_sale', {
      p_sale_id: sale.id,
      p_performer_id: auth.currentUser.id,
    }), 'Failed to delete sale');
    if (!result) return;
    showToast('Sale deleted — stock restored', 'success'); close(); renderSales(body, header);
  };
}

