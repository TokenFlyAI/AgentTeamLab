# Bug Log

> Auto-maintained. Discovered during monitoring sessions.

---

## OPEN

### BUG-019: kimi --continue resumes dangling tool_call session after SIGKILL
**Severity:** High
**Discovered:** 2026-04-02
**File:** `run_agent.sh` (kimi executor, cycle resume)
**Symptom:** When a kimi agent process is SIGKILL'd mid-tool-call, kimi's server records an incomplete assistant message with unresolved `tool_calls`. Next resume with `--continue` gets `400: an assistant message with tool_calls must be followed by tool results`. Agent enters infinite fast-fail loop. Clearing `session_id_kimi.txt` doesn't help — `--continue` picks up the last kimi session globally (from `~/.kimi/sessions/`), which is still the broken one.
**Root cause:** `--continue` resumes the most recent global kimi session per working directory — clearing the local session marker doesn't affect kimi's server-side state.
**Fix applied:** Switch affected agent to claude executor. Delete the broken session from `~/.kimi/sessions/` to force kimi to start fresh.
**Proper fix:** On kimi 400 "tool_calls" error, detect via stderr pattern and delete the specific broken session from `~/.kimi/sessions/` before retrying.

---

### BUG-020: `run_subset.sh` lock uses `$$` (parent PID) in subshells — blocks agent's own future cycles
**Severity:** High
**Discovered:** 2026-04-02
**File:** `run_subset.sh` (lock file in `(...)&` subshell)
**Symptom:** After adding BUG-018 lock fix, `$$` in a `(...)&` subshell returns the PARENT process PID (not the subshell PID). All 4 agent locks get the same PID. Each agent's own next-cycle check sees its lock as "alive" and skips itself. Agents run exactly one cycle then stop forever.
**Root cause:** In bash, `$$` inside `(...)&` subshells returns the parent PID. `$BASHPID` would work but isn't available on macOS's bash 3.2.
**Fix:** Use `MY_PID=$(sh -c 'echo $PPID')` to get the actual subshell PID on macOS.

---

### BUG-018: Multiple smart-start calls spawn duplicate agent processes
**Severity:** High
**Discovered:** 2026-04-02
**File:** `smart_run.sh` / `server.js` (/api/agents/smart-start)
**Symptom:** Calling `POST /api/agents/smart-start` + `bash run_subset.sh` + smart_run daemon concurrently spawns N copies of the same agent. Observed: 4x alice, 3x bob. Duplicate agents write to the same session file, causing fast-fail races and duplicate log entries. Session cycle counts increment erratically.
**Root cause:** `run_subset.sh` doesn't check if an agent is already running before launching. `/api/agents/smart-start` also calls `smart_run.sh` without checking existing `run_subset.sh` loops.
**Impact:** Fast-fail cascade (each duplicate fails when the other holds the session lock), wasted tokens, log noise
**Fix needed:** Add guard in `run_subset.sh`: before launching, check `pgrep -f "run_agent.sh ${ag}$"` — if already running, skip. Or use a per-agent lock file.

---

### BUG-001: kimi content_filter on long prompts (both stream-json and plain mode)
**Severity:** Critical  
**Discovered:** 2026-04-01  
**File:** `run_agent.sh` (kimi executor branch)  
**Symptom:** kimi returns `Error code: 400 - content_filter` for tina's prompt (~14,910 chars) even in plain `--print` mode. Alice (~13,569 chars) works fine. Tina's prompt consistently rejected.  
**Affected agents:** tina (confirmed — every cycle fails)  
**Not affected:** alice (shorter prompt), bob, charlie, sam  
**Root cause:** Unknown — suspected kimi content filter triggered by tina's QA/security content + financial trading direction in same prompt. Size may be a factor.  
**Impact:** Tina can't use kimi executor — infinite 400 error loop  
**Fix:** Switched tina to claude executor (`echo "claude" > agents/tina/executor.txt`)

---

### BUG-002: Agent inboxes not cleaned before run — stale messages from previous agent cycle
**Severity:** Medium  
**Discovered:** 2026-04-01  
**File:** `e2e_dry_run/clean_agents.sh` / `run_agent.sh`  
**Symptom:** After a run is killed mid-cycle, agents generate messages into each other's inboxes (e.g. `from_charlie_ready_for_tasks.md`, `from_sam_idle_alert.md` in alice's inbox). These persist into the next run, polluting cycle 1 context.  
**Affected:** alice inbox (2 msgs from previous partial run), bob inbox (2 msgs)  
**Root cause:** `clean_agents.sh` only cleans the 5 E2E agents' inboxes, but agents write to all 20 agents' inboxes during operation  
**Fix:** `clean_agents.sh` should also wipe all 20 agents' inboxes when used for E2E runs  

