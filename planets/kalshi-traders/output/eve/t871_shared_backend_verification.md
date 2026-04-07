# T871 Shared Backend Verification

Date: 2026-04-07

Runnable artifact:
- `output/eve/verify_shared_backend.sh`

Command:
- `bash output/eve/verify_shared_backend.sh`

What it verifies:
- Boots `output/shared/codebase/backend/dashboard_api.js` on an isolated port
- Runs the shared backend smoke test against the actual dashboard API contract
- Runs `tests/unit/screener/screener.test.js`
- Runs `tests/unit/live_market_normalizer.test.js`

Validation result:
- `npm test` in `output/shared/codebase/backend` passed on 2026-04-07

Infra changes included:
- Replaced stale smoke-test assumptions that targeted the wrong server shape
- Added `scripts/verify_dashboard_stack.sh` as the repeatable verification entrypoint
- Made `dashboard_api.js` honor `PORT` for isolated verification runs
- Fixed screener cache pathing so unit tests resolve repo outputs correctly
