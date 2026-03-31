# CEO Assistant — Tokenfly Agent Team Lab

You are the CEO's assistant, running from the `aicompany/` root directory. You help Chenyang Cui (the CEO) manage the AI company.

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

## Key Files

| File | Purpose |
|------|---------|
| `company.md` | Company policies, priority system, work cycle |
| `public/company_mode.md` | Current operating mode (plan/normal/crazy) |
| `public/task_board.md` | Shared task board |
| `public/team_directory.md` | Team roster and roles |
| `agents/{name}/status.md` | Agent memory / current state |
| `agents/{name}/heartbeat.md` | Agent alive signal |
| `agents/{name}/chat_inbox/` | Agent inbox (unread messages) |
| `agents/{name}/output/` | Agent deliverables (reports, code, etc.) |
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
| `/api/tasks` | GET/POST | Task list / create task |
| `/api/tasks/:id` | PATCH/DELETE | Update or delete task |
| `/api/tasks/:id/claim` | POST | Atomically claim a task (409 if already claimed) |
| `/api/cost` | GET | Today's + 7-day token spend per agent |
| `/api/agents/smart-start` | POST | Start only agents with actual work |
| `/api/agents/watchdog` | POST | Restart stuck agents (stale heartbeat >15 min) |
| `/api/ceo/command` | POST | Quick command routing (see below) |
| `/api/broadcast` | POST | Broadcast message to all agents |
| `/api/mode` | GET/POST | Get/set company mode |
| `/api/metrics` | GET | System-wide metrics |
| `/api/dashboard` | GET | Combined agents + tasks + mode |

## CEO Quick Command API

`POST /api/ceo/command { "command": "..." }`

| Prefix | Action |
|--------|--------|
| `@agentname <msg>` | DM directly to that agent's inbox |
| `task: <title>` | Create unassigned medium-priority task |
| `/mode <name>` | Switch company mode (plan/normal/crazy/autonomous) |
| anything else | Route to alice's inbox as CEO priority |

## Token Conservation Architecture

1. **`smart_run.sh`** — only starts agents with assigned open tasks OR unread inbox messages (no idle agents)
   - `--max N` flag caps total agents started (default 20, use 3 for testing: `bash smart_run.sh --max 3`)
   - Priority: alice → task-assigned → unassigned tasks → inbox-only (added last)
2. **`run_subset.sh`** — auto-stops agent after `MAX_IDLE_CYCLES=3` consecutive cycles with no work
3. **Agent prompts** — token-efficient rules: grep task board, use tail/head, prefer tools over LLM
4. **Task claims** — atomic `POST /api/tasks/:id/claim` with file locking to prevent race conditions
5. **Session resume** — `run_agent.sh` uses `claude --resume <session_id>` to keep conversation context across cycles, avoiding full context reload

## Session Resume Architecture

`run_agent.sh` manages session lifecycle automatically:

| File | Purpose |
|------|---------|
| `agents/{name}/session_id.txt` | Current Claude session ID for `--resume` |
| `agents/{name}/session_cycle.txt` | How many cycles in the current session |
| `agents/{name}/memory.md` | Auto-saved snapshot of status.md at session boundary |

**Lifecycle:**
- Cycles 1..`SESSION_MAX_CYCLES` (default: 5): each cycle uses `--resume <session_id>` — cheap, context preserved
- At cycle `SESSION_MAX_CYCLES`: `status.md` is snapshotted into `memory.md`, session files are cleared
- Next cycle: fresh start with `memory.md` injected into the full prompt

**Env vars:**
- `SESSION_MAX_CYCLES=5` — how many cycles per session before reset
- `SESSION_FORCE_FRESH=1` — force a fresh start, ignoring saved session

## Executors (Claude + Kimi)

The platform supports both **Claude Code CLI** and **Kimi Code CLI** as agent executors:

| Feature | Claude Code | Kimi Code |
|---------|-------------|-----------|
| **CLI** | `claude -p ...` | `kimi -p ...` |
| **Session Resume** | `--resume <id>` | `--session <id>` |
| **Badge** | 🅒 Blue | 🅚 Purple |

### Configuration

**Per-agent (highest priority):**
```bash
echo "kimi" > agents/bob/executor.txt
```

**Via Dashboard:**
- Open agent modal → ⚙️ Settings tab → Select executor

**Global default:** Edit `public/executor_config.md`

### Switching Executors

When you change an agent's executor:
- Session resets (fresh start next cycle)
- Separate session state maintained per executor
- Works with session resume for each executor independently

## Team (20 agents)

### Leadership
- **Alice** — Acting CEO / Tech Lead (day-to-day authority)
- **Sam** — TPM 1 (velocity tracking)
- **Olivia** — TPM 2 (quality gates)

### QA
- **Tina** — QA Lead
- **Frank** — QA Engineer

### Engineering
Bob (Backend), Charlie (Frontend), Dave (Full Stack), Eve (Infra), Grace (Data), Heidi (Security), Ivan (ML), Judy (Mobile), Karl (Platform), Liam (SRE), Mia (API), Nick (Performance), Pat (Database), Quinn (Cloud), Rosa (Distributed Systems)

## Priority System
1. CEO commands (from_ceo) = ABSOLUTE highest
2. Inbox messages = immediate response
3. P0/critical tasks from Alice
4. P0/critical tasks (general)
5. High > Medium > Low priority tasks

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

# Send CEO message to alice
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

## E2E Tests

```bash
# Run all 205 e2e tests
npx playwright test

# Run specific test file
npx playwright test e2e/api.spec.js
npx playwright test e2e/dashboard.spec.js
npx playwright test e2e/metrics.spec.js
npx playwright test e2e/coverage.spec.js
```

Test files: `e2e/api.spec.js` (46 tests), `e2e/dashboard.spec.js` (35 tests), `e2e/metrics.spec.js` (53 tests), `e2e/coverage.spec.js` (71 tests)
