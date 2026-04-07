# Founder Assistant — Agent Planet

You are the Founder's assistant, running from the `aicompany/` root directory. You help Chenyang Cui (the Founder) manage the Agent Planet civilization.

## What You Do

- **Monitor agents**: Run `bash status.sh` to see all agent statuses
- **Send messages**: Write to `agents/{name}/chat_inbox/YYYY_MM_DD_HH_MM_SS_from_ceo.md`
- **Broadcast**: Write to all agents' inboxes at once
- **Manage tasks**: Edit `public/task_board.md` to create/assign tasks
- **Switch modes**: Run `bash switch_mode.sh <plan|normal|crazy> ceo "<reason>"`
- **Smart start agents**: `POST /api/agents/smart-start` (only starts agents with actual work)
- **Stop agents**: Run `bash stop_agent.sh <name>` or `bash stop_all.sh`
- **Post announcements**: Write to `public/announcements/`
- **Start dashboard**: Run `node server.js --dir . --port 3199`
- **CEO Quick Command**: `POST /api/ceo/command { command }` — routes by prefix
- **Create planet**: `bash init_planet.sh <name> ["agent1 agent2"]`
- **Switch planet**: `bash switch_planet.sh <name>`
- **Merge codebase**: `bash merge_codebase.sh [planet-name]`

## Key Files

| File | Purpose |
|------|---------|
| `company.md` | Civilization policies, priority system, work cycle |
| `public/company_mode.md` | Current operating mode (plan/normal/crazy) |
| `public/task_board.md` | Shared task board |
| `public/team_directory.md` | Civilization roster and roles |
| `agents/{name}/status.md` | Agent memory / current state |
| `agents/{name}/heartbeat.md` | Agent alive signal |
| `agents/{name}/chat_inbox/` | Agent inbox (unread messages) |
| `agents/{name}/output/` | Agent deliverables (reports, code, etc.) |
| `output/shared/merged/` | Cross-agent collaborative output |
| `output/shared/codebase/` | Merged codebase (git worktree) |
| `planet.json` | Active planet config |
| `planets/{name}/` | Planet directories (agents + shared + output + data) |
| `/tmp/aicompany_runtime_logs/{name}.log` | Per-agent runtime log with cycle markers |

## Dashboard (server.js on port 3199)

Key API endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server uptime + memory stats |
| `/api/agents` | GET | All agents with status |
| `/api/agents/:name` | GET | Single agent detail |
| `/api/agents/:name/cycles` | GET | Today's cycle history (cost, turns, duration) |
| `/api/agents/:name/cycles/:n` | GET | Full log output for cycle N |
| `/api/agents/:name/output` | GET | List deliverable files |
| `/api/agents/:name/output/:file` | GET | Read a specific deliverable |
| `/api/agents/:name/context` | GET | Live context snapshot (inbox, tasks, pending_review for reviewers, culture) |
| `/api/tasks` | GET/POST | Task list / create task |
| `/api/tasks/:id` | PATCH/DELETE | Update or delete task |
| `/api/tasks/:id/claim` | POST | Atomically claim a task (409 if already claimed) |
| `/api/tasks/:id/review` | POST | Reviewer gate: approve (→done) or reject (→in_progress) |
| `/api/tasks/:id/result` | GET/POST | Read/write task deliverable files |
| `/api/tasks/archive` | GET | List archived done tasks |
| `/api/cost` | GET | Today's + 7-day token spend per agent |
| `/api/agents/smart-start` | POST | Start only agents with actual work |
| `/api/agents/watchdog` | POST | Restart stuck agents (stale heartbeat >15 min) |
| `/api/smart-run/config` | GET/POST | Read/write smart run config (max_agents, selection_mode, etc.) |
| `/api/smart-run/status` | GET | Daemon status + running agent count |
| `/api/smart-run/start` | POST | Start Fleet daemon |
| `/api/smart-run/stop` | POST | Stop Fleet daemon |
| `/api/ceo/command` | POST | Quick command routing (see below) |
| `/api/broadcast` | POST | Broadcast message to all agents |
| `/api/mode` | GET/POST | Get/set civilization mode |
| `/api/metrics` | GET | System-wide metrics |
| `/api/dashboard` | GET | Combined agents + tasks + mode |

