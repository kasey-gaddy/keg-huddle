'use strict';
/**
 * Routes for trainers and admins (KE&G Microsoft sign-in required).
 * Mounted under /api/manage/... because Azure Functions reserves /admin.
 */
const crypto = require('node:crypto');
const { HttpError, ConflictError, PreconditionError, cleanText, cleanId, num, todayStr, uid } = require('../lib/util');
const { getStore } = require('../lib/store');
const repo = require('../lib/repo');
const { PK, strip, tag } = repo;
const live = require('../lib/live');
const hcss = require('../integrations/hcss');
const { DEFAULT_PTS } = require('../lib/defaults');

const S = () => getStore();
const who = (req) => ({ email: String(req.user.userDetails || '').toLowerCase(), name: req.user.userDetails || 'Trainer' });
const listStripped = async (pk) => (await S().list(pk)).map(strip);

/** Generic ETag-safe read-modify-write for small admin documents. */
async function mutateDoc(pk, id, fn) {
  for (let i = 0; i < 5; i++) {
    const doc = await S().get(pk, id);
    if (!doc) throw new HttpError(404, 'Not found.');
    const etag = doc._etag;
    await fn(doc);
    try { const saved = await S().replace(doc, etag); return strip(saved); }
    catch (e) { if (!(e instanceof PreconditionError)) throw e; }
  }
  throw new HttpError(409, 'Someone else changed this at the same time. Try again.');
}

/* ---------- people ---------- */
function parseRows(rows) {
  if (!Array.isArray(rows)) throw new HttpError(400, 'Rows are missing.');
  if (rows.length > 2000) throw new HttpError(400, 'Load 2,000 people or fewer at a time.');
  const out = [];
  for (const r of rows) {
    const id = cleanId(r && r.id), name = cleanText(r && r.name, 80);
    if (id && name) out.push({ id, name, crew: cleanText(r.crew, 60) });
  }
  if (!out.length) throw new HttpError(400, 'No valid rows. Each row needs an employee ID and a name.');
  return out;
}
/** Create profiles only for new IDs. Existing profiles (and their points) are never overwritten. */
async function upsertPeople(rows) {
  let created = 0, existing = 0; const ids = [];
  const known = await repo.people();
  for (const r of rows) {
    if (!known.has(r.id)) {
      try { await S().create(tag(PK.people, 'person', r)); created++; }
      catch (e) { if (e instanceof ConflictError) existing++; else throw e; }
    } else existing++;
    if (!ids.includes(r.id)) ids.push(r.id);
  }
  repo.invalidate('people');
  return { created, existing, ids };
}

/* ---------- sessions ---------- */
async function moderatorState(code) {
  const s = await repo.session(code);
  if (!s) throw new HttpError(404, 'Session not found.');
  const l = live.assemble(s.control, s.events);
  return { live: l, view: live.moderatorView(l, await repo.rules(), await repo.people(), Date.now()) };
}

async function startSession(req) {
  await repo.ensureSeed();
  const me = who(req);
  const open = (await S().list(PK.sessions)).filter((x) => x.status === 'open' && x.owner === me.email);
  if (open.length) return { body: (await moderatorState(open[0].id)).view };
  const b = await req.json();
  const mods = await repo.modules();
  const module = b.moduleId ? mods.get(b.moduleId) : mods.get('m-tail') || null;
  for (let i = 0; i < 20; i++) {
    const code = String(crypto.randomInt(100000, 1000000));
    try {
      await S().create(live.newControl({ code, owner: me.email, ownerName: me.name, module, rosterId: null, now: Date.now() }));
    } catch (e) { if (e instanceof ConflictError) continue; throw e; }
    await S().upsert({ id: code, pk: PK.sessions, type: 'sessionIndex', owner: me.email, status: 'open', created: new Date().toISOString() });
    return { body: (await moderatorState(code)).view };
  }
  throw new HttpError(503, 'Could not create a session code. Try again.');
}

async function sessionState(req) {
  const { view } = await moderatorState(req.params.code);
  if (req.query.v && req.query.v === view.v) return { body: { unchanged: true, v: view.v, serverNow: Date.now() } };
  return { body: view };
}

