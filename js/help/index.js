// Help centre content registry and search.
// Each file in ./sections/ default-exports one section ({ id, title, icon, intro, articles }).
// The block format is documented in knowledge-base/help-centre.md.

const modules = import.meta.glob('./sections/*.js', { eager: true });

// Reading order of the sections; sections not listed here go last.
const SECTION_ORDER = ['getting-started', 'daily-ops', 'sales', 'customers', 'inventory', 'reports-settings', 'help'];

export const SECTIONS = Object.values(modules)
  .map(m => m.default)
  .filter(Boolean)
  .sort((a, b) => rank(a.id) - rank(b.id));

function rank(id) {
  const i = SECTION_ORDER.indexOf(id);
  return i === -1 ? SECTION_ORDER.length : i;
}

export const ARTICLES = SECTIONS.flatMap(section =>
  section.articles.map(article => ({ ...article, section })));

export const ARTICLE_BY_ID = Object.fromEntries(ARTICLES.map(a => [a.id, a]));

export function canSee(article, role) {
  return role === 'admin' || article.roles.includes(role);
}

export function visibleSections(role) {
  return SECTIONS
    .map(section => ({
      ...section,
      articles: section.articles.filter(a => canSee(a, role)).map(a => ARTICLE_BY_ID[a.id]),
    }))
    .filter(section => section.articles.length > 0);
}

// ---------- search ----------

// Words that carry no meaning in "how do I …?" questions.
const STOP_WORDS = new Set(('a an and are can do does for from how i in is it me my of on or the to what when where which who why '
  + 'will with you your this that there should could would get got want need please kaise karu kare hai ka ki ke se').split(' '));

export function tokenize(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9₹]+/g) || [];
}

export function queryTerms(query) {
  const words = tokenize(query);
  const terms = words.filter(w => !STOP_WORDS.has(w));
  return terms.length ? terms : words;
}

// Plain text of an article's blocks (formatting markers stripped).
export function blockText(blocks) {
  return (blocks || []).map(b => {
    if (b.text) return b.text;
    if (b.items) return b.items.join(' ');
    if (b.type === 'img') return `${b.alt || ''} ${b.caption || ''}`;
    if (b.type === 'table') return [...(b.head || []), ...(b.rows || []).flat()].join(' ');
    return '';
  }).join(' ').replace(/\*\*|`|\[\[[^\]|]*\|?|\]\]/g, ' ');
}

const INDEX = ARTICLES.map(a => ({
  article: a,
  title: tokenize(a.title).filter(w => !STOP_WORDS.has(w)),
  fields: [
    { weight: 10, words: tokenize(a.title) },
    { weight: 6, words: tokenize((a.keywords || []).join(' ')) },
    { weight: 4, words: tokenize(`${a.summary} ${a.section.title}`) },
    { weight: 1, words: tokenize(blockText(a.blocks)) },
  ],
}));

// "returns" matches "return", "returning" matches "return", "bill" matches "billing".
function wordMatches(word, term) {
  if (word.startsWith(term)) return true;
  return word.length >= 4 && term.startsWith(word) && term.length - word.length <= 3;
}

// Best field weight for one term; an exact word counts a little more than a word-form match.
function termScore(fields, term) {
  let best = 0;
  for (const f of fields) {
    if (f.weight <= best) continue;
    if (f.words.includes(term)) best = f.weight;
    else if (f.words.some(w => wordMatches(w, term))) best = f.weight * 0.8;
  }
  return best;
}

// Titles that read like the query rank first: "request stock" → "Request stock for the day".
function titleBonus(title, terms) {
  let bonus = 0;
  if (title.length && wordMatches(title[0], terms[0])) bonus += 6;
  for (let i = 0; i + terms.length <= title.length && terms.length > 1; i++) {
    if (terms.every((t, j) => wordMatches(title[i + j], t))) { bonus += 8; break; }
  }
  return bonus;
}

// Ranked articles for a query. Every term must match somewhere; if nothing
// matches all terms, fall back to articles matching the most terms.
export function searchArticles(query, role) {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const scored = [];
  for (const entry of INDEX) {
    if (!canSee(entry.article, role)) continue;
    let score = 0, matched = 0;
    for (const t of terms) {
      const s = termScore(entry.fields, t);
      if (s) { score += s; matched++; }
    }
    if (matched) scored.push({ article: entry.article, score: score + titleBonus(entry.title, terms), matched });
  }
  const full = scored.filter(r => r.matched === terms.length);
  const pool = full.length ? full : scored.filter(r => r.matched === Math.max(...scored.map(s => s.matched)));
  return pool
    .sort((a, b) => b.score - a.score || a.article.title.length - b.article.title.length)
    .map(r => r.article);
}