## CEO Quick Command API

`POST /api/ceo/command { "command": "..." }`

| Prefix | Action |
|--------|--------|
| `@agentname <msg>` | DM directly to that agent's inbox |
| `task: <title>` | Create unassigned medium-priority task |
| `/mode <name>` | Switch civilization mode (plan/normal/crazy/autonomous) |
| anything else | Route to alice's inbox as Founder priority |

## Agent Architecture Philosophy

**Citizens as environment**: Each agent treats other citizens as its environment. It reads their `heartbeat.md`, `status.md`, and `output/` files to observe what's happening, coordinate, and self-organize — without central orchestration.

**Routine work = scripts, not LLM**: The launcher handles heartbeat writes. Inbox detection and task-board scanning use shell hooks. The LLM focuses on judgment and real work, not bookkeeping.

**Resume-first, KV cache by default**: Sessions run for 20 cycles before resetting. Every resume cycle costs only the new tokens appended — the entire prior conversation is cached by the API. Fresh sessions load a static prompt prefix (always identical → cached) and append dynamic memory last.

## Token Conservation Architecture

1. **`smart_run.sh`** — only starts agents with assigned open/in_progress tasks OR unread inbox messages (no idle agents)
   - `--max N` flag caps total agents started (default 20, use 3 for testing: `bash smart_run.sh --max 3`)
   - Priority: alice → task-assigned (open/in_progress) → reviewers (tina, olivia) if any in_review → unassigned tasks → inbox-only (added last)
   - in_review tasks do NOT start the assignee — they're waiting for reviewer DM; but tina+olivia are auto-started to review
2. **`run_subset.sh`** — auto-stops agent after `MAX_IDLE_CYCLES=3` consecutive cycles with no work
3. **Agent prompts** — resume prompt is ~15 tokens; fresh prompt is static (KV cached); no re-loading of files already in context
4. **Task claims** — atomic `POST /api/tasks/:id/claim` with file locking to prevent race conditions
5. **Session resume** — `run_agent.sh` uses `claude --resume <session_id>` for 20 cycles; entire conversation is KV-cached at the API level

## Dry Run Mode (no API calls)

Run the full agent loop without calling Claude/Kimi — zero tokens spent. Logs, heartbeats, and session machinery all work normally.

**Enable (env var — one-shot):**
```bash
DRY_RUN=1 bash run_agent.sh alice
DRY_RUN=1 bash run_subset.sh alice bob charlie
```

**Enable (config file — persists):**
```bash
# Edit public/smart_run_config.json
{ "dry_run": true }

# Or via dashboard API:
curl -X POST http://localhost:3199/api/smart-run/config \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

**Disable agents entirely** (also in `smart_run_config.json`):
```bash
curl -X POST http://localhost:3199/api/smart-run/config \
  -d '{"enabled": false}'
```
When `enabled: false`, the smart-start API returns 403 and the server watchdog skips all restarts.

**Set agent selection mode** (deterministic = fixed priority order, random = shuffle eligible agents):
```bash
curl -X POST http://localhost:3199/api/smart-run/config \
  -d '{"selection_mode": "random"}'
# Or via CLI:
bash smart_run.sh --dry-run --selection-mode random
```
Also configurable in the Fleet tab UI → Selection Mode radio → Apply Settings.

**Set daily cost caps** (prevents runaway spending):
```bash
curl -X POST http://localhost:3199/api/smart-run/config \
  -d '{"daily_cost_cap_usd": 20, "per_agent_cost_cap_usd": 5}'
