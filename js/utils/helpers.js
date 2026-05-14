// ============================================
// UTILITY HELPERS
// ============================================

import { reportError } from '../error-tracking.js';

// Centralized configuration thresholds.
// When tuning business rules, adjust here rather than hunting magic numbers.
export const CONFIG = {
  // Show "Expiring Soon" warning when within N days of expiry.
  EXPIRY_WARN_DAYS: 60,
  // Lookahead window for the dashboard "Upcoming Refills" card.
  UPCOMING_REFILL_DAYS: 7,
  // Sales whose expected_payment_date falls within this many days are batched
  // into the dashboard's "Payment Reminders" card.
  PAYMENT_DUE_SOON_DAYS: 7,
  // Sales whose expected_payment_date is within this many days are flagged
  // urgent (red/amber styling in tables and reminder rows).
  PAYMENT_URGENT_DAYS: 3,
  // Fallback for a product without a max_daily_consumption set when deciding
  // whether a return's consumption should be flagged.
  DEFAULT_DAILY_CONSUMPTION: 30,
};

// Round a currency amount to 2 decimal places (matches DECIMAL(12,2) in DB).
// Apply when computing sums or before sending values to db.rpc / db.update —
// otherwise float drift accumulates: 0.1 + 0.2 = 0.30000000000000004.
export function roundCurrency(amount) {
  return Math.round(Number(amount || 0) * 100) / 100;
}

// Wrap an async save handler so the button is disabled + spinner-rendered for
// the duration. Re-enables on completion (success or failure). Idempotent if
// invoked twice while in flight (returns immediately).
//   onclick = (e) => withSaving(e.currentTarget, async () => { ... });
export async function withSaving(btn, fn) {
  if (!btn || btn.dataset.busy === '1') return;
  const orig = btn.innerHTML;
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div>';
  try {
    return await fn();
  } finally {
    // The button may have been removed if fn() closed the modal — guard that.
    if (btn.isConnected) {
      btn.disabled = false;
      btn.innerHTML = orig;
      btn.dataset.busy = '0';
    }
  }
}

// Render a skeleton placeholder. Use before a long fetch so the user sees
// content shape immediately instead of a blank screen / generic spinner.
//   variant: 'card' | 'table' | 'list'
//   count:   how many skeleton blocks to render
// Returns an HTML string (so callers can compose into innerHTML).
export function skeletonHTML(variant = 'card', count = 4) {
  const card = `<div class="skeleton skeleton-card" aria-hidden="true">
    <div class="skeleton-shimmer"></div>
    <div class="skeleton-line skeleton-line--label"></div>
    <div class="skeleton-line skeleton-line--value"></div>
    <div class="skeleton-line skeleton-line--meta"></div>
  </div>`;
  const row = `<div class="skeleton-row" aria-hidden="true">
    <div class="skeleton-line skeleton-line--label"></div>
    <div class="skeleton-line skeleton-line--label" style="width:60%;"></div>
    <div class="skeleton-line skeleton-line--label" style="width:40%;"></div>
  </div>`;
  if (variant === 'card') {
    return `<div class="stats-grid">${Array(count).fill(card).join('')}</div>`;
  }
  if (variant === 'table') {
    return `<div class="skeleton-table">${Array(count).fill(row).join('')}</div>`;
  }
  return `<div class="skeleton-list">${Array(count).fill(row).join('')}</div>`;
}

export function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

// Alias for backward compatibility
export const escapeHtml = esc;

// Safe DB operation wrapper — shows toast on error, returns data or null.
// Also forwards to error-tracking (Sentry) when configured.
export async function dbOp(promise, errorMsg = 'Operation failed') {
  try {
    const result = await promise;
    if (result?.error) {
      console.error(errorMsg, result.error);
      reportError(
        new Error(`${errorMsg}: ${result.error.message || 'Unknown error'}`),
        { kind: 'db-error', supabaseError: result.error }
      );
      showToast(errorMsg + ': ' + (result.error.message || 'Unknown error'), 'error');
      return null;
    }
    return result;
  } catch (err) {
    console.error(errorMsg, err);
    reportError(err, { kind: 'db-throw', errorMsg });
    showToast(errorMsg + ': ' + (err.message || 'Network error'), 'error');
    return null;
  }
}

