/**
 * Agent Planet API Client SDK
 * Zero-dependency Node.js client for the Agent Planet Dashboard API (server.js).
 *
 * @version 1.0.0
 * @author Karl (Platform Engineer)
 * @task T1014
 * @sprint Sprint 9
 * @generated 2026-04-07
 *
 * Usage:
 *   const { AgentPlanetClient } = require('./lib/api_client');
 *   const client = new AgentPlanetClient({ apiKey: process.env.API_KEY });
 *   const agents = await client.agents.list();
 *   const task = await client.tasks.get(542);
 *
 * All methods return parsed JSON (or throw on non-2xx).
 * Public endpoints (health, events) skip auth automatically.
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Core HTTP helper
// ---------------------------------------------------------------------------

/**
 * Make a single HTTP/HTTPS request.
 * @param {object} opts
 * @param {string} opts.baseUrl   - e.g. 'http://localhost:3199'
 * @param {string} opts.method    - GET | POST | PATCH | DELETE
 * @param {string} opts.path      - e.g. '/api/agents'
 * @param {object} [opts.headers] - extra headers
 * @param {object|string|null} [opts.body] - request body (auto-serialised to JSON)
 * @param {object} [opts.query]   - query-string params
 * @returns {Promise<any>} parsed JSON response
 */
