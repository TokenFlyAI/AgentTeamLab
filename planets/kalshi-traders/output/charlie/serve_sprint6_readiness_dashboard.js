#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT_INDEX = process.argv.indexOf("--port");
const PORT = PORT_INDEX >= 0 ? Number(process.argv[PORT_INDEX + 1]) : 3461;

const SCRIPT_DIR = fs.realpathSync(__dirname);
const ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const API_BASE = "http://localhost:3199";
const AUTH_HEADER = { Authorization: `Bearer ${process.env.API_KEY || "test"}` };

const LANES = [
  {
    id: 814,
    owner: "Bob",
    label: "Normalization",
    title: "Live market normalization",
    artifactPath: path.join(ROOT, "output", "bob", "live_market_normalization_report.md"),
    runCommand:
      "node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/bob/backend/scripts/verify_live_market_normalization.js",
    verifyCommand:
      "node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/bob/backend/tests/unit/live_market_normalizer.test.js",
  },
  {
    id: 815,
    owner: "Ivan",
    label: "Clustering Audit",
    title: "Cluster stability audit",
    artifactPath: path.join(ROOT, "output", "ivan", "cluster_stability_audit.md"),
    runCommand: "python3 /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/ivan/cluster_stability_audit.py",
    verifyCommand: "cat /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/ivan/cluster_stability_audit.json",
  },
  {
    id: 816,
    owner: "Grace",
    label: "Phase 1 Fixture",
    title: "Live-data fixture pack",
    artifactPath: path.join(ROOT, "output", "grace", "filtered_markets_live_fixture.json"),
    runCommand: "node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/verify_live_phase1_fixture.js",
    verifyCommand: "cat /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/grace/live_phase1_validation_report.md",
  },
  {
    id: 817,
    owner: "Dave",
    label: "Replay Harness",
    title: "Deterministic replay harness",
    artifactPath: path.join(ROOT, "output", "dave", "t817", "replay_report.json"),
    runCommand:
      "node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/dave/backend/strategies/risk_replay_harness_t817.js",
    verifyCommand:
      "node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/agents/dave/tests/integration/t817_replay_harness.test.js",
  },
  {
    id: 818,
    owner: "Tina",
    label: "QA Gates",
    title: "QA acceptance gates",
    artifactPath: path.join(ROOT, "output", "tina", "sprint6_qa_acceptance_gates.md"),
    runCommand: "cat /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/tina/sprint6_qa_acceptance_gates.md",
    verifyCommand: "review against Tina gate table G1-G7",
  },
  {
    id: 819,
    owner: "Charlie",
    label: "Readiness View",
    title: "Sprint 6 readiness dashboard",
    artifactPath: path.join(ROOT, "output", "charlie", "sprint6_readiness_dashboard.html"),
    runCommand:
      "node /Users/chenyangcui/Documents/code/aicompany/planets/kalshi-traders/output/charlie/serve_sprint6_readiness_dashboard.js --port 3461",
    verifyCommand: "curl -s http://localhost:3461/api/readiness | python3 -m json.tool",
  },
];

