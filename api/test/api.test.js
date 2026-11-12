'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.STORE = 'memory';
process.env.SEED_DEMO = 'true';
process.env.TOKEN_SIGNING_KEY = 'test-key-test-key-test-key-test-key-123';
process.env.HCSS_MODE = 'mock';

const routes = require('../src/handlers');
const { run } = require('../src/lib/http');
const { rolesFor } = require('../src/lib/auth');

const principal = (roles) => Buffer.from(JSON.stringify({ userId: 'u1', userDetails: 'trainer@kegtus.com', identityProvider: 'aad', userRoles: ['authenticated', ...roles] })).toString('base64');

function call(name, { params = {}, query = {}, body, headers = {}, ip = '1.2.3.4' } = {}) {
  const route = routes.find((r) => r.name === name);
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return run(route, { method: route.methods[0], params, query, ip, headers: { get: (n) => h[n.toLowerCase()] ?? null }, json: async () => body || {} });
}
const trainer = { 'x-ms-client-principal': principal(['trainer']) };
const admin = { 'x-ms-client-principal': principal(['admin', 'trainer']) };

test('manage routes require sign-in and the right role', async () => {
  assert.equal((await call('manageBootstrap')).status, 401);
  assert.equal((await call('manageBootstrap', { headers: { 'x-ms-client-principal': principal([]) } })).status, 403);
  assert.equal((await call('manageBootstrap', { headers: trainer })).status, 200);
  assert.equal((await call('manageModuleCreate', { headers: trainer, body: { name: 'x' } })).status, 403, 'trainers cannot create modules');
  assert.equal((await call('managePoints', { headers: trainer, body: {} })).status, 403);
});

test('full session: join, answer once, end, completions, HCSS mock sync', async () => {
  const start = await call('manageStartSession', { headers: trainer, body: {} });
  assert.equal(start.status, 200);
  const code = start.body.code;
  assert.match(code, /^\d{6}$/);

  // Switch to Defensive Driving and give it an HCSS course code
  await call('manageModulePut', { headers: admin, params: { id: 'm-dd' }, body: { hcssCourseCode: 'DD-01' } });
  let r = await call('manageSessionCommand', { headers: trainer, params: { code }, body: { type: 'setModule', moduleId: 'm-dd' } });
  assert.equal(r.status, 200);

  // Unknown employee and bad code are rejected
  assert.equal((await call('join', { body: { code, employeeId: '99999' } })).status, 404);
  assert.equal((await call('join', { body: { code: '000000', employeeId: '10001' } })).status, 404);

  const j1 = await call('join', { body: { code, employeeId: '10001' } });
  const j2 = await call('join', { body: { code, employeeId: '10002' } });
  assert.equal(j1.status, 200);
  const auth1 = { authorization: 'Bearer ' + j1.body.token }, auth2 = { authorization: 'Bearer ' + j2.body.token };

  // Token for one session does not work on another, and tampering fails
  assert.equal((await call('liveMe', { params: { code: '111111' }, headers: auth1 })).status, 401);
  assert.equal((await call('liveMe', { params: { code }, headers: { authorization: auth1.authorization.slice(0, -2) + 'xx' } })).status, 401);

  const qid = r.body.quiz.questions[0].id, correct = r.body.quiz.questions[0].correct;
  // Answering before release fails
  assert.equal((await call('liveAnswer', { params: { code }, headers: auth1, body: { qid, choice: correct } })).status, 409);
  await call('manageSessionCommand', { headers: trainer, params: { code }, body: { type: 'selectQuestion', qid } });
  await call('manageSessionCommand', { headers: trainer, params: { code }, body: { type: 'release' } });
  assert.equal((await call('liveAnswer', { params: { code }, headers: auth1, body: { qid, choice: correct } })).status, 200);
  // A second answer is ignored, not counted twice
  await call('liveAnswer', { params: { code }, headers: auth1, body: { qid, choice: (correct + 1) % 4 } });
  assert.equal((await call('liveAnswer', { params: { code }, headers: auth2, body: { qid, choice: (correct + 1) % 4 } })).status, 200);

  await new Promise((res) => setTimeout(res, 1100)); // let the 1s cache expire
  const st = await call('manageSessionState', { headers: trainer, params: { code } });
  assert.deepEqual(st.body.quiz.answers[qid], { 10001: correct, 10002: (correct + 1) % 4 });

  // Ask anonymously; moderator sees no ID
  await call('liveAsk', { params: { code }, headers: auth2, body: { text: 'Do we need a spotter?', anonymous: true } });
  await new Promise((res) => setTimeout(res, 1100));
  const st2 = await call('manageSessionState', { headers: trainer, params: { code } });
  assert.equal(st2.body.qa[0].empId, null);

  const end = await call('manageSessionEnd', { headers: trainer, params: { code }, body: {} });
  assert.equal(end.status, 200, JSON.stringify(end.body));
  assert.equal(end.body.records, 2);
  assert.equal(end.body.passed, 1);
  assert.equal(end.body.queuedForHcss, 1);
  // Saving twice is refused
  assert.equal((await call('manageSessionEnd', { headers: trainer, params: { code }, body: {} })).status, 409);
  // Phones can no longer answer
  assert.equal((await call('liveWord', { params: { code }, headers: auth1, body: { text: 'heat' } })).status, 409);

  const sync = await call('manageHcssSync', { headers: admin });
  assert.equal(sync.body.sent, 1);
  const boot = await call('manageBootstrap', { headers: trainer });
  const comp = boot.body.completions.find((c) => c.empId === '10001');
  assert.equal(comp.hcss.status, 'sent');
  assert.equal(boot.body.ledger.filter((l) => l.sessionCode === code).length, 2);
});

