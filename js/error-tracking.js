// Lightweight error-tracking shim that lazy-loads Sentry only when configured.
//
// Activation: set VITE_SENTRY_DSN in your .env (and Vercel env vars) to a
// Sentry project DSN. If unset, this module is effectively a no-op — Sentry
// won't be loaded, no events will be sent, no bundle cost is paid beyond
// these few KB of glue.
//
// To get a DSN:
//   1. Sign up at https://sentry.io (free tier covers 5K events / month)
//   2. Create a Browser-JavaScript project
//   3. Copy the DSN from Settings → Client Keys
//   4. Add VITE_SENTRY_DSN=<dsn> to Vercel env vars (Production scope)

const DSN = import.meta.env.VITE_SENTRY_DSN || '';

let sentryPromise = null;
function loadSentry() {
  if (!DSN) return null;
  if (!sentryPromise) {
    sentryPromise = import('@sentry/browser').catch(err => {
      console.warn('[error-tracking] Failed to load Sentry SDK:', err);
      return null;
    });
  }
  return sentryPromise;
}

export async function initErrorTracking() {
  if (!DSN) return;
  const Sentry = await loadSentry();
  if (!Sentry) return;
  try {
    Sentry.init({
      dsn: DSN,
      environment: import.meta.env.PROD ? 'production' : 'development',
      // Single warehouse, low-volume — capture every error.
      sampleRate: 1.0,
      // Don't capture performance traces by default; opt-in later if useful.
      tracesSampleRate: 0,
      // Strip URLs that look like access tokens from breadcrumbs.
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.data?.url?.includes('access_token')) return null;
        return breadcrumb;
      },
    });
  } catch (err) {
    console.warn('[error-tracking] Sentry init failed:', err);
  }
}

// Set the current user on Sentry events so we can filter by who hit the issue.
// PII-light: just id + role, no email by default.
export async function setErrorUser(user) {
  if (!DSN || !user) return;
  const Sentry = await loadSentry();
  if (!Sentry) return;
  try {
    Sentry.setUser({ id: user.id, role: user.role });
  } catch { /* swallow — error tracking must never break the app */ }
}

// Report a captured error/exception with optional structured context.
// Always safe to call; if Sentry isn't configured, this is a no-op.
export async function reportError(err, context = {}) {
  if (!DSN) return;
  const Sentry = await loadSentry();
  if (!Sentry) return;
  try {
    Sentry.captureException(err, { extra: context });
  } catch { /* swallow */ }
}

// Convenience for app-level "this shouldn't happen" warnings that aren't
// actual exceptions but are worth surfacing.
export async function reportMessage(message, level = 'warning', context = {}) {
  if (!DSN) return;
  const Sentry = await loadSentry();
  if (!Sentry) return;
  try {
    Sentry.captureMessage(message, { level, extra: context });
  } catch { /* swallow */ }
}