async function command(req) {
  const { code } = req.params;
  const cmd = await req.json();
  const [modules, rosters, people] = await Promise.all([repo.modules(), repo.rosters(), repo.people()]);
  const { control, events, result } = await repo.mutateControl(code, (ctrl, evs) =>
    live.applyCommand(ctrl, cmd, { live: live.assemble(ctrl, evs), now: Date.now(), modules, rosters, peopleIds: new Set(people.keys()) }));
  // A question added during a session is also saved to its training module.
  if (result && result.added && control.moduleId) {
    await mutateDoc(PK.modules, control.moduleId, (m) => { m.questions.push(result.added); });
    repo.invalidate('modules');
  }
  const l = live.assemble(control, events);
  return { body: live.moderatorView(l, await repo.rules(), people, Date.now()) };
}

async function endSession(req) {
  const { code } = req.params;
  const b = await req.json();
  const [modules, rosters, people, rules] = await Promise.all([repo.modules(), repo.rosters(), repo.people(), repo.rules()]);
  let s = await repo.session(code);
  if (!s) throw new HttpError(404, 'Session not found.');
  if (s.control.finalized) throw new HttpError(409, 'This session was already saved.');
  const module = s.control.moduleId ? modules.get(s.control.moduleId) : null;
  const pre = live.assemble(s.control, s.events);
  const released = pre.ctrl.quiz.questions.filter((q) => pre.ctrl.quiz.opened[q.id] != null).length;
  if (module && +module.pass && !released && !b.force) {
    throw new HttpError(409, `No quiz questions were run, so nobody can pass ${module.name}.`, { needsConfirm: true });
  }
  // 1. Close the session (atomic). Phones can no longer add anything.
  const closed = await repo.mutateControl(code, (ctrl) => { ctrl.status = 'ended'; ctrl.endedAt = Date.now(); ctrl.v++; });
  const l = live.assemble(closed.control, closed.events);
  const roster = l.ctrl.rosterId ? rosters.get(l.ctrl.rosterId) : null;
  const date = todayStr();
  const out = live.finalize({ live: l, module, roster, rules, people, date });
  // 2. Write results. IDs are deterministic, so a retry overwrites, never duplicates.
  for (const d of [...out.ledger, ...out.completions, ...out.outbox, out.history]) await S().upsert(d);
  if (roster && out.rosterAdds.length) {
    await mutateDoc(PK.rosters, roster.id, (r) => { out.rosterAdds.forEach((id) => { if (!r.members.includes(id)) r.members.push(id); }); });
    repo.invalidate('rosters');
  }
  await repo.mutateControl(code, (ctrl) => { ctrl.finalized = true; });
  await S().upsert({ id: code, pk: PK.sessions, type: 'sessionIndex', owner: closed.control.owner, status: 'ended', ended: new Date().toISOString() });
  const passed = out.completions.filter((c) => c.passed).length;
  return { body: { saved: true, date, module: module ? { id: module.id, name: module.name, expires: module.expires } : null, records: out.completions.length, passed, walkInsAdded: out.rosterAdds.length, queuedForHcss: out.outbox.length, roster: roster ? roster.name : null } };
}

/* ---------- bootstrap ---------- */
async function bootstrap(req) {
  await repo.ensureSeed();
  const [people, rosters, modules, completions, ledger, history, pts, h] = await Promise.all([
    listStripped(PK.people), listStripped(PK.rosters), listStripped(PK.modules), listStripped(PK.completions), listStripped(PK.ledger), listStripped(PK.history), repo.rules(), hcss.status()
  ]);
  return { body: { me: { ...who(req), roles: req.user.userRoles }, people, rosters, modules, completions, ledger, history, pts, hcss: h } };
}

/* ---------- settings ---------- */
async function putPoints(req) {
  const b = await req.json(), cur = await repo.rules(), next = {};
  for (const k of Object.keys(DEFAULT_PTS)) next[k] = Math.round(num(b[k], 0, k === 'wordCap' ? 50 : 1000, cur[k]));
  await S().upsert({ id: 'points', pk: PK.settings, type: 'settings', ...next });
  repo.invalidate('rules');
  return { body: next };
}

