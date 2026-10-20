# Deployment & Hosting

## What This Subsystem Does
The app is a static Vite SPA (`index.html` + `js/` + `css/` → `dist/`) talking directly to Supabase from the browser. The only server-side code is the `create-user` Supabase Edge Function, used by Settings → Users to create seller/admin accounts with the service role key. Since 2026-10-20 the static site is hosted on **Cloudflare Pages** (free plan); before that it was on Vercel Hobby (see History below).

## How It Is Structured
| Piece | Where | Notes |
|-------|-------|-------|
| Static site | Cloudflare Pages project `narmada-inventory` → https://narmada-inventory.pages.dev, Git-connected to `github.com/naramadaessence/inventory-management`, branch `main` (every push to main auto-deploys) | Build `npm run build`, output `dist`, account narmadaessence.sachin@gmail.com |
| Edge Function | `supabase/functions/create-user/` → Supabase project `jnfykpicpttvnihgsckt` | `index.ts` = Deno entry; `handler.js` = logic (runtime-agnostic, unit-tested) |
| Function config | `supabase/config.toml` | Only sets `[functions.create-user] verify_jwt = false`; the function checks the JWT + admin role itself |
| Client call site | `js/pages/settings.js` | `supabase.functions.invoke('create-user', { body })` — supabase-js adds the user's access token |
| Database schema | `supabase-schema.sql` + `migrations/` | Applied **manually** in the Supabase SQL editor (see README "Setup / Migration Order") |

### Cloudflare Pages settings
- Framework preset: Vite (or None). Build command: `npm run build`. Build output directory: `dist`. Root directory: `/`.
- Environment variables (Production, and Preview if previews are wanted):
  - `VITE_SUPABASE_URL` — `https://jnfykpicpttvnihgsckt.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` — Supabase → Project Settings → API Keys → anon/publishable key (public by design, but enter it yourself)
  - `NODE_VERSION` — `22` (Vite 8 needs a modern Node)
  - `VITE_SENTRY_DSN` — optional; leave unset to disable Sentry
- No `_redirects` needed: the router is in-memory (`js/main.js`), URLs never change path.

### Edge Function deploy
```bash
npx supabase login
npx supabase functions deploy create-user --project-ref jnfykpicpttvnihgsckt
npx supabase secrets set ALLOWED_ORIGINS=https://<project>.pages.dev --project-ref jnfykpicpttvnihgsckt
```
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically; do not set them as secrets.
- `ALLOWED_ORIGINS` is comma-separated. Add the custom domain too if one is attached (e.g. `https://app.narmadaessence.com`). `http://localhost:3000` and `:5173` are always allowed.
- Alternative without CLI: Supabase dashboard → Edge Functions → Deploy a new function → Via editor, name `create-user`, add both files, then turn **off** "Enforce JWT verification" in the function's settings.

## Conventions And Rules
- Env vars are baked into the bundle at **build time** by Vite. Changing one in Cloudflare requires a redeploy.
- A production build without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` builds fine but throws at startup (`assertProductionConfig` in `js/supabase.js`) — it never silently falls back to demo mode.
- Keep the service role key out of the browser and out of Cloudflare. It only lives inside Supabase.
- Supabase GitHub integration (Settings → Integrations → GitHub, connected 2026-10-20): **keep "Deploy to production" OFF.** The repo's `migrations/` files are not re-runnable (002 corrupts liquid stock, 006/009/010 overwrite the hardened RPCs, 003/004 fail). If they are ever placed under `supabase/migrations/`, the integration would run them all against production because no migration history table exists. To adopt the integration safely, first baseline: `supabase link`, `supabase db pull` (one baseline migration from prod), confirm `supabase migration list` shows nothing pending, archive `migrations/`, write new changes with `supabase migration new`.

## Known Gotchas
- Cloudflare preview deployments (`<hash>.<project>.pages.dev`) are not in `ALLOWED_ORIGINS`, so Create User fails there (everything else works).
- Supabase Auth → URL Configuration → Site URL should point at the Cloudflare URL so any auth emails link to the right host.
- `error.context` on a non-2xx `functions.invoke` result is the raw `Response`; settings.js reads `{ error }` from its JSON for the toast.

## History
- 2026-04-24 → 2026-07-23: Vercel Hobby (`inventory-management-pi-opal.vercel.app`, Vercel fn `api/create-user.js`).
- 2026-07-23: Vercel paused the whole Hobby team for exceeding Fluid Provisioned Memory (likely a different project in the team, "broadcast", since deleted — unconfirmed because the Vercel account used by the agent had no access to the team). The pause did not lift on its own; Vercel requires Pro or support. Hobby is also non-commercial only, which this app is not. Site returned `402 DEPLOYMENT_DISABLED`.
- 2026-10-20: Moved to Cloudflare Pages + Supabase Edge Function (see `decisions.md`). Edge Function `create-user` deployed via CLI (verify_jwt false), `ALLOWED_ORIGINS=https://narmada-inventory.pages.dev` set. Verified: site 200, bundle contains the prod Supabase URL and no `/api/create-user`, login page renders with no console errors, CORS preflight from the Pages origin returns 204 with the origin echoed, unauthenticated POST → 401.

## How It Is Tested
- `tests/create-user-function.test.js` — handler: CORS preflight allow/deny, 405, 401 (missing/invalid token), 403 (non-admin), 400 (validation, Supabase errors), 500 (missing env), 200 success with phone update, 429 rate limit.
- `npm run build` — bundle builds.
- Not covered automatically: the Deno entry (`index.ts`), the real Supabase gateway, and Cloudflare build settings. After each deploy, smoke test: open the site, log in as admin, create a throwaway seller in Settings → Users.

## Related KB Files
- `README.md` — setup / migration order, quick facts
- `decisions.md` — why Cloudflare Pages + Edge Function
- `known-issues.md` — migration re-run risk, leaked admin password
- `architecture.md` — data model and security model
