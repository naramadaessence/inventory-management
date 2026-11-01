// Help centre (js/pages/help.js + js/help/): content integrity, search, and rendering.

import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, auth } from '../js/supabase.js';
import { SECTIONS, ARTICLES, ARTICLE_BY_ID, searchArticles, canSee, blockText } from '../js/help/index.js';
import { renderHelp, formatInline, resetHelpState } from '../js/pages/help.js';

const PUBLIC_HELP = resolve(process.cwd(), 'public/help') + '/';
const NAV_PAGES = ['dashboard', 'products', 'purchases', 'daily-ops', 'inventory-log', 'sales', 'collections', 'parties',
  'rentals', 'installations', 'damage-loss', 'reports', 'settings', 'help'];
const BLOCK_TYPES = ['p', 'h', 'steps', 'list', 'img', 'table', 'tip', 'note', 'warning'];
const ANCHORS = [
  'getting-started-log-in', 'getting-started-navigate', 'getting-started-roles', 'dashboard-overview',
  'daily-ops-request-stock', 'daily-ops-approve-issue', 'daily-ops-submit-return', 'daily-ops-approve-return',
  'products-add-product', 'products-request-adjustment', 'purchases-record-purchase', 'inventory-log-overview', 'damage-loss-report',
  'sales-record-bill', 'sales-edit-bill', 'collections-record-payment',
  'parties-add-party', 'installations-add-installation', 'rentals-add-rental',
  'reports-overview', 'reports-staff-ledger', 'settings-add-user', 'settings-stock-rules',
  'help-search',
];

// Every string a reader sees in an article.
function strings(article) {
  const out = [article.title, article.summary];
  for (const b of article.blocks) {
    if (b.text) out.push(b.text);
    if (b.items) out.push(...b.items);
    if (b.alt) out.push(b.alt);
    if (b.caption) out.push(b.caption);
    if (b.head) out.push(...b.head);
    if (b.rows) out.push(...b.rows.flat());
  }
  return out;
}

