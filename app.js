/* global supabase */
/* CONFIG */
const { SUPABASE_URL, SUPABASE_ANON_KEY, API_URL, VERSION } = window.APP_CONFIG || {};
document.getElementById('ver').textContent = VERSION || '';

/* Supabase */
const sb = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let currentUser = null;
async function initAuth() {
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  currentUser = user || null;
  paintUser();
  sb.auth.onAuthStateChange((_evt, session) => {
    currentUser = session?.user || null;
    paintUser();
    refreshBoard();
  });
}
function paintUser() {
  const chip = document.getElementById('userChip');
  chip.innerHTML = currentUser
    ? `${currentUser.email || 'Account'} · <button id="btnSignOut" class="link">Sign out</button>`
    : `Guest · <button id="btnSignIn" class="link">Sign in</button>`;
  (document.getElementById('btnSignIn')||{}).onclick = () => openAuth();
  (document.getElementById('btnSignOut')||{}).onclick = async () => { await sb.auth.signOut(); };
}

/* UI refs */
const goalsEl = document.getElementById('goals');
const levelLabel = document.getElementById('levelLabel');
const friendlyLevel = document.getElementById('friendlyLevel');
const fillersEl = document.getElementById('fillers');
const fillersTop = document.getElementById('fillersTop');
const sessionsEl = document.getElementById('sessions');
const sessionsTop = document.getElementById('sessionsTop');
const streakEl = document.getElementById('streak');
const streakTop = document.getElementById('streakTop');

const pronBox = document.getElementById('pronBox');
const gramBox = document.getElementById('gramBox');
const fixBox  = document.getElementById('fixBox');
const nextBox = document.getElementById('nextBox');

const timerEl = document.getElementById('timer');
const meterEl = document.getElementById('meter');
const stateBadge = document.getElementById('stateBadge');
const recStateMini = document.getElementById('recStateMini');

const btnStart = document.getElementById('btnStart');
const btnStop  = document.getElementById('btnStop');
const btnSend  = document.getElementById('btnSend');
const btnRnd   = document.getElementById('btnRnd');
const promptEl = document.getElementById('prompt');
const boardEl  = document.getElementById('board');

/* Local progress */
let localSessions = Number(localStorage.getItem('ec_sessions')||'0');
let lastFeedbackOk = localStorage.getItem('ec_fb_ok') === '1';
let streak = Number(localStorage.getItem('ec_streak')||'0');
let streakDate = localStorage.getItem('ec_streak_date') || '';

paintProgress();

function paintProgress() {
  sessionsEl.textContent = sessionsTop.textContent = String(localSessions);
  streakEl.textContent = streakTop.textContent = String(streak);
}

/* Goals */
let goal = 'Work English';
goalsEl.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if(!b) return;
  [...goalsEl.children].forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  goal = b.dataset.goal || goal;
  // change the starter prompt lightly
  const prompts = {
    'Work English': [
      'Describe a recent project you led and one lesson you learned.',
      'Explain one challenge your team faced and how you solved it.',
      'Tell me about a time you influenced a decision at work.'
    ],
    'Daily Life': [
      'Describe your last weekend in 45 seconds.',
      'What’s your morning routine? Speak for 45 seconds.',
      'Tell me about your favorite hobby and why you enjoy it.'
    ],
    'Interview Prep': [
      'Introduce yourself and your professional background.',
      'Describe your biggest strength with one example.',
      'Tell me about a difficult problem you solved.'
    ],
    'Travel': [
      'Describe your best trip and what made it memorable.',
      'Explain how you plan a trip from scratch.',
      'Talk about a city you want to visit and why.'
    ],
    'Presentation': [
      'Summarize a 2-minute talk you recently gave.',
      'Explain a product or idea as if to a new colleague.',
      'Describe an audience question and your answer.'
    ]
  };
  promptEl.textContent = prompts[goal][0];
});

/* Randomize prompt */
btnRnd.onclick = () => {
  const list = [...document.querySelectorAll('#goals .pill')].find(p=>p.classList.contains('active'))?.dataset.goal || goal;
  const L = {
    'Work English': [
      'Explain one challenge your team faced and how you solved it.',
      'Describe a recent conflict and how you handled it.'
    ],
    'Daily Life': [
      'What did you do last weekend?',
      'Tell me about your favorite food and why you love it.'
    ],
    'Interview Prep': [
      'What is your biggest weakness and how are you improving it?',
      'Describe a project you’re proud of.'
    ],
    'Travel': [
      'Describe a trip that changed your perspective.',
      'Plan a weekend in a city you like.'
    ],
    'Presentation': [
      'Outline the main message of your latest talk.',
      'Explain a complex topic in simple terms.'
    ]
  }[list];
  promptEl.textContent = L[Math.floor(Math.random()*L.length)];
};

