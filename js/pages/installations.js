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
    ${installations.length === 0 ? '<div class="empty-state"><i class="fas fa-tools"></i><h3>No installations yet</h3><p>Click "Add Installation" to record a machine deployment.</p></div>' : `
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Party / Location</th><th>Machine</th><th>Model</th><th>Qty</th><th>Installed On</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${installations.map(i => {
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
    </table></div>`}
  `;

  document.getElementById('btn-add-install').addEventListener('click', () => openInstallModal(null, parties, machineProducts, body, header));
  body.querySelectorAll('.edit-install').forEach(el => {
    el.addEventListener('click', () => {
      const inst = installations.find(i => i.id == el.dataset.id);
      if (inst) openInstallModal(inst, parties, machineProducts, body, header);
    });
  });
  body.querySelectorAll('.remove-install').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('Mark this installation as removed?')) return;
      await dbOp(db.update('installations', parseInt(el.dataset.id), { status: 'removed', removed_date: new Date().toISOString().split('T')[0] }), 'Failed to update');
      showToast('Installation marked as removed', 'success');
      renderInstallations(body, header);
    });
  });
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
