// Global keyboard shortcuts.
//
// Activated when the focused element is NOT inside an input / textarea / select
// (so typing into a form doesn't trigger them). Modifier-key shortcuts
// (Cmd/Ctrl+K) work regardless.
//
// Shortcuts:
//   ?              — Show shortcuts help modal
//   g d            — Go to Dashboard (sequence: press 'g', then 'd')
//   g p            — Go to Products (admin)
//   g s            — Go to Sales
//   g c            — Go to Collections
//   n              — New item on the current page (clicks the page's primary action button)
//   /              — Focus the search/filter input on the current page (if any)

import { createModal, esc } from './utils/helpers.js';

const SHORTCUTS = [
  { keys: '?', label: 'Show this help' },
  { keys: 'g d', label: 'Go to Dashboard' },
  { keys: 'g p', label: 'Go to Products (admin)' },
  { keys: 'g s', label: 'Go to Sales' },
  { keys: 'g c', label: 'Go to Collections' },
  { keys: 'g r', label: 'Go to Reports (admin)' },
  { keys: 'n', label: 'New item on the current page' },
  { keys: '/', label: 'Focus search / filter on the current page' },
  { keys: 'Esc', label: 'Close modal' },
];

const NAV_MAP = {
  d: 'dashboard',
  p: 'products',
  s: 'sales',
  c: 'collections',
  r: 'reports',
  i: 'inventory-log',
  l: 'damage-loss', // 'l' for loss
};

function isTypingInForm(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

function isModalOpen() {
  return !!document.querySelector('.modal-overlay');
}

function showHelpModal() {
  const rows = SHORTCUTS.map(s => {
    const keys = s.keys.split(' ').map(k => `<kbd>${esc(k)}</kbd>`).join(' then ');
    return `<div>${keys}</div><div>${esc(s.label)}</div>`;
  }).join('');
  createModal('Keyboard Shortcuts', `<div class="shortcuts-list">${rows}</div>`);
}

function clickPrimaryAction() {
  // Convention: each page header has a single .btn-primary — click it.
  const btn = document.querySelector('#page-header .btn-primary, .toolbar .btn-primary');
  if (btn && !btn.disabled) btn.click();
}

function focusSearchOrFilter() {
  // Try, in order: a search input, the first select in the toolbar, then any input.
  const target =
    document.querySelector('#page-body input[type="search"]') ||
    document.querySelector('#page-body input[placeholder*="search" i]') ||
    document.querySelector('#page-body .toolbar select') ||
    document.querySelector('#page-body input:not([type="hidden"])');
  if (target) target.focus();
}

export function installKeyboardShortcuts() {
  let pendingPrefix = null; // for 'g X' sequences
  let pendingTimeout = null;

  function clearPending() {
    pendingPrefix = null;
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }

  document.addEventListener('keydown', (e) => {
    // Don't intercept while user is typing into a form field.
    if (isTypingInForm(e.target)) return;

    // Don't intercept while a modal is open (Esc handler in createModal owns those).
    if (isModalOpen() && e.key !== '?') return;

    // Sequence: g <key> goes to a page.
    if (pendingPrefix === 'g') {
      const page = NAV_MAP[e.key.toLowerCase()];
      clearPending();
      if (page && typeof window.navigateTo === 'function') {
        e.preventDefault();
        window.navigateTo(page);
      }
      return;
    }

    // Single-key shortcuts.
    if (e.key === '?') {
      e.preventDefault();
      showHelpModal();
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      focusSearchOrFilter();
      return;
    }
    if (e.key === 'n') {
      e.preventDefault();
      clickPrimaryAction();
      return;
    }
    if (e.key === 'g') {
      e.preventDefault();
      pendingPrefix = 'g';
      pendingTimeout = setTimeout(clearPending, 1500);
      return;
    }
  });
}
