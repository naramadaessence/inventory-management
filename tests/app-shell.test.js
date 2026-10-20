// Tests for the app shell rendered by js/main.js.

import { describe, it, expect, beforeEach } from 'vitest';

const HOSTILE_NAME = '<img src=x onerror="window.__xss=1">';

describe('app shell', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.setItem('narmada_user', JSON.stringify({
      id: 'xss-user', email: 'x@example.com', full_name: HOSTILE_NAME, role: 'seller', is_active: true,
    }));
  });

  it('renders the signed-in user name as text, not HTML', async () => {
    await import('../js/main.js');
    await new Promise(r => setTimeout(r, 0));

    const nameEl = document.querySelector('.sidebar-user-info .name');
    expect(nameEl).not.toBeNull();
    expect(nameEl.textContent).toBe(HOSTILE_NAME);
    expect(document.querySelector('.sidebar-user img')).toBeNull();
  });
});
