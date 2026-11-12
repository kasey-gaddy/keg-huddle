'use strict';
/**
 * Live session engine.
 *
 * A session is one "control" document (moderator-owned, written with ETag
 * concurrency) plus many small append-only "event" documents written by
 * phones (check-ins, answers, words, questions). Phones never write to the
 * control document, so 50 people answering at once never collide.
 *
 * Everything in this file is pure: no I/O. That keeps it easy to test.
 */
const crypto = require('node:crypto');
const { HttpError, uid, cleanText, norm, clone } = require('./util');
const { mkCompletion } = require('./training');

const TABS = ['join', 'quiz', 'words', 'wheel', 'qa', 'timer', 'board', 'reports', 'trainings', 'rosters'];
const DEFAULT_PROMPT = "In one word, what's the biggest hazard on your job site this week?";
const pkFor = (code) => 'session:' + code;

function newControl({ code, owner, ownerName, module, rosterId, now }) {
  return {
    id: 'control', pk: pkFor(code), type: 'session',
    code, owner, ownerName: ownerName || owner, status: 'open', created: now,
    title: module ? module.name : 'Safety Huddle',
    activeTab: 'join',
    moduleId: module ? module.id : null,
    rosterId: rosterId || null,
    quiz: { questions: module ? clone(module.questions) : [], current: null, state: 'idle', opened: {}, round: 1 },
    words: { prompt: DEFAULT_PROMPT, open: true, hidden: [], round: 1 },
    wheel: { pool: 'checked', remove: true, winners: [], last: null, spin: null },
    qaStatus: {}, qaSpot: null,
    timer: { dur: 300, rem: 300, endsAt: null },
    bonus: {},
    v: 1
  };
}

/** Fold event documents into the shape the UI works with. */
function assemble(ctrl, events) {
  const participants = [], answers = {}, times = {}, words = [], qa = [];
  const sorted = events.slice().sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  for (const e of sorted) {
    if (e.kind === 'checkin') participants.push({ id: e.empId, t: e.t });
    else if (e.kind === 'answer' && e.round === ctrl.quiz.round) {
      (answers[e.qid] = answers[e.qid] || {})[e.empId] = e.choice;
      (times[e.qid] = times[e.qid] || {})[e.empId] = e.t;
    } else if (e.kind === 'word' && e.round === ctrl.words.round) words.push({ empId: e.empId, text: e.text, t: e.t });
    else if (e.kind === 'ask') qa.push({ id: e.id, empId: e.empId, anon: !!e.anon, text: e.text, t: e.t, status: ctrl.qaStatus[e.id] || 'open' });
  }
  return { ctrl, participants, answers, times, words, qa, v: `${ctrl.v}.${events.length}` };
}

const n0 = (v) => Math.max(0, +v || 0);

function qPoints(live, q, empId, rules) {
  const a = (live.answers[q.id] || {})[empId];
  if (a == null) return 0;
  let p = n0(rules.answer);
  if (a === q.correct) {
    p += n0(rules.correct);
    const op = live.ctrl.quiz.opened[q.id], t = (live.times[q.id] || {})[empId];
    if (op != null && t != null) p += Math.round(n0(rules.speed) * Math.max(0, 1 - (t - op) / 20000));
  }
  return p;
}

function scoreboard(live, rules, people) {
  const m = {};
  const row = (id) => (m[id] = m[id] || { id, total: 0, checkin: 0, quiz: 0, correct: 0, answered: 0, words: 0, asks: 0, bonus: 0 });
  const add = (id, k, v) => { const r = row(id); r[k] += v; r.total += v; };
  live.participants.forEach((p) => add(p.id, 'checkin', n0(rules.checkin)));
  live.ctrl.quiz.questions.forEach((q) => {
    const A = live.answers[q.id] || {};
    Object.keys(A).forEach((id) => { add(id, 'quiz', qPoints(live, q, id, rules)); const r = row(id); r.answered++; if (A[id] === q.correct) r.correct++; });
  });
  const wc = {};
  live.words.forEach((w) => { wc[w.empId] = (wc[w.empId] || 0) + 1; });
  Object.keys(wc).forEach((id) => add(id, 'words', Math.min(wc[id], n0(rules.wordCap)) * n0(rules.word)));
  live.qa.forEach((q) => { if (q.status !== 'hidden') add(q.empId, 'asks', n0(rules.ask)); });
  Object.keys(live.ctrl.bonus).forEach((id) => add(id, 'bonus', +live.ctrl.bonus[id] || 0));
  const arr = Object.values(m).filter((r) => people.has(r.id));
  arr.forEach((r) => { const p = people.get(r.id); r.name = p.name; r.crew = p.crew || ''; });
  arr.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  arr.forEach((r, i) => { r.rank = i && arr[i - 1].total === r.total ? arr[i - 1].rank : i + 1; });
  return arr;
}

