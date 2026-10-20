import { db, auth } from '../supabase.js';
import { formatCurrency, formatStock, formatDate, getDateRange, showToast, esc, localDay, USAGE_REASONS, DISCREPANCY_TYPES } from '../utils/helpers.js';
import Chart from 'chart.js/auto';

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
      <button class="tab-btn" data-tab="ledger">Staff Daily Ledger</button>
      <button class="tab-btn" data-tab="movers">Fast/Slow Movers</button>
    </div>
    <div id="report-content"></div>
  `;

  let activeTab = 'sales';
  let startDate = defaultRange.start;
  let endDate = defaultRange.end;
  // Ledger filters survive date-range changes and tab switches.
  const ledgerState = { staffId: '', fragrance: '', groupBy: 'product' };

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

    const { data: sales } = await db.fetchAllPaged('sales');
    const { data: products } = await db.getAll('products');
    const { data: profiles } = await db.getAll('profiles');
    const { data: sessions } = await db.fetchAllPaged('checkout_sessions');
    const { data: checkoutItems } = await db.fetchAllPaged('checkout_items');
    const { data: categories } = await db.getAll('categories');
    const { data: allSaleItems } = await db.fetchAllPaged('sale_items');
    const { data: parties } = await db.getAll('parties');
    const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
    const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

    const filteredSales = sales.filter(s => {
      const d = (s.sale_date || s.created_at || '').split('T')[0];
      return d >= startDate && d <= endDate;
    });
    const filteredSaleIds = new Set(filteredSales.map(s => s.id));
    const filteredItems = allSaleItems.filter(si => filteredSaleIds.has(si.sale_id));

    if (activeTab === 'sales') renderSalesReport(container, filteredSales, filteredItems, prodMap, profiles);
    else if (activeTab === 'stock') renderStockReport(container, products, catMap, parties, prodMap);
    else if (activeTab === 'sellers') renderSellerReport(container, sessions, checkoutItems, profiles, prodMap, startDate, endDate);
    else if (activeTab === 'ledger') {
      const { data: usage } = await db.fetchAllPaged('checkout_usage');
      renderLedgerReport(container, { sessions, checkoutItems, usage: usage || [], products, prodMap, profiles, parties, startDate, endDate }, ledgerState);
    }
    else if (activeTab === 'movers') renderMoversReport(container, filteredItems, products, prodMap);
  }

  loadReport();
}

function renderSalesReport(container, sales, saleItems, prodMap, profiles) {
  const totalRev = sales.reduce((s, r) => s + (r.total_amount || 0), 0);
  const avgOrder = sales.length ? totalRev / sales.length : 0;

  // Group by product using sale_items
  const byProduct = {};
  saleItems.forEach(si => {
    const pName = prodMap[si.product_id]?.name || 'Unknown';
    if (!byProduct[pName]) byProduct[pName] = { revenue: 0, qty: 0 };
    byProduct[pName].revenue += si.line_total || 0;
    byProduct[pName].qty += si.quantity || 0;
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

function renderStockReport(container, products, catMap, parties, prodMap) {
  const activeProducts = products.filter(p => p.is_active);
  const warehouseValue = activeProducts.reduce((s, p) => s + p.current_stock * p.unit_price, 0);

  // Machine category filter: only physical machines (diffusers/dispensers), NOT oils or refills
  const isMachineCat = (cid) => { const c = catMap[parseInt(cid)]; if (!c || c.type === 'liquid') return false; const n = c.name.toLowerCase(); return !n.includes('refill') && !n.includes('oil'); };

  // Deployed machines: sourced from parties.machine_counts (category_id → qty)
  // Only Free-to-Use parties, only machine categories
  const deployedByCat = {};  // category_id → { qty, parties[] }
  (parties || []).filter(p => p.machine_type === 'free_to_use').forEach(p => {
    const mc = p.machine_counts || {};
    Object.entries(mc).forEach(([cid, qty]) => {
      if (isMachineCat(cid) && qty > 0) {
        if (!deployedByCat[cid]) deployedByCat[cid] = { qty: 0, parties: [] };
        deployedByCat[cid].qty += qty;
        if (p.name && !deployedByCat[cid].parties.includes(p.name)) deployedByCat[cid].parties.push(p.name);
      }
    });
  });

  // Average unit price per machine category for valuation
  const avgPriceByCat = {};
  activeProducts.forEach(p => {
    if (!avgPriceByCat[p.category_id]) avgPriceByCat[p.category_id] = { sum: 0, count: 0 };
    avgPriceByCat[p.category_id].sum += p.unit_price;
    avgPriceByCat[p.category_id].count++;
  });

  let ftuDeployedValue = 0;
  let totalDeployedMachines = 0;
  let ftuParties = new Set();
  
  (parties || []).filter(p => p.machine_type === 'free_to_use').forEach(p => {
    const mc = p.machine_counts || {};
    let hasMachine = false;
    Object.entries(mc).forEach(([cid, qty]) => {
      if (isMachineCat(cid) && qty > 0) {
        hasMachine = true;
        totalDeployedMachines += qty;
      }
    });
    if (hasMachine) ftuParties.add(p.id);
  });

  Object.entries(deployedByCat).forEach(([cid, data]) => {
    const avg = avgPriceByCat[parseInt(cid)];
    ftuDeployedValue += data.qty * (avg ? avg.sum / avg.count : 0);
  });
  const totalValue = warehouseValue + ftuDeployedValue;

  // Category breakdown (warehouse only)
  const byCat = {};
  activeProducts.forEach(p => {
    const cName = catMap[p.category_id]?.name || 'Other';
    if (!byCat[cName]) byCat[cName] = { value: 0, count: 0 };
    byCat[cName].value += p.current_stock * p.unit_price;
    byCat[cName].count++;
  });
  const catEntries = Object.entries(byCat).sort((a, b) => b[1].value - a[1].value);

  // Build combined product list: warehouse stock + deployed qty (by category), sorted by total value
  const productRows = activeProducts.map(p => {
    const dep = deployedByCat[String(p.category_id)] || { qty: 0, parties: [] };
    // Only show deployed for machine categories
    const showDeployed = isMachineCat(String(p.category_id));
    const depQty = showDeployed ? dep.qty : 0;
    const depParties = showDeployed ? dep.parties : [];
    const whValue = p.current_stock * p.unit_price;
    const depValue = depQty * p.unit_price;
    return { ...p, deployedQty: depQty, deployedParties: depParties, whValue, depValue, totalValue: whValue + depValue };
  }).sort((a, b) => b.totalValue - a.totalValue);

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon amber"><i class="fas fa-warehouse"></i></div><div class="stat-info"><div class="stat-label">Total Asset Value</div><div class="stat-value">${formatCurrency(totalValue)}</div><div class="stat-change" style="font-size:0.7rem;">Warehouse: ${formatCurrency(warehouseValue)}${ftuDeployedValue > 0 ? ` · Deployed: ${formatCurrency(ftuDeployedValue)}` : ''}</div></div></div>
      <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-boxes-stacked"></i></div><div class="stat-info"><div class="stat-label">Active Products</div><div class="stat-value">${activeProducts.length}</div></div></div>
      ${ftuDeployedValue > 0 ? `<div class="stat-card"><div class="stat-icon" style="background:rgba(20,184,166,0.12);color:#14b8a6;"><i class="fas fa-truck-loading"></i></div><div class="stat-info"><div class="stat-label">Deployed (Free-to-Use)</div><div class="stat-value">${formatCurrency(ftuDeployedValue)}</div><div class="stat-change" style="font-size:0.7rem;">${totalDeployedMachines} machine${totalDeployedMachines !== 1 ? 's' : ''} at ${ftuParties.size} location${ftuParties.size !== 1 ? 's' : ''}</div></div></div>` : ''}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><h3>Asset Value by Category</h3></div><div class="card-body"><div class="chart-container"><canvas id="stock-chart"></canvas></div></div></div>
      <div class="card"><div class="card-header"><h3>Stock Details</h3><div style="display:flex;gap:10px;align-items:center;font-size:0.7rem;"><span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:var(--amber);display:inline-block;"></span> Warehouse</span><span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:#14b8a6;display:inline-block;"></span> Deployed (Free-to-Use)</span></div></div><div class="card-body">
        <table class="data-table"><thead><tr><th>Product</th><th>Warehouse</th><th>Deployed</th><th>Location</th><th>Total Value</th></tr></thead>
        <tbody>${productRows.slice(0, 20).map(p => {
          const depBadge = p.deployedQty > 0
            ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;background:rgba(20,184,166,0.1);color:#14b8a6;font-weight:600;font-size:0.8rem;">${formatStock(p.deployedQty, p.type)}</span>`
            : '<span style="color:var(--text-muted);font-size:0.8rem;">—</span>';
          const locationText = p.deployedParties.length > 0
            ? `<span style="font-size:0.75rem;color:var(--text-muted);">${p.deployedParties.map(n => esc(n)).join(', ')}</span>`
            : '<span style="color:var(--text-muted);font-size:0.75rem;">—</span>';
          return `<tr>
            <td>${esc(p.name)}</td>
            <td>${formatStock(p.current_stock, p.type)}</td>
            <td>${depBadge}</td>
            <td>${locationText}</td>
            <td style="font-weight:600;">${formatCurrency(p.totalValue)}</td>
          </tr>`;
        }).join('')}</tbody></table>
      </div></div>
    </div>
  `;

  // Build chart data: categories (warehouse) + deployed slice
  const chartLabels = catEntries.map(([n]) => n);
  const chartData = catEntries.map(([, d]) => d.value);
  const colors = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];
  const chartColors = colors.slice(0, catEntries.length);

  // Add deployed slice if there is deployed value
  if (ftuDeployedValue > 0) {
    chartLabels.push('Deployed (Free-to-Use)');
    chartData.push(ftuDeployedValue);
    chartColors.push('#14b8a6');
  }

  if (chartLabels.length > 0) {
    const ctx = document.getElementById('stock-chart').getContext('2d');
    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: chartLabels,
        datasets: [{ data: chartData, backgroundColor: chartColors, borderWidth: 2, borderColor: 'var(--card)' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${formatCurrency(ctx.parsed)} (${pct}%)`;
              }
            }
          }
        }
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
    // Legacy items (used_quantity null) are never counted as mismatches.
    const mismatched = sItems.filter(i => i.has_mismatch && i.used_quantity != null);
    const shortage = { unit: 0, liquid: 0 };
    mismatched.forEach(i => {
      const diff = Number(i.difference || 0);
      if (diff > 0) shortage[prodMap[i.product_id]?.type === 'liquid' ? 'liquid' : 'unit'] += diff;
    });
    return { ...s, totalSessions: sSessions.length, totalItems: sItems.length, flagged, mismatches: mismatched.length, shortage };
  });

  container.innerHTML = `
    <div class="card"><div class="card-header"><h3>Seller Performance</h3></div><div class="card-body">
      ${sellerStats.length === 0 ? '<p style="color:var(--text-muted);">No sellers found</p>' : `
        <div class="table-wrapper"><table class="data-table"><thead><tr><th>Seller</th><th>Sessions</th><th>Items Handled</th><th>Flags</th><th>Mismatches</th><th>Total Shortage</th><th>Status</th></tr></thead>
        <tbody>${sellerStats.map(s => `<tr>
          <td><strong>${esc(s.full_name)}</strong><br><small style="color:var(--text-muted);">${esc(s.email)}</small></td>
          <td>${s.totalSessions}</td>
          <td>${s.totalItems}</td>
          <td style="${s.flagged ? 'color:var(--red);font-weight:700;' : ''}">${s.flagged || 0}</td>
          <td style="${s.mismatches ? 'color:var(--red);font-weight:700;' : ''}">${s.mismatches}</td>
          <td style="${s.shortage.unit || s.shortage.liquid ? 'color:var(--red);font-weight:600;' : ''}">${formatByUnit(s.shortage)}</td>
          <td><span class="badge-status ${s.flagged ? 'red' : 'green'}">${s.flagged ? 'Needs Review' : 'Good'}</span></td>
        </tr>`).join('')}</tbody></table></div>
      `}
    </div></div>
  `;
}