/* ---------- people & rosters ---------- */
async function addPerson(req) {
  const [r] = parseRows([await req.json()]);
  if ((await repo.people()).has(r.id)) throw new HttpError(409, 'That ID already has a profile.');
  await upsertPeople([r]);
  return { body: r };
}
async function importPeople(req) { return { body: await upsertPeople(parseRows((await req.json()).rows)) }; }

async function createRoster(req) {
  const b = await req.json();
  const name = cleanText(b.name, 80);
  if (!name) throw new HttpError(400, 'Give the roster a name.');
  let ids, created = 0, existing = 0;
  if (b.fromSession) {
    const s = await repo.session(String(b.fromSession));
    if (!s) throw new HttpError(404, 'Session not found.');
    ids = live.assemble(s.control, s.events).participants.map((p) => p.id);
    existing = ids.length;
  } else ({ ids, created, existing } = await upsertPeople(parseRows(b.rows)));
  if (!ids.length) throw new HttpError(400, 'Nobody to add.');
  const r = { id: 'r_' + uid(), name, created: todayStr(), members: ids };
  await S().create(tag(PK.rosters, 'roster', r));
  repo.invalidate('rosters');
  return { status: 201, body: { roster: r, created, existing } };
}
async function patchRoster(req) {
  const b = await req.json();
  let summary = { created: 0, existing: 0, added: 0 };
  let rows = null;
  if (b.addRows) { rows = parseRows(b.addRows); const u = await upsertPeople(rows); summary.created = u.created; summary.existing = u.existing; rows = u.ids; }
  const rm = b.removeMember ? cleanId(b.removeMember) : null;
  const r = await mutateDoc(PK.rosters, req.params.id, (doc) => {
    if (b.name !== undefined) doc.name = cleanText(b.name, 80) || doc.name;
    if (rows) rows.forEach((id) => { if (!doc.members.includes(id)) { doc.members.push(id); summary.added++; } });
    if (rm) doc.members = doc.members.filter((x) => x !== rm);
  });
  repo.invalidate('rosters');
  return { body: { roster: r, ...summary } };
}
async function clearRosterPoints(req) {
  const id = req.params.id;
  if (!(await repo.rosters()).has(id)) throw new HttpError(404, 'Roster not found.');
  let n = 0;
  for (const l of await S().list(PK.ledger)) if (l.rosterId === id && !l.cleared) { l.cleared = true; l.clearedAt = todayStr(); await S().upsert(l); n++; }
  await mutateDoc(PK.rosters, id, (r) => { r.clearedAt = todayStr(); });
  repo.invalidate('rosters');
  return { body: { cleared: n } };
}
async function deleteRoster(req) {
  await S().remove(PK.rosters, req.params.id);
  repo.invalidate('rosters');
  return {};
}

/* ---------- training modules ---------- */
const EXPIRES = [0, 6, 12, 24, 36, 60];
async function createModule(req) {
  const b = await req.json();
  const m = { id: 'm_' + uid(), code: '', name: cleanText(b.name, 80) || 'New training', desc: '', expires: 12, pass: 70, hcssCourseCode: '', questions: [] };
  await S().create(tag(PK.modules, 'module', m));
  repo.invalidate('modules');
  return { status: 201, body: m };
}
async function putModule(req) {
  const b = await req.json();
  const m = await mutateDoc(PK.modules, req.params.id, (doc) => {
    if (b.name !== undefined) doc.name = cleanText(b.name, 80) || doc.name;
    if (b.desc !== undefined) doc.desc = cleanText(b.desc, 400);
    if (b.code !== undefined) doc.code = cleanText(b.code, 12).toUpperCase();
    if (b.expires !== undefined) { const e = Math.round(+b.expires); if (!EXPIRES.includes(e)) throw new HttpError(400, 'Pick an expiration from the list.'); doc.expires = e; }
    if (b.pass !== undefined) doc.pass = Math.round(num(b.pass, 0, 100, doc.pass));
    if (b.hcssCourseCode !== undefined) doc.hcssCourseCode = cleanText(b.hcssCourseCode, 60);
  });
  repo.invalidate('modules');
  return { body: m };
}
async function addModuleQuestion(req) {
  const q = live.validQuestion(await req.json());
  const m = await mutateDoc(PK.modules, req.params.id, (doc) => { doc.questions.push(q); });
  repo.invalidate('modules');
  return { status: 201, body: m };
}
async function deleteModuleQuestion(req) {
  const m = await mutateDoc(PK.modules, req.params.id, (doc) => { doc.questions = doc.questions.filter((q) => q.id !== req.params.qid); });
  repo.invalidate('modules');
  return { body: m };
}
async function deleteModule(req) {
  await S().remove(PK.modules, req.params.id);
  repo.invalidate('modules');
  return {};
}