function moderatorView(live, rules, people, now) {
  const c = live.ctrl;
  return {
    v: live.v, serverNow: now, code: c.code, title: c.title, status: c.status, activeTab: c.activeTab,
    session: { moduleId: c.moduleId, rosterId: c.rosterId },
    participants: live.participants,
    quiz: { questions: c.quiz.questions, current: c.quiz.current, state: c.quiz.state, answers: live.answers, opened: c.quiz.opened, times: live.times },
    bonus: c.bonus,
    words: { prompt: c.words.prompt, open: c.words.open, items: live.words, hidden: c.words.hidden },
    wheel: c.wheel,
    // Anonymous questions never carry the asker's ID to any screen.
    qa: live.qa.map((q) => ({ id: q.id, empId: q.anon ? null : q.empId, anon: q.anon, text: q.text, t: q.t, status: q.status })),
    qaSpot: c.qaSpot,
    timer: c.timer,
    scoreboard: scoreboard(live, rules, people)
  };
}

function phoneView(live, empId, rules, people, now) {
  const c = live.ctrl, sb = scoreboard(live, rules, people), me = sb.find((r) => r.id === empId), p = people.get(empId) || { name: 'ID ' + empId };
  const q = c.quiz.questions.find((x) => x.id === c.quiz.current);
  let quiz = null;
  if (q && (c.quiz.state === 'open' || c.quiz.state === 'revealed')) {
    const mine = (live.answers[q.id] || {})[empId];
    quiz = { id: q.id, state: c.quiz.state, text: q.text, options: q.options, es: q.es || null, myChoice: mine == null ? null : mine };
    if (c.quiz.state === 'revealed') { quiz.correct = q.correct; quiz.earned = qPoints(live, q, empId, rules); }
  }
  // Score only counts questions whose answer is no longer secret.
  let right = 0, n = 0;
  c.quiz.questions.forEach((x) => {
    if (x.id === c.quiz.current && c.quiz.state === 'open') return;
    const a = (live.answers[x.id] || {})[empId];
    if (a != null) { n++; if (a === x.correct) right++; }
  });
  return {
    v: live.v, serverNow: now, code: c.code, title: c.title, status: c.status, activeTab: c.activeTab,
    me: { id: empId, name: p.name, points: me ? me.total : 0, rank: me ? me.rank : null },
    quiz, score: n ? { right, n } : null,
    words: { open: c.words.open, prompt: c.words.prompt, mine: live.words.filter((w) => w.empId === empId).map((w) => w.text), cap: n0(rules.wordCap), per: n0(rules.word) },
    // Wait for the on-screen spin animation (about 5 seconds) before telling the winner.
    wheel: { pickedMe: c.wheel.last === empId && (!c.wheel.spin || now - c.wheel.spin.at > 5500) },
    timer: c.timer,
    myQuestions: live.qa.filter((x) => x.empId === empId && x.status !== 'hidden').map((x) => ({ id: x.id, text: x.text, anon: x.anon, status: x.status }))
  };
}

function wheelPool(ctrl, live, rosters, peopleIds) {
  const r = ctrl.rosterId && rosters.get(ctrl.rosterId);
  let ids = ctrl.wheel.pool === 'checked' ? live.participants.map((p) => p.id)
    : ctrl.wheel.pool === 'roster' && r ? r.members.slice() : [...peopleIds];
  if (ctrl.wheel.remove) ids = ids.filter((id) => !ctrl.wheel.winners.includes(id));
  return ids;
}

function remaining(timer, now) { return timer.endsAt ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000)) : timer.rem; }