function request({ baseUrl, method, path, headers = {}, body = null, query = {} }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const isJson = body !== null && typeof body === 'object';
    const bodyStr = isJson ? JSON.stringify(body) : (body || null);

    const reqHeaders = {
      'Accept': 'application/json',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: reqHeaders,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(raw)); }
          catch { resolve(raw); }
        } else {
          let errBody;
          try { errBody = JSON.parse(raw); } catch { errBody = raw; }
          const err = new Error(`HTTP ${res.statusCode}: ${url.pathname}`);
          err.status = res.statusCode;
          err.body = errBody;
          reject(err);
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// AgentPlanetClient
// ---------------------------------------------------------------------------

class AgentPlanetClient {
  /**
   * @param {object} opts
   * @param {string} [opts.baseUrl='http://localhost:3199']
   * @param {string} [opts.apiKey]   - Bearer token (API_KEY env var)
   * @param {number} [opts.timeout]  - unused (future)
   */
  constructor({ baseUrl = 'http://localhost:3199', apiKey = '' } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey || process.env.API_KEY || '';

    // Bind sub-namespaces
    this.core       = new CoreEndpoints(this);
    this.planets    = new PlanetsEndpoints(this);
    this.agents     = new AgentsEndpoints(this);
    this.executors  = new ExecutorsEndpoints(this);
    this.smartRun   = new SmartRunEndpoints(this);
    this.tasks      = new TasksEndpoints(this);
    this.broadcast  = new BroadcastEndpoints(this);
    this.ceo        = new CeoEndpoints(this);
    this.channel    = new ChannelEndpoints(this);
    this.consensus  = new ConsensusEndpoints(this);
    this.knowledge  = new KnowledgeEndpoints(this);
    this.mode       = new ModeEndpoints(this);
    this.cost       = new CostEndpoints(this);
    this.messages   = new MessagesEndpoints(this);
  }

  /** @internal */
  _authHeader(skipAuth = false) {
    if (skipAuth || !this.apiKey) return {};
    return { 'Authorization': `Bearer ${this.apiKey}` };
  }

  /** @internal */
  _req(method, path, { body, query, skipAuth } = {}) {
    return request({
      baseUrl: this.baseUrl,
      method,
      path,
      headers: this._authHeader(skipAuth),
      body,
      query,
    });
  }

  get(path, opts)    { return this._req('GET',    path, opts); }
  post(path, opts)   { return this._req('POST',   path, opts); }
  patch(path, opts)  { return this._req('PATCH',  path, opts); }
  delete(path, opts) { return this._req('DELETE', path, opts); }
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

class CoreEndpoints {
  constructor(client) { this._c = client; }

  /** GET /api/health — public */
  health() {
    return this._c.get('/api/health', { skipAuth: true });
  }

  /** GET /api/config */
  config() {
    return this._c.get('/api/config');
  }

  /** GET /api/dashboard — agents + tasks + mode in one call */
  dashboard() {
    return this._c.get('/api/dashboard');
  }

  /** GET /api/search?q=<query> */
  search(q) {
    return this._c.get('/api/search', { query: { q } });
  }

  /** GET /api/org */
  org() {
    return this._c.get('/api/org');
  }

  /** GET /api/sops */
  sops() {
    return this._c.get('/api/sops');
  }

  /** GET /api/ops */
  ops() {
    return this._c.get('/api/ops');
  }

  /** GET /api/digest */
  digest() {
    return this._c.get('/api/digest');
  }
}

// ---------------------------------------------------------------------------
// Planets
// ---------------------------------------------------------------------------

class PlanetsEndpoints {
  constructor(client) { this._c = client; }

  /** GET /api/planets */
  list() {
    return this._c.get('/api/planets');
  }

  /** GET /api/planets/active */
  active() {
    return this._c.get('/api/planets/active');
  }

  /**
   * POST /api/planets/switch
   * @param {string} name - planet name
   */
  switch(name) {
    return this._c.post('/api/planets/switch', { body: { name } });
  }

  /**
   * POST /api/planets/create
   * @param {string} name
   * @param {string[]} [agents]
   */
  create(name, agents = []) {
    return this._c.post('/api/planets/create', { body: { name, agents } });
  }
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

class AgentsEndpoints {
  constructor(client) { this._c = client; }

  /** GET /api/agents */
  list() {
    return this._c.get('/api/agents');
  }

  /** GET /api/agents/:name */
  get(name) {
    return this._c.get(`/api/agents/${enc(name)}`);
  }

  /** GET /api/agents/:name/executor */
  getExecutor(name) {
    return this._c.get(`/api/agents/${enc(name)}/executor`);
  }

  /**
   * POST /api/agents/:name/executor
   * @param {string} name
   * @param {'claude'|'kimi'|'codex'|'gemini'} executor
   */
  setExecutor(name, executor) {
    return this._c.post(`/api/agents/${enc(name)}/executor`, { body: { executor } });
  }

  /** GET /api/agents/:name/log */
  getLog(name) {
    return this._c.get(`/api/agents/${enc(name)}/log`);
  }

  /**
   * POST /api/agents/:name/message — send DM to agent's inbox
   * @param {string} name
   * @param {string} message
   * @param {string} [from='ceo']
   */
  sendMessage(name, message, from = 'ceo') {
    return this._c.post(`/api/agents/${enc(name)}/message`, { body: { message, from } });
  }

  /** POST /api/agents/:name/stop */
  stop(name) {
    return this._c.post(`/api/agents/${enc(name)}/stop`);
  }

  /** POST /api/agents/:name/ping */
  ping(name) {
    return this._c.post(`/api/agents/${enc(name)}/ping`);
  }

  /** POST /api/agents/:name/start */
  start(name) {
    return this._c.post(`/api/agents/${enc(name)}/start`);
  }

  /** POST /api/agents/start-all */
  startAll() {
    return this._c.post('/api/agents/start-all');
  }

  /** POST /api/agents/stop-all */
  stopAll() {
    return this._c.post('/api/agents/stop-all');
  }

  /** POST /api/agents/smart-start */
  smartStart() {
    return this._c.post('/api/agents/smart-start');
  }

  /** POST /api/agents/watchdog */
  watchdog() {
    return this._c.post('/api/agents/watchdog');
  }

  /**
   * POST /api/agents/:name/persona/note
   * @param {string} name
   * @param {string} note
   */
  addPersonaNote(name, note) {
    return this._c.post(`/api/agents/${enc(name)}/persona/note`, { body: { note } });
  }

  /**
   * POST /api/agents/:name/persona
   * @param {string} name
   * @param {string} persona - full persona text
   */
  updatePersona(name, persona) {
    return this._c.post(`/api/agents/${enc(name)}/persona`, { body: { persona } });
  }

  /**
   * POST /api/agents/:name/inbox
   * @param {string} name
   * @param {string} message
   * @param {string} [from='ceo']
   */
  postInbox(name, message, from = 'ceo') {
    return this._c.post(`/api/agents/${enc(name)}/inbox`, { body: { message, from } });
  }

  /** GET /api/agents/:name/context */
  getContext(name) {
    return this._c.get(`/api/agents/${enc(name)}/context`);
  }

  /** GET /api/agents/:name/cycles */
  getCycles(name) {
    return this._c.get(`/api/agents/${enc(name)}/cycles`);
  }

  /** GET /api/agents/:name/cycles/:n */
  getCycleDetail(name, n) {
    return this._c.get(`/api/agents/${enc(name)}/cycles/${n}`);
  }

  /** GET /api/agents/:name/health */
  getHealth(name) {
    return this._c.get(`/api/agents/${enc(name)}/health`);
  }

  /** GET /api/agents/:name/output */
  listOutput(name) {
    return this._c.get(`/api/agents/${enc(name)}/output`);
  }

  /**
   * GET /api/agents/:name/output/:file
   * @param {string} name
   * @param {string} file
   */
  readOutput(name, file) {
    return this._c.get(`/api/agents/${enc(name)}/output/${enc(file)}`);
  }
}

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

class ExecutorsEndpoints {
  constructor(client) { this._c = client; }

  /** GET /api/executors */
  list() {
    return this._c.get('/api/executors');
  }

  /** GET /api/executors/health */
  health() {
    return this._c.get('/api/executors/health');
  }

  /** GET /api/config/executor */
  config() {
    return this._c.get('/api/config/executor');
  }
}

// ---------------------------------------------------------------------------
// Smart-Run / Fleet
// ---------------------------------------------------------------------------

class SmartRunEndpoints {
  constructor(client) { this._c = client; }

  /** GET /api/smart-run/config */
  getConfig() {
    return this._c.get('/api/smart-run/config');
  }

  /**
   * POST /api/smart-run/config
   * @param {object} config - partial SmartRunConfig
   */
  updateConfig(config) {
    return this._c.post('/api/smart-run/config', { body: config });
  }

  /** POST /api/smart-run/start */
  start() {
    return this._c.post('/api/smart-run/start');
  }

  /** POST /api/smart-run/stop */
  stop() {
    return this._c.post('/api/smart-run/stop');
  }

  /** GET /api/smart-run/status */
  status() {
    return this._c.get('/api/smart-run/status');
  }

  /** GET /api/watchdog-log */
  watchdogLog() {
    return this._c.get('/api/watchdog-log');
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

class TasksEndpoints {
  constructor(client) { this._c = client; }

  /**
   * GET /api/tasks
   * @param {object} [filters]
   * @param {string} [filters.status]   - open|in_progress|done|blocked|in_review|cancelled
   * @param {string} [filters.assignee] - agent name
   * @param {string} [filters.priority] - low|medium|high|critical
   * @param {string} [filters.group]
   */
  list({ status, assignee, priority, group } = {}) {
    return this._c.get('/api/tasks', { query: { status, assignee, priority, group } });
  }

  /**
   * POST /api/tasks
   * @param {object} task
   * @param {string} task.title
   * @param {string} [task.description]
   * @param {'low'|'medium'|'high'|'critical'} [task.priority='medium']
   * @param {string} [task.assignee]
   * @param {string} [task.group]
   */
  create(task) {
    return this._c.post('/api/tasks', { body: task });
  }

  /** GET /api/tasks/:id */
  get(id) {
    return this._c.get(`/api/tasks/${id}`);
  }

  /**
   * PATCH /api/tasks/:id
   * @param {number|string} id
   * @param {object} updates - e.g. { status, notes, assignee, priority }
   */
  update(id, updates) {
    return this._c.patch(`/api/tasks/${id}`, { body: updates });
  }

  /** DELETE /api/tasks/:id */
  delete(id) {
    return this._c.delete(`/api/tasks/${id}`);
  }

  /**
   * POST /api/tasks/:id/claim — atomically claim a task (409 if already claimed)
   * @param {number|string} id
   * @param {string} assignee - agent name
   */
  claim(id, assignee) {
    return this._c.post(`/api/tasks/${id}/claim`, { body: { assignee } });
  }

  /**
   * POST /api/tasks/:id/review
   * @param {number|string} id
   * @param {'approve'|'reject'} verdict
   * @param {string} reviewer - agent name
   * @param {string} [comment]
   */
  review(id, verdict, reviewer, comment = '') {
    return this._c.post(`/api/tasks/${id}/review`, { body: { verdict, reviewer, comment } });
  }

  /** GET /api/tasks/:id/result */
  getResult(id) {
    return this._c.get(`/api/tasks/${id}/result`);
  }

  /**
   * POST /api/tasks/:id/result
   * @param {number|string} id
   * @param {string|object} content
   */
  writeResult(id, content) {
    return this._c.post(`/api/tasks/${id}/result`, { body: { content } });
  }

  /** GET /api/tasks/archive */
  listArchive() {
    return this._c.get('/api/tasks/archive');
  }

  /** POST /api/tasks/archive — archive completed tasks */
  archive() {
    return this._c.post('/api/tasks/archive');
  }

  /** GET /api/tasks/export.csv */
  exportCsv() {
    return this._c.get('/api/tasks/export.csv');
  }

  /** GET /api/tasks/health */
  health() {
    return this._c.get('/api/tasks/health');
  }

  // Convenience helpers

  /** Mark task in_progress */
  markInProgress(id, notes = '') {
    return this.update(id, { status: 'in_progress', notes });
  }

  /** Mark task in_review */
  markInReview(id, notes = '') {
    return this.update(id, { status: 'in_review', notes });
  }

  /** Mark task done */
  markDone(id, notes = '') {
    return this.update(id, { status: 'done', notes });
  }
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

class BroadcastEndpoints {
  constructor(client) { this._c = client; }

  /**
   * POST /api/broadcast — DM all agents simultaneously
   * @param {string} message
   * @param {string} [from='ceo']
   */
  send(message, from = 'ceo') {
    return this._c.post('/api/broadcast', { body: { message, from } });
  }
}

// ---------------------------------------------------------------------------
// CEO
// ---------------------------------------------------------------------------

class CeoEndpoints {
  constructor(client) { this._c = client; }

  /**
   * POST /api/ceo/command — smart-routed command
   * Prefixes: @agentname <msg>, task: <title>, /mode <name>, or plain text → alice
   * @param {string} command
   */
  command(command) {
    return this._c.post('/api/ceo/command', { body: { command } });
  }

  /** GET /api/ceo-inbox */
  getInbox() {
    return this._c.get('/api/ceo-inbox');
  }

  /**
   * POST /api/ceo-inbox/:filename/read — mark CEO inbox message as read
   * @param {string} filename
   */
  markInboxRead(filename) {
    return this._c.post(`/api/ceo-inbox/${enc(filename)}/read`);
  }
}

// ---------------------------------------------------------------------------
// Team channel + Announcements
// ---------------------------------------------------------------------------

class ChannelEndpoints {
  constructor(client) { this._c = client; }

  /** GET /api/team-channel */
  listMessages() {
    return this._c.get('/api/team-channel');
  }

  /**
   * POST /api/team-channel
   * @param {string} message
   * @param {string} from - agent name
   */
  post(message, from) {
    return this._c.post('/api/team-channel', { body: { message, from } });
  }

  /** GET /api/announcements */
  listAnnouncements() {
    return this._c.get('/api/announcements');
  }

  /**
   * POST /api/announcements
   * @param {string} message
   * @param {string} from - agent name
   */
  postAnnouncement(message, from) {
    return this._c.post('/api/announcements', { body: { message, from } });
  }
}

// ---------------------------------------------------------------------------
// Consensus
// ---------------------------------------------------------------------------

class ConsensusEndpoints {
  constructor(client) { this._c = client; }

  /** GET /api/consensus */
  get() {
    return this._c.get('/api/consensus');
  }

  /**
   * POST /api/consensus/entry — add a norm or decision
   * @param {'norm'|'decision'} type
   * @param {string} content
   * @param {string} [author]
   */
  addEntry(type, content, author = '') {
    return this._c.post('/api/consensus/entry', { body: { type, content, author } });
  }

  /**
   * DELETE /api/consensus/entry/:id
   * @param {string|number} id - e.g. 'C1' or 'D2'
   */
  deleteEntry(id) {
    return this._c.delete(`/api/consensus/entry/${enc(String(id))}`);
  }
}

// ---------------------------------------------------------------------------
// Knowledge + Research
// ---------------------------------------------------------------------------

class KnowledgeEndpoints {
  constructor(client) { this._c = client; }

  /** GET /api/knowledge */
  list() {
    return this._c.get('/api/knowledge');
  }

  /** GET /api/knowledge/:path */
  get(path) {
    return this._c.get(`/api/knowledge/${enc(path)}`);
  }

  /** GET /api/research */
  listResearch() {
    return this._c.get('/api/research');
  }

  /** GET /api/research/:file */
  getResearch(file) {
    return this._c.get(`/api/research/${enc(file)}`);
  }

  /** GET /api/code-output */
  getCodeOutput() {
    return this._c.get('/api/code-output');
  }
}

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

class ModeEndpoints {
  constructor(client) { this._c = client; }

  /** GET /api/mode */
  get() {
    return this._c.get('/api/mode');
  }

  /**
   * POST /api/mode
   * @param {'plan'|'normal'|'crazy'|'autonomous'} mode
   * @param {string} [reason]
   */
  set(mode, reason = '') {
    return this._c.post('/api/mode', { body: { mode, reason } });
  }
}

// ---------------------------------------------------------------------------
// Cost + Stats + Metrics
// ---------------------------------------------------------------------------

class CostEndpoints {
  constructor(client) { this._c = client; }

  /** GET /api/cost — today's + 7-day token spend per agent */
  getCost() {
    return this._c.get('/api/cost');
  }

  /** GET /api/stats */
  getStats() {
    return this._c.get('/api/stats');
  }

  /** GET /api/metrics */
  getMetrics() {
    return this._c.get('/api/metrics');
  }
}

// ---------------------------------------------------------------------------
// Messages (message bus)
// ---------------------------------------------------------------------------

class MessagesEndpoints {
  constructor(client) { this._c = client; }

  /**
   * POST /api/messages — send a message to an agent
   * @param {string} to - agent name
   * @param {string} message
   * @param {string} [from='ceo']
   */
  send(to, message, from = 'ceo') {
    return this._c.post('/api/messages', { body: { to, message, from } });
  }

  /**
   * POST /api/messages/broadcast
   * @param {string} message
   * @param {string} [from='ceo']
   */
  broadcast(message, from = 'ceo') {
    return this._c.post('/api/messages/broadcast', { body: { message, from } });
  }

  /** GET /api/messages/queue-depth */
  queueDepth() {
    return this._c.get('/api/messages/queue-depth');
  }

  /** GET /api/inbox/:agent */
  getInbox(agent) {
    return this._c.get(`/api/inbox/${enc(agent)}`);
  }

  /**
   * POST /api/inbox/:agent/:id/ack
   * @param {string} agent
   * @param {string} id - message id
   */
  ack(agent, id) {
    return this._c.post(`/api/inbox/${enc(agent)}/${enc(id)}/ack`);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function enc(s) {
  return encodeURIComponent(s);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  AgentPlanetClient,
  // Named sub-class exports for testing / extension
  CoreEndpoints,
  PlanetsEndpoints,
  AgentsEndpoints,
  ExecutorsEndpoints,
  SmartRunEndpoints,
  TasksEndpoints,
  BroadcastEndpoints,
  CeoEndpoints,
  ChannelEndpoints,
  ConsensusEndpoints,
  KnowledgeEndpoints,
  ModeEndpoints,
  CostEndpoints,
  MessagesEndpoints,
};
