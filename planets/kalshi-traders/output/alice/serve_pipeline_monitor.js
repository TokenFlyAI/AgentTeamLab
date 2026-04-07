#!/usr/bin/env node
/**
 * Pipeline Monitor Server — T581
 * Serves pipeline_monitor.html on port 3460
 * Serves pipeline output files as JSON for the dashboard to read
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3460;
const ROOT = path.resolve(__dirname, '..', '..');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
};

function serve(res, filePath, contentType) {
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === '/' || p === '/index.html') {
    return serve(res, path.join(__dirname, 'pipeline_monitor.html'), 'text/html');
  }

  // Serve output files: /output/{agent}/{file}
  if (p.startsWith('/output/')) {
    const rel = p.slice('/output/'.length);
    const filePath = path.join(ROOT, 'output', rel);
    // Prevent directory traversal
    if (!filePath.startsWith(path.join(ROOT, 'output'))) {
      res.writeHead(403); return res.end('Forbidden');
    }
    return serve(res, filePath, MIME[path.extname(filePath)] || 'application/octet-stream');
  }

  // Serve public files: /public/{file}
  if (p.startsWith('/public/')) {
    const rel = p.slice('/public/'.length);
    const filePath = path.join(ROOT, 'public', rel);
    if (!filePath.startsWith(path.join(ROOT, 'public'))) {
      res.writeHead(403); return res.end('Forbidden');
    }
    return serve(res, filePath, MIME[path.extname(filePath)] || 'application/octet-stream');
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Pipeline Monitor running at http://localhost:${PORT}`);
  console.log(`Serving data from: ${ROOT}`);
});
