import { db, auth, supabase } from '../supabase.js';
import { formatCurrency, formatStock, formatDate, showToast, createModal, debounce } from '../utils/helpers.js';

function escapeHtml(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; }

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

function getImageUrl(imageUrl) {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http')) return imageUrl;
  // Build Supabase storage public URL
  return `${SUPABASE_URL}/storage/v1/object/public/product-images/${imageUrl}`;
}

function productImageHtml(product, size = 'card') {
  const url = getImageUrl(product.image_url);
  if (url) {
    const sizeClass = size === 'card' ? 'product-card-img' : '';
    return `<div class="${sizeClass}" style="overflow:hidden;"><img src="${escapeHtml(url)}" alt="${escapeHtml(product.name)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;font-size:2.5rem;color:var(--text-muted);\\' ><i class=\\'fas ${product.type === 'liquid' ? 'fa-flask' : 'fa-box'}\\'></i></div>'" /></div>`;
  }
  return `<div class="product-card-img" style="display:flex;align-items:center;justify-content:center;font-size:2.5rem;color:var(--text-muted);"><i class="fas ${product.type === 'liquid' ? 'fa-flask' : 'fa-box'}"></i></div>`;
}

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
          ${productImageHtml(p)}
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
        <thead><tr><th></th><th>Product</th><th>Category</th><th>Type</th><th>Price</th><th>Stock</th><th>Threshold</th><th>Expiry</th><th>Actions</th></tr></thead>
        <tbody>${filtered.map(p => {
          const cat = catMap[p.category_id];
          const isLow = p.current_stock <= p.min_stock_threshold;
          const imgUrl = getImageUrl(p.image_url);
          return `<tr>
            <td style="width:40px;">${imgUrl ? `<img src="${escapeHtml(imgUrl)}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;" />` : `<i class="fas ${p.type === 'liquid' ? 'fa-flask' : 'fa-box'}" style="color:var(--text-muted);font-size:1.2rem;"></i>`}</td>
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
  const currentImgUrl = getImageUrl(product?.image_url);

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
    <div class="form-group">
      <label class="form-label">Product Image</label>
      <div id="image-upload-area" style="border:2px dashed var(--border);border-radius:8px;padding:16px;text-align:center;cursor:pointer;transition:border-color 0.2s;">
        ${currentImgUrl 
          ? `<div id="image-preview" style="margin-bottom:8px;"><img src="${escapeHtml(currentImgUrl)}" style="max-height:120px;border-radius:8px;object-fit:cover;" /></div>
             <p style="font-size:0.8rem;color:var(--text-muted);margin:0;">Click to change image</p>`
          : `<div id="image-preview"></div>
             <i class="fas fa-cloud-upload-alt" style="font-size:2rem;color:var(--text-muted);margin-bottom:8px;display:block;"></i>
             <p style="font-size:0.8rem;color:var(--text-muted);margin:0;">Click or drag to upload (max 5MB)</p>`
        }
        <input type="file" id="prod-image" accept="image/*" style="display:none;" />
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

  // Image upload handling
  let selectedFile = null;
  const uploadArea = document.getElementById('image-upload-area');
  const fileInput = document.getElementById('prod-image');
  const preview = document.getElementById('image-preview');

  uploadArea.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = 'var(--primary)'; });
  uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = 'var(--border)'; });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = 'var(--border)';
    if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', (e) => { if (e.target.files.length) handleFileSelect(e.target.files[0]); });

  function handleFileSelect(file) {
    if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'error'); return; }
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.innerHTML = `<img src="${e.target.result}" style="max-height:120px;border-radius:8px;object-fit:cover;" />`;
      uploadArea.querySelector('p').textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
      const icon = uploadArea.querySelector('.fa-cloud-upload-alt');
      if (icon) icon.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

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

    const saveBtn = document.getElementById('prod-save-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div>';

    let imageUrl = product?.image_url || null;

    // Upload image if selected
    if (selectedFile && supabase) {
      try {
        const ext = selectedFile.name.split('.').pop().toLowerCase();
        const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(fileName, selectedFile, { contentType: selectedFile.type, upsert: false });
        if (uploadError) {
          showToast('Image upload failed: ' + uploadError.message, 'error');
          saveBtn.disabled = false;
          saveBtn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Create'}`;
          return;
        }
        imageUrl = fileName;
      } catch (err) {
        showToast('Image upload error', 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Create'}`;
        return;
      }
    }

    const record = {
      name, model_number: model || null, category_id: catId, type: cat?.type || 'unit',
      unit_price: price, current_stock: stock, min_stock_threshold: threshold,
      max_daily_consumption: maxDaily, expiry_date: expiry, is_active: true,
      image_url: imageUrl
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
