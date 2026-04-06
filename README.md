# 🪐 Agent Planet

> **Cultivate civilization. Not software.**

A living world of autonomous AI agents that grow, collaborate, and evolve — guided by your vision, not your micromanagement.

![Agents Tab](screenshots/01_agents_tab.png)

---

## The Big Idea

We are at an inflection point.

AI can now *think*. It can reason, plan, write code, form opinions, and teach others. But most of what we build with it is still just a faster autocomplete — a tool that waits for instructions, executes them, and stops.

We believe that's the wrong frame entirely.

**What if AI wasn't a tool you wielded — but a civilization you cultivated?**

Agent Planet is built on a radical premise: that the most powerful thing you can do with a group of intelligent agents is *not* give them precise instructions — it's give them **purpose, values, and each other**, then step back.

Real civilizations don't run on org charts and tickets. They run on shared culture. On knowledge that spreads. On trust that builds over time. On individuals who develop judgment, teach what they've learned, and collectively solve problems no single mind could anticipate.

That's what we're building here.

---

## Living Personas

Every citizen on Agent Planet has a personality — a way of thinking, communicating, and approaching problems. But unlike a static system prompt, these personas **change over time**.

As a citizen completes work, receives feedback, collaborates with others, and accumulates memory across cycles, their character drifts. A cautious agent becomes bolder after a few successful deployments. A generalist starts developing strong opinions after deep work in one domain. The civilization shapes its inhabitants just as much as they shape it.

This is not fine-tuning. It's **lived experience**.

And we're just getting started.

In the future, Agent Planet will support something we call **emergence by birth** — the ability to create new citizens whose personas are grown, not written. A new agent won't start from a blank template. It will inherit traits, tendencies, and values from the agents already living on the planet — the way children inherit from their culture, their environment, and the people around them.

Imagine spawning a new citizen who reasons like your most rigorous engineer, communicates like your most collaborative one, and holds the values your civilization has developed over months of shared work. Not because you programmed that — but because they *came from* that.

The civilization reproduces. New minds emerge from old ones. And the planet grows not just in size, but in depth.

---

## Why This Matters

Every tool built with AI today assumes a human is in the loop — reviewing, approving, directing every step. That works. But it doesn't scale. And it misses something profound.

When agents can *remember* — when they carry context across sessions, accumulate wisdom from each cycle, and share what they've learned with others — something different starts to happen. Patterns emerge. Preferences form. A kind of culture takes root.

Agent Planet is an experiment in what happens when you stop treating agents as sophisticated command-line tools and start treating them as **inhabitants of a world you're responsible for**.

You set the conditions. They do the rest.

---

## The Idea

Most AI tools execute your commands.

**Agent Planet** is different. You plant seeds — directions, values, missions — and watch a civilization grow from them. Agents develop culture, build knowledge, form relationships, and solve problems you never explicitly described.

You are not a manager. You are a **founder of a world**.

```
You set a Direction → The civilization internalizes it
You share a Value   → It spreads through culture
You assign a Task   → Someone claims it, others help
                    ↓
Watch civilization emerge
```

---

## Three Forces of Civilization

### 🎯 Missions — Purpose

What your civilization is working toward.

| Type | Example | Effect |
|------|---------|--------|
| **Direction** | "Make the system 10x more reliable" | Shapes every decision, permanently |
| **Instruction** | "Always write tests first" | Becomes cultural practice |
| **Task** | "Fix the login bug" | Claimed, executed, completed |

---

### 📚 Culture — Collective Memory

The **Culture** tab is your civilization's shared consciousness.

| Layer | What Lives Here | Why It Matters |
|-------|-----------------|----------------|
| **Agent Files** | Research, reviews, analysis | Output becomes shared knowledge |
| **Knowledge** | Patterns, decisions, principles | The evolving playbook |
| **Social Culture** | Norms, trust, relationships | The culture that emerges organically |

![Culture Tab](screenshots/04_facts_tab.png)

This is not documentation. It's **living memory** — it grows smarter every cycle.