// ============================================
// STAFF DAILY LEDGER
// Per staff member, per day (checkout_time, local date), per product or
// fragrance: Issued, Returned, Used (by reason), Difference and status.
// Difference = Issued − Returned − Used (positive = shortage), stored on
// checkout_items by submit_return. Legacy returns (used_quantity null) show
// "—" for Used / Difference and are never counted as mismatches.
// ============================================

// Only sessions where stock actually left the warehouse.
const LEDGER_SESSION_STATUSES = ['checked_out', 'pending_approval', 'checked_in', 'flagged'];

function round3(n) { return Math.round(Number(n || 0) * 1000) / 1000; }


function normFragrance(f) { return String(f || '').trim().toLowerCase(); }

function itemState(session, item) {
  if (session.status === 'checked_out') return 'in_field';
  if (session.status === 'pending_approval') return 'awaiting';
  if (item.used_quantity == null) return session.status === 'flagged' ? 'flagged' : 'legacy';
  if (item.discrepancy_type) return 'resolved';
  if (item.has_mismatch) return Number(item.difference) > 0 ? 'shortage' : 'excess';
  return 'matching';
}

function emptyTotals() {
  const t = () => ({ issued: 0, returned: 0, used: 0, difference: 0, hasReturned: false, hasUsed: false });
  return { unit: t(), liquid: t() };
}

