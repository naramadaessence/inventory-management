import { db, auth } from '../supabase.js';
import { formatCurrency, formatDateTime, formatDate, showToast, createModal, daysUntil, esc, dbOp } from '../utils/helpers.js';

export async function renderSales(body, header) {
  if (!auth.isAdmin()) { body.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3></div>'; return; }

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Sales</h1>
      <div class="page-header-subtitle">Record and track sales to parties</div>
    </div>
    <button class="btn btn-primary" id="btn-new-sale"><i class="fas fa-plus"></i> Record Sale</button>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  const { data: sales } = await db.getAll('sales', { orderBy: ['created_at', 'desc'] });
  const { data: parties } = await db.getAll('parties');
  const { data: products } = await db.getAll('products');
  const partyMap = Object.fromEntries(parties.map(p => [p.id, p]));
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

  const totalRevenue = sales.reduce((s, r) => s + (r.total_amount || 0), 0);
  const totalReceived = sales.reduce((s, r) => s + (r.amount_received || 0), 0);
  const totalPending = totalRevenue - totalReceived;

  body.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon green"><i class="fas fa-indian-rupee-sign"></i></div>
        <div class="stat-info">
          <div class="stat-label">Total Revenue</div>
          <div class="stat-value">${formatCurrency(totalRevenue)}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fas fa-receipt"></i></div>
        <div class="stat-info">
          <div class="stat-label">Total Transactions</div>
          <div class="stat-value">${sales.length}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon amber"><i class="fas fa-clock"></i></div>
        <div class="stat-info">
          <div class="stat-label">Pending Amount</div>
          <div class="stat-value">${formatCurrency(totalPending)}</div>
        </div>
      </div>
    </div>
    ${sales.length === 0 ? '<div class="empty-state"><i class="fas fa-receipt"></i><h3>No sales recorded</h3><p>Click "Record Sale" to add your first sale.</p></div>' : `
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Date</th><th>Party</th><th>Product</th><th>Qty</th><th>Amount</th><th>Received</th><th>Payment</th><th>Due Date</th></tr></thead>
      <tbody>${sales.map(s => {
        const party = partyMap[s.party_id];
        const prod = prodMap[s.product_id];
        const balance = (s.total_amount || 0) - (s.amount_received || 0);
        const isOverdue = s.expected_payment_date && s.payment_status !== 'paid' && daysUntil(s.expected_payment_date) < 0;
        return `<tr>
          <td>${formatDate(s.sale_date || s.created_at)}</td>
          <td><strong>${esc(party?.name || 'Walk-in')}</strong></td>
          <td>${esc(prod?.name || 'Unknown')}</td>
          <td>${s.quantity}${prod?.type === 'liquid' ? 'g' : ' pcs'}</td>
          <td style="font-weight:600;color:var(--green);">${formatCurrency(s.total_amount)}</td>
          <td>${s.amount_received ? formatCurrency(s.amount_received) : '—'}</td>
          <td><span class="badge-status ${s.payment_status === 'paid' ? 'green' : s.payment_status === 'partial' ? 'amber' : 'red'}">${esc(s.payment_status || 'pending')}</span></td>
          <td style="${isOverdue ? 'color:var(--red);font-weight:600;' : ''}">${s.expected_payment_date ? formatDate(s.expected_payment_date) : '—'}${isOverdue ? ' ⚠' : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`}
  `;

  document.getElementById('btn-new-sale').addEventListener('click', () => openSaleModal(parties, products, body, header));
}

function openSaleModal(parties, products, body, header) {
  const activeProducts = products.filter(p => p.is_active);
  const content = `
    <div class="form-row">
      <div class="form-group" style="position:relative;z-index:50;">
        <label class="form-label">Party / Customer *</label>
        <div style="position:relative;" id="party-combo">
          <input class="form-input" id="sale-party-input" placeholder="Type name or select..." autocomplete="off" />
          <input type="hidden" id="sale-party" value="" />
          <div id="party-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--card);border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius) var(--radius);max-height:200px;overflow-y:auto;z-index:100;box-shadow:var(--shadow-md);">
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
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Product *</label>
        <select class="form-select" id="sale-product">
          ${activeProducts.map(p => `<option value="${p.id}" data-price="${p.unit_price}" data-type="${p.type}" data-catid="${p.category_id}">${esc(p.name)} (₹${p.unit_price}${p.type === 'liquid' ? '/g' : '/pc'})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Quantity *</label>
        <input class="form-input" type="number" id="sale-qty" value="1" min="0.1" step="1" required />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Unit Price (₹)</label>
        <input class="form-input" type="number" id="sale-price" value="${activeProducts[0]?.unit_price || 0}" min="0" step="0.01" />
      </div>
      <div class="form-group">
        <label class="form-label">Total Amount</label>
        <input class="form-input" type="text" id="sale-total" value="₹0" readonly style="font-weight:700;color:var(--green);" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Payment Status</label>
        <select class="form-select" id="sale-payment">
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="pending">Pending</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Payment Method</label>
        <select class="form-select" id="sale-method">
          <option value="">— Select —</option>
          <option value="cash">Cash</option>
          <option value="upi">UPI / Online</option>
          <option value="bank_transfer">Bank Transfer</option>
          <option value="cheque">Cheque</option>
        </select>
      </div>
    </div>
    <div class="form-row" id="pending-fields" style="display:none;">
      <div class="form-group">
        <label class="form-label">Amount Received (₹)</label>
        <input class="form-input" type="number" id="sale-received" value="0" min="0" step="0.01" />
      </div>
      <div class="form-group">
        <label class="form-label">Expected Payment Date</label>
        <input class="form-input" type="date" id="sale-expected-date" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="sale-notes" maxlength="500" placeholder="Additional details..."></textarea>
    </div>
  `;

  const footer = `<button class="btn btn-secondary" id="sale-cancel">Cancel</button><button class="btn btn-primary" id="sale-save"><i class="fas fa-save"></i> Record Sale</button>`;
  const { close } = createModal('Record Sale', content, { footer });

  function updateTotal() {
    const qty = parseFloat(document.getElementById('sale-qty').value) || 0;
    const price = parseFloat(document.getElementById('sale-price').value) || 0;
    document.getElementById('sale-total').value = formatCurrency(qty * price);
  }

  // Party combobox logic
  const partyInput = document.getElementById('sale-party-input');
  const partyHidden = document.getElementById('sale-party');
  const partyDropdown = document.getElementById('party-dropdown');
  const allPartyOpts = partyDropdown.querySelectorAll('.party-opt');
  let selectedCatRates = {};

  partyInput.addEventListener('focus', () => { partyDropdown.style.display = 'block'; filterPartyOpts(); });
  partyInput.addEventListener('input', () => {
    partyHidden.value = '';
    selectedCatRates = {};
    filterPartyOpts();
    applyPrice();
  });
  document.addEventListener('click', (e) => {
    if (!document.getElementById('party-combo')?.contains(e.target)) partyDropdown.style.display = 'none';
  });

  function filterPartyOpts() {
    const term = partyInput.value.toLowerCase().trim();
    allPartyOpts.forEach(opt => {
      const name = opt.textContent.toLowerCase();
      opt.style.display = (!term || name.includes(term)) ? 'block' : 'none';
    });
  }

  allPartyOpts.forEach(opt => {
    opt.addEventListener('mouseenter', () => { opt.style.background = 'var(--primary-soft)'; });
    opt.addEventListener('mouseleave', () => { opt.style.background = ''; });
    opt.addEventListener('click', () => {
      const id = opt.dataset.id;
      partyInput.value = opt.textContent.trim();
      partyHidden.value = id;
      try { selectedCatRates = JSON.parse(opt.dataset.catrates || '{}'); } catch(e) { selectedCatRates = {}; }
      partyDropdown.style.display = 'none';
      applyPrice();
    });
  });

  // Get custom price for selected party + product (by category)
  function getCustomPrice() {
    const prodOpt = document.getElementById('sale-product').selectedOptions[0];
    const catId = prodOpt?.dataset?.catid;
    if (catId && selectedCatRates[catId] !== undefined) return selectedCatRates[catId];
    return null;
  }

  function applyPrice() {
    const customPrice = getCustomPrice();
    const prodOpt = document.getElementById('sale-product').selectedOptions[0];
    const defaultPrice = parseFloat(prodOpt?.dataset?.price) || 0;
    const priceInput = document.getElementById('sale-price');
    priceInput.value = customPrice !== null ? customPrice : defaultPrice;
    if (customPrice !== null) {
      priceInput.style.borderColor = 'var(--primary)';
      priceInput.style.background = 'var(--primary-soft)';
      priceInput.title = 'Custom rate for this party';
    } else {
      priceInput.style.borderColor = '';
      priceInput.style.background = '';
      priceInput.title = '';
    }
    updateTotal();
  }

  // Show/hide pending fields based on payment status
  document.getElementById('sale-payment').addEventListener('change', (e) => {
    const pendingFields = document.getElementById('pending-fields');
    pendingFields.style.display = (e.target.value === 'pending' || e.target.value === 'partial') ? 'flex' : 'none';
  });

  document.getElementById('sale-product').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    document.getElementById('sale-qty').step = opt.dataset.type === 'liquid' ? '0.1' : '1';
    applyPrice();
  });
  document.getElementById('sale-qty').addEventListener('input', updateTotal);
  document.getElementById('sale-price').addEventListener('input', updateTotal);
  applyPrice();

  document.getElementById('sale-cancel').onclick = close;
  document.getElementById('sale-save').onclick = async () => {
    const productId = parseInt(document.getElementById('sale-product').value);
    const qty = parseFloat(document.getElementById('sale-qty').value);
    const price = parseFloat(document.getElementById('sale-price').value);
    const partyId = partyHidden.value ? parseInt(partyHidden.value) : null;
    const partyName = partyInput.value.trim();
    const paymentStatus = document.getElementById('sale-payment').value;
    const paymentMethod = document.getElementById('sale-method').value || null;
    const amountReceived = paymentStatus === 'paid' ? qty * price : parseFloat(document.getElementById('sale-received').value) || 0;
    const expectedDate = document.getElementById('sale-expected-date')?.value || null;

    if (!productId || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
      showToast('Please fill in all required fields with valid values', 'error');
      return;
    }

    const prod = products.find(p => p.id === productId);
    if (qty > prod.current_stock) { showToast('Insufficient stock', 'error'); return; }

    const saleResult = await dbOp(db.insert('sales', {
      party_id: partyId,
      product_id: productId,
      quantity: qty,
      unit_price: price,
      total_amount: qty * price,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      amount_received: amountReceived,
      expected_payment_date: expectedDate,
      sale_date: document.getElementById('sale-date').value,
      notes: document.getElementById('sale-notes').value.trim(),
      recorded_by: auth.currentUser.id
    }), 'Failed to record sale');
    if (!saleResult) return;

    await dbOp(db.update('products', productId, { current_stock: prod.current_stock - qty }), 'Failed to update stock');
    await dbOp(db.insert('inventory_transactions', {
      product_id: productId,
      type: 'sale',
      quantity: -qty,
      reference_type: 'sale',
      performed_by: auth.currentUser.id,
      notes: `Sale to ${partyId ? 'party' : 'walk-in'}`
    }), 'Failed to log transaction');

    showToast('Sale recorded', 'success');
    close();
    renderSales(body, header);
  };
}