/* Recording */
let rec, chunks=[], mediaStream=null, durationSec=0, tickInt=null, startTs=0;

function setLive(on){
  stateBadge.textContent = on ? 'Live' : 'Idle';
  recStateMini.textContent = on ? 'Live' : 'Idle';
  stateBadge.classList.toggle('subtle', !on);
  recStateMini.classList.toggle('subtle', !on);
}
function zero(n){return n<10?'0'+n:String(n)}
function paintTimer(sec){
  timerEl.textContent = `${zero(Math.floor(sec/60))}:${zero(sec%60)}`;
  // width
  const pct = Math.min(100, Math.round((sec/90)*100));
  meterEl.style.width = pct+'%';
  // color thresholds: 0–20s red, 20–45 amber, >=45 green
  if (sec < 20) meterEl.style.background = 'linear-gradient(90deg, var(--bad), #ff6b6b)';
  else if (sec < 45) meterEl.style.background = 'linear-gradient(90deg, var(--warn), #ffca57)';
  else meterEl.style.background = 'linear-gradient(90deg, var(--ok), #34d399)';
}

btnStart.onclick = async () => {
  try{
    chunks=[]; durationSec=0; startTs=Date.now();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
               : (MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2') ? 'audio/mp4' : '');
    rec = new MediaRecorder(mediaStream,{ mimeType:mime });
    rec.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => mediaStream.getTracks().forEach(t=>t.stop());
    rec.start(250);
    setLive(true);
    btnStart.disabled = true; btnStop.disabled = false; btnSend.disabled = true;
    meterEl.style.width = '0%'; paintTimer(0);
    tickInt = setInterval(()=>{
      durationSec = Math.max(0, Math.round((Date.now()-startTs)/1000));
      paintTimer(durationSec);
    }, 1000);
  }catch(e){
    alert('Mic permission denied or unavailable.');
  }
};

btnStop.onclick = () => stopRec();
function stopRec(){
  try{ rec && rec.state!=='inactive' && rec.stop(); }catch{}
  clearInterval(tickInt); tickInt=null;
  setLive(false);
  btnStart.disabled = false; btnStop.disabled = true; btnSend.disabled = chunks.length===0;
}

/* Analyze */
btnSend.onclick = async () => {
  // block: require login after 5 sessions (but count is still stored)
  if (!currentUser && localSessions >= 5) { openAuth(); return; }

  const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
  const fd = new FormData();
  fd.append('files[]', blob, blob.type.includes('mp4') ? 'audio.m4a' : 'audio.webm');
  fd.append('duration_sec', String(durationSec));
  fd.append('goal', goal);
  fd.append('prompt_text', promptEl.textContent);

  btnSend.disabled = true;
  fixBox.textContent = 'Analyzing...';

  try{
    const res = await fetch(API_URL, { method:'POST', body:fd });
    const json = await res.json();

    // fallback when too short
    if (json.fallback) {
      levelLabel.textContent = friendlyLevel.textContent = 'Beginner';
      fillersEl.textContent = fillersTop.textContent = String(json.fluency?.fillers ?? 0);
      gramBox.innerHTML = liMap(json.grammar_issues || []);
      pronBox.innerHTML = pronMap(json.pronunciation || []);
      setEmptyStates();
      fixBox.textContent = json.one_thing_to_fix || 'Speak for at least 45 seconds.';
      nextBox.textContent = json.next_prompt || 'Describe your last weekend in 45 seconds.';
    } else {
      const lvl = json.friendly_level || json.cefr_estimate || 'Intermediate';
      levelLabel.textContent = friendlyLevel.textContent = lvl;
      const fill = Number(json.fluency?.fillers ?? 0);
      fillersEl.textContent = fillersTop.textContent = String(fill);

      gramBox.innerHTML = liMap(json.grammar_issues || []);
      pronBox.innerHTML = pronMap(json.pronunciation || []);
      setEmptyStates();

      fixBox.textContent = json.one_thing_to_fix || 'Focus on clarity.';
      nextBox.textContent = json.next_prompt || 'Tell me about a recent challenge.';
    }

    // update local counters
    localSessions += 1;
    localStorage.setItem('ec_sessions', String(localSessions));
    bumpStreak();
    paintProgress();

    // store session row (even guests -> user_id null)
    if (sb) {
      try {
        await sb.from('sessions').insert({
          user_id: currentUser?.id ?? null,
          duration_sec: durationSec,
          level_label: friendlyLevel.textContent || null,
          goal
        });
      } catch {}
    }

    // feedback: show after first completion if not yet
    if (!lastFeedbackOk && localSessions >= 1) {
      openFeedback(() => { lastFeedbackOk = true; localStorage.setItem('ec_fb_ok','1'); });
    }

    refreshBoard();
  } catch(err){
    fixBox.textContent = 'Analyzer error. Please try again.';
  } finally {
    btnSend.disabled = false;
  }
};

function setEmptyStates(){
  if (!gramBox.innerHTML.trim()) { gramBox.classList.add('empty'); gramBox.textContent='–'; } else { gramBox.classList.remove('empty'); }
  if (!pronBox.innerHTML.trim()) { pronBox.classList.add('empty'); pronBox.textContent='–'; } else { pronBox.classList.remove('empty'); }
}

function liMap(arr){
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr.map(x=>`<div class="li">→ ${escapeHtml(x.error||x.sound_or_word||'')}<br><span class="try">Try:</span> ${escapeHtml(x.fix||x.minimal_pair||'')}</div>`).join('');
}
function pronMap(arr){
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr.map(x=>`<div class="li">→ <b>${escapeHtml(x.sound_or_word||'')}</b> — ${escapeHtml(x.issue||'')}<br><span class="try">Try:</span> ${escapeHtml(x.minimal_pair||'')}</div>`).join('');
}
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]))}