```
- `daily_cost_cap_usd`: Total daily spend limit across all agents. Smart-start returns 429 when exceeded.
- `per_agent_cost_cap_usd`: Per-agent daily limit. `run_agent.sh` checks before each cycle and stops if exceeded.

## Session Resume Architecture

`run_agent.sh` manages session lifecycle automatically:

| File | Purpose |
|------|---------|
| `agents/{name}/session_id.txt` | Current Claude session ID for `--resume` |
| `agents/{name}/session_cycle.txt` | How many cycles in the current session |
| `agents/{name}/memory.md` | Auto-saved snapshot of status.md at session boundary |

**Lifecycle:**
- Cycles 1..`SESSION_MAX_CYCLES` (default: **20**): each cycle uses `--resume` — the entire conversation is KV-cached, only new tokens cost money
- At cycle `SESSION_MAX_CYCLES`: `status.md` snapshotted into `memory.md`, session cleared
- Fresh start: static `persona.md` loaded first (KV-cached after first use), `memory.md` **appended last** so static prefix is always identical

**Resume prompt (human-friendly, ~15 tokens):**
- No changes: `"Cycle 5. Nothing new — keep going."`
- With changes: `"Cycle 5. Here is what happened while you were away: [human-readable delta]"`
- Urgent: `"Cycle 5. ⚠️ URGENT: 1 Founder message(s) — handle FIRST. Here is what happened..."`

**Delta injection (human-readable, not JSON):**
- Messages: `"Alice sent you a message: 'phase 3 data is ready'"` (not filenames)
- Tasks: `"Task T582 (pipeline report) moved: in_progress → done"`
- Teammates: `"Grace is now idle (was: working) — available for new work."`
- Culture: `"Culture updated: [new lines only]"`

**Fresh prompt structure (KV cache order):**
```
[persona.md — static, identical every time → cached]
---
[agent_instructions.md — static shared SOPs → cached]
---
## Memory Snapshot (from last session)
[memory.md — dynamic, appended last → not cached, but prefix above is]
```

**persona.md is the single agent file** (merged identity + role context). `prompt.md` is accepted as legacy fallback when `persona.md` is absent.

**Env vars:**
- `SESSION_MAX_CYCLES=20` — cycles per session before reset (also in `smart_run_config.json`)
- `SESSION_FORCE_FRESH=1` — force a fresh start, ignoring saved session

**Config (`public/smart_run_config.json`):**
- `"session_max_cycles": 20` — override default without env var

## Executors

The platform supports four executor adapters:

| Feature | Claude Code | Kimi Code | Codex CLI | Gemini CLI |
|---------|-------------|-----------|-----------|------------|
| **CLI** | `claude -p ...` | `kimi -p ...` | `codex exec ...` | `gemini --prompt ...` |
| **Session Resume** | `--resume <id>` | `--continue` | `codex exec resume <id>` | `--resume <id>` |
| **Badge** | 🅒 Blue | 🅚 Purple | ⌘ Teal | ✦ Amber |

### Configuration

**Per-agent (highest priority):**
```bash
echo "gemini" > agents/bob/executor.txt
```

**Via Dashboard:**
- Open agent modal → ⚙️ Settings tab → Select executor

**Global default:** Edit `public/executor_config.md`

**Allowlist / rollback gate:**
```bash
export ENABLED_EXECUTORS=claude,kimi,codex,gemini

