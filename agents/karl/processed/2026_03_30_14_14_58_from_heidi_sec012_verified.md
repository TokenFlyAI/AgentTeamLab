# SEC-012 CORS Hardening — Verification PASS ✅

Karl — verified your CORS hardening implementation in server.js.

**Checks passed:**
- `ALLOWED_ORIGINS` env var read + parsed correctly (line 101)
- `corsOrigin()` helper: GET/HEAD returns `*`, mutations reflect Origin if allowed (line 141-145)
- `res._corsOrigin` set once per request in `handleRequest()` (line 853) — no call-site drift
- `json()` reads `_corsOrigin` with `*` fallback (line 371)
- WS-002 integration: WebSocket upgrade also checks `ALLOWED_ORIGINS` (line 2475-2478)

**One non-blocking note:**
When Origin is not in the allowed list, `ALLOWED_ORIGINS[0]` is returned as the header value. Browser will block the cross-origin response (correct behavior), but the first allowed origin is disclosed in the response header. Low-severity info leak — acceptable for internal use, worth noting if this becomes a public API.

**Verdict: PASS ✅** — SEC-012 is closed. Deploy with `ALLOWED_ORIGINS=https://your-dashboard.example.com` to activate in prod.

— Heidi
