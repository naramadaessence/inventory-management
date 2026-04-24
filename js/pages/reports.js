import { db, auth } from '../supabase.js';
import { formatCurrency, formatStock, formatDate, getDateRange, showToast } from '../utils/helpers.js';
import Chart from 'chart.js/auto';

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

let chartInstances = [];
function destroyCharts() { chartInstances.forEach(c => c.destroy()); chartInstances = []; }

export async function renderReports(body, header) {
  if (!auth.isAdmin()) { body.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3></div>'; return; }
  destroyCharts();

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Reports</h1>
      <div class="page-header-subtitle">Sales analytics, stock reports & insights</div>
    </div>
    <div></div>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  const defaultRange = getDateRange('30days');
  body.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <select class="form-select" id="report-preset" style="width:160px;">
          <option value="7days">Last 7 Days</option>
          <option value="30days" selected>Last 30 Days</option>
          <option value="90days">Last 90 Days</option>
          <option value="thisMonth">This Month</option>
          <option value="lastMonth">Last Month</option>
          <option value="thisYear">This Year</option>
          <option value="custom">Custom Range</option>
        </select>
        <input class="form-input" type="date" id="report-start" value="${defaultRange.start}" style="width:150px;" />
        <input class="form-input" type="date" id="report-end" value="${defaultRange.end}" style="width:150px;" />
        <button class="btn btn-primary btn-sm" id="report-apply"><i class="fas fa-filter"></i> Apply</button>
      </div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="sales">Sales Report</button>
      <button class="tab-btn" data-tab="stock">Stock Valuation</button>
      <button class="tab-btn" data-tab="sellers">Seller Performance</button>
      <button class="tab-btn" data-tab="movers">Fast/Slow Movers</button>
    </div>
    <div id="report-content"></div>
  `;

  let activeTab = 'sales';
  let startDate = defaultRange.start;
  let endDate = defaultRange.end;

  document.getElementById('report-preset').addEventListener('change', (e) => {
    if (e.target.value === 'custom') return;
    const range = getDateRange(e.target.value);
    document.getElementById('report-start').value = range.start;
    document.getElementById('report-end').value = range.end;
    startDate = range.start;
    endDate = range.end;
    loadReport();
  });

  document.getElementById('report-apply').addEventListener('click', () => {
    startDate = document.getElementById('report-start').value;
    endDate = document.getElementById('report-end').value;
    if (startDate > endDate) { showToast('Start date must be before end date', 'error'); return; }
    loadReport();
  });

  body.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      loadReport();
    });
  });

  async function loadReport() {
    destroyCharts();
    const container = document.getElementById('report-content');
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    const { data: sales } = await db.getAll('sales');
    const { data: products } = await db.getAll('products');
    const { data: profiles } = await db.getAll('profiles');
    const { data: sessions } = await db.getAll('checkout_sessions');
    const { data: checkoutItems } = await db.getAll('checkout_items');
    const { data: categories } = await db.getAll('categories');
    const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
    const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

    const filteredSales = sales.filter(s => {
      const d = (s.sale_date || s.created_at || '').split('T')[0];
      return d >= startDate && d <= endDate;
    });

    if (activeTab === 'sales') renderSalesReport(container, filteredSales, prodMap, profiles);
    else if (activeTab === 'stock') renderStockReport(container, products, catMap);
    else if (activeTab === 'sellers') renderSellerReport(container, sessions, checkoutItems, profiles, prodMap, startDate, endDate);
    else if (activeTab === 'movers') renderMoversReport(container, filteredSales, products, prodMap);
  }

  loadReport();
}

function renderSalesReport(container, sales, prodMap, profiles) {
  const totalRev = sales.reduce((s, r) => s + (r.total_amount || 0), 0);
  const avgOrder = sales.length ? totalRev / sales.length : 0;

  // Group by product
  const byProduct = {};
  sales.forEach(s => {
    const pName = prodMap[s.product_id]?.name || 'Unknown';
    if (!byProduct[pName]) byProduct[pName] = { revenue: 0, qty: 0 };
    byProduct[pName].revenue += s.total_amount || 0;
    byProduct[pName].qty += s.quantity || 0;
  });
  const topProducts = Object.entries(byProduct).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10);

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon green"><i class="fas fa-indian-rupee-sign"></i></div><div class="stat-info"><div class="stat-label">Total Revenue</div><div class="stat-value">${formatCurrency(totalRev)}</div></div></div>
      <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-receipt"></i></div><div class="stat-info"><div class="stat-label">Transactions</div><div class="stat-value">${sales.length}</div></div></div>
      <div class="stat-card"><div class="stat-icon amber"><i class="fas fa-chart-bar"></i></div><div class="stat-info"><div class="stat-label">Avg Order Value</div><div class="stat-value">${formatCurrency(avgOrder)}</div></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><h3>Revenue by Product</h3></div><div class="card-body"><div class="chart-container"><canvas id="sales-chart"></canvas></div></div></div>
      <div class="card"><div class="card-header"><h3>Top Products</h3></div><div class="card-body">
        ${topProducts.length === 0 ? '<p style="color:var(--text-muted);">No sales in this period</p>' : `
          <table class="data-table"><thead><tr><th>Product</th><th>Revenue</th><th>Qty</th></tr></thead>
          <tbody>${topProducts.map(([name, d]) => `<tr><td>${esc(name)}</td><td style="font-weight:600;color:var(--green);">${formatCurrency(d.revenue)}</td><td>${d.qty}</td></tr>`).join('')}</tbody></table>
        `}
      </div></div>
    </div>
  `;

  if (topProducts.length > 0) {
    const ctx = document.getElementById('sales-chart').getContext('2d');
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: topProducts.map(([n]) => n.length > 20 ? n.slice(0, 20) + '…' : n),
        datasets: [{ label: 'Revenue (₹)', data: topProducts.map(([, d]) => d.revenue), backgroundColor: 'rgba(245,158,11,0.6)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', callback: v => '₹' + v.toLocaleString() } },
          x: { grid: { display: false }, ticks: { color: '#94a3b8', maxRotation: 45 } }
        }
      }
    });
    chartInstances.push(chart);
  }
}