describe('help content', () => {
  it('has every section and anchor article', () => {
    expect(SECTIONS.map(s => s.id)).toEqual(
      ['getting-started', 'daily-ops', 'sales', 'customers', 'inventory', 'reports-settings', 'help']);
    for (const id of ANCHORS) expect(ARTICLE_BY_ID[id], id).toBeTruthy();
  });

  it('gives every section a title, icon and intro', () => {
    for (const s of SECTIONS) {
      expect(s.title, s.id).toBeTruthy();
      expect(s.icon, s.id).toMatch(/^fa-/);
      expect(s.intro, s.id).toBeTruthy();
      expect(s.articles.length, s.id).toBeGreaterThan(0);
    }
  });

  it('uses unique article ids', () => {
    const ids = ARTICLES.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fills the required fields of every article', () => {
    for (const a of ARTICLES) {
      expect(a.id, a.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(a.title, a.id).toBeTruthy();
      expect(a.summary, a.id).toBeTruthy();
      expect(a.roles.length, a.id).toBeGreaterThan(0);
      for (const r of a.roles) expect(['admin', 'seller'], a.id).toContain(r);
      if (a.page != null) expect(NAV_PAGES, a.id).toContain(a.page);
      expect(Array.isArray(a.keywords), a.id).toBe(true);
      expect(a.blocks.length, a.id).toBeGreaterThan(0);
      for (const b of a.blocks) expect(BLOCK_TYPES, `${a.id} block`).toContain(b.type);
    }
  });

  it('only links to articles that exist', () => {
    for (const a of ARTICLES) {
      for (const r of a.related || []) expect(ARTICLE_BY_ID[r], `${a.id} related ${r}`).toBeTruthy();
      for (const s of strings(a)) {
        for (const [, id] of String(s).matchAll(/\[\[([^\]|]+)/g)) {
          expect(ARTICLE_BY_ID[id], `${a.id} links ${id}`).toBeTruthy();
        }
      }
    }
  });

  it('has a screenshot file for every image block', () => {
    for (const a of ARTICLES) {
      for (const b of a.blocks.filter(b => b.type === 'img')) {
        expect(b.alt, `${a.id} ${b.src} alt`).toBeTruthy();
        expect(existsSync(PUBLIC_HELP + b.src), `${a.id} → public/help/${b.src}`).toBe(true);
      }
    }
  });

  it('contains no raw HTML in content strings', () => {
    for (const a of ARTICLES) {
      for (const s of strings(a)) expect(String(s), a.id).not.toMatch(/<\/?[a-z][^>]*>/i);
    }
  });
});

describe('help search', () => {
  const top = (q, role = 'admin', n = 3) => searchArticles(q, role).slice(0, n).map(a => a.id);

  it.each([
    ['how do I record a sale?', 'sales-record-bill'],
    ['edit bill', 'sales-edit-bill'],
    ['customer paid payment', 'collections-record-payment'],
    ['add new party', 'parties-add-party'],
    ['request stock', 'daily-ops-request-stock'],
    ['return stock', 'daily-ops-submit-return'],
    ['add user', 'settings-add-user'],
    ['damaged', 'damage-loss-report'],
  ])('finds "%s"', (q, id) => {
    expect(top(q, 'admin', 5)).toContain(id);
  });

  it('matches word forms (returns → return)', () => {
    expect(searchArticles('returns', 'admin').length).toBeGreaterThan(0);
  });

  it('never shows admin-only guides to sellers', () => {
    for (const q of ['add user', 'product', 'stock', 'report', 'approve']) {
      for (const a of searchArticles(q, 'seller')) expect(a.roles, `${q} → ${a.id}`).toContain('seller');
    }
  });

  it('returns nothing for an empty query', () => {
    expect(searchArticles('   ', 'admin')).toEqual([]);
  });

  it('indexes block text', () => {
    expect(blockText([{ type: 'p', text: 'Click **Save** then [[help-search|search]]' }])).toMatch(/Save/);
  });
});

describe('help page', () => {
  beforeEach(async () => {
    localStorage.clear();
    await auth.getSession(); // seeds the demo store
    document.body.innerHTML = '<div id="sidebar"></div><div id="header"></div><div id="body"></div>';
    window.navigateTo = () => {};
    resetHelpState();
  });

  async function render(role, opts) {
    const { data: profiles } = await db.getAll('profiles');
    auth.currentUser = profiles.find(p => p.role === role);
    await renderHelp(document.getElementById('body'), document.getElementById('header'), opts);
  }

  const visibleArticleIds = () => [...document.querySelectorAll('#body [data-article]')].map(el => el.dataset.article);

  it('escapes content and renders inline formatting', () => {
    const html = formatInline('Click **Save** and press `Enter` <img src=x>', 'admin');
    expect(html).toContain('<strong>Save</strong>');
    expect(html).toContain('<kbd>Enter</kbd>');
    expect(html).not.toContain('<img');
  });

  it('lists only seller guides for a seller', async () => {
    await render('seller');
    const ids = visibleArticleIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(canSee(ARTICLE_BY_ID[id], 'seller'), id).toBe(true);
    expect(ids).not.toContain('settings-add-user');
  });

  it('searches, opens an article, and shows its steps and screenshots', async () => {
    await render('admin');
    const input = document.getElementById('help-search');
    input.value = 'record sale';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 200));
    const result = document.querySelector('#help-view .help-result[data-article="sales-record-bill"]');
    expect(result).toBeTruthy();
    result.click();
    expect(document.querySelector('.help-title').textContent).toBe(ARTICLE_BY_ID['sales-record-bill'].title);
    expect(document.querySelectorAll('.help-steps li').length).toBeGreaterThan(0);
    expect(document.querySelector('.help-figure img').getAttribute('src')).toMatch(/^\/help\/.+\.webp$/);
    expect(document.querySelector('.help-article-body mark')).toBeTruthy();
  });

  it('shows guides for the page the user came from', async () => {
    await render('admin', { from: 'sales' });
    const ctx = document.querySelector('.help-context');
    expect(ctx).toBeTruthy();
    expect([...ctx.querySelectorAll('[data-article]')].map(el => el.dataset.article)).toContain('sales-record-bill');
  });

  it('lists every guide of a topic when the topic is opened', async () => {
    await render('admin', { from: 'dashboard' });
    document.querySelector('.help-section-head[data-section="sales"]').click();
    const ids = [...document.querySelectorAll('#help-view .help-result')].map(el => el.dataset.article);
    expect(ids).toEqual(SECTIONS.find(s => s.id === 'sales').articles.map(a => a.id));
  });

  it('shows a friendly message when nothing matches', async () => {
    await render('admin');
    const input = document.getElementById('help-search');
    input.value = 'zzzqqq';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 200));
    expect(document.querySelector('#help-view .empty-state h3').textContent).toContain('No guides found');
  });
});
