import { auth } from '../supabase.js';
import { showToast } from '../utils/helpers.js';

export function renderLogin(container, onSuccess) {
  container.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">🌿</div>
        <div class="login-brand">Narmada Essence</div>
        <div class="login-subtitle">Inventory Management System</div>
        <form id="login-form">
          <div class="form-group">
            <label class="form-label" for="login-email">Email</label>
            <input class="form-input" type="email" id="login-email" placeholder="admin@narmadaessence.com" required autocomplete="email" maxlength="254" />
          </div>
          <div class="form-group">
            <label class="form-label" for="login-password">Password</label>
            <input class="form-input" type="password" id="login-password" placeholder="••••••••" required autocomplete="current-password" minlength="6" maxlength="128" />
          </div>
          <div id="login-error" class="form-error" style="margin-bottom:12px;display:none;"></div>
          <button type="submit" class="btn btn-primary btn-block btn-lg" id="login-btn">
            <i class="fas fa-sign-in-alt"></i> Sign In
          </button>
        </form>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border);text-align:center;">
          <p style="font-size:0.75rem;color:var(--text-muted);">Contact your administrator for login credentials</p>
        </div>
      </div>
    </div>
  `;

  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;

    // Input validation
    if (!email || !password) {
      errorEl.textContent = 'Please fill in all fields.';
      errorEl.style.display = 'block';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = 'Please enter a valid email address.';
      errorEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto;"></div>';
    errorEl.style.display = 'none';

    try {
      const { user, error } = await auth.login(email, password);
      if (error) {
        errorEl.textContent = error.message || 'Login failed. Please try again.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
        return;
      }
      showToast(`Welcome, ${user.full_name}!`, 'success');
      onSuccess();
    } catch (err) {
      errorEl.textContent = 'An unexpected error occurred. Please try again.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
    }
  });
}
