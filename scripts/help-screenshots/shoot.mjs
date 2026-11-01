// Screenshot harness for the in-app Help page (knowledge-base/help-centre.md).
// Drives the demo build (`npm run dev`, ?demo=week data) in headless Edge and writes
// public/help/<name>.webp. puppeteer-core is deliberately not a project dependency:
//
//   npm i --no-save puppeteer-core@24
//   node scripts/help-screenshots/shoot.mjs scripts/help-screenshots/specs/<section>.mjs [--only name1,name2] [--out <dir>]
//
// Env: HELP_BASE_URL (default http://localhost:3000), HELP_BROWSER (path to Edge/Chrome).
//
// A spec file exports `shots`: an array of
//   {
//     name: 'sales-new-bill',          // file name without extension -> <out>/<name>.webp
//     login: 'admin' | 'seller' | '<email>',   // admin = admin@, seller = seller1@ ; or any demo-week email
//     page: 'sales',                   // nav id passed to window.navigateTo (optional)
//     mobile: false,                   // true -> 390x844 phone viewport
//     run: async (h) => { ... },       // optional: clicks/typing to reach the state
//     target: 'viewport' | 'modal' | '<css selector>',  // default 'viewport'
//   }
// Each shot runs in a fresh browser context with the ?demo=week dataset loaded.
//
// Helper `h`:
//   h.page                    puppeteer Page
//   h.go(pageId)              navigate via the sidebar router and wait until it settles
//   h.click(selector)         click a CSS selector (waits for it)
//   h.clickText(text, sel?)   click the first element matching `sel` (default 'button, a, .tab, [role=tab]')
//                             whose trimmed text includes `text`
//   h.type(selector, text)    type into an input (clears it first)
//   h.select(selector, value) choose an <option> by value
//   h.selectText(selector, t) choose the first <option> whose text includes t
//   h.wait(ms)
//   h.settle()                wait for spinners/skeletons to disappear + 300ms
//   h.highlight(selector)     draw an amber ring around the element (for "click here" shots)
//   h.eval(fn, ...args)       page.evaluate
//   h.scrollTo(selector)      scroll element into view (centre)

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const BASE = process.env.HELP_BASE_URL || 'http://localhost:3000';
const EDGE = process.env.HELP_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DEFAULT_OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/help');

const LOGINS = {
  admin: ['admin@narmadaessence.com', 'admin123'],
  seller: ['seller1@narmadaessence.com', 'seller123'],
};

const args = process.argv.slice(2);
const specPath = args[0];
if (!specPath) { console.error('usage: node shoot.mjs <spec.mjs> [--only a,b] [--out dir]'); process.exit(2); }
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null;
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : DEFAULT_OUT;
mkdirSync(OUT, { recursive: true });

const { shots } = await import(pathToFileURL(path.resolve(specPath)).href);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-first-run', '--disable-extensions', '--hide-scrollbars'],
});

function credentials(login) {
  if (LOGINS[login]) return LOGINS[login];
  const pw = /^(priya|admin)@/.test(login) ? 'admin123' : 'seller123';
  return [login, pw];
}

function makeHelper(page) {
  const h = {
    page,
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    eval: (fn, ...a) => page.evaluate(fn, ...a),
    async settle() {
      await page.waitForFunction(
        () => !document.querySelector('#page-body .loading-overlay, #page-body .skeleton, #page-body .skeleton-row, .modal .spinner'),
        { timeout: 10000 },
      ).catch(() => {});
      await h.wait(350);
    },
    async go(pageId) {
      await page.evaluate((id) => window.navigateTo(id), pageId);
      await h.settle();
    },
    async click(selector) {
      await page.waitForSelector(selector, { visible: true, timeout: 8000 });
      await page.click(selector);
      await h.settle();
    },
    async clickText(text, sel = 'button, a, .tab, [role=tab]') {
      const ok = await page.evaluate((text, sel) => {
        const el = [...document.querySelectorAll(sel)]
          .filter(e => e.offsetParent !== null)
          .find(e => e.textContent.replace(/\s+/g, ' ').trim().includes(text));
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      }, text, sel);
      if (!ok) throw new Error(`clickText: no visible "${sel}" containing "${text}"`);
      await h.settle();
    },
    async type(selector, text) {
      await page.waitForSelector(selector, { visible: true, timeout: 8000 });
      await page.$eval(selector, el => { el.value = ''; });
      await page.type(selector, String(text));
      await h.wait(150);
    },
    async select(selector, value) {
      await page.waitForSelector(selector, { timeout: 8000 });
      await page.select(selector, String(value));
      await h.wait(200);
    },
    async selectText(selector, text) {
      const value = await page.$eval(selector, (el, t) => {
        const o = [...el.options].find(o => o.textContent.includes(t));
        return o ? o.value : null;
      }, text);
      if (value == null) throw new Error(`selectText: no option containing "${text}" in ${selector}`);
      await h.select(selector, value);
    },
    async scrollTo(selector) {
      await page.$eval(selector, el => el.scrollIntoView({ block: 'center' }));
      await h.wait(200);
    },
    async highlight(selector) {
      await page.$eval(selector, el => {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        const ring = document.createElement('div');
        ring.className = 'help-shot-ring';
        Object.assign(ring.style, {
          position: 'fixed', left: `${r.left - 6}px`, top: `${r.top - 6}px`,
          width: `${r.width + 12}px`, height: `${r.height + 12}px`,
          border: '3px solid #d97706', borderRadius: '10px',
          boxShadow: '0 0 0 4px rgba(217,119,6,0.25)', zIndex: 100000, pointerEvents: 'none',
        });
        document.body.appendChild(ring);
      });
      await h.wait(100);
    },
  };
  return h;
}

let failed = 0;
for (const shot of shots) {
  if (only && !only.has(shot.name)) continue;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.setViewport(shot.mobile
      ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { width: 1366, height: 820, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/?demo=week`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#login-form', { timeout: 15000 });
    if (shot.login !== 'none') {
      const [email, pw] = credentials(shot.login || 'admin');
      await page.type('#login-email', email);
      await page.type('#login-password', pw);
      await page.click('#login-btn');
      await page.waitForSelector('#sidebar-nav .nav-item', { timeout: 15000 });
      // Let the welcome / demo toasts disappear.
      await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    }
    const h = makeHelper(page);
    await h.settle();
    if (shot.page) await h.go(shot.page);
    if (shot.run) await shot.run(h);
    await h.wait(250);
    // Toasts from setup actions would cover content; keep them only if asked.
    if (!shot.keepToasts) await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    const file = path.join(OUT, `${shot.name}.webp`);
    const target = shot.target || 'viewport';
    if (target === 'viewport') {
      await page.screenshot({ path: file, type: 'webp', quality: 82 });
    } else {
      const sel = target === 'modal' ? '.modal-overlay .modal' : target;
      const el = await page.waitForSelector(sel, { visible: true, timeout: 8000 });
      await el.screenshot({ path: file, type: 'webp', quality: 82 });
    }
    console.log(`ok   ${shot.name}${errors.length ? `  (page errors: ${errors.join(' | ')})` : ''}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${shot.name}: ${err.message}`);
  } finally {
    await ctx.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
