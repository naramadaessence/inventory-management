import { db, auth } from '../supabase.js';
import { formatCurrency, formatDate, formatDateTime, showToast, createModal, daysUntil } from '../utils/helpers.js';

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

export async function renderCollections(body, header) {
  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle"><i class="fas fa-bars"></i></button>
      <h1>Collections</h1>
      <div class="page-header-subtitle">Track pending payments & follow-ups</div>
    </div>
    <div></div>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  const { data: sales } = await db.getAll('sales', { orderBy: ['created_at', 'desc'] });
  const { data: parties } = await db.getAll('parties');
  const { data: products } = await db.getAll('products');
  const { data: followups } = await db.getAll('payment_followups', { orderBy: ['created_at', 'desc'] });
  const { data: profiles } = await db.getAll('profiles');
  const partyMap = Object.fromEntries(parties.map(p => [p.id, p]));
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));

  const pendingSales = sales.filter(s => s.payment_status === 'pending' || s.payment_status === 'partial');
  const totalPending = pendingSales.reduce((sum, s) => sum + ((s.total_amount || 0) - (s.amount_received || 0)), 0);
  const dueSoon = pendingSales.filter(s => s.expected_payment_date && daysUntil(s.expected_payment_date) <= 3 && daysUntil(s.expected_payment_date) >= 0);
  const overdue = pendingSales.filter(s => s.expected_payment_date && daysUntil(s.expected_payment_date) < 0);

  body.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon red"><i class="fas fa-clock"></i></div>
        <div class="stat-info">
          <div class="stat-label">Total Pending</div>
          <div class="stat-value">${formatCurrency(totalPending)}</div>
          <div class="stat-change">${pendingSales.length} invoices</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon amber"><i class="fas fa-bell"></i></div>
        <div class="stat-info">
          <div class="stat-label">Due Soon (3 days)</div>
          <div class="stat-value">${dueSoon.length}</div>
          <div class="stat-change">${formatCurrency(dueSoon.reduce((s, r) => s + ((r.total_amount || 0) - (r.amount_received || 0)), 0))}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red"><i class="fas fa-exclamation-circle"></i></div>
        <div class="stat-info">
          <div class="stat-label">Overdue</div>
          <div class="stat-value">${overdue.length}</div>
          <div class="stat-change down">${formatCurrency(overdue.reduce((s, r) => s + ((r.total_amount || 0) - (r.amount_received || 0)), 0))}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="fas fa-check-circle"></i></div>
        <div class="stat-info">
          <div class="stat-label">Collected Today</div>
          <div class="stat-value">${formatCurrency(followups.filter(f => new Date(f.created_at).toDateString() === new Date().toDateString()).reduce((s, f) => s + (f.amount_collected || 0), 0))}</div>
        </div>
      </div>
    </div>

    <div class="tabs" style="margin-bottom:16px;">
      <button class="tab-btn active" data-tab="pending">Pending Payments</button>
      <button class="tab-btn" data-tab="overdue">Overdue</button>
      <button class="tab-btn" data-tab="history">Follow-up History</button>
    </div>
    <div id="collections-content"></div>
  `;

  let activeTab = 'pending';

  body.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderTab();
    });
  });

  function renderTab() {
    const container = document.getElementById('collections-content');
    if (activeTab === 'pending') renderPendingTab(container, pendingSales);
    else if (activeTab === 'overdue') renderOverdueTab(container, overdue);
    else renderHistoryTab(container);
  }

  function renderPendingTab(container, list) {
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle" style="color:var(--green);"></i><h3>All payments collected!</h3><p>No pending payments at this time.</p></div>';
      return;
    }

    container.innerHTML = `<div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Party</th><th>Product</th><th>Sale Date</th><th>Amount</th><th>Received</th><th>Balance</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${list.map(s => {
        const party = partyMap[s.party_id];
        const prod = prodMap[s.product_id];
        const balance = (s.total_amount || 0) - (s.amount_received || 0);
        const isOverdue = s.expected_payment_date && daysUntil(s.expected_payment_date) < 0;
        const isDueSoon = s.expected_payment_date && daysUntil(s.expected_payment_date) <= 3 && daysUntil(s.expected_payment_date) >= 0;
        const dueDateClass = isOverdue ? 'color:var(--red);font-weight:700;' : isDueSoon ? 'color:var(--accent);font-weight:600;' : '';
        const daysText = s.expected_payment_date ? (isOverdue ? `${Math.abs(daysUntil(s.expected_payment_date))}d overdue` : `${daysUntil(s.expected_payment_date)}d left`) : '';

        return `<tr>
          <td><strong>${esc(party?.name || 'Walk-in')}</strong></td>
          <td>${esc(prod?.name || '—')}</td>
          <td>${formatDate(s.sale_date || s.created_at)}</td>
          <td>${formatCurrency(s.total_amount)}</td>
          <td style="color:var(--green);font-weight:600;">${formatCurrency(s.amount_received || 0)}</td>
          <td style="color:var(--red);font-weight:700;">${formatCurrency(balance)}</td>
          <td style="${dueDateClass}">${s.expected_payment_date ? formatDate(s.expected_payment_date) : '—'}<br><small style="font-size:0.7rem;">${daysText}</small></td>
          <td><span class="badge-status ${s.payment_status === 'partial' ? 'amber' : 'red'}">${esc(s.payment_status)}</span></td>
          <td>
            <button class="btn btn-sm btn-primary update-payment-btn" data-id="${s.id}" title="Update Payment"><i class="fas fa-money-bill-wave"></i></button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    container.querySelectorAll('.update-payment-btn').forEach(el => {
      el.addEventListener('click', () => {
        const sale = sales.find(s => s.id == el.dataset.id);
        openPaymentUpdateModal(sale);
      });
    });
  }

  function renderOverdueTab(container, list) {
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle" style="color:var(--green);"></i><h3>No overdue payments</h3></div>';
      return;
    }
    renderPendingTab(container, list);
  }

  function renderHistoryTab(container) {
    if (followups.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><h3>No follow-ups recorded</h3><p>Payment follow-up history will appear here.</p></div>';
      return;
    }

    container.innerHTML = `<div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Date</th><th>Party</th><th>Visited By</th><th>Status</th><th>Collected</th><th>Next Due</th><th>Notes</th></tr></thead>
      <tbody>${followups.slice(0, 50).map(f => {
        const party = partyMap[f.party_id];
        const visitor = profileMap[f.visited_by];
        const statusColors = { paid: 'green', partial: 'amber', pending: 'red', promised: 'blue' };
        return `<tr>
          <td>${formatDateTime(f.visit_date || f.created_at)}</td>
          <td><strong>${esc(party?.name || '—')}</strong></td>
          <td>${esc(visitor?.full_name || '—')}</td>
          <td><span class="badge-status ${statusColors[f.status_update] || 'amber'}">${esc(f.status_update)}</span></td>
          <td style="color:var(--green);font-weight:600;">${f.amount_collected ? formatCurrency(f.amount_collected) : '—'}</td>
          <td>${f.expected_payment_date ? formatDate(f.expected_payment_date) : '—'}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${esc(f.notes)}">${esc(f.notes || '—')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  function openPaymentUpdateModal(sale) {
    const party = partyMap[sale.party_id];
    const prod = prodMap[sale.product_id];
    const balance = (sale.total_amount || 0) - (sale.amount_received || 0);

    const content = `
      <div style="background:var(--bg-secondary);border-radius:8px;padding:12px 16px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${esc(party?.name || 'Walk-in')}</strong>
            <div style="font-size:0.8rem;color:var(--text-muted);">${esc(prod?.name || '—')} · ${formatDate(sale.sale_date || sale.created_at)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.8rem;color:var(--text-muted);">Balance Due</div>
            <div style="font-size:1.25rem;font-weight:700;color:var(--red);">${formatCurrency(balance)}</div>
          </div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Payment Status *</label>
          <select class="form-select" id="fu-status">
            <option value="pending">Still Pending</option>
            <option value="partial">Partial Payment</option>
            <option value="paid">Fully Paid</option>
            <option value="promised">Promised (date given)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <select class="form-select" id="fu-method">
            <option value="">— Select —</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI / Online</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Amount Collected (₹)</label>
          <input class="form-input" type="number" id="fu-amount" min="0" max="${balance}" step="0.01" value="0" />
        </div>
        <div class="form-group">
          <label class="form-label">Expected Payment Date</label>
          <input class="form-input" type="date" id="fu-expected-date" value="${sale.expected_payment_date || ''}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Visit Notes</label>
        <textarea class="form-textarea" id="fu-notes" maxlength="500" placeholder="E.g. Met Mr. Patel, he said payment will be made by 28th..."></textarea>
      </div>
    `;

    const footer = `<button class="btn btn-secondary" id="fu-cancel">Cancel</button><button class="btn btn-primary" id="fu-save"><i class="fas fa-check"></i> Update Payment</button>`;
    const { close } = createModal('Update Payment', content, { footer });

    // Auto-fill amount when status changes to 'paid'
    document.getElementById('fu-status').addEventListener('change', (e) => {
      if (e.target.value === 'paid') {
        document.getElementById('fu-amount').value = balance;
      }
    });

    document.getElementById('fu-cancel').onclick = close;
    document.getElementById('fu-save').onclick = async () => {
      const status = document.getElementById('fu-status').value;
      const method = document.getElementById('fu-method').value;
      const amount = parseFloat(document.getElementById('fu-amount').value) || 0;
      const expectedDate = document.getElementById('fu-expected-date').value || null;
      const notes = document.getElementById('fu-notes').value.trim();

      if (amount < 0) { showToast('Amount cannot be negative', 'error'); return; }
      if (amount > balance) { showToast(`Amount cannot exceed balance of ${formatCurrency(balance)}`, 'error'); return; }

      const saveBtn = document.getElementById('fu-save');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div>';

      // Record follow-up
      await db.insert('payment_followups', {
        sale_id: sale.id,
        party_id: sale.party_id,
        visited_by: auth.currentUser.id,
        visit_date: new Date().toISOString(),
        status_update: status,
        payment_method: method || null,
        amount_collected: amount,
        expected_payment_date: expectedDate,
        notes
      });

      // Update sale record
      const newReceived = (sale.amount_received || 0) + amount;
      const newStatus = status === 'paid' || newReceived >= sale.total_amount ? 'paid' : status === 'partial' || newReceived > 0 ? 'partial' : 'pending';

      await db.update('sales', sale.id, {
        payment_status: newStatus,
        payment_method: method || sale.payment_method,
        amount_received: newReceived,
        expected_payment_date: expectedDate || sale.expected_payment_date
      });

      showToast(amount > 0 ? `${formatCurrency(amount)} collected! Status: ${newStatus}` : 'Payment status updated', 'success');
      close();
      renderCollections(body, header);
    };
  }

  renderTab();
}