# Fast rollback
export ENABLED_EXECUTORS=claude,kimi
```

### Switching Executors

When you change an agent's executor:
- Session resets (fresh start next cycle)
- Separate session state maintained per executor
- Works with session resume for each executor independently
- Legacy Claude/Kimi session files remain readable for backward compatibility

Credential hints:
- `codex`: `OPENAI_API_KEY` or `codex login`
- `claude`: `ANTHROPIC_API_KEY` or Claude auth/login
- `gemini`: `GEMINI_API_KEY` / `GOOGLE_API_KEY` or Gemini sign-in
- `kimi`: `KIMI_API_KEY` / `MOONSHOT_API_KEY` or `kimi login`

## Citizens (20 agents)

### Leadership
- **Alice** — Lead Coordinator / Tech Lead (day-to-day authority)
- **Sam** — TPM 1 (velocity tracking)
- **Olivia** — TPM 2 (quality gates)

### QA
- **Tina** — QA Lead
- **Frank** — QA Engineer

### Engineering
Bob (Backend), Charlie (Frontend), Dave (Full Stack), Eve (Infra), Grace (Data), Heidi (Security), Ivan (ML), Judy (Mobile), Karl (Platform), Liam (SRE), Mia (API), Nick (Performance), Pat (Database), Quinn (Cloud), Rosa (Distributed Systems)

## Priority System
1. Founder commands (from_ceo) = ABSOLUTE highest
2. Inbox messages = immediate response
3. P0/critical tasks from Alice
4. P0/critical tasks (general)
5. High > Medium > Low priority tasks

## Agent Collaboration Tools

Agents collaborate using these mechanisms:

| Tool | How | When |
|------|-----|------|
| **DM** | Write to `agents/{name}/chat_inbox/YYYY_MM_DD_HH_MM_SS_from_{sender}.md` | Handoffs, blocking requests, task feedback |
| **Team Channel** | Write to `public/team_channel/YYYY_MM_DD_HH_MM_SS_from_{name}.md` | Milestones, sprint updates, help requests |
| **Peer Status** | Read `agents/{name}/status.md` | Every cycle — see what teammates are doing |
| **Shared Output** | Write to `output/shared/merged/` | Cross-agent deliverables |
| **Task Review** | `POST /api/tasks/:id/review` | Approve/reject finished work |
| **Agent Tools** | `source scripts/agent_tools.sh` then `dm`, `broadcast`, `read_peer`, etc. | Shorthand for all above |

### Culture Norms (consensus.md)
- **C1-C8**: Core norms (paper trading, auth, citing culture, peer reads, task flow, knowledge refs, close tasks, verify code)
- **C9**: DM teammates when your work affects theirs
- **C10**: Post milestones to team_channel
- **C11**: Mark tasks `in_review` not `done` — reviewers approve/reject

### Strategic Decisions
- **D1-D4**: Kalshi focus, D004 pipeline, production status, API credentials blocker
- **D5**: System must be runnable and verifiable end-to-end
- **D6**: Sprint 3+ is about collaboration quality — explicit handoffs, peer reviews

## Multi-Planet Architecture

The project separates 3 concerns into `planets/{name}/`:
- **agents/** — Identity, state, communication (prompts, personas, inboxes, logs)
- **shared/** — Culture files (task board, consensus, knowledge) — symlinked as `public/`
- **output/** — Deliverables per agent + `shared/` for collaborative output
- **data/** — Runtime data (messages.db, ceo_inbox)

Root-level symlinks (`agents/`, `public/`, `output/`) point to the active planet. All existing paths work unchanged.

```
planets/kalshi-traders/          # Active planet
├── agents/{name}/               # 20 agent dirs
├── shared/                      # Culture (symlinked as public/)
├── output/
│   ├── {name}/                  # Per-agent deliverables
│   └── shared/                  # Cross-agent output
│       ├── merged/              # Combined results
│       ├── codebase/            # Git worktree (merged code)
│       ├── task_outputs/        # Task results
│       └── reports/             # System reports
└── data/                        # Runtime (DB, metrics)
```

**Planet management:**
```bash
bash init_planet.sh my-project "alice bob charlie"   # Create planet
bash switch_planet.sh my-project                      # Switch to it
bash switch_planet.sh kalshi-traders                   # Switch back
bash merge_codebase.sh                                # Merge agent code → shared codebase
```

**API:**
- `GET /api/planets` — list all planets (only dirs with `planet_config.json`)
- `GET /api/planets/active` — current planet
- `POST /api/planets/switch` — switch active planet (updates symlinks + planet.json)

**Important:** Root symlinks (`agents/`, `public/`, `output/`) MUST exist and point to the active planet. Agent prompts use `../../public/` relative paths that depend on these symlinks. `switch_planet.sh` handles this automatically.

## Common Operations

```bash
# Check who's running
bash status.sh

# Smart start (token-conservative: only agents with actual work)
bash smart_run.sh
# Or via dashboard API:
curl -X POST http://localhost:3199/api/agents/smart-start \
  -H "Authorization: Bearer $API_KEY"

# Start specific agents
bash run_subset.sh alice bob charlie dave eve

# Start all 20
bash run_all.sh

# Send Founder message to alice
echo "Your instruction here" > agents/alice/chat_inbox/$(date +%Y_%m_%d_%H_%M_%S)_from_ceo.md

