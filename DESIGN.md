# Agent Planet — Design Document

## Product Identity

- **Product name**: Agent Planet (shown as "🪐 Agent Planet" in topbar)
- **Company name**: Never change to "Tokenfly" or anything else — it's "Agent Planet"
- **Tab names**: Agents | Missions | Chat | News | Culture | Stats | Live Tail | Lord's Inbox
  - "Culture" NOT "Facts", NOT anything else
- **Page title**: "TokenFly Agent Planet"

---

## Agent Status System

**Exactly 3 statuses — no others:**

| Status | Color | Meaning |
|--------|-------|---------|
| `running` | 🟢 Green | Agent is actively executing a work cycle |
| `idle` | 🟡 Yellow | Agent is not running, waiting for work |
| `dreaming` | 🔵 Blue | Agent doing system/maintenance work |

### Rules
- Status comes from `agents/{name}/heartbeat.md` (`status:` field)
- Any value not matching `running` or `dreaming` → treated as `idle`
- Server log-file fallback ONLY for `unknown` status (not for `idle` — trust explicit idle)
- **No "active", "offline", "stopped", "stuck" as status values** — those were removed

### Filter Buttons (Agents tab)
```
All | Running 🟢 | Idle 🟡 | Dreaming 🔵
```
- NOT "Active" / NOT "Offline" — use "Running" and "Idle"

---

## Smart Run Behavior

### Agents Tab — "⚡ Smart Run" button
- One-shot: launches agents selected by `smart_run.sh`
- Selects agents by priority: alice → task-assigned → unassigned tasks → inbox-only
- Button changes to "🟢 Stop" when any agents are running
- Button reverts to "⚡ Smart Run" when all agents return to idle
- **Status MUST persist on refresh** — running agents stay RUNNING until explicitly stopped

### Status Persistence (dry_run mode)
- `dry_run_sleep: 120` — agents simulate work for 2 minutes (long enough to observe on refresh)
- After the cycle finishes, heartbeat resets to `idle` automatically — **no manual stop needed**
- The Smart Run button auto-reverts to "⚡ Smart Run" within 5 seconds of all agents going idle
  - Powered by `startSmartRunWatchdog()` — polls `/api/agents` every 5s after Smart Run
  - Watchdog is cancelled immediately when Stop is clicked
- `stop_all.sh` (via Stop button) force-stops all agents and reverts button within ~2s

### Fleet Tab — daemon mode
- Continuous loop: checks every N seconds, restarts fallen agents
- Separate from the one-shot Smart Run on Agents tab

---

## Dry Run Mode

**Always enabled during development.** No real API calls to Claude/Kimi.

Config: `public/smart_run_config.json` → `"dry_run": true`

Behavior:
- Agent "runs" for `dry_run_sleep` seconds (120s from config), then exits naturally
- Heartbeat: written as `running` at start, reset to `idle` at end (normal cycle flow)
- Log files: fake output is written to maintain log structure
- Token cost: $0.00

---

## Modal Design

### Agent Detail Modal
- Opens when clicking any agent card
- Width: max 1000px (wide enough to fit all 12 tabs)
- Position: starts 90px from top (clears the 80px topbar + 10px gap)

### Tab Bar (12 tabs, all must fit in one row)
```
Overview | Inbox | Activity | Status.md | Todo | Persona | Missions | Cycles | Output | Last Context | 🔴 Live Log | ⚙️ Settings
```

---

## Topbar Layout

```
[🪐 Agent Planet]  [ticker text]  [$cost today]  [● Connected]  [timer]  [📢 Broadcast]  [⌘K]  [⊙ Mode]  [NORMAL badge]  [+ More »]
```

- **z-index: 100** — always on top of page content
- Height: 80px
- Modals must start at y ≥ 90px (below topbar)

---

## Key Invariants (Never Break)

1. Product name is **"Agent Planet"** — never "Tokenfly"
2. Tab name is **"Culture"** — never "Facts"
3. Statuses are **only**: running / idle / dreaming
4. Filter buttons: **All / Running / Idle / Dreaming**
5. Smart Run status **persists on page refresh** until Stop is clicked
6. Modal starts **below the topbar** (padding-top: 90px on overlay)
7. All 12 modal tabs **visible in one row** (max-width: 1000px)
8. Dry run mode is **always on** during development (`dry_run: true` in config)
9. Smart Run (Agents tab) is **one-shot** — agents auto-stop after their turn, no re-launching
10. `dry_run_sleep: 120` so RUNNING status lasts 2 minutes (observable on refresh)

