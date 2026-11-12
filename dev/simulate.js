#!/usr/bin/env node
'use strict';
/**
 * Simulate a room of employees on their phones, against the dev server or
 * a test environment. Each fake phone joins, polls like a real phone, and
 * answers questions / sends words / asks questions when those tabs are up.
 *
 *   npm run simulate -- --count 50 [--code 123456] [--url http://localhost:4280]
 *
 * With no --code it reads the newest open session from the dev server.
 * Use it as a load test too: 50 phones polling every 1.5s is the real load.
 */
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const BASE = (args.url || 'http://localhost:4280').replace(/\/$/, '');
const COUNT = +(args.count || 50);
const START = +(args.start || 10001);
const WORDS = ['heat', 'heat', 'heat', 'traffic', 'traffic', 'rushing', 'rushing', 'trenches', 'dust', 'fatigue', 'backing equipment', 'dehydration', 'monsoon', 'overhead lines', 'distractions', 'cave-ins', 'calor', 'blind spots', 'silica'];
const QS = ['Do we need a trench box for a 4 foot trench in clay?', 'Who is the competent person on our crew this week?', 'Are there electrolyte drinks on every job?', 'Can I use my own lock for lockout?', 'Do I need a harness in a scissor lift?', '¿Hay agua fría en todos los trabajos?'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, p, body, token) {
  const r = await fetch(BASE + '/api/' + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

async function phone(code, id, stats) {
  const j = await req('POST', 'join', { code, employeeId: String(id) });
  if (j.status !== 200) { stats.joinFail++; return; }
  stats.joined++;
  const tok = j.body.token; let v = '', view = null; const done = new Set(); let words = 0, asked = 0;
  while (!stats.stop) {
    const t0 = Date.now();
    const r = await req('GET', `live/${code}/me?v=${encodeURIComponent(v)}`, null, tok);
    stats.polls++; stats.latency.push(Date.now() - t0);
    if (r.status !== 200) { stats.errors++; await sleep(1500); continue; }
    if (!r.body.unchanged) { view = r.body; v = view.v; }
    if (view.status !== 'open') break;
    if (view.activeTab === 'quiz' && view.quiz && view.quiz.state === 'open' && view.quiz.myChoice == null && !done.has(view.quiz.id)) {
      done.add(view.quiz.id);
      await sleep(500 + Math.random() * 7000);
      // Phones never see the right answer, so simulated people just guess.
      const choice = Math.floor(Math.random() * view.quiz.options.length);
      const a = await req('POST', `live/${code}/answer`, { qid: view.quiz.id, choice }, tok);
      a.status === 200 ? stats.answers++ : stats.errors++;
    }
    if (view.activeTab === 'words' && view.words.open && words < 1 + Math.floor(Math.random() * 2)) {
      await sleep(Math.random() * 4000); words++;
      const w = await req('POST', `live/${code}/word`, { text: pick(WORDS) }, tok); w.status === 200 ? stats.words++ : stats.errors++;
    }
    if (view.activeTab === 'qa' && asked < 1 && Math.random() < 0.15) {
      asked++;
      const q = await req('POST', `live/${code}/ask`, { text: pick(QS), anonymous: Math.random() < 0.3 }, tok); q.status === 200 ? stats.asks++ : stats.errors++;
    }
    await sleep(Math.max(0, 1500 - (Date.now() - t0)));
  }
}

(async () => {
  let code = args.code;
  if (!code) {
    const r = await fetch(BASE + '/api/manage/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    code = (await r.json()).code;
  }
  if (!code) { console.error('No session code. Pass --code 123456'); process.exit(1); }
  const stats = { joined: 0, joinFail: 0, polls: 0, answers: 0, words: 0, asks: 0, errors: 0, latency: [], stop: false };
  console.log(`Simulating ${COUNT} phones on session ${code} at ${BASE}. Ctrl+C to stop.`);
  const ids = Array.from({ length: COUNT }, (_, i) => START + i);
  const runs = ids.map((id, i) => sleep(i * 60).then(() => phone(code, id, stats)));
  const timer = setInterval(() => {
    const l = stats.latency.splice(0).sort((a, b) => a - b);
    const p95 = l.length ? l[Math.floor(l.length * 0.95)] : 0;
    console.log(`joined ${stats.joined} | polls ${stats.polls} | answers ${stats.answers} | words ${stats.words} | questions ${stats.asks} | errors ${stats.errors} | p95 poll ${p95}ms`);
  }, 5000);
  const dur = args.seconds ? +args.seconds * 1000 : 0;
  if (dur) setTimeout(() => { stats.stop = true; }, dur);
  process.on('SIGINT', () => { stats.stop = true; });
  await Promise.all(runs);
  clearInterval(timer);
  console.log('Done.', JSON.stringify({ ...stats, latency: undefined }));
})();
