// ============================================
// UTILITY HELPERS
// ============================================

export function formatCurrency(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function formatWeight(grams) {
  if (grams >= 1000) return (grams / 1000).toFixed(2) + ' kg';
  return grams.toFixed(0) + ' g';
}

export function formatStock(qty, type) {
  if (type === 'liquid') return formatWeight(qty);
  return qty + ' pcs';
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
  toast.innerHTML = `<i class="fas ${icons[type] || icons.success}"></i> ${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// Simple modal helper
export function createModal(title, content, options = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${options.large ? 'modal-lg' : ''}">
      <div class="modal-header">
        <h2>${title}</h2>
        <button class="modal-close" id="modal-close-btn"><i class="fas fa-times"></i></button>
      </div>
      <div class="modal-body">${content}</div>
      ${options.footer ? `<div class="modal-footer">${options.footer}</div>` : ''}
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('#modal-close-btn').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
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
