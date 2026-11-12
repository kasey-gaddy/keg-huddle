'use strict';
/**
 * HCSS Skills connector.
 *
 * Huddle never calls HCSS directly when a session ends. Passed completions
 * for modules that have an HCSS course code are written to an "outbox".
 * This processor drains the outbox. That way:
 *   - a slow or down HCSS never blocks a training session,
 *   - nothing is lost; failed items retry,
 *   - we can turn the connection on later and replay everything queued.
 *
 * HCSS_MODE:
 *   off  (default) items stay queued, nothing is sent
 *   mock           items are marked sent without calling HCSS (for demos/tests)
 *   live           items are sent to the HCSS Skills API
 *
 * Live mode also requires HCSS_MAPPING_VERIFIED=true, which someone sets only
 * after confirming the field mapping in liveClient.js against the HCSS
 * sandbox. This prevents sending wrongly shaped data to production HCSS.
 */
const { getStore } = require('../../lib/store');
const { PK } = require('../../lib/repo');

function config() {
  const mode = ['off', 'mock', 'live'].includes(process.env.HCSS_MODE) ? process.env.HCSS_MODE : 'off';
  return {
    mode,
    verified: process.env.HCSS_MAPPING_VERIFIED === 'true',
    employeeKey: process.env.HCSS_EMPLOYEE_KEY === 'payrollCode' ? 'payrollCode' : 'employeeCode'
  };
}

function client(cfg) {
  if (cfg.mode === 'mock') return require('./mockClient');
  if (cfg.mode === 'live') {
    if (!cfg.verified) throw new Error('HCSS live mode is blocked until HCSS_MAPPING_VERIFIED=true');
    return require('./liveClient');
  }
  return null;
}

async function status() {
  const cfg = config();
  const items = await getStore().list(PK.outbox);
  const count = (s) => items.filter((i) => i.status === s).length;
  return { mode: cfg.mode, verified: cfg.verified, employeeKey: cfg.employeeKey, pending: count('pending'), sent: count('sent'), failed: count('failed') };
}

/** Send up to `max` pending items. Returns a summary. */
async function processOutbox(max = 200) {
  const cfg = config();
  const c = client(cfg);
  if (!c) return { mode: cfg.mode, sent: 0, failed: 0, skipped: true };
  const s = getStore();
  const pending = (await s.list(PK.outbox)).filter((i) => i.status === 'pending' || (i.status === 'failed' && i.attempts < 5)).slice(0, max);
  if (!pending.length) return { mode: cfg.mode, sent: 0, failed: 0 };
  let results;
  try {
    results = await c.importEmployeeSkills(pending, cfg);
  } catch (e) {
    results = pending.map((p) => ({ id: p.id, ok: false, error: String(e.message || e).slice(0, 300) }));
  }
  let sent = 0, failed = 0;
  for (const r of results) {
    const item = pending.find((p) => p.id === r.id);
    if (!item) continue;
    item.attempts++;
    item.status = r.ok ? 'sent' : 'failed';
    item.lastError = r.ok ? null : r.error;
    item.sentAt = r.ok ? new Date().toISOString() : null;
    await s.upsert(item);
    const comp = await s.get(PK.completions, item.completionId);
    if (comp && comp.hcss) { comp.hcss.status = item.status; comp.hcss.lastError = item.lastError; await s.upsert(comp); }
    r.ok ? sent++ : failed++;
  }
  return { mode: cfg.mode, sent, failed };
}

module.exports = { config, status, processOutbox };
