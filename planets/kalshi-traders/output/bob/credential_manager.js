#!/usr/bin/env node
/**
 * Kalshi Credential Manager
 *
 * Secure credential loading, validation, and rate limiting for Kalshi API integration.
 * Integrates with kalshi_client.js auth flow.
 *
 * Usage:
 *   const { CredentialManager } = require('./credential_manager');
 *   const creds = new CredentialManager();
 *   creds.validate();  // throws if missing required credentials
 *   const client = creds.createClient();  // returns configured KalshiClient
 *
 * Run standalone:
 *   node credential_manager.js          # validate credentials
 *   node credential_manager.js --audit  # show audit log
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- .env loader (zero dependencies) ---

function loadEnvFile(envPath) {
  if (!envPath) envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const vars = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

// --- Audit Logger ---

class AuditLogger {
  constructor(logPath) {
    this.logPath = logPath || path.join(__dirname, 'audit_log.jsonl');
  }

  log(event, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      ...details
    };
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(this.logPath, line);
  }

  read(limit = 50) {
    if (!fs.existsSync(this.logPath)) return [];
    const lines = fs.readFileSync(this.logPath, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l));
  }
}

// --- Rate Limiter ---

class RateLimiter {
  constructor(options = {}) {
    // Kalshi API limits: 10 requests/second for trading, 100/second for market data
    this.tradingLimit = options.tradingLimit || 10;
    this.dataLimit = options.dataLimit || 100;
    this.windowMs = options.windowMs || 1000;
    this.tradingCalls = [];
    this.dataCalls = [];
  }

  async checkTrading() {
    return this._check(this.tradingCalls, this.tradingLimit);
  }

  async checkData() {
    return this._check(this.dataCalls, this.dataLimit);
  }

  async _check(calls, limit) {
    const now = Date.now();
    // Remove calls outside window
    while (calls.length > 0 && calls[0] < now - this.windowMs) {
      calls.shift();
    }
    if (calls.length >= limit) {
      const waitMs = calls[0] + this.windowMs - now;
      await new Promise(r => setTimeout(r, waitMs));
    }
    calls.push(Date.now());
    return true;
  }

  getUsage() {
    const now = Date.now();
    const recentTrading = this.tradingCalls.filter(t => t > now - this.windowMs).length;
    const recentData = this.dataCalls.filter(t => t > now - this.windowMs).length;
    return {
      trading: { used: recentTrading, limit: this.tradingLimit },
      data: { used: recentData, limit: this.dataLimit }
    };
  }
}

// --- Credential Manager ---

class CredentialManager {
  constructor(options = {}) {
    this.envPath = options.envPath || path.resolve(process.cwd(), '.env');
    this.audit = new AuditLogger(options.auditLogPath);
    this.rateLimiter = new RateLimiter(options.rateLimits);
    this._credentials = null;
    this._loadCredentials();
  }

  _loadCredentials() {
    // Load .env file into process.env (without overwriting existing vars)
    const envVars = loadEnvFile(this.envPath);
    for (const [key, val] of Object.entries(envVars)) {
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }

    this._credentials = {
      apiKey: process.env.KALSHI_API_KEY || null,
      apiSecret: process.env.KALSHI_API_SECRET || null,
      email: process.env.KALSHI_EMAIL || null,
      password: process.env.KALSHI_PASSWORD || null,
      demo: process.env.KALSHI_DEMO === 'true',
      paperTrading: process.env.PAPER_TRADING !== 'false'  // default: paper mode (C1)
    };

    this.audit.log('credentials_loaded', {
      hasApiKey: !!this._credentials.apiKey,
      hasApiSecret: !!this._credentials.apiSecret,
      hasEmail: !!this._credentials.email,
      hasPassword: !!this._credentials.password,
      demo: this._credentials.demo,
      paperTrading: this._credentials.paperTrading,
      source: fs.existsSync(this.envPath) ? '.env file' : 'environment only'
    });
  }

  validate() {
    const c = this._credentials;
    const errors = [];

    // Need either API key or email/password
    const hasApiKey = !!(c.apiKey && c.apiSecret);
    const hasEmailAuth = !!(c.email && c.password);

    if (!hasApiKey && !hasEmailAuth) {
      errors.push('No authentication method configured. Set KALSHI_API_KEY + KALSHI_API_SECRET, or KALSHI_EMAIL + KALSHI_PASSWORD.');
    }

    if (c.apiKey && !c.apiSecret) {
      errors.push('KALSHI_API_KEY is set but KALSHI_API_SECRET is missing.');
    }

    if (c.email && !c.password) {
      errors.push('KALSHI_EMAIL is set but KALSHI_PASSWORD is missing.');
    }

    // Paper trading safety check (C1)
    if (!c.paperTrading && !c.demo) {
      console.warn('[CredentialManager] WARNING: PAPER_TRADING=false and not in demo mode. Real orders will be placed!');
      this.audit.log('live_trading_warning', { demo: false, paperTrading: false });
    }

    if (errors.length > 0) {
      this.audit.log('validation_failed', { errors });
      const errMsg = 'Credential validation failed:\n  - ' + errors.join('\n  - ');
      throw new Error(errMsg);
    }

    this.audit.log('validation_passed', {
      authMethod: hasApiKey ? 'api_key' : 'email_password',
      demo: c.demo,
      paperTrading: c.paperTrading
    });

    return {
      valid: true,
      authMethod: hasApiKey ? 'api_key' : 'email_password',
      demo: c.demo,
      paperTrading: c.paperTrading
    };
  }

  /**
   * Returns credential object safe for passing to KalshiClient constructor.
   * Never logs or exposes raw secrets.
   */
  getClientOptions() {
    const c = this._credentials;
    return {
      apiKey: c.apiKey,
      apiSecret: c.apiSecret,
      email: c.email,
      password: c.password,
      demo: c.demo,
      mock: false
    };
  }

  /**
   * Creates a configured KalshiClient instance with credentials.
   * Requires kalshi_client.js in the same directory or shared codebase.
   */
  createClient() {
    this.validate();
    const KalshiClient = require('./kalshi_client');
    const client = new KalshiClient(this.getClientOptions());
    this.audit.log('client_created', {
      authMethod: this._credentials.apiKey ? 'api_key' : 'email_password',
      demo: this._credentials.demo
    });
    return client;
  }

  /**
   * Middleware-style rate limiter for API calls.
   * Call before each API request.
   */
  async rateLimitTrading() {
    await this.rateLimiter.checkTrading();
    this.audit.log('api_call', { type: 'trading' });
  }

  async rateLimitData() {
    await this.rateLimiter.checkData();
    this.audit.log('api_call', { type: 'data' });
  }

  getRateLimitStatus() {
    return this.rateLimiter.getUsage();
  }

  /**
   * Returns a masked summary of credentials (safe for logging).
   */
  summary() {
    const c = this._credentials;
    return {
      apiKey: c.apiKey ? c.apiKey.slice(0, 4) + '...' + c.apiKey.slice(-4) : null,
      apiSecret: c.apiSecret ? '***' : null,
      email: c.email || null,
      password: c.password ? '***' : null,
      demo: c.demo,
      paperTrading: c.paperTrading
    };
  }
}