function addToTotals(totals, row) {
  const t = totals[row.type];
  t.issued += row.issued;
  if (row.returned != null) { t.returned += row.returned; t.hasReturned = true; }
  if (row.used != null) { t.used += row.used; t.difference += row.difference; t.hasUsed = true; }
}

// Build ledger rows, grouped staff → day → product/fragrance. Pure; exported for tests.
export function buildStaffLedger({ sessions, checkoutItems, usage = [], prodMap, profiles = [], parties = [], startDate, endDate, staffId = '', fragrance = '', groupBy = 'product' }) {
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
  const partyMap = Object.fromEntries(parties.map(p => [p.id, p]));
  const wantFragrance = normFragrance(fragrance);

  const sessionInfo = new Map();
  sessions.forEach(s => {
    if (!LEDGER_SESSION_STATUSES.includes(s.status)) return;
    if (staffId && s.seller_id !== staffId) return;
    const day = localDay(s.checkout_time || s.created_at);
    if (!day || day < startDate || day > endDate) return;
    sessionInfo.set(s.id, { session: s, day });
  });

  const usageByItem = {};
  usage.forEach(u => { (usageByItem[u.item_id] = usageByItem[u.item_id] || []).push(u); });

  const rowMap = new Map();
  checkoutItems.forEach(item => {
    const info = sessionInfo.get(item.session_id);
    if (!info) return;
    const product = prodMap[item.product_id];
    if (wantFragrance && normFragrance(product?.fragrance) !== wantFragrance) return;
    const type = product?.type === 'liquid' ? 'liquid' : 'unit';
    const byFragrance = groupBy === 'fragrance' && normFragrance(product?.fragrance);
    // Fragrance rows never mix kg with pcs: same fragrance, different unit → separate rows.
    const groupKey = byFragrance ? `f:${normFragrance(product.fragrance)}:${type}` : `p:${item.product_id}`;
    const label = byFragrance ? product.fragrance.trim() : (product?.name || 'Unknown product');
    const staff = info.session.seller_id;
    const key = `${staff}|${info.day}|${groupKey}`;

    let row = rowMap.get(key);
    if (!row) {
      row = {
        staffId: staff, staffName: profileMap[staff]?.full_name || 'Unknown staff', day: info.day,
        key: groupKey, label, type, products: [],
        issued: 0, returned: null, used: null, difference: null,
        usage: Object.fromEntries(Object.keys(USAGE_REASONS).map(k => [k, 0])), usageNotes: [],
        states: new Set(), resolvedTypes: new Set(), mismatchCount: 0, mismatchDiff: 0,
      };
      rowMap.set(key, row);
    }
    if (product?.name && !row.products.includes(product.name)) row.products.push(product.name);

    const state = itemState(info.session, item);
    row.states.add(state);
    row.issued = round3(row.issued + Number(item.checkout_quantity || 0));
    if (state !== 'in_field' && item.checkin_quantity != null) {
      row.returned = round3((row.returned || 0) + Number(item.checkin_quantity));
    }
    if (state !== 'in_field' && item.used_quantity != null) {
      const diff = item.difference != null
        ? Number(item.difference)
        : Number(item.checkout_quantity || 0) - Number(item.checkin_quantity || 0) - Number(item.used_quantity);
      row.used = round3((row.used || 0) + Number(item.used_quantity));
      row.difference = round3((row.difference || 0) + diff);
      if (item.has_mismatch) { row.mismatchCount++; row.mismatchDiff = round3(row.mismatchDiff + diff); }
      if (item.discrepancy_type) row.resolvedTypes.add(item.discrepancy_type);
      (usageByItem[item.id] || []).forEach(u => {
        if (row.usage[u.reason] == null) row.usage[u.reason] = 0;
        row.usage[u.reason] = round3(row.usage[u.reason] + Number(u.quantity || 0));
        const party = partyMap[u.party_id]?.name;
        if (party || u.notes) row.usageNotes.push(`${USAGE_REASONS[u.reason] || u.reason}: ${[party, u.notes].filter(Boolean).join(' — ')}`);
      });
    }
  });

  const rows = [...rowMap.values()].map(row => ({ ...row, status: rowStatus(row) }));
  rows.sort((a, b) => a.staffName.localeCompare(b.staffName) || a.staffId.localeCompare(b.staffId)
    || b.day.localeCompare(a.day) || a.label.localeCompare(b.label) || a.type.localeCompare(b.type));
  return rows;
}

