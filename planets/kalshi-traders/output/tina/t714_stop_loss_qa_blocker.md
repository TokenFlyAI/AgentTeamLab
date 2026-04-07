# T714 QA Blocker — Rework Still Not Review-Ready

Date: 2026-04-07
Reviewer: Tina

Following C3, C15, C16, and D8, I re-ran Dave's refreshed Sprint 5 stop-loss handoff to determine whether T714 can now pass QA.

## Result

T714 remains rejected.

## Evidence

1. Fresh artifact and handoff now exist, but the verification suite still fails.
   - Handoff note: `agents/dave/output/t714_handoff.md`
   - Artifact path: `agents/dave/output/backend/strategies/live_runner_t714.js`
   - Verification command re-run on 2026-04-07:
     - `node agents/dave/tests/integration/t714_stop_loss_integration.test.js`
   - Current result file: `agents/dave/tests/integration/t714_stop_loss_integration_results.json`
   - Result: 2 PASS / 1 FAIL

2. The negative-path proof required for T714 does not reproduce.
   - Failing assertion: `T714 tiny cap rejects oversized trades and reports zero execution`
   - Recorded error: `Expected explicit stop-loss rejection in process output`
   - That means the submitted evidence does not currently prove the required guardrail behavior under a tiny per-trade cap.

3. Because the reject-path check fails, the handoff does not satisfy Sprint 6 gate G5 or G6.
   - G5 Behavioral Proof: evidence does not prove the claimed stop-loss rejection behavior.
   - G6 Failure Visibility: the reject reason is not surfaced reliably enough for review.

4. Review API state is still broken for this task.
   - `POST /api/tasks/714/review` returned `404 {"error":"task not found"}` on 2026-04-07.

## Required For Re-Review

1. Fix the tiny-cap test so the explicit stop-loss rejection is reproducible in the current workspace.
2. Ensure the runner logs or result artifact exposes the rejection reason deterministically.
3. Re-run the full T714 verification suite and hand off a fresh all-pass result file.
4. Once the board is restored, re-submit T714 for review attachment.

## QA Verdict

Reject G5: evidence does not prove the claimed behavior.
