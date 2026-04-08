"use strict";

const EXECUTORS = {
  claude: {
    name: "claude",
    label: "Claude Code",
    binary: "claude",
    transport: "cli",
    sessionMode: "explicit_id",
    supportsStructuredOutput: true,
    supportsWorkdirOverride: false,
    authEnvVars: ["ANTHROPIC_API_KEY"],
    authHint: "Set ANTHROPIC_API_KEY or run claude auth/login.",
    badge: { icon: "🅒", color: "#0088ff", background: "rgba(0,136,255,0.15)", border: "rgba(0,136,255,0.3)" },
  },
  kimi: {
    name: "kimi",
    label: "Kimi Code",
    binary: "kimi",
    transport: "cli",
    sessionMode: "implicit_continue",
    supportsStructuredOutput: false,
    supportsWorkdirOverride: true,
    authEnvVars: ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
    authHint: "Set KIMI_API_KEY/MOONSHOT_API_KEY or run kimi login.",
    badge: { icon: "🅚", color: "#a855f7", background: "rgba(147,51,234,0.15)", border: "rgba(147,51,234,0.3)" },
  },
  codex: {
    name: "codex",
    label: "Codex CLI",
    binary: "codex",
    transport: "cli",
    sessionMode: "explicit_id",
    supportsStructuredOutput: true,
    supportsWorkdirOverride: true,
    authEnvVars: ["OPENAI_API_KEY"],
    authHint: "Set OPENAI_API_KEY or run codex login.",
    badge: { icon: "⌘", color: "#00c2a8", background: "rgba(0,194,168,0.15)", border: "rgba(0,194,168,0.3)" },
  },
  gemini: {
    name: "gemini",
    label: "Gemini CLI",
    binary: "gemini",
    transport: "cli",
    sessionMode: "explicit_or_latest",
    supportsStructuredOutput: true,
    supportsWorkdirOverride: false,
    authEnvVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    authHint: "Set GEMINI_API_KEY/GOOGLE_API_KEY or sign in with Gemini CLI.",
    badge: { icon: "✦", color: "#ffb020", background: "rgba(255,176,32,0.15)", border: "rgba(255,176,32,0.3)" },
  },
};

const DEFAULT_EXECUTOR = "gemini";
const DEFAULT_ENABLED_EXECUTORS = Object.freeze(["gemini"]);

function normalizeExecutorName(name) {
  return String(name || "").trim().toLowerCase();
}

function getSupportedExecutors() {
  return Object.keys(EXECUTORS);
}

function isValidExecutor(name) {
  return Object.prototype.hasOwnProperty.call(EXECUTORS, normalizeExecutorName(name));
}

function parseEnabledExecutors(raw) {
  const items = String(raw || DEFAULT_ENABLED_EXECUTORS.join(","))
    .split(",")
    .map((item) => normalizeExecutorName(item))
    .filter((item, index, all) => item && all.indexOf(item) === index && isValidExecutor(item));
  return items.length ? items : [DEFAULT_EXECUTOR];
}

function getEnabledExecutors(raw) {
  return parseEnabledExecutors(raw);
}

function isEnabledExecutor(name, raw) {
  const normalized = normalizeExecutorName(name);
  return parseEnabledExecutors(raw).includes(normalized);
}

function getExecutorMeta(name) {
  return EXECUTORS[normalizeExecutorName(name)] || null;
}

module.exports = {
  DEFAULT_EXECUTOR,
  DEFAULT_ENABLED_EXECUTORS,
  EXECUTORS,
  getEnabledExecutors,
  getExecutorMeta,
  getSupportedExecutors,
  isEnabledExecutor,
  isValidExecutor,
  normalizeExecutorName,
  parseEnabledExecutors,
};