// One status per row; an aggregated (fragrance) row shows the most urgent one.
function rowStatus(row) {
  const s = row.states;
  const mismatchKind = row.mismatchDiff > 0 ? 'Shortage' : 'Excess';
  if (s.has('in_field')) return { key: 'in_field', label: 'In field', color: 'blue', mismatch: false };
  if (s.has('awaiting')) {
    return row.mismatchCount
      ? { key: 'awaiting', label: `Awaiting approval · ${mismatchKind}`, color: 'red', mismatch: true }
      : { key: 'awaiting', label: 'Awaiting approval', color: 'amber', mismatch: false };
  }
  if (s.has('shortage') || s.has('excess')) return { key: mismatchKind.toLowerCase(), label: mismatchKind, color: 'red', mismatch: true };
  if (s.has('resolved')) {
    const types = [...row.resolvedTypes].map(t => DISCREPANCY_TYPES[t] || t).join(', ');
    return { key: 'resolved', label: `Resolved: ${types}`, color: 'purple', mismatch: true };
  }
  if (s.has('flagged')) return { key: 'flagged', label: 'Flagged (old return)', color: 'amber', mismatch: false };
  if (s.has('matching')) return { key: 'matching', label: 'Matching', color: 'green', mismatch: false };
  return { key: 'legacy', label: 'Returned (no usage entry)', color: '', mismatch: false };
}

