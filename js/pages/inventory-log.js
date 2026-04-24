import { db, auth } from '../supabase.js';
import { formatDateTime, formatStock, showToast } from '../utils/helpers.js';

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

export async function renderInventoryLog(body, header) {
  if (!auth.isAdmin()) { body.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3></div>'; return; }

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Inventory Log</h1>
      <div class="page-header-subtitle">Full audit trail of all inventory movements</div>
    </div>
    <div></div>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  const { data: txns } = await db.getAll('inventory_transactions', { orderBy: ['created_at', 'desc'] });
  const { data: products } = await db.getAll('products');
  const { data: profiles } = await db.getAll('profiles');
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
  const userMap = Object.fromEntries(profiles.map(p => [p.id, p]));

  body.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <select class="form-select" id="log-filter-type" style="width:160px;">
          <option value="">All Types</option>
          <option value="checkout">Checkout</option>
          <option value="checkin">Check-in</option>
          <option value="sale">Sale</option>
          <option value="rental_out">Rental Out</option>
          <option value="rental_return">Rental Return</option>
          <option value="damage">Damage</option>
          <option value="stock_in">Stock In</option>
          <option value="adjustment">Adjustment</option>
        </select>
      </div>
      <div class="toolbar-right">
        <span style="color:var(--text-muted);font-size:0.85rem;">${txns.length} total entries</span>
      </div>
    </div>
    <div id="log-table"></div>
  `;

  let filterType = '';
  function renderLog() {
    let filtered = txns;
    if (filterType) filtered = filtered.filter(t => t.type === filterType);

    const container = document.getElementById('log-table');
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><h3>No log entries found</h3></div>';
      return;
    }

    const typeColors = { checkout: 'amber', checkin: 'green', sale: 'green', rental_out: 'purple', rental_return: 'blue', damage: 'red', stock_in: 'blue', adjustment: 'amber' };
    container.innerHTML = `<div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Timestamp</th><th>Type</th><th>Product</th><th>Quantity</th><th>Performed By</th><th>Notes</th></tr></thead>
      <tbody>${filtered.slice(0, 200).map(t => {
        const prod = prodMap[t.product_id];
        const user = userMap[t.performed_by];
        const color = typeColors[t.type] || 'blue';
        return `<tr>
          <td style="white-space:nowrap;">${formatDateTime(t.created_at)}</td>
          <td><span class="badge-status ${color}">${esc(t.type.replace(/_/g, ' '))}</span></td>
          <td>${esc(prod?.name || 'Unknown')}</td>
          <td style="font-weight:700;color:${t.quantity >= 0 ? 'var(--green)' : 'var(--red)'};">${t.quantity >= 0 ? '+' : ''}${t.quantity}</td>
          <td>${esc(user?.full_name || 'System')}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(t.notes || '')}">${esc(t.notes || '—')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  document.getElementById('log-filter-type').addEventListener('change', e => { filterType = e.target.value; renderLog(); });
  renderLog();
}
