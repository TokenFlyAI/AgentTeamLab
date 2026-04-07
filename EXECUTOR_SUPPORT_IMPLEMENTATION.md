# Executor Support Implementation Notes

## Goal

Extend Agent Planet from two hardcoded executors (`claude`, `kimi`) to a four-executor model (`claude`, `kimi`, `codex`, `gemini`) while:

- preserving existing Claude/Kimi behavior
- keeping rollout and rollback safe
- making future executor additions cheaper
- allowing web UI, API, and shell runtime to use the same executor model

## High-Level Design

The implementation was done as a narrow executor abstraction instead of a full platform rewrite.

The main design decisions were:

- keep `run_agent.sh` as the orchestrator
- keep `executor.txt` as the per-agent assignment source
- keep the dashboard/API model of "one executor per agent"
- add a shared executor registry
- add executor health/readiness metadata
- add global executor enable/disable gating
- preserve current Claude/Kimi behavior as much as possible

This made Codex/Gemini support possible without scattering more `claude|kimi` branches around the repo.

## Files Added

### [`lib/executors.sh`](/Users/chenyangcui/Documents/code/aicompany/lib/executors.sh)

Added a shared shell-side executor registry and helper layer.

Responsibilities:

- define supported executors
- define default executor
- define default enabled executor set
- validate executor names
- normalize enabled executor config
- detect whether an executor is enabled
- map executor names to binary/label/transport
- provide simple auth status and auth hints

Executors defined:

- `claude`
- `kimi`
- `codex`
- `gemini`

### [`lib/executors.js`](/Users/chenyangcui/Documents/code/aicompany/lib/executors.js)

Added a matching Node-side executor registry used by the backend/UI API layer.

Responsibilities:

- expose shared executor metadata to `server.js`
- centralize supported executor list
- centralize default enabled executor logic
- normalize executor names
- provide metadata such as labels, badges, transport, auth hints

### [`tests/unit/executors.test.js`](/Users/chenyangcui/Documents/code/aicompany/tests/unit/executors.test.js)

Added unit coverage for registry behavior and enabled-executor normalization.

## Files Changed

### [`lib/executor_config.sh`](/Users/chenyangcui/Documents/code/aicompany/lib/executor_config.sh)

Generalized executor/session helper behavior so it is no longer tightly coupled to only Claude/Kimi.

Key changes:

- validation now goes through shared executor helpers
- session-state lookup supports executor-aware behavior
- backward compatibility was preserved for legacy session files

Why:

Existing session naming and validation logic did not scale cleanly beyond two executors.

### [`run_agent.sh`](/Users/chenyangcui/Documents/code/aicompany/run_agent.sh)

Refactored the runtime to support:

- `claude`
- `kimi`
- `codex`
- `gemini`

The intent was not to redesign the agent loop, but to move executor-specific launch behavior behind a cleaner seam.

Responsibilities still kept in `run_agent.sh`:

- prompt construction
- context handling
- cycle orchestration
- memory snapshot behavior
- loop status / cycle tracking

Executor-specific behavior was updated to handle:

- executor selection
- executor-specific session handling
- Codex invocation
- Gemini invocation

### [`server.js`](/Users/chenyangcui/Documents/code/aicompany/server.js)

Backend executor support was expanded and normalized.

Main changes:

- import shared executor metadata from `lib/executors.js`
- add support for `codex` and `gemini`
- add `/api/executors`
- add `/api/executors/health`
- make per-agent executor set/get honor the shared executor model
- add enabled-executor resolution from config/environment
- expose executor health metadata on agent API responses
- normalize `enabled_executors` in smart-run config handling

Important bug fix made during live verification:

- the agent executor save endpoint was rejecting `codex` as "disabled" even when the enabled list contained it
- root cause: `setExecutorForAgent()` checked only `process.env.ENABLED_EXECUTORS` instead of the resolved enabled-executor list
- fix: use `getEnabledExecutorList()` directly for `requireEnabled` validation

This was the main live bug blocking Codex assignment from the web UI.

### [`index_lite.html`](/Users/chenyangcui/Documents/code/aicompany/index_lite.html)

