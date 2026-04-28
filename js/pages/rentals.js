import { db, auth } from '../supabase.js';
import { formatDate, formatDateTime, formatCurrency, showToast, createModal, esc, dbOp } from '../utils/helpers.js';

export async function renderRentals(body, header) {
  if (!auth.isAdmin()) { body.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3></div>'; return; }

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Rentals</h1>
      <div class="page-header-subtitle">Machine & dispenser rental tracking</div>
    </div>
    <button class="btn btn-primary" id="btn-new-rental"><i class="fas fa-plus"></i> New Rental</button>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  const { data: rentals } = await db.getAll('rentals', { orderBy: ['created_at', 'desc'] });
  const { data: parties } = await db.getAll('parties');
  const { data: products } = await db.getAll('products');
  const { data: categories } = await db.getAll('categories');
  const partyMap = Object.fromEntries(parties.map(p => [p.id, p]));
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

  const active = rentals.filter(r => r.status === 'active').length;
  const overdue = rentals.filter(r => r.status === 'active' && r.expected_return_date && new Date(r.expected_return_date) < new Date()).length;

  body.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon purple"><i class="fas fa-handshake"></i></div>
        <div class="stat-info"><div class="stat-label">Active Rentals</div><div class="stat-value">${active}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon ${overdue ? 'red' : 'green'}"><i class="fas ${overdue ? 'fa-clock' : 'fa-check-circle'}"></i></div>
        <div class="stat-info"><div class="stat-label">Overdue</div><div class="stat-value">${overdue}</div></div>
      </div>
    </div>
    ${rentals.length === 0 ? '<div class="empty-state"><i class="fas fa-handshake"></i><h3>No rentals yet</h3></div>' : `
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Product</th><th>Party</th><th>Rented</th><th>Expected Return</th><th>Rent/Month</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rentals.map(r => {
        const prod = prodMap[r.product_id];
        const party = partyMap[r.party_id];
        const isOverdue = r.status === 'active' && r.expected_return_date && new Date(r.expected_return_date) < new Date();
        return `<tr>
          <td><strong>${esc(prod?.name || 'Unknown')}</strong></td>
          <td>${esc(party?.name || 'Unknown')}</td>
          <td>${formatDate(r.rental_date)}</td>
          <td style="${isOverdue ? 'color:var(--red);font-weight:600;' : ''}">${r.expected_return_date ? formatDate(r.expected_return_date) : '—'} ${isOverdue ? '⚠' : ''}</td>
          <td>${formatCurrency(r.rent_amount || 0)}</td>
          <td><span class="badge-status ${r.status === 'returned' ? 'green' : isOverdue ? 'red' : 'amber'}">${r.status === 'returned' ? 'Returned' : isOverdue ? 'Overdue' : 'Active'}</span></td>
          <td>${r.status === 'active' ? `<button class="btn btn-sm btn-secondary return-btn" data-id="${r.id}"><i class="fas fa-undo"></i> Return</button>` : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`}
  `;

  document.getElementById('btn-new-rental').addEventListener('click', () => openRentalModal(parties, products, categories, body, header));
  body.querySelectorAll('.return-btn').forEach(el => {
    el.addEventListener('click', async () => {
      const rental = rentals.find(r => r.id == el.dataset.id);
      if (confirm('Mark this rental as returned?')) {
        await dbOp(db.update('rentals', rental.id, { status: 'returned', actual_return_date: new Date().toISOString() }), 'Failed to update rental');
        const prod = prodMap[rental.product_id];
        if (prod) await dbOp(db.update('products', prod.id, { current_stock: (prod.current_stock || 0) + (rental.quantity || 1) }), 'Failed to update stock');
        await dbOp(db.insert('inventory_transactions', { product_id: rental.product_id, type: 'rental_return', quantity: rental.quantity || 1, reference_type: 'rental', reference_id: rental.id, performed_by: auth.currentUser.id, notes: 'Rental returned' }), 'Failed to log transaction');
        showToast('Rental marked as returned', 'success');
        renderRentals(body, header);
      }
    });
  });
}

function openRentalModal(parties, products, categories, body, header) {
  // Find machine categories by name (Automatic Dispenser, Mini Diffuser, Premium Diffuser)
  const machineCatNames = ['automatic dispenser', 'mini diffuser', 'premium diffuser', 'dispenser', 'diffuser'];
  const machineCatIds = categories
    .filter(c => machineCatNames.some(n => c.name.toLowerCase().includes(n)))
    .map(c => c.id);
  const machines = products.filter(p => p.is_active && machineCatIds.includes(p.category_id));
  const content = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Machine/Dispenser *</label>
        <select class="form-select" id="rent-product">${machines.map(p => `<option value="${p.id}">${esc(p.name)} (stock: ${p.current_stock})</option>`).join('')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Party *</label>
        <select class="form-select" id="rent-party">${parties.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Quantity</label>
        <input class="form-input" type="number" id="rent-qty" value="1" min="1" />
      </div>
      <div class="form-group">
        <label class="form-label">Monthly Rent (₹)</label>
        <input class="form-input" type="number" id="rent-amount" value="0" min="0" step="1" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Rental Date</label>
        <input class="form-input" type="date" id="rent-date" value="${new Date().toISOString().split('T')[0]}" />
      </div>
      <div class="form-group">
        <label class="form-label">Expected Return Date</label>
        <input class="form-input" type="date" id="rent-return" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="rent-notes" maxlength="500"></textarea>
    </div>
  `;
  const footer = `<button class="btn btn-secondary" id="rent-cancel">Cancel</button><button class="btn btn-primary" id="rent-save"><i class="fas fa-save"></i> Create Rental</button>`;
  const { close } = createModal('New Rental', content, { footer });

  document.getElementById('rent-cancel').onclick = close;
  document.getElementById('rent-save').onclick = async () => {
    const productId = parseInt(document.getElementById('rent-product').value);
    const partyId = parseInt(document.getElementById('rent-party').value);
    const qty = parseInt(document.getElementById('rent-qty').value) || 1;
    const prod = products.find(p => p.id === productId);

    if (qty > prod.current_stock) { showToast('Insufficient stock', 'error'); return; }

    const rentalResult = await dbOp(db.insert('rentals', {
      product_id: productId, party_id: partyId, quantity: qty,
      rental_date: document.getElementById('rent-date').value,
      expected_return_date: document.getElementById('rent-return').value || null,
      actual_return_date: null,
      rent_amount: parseFloat(document.getElementById('rent-amount').value) || 0,
      status: 'active',
      notes: document.getElementById('rent-notes').value.trim()
    }), 'Failed to create rental');
    if (!rentalResult) return;
    await dbOp(db.update('products', productId, { current_stock: prod.current_stock - qty }), 'Failed to update stock');
    await dbOp(db.insert('inventory_transactions', { product_id: productId, type: 'rental_out', quantity: -qty, reference_type: 'rental', performed_by: auth.currentUser.id, notes: 'Rental out' }), 'Failed to log transaction');

    showToast('Rental created', 'success');
    close();
    renderRentals(body, header);
  };
}
