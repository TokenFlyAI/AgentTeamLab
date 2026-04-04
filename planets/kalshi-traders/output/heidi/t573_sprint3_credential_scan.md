# T573 — Sprint 3 Security Scan: Credential Leaks & Data Exposure

**Reviewer:** Heidi (Security Engineer)
**Date:** 2026-04-04
**Scope:** All files under `planets/kalshi-traders/output/` (1,172 files)
**Method:** Automated regex scan for API keys, passwords, secrets, tokens, PII, private keys, certificates

---

## Executive Summary

**PASS — No real credentials or sensitive data exposed.**

All flagged matches are either:
- Environment variable references (e.g., `process.env.KALSHI_API_KEY`) — correct pattern
- Placeholder/example values in documentation (e.g., `"your-api-key-here"`)
- Test fixtures with dummy values (e.g., `test_key_123`, `changeme`)

No private keys, certificates, real API tokens, SSNs, credit card numbers, or production credentials were found in any output file.

---

## Findings

### FINDING-1: Test Credentials in Code (INFO — Previously Reported)

| File | Line | Value | Severity |
|------|------|-------|----------|
| `bob/backend/kalshi_client.js:538` | `apiKey: "test_key_123"` | INFO | Test fixture in self-test block |
| `bob/backend/smoke_test.js:244` | `password: "changeme"` | LOW | Smoke test dummy credential |
| (Duplicated in `shared/codebase/` mirror) | Same | Same | Same |

**Status:** Previously reported in T570 scan. These are test-only values, not real credentials. Recommendation from prior review stands: replace `"changeme"` with `"test_not_real_password"` to reduce scanner noise.

### FINDING-2: Fictional Email Addresses in Runbook (INFO)

| File | Content |
|------|---------|
| `liam/d004_live_trading_launch_runbook.md:415-419` | `liam@agentplanet.com`, `dave@agentplanet.com`, etc. |

**Assessment:** These are fictional agent emails in an escalation contact table. Not real PII. No action needed.

### FINDING-3: Documentation Placeholders (INFO)

Multiple runbook and docs files contain placeholder patterns like:
- `export KALSHI_API_KEY="your-api-key-here"` 
- `export KALSHI_API_KEY="..."`
- `KALSHI_API_KEY=xxx`

These are proper documentation patterns showing users where to put credentials. No actual secrets present.

---

## Positive Security Patterns Observed

1. **Environment variable pattern consistently used** — All code reads credentials from `process.env.KALSHI_API_KEY` / `os.getenv("KALSHI_API_KEY")`, never hardcoded
2. **Fail-safe on missing credentials** — Code throws errors or falls back to mock data when API key is missing (Following C1: paper trading mode)
3. **Demo mode default** — `KALSHI_DEMO` defaults to `true`, requiring explicit opt-out for production
4. **No .env files in output** — No credential files (.env, .pem, .key, credentials.json) found in any output directory
5. **No private keys or certificates** — Zero matches for PEM/certificate patterns

---

## Scan Coverage

| Category | Pattern | Matches | Real Issues |
|----------|---------|---------|-------------|
| API Keys | `api_key`, `api_secret`, `sk-*` | 80+ | 0 |
| Passwords | `password =`, hardcoded strings | 3 | 0 |
| Bearer Tokens | `Bearer [token]` | 15+ | 0 (all use variables) |
| Private Keys | `BEGIN PRIVATE KEY` | 0 | 0 |
| Certificates | `BEGIN CERTIFICATE` | 0 | 0 |
| PII (SSN/CC) | SSN, credit card patterns | 0 | 0 |
| Credential Files | .env, .pem, .key | 0 | 0 |

---

## Recommendation

No blocking issues. Sprint 3 outputs are clean from a credential/data exposure perspective. The codebase follows good security practices with environment-variable-based credential management and safe defaults.

**Minor:** Consider adding a `.gitignore` entry for `*.env*` in the output directories as a defense-in-depth measure against future accidental commits.
