'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const live = require('../src/lib/live');
const { mkCompletion, cStatus } = require('../src/lib/training');
const { seedModules, DEFAULT_PTS } = require('../src/lib/defaults');

const mod = seedModules().find((m) => m.id === 'm-dd'); // pass 80, expires 12
const people = new Map([['1', { id: '1', name: 'Ana Ortega', crew: 'JOC' }], ['2', { id: '2', name: 'Luis Moreno', crew: 'Utility' }]]);
const ev = (o) => ({ type: 'event', ...o });

function session() {
  const c = live.newControl({ code: '123456', owner: 't@kegtus.com', module: mod, now: 1000 });
  return c;
}

test('answers from an old quiz round are ignored after switching trainings', () => {
  const c = session();
  const q = c.quiz.questions[0];
  const events = [ev({ id: 'ci_1', kind: 'checkin', empId: '1', t: 1 }), ev({ id: 'a', kind: 'answer', empId: '1', qid: q.id, round: 1, choice: q.correct, t: 2 })];
  assert.equal(live.assemble(c, events).answers[q.id]['1'], q.correct);
  live.applyCommand(c, { type: 'setModule', moduleId: mod.id }, { live: live.assemble(c, events), now: 5, modules: new Map([[mod.id, mod]]), rosters: new Map(), peopleIds: new Set() });
  assert.equal(live.assemble(c, events).answers[q.id], undefined);
});

test('phone never sees the correct answer while a question is open', () => {
  const c = session();
  const ctx = (evs) => ({ live: live.assemble(c, evs), now: 10_000, modules: new Map(), rosters: new Map(), peopleIds: new Set(people.keys()) });
  const evs = [ev({ id: 'ci_1', kind: 'checkin', empId: '1', t: 1 })];
  live.applyCommand(c, { type: 'selectQuestion', qid: c.quiz.questions[0].id }, ctx(evs));
  live.applyCommand(c, { type: 'release' }, ctx(evs));
  evs.push(ev({ id: 'an', kind: 'answer', empId: '1', qid: c.quiz.questions[0].id, round: 1, choice: 0, t: 11_000 }));
  const open = live.phoneView(live.assemble(c, evs), '1', DEFAULT_PTS, people, 0);
  assert.equal(open.quiz.correct, undefined);
  assert.equal(open.score, null, 'score must not reveal the open question');
  live.applyCommand(c, { type: 'reveal' }, ctx(evs));
  const rev = live.phoneView(live.assemble(c, evs), '1', DEFAULT_PTS, people, 0);
  assert.equal(rev.quiz.correct, c.quiz.questions[0].correct);
});

test('speed bonus and points', () => {
  const c = session();
  const q = c.quiz.questions[0];
  c.quiz.opened[q.id] = 0;
  const evs = [
    ev({ id: 'ci_1', kind: 'checkin', empId: '1', t: 0 }), ev({ id: 'ci_2', kind: 'checkin', empId: '2', t: 0 }),
    ev({ id: 'a1', kind: 'answer', empId: '1', qid: q.id, round: 1, choice: q.correct, t: 0 }),
    ev({ id: 'a2', kind: 'answer', empId: '2', qid: q.id, round: 1, choice: (q.correct + 1) % 4, t: 1000 })
  ];
  const sb = live.scoreboard(live.assemble(c, evs), DEFAULT_PTS, people);
  assert.equal(sb[0].id, '1');
  assert.equal(sb[0].total, 10 + 10 + 100 + 50);
  assert.equal(sb[1].total, 10 + 10);
});

test('anonymous questions hide the asker from the moderator but still earn points', () => {
  const c = session();
  const evs = [ev({ id: 'ci_1', kind: 'checkin', empId: '1', t: 0 }), ev({ id: 'q_x', kind: 'ask', empId: '1', anon: true, text: 'Who is the competent person?', t: 1 })];
  const l = live.assemble(c, evs);
  const view = live.moderatorView(l, DEFAULT_PTS, people, 0);
  assert.equal(view.qa[0].empId, null);
  assert.equal(view.scoreboard[0].asks, 10);
  assert.ok(!JSON.stringify(view.qa).includes('"1"'));
});

