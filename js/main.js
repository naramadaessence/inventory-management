import { auth } from './supabase.js';
import { renderLogin } from './pages/login.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderProducts } from './pages/products.js';
import { renderDailyOps } from './pages/daily-operations.js';
import { renderSales } from './pages/sales.js';
import { renderCollections } from './pages/collections.js';
import { renderParties } from './pages/parties.js';
import { renderRentals } from './pages/rentals.js';
import { renderInstallations } from './pages/installations.js';
import { renderDamageLoss } from './pages/damage-loss.js';
import { renderInventoryLog } from './pages/inventory-log.js';
import { renderReports } from './pages/reports.js';
import { renderSettings } from './pages/settings.js';

const app = document.getElementById('app');
let currentPage = 'dashboard';

// ============================================
// NAV ITEMS
// ============================================
const adminNav = [
  { section: 'Overview' },
  { id: 'dashboard', icon: 'fa-th-large', label: 'Dashboard' },
  { section: 'Inventory' },
  { id: 'products', icon: 'fa-boxes-stacked', label: 'Products' },
  { id: 'daily-ops', icon: 'fa-right-left', label: 'Daily Operations' },
  { id: 'inventory-log', icon: 'fa-list-check', label: 'Inventory Log' },
  { section: 'Business' },
  { id: 'sales', icon: 'fa-indian-rupee-sign', label: 'Sales' },
  { id: 'collections', icon: 'fa-money-bill-wave', label: 'Collections' },
  { id: 'parties', icon: 'fa-users', label: 'Parties' },
  { id: 'rentals', icon: 'fa-handshake', label: 'Rentals' },
  { id: 'installations', icon: 'fa-tools', label: 'Installations' },
  { section: 'Tracking' },
  { id: 'damage-loss', icon: 'fa-triangle-exclamation', label: 'Damage & Loss' },
  { id: 'reports', icon: 'fa-chart-line', label: 'Reports' },
  { section: 'System' },
  { id: 'settings', icon: 'fa-gear', label: 'Settings' },
];

const sellerNav = [
  { section: 'My Area' },
  { id: 'dashboard', icon: 'fa-th-large', label: 'My Checkouts' },
  { id: 'daily-ops', icon: 'fa-right-left', label: 'Daily Operations' },
  { section: 'Business' },
  { id: 'collections', icon: 'fa-money-bill-wave', label: 'Collections' },
];

// ============================================
// RENDER APP SHELL
// ============================================
function renderShell() {
  const user = auth.currentUser;
  const nav = auth.isAdmin() ? adminNav : sellerNav;
  const initials = user.full_name.split(' ').map(w => w[0]).join('').toUpperCase();

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-brand">
            <span class="sidebar-brand-icon">🌿</span>
            <div class="sidebar-brand-text">
              <h2>Narmada Essence</h2>
              <span>Inventory Manager</span>
            </div>
          </div>
        </div>
        <nav class="sidebar-nav" id="sidebar-nav"></nav>
        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="sidebar-user-avatar">${initials}</div>
            <div class="sidebar-user-info">
              <div class="name">${user.full_name}</div>
              <div class="role">${user.role}</div>
            </div>
            <button class="btn-logout" id="btn-logout" title="Logout">
              <i class="fas fa-sign-out-alt"></i>
            </button>
          </div>
        </div>
      </aside>
      <main class="main-content">
        <header class="page-header" id="page-header">
          <div>
            <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
          </div>
          <div></div>
        </header>
        <div class="page-body" id="page-body">
          <div class="loading-overlay"><div class="spinner"></div></div>
        </div>
      </main>
    </div>
  `;

  // Build nav
  const navEl = document.getElementById('sidebar-nav');
  nav.forEach(item => {
    if (item.section) {
      navEl.innerHTML += `<div class="nav-section-title">${item.section}</div>`;
    } else {
      navEl.innerHTML += `
        <div class="nav-item ${item.id === currentPage ? 'active' : ''}" data-page="${item.id}">
          <i class="fas ${item.icon}"></i>
          <span>${item.label}</span>
        </div>
      `;
    }
  });

  // Nav click handlers
  navEl.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      currentPage = el.dataset.page;
      navigateTo(currentPage);
    });
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await auth.logout();
    init();
  });

  // Mobile toggle
  document.getElementById('mobile-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  navigateTo(currentPage);
}

// ============================================
// PAGE ROUTER
// ============================================
function navigateTo(page) {
  currentPage = page;

  // Update active nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Close mobile sidebar
  document.getElementById('sidebar')?.classList.remove('open');

  // Route to page
  const body = document.getElementById('page-body');
  const header = document.getElementById('page-header');

  const pages = {
    'dashboard': () => renderDashboard(body, header),
    'products': () => renderProducts(body, header),
    'daily-ops': () => renderDailyOps(body, header),
    'sales': () => renderSales(body, header),
    'collections': () => renderCollections(body, header),
    'parties': () => renderParties(body, header),
    'rentals': () => renderRentals(body, header),
    'installations': () => renderInstallations(body, header),
    'damage-loss': () => renderDamageLoss(body, header),
    'inventory-log': () => renderInventoryLog(body, header),
    'reports': () => renderReports(body, header),
    'settings': () => renderSettings(body, header),
  };

  if (pages[page]) {
    pages[page]();
  } else {
    body.innerHTML = '<div class="empty-state"><i class="fas fa-question-circle"></i><h3>Page not found</h3></div>';
  }
}

// Make navigateTo globally available for pages that need sub-navigation
window.navigateTo = navigateTo;

// ============================================
// INIT
// ============================================
async function init() {
  const user = await auth.getSession();
  if (user) {
    renderShell();
  } else {
    renderLogin(app, init);
  }
}

init();
