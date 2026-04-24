import { db, auth } from '../supabase.js';
import { formatDate, formatCurrency, showToast, createModal } from '../utils/helpers.js';

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

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
  const { data: products } = await db.getAll('products');

  body.innerHTML = parties.length === 0 ? '<div class="empty-state"><i class="fas fa-users"></i><h3>No parties yet</h3><p>Add your first customer or client.</p></div>' : `
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Name</th><th>Phone</th><th>Address</th><th>AMC Rate</th><th>AMC Refill</th><th>Custom Pricing</th><th>Total Sales</th><th>Actions</th></tr></thead>
      <tbody>${parties.map(p => {
        const partySales = sales.filter(s => s.party_id === p.id);
        const totalRev = partySales.reduce((sum, s) => sum + (s.total_amount || 0), 0);
        const today = new Date().getDate();
        const isToday = p.amc_active && p.amc_day === today;
        const customRates = p.custom_product_rates || {};
        const rateCount = Object.keys(customRates).length;
        return `<tr style="${isToday ? 'background:var(--primary-soft);' : ''}">
          <td><strong>${esc(p.name)}</strong>${p.notes ? `<br><small style="color:var(--text-muted);">${esc(p.notes)}</small>` : ''}</td>
          <td>${esc(p.phone || '—')}</td>
          <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;">${esc(p.address || '—')}</td>
          <td style="font-weight:700;color:var(--primary);">${p.amc_rate ? '₹' + Number(p.amc_rate).toLocaleString('en-IN') + '/mo' : '<span style="color:var(--text-muted);">—</span>'}</td>
          <td>${p.amc_active
            ? `<span class="badge-status ${isToday ? 'green' : 'blue'}">${isToday ? '📍 TODAY' : getOrdinal(p.amc_day) + ' of month'}</span>`
            : '<span style="color:var(--text-muted);">—</span>'
          }</td>
          <td>${rateCount > 0
            ? `<span class="badge-status blue">${rateCount} product${rateCount > 1 ? 's' : ''}</span>`
            : '<span style="color:var(--text-muted);">Default</span>'
          }</td>
          <td style="font-weight:600;">₹${totalRev.toLocaleString('en-IN')} (${partySales.length})</td>
          <td><button class="btn btn-sm btn-ghost edit-party-btn" data-id="${p.id}"><i class="fas fa-pen"></i></button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  `;

  document.getElementById('btn-add-party').addEventListener('click', () => openPartyModal(null, body, header, products));
  body.querySelectorAll('.edit-party-btn').forEach(el => {
    el.addEventListener('click', () => openPartyModal(parties.find(p => p.id == el.dataset.id), body, header, products));
  });
}

function openPartyModal(party, body, header, products) {
  const isEdit = !!party;
  const customRates = party?.custom_product_rates || {};

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

    <div style="background:var(--bg-secondary);border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <i class="fas fa-indian-rupee-sign" style="color:var(--primary);"></i>
        <strong style="font-size:0.9rem;">AMC Pricing & Schedule</strong>
      </div>
      <div class="form-group">
        <label class="form-label">Fixed Monthly AMC Rate (₹)</label>
        <input class="form-input" type="number" id="party-amc-rate" min="0" step="1" value="${party?.amc_rate || ''}" placeholder="E.g. 2500" />
      </div>
      <div class="form-row">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Enable AMC</label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="party-amc-active" ${party?.amc_active ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary);" />
            <span style="font-size:0.85rem;">Monthly refill reminders</span>
          </label>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Refill Day of Month</label>
          <select class="form-select" id="party-amc-day">
            ${Array.from({length: 28}, (_, i) => i + 1).map(d =>
              `<option value="${d}" ${party?.amc_day === d ? 'selected' : ''}>${getOrdinal(d)}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    </div>

    <div style="background:var(--bg-secondary);border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <i class="fas fa-tags" style="color:var(--blue);"></i>
          <strong style="font-size:0.9rem;">Custom Product Rates</strong>
        </div>
        <span style="font-size:0.75rem;color:var(--text-muted);">Leave blank = default price</span>
      </div>
      <div style="max-height:200px;overflow-y:auto;" id="product-rates-list">
        ${products.filter(p => p.is_active).map(p => {
          const customRate = customRates[String(p.id)];
          const hasCustom = customRate !== undefined && customRate !== null;
          return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);">
            <div style="flex:1;font-size:0.8rem;">
              <strong>${esc(p.name)}</strong>
              <div style="font-size:0.7rem;color:var(--text-muted);">Default: ₹${Number(p.unit_price).toLocaleString('en-IN')}${p.type === 'liquid' ? '/g' : '/unit'}</div>
            </div>
            <input class="form-input product-rate-input" data-pid="${p.id}" type="number" min="0" step="0.01"
              value="${hasCustom ? customRate : ''}"
              placeholder="₹${Number(p.unit_price).toLocaleString('en-IN')}"
              style="width:110px;padding:6px 8px;font-size:0.8rem;${hasCustom ? 'border-color:var(--primary);background:var(--primary-soft);' : ''}" />
          </div>`;
        }).join('')}
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
    const amcActive = document.getElementById('party-amc-active').checked;
    const amcDay = parseInt(document.getElementById('party-amc-day').value);
    const amcRate = parseFloat(document.getElementById('party-amc-rate').value) || null;

    // Collect custom product rates
    const customProductRates = {};
    document.querySelectorAll('.product-rate-input').forEach(input => {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val >= 0) {
        customProductRates[input.dataset.pid] = val;
      }
    });

    const record = {
      name,
      phone: document.getElementById('party-phone').value.trim(),
      address: document.getElementById('party-address').value.trim(),
      notes: document.getElementById('party-notes').value.trim(),
      amc_active: amcActive,
      amc_day: amcActive ? amcDay : null,
      amc_rate: amcRate,
      custom_product_rates: Object.keys(customProductRates).length > 0 ? customProductRates : null
    };
    if (isEdit) { await db.update('parties', party.id, record); showToast('Party updated', 'success'); }
    else { await db.insert('parties', record); showToast('Party added', 'success'); }
    close();
    renderParties(body, header);
  };
}