function formatByUnit(byType) {
  const parts = [];
  if (byType.unit) parts.push(formatStock(round3(byType.unit), 'unit'));
  if (byType.liquid) parts.push(formatStock(round3(byType.liquid), 'liquid'));
  return parts.length ? parts.join(' · ') : '—';
}

function formatDiff(diff, type) {
  if (diff == null) return '—';
  if (diff === 0) return formatStock(0, type);
  return `${formatStock(round3(Math.abs(diff)), type)} ${diff > 0 ? 'short' : 'excess'}`;
}

// Subtotal cells; pcs and kg are summed separately and shown one per line.
function totalsCells(totals) {
  const types = ['unit', 'liquid'].filter(t => totals[t].issued > 0);
  const cell = (col, flag, fmt) => {
    const parts = types.filter(t => !flag || totals[t][flag]).map(t => fmt(round3(totals[t][col]), t));
    return `<td data-col="${col}">${parts.length ? parts.join('<br>') : '—'}</td>`;
  };
  return cell('issued', null, formatStock) + cell('returned', 'hasReturned', formatStock)
    + cell('used', 'hasUsed', formatStock) + cell('difference', 'hasUsed', formatDiff);
}

function usageBreakdown(row) {
  return Object.entries(row.usage).filter(([, q]) => q > 0)
    .map(([reason, q]) => `${USAGE_REASONS[reason] || reason}: ${formatStock(q, row.type)}`);
}