---

### BUG-003: Tasks not being claimed by agents (tasks 218-220 remain unassigned after cycle 1)
**Severity:** Medium  
**Discovered:** 2026-04-01  
**Symptom:** Alice ran cycle 1 successfully (real kimi call), but tasks 218-220 remain open/unassigned. Agent didn't claim or update any tasks.  
**Possible causes:**  
1. Agent needs multiple cycles to discover and claim tasks  
2. Tasks are unassigned (no `assignee`) — agents might skip unassigned tasks  
3. The task grep command in prompt.md filters by agent name, so unassigned tasks may not surface  
**Note:** This may be expected behavior on cycle 1 — agents need time to orient. Monitor across more cycles.

---

### BUG-004: Resume mode not working for kimi — all cycles are fresh starts
**Severity:** Critical  
**Discovered:** 2026-04-01  
**File:** `run_agent.sh` (session ID extraction for kimi)  
**Symptom:** kimi session_id is extracted via `jq -r 'select(.type == "result") | .session_id'` from `--output-format stream-json` output. But kimi's stream-json format does NOT include a `session_id` field in the result — it uses a different schema (`message_id` in `StatusUpdate`). So `SAVED_SESSION_ID` is always empty → `USE_RESUME=0` → every cycle is fresh start.  
**Impact:** 0% KV cache hits for kimi, every cycle costs full prompt tokens  
**Fix:** Use `--continue` flag for kimi resume instead of `--session $ID` — kimi tracks sessions per working directory, `--continue` resumes the last session without needing an explicit ID  

---

### BUG-005: E2E injector injects tasks with no assignee — agents don't pick them up
**Severity:** Low  
**Discovered:** 2026-04-01  
**File:** `e2e_dry_run/inject_events.sh`  
**Symptom:** CEO quick command `task: ...` creates tasks with `assignee: unassigned`. Agents grep for their own name on the task board and won't see unassigned tasks unless they specifically scan for them.  
**Fix:** Either assign tasks explicitly in inject_events.sh, or update agent prompts to also check unassigned tasks  

---

### BUG-008: Task board column parsing wrong in `build_selection_list`
**Severity:** High  
**Discovered:** 2026-04-02  
**File:** `smart_run.sh` (build_selection_list, line ~178)  
**Symptom:** `while IFS='|' read -r _ id title assignee status _` only has 6 variables. Task board has 10 columns. `assignee` reads Description, `status` reads Priority — completely wrong. No agents selected via task assignment.  
**Impact:** Only alice (force_alice) and inbox agents get started. Task-assigned agents (bob, charlie) never selected.  
**Fix:** Changed read to `read -r _ id title _desc _priority _group assignee tb_status _` — correct column mapping. Also handles comma-separated assignees (e.g., "ivan,grace").

---

### BUG-007: `setsid` not available on macOS — daemon can't start any agents
**Severity:** Critical  
**Discovered:** 2026-04-02  
**File:** `smart_run.sh` (daemon_loop, line ~332)  
**Symptom:** `setsid bash run_agent.sh agent` fails silently on macOS (setsid not in PATH). Daemon runs but starts 0 agents. `build_selection_list` returns agents but launch fails with "command not found".  
**Root cause:** `setsid` is Linux-only. macOS doesn't ship it.  
**Fix:** Added `command -v setsid` check — falls back to `nohup bash run_agent.sh agent` on macOS

---

### BUG-006: Stale heartbeat traps daemon — agents never restarted after cycle
**Severity:** High  
**Discovered:** 2026-04-02  
**File:** `run_agent.sh`, `smart_run.sh`  
**Symptom:** After a kimi cycle completes, heartbeat.md stays "running" (written by kimi during cycle). `is_agent_running()` in smart_run.sh returns true based solely on heartbeat status, never checking actual process. Daemon thinks agents are running and doesn't restart them.  
**Root cause 1:** `run_agent.sh` had no trap on EXIT — if killed before line 553 (idle write), heartbeat stays "running"  
**Root cause 2:** `is_agent_running()` trusts heartbeat "running" without checking process age or pgrep  
**Fix 1:** Added `trap '_write_idle_heartbeat' EXIT` in run_agent.sh after initial heartbeat write  
**Fix 2:** Updated `is_agent_running()` to check heartbeat age — if >5 min old, verify with pgrep before trusting "running"  

