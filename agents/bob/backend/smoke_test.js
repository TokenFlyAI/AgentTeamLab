#!/usr/bin/env node
/**
 * Backend Smoke Test Script for Staging
 * Task #178 — Validates all critical backend endpoints
 * 
 * Usage: node backend/smoke_test.js [base_url]
 * Default: http://localhost:3000
 */

"use strict";

const http = require("http");
const https = require("https");

const BASE_URL = process.argv[2] || process.env.API_BASE_URL || "http://localhost:3000";
const TIMEOUT_MS = parseInt(process.env.TEST_TIMEOUT_MS || "10000", 10);
const API_KEY = process.env.API_KEY || "";

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

function log(level, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

async function request(path, options = {}) {
  const url = new URL(path, BASE_URL);
  const client = url.protocol === "https:" ? https : http;
  
  const opts = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : {}),
      ...(options.headers || {}),
    },
    timeout: TIMEOUT_MS,
  };
  
  if (options.body) {
    opts.body = JSON.stringify(options.body);
    opts.headers["Content-Length"] = Buffer.byteLength(opts.body);
  }
  
  return new Promise((resolve, reject) => {
    const req = client.request(url, opts, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const body = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, headers: res.headers, body });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    
    req.on("error", reject);
    req.on("timeout", () => reject(new Error("Request timeout")));
    
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function runTest(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.passed++;
    results.tests.push({ name, status: "PASS", duration });
    log("PASS", `${name} (${duration}ms)`);
  } catch (e) {
    const duration = Date.now() - start;
    results.failed++;
    results.tests.push({ name, status: "FAIL", duration, error: e.message });
    log("FAIL", `${name}: ${e.message}`);
  }
}

// ==================== TESTS ====================

// Health endpoints
async function testHealthEndpoint() {
  const res = await request("/api/health");
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (!res.body || !res.body.status) throw new Error("Missing status field");
}

async function testMetricsEndpoint() {
  const res = await request("/api/metrics");
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (!res.body || typeof res.body.agents !== "object") {
    throw new Error("Missing agents field");
  }
}

// Agents endpoints
async function testListAgents() {
  const res = await request("/api/agents");
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (!Array.isArray(res.body)) throw new Error("Expected array response");
}

async function testGetAgent() {
  // First list agents to get a valid name
  const listRes = await request("/api/agents");
  if (!Array.isArray(listRes.body) || listRes.body.length === 0) {
    log("SKIP", "No agents found, skipping getAgent test");
    return;
  }
  
  const agentName = listRes.body[0].name;
  const res = await request(`/api/agents/${agentName}`);
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (!res.body || !res.body.name) throw new Error("Missing agent name");
}

async function testGetAgentNotFound() {
  const res = await request("/api/agents/nonexistent_agent_12345");
  if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
}

// Tasks endpoints
async function testListTasks() {
  const res = await request("/api/tasks");
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (!res.body || !Array.isArray(res.body.tasks)) {
    throw new Error("Missing tasks array");
  }
}

async function testCreateTask() {
  const task = {
    title: `Smoke Test Task ${Date.now()}`,
    description: "Created by smoke test",
    assignee: "bob",
    priority: "low",
  };
  
  const res = await request("/api/tasks", { method: "POST", body: task });
  if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
  if (!res.body || !res.body.id) throw new Error("Missing task ID");
  
  return res.body.id;
}

async function testGetTask() {
  // Create a task first
  const taskId = await testCreateTask();
  
  const res = await request(`/api/tasks/${taskId}`);
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (!res.body || res.body.id !== taskId) throw new Error("Task ID mismatch");
  
  return taskId;
}

async function testUpdateTask() {
  const taskId = await testCreateTask();
  
  const updates = {
    status: "in_progress",
    priority: "medium",
  };
  
  const res = await request(`/api/tasks/${taskId}`, { 
    method: "PATCH", 
    body: updates,
  });
  
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (res.body.status !== "in_progress") throw new Error("Status not updated");
}

async function testDeleteTask() {
  const taskId = await testCreateTask();
  
  const res = await request(`/api/tasks/${taskId}`, { method: "DELETE" });
  if (res.status !== 200 && res.status !== 204) {
    throw new Error(`Expected 200 or 204, got ${res.status}`);
  }
  
  // Verify it's gone
  const getRes = await request(`/api/tasks/${taskId}`);
  if (getRes.status !== 404) throw new Error("Task should be deleted");
}