function fileExists(target) {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function statFile(target) {
  if (!fileExists(target)) {
    return { exists: false, path: target };
  }
  const stat = fs.statSync(target);
  return {
    exists: true,
    path: target,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

function readText(target) {
  try {
    return fs.readFileSync(target, "utf8");
  } catch {
    return "";
  }
}

function readJson(target) {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
}

function getJson(url) {
  return fetch(url, { headers: AUTH_HEADER }).then(async (response) => {
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { ok: response.ok, status: response.status, body };
  });
}

function severityRank(level) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[level] || 0;
}

function deriveArtifactState(lane) {
  const artifact = statFile(lane.artifactPath);
  const result = {
    artifact,
    readiness: artifact.exists ? "ready" : "missing",
    freshness: artifact.exists ? artifact.modifiedAt : null,
    details: [],
  };

  if (!artifact.exists) {
    result.readiness = "missing";
    result.details.push("Artifact not present yet.");
    return result;
  }

  if (lane.id === 814) {
    const report = readText(lane.artifactPath);
    const freshnessMatch = report.match(/generatedAt=([0-9TZ:.\-]+)/);
    if (freshnessMatch) {
      result.freshness = freshnessMatch[1];
    }
    result.details.push("Normalization verifier report present.");
  }

  if (lane.id === 815) {
    const audit = readJson(path.join(ROOT, "output", "ivan", "cluster_stability_audit.json"));
    if (audit?.generated_at) {
      result.freshness = audit.generated_at;
    }
    if (audit?.input_fixture?.modified_at) {
      result.details.push(`Audit input fixture freshness: ${audit.input_fixture.modified_at}.`);
    }
    if (audit?.input_fixture?.path) {
      result.details.push(`Audit currently references ${path.basename(audit.input_fixture.path)} as upstream evidence.`);
    }
    if (audit?.baseline?.clusters?.length) {
      result.details.push(`${audit.baseline.clusters.length} baseline clusters recorded.`);
    }
    if (audit?.recommendations?.length) {
      result.details.push(`${audit.recommendations.length} follow-up recommendations documented.`);
    }
  }

  if (lane.id === 816) {
    const fixture = readJson(lane.artifactPath);
    const phase = fixture?.phase || "";
    const task = fixture?.task || "";
    if (fixture?.generated_at) {
      result.freshness = fixture.generated_at;
    }
    if (fixture?.summary?.qualifying_markets != null) {
      result.details.push(`${fixture.summary.qualifying_markets} qualifying markets in current file.`);
    }
    if (phase !== "Sprint 6 Phase 1" && task !== "T816") {
      result.readiness = "stale";
      result.details.push(`Current file is ${task || "unknown task"} / ${phase || "unknown phase"}, not Sprint 6 evidence.`);
    }
  }

  if (lane.id === 817) {
    const replay = readJson(lane.artifactPath);
    if (replay?.generatedAt) {
      result.freshness = replay.generatedAt;
    }
    if (replay?.error) {
      result.readiness = "warning";
      result.details.push(`Replay run failed: ${replay.error}`);
    } else {
      const mismatches = [];
      for (const scenario of replay?.scenarios || []) {
        const observed = scenario.observed || {};
        const expected = scenario.expected || {};
        const keys = ["halted", "executed", "stopLossRejected", "capitalFloorBreached"];
        const isMatch = keys.every((key) => observed[key] === expected[key]);
        if (!isMatch) {
          mismatches.push(scenario.scenario);
        }
      }
      if (mismatches.length) {
        result.readiness = "warning";
        result.details.push(`Scenario mismatches: ${mismatches.join(", ")}.`);
      } else if (Array.isArray(replay?.scenarios) && replay.scenarios.length) {
        result.details.push("Observed replay outputs match stated expectations.");
      } else {
        result.readiness = "warning";
        result.details.push("Replay artifact is present, but no scenario results were recorded.");
      }
    }
  }

  if (lane.id === 818) {
    result.details.push("QA gate definition present.");
    result.details.push("Gate table G1-G7 is available for reviewer cross-checks.");
  }

  if (lane.id === 819) {
    result.details.push("Dashboard artifact ready.");
  }

  return result;
}

async function buildReadiness() {
  const taskListResponse = await getJson(`${API_BASE}/api/tasks`);
  const tasks = Array.isArray(taskListResponse.body) ? taskListResponse.body : [];
  const taskMap = new Map(tasks.map((task) => [task.id, task]));

  const lanes = [];
  const blockers = [];

  for (const lane of LANES) {
    const taskResponse = await getJson(`${API_BASE}/api/tasks/${lane.id}`);
    const task = taskMap.get(lane.id) || (taskResponse.ok ? taskResponse.body : null);
    const artifactState = deriveArtifactState(lane);
    const status = task?.status || (artifactState.artifact.exists ? "untracked" : "missing");

    const laneData = {
      ...lane,
      taskStatus: status,
      taskFound: taskResponse.ok || taskMap.has(lane.id),
      taskArchived: Boolean(task?.archived),
      taskNotes: task?.notesList || [],
      artifact: artifactState.artifact,
      artifactState: artifactState.readiness,
      freshness: artifactState.freshness,
      details: artifactState.details,
    };

    if (!laneData.taskFound) {
      blockers.push({
        level: "medium",
        title: `T${lane.id} missing from active task lookup`,
        message: "Artifact exists, but the board API still returns task not found on port 3199.",
      });
    }

    if (lane.id === 816 && laneData.artifactState === "stale") {
      blockers.push({
        level: "high",
        title: "Sprint 6 Phase 1 fixture is not current",
        message: "Grace's visible artifact is still the Sprint 4 filtered markets file, so Phase 1 is not review-ready.",
      });
    }

    if (lane.id === 817 && laneData.artifactState === "warning") {
      blockers.push({
        level: "high",
        title: "Replay harness evidence is currently degraded",
        message: "The latest T817 artifact records a failed deterministic replay run and should be refreshed before claiming Sprint 6 risk replay is green.",
      });
    }

    lanes.push(laneData);
  }

  const apiKeyConfigured = Boolean(process.env.KALSHI_API_KEY);
  if (!apiKeyConfigured) {
    blockers.push({
      level: "critical",
      title: "T236 still blocked",
      message: "Kalshi API credentials are not configured in this environment.",
    });
  }

  blockers.sort((a, b) => severityRank(b.level) - severityRank(a.level));

  const readyCount = lanes.filter((lane) => ["ready"].includes(lane.artifactState)).length;
  const reviewCount = lanes.filter((lane) => lane.taskStatus === "in_review").length;
  const inProgressCount = lanes.filter((lane) => lane.taskStatus === "in_progress").length;

  return {
    generatedAt: new Date().toISOString(),
    apiKeyConfigured,
    board: {
      readyCount,
      reviewCount,
      inProgressCount,
      blockerCount: blockers.length,
    },
    blockers,
    lanes,
  };
}

function sendJson(res, data) {
  res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function sendText(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "text/plain; charset=utf-8" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return sendText(
      res,
      200,
      fs.readFileSync(path.join(SCRIPT_DIR, "sprint6_readiness_dashboard.html"), "utf8"),
      "text/html; charset=utf-8"
    );
  }

  if (url.pathname === "/api/readiness") {
    try {
      return sendJson(res, await buildReadiness());
    } catch (error) {
      return sendJson(res, { error: error.message });
    }
  }

  return sendText(res, 404, "Not found");
});

server.listen(PORT, () => {
  console.log(`Sprint 6 readiness dashboard running at http://localhost:${PORT}`);
  console.log("  GET /             - dashboard");
  console.log("  GET /api/readiness - live readiness snapshot");
});