---

---

### BUG-010: `parseCycleContent()` wrong regex — cycle detail shows blank LLM output
**Severity:** High
**Discovered:** 2026-04-02
**File:** `index_lite.html` (parseCycleContent function)
**Symptom:** Clicking a cycle in the agent modal showed no readable LLM text — just the raw log or fallback "last 80 lines". User couldn't see what agents were doing.
**Root cause:** Regex `\ntext='([\s\S]*?)',?\n` targeted the raw kimi log format (`TextPart(\n    text='...')`) but `run_agent.sh` writes to a *daily* log (not raw) where the processing pipeline converts single-line TextParts via sed → `[ASSISTANT] ...` and strips 4-space-indented lines. So the `text='` pattern never matched the daily log.
**Fix:** Updated `parseCycleContent()` with two correct patterns:
  1. `\[ASSISTANT\] ([\s\S]*?)(?=\nToolCall\(|\nTextPart\(|...)` — sed-converted single-line responses
  2. `TextPart\(\n([\s\S]*?)(?='?\n(?:ToolCall\(|...))` — multi-line TextPart continuations

---

### BUG-011: Agent card always shows 🅒 claude badge even for kimi agents
**Severity:** Low
**Discovered:** 2026-04-02
**File:** `server.js` (getAgentSummary), `index_lite.html`
**Symptom:** All agent cards displayed the blue 🅒 claude badge. Kimi agents should show purple 🅚.
**Root cause:** `getAgentSummary()` (used by `/api/dashboard` and `/api/agents` list) didn't include `executor` field. The UI fell back to `agent.executor || 'claude'` → always 'claude'.
**Fix:** Added `const executor = getExecutorForAgent(name)` to `getAgentSummary()` return value.

---

### BUG-012: `force_alice` boolean flip — daemon silently sets force_alice=0 every restart
**Severity:** High
**Discovered:** 2026-04-02
**File:** `smart_run.sh` (read_config)
**Symptom:** After daemon restart, `force_alice` would flip to 0 even if set to 1 via API. Alice stopped being force-started. Affected every daemon restart cycle.
**Root cause:** Config API writes `"force_alice": 1` (integer). `read_config` used `jq -r '.force_alice // true' | grep -qi "true"` — jq returns `"1"` (string), `grep "true"` on `"1"` fails → `FORCE_ALICE=0` → `write_config` writes `"force_alice": 0` → next read returns `"0"` → same failure. Self-reinforcing loop.
**Fix:** Changed to `jq -r 'if (.force_alice == true or .force_alice == 1) then 1 else 0 end'` — handles both boolean and integer representations.

---

### BUG-013: SIGTERM trap overwrites config with stale runtime values
**Severity:** High
**Discovered:** 2026-04-02
**File:** `smart_run.sh` (daemon_loop SIGTERM trap, --stop handler)
**Symptom:** When daemon stopped (via API or `--stop`), it called `write_config "false"` using the daemon's in-memory variable values (e.g. `max_agents=3`). This overwrote any config changes made via the API while the daemon was running — e.g. setting `max_agents=4` via API would be wiped back to 3 on next stop.
**Root cause:** SIGTERM handler unconditionally wrote all config fields including `max_agents`, `selection_mode`, etc. from daemon's stale runtime state.
**Fix:** SIGTERM trap now only removes the PID file and exits — does not write config. Removed `write_config "false"` from `--stop` handler too.

---

### BUG-014: `force_alice` bypassed at max capacity — alice not started when 4 agents already running
**Severity:** Medium
**Discovered:** 2026-04-02
**File:** `smart_run.sh` (build_selection_list, priority 1 block)
**Symptom:** When all 4 agent slots were taken by other agents (e.g. bob, dave, grace, heidi), alice was not started despite `force_alice=1`. Dashboard showed alice as idle indefinitely.
**Root cause:** `add_agent "alice"` was gated by `under_max && add_agent "alice"` — when already at `MAX_AGENTS`, `under_max` returns false and alice is skipped.
**Fix:** When `FORCE_ALICE=1`, alice bypasses `under_max` check: `if [ "$FORCE_ALICE" -eq 1 ]; then add_agent "alice"; else under_max && add_agent "alice"; fi`

