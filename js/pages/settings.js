import { db, auth, supabase } from '../supabase.js';
import { showToast, createModal, esc, formatStock, dbOp, withSaving } from '../utils/helpers.js';

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
      <button class="tab-btn" data-tab="stock-rules">Stock Rules</button>
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
    else if (activeTab === 'stock-rules') await renderStockRulesTab(container);
  }

  loadTab();
}

async function renderUsersTab(container, body) {
  const { data: profiles } = await db.getAll('profiles');

  container.innerHTML = `
    <div class="toolbar">
      <div></div>
      <button class="btn btn-primary" id="btn-add-user"><i class="fas fa-plus"></i> Add Seller</button>
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
      const result = await dbOp(db.update('profiles', el.dataset.id, { is_active: !isActive }), 'Failed to update user status');
      if (!result) return;
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
        <label class="form-label">Phone</label>
        <input class="form-input" id="user-phone" value="${esc(user?.phone || '')}" maxlength="15" />
      </div>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select class="form-select" id="user-role">
          <option value="seller" ${!user || user?.role === 'seller' ? 'selected' : ''}>Seller</option>
          <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
    </div>
    ${!isEdit ? `<div class="form-group">
      <label class="form-label">Password *</label>
      <input class="form-input" type="password" id="user-password" minlength="6" maxlength="128" required placeholder="Min 6 characters" />
    </div>` : ''}
  `;
  const footer = `<button class="btn btn-secondary" id="user-cancel">Cancel</button><button class="btn btn-primary" id="user-save"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Create Account'}</button>`;
  const { close } = createModal(isEdit ? 'Edit User' : 'Create Seller Account', content, { footer });

  document.getElementById('user-cancel').onclick = close;
  document.getElementById('user-save').onclick = (e) => withSaving(e.currentTarget, async () => {
    const name = document.getElementById('user-name').value.trim();
    const email = document.getElementById('user-email').value.trim().toLowerCase();
    const role = document.getElementById('user-role').value;
    const phone = document.getElementById('user-phone').value.trim();

    if (!name || name.length < 2) { showToast('Name is required', 'error'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Valid email is required', 'error'); return; }

    if (isEdit) {
      const result = await dbOp(db.update('profiles', user.id, { full_name: name, role, phone }), 'Failed to update user');
      if (!result) return;
      showToast('User updated', 'success');
    } else {
      const password = document.getElementById('user-password').value;
      if (!password || password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }

      if (db.isDemoMode) {
        // Demo mode: just insert into local store
        const result = await dbOp(db.insert('profiles', { full_name: name, email, role, phone, is_active: true, id: 'user-' + Date.now() }), 'Failed to create user');
        if (!result) return;
        showToast('User created (demo mode)', 'success');
      } else {
        // Production: call the create-user Supabase Edge Function
        try {
          const { data: result, error } = await supabase.functions.invoke('create-user', {
            body: { email, password, full_name: name, phone }
          });
          if (error) {
            let detail = null;
            try { detail = await error.context?.json?.(); } catch { /* non-JSON error body */ }
            showToast(detail?.error || 'Failed to create user', 'error');
            return;
          }
          // Update role if not default seller
          if (role === 'admin') {
            const roleResult = await dbOp(db.update('profiles', result.user_id, { role: 'admin' }), 'Failed to update user role');
            if (!roleResult) return;
          }
          showToast('Seller account created successfully!', 'success');
        } catch (err) {
          showToast('Network error. Please try again.', 'error');
          return;
        }
      }
    }
    close();
    renderUsersTab(container, body);
  });
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
        <select class="form-select" id="cat-type"><option value="unit">Unit (pieces)</option><option value="liquid">Liquid (kg)</option></select>
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="cat-cancel">Cancel</button><button class="btn btn-primary" id="cat-save"><i class="fas fa-save"></i> Create</button>`;
    const { close } = createModal('Add Category', content, { footer });
    document.getElementById('cat-cancel').onclick = close;
    document.getElementById('cat-save').onclick = (e) => withSaving(e.currentTarget, async () => {
      const name = document.getElementById('cat-name').value.trim();
      if (!name) { showToast('Name required', 'error'); return; }
      const result = await dbOp(db.insert('categories', { name, type: document.getElementById('cat-type').value }), 'Failed to add category');
      if (!result) return;
      showToast('Category added', 'success');
      close();
      renderCategoriesTab(container, body);
    });
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
      document.getElementById('cat-save').onclick = (e) => withSaving(e.currentTarget, async () => {
        const name = document.getElementById('cat-name').value.trim();
        if (!name) { showToast('Name required', 'error'); return; }
        const result = await dbOp(db.update('categories', cat.id, { name, type: document.getElementById('cat-type').value }), 'Failed to update category');
        if (!result) return;
        showToast('Category updated', 'success');
        close();
        renderCategoriesTab(container, body);
      });
    });
  });
}

const STOCK_RULES = [
  {
    key: 'liquid_tolerance_kg',
    label: 'Liquid tolerance (kg)',
    unit: 'kg',
    step: '0.001',
    help: 'For oils weighed in kg. 0.010 kg = 10 g.',
  },
  {
    key: 'unit_tolerance',
    label: 'Piece tolerance (pcs)',
    unit: 'pcs',
    step: '1',
    help: 'For machines and refills counted in pieces. 0 means the count must match exactly.',
  },
];

async function renderStockRulesTab(container) {
  container.innerHTML = '<div class="loading-overlay"><div class="spinner" role="status" aria-label="Loading"></div></div>';
  const res = await dbOp(db.getAll('app_settings'), 'Failed to load stock rules');
  if (!res) { container.innerHTML = ''; return; }
  const settings = res.data || [];
  const rows = STOCK_RULES.map(rule => ({ rule, row: settings.find(s => s.key === rule.key) }));

  if (rows.some(r => !r.row)) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-sliders"></i><h3>Stock rules are not set up</h3><p>The app_settings rows are missing. Run migration 016 first.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>Return matching tolerance</h3></div>
      <div class="card-body">
        <p style="margin:0 0 16px;color:var(--text-secondary);">A return counts as matching when |Issued − Returned − Used| is within this amount. Anything beyond it is flagged as a mismatch and an admin must classify it before approving.</p>
        <div class="form-row">
          ${rows.map(({ rule, row }) => `
          <div class="form-group">
            <label class="form-label" for="rule-${rule.key}">${esc(rule.label)}</label>
            <input class="form-input stock-rule-input" type="number" min="0" step="${rule.step}" id="rule-${rule.key}" data-key="${rule.key}" data-id="${esc(String(row.id))}" value="${esc(String(row.value ?? 0))}" />
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${esc(rule.help)}</div>
          </div>`).join('')}
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <button class="btn btn-primary" id="btn-save-stock-rules"><i class="fas fa-save"></i> Save Stock Rules</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-save-stock-rules').onclick = (e) => withSaving(e.currentTarget, async () => {
    const updates = [];
    for (const { rule, row } of rows) {
      const raw = document.getElementById(`rule-${rule.key}`).value.trim();
      const value = Number(raw);
      if (raw === '' || !Number.isFinite(value) || value < 0) {
        showToast(`${rule.label} must be zero or more`, 'error');
        return;
      }
      if (rule.unit === 'pcs' && !Number.isInteger(value)) {
        showToast(`${rule.label} must be a whole number`, 'error');
        return;
      }
      const rounded = rule.unit === 'kg' ? Math.round(value * 1000) / 1000 : value;
      if (rounded !== Number(row.value)) updates.push({ row, value: rounded });
    }
    if (updates.length === 0) { showToast('No changes to save', 'warning'); return; }

    for (const { row, value } of updates) {
      const result = await dbOp(db.update('app_settings', row.id, { value }), 'Failed to save stock rules');
      if (!result) return;
      row.value = value;
    }
    showToast('Stock rules saved', 'success');
    renderStockRulesTab(container);
  });
}
