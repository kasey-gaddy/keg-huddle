'use strict';
const { getStore } = require('./store');
const { ConflictError, PreconditionError, HttpError } = require('./util');
const { DEFAULT_PTS, seedModules, demoPeople, demoRosters } = require('./defaults');
const { pkFor } = require('./live');

const PK = { people: 'people', rosters: 'rosters', modules: 'modules', completions: 'completions', ledger: 'ledger', history: 'history', outbox: 'outbox', settings: 'settings', sessions: 'sessions' };

const strip = (d) => { if (!d) return d; const { pk, type, _etag, ...rest } = d; return rest; }; // eslint-disable-line no-unused-vars
const tag = (pk, type, d) => ({ ...d, pk, type });

/* ---------- first-run seed ---------- */
let seeded = false;
async function ensureSeed() {
  if (seeded) return;
  const s = getStore();
  const mods = await s.list(PK.modules);
  if (!mods.length) for (const m of seedModules()) await createIgnore(tag(PK.modules, 'module', m));
  if (!(await s.get(PK.settings, 'points'))) await createIgnore({ id: 'points', pk: PK.settings, type: 'settings', ...DEFAULT_PTS });
  if (process.env.SEED_DEMO === 'true' && !(await s.list(PK.people)).length) {
    const people = demoPeople();
    for (const p of people) await createIgnore(tag(PK.people, 'person', p));
    for (const r of demoRosters(people)) await createIgnore(tag(PK.rosters, 'roster', r));
  }
  seeded = true;
}
async function createIgnore(doc) { try { await getStore().create(doc); } catch (e) { if (!(e instanceof ConflictError)) throw e; } }

/* ---------- short-lived caches for the hot polling path ---------- */
const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, until: Date.now() + ttl });
  return value;
}
function invalidate(...keys) { keys.forEach((k) => cache.delete(k)); }

const asMap = (arr) => new Map(arr.map((d) => [d.id, strip(d)]));
const people = () => cached('people', 30000, async () => asMap(await getStore().list(PK.people)));
const rosters = () => cached('rosters', 30000, async () => asMap(await getStore().list(PK.rosters)));
const modules = () => cached('modules', 30000, async () => asMap(await getStore().list(PK.modules)));
const rules = () => cached('rules', 30000, async () => ({ ...DEFAULT_PTS, ...strip(await getStore().get(PK.settings, 'points') || {}) }));

/** Session control + events, cached ~1s per instance. */
function session(code) {
  return cached('s:' + code, 1000, async () => {
    const all = await getStore().list(pkFor(code));
    const control = all.find((d) => d.id === 'control');
    if (!control) return null;
    return { control, events: all.filter((d) => d.type === 'event') };
  });
}

/** Read-modify-write the control doc with ETag retries. */
async function mutateControl(code, fn) {
  const s = getStore();
  for (let i = 0; i < 5; i++) {
    const all = await s.list(pkFor(code));
    const control = all.find((d) => d.id === 'control');
    if (!control) throw new HttpError(404, 'Session not found.');
    const events = all.filter((d) => d.type === 'event');
    const etag = control._etag;
    const result = await fn(control, events);
    try {
      const saved = await s.replace(control, etag);
      invalidate('s:' + code);
      return { control: saved, events, result };
    } catch (e) {
      if (!(e instanceof PreconditionError)) throw e;
    }
  }
  throw new HttpError(409, 'Someone else changed this at the same time. Try again.');
}

async function addEvent(code, ev) {
  try { await getStore().create({ ...ev, pk: pkFor(code), type: 'event' }); }
  catch (e) { if (e instanceof ConflictError) return false; throw e; }
  invalidate('s:' + code);
  return true;
}

module.exports = { PK, strip, tag, ensureSeed, people, rosters, modules, rules, session, mutateControl, addEvent, invalidate };
