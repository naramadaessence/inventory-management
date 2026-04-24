import { db, auth } from '../supabase.js';
import { formatDate, formatStock, showToast, createModal } from '../utils/helpers.js';

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

export async function renderDamageLoss(body, header) {
  if (!auth.isAdmin()) { body.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3></div>'; return; }

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Damage & Loss</h1>
      <div class="page-header-subtitle">Report damaged or lost inventory</div>
    </div>
    <button class="btn btn-primary" id="btn-report-damage"><i class="fas fa-plus"></i> Report</button>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  const { data: reports } = await db.getAll('damage_reports', { orderBy: ['created_at', 'desc'] });
  const { data: products } = await db.getAll('products');
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

  body.innerHTML = reports.length === 0 ? '<div class="empty-state"><i class="fas fa-shield-halved"></i><h3>No damage reports</h3><p>Good news — no damage or loss recorded.</p></div>' : `
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Quantity Lost</th><th>Reason</th></tr></thead>
      <tbody>${reports.map(r => {
        const prod = prodMap[r.product_id];
        return `<tr>
          <td>${formatDate(r.report_date || r.created_at)}</td>
          <td><strong>${esc(prod?.name || 'Unknown')}</strong></td>
          <td><span class="badge-status ${r.damage_type === 'damaged' ? 'amber' : 'red'}">${esc(r.damage_type || 'damage')}</span></td>
          <td style="color:var(--red);font-weight:600;">${formatStock(r.quantity, prod?.type)}</td>
          <td>${esc(r.reason || '—')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  `;

  document.getElementById('btn-report-damage').addEventListener('click', () => {
    const activeProducts = products.filter(p => p.is_active);
    const content = `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Product *</label>
          <select class="form-select" id="dmg-product">${activeProducts.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-select" id="dmg-type">
            <option value="damaged">Damaged</option>
            <option value="lost">Lost</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Quantity *</label>
          <input class="form-input" type="number" id="dmg-qty" value="1" min="0.1" required />
        </div>
        <div class="form-group">
          <label class="form-label">Date</label>
          <input class="form-input" type="date" id="dmg-date" value="${new Date().toISOString().split('T')[0]}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Reason *</label>
        <textarea class="form-textarea" id="dmg-reason" maxlength="500" required placeholder="Describe what happened..."></textarea>
      </div>
    `;
    const footer = `<button class="btn btn-secondary" id="dmg-cancel">Cancel</button><button class="btn btn-danger" id="dmg-save"><i class="fas fa-exclamation-triangle"></i> Report Damage</button>`;
    const { close } = createModal('Report Damage / Loss', content, { footer });

    document.getElementById('dmg-cancel').onclick = close;
    document.getElementById('dmg-save').onclick = async () => {
      const productId = parseInt(document.getElementById('dmg-product').value);
      const qty = parseFloat(document.getElementById('dmg-qty').value);
      const reason = document.getElementById('dmg-reason').value.trim();
      if (!reason || reason.length < 3) { showToast('Please provide a reason', 'error'); return; }
      if (isNaN(qty) || qty <= 0) { showToast('Valid quantity required', 'error'); return; }

      const prod = products.find(p => p.id === productId);
      await db.insert('damage_reports', {
        product_id: productId,
        damage_type: document.getElementById('dmg-type').value,
        quantity: qty,
        reason,
        report_date: document.getElementById('dmg-date').value,
        reported_by: auth.currentUser.id
      });
      await db.update('products', productId, { current_stock: Math.max(0, (prod.current_stock || 0) - qty) });
      await db.insert('inventory_transactions', { product_id: productId, type: 'damage', quantity: -qty, reference_type: 'damage_report', performed_by: auth.currentUser.id, notes: `${document.getElementById('dmg-type').value}: ${reason}` });

      showToast('Damage report filed', 'warning');
      close();
      renderDamageLoss(body, header);
    };
  });
}