function ledgerRowHtml(row) {
  const breakdown = usageBreakdown(row);
  const tip = [...breakdown, ...row.usageNotes].join('\n');
  const usedCell = row.used == null ? '—' : (breakdown.length
    ? `<details><summary style="cursor:pointer;" title="${esc(tip)}">${formatStock(row.used, row.type)}</summary><div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${[...breakdown, ...row.usageNotes].map(esc).join('<br>')}</div></details>`
    : formatStock(row.used, row.type));
  const bg = row.status.mismatch ? (row.status.key === 'resolved' ? 'var(--purple-soft)' : 'var(--red-soft)') : '';
  const diffStyle = row.status.mismatch && row.status.key !== 'resolved' ? 'color:var(--red);font-weight:700;' : '';
  const productsTitle = row.key.startsWith('f:') ? ` title="${esc(row.products.join(', '))}"` : '';
  return `<tr data-ledger-row data-staff="${esc(row.staffId)}" data-day="${row.day}" data-key="${esc(row.key)}" data-status="${row.status.key}" class="${row.status.mismatch ? 'ledger-mismatch' : ''}"${bg ? ` style="background:${bg};"` : ''}>
    <td${productsTitle}>${esc(row.label)}${row.key.startsWith('f:') && row.products.length > 1 ? `<div style="font-size:0.7rem;color:var(--text-muted);">${row.products.length} products</div>` : ''}</td>
    <td data-col="issued" data-value="${row.issued}">${formatStock(row.issued, row.type)}</td>
    <td data-col="returned" data-value="${row.returned ?? ''}">${row.returned == null ? '—' : formatStock(row.returned, row.type)}</td>
    <td data-col="used" data-value="${row.used ?? ''}">${usedCell}</td>
    <td data-col="difference" data-value="${row.difference ?? ''}" style="${diffStyle}">${formatDiff(row.difference, row.type)}</td>
    <td><span class="badge-status ${row.status.color}"${row.status.color ? '' : ' style="background:var(--bg);color:var(--text-muted);"'}>${esc(row.status.label)}</span></td>
  </tr>`;
}

function dayLabel(day) { return formatDate(`${day}T00:00:00`); }