Updated the dashboard so executor support is data-driven instead of Claude/Kimi-only.

Main changes:

- added metadata for `codex` and `gemini`
- executor badges/colors/icons now cover all four executors
- executor dropdown in agent settings is populated from `/api/executors`
- Fleet page now has an `Enabled Executors` control block
- Fleet config save path includes `enabled_executors`
- agent settings modal uses the live executor catalog instead of a hardcoded pair

Important live observation:

- the per-agent settings dropdown did include `codex` and `gemini` once the backend/API were correct
- the browser automation originally appeared stuck because the page start/save flows use modal/confirm patterns that needed explicit Playwright handling

### [`init_agent.sh`](/Users/chenyangcui/Documents/code/aicompany/init_agent.sh)

Updated executor validation to recognize the expanded executor set.

### [`stop_agent.sh`](/Users/chenyangcui/Documents/code/aicompany/stop_agent.sh)

Updated process/session cleanup behavior to be safer with multiple executor types.

### [`clean_history.sh`](/Users/chenyangcui/Documents/code/aicompany/clean_history.sh)

Updated cleanup paths to match generalized executor/session state handling.

### [`README.md`](/Users/chenyangcui/Documents/code/aicompany/README.md)

Updated to reflect expanded executor support and rollout model.

### [`CLAUDE.md`](/Users/chenyangcui/Documents/code/aicompany/CLAUDE.md)

Updated to reflect the broader executor environment instead of a Claude/Kimi-only assumption.

### [`VERIFICATION_REPORT.md`](/Users/chenyangcui/Documents/code/aicompany/VERIFICATION_REPORT.md)

Updated with new executor-related verification context.

### [`FLEET_CONTROL_GUIDE.md`](/Users/chenyangcui/Documents/code/aicompany/FLEET_CONTROL_GUIDE.md)

Updated Fleet guidance to include enabled-executor gating and rollout safety.

### [`planets/kalshi-traders/shared/smart_run_config.json`](/Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/shared/smart_run_config.json)

Updated live fleet config to include:

- `enabled_executors`

This allows the web UI and backend to expose `codex` / `gemini` without relying only on process env.

## Executor Model Implemented

The implementation now distinguishes these states:

- supported: executor exists in code
- enabled: executor is allowed in this workspace
- installed: CLI exists on the machine
- runnable: backend considers it available for execution

The backend now returns this information through `/api/executors`.

## Credentials / Readiness Model

The implementation does **not** store provider secrets per agent.

Instead, it exposes provider-level hints and simple readiness information:

- `claude`: `ANTHROPIC_API_KEY` or Claude login
- `kimi`: `KIMI_API_KEY` / `MOONSHOT_API_KEY` or Kimi login
- `codex`: `OPENAI_API_KEY` or Codex login
- `gemini`: `GEMINI_API_KEY` / `GOOGLE_API_KEY` or Gemini login

The health object includes:

- install state
- enabled state
- auth hint
- label/badge metadata

## Live Verification Performed

### Static / syntax verification

Verified:

- `bash -n run_agent.sh`
- `bash -n init_agent.sh`
- `bash -n stop_agent.sh`
- `bash -n clean_history.sh`
- `node --check server.js`
- `node --check lib/executors.js`
- `bash -n lib/executors.sh`

### Unit verification

Verified:

- `node tests/unit/executors.test.js`

### Backend verification

Verified live API responses from the running dashboard:

- `/api/executors` returned all four executors
- `/api/agents/:name/executor` returned per-agent executor and health
- `POST /api/agents/:name/executor` worked for `codex`

### Browser / Playwright verification

Verified with Playwright against the local site:

- dashboard page loads
- Fleet tab renders
- `Enabled Executors` section renders
- Codex and Gemini appear in Fleet controls
- agent settings modal executor dropdown contains:
  - Claude
  - Kimi
  - Codex
  - Gemini
- selection checkboxes for agents work
- `Start Selected` button appears when agents are selected

Important note from browser verification:

- the bulk start flow uses a browser confirmation dialog
- browser automation must accept that dialog
- the apparent "hang" during some browser tests was caused by the confirmation dialog, not by the backend

### Live run verification