// --- .gitignore check ---

function ensureGitignore() {
  const gitignorePath = path.resolve(process.cwd(), '.gitignore');
  const requiredEntries = ['.env', '.env.*', 'audit_log.jsonl'];
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
  }
  const missing = requiredEntries.filter(e => !content.includes(e));
  if (missing.length > 0) {
    const addition = '\n# Kalshi credentials — never commit\n' + missing.join('\n') + '\n';
    fs.appendFileSync(gitignorePath, addition);
    console.log(`[CredentialManager] Added to .gitignore: ${missing.join(', ')}`);
  }
}

// --- CLI ---

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--audit')) {
    const audit = new AuditLogger();
    const entries = audit.read(args.includes('--all') ? 1000 : 50);
    console.log(`\n=== Kalshi API Audit Log (${entries.length} entries) ===\n`);
    for (const e of entries) {
      console.log(`[${e.timestamp}] ${e.event}`, JSON.stringify(e, ['timestamp', 'event'].reduce((o, k) => { delete o[k]; return o; }, { ...e })));
    }
    process.exit(0);
  }

  console.log('\n=== Kalshi Credential Manager ===\n');

  // Ensure .gitignore covers sensitive files
  ensureGitignore();

  const cm = new CredentialManager();

  // Check if any credentials configured
  try {
    const result = cm.validate();
    console.log('Validation:', result);
    console.log('Credentials:', cm.summary());
    console.log('Rate limits:', cm.getRateLimitStatus());
    console.log('\n[OK] Credentials valid. Ready for Kalshi API integration.');
  } catch (err) {
    // No credentials is expected in dev/CI — show mock mode info
    console.log('[INFO]', err.message);
    console.log('\nTo configure credentials:');
    console.log('  1. Create .env file with KALSHI_API_KEY and KALSHI_API_SECRET');
    console.log('  2. Or set environment variables directly');
    console.log('  3. For demo mode, add KALSHI_DEMO=true');
    console.log('\nWithout credentials, kalshi_client.js runs in mock mode (safe for development).');
    console.log('\nFollowing C1: Paper trading mode is default. Set PAPER_TRADING=false only with Founder approval.');
  }
}

module.exports = { CredentialManager, AuditLogger, RateLimiter, loadEnvFile, ensureGitignore };
