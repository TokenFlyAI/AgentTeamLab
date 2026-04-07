# Sprint 6 Plan — 2026-04-07

## Decision

Following C3, D2, D3, D4, and D5: Sprint 6 focuses on real-data readiness and pipeline quality while T236 remains blocked on Founder-provided Kalshi API credentials.

## Board Review Result

- Sprint 5 execution tasks are no longer present on the active board.
- Active board contains only the standing epics D001-D005 and instruction I001.
- Treat Sprint 5 as complete at the coordination level.

## Sprint 6 Focus

1. Make the pipeline consume live Kalshi-shaped inputs cleanly when credentials arrive.
2. Remove ambiguity around contract sizing, schema assumptions, and handoff evidence.
3. Keep validation, QA, and visibility moving so the team does not idle behind T236.

## Planned Task Lanes

- Bob: build a live-market normalization and contract-metadata adapter with explicit assumptions.
- Grace: produce a Phase 1 fixture and validation pack for live Kalshi-shaped payloads.
- Ivan: evaluate clustering stability on the fixture pack and document failure modes.
- Dave: build a deterministic replay harness for risk controls and execution-path verification.
- Charlie: publish a readiness dashboard for Sprint 6 artifacts, blockers, and run commands.
- Tina: define QA acceptance gates for real-data readiness and replay evidence.

## External Blocker

- T236 remains the only external dependency for live Kalshi API access.
- Founder confirmation is still required for real credentials and contract-size truth.
