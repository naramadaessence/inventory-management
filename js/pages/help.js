import { auth } from '../supabase.js';
import { esc, debounce, createModal } from '../utils/helpers.js';
import { ARTICLE_BY_ID, canSee, visibleSections, searchArticles, queryTerms } from '../help/index.js';

// Survives navigating away and back, so Help reopens where the user left it.
const state = { query: '', articleId: null, sectionId: null };

export function resetHelpState() {
  Object.assign(state, { query: '', articleId: null, sectionId: null });
}

const CALLOUTS = {
  tip: { icon: 'fa-lightbulb', label: 'Tip' },
  note: { icon: 'fa-circle-info', label: 'Note' },
  warning: { icon: 'fa-triangle-exclamation', label: 'Careful' },
};

const ROLE_LABELS = { admin: 'Admin', seller: 'Seller' };

// Content strings allow **bold**, `key`, and [[article-id]] / [[article-id|words]] links.
export function formatInline(text, role) {
  let html = esc(text);
  html = html.replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, id, label) => {
    const target = ARTICLE_BY_ID[id];
    const words = label || esc(target?.title || id);
    if (!target || !canSee(target, role)) return words;
    return `<a href="#" class="help-link" data-article="${id}">${words}</a>`;
  });
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<kbd>$1</kbd>');
  return html;
}

