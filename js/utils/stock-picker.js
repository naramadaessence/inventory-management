// Searchable stock picker for the Issue Stock / Request Stock window
// (Daily Operations). Search box + category chips, results grouped by
// category with an "Any <category>" row (free stock) at the top of each group.
// Contract for Any lines: knowledge-base/category-issue.md.

import { esc, formatStock } from './helpers.js';
import { anyLineLabel, categoryFreeStock } from './field-stock.js';

const words = q => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
const matches = (haystack, ws) => ws.every(w => haystack.includes(w));

// root: element to render into.
// options:
//   products     active products that can be picked
//   allProducts  every product (free stock counts inactive ones too, like the server)
//   categories   all categories
//   holds        holdsMap() of open Any lines
//   allowOut     true: out-of-stock rows stay pickable (seller requests); false: greyed out
//   inList(kind, id) → quantity already in the list (0 if none), for the "in list" tag
//   onPick({ kind: 'product' | 'any', id })
// Returns { refresh() } — call after the list changes.
export function createStockPicker(root, { products, allProducts, categories, holds = {}, allowOut = false, inList = () => 0, onPick }) {
  const cats = (categories || []).slice().sort((a, b) => a.id - b.id);
  const catIds = new Set(cats.map(c => c.id));
  const groups = cats
    .map(c => ({ id: c.id, category: c, products: products.filter(p => p.category_id === c.id) }))
    .filter(g => g.products.length);
  const orphans = products.filter(p => !catIds.has(p.category_id));
  if (orphans.length) groups.push({ id: 'none', category: null, products: orphans });
  groups.forEach(g => g.products.sort((a, b) => String(a.name).localeCompare(String(b.name))));

  let activeCat = 'all';
  let query = '';

  root.innerHTML = `<div class="sp-picker">
      <div class="sp-search-wrap">
        <i class="fas fa-search" aria-hidden="true"></i>
        <input class="form-input sp-search" type="search" placeholder="Search products or categories…" aria-label="Search products" autocomplete="off" />
      </div>
      <div class="sp-chips" role="group" aria-label="Filter by category">
        <button type="button" class="sp-chip active" data-cat="all">All</button>
        ${groups.map(g => `<button type="button" class="sp-chip" data-cat="${g.id}">${esc(g.category?.name || 'Other')}</button>`).join('')}
      </div>
      <div class="sp-results" aria-live="polite"></div>
    </div>`;
  const results = root.querySelector('.sp-results');

  const typeOf = g => g.category?.type || g.products[0]?.type;

  function rowHTML({ kind, id, name, stock, type, low, any }) {
    const out = stock <= 0;
    const disabled = out && !allowOut;
    const added = Number(inList(kind, id) || 0);
    const badge = out
      ? `<span class="sp-badge is-out">${any ? 'None free' : 'Out of stock'}</span>`
      : `<span class="sp-badge${low ? ' is-low' : ''}">${formatStock(stock, type)}${any ? ' free' : ''}</span>`;
    const title = disabled ? 'Out of stock — cannot be issued'
      : out ? 'Out of stock — admin must add stock before approving' : '';
    return `<button type="button" class="sp-row${any ? ' is-any' : ''}${out ? ' is-out' : ''}" data-kind="${kind}" data-id="${id}"${disabled ? ' disabled aria-disabled="true"' : ''}${title ? ` title="${esc(title)}"` : ''}>
        <span class="sp-row-name">${any ? '<i class="fas fa-layer-group" aria-hidden="true"></i> ' : ''}${esc(name)}${any ? '<small>types named on return</small>' : ''}${out && allowOut ? '<small class="sp-warn"><i class="fas fa-triangle-exclamation"></i> Out of stock — admin will review</small>' : ''}</span>
        <span class="sp-row-side">${added > 0 ? `<span class="sp-added"><i class="fas fa-check"></i> ${formatStock(added, type)}</span>` : ''}${badge}</span>
      </button>`;
  }

  function render() {
    const ws = words(query);
    const scroll = results.scrollTop;
    const shown = groups.filter(g => activeCat === 'all' || String(g.id) === activeCat).map(g => {
      const catName = String(g.category?.name || '').toLowerCase();
      const anyText = `any ${catName}`;
      const catHit = ws.length && matches(anyText, ws);
      const items = ws.length && !catHit
        ? g.products.filter(p => matches(`${p.name} ${p.model_number || ''} ${p.fragrance || ''} ${catName}`.toLowerCase(), ws))
        : g.products;
      return { g, items };
    }).filter(({ items }) => items.length);

    if (!shown.length) {
      results.innerHTML = `<div class="sp-empty">No products match “${esc(query.trim())}”.</div>`;
      return;
    }
    results.innerHTML = shown.map(({ g, items }) => {
      const type = typeOf(g);
      const anyRow = g.category ? rowHTML({
        kind: 'any', id: g.id, any: true, type,
        name: anyLineLabel(g.category),
        stock: categoryFreeStock(g.id, allProducts, holds),
      }) : '';
      return `<div class="sp-group" data-cat="${g.id}">
          <div class="sp-group-title">${esc(g.category?.name || 'Other')}</div>
          ${anyRow}
          ${items.map(p => rowHTML({
            kind: 'product', id: p.id, name: p.name, type: p.type,
            stock: Number(p.current_stock || 0),
            low: Number(p.current_stock || 0) <= Number(p.min_stock_threshold || 0),
          })).join('')}
        </div>`;
    }).join('');
    results.scrollTop = scroll;
  }

  root.querySelector('.sp-search').addEventListener('input', e => { query = e.target.value; render(); });
  root.querySelector('.sp-chips').addEventListener('click', e => {
    const chip = e.target.closest('.sp-chip');
    if (!chip) return;
    activeCat = chip.dataset.cat;
    root.querySelectorAll('.sp-chip').forEach(c => c.classList.toggle('active', c === chip));
    render();
  });
  results.addEventListener('click', e => {
    const row = e.target.closest('.sp-row');
    if (!row || row.disabled) return;
    onPick({ kind: row.dataset.kind, id: Number(row.dataset.id) });
  });

  render();
  return { refresh: render };
}
