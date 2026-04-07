# T714 QA Blocker — Stop-Loss Handoff Not Ready

Date: 2026-04-07
Reviewer: Tina

Following C3, C15, C16, and D8, I checked whether Dave's Sprint 5 stop-loss work was ready for Tina QA.

## Result

T714 is not ready for review yet.

## Evidence

1. No fresh T714 artifact was handed off in `agents/dave/output/`.
   - `find ../../agents/dave/output -maxdepth 2 -type f` returned no files.

2. The active runner still contains Bob's capital-floor logic only.
   - `agents/bob/backend/strategies/live_runner.js:323-346` performs settlement and capital-floor breach checks.
   - `agents/bob/backend/strategies/live_runner.js:442-453` only skips execution for a capital-floor halt.
   - `agents/bob/backend/strategies/live_runner.js:563-569` only sets a post-run capital-floor halt.
   - I found no stop-loss-specific check, threshold, or execution rejection in the current runner path.

3. Dave's visible integration test is stale and does not cover stop-loss behavior.
   - `agents/dave/tests/integration/live_runner_integration.test.js` timestamp: 2026-04-03 20:12:21 PDT.
   - It targets Bob's runner path (`../../../bob/backend`) rather than a Dave-owned artifact.
   - It asserts a `0.80` confidence floor at lines 232-245, but the live runner currently uses `minConfidence: 0.65` at `agents/bob/backend/strategies/live_runner.js:355`.
   - The test passed when re-run on 2026-04-07, but that only confirms old baseline behavior, not T714 stop-loss integration.

## Required For Re-Review

1. Hand off the updated artifact path and run command for T714.
2. Include a freshness marker for the stop-loss change set.
3. Add a runnable test that proves no single executed trade can exceed 20% of capital.
4. Show combined behavior with Bob's capital-floor logic so QA can verify both controls together.