function renderBlock(block, role) {
  const f = (t) => formatInline(t, role);
  switch (block.type) {
    case 'p': return `<p>${f(block.text)}</p>`;
    case 'h': return `<h3>${f(block.text)}</h3>`;
    case 'steps': return `<ol class="help-steps">${block.items.map(i => `<li>${f(i)}</li>`).join('')}</ol>`;
    case 'list': return `<ul class="help-list">${block.items.map(i => `<li>${f(i)}</li>`).join('')}</ul>`;
    case 'img': return `
      <figure class="help-figure">
        <button type="button" class="help-figure-btn" data-src="/help/${esc(block.src)}" data-caption="${esc(block.caption || block.alt)}" aria-label="Enlarge screenshot: ${esc(block.alt)}">
          <img src="/help/${esc(block.src)}" alt="${esc(block.alt)}" loading="lazy" />
        </button>
        ${block.caption ? `<figcaption>${f(block.caption)}</figcaption>` : ''}
      </figure>`;
    case 'table': return `
      <div class="table-wrapper help-table"><table class="data-table">
        <thead><tr>${block.head.map(h => `<th>${f(h)}</th>`).join('')}</tr></thead>
        <tbody>${block.rows.map(r => `<tr>${r.map(c => `<td>${f(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    case 'tip': case 'note': case 'warning': {
      const c = CALLOUTS[block.type];
      return `<div class="help-callout help-callout--${block.type}">
        <i class="fas ${c.icon}" aria-hidden="true"></i>
        <div><strong>${c.label}:</strong> ${f(block.text)}</div>
      </div>`;
    }
    default: return '';
  }
}

function roleChips(article) {
  return article.roles.map(r => `<span class="badge-status ${r === 'admin' ? 'purple' : 'blue'}">${ROLE_LABELS[r] || esc(r)}</span>`).join(' ');
}

function articleLink(article, extraClass = '') {
  return `<a href="#" class="help-link ${extraClass}" data-article="${esc(article.id)}">${esc(article.title)}</a>`;
}

function articleCard(article, terms) {
  return `
    <a href="#" class="help-result" data-article="${esc(article.id)}">
      <span class="help-result-title">${highlightText(article.title, terms)}</span>
      <span class="help-result-section"><i class="fas ${esc(article.section.icon)}" aria-hidden="true"></i> ${esc(article.section.title)}</span>
      <span class="help-result-summary">${highlightText(article.summary, terms)}</span>
    </a>`;
}

function termPattern(terms) {
  if (!terms.length) return null;
  const alt = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(${alt})`, 'gi');
}

function highlightText(text, terms) {
  const re = termPattern(terms);
  const safe = esc(text);
  return re ? safe.replace(re, '<mark>$1</mark>') : safe;
}

// Wrap search terms in <mark> inside already-rendered article text.
function markTerms(root, terms) {
  const re = termPattern(terms);
  if (!re) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (!re.test(node.nodeValue)) continue;
    re.lastIndex = 0;
    const span = document.createElement('span');
    span.innerHTML = esc(node.nodeValue).replace(re, '<mark>$1</mark>');
    node.replaceWith(...span.childNodes);
  }
}

export async function renderHelp(body, header, { from } = {}) {
  const role = auth.isAdmin() ? 'admin' : 'seller';
  const sections = visibleSections(role);

  header.innerHTML = `
    <div>
      <button class="mobile-toggle" id="mobile-toggle" aria-label="Toggle navigation"><i class="fas fa-bars" aria-hidden="true"></i></button>
      <h1>Help</h1>
      <div class="page-header-subtitle">Step-by-step guides with screenshots for everything in the system</div>
    </div>
  `;
  document.getElementById('mobile-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  body.innerHTML = `
    <div class="help-layout">
      <nav class="help-toc" aria-label="Help topics">
        <a href="#" class="help-toc-home" data-home="1"><i class="fas fa-house" aria-hidden="true"></i> All topics</a>
        ${sections.map(s => `
          <div class="help-toc-section" data-toc-section="${esc(s.id)}">
            <a href="#" class="help-toc-title" data-section="${esc(s.id)}"><i class="fas ${esc(s.icon)}" aria-hidden="true"></i> ${esc(s.title)}</a>
            <div class="help-toc-articles">${s.articles.map(a => articleLink(a, 'help-toc-link')).join('')}</div>
          </div>`).join('')}
      </nav>
      <div class="help-main">
        <div class="help-search search-input">
          <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
          <input type="search" class="form-input" id="help-search" placeholder="Search help, e.g. how do I record a sale?" aria-label="Search help" autocomplete="off" />
        </div>
        <div id="help-view" aria-live="polite"></div>
      </div>
    </div>
  `;

  const layout = body.querySelector('.help-layout');
  const view = body.querySelector('#help-view');
  const input = body.querySelector('#help-search');
  input.value = state.query;

  // The contents list only expands the topic being read.
  function setActiveToc() {
    layout.querySelectorAll('.help-toc-section').forEach(el => {
      el.classList.toggle('open', el.dataset.tocSection === state.sectionId);
    });
    layout.querySelectorAll('.help-toc-link').forEach(el => {
      el.classList.toggle('active', el.dataset.article === state.articleId);
    });
  }

  function showHome() {
    state.articleId = null; state.sectionId = null;
    const forPage = from && from !== 'help'
      ? sections.flatMap(s => s.articles).filter(a => a.page === from)
      : [];
    view.innerHTML = `
      ${forPage.length ? `
        <div class="card help-context">
          <div class="card-header"><h3><i class="fas fa-location-dot" aria-hidden="true"></i> Guides for the page you were on</h3></div>
          <div class="card-body help-context-list">
            ${forPage.slice(0, 8).map(a => articleLink(a)).join('')}
            ${forPage.length > 8 ? `<a href="#" class="help-more" data-section="${esc(forPage[0].section.id)}">See all ${sections.find(x => x.id === forPage[0].section.id).articles.length} guides <i class="fas fa-arrow-right" aria-hidden="true"></i></a>` : ''}
          </div>
        </div>` : ''}
      <div class="help-sections">
        ${sections.map(s => `
          <div class="card help-section-card">
            <div class="card-body">
              <a href="#" class="help-section-head" data-section="${esc(s.id)}">
                <span class="stat-icon amber"><i class="fas ${esc(s.icon)}" aria-hidden="true"></i></span>
                <span><span class="help-section-name">${esc(s.title)}</span><span class="help-section-count">${s.articles.length} guides</span></span>
              </a>
              <p class="help-section-intro">${formatInline(s.intro, role)}</p>
              <div class="help-section-links">
                ${s.articles.slice(0, 5).map(a => articleLink(a)).join('')}
                ${s.articles.length > 5 ? `<a href="#" class="help-more" data-section="${esc(s.id)}">See all ${s.articles.length} guides <i class="fas fa-arrow-right" aria-hidden="true"></i></a>` : ''}
              </div>
            </div>
          </div>`).join('')}
      </div>`;
    setActiveToc();
  }

  function showSection(id) {
    const s = sections.find(x => x.id === id);
    if (!s) return showHome();
    state.articleId = null; state.sectionId = id; state.query = ''; input.value = '';
    view.innerHTML = `
      <div class="help-breadcrumb"><a href="#" data-home="1">Help</a> <i class="fas fa-chevron-right" aria-hidden="true"></i> ${esc(s.title)}</div>
      <h2 class="help-title" tabindex="-1"><i class="fas ${esc(s.icon)}" aria-hidden="true"></i> ${esc(s.title)}</h2>
      <p class="help-lead">${formatInline(s.intro, role)}</p>
      <div class="help-results">${s.articles.map(a => articleCard(a, [])).join('')}</div>`;
    setActiveToc();
    view.querySelector('.help-title').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function showResults() {
    state.articleId = null; state.sectionId = null;
    const terms = queryTerms(state.query);
    const results = searchArticles(state.query, role);
    view.innerHTML = results.length ? `
      <div class="help-results-count">${results.length} ${results.length === 1 ? 'guide' : 'guides'} found for “${esc(state.query)}”</div>
      <div class="help-results">${results.map(a => articleCard(a, terms)).join('')}</div>
    ` : `
      <div class="empty-state">
        <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
        <h3>No guides found for “${esc(state.query)}”</h3>
        <p>Try fewer or simpler words, like “sale”, “return” or “payment”, or browse a topic:</p>
        <div class="help-empty-topics">${sections.map(s => `<a href="#" class="btn btn-secondary btn-sm" data-section="${esc(s.id)}"><i class="fas ${esc(s.icon)}" aria-hidden="true"></i> ${esc(s.title)}</a>`).join('')}</div>
      </div>`;
    setActiveToc();
  }

  function showArticle(id) {
    const a = ARTICLE_BY_ID[id];
    if (!a || !canSee(a, role)) return showHome();
    state.articleId = id; state.sectionId = a.section.id;
    const related = (a.related || []).map(r => ARTICLE_BY_ID[r]).filter(r => r && canSee(r, role));
    const back = state.query
      ? `<a href="#" data-results="1"><i class="fas fa-arrow-left" aria-hidden="true"></i> Back to results</a>`
      : `<a href="#" data-home="1">Help</a> <i class="fas fa-chevron-right" aria-hidden="true"></i> <a href="#" data-section="${esc(a.section.id)}">${esc(a.section.title)}</a>`;
    view.innerHTML = `
      <article class="help-article">
        <div class="help-breadcrumb">${back}</div>
        <h2 class="help-title" tabindex="-1">${esc(a.title)}</h2>
        <div class="help-meta"><span class="help-meta-label">Who can do this:</span> ${roleChips(a)}
          ${a.page ? `<button type="button" class="btn btn-secondary btn-sm help-open-page" data-page="${esc(a.page)}"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i> Open this page</button>` : ''}
        </div>
        <p class="help-lead">${formatInline(a.summary, role)}</p>
        <div class="help-article-body">${a.blocks.map(b => renderBlock(b, role)).join('')}</div>
        ${related.length ? `
          <div class="help-related">
            <h3>Related guides</h3>
            ${related.map(r => articleLink(r)).join('')}
          </div>` : ''}
      </article>`;
    if (state.query) markTerms(view.querySelector('.help-article-body'), queryTerms(state.query));
    setActiveToc();
    view.querySelector('.help-title').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // One delegated handler for every link/button in the help page.
  layout.addEventListener('click', (e) => {
    const el = e.target.closest('[data-article], [data-section], [data-home], [data-results], .help-figure-btn, .help-open-page');
    if (!el) return;
    e.preventDefault();
    if (el.classList.contains('help-figure-btn')) {
      const { overlay } = createModal(el.dataset.caption || 'Screenshot', `<img class="help-zoom-img" src="${esc(el.dataset.src)}" alt="" />`, { large: true });
      overlay.querySelector('.modal').classList.add('help-zoom-modal');
      return;
    }
    if (el.classList.contains('help-open-page')) return window.navigateTo(el.dataset.page);
    if (el.dataset.article) return showArticle(el.dataset.article);
    if (el.dataset.section) return showSection(el.dataset.section);
    if (el.dataset.results) return showResults();
    if (el.dataset.home) { state.query = ''; input.value = ''; return showHome(); }
  });

  const onSearch = debounce(() => {
    state.query = input.value.trim();
    if (state.query) showResults(); else showHome();
  }, 150);
  input.addEventListener('input', onSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    state.query = input.value.trim();
    const first = state.query && searchArticles(state.query, role)[0];
    if (first) showArticle(first.id);
  });

  if (state.articleId) showArticle(state.articleId);
  else if (state.query) showResults();
  else if (state.sectionId) showSection(state.sectionId);
  else showHome();
}
