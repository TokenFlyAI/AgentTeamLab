# Sprint 7 Live Pipeline QA Test Cases

Date: 2026-04-07
Owner: Frank
Task: T880

Following C3, C6, C15, C16, C17, D2, and D5, these cases define the minimum QA checks for Sprint 7 work on T852 and T853.

## Scope

- Phase 1 live-fixture traceability from Grace's artifact
- Phase 2 and Phase 3 lineage checks on Bob's E2E run
- Replay harness determinism and risk-control reject paths on Dave's rerun
- Freshness and review-package completeness for all handoffs

## Canonical Inputs

- Phase 1 filtered fixture: `/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/filtered_markets_live_fixture.json`
- Phase 1 verifier: `node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/verify_live_phase1_fixture.js`
- QA gates: `/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/agents/tina/output/sprint6_qa_acceptance_gates.md`
- Replay harness integration test: `node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/agents/dave/tests/integration/t817_replay_harness.test.js`
- Shared backend verifier: `bash /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/eve/verify_shared_backend.sh`

## Test Cases

1. `TC-S7-001` Review package completeness.
Expected: handoff includes `Artifact`, `Run`, `Verify`, `Freshness`, `Inputs`, and `Expected`.
Fail if: any field required by Tina gate G1-G7 is missing.

2. `TC-S7-002` Phase 1 input traceability uses Grace fixture, not synthetic generation.
Steps: inspect Bob's handoff and produced artifacts; confirm the stated input path equals `/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/filtered_markets_live_fixture.json`.
Expected: no synthetic market generator is the source of truth for the Sprint 7 run.
Fail if: output traces to generated mock markets or omits the exact fixture path.

3. `TC-S7-003` Phase 1 fixture sanity re-run.
Run: `node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/verify_live_phase1_fixture.js`
Expected: 9 normalized markets, 4 qualifying markets, 2 rejected invalid markets, 2 middle-range exclusions, 2 extreme-ratio manual-review exclusions.
Fail if: counts drift or any qualifying ticker falls outside the validated set.

4. `TC-S7-004` Phase 1 qualifying ticker contract.
Expected qualifying tickers: `KXINF-26JUN-T030`, `KXUNEMP-26SEP05-T072`, `KXBTCDOM-26OCT15-T068`, `KXSOL-27APR16-T450`.
Fail if: Bob's Phase 1 output adds, drops, or renames any qualifying ticker without an updated upstream fixture and freshness marker.

5. `TC-S7-005` Phase 2 lineage containment.
Expected: every market in Bob's cluster artifact traces back to the four qualifying Phase 1 tickers above.
Fail if: any cluster member originates from rejected, low-volume, middle-range, or synthetic-only input data.

6. `TC-S7-006` Phase 3 correlation gate.
Expected: every reported arbitrage pair includes `pearson_r`, spread fields, and ticker lineage back to Bob's Phase 2 output; strong-correlation claims must meet the documented `r > 0.75` threshold or clearly mark lower-threshold exploratory output.
Fail if: correlation claims lack threshold context, omit spread evidence, or include orphan tickers.

7. `TC-S7-007` Freshness marker integrity.
Expected: current-cycle `generatedAt` or equivalent marker is present on the produced Sprint 7 artifact and matches the reviewed run.
Fail if: reviewer cannot tie timestamped evidence to the artifact under review.

8. `TC-S7-008` Replay harness determinism.
Run: `node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/agents/dave/tests/integration/t817_replay_harness.test.js`
Expected: `replay_report.json` exists, `failed === 0`, `scenarios.length === 3`, and each scenario is deterministic with a canonical hash.
Fail if: repeated runs drift or the report is missing.

9. `TC-S7-009` Tiny-cap reject path.
Expected: scenario `tiny_cap_rejection` shows `executed === 0` and `stopLossRejected >= 1`.
Fail if: any paper trade executes under tiny-cap rejection conditions or the halt reason is not visible.

10. `TC-S7-010` Capital-floor halt path.
Expected: scenario `capital_floor_halt` shows `halted === true` and `capitalFloorBreached === true`.
Fail if: replay continues past the floor or the report does not surface the breach reason.

11. `TC-S7-011` Baseline live-signal replay executes at least one paper trade.
Expected: scenario `baseline_execution` shows `executed > 0` when run against Bob's delivered live-fixture signals.
Fail if: baseline produces zero executions without an explicit no-signal explanation tied to the live input.

12. `TC-S7-012` Shared backend verification remains green after Sprint 7 artifacts land.
Run: `bash /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/eve/verify_shared_backend.sh`
Expected: backend smoke verification passes on the current shared stack.
Fail if: Sprint 7 changes break supported readiness endpoints or startup assumptions.

## QA Notes

- Immediate reject under G4/G5 if T852 uses `/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/bob/run_pipeline.js` without replacing its synthetic Phase 1 generator with Grace's live fixture input.
- Immediate reject under G6 if T853 proves only happy-path replay behavior and omits tiny-cap or capital-floor evidence.
