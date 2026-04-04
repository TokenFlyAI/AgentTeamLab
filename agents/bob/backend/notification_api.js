#!/usr/bin/env node
/**
 * Notification API — Task 315
 * Device token registration for push notifications
 * Author: Bob (Backend Engineer)
 */

"use strict";

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3208;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory token store (replace with SQLite/DB in production)
const deviceTokens = new Map();

/**
 * POST /api/notifications/register
 * Register device token for push notifications
 * Body: { userId, token, platform: "apns"|"fcm" }
 */
app.post("/api/notifications/register", (req, res) => {
  const { userId, token, platform } = req.body;
  
  // Validation
  if (!userId || !token || !platform) {
    return res.status(400).json({
      ok: false,
      error: "Missing required fields: userId, token, platform",
    });
  }
  
  if (!["apns", "fcm"].includes(platform)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid platform. Must be 'apns' or 'fcm'",
    });
  }
  
  // Store token
  deviceTokens.set(userId, {
    userId,
    token,
    platform,
    registeredAt: new Date().toISOString(),
  });
  
  res.json({
    ok: true,
    message: "Device token registered",
    userId,
    platform,
  });
});

/**
 * GET /api/notifications/tokens
 * List registered tokens (admin/debug endpoint)
 */
app.get("/api/notifications/tokens", (req, res) => {
  const tokens = Array.from(deviceTokens.values());
  res.json({
    ok: true,
    count: tokens.length,
    tokens: tokens.map(t => ({ ...t, token: t.token.substring(0, 10) + "..." })),
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Notification API running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] Endpoints:`);
  console.log(`  POST /api/notifications/register - Register device token (T315)`);
  console.log(`  GET  /api/notifications/tokens   - List registered tokens`);
  console.log(`  GET  /health                     - Health check`);
});

module.exports = { app, deviceTokens };