test('roster import never overwrites an existing profile', async () => {
  const r = await call('manageRosterCreate', { headers: trainer, body: { name: 'Test Crew', rows: [{ id: '10001', name: 'Someone Else', crew: 'X' }, { id: '20001', name: 'New Person', crew: 'Mining' }] } });
  assert.equal(r.status, 201);
  assert.equal(r.body.created, 1); assert.equal(r.body.existing, 1);
  const boot = await call('manageBootstrap', { headers: trainer });
  assert.notEqual(boot.body.people.find((p) => p.id === '10001').name, 'Someone Else');
});

test('roles: tenant lock and email lists', () => {
  process.env.ADMIN_EMAILS = 'boss@kegtus.com'; process.env.TRAINER_EMAILS = 'safety@kegtus.com';
  process.env.ALLOWED_TENANT_ID = 'abc';
  const claims = [{ typ: 'http://schemas.microsoft.com/identity/claims/tenantid', val: 'abc' }];
  assert.deepEqual(rolesFor('Boss@kegtus.com', claims), ['admin', 'trainer']);
  assert.deepEqual(rolesFor('safety@kegtus.com', claims), ['trainer']);
  assert.deepEqual(rolesFor('boss@kegtus.com', [{ typ: 'tid', val: 'other' }]), []);
  assert.deepEqual(rolesFor('random@kegtus.com', claims), []);
});

test('a whole crew on one IP can join, but repeated wrong IDs are slowed down', async () => {
  const start = await call('manageStartSession', { headers: { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userId: 'u2', userDetails: 'other@kegtus.com', userRoles: ['authenticated', 'trainer'] })).toString('base64') }, body: {} });
  const code = start.body.code;
  for (let i = 0; i < 50; i++) assert.equal((await call('join', { ip: '9.9.9.9', body: { code, employeeId: String(10001 + i) } })).status, 200);
  let last;
  for (let i = 0; i < 30; i++) last = await call('join', { ip: '8.8.8.8', body: { code, employeeId: 'X' + i } });
  assert.equal(last.status, 429);
});