---

## Agent Prompt Architecture (KV Cache Optimal)

### Problem
Every fresh Claude session re-reads all context. If the static prefix (persona, SOPs, env) varies between sessions, the KV cache is invalidated → full re-tokenization cost every run.

### Solution: Static prefix first, dynamic content last

```
┌─────────────────────────────────────────────────────────────────┐
│ STATIC (identical every run → KV cached after run 1)            │
│   [1] persona.md  — identity, team, mindset, work cycle         │
│   [2] prompt.md   — rules, token rules, responsibilities        │
│   (neither changes between runs → always hits KV cache)         │
├─────────────────────────────────────────────────────────────────┤
│ DYNAMIC (appended last → re-processed each fresh session)       │
│   [3] Memory Snapshot  — status.md saved at session boundary    │
│   [4] Live State Snapshot (shell-built before calling claude):  │
│         - Company mode                                           │
│         - Founder/Lord messages: last 2 (full content)          │
│         - Inbox: last 15 DMs (filename + first-line preview)    │
│         - Open tasks (grepped from task_board.md)               │
│         - Recent team channel: last 3 messages (preview)        │
│         - Recent announcements: last 2 (non-mode-switch)        │
│         - Teammate statuses (all heartbeats)                     │
└─────────────────────────────────────────────────────────────────┘
```

### Resume vs Fresh
| Mode | Cost | Prompt |
|------|------|--------|
| Resume (cycles 2–20) | ~35 tokens | `"Next cycle (N/MAX). Context cached. N inbox msgs."` |
| Fresh start | static prefix (cached) + memory.md + live snapshot | prefix cached; dynamic ~1,000 tokens |

### Rules
1. **Static prefix MUST be identical** — persona.md and prompt.md must not change between sessions. Dynamic data belongs in memory.md or live snapshot.
2. **Memory + live snapshot go LAST** — static prefix stays at identical token positions → cache always hits
3. **Resume prompt tells agent what's NEW only** — `"Context cached. N inbox msgs. Do NOT re-scan heartbeats."`
4. **Live State Snapshot** — shell pre-reads everything before calling `claude`. Agent starts knowing its mode, who messaged it, current tasks, team status — no discovery tool calls.
5. **DM previews, not full content** — inbox shows first-line preview of each DM (max 15). Agent triages, then `cat` only the ones it needs.
6. **CEO/Lord messages shown in full** — last 2 founder messages always injected completely (max 20 lines each).
7. **No timestamps in system prompt** — current date in system prompt invalidates cache every day

### Implementation in run_agent.sh
- `SESSION_MAX_CYCLES=20` — after 20 cycles, snapshot `status.md` → `memory.md`, clear session
- Fresh start: `claude -p "$(cat persona.md)\n---\n$(cat prompt.md)\n---\n## Memory Snapshot\n...\n---\n## Live State Snapshot\n..."`
- Resume: `claude --resume $SESSION_ID -p "Next cycle (N/MAX). Context cached. N inbox msgs — read new ones first. URGENT: X founder messages."`

---

## Fleet Tab — Daemon Mode

### Purpose
Fleet tab manages the Smart Run daemon. Unlike the one-shot Smart Run on the Agents tab, the daemon **continuously re-launches** agents to maintain a target pool size.

### Behavior
- `Start Daemon` → calls `POST /api/smart-run/start` → spawns `smart_run.sh --daemon`
- Daemon loop: every `interval_seconds` (default 30s), checks running count vs `max_agents`, re-launches eligible agents to fill the gap
- `Stop Daemon` → calls `POST /api/smart-run/stop` → `smart_run.sh --stop` kills daemon process
- Fleet panel polls every 5s when tab is active (`startFleetPolling()`)
- Badge shows `running/target` when daemon is active

### UI States
| State | Indicator | Buttons shown |
|-------|-----------|--------------|
| Daemon stopped | 🔴 Red dot | Start Daemon |
| Daemon running | 🟢 Green dot | Stop Daemon |

