'use strict';
const { HttpError } = require('./util');
const { requireRole, verifyEmployeeToken } = require('./auth');

/**
 * One wrapper for every route, used by both Azure Functions and the local
 * dev server. It enforces the route's auth level before the handler runs,
 * caps body size, and never leaks internal error details to the caller.
 *
 * Route auth levels:
 *   public   - anyone (join page, role lookup)
 *   employee - signed employee token for the session in the URL
 *   trainer  - signed-in KE&G user with the trainer or admin role
 *   admin    - signed-in KE&G user with the admin role
 */
const MAX_BODY = 256 * 1024;

async function run(route, req, log) {
  try {
    if (route.auth === 'trainer') req.user = requireRole(req, ['trainer', 'admin']);
    else if (route.auth === 'admin') req.user = requireRole(req, ['admin']);
    else if (route.auth === 'employee') req.empId = verifyEmployeeToken(req, req.params.code);
    const res = (await route.handler(req)) || {};
    return { status: res.status || 200, body: res.body === undefined ? { ok: true } : res.body };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message, ...(e.extra || {}) } };
    if (log) log(`Unhandled error in ${route.name}: ${e && e.stack ? e.stack : e}`);
    return { status: 500, body: { error: 'Something went wrong. Try again.' } };
  }
}

/** Adapter: Azure Functions v4 HttpRequest -> our plain request object. */
function fromAzure(request) {
  return {
    method: request.method,
    params: request.params || {},
    query: Object.fromEntries(request.query ? request.query.entries() : []),
    headers: { get: (n) => request.headers.get(n) },
    ip: String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim().replace(/:\d+$/, '') || 'unknown',
    json: async () => {
      const text = await request.text();
      if (text.length > MAX_BODY) throw new HttpError(413, 'Request too large.');
      if (!text) return {};
      try { return JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON.'); }
    }
  };
}

const SECURITY_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

module.exports = { run, fromAzure, MAX_BODY, SECURITY_HEADERS };
