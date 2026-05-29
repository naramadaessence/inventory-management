# Testing

## Test Frameworks in Use
- Unit / business-logic contract tests: Vitest 3.2.4
- DOM/localStorage environment: happy-dom 20.9.0
- Build verification: Vite production build via `npm run build`

## How to Run Tests
| Command | What it runs |
|---------|--------------|
| `npm test` | Full Vitest suite in run mode |
| `npm run test:watch` | Vitest watch mode |
| `npm run build` | Production bundle build check |
| `npm test -- tests/demo-rpc.test.js` | Existing demo RPC contract tests only |

## Test File Conventions
- Tests live under `tests/`.
- Test filenames use `*.test.js`.
- Current tests import the public app APIs (`db`, `auth`) instead of private helpers where possible.
- `beforeEach` clears `localStorage` and calls `auth.getSession()` to initialize the demo dataset.

## What Must Be Tested
- Any new stock-mutating RPC must have matching coverage in `tests/demo-rpc.test.js` or a new focused test file.
- Production RPC call shapes must be mirrored by demo-mode `db.rpc(name, params)` tests so demo and Supabase paths keep the same interface.
- Any change to sale, issue approval, return approval, sale deletion, stock adjustment, or inventory audit logging needs a regression test.
- If a new helper changes form save behavior, error handling, currency rounding, or caching behavior, add a focused unit test before relying on manual QA.

## Mocks, Fakes, and Fixtures
- The localStorage demo store in `js/supabase.js` is the current fake database.
- Tests use the seeded demo dataset created by `initStore()` through `auth.getSession()`.
- External services are not called during the test suite.
- Sentry remains inactive unless `VITE_SENTRY_DSN` is configured, so normal tests do not need a Sentry mock.

## Current Coverage
- `tests/demo-rpc.test.js` covers:
  - `record_sale` happy path, insufficient stock path, and multi-item sale stock deduction
  - `update_sale` edited bill replacement, stock rebalancing, audit rows, and insufficient-stock rollback
  - `adjust_stock` positive delta and negative-stock guard
  - `approve_issue` happy path and insufficient stock path
  - `approve_return`
  - `delete_sale` stock restore, sale item cascade, and audit transaction logging

## Known Flaky Tests
None - keep it that way.

## Related KB Files
- `architecture.md` - data model, stock flow, RPC contract
- `decisions.md` - why stock mutations moved to Postgres RPCs and why Vitest is used
- `known-issues.md` - active caveats that tests should eventually lock down