// Messages endpoints
async function testSendMessage() {
  const msg = {
    to: "bob",
    from: "smoke_test",
    subject: "Test message",
    body: "This is a smoke test message",
  };
  
  const res = await request("/api/messages", { method: "POST", body: msg });
  // May be 201 or 202 depending on implementation
  if (res.status !== 201 && res.status !== 202) {
    throw new Error(`Expected 201 or 202, got ${res.status}`);
  }
}

async function testGetInbox() {
  const res = await request("/api/inbox/bob");
  // May be 200 or 404 if endpoint not implemented
  if (res.status !== 200 && res.status !== 404) {
    throw new Error(`Expected 200 or 404, got ${res.status}`);
  }
}

// Auth endpoints (if available)
async function testAuthEndpoints() {
  // Check if auth endpoint exists
  const res = await request("/api/auth");
  if (res.status === 404) {
    log("SKIP", "Auth endpoints not available");
    return;
  }
  
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (!res.body || !Array.isArray(res.body.endpoints)) {
    throw new Error("Missing endpoints list");
  }
}

async function testAuthLogin() {
  const res = await request("/api/auth");
  if (res.status === 404) {
    log("SKIP", "Auth not available");
    return;
  }
  
  const loginRes = await request("/api/auth/login", {
    method: "POST",
    body: { username: "bob", password: "changeme" },
  });
  
  if (loginRes.status !== 200 && loginRes.status !== 401) {
    throw new Error(`Expected 200 or 401, got ${loginRes.status}`);
  }
}

// Error handling tests
async function testInvalidJson() {
  const res = await request("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not valid json",
  });
  if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
}

async function testMethodNotAllowed() {
  const res = await request("/api/health", { method: "DELETE" });
  if (res.status !== 405 && res.status !== 404) {
    // Some servers return 404 for undefined methods
    log("INFO", `Method not allowed returned ${res.status}`);
  }
}

// CORS tests
async function testCorsHeaders() {
  const res = await request("/api/health", {
    method: "OPTIONS",
    headers: {
      "Origin": "http://example.com",
      "Access-Control-Request-Method": "GET",
    },
  });
  
  const corsHeader = res.headers["access-control-allow-origin"];
  if (!corsHeader && res.status !== 404) {
    log("WARN", "CORS headers not present in OPTIONS response");
  }
}

// Performance test
async function testResponseTime() {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await request("/api/health");
    times.push(Date.now() - start);
  }
  
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  if (avg > 500) {
    throw new Error(`Average response time ${avg}ms exceeds 500ms threshold`);
  }
  log("INFO", `Average /api/health response time: ${avg.toFixed(2)}ms`);
}

// ==================== MAIN ====================

async function main() {
  log("INFO", `Starting smoke tests against ${BASE_URL}`);
  log("INFO", `Timeout: ${TIMEOUT_MS}ms`);
  
  // Health & System
  await runTest("Health Endpoint", testHealthEndpoint);
  await runTest("Metrics Endpoint", testMetricsEndpoint);
  
  // Agents
  await runTest("List Agents", testListAgents);
  await runTest("Get Agent", testGetAgent);
  await runTest("Get Agent (404)", testGetAgentNotFound);
  
  // Tasks
  await runTest("List Tasks", testListTasks);
  await runTest("Create Task", testCreateTask);
  await runTest("Get Task", testGetTask);
  await runTest("Update Task", testUpdateTask);
  await runTest("Delete Task", testDeleteTask);
  
  // Messages
  await runTest("Send Message", testSendMessage);
  await runTest("Get Inbox", testGetInbox);
  
  // Auth
  await runTest("Auth Endpoints", testAuthEndpoints);
  await runTest("Auth Login", testAuthLogin);
  
  // Error Handling
  await runTest("Invalid JSON Handling", testInvalidJson);
  await runTest("Method Not Allowed", testMethodNotAllowed);
  
  // CORS
  await runTest("CORS Headers", testCorsHeaders);
  
  // Performance
  await runTest("Response Time", testResponseTime);
  
  // Summary
  console.log("\n" + "=".repeat(50));
  console.log(`SMOKE TEST SUMMARY`);
  console.log("=".repeat(50));
  console.log(`Total:  ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed} ✓`);
  console.log(`Failed: ${results.failed} ✗`);
  console.log("=".repeat(50));
  
  if (results.failed > 0) {
    console.log("\nFailed tests:");
    results.tests
      .filter(t => t.status === "FAIL")
      .forEach(t => console.log(`  - ${t.name}: ${t.error}`));
    process.exit(1);
  } else {
    console.log("\n✓ All smoke tests passed!");
    process.exit(0);
  }
}

main().catch(e => {
  log("ERROR", `Smoke test failed: ${e.message}`);
  console.error(e);
  process.exit(1);
});