/* ---------- HCSS ---------- */
async function hcssStatus() { return { body: await hcss.status() }; }
async function hcssSync() { return { body: await hcss.processOutbox() }; }

async function meRoute(req) { return { body: { ...who(req), roles: req.user.userRoles } }; }

module.exports = [
  { name: 'manageMe', methods: ['GET'], route: 'manage/me', auth: 'trainer', handler: meRoute },
  { name: 'manageBootstrap', methods: ['GET'], route: 'manage/bootstrap', auth: 'trainer', handler: bootstrap },
  { name: 'manageStartSession', methods: ['POST'], route: 'manage/sessions', auth: 'trainer', handler: startSession },
  { name: 'manageSessionState', methods: ['GET'], route: 'manage/sessions/{code}/state', auth: 'trainer', handler: sessionState },
  { name: 'manageSessionCommand', methods: ['POST'], route: 'manage/sessions/{code}/command', auth: 'trainer', handler: command },
  { name: 'manageSessionEnd', methods: ['POST'], route: 'manage/sessions/{code}/end', auth: 'trainer', handler: endSession },
  { name: 'managePoints', methods: ['PUT'], route: 'manage/settings/points', auth: 'admin', handler: putPoints },
  { name: 'managePeopleAdd', methods: ['POST'], route: 'manage/people', auth: 'trainer', handler: addPerson },
  { name: 'managePeopleImport', methods: ['POST'], route: 'manage/people/import', auth: 'trainer', handler: importPeople },
  { name: 'manageRosterCreate', methods: ['POST'], route: 'manage/rosters', auth: 'trainer', handler: createRoster },
  { name: 'manageRosterPatch', methods: ['PATCH'], route: 'manage/rosters/{id}', auth: 'trainer', handler: patchRoster },
  { name: 'manageRosterClear', methods: ['POST'], route: 'manage/rosters/{id}/clear-points', auth: 'trainer', handler: clearRosterPoints },
  { name: 'manageRosterDelete', methods: ['DELETE'], route: 'manage/rosters/{id}', auth: 'admin', handler: deleteRoster },
  { name: 'manageModuleCreate', methods: ['POST'], route: 'manage/modules', auth: 'admin', handler: createModule },
  { name: 'manageModulePut', methods: ['PUT'], route: 'manage/modules/{id}', auth: 'admin', handler: putModule },
  { name: 'manageModuleQAdd', methods: ['POST'], route: 'manage/modules/{id}/questions', auth: 'admin', handler: addModuleQuestion },
  { name: 'manageModuleQDel', methods: ['DELETE'], route: 'manage/modules/{id}/questions/{qid}', auth: 'admin', handler: deleteModuleQuestion },
  { name: 'manageModuleDelete', methods: ['DELETE'], route: 'manage/modules/{id}', auth: 'admin', handler: deleteModule },
  { name: 'manageHcssStatus', methods: ['GET'], route: 'manage/hcss/status', auth: 'trainer', handler: hcssStatus },
  { name: 'manageHcssSync', methods: ['POST'], route: 'manage/hcss/sync', auth: 'admin', handler: hcssSync }
];
