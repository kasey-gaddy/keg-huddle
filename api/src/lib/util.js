'use strict';
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}
class ConflictError extends Error { constructor(m) { super(m || 'conflict'); this.code = 409; } }
class PreconditionError extends Error { constructor(m) { super(m || 'precondition failed'); this.code = 412; } }

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const TZ = () => process.env.APP_TIMEZONE || 'America/Phoenix';

/** Today's date (YYYY-MM-DD) in the company time zone. */
function todayStr(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function addMonths(d, m) {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCMonth(x.getUTCMonth() + (+m || 0));
  return x.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
}

/** Trim, strip control characters, collapse whitespace, cap length. */
function cleanText(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
const norm = (t) => String(t).trim().toLowerCase().replace(/\s+/g, ' ');

function cleanId(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(s)) return null;
  return s;
}

function num(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));

module.exports = { HttpError, ConflictError, PreconditionError, uid, todayStr, addMonths, daysBetween, cleanText, cleanId, norm, num, clone };
