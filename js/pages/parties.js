import { db, auth } from '../supabase.js';
import { formatDate, formatCurrency, showToast, createModal, esc, dbOp } from '../utils/helpers.js';

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
  const { data: categories } = await db.getAll('categories');
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

  body.innerHTML = parties.length === 0 ? '<div class="empty-state"><i class="fas fa-users"></i><h3>No parties yet</h3><p>Add your first customer or client.</p></div>' : `
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Name</th><th>Phone</th><th>Machine</th><th>AMC Rate</th><th>AMC Refill</th><th>Category Pricing</th><th>Total Sales</th><th>Actions</th></tr></thead>
      <tbody>${parties.map(p => {
        const partySales = sales.filter(s => s.party_id === p.id);
        const totalRev = partySales.reduce((sum, s) => sum + (s.total_amount || 0), 0);
        const today = new Date().getDate();
        const isToday = p.amc_active && p.amc_day === today;
        const catRates = p.custom_category_rates || {};
        const rateEntries = Object.entries(catRates);
        return `<tr style="${isToday ? 'background:var(--primary-soft);' : ''}">
          <td><strong>${esc(p.name)}</strong>${p.notes ? `<br><small style="color:var(--text-muted);">${esc(p.notes)}</small>` : ''}${p.address ? `<br><small style="color:var(--text-muted);"><i class="fas fa-map-marker-alt" style="font-size:0.65rem;"></i> ${esc(p.address)}</small>` : ''}</td>
          <td>${esc(p.phone || '—')}</td>
          <td>${p.machine_type === 'purchased' 
            ? `<span class="badge-status green"><i class="fas fa-shopping-cart" style="font-size:0.65rem;"></i> Purchased${p.machine_count > 1 ? ` ×${p.machine_count}` : ''}</span>` 
            : p.machine_type === 'free_to_use' 
              ? `<span class="badge-status blue"><i class="fas fa-handshake" style="font-size:0.65rem;"></i> Free to Use${p.machine_count > 1 ? ` ×${p.machine_count}` : ''}</span>` 
              : '<span style="color:var(--text-muted);">—</span>'
          }</td>
          <td style="font-weight:700;color:var(--primary);">${p.amc_rate ? '₹' + Number(p.amc_rate).toLocaleString('en-IN') + '/mo' : '<span style="color:var(--text-muted);">—</span>'}</td>
          <td>${p.amc_active
            ? `<span class="badge-status ${isToday ? 'green' : 'blue'}">${isToday ? '📍 TODAY' : getOrdinal(p.amc_day) + ' of month'}</span>`
            : '<span style="color:var(--text-muted);">—</span>'
          }</td>
          <td>${rateEntries.length > 0
            ? rateEntries.map(([cid, rate]) => {
                const cat = catMap[parseInt(cid)];
                return `<div style="font-size:0.75rem;"><strong>${esc(cat?.name || '?')}</strong>: ₹${Number(rate).toLocaleString('en-IN')}</div>`;
              }).join('')
            : '<span style="color:var(--text-muted);">Default</span>'
          }</td>
          <td style="font-weight:600;">₹${totalRev.toLocaleString('en-IN')} (${partySales.length})</td>
          <td><button class="btn btn-sm btn-ghost edit-party-btn" data-id="${p.id}"><i class="fas fa-pen"></i></button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  `;

  document.getElementById('btn-add-party').addEventListener('click', () => openPartyModal(null, body, header, products, categories));
  body.querySelectorAll('.edit-party-btn').forEach(el => {
    el.addEventListener('click', () => openPartyModal(parties.find(p => p.id == el.dataset.id), body, header, products, categories));
  });
}

function openPartyModal(party, body, header, products, categories) {
  const isEdit = !!party;
  const catRates = party?.custom_category_rates || {};

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
        <i class="fas fa-cogs" style="color:var(--green);"></i>
        <strong style="font-size:0.9rem;">Machine Type</strong>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:6px;padding:10px 16px;border-radius:var(--radius);border:2px solid var(--border);cursor:pointer;flex:1;min-width:140px;transition:all 0.2s;" class="machine-opt" data-val="none">
          <input type="radio" name="machine-type" value="none" ${!party?.machine_type || party?.machine_type === 'none' ? 'checked' : ''} style="accent-color:var(--text-muted);" />
          <div><strong style="font-size:0.85rem;">No Machine</strong><div style="font-size:0.7rem;color:var(--text-muted);">Only refills / oils</div></div>
        </label>
        <label style="display:flex;align-items:center;gap:6px;padding:10px 16px;border-radius:var(--radius);border:2px solid var(--border);cursor:pointer;flex:1;min-width:140px;transition:all 0.2s;" class="machine-opt" data-val="purchased">
          <input type="radio" name="machine-type" value="purchased" ${party?.machine_type === 'purchased' ? 'checked' : ''} style="accent-color:var(--green);" />
          <div><strong style="font-size:0.85rem;color:var(--green);"><i class="fas fa-shopping-cart"></i> Purchased</strong><div style="font-size:0.7rem;color:var(--text-muted);">Machine bought outright</div></div>
        </label>
        <label style="display:flex;align-items:center;gap:6px;padding:10px 16px;border-radius:var(--radius);border:2px solid var(--border);cursor:pointer;flex:1;min-width:140px;transition:all 0.2s;" class="machine-opt" data-val="free_to_use">
          <input type="radio" name="machine-type" value="free_to_use" ${party?.machine_type === 'free_to_use' ? 'checked' : ''} style="accent-color:var(--blue);" />
          <div><strong style="font-size:0.85rem;color:var(--blue);"><i class="fas fa-handshake"></i> Free to Use</strong><div style="font-size:0.7rem;color:var(--text-muted);">Monthly visits required</div></div>
        </label>
      </div>
      <div id="machine-count-row" style="display:${party?.machine_type && party?.machine_type !== 'none' ? 'flex' : 'none'};align-items:center;gap:12px;margin-top:12px;padding:10px 14px;background:var(--card);border-radius:var(--radius);border:1px solid var(--border);">
        <i class="fas fa-hashtag" style="color:var(--primary);font-size:0.9rem;"></i>
        <label style="font-size:0.85rem;font-weight:600;white-space:nowrap;">Number of Machines</label>
        <input class="form-input" type="number" id="party-machine-count" value="${party?.machine_count || 1}" min="1" max="100" step="1" style="width:80px;text-align:center;font-weight:700;font-size:1rem;" />
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
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <i class="fas fa-tags" style="color:var(--blue);"></i>
        <strong style="font-size:0.9rem;">Category-wise Fixed Rates</strong>
      </div>
      <p style="font-size:0.75rem;color:var(--text-muted);margin:0 0 12px;">Set a fixed price per category. Any product in that category will auto-use this rate for this party.</p>
      ${categories.map(c => {
        const hasRate = catRates[String(c.id)] !== undefined && catRates[String(c.id)] !== null;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
          <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;">
            <input type="checkbox" class="cat-toggle" data-cid="${c.id}" ${hasRate ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--primary);" />
            <div>
              <strong style="font-size:0.85rem;">${esc(c.name)}</strong>
              <div style="font-size:0.7rem;color:var(--text-muted);">${c.type === 'liquid' ? 'Oils (per gram)' : 'Units (per piece)'}</div>
            </div>
          </label>
          <input class="form-input cat-rate-input" data-cid="${c.id}" type="number" min="0" step="1"
            value="${hasRate ? catRates[String(c.id)] : ''}"
            placeholder="₹ rate"
            style="width:110px;padding:6px 8px;font-size:0.8rem;${hasRate ? 'border-color:var(--primary);background:var(--primary-soft);' : 'opacity:0.4;'}"
            ${hasRate ? '' : 'disabled'} />
        </div>`;
      }).join('')}
    </div>

    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="party-notes" maxlength="500">${esc(party?.notes || '')}</textarea>
    </div>
  `;
  const footer = `<button class="btn btn-secondary" id="party-cancel">Cancel</button><button class="btn btn-primary" id="party-save"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Create'}</button>`;
  const { close } = createModal(isEdit ? 'Edit Party' : 'Add Party', content, { footer });

  // Toggle category rate inputs
  document.querySelectorAll('.cat-toggle').forEach(cb => {
    cb.addEventListener('change', () => {
      const input = document.querySelector(`.cat-rate-input[data-cid="${cb.dataset.cid}"]`);
      if (cb.checked) {
        input.disabled = false;
        input.style.opacity = '1';
        input.style.borderColor = 'var(--primary)';
        input.style.background = 'var(--primary-soft)';
        input.focus();
      } else {
        input.disabled = true;
        input.value = '';
        input.style.opacity = '0.4';
        input.style.borderColor = '';
        input.style.background = '';
      }
    });
  });

  // Toggle machine count row based on machine type
  document.querySelectorAll('input[name="machine-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const row = document.getElementById('machine-count-row');
      row.style.display = radio.value !== 'none' ? 'flex' : 'none';
      if (radio.value === 'none') document.getElementById('party-machine-count').value = 1;
    });
  });

  document.getElementById('party-cancel').onclick = close;
  document.getElementById('party-save').onclick = async () => {
    const name = document.getElementById('party-name').value.trim();
    if (!name || name.length < 2) { showToast('Name is required', 'error'); return; }
    const amcActive = document.getElementById('party-amc-active').checked;
    const amcDay = parseInt(document.getElementById('party-amc-day').value);
    const amcRate = parseFloat(document.getElementById('party-amc-rate').value) || null;

    // Collect category rates (only checked ones with values)
    const customCategoryRates = {};
    document.querySelectorAll('.cat-rate-input').forEach(input => {
      const cb = document.querySelector(`.cat-toggle[data-cid="${input.dataset.cid}"]`);
      if (cb?.checked) {
        const val = parseFloat(input.value);
        if (!isNaN(val) && val >= 0) {
          customCategoryRates[input.dataset.cid] = val;
        }
      }
    });

    const machineType = document.querySelector('input[name="machine-type"]:checked')?.value || 'none';

    const record = {
      name,
      phone: document.getElementById('party-phone').value.trim(),
      address: document.getElementById('party-address').value.trim(),
      notes: document.getElementById('party-notes').value.trim(),
      machine_type: machineType,
      machine_count: machineType !== 'none' ? (parseInt(document.getElementById('party-machine-count').value) || 1) : null,
      amc_active: amcActive,
      amc_day: amcActive ? amcDay : null,
      amc_rate: amcRate,
      custom_category_rates: Object.keys(customCategoryRates).length > 0 ? customCategoryRates : null
    };
    const result = isEdit
      ? await dbOp(db.update('parties', party.id, record), 'Failed to update party')
      : await dbOp(db.insert('parties', record), 'Failed to add party');
    if (!result) return;
    showToast(isEdit ? 'Party updated' : 'Party added', 'success');
    close();
    renderParties(body, header);
  };
}