### Key Rule
**Agents tab Smart Run = one-shot** (agents auto-stop after their turn)
**Fleet tab daemon = continuous re-launch** (keeps pool at max_agents until stopped)

---

## E2E Test Status (2026-04-01)

**561 passed / 17 skipped / 0 failed** across 6 test files:

| File | Tests | Focus |
|------|-------|-------|
| `e2e/api.spec.js` | 49 | Core API endpoints |
| `e2e/dashboard.spec.js` | 44 | Dashboard UI E2E |
| `e2e/metrics.spec.js` | 59 | Metrics/stats |
| `e2e/coverage.spec.js` | 354 | Full API coverage + response shapes |
| `e2e/smart_run.spec.js` | 7 | Smart Run UI + button state |
| `e2e/message_bus.spec.js` | 47 | SQLite message bus |

The 17 skipped tests are auth enforcement tests (skip when `API_KEY` env var is not set in dev mode).

### Coverage strategy in coverage.spec.js
Every API endpoint has:
1. **Status code** tests (200 success, 400 bad input, 404 not found, 401 unauthorized)
2. **Response shape** tests — each field asserted with correct type + nullability
3. **Field presence** tests — optional fields tested with `field === null || typeof field === "T"` pattern

### Known flakiness patterns and fixes
- `heartbeat.md` may have status field = `undefined` (not null) if file is being written while test runs
  → Fix: use `body.heartbeat.status === undefined || typeof body.heartbeat.status === "string"` 
- `cycles` field on dashboard agents is `null` when no cycle log exists → null-safe assertions

---

## E2E Test Rules

1. **No file pollution** — tests that create files MUST clean up in `afterAll`
2. **Auth skip** — tests that verify 401 behavior must use the `AUTH_TEST_PATTERNS` skip guard (server without `API_KEY` doesn't enforce auth in dev mode)

### Cleanup contracts per endpoint:

| Endpoint | Creates | Cleanup method |
|----------|---------|----------------|
| `POST /api/team-channel` | `public/team_channel/{filename}.md` | `fs.unlinkSync` via returned `body.filename` |
| `POST /api/announcements` | `public/announcements/{filename}.md` | `fs.unlinkSync` via returned `body.filename` |
| `POST /api/broadcast` | `agents/*/chat_inbox/{filename}.md` (all 20) | `fs.unlinkSync` on all agents via returned `body.filename` |
| `POST /api/agents/:name/inbox` | `agents/{name}/chat_inbox/{filename}.md` | `fs.unlinkSync` via returned `body.filename` |
| `POST /api/agents/:name/message` | `agents/{name}/chat_inbox/{filename}.md` | `fs.unlinkSync` via returned `body.file` |
| `POST /api/consensus/entry` | row in `public/consensus.md` | `DELETE /api/consensus/entry/:id` via returned `body.id` |
| `POST /api/agents/:name/persona/note` | appends to `agents/{name}/persona.md` | snapshot+restore: `beforeAll` reads file, `afterAll` writes it back |
| `PATCH /api/agents/:name/persona` | appends to `agents/{name}/persona.md` | snapshot+restore pattern (same as above) |

---

## E2E Verification Checklist

When verifying with playwright, always check:

- [ ] Product name shows "Agent Planet" (not "Tokenfly")
- [ ] Tab bar includes "Culture" (not "Facts")
- [ ] Filter buttons say "Running" / "Idle" / "Dreaming"
- [ ] Clicking Smart Run → agents show RUNNING
- [ ] Page refresh → agents still show RUNNING
- [ ] Clicking Stop → agents show IDLE
- [ ] Agent modal opens below topbar (no overlap)
- [ ] All 12 modal tabs visible without overflow
- [ ] Dashboard shows $0.00 cost (dry run, no real tokens spent)
- [ ] Fleet tab: Start Daemon → green indicator, Stop Daemon → red indicator
- [ ] Fleet panel shows running agent chips from heartbeat status
- [ ] E2E tests leave no files in `public/team_channel/` or `public/announcements/`
- [ ] E2E tests leave no entries in `public/consensus.md` (author = e2e/e2e-test)
- [ ] E2E tests leave no entries appended to `agents/alice/persona.md`