test('wheel spin picks from the checked-in pool and removes winners', () => {
  const c = session();
  const evs = [ev({ id: 'ci_1', kind: 'checkin', empId: '1', t: 0 }), ev({ id: 'ci_2', kind: 'checkin', empId: '2', t: 0 })];
  const ctx = () => ({ live: live.assemble(c, evs), now: 1, modules: new Map(), rosters: new Map(), peopleIds: new Set(people.keys()) });
  live.applyCommand(c, { type: 'spin' }, ctx());
  live.applyCommand(c, { type: 'spin' }, ctx());
  assert.deepEqual([...c.wheel.winners].sort(), ['1', '2']);
  assert.throws(() => live.applyCommand(c, { type: 'spin' }, ctx()), /No names/);
});

test('bad commands are rejected', () => {
  const c = session();
  const ctx = { live: live.assemble(c, []), now: 1, modules: new Map(), rosters: new Map(), peopleIds: new Set() };
  assert.throws(() => live.applyCommand(c, { type: 'nope' }, ctx), /Unknown command/);
  assert.throws(() => live.applyCommand(c, { type: 'bonus', empId: 'x', delta: 10 }, ctx), /Unknown employee/);
  assert.throws(() => live.applyCommand(c, { type: 'bonus', empId: '1', delta: 500 }, { ...ctx, peopleIds: new Set(['1']) }), /between/);
  assert.throws(() => live.applyCommand(c, { type: 'addQuestion', question: { text: 'x', options: ['a'], correct: 0 } }, ctx), /2 to 4/);
});

test('finalize: completions, expiration, deterministic ids, outbox only with HCSS code', () => {
  const m = { ...mod, hcssCourseCode: 'DD-01' };
  const c = live.newControl({ code: '654321', owner: 't', module: m, now: 0 });
  c.quiz.opened[c.quiz.questions[0].id] = 0;
  const q = c.quiz.questions[0];
  const evs = [
    ev({ id: 'ci_1', kind: 'checkin', empId: '1', t: 0 }), ev({ id: 'ci_2', kind: 'checkin', empId: '2', t: 0 }),
    ev({ id: 'a1', kind: 'answer', empId: '1', qid: q.id, round: 1, choice: q.correct, t: 1 }),
    ev({ id: 'a2', kind: 'answer', empId: '2', qid: q.id, round: 1, choice: (q.correct + 1) % 4, t: 1 })
  ];
  const roster = { id: 'r1', name: 'Fleet', members: ['1'] };
  const out = live.finalize({ live: live.assemble(c, evs), module: m, roster, rules: DEFAULT_PTS, people, date: '2026-11-12' });
  const c1 = out.completions.find((x) => x.empId === '1'), c2 = out.completions.find((x) => x.empId === '2');
  assert.equal(c1.id, 'c_654321_1');
  assert.equal(c1.passed, true); assert.equal(c1.expires, '2027-11-12');
  assert.equal(c2.passed, false); assert.equal(c2.expires, null);
  assert.equal(out.outbox.length, 1); assert.equal(out.outbox[0].courseCode, 'DD-01');
  assert.deepEqual(out.rosterAdds, ['2']);
  assert.equal(out.history.id, 'h_654321');
});

test('completion status', () => {
  const c = mkCompletion({ id: 'm', name: 'M', pass: 0, expires: 12 }, '1', null, 'x', '2025-11-20', null);
  assert.equal(cStatus(c, '2026-11-12').k, 'soon');
  assert.equal(cStatus(c, '2026-12-01').k, 'expired');
  assert.equal(cStatus(c, '2026-01-01').k, 'ok');
});
