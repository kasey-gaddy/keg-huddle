/* KE&G Huddle - trainer console.
   All data comes from the API (/api/manage/...). Nothing sensitive is kept
   in the browser beyond the current screen. */
(function () {
'use strict';
const $ = (s) => document.querySelector(s);
/* ---------- state ---------- */
let S = { people: [], rosters: [], modules: [], completions: [], ledger: [], history: [], pts: {}, hcss: {}, me: { roles: [] },
  participants: [], quiz: { questions: [], answers: {}, opened: {}, times: {} }, words: { items: [], hidden: [] }, wheel: { winners: [] },
  qa: [], timer: { dur: 300, rem: 300, endsAt: null }, session: {}, bonus: {}, scoreboard: [] };
let BOOT = null, LIVE = null, SB = [], clockOffset = 0, polling = false, seenSpin;
const SEEN = new Set();
function fresh(k) { if (SEEN.has(k)) return ''; SEEN.add(k); return ' new'; }
const ui = { boardScope: 'session', confirm: null, pendingModule: null, rosterSel: 'all', newRoster: { name: '' }, addMembers: false, modSel: 'm-dd', trSub: 'records', trF: { mod: '', ros: '', st: '' }, mq: { text: '', o0: '', o1: '', o2: '', o3: '', correct: '0', topic: 'Other' }, boardAll: false, view: 'normal', showLive: false, addOpen: false, newQ: { text: '', o0: '', o1: '', o2: '', o3: '', correct: '0', topic: 'Trenching & Excavation' }, qaFilter: 'open', csv: '', one: { id: '', name: '', crew: '' }, rosterQ: '', wheelRot: 0, spinning: false, spinPool: null };
const isAdmin = () => ((S.me && S.me.roles) || []).includes('admin');

/* ---------- API ---------- */
async function api(method, path, body) {
  const r = await fetch('/api/' + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  if (r.status === 401) { location.href = '/.auth/login/kegtus?post_login_redirect_uri=/'; throw new Error('Please sign in.'); }
  let j = {};
  try { j = await r.json(); } catch (e) { /* empty body */ }
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong.'); e.status = r.status; e.body = j; throw e; }
  return j;
}
function merge() { S = Object.assign({}, BOOT || {}, LIVE || {}); SB = (LIVE && LIVE.scoreboard) || []; }
async function loadBoot() { BOOT = await api('GET', 'manage/bootstrap'); merge(); }
function setLive(v) { if (!v || v.unchanged) return false; LIVE = v; clockOffset = v.serverNow - Date.now(); merge(); return true; }
async function cmd(type, extra) {
  try { setLive(await api('POST', `manage/sessions/${S.code}/command`, Object.assign({ type }, extra || {}))); maybeAnimateSpin(); render(); }
  catch (e) { toast(e.message); }
}
async function poll() {
  if (!S.code || polling || document.hidden) return;
  polling = true;
  try {
    const v = await api('GET', `manage/sessions/${S.code}/state?v=${encodeURIComponent(LIVE ? LIVE.v : '')}`);
    if (setLive(v)) { maybeAnimateSpin(); render(); }
  } catch (e) { /* keep polling */ } finally { polling = false; }
}
async function adminCall(method, path, body, okMsg) {
  try { const r = await api(method, path, body); await loadBoot(); render(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
  catch (e) { toast(e.message); return null; }
}
const now = () => Date.now() + clockOffset;

/* ---------- reused view code ---------- */
const COLORS=['#103F91','#E8621A','#1A2744','#2E7D5B'];
const SHAPES=['▲','◆','●','■'];
const LETTERS=['A','B','C','D'];
const WHEEL_PAL=['#103F91','#E8621A','#1A2744','#1B4F9B','#2E7D5B','#0D1F3C'];
const CLOUD_COL=['#103F91','#E8621A','#1A2744','#2E7D5B','#1B4F9B'];
const TOPICS=['Trenching & Excavation','Heat Illness','Lockout/Tagout','Fall Protection','Equipment & Traffic','Hazard Communication','Reporting & Near Misses','ESOP & Benefits','Other'];
const TOPIC_KEYS=[
 ['Trenching & Excavation',['trench','excavat','competent','shoring','soil','cave','spoil','zanja','sloping']],
 ['Heat Illness',['heat','water','hydrat','shade','electrolyte','calor','agua','cramp','sun']],
 ['Lockout/Tagout',['lockout','loto','tagout','candado',' lock','my lock','own lock']],
 ['Fall Protection',['harness','fall','ladder','lift','guardrail','arnés']],
 ['Equipment & Traffic',['backing','spotter','traffic','equipment','flagger','excavator','loader','blind spot']],
 ['Hazard Communication',['sds','chemical','coating','label','silica']],
 ['Reporting & Near Misses',['report','near miss','incident','injur','hurt']],
 ['ESOP & Benefits',['esop','vest','retire','benefit','paid','pay ','401','stock']]
];
function todayStr(){return new Date().toLocaleDateString('en-CA');}
function addMonths(d,m){const x=new Date(d+'T12:00:00');x.setMonth(x.getMonth()+(+m||0));return x.toLocaleDateString('en-CA');}
function daysUntil(d){return Math.round((new Date(d+'T12:00:00')-new Date(todayStr()+'T12:00:00'))/864e5);}
function fmtDate(d){return d?new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';}
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const emp=id=>S.people.find(e=>e.id===id);
const nm=id=>{const e=emp(id);return e?e.name:'ID '+id;};
const short=id=>{const e=emp(id);if(!e)return 'ID '+id;const p=e.name.split(' ');return p[0]+(p[1]?' '+p[1][0]+'.':'');};
const pct=(a,b)=>b?Math.round(a/b*100):0;
const fmt=s=>{s=Math.max(0,s|0);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
const norm=t=>String(t).trim().toLowerCase().replace(/\s+/g,' ');
const ago=t=>{const m=Math.floor((Date.now()-t)/60000);return m<1?'just now':m+' min ago';};
function topicOf(text){const t=' '+String(text).toLowerCase()+' ';for(const [name,keys] of TOPIC_KEYS){if(keys.some(k=>t.includes(k)))return name;}return 'Other';}
function curQ(){return S.quiz.questions.find(q=>q.id===S.quiz.current);}
function isIn(id){return S.participants.some(p=>p.id===id);}
const mod=id=>S.modules.find(m=>m.id===id);
const ros=id=>S.rosters.find(r=>r.id===id);
const clone=o=>JSON.parse(JSON.stringify(o));
function cStatus(c){
 if(!c)return {k:'none',label:'Not taken'};
 if(!c.passed)return {k:'retake',label:'Needs retake'};
 if(!c.expires)return {k:'ok',label:'Complete'};
 const d=daysUntil(c.expires);
 if(d<0)return {k:'expired',label:'Expired'};
 if(d<=60)return {k:'soon',label:'Expires in '+d+' day'+(d===1?'':'s')};
 return {k:'ok',label:'Current'};
}
function latestMap(){const m={};S.completions.forEach(c=>{const k=c.empId+'|'+c.moduleId,p=m[k];if(!p||c.date>p.date)m[k]=c;});return m;}
function personChips(id,LM){
 return S.modules.map(md=>{const c=LM[id+'|'+md.id];if(!c)return '';const st=cStatus(c);return `<span class="st ${st.k}" title="${esc(md.name)}: ${esc(st.label)}${c.expires?' · expires '+esc(fmtDate(c.expires)):''}">${esc(md.code||abbr(md.name))}</span>`;}).join('');
}
function abbr(n){const w=String(n).replace(/[^A-Za-z0-9 ]/g,' ').split(/\s+/).filter(Boolean);return w.length>1?w.slice(0,3).map(x=>/^\d+$/.test(x)?x:x[0]).join('').toUpperCase():n.slice(0,4);}
function confirmGate(key){if(ui.confirm===key){ui.confirm=null;return true;}ui.confirm=key;render();setTimeout(()=>{if(ui.confirm===key){ui.confirm=null;render();}},4500);return false;}
const cbtn=(key,label,cls,arg)=>`<button class="btn sm ${cls||'g'} ${ui.confirm===key?'confirm':''}" data-act="${key.split(':')[0]}" data-arg="${esc(arg||'')}">${ui.confirm===key?'Click again to confirm':label}</button>`;
let toastT=null;
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),2400);}

const num=v=>Math.max(0,+v||0);
function standings(scope){
 if(scope==='session')return SB;
 const rid=S.session.rosterId,r=ros(rid),m={};
 S.ledger.forEach(l=>{if(scope==='roster'&&(l.rosterId!==rid||l.cleared))return;m[l.empId]=(m[l.empId]||0)+l.pts;});
 SB.forEach(x=>{m[x.id]=(m[x.id]||0)+x.total;});
 let ids=Object.keys(m);if(scope==='roster'&&r)ids=ids.filter(id=>r.members.includes(id)||isIn(id));
 const arr=ids.filter(id=>emp(id)).map(id=>({id,name:nm(id),crew:(emp(id)||{}).crew||'',total:m[id]}));
 arr.sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
 arr.forEach((x,i)=>{x.rank=i&&arr[i-1].total===x.total?arr[i-1].rank:i+1;});
 return arr;
}
function lifetimeMap(){const m={};S.ledger.forEach(l=>{m[l.empId]=(m[l.empId]||0)+l.pts;});return m;}
function rosterPtsMap(rid){const m={};S.ledger.forEach(l=>{if(l.rosterId===rid&&!l.cleared)m[l.empId]=(m[l.empId]||0)+l.pts;});return m;}
function allTime(){
 const m={};
 S.ledger.forEach(l=>{const r=m[l.empId]=m[l.empId]||{id:l.empId,total:0,sessions:0};r.total+=l.pts;r.sessions++;});
 SB.forEach(x=>{const r=m[x.id]=m[x.id]||{id:x.id,total:0,sessions:0};r.total+=x.total;r.sessions++;});
 return Object.values(m).filter(r=>emp(r.id)).sort((a,b)=>b.total-a.total);
}

function tabsHTML(){
 const openQs=S.qa.filter(q=>q.status==='open').length;
 const t=(id,label,ct)=>`<button class="tab ${S.activeTab===id?'on':''}" data-act="tab" data-arg="${id}">${label}${ct?`<span class="ct">${ct}</span>`:''}</button>`;
 return t('join','Join',S.participants.length)+t('quiz','Quiz')+t('words','Word Cloud')+t('wheel','Random Wheel')+t('qa','Q&amp;A',openQs)+t('timer','Timer')+t('board','Leaderboard')+
  `<span class="tabsep"></span><span class="tabgroup">Back end</span>${t('reports','Reports')}${t('trainings','Trainings')}${t('rosters','Rosters')}`;
}

function stageHTML(){
 switch(S.activeTab){
  case 'join':return joinHTML();
  case 'quiz':return quizHTML();
  case 'words':return wordsHTML();
  case 'wheel':return wheelHTML();
  case 'qa':return qaHTML();
  case 'timer':return timerHTML();
  case 'board':return boardHTML();
  case 'reports':return reportsHTML();
  case 'rosters':return rostersHTML();
  case 'trainings':return trainingsHTML();
 }
 return '';
}

function setupHTML(){
 const sm=S.session.moduleId,sr=S.session.rosterId,m=mod(sm),r=ros(sr);
 let info='Pick a training to load its questions, and a roster to see who is missing.';
 if(m)info=`<b>${esc(m.name)}</b>: ${m.questions.length} questions · ${+m.pass?'pass at '+m.pass+'%':'attendance counts as complete'} · ${+m.expires?'expires '+m.expires+' months after completion':'no expiration'}`;
 return `${ui.pendingModule!=null?`<div class="warn">Switching trainings replaces today's quiz and clears the answers so far. <button class="btn sm o" data-act="applyModule" data-arg="${esc(ui.pendingModule)}">Switch anyway</button><button class="btn sm g" data-act="cancelModule">Keep current</button></div>`:''}
 <div class="setup adminonly">
  <div class="fld"><label for="selMod">Training</label><select id="selMod" data-change="setModule"><option value="">No training (open session)</option>${S.modules.map(x=>`<option value="${x.id}" ${x.id===sm?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
  <div class="fld"><label for="selRos">Roster</label><select id="selRos" data-change="setRoster"><option value="">No roster (anyone can join)</option>${S.rosters.map(x=>`<option value="${x.id}" ${x.id===sr?'selected':''}>${esc(x.name)} (${x.members.length})</option>`).join('')}</select></div>
  <div class="info">${info}</div>
 </div>`;
}
function joinHTML(){
 const ps=S.participants.slice().reverse(),r=ros(S.session.rosterId);
 let right;
 if(r){
  const here=r.members.filter(isIn),away=r.members.filter(id=>!isIn(id)),walk=S.participants.filter(p=>!r.members.includes(p.id));
  right=`<div class="row between wrap"><div><div class="bigcount">${here.length}<span style="font-size:28px;color:var(--muted)"> / ${r.members.length}</span></div><div class="muted">${esc(r.name)} checked in</div></div>${walk.length?`<span class="badge off">${walk.length} not on this roster</span>`:''}</div>
   <div class="chips">${ps.filter(p=>r.members.includes(p.id)).map(p=>`<span class="chip${fresh('c'+p.id+p.t)}" title="${esc(nm(p.id))}">${esc(short(p.id))}</span>`).join('')}${walk.map(p=>`<span class="chip walk${fresh('c'+p.id+p.t)}" title="Not on this roster. They will be added when you save.">${esc(short(p.id))} +</span>`).join('')}</div>
   ${away.length?`<div class="sub adminonly">Not here yet (${away.length})</div><div class="chips adminonly">${away.map(id=>`<span class="chip away">${esc(short(id))}</span>`).join('')}</div>`:''}`;
 }else{
  right=`<div class="row between wrap"><div><div class="bigcount">${ps.length}</div><div class="muted">checked in</div></div><div class="muted sm">${S.people.length} employees in the system</div></div>
   <div class="chips">${ps.map(p=>`<span class="chip${fresh('c'+p.id+p.t)}" title="${esc(nm(p.id))} · ${esc(p.id)}">${esc(short(p.id))}</span>`).join('')||'<p class="muted">Nobody yet. Ask everyone to point their phone camera at the code.</p>'}</div>
   ${ps.length?`<div class="adminonly" style="margin-top:14px"><button class="btn g sm" data-act="rosterFromCheckins">Save this group as a roster</button></div>`:''}`;
 }
 return `${setupHTML()}<div class="join">
 <div class="card qrcard">
  <input class="title-in" id="sTitle" data-bind="S.title" value="${esc(S.title)}" aria-label="Session title">
  <div class="qrbox">${qrImg?`<img src="${qrImg}" alt="QR code to join">`:`<div class="qrfallback">QR code</div>`}</div>
  <div class="scan">Scan to join</div>
  <div class="muted">or go to <b>${esc(location.host)}/join</b> and enter</div>
  <div class="code">${esc(S.code)}</div>
  <div class="note">Point your phone camera at the code. No app or account needed, just your employee ID.</div>
 </div>
 <div class="card">${right}</div></div>`;
}

function qStats(q){const ans=S.quiz.answers[q.id]||{};const v=Object.values(ans);return {n:v.length,right:v.filter(x=>x===q.correct).length};}
function quizHTML(){
 const Q=S.quiz,qs=Q.questions,cur=curQ();
 const list=qs.map((q,i)=>{const st=qStats(q);return `<button class="qitem ${q.id===Q.current?'on':''}" data-act="qSelect" data-arg="${q.id}"><span class="qn">${i+1}</span><span class="qt">${esc(q.text)}</span><span class="qtag">${esc(q.topic)}</span>${st.n?`<span class="qdone">${pct(st.right,st.n)}% correct · ${st.n} answers</span>`:''}</button>`;}).join('');
 const nq=ui.newQ;
 const add=ui.addOpen?`<div class="card addform">
   <h3>Add a question</h3>
   <textarea id="nqText" rows="3" data-bind="ui.newQ.text" placeholder="Question">${esc(nq.text)}</textarea>
   ${[0,1,2,3].map(i=>`<input id="nqO${i}" data-bind="ui.newQ.o${i}" value="${esc(nq['o'+i])}" placeholder="Answer ${LETTERS[i]}${i>1?' (optional)':''}">`).join('')}
   <div class="row"><label class="sm" style="white-space:nowrap">Correct</label><select id="nqC" data-bind="ui.newQ.correct">${[0,1,2,3].map(i=>`<option value="${i}" ${nq.correct==i?'selected':''}>${LETTERS[i]}</option>`).join('')}</select></div>
   <select id="nqT" data-bind="ui.newQ.topic">${TOPICS.map(t=>`<option ${nq.topic===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
   <div class="row"><button class="btn sm" data-act="qAdd">Save question</button><button class="btn g sm" data-act="qToggleAdd">Cancel</button></div>
  </div>`:`<button class="qadd" data-act="qToggleAdd">+ Add a question</button>`;
 let main;
 if(!cur){
  main=`<div class="empty"><div><h3>Pick a question to get started</h3><p>Choose one on the left. It stays hidden until you hit <b>Release</b>, then it pops up on every phone.</p></div></div>`;
 }else{
  const idx=qs.indexOf(cur),ans=Q.answers[cur.id]||{},counts=[0,0,0,0];
  Object.values(ans).forEach(v=>counts[v]++);
  const total=Object.keys(ans).length,n=S.participants.length,show=Q.state==='revealed'||ui.showLive;
  const opts=cur.options.map((o,i)=>`<div class="opt ${Q.state==='revealed'?(i===cur.correct?'right':'dim'):''}" style="--c:${COLORS[i]}">
    ${show?`<div class="obar" style="width:${total?counts[i]/total*100:0}%"></div>`:''}
    <span class="shape">${SHAPES[i]}</span><span class="otext">${esc(o)}</span>${show?`<span class="ocount">${counts[i]}</span>`:''}</div>`).join('');
  const state=Q.state==='open'?`<span class="state live"><span class="dot"></span>Live on phones</span>`:Q.state==='revealed'?`<span class="state">Answer revealed · ${pct(counts[cur.correct],total)}% got it right</span>`:`<span class="state muted">Not released yet</span>`;
  let btns='';
  if(Q.state==='ready'||Q.state==='idle')btns=`<button class="btn o lg" data-act="qRelease">Release question</button>`;
  else if(Q.state==='open')btns=`<button class="btn lg" data-act="qReveal">Close &amp; reveal answer</button>`;
  else btns=(idx<qs.length-1?`<button class="btn o lg" data-act="qNext">Next question</button>`:`<button class="btn o lg" data-act="tab" data-arg="reports">See results in Reports</button>`)+`<button class="btn g lg" data-act="tab" data-arg="board">Leaderboard</button>`;
  main=`<div class="qhead"><div class="row"><span class="tag">Question ${idx+1} of ${qs.length}</span><span class="tag">${esc(cur.topic)}</span></div>${state}</div>
   <div class="qtext">${esc(cur.text)}</div>
   <div class="opts">${opts}</div>
   <div class="qfoot">${btns}
    <div class="prog"><div class="row between sm"><span><b>${total}</b> of ${n} answered</span>${Q.state!=='revealed'?`<button class="linkbtn adminonly" data-act="qLive">${ui.showLive?'Hide live results':'Peek at live results'}</button>`:''}</div><div class="progbar"><div style="width:${n?Math.min(100,total/n*100):0}%"></div></div></div>
    <button class="btn g sm adminonly" data-act="qDel" data-arg="${cur.id}" title="Delete this question">Delete</button>
   </div>`;
 }
 return `<div class="quiz"><div class="qlist">${list}${add}</div><div class="card qmain">${main}</div></div>`;
}

function wordsHTML(){
 const W=S.words,map={};
 W.items.forEach(w=>{const k=norm(w.text);if(W.hidden.includes(k))return;(map[k]=map[k]||{text:w.text.trim(),k,c:0}).c++;});
 const arr=Object.values(map).sort((a,b)=>b.c-a.c),max=arr.length?arr[0].c:1,laid=[];
 arr.forEach((w,i)=>{i%2?laid.unshift(w):laid.push(w);});
 const contributors=new Set(W.items.map(w=>w.empId)).size;
 return `<div class="card">
  <input class="prompt-in" id="wPrompt" data-bind="S.words.prompt" value="${esc(W.prompt)}" aria-label="Word cloud prompt">
  <div class="wordtop">
   <span class="badge ${W.open?'on':'off'}">${W.open?'<span class="dot"></span>Open for answers':'Closed'}</span>
   <span class="muted sm">${W.items.length} responses from ${contributors} people</span>
   <span style="flex:1"></span>
   <button class="btn sm ${W.open?'g':'o'}" data-act="wOpen">${W.open?'Close answers':'Open answers'}</button>
   <button class="btn g sm adminonly" data-act="wClear">Clear</button>
   ${W.hidden.length?`<button class="btn g sm adminonly" data-act="wUnhide">Show ${W.hidden.length} hidden</button>`:''}
  </div>
  <div class="cloud">${laid.map((w,i)=>`<span class="word${fresh('w'+w.k)}" data-act="wHide" data-arg="${esc(w.k)}" title="${w.c} × · click to hide" style="font-size:${Math.round(18+58*(w.c/max))}px;color:${CLOUD_COL[(arr.indexOf(w))%CLOUD_COL.length]}">${esc(w.text)}</span>`).join('')||'<span class="muted">Words show up here as people send them. Bigger means more people said it.</span>'}</div>
  <div class="muted sm adminonly">Click any word to hide it from the screen.</div>
 </div>`;
}

function wheelPool(){const r=ros(S.session.rosterId);let ids=S.wheel.pool==='checked'?S.participants.map(p=>p.id):S.wheel.pool==='roster'&&r?r.members.slice():S.people.map(e=>e.id);if(S.wheel.remove)ids=ids.filter(id=>!S.wheel.winners.includes(id));return ids;}
function wheelHTML(){
 const W=S.wheel,pool=wheelPool(),last=W.last,le=last&&emp(last);
 return `<div class="wheelwrap">
  <div class="wheelbox"><canvas id="wheel" width="1040" height="1040"></canvas><div class="pointer"></div></div>
  <div class="wheelside">
   ${last&&!ui.spinning?`<div class="winner${fresh('win'+last+W.winners.length)}"><div class="muted sm">Picked</div><div class="wname">${esc(nm(last))}</div><div class="muted sm">${esc(le?le.crew:'')} · ID ${esc(last)}</div></div>`:''}
   <button class="btn o lg block" data-act="spin" ${ui.spinning||!pool.length?'disabled':''}>${ui.spinning?'Spinning...':'Spin the wheel'}</button>
   <div class="card adminonly" style="display:flex;flex-direction:column;gap:10px">
    <label class="sm muted">Who's on the wheel</label>
    <select id="wPool" data-bind="S.wheel.pool"><option value="checked" ${W.pool==='checked'?'selected':''}>Checked-in employees (${S.participants.length})</option>${ros(S.session.rosterId)?`<option value="roster" ${W.pool==='roster'?'selected':''}>Everyone on ${esc(ros(S.session.rosterId).name)} (${ros(S.session.rosterId).members.length})</option>`:''}<option value="all" ${W.pool==='all'?'selected':''}>Every employee (${S.people.length})</option></select>
    <label class="chk"><input type="checkbox" id="wRem" data-bind="S.wheel.remove" ${W.remove?'checked':''}> Take winners off the wheel</label>
    <div class="muted sm">${pool.length} names on the wheel</div>
   </div>
   ${W.winners.length?`<div class="card adminonly"><div class="row between"><h3>Picked this session</h3><button class="linkbtn" data-act="wheelClear">Clear</button></div><div class="wlist">${W.winners.slice().reverse().map(id=>`<div>${esc(nm(id))} <span class="muted">· ${esc(id)}</span></div>`).join('')}</div></div>`:''}
  </div></div>`;
}
function drawWheel(){
 const c=document.getElementById('wheel');if(!c)return;
 const ctx=c.getContext('2d'),W=c.width,cx=W/2,cy=W/2,R=W/2-10;
 ctx.clearRect(0,0,W,W);
 const ids=ui.spinPool||wheelPool(),n=ids.length;
 if(!n){ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.fillStyle='#E3E8F0';ctx.fill();ctx.fillStyle='#5B6782';ctx.font='600 40px Barlow, sans-serif';ctx.textAlign='center';ctx.fillText('No names on the wheel yet',cx,cy+14);return;}
 const seg=Math.PI*2/n,fs=Math.max(17,Math.min(40,1100/n));
 for(let i=0;i<n;i++){
  const st=ui.wheelRot+i*seg;let col=WHEEL_PAL[i%WHEEL_PAL.length];
  if(i===n-1&&n>1&&i%WHEEL_PAL.length===0)col=WHEEL_PAL[2];
  ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,R,st,st+seg);ctx.closePath();ctx.fillStyle=col;ctx.fill();
  if(n<120){ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=2;ctx.stroke();}
  ctx.save();ctx.translate(cx,cy);ctx.rotate(st+seg/2);ctx.textAlign='right';ctx.fillStyle='#fff';ctx.font=`600 ${fs}px Barlow, sans-serif`;
  ctx.fillText(short(ids[i]),R-22,fs/3);ctx.restore();
 }
 ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.lineWidth=10;ctx.strokeStyle='#0D1F3C';ctx.stroke();
 ctx.beginPath();ctx.arc(cx,cy,74,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=8;ctx.strokeStyle='#E8621A';ctx.stroke();
 ctx.fillStyle='#0D1F3C';ctx.font='700 44px "Barlow Condensed", sans-serif';ctx.textAlign='center';ctx.fillText('KE&G',cx,cy+15);
}

function qaHTML(){
 const f=ui.qaFilter,all=S.qa.filter(q=>q.status!=='hidden');
 const list=all.filter(q=>f==='all'||q.status===f).sort((a,b)=>b.t-a.t);
 const spot=S.qa.find(q=>q.id===S.qaSpot);
 const cnt=s=>all.filter(q=>q.status===s).length;
 return `${spot?`<div class="spot"><div class="lbl">On screen now</div><div class="stxt">${esc(spot.text)}</div><div class="who">${spot.anon?'Asked anonymously':'Asked by '+esc(nm(spot.empId))}</div></div>`:''}
 <div class="filters"><button class="fbtn ${f==='open'?'on':''}" data-act="qaFilter" data-arg="open">Open (${cnt('open')})</button><button class="fbtn ${f==='answered'?'on':''}" data-act="qaFilter" data-arg="answered">Answered (${cnt('answered')})</button><button class="fbtn ${f==='all'?'on':''}" data-act="qaFilter" data-arg="all">All (${all.length})</button></div>
 ${list.map(q=>`<div class="qaitem ${q.status==='answered'?'done':''}${fresh('q'+q.id)}">
   <div class="qx"><div class="qq">${esc(q.text)}</div><div class="meta">${q.anon?'Anonymous':esc(nm(q.empId))} · ${ago(q.t)} · <span class="tag">${esc(topicOf(q.text))}</span></div></div>
   <div class="qaacts"><button class="btn sm ${S.qaSpot===q.id?'o':'g'}" data-act="qaSpot" data-arg="${q.id}">${S.qaSpot===q.id?'Take off screen':'Show on screen'}</button>
   <button class="btn g sm" data-act="qaDone" data-arg="${q.id}">${q.status==='answered'?'Reopen':'Mark answered'}</button>
   <button class="btn g sm adminonly" data-act="qaHide" data-arg="${q.id}" title="Hide this question">Hide</button></div>
  </div>`).join('')||`<div class="card empty" style="min-height:220px"><div><h3>No questions here yet</h3><p>Employees can send a question any time from the Ask tab on their phone. Try it on the phone in the test panel.</p></div></div>`}`;
}

function timerHTML(){
 const running=!!S.timer.endsAt;
 return `<div class="card" style="padding:40px 20px">
  <div class="tdigits big">${fmt(trem())}</div>
  <div class="tctl">${running?`<button class="btn lg" data-act="tPause">Pause</button>`:`<button class="btn o lg" data-act="tStart" ${trem()<=0?'disabled':''}>Start</button>`}<button class="btn g lg" data-act="tReset">Reset</button></div>
  <div class="tctl">${[1,2,3,5,10,15].map(m=>`<button class="btn g sm" data-act="tSet" data-arg="${m}">${m} min</button>`).join('')}</div>
 </div>`;
}

function boardHTML(){
 const scope=(ui.boardScope==='roster'&&!ros(S.session.rosterId))?'session':ui.boardScope,sb=standings(scope),max=sb.length?Math.max(1,sb[0].total):1,P=S.pts,live=scope==='session';
 const r=ros(S.session.rosterId);
 const scopes=`<div class="filters"><button class="fbtn ${scope==='session'?'on':''}" data-act="boardScope" data-arg="session">Today</button>${r?`<button class="fbtn ${scope==='roster'?'on':''}" data-act="boardScope" data-arg="roster">${esc(r.name)}</button>`:''}<button class="fbtn ${scope==='all'?'on':''}" data-act="boardScope" data-arg="all">All-time</button></div>`;
 const pod=(r,cls)=>r?`<div class="pod ${cls}${fresh('p'+cls+r.id)}"><div class="pr">#${r.rank}</div><div class="pn">${esc(r.name)}</div><div class="pc">${esc(r.crew)}</div><div class="pp">${r.total}<small> pts</small></div></div>`:'<div></div>';
 const rest=ui.boardAll?sb.slice(3):sb.slice(3,10);
 const lrow=r=>`<div class="lrow"><div class="lrank">${r.rank}</div><div class="lname">${esc(r.name)}<small>${esc(r.crew)}${live?` · ${r.correct}/${r.answered} correct`:''}</small></div><div class="ltr"><div style="width:${Math.max(0,r.total)/max*100}%"></div></div><div class="lpts">${r.total}</div>
   <div class="lacts" ${live?'':'style="visibility:hidden"'}><button data-act="bonus" data-arg="${r.id}|10" title="Give 10 bonus points">+10</button><button data-act="bonus" data-arg="${r.id}|25" title="Give 25 bonus points">+25</button><button data-act="bonus" data-arg="${r.id}|-10" title="Take away 10 points">−10</button></div></div>`;
 const rule=(k,label,hint)=>`<label><span>${label}${hint?`<small>${hint}</small>`:''}</span><input type="number" min="0" step="5" id="pt_${k}" data-bind="S.pts.${k}" value="${esc(P[k])}"></label>`;
 return `<div class="board"><div>${scopes}
  ${sb.length?`<div class="podium">${pod(sb[1],'r2')}${pod(sb[0],'r1')}${pod(sb[2],'r3')}</div>
  <div class="card">${sb.slice(0,3).map(lrow).join('')}${rest.map(lrow).join('')}
   <div class="row between" style="margin-top:10px"><span class="muted sm">${sb.length} people with points</span>${sb.length>10?`<button class="linkbtn" data-act="boardAll">${ui.boardAll?'Show top 10':'Show everyone'}</button>`:''}</div>
  </div>`:`<div class="card empty"><div><h3>No points yet</h3><p>Points start the moment people check in.</p></div></div>`}
 </div>
 <div class="adminonly" style="display:flex;flex-direction:column;gap:14px">
  <div class="card"><h3>How points work</h3>${isAdmin()?'':'<div class="muted sm" style="margin-bottom:8px">Only admins can change the point rules.</div>'}<fieldset class="fs" ${isAdmin()?'':'disabled'}><div class="rules">
   ${rule('checkin','Checking in')}
   ${rule('answer','Answering a question','Right or wrong')}
   ${rule('correct','Correct answer')}
   ${rule('speed','Speed bonus, max','Faster answers get more, over 20 seconds')}
   ${rule('word','Each word sent')}
   ${rule('wordCap','Word limit per person','Stops people spamming for points')}
   ${rule('ask','Asking a question','Hidden questions don\'t count')}
  </div></fieldset><div class="aihint">Use the +10 and +25 buttons to reward people who speak up in the room. Changing a rule updates everyone's score right away.</div></div>
  <button class="btn g" data-act="copyCsv" data-arg="points">Copy today's points as CSV</button>
  <div class="aihint">Points follow the person, not the roster. Someone on three rosters has one account and one lifetime total. Clearing a roster's points (Rosters tab) resets that roster's standings only.</div>
 </div></div>`;
}

function qMeta(qid){return S.quiz.questions.find(q=>q.id===qid)||{text:qid,topic:'Other'};}
function questionStats(){
 const m={};
 S.history.forEach(h=>h.qs.forEach(q=>{const meta=q.text?q:qMeta(q.qid);const r=m[q.qid]=m[q.qid]||{qid:q.qid,text:meta.text,topic:meta.topic,asked:0,missed:0};r.asked+=q.asked;r.missed+=q.missed;}));
 S.quiz.questions.forEach(q=>{const st=qStats(q);if(!st.n)return;const r=m[q.id]=m[q.id]||{qid:q.id,text:q.text,topic:q.topic,asked:0,missed:0};r.asked+=st.n;r.missed+=st.n-st.right;});
 return Object.values(m).filter(r=>r.asked).sort((a,b)=>b.missed/b.asked-a.missed/a.asked);
}
function askedList(){
 const out=[];
 S.history.forEach(h=>h.qa.forEach(t=>out.push({text:t,when:h.date})));
 S.qa.filter(q=>q.status!=='hidden').forEach(q=>out.push({text:q.text,when:'Today'}));
 return out;
}
function reportsHTML(){
 const qs=questionStats(),asked=askedList();
 const sessions=S.history.length+(S.participants.length?1:0);
 const reached=S.history.reduce((a,h)=>a+h.n,0)+S.participants.length;
 const totA=qs.reduce((a,r)=>a+r.asked,0),totM=qs.reduce((a,r)=>a+r.missed,0);
 const byTopic={};asked.forEach(a=>{const t=topicOf(a.text);(byTopic[t]=byTopic[t]||[]).push(a.text);});
 const topics=Object.entries(byTopic).sort((a,b)=>b[1].length-a[1].length),tmax=topics.length?topics[0][1].length:1;
 const col=p=>p>=40?'#B3261E':p>=25?'#E8621A':'#2E7D5B';
 return `<div class="row between wrap" style="margin-bottom:14px"><h2 style="margin:0">Training reports</h2><span class="sample">Includes made-up sample history</span></div>
 <div class="tiles">
  <div class="tile"><div class="v">${sessions}</div><div class="l">Sessions run</div></div>
  <div class="tile"><div class="v">${reached}</div><div class="l">Check-ins</div></div>
  <div class="tile"><div class="v">${totA}</div><div class="l">Quiz answers</div></div>
  <div class="tile"><div class="v">${pct(totA-totM,totA)}%</div><div class="l">Answered correctly</div></div>
 </div>
 <div class="rgrid">
  <div class="card"><div class="row between"><h3>Most missed questions</h3><button class="btn g sm" data-act="copyCsv" data-arg="missed">Copy CSV</button></div>
   ${qs.map(r=>{const p=pct(r.missed,r.asked);return `<div class="mrow"><div class="mt">${esc(r.text)}</div><div class="mbar"><span class="tag">${esc(r.topic)}</span><div class="tr"><div style="width:${p}%;background:${col(p)}"></div></div><span class="pv" style="color:${col(p)}">${p}%</span></div><div class="muted sm">${r.missed} of ${r.asked} missed</div></div>`;}).join('')||'<p class="muted">No quiz answers yet.</p>'}
  </div>
  <div class="card"><div class="row between"><h3>What people are asking about</h3><button class="btn g sm" data-act="copyCsv" data-arg="asked">Copy CSV</button></div>
   ${topics.map(([t,list])=>`<div class="mrow"><div class="mbar" style="margin-top:0"><span class="mt" style="width:190px">${esc(t)}</span><div class="tr"><div style="width:${list.length/tmax*100}%;background:#103F91"></div></div><span class="pv">${list.length}</span></div><ul class="ex">${[...new Set(list)].slice(0,3).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')||'<p class="muted">No questions asked yet.</p>'}
   <div class="aihint">The prototype sorts questions by keyword. The full build would use AI to group similar questions, even when they're worded differently or asked in Spanish.</div>
  </div>
 </div>
 <div class="card" style="margin-top:18px"><div class="row between"><h3>All-time points leaders</h3><button class="btn g sm" data-act="copyCsv" data-arg="alltime">Copy CSV</button></div>
  <table><thead><tr><th>Rank</th><th>Name</th><th>Crew</th><th>Sessions</th><th>Total points</th></tr></thead><tbody>
  ${allTime().slice(0,10).map((r,i)=>`<tr><td><b>${i+1}</b></td><td>${esc(nm(r.id))}</td><td>${esc((emp(r.id)||{}).crew||'')}</td><td>${r.sessions}</td><td><b>${r.total}</b></td></tr>`).join('')||'<tr><td colspan="5" class="muted">No points yet.</td></tr>'}
  </tbody></table><div class="aihint">Handy for a quarterly prize. Points carry over every time you click End &amp; save session.</div></div>
 <div class="card" style="margin-top:18px"><div class="row between"><h3>Sessions</h3><button class="btn g sm" data-act="copyCsv" data-arg="attendance">Copy today's attendance</button></div>
  <table><thead><tr><th>Date</th><th>Session</th><th>Training</th><th>Roster</th><th>Checked in</th><th>Quiz questions</th><th>Questions asked</th></tr></thead><tbody>
  <tr><td><b>Today</b></td><td>${esc(S.title)} <span class="tag">Live</span></td><td>${esc((mod(S.session.moduleId)||{}).name||'')}</td><td>${esc((ros(S.session.rosterId)||{}).name||'')}</td><td>${S.participants.length}</td><td>${S.quiz.questions.filter(q=>qStats(q).n).length}</td><td>${S.qa.filter(q=>q.status!=='hidden').length}</td></tr>
  ${S.history.slice().sort((a,b)=>a.date<b.date?1:-1).map(h=>`<tr><td>${esc(fmtDate(h.date))}</td><td>${esc(h.title)}</td><td>${esc((mod(h.moduleId)||{}).name||'')}</td><td>${esc((ros(h.rosterId)||{}).name||'')}</td><td>${h.n}</td><td>${h.qs.length}</td><td>${h.qa.length}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function rostersHTML(){
 const sel=ui.rosterSel,LM=latestMap(),life=lifetimeMap();
 const list=`<div class="lcards">
  <button class="lcard ${sel==='all'?'on':''}" data-act="rosterSel" data-arg="all"><b>All employees</b><span>${S.people.length} people · one profile each</span></button>
  ${S.rosters.map(r=>`<button class="lcard ${sel===r.id?'on':''}" data-act="rosterSel" data-arg="${r.id}"><b>${esc(r.name)}</b><span>${r.members.length} people${S.session.rosterId===r.id?' · in use today':''}</span></button>`).join('')}
  <button class="lcard addnew" data-act="rosterSel" data-arg="new">+ New roster</button></div>`;
 let main;
 if(sel==='new'){
  main=`<div class="card" style="display:flex;flex-direction:column;gap:10px"><h3>Build a new roster</h3>
   <input id="nrName" data-bind="ui.newRoster.name" value="${esc(ui.newRoster.name)}" placeholder="Roster name, like Fleet Drivers or Q1 New Hires">
   <div class="muted sm">Paste from Excel or upload a CSV with columns: Employee ID, Name, Crew. Anyone whose ID is already in the system keeps their existing profile and points. Only new IDs get a new profile.</div>
   <textarea id="rCsv" rows="8" data-bind="ui.csv" placeholder="10101, Jane Doe, Utility&#10;10005, Rosa Ortega, Mining">${esc(ui.csv)}</textarea>
   <input type="file" id="rFile" accept=".csv,.txt">
   <div class="row wrap"><button class="btn" data-act="rosterCreate">Create roster</button>${S.participants.length?`<button class="btn g" data-act="rosterFromCheckins">Use today's ${S.participants.length} check-ins instead</button>`:''}</div>
  </div>`;
 }else if(sel==='all'){
  const q=norm(ui.rosterQ),rows=S.people.filter(e=>!q||norm(e.name+' '+e.id+' '+e.crew).includes(q));
  const o=ui.one;
  main=`<div class="rost"><div class="card"><div class="row between wrap" style="margin-bottom:10px"><h3 style="margin:0">All employees <span class="muted" style="font-family:Barlow;font-size:14px;font-weight:500">${S.people.length}</span></h3><input id="rQ" data-bind="ui.rosterQ" data-live="1" value="${esc(ui.rosterQ)}" placeholder="Search name, ID or crew" style="max-width:240px"></div>
   <div class="rtable"><table><thead><tr><th>ID</th><th>Name</th><th>Crew</th><th>Rosters</th><th>Lifetime pts</th><th>Trainings</th></tr></thead><tbody>
   ${rows.map(e=>`<tr><td>${esc(e.id)}</td><td>${esc(e.name)}</td><td>${esc(e.crew||'')}</td><td class="sm">${S.rosters.filter(r=>r.members.includes(e.id)).map(r=>esc(r.name)).join(', ')||'<span class="muted">None</span>'}</td><td><b>${life[e.id]||0}</b></td><td><div class="mchips">${personChips(e.id,LM)||'<span class="muted sm">None yet</span>'}</div></td></tr>`).join('')}
   </tbody></table></div></div>
   <div class="card" style="display:flex;flex-direction:column;gap:8px"><h3>Add one person</h3>
    <input id="oId" data-bind="ui.one.id" value="${esc(o.id)}" placeholder="Employee ID">
    <input id="oName" data-bind="ui.one.name" value="${esc(o.name)}" placeholder="Full name">
    <input id="oCrew" data-bind="ui.one.crew" value="${esc(o.crew)}" placeholder="Crew or division (optional)">
    <button class="btn sm" data-act="rosterAddOne">Add</button>
    <div class="syncnote">Later, this list comes straight from BDL People so nobody has to type it in.</div>
   </div></div>`;
 }else{
  const r=ros(sel);if(!r){ui.rosterSel='all';return rostersHTML();}
  const ri=S.rosters.indexOf(r),rp=rosterPtsMap(r.id),tot=r.members.reduce((a,id)=>a+(rp[id]||0),0);
  const trained=new Set(S.completions.filter(c=>c.rosterId===r.id).map(c=>c.moduleId));
  main=`<div class="card">
   <div class="dhead"><input class="title-in" id="rName" data-bind="S.rosters.${ri}.name" value="${esc(r.name)}" aria-label="Roster name">
    ${S.session.rosterId===r.id?'<span class="badge on">In use today</span>':`<button class="btn sm o" data-act="useRoster" data-arg="${r.id}">Use for today's session</button>`}</div>
   <div class="stats"><div><b>${r.members.length}</b>people</div><div><b>${tot}</b>roster points</div><div><b>${trained.size}</b>trainings run</div><div><b>${fmtDate(r.created)}</b>created</div>${r.clearedAt?`<div><b>${fmtDate(r.clearedAt)}</b>points last cleared</div>`:''}</div>
   <div class="row wrap" style="margin-bottom:12px"><button class="btn g sm" data-act="toggleAddMembers">${ui.addMembers?'Close':'Add people'}</button>${cbtn('clearRosterPts:'+r.id,'Clear points for this roster','g',r.id)}<button class="btn g sm" data-act="copyCsv" data-arg="roster">Copy roster CSV</button>${isAdmin()?cbtn('deleteRoster:'+r.id,'Delete roster','g',r.id):''}</div>
   ${ui.addMembers?`<div class="card" style="background:#F7F9FC;display:flex;flex-direction:column;gap:8px;margin-bottom:12px"><div class="muted sm">Paste or upload Employee ID, Name, Crew. Existing IDs keep their profile and points.</div><textarea id="rCsv" rows="5" data-bind="ui.csv">${esc(ui.csv)}</textarea><input type="file" id="rFile" accept=".csv,.txt"><div><button class="btn sm" data-act="rosterAddMembers" data-arg="${r.id}">Add to ${esc(r.name)}</button></div></div>`:''}
   <div class="rtable"><table><thead><tr><th>ID</th><th>Name</th><th>Crew</th><th>Roster pts</th><th>Lifetime pts</th><th>Trainings</th><th></th></tr></thead><tbody>
   ${r.members.map(id=>{const e=emp(id)||{name:'ID '+id};return `<tr><td>${esc(id)}</td><td>${esc(e.name)}</td><td>${esc(e.crew||'')}</td><td><b>${rp[id]||0}</b></td><td>${life[id]||0}</td><td><div class="mchips">${personChips(id,LM)||'<span class="muted sm">None yet</span>'}</div></td><td><button class="xbtn" data-act="removeMember" data-arg="${r.id}|${id}" title="Remove from this roster">\u00d7</button></td></tr>`;}).join('')||'<tr><td colspan="7" class="muted">No one on this roster yet.</td></tr>'}
   </tbody></table></div>
   <div class="aihint">Clearing points resets this roster's standings. Everyone keeps their lifetime points and their points on other rosters.</div>
  </div>`;
 }
 return `<div class="split2">${list}${main}</div>`;
}

function recordRows(){
 const LM=latestMap(),f=ui.trF,rr=ros(f.ros);
 return Object.values(LM).filter(c=>(!f.mod||c.moduleId===f.mod)&&(!rr||rr.members.includes(c.empId))&&(!f.st||cStatus(c).k===f.st)&&emp(c.empId))
  .sort((a,b)=>{const o={expired:0,retake:1,soon:2,ok:3};const ka=o[cStatus(a).k],kb=o[cStatus(b).k];return ka-kb||(a.expires||'9').localeCompare(b.expires||'9')||nm(a.empId).localeCompare(nm(b.empId));});
}
function trainingsHTML(){
 const sub=ui.trSub;
 const tabs=`<div class="subtabs"><button class="fbtn ${sub==='records'?'on':''}" data-act="trSub" data-arg="records">Training records</button><button class="fbtn ${sub==='modules'?'on':''}" data-act="trSub" data-arg="modules">Training modules</button></div>`;
 if(sub==='modules')return tabs+modulesHTML();
 const all=Object.values(latestMap()).filter(c=>emp(c.empId)),cnt=k=>all.filter(c=>cStatus(c).k===k).length,rows=recordRows(),LM=latestMap(),f=ui.trF;
 const matrix=`<table class="matrix"><thead><tr><th>Roster</th>${S.modules.map(m=>`<th>${esc(m.name)}</th>`).join('')}</tr></thead><tbody>
  ${S.rosters.map(r=>`<tr><td><b>${esc(r.name)}</b> <span class="muted sm">${r.members.length}</span></td>${S.modules.map(m=>{const cs=r.members.map(id=>LM[id+'|'+m.id]).filter(Boolean);if(!cs.length)return '<td class="muted">-</td>';const good=cs.filter(c=>['ok','soon'].includes(cStatus(c).k)).length,soon=cs.filter(c=>cStatus(c).k==='soon').length,bad=cs.filter(c=>['expired','retake'].includes(cStatus(c).k)).length;return `<td><b>${good}/${r.members.length}</b> current${soon?`<br><span class="st soon">${soon} expiring</span>`:''}${bad?`<br><span class="st expired">${bad} expired or retake</span>`:''}</td>`;}).join('')}</tr>`).join('')}
 </tbody></table>`;
 return tabs+`<div class="tiles">
  <div class="tile"><div class="v">${all.length}</div><div class="l">Training records on file</div></div>
  <div class="tile"><div class="v" style="color:var(--green)">${cnt('ok')}</div><div class="l">Current</div></div>
  <div class="tile"><div class="v" style="color:var(--orange)">${cnt('soon')}</div><div class="l">Expiring in the next 60 days</div></div>
  <div class="tile"><div class="v" style="color:var(--red)">${cnt('expired')+cnt('retake')}</div><div class="l">Expired or need a retake</div></div>
 </div>
 ${hcssCard()}
 <div class="card" style="margin-bottom:18px"><h3>Roster progress</h3>${matrix}</div>
 <div class="card"><div class="row between wrap"><h3>Who has completed what</h3><button class="btn g sm" data-act="copyCsv" data-arg="records">Copy CSV</button></div>
  <div class="filters2">
   <select id="fMod" data-bind="ui.trF.mod"><option value="">All trainings</option>${S.modules.map(m=>`<option value="${m.id}" ${f.mod===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select>
   <select id="fRos" data-bind="ui.trF.ros"><option value="">All rosters</option>${S.rosters.map(r=>`<option value="${r.id}" ${f.ros===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select>
   <select id="fSt" data-bind="ui.trF.st"><option value="">Any status</option>${[['ok','Current'],['soon','Expiring soon'],['expired','Expired'],['retake','Needs retake']].map(([k,l])=>`<option value="${k}" ${f.st===k?'selected':''}>${l}</option>`).join('')}</select>
  </div>
  <div class="rtable"><table><thead><tr><th>Employee</th><th>ID</th><th>Training</th><th>Completed</th><th>Score</th><th>Expires</th><th>Status</th><th>HCSS</th></tr></thead><tbody>
  ${rows.map(c=>{const st=cStatus(c);return `<tr><td><b>${esc(nm(c.empId))}</b></td><td>${esc(c.empId)}</td><td>${esc((mod(c.moduleId)||{}).name||c.moduleName)}</td><td>${fmtDate(c.date)}</td><td>${c.score==null?'<span class="muted">Attended</span>':c.score+'%'}</td><td>${c.expires?fmtDate(c.expires):c.passed?'<span class="muted">Never</span>':'<span class="muted">-</span>'}</td><td><span class="st ${st.k}">${esc(st.label)}</span></td><td>${c.hcss?`<span class="st ${c.hcss.status==='sent'?'ok':c.hcss.status==='failed'?'expired':'none'}" title="${esc(c.hcss.lastError||'')}">${esc(hcssLabel(c))}</span>`:'<span class="muted sm">-</span>'}</td></tr>`;}).join('')||'<tr><td colspan="8" class="muted">No records match.</td></tr>'}
  </tbody></table></div>
  <div class="syncnote">Shows each person's most recent result per training. Expiration dates are stamped when the training is completed. Passed trainings with an HCSS course code are queued for HCSS Skills.</div>
 </div>`;
}
function modulesHTML(){
 const m=mod(ui.modSel)||S.modules[0];
 const list=`<div class="lcards">${S.modules.map(x=>`<button class="lcard ${m&&x.id===m.id?'on':''}" data-act="modSel" data-arg="${x.id}"><b>${esc(x.name)}</b><span>${x.questions.length} questions · ${+x.expires?'expires in '+(x.expires%12?x.expires+' months':(x.expires/12)+' year'+(x.expires>12?'s':'')):'no expiration'}</span></button>`).join('')}<button class="lcard addnew" data-act="modNew">+ New training module</button></div>`;
 if(!m)return `<div class="split2">${list}<div></div></div>`;
 const mi=S.modules.indexOf(m),nq=ui.mq,done=S.completions.filter(c=>c.moduleId===m.id).length;
 return `<div class="split2">${list}<div class="card">
  <div class="dhead"><input class="title-in" id="mName" data-bind="S.modules.${mi}.name" value="${esc(m.name)}" aria-label="Training name">
   ${S.session.moduleId===m.id?'<span class="badge on">Loaded today</span>':`<button class="btn sm o" data-act="useModule" data-arg="${m.id}">Use for today's session</button>`}</div>
  ${isAdmin()?'':'<div class="warn">Only admins can edit training modules. You can still use any module for a session.</div>'}
  <fieldset class="fs" ${isAdmin()?'':'disabled'}>
  <textarea id="mDesc" rows="2" data-bind="S.modules.${mi}.desc" placeholder="What this training covers and who needs it">${esc(m.desc||'')}</textarea>
  <div class="row wrap" style="margin:12px 0;gap:16px">
   <label class="sm" style="display:flex;flex-direction:column;gap:4px;min-width:200px">Expires after completion<select id="mExp" data-bind="S.modules.${mi}.expires">${[[0,'Never'],[6,'6 months'],[12,'1 year'],[24,'2 years'],[36,'3 years'],[60,'5 years']].map(([v,l])=>`<option value="${v}" ${+m.expires===v?'selected':''}>${l}</option>`).join('')}</select></label>
   <label class="sm" style="display:flex;flex-direction:column;gap:4px;width:200px">Passing score (%)<input type="number" min="0" max="100" step="5" id="mPass" data-bind="S.modules.${mi}.pass" value="${esc(m.pass)}"></label>
   <label class="sm" style="display:flex;flex-direction:column;gap:4px;width:220px">HCSS Skills course code<input id="mHcss" data-bind="S.modules.${mi}.hcssCourseCode" value="${esc(m.hcssCourseCode||'')}" placeholder="Leave blank to keep in Huddle only"></label>
   <div class="muted sm" style="flex:1;min-width:200px;align-self:flex-end">Set the passing score to 0 if showing up is enough. ${done} completion records so far.</div>
  </div>
  <div class="sub">Questions (${m.questions.length})</div>
  ${m.questions.map((q,i)=>`<div class="qline"><span class="qn">${i+1}</span><div class="qx">${esc(q.text)}<small>\u2713 ${esc(q.options[q.correct])}</small><span class="muted sm">${esc(q.topic)}</span></div><button class="xbtn" data-act="modQDel" data-arg="${m.id}|${q.id}" title="Delete question">\u00d7</button></div>`).join('')||'<p class="muted">No questions yet.</p>'}
  <div class="card" style="background:#F7F9FC;display:flex;flex-direction:column;gap:8px;margin-top:14px"><h3 style="margin:0">Add a question</h3>
   <textarea id="mqText" rows="2" data-bind="ui.mq.text" placeholder="Question">${esc(nq.text)}</textarea>
   ${[0,1,2,3].map(i=>`<input id="mqO${i}" data-bind="ui.mq.o${i}" value="${esc(nq['o'+i])}" placeholder="Answer ${LETTERS[i]}${i>1?' (optional)':''}">`).join('')}
   <div class="row"><label class="sm" style="white-space:nowrap">Correct</label><select id="mqC" data-bind="ui.mq.correct">${[0,1,2,3].map(i=>`<option value="${i}" ${nq.correct==i?'selected':''}>${LETTERS[i]}</option>`).join('')}</select><select id="mqT" data-bind="ui.mq.topic">${TOPICS.map(t=>`<option ${nq.topic===t?'selected':''}>${esc(t)}</option>`).join('')}</select></div>
   <div><button class="btn sm" data-act="modQAdd" data-arg="${m.id}">Add to ${esc(m.name)}</button></div>
  </div>
  <div class="row" style="margin-top:14px">${cbtn('modDelete:'+m.id,'Delete this module','g',m.id)}</div>
  </fieldset>
 </div></div>`;
}

function parseCSV(text){
 const out=[];String(text).split(/\r?\n/).forEach(line=>{
  if(!line.trim())return;
  let cells=[];if(line.includes('\t'))cells=line.split('\t');else{let cur='',q=false;for(let k=0;k<line.length;k++){const ch=line[k];if(ch==='"'){if(q&&line[k+1]==='"'){cur+='"';k++;}else q=!q;}else if(ch===','&&!q){cells.push(cur);cur='';}else cur+=ch;}cells.push(cur);}
  cells=cells.map(c=>c.trim());
  if(!cells[0]||/id|employee/i.test(cells[0])&&!/\d/.test(cells[0]))return;
  if(!cells[1])return;
  out.push({id:cells[0],name:cells[1],crew:cells[2]||''});
 });
 return out;
}


function hcssCard(){
 const h=S.hcss||{},q=(h.pending||0)+(h.failed||0);
 const msg=h.mode==='off'?`Not connected yet. ${h.pending||0} passed training${h.pending===1?'':'s'} queued. They send automatically once the HCSS connection is turned on.`
  :h.mode==='mock'?`Test mode. Queued items are marked sent without contacting HCSS.`
  :`Connected. Sends every 15 minutes. ${h.sent||0} sent, ${h.failed||0} failed.`;
 return `<div class="card" style="margin-bottom:18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:260px"><h3 style="margin:0 0 4px">HCSS Skills</h3><div class="muted sm">${esc(msg)}</div></div>
  ${isAdmin()&&h.mode!=='off'&&q?'<button class="btn g sm" data-act="hcssSync">Send now</button>':''}</div>`;
}
/* ---------- shell + render ---------- */
function shell() {
  document.getElementById('root').innerHTML = `
  <header class="topbar"><div class="brand">KE&amp;G <b>Huddle</b></div><div id="hdr"></div></header>
  <div class="app" id="app"><section class="mod"><nav class="tabs" id="tabs"></nav><div class="stage" id="stage"><div class="empty"><div><h3>Loading...</h3></div></div></div></section></div>`;
}
function render() {
  const a = document.activeElement; const fid = a && a.id; let ss = null, se = null, keepVal = null;
  try { ss = a.selectionStart; se = a.selectionEnd; } catch (e) { /* not a text field */ }
  // Keep what the user is typing in a field that saves on blur.
  if (a && a.dataset && a.dataset.bind && a.dataset.bind.startsWith('S.') && a.type !== 'checkbox' && a.tagName !== 'SELECT') keepVal = a.value;
  if (S.code && window.__qrCode !== S.code) makeQR();
  document.getElementById('app').className = 'app ' + (ui.view === 'projector' ? 'projector' : '');
  document.getElementById('hdr').innerHTML = hdrHTML();
  document.getElementById('tabs').innerHTML = tabsHTML();
  document.getElementById('stage').innerHTML = stageHTML();
  if (S.activeTab === 'wheel') drawWheel();
  if (fid) {
    const el = document.getElementById(fid);
    if (el) {
      if (keepVal != null) el.value = keepVal;
      if (el !== document.activeElement) { el.focus(); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) { /* ignore */ } }
    }
  }
}
function hdrHTML() {
  const m = mod(S.session && S.session.moduleId);
  return `<span class="hpill"><span class="dot"></span>Live</span>
  <span class="hpill hide-sm">Session <b>${esc(S.code || '')}</b></span>
  ${m ? `<span class="hpill hide-sm">${esc(m.name)}</span>` : ''}
  <span class="hpill"><b>${(S.participants || []).length}</b>&nbsp;joined</span>
  <button class="hbtn" data-act="refresh" title="Pull the latest data">Refresh</button>
  <button class="hbtn" data-act="view">${ui.view === 'projector' ? 'Exit projector view' : 'Projector view'}</button>
  <button class="hbtn o" data-act="endSession" ${ui.confirm === 'endSession' ? 'style="background:#B3261E;border-color:#B3261E"' : ''}>${ui.confirm === 'endSession' ? 'Click again to save' : 'End &amp; save session'}</button>
  <span class="hpill hide-sm" title="${esc((S.me && S.me.email) || '')}">${esc(((S.me && S.me.email) || '').split('@')[0])} · <a href="/.auth/logout?post_logout_redirect_uri=/" style="color:#fff">Sign out</a></span>`;
}
let qrImg = null;
function makeQR() {
  try {
    if (typeof QRCode === 'undefined') return;
    const box = document.getElementById('qrtmp'); box.innerHTML = '';
    new QRCode(box, { text: `${location.origin}/join/?code=${S.code}`, width: 480, height: 480, colorDark: '#0D1F3C', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    const c = box.querySelector('canvas'); qrImg = c ? c.toDataURL() : null;
    window.__qrCode = S.code;
  } catch (e) { qrImg = null; }
}
function trem() { const t = S.timer || {}; return t.endsAt ? Math.max(0, Math.ceil((t.endsAt - now()) / 1000)) : (t.rem || 0); }
function maybeAnimateSpin() {
  const sp = S.wheel && S.wheel.spin;
  if (seenSpin === undefined) { seenSpin = sp ? sp.id : ''; return; }
  if (!sp || sp.id === seenSpin) return;
  seenSpin = sp.id;
  const ids = sp.pool, n = ids.length, w = ids.indexOf(sp.winner);
  if (!n || w < 0) return;
  const seg = Math.PI * 2 / n, start = ui.wheelRot;
  let target = -Math.PI / 2 - (w + 0.5) * seg; while (target < start + Math.PI * 12) target += Math.PI * 2;
  ui.spinPool = ids; ui.spinning = true;
  const t0 = performance.now(), D = 5200;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / D), ez = 1 - Math.pow(1 - p, 4);
    ui.wheelRot = start + (target - start) * ez; drawWheel();
    if (p < 1) requestAnimationFrame(step); else { ui.wheelRot = target % (Math.PI * 2); ui.spinning = false; render(); }
  };
  requestAnimationFrame(step);
}
/* ---------- actions (every change goes through the API) ---------- */
const ACT = {
  tab: (a) => { if (!ui.spinning) ui.spinPool = null; cmd('setTab', { tab: a }); },
  view: () => { ui.view = ui.view === 'projector' ? 'normal' : 'projector'; render(); },
  refresh: async () => { try { await loadBoot(); LIVE = null; setLive(await api('GET', `manage/sessions/${S.code}/state`)); render(); toast('Up to date'); } catch (e) { toast(e.message); } },
  qSelect: (a) => { ui.showLive = false; cmd('selectQuestion', { qid: a }); },
  qRelease: () => cmd('release'),
  qReveal: () => cmd('reveal'),
  qNext: () => { ui.showLive = false; cmd('next'); },
  qLive: () => { ui.showLive = !ui.showLive; render(); },
  qToggleAdd: () => { ui.addOpen = !ui.addOpen; render(); },
  qAdd: async () => {
    const n = ui.newQ, raw = [0, 1, 2, 3].map((k) => ({ t: String(n['o' + k]).trim(), c: String(k) === String(n.correct) })), opts = raw.filter((o) => o.t);
    const ci = opts.findIndex((o) => o.c);
    if (!n.text.trim() || opts.length < 2) return toast('Add a question and at least two answers');
    if (ci < 0) return toast('The correct answer is blank');
    await cmd('addQuestion', { question: { text: n.text, options: opts.map((o) => o.t), correct: ci, topic: n.topic } });
    ui.newQ = { text: '', o0: '', o1: '', o2: '', o3: '', correct: '0', topic: n.topic }; ui.addOpen = false;
    if (S.session.moduleId) await loadBoot();
    render(); toast(S.session.moduleId ? 'Question added here and to the training module' : 'Question added');
  },
  qDel: (a) => cmd('deleteQuestion', { qid: a }),
  wOpen: () => cmd('wordsOpen', { open: !S.words.open }),
  wClear: () => cmd('wordsClear'),
  wHide: (a) => cmd('hideWord', { key: a }),
  wUnhide: () => cmd('unhideWords'),
  wheelClear: () => { ui.spinPool = null; cmd('wheelClear'); },
  spin: () => { if (!ui.spinning) cmd('spin'); },
  qaFilter: (a) => { ui.qaFilter = a; render(); },
  qaDone: (a) => { const q = S.qa.find((x) => x.id === a); if (q) cmd('qaStatus', { id: a, status: q.status === 'answered' ? 'open' : 'answered' }); },
  qaSpot: (a) => cmd('qaSpot', { id: a }),
  qaHide: (a) => cmd('qaStatus', { id: a, status: 'hidden' }),
  tSet: (a) => cmd('timerSet', { minutes: +a }),
  tStart: () => cmd('timerStart'),
  tPause: () => cmd('timerPause'),
  tReset: () => cmd('timerReset'),
  boardAll: () => { ui.boardAll = !ui.boardAll; render(); },
  boardScope: (a) => { ui.boardScope = a; render(); },
  bonus: async (a) => { const [id, v] = String(a).split('|'); await cmd('bonus', { empId: id, delta: +v }); toast((+v > 0 ? '+' : '−') + Math.abs(+v) + ' points for ' + short(id)); },
  setModule: (v) => {
    const has = Object.keys(S.quiz.answers || {}).some((k) => Object.keys(S.quiz.answers[k]).length);
    if (has && v !== (S.session.moduleId || '')) { ui.pendingModule = v; render(); return; }
    ACT.applyModule(v);
  },
  cancelModule: () => { ui.pendingModule = null; render(); },
  applyModule: async (v) => { ui.pendingModule = null; await cmd('setModule', { moduleId: v || null }); const m = mod(v); toast(m ? `Loaded ${m.questions.length} ${m.name} questions` : 'No training selected'); },
  useModule: async (a) => { await ACT.applyModule(a); cmd('setTab', { tab: 'join' }); },
  setRoster: (v) => cmd('setRoster', { rosterId: v || null }),
  useRoster: async (a) => { await cmd('setRoster', { rosterId: a }); cmd('setTab', { tab: 'join' }); toast('Roster set for today'); },
  rosterSel: (a) => { ui.rosterSel = a; ui.addMembers = false; ui.csv = ''; render(); },
  toggleAddMembers: () => { ui.addMembers = !ui.addMembers; render(); },
  rosterCreate: async () => {
    const name = String(ui.newRoster.name).trim(), rows = parseCSV(ui.csv);
    if (!name) return toast('Give the roster a name');
    if (!rows.length) return toast('Paste or upload at least one person');
    const r = await adminCall('POST', 'manage/rosters', { name, rows }, (x) => `${name}: ${x.roster.members.length} people. ${x.created} new profile${x.created === 1 ? '' : 's'}, ${x.existing} already in the system with points carried over.`);
    if (r) { ui.rosterSel = r.roster.id; ui.csv = ''; ui.newRoster = { name: '' }; render(); }
  },
  rosterFromCheckins: async () => {
    if (!S.participants.length) return toast('Nobody is checked in yet');
    const name = String(ui.newRoster.name).trim() || S.title + ' group';
    const r = await adminCall('POST', 'manage/rosters', { name, fromSession: S.code }, `Saved ${S.participants.length} people as a roster. Rename it here.`);
    if (r) { ui.rosterSel = r.roster.id; ui.newRoster = { name: '' }; await cmd('setRoster', { rosterId: r.roster.id }); cmd('setTab', { tab: 'rosters' }); }
  },
  rosterAddMembers: async (a) => {
    const rows = parseCSV(ui.csv); if (!rows.length) return toast('Paste or upload at least one person');
    const r = await adminCall('PATCH', 'manage/rosters/' + encodeURIComponent(a), { addRows: rows }, (x) => `${x.added} added to ${x.roster.name}. ${x.created} new profile${x.created === 1 ? '' : 's'}, ${x.existing} existing kept their points.`);
    if (r) { ui.csv = ''; ui.addMembers = false; render(); }
  },
  removeMember: (a) => { const [rid, id] = a.split('|'); adminCall('PATCH', 'manage/rosters/' + encodeURIComponent(rid), { removeMember: id }, short(id) + ' removed. Their profile and points stay.'); },
  clearRosterPts: (a) => { if (!confirmGate('clearRosterPts:' + a)) return; adminCall('POST', `manage/rosters/${encodeURIComponent(a)}/clear-points`, {}, 'Points cleared for this roster. Lifetime points untouched.'); },
  deleteRoster: async (a) => { if (!confirmGate('deleteRoster:' + a)) return; if (S.session.rosterId === a) await cmd('setRoster', { rosterId: null }); ui.rosterSel = 'all'; adminCall('DELETE', 'manage/rosters/' + encodeURIComponent(a), null, 'Roster deleted. People, points and training records stay.'); },
  rosterAddOne: async () => {
    const o = ui.one; if (!String(o.id).trim() || !String(o.name).trim()) return toast('Add an ID and a name');
    const r = await adminCall('POST', 'manage/people', { id: String(o.id).trim(), name: String(o.name).trim(), crew: String(o.crew).trim() }, o.name + ' added');
    if (r) { ui.one = { id: '', name: '', crew: '' }; render(); }
  },
  trSub: (a) => { ui.trSub = a; render(); },
  modSel: (a) => { ui.modSel = a; render(); },
  modNew: async () => { const m = await adminCall('POST', 'manage/modules', { name: 'New training' }); if (m) { ui.modSel = m.id; render(); } },
  modQAdd: async (a) => {
    const n = ui.mq, opts = [0, 1, 2, 3].map((k) => ({ t: String(n['o' + k]).trim(), c: String(k) === String(n.correct) })).filter((o) => o.t), ci = opts.findIndex((o) => o.c);
    if (!n.text.trim() || opts.length < 2) return toast('Add a question and at least two answers');
    if (ci < 0) return toast('The correct answer is blank');
    const r = await adminCall('POST', `manage/modules/${encodeURIComponent(a)}/questions`, { text: n.text, options: opts.map((o) => o.t), correct: ci, topic: n.topic }, 'Question added');
    if (r) { ui.mq = { text: '', o0: '', o1: '', o2: '', o3: '', correct: '0', topic: n.topic }; render(); }
  },
  modQDel: (a) => { const [mid, qid] = a.split('|'); adminCall('DELETE', `manage/modules/${encodeURIComponent(mid)}/questions/${encodeURIComponent(qid)}`); },
  modDelete: (a) => { if (!confirmGate('modDelete:' + a)) return; ui.modSel = null; adminCall('DELETE', 'manage/modules/' + encodeURIComponent(a), null, 'Module deleted. Past completion records stay on file.'); },
  hcssSync: () => adminCall('POST', 'manage/hcss/sync', {}, (r) => r.skipped ? 'HCSS is not connected yet. Items stay queued.' : `Sent ${r.sent} to HCSS${r.failed ? ', ' + r.failed + ' failed' : ''}.`),
  copyCsv: (a) => {
    let rows;
    if (a === 'attendance') rows = [['Employee ID', 'Name', 'Crew', 'Checked in']].concat(S.participants.map((p) => { const e = emp(p.id) || {}; return [p.id, e.name || '', e.crew || '', new Date(p.t).toLocaleString()]; }));
    else if (a === 'missed') rows = [['Question', 'Topic', 'Answered', 'Missed', 'Miss rate']].concat(questionStats().map((r) => [r.text, r.topic, r.asked, r.missed, pct(r.missed, r.asked) + '%']));
    else if (a === 'points') rows = [['Rank', 'Employee ID', 'Name', 'Crew', 'Total', 'Check-in', 'Quiz', 'Correct answers', 'Questions answered', 'Word cloud', 'Questions asked', 'Bonus']].concat(SB.map((r) => [r.rank, r.id, r.name, r.crew, r.total, r.checkin, r.quiz, r.correct, r.answered, r.words, r.asks, r.bonus]));
    else if (a === 'alltime') rows = [['Rank', 'Employee ID', 'Name', 'Crew', 'Sessions', 'Total points']].concat(allTime().map((r, i) => [i + 1, r.id, nm(r.id), (emp(r.id) || {}).crew || '', r.sessions, r.total]));
    else if (a === 'records') rows = [['Employee ID', 'Name', 'Training', 'Completed', 'Score', 'Passed', 'Expires', 'Status', 'HCSS']].concat(recordRows().map((c) => [c.empId, nm(c.empId), (mod(c.moduleId) || {}).name || c.moduleName, c.date, c.score == null ? '' : c.score + '%', c.passed ? 'Yes' : 'No', c.expires || 'Never', cStatus(c).label, hcssLabel(c)]));
    else if (a === 'roster') { const r = ros(ui.rosterSel), rp = r ? rosterPtsMap(r.id) : {}, lf = lifetimeMap(); rows = [['Employee ID', 'Name', 'Crew', 'Roster points', 'Lifetime points']].concat((r ? r.members : []).map((id) => [id, nm(id), (emp(id) || {}).crew || '', rp[id] || 0, lf[id] || 0])); }
    else rows = [['Question asked', 'Topic', 'When']].concat(askedList().map((x) => [x.text, topicOf(x.text), x.when]));
    const csv = rows.map((r) => r.map((c) => { c = String(c); if (/^[=+\-@]/.test(c)) c = "'" + c; return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',')).join('\n');
    try { navigator.clipboard.writeText(csv).then(() => toast('Copied. Paste it into Excel.'), () => toast('Copy was blocked in this window')); } catch (e) { toast('Copy was blocked in this window'); }
  },
  endSession: async () => {
    if (ui.confirm !== 'endSession' && ui.confirm !== 'endForce') { ui.confirm = 'endSession'; render(); setTimeout(() => { if (ui.confirm === 'endSession') { ui.confirm = null; render(); } }, 5000); return; }
    const force = ui.confirm === 'endForce'; ui.confirm = null; render();
    try {
      const r = await api('POST', `manage/sessions/${S.code}/end`, { force });
      await loadBoot(); LIVE = null; seenSpin = undefined;
      setLive(await api('POST', 'manage/sessions', {})); maybeAnimateSpin();
      ui.trSub = 'records'; ui.trF = { mod: r.module ? r.module.id : '', ros: '', st: '' }; ui.boardScope = 'session';
      await cmd('setTab', { tab: r.module ? 'trainings' : 'reports' });
      toast(r.module ? `Saved. ${r.passed} of ${r.records} completed ${r.module.name}${+r.module.expires ? ', good until ' + fmtDate(addMonths(r.date, r.module.expires)) : ''}.${r.walkInsAdded ? ' ' + r.walkInsAdded + ' added to ' + r.roster + '.' : ''}` : 'Session saved. Points added to everyone’s totals.');
    } catch (e) {
      if (e.body && e.body.needsConfirm) { ui.confirm = 'endForce'; render(); toast(e.message + ' Click End & save again to save anyway.'); setTimeout(() => { if (ui.confirm === 'endForce') { ui.confirm = null; render(); } }, 6000); }
      else toast(e.message);
    }
  }
};
function hcssLabel(c) { if (!c.hcss) return ''; return { queued: 'Queued', pending: 'Queued', sent: 'In HCSS', failed: 'Failed' }[c.hcss.status] || c.hcss.status; }

/* Fields bound to server data save when the user leaves the field. */
const saveTimers = {};
function saveBound(path, value) {
  const p = path.split('.');
  if (path === 'S.title') return cmd('setTitle', { title: value });
  if (path === 'S.words.prompt') return cmd('wordsPrompt', { text: value });
  if (path === 'S.wheel.pool') return cmd('wheelConfig', { pool: value });
  if (path === 'S.wheel.remove') return cmd('wheelConfig', { remove: value });
  if (p[1] === 'pts') { clearTimeout(saveTimers.pts); saveTimers.pts = setTimeout(() => adminCall('PUT', 'manage/settings/points', S.pts, 'Point rules saved'), 300); return; }
  if (p[1] === 'modules') { const m = S.modules[+p[2]]; if (m) adminCall('PUT', 'manage/modules/' + encodeURIComponent(m.id), { [p[3]]: value }, 'Saved'); return; }
  if (p[1] === 'rosters') { const r = S.rosters[+p[2]]; if (r) adminCall('PATCH', 'manage/rosters/' + encodeURIComponent(r.id), { name: value }, 'Saved'); return; }
}
/* ---------- events ---------- */
function setPath(path, val) { const parts = path.split('.'), root = parts.shift(), last = parts.pop(); let o = root === 'S' ? S : ui; for (const k of parts) o = o[k]; o[last] = val; return root; }
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
  const fn = ACT[t.dataset.act]; if (fn) { e.preventDefault(); fn(t.dataset.arg); }
});
document.addEventListener('input', (e) => {
  const t = e.target; if (!t.dataset.bind || t.type === 'checkbox' || t.tagName === 'SELECT') return;
  const root = setPath(t.dataset.bind, t.value);
  if (root === 'ui' && t.dataset.live) render();
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'rFile' && t.files && t.files[0]) { const r = new FileReader(); r.onload = () => { ui.csv = String(r.result); render(); toast('File loaded. Review it, then save.'); }; r.readAsText(t.files[0]); return; }
  if (t.dataset.change) { ACT[t.dataset.change](t.value); return; }
  if (!t.dataset.bind) return;
  const val = t.type === 'checkbox' ? t.checked : t.value;
  const root = setPath(t.dataset.bind, val);
  if (root === 'S') saveBound(t.dataset.bind, val); else render();
});
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key === 'Enter' && t.tagName === 'INPUT' && t.dataset.bind && t.dataset.bind.startsWith('S.')) { e.preventDefault(); t.blur(); }
});
setInterval(() => {
  document.querySelectorAll('.tdigits').forEach((el) => { const v = fmt(trem()); if (el.textContent !== v) el.textContent = v; });
}, 250);
setInterval(poll, 1500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

/* ---------- start ---------- */
(async function init() {
  shell();
  try {
    await loadBoot();
    setLive(await api('POST', 'manage/sessions', {}));
    maybeAnimateSpin();
    if (!S.modules.some((m) => m.id === ui.modSel) && S.modules[0]) ui.modSel = S.modules[0].id;
    render();
  } catch (e) {
    document.getElementById('stage').innerHTML = `<div class="empty"><div><h3>Could not load Huddle</h3><p>${esc(e.message)}</p></div></div>`;
  }
})();
})();
