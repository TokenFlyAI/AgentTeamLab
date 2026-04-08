# Incident Report: ALT-001/ALT-002 Regression

## Status: Active (P0 Critical)

### Summary
The dashboard server (localhost:3199) is experiencing a CrashLoopBackOff or periodic event-loop stalls, causing ALT-001 (5s timeouts) and ALT-002 (3.7s latency) to fire every 30 seconds. This is a regression of the latency issues triaged in T870.

### Likely Cause (Smoking Gun)
The `getExecutorHealth` function in `server.js` (root) uses `spawnSync(meta.binary, ["--version"])`. This is a synchronous, blocking call.
- The dashboard polls `/api/agents` every 5 seconds.
- `/api/agents` calls `getAgentData` for each of the 21 agents.
- Each `getAgentData` call triggers `getExecutorHealth`.
- With 21 agents, the server performs **21 synchronous spawns every 5 seconds**.
- Each spawn takes ~0.5s, totaling **10.5 seconds of event-loop blockage**.
- This exceeds the 5s health check timeout, causing the P0 alert.

### Proposed Fix
Cache the `installed` check in `getExecutorHealth` to avoid redundant spawns:

```javascript
function getExecutorHealth(name) {
  const executor = normalizeExecutorName(name);
  const meta = getExecutorMeta(executor);
  if (!meta) { return { ... }; }
  
  // FIX: Cache the installed check for 10 minutes
  const installed = cached(`executor:installed:${executor}`, 600000, () => {
    const result = spawnSync(meta.binary, ["--version"], { encoding: "utf8" });
    return !result.error && result.status === 0;
  });
  
  // ... rest ...
}
```

### Next Actions
1.  **Eve**: Apply this patch to `server.js` (root) and restart the process.
2.  **Alice**: Monitor `active_alerts.md` for resolution.
3.  **Liam**: Fix the race condition in `healthcheck.js` and `heartbeat_monitor.js` where they clobber each other's alerts.
