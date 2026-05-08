import { db, auth } from '../supabase.js';
import { formatDate, showToast, createModal, esc, dbOp } from '../utils/helpers.js';

export async function renderInstallations(body, header) {
  if (!auth.isAdmin()) { body.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3></div>'; return; }

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Installations</h1>
      <div class="page-header-subtitle">Track machines deployed at party locations</div>
    </div>
    <button class="btn btn-primary" id="btn-add-install"><i class="fas fa-plus"></i> Add Installation</button>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  const { data: installations } = await db.getAll('installations', { orderBy: ['installation_date', 'desc'] });
  const { data: parties } = await db.getAll('parties');
  const { data: products } = await db.getAll('products');
  const { data: categories } = await db.getAll('categories');
  const partyMap = Object.fromEntries(parties.map(p => [p.id, p]));
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

  // Only machine products (dispensers/diffusers, not oils/refills)
  const machineCatIds = categories
    .filter(c => /dispenser|diffuser/i.test(c.name) && !/oil|refill/i.test(c.name))
    .map(c => c.id);
  const machineProducts = products.filter(p => p.is_active && machineCatIds.includes(p.category_id));

  // Unique parties and products that appear in installations
  const usedPartyIds = [...new Set(installations.map(i => i.party_id))];
  const usedProductIds = [...new Set(installations.map(i => i.product_id))];

  const active = installations.filter(i => i.status === 'active').length;
  const totalMachines = installations.filter(i => i.status === 'active').reduce((sum, i) => sum + (i.quantity || 1), 0);

  body.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fas fa-map-marker-alt"></i></div>
        <div class="stat-info"><div class="stat-label">Active Locations</div><div class="stat-value">${active}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="fas fa-cogs"></i></div>
        <div class="stat-info"><div class="stat-label">Total Machines Deployed</div><div class="stat-value">${totalMachines}</div></div>
      </div>
    </div>

    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <i class="fas fa-filter" style="color:var(--primary);font-size:0.85rem;"></i>
        <strong style="font-size:0.85rem;">Filters & Sorting</strong>
        <button class="btn btn-ghost btn-sm" id="btn-clear-filters" style="margin-left:auto;font-size:0.75rem;"><i class="fas fa-times"></i> Clear All</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">Search</label>
          <div style="position:relative;">
            <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:0.75rem;"></i>
            <input class="form-input" id="filter-search" placeholder="Party, machine..." style="padding:8px 10px 8px 30px;font-size:0.8rem;" />
          </div>
        </div>
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">Party</label>
          <select class="form-select" id="filter-party" style="padding:8px 10px;font-size:0.8rem;">
            <option value="">All Parties</option>
            ${usedPartyIds.map(pid => {
              const p = partyMap[pid];
              return p ? `<option value="${pid}">${esc(p.name)}</option>` : '';
            }).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">Machine</label>
          <select class="form-select" id="filter-machine" style="padding:8px 10px;font-size:0.8rem;">
            <option value="">All Machines</option>
            ${usedProductIds.map(pid => {
              const p = prodMap[pid];
              return p ? `<option value="${pid}">${esc(p.name)}</option>` : '';
            }).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">Status</label>
          <select class="form-select" id="filter-status" style="padding:8px 10px;font-size:0.8rem;">
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="removed">Removed</option>
            <option value="replaced">Replaced</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">From Date</label>
          <input class="form-input" type="date" id="filter-date-from" style="padding:8px 10px;font-size:0.8rem;" />
        </div>
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">To Date</label>
          <input class="form-input" type="date" id="filter-date-to" style="padding:8px 10px;font-size:0.8rem;" />
        </div>
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">Sort By</label>
          <select class="form-select" id="filter-sort" style="padding:8px 10px;font-size:0.8rem;">
            <option value="date_desc">Date: Newest First</option>
            <option value="date_asc">Date: Oldest First</option>
            <option value="party_asc">Party: A → Z</option>
            <option value="party_desc">Party: Z → A</option>
            <option value="machine_asc">Machine: A → Z</option>
            <option value="machine_desc">Machine: Z → A</option>
            <option value="qty_desc">Qty: High → Low</option>
            <option value="qty_asc">Qty: Low → High</option>
          </select>
        </div>
      </div>
    </div>

    <div id="install-results-info" style="font-size:0.8rem;color:var(--text-muted);margin-bottom:10px;"></div>
    <div id="install-table-container"></div>
  `;

  // ---- Client-side filter + sort engine ----
  function applyFilters() {
    const search = (document.getElementById('filter-search').value || '').toLowerCase();
    const partyFilter = document.getElementById('filter-party').value;
    const machineFilter = document.getElementById('filter-machine').value;
    const statusFilter = document.getElementById('filter-status').value;
    const dateFrom = document.getElementById('filter-date-from').value;
    const dateTo = document.getElementById('filter-date-to').value;
    const sortVal = document.getElementById('filter-sort').value;

    let filtered = installations.filter(i => {
      const party = partyMap[i.party_id];
      const prod = prodMap[i.product_id];
      // Search (party name, address, machine name, model, notes)
      if (search) {
        const haystack = [
          party?.name, party?.address, prod?.name, prod?.model_number, i.notes
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (partyFilter && String(i.party_id) !== partyFilter) return false;
      if (machineFilter && String(i.product_id) !== machineFilter) return false;
      if (statusFilter && i.status !== statusFilter) return false;
      if (dateFrom && i.installation_date < dateFrom) return false;
      if (dateTo && i.installation_date > dateTo) return false;
      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      const pA = partyMap[a.party_id]?.name || '';
      const pB = partyMap[b.party_id]?.name || '';
      const mA = prodMap[a.product_id]?.name || '';
      const mB = prodMap[b.product_id]?.name || '';
      switch (sortVal) {
        case 'date_desc': return (b.installation_date || '').localeCompare(a.installation_date || '');
        case 'date_asc': return (a.installation_date || '').localeCompare(b.installation_date || '');
        case 'party_asc': return pA.localeCompare(pB);
        case 'party_desc': return pB.localeCompare(pA);
        case 'machine_asc': return mA.localeCompare(mB);
        case 'machine_desc': return mB.localeCompare(mA);
        case 'qty_desc': return (b.quantity || 1) - (a.quantity || 1);
        case 'qty_asc': return (a.quantity || 1) - (b.quantity || 1);
        default: return 0;
      }
    });

    // Results info
    const info = document.getElementById('install-results-info');
    if (filtered.length === installations.length) {
      info.textContent = `Showing all ${installations.length} installations`;
    } else {
      info.textContent = `Showing ${filtered.length} of ${installations.length} installations`;
    }

    // Render table
    const container = document.getElementById('install-table-container');
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><h3>No installations match</h3><p>Try changing your filters.</p></div>';
      return;
    }
    container.innerHTML = `
      <div class="table-wrapper"><table class="data-table">
        <thead><tr><th>Party / Location</th><th>Machine</th><th>Model</th><th>Qty</th><th>Installed On</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${filtered.map(i => {
          const party = partyMap[i.party_id];
          const prod = prodMap[i.product_id];
          return `<tr>
            <td><strong>${esc(party?.name || 'Unknown')}</strong>${party?.address ? `<br><small style="color:var(--text-muted);"><i class="fas fa-map-marker-alt" style="font-size:0.6rem;"></i> ${esc(party.address)}</small>` : ''}</td>
            <td>${esc(prod?.name || 'Unknown')}</td>
            <td style="color:var(--text-muted);font-size:0.8rem;">${esc(prod?.model_number || '—')}</td>
            <td style="font-weight:700;font-size:1.1rem;">${i.quantity || 1}</td>
            <td>${formatDate(i.installation_date)}</td>
            <td><span class="badge-status ${i.status === 'active' ? 'green' : i.status === 'removed' ? 'red' : 'amber'}">${i.status === 'active' ? 'Active' : i.status === 'removed' ? 'Removed' : 'Replaced'}</span></td>
            <td>
              ${i.status === 'active' ? `<button class="btn btn-sm btn-ghost edit-install" data-id="${i.id}"><i class="fas fa-pen"></i></button>
              <button class="btn btn-sm btn-ghost remove-install" data-id="${i.id}" style="color:var(--red);"><i class="fas fa-times"></i></button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    `;

    // Re-bind action buttons
    container.querySelectorAll('.edit-install').forEach(el => {
      el.addEventListener('click', () => {
        const inst = installations.find(i => i.id == el.dataset.id);
        if (inst) openInstallModal(inst, parties, machineProducts, body, header);
      });
    });
    container.querySelectorAll('.remove-install').forEach(el => {
      el.addEventListener('click', async () => {
        if (!confirm('Mark this installation as removed?')) return;
        await dbOp(db.update('installations', parseInt(el.dataset.id), { status: 'removed', removed_date: new Date().toISOString().split('T')[0] }), 'Failed to update');
        showToast('Installation marked as removed', 'success');
        renderInstallations(body, header);
      });
    });
  }

  // Bind filter/sort events
  ['filter-search', 'filter-party', 'filter-machine', 'filter-status', 'filter-date-from', 'filter-date-to', 'filter-sort'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener(el.tagName === 'INPUT' && el.type === 'text' ? 'input' : 'change', applyFilters);
  });
  // Search also triggers on input for type="text" — handle the search input specifically
  document.getElementById('filter-search').addEventListener('input', applyFilters);

  // Clear all filters
  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-party').value = '';
    document.getElementById('filter-machine').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    document.getElementById('filter-sort').value = 'date_desc';
    applyFilters();
  });

  // Add installation button
  document.getElementById('btn-add-install').addEventListener('click', () => openInstallModal(null, parties, machineProducts, body, header));

  // Initial render
  applyFilters();
}

function openInstallModal(inst, parties, machineProducts, body, header) {
  const isEdit = !!inst;
  const content = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Party / Location *</label>
        <select class="form-select" id="inst-party">
          <option value="">— Select Party —</option>
          ${parties.map(p => `<option value="${p.id}" ${inst?.party_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Machine *</label>
        <select class="form-select" id="inst-product">
          <option value="">— Select Machine —</option>
          ${machineProducts.map(p => `<option value="${p.id}" ${inst?.product_id === p.id ? 'selected' : ''}>${esc(p.name)}${p.model_number ? ` (${esc(p.model_number)})` : ''}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Quantity *</label>
        <input class="form-input" type="number" id="inst-qty" value="${inst?.quantity || 1}" min="1" max="100" step="1" />
      </div>
      <div class="form-group">
        <label class="form-label">Installation Date *</label>
        <input class="form-input" type="date" id="inst-date" value="${inst?.installation_date || new Date().toISOString().split('T')[0]}" required />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="inst-notes" maxlength="500" placeholder="Serial numbers, location details...">${esc(inst?.notes || '')}</textarea>
    </div>
  `;
  const footer = `<button class="btn btn-secondary" id="inst-cancel">Cancel</button><button class="btn btn-primary" id="inst-save"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Add'} Installation</button>`;
  const { close } = createModal(isEdit ? 'Edit Installation' : 'Add Installation', content, { footer });

  document.getElementById('inst-cancel').onclick = close;
  document.getElementById('inst-save').onclick = async () => {
    const partyId = parseInt(document.getElementById('inst-party').value);
    const productId = parseInt(document.getElementById('inst-product').value);
    const qty = parseInt(document.getElementById('inst-qty').value) || 1;
    const date = document.getElementById('inst-date').value;

    if (!partyId || !productId || !date) { showToast('Please fill all required fields', 'error'); return; }

    const record = {
      party_id: partyId,
      product_id: productId,
      quantity: qty,
      installation_date: date,
      status: 'active',
      notes: document.getElementById('inst-notes').value.trim()
    };

    const result = isEdit
      ? await dbOp(db.update('installations', inst.id, record), 'Failed to update')
      : await dbOp(db.insert('installations', record), 'Failed to add installation');
    if (!result) return;

    showToast(isEdit ? 'Installation updated' : 'Installation recorded', 'success');
    close();
    renderInstallations(body, header);
  };
}
