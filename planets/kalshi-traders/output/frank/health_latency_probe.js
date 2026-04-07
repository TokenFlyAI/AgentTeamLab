#!/usr/bin/env node
'use strict';

const http = require('http');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const idx = args.indexOf(name);
  if (idx === -1 || idx === args.length - 1) return fallback;
  return args[idx + 1];
};

const PORT = Number(getArg('--port', '3199'));
const SAMPLES = Number(getArg('--samples', '25'));
const THRESHOLD_MS = Number(getArg('--threshold', '500'));
const API_KEY = process.env.API_KEY || 'test';

function percentile(samples, p) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function probeOnce() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.get(`http://localhost:${PORT}/api/health`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const durationMs = Date.now() - start;
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (_) {}
        resolve({
          status: res.statusCode,
          durationMs,
          activeAgents: parsed?.activeAgents ?? null,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function main() {
  const results = [];
  for (let i = 0; i < SAMPLES; i++) {
    try {
      results.push(await probeOnce());
    } catch (error) {
      results.push({ status: null, durationMs: 5000, error: error.message });
    }
  }

  const successful = results.filter((result) => result.status === 200);
  const durations = successful.map((result) => result.durationMs);
  const slowSamples = results
    .map((result, index) => ({ sample: index + 1, ...result }))
    .filter((result) => result.durationMs > THRESHOLD_MS || result.status !== 200);

  const summary = {
    port: PORT,
    samplesRequested: SAMPLES,
    samplesCompleted: results.length,
    okResponses: successful.length,
    thresholdMs: THRESHOLD_MS,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: durations.length ? Math.max(...durations) : null,
    breaches: slowSamples.length,
    slowSamples,
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.breaches > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
