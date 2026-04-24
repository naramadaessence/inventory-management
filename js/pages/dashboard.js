import { db, auth } from '../supabase.js';
import { formatCurrency, formatStock, formatDateTime, daysUntil, showToast, escapeHtml } from '../utils/helpers.js';

export async function renderDashboard(body, header) {
  const isAdmin = auth.isAdmin();

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>${isAdmin ? 'Dashboard' : 'My Checkouts'}</h1>
      <div class="page-header-subtitle">${isAdmin ? 'Warehouse overview & alerts' : 'Your checkout history'}</div>
    </div>
    <div style="font-size:0.85rem;color:var(--text-muted);">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  if (!isAdmin) {
    await renderSellerView(body);
    return;
  }

  const { data: products } = await db.getAll('products');
  const { data: sessions } = await db.getAll('checkout_sessions');
  const { data: sales } = await db.getAll('sales');
  const { data: rentals } = await db.getAll('rentals');
  const { data: damages } = await db.getAll('damage_reports');
  const { data: amcParties } = await db.getAll('parties');

  const activeCheckouts = sessions.filter(s => s.status === 'checked_out').length;
  const flaggedSessions = sessions.filter(s => s.status === 'flagged').length;
  const lowStockProducts = products.filter(p => p.is_active && p.current_stock <= p.min_stock_threshold);
  const expiringProducts = products.filter(p => p.is_active && p.expiry_date && daysUntil(p.expiry_date) <= 60 && daysUntil(p.expiry_date) > 0);
  const expiredProducts = products.filter(p => p.is_active && p.expiry_date && daysUntil(p.expiry_date) <= 0);
  const totalStockValue = products.reduce((sum, p) => sum + (p.current_stock * p.unit_price), 0);
  const activeRentals = rentals.filter(r => r.status === 'active').length;
  const totalSalesValue = sales.reduce((sum, s) => sum + (s.total_amount || 0), 0);
  const alertCount = lowStockProducts.length + flaggedSessions + expiredProducts.length;

  // AMC Worklist
  const today = new Date().getDate();
  const amcEnabled = amcParties.filter(p => p.amc_active && p.amc_day);
  const todaysRefills = amcEnabled.filter(p => p.amc_day === today);
  const upcoming7Days = [];
  for (let d = 1; d <= 7; d++) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + d);
    const futureDay = futureDate.getDate();
    const partiesOnDay = amcEnabled.filter(p => p.amc_day === futureDay);
    if (partiesOnDay.length > 0) {
      upcoming7Days.push({ date: futureDate, day: futureDay, parties: partiesOnDay });
    }
  }

  const amcWorklistHtml = todaysRefills.length > 0 ? `
    <div class="card" style="margin-bottom:20px;border-left:4px solid var(--primary);">
      <div class="card-header">
        <h3><i class="fas fa-calendar-check" style="color:var(--primary);margin-right:8px;"></i>Today's AMC Refill Worklist</h3>
        <span class="badge-status green">${todaysRefills.length} visits</span>
      </div>
      <div class="card-body">
        <div class="alert-list">
          ${todaysRefills.map(p => `<div class="alert-item" style="background:var(--primary-soft);">
            <i class="fas fa-map-marker-alt" style="color:var(--primary);"></i>
            <div style="flex:1;">
              <strong>${escapeHtml(p.name)}</strong>
              <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(p.address || 'No address')} · ${escapeHtml(p.phone || 'No phone')}</div>
            </div>
            <button class="btn btn-sm btn-primary" onclick="window.navigateTo('parties')">View</button>
          </div>`).join('')}
        </div>
      </div>
    </div>` : '';

  const upcomingHtml = upcoming7Days.length > 0 ? `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header">
        <h3><i class="fas fa-calendar-alt" style="color:var(--blue);margin-right:8px;"></i>Upcoming Refills (7 Days)</h3>
      </div>
      <div class="card-body">
        <div class="alert-list">
          ${upcoming7Days.map(entry => entry.parties.map(p => `<div class="alert-item">
            <i class="fas fa-clock" style="color:var(--blue);"></i>
            <div style="flex:1;">
              <strong>${escapeHtml(p.name)}</strong>
              <div style="font-size:0.75rem;color:var(--text-muted);">${entry.date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} — ${escapeHtml(p.address || 'No address')}</div>
            </div>
          </div>`).join('')).join('')}
        </div>
      </div>
    </div>` : '';

  body.innerHTML = `
    ${amcWorklistHtml}
    ${upcomingHtml}
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon amber"><i class="fas fa-warehouse"></i></div>
        <div class="stat-info">
          <div class="stat-label">Total Stock Value</div>
          <div class="stat-value">${formatCurrency(totalStockValue)}</div>
          <div class="stat-change">${products.filter(p=>p.is_active).length} active products</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fas fa-right-left"></i></div>
        <div class="stat-info">
          <div class="stat-label">Active Checkouts</div>
          <div class="stat-value">${activeCheckouts}</div>
          <div class="stat-change ${flaggedSessions ? 'down' : ''}">${flaggedSessions ? flaggedSessions + ' flagged' : 'No flags'}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="fas fa-indian-rupee-sign"></i></div>
        <div class="stat-info">
          <div class="stat-label">Total Sales</div>
          <div class="stat-value">${formatCurrency(totalSalesValue)}</div>
          <div class="stat-change">${sales.length} transactions</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon ${alertCount > 0 ? 'red' : 'green'}"><i class="fas ${alertCount > 0 ? 'fa-bell' : 'fa-check-circle'}"></i></div>
        <div class="stat-info">
          <div class="stat-label">Alerts</div>
          <div class="stat-value">${alertCount}</div>
          <div class="stat-change ${alertCount > 0 ? 'down' : 'up'}">${alertCount > 0 ? 'Needs attention' : 'All clear'}</div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-exclamation-triangle" style="color:var(--red);margin-right:8px;"></i>Low Stock Alerts</h3>
          <span class="badge-status ${lowStockProducts.length ? 'red' : 'green'}">${lowStockProducts.length} items</span>
        </div>
        <div class="card-body" id="low-stock-list"></div>
      </div>
      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-clock" style="color:var(--accent);margin-right:8px;"></i>Expiring Soon</h3>
          <span class="badge-status ${expiringProducts.length ? 'amber' : 'green'}">${expiringProducts.length + expiredProducts.length} items</span>
        </div>
        <div class="card-body" id="expiry-list"></div>
      </div>
    </div>

    <div style="margin-top:20px;">
      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-money-bill-wave" style="color:var(--red);margin-right:8px;"></i>Payment Reminders</h3>
          <button class="btn btn-sm btn-secondary" onclick="window.navigateTo('collections')">View All</button>
        </div>
        <div class="card-body" id="payment-reminders"></div>
      </div>
    </div>

    <div style="margin-top:20px;">
      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-history" style="color:var(--blue);margin-right:8px;"></i>Recent Activity</h3>
        </div>
        <div class="card-body" id="recent-activity"></div>
      </div>
    </div>
  `;

  // Low stock list
  const lowStockEl = document.getElementById('low-stock-list');
  if (lowStockProducts.length === 0) {
    lowStockEl.innerHTML = '<div class="empty-state" style="padding:20px;"><i class="fas fa-check-circle" style="font-size:1.5rem;color:var(--green);"></i><p style="color:var(--text-secondary);margin-top:8px;">All products are well-stocked</p></div>';
  } else {
    lowStockEl.innerHTML = '<div class="alert-list">' + lowStockProducts.map(p => {
      const pName = escapeHtml(p.name);
      const stockStr = formatStock(p.current_stock, p.type);
      const threshStr = formatStock(p.min_stock_threshold, p.type);
      const pct = Math.round((p.current_stock / p.min_stock_threshold) * 100);
      return `<div class="alert-item danger">
        <i class="fas fa-arrow-down"></i>
        <div style="flex:1;">
          <strong>${pName}</strong>
          <div style="font-size:0.75rem;opacity:0.8;">Stock: ${stockStr} (min: ${threshStr}) — ${pct}% of threshold</div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="window.navigateTo('products')">View</button>
      </div>`;
    }).join('') + '</div>';
  }

  // Expiry list
  const expiryEl = document.getElementById('expiry-list');
  const allExpiry = [...expiredProducts.map(p => ({...p, _expired: true})), ...expiringProducts];
  if (allExpiry.length === 0) {
    expiryEl.innerHTML = '<div class="empty-state" style="padding:20px;"><i class="fas fa-check-circle" style="font-size:1.5rem;color:var(--green);"></i><p style="color:var(--text-secondary);margin-top:8px;">No products expiring soon</p></div>';
  } else {
    expiryEl.innerHTML = '<div class="alert-list">' + allExpiry.map(p => {
      const days = daysUntil(p.expiry_date);
      const pName = escapeHtml(p.name);
      const cls = p._expired ? 'danger' : 'warning';
      const label = p._expired ? 'EXPIRED' : `${days} days left`;
      return `<div class="alert-item ${cls}">
        <i class="fas ${p._expired ? 'fa-times-circle' : 'fa-clock'}"></i>
        <div style="flex:1;">
          <strong>${pName}</strong>
          <div style="font-size:0.75rem;opacity:0.8;">${label} — Expires: ${p.expiry_date}</div>
        </div>
      </div>`;
    }).join('') + '</div>';
  }

  // Recent activity
  const recentEl = document.getElementById('recent-activity');

  // Payment reminders
  const payRemEl = document.getElementById('payment-reminders');
  const pendingSales = sales.filter(s => s.payment_status === 'pending' || s.payment_status === 'partial');
  const overdueSales = pendingSales.filter(s => s.expected_payment_date && daysUntil(s.expected_payment_date) < 0);
  const dueSoonSales = pendingSales.filter(s => s.expected_payment_date && daysUntil(s.expected_payment_date) >= 0 && daysUntil(s.expected_payment_date) <= 7);
  const noDateSales = pendingSales.filter(s => !s.expected_payment_date);
  const urgentPayments = [...overdueSales, ...dueSoonSales, ...noDateSales].slice(0, 6);
  const { data: allParties } = await db.getAll('parties');
  const partyNameMap = Object.fromEntries(allParties.map(p => [p.id, p.name]));

  if (urgentPayments.length === 0) {
    payRemEl.innerHTML = '<div class="empty-state" style="padding:20px;"><i class="fas fa-check-circle" style="font-size:1.5rem;color:var(--green);"></i><p style="color:var(--text-secondary);margin-top:8px;">All payments collected!</p></div>';
  } else {
    const { data: allProducts } = await db.getAll('products');
    payRemEl.innerHTML = '<div class="alert-list">' + urgentPayments.map(s => {
      const pName = partyNameMap[s.party_id] || 'Walk-in';
      const balance = (s.total_amount || 0) - (s.amount_received || 0);
      const isOverdue = s.expected_payment_date && daysUntil(s.expected_payment_date) < 0;
      const isDueSoon = s.expected_payment_date && daysUntil(s.expected_payment_date) >= 0 && daysUntil(s.expected_payment_date) <= 3;
      const cls = isOverdue ? 'danger' : isDueSoon ? 'warning' : '';
      const dateLabel = s.expected_payment_date
        ? (isOverdue ? `⚠ ${Math.abs(daysUntil(s.expected_payment_date))} days overdue` : `Due: ${s.expected_payment_date}`)
        : 'No due date set';
      return `<div class="alert-item ${cls}">
        <i class="fas ${isOverdue ? 'fa-exclamation-circle' : 'fa-clock'}"></i>
        <div style="flex:1;">
          <strong>${escapeHtml(pName)}</strong>
          <div style="font-size:0.75rem;opacity:0.8;">${dateLabel} · Balance: <strong style="color:var(--red);">${formatCurrency(balance)}</strong></div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="window.navigateTo('collections')">Collect</button>
      </div>`;
    }).join('') + '</div>';
  }

  // Recent activity - continued
  const { data: txns } = await db.getAll('inventory_transactions', { orderBy: ['created_at', 'desc'] });
  const recent = txns.slice(0, 8);
  if (recent.length === 0) {
    recentEl.innerHTML = '<div class="empty-state" style="padding:20px;"><i class="fas fa-inbox" style="font-size:1.5rem;"></i><p style="color:var(--text-secondary);margin-top:8px;">No activity yet. Start a checkout or record a sale.</p></div>';
  } else {
    const { data: allProducts } = await db.getAll('products');
    const { data: allProfiles } = await db.getAll('profiles');
    recentEl.innerHTML = recent.map(t => {
      const prod = allProducts.find(p => p.id === t.product_id);
      const user = allProfiles.find(u => u.id === t.performed_by);
      const icons = { stock_in: 'fa-arrow-down text-green', stock_out: 'fa-arrow-up text-red', checkout: 'fa-sign-out-alt text-blue', checkin: 'fa-sign-in-alt text-green', damage: 'fa-exclamation-triangle text-red', sale: 'fa-indian-rupee-sign text-green', rental_out: 'fa-handshake text-purple', adjustment: 'fa-sliders text-amber' };
      const iconClass = icons[t.type] || 'fa-circle text-muted';
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);">
        <i class="fas ${iconClass.split(' ')[0]}" style="width:24px;text-align:center;color:var(--${iconClass.split(' ')[1]?.replace('text-','') || 'text-muted'});"></i>
        <div style="flex:1;">
          <strong style="font-size:0.85rem;">${escapeHtml(t.type.replace(/_/g, ' '))}</strong>
          <span style="color:var(--text-secondary);"> — ${escapeHtml(prod?.name || 'Unknown')}</span>
          <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(user?.full_name || 'System')} · ${formatDateTime(t.created_at)}</div>
        </div>
        <span style="font-weight:600;color:${t.quantity >= 0 ? 'var(--green)' : 'var(--red)'};">${t.quantity >= 0 ? '+' : ''}${t.quantity}</span>
      </div>`;
    }).join('');
  }
}

async function renderSellerView(body) {
  const userId = auth.currentUser.id;
  const { data: sessions } = await db.getAll('checkout_sessions');
  const mySessions = sessions.filter(s => s.seller_id === userId).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  body.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>My Checkout History</h3>
      </div>
      <div class="card-body">
        ${mySessions.length === 0 ? '<div class="empty-state"><i class="fas fa-inbox"></i><h3>No checkouts yet</h3><p>Your daily checkouts will appear here.</p></div>' : `
          <div class="table-wrapper"><table class="data-table">
            <thead><tr><th>Date</th><th>Checkout</th><th>Checkin</th><th>Status</th></tr></thead>
            <tbody>${mySessions.map(s => `<tr>
              <td>${formatDateTime(s.checkout_time)}</td>
              <td>${formatDateTime(s.checkout_time)}</td>
              <td>${s.checkin_time ? formatDateTime(s.checkin_time) : '—'}</td>
              <td><span class="badge-status ${s.status === 'checked_in' ? 'green' : s.status === 'flagged' ? 'red' : 'amber'}">${escapeHtml(s.status.replace(/_/g, ' '))}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        `}
      </div>
    </div>
  `;
}