Verified through the normal website flow:

1. switched `alice`, `bob`, and `charlie` to `codex`
2. selected those three agents in the Agents page
3. triggered `Start Selected` through the website flow
4. accepted the page confirmation dialog
5. verified live ping state showed all three as running

Observed running state after web start:

- `alice`: running
- `bob`: running
- `charlie`: running

This confirmed the page-driven bulk start path was functioning for three Codex-assigned agents.

## Bugs Found During Live Verification

### 1. Per-agent executor save rejected Codex incorrectly

Symptom:

- agent settings dropdown showed Codex
- saving Codex returned backend error saying executor disabled

Cause:

- enabled-executor validation used only `process.env.ENABLED_EXECUTORS`
- live config used `smart_run_config.json`

Fix:

- resolve enabled executors through `getEnabledExecutorList()`

### 2. Browser automation appeared stuck during bulk start

Symptom:

- Playwright seemed to hang on `Start Selected`

Cause:

- web page shows a `confirm(...)` dialog before starting selected agents

Fix:

- accept dialog in Playwright

This was not an app bug, but it was a verification trap.

### 3. Detached local server restart was unreliable in this environment

Symptom:

- some detached `node server.js ... &` restarts exited immediately

Workaround used for live verification:

- keep a normal running dashboard process on port `3199`
- verify against that stable server instead of repeatedly bouncing it

## Backward Compatibility Preserved

Preserved behavior for current system:

- Claude/Kimi remain valid executors
- existing API shape remains mostly intact
- per-agent `executor.txt` remains authoritative
- session continuity helpers keep legacy compatibility paths
- UI still supports current workflow patterns

## Rollout / Safety Model Implemented

The system now supports global gating of executor exposure:

- backend can decide which executors are enabled
- Fleet UI exposes enabled-executor controls
- agent settings only show enabled executors from the live catalog

This gives:

- safer rollout
- faster rollback
- cleaner operator control

## Remaining Notes

- There are still uncommitted local changes at the time of writing for the executor/UI/config path.
- Live verification confirmed the key web/UI/backend path for Codex selection and three-agent start.
- If deeper runtime verification is needed, the next step is to inspect per-cycle Codex output artifacts/log destinations in `run_subset.sh` / `run_agent.sh` and ensure they are written where operators expect.

## Summary

The executor expansion was implemented by:

- adding a shared executor registry
- updating runtime/backend/UI to use it
- adding Codex and Gemini support
- adding enabled-executor gating
- surfacing health/readiness metadata
- fixing the live backend save bug for Codex
- verifying the normal website flow for selecting three Codex agents and starting them

The most important completed outcome is that Codex is now:

- visible in Fleet controls
- visible in per-agent settings
- assignable through the live backend
- assignable through the normal web workflow
- startable for multiple agents through the normal website flow

## Chronological Record Of Work

This section is a more literal record of what was done, in order.

### 1. Codebase analysis

Reviewed the current repo to understand where executor support was hardcoded.

Primary files identified:

- [`run_agent.sh`](/Users/chenyangcui/Documents/code/aicompany/run_agent.sh)
- [`lib/executor_config.sh`](/Users/chenyangcui/Documents/code/aicompany/lib/executor_config.sh)
- [`server.js`](/Users/chenyangcui/Documents/code/aicompany/server.js)
- [`index_lite.html`](/Users/chenyangcui/Documents/code/aicompany/index_lite.html)
- [`init_agent.sh`](/Users/chenyangcui/Documents/code/aicompany/init_agent.sh)
- [`stop_agent.sh`](/Users/chenyangcui/Documents/code/aicompany/stop_agent.sh)
- [`clean_history.sh`](/Users/chenyangcui/Documents/code/aicompany/clean_history.sh)

Conclusion from that review:

- executor support existed in multiple places
- the current implementation was effectively dual-executor and not extensible
- the right minimal-change approach was to add a shared executor seam instead of redesigning the platform

### 2. Research and compatibility planning

Confirmed the expected external behavior for:

- Codex CLI
- Gemini CLI
- Claude Code
- existing Kimi support assumptions

The implementation was then shaped around:

- non-interactive CLI execution
- session semantics
- machine-readable output support
- working-directory handling
- credentials/readiness hints

### 3. Shared executor registry implementation

Created:

- [`lib/executors.sh`](/Users/chenyangcui/Documents/code/aicompany/lib/executors.sh)
- [`lib/executors.js`](/Users/chenyangcui/Documents/code/aicompany/lib/executors.js)

This established:

- supported executor list
- default executor
- enabled-executor parsing
- per-executor metadata
- auth hints
- badge metadata for UI

### 4. Backend integration

Updated [`server.js`](/Users/chenyangcui/Documents/code/aicompany/server.js) to:

- use shared executor metadata
- expose executor catalog and health
- allow Codex/Gemini as valid executors
- expose enabled-executor state
- return per-agent executor health
- normalize smart-run config executor enablement

### 5. Shell/runtime integration

Updated executor-related shell code so the runtime could work with more than two executors.

This included:

- generalized validation
- generalized session support
- runtime support for Codex and Gemini
- backward-compatible handling for older executor state

### 6. UI integration

Updated [`index_lite.html`](/Users/chenyangcui/Documents/code/aicompany/index_lite.html) so the UI could:

- render four executor types
- show executor badges correctly
- populate per-agent settings from the live catalog
- expose Fleet-level enabled-executor controls

### 7. Docs and test additions

Added and updated:

- unit tests for executor helpers
- main docs covering executor support
- fleet-control docs
- verification notes

### 8. Static verification

Ran syntax and static checks on:

- shell files
- backend files
- registry files

This was done before live server verification to catch mechanical breakage early.

### 9. Live dashboard verification

Brought up the local dashboard and verified live API responses from:

- `/api/executors`
- `/api/agents/:name/executor`

Confirmed that:

- all four executors were exposed
- health metadata was present
- Codex and Gemini appeared enabled when configured

### 10. Fleet page verification

Used Playwright to load the real dashboard and inspect the Fleet page.

Confirmed:

- the page loaded correctly
- the Fleet tab rendered
- the `Enabled Executors` section rendered
- Codex and Gemini were visible there

### 11. Per-agent settings verification

Used Playwright to open a real agent modal and inspect the settings tab.

Confirmed:

- the modal opened
- the settings tab existed
- the executor dropdown contained:
  - Claude
  - Kimi
  - Codex
  - Gemini

### 12. Live save bug discovery

During real verification, a bug appeared:

- Codex was visible in the dropdown
- but saving Codex for an agent failed

Verified directly with the live backend that:

- `POST /api/agents/alice/executor` returned an executor-disabled error
- even though `/api/executors` showed Codex enabled

This proved the issue was not the dropdown; it was backend validation logic.

### 13. Live save bug fix

Patched [`server.js`](/Users/chenyangcui/Documents/code/aicompany/server.js) so executor enablement checks use the resolved enabled-executor list instead of only `process.env.ENABLED_EXECUTORS`.

That fixed the mismatch between:

- enabled executors from config
- executor save validation

After the fix:

- `POST /api/agents/alice/executor` succeeded for Codex
- `GET /api/agents/alice/executor` showed Codex

### 14. Live multi-agent start verification

Changed three agents to Codex:

- `alice`
- `bob`
- `charlie`

Then tested the normal website start flow for those three.

What happened:

- selecting agents in the page worked
- `Start Selected` appeared
- initial browser automation seemed stuck

Root cause found:

- the UI shows a confirmation dialog before starting selected agents
- automation must accept the confirm dialog

After handling the dialog, verified via live API ping endpoints that:

- `alice` was running
- `bob` was running
- `charlie` was running

### 15. Additional operational observation

Detached server restarts in this environment were inconsistent.

Because of that, the practical live-verification approach became:

- keep one normal server process on `3199`
- verify against that running instance
- avoid repeated restart churn while testing the UI

That was an environment stability issue, not an executor-model design issue.

## Commits Already Made During This Work

Earlier in this implementation, two commits were created and pushed:

- `e4a7316` — initial multi-executor support work
- `af9813b` — safer enabled-executor default / rollout follow-up

These commits were part of the feature rollout before later live fixes and verification work continued locally.
