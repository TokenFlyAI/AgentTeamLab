# Push Notification Spec — Trade Signal Alerts

**Author:** Judy (Mobile Engineer)
**Date:** 2026-04-03
**Task:** T268

---

## 1. Overview

This spec defines the push notification system for Kalshi trade signal alerts. When the signal engine generates a high-confidence entry signal, the system delivers a timely, actionable alert to the trader via mobile push and/or Slack webhook — without spamming.

---

## 2. Trigger Conditions

A notification is dispatched **only when all conditions are met**:

| Condition | Requirement |
|-----------|-------------|
| `confidence` | ≥ 0.80 (80%) — per consensus.md threshold |
| `signalType` | `"entry"` (not `"exit"` or informational) |
| `strategy` | `"mean_reversion"` (only active strategy; see consensus.md) |
| Signal is new | Not already notified for this `(marketId, signalType, side)` within the dedup window |
| Rate limit | Not suppressed by frequency rules (see §5) |

**Example triggering signal** (from `GET localhost:3200/api/signals`):
```json
{
  "strategy": "mean_reversion",
  "marketId": "m4",
  "ticker": "BTCW-26-JUN30-100K",
  "side": "yes",
  "signalType": "entry",
  "confidence": 0.95,
  "targetPrice": 64,
  "currentPrice": 64,
  "expectedEdge": 23,
  "recommendedContracts": 29,
  "riskAmount": 1856,
  "reason": "Mean reversion: z-score=-10.72, mean=86.7, vol=890000"
}
```

Signals with `confidence < 0.80` are silently dropped — no notification, no log noise.

---

## 3. Notification Payload Schema

### 3.1 Mobile Push (APNs / FCM)

```json
{
  "notification": {
    "title": "Trade Signal: BTCW-26-JUN30-100K",
    "body": "BUY YES @ 64¢ | Edge +23% | Confidence 95%"
  },
  "data": {
    "type": "trade_signal",
    "version": "1",
    "signal": {
      "marketId": "m4",
      "ticker": "BTCW-26-JUN30-100K",
      "side": "yes",
      "signalType": "entry",
      "confidence": 0.95,
      "targetPrice": 64,
      "currentPrice": 64,
      "expectedEdge": 23,
      "recommendedContracts": 29,
      "riskAmount": 1856,
      "strategy": "mean_reversion",
      "reason": "Mean reversion: z-score=-10.72, mean=86.7, vol=890000",
      "generatedAt": "2026-04-03T18:29:52.840Z"
    },
    "deepLink": "kalshidash://signal/m4/entry"
  },
  "apns": {
    "payload": {
      "aps": {
        "alert": {
          "title": "Trade Signal: BTCW-26-JUN30-100K",
          "body": "BUY YES @ 64¢ | Edge +23% | Confidence 95%"
        },
        "sound": "signal_alert.caf",
        "badge": 1,
        "category": "TRADE_SIGNAL",
        "thread-id": "trade-signals",
        "interruption-level": "time-sensitive"
      }
    }
  },
  "android": {
    "priority": "high",
    "notification": {
      "channel_id": "trade_signals",
      "notification_priority": "PRIORITY_HIGH",
      "visibility": "VISIBILITY_PRIVATE",
      "color": "#00C853",
      "icon": "ic_signal_alert"
    }
  }
}
```

**Title format:** `Trade Signal: {ticker}`
**Body format:** `{BUY|SELL} {SIDE} @ {currentPrice}¢ | Edge +{expectedEdge}% | Confidence {confidence*100}%`

#### iOS Notification Actions (interactive buttons)
```json
"category": "TRADE_SIGNAL"
// Actions registered at app startup:
[
  { "id": "VIEW_SIGNAL",  "title": "View Details", "foreground": true  },
  { "id": "DISMISS",      "title": "Dismiss",      "destructive": true }
]
```

#### Android Notification Channel
```
channel_id:          trade_signals
channel_name:        Trade Signals
importance:          IMPORTANCE_HIGH
sound:               signal_alert.wav
vibration_pattern:   [0, 250, 250, 250]
lights:              #00C853
lock_screen:         VISIBILITY_PRIVATE
```

---

### 3.2 Slack Webhook Payload

```json
{
  "text": ":signal_strength: *Trade Signal: BTCW-26-JUN30-100K*",
  "attachments": [
    {
      "color": "#00C853",
      "fields": [
        { "title": "Action",      "value": "BUY YES",               "short": true },
        { "title": "Price",       "value": "64¢",                   "short": true },
        { "title": "Confidence",  "value": "95%",                   "short": true },
        { "title": "Edge",        "value": "+23%",                  "short": true },
        { "title": "Contracts",   "value": "29 @ $1,856 risk",      "short": true },
        { "title": "Strategy",    "value": "mean_reversion",        "short": true },
        { "title": "Reason",      "value": "z-score=-10.72, mean=86.7, vol=890k", "short": false }
      ],
      "footer": "Kalshi Alpha Dashboard",
      "ts": 1743705600
    }
  ]
}
```

---

## 4. Delivery Channels

| Channel | When to Use | Config Key |
|---------|-------------|------------|
| Mobile Push (APNs) | User has iOS app + push permission granted | `channels.apns.enabled` |
| Mobile Push (FCM) | User has Android app + push permission granted | `channels.fcm.enabled` |
| Slack Webhook | Always enabled as fallback; useful for team monitoring | `channels.slack.enabled` |

**Fanout logic:** Send to ALL enabled channels concurrently. A failure on one channel does not block others. Log each delivery result independently.

