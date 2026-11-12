/* KE&G Huddle - employee phone page. No account needed:
   session code + employee ID returns a short-lived token for that session. */
(function () {
'use strict';
const COLORS = ['#103F91', '#E8621A', '#1A2744', '#2E7D5B'];
const SHAPES = ['▲', '◆', '●', '■'];
const T={
 en:{codeLbl:'Session code',idLbl:'Employee ID',joinTitle:'Join the training',ended:'This session has ended. Thanks for taking part!',endedPts:'You earned',again:'Join another session',offline:'Reconnecting...',session:'Session',enterId:'Enter your employee ID',signIn:'Join',notFound:'ID not found. Check with your trainer.',hi:'Signed in as',waiting:'You\'re in. Waiting for the next activity.',waitQ:'Get ready. The next question is coming.',locked:'Answer locked in',lockedSub:'Watch the screen for the answer.',correct:'Correct!',wrong:'Not quite.',theAnswer:'The answer was',missedQ:'Time\'s up',score:'Your score',wordPh:'Type a word or short phrase',send:'Send',sentList:'You sent',sentFlash:'Sent! Add another if you want.',closed:'The word cloud is closed right now.',wheel:'The wheel is up. Eyes on the screen.',picked:'You were picked!',askTitle:'Ask a question',askPh:'What do you want to know?',anon:'Ask anonymously',askSent:'Question sent. Thanks.',yourQs:'Your questions',answered:'Answered',activity:'Activity',ask:'Ask',pts:'pts',earned:'points',forAnswering:'for answering',rankMsg:'You\'re in',withPts:'with',leader:'Leaderboard is up. Eyes on the screen.',wordPts:'You earn points for up to',words:'words',timer:'Timer',signOut:'Sign out',anonTag:'anonymous'},
 es:{codeLbl:'C\u00f3digo de sesi\u00f3n',idLbl:'N\u00famero de empleado',joinTitle:'\u00danete a la capacitaci\u00f3n',ended:'La sesi\u00f3n termin\u00f3. \u00a1Gracias por participar!',endedPts:'Ganaste',again:'Unirse a otra sesi\u00f3n',offline:'Reconectando...',session:'Sesi\u00f3n',enterId:'Ingresa tu número de empleado',signIn:'Entrar',notFound:'No se encontró el número. Pregunta a tu instructor.',hi:'Sesión de',waiting:'Ya entraste. Esperando la siguiente actividad.',waitQ:'Prepárate. Ya viene la siguiente pregunta.',locked:'Respuesta registrada',lockedSub:'Mira la pantalla para ver la respuesta.',correct:'¡Correcto!',wrong:'Incorrecto.',theAnswer:'La respuesta era',missedQ:'Se acabó el tiempo',score:'Tu puntaje',wordPh:'Escribe una palabra o frase corta',send:'Enviar',sentList:'Enviaste',sentFlash:'¡Enviado! Puedes mandar otra.',closed:'La nube de palabras está cerrada.',wheel:'La ruleta está lista. Mira la pantalla.',picked:'¡Te tocó a ti!',askTitle:'Haz una pregunta',askPh:'¿Qué quieres saber?',anon:'Preguntar de forma anónima',askSent:'Pregunta enviada. Gracias.',yourQs:'Tus preguntas',answered:'Contestada',activity:'Actividad',ask:'Preguntar',pts:'pts',earned:'puntos',forAnswering:'por contestar',rankMsg:'Vas en el lugar',withPts:'con',leader:'La tabla de posiciones est\u00e1 en pantalla.',wordPts:'Ganas puntos por hasta',words:'palabras',timer:'Temporizador',signOut:'Salir',anonTag:'anónima'}
};


const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (s) => { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const store = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
let lang = 'en'; try { lang = localStorage.getItem('huddle.lang') === 'es' ? 'es' : 'en'; } catch (e) { /* ignore */ }
const params = new URLSearchParams(location.search);
const P = { pane: 'activity', draft: '', ask: '', anon: false, flash: '', askFlash: '', err: '', busy: false, code: (params.get('code') || '').replace(/\D/g, '').slice(0, 6), id: '' };
let J = store.get('huddle.join'); // { code, token, name }
if (J && P.code && J.code !== P.code) { J = null; store.del('huddle.join'); }
let V = null, offset = 0, polling = false, offline = false;
const L = () => T[lang];

async function call(method, path, body) {
  const h = { 'content-type': 'application/json' };
  if (J) h.authorization = 'Bearer ' + J.token;
  const r = await fetch('/api/' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
  if (r.status === 401 && J) { J = null; V = null; store.del('huddle.join'); }
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong.'); e.status = r.status; throw e; }
  return j;
}
async function poll() {
  if (!J || polling || document.hidden) return;
  polling = true;
  try {
    const v = await call('GET', `live/${J.code}/me?v=${encodeURIComponent(V ? V.v : '')}`);
    offset = v.serverNow - Date.now();
    const wasOffline = offline; offline = false;
    if (!v.unchanged) { V = v; render(); } else if (wasOffline) render();
  } catch (e) { if (!e.status) { offline = true; } render(); }
  finally { polling = false; }
}
const trem = () => { const t = V && V.timer; if (!t) return 0; return t.endsAt ? Math.max(0, Math.ceil((t.endsAt - Date.now() - offset) / 1000)) : t.rem; };

function head() {
  return `<div class="ph-head"><span class="ph-brand">KE&amp;G <b>Huddle</b></span><span class="lang"><button class="${lang === 'en' ? 'on' : ''}" data-act="lang" data-arg="en">EN</button><button class="${lang === 'es' ? 'on' : ''}" data-act="lang" data-arg="es">ES</button></span></div>`;
}
function joinForm() {
  const l = L();
  return `<div class="ph-center"><h3>${l.joinTitle}</h3>
   <label class="lbl" for="jCode">${l.codeLbl}</label><input id="jCode" inputmode="numeric" autocomplete="off" maxlength="6" value="${esc(P.code)}" placeholder="123456">
   <label class="lbl" for="jId">${l.idLbl}</label><input id="jId" inputmode="numeric" autocomplete="off" maxlength="32" value="${esc(P.id)}" placeholder="10001">
   <button class="btn o block" data-act="join" ${P.busy ? 'disabled' : ''}>${l.signIn}</button>
   ${P.err ? `<div class="err">${esc(P.err)}</div>` : ''}</div>`;
}
function wait(msg) { return `<div class="ph-center"><div class="big-ic" style="background:#1B4F9B">…</div><div class="ph-msg">${msg}</div></div>`; }
function activity() {
  const l = L(), tab = V.activeTab;
  if (tab === 'quiz') {
    const q = V.quiz;
    if (!q) return wait(l.waitQ);
    const es = lang === 'es' && q.es, text = es ? q.es.text : q.text, opts = es ? q.es.options : q.options;
    if (q.state === 'open') {
      if (q.myChoice != null) return `<div class="ph-center"><div class="big-ic" style="background:${COLORS[q.myChoice]}">${SHAPES[q.myChoice]}</div><div class="ph-msg">${l.locked}</div><div class="ph-sub">${l.lockedSub}</div></div>`;
      return `<div class="ph-q">${esc(text)}</div><div class="ans">${opts.map((o, k) => `<button style="background:${COLORS[k]}" data-act="answer" data-arg="${k}"><span class="shape">${SHAPES[k]}</span>${esc(o)}</button>`).join('')}</div>`;
    }
    const ok = q.myChoice === q.correct;
    return `<div class="ph-center"><div class="big-ic" style="background:${ok ? '#2E7D5B' : '#B3261E'}">${ok ? '✓' : '✕'}</div>
     <div class="ph-msg">${q.myChoice == null ? l.missedQ : ok ? l.correct : l.wrong}</div>
     ${ok ? '' : `<div class="ph-sub">${l.theAnswer}:</div><div class="ph-ans">${esc(opts[q.correct])}</div>`}
     ${q.myChoice != null ? `<div class="earn">+${q.earned} ${l.earned}${ok ? '' : ' <span class="ph-sub">' + l.forAnswering + '</span>'}</div>` : ''}
     ${V.score ? `<div class="ph-score">${l.score}: <b>${V.score.right} / ${V.score.n}</b></div>` : ''}</div>`;
  }
  if (tab === 'words') {
    if (!V.words.open) return wait(l.closed);
    return `<div class="ph-prompt">${esc(V.words.prompt)}</div>
     <input id="pWord" maxlength="30" autocomplete="off" value="${esc(P.draft)}" placeholder="${l.wordPh}">
     <button class="btn o block" style="margin-top:8px" data-act="word">${l.send}</button>
     ${P.flash ? `<div class="flash">${esc(P.flash)}</div>` : ''}
     ${V.words.cap && V.words.per ? `<div class="ph-sub" style="font-size:12px;margin-top:6px">${l.wordPts} ${V.words.cap} ${l.words}</div>` : ''}
     ${V.words.mine.length ? `<div class="ph-sub" style="margin-top:12px">${l.sentList}:</div><div class="ph-sent">${V.words.mine.map((w) => `<span>${esc(w)}</span>`).join('')}</div>` : ''}`;
  }
  if (tab === 'wheel') return `<div class="ph-center"><div class="big-ic" style="background:#E8621A">✦</div><div class="ph-msg">${l.wheel}</div>${V.wheel.pickedMe ? `<div class="picked">${l.picked}</div>` : ''}</div>`;
  if (tab === 'board') return `<div class="ph-center"><div class="ph-sub">${l.rankMsg}</div><div class="ph-rank">#${V.me.rank || '-'}</div><div class="ph-msg">${l.withPts} ${V.me.points} ${l.earned}</div><div class="ph-sub" style="margin-top:8px">${l.leader}</div></div>`;
  if (tab === 'timer') return `<div class="ph-center"><div class="ph-sub">${l.timer}</div><div class="tdigits" style="font-size:96px;line-height:1">${fmt(trem())}</div></div>`;
  return wait(l.waiting);
}
function askPane() {
  const l = L();
  return `<div class="ph-prompt">${l.askTitle}</div>
   <textarea id="pAsk" rows="4" maxlength="240" placeholder="${l.askPh}">${esc(P.ask)}</textarea>
   <label class="chk" style="margin-top:8px;font-size:14px"><input type="checkbox" id="pAnon" ${P.anon ? 'checked' : ''}> ${l.anon}</label>
   <button class="btn o block" style="margin-top:10px" data-act="ask">${l.send}</button>
   ${P.askFlash ? `<div class="flash">${esc(P.askFlash)}</div>` : ''}
   ${V.myQuestions.length ? `<div class="ph-sub" style="margin-top:14px">${l.yourQs}</div>${V.myQuestions.slice().reverse().map((q) => `<div class="myq">${q.status === 'answered' ? `<div class="ok">✓ ${l.answered}</div>` : ''}${esc(q.text)}${q.anon ? ` <span class="muted">(${l.anonTag})</span>` : ''}</div>`).join('')}` : ''}`;
}
function render() {
  const a = document.activeElement, fid = a && a.id; let ss = null, se = null;
  try { ss = a.selectionStart; se = a.selectionEnd; } catch (e) { /* ignore */ }
  const l = L();
  let body, nav = '';
  if (!J || !V) body = J ? wait(l.offline) : joinForm();
  else if (V.status !== 'open') body = `<div class="ph-center"><div class="ended"><div class="ph-msg">${l.ended}</div><p>${l.endedPts} <b>${V.me.points}</b> ${l.earned}.</p><button class="btn g" data-act="leave">${l.again}</button></div></div>`;
  else {
    const pane = V.activeTab === 'qa' ? 'ask' : P.pane;
    body = `<div class="ph-top"><div class="ph-hello">${l.hi} <b>${esc(V.me.name)}</b></div><span class="ph-pts"><b>${V.me.points}</b> ${l.pts}${V.me.rank ? ` · #${V.me.rank}` : ''}</span></div>` + (pane === 'ask' ? askPane() : activity());
    nav = `<div class="ph-nav"><button class="${pane === 'activity' ? 'on' : ''}" data-act="pane" data-arg="activity">${l.activity}</button><button class="${pane === 'ask' ? 'on' : ''}" data-act="pane" data-arg="ask">${l.ask}</button><button data-act="leave">${l.signOut}</button></div>`;
  }
  document.getElementById('root').innerHTML = `<div class="jwrap">${head()}<div class="ph-body">${offline && J ? `<div class="hint">${l.offline}</div>` : ''}${body}</div>${nav}</div>`;
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) { /* ignore */ } } }
}
const flash = (k, msg) => { P[k] = msg; render(); setTimeout(() => { P[k] = ''; render(); }, 2500); };
const ACT = {
  lang: (a) => { lang = a; try { localStorage.setItem('huddle.lang', a); } catch (e) { /* ignore */ } render(); },
  pane: (a) => { P.pane = a; render(); },
  join: async () => {
    P.code = (document.getElementById('jCode').value || '').replace(/\D/g, ''); P.id = (document.getElementById('jId').value || '').trim();
    P.busy = true; P.err = ''; render();
    try {
      const r = await call('POST', 'join', { code: P.code, employeeId: P.id });
      J = { code: r.code, token: r.token, name: r.employee.firstName }; store.set('huddle.join', J);
      history.replaceState(null, '', '/join/?code=' + r.code);
      P.busy = false;
      await poll();
    } catch (e) { P.err = e.message; }
    P.busy = false; render();
  },
  answer: async (a) => { try { await call('POST', `live/${J.code}/answer`, { qid: V.quiz.id, choice: +a }); V.quiz.myChoice = +a; render(); poll(); } catch (e) { flash('flash', e.message); } },
  word: async () => {
    const t = (document.getElementById('pWord').value || '').trim(); if (!t) return;
    try { await call('POST', `live/${J.code}/word`, { text: t }); P.draft = ''; V.words.mine.push(t); flash('flash', L().sentFlash); poll(); } catch (e) { flash('flash', e.message); }
  },
  ask: async () => {
    const t = (document.getElementById('pAsk').value || '').trim(); if (!t) return;
    try { await call('POST', `live/${J.code}/ask`, { text: t, anonymous: P.anon }); P.ask = ''; flash('askFlash', L().askSent); poll(); } catch (e) { flash('askFlash', e.message); }
  },
  leave: () => { J = null; V = null; store.del('huddle.join'); P.code = ''; P.err = ''; history.replaceState(null, '', '/join/'); render(); }
};
document.addEventListener('click', (e) => { const t = e.target.closest('[data-act]'); if (!t || t.disabled) return; e.preventDefault(); if (ACT[t.dataset.act]) ACT[t.dataset.act](t.dataset.arg); });
document.addEventListener('input', (e) => { const t = e.target; if (t.id === 'pWord') P.draft = t.value; if (t.id === 'pAsk') P.ask = t.value; if (t.id === 'jCode') P.code = t.value; if (t.id === 'jId') P.id = t.value; });
document.addEventListener('change', (e) => { if (e.target.id === 'pAnon') P.anon = e.target.checked; });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return; const id = e.target.id;
  if (id === 'jId' || id === 'jCode') { e.preventDefault(); ACT.join(); }
  if (id === 'pWord') { e.preventDefault(); ACT.word(); }
});
setInterval(poll, 1500);
setInterval(() => { document.querySelectorAll('.tdigits').forEach((el) => { const v = fmt(trem()); if (el.textContent !== v) el.textContent = v; }); }, 250);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
render(); poll();
})();
