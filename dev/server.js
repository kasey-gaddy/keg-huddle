#!/usr/bin/env node
'use strict';
/**
 * Local development server. Runs the whole app on http://localhost:4280
 * with no Azure account: in-memory storage, demo employees, and a fake
 * signed-in admin. It applies the same security headers as
 * staticwebapp.config.json so CSP problems show up locally too.
 *
 *   npm run dev            (from the repo root)
 *   DEV_ROLE=trainer npm run dev   to try the console as a trainer
 *
 * NEVER deploy this file. It is not used in Azure.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.STORE = 'memory';
process.env.SEED_DEMO = process.env.SEED_DEMO || 'true';
process.env.TOKEN_SIGNING_KEY = process.env.TOKEN_SIGNING_KEY || crypto.randomBytes(32).toString('hex');
process.env.HCSS_MODE = process.env.HCSS_MODE || 'off';

const routes = require('../api/src/handlers');
const { run, MAX_BODY } = require('../api/src/lib/http');

const APP = path.join(__dirname, '..', 'app');
const swa = JSON.parse(fs.readFileSync(path.join(APP, 'staticwebapp.config.json'), 'utf8'));
const PORT = +process.env.PORT || 4280;
const role = process.env.DEV_ROLE === 'trainer' ? ['trainer'] : ['admin', 'trainer'];
const principal = { identityProvider: 'kegtus', userId: 'dev-user', userDetails: 'dev.trainer@kegtus.com', userRoles: ['anonymous', 'authenticated', ...role] };
const principalHeader = Buffer.from(JSON.stringify(principal)).toString('base64');

const table = routes.map((r) => ({ ...r, re: new RegExp('^/api/' + r.route.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)') + '$') }));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...swa.globalHeaders, ...headers });
  res.end(body);
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new Error('too large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  if (p === '/.auth/me') return send(res, 200, JSON.stringify({ clientPrincipal: principal }), { 'content-type': 'application/json' });
  if (p.startsWith('/.auth/')) return send(res, 302, '', { location: '/' });

  if (p.startsWith('/api/')) {
    const match = table.find((r) => r.methods.includes(req.method) && r.re.test(p));
    if (!match) return send(res, 404, JSON.stringify({ error: 'Not found' }), { 'content-type': 'application/json' });
    let text = '';
    try { text = await readBody(req); } catch { return send(res, 413, '{"error":"Request too large."}', { 'content-type': 'application/json' }); }
    const headers = { ...req.headers };
    // Simulate Static Web Apps: signed-in user on /api/manage/* only.
    if (p.startsWith('/api/manage/')) headers['x-ms-client-principal'] = principalHeader;
    else delete headers['x-ms-client-principal'];
    const r = await run(match, {
      method: req.method,
      params: p.match(match.re).groups || {},
      query: Object.fromEntries(url.searchParams),
      headers: { get: (n) => headers[n.toLowerCase()] ?? null },
      ip: req.socket.remoteAddress || 'local',
      json: async () => { if (!text) return {}; try { return JSON.parse(text); } catch { const { HttpError } = require('../api/src/lib/util'); throw new HttpError(400, 'Invalid JSON.'); } }
    }, (m) => console.error(m));
    return send(res, r.status, JSON.stringify(r.body), { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }

  let file = p.endsWith('/') ? p + 'index.html' : p;
  if (p === '/join') return send(res, 301, '', { location: '/join/' });
  const full = path.normalize(path.join(APP, file));
  if (!full.startsWith(APP) || file.includes('staticwebapp.config.json')) return send(res, 404, 'Not found');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream' });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nKE&G Huddle dev server: http://localhost:${PORT}`);
  console.log(`  Trainer console:  http://localhost:${PORT}/   (signed in as ${principal.userDetails}, roles: ${role.join(', ')})`);
  console.log(`  Employee phone:   http://localhost:${PORT}/join/   (demo IDs 10001 to 10064)`);
  console.log(`  Fill the room:    npm run simulate -- --count 50\n`);
});