function renderLedgerReport(container, data, state) {
  const { sessions, profiles, products, startDate, endDate } = data;
  const staffIds = [...new Set(sessions.filter(s => LEDGER_SESSION_STATUSES.includes(s.status)).map(s => s.seller_id))];
  const staffOptions = staffIds
    .map(id => ({ id, name: profiles.find(p => p.id === id)?.full_name || 'Unknown staff' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const fragranceOptions = [...new Map(products.filter(p => normFragrance(p.fragrance))
    .map(p => [normFragrance(p.fragrance), p.fragrance.trim()])).values()].sort((a, b) => a.localeCompare(b));

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <select class="form-select" id="ledger-staff" style="width:180px;">
          <option value="">All staff</option>
          ${staffOptions.map(o => `<option value="${esc(o.id)}" ${o.id === state.staffId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
        </select>
        <select class="form-select" id="ledger-fragrance" style="width:180px;">
          <option value="">All fragrances</option>
          ${fragranceOptions.map(f => `<option value="${esc(f)}" ${normFragrance(f) === normFragrance(state.fragrance) ? 'selected' : ''}>${esc(f)}</option>`).join('')}
        </select>
        <div style="display:inline-flex;gap:4px;">
          <button class="btn btn-sm ${state.groupBy === 'product' ? 'btn-primary' : 'btn-secondary'}" id="ledger-group-product">Product-wise</button>
          <button class="btn btn-sm ${state.groupBy === 'fragrance' ? 'btn-primary' : 'btn-secondary'}" id="ledger-group-fragrance">Fragrance-wise</button>
        </div>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-sm btn-secondary" id="ledger-export"><i class="fas fa-download"></i> Export CSV</button>
      </div>
    </div>
    <div id="ledger-body"></div>
  `;

  const rerender = () => renderLedgerReport(container, data, state);
  container.querySelector('#ledger-staff').addEventListener('change', e => { state.staffId = e.target.value; rerender(); });
  container.querySelector('#ledger-fragrance').addEventListener('change', e => { state.fragrance = e.target.value; rerender(); });
  container.querySelector('#ledger-group-product').addEventListener('click', () => { state.groupBy = 'product'; rerender(); });
  container.querySelector('#ledger-group-fragrance').addEventListener('click', () => { state.groupBy = 'fragrance'; rerender(); });

  const rows = buildStaffLedger({ ...data, staffId: state.staffId, fragrance: state.fragrance, groupBy: state.groupBy });
  container.querySelector('#ledger-export').addEventListener('click', () => exportLedgerCsv(rows, startDate, endDate, state.groupBy));

  const bodyEl = container.querySelector('#ledger-body');
  if (rows.length === 0) {
    bodyEl.innerHTML = '<div class="empty-state"><i class="fas fa-clipboard-list"></i><h3>No stock issued in this period</h3><p style="color:var(--text-muted);">Change the date range or filters.</p></div>';
    return;
  }

  const mismatchRows = rows.filter(r => r.status.mismatch && r.status.key !== 'resolved').length;
  const awaitingRows = rows.filter(r => r.status.key === 'awaiting').length;
  const inFieldRows = rows.filter(r => r.status.key === 'in_field').length;

  const byStaff = new Map();
  rows.forEach(r => {
    if (!byStaff.has(r.staffId)) byStaff.set(r.staffId, { name: r.staffName, days: new Map() });
    const days = byStaff.get(r.staffId).days;
    if (!days.has(r.day)) days.set(r.day, []);
    days.get(r.day).push(r);
  });

  const header = `<thead><tr><th>${state.groupBy === 'fragrance' ? 'Fragrance / Product' : 'Product'}</th><th>Issued</th><th>Returned</th><th>Used</th><th title="Difference = Issued − Returned − Used">Difference</th><th>Status</th></tr></thead>`;
  bodyEl.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon ${mismatchRows ? 'red' : 'green'}"><i class="fas fa-scale-unbalanced"></i></div><div class="stat-info"><div class="stat-label">Unresolved Mismatches</div><div class="stat-value" id="ledger-mismatch-count">${mismatchRows}</div></div></div>
      <div class="stat-card"><div class="stat-icon amber"><i class="fas fa-hourglass-half"></i></div><div class="stat-info"><div class="stat-label">Awaiting Approval</div><div class="stat-value">${awaitingRows}</div></div></div>
      <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-person-walking-luggage"></i></div><div class="stat-info"><div class="stat-label">Still in Field</div><div class="stat-value">${inFieldRows}</div></div></div>
    </div>
    ${[...byStaff.entries()].map(([sid, staff]) => {
      const staffTotals = emptyTotals();
      const staffMismatches = [...staff.days.values()].flat().filter(r => r.status.mismatch && r.status.key !== 'resolved').length;
      const dayBlocks = [...staff.days.entries()].map(([day, dayRows]) => {
        const dayTotals = emptyTotals();
        dayRows.forEach(r => { addToTotals(dayTotals, r); addToTotals(staffTotals, r); });
        return `
          <tr class="ledger-day-row"><td colspan="6" style="background:var(--bg);font-weight:700;">${esc(dayLabel(day))}</td></tr>
          ${dayRows.map(ledgerRowHtml).join('')}
          <tr class="ledger-day-total" data-day="${day}" style="font-weight:600;"><td style="color:var(--text-muted);">Day total</td>${totalsCells(dayTotals)}<td></td></tr>`;
      }).join('');
      return `<div class="card ledger-staff" data-staff="${esc(sid)}" style="margin-bottom:20px;">
        <div class="card-header"><h3><i class="fas fa-user" style="color:var(--blue);margin-right:8px;"></i>${esc(staff.name)}</h3>
          <span class="badge-status ${staffMismatches ? 'red' : 'green'}">${staffMismatches ? `${staffMismatches} mismatch${staffMismatches > 1 ? 'es' : ''}` : 'No open mismatches'}</span></div>
        <div class="card-body"><div class="table-wrapper"><table class="data-table ledger-table">${header}
          <tbody>${dayBlocks}</tbody>
          <tfoot><tr class="ledger-staff-total" style="font-weight:700;border-top:2px solid var(--border);"><td>Staff total</td>${totalsCells(staffTotals)}<td></td></tr></tfoot>
        </table></div></div>
      </div>`;
    }).join('')}
  `;
}

function exportLedgerCsv(rows, startDate, endDate, groupBy) {
  if (rows.length === 0) { showToast('No ledger rows to export', 'warning'); return; }
  const num = v => (v == null ? '' : round3(v));
  const header = ['Staff', 'Date', groupBy === 'fragrance' ? 'Fragrance / Product' : 'Product', 'Products', 'Unit', 'Issued', 'Returned', 'Used',
    ...Object.values(USAGE_REASONS), 'Difference (Issued - Returned - Used)', 'Status'];
  const lines = [header, ...rows.map(r => [
    r.staffName, r.day, r.label, r.products.join('; '), r.type === 'liquid' ? 'kg' : 'pcs',
    num(r.issued), num(r.returned), num(r.used),
    ...Object.keys(USAGE_REASONS).map(k => (r.used == null ? '' : num(r.usage[k] || 0))),
    num(r.difference), r.status.label,
  ])];
  const toCsvField = val => {
    if (val === null || val === undefined) return '""';
    let s = String(val);
    if (typeof val === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`; // keep spreadsheet formulas inert
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csvContent = '﻿' + lines.map(r => r.map(toCsvField).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `staff_ledger_${groupBy}_${startDate}_${endDate}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function renderMoversReport(container, saleItems, products, prodMap) {
  const salesByProduct = {};
  saleItems.forEach(si => {
    if (!salesByProduct[si.product_id]) salesByProduct[si.product_id] = 0;
    salesByProduct[si.product_id] += si.quantity || 0;
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
