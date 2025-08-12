/* ========= config & setup ========= */
const CFG = window.APP_CONFIG || {};
const { SUPABASE_URL, SUPABASE_ANON_KEY, API_URL, VERSION } = CFG;

const verEl = document.getElementById('ver');
if (verEl) verEl.textContent = `v${VERSION || '0.0.0'}`;

const supabase =
  (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

/* ========= elements ========= */
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnSend = document.getElementById('btnSend');
const sendSpinner = btnSend.querySelector('.spinner');
const sendLabel = btnSend.querySelector('.cta-label');

const timerEl = document.getElementById('timer');
const meterEl = document.getElementById('meter');
const goalsEl = document.getElementById('goals');
const promptEl = document.getElementById('prompt');
const btnRnd = document.getElementById('btnRnd');

const levelLabel = document.getElementById('levelLabel');
const levelLabelTop = document.getElementById('levelLabelTop');
const fillersEl = document.getElementById('fillers');
const fillersTop = document.getElementById('fillersTop');
const sessionsEl = document.getElementById('sessions');
const sessionsTop = document.getElementById('sessionsTop');
const streakEl = document.getElementById('streak');
const streakTop = document.getElementById('streakTop');

const liveChip = document.getElementById('liveChip');
const liveText = document.getElementById('liveText');

const pronBox = document.getElementById('pronBox');
const gramBox = document.getElementById('gramBox');
const fixBox = document.getElementById('fixBox');
const nextBox = document.getElementById('nextBox');
const board = document.getElementById('board');

const feedbackModal = document.getElementById('feedbackModal');
const fbClose = document.getElementById('fbClose');
const fbSkip = document.getElementById('fbSkip');
const fbSend = document.getElementById('fbSend');
const fbName = document.getElementById('fbName');
const fbEmail = document.getElementById('fbEmail');
const fbText = document.getElementById('fbText');
const starBar = document.getElementById('stars');

const authModal = document.getElementById('authModal');
const authClose = document.getElementById('authClose');
const authGoogle = document.getElementById('authGoogle');
const authEmail = document.getElementById('authEmail');
const authEmailLink = document.getElementById('authEmailLink');

const btnAuth = document.getElementById('btnAuth');
const btnSignOut = document.getElementById('btnSignOut');
const userBadge = document.getElementById('userBadge');
const avatarImg = document.getElementById('avatar');
const btnFeedback = document.getElementById('btnFeedback');

/* ========= local state ========= */
let mediaStream, mediaRec, recChunks = [], startTs = 0, gateTmr=null;
let canAnalyze = false;
let currentUser = null;
let currentGoal = 'Work English';
let lastRating = 0;

/* ========= helpers ========= */
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const fmt = (n)=>String(n).padStart(2,'0');
const mapFriendly = (s)=>{
  const x = String(s||'').toUpperCase();
  if (x.startsWith('A1')) return 'Beginner';
  if (x.startsWith('A2')) return 'Elementary';
  if (x.startsWith('B1')) return 'Intermediate';
  if (x.startsWith('B2')) return 'Advanced';
  if (x.startsWith('C1')) return 'Fluent';
  if (x.startsWith('C2')) return 'Native-like';
  return s||'–';
}
const setLive = (state)=>{ // 'idle' | 'live'
  liveChip.classList.toggle('live', state==='live');
  liveChip.classList.toggle('idle', state!=='live');
  liveText.textContent = state==='live' ? 'Live' : 'Idle';
}
const setSendLoading = (v)=>{
  btnSend.disabled = v;
  sendSpinner.classList.toggle('hidden', !v);
}

/* ========= prompts ========= */
const PROMPTS = [
  "Describe a recent project you led and one lesson you learned.",
  "Describe a challenge you faced at work and how you handled it.",
  "Tell me about your last weekend in 45 seconds.",
  "Explain one problem your team faced and how you solved it."
];
btnRnd.addEventListener('click', ()=>{
  promptEl.textContent = PROMPTS[Math.floor(Math.random()*PROMPTS.length)];
});

/* ========= goals ========= */
goalsEl.addEventListener('click', (e)=>{
  const b = e.target.closest('button');
  if (!b) return;
  goalsEl.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
  b.classList.add('active');
  currentGoal = b.dataset.goal;
});

/* ========= timer/meter ========= */
function tick(){
  const sec = Math.floor((Date.now()-startTs)/1000);
  timerEl.textContent = `${fmt(Math.floor(sec/60))}:${fmt(sec%60)}`;
  const pct = Math.max(0, Math.min(100, Math.floor((sec/90)*100)));
  meterEl.style.width = `${pct}%`;
}
function resetTimer(){
  if (gateTmr) cancelAnimationFrame(gateTmr);
  timerEl.textContent = '00:00';
  meterEl.style.width = '0%';
}

/* ========= recording ========= */
btnStart.addEventListener('click', async ()=>{
  try{
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Microphone not available in this browser.');
      return;
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({audio:true});
    recChunks = [];
    mediaRec = new MediaRecorder(
      mediaStream,
      {mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'}
    );
    mediaRec.ondataavailable = (ev)=>{ if (ev.data?.size) recChunks.push(ev.data) };
    mediaRec.onstop = ()=>{ mediaStream.getTracks().forEach(t=>t.stop()) };
    mediaRec.start(1000);

    btnStart.disabled = true;
    btnStop.disabled = false;
    setLive('live');
    startTs = Date.now();
    (function rafLoop(){ tick(); gateTmr = requestAnimationFrame(rafLoop); })();
  }catch(err){
    console.error('mic error', err);
    alert('Microphone permission denied or unavailable.');
  }
});

btnStop.addEventListener('click', ()=>{
  if (!mediaRec) return;
  try{ mediaRec.stop(); }catch{}
  resetTimer();
  setLive('idle');
  btnStart.disabled = false;
  btnStop.disabled = true;

  canAnalyze = recChunks.length>0;
  btnSend.disabled = !canAnalyze;
});

/* ========= analysis ========= */
btnSend.addEventListener('click', async ()=>{
  if (!canAnalyze || recChunks.length===0) return;
  const blob = new Blob(recChunks, {type:'audio/webm'});
  const durSec = Math.round((Date.now()-startTs)/1000) || 0;

  setSendLoading(true);
  sendLabel.textContent = 'Analyzing…';

  try{
    const form = new FormData();
    form.append('files[]', blob, 'audio.webm');
    form.append('duration_sec', String(durSec));
    form.append('goal', currentGoal);
    form.append('prompt_text', promptEl.textContent || '');

    const res = await fetch(API_URL, {method:'POST', body:form});
    const json = await res.json();

    if (json?.fallback) {
      levelLabel.textContent = levelLabelTop.textContent = 'Beginner';
      fillersEl.textContent = fillersTop.textContent = String(json.fluency?.fillers ?? 0);
      fixBox.textContent = json.one_thing_to_fix || 'Speak in full sentences.';
      nextBox.textContent = json.next_prompt || 'Describe your last weekend in 45 seconds.';
      pronBox.innerHTML = '';
      gramBox.innerHTML = '';
    } else {
      const friendly = json.friendly_level || mapFriendly(json.cefr_estimate);
      levelLabel.textContent = levelLabelTop.textContent = friendly || '–';

      const f = json.fluency?.fillers ?? 0;
      fillersEl.textContent = fillersTop.textContent = String(f);

      const gi = Array.isArray(json.grammar_issues) ? json.grammar_issues : [];
      gramBox.innerHTML = gi.map(g=>(
        `<div class="card tight">
           <div>→ ${escapeHtml(g.error||'')}</div>
           <div class="muted">Try: ${escapeHtml(g.fix||'')}</div>
           <div class="muted">Why: ${escapeHtml(g.why||'')}</div>
         </div>`
      )).join('') || '–';

      const pi = Array.isArray(json.pronunciation) ? json.pronunciation : [];
      pronBox.innerHTML = pi.map(p=>(
        `<div class="card tight">
           ${escapeHtml(p.sound_or_word||'')} — ${escapeHtml(p.issue||'')}
           <div class="muted">Try: ${escapeHtml(p.minimal_pair||'')}</div>
         </div>`
      )).join('') || '–';

      fixBox.textContent = json.one_thing_to_fix || '–';
      nextBox.textContent = json.next_prompt || '–';
    }

    bumpSession(durSec, levelLabel.textContent);

    const shownFb = localStorage.getItem('ec_feedback_shown');
    if (!shownFb) { openFeedback(); }
  }catch(err){
    console.error('analyze error', err);
    alert('Analyze failed. Please try again.');
  }finally{
    setSendLoading(false);
    sendLabel.textContent = 'Send & Analyze';
    canAnalyze = false;
    btnSend.disabled = true;
    recChunks = [];
  }
});

function bumpSession(durationSec, level_text){
  const prev = Number(localStorage.getItem('ec_sessions')||'0') + 1;
  localStorage.setItem('ec_sessions', String(prev));
  sessionsEl.textContent = sessionsTop.textContent = String(prev);

  const last = localStorage.getItem('ec_last_day') || '';
  const today = new Date().toISOString().slice(0,10);
  const yest = new Date(Date.now()-86400000).toISOString().slice(0,10);
  let sr = Number(localStorage.getItem('ec_streak')||'0');
  sr = (last===today) ? sr : (last===yest ? sr+1 : 1);
  localStorage.setItem('ec_last_day', today);
  localStorage.setItem('ec_streak', String(sr));
  streakEl.textContent = streakTop.textContent = String(sr);

  board.textContent = `You — ${prev} session${prev===1?'':'s'} (sign in for public board).`;

  if (supabase){
    const anon = getAnonId();
    supabase.from('sessions').insert({
      user_id: currentUser?.id ?? null,
      duration_sec: durationSec,
      level_label: level_text || null,
      goal: currentGoal || null,
      anon_id: anon
    }).then(()=>{}).catch(()=>{});
  }
}

/* ========= feedback ========= */
function openFeedback(){ feedbackModal.showModal(); }
function closeFeedback(){
  feedbackModal.close(); localStorage.setItem('ec_feedback_shown', '1');
}
fbClose.addEventListener('click', closeFeedback);
fbSkip.addEventListener('click', closeFeedback);

starBar.addEventListener('click', (e)=>{
  const b = e.target.closest('button'); if(!b) return;
  lastRating = Number(b.dataset.v||'0');
  starBar.querySelectorAll('button').forEach(x=>x.classList.toggle('active', Number(x.dataset.v)<=lastRating));
});

fbSend.addEventListener('click', async ()=>{
  const name = fbName.value.trim();
  const email = fbEmail.value.trim();
  const text = fbText.value.trim();
  if (!lastRating && !text){
    alert('Please add a quick rating or a short note, or press Skip.');
    return;
  }
  if (!supabase){ closeFeedback(); return; }
  try{
    await supabase.from('feedback').insert({
      user_id: currentUser?.id ?? null,
      name, email, rating: lastRating||null, text
    });
  }catch(e){}
  closeFeedback();
});

/* ========= auth ========= */
btnAuth.addEventListener('click', ()=> authModal.showModal());
authClose.addEventListener('click', ()=> authModal.close());

if (supabase){
  supabase.auth.onAuthStateChange((_event, session)=>{
    currentUser = session?.user || null;
    renderAuth();
    if (currentUser) upsertProfile(); // optional profiles table
  });
}

authGoogle?.addEventListener('click', ()=> signInOAuth('google'));
authEmailLink?.addEventListener('click', async ()=>{
  const email = authEmail.value.trim();
  if (!email){ alert('Enter an email.'); return; }
  await supabase.auth.signInWithOtp({
    email, options:{ emailRedirectTo: window.location.origin }
  });
  alert('Check your email for a sign-in link.');
});

btnSignOut.addEventListener('click', async ()=>{
  if (!supabase) return;
  await supabase.auth.signOut();
});

async function signInOAuth(provider){
  if (!supabase){ alert('Auth not available.'); return; }
  try{
    await supabase.auth.signInWithOAuth({
      provider,
      options:{ redirectTo: window.location.origin }
    });
  }catch(e){
    alert('Sign in failed. Please try again.');
  }
}

function renderAuth(){
  if (currentUser){
    btnAuth.classList.add('hidden');
    btnSignOut.classList.remove('hidden');

    const meta = currentUser.user_metadata || {};
    const email = currentUser.email || '';
    const avatar = meta.avatar_url || '';

    userBadge.classList.remove('hidden');
    userBadge.textContent = email;

    if (avatar){
      avatarImg.src = avatar;
      avatarImg.classList.remove('hidden');
    }else{
      avatarImg.classList.add('hidden');
      avatarImg.src = '';
    }
    authModal.close();
  }else{
    btnAuth.classList.remove('hidden');
    btnSignOut.classList.add('hidden');
    userBadge.classList.add('hidden');
    userBadge.textContent = '';
    avatarImg.classList.add('hidden');
    avatarImg.src = '';
  }
}

/* optional: keep a profile row in public.profiles */
async function upsertProfile(){
  try{
    if (!supabase || !currentUser) return;
    const meta = currentUser.user_metadata || {};
    await supabase.from('profiles').upsert({
      id: currentUser.id,
      display_name: meta.full_name || null,
      email: currentUser.email || null,
      avatar_url: meta.avatar_url || null,
      last_seen: new Date().toISOString()
    });
  }catch(e){}
}

/* header feedback */
btnFeedback.addEventListener('click', openFeedback);

/* ========= init counters on load ========= */
(function initCounters(){
  sessionsEl.textContent = sessionsTop.textContent = String(Number(localStorage.getItem('ec_sessions')||'0'));
  streakEl.textContent = streakTop.textContent = String(Number(localStorage.getItem('ec_streak')||'0'));
  const first = localStorage.getItem('ec_first') || '';
  if (!first) localStorage.setItem('ec_first', new Date().toISOString());
})();

/* ========= utilities ========= */
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) }
function getAnonId(){
  let id = localStorage.getItem('ec_anon');
  if (!id){ id = crypto.randomUUID(); localStorage.setItem('ec_anon', id); }
  return id;
}

/* ===== initial UI ===== */
renderAuth();
setLive('idle');
setSendLoading(false);
btnSend.disabled = true;
