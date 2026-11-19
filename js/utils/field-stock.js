// Client-side rules for "Any <category>" issue lines and bills from field
// stock (migration 018). The database functions enforce the same rules; these
// pure helpers let screens show them before saving. Contract:
// knowledge-base/category-issue.md.

const EPS = 1e-9;
const round3 = n => Math.round(Number(n || 0) * 1000) / 1000;

export const OPEN_SESSION_STATUSES = ['checked_out', 'pending_approval'];

// An "Any <category>" issue line: no product, a category, not a child row.
export const isAnyLine = item => item?.product_id == null && item?.parent_item_id == null;

// A per-product row written by submit_return under an Any line.
export const isChildLine = item => item?.parent_item_id != null;

// Rows to show or count per product: once an Any line has been split into
// child rows (return submitted), the children replace it.
export function reportableItems(items) {
  const split = new Set((items || []).filter(isChildLine).map(i => i.parent_item_id));
  return (items || []).filter(i => !split.has(i.id));
}

// Label for an Any line, e.g. "Any Dispenser Refill".
export function anyLineLabel(category) {
  return `Any ${category?.name || 'category'}`;
}

// { categoryId: heldQty } from get_category_holds() rows.
export function holdsMap(rows) {
  const map = {};
  (rows || []).forEach(r => { map[Number(r.category_id)] = round3(r.held); });
  return map;
}

// Free stock of a category on the shelf: Σ product stock − held by open Any lines.
export function categoryFreeStock(categoryId, products, holds = {}) {
  const stock = (products || [])
    .filter(p => p.category_id === categoryId)
    .reduce((sum, p) => sum + Math.max(Number(p.current_stock || 0), 0), 0);
  return round3(stock - Number(holds[categoryId] || 0));
}

// Checks issue lines the way check_issue_availability does. lines:
// [{ product_id?, category_id?, quantity }]. Returns an error message or null.
export function issueProblem(lines, { products, categories, holds = {} }) {
  const prodMap = Object.fromEntries((products || []).map(p => [p.id, p]));
  const catMap = Object.fromEntries((categories || []).map(c => [c.id, c]));
  const byProduct = {};
  const byCategory = {};
  const anySeen = new Set();
  for (const line of lines) {
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return 'Every quantity must be greater than zero';
    if (line.product_id) {
      const p = prodMap[line.product_id];
      if (!p) return 'Unknown product';
      byProduct[p.id] = (byProduct[p.id] || 0) + qty;
      byCategory[p.category_id] = (byCategory[p.category_id] || 0) + qty;
    } else {
      const c = catMap[line.category_id];
      if (!c) return 'Unknown category';
      if (c.type === 'unit' && !Number.isInteger(qty)) return `Any ${c.name} must be whole pieces`;
      if (anySeen.has(c.id)) return `Any ${c.name} is listed twice`;
      anySeen.add(c.id);
      byCategory[c.id] = (byCategory[c.id] || 0) + qty;
    }
  }
  for (const [pid, qty] of Object.entries(byProduct)) {
    const p = prodMap[pid];
    if (qty > Number(p.current_stock || 0) + EPS) return `Insufficient stock for ${p.name}`;
  }
  for (const [cid, qty] of Object.entries(byCategory)) {
    const free = categoryFreeStock(Number(cid), products, holds);
    if (qty > free + EPS) return `Not enough ${catMap[cid]?.name || 'stock'} in the warehouse: ${Math.max(free, 0)} free, ${round3(qty)} asked`;
  }
  return null;
}