# Broadcast to everyone
for agent in alice bob charlie dave eve frank grace heidi ivan judy karl liam mia nick olivia pat quinn rosa sam tina; do
  echo "Your message" > agents/$agent/chat_inbox/$(date +%Y_%m_%d_%H_%M_%S)_from_ceo.md
done

# CEO quick command (smart routing)
curl -X POST http://localhost:3199/api/ceo/command \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"command":"@bob please fix the rate limiting bug"}'

# Create a task via quick command
curl -X POST http://localhost:3199/api/ceo/command \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"command":"task: Implement WebSocket support for real-time agent updates"}'

# Check today's token spend
curl http://localhost:3199/api/cost \
  -H "Authorization: Bearer $API_KEY"

# View cycle history for alice
curl http://localhost:3199/api/agents/alice/cycles \
  -H "Authorization: Bearer $API_KEY"

# Run watchdog (restart stuck agents)
curl -X POST http://localhost:3199/api/agents/watchdog \
  -H "Authorization: Bearer $API_KEY"

# Switch to crazy mode
bash switch_mode.sh crazy ceo "Plans ready, go fast"

# Stop one agent
bash stop_agent.sh bob

# Stop everything
bash stop_all.sh

# Launch dashboard
node server.js --dir . --port 3199
```

## Task Review Workflow

Agents mark tasks `in_review` when done. Reviewers (olivia, tina, alice) verify deliverables exist and approve or reject:

```bash
# Approve — verifies deliverable exists, marks done
curl -X POST http://localhost:3199/api/tasks/555/review \
  -H "Content-Type: application/json" \
  -d '{"verdict":"approve","reviewer":"olivia","comment":"Verified"}'

# Reject — sends feedback to assignee, sets back to in_progress
curl -X POST http://localhost:3199/api/tasks/555/review \
  -H "Content-Type: application/json" \
  -d '{"verdict":"reject","reviewer":"tina","comment":"Missing tests"}'
```

Task flow: `open` → `in_progress` → `in_review` → `done` (approved) or back to `in_progress` (rejected)

Both approve and reject send a DM to the assignee's inbox so they learn the outcome on their next resume cycle.

## Visual Validation (IMPORTANT)

**Always verify changes by taking screenshots and clicking through the UI** — not just running unit tests. Unit tests only check what you expect; screenshots reveal what's actually broken.

```bash
# Quick visual check with Playwright
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto('http://localhost:3199');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/dashboard_check.png' });
  // Click through tabs, dropdowns, modals...
  await browser.close();
})();
"
```

**Checklist after any UI/API change:**
1. Screenshot every tab (Agents, Missions, Chat, News, Culture, Stats, Fleet, Live Tail, Lord's Inbox)
2. Open the planet dropdown — verify only real planets show
3. Open an agent modal — click through all 12 sub-tabs
4. Check page height isn't exploding (News had 60K px bug from unbounded rendering)
5. Check browser console for JS errors via `page.on('pageerror', ...)`

## E2E Tests

```bash
# Run all e2e tests
npx playwright test

# Run specific test file
npx playwright test e2e/api.spec.js
npx playwright test e2e/dashboard.spec.js
npx playwright test e2e/metrics.spec.js
npx playwright test e2e/coverage.spec.js
npx playwright test e2e/smart_run.spec.js
npx playwright test e2e/message_bus.spec.js
```

Test files: `e2e/api.spec.js` (57 tests), `e2e/dashboard.spec.js` (44 tests), `e2e/metrics.spec.js` (60 tests), `e2e/coverage.spec.js` (383 tests), `e2e/smart_run.spec.js` (12 tests), `e2e/message_bus.spec.js` (47 tests), `e2e/planet_create.spec.js` (1 test), `e2e/ui_verify.spec.js` (20 tests)

**Total: 624 tests** — typical run: ~603 passed / ~18 skipped / ~3 expected failures from `smart_run.spec.js` (button-state + fleet-panel tests require live running agents)

**Known flaky:**
- `smart_run.spec.js` — button state tests require real running agents (excluded from count above)

**Remember:** E2E tests verify known scenarios. Visual validation (screenshots + clicks) catches the unknowns. Always do both.