---

### BUG-015: Default `max_agents=3` in smart_run.sh overrides config on fresh start
**Severity:** Medium
**Discovered:** 2026-04-02
**File:** `smart_run.sh` (top-level defaults, jq fallback)
**Symptom:** On daemon restart, `max_agents` silently reverted to 3 even if config file had 4.
**Root cause:** Script-level default `MAX_AGENTS=3` (line 32) was used as jq fallback `.max_agents // 3`. The grep/sed fallback also defaulted to 3.
**Fix:** Changed all defaults from 3 to 4: `MAX_AGENTS=4`, `.max_agents // 4`, `MAX_AGENTS="${MAX_AGENTS:-4}"`.

---

### BUG-016: `/api/search` results missing `agent`/`file` fields for non-agent result types
**Severity:** Low
**Discovered:** 2026-04-02
**File:** `server.js` (/api/search endpoint)
**Symptom:** E2E test `result entries have agent and file fields` failed. Search results for `type:"tasks"` and `type:"announcements"` lacked `agent` and `file` keys entirely — JS `in` operator returned false.
**Root cause:** Only `type:"agent"` results included `agent` and `file`. Other types omitted them.
**Fix:** Added `agent: null, file: null` to `tasks` and `announcements` result objects.

---

### BUG-017: SOPs missing — `/api/agents/:name/context` returns `sop: null`
**Severity:** Low
**Discovered:** 2026-04-02
**File:** `public/sops/` (missing files)
**Symptom:** E2E test `sop is non-null string when mode is valid` failed. Context API returned `sop: null` for all modes.
**Root cause:** `public/sops/` directory existed but contained no files. Server reads `sops/{mode}_mode.md`.
**Fix:** Created `public/sops/normal_mode.md`, `plan_mode.md`, `crazy_mode.md`.

---

## FIXED

### BUG-F001: `MEMORY_FILE` used before definition in `run_agent.sh`
**Fixed:** 2026-04-01 — moved `MEMORY_FILE` declaration before the session boundary block

### BUG-F002: Hardcoded `session_cycle.txt` in cycle logging — ignores executor-specific cycle file
**Fixed:** 2026-04-01 — changed to `$SESSION_CYCLE_FILE`

### BUG-F003: `selection_mode` not persisted by `write_config()` in `smart_run.sh`
**Fixed:** 2026-04-01 — added `selection_mode` to the patch JSON

### BUG-F004: `"norm"` type in `inject_events.sh` — invalid consensus entry type (server returns id `?`)
**Fixed:** 2026-04-01 — changed to `"culture"` type

### BUG-F005: `ORIG_SLEEP` parse error not handled in `e2e_dry_run/run.sh`
**Fixed:** 2026-04-01 — added `|| echo 120` fallback

### BUG-F006: Culture delta sends full board content (~800 tokens) instead of only new entries
**Fixed:** 2026-04-01 — changed to line-based diff (only new lines)

### BUG-F007: macOS `mktemp` with `.json` suffix creates literal filename (not temp)
**Fixed:** 2026-04-01 — removed `.json` suffix from all 3 `mktemp` calls

### BUG-F008: Dry run never saves session ID → no resume cycles, all fresh starts
**Fixed:** 2026-04-01 — save `"dryrun"` marker to enable cycle tracking without real session

### BUG-F009: `export -f run_agent_loop` for parallel subshells is unreliable
**Fixed:** 2026-04-01 — replaced with inline `(...)&` subshell loops

---

### BUG-009: `\b` word boundary in pgrep not supported on macOS — duplicate agents launched
**Severity:** High  
**Discovered:** 2026-04-02  
**File:** `smart_run.sh` (is_agent_running, lines ~141-149)  
**Symptom:** `pgrep -f "run_agent.sh.*\bbob\b"` silently fails (matches nothing) on macOS because `\b` is a Perl regex extension — macOS pgrep uses POSIX ERE which doesn't support it. Result: daemon thinks agent isn't running and launches duplicates. Observed: 3x bob, 2x dave processes.  
**Fix:** Changed patterns to `run_agent.sh ${ag}$` and `run_agent.sh ${ag} ` — no word boundary needed, just trailing space or end-of-string.
