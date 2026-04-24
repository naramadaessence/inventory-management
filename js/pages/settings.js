import { db, auth } from '../supabase.js';
import { showToast, createModal } from '../utils/helpers.js';

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

export async function renderSettings(body, header) {
  if (!auth.isAdmin()) { body.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3></div>'; return; }

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Settings</h1>
      <div class="page-header-subtitle">Manage users, categories & system configuration</div>
    </div>
    <div></div>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  body.innerHTML = `
    <div class="tabs">
      <button class="tab-btn active" data-tab="users">Users</button>
      <button class="tab-btn" data-tab="categories">Categories</button>
      <button class="tab-btn" data-tab="stock">Stock Intake</button>
    </div>
    <div id="settings-content"></div>
  `;

  let activeTab = 'users';

  body.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      loadTab();
    });
  });

  async function loadTab() {
    const container = document.getElementById('settings-content');
    if (activeTab === 'users') await renderUsersTab(container, body);
    else if (activeTab === 'categories') await renderCategoriesTab(container, body);
    else if (activeTab === 'stock') await renderStockIntakeTab(container, body);
  }

  loadTab();
}

async function renderUsersTab(container, body) {
  const { data: profiles } = await db.getAll('profiles');

  container.innerHTML = `
    <div class="toolbar">
      <div></div>
      <button class="btn btn-primary" id="btn-add-user"><i class="fas fa-plus"></i> Add User</button>
    </div>
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${profiles.map(p => `<tr>
        <td><strong>${esc(p.full_name)}</strong></td>
        <td>${esc(p.email)}</td>
        <td><span class="badge-status ${p.role === 'admin' ? 'amber' : 'blue'}">${p.role}</span></td>
        <td>${esc(p.phone || '—')}</td>
        <td><span class="badge-status ${p.is_active ? 'green' : 'red'}">${p.is_active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <button class="btn btn-sm btn-ghost edit-user-btn" data-id="${p.id}"><i class="fas fa-pen"></i></button>
          ${p.id !== auth.currentUser.id ? `<button class="btn btn-sm btn-ghost toggle-user-btn" data-id="${p.id}" data-active="${p.is_active}"><i class="fas ${p.is_active ? 'fa-ban' : 'fa-check'}"></i></button>` : ''}
        </td>
      </tr>`).join('')}</tbody>
    </table></div>
  `;

  document.getElementById('btn-add-user').addEventListener('click', () => openUserModal(null, container, body));
  container.querySelectorAll('.edit-user-btn').forEach(el => {
    el.addEventListener('click', () => openUserModal(profiles.find(p => p.id === el.dataset.id), container, body));
  });
  container.querySelectorAll('.toggle-user-btn').forEach(el => {
    el.addEventListener('click', async () => {
      const isActive = el.dataset.active === 'true';
      await db.update('profiles', el.dataset.id, { is_active: !isActive });
      showToast(`User ${isActive ? 'deactivated' : 'activated'}`, isActive ? 'warning' : 'success');
      renderUsersTab(container, body);
    });
  });
}

function openUserModal(user, container, body) {
  const isEdit = !!user;
  const content = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Full Name *</label>
        <input class="form-input" id="user-name" value="${esc(user?.full_name || '')}" maxlength="100" required />
      </div>
      <div class="form-group">
        <label class="form-label">Email *</label>
        <input class="form-input" type="email" id="user-email" value="${esc(user?.email || '')}" maxlength="254" required ${isEdit ? 'readonly' : ''} />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Role *</label>
        <select class="form-select" id="user-role">
          <option value="seller" ${user?.role === 'seller' ? 'selected' : ''}>Seller</option>
          <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Phone</label>
        <input class="form-input" id="user-phone" value="${esc(user?.phone || '')}" maxlength="15" />
      </div>
    </div>
    ${!isEdit ? `<div class="form-group">
      <label class="form-label">Password *</label>
      <input class="form-input" type="password" id="user-password" minlength="6" maxlength="128" required placeholder="Min 6 characters" />
    </div>` : ''}
  `;
  const footer = `<button class="btn btn-secondary" id="user-cancel">Cancel</button><button class="btn btn-primary" id="user-save"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Create'}</button>`;
  const { close } = createModal(isEdit ? 'Edit User' : 'Add User', content, { footer });

  document.getElementById('user-cancel').onclick = close;
  document.getElementById('user-save').onclick = async () => {
    const name = document.getElementById('user-name').value.trim();
    const email = document.getElementById('user-email').value.trim().toLowerCase();
    const role = document.getElementById('user-role').value;
    const phone = document.getElementById('user-phone').value.trim();

    if (!name || name.length < 2) { showToast('Name is required', 'error'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Valid email is required', 'error'); return; }

    const record = { full_name: name, email, role, phone, is_active: true };
    if (isEdit) {
      await db.update('profiles', user.id, record);
      showToast('User updated', 'success');
    } else {
      const password = document.getElementById('user-password').value;
      if (!password || password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
      record.id = 'user-' + Date.now();
      await db.insert('profiles', record);
      showToast('User created (demo mode — use seller123 to login)', 'success');
    }
    close();
    renderUsersTab(container, body);
  };
}

async function renderCategoriesTab(container, body) {
  const { data: categories } = await db.getAll('categories');

  container.innerHTML = `
    <div class="toolbar">
      <div></div>
      <button class="btn btn-primary" id="btn-add-cat"><i class="fas fa-plus"></i> Add Category</button>
    </div>
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Name</th><th>Type</th><th>Actions</th></tr></thead>
      <tbody>${categories.map(c => `<tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td><span class="badge-status ${c.type === 'liquid' ? 'purple' : 'blue'}">${c.type}</span></td>
        <td><button class="btn btn-sm btn-ghost edit-cat-btn" data-id="${c.id}"><i class="fas fa-pen"></i></button></td>
      </tr>`).join('')}</tbody>
    </table></div>
  `;

  document.getElementById('btn-add-cat').addEventListener('click', () => {
    const content = `
      <div class="form-group"><label class="form-label">Category Name *</label><input class="form-input" id="cat-name" maxlength="100" required /></div>
      <div class="form-group"><label class="form-label">Tracking Type *</label>
        <select class="form-select" id="cat-type"><option value="unit">Unit (pieces)</option><option value="liquid">Liquid (grams)</option></select>
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="cat-cancel">Cancel</button><button class="btn btn-primary" id="cat-save"><i class="fas fa-save"></i> Create</button>`;
    const { close } = createModal('Add Category', content, { footer });
    document.getElementById('cat-cancel').onclick = close;
    document.getElementById('cat-save').onclick = async () => {
      const name = document.getElementById('cat-name').value.trim();
      if (!name) { showToast('Name required', 'error'); return; }
      await db.insert('categories', { name, type: document.getElementById('cat-type').value });
      showToast('Category added', 'success');
      close();
      renderCategoriesTab(container, body);
    };
  });

  container.querySelectorAll('.edit-cat-btn').forEach(el => {
    el.addEventListener('click', () => {
      const cat = categories.find(c => c.id == el.dataset.id);
      const content = `
        <div class="form-group"><label class="form-label">Category Name *</label><input class="form-input" id="cat-name" value="${esc(cat.name)}" maxlength="100" required /></div>
        <div class="form-group"><label class="form-label">Tracking Type</label>
          <select class="form-select" id="cat-type"><option value="unit" ${cat.type === 'unit' ? 'selected' : ''}>Unit</option><option value="liquid" ${cat.type === 'liquid' ? 'selected' : ''}>Liquid</option></select>
        </div>
      `;
      const footer = `<button class="btn btn-secondary" id="cat-cancel">Cancel</button><button class="btn btn-primary" id="cat-save"><i class="fas fa-save"></i> Update</button>`;
      const { close } = createModal('Edit Category', content, { footer });
      document.getElementById('cat-cancel').onclick = close;
      document.getElementById('cat-save').onclick = async () => {
        const name = document.getElementById('cat-name').value.trim();
        if (!name) { showToast('Name required', 'error'); return; }
        await db.update('categories', cat.id, { name, type: document.getElementById('cat-type').value });
        showToast('Category updated', 'success');
        close();
        renderCategoriesTab(container, body);
      };
    });
  });
}

async function renderStockIntakeTab(container, body) {
  const { data: products } = await db.getAll('products');
  const { data: intakes } = await db.getAll('stock_intakes', { orderBy: ['created_at', 'desc'] });
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
  const activeProducts = products.filter(p => p.is_active);

  container.innerHTML = `
    <div class="toolbar">
      <div></div>
      <button class="btn btn-primary" id="btn-stock-intake"><i class="fas fa-plus"></i> Add Stock</button>
    </div>
    ${intakes.length === 0 ? '<div class="empty-state"><i class="fas fa-truck"></i><h3>No stock intakes yet</h3><p>Record new inventory arrivals here.</p></div>' : `
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Date</th><th>Product</th><th>Quantity Added</th><th>Notes</th></tr></thead>
      <tbody>${intakes.slice(0, 50).map(i => {
        const prod = prodMap[i.product_id];
        return `<tr>
          <td>${new Date(i.created_at).toLocaleDateString('en-IN')}</td>
          <td>${esc(prod?.name || 'Unknown')}</td>
          <td style="color:var(--green);font-weight:700;">+${i.quantity}${prod?.type === 'liquid' ? 'g' : ' pcs'}</td>
          <td>${esc(i.notes || '—')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`}
  `;

  document.getElementById('btn-stock-intake').addEventListener('click', () => {
    const content = `
      <div class="form-group">
        <label class="form-label">Product *</label>
        <select class="form-select" id="intake-product">${activeProducts.map(p => `<option value="${p.id}">${esc(p.name)} (current: ${p.current_stock})</option>`).join('')}</select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Quantity to Add *</label>
          <input class="form-input" type="number" id="intake-qty" min="0.1" required />
        </div>
        <div class="form-group">
          <label class="form-label">Supplier / Batch</label>
          <input class="form-input" id="intake-supplier" maxlength="200" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-textarea" id="intake-notes" maxlength="500"></textarea>
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="intake-cancel">Cancel</button><button class="btn btn-primary" id="intake-save"><i class="fas fa-plus"></i> Add Stock</button>`;
    const { close } = createModal('Stock Intake', content, { footer });

    document.getElementById('intake-cancel').onclick = close;
    document.getElementById('intake-save').onclick = async () => {
      const productId = parseInt(document.getElementById('intake-product').value);
      const qty = parseFloat(document.getElementById('intake-qty').value);
      if (isNaN(qty) || qty <= 0) { showToast('Valid quantity required', 'error'); return; }

      const prod = products.find(p => p.id === productId);
      await db.insert('stock_intakes', {
        product_id: productId,
        quantity: qty,
        supplier: document.getElementById('intake-supplier').value.trim(),
        notes: document.getElementById('intake-notes').value.trim(),
        received_by: auth.currentUser.id
      });
      await db.update('products', productId, { current_stock: (prod.current_stock || 0) + qty });
      await db.insert('inventory_transactions', { product_id: productId, type: 'stock_in', quantity: qty, reference_type: 'stock_intake', performed_by: auth.currentUser.id, notes: 'Stock intake' });

      showToast('Stock added successfully', 'success');
      close();
      renderStockIntakeTab(container, body);
    };
  });
}