function renderStockReport(container, products, catMap) {
  const activeProducts = products.filter(p => p.is_active);
  const totalValue = activeProducts.reduce((s, p) => s + p.current_stock * p.unit_price, 0);
  const byCat = {};
  activeProducts.forEach(p => {
    const cName = catMap[p.category_id]?.name || 'Other';
    if (!byCat[cName]) byCat[cName] = { value: 0, count: 0 };
    byCat[cName].value += p.current_stock * p.unit_price;
    byCat[cName].count++;
  });
  const catEntries = Object.entries(byCat).sort((a, b) => b[1].value - a[1].value);

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon amber"><i class="fas fa-warehouse"></i></div><div class="stat-info"><div class="stat-label">Total Stock Value</div><div class="stat-value">${formatCurrency(totalValue)}</div></div></div>
      <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-boxes-stacked"></i></div><div class="stat-info"><div class="stat-label">Active Products</div><div class="stat-value">${activeProducts.length}</div></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><h3>Value by Category</h3></div><div class="card-body"><div class="chart-container"><canvas id="stock-chart"></canvas></div></div></div>
      <div class="card"><div class="card-header"><h3>Stock Details</h3></div><div class="card-body">
        <table class="data-table"><thead><tr><th>Product</th><th>Stock</th><th>Value</th></tr></thead>
        <tbody>${activeProducts.sort((a,b) => (b.current_stock*b.unit_price) - (a.current_stock*a.unit_price)).slice(0,15).map(p => `<tr><td>${esc(p.name)}</td><td>${formatStock(p.current_stock, p.type)}</td><td style="font-weight:600;">${formatCurrency(p.current_stock * p.unit_price)}</td></tr>`).join('')}</tbody></table>
      </div></div>
    </div>
  `;

  if (catEntries.length > 0) {
    const colors = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4'];
    const ctx = document.getElementById('stock-chart').getContext('2d');
    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: catEntries.map(([n]) => n),
        datasets: [{ data: catEntries.map(([, d]) => d.value), backgroundColor: colors.slice(0, catEntries.length), borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 16 } } }
      }
    });
    chartInstances.push(chart);
  }
}

function renderSellerReport(container, sessions, checkoutItems, profiles, prodMap, startDate, endDate) {
  const sellers = profiles.filter(p => p.role === 'seller');
  const sellerStats = sellers.map(s => {
    const sSessions = sessions.filter(ss => ss.seller_id === s.id && (ss.checkout_time || ss.created_at || '').split('T')[0] >= startDate && (ss.checkout_time || ss.created_at || '').split('T')[0] <= endDate);
    const sItems = checkoutItems.filter(i => sSessions.some(ss => ss.id === i.session_id));
    const flagged = sItems.filter(i => i.is_flagged).length;
    return { ...s, totalSessions: sSessions.length, totalItems: sItems.length, flagged };
  });

  container.innerHTML = `
    <div class="card"><div class="card-header"><h3>Seller Performance</h3></div><div class="card-body">
      ${sellerStats.length === 0 ? '<p style="color:var(--text-muted);">No sellers found</p>' : `
        <table class="data-table"><thead><tr><th>Seller</th><th>Sessions</th><th>Items Handled</th><th>Flags</th><th>Status</th></tr></thead>
        <tbody>${sellerStats.map(s => `<tr>
          <td><strong>${esc(s.full_name)}</strong><br><small style="color:var(--text-muted);">${esc(s.email)}</small></td>
          <td>${s.totalSessions}</td>
          <td>${s.totalItems}</td>
          <td style="${s.flagged ? 'color:var(--red);font-weight:700;' : ''}">${s.flagged || 0}</td>
          <td><span class="badge-status ${s.flagged ? 'red' : 'green'}">${s.flagged ? 'Needs Review' : 'Good'}</span></td>
        </tr>`).join('')}</tbody></table>
      `}
    </div></div>
  `;
}

function renderMoversReport(container, sales, products, prodMap) {
  const salesByProduct = {};
  sales.forEach(s => {
    if (!salesByProduct[s.product_id]) salesByProduct[s.product_id] = 0;
    salesByProduct[s.product_id] += s.quantity || 0;
  });
  const movers = Object.entries(salesByProduct).map(([id, qty]) => ({ product: prodMap[parseInt(id)], qty })).filter(m => m.product).sort((a, b) => b.qty - a.qty);
  const fast = movers.slice(0, 10);
  const slow = [...movers].sort((a, b) => a.qty - b.qty).slice(0, 10);

  container.innerHTML = `
    <div class="grid-2">
      <div class="card"><div class="card-header"><h3><i class="fas fa-rocket" style="color:var(--green);margin-right:8px;"></i>Fast Movers</h3></div><div class="card-body">
        ${fast.length === 0 ? '<p style="color:var(--text-muted);">No sales data</p>' : `
          <table class="data-table"><thead><tr><th>Product</th><th>Qty Sold</th></tr></thead>
          <tbody>${fast.map(m => `<tr><td>${esc(m.product.name)}</td><td style="font-weight:700;color:var(--green);">${m.qty}</td></tr>`).join('')}</tbody></table>
        `}
      </div></div>
      <div class="card"><div class="card-header"><h3><i class="fas fa-turtle" style="color:var(--red);margin-right:8px;"></i>Slow Movers</h3></div><div class="card-body">
        ${slow.length === 0 ? '<p style="color:var(--text-muted);">No sales data</p>' : `
          <table class="data-table"><thead><tr><th>Product</th><th>Qty Sold</th></tr></thead>
          <tbody>${slow.map(m => `<tr><td>${esc(m.product.name)}</td><td style="font-weight:700;color:var(--red);">${m.qty}</td></tr>`).join('')}</tbody></table>
        `}
      </div></div>
    </div>
  `;
}
