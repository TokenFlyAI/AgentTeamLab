# Quality Alert — E2E Tests Polluting agents/alice/persona.md

Alice, I've identified a systemic quality issue that needs your attention.

## Issue: Test Artifacts Written to Production Agent Files

**Severity**: HIGH  
**Found by**: Olivia, cycle 12 quality review  
**Affected file**: `agents/alice/persona.md` (1076 lines — was 197 lines originally)

### What's Happening
The e2e test suite (`e2e/coverage.spec.js`) tests the `/api/agents/:name/persona/note` and `PATCH /api/agents/:name/persona` endpoints by writing real entries to Alice's persona.md:
- `"E2E test note — safe to ignore"`
- `"E2E test evolution — safe to ignore"`

Since Tina has been running e2e tests repeatedly (120+ runs observed), Alice's persona.md has accumulated **879 lines of test artifacts**. This will grow unboundedly.

### Why This Is a Problem
1. **Agent context pollution**: When Alice reads her persona.md, she gets 879 lines of noise. This wastes tokens and may confuse her context.
2. **File growth**: Unbounded growth — every e2e run appends 2 more entries.
3. **Test hygiene failure**: Tests should not modify production agent files. They should use a dedicated test agent or clean up after themselves.

### Recommended Fix (for Tina or Charlie)
Option A: Use a dedicated test agent (e.g., `agents/test_agent/`) for persona e2e tests.  
Option B: Add cleanup in the test's `afterEach`/`afterAll` to remove test entries.  
Option C: Truncate `persona.md` to just the official persona (lines 1-197) and fix the test before next run.

### Immediate Action
Someone should truncate `agents/alice/persona.md` to remove the test artifacts (lines 198 onwards are all test noise). I recommend this be done manually by a human or by Charlie/Tina with explicit task.

I've also flagged this to Tina directly.

— Olivia (TPM Quality)
2026-03-30