function validQuestion(q) {
  const text = cleanText(q && q.text, 300);
  const options = (Array.isArray(q && q.options) ? q.options : []).map((o) => cleanText(o, 120)).filter(Boolean).slice(0, 4);
  const correct = Number(q && q.correct);
  if (!text || options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) throw new HttpError(400, 'A question needs text, 2 to 4 answers, and a correct answer.');
  return { id: 'q' + uid(), topic: cleanText(q.topic, 40) || 'Other', text, options, correct };
}

const bad = (m) => { throw new HttpError(400, m); };

/**
 * Apply a moderator command to the control document (mutates and returns it).
 * ctx: { live, now, modules: Map, rosters: Map, peopleIds: Set }
 */
function applyCommand(ctrl, cmd, ctx) {
  if (ctrl.status !== 'open') bad('This session has ended.');
  const Q = ctrl.quiz, now = ctx.now;
  const findQ = (id) => Q.questions.find((q) => q.id === id) || bad('Unknown question.');
  const out = {};
  switch (cmd && cmd.type) {
    case 'setTab': if (!TABS.includes(cmd.tab)) bad('Unknown tab.'); ctrl.activeTab = cmd.tab; break;
    case 'setTitle': ctrl.title = cleanText(cmd.title, 120) || ctrl.title; break;
    case 'selectQuestion': findQ(cmd.qid); Q.current = cmd.qid; Q.state = 'ready'; break;
    case 'release': if (!Q.current) bad('Pick a question first.'); Q.state = 'open'; if (Q.opened[Q.current] == null) Q.opened[Q.current] = now; break;
    case 'reveal': if (Q.state === 'open') Q.state = 'revealed'; break;
    case 'next': {
      const i = Q.questions.findIndex((q) => q.id === Q.current);
      if (i >= 0 && i < Q.questions.length - 1) { Q.current = Q.questions[i + 1].id; Q.state = 'ready'; }
      break;
    }
    case 'addQuestion': { const q = validQuestion(cmd.question); Q.questions.push(q); out.added = q; break; }
    case 'deleteQuestion': findQ(cmd.qid); Q.questions = Q.questions.filter((q) => q.id !== cmd.qid); if (Q.current === cmd.qid) { Q.current = null; Q.state = 'idle'; } break;
    case 'wordsPrompt': ctrl.words.prompt = cleanText(cmd.text, 200) || ctrl.words.prompt; break;
    case 'wordsOpen': ctrl.words.open = !!cmd.open; break;
    case 'wordsClear': ctrl.words.round++; ctrl.words.hidden = []; break;
    case 'hideWord': { const k = norm(cleanText(cmd.key, 30)); if (k && !ctrl.words.hidden.includes(k)) ctrl.words.hidden.push(k); break; }
    case 'unhideWords': ctrl.words.hidden = []; break;
    case 'wheelConfig':
      if (cmd.pool !== undefined) { if (!['checked', 'roster', 'all'].includes(cmd.pool)) bad('Unknown pool.'); ctrl.wheel.pool = cmd.pool; }
      if (cmd.remove !== undefined) ctrl.wheel.remove = !!cmd.remove;
      break;
    case 'spin': {
      const pool = wheelPool(ctrl, ctx.live, ctx.rosters, ctx.peopleIds);
      if (!pool.length) bad('No names on the wheel.');
      const winner = pool[crypto.randomInt(pool.length)];
      ctrl.wheel.spin = { id: uid(), winner, pool, at: now };
      ctrl.wheel.last = winner;
      ctrl.wheel.winners.push(winner);
      break;
    }
    case 'wheelClear': ctrl.wheel.winners = []; ctrl.wheel.last = null; ctrl.wheel.spin = null; break;
    case 'qaStatus': {
      if (!ctx.live.qa.some((q) => q.id === cmd.id)) bad('Unknown question.');
      if (!['open', 'answered', 'hidden'].includes(cmd.status)) bad('Unknown status.');
      ctrl.qaStatus[cmd.id] = cmd.status;
      if (ctrl.qaSpot === cmd.id && cmd.status !== 'open') ctrl.qaSpot = null;
      break;
    }
    case 'qaSpot':
      if (cmd.id && !ctx.live.qa.some((q) => q.id === cmd.id)) bad('Unknown question.');
      ctrl.qaSpot = cmd.id && ctrl.qaSpot !== cmd.id ? cmd.id : null;
      break;
    case 'timerSet': { const m = Math.round(+cmd.minutes); if (!(m >= 1 && m <= 60)) bad('Pick 1 to 60 minutes.'); ctrl.timer = { dur: m * 60, rem: m * 60, endsAt: null }; break; }
    case 'timerStart': { const r = remaining(ctrl.timer, now); if (r > 0) { ctrl.timer.rem = r; ctrl.timer.endsAt = now + r * 1000; } break; }
    case 'timerPause': ctrl.timer.rem = remaining(ctrl.timer, now); ctrl.timer.endsAt = null; break;
    case 'timerReset': ctrl.timer.rem = ctrl.timer.dur; ctrl.timer.endsAt = null; break;
    case 'bonus': {
      const d = Math.round(+cmd.delta);
      if (!Number.isInteger(d) || d < -50 || d > 50 || d === 0) bad('Bonus must be between -50 and 50.');
      if (!ctx.peopleIds.has(cmd.empId)) bad('Unknown employee.');
      ctrl.bonus[cmd.empId] = (ctrl.bonus[cmd.empId] || 0) + d;
      break;
    }
    case 'setModule': {
      const m = cmd.moduleId ? ctx.modules.get(cmd.moduleId) : null;
      if (cmd.moduleId && !m) bad('Unknown training.');
      ctrl.moduleId = m ? m.id : null;
      if (m) { ctrl.quiz = { questions: clone(m.questions), current: null, state: 'idle', opened: {}, round: Q.round + 1 }; ctrl.title = m.name; }
      break;
    }
    case 'setRoster':
      if (cmd.rosterId && !ctx.rosters.has(cmd.rosterId)) bad('Unknown roster.');
      ctrl.rosterId = cmd.rosterId || null;
      if (!ctrl.rosterId && ctrl.wheel.pool === 'roster') ctrl.wheel.pool = 'checked';
      break;
    default: bad('Unknown command.');
  }
  ctrl.v++;
  return out;
}

