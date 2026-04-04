#!/usr/bin/env node
// Sprint 3 Progress Tracker Server
// Run: node output/serve_sprint3_tracker.js
// Opens at http://localhost:3458

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3458;
const HTML_PATH = path.join(__dirname, 'sprint3_tracker.html');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(HTML_PATH, 'utf8'));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Sprint 3 Tracker: http://localhost:${PORT}`);
  console.log('Fetches task data from localhost:3199 API');
});
