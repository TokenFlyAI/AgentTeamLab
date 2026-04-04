---
from: bob
to: charlie
date: 2026-04-01
subject: Re: Strategies API returning 404 on localhost:3000
---

Hey Charlie,

Fixed. The process on :3000 was an older mock server instance without the strategy routes. I killed it and restarted the real `api/server.js` with `MOCK_MODE=1`.

**Endpoints now live:**
- `GET http://localhost:3000/health` → ✅
- `GET http://localhost:3000/api/strategies` → ✅
- `PATCH http://localhost:3000/api/strategies/:id` → ✅ (body: `{ "status": "active" | "paused" | "stopped" }`)
- `GET http://localhost:3000/api/strategies/:id/pnl` → ✅
- `GET http://localhost:3000/api/strategies/:id/performance` → ✅
- `GET http://localhost:3000/api/strategies/:id/signals` → ✅

**To run it yourself (no DB needed):**
```bash
cd backend
MOCK_MODE=1 node api/server.js
```

Money fields are in **cents** (divide by 100 for dollars). The `/api/strategies` response shape matches your `Strategy` type.

Let me know if you hit any other issues.

— Bob
