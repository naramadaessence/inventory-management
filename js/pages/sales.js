import { db, auth } from '../supabase.js';
import { formatCurrency, formatDateTime, formatDate, showToast, createModal } from '../utils/helpers.js';

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

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

  body.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon green"><i class="fas fa-indian-rupee-sign"></i></div>
        <div class="stat-info">
          <div class="stat-label">Total Revenue</div>
          <div class="stat-value">${formatCurrency(sales.reduce((s, r) => s + (r.total_amount || 0), 0))}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fas fa-receipt"></i></div>
        <div class="stat-info">
          <div class="stat-label">Total Transactions</div>
          <div class="stat-value">${sales.length}</div>
        </div>
      </div>
    </div>
    ${sales.length === 0 ? '<div class="empty-state"><i class="fas fa-receipt"></i><h3>No sales recorded</h3><p>Click "Record Sale" to add your first sale.</p></div>' : `
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Date</th><th>Party</th><th>Product</th><th>Qty</th><th>Amount</th><th>Payment</th></tr></thead>
      <tbody>${sales.map(s => {
        const party = partyMap[s.party_id];
        const prod = prodMap[s.product_id];
        return `<tr>
          <td>${formatDate(s.sale_date || s.created_at)}</td>
          <td><strong>${esc(party?.name || 'Walk-in')}</strong></td>
          <td>${esc(prod?.name || 'Unknown')}</td>
          <td>${s.quantity}${prod?.type === 'liquid' ? 'g' : ' pcs'}</td>
          <td style="font-weight:600;color:var(--green);">${formatCurrency(s.total_amount)}</td>
          <td><span class="badge-status ${s.payment_status === 'paid' ? 'green' : s.payment_status === 'partial' ? 'amber' : 'red'}">${esc(s.payment_status || 'pending')}</span></td>
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
      <div class="form-group">
        <label class="form-label">Party / Customer *</label>
        <select class="form-select" id="sale-party">
          <option value="">Walk-in customer</option>
          ${parties.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
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
          ${activeProducts.map(p => `<option value="${p.id}" data-price="${p.unit_price}" data-type="${p.type}">${esc(p.name)} (₹${p.unit_price}${p.type === 'liquid' ? '/g' : '/pc'})</option>`).join('')}
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
    <div class="form-group">
      <label class="form-label">Payment Status</label>
      <select class="form-select" id="sale-payment">
        <option value="paid">Paid</option>
        <option value="partial">Partial</option>
        <option value="pending">Pending</option>
      </select>
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

  document.getElementById('sale-product').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    document.getElementById('sale-price').value = opt.dataset.price;
    document.getElementById('sale-qty').step = opt.dataset.type === 'liquid' ? '0.1' : '1';
    updateTotal();
  });
  document.getElementById('sale-qty').addEventListener('input', updateTotal);
  document.getElementById('sale-price').addEventListener('input', updateTotal);
  updateTotal();

  document.getElementById('sale-cancel').onclick = close;
  document.getElementById('sale-save').onclick = async () => {
    const productId = parseInt(document.getElementById('sale-product').value);
    const qty = parseFloat(document.getElementById('sale-qty').value);
    const price = parseFloat(document.getElementById('sale-price').value);
    const partyId = document.getElementById('sale-party').value ? parseInt(document.getElementById('sale-party').value) : null;

    if (!productId || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
      showToast('Please fill in all required fields with valid values', 'error');
      return;
    }

    const prod = products.find(p => p.id === productId);
    if (qty > prod.current_stock) { showToast('Insufficient stock', 'error'); return; }

    await db.insert('sales', {
      party_id: partyId,
      product_id: productId,
      quantity: qty,
      unit_price: price,
      total_amount: qty * price,
      payment_status: document.getElementById('sale-payment').value,
      sale_date: document.getElementById('sale-date').value,
      notes: document.getElementById('sale-notes').value.trim(),
      recorded_by: auth.currentUser.id
    });

    await db.update('products', productId, { current_stock: prod.current_stock - qty });
    await db.insert('inventory_transactions', {
      product_id: productId,
      type: 'sale',
      quantity: -qty,
      reference_type: 'sale',
      performed_by: auth.currentUser.id,
      notes: `Sale to ${partyId ? 'party' : 'walk-in'}`
    });

    showToast('Sale recorded', 'success');
    close();
    renderSales(body, header);
  };
}
