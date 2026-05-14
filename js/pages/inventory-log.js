import { db, auth } from '../supabase.js';
import { formatDateTime, formatStock, showToast, esc } from '../utils/helpers.js';

const PAGE_SIZE = 50;

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

  // Lookups (small tables, fine to fetch fully)
  const { data: products } = await db.getAll('products');
  const { data: profiles } = await db.getAll('profiles');
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
  const userMap = Object.fromEntries(profiles.map(p => [p.id, p]));

  // Page-local state. We paginate server-side and filter server-side via .eq()
  // so the table doesn't silently truncate at Supabase's 1000-row default.
  let filterType = '';
  let page = 0;

  body.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <select class="form-select" id="log-filter-type" style="width:160px;">
          <option value="">All Types</option>
          <option value="checkout">Checkout</option>
          <option value="checkin">Check-in</option>
          <option value="sale">Sale</option>
          <option value="sale_delete">Sale Deleted</option>
          <option value="rental_out">Rental Out</option>
          <option value="rental_return">Rental Return</option>
          <option value="damage">Damage</option>
          <option value="stock_in">Stock In</option>
          <option value="adjustment">Adjustment</option>
        </select>
      </div>
      <div class="toolbar-right" id="log-pager"></div>
    </div>
    <div id="log-table"></div>
  `;

  document.getElementById('log-filter-type').addEventListener('change', e => {
    filterType = e.target.value;
    page = 0;
    renderPage();
  });

  async function renderPage() {
    const tableEl = document.getElementById('log-table');
    const pagerEl = document.getElementById('log-pager');
    tableEl.innerHTML = '<div class="loading-overlay" style="position:relative;height:120px;"><div class="spinner"></div></div>';

    const opts = {
      orderBy: ['created_at', 'desc'],
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    };
    if (filterType) opts.eq = { type: filterType };

    const { data: txns, error } = await db.getAll('inventory_transactions', opts);
    if (error) {
      tableEl.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load log</h3></div>';
      showToast('Failed to load inventory log', 'error');
      return;
    }

    if (!txns || txns.length === 0) {
      tableEl.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><h3>No log entries${page > 0 ? ' on this page' : ' found'}</h3></div>`;
      pagerEl.innerHTML = page > 0 ? `<button class="btn btn-sm btn-secondary" id="log-prev"><i class="fas fa-chevron-left"></i> Prev</button>` : '';
      document.getElementById('log-prev')?.addEventListener('click', () => { page = Math.max(0, page - 1); renderPage(); });
      return;
    }

    const typeColors = { checkout: 'amber', checkin: 'green', sale: 'green', sale_delete: 'red', rental_out: 'purple', rental_return: 'blue', damage: 'red', stock_in: 'blue', adjustment: 'amber' };
    tableEl.innerHTML = `<div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Timestamp</th><th>Type</th><th>Product</th><th>Quantity</th><th>Performed By</th><th>Notes</th></tr></thead>
      <tbody>${txns.map(t => {
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

    // Pager: enable Next only if we got a full page (means there's likely more)
    const hasMore = txns.length === PAGE_SIZE;
    const start = page * PAGE_SIZE + 1;
    const end = page * PAGE_SIZE + txns.length;
    pagerEl.innerHTML = `
      <span style="color:var(--text-muted);font-size:0.85rem;margin-right:12px;">Showing ${start}–${end}</span>
      <button class="btn btn-sm btn-secondary" id="log-prev" ${page === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}><i class="fas fa-chevron-left"></i> Prev</button>
      <button class="btn btn-sm btn-secondary" id="log-next" ${!hasMore ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''} style="margin-left:6px;">Next <i class="fas fa-chevron-right"></i></button>
    `;
    document.getElementById('log-prev')?.addEventListener('click', () => { if (page > 0) { page--; renderPage(); } });
    document.getElementById('log-next')?.addEventListener('click', () => { if (hasMore) { page++; renderPage(); } });
  }

  renderPage();
}
