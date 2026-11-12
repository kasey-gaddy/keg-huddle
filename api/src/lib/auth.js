'use strict';
const crypto = require('node:crypto');
const { HttpError } = require('./util');

/**
 * Trainers and admins sign in with KE&G Microsoft accounts through Azure
 * Static Web Apps. SWA forwards the signed-in user to the API in the
 * x-ms-client-principal header. The Function App is a "linked backend",
 * so it only accepts traffic that comes through the Static Web App.
 */
function getPrincipal(req) {
  const raw = req.headers.get('x-ms-client-principal');
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!p || !p.userId) return null;
    p.userRoles = Array.isArray(p.userRoles) ? p.userRoles : [];
    return p;
  } catch { return null; }
}

function requireRole(req, roles) {
  const p = getPrincipal(req);
  if (!p) throw new HttpError(401, 'Please sign in.');
  if (!roles.some((r) => p.userRoles.includes(r))) throw new HttpError(403, 'You do not have access to this.');
  return p;
}

const listFrom = (v) => String(v || '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Role assignment, called by Static Web Apps at sign-in (rolesSource).
 * Admins and trainers are listed in app settings for now. When BDL People
 * is ready, swap this for an Entra ID group check.
 */
function rolesFor(email, claims) {
  const e = String(email || '').toLowerCase();
  const tenant = process.env.ALLOWED_TENANT_ID;
  if (tenant) {
    const tid = (claims || []).find((c) => c.typ === 'http://schemas.microsoft.com/identity/claims/tenantid' || c.typ === 'tid');
    if (!tid || String(tid.val).toLowerCase() !== tenant.toLowerCase()) return [];
  }
  const roles = [];
  if (listFrom(process.env.ADMIN_EMAILS).includes(e)) roles.push('admin', 'trainer');
  else if (listFrom(process.env.TRAINER_EMAILS).includes(e)) roles.push('trainer');
  return roles;
}

/* ---------- employee tokens ---------- */
/* Employees don't have accounts. Joining with a live session code and a
   valid employee ID returns a short-lived token signed with a key that
   lives in Key Vault. The token only works for that one session. */

function signingKey() {
  const k = process.env.TOKEN_SIGNING_KEY;
  if (!k || k.length < 32) throw new Error('TOKEN_SIGNING_KEY must be set (32+ characters)');
  return k;
}
const b64 = (b) => Buffer.from(b).toString('base64url');

function signEmployeeToken(code, empId, hours = 12) {
  const payload = b64(JSON.stringify({ sid: code, emp: empId, exp: Date.now() + hours * 3600e3 }));
  const sig = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyEmployeeToken(req, code) {
  const h = req.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [payload, sig] = tok.split('.');
  if (!payload || !sig) throw new HttpError(401, 'Please join the session again.');
  const want = crypto.createHmac('sha256', signingKey()).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new HttpError(401, 'Please join the session again.');
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new HttpError(401, 'Please join the session again.'); }
  if (data.exp < Date.now() || data.sid !== code) throw new HttpError(401, 'Please join the session again.');
  return data.emp;
}

/* ---------- simple per-instance rate limiter ---------- */
/* Slows down guessing of session codes and employee IDs. In production,
   put Azure Front Door WAF rate limiting in front for a shared limit. */
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return; }
  b.n++;
  if (b.n > max) throw new HttpError(429, 'Too many tries. Wait a minute and try again.');
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}

/* Failed-attempt limiter. Crews on the same jobsite Wi-Fi or cell tower
   often share one public IP, so successful joins are not counted; only
   wrong codes / wrong IDs are. */
function checkFails(key, max) {
  const b = buckets.get('f:' + key);
  if (b && b.reset > Date.now() && b.n >= max) throw new HttpError(429, 'Too many wrong tries. Wait a few minutes and try again.');
}
function noteFail(key, windowMs) {
  const now = Date.now(), k = 'f:' + key, b = buckets.get(k);
  if (!b || b.reset < now) buckets.set(k, { n: 1, reset: now + windowMs }); else b.n++;
}

module.exports = { getPrincipal, requireRole, rolesFor, signEmployeeToken, verifyEmployeeToken, rateLimit, checkFails, noteFail };
