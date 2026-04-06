"use strict";

const assert = require("assert");
const {
  DEFAULT_EXECUTOR,
  getEnabledExecutors,
  getExecutorMeta,
  getSupportedExecutors,
  isEnabledExecutor,
  isValidExecutor,
  parseEnabledExecutors,
} = require("../../lib/executors");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

console.log("\nexecutors");

test("default executor remains claude", () => {
  assert.strictEqual(DEFAULT_EXECUTOR, "claude");
});

test("supported executors include claude, kimi, codex, gemini", () => {
  const executors = getSupportedExecutors();
  assert.ok(executors.includes("claude"));
  assert.ok(executors.includes("kimi"));
  assert.ok(executors.includes("codex"));
  assert.ok(executors.includes("gemini"));
});

test("parseEnabledExecutors filters invalid values and preserves valid ones", () => {
  const parsed = parseEnabledExecutors("claude,codex,not-real,gemini");
  assert.deepStrictEqual(parsed, ["claude", "codex", "gemini"]);
});

test("parseEnabledExecutors falls back to the default enabled set when config is empty", () => {
  assert.deepStrictEqual(parseEnabledExecutors(""), ["claude", "kimi", "codex", "gemini"]);
});

test("isValidExecutor recognizes codex and gemini", () => {
  assert.strictEqual(isValidExecutor("codex"), true);
  assert.strictEqual(isValidExecutor("gemini"), true);
  assert.strictEqual(isValidExecutor("bogus"), false);
});

test("isEnabledExecutor respects custom allowlist", () => {
  assert.strictEqual(isEnabledExecutor("codex", "claude,kimi"), false);
  assert.strictEqual(isEnabledExecutor("gemini", "claude,gemini"), true);
});

test("executor metadata exposes labels and binaries", () => {
  const meta = getExecutorMeta("codex");
  assert.strictEqual(meta.label, "Codex CLI");
  assert.strictEqual(meta.binary, "codex");
});

test("getEnabledExecutors returns all configured executors", () => {
  assert.deepStrictEqual(getEnabledExecutors("claude,kimi,codex,gemini"), ["claude", "kimi", "codex", "gemini"]);
});

if (failed > 0) {
  process.exitCode = 1;
  console.error(`\nexecutors: ${passed} passed, ${failed} failed`);
} else {
  console.log(`\nexecutors: ${passed} passed`);
}