// What an open session can still bill from field stock.
//   items: the session's top-level checkout_items
//   soldItems: sale_items of bills already linked to the session
// Returns { products: { productId: remaining on its own lines },
//           categories: { categoryId: remaining on the Any line } }.
export function fieldStockRemaining({ items, soldItems = [], products }) {
  const prodMap = Object.fromEntries((products || []).map(p => [p.id, p]));
  const top = (items || []).filter(i => i.parent_item_id == null);
  const own = {};
  const anyQty = {};
  top.forEach(i => {
    if (i.product_id != null) own[i.product_id] = (own[i.product_id] || 0) + Number(i.checkout_quantity || 0);
    else anyQty[i.category_id] = (anyQty[i.category_id] || 0) + Number(i.checkout_quantity || 0);
  });
  const sold = {};
  soldItems.forEach(si => { sold[si.product_id] = (sold[si.product_id] || 0) + Number(si.quantity || 0); });

  const remainingOwn = { ...own };
  const remainingAny = { ...anyQty };
  Object.entries(sold).forEach(([pid, qty]) => {
    const fromOwn = Math.min(qty, remainingOwn[pid] || 0);
    if (remainingOwn[pid] != null) remainingOwn[pid] = round3(remainingOwn[pid] - fromOwn);
    const overflow = round3(qty - fromOwn);
    const catId = prodMap[pid]?.category_id;
    if (overflow > EPS && remainingAny[catId] != null) remainingAny[catId] = round3(remainingAny[catId] - overflow);
  });
  return { products: remainingOwn, categories: remainingAny };
}

// Error message if adding billItems ([{ product_id, quantity }]) to a session's
// field stock would sell more than it issued (check_field_sale_capacity), else null.
export function fieldBillProblem({ items, soldItems = [], products, billItems }) {
  const prodMap = Object.fromEntries((products || []).map(p => [p.id, p]));
  const top = (items || []).filter(i => i.parent_item_id == null);
  const all = [...soldItems, ...billItems];
  const sold = {};
  all.forEach(si => { sold[si.product_id] = (sold[si.product_id] || 0) + Number(si.quantity || 0); });
  const overflowByCat = {};
  for (const [pid, qty] of Object.entries(sold)) {
    const p = prodMap[pid];
    const own = top.filter(i => i.product_id === Number(pid)).reduce((s, i) => s + Number(i.checkout_quantity || 0), 0);
    const overflow = round3(qty - own);
    if (overflow > EPS) {
      if (!top.some(i => isAnyLine(i) && i.category_id === p?.category_id)) {
        return own > 0
          ? `Only ${own} ${p?.name || 'pieces'} were issued to this staff member`
          : `${p?.name || 'This product'} was not issued to this staff member`;
      }
      overflowByCat[p.category_id] = (overflowByCat[p.category_id] || 0) + overflow;
    }
  }
  for (const [cid, overflow] of Object.entries(overflowByCat)) {
    const anyLine = top.find(i => isAnyLine(i) && i.category_id === Number(cid));
    if (overflow > Number(anyLine.checkout_quantity) + EPS) {
      return `These bills sell ${round3(overflow)} from the Any line, but only ${anyLine.checkout_quantity} were issued`;
    }
  }
  return null;
}

// Splits bills linked to a session across its issue lines the way
// submit_return does: a product's own lines first (in id order, up to their
// issued quantity), the rest to the Any line of its category.
//   items: top-level checkout_items of the session
//   soldLines: [{ product_id, sale_id, party_id, quantity }] (one per bill and product)
// Returns { byItem: { itemId: [{ product_id, sale_id, party_id, quantity }] }, unallocated: [...] }.
export function allocateSold({ items, soldLines = [], products }) {
  const prodMap = Object.fromEntries((products || []).map(p => [p.id, p]));
  const top = (items || []).filter(i => i.parent_item_id == null).slice().sort((a, b) => a.id - b.id);
  const left = soldLines
    .map(l => ({ ...l, quantity: Number(l.quantity || 0) }))
    .sort((a, b) => a.sale_id - b.sale_id);
  const byItem = {};
  const push = (itemId, line, qty) => { (byItem[itemId] = byItem[itemId] || []).push({ ...line, quantity: round3(qty) }); };

  top.filter(i => i.product_id != null).forEach(item => {
    let taken = 0;
    for (const line of left) {
      if (line.product_id !== item.product_id || line.quantity <= EPS) continue;
      const take = round3(Math.min(line.quantity, Number(item.checkout_quantity || 0) - taken));
      if (take <= 0) break;
      push(item.id, line, take);
      line.quantity = round3(line.quantity - take);
      taken = round3(taken + take);
    }
  });
  top.filter(isAnyLine).forEach(item => {
    for (const line of left) {
      if (line.quantity <= EPS || prodMap[line.product_id]?.category_id !== item.category_id) continue;
      push(item.id, line, line.quantity);
      line.quantity = 0;
    }
  });
  return { byItem, unallocated: left.filter(l => l.quantity > EPS) };
}