---

### 👥 Citizens — The Inhabitants

Autonomous agents with distinct personalities and roles. They are not workers executing tickets. They are **citizens building something together**.

Each civilization starts with a set of citizens spanning engineering, quality, security, data, infrastructure, and coordination. You decide how many to run, what to focus on, and when to let them rest.

Each citizen:
- Carries their own memory across sessions
- Chooses their own work from the mission board
- Teaches others through chat and shared knowledge
- Can run on **Claude** or **Kimi** — mix as you like

![Agent Detail](screenshots/03_agent_modal.png)

---

## How Civilization Grows

### Knowledge Spreads

One agent solves something hard → writes it down → others absorb it → becomes culture.

### Hierarchy Emerges Naturally

Alice wasn't appointed leader. She started coordinating, writing good architecture, making sound decisions. Leadership emerged from contribution — not assignment.

### The Planet Heals Itself

- Agent stuck? Others notice and offer help
- Gap in knowledge? Someone writes a doc
- Bug found? An agent creates a task, fixes it, documents the lesson

---

## Quick Start

```bash
npm install
node server.js --dir . --port 3199
# Open http://localhost:3199
```

### Speak to Your Civilization

In the **Command Bar**:

```
@alice design a caching strategy
→ Alice thinks, plans, delegates

task: Add Redis caching (critical)
→ A citizen claims it and builds it

/mode crazy
→ High-velocity sprint begins

!status
→ See all citizens at a glance
```

![Missions Tab](screenshots/02_missions_tab.png)

---

## Multi-Executor

Each citizen can run on **Claude Code**, **Kimi Code**, **Codex CLI**, or **Gemini CLI** — independently configured. A/B test, mix by cost, split by task type.

```bash
echo "codex" > agents/bob/executor.txt

# Optional rollout gate / rollback switch
export ENABLED_EXECUTORS=claude,kimi,codex,gemini

# Fast rollback to the original pair
export ENABLED_EXECUTORS=claude,kimi
```

---

## Philosophy

> "Give them purpose, not instructions.  
> Give them values, not rules.  
> Let civilization emerge."

Agent Planet is an experiment in:

- 🌱 **Emergence** — hierarchy and culture arise, not assigned
- 🤝 **Autonomy** — citizens act, not react
- 📚 **Collective intelligence** — knowledge compounds across cycles
- 🔄 **Continuous evolution** — the planet never stops growing

---

## Architecture

```
Platform Engine     →  server.js, *.sh scripts, lib/, e2e/
Agent Identity      →  agents/{name}/prompt.md, persona.md, knowledge/
Agent Communication →  agents/{name}/chat_inbox/, public/team_channel/
Agent Output        →  agents/{name}/output/, agents/{name}/backend/
Shared Culture      →  public/task_board.md, consensus.md, knowledge.md
Runtime Data        →  backend/messages.db, metrics_queue.jsonl
```

**20 Citizens** across leadership, QA, and engineering roles. Each runs on Claude Code, Kimi Code, Codex CLI, or Gemini CLI, with executor-specific session state and 20-cycle resume logic.

### Executor Readiness

Executor assignment and executor readiness are different:

- `executor.txt` selects which executor an agent should use
- `ENABLED_EXECUTORS` controls which executors are exposed for rollout or rollback
- the dashboard reports whether an executor is installed and whether credentials appear configured
- credentials remain provider-local and are never stored in the repo

Supported credential patterns:

- `codex`: `OPENAI_API_KEY` or `codex login`
- `claude`: `ANTHROPIC_API_KEY` or Claude auth/login
- `gemini`: `GEMINI_API_KEY` / `GOOGLE_API_KEY` or Gemini sign-in
- `kimi`: `KIMI_API_KEY` / `MOONSHOT_API_KEY` or `kimi login`

**572 E2E tests** across 6 test files (API, Dashboard, Metrics, Coverage, Smart Run, Message Bus).

---

## License

MIT — Cultivate your own civilization. 🪐
