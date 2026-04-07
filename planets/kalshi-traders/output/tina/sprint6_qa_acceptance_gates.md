# Sprint 6 QA Acceptance Gates — Real-Data Readiness

Date: 2026-04-07
Owner: Tina
Task: T818

Following C3, C11, C15, C16, C17, and D2, this document defines the minimum QA evidence required before Sprint 6 artifacts can be approved as real-data-ready.

## Scope

Use these gates for any Sprint 6 deliverable that claims readiness for live Kalshi data, production replay, risk validation, or launch review. A reviewer should reject the task if any mandatory gate below is missing.

## Required Handoff Package

Every task submitted for review must include all of the following in the task note or DM:

1. Artifact path
2. Run command
3. Verification command
4. Freshness marker
5. Expected result summary
6. Upstream inputs used

Required format:

```text
Artifact: /absolute/path/to/file_or_dir
Run: <single runnable command>
Verify: <single runnable command>
Freshness: generatedAt=<ISO-8601 timestamp>
Inputs: <absolute paths or task IDs>
Expected: <1-3 lines describing pass condition>
```

## Gate Table

| Gate | Requirement | Pass Condition | Reject If |
|---|---|---|---|
| G1 Freshness | Artifact and evidence are from the current sprint cycle | Freshness marker exists and reviewer can match it to the produced artifact or result file | No freshness marker, stale timestamp, or timestamp cannot be tied to the artifact |
| G2 Reproducibility | Reviewer can run the work without reconstructing context | Run and verify commands are present, execute successfully, and produce the claimed output | Missing command, broken command, hidden manual steps, or environment assumptions not stated |
| G3 Artifact Integrity | Deliverable is present in the claimed path and contains current output | File exists, is non-empty, and references the current run or inputs | Missing file, placeholder output, or stale copied artifact |
| G4 Input Traceability | Real-data readiness claims must name upstream dependencies | Handoff lists exact input files, task IDs, or API sources used by the run | Reviewer cannot tell what data/code version produced the result |
| G5 Behavioral Proof | Tests or checks demonstrate the claimed behavior | Evidence covers the feature or risk claim directly, not just adjacent baseline behavior | Only indirect evidence exists, or tests do not exercise the claimed condition |
| G6 Failure Visibility | Negative-path behavior is observable | Tests or logs show how failure, stale data, or blocked execution is surfaced | Success-only proof with no evidence of guardrails or reject paths |
| G7 Reviewability | Reviewer has enough detail to approve or reject in one pass | Expected outcome and acceptance threshold are stated explicitly | Reviewer must infer thresholds or ask follow-up questions to know what passing means |

## Sprint 6 Evidence Requirements By Deliverable Type

### 1. Real-data ingestion or normalization

- Must show the exact source endpoint or input fixture.
- Must include a captured output artifact with generated timestamp.
- Must prove schema validity and field normalization on current data.
- Must show behavior for malformed, missing, or partial payloads.

### 2. Replay, backtest, or deterministic harness work

- Must provide a fixed seed, fixed fixture, or both.
- Must demonstrate identical outputs across at least two consecutive runs.
- Must persist the replay result to a file reviewers can diff.
- Must state the invariants being checked.

### 3. Risk-control changes

- Must prove the happy path and the reject path.
- Must show compatibility with adjacent controls already in the runner.
- Must include evidence that rejected trades or blocked runs are not counted as executed work.
- Must surface the exact halt or rejection reason in logs or report output.

### 4. Readiness dashboard or summary artifacts

- Must declare the source artifacts and their freshness rules.
- Must clearly distinguish current, stale, missing, and blocked states.
- Must link each red/yellow state to an underlying file, test, or blocker.
- Must not summarize a component as ready if the underlying artifact cannot be reproduced.

## Reviewer Workflow

1. Confirm the task is in `in_review`.
2. Check the handoff package for Artifact, Run, Verify, Freshness, Inputs, and Expected.
3. Open the artifact path and confirm it exists.
4. Run the verification command exactly as handed off.
5. Compare the produced output to the stated expected result.
6. Confirm freshness and input traceability.
7. Approve only if all gates pass; otherwise reject with the first concrete failing gate.

## Standard Reject Reasons

Use one of these as the first sentence of the review comment:

- Reject G1: freshness marker missing or stale
- Reject G2: verification command missing or not runnable
- Reject G3: artifact missing or does not match current run
- Reject G4: upstream inputs not identified
- Reject G5: evidence does not prove the claimed behavior
- Reject G6: failure path or guardrail behavior not demonstrated
- Reject G7: acceptance threshold not stated clearly enough for review

## Definition Of Ready For Review

A Sprint 6 task is review-ready only when:

1. The task is in `in_review`.
2. The artifact exists at the handed-off path.
3. The reviewer can execute the verify command successfully.
4. The evidence directly proves the claim being reviewed.
5. Freshness and inputs are explicit.

If any item above is false, the reviewer should reject immediately and escalate the blocker per C17.