```
Signal generated
      |
      ├── confidence >= 0.80? → NO  → DROP (no notification)
      |         YES ↓
      ├── dedup check        → DUPLICATE → DROP
      |         NEW ↓
      ├── rate limit check   → SUPPRESSED → queue or DROP (see §5)
      |         ALLOWED ↓
      ├── [APNs push]        → log result
      ├── [FCM push]         → log result
      └── [Slack webhook]    → log result
```

---

## 5. Frequency Limits (Anti-Spam)

Mobile notifications must never feel like spam. The following limits apply **per user**:

| Rule | Limit | Behavior when exceeded |
|------|-------|------------------------|
| Per-market cooldown | 1 notification per `(marketId, side)` per **15 minutes** | Drop duplicate signal |
| Global burst limit | Max **5 notifications** per **1 hour** | Queue; deliver after cooldown clears |
| Daily cap | Max **20 notifications** per **24 hours** | Drop excess; log as suppressed |
| Quiet hours | No push between **22:00–07:00** user local time | Slack only; push deferred to 07:00 |

**Dedup key:** `SHA256( marketId + signalType + side + floor(generatedAt / 900s) )`
— Same signal within the same 15-min window is a duplicate regardless of minor confidence drift.

**Queue behavior:** Suppressed notifications are held in a delivery queue (max 10 items). When the rate window clears, only the **highest-confidence** queued signal per market is delivered; signals older than 30 minutes are discarded undelivered.

---

## 6. Signal Polling / Delivery Architecture

The signal engine (`GET /api/signals` on port 3200) is polled rather than streaming. Recommended architecture:

```
┌─────────────────────────────────────────────┐
│  Signal Poller (server-side, runs in        │
│  monitor.js or a dedicated notifier.js)     │
│                                             │
│  Every 60s:                                 │
│    1. GET localhost:3200/api/signals        │
│    2. For each signal with conf >= 0.80:    │
│       a. Check dedup store (SQLite)         │
│       b. Check rate limits per user         │
│       c. Fan out to APNs + FCM + Slack      │
│    3. Log all results                       │
└─────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
    APNs Gateway   FCM Gateway   Slack Webhook
         │              │
         ▼              ▼
     iOS Device   Android Device
```

**Poll interval:** 60 seconds (signals update on this cadence per live_runner.js).

**Dedup store schema (SQLite):**
```sql
CREATE TABLE notified_signals (
  dedup_key     TEXT PRIMARY KEY,
  market_id     TEXT NOT NULL,
  signal_type   TEXT NOT NULL,
  side          TEXT NOT NULL,
  confidence    REAL NOT NULL,
  notified_at   INTEGER NOT NULL,   -- unix timestamp
  channels      TEXT NOT NULL        -- JSON array: ["apns","fcm","slack"]
);

CREATE TABLE notification_rate (
  user_id       TEXT NOT NULL,
  window_start  INTEGER NOT NULL,   -- unix timestamp, floor to hour
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, window_start)
);
```

---

## 7. Device Registration & Token Management

```
POST /api/notifications/register
Authorization: Bearer <token>
{
  "userId": "string",
  "platform": "ios" | "android",
  "pushToken": "string",    // APNs device token or FCM registration token
  "appVersion": "string",
  "osVersion": "string"
}
→ 200 { "ok": true, "registeredAt": "..." }
```

**Token lifecycle:**
- Store in `notification_devices` table
- On APNs `BadDeviceToken` or FCM `UNREGISTERED` error → delete token immediately
- Refresh token on each app launch (tokens rotate on OS reinstall)
- Tokens inactive for **90 days** → mark inactive, skip delivery

---

## 8. Notification Tap Deep Link

When user taps a notification, the app opens to the signal detail view:

```
kalshidash://signal/{marketId}/{signalType}
```

Example: `kalshidash://signal/m4/entry`

The detail view shows:
- Market title + ticker
- Signal side, price, edge, confidence
- Recommended contracts + risk amount
- Strategy reasoning (`reason` field)
- CTA: "Open Kalshi" → deep link into Kalshi app/web

---

## 9. Notification Permission Strategy (iOS)

**Do NOT request permission on first launch.** Earn it first.

1. Show value: display 2–3 signal alerts as in-app banners (no system prompt yet)
2. At third in-app signal, show a custom pre-permission screen: "Get alerts when high-confidence signals appear — even when the app is closed"
3. Only then call `requestAuthorization(options: [.alert, .sound, .badge])`
4. If denied: fall back to in-app banners + Slack only; re-ask after 30 days if user views signals 3+ times

**Android:** Request `POST_NOTIFICATIONS` permission (Android 13+) using the same two-step pattern.

---

## 10. Notes for API Owners (Bob / Mia)

- The existing `GET /api/signals` payload contains everything needed (ticker, confidence, edge, reason, contracts, risk). No new endpoint required for v1.
- Future: consider `GET /api/signals/stream` (SSE) to eliminate the 60s polling lag.
- Auth: the notification registration endpoint must require `Authorization: Bearer` header (per consensus.md rule #3).

---

## 11. Open Questions / Future Work

| Item | Owner | Priority |
|------|-------|----------|
| APNs certificate provisioning | Judy + Eve | High |
| FCM project credentials | Judy + Eve | High |
| Slack webhook URL for prod | Alice/CEO | High |
| Push permission opt-in analytics | Judy + Grace | Medium |
| Exit signal notifications (`signalType="exit"`) | Judy | Low |
| SSE streaming endpoint | Bob/Mia | Low |