/**
 * Everything that gets written when a session is saved. Pure.
 * IDs are deterministic (based on the session code), so if saving is
 * interrupted and retried, records are overwritten rather than duplicated.
 */
function finalize({ live, module, roster, rules, people, date }) {
  const c = live.ctrl, sb = scoreboard(live, rules, people);
  const released = c.quiz.questions.filter((q) => c.quiz.opened[q.id] != null);
  const ledger = sb.filter((r) => r.total !== 0).map((r) => ({ id: `l_${c.code}_${r.id}`, pk: 'ledger', type: 'ledger', empId: r.id, rosterId: roster ? roster.id : null, sessionCode: c.code, date, pts: r.total }));
  const completions = [];
  if (module) {
    live.participants.forEach((p) => {
      if (!people.has(p.id)) return;
      let score = null;
      if (released.length) score = Math.round(released.filter((q) => (live.answers[q.id] || {})[p.id] === q.correct).length / released.length * 100);
      completions.push({ ...mkCompletion(module, p.id, roster ? roster.id : null, c.code, date, score), id: `c_${c.code}_${p.id}`, pk: 'completions', type: 'completion' });
    });
  }
  const outbox = completions.filter((x) => x.hcss).map((x) => ({
    id: 'o_' + x.id, pk: 'outbox', type: 'outbox', completionId: x.id, empId: x.empId, courseCode: x.hcss.courseCode,
    completedOn: x.date, expiresOn: x.expires, status: 'pending', attempts: 0, lastError: null
  }));
  const rosterAdds = roster ? live.participants.map((p) => p.id).filter((id) => !roster.members.includes(id)) : [];
  const qs = c.quiz.questions.map((q) => {
    const A = live.answers[q.id] || {}, vals = Object.values(A);
    return vals.length ? { qid: q.id, text: q.text, topic: q.topic, asked: vals.length, missed: vals.filter((v) => v !== q.correct).length } : null;
  }).filter(Boolean);
  const history = {
    id: `h_${c.code}`, pk: 'history', type: 'history', date, title: c.title, moduleId: module ? module.id : null, rosterId: roster ? roster.id : null,
    sessionCode: c.code, owner: c.owner, n: live.participants.length, qs, qa: live.qa.filter((q) => q.status !== 'hidden').map((q) => q.text)
  };
  return { ledger, completions, outbox, rosterAdds, history, released: released.length };
}

module.exports = { TABS, pkFor, newControl, assemble, qPoints, scoreboard, moderatorView, phoneView, applyCommand, finalize, wheelPool, validQuestion };
