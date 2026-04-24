import { db, auth } from '../supabase.js';
import { formatDate, showToast, createModal } from '../utils/helpers.js';

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

export async function renderParties(body, header) {
  if (!auth.isAdmin()) { body.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3></div>'; return; }

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Parties</h1>
      <div class="page-header-subtitle">Customer & client directory</div>
    </div>
    <button class="btn btn-primary" id="btn-add-party"><i class="fas fa-plus"></i> Add Party</button>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  const { data: parties } = await db.getAll('parties', { orderBy: ['created_at', 'desc'] });
  const { data: sales } = await db.getAll('sales');

  body.innerHTML = parties.length === 0 ? '<div class="empty-state"><i class="fas fa-users"></i><h3>No parties yet</h3><p>Add your first customer or client.</p></div>' : `
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Name</th><th>Phone</th><th>Address</th><th>Total Sales</th><th>Added</th><th>Actions</th></tr></thead>
      <tbody>${parties.map(p => {
        const partySales = sales.filter(s => s.party_id === p.id);
        const totalRev = partySales.reduce((sum, s) => sum + (s.total_amount || 0), 0);
        return `<tr>
          <td><strong>${esc(p.name)}</strong>${p.notes ? `<br><small style="color:var(--text-muted);">${esc(p.notes)}</small>` : ''}</td>
          <td>${esc(p.phone || '—')}</td>
          <td>${esc(p.address || '—')}</td>
          <td style="font-weight:600;">₹${totalRev.toLocaleString('en-IN')} (${partySales.length})</td>
          <td>${formatDate(p.created_at)}</td>
          <td><button class="btn btn-sm btn-ghost edit-party-btn" data-id="${p.id}"><i class="fas fa-pen"></i></button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  `;

  document.getElementById('btn-add-party').addEventListener('click', () => openPartyModal(null, body, header));
  body.querySelectorAll('.edit-party-btn').forEach(el => {
    el.addEventListener('click', () => openPartyModal(parties.find(p => p.id == el.dataset.id), body, header));
  });
}

function openPartyModal(party, body, header) {
  const isEdit = !!party;
  const content = `
    <div class="form-group">
      <label class="form-label">Party Name *</label>
      <input class="form-input" id="party-name" value="${esc(party?.name || '')}" required maxlength="200" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Phone</label>
        <input class="form-input" id="party-phone" value="${esc(party?.phone || '')}" maxlength="15" />
      </div>
      <div class="form-group">
        <label class="form-label">Address</label>
        <input class="form-input" id="party-address" value="${esc(party?.address || '')}" maxlength="300" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="party-notes" maxlength="500">${esc(party?.notes || '')}</textarea>
    </div>
  `;
  const footer = `<button class="btn btn-secondary" id="party-cancel">Cancel</button><button class="btn btn-primary" id="party-save"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Create'}</button>`;
  const { close } = createModal(isEdit ? 'Edit Party' : 'Add Party', content, { footer });

  document.getElementById('party-cancel').onclick = close;
  document.getElementById('party-save').onclick = async () => {
    const name = document.getElementById('party-name').value.trim();
    if (!name || name.length < 2) { showToast('Name is required', 'error'); return; }
    const record = {
      name,
      phone: document.getElementById('party-phone').value.trim(),
      address: document.getElementById('party-address').value.trim(),
      notes: document.getElementById('party-notes').value.trim()
    };
    if (isEdit) { await db.update('parties', party.id, record); showToast('Party updated', 'success'); }
    else { await db.insert('parties', record); showToast('Party added', 'success'); }
    close();
    renderParties(body, header);
  };
}