export function formatCurrency(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Format KG display — always shows KG (e.g., 5.000 kg, 0.900 kg)
export function formatWeight(kg) {
  return (kg || 0).toFixed(3) + ' kg';
}

export function formatStock(qty, type) {
  if (type === 'liquid') return formatWeight(qty);
  return qty + ' pcs';
}

// Format price display — ₹/kg for liquids, ₹/pc for units
export function formatPricePerUnit(price, type) {
  if (type === 'liquid') {
    return '₹' + Number(price || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + '/kg';
  }
  return '₹' + Number(price || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + '/pc';
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(dateStr) {
  const now = new Date();
  const d = new Date(dateStr);
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

export function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Toast notification system
const toastContainer = (() => {
  const el = document.createElement('div');
  el.className = 'toast-container';
  document.body.appendChild(el);
  return el;
})();

export function showToast(message, type = 'success') {
  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  // Build structurally so `message` is treated as text, not HTML.
  // (Stored values like product names can come from form input — never trust them in innerHTML.)
  const icon = document.createElement('i');
  icon.className = `fas ${icons[type] || icons.success}`;
  toast.appendChild(icon);
  toast.appendChild(document.createTextNode(' ' + String(message)));
  toastContainer.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// Simple modal helper.
// `title` is rendered as text (safe). `content` and `options.footer` are rendered as HTML —
// callers MUST pass user data through esc() before composing those strings.
//
// Accessibility:
//   - Captures previously-focused element on open; restores it on close.
//   - Autofocuses the first input/textarea/select after open (one-tick delay).
//   - Traps Tab / Shift+Tab inside the modal.
//   - Closes on Escape.
//   - Closes on backdrop click.
export function createModal(title, content, options = {}) {
  const previouslyFocused = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${options.large ? 'modal-lg' : ''}" tabindex="-1" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2></h2>
        <button class="modal-close" id="modal-close-btn" aria-label="Close"><i class="fas fa-times"></i></button>
      </div>
      <div class="modal-body"></div>
      ${options.footer ? '<div class="modal-footer"></div>' : ''}
    </div>
  `;
  overlay.querySelector('.modal-header h2').textContent = String(title);
  overlay.querySelector('.modal-body').innerHTML = content;
  if (options.footer) {
    overlay.querySelector('.modal-footer').innerHTML = options.footer;
  }
  document.body.appendChild(overlay);

  // Focusable elements selector — used for autofocus and Tab containment.
  const focusableSelector = 'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  const getFocusable = () => Array.from(overlay.querySelectorAll(focusableSelector))
    .filter(el => el.offsetParent !== null);

  // Forward-declare close so escHandler can reference it.
  let close;
  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escHandler);

  close = () => {
    document.removeEventListener('keydown', escHandler);
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
      // Return focus to whatever was focused before the modal opened.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus(); } catch { /* element may have been removed from DOM */ }
      }
    }, 200);
  };

  overlay.querySelector('#modal-close-btn').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Tab containment — keep focus inside the modal while it's open.
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const list = getFocusable();
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });

  // Autofocus first text-input-like element so the user can start typing immediately.
  // One-tick delay so the DOM is laid out and the element is visible.
  setTimeout(() => {
    const list = getFocusable();
    const firstInput = list.find(el => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
    (firstInput || list[0])?.focus();
  }, 0);

  return { overlay, close };
}

// Date range helper for reports
export function getDateRange(preset) {
  const now = new Date();
  const start = new Date();
  switch (preset) {
    case 'today': start.setHours(0, 0, 0, 0); break;
    case '7days': start.setDate(now.getDate() - 7); break;
    case '30days': start.setDate(now.getDate() - 30); break;
    case '90days': start.setDate(now.getDate() - 90); break;
    case 'thisMonth': start.setDate(1); start.setHours(0, 0, 0, 0); break;
    case 'lastMonth':
      start.setMonth(now.getMonth() - 1, 1);
      start.setHours(0, 0, 0, 0);
      now.setDate(0);
      break;
    case 'thisYear': start.setMonth(0, 1); start.setHours(0, 0, 0, 0); break;
    default: start.setDate(now.getDate() - 30);
  }
  return { start: start.toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
}
