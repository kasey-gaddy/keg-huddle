'use strict';
/** Routes used by employee phones. No accounts: session code + employee ID. */
const { HttpError, cleanText, cleanId } = require('../lib/util');
const { signEmployeeToken, rateLimit, checkFails, noteFail } = require('../lib/auth');
const repo = require('../lib/repo');
const { assemble, phoneView } = require('../lib/live');

async function liveFor(code) {
  const s = await repo.session(code);
  if (!s) throw new HttpError(404, 'That session is not running.');
  return assemble(s.control, s.events);
}

async function join(req) {
  rateLimit('join:' + req.ip, 600, 5 * 60e3); // generous: a whole crew may share one IP
  checkFails(req.ip, 25);
  try { return await joinInner(req); } catch (e) { if (e instanceof HttpError && (e.status === 404 || e.status === 400)) noteFail(req.ip, 10 * 60e3); throw e; }
}
async function joinInner(req) {
  await repo.ensureSeed();
  const b = await req.json();
  const code = String(b.code || '').trim();
  const id = cleanId(b.employeeId);
  if (!/^\d{6}$/.test(code) || !id) throw new HttpError(400, 'Enter the 6-digit session code and your employee ID.');
  const s = await repo.session(code);
  if (!s || s.control.status !== 'open') throw new HttpError(404, 'That session is not running. Check the code on the screen.');
  const p = (await repo.people()).get(id);
  if (!p) throw new HttpError(404, 'ID not found. Check with your trainer.');
  await repo.addEvent(code, { id: 'ci_' + id, kind: 'checkin', empId: id, t: Date.now() });
  return { body: { token: signEmployeeToken(code, id), code, employee: { id, firstName: p.name.split(' ')[0] } } };
}

async function me(req) {
  const { code } = req.params;
  const live = await liveFor(code);
  if (req.query.v && req.query.v === live.v) return { body: { unchanged: true, v: live.v, serverNow: Date.now() } };
  return { body: phoneView(live, req.empId, await repo.rules(), await repo.people(), Date.now()) };
}

function checkedIn(live, empId) {
  if (!live.participants.some((p) => p.id === empId)) throw new HttpError(403, 'Please join the session again.');
  if (live.ctrl.status !== 'open') throw new HttpError(409, 'This session has ended.');
}

async function answer(req) {
  const { code } = req.params;
  rateLimit(`act:${code}:${req.empId}`, 60, 60e3);
  const b = await req.json();
  const live = await liveFor(code);
  checkedIn(live, req.empId);
  const Q = live.ctrl.quiz;
  const q = Q.questions.find((x) => x.id === b.qid);
  if (!q || Q.current !== q.id || Q.state !== 'open') throw new HttpError(409, 'That question is closed.');
  const choice = Number(b.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) throw new HttpError(400, 'Pick one of the answers.');
  // One answer per person per question: the ID makes a second answer a no-op.
  await repo.addEvent(code, { id: `an_${Q.round}_${q.id}_${req.empId}`, kind: 'answer', empId: req.empId, qid: q.id, round: Q.round, choice, t: Date.now() });
  return {};
}

async function word(req) {
  const { code } = req.params;
  rateLimit(`act:${code}:${req.empId}`, 60, 60e3);
  const b = await req.json();
  const live = await liveFor(code);
  checkedIn(live, req.empId);
  if (!live.ctrl.words.open) throw new HttpError(409, 'The word cloud is closed.');
  const text = cleanText(b.text, 30);
  if (!text) throw new HttpError(400, 'Type a word first.');
  if (live.words.filter((w) => w.empId === req.empId).length >= 10) throw new HttpError(429, 'That is the limit for this word cloud.');
  await repo.addEvent(code, { id: 'w_' + require('../lib/util').uid(), kind: 'word', empId: req.empId, text, round: live.ctrl.words.round, t: Date.now() });
  return {};
}

async function ask(req) {
  const { code } = req.params;
  rateLimit(`act:${code}:${req.empId}`, 60, 60e3);
  const b = await req.json();
  const live = await liveFor(code);
  checkedIn(live, req.empId);
  const text = cleanText(b.text, 240);
  if (!text) throw new HttpError(400, 'Type your question first.');
  if (live.qa.filter((q) => q.empId === req.empId).length >= 10) throw new HttpError(429, 'That is the limit for this session.');
  // The asker's ID is stored so they get points and can see their own
  // questions. It is never returned to the moderator or other phones when
  // the question is anonymous.
  await repo.addEvent(code, { id: 'q_' + require('../lib/util').uid(), kind: 'ask', empId: req.empId, anon: !!b.anonymous, text, t: Date.now() });
  return {};
}

module.exports = [
  { name: 'join', methods: ['POST'], route: 'join', auth: 'public', handler: join },
  { name: 'liveMe', methods: ['GET'], route: 'live/{code}/me', auth: 'employee', handler: me },
  { name: 'liveAnswer', methods: ['POST'], route: 'live/{code}/answer', auth: 'employee', handler: answer },
  { name: 'liveWord', methods: ['POST'], route: 'live/{code}/word', auth: 'employee', handler: word },
  { name: 'liveAsk', methods: ['POST'], route: 'live/{code}/ask', auth: 'employee', handler: ask }
];
