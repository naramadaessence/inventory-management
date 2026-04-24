import { db, auth } from '../supabase.js';
import { formatCurrency, formatStock, formatDate, showToast, createModal, debounce } from '../utils/helpers.js';

function escapeHtml(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; }

export async function renderProducts(body, header) {
  if (!auth.isAdmin()) { body.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3></div>'; return; }

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Products</h1>
      <div class="page-header-subtitle">Manage your product catalog & stock levels</div>
    </div>
    <button class="btn btn-primary" id="btn-add-product"><i class="fas fa-plus"></i> Add Product</button>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  const { data: products } = await db.getAll('products');
  const { data: categories } = await db.getAll('categories');
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

  body.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-input">
          <i class="fas fa-search"></i>
          <input class="form-input" id="product-search" placeholder="Search products..." />
        </div>
        <select class="form-select" id="product-filter-cat" style="width:180px;">
          <option value="">All Categories</option>
          ${categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="toolbar-right">
        <select class="form-select" id="product-view" style="width:120px;">
          <option value="grid">Grid View</option>
          <option value="table">Table View</option>
        </select>
      </div>
    </div>
    <div id="products-container"></div>
  `;

  let view = 'grid';
  let searchTerm = '';
  let filterCat = '';

  function renderList() {
    let filtered = products.filter(p => p.is_active !== false);
    if (searchTerm) filtered = filtered.filter(p => p.name.toLowerCase().includes(searchTerm));
    if (filterCat) filtered = filtered.filter(p => p.category_id == filterCat);

    const container = document.getElementById('products-container');
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><h3>No products found</h3></div>';
      return;
    }

    if (view === 'grid') {
      container.innerHTML = `<div class="product-grid">${filtered.map(p => {
        const cat = catMap[p.category_id];
        const isLow = p.current_stock <= p.min_stock_threshold;
        return `<div class="product-card" data-id="${p.id}">
          <div class="product-card-img" style="display:flex;align-items:center;justify-content:center;font-size:2.5rem;color:var(--text-muted);">
            <i class="fas ${p.type === 'liquid' ? 'fa-flask' : 'fa-box'}"></i>
          </div>
          <div class="product-card-body">
            <h4 title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h4>
            <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(cat?.name || '—')} · ${formatCurrency(p.unit_price)}${p.type === 'liquid' ? '/g' : '/pc'}</div>
            <div class="product-card-meta">
              <span class="product-card-stock" style="${isLow ? 'color:var(--red);font-weight:600;' : ''}">${isLow ? '⚠ ' : ''}${formatStock(p.current_stock, p.type)}</span>
              <span class="product-card-type ${p.type}">${p.type}</span>
            </div>
          </div>
        </div>`;
      }).join('')}</div>`;
    } else {
      container.innerHTML = `<div class="table-wrapper"><table class="data-table">
        <thead><tr><th>Product</th><th>Category</th><th>Type</th><th>Price</th><th>Stock</th><th>Threshold</th><th>Expiry</th><th>Actions</th></tr></thead>
        <tbody>${filtered.map(p => {
          const cat = catMap[p.category_id];
          const isLow = p.current_stock <= p.min_stock_threshold;
          return `<tr>
            <td><strong>${escapeHtml(p.name)}</strong>${p.model_number ? `<br><small style="color:var(--text-muted);">${escapeHtml(p.model_number)}</small>` : ''}</td>
            <td>${escapeHtml(cat?.name || '—')}</td>
            <td><span class="badge-status ${p.type === 'liquid' ? 'purple' : 'blue'}">${p.type}</span></td>
            <td>${formatCurrency(p.unit_price)}${p.type === 'liquid' ? '/g' : ''}</td>
            <td style="${isLow ? 'color:var(--red);font-weight:700;' : ''}">${isLow ? '⚠ ' : ''}${formatStock(p.current_stock, p.type)}</td>
            <td>${formatStock(p.min_stock_threshold, p.type)}</td>
            <td>${formatDate(p.expiry_date)}</td>
            <td><button class="btn btn-sm btn-ghost product-edit-btn" data-id="${p.id}"><i class="fas fa-pen"></i></button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    }

    // Card & row click handlers
    container.querySelectorAll('.product-card').forEach(el => el.addEventListener('click', () => openProductModal(products.find(p => p.id == el.dataset.id), categories)));
    container.querySelectorAll('.product-edit-btn').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); openProductModal(products.find(p => p.id == el.dataset.id), categories); }));
  }

  document.getElementById('product-search').addEventListener('input', debounce(e => { searchTerm = e.target.value.toLowerCase().trim(); renderList(); }));
  document.getElementById('product-filter-cat').addEventListener('change', e => { filterCat = e.target.value; renderList(); });
  document.getElementById('product-view').addEventListener('change', e => { view = e.target.value; renderList(); });
  document.getElementById('btn-add-product').addEventListener('click', () => openProductModal(null, categories));

  renderList();
}

function openProductModal(product, categories) {
  const isEdit = !!product;
  const title = isEdit ? 'Edit Product' : 'Add New Product';

  const formHtml = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Product Name *</label>
        <input class="form-input" id="prod-name" value="${escapeHtml(product?.name || '')}" required maxlength="200" />
      </div>
      <div class="form-group">
        <label class="form-label">Model Number</label>
        <input class="form-input" id="prod-model" value="${escapeHtml(product?.model_number || '')}" maxlength="50" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Category *</label>
        <select class="form-select" id="prod-category">
          ${categories.map(c => `<option value="${c.id}" ${product?.category_id == c.id ? 'selected' : ''}>${escapeHtml(c.name)} (${c.type})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Unit Price (₹) *</label>
        <input class="form-input" type="number" id="prod-price" value="${product?.unit_price || ''}" min="0" step="0.01" required />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Current Stock ${product?.type === 'liquid' ? '(grams)' : '(pieces)'} *</label>
        <input class="form-input" type="number" id="prod-stock" value="${product?.current_stock || 0}" min="0" step="${product?.type === 'liquid' ? '0.1' : '1'}" required />
      </div>
      <div class="form-group">
        <label class="form-label">Min Stock Threshold *</label>
        <input class="form-input" type="number" id="prod-threshold" value="${product?.min_stock_threshold || 10}" min="0" required />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Max Daily Consumption</label>
        <input class="form-input" type="number" id="prod-maxdaily" value="${product?.max_daily_consumption || ''}" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">Expiry Date</label>
        <input class="form-input" type="date" id="prod-expiry" value="${product?.expiry_date || ''}" />
      </div>
    </div>
  `;

  const footer = `
    ${isEdit ? '<button class="btn btn-danger" id="prod-delete-btn"><i class="fas fa-trash"></i> Delete</button>' : ''}
    <div style="flex:1;"></div>
    <button class="btn btn-secondary" id="prod-cancel-btn">Cancel</button>
    <button class="btn btn-primary" id="prod-save-btn"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Create'}</button>
  `;

  const { close } = createModal(title, formHtml, { footer });

  document.getElementById('prod-cancel-btn').onclick = close;

  document.getElementById('prod-save-btn').onclick = async () => {
    const name = document.getElementById('prod-name').value.trim();
    const model = document.getElementById('prod-model').value.trim();
    const catId = parseInt(document.getElementById('prod-category').value);
    const price = parseFloat(document.getElementById('prod-price').value);
    const stock = parseFloat(document.getElementById('prod-stock').value);
    const threshold = parseFloat(document.getElementById('prod-threshold').value);
    const maxDaily = parseFloat(document.getElementById('prod-maxdaily').value) || null;
    const expiry = document.getElementById('prod-expiry').value || null;
    const cat = categories.find(c => c.id === catId);

    // Validation
    if (!name || name.length < 2) { showToast('Product name is required (min 2 chars)', 'error'); return; }
    if (isNaN(price) || price < 0) { showToast('Valid price is required', 'error'); return; }
    if (isNaN(stock) || stock < 0) { showToast('Valid stock quantity is required', 'error'); return; }
    if (isNaN(threshold) || threshold < 0) { showToast('Valid threshold is required', 'error'); return; }

    const record = {
      name, model_number: model || null, category_id: catId, type: cat?.type || 'unit',
      unit_price: price, current_stock: stock, min_stock_threshold: threshold,
      max_daily_consumption: maxDaily, expiry_date: expiry, is_active: true
    };

    if (isEdit) {
      await db.update('products', product.id, record);
      showToast('Product updated', 'success');
    } else {
      await db.insert('products', record);
      showToast('Product created', 'success');
    }
    close();
    const body = document.getElementById('page-body');
    const hdr = document.getElementById('page-header');
    renderProducts(body, hdr);
  };

  if (isEdit) {
    document.getElementById('prod-delete-btn').onclick = async () => {
      if (confirm(`Delete "${product.name}"? This cannot be undone.`)) {
        await db.update('products', product.id, { is_active: false });
        showToast('Product deactivated', 'warning');
        close();
        const body = document.getElementById('page-body');
        const hdr = document.getElementById('page-header');
        renderProducts(body, hdr);
      }
    };
  }
}
