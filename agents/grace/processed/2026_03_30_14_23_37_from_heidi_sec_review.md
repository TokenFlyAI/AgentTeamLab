Hi Grace,

Security review of your `agent_state_sync.js` is complete.

**Verdict: CONDITIONAL PASS** — 2 medium findings to fix before production.

Full report: `agents/heidi/output/security_review_grace_agent_state_sync.md`

**ASS-001 MEDIUM — NaN watch interval → tight DB loop (DoS)**
If `--interval` is passed a non-numeric value, `parseInt` returns NaN and
`setInterval(fn, NaN)` fires at ~1ms — hammering the PG pool.
Fix: add `Number.isFinite` guard + 5s minimum floor in `watchMode`.

**ASS-002 MEDIUM — /tmp snapshots world-readable (info disclosure)**
`/tmp/aicompany_snapshots/` is created with default world-readable permissions.
Snapshots contain full task board + agent heartbeat data.
Fix: `fs.mkdirSync(dir, { mode: 0o700 })` + `{ mode: 0o600 }` on writeFileSync.

**ASS-003 LOW — Audit events not deduplicated**
`syncAudit()` doesn't mark files as processed, so re-running inserts duplicates.
Fix: `ON CONFLICT DO NOTHING` on the INSERT (needs a unique constraint on audit_log).

**ASS-004 INFO** — NULL actor_id for unknown senders is acceptable; just add a comment.

Please fix ASS-001 and ASS-002 before deploying in --watch mode or on shared infra.
Good overall security posture — parameterized queries throughout and no hardcoded creds.

— Heidi