/* Streak: one increase per day with at least one session */
function bumpStreak(){
  const today = new Date().toISOString().slice(0,10);
  if (streakDate !== today) { streak += 1; streakDate = today; }
  localStorage.setItem('ec_streak', String(streak));
  localStorage.setItem('ec_streak_date', streakDate);
}

/* Leaderboard */
async function refreshBoard(){
  if (!sb || !currentUser) {
    boardEl.textContent = `You — ${localSessions} session${localSessions===1?'':'s'} (sign in for public board).`;
    return;
  }
  try{
    const { data, error } = await sb
      .rpc('top_users_by_sessions')  // helper function from earlier SQL
      .select?.(); // some environments require .select(); harmless if unsupported
    if (error || !data) throw error || new Error('No data');
    boardEl.innerHTML = data.map((r,i)=>`<div>${i+1}. ${escapeHtml(r.display)} — <b>${r.sessions}</b> sessions</div>`).join('');
  }catch{
    boardEl.textContent = `You — ${localSessions} session${localSessions===1?'':'s'}.`;
  }
}

/* Feedback modal */
const fbDialog = document.getElementById('fbDialog');
const fbForm   = document.getElementById('fbForm');
document.getElementById('feedbackLink').onclick = () => fbDialog.showModal();
document.getElementById('fbSkip').onclick = () => fbDialog.close();
fbForm.onsubmit = async (e) => {
  e.preventDefault();
  const rating = Number((new FormData(fbForm)).get('rating')||0);
  const name = document.getElementById('fbName').value.trim();
  const email = document.getElementById('fbEmail').value.trim();
  const text = document.getElementById('fbText').value.trim();
  if (sb) {
    try {
      await sb.from('feedback').insert({
        user_id: currentUser?.id ?? null, name, email, rating, text
      });
    } catch {}
  }
  localStorage.setItem('ec_fb_ok','1');
  fbDialog.close();
};
function openFeedback(cb){ fbDialog.showModal(); fbDialog.addEventListener('close', ()=>cb?.(), { once:true }); }

/* Auth modal */
const authBox = document.getElementById('authBox');
function openAuth(){ authBox.showModal(); }
document.getElementById('authClose').onclick = ()=> authBox.close();
document.getElementById('btnMagic').onclick = async ()=>{
  const email = document.getElementById('authEmail').value.trim();
  if (!email) return alert('Enter email first.');
  try{ await sb.auth.signInWithOtp({ email, emailRedirectTo: location.origin }); alert('Check your inbox.'); }catch{ alert('Could not send link.'); }
};
document.getElementById('btnGoogle').onclick = async ()=>{
  try{ await sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: location.origin } }); }catch{ alert('Sign-in failed'); }
};
document.getElementById('btnFacebook').onclick = async ()=>{
  try{ await sb.auth.signInWithOAuth({ provider:'facebook', options:{ redirectTo: location.origin } }); }catch{ alert('Sign-in failed'); }
};

/* Init */
setLive(false);
initAuth();
refreshBoard();
