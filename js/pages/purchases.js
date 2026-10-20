import { db, auth } from '../supabase.js';
import { formatCurrency, formatStock, formatPricePerUnit, formatDate, showToast, createModal, esc, dbOp, roundCurrency, withSaving, skeletonHTML } from '../utils/helpers.js';

const NONE_KEY = '__none__';

// Local calendar date (YYYY-MM-DD). toISOString() would give the UTC date,
// which is yesterday in India before 05:30.
function localISODate(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// purchase_date is a plain date; legacy rows only have created_at.
function purchaseDay(intake) {
  return intake.purchase_date || localISODate(new Date(intake.created_at));
}

function displayDay(day) {
  // Parse as local midnight so the shown date never shifts by time zone.
  return formatDate(day + 'T00:00:00');
}

function hasRate(intake) {
  return intake.purchase_rate !== null && intake.purchase_rate !== undefined && intake.purchase_rate !== '';
}

function purchaseValue(intake) {
  if (!hasRate(intake)) return null;
  if (intake.total_amount !== null && intake.total_amount !== undefined) return Number(intake.total_amount);
  return roundCurrency(Number(intake.quantity) * Number(intake.purchase_rate));
}

function supplierKey(intake) {
  return String(intake.supplier || '').trim().toLowerCase();
}

function fragranceKey(product) {
  return product?.fragrance ? String(product.fragrance) : NONE_KEY;
}

export async function renderPurchases(body, header) {
  if (!auth.isAdmin()) { body.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3></div>'; return; }

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Purchases</h1>
      <div class="page-header-subtitle">Stock bought from suppliers, with rates and bills</div>
    </div>
    <button class="btn btn-primary" id="btn-record-purchase"><i class="fas fa-plus"></i> Record Purchase</button>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  body.innerHTML = skeletonHTML('card', 3) + '<div style="margin-top:20px;">' + skeletonHTML('table', 6) + '</div>';

  const [intakesRes, productsRes] = await Promise.all([
    dbOp(db.fetchAllPaged('stock_intakes', { orderBy: ['created_at', 'desc'] }), 'Failed to load purchases'),
    dbOp(db.getAll('products'), 'Failed to load products'),
  ]);
  if (!intakesRes || !productsRes) {
    body.innerHTML = '<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><h3>Could not load purchases</h3></div>';
    return;
  }

  const products = productsRes.data || [];
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
  const intakes = (intakesRes.data || []).slice().sort((a, b) => {
    const da = purchaseDay(a), dB = purchaseDay(b);
    if (da !== dB) return da > dB ? -1 : 1;
    if (a.created_at !== b.created_at) return a.created_at > b.created_at ? -1 : 1;
    return (b.id || 0) - (a.id || 0);
  });

  // Filter options come from what has actually been purchased.
  const supplierLabels = new Map();
  intakes.forEach(i => {
    const key = supplierKey(i);
    if (key && !supplierLabels.has(key)) supplierLabels.set(key, String(i.supplier).trim());
  });
  const purchasedProductIds = [...new Set(intakes.map(i => i.product_id))];
  const productOptions = purchasedProductIds
    .map(id => prodMap[id] || { id, name: 'Unknown product' })
    .sort((a, b) => a.name.localeCompare(b.name));
  const fragranceOptions = [...new Set(purchasedProductIds.map(id => fragranceKey(prodMap[id])))]
    .sort((a, b) => (a === NONE_KEY) - (b === NONE_KEY) || a.localeCompare(b));

  body.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left" style="flex-wrap:wrap;">
        <input class="form-input" type="date" id="pf-from" aria-label="From date" title="From date" style="width:150px;" />
        <input class="form-input" type="date" id="pf-to" aria-label="To date" title="To date" style="width:150px;" />
        <select class="form-select" id="pf-supplier" aria-label="Supplier" style="width:170px;">
          <option value="">All suppliers</option>
          ${[...supplierLabels].sort((a, b) => a[1].localeCompare(b[1])).map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join('')}
        </select>
        <select class="form-select" id="pf-product" aria-label="Product" style="width:200px;">
          <option value="">All products</option>
          ${productOptions.map(p => `<option value="${esc(String(p.id))}">${esc(p.name)}</option>`).join('')}
        </select>
        <select class="form-select" id="pf-fragrance" aria-label="Fragrance" style="width:170px;">
          <option value="">All fragrances</option>
          ${fragranceOptions.map(f => `<option value="${esc(f)}">${f === NONE_KEY ? 'No fragrance' : esc(f)}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-ghost" id="pf-clear"><i class="fas fa-xmark"></i> Clear</button>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-sm btn-secondary" id="btn-export-purchases"><i class="fas fa-download"></i> Export CSV</button>
      </div>
    </div>
    <div id="purchase-results"></div>
  `;

  let groupBy = 'supplier';

  function readFilters() {
    return {
      from: document.getElementById('pf-from').value,
      to: document.getElementById('pf-to').value,
      supplier: document.getElementById('pf-supplier').value,
      product: document.getElementById('pf-product').value,
      fragrance: document.getElementById('pf-fragrance').value,
    };
  }

  function filtered() {
    const f = readFilters();
    return intakes.filter(i => {
      const day = purchaseDay(i);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      if (f.supplier && supplierKey(i) !== f.supplier) return false;
      if (f.product && String(i.product_id) !== f.product) return false;
      if (f.fragrance && fragranceKey(prodMap[i.product_id]) !== f.fragrance) return false;
      return true;
    });
  }

  function groupTotals(rows) {
    const groups = new Map();
    rows.forEach(i => {
      const prod = prodMap[i.product_id];
      let key, label;
      if (groupBy === 'supplier') {
        key = supplierKey(i) || NONE_KEY;
        label = supplierLabels.get(supplierKey(i)) || 'Unknown supplier';
      } else if (groupBy === 'product') {
        key = String(i.product_id);
        label = prod?.name || 'Unknown product';
      } else {
        key = fragranceKey(prod);
        label = key === NONE_KEY ? 'No fragrance' : key;
      }
      if (!groups.has(key)) groups.set(key, { key, label, entries: 0, kg: 0, pcs: 0, value: 0, unpriced: 0 });
      const g = groups.get(key);
      g.entries += 1;
      if (prod?.type === 'liquid') g.kg += Number(i.quantity || 0);
      else g.pcs += Number(i.quantity || 0);
      const value = purchaseValue(i);
      if (value === null) g.unpriced += 1;
      else g.value += value;
    });
    return [...groups.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }

  function renderResults() {
    const rows = filtered();
    const totalValue = roundCurrency(rows.reduce((s, i) => s + (purchaseValue(i) || 0), 0));
    const totalKg = rows.reduce((s, i) => s + (prodMap[i.product_id]?.type === 'liquid' ? Number(i.quantity || 0) : 0), 0);
    const totalPcs = rows.reduce((s, i) => s + (prodMap[i.product_id]?.type === 'liquid' ? 0 : Number(i.quantity || 0)), 0);
    const groups = groupTotals(rows);
    const container = document.getElementById('purchase-results');

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon green"><i class="fas fa-indian-rupee-sign"></i></div><div class="stat-info"><div class="stat-label">Total Purchase Value</div><div class="stat-value" id="purchase-total-value">${formatCurrency(totalValue)}</div></div></div>
        <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-receipt"></i></div><div class="stat-info"><div class="stat-label">Purchase Entries</div><div class="stat-value" id="purchase-entry-count">${rows.length}</div></div></div>
        <div class="stat-card"><div class="stat-icon amber"><i class="fas fa-boxes-stacked"></i></div><div class="stat-info"><div class="stat-label">Quantity Bought</div><div class="stat-value" style="font-size:1.1rem;">${formatStock(totalKg, 'liquid')} · ${totalPcs} pcs</div></div></div>
      </div>
      ${intakes.length === 0 ? '<div class="empty-state"><i class="fas fa-truck-ramp-box"></i><h3>No purchases yet</h3><p>Click "Record Purchase" to add stock bought from a supplier.</p></div>' : `
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header">
          <h3>Totals by</h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${[['supplier', 'Supplier'], ['product', 'Product'], ['fragrance', 'Fragrance']].map(([key, label]) =>
              `<button class="btn btn-sm ${groupBy === key ? 'btn-primary active' : 'btn-ghost'} purchase-group-btn" data-group="${key}" style="border-radius:20px;">${label}</button>`).join('')}
          </div>
        </div>
        ${groups.length === 0 ? '<div class="card-body" style="color:var(--text-muted);">No purchases match these filters.</div>' : `
        <div class="table-wrapper"><table class="data-table" id="purchase-group-table">
          <thead><tr><th>${groupBy === 'supplier' ? 'Supplier' : groupBy === 'product' ? 'Product' : 'Fragrance'}</th><th>Entries</th><th>Qty (kg)</th><th>Qty (pcs)</th><th>Value</th></tr></thead>
          <tbody>${groups.map(g => `<tr class="purchase-group-row" data-group-key="${esc(g.key)}">
            <td><strong>${esc(g.label)}</strong></td>
            <td>${g.entries}</td>
            <td class="group-kg">${g.kg ? formatStock(g.kg, 'liquid') : '—'}</td>
            <td class="group-pcs">${g.pcs ? g.pcs + ' pcs' : '—'}</td>
            <td class="group-value" style="font-weight:600;">${formatCurrency(g.value)}${g.unpriced ? ` <span style="color:var(--text-muted);font-weight:400;font-size:0.75rem;" title="Older entries recorded without a rate">(+${g.unpriced} without rate)</span>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
      ${rows.length === 0 ? '<div class="empty-state"><i class="fas fa-filter"></i><h3>No purchases match these filters</h3></div>' : `
      <div class="table-wrapper"><table class="data-table" id="purchase-table">
        <thead><tr><th>Date</th><th>Product</th><th>Fragrance</th><th>Qty</th><th>Rate</th><th>Total</th><th>Supplier</th><th>Bill No.</th></tr></thead>
        <tbody>${rows.map(i => {
          const prod = prodMap[i.product_id];
          const value = purchaseValue(i);
          return `<tr class="purchase-row" data-id="${esc(String(i.id))}">
            <td>${displayDay(purchaseDay(i))}</td>
            <td><strong>${esc(prod?.name || 'Unknown product')}</strong>${i.notes ? `<div style="font-size:0.75rem;color:var(--text-muted);">${esc(i.notes)}</div>` : ''}</td>
            <td>${esc(prod?.fragrance || '—')}</td>
            <td style="color:var(--green);font-weight:600;">+${formatStock(Number(i.quantity || 0), prod?.type)}</td>
            <td class="purchase-rate">${hasRate(i) ? formatPricePerUnit(i.purchase_rate, prod?.type) : '—'}</td>
            <td class="purchase-value" style="font-weight:600;">${value === null ? '—' : formatCurrency(value)}</td>
            <td>${esc(i.supplier || '—')}</td>
            <td>${esc(i.bill_number || '—')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`}`}
    `;

    container.querySelectorAll('.purchase-group-btn').forEach(btn => {
      btn.addEventListener('click', () => { groupBy = btn.dataset.group; renderResults(); });
    });
  }

  ['pf-from', 'pf-to', 'pf-supplier', 'pf-product', 'pf-fragrance'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderResults);
  });
  document.getElementById('pf-clear').addEventListener('click', () => {
    ['pf-from', 'pf-to', 'pf-supplier', 'pf-product', 'pf-fragrance'].forEach(id => { document.getElementById(id).value = ''; });
    renderResults();
  });

  document.getElementById('btn-export-purchases').addEventListener('click', () => {
    const rows = filtered();
    if (rows.length === 0) { showToast('No purchases to export in this view', 'warning'); return; }
    const csvRows = [['Date', 'Product', 'Fragrance', 'Quantity', 'Unit', 'Rate', 'Total', 'Supplier', 'Bill No.', 'Notes']];
    rows.forEach(i => {
      const prod = prodMap[i.product_id];
      const value = purchaseValue(i);
      csvRows.push([
        purchaseDay(i),
        prod?.name || 'Unknown product',
        prod?.fragrance || '',
        i.quantity,
        prod?.type === 'liquid' ? 'kg' : 'pcs',
        hasRate(i) ? i.purchase_rate : '',
        value === null ? '' : value,
        i.supplier || '',
        i.bill_number || '',
        i.notes || '',
      ]);
    });
    const toCsvField = val => {
      if (val === null || val === undefined) return '""';
      return '"' + String(val).replace(/"/g, '""') + '"';
    };
    const csvContent = '﻿' + csvRows.map(r => r.map(toCsvField).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `purchases_export_${localISODate()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  document.getElementById('btn-record-purchase').addEventListener('click', () =>
    openPurchaseModal(products, [...supplierLabels.values()], body, header));

  renderResults();
}

function openPurchaseModal(products, suppliers, body, header) {
  const activeProducts = products.filter(p => p.is_active).sort((a, b) => a.name.localeCompare(b.name));
  if (activeProducts.length === 0) { showToast('Add an active product first', 'warning'); return; }

  const content = `
    <div class="form-group">
      <label class="form-label" for="purchase-product">Product *</label>
      <select class="form-select" id="purchase-product">${activeProducts.map(p =>
        `<option value="${esc(String(p.id))}" data-type="${esc(p.type)}">${esc(p.name)}${p.fragrance ? ' · ' + esc(p.fragrance) : ''} (${p.type === 'liquid' ? 'kg' : 'pcs'})</option>`).join('')}</select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" id="purchase-qty-label" for="purchase-qty">Quantity *</label>
        <input class="form-input" type="number" id="purchase-qty" min="0" step="0.001" required />
      </div>
      <div class="form-group">
        <label class="form-label" id="purchase-rate-label" for="purchase-rate">Purchase Rate *</label>
        <input class="form-input" type="number" id="purchase-rate" min="0" step="0.01" required />
      </div>
    </div>
    <div style="margin:-4px 0 16px;font-size:0.9rem;">Total: <strong id="purchase-total">${formatCurrency(0)}</strong></div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="purchase-supplier">Supplier *</label>
        <input class="form-input" id="purchase-supplier" maxlength="200" list="purchase-supplier-list" required />
        <datalist id="purchase-supplier-list">${suppliers.map(s => `<option value="${esc(s)}"></option>`).join('')}</datalist>
      </div>
      <div class="form-group">
        <label class="form-label" for="purchase-bill">Bill Number</label>
        <input class="form-input" id="purchase-bill" maxlength="100" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="purchase-date">Purchase Date *</label>
      <input class="form-input" type="date" id="purchase-date" value="${localISODate()}" max="${localISODate()}" required />
    </div>
    <div class="form-group">
      <label class="form-label" for="purchase-notes">Notes</label>
      <textarea class="form-textarea" id="purchase-notes" maxlength="500"></textarea>
    </div>
  `;
  const footer = `<button class="btn btn-secondary" id="purchase-cancel">Cancel</button><button class="btn btn-primary" id="purchase-save"><i class="fas fa-save"></i> Save Purchase</button>`;
  const { close } = createModal('Record Purchase', content, { footer });

  const isLiquid = () => {
    const select = document.getElementById('purchase-product');
    return select.options[select.selectedIndex]?.dataset?.type === 'liquid';
  };

  function updateTotal() {
    const qty = parseFloat(document.getElementById('purchase-qty').value);
    const rate = parseFloat(document.getElementById('purchase-rate').value);
    const total = Number.isFinite(qty) && Number.isFinite(rate) ? roundCurrency(qty * rate) : 0;
    document.getElementById('purchase-total').textContent = formatCurrency(total);
  }

  function updateUnitLabels() {
    const liquid = isLiquid();
    document.getElementById('purchase-qty-label').textContent = liquid ? 'Quantity (kg) *' : 'Quantity (pcs) *';
    document.getElementById('purchase-qty').step = liquid ? '0.001' : '1';
    document.getElementById('purchase-rate-label').textContent = liquid ? 'Purchase Rate (₹ per kg) *' : 'Purchase Rate (₹ per pc) *';
  }
  updateUnitLabels();
  document.getElementById('purchase-product').addEventListener('change', updateUnitLabels);
  document.getElementById('purchase-qty').addEventListener('input', updateTotal);
  document.getElementById('purchase-rate').addEventListener('input', updateTotal);

  document.getElementById('purchase-cancel').onclick = close;
  document.getElementById('purchase-save').onclick = (e) => withSaving(e.currentTarget, async () => {
    const productId = parseInt(document.getElementById('purchase-product').value, 10);
    const qty = parseFloat(document.getElementById('purchase-qty').value);
    const rateRaw = document.getElementById('purchase-rate').value.trim();
    const rate = parseFloat(rateRaw);
    const supplier = document.getElementById('purchase-supplier').value.trim();
    const purchaseDate = document.getElementById('purchase-date').value;

    if (!Number.isFinite(qty) || qty <= 0) { showToast('Quantity must be greater than zero', 'error'); return; }
    if (!isLiquid() && !Number.isInteger(qty)) { showToast('Quantity must be a whole number of pieces', 'error'); return; }
    if (rateRaw === '' || !Number.isFinite(rate) || rate < 0) { showToast('Purchase rate must be zero or more', 'error'); return; }
    if (!supplier) { showToast('Supplier is required', 'error'); return; }
    if (!purchaseDate) { showToast('Purchase date is required', 'error'); return; }

    const result = await dbOp(db.rpc('record_purchase', {
      p_product_id: productId,
      p_quantity: isLiquid() ? Math.round(qty * 1000) / 1000 : qty,
      p_purchase_rate: roundCurrency(rate),
      p_supplier: supplier,
      p_bill_number: document.getElementById('purchase-bill').value.trim() || null,
      p_purchase_date: purchaseDate,
      p_notes: document.getElementById('purchase-notes').value.trim() || null,
      p_received_by: auth.currentUser.id,
    }), 'Failed to record purchase');
    if (!result) return;

    showToast('Purchase recorded — stock added', 'success');
    close();
    renderPurchases(body, header);
  });
}
