(() => {
  const CFG = window.APP_CONFIG || {};
  document.getElementById('ver').textContent = CFG.VERSION || '';

  // --- Supabase client
  if (!window.supabase) {
    alert('Supabase JS not loaded.');
    return;
  }
  const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  // --- Elements
  const btnStart = q('#btnStart');
  const btnStop = q('#btnStop');
  const btnSend = q('#btnSend');
  const sendSpinner = q('#sendSpinner');
  const meterEl = q('#meter');
  const timerEl = q('#timer');
  const recState = q('#recState');

  const levelLabel = q('#levelLabel');
  const fillersEl = q('#fillers');
  const sessionsEl = q('#sessions');
  const streakEl = q('#streak');
  const pronBox = q('#pronBox');
  const gramBox = q('#gramBox');
  const fixBox = q('#fixBox');
  const nextBox = q('#nextBox');
  const leaderBox = q('#leaderBox');

  const goalWrap = q('#goals');
  const promptEl = q('#prompt');
  const btnRnd = q('#btnRnd');

  // Auth UI
  const btnAuth = q('#btnAuth');
  const btnSignOut = q('#btnSignOut');
  const userEmail = q('#userEmail');
  const userAvatar = q('#userAvatar');
  const userChip = q('#userChip');

  const authModal = q('#authModal');
  const authClose = q('#authClose');
  const btnGoogle = q('#btnGoogle');
  const emailInput = q('#email');
  const btnMagic = q('#btnMagic');

  // Feedback modal
  const fbModal = q('#fbModal');
  const fbClose = q('#fbClose');
  const fbName = q('#fbName');
  const fbEmail = q('#fbEmail');
  const fbText = q('#fbText');
  const fbSend = q('#fbSend');
  const fbSkip = q('#fbSkip');
  const stars = q('#stars');
  let fbRating = 0;

  // --- State
  let mediaStream = null;
  let mediaRec = null;
  let chunks = [];
  let startTs = 0;
  let timerInt = null;
  const MAX_SEC = 95;

  let currentUser = null;
  let localSessions = Number(localStorage.getItem('ec_sessions') || '0');
  let allowNextWithoutLogin = false; // flips after feedback submit/skipped

  // per-device id for anonymous unique users
  const CLIENT_ID = (localStorage.getItem('ec_client_id')) || (() => {
    const id = crypto.randomUUID();
    localStorage.setItem('ec_client_id', id);
    return id;
  })();

  // --- helpers
  function q(sel){ return document.querySelector(sel); }
  function ms(n){ return ('0' + n).slice(-2); }
  const nowIso = () => new Date().toISOString();

  function getGoal(){
    const a = [...goalWrap.querySelectorAll('.chip')].find(b => b.classList.contains('chip--active'));
    return a?.dataset.goal || 'Work English';
  }
  goalWrap.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if(!b) return;
    goalWrap.querySelectorAll('.chip').forEach(x => x.classList.remove('chip--active'));
    b.classList.add('chip--active');
  });

  // randomize prompt
  const PROMPTS = [
    "Describe a recent project you led and one lesson you learned.",
    "Tell me about your weekend in 45 seconds.",
    "Explain one problem your team faced and how you solved it.",
    "Describe a challenge you faced and how you overcame it.",
    "Talk about a time you helped someone at work."
  ];
  btnRnd.addEventListener('click', () => {
    promptEl.value = PROMPTS[Math.floor(Math.random()*PROMPTS.length)];
  });

  // --- auth modal controls
  const openAuth = () => authModal.hidden = false;
  const closeAuth = () => authModal.hidden = true;
  authClose.onclick = closeAuth;
  btnAuth.onclick = openAuth;

  btnGoogle.onclick = async() => {
    try {
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin }
      });
      if (error) alert(error.message);
    } catch (e){ alert(e.message); }
  };

  btnMagic.onclick = async() => {
    const email = emailInput.value.trim();
    if (!email) return alert('Enter email first.');
    const { error } = await sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin }
    });
    if (error) return alert(error.message);
    alert('Check your email for a sign-in link.');
    closeAuth();
  };

  btnSignOut.onclick = async() => {
    await sb.auth.signOut();
    renderUser(null);
    leaderBox.textContent = 'Public leaderboard requires sign-in. You’ll still see your local totals below.';
  };

  // auth state
  sb.auth.onAuthStateChange(async (_evt, sess) => {
    currentUser = sess?.user || null;
    renderUser(currentUser);
    refreshUserStats();
  });

  function renderUser(user){
    if (user){
      btnAuth.style.display = 'none';
      btnSignOut.style.display = '';
      userEmail.textContent = user.email || 'User';
      userChip.style.display = 'flex';
      // avatar
      const url = user.user_metadata?.avatar_url || user.user_metadata?.picture;
      if (url){ userAvatar.src = url; userAvatar.style.display = 'block'; }
      else userAvatar.style.display = 'none';
      closeAuth();
    } else {
      btnAuth.style.display = '';
      btnSignOut.style.display = 'none';
      userEmail.textContent = 'Guest';
      userAvatar.style.display = 'none';
    }
  }

  // --- recording controls
  btnStart.onclick = async() => {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio:true });
      mediaRec = new MediaRecorder(mediaStream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'});
      chunks = [];
      mediaRec.ondataavailable = e => { if (e.data.size>0) chunks.push(e.data); };
      mediaRec.start();
      startTs = Date.now();
      recState.textContent = 'Recording…';
      btnStart.disabled = true; btnStop.disabled = false; btnSend.disabled = true;

      tick(); timerInt = setInterval(tick, 250);
    } catch(e){
      alert('Mic permission denied or unavailable.');
    }
  };

  function tick(){
    const sec = Math.max(0, Math.floor((Date.now()-startTs)/1000));
    timerEl.textContent = `${ms(Math.floor(sec/60))}:${ms(sec%60)}`;
    const p = Math.min(100, Math.round((sec/90)*100));
    meterEl.style.width = p + '%';
  }

  btnStop.onclick = () => {
    try { mediaRec?.stop(); mediaStream?.getTracks()?.forEach(t=>t.stop()); } catch {}
    clearInterval(timerInt); timerInt=null;
    btnStart.disabled = false; btnStop.disabled = true;
    recState.textContent = 'Recorded';
    if (chunks.length) btnSend.disabled = false;
  };

  // --- analyzing
  btnSend.onclick = analyze;
  async function analyze(){
    if (btnSend.disabled) return;
    const goal = getGoal();
    const durationSec = Math.round((Date.now()-startTs)/1000);
    if (durationSec < 5 || !chunks.length) return alert('Please record 5–10 seconds at least.');

    btnSend.disabled = true; sendSpinner.hidden = false;
    recState.textContent = 'Analyzing…';

    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    const fd = new FormData();
    fd.append('files[]', new File([blob], 'audio.webm', { type: blob.type }));
    fd.append('duration_sec', String(durationSec));
    fd.append('goal', goal);
    fd.append('prompt_text', promptEl.value.trim());

    try{
      const res = await fetch(CFG.API_URL, { method:'POST', body: fd });
      const json = await res.json();

      // fallback case
      if (json.fallback) {
        levelLabel.textContent = '–';
        fillersEl.textContent = String(json.fluency?.fillers ?? 0);
        fixBox.textContent = json.one_thing_to_fix || 'Speak for ~60 seconds.';
        nextBox.textContent = json.next_prompt || 'Describe your weekend in 45 seconds.';
        pronBox.textContent = '–';
        gramBox.textContent = '–';
      } else {
        // render
        levelLabel.textContent = (json.friendly_level || json.cefr_estimate || '–');
        fillersEl.textContent = String(json.fluency?.fillers ?? 0);
        fixBox.textContent = (json.one_thing_to_fix || '–');
        nextBox.textContent = (json.next_prompt || '–');

        // grammar list
        if (Array.isArray(json.grammar_issues) && json.grammar_issues.length){
          gramBox.innerHTML = json.grammar_issues.map(g =>
            `→ ${escapeHtml(g.error)}\nTry: ${escapeHtml(g.fix)}\nWhy: ${escapeHtml(g.why)}`
          ).join('\n\n');
        } else gramBox.textContent = '–';

        // pronunciation list
        if (Array.isArray(json.pronunciation) && json.pronunciation.length){
          pronBox.innerHTML = json.pronunciation.map(p =>
            `${escapeHtml(p.sound_or_word)} — ${escapeHtml(p.issue || '')}${
              p.minimal_pair ? `\nTry: ${escapeHtml(p.minimal_pair)}` : ''}`
          ).join('\n\n');
        } else pronBox.textContent = '–';
      }

      // Save session row
      const levelText = levelLabel.textContent || '-';
      await insertSession({
        goal, duration_sec: durationSec, level_label: levelText
      });

      // show feedback (only once before next run)
      const analyzedCount = Number(localStorage.getItem('ec_cnt')||'0');
      localStorage.setItem('ec_cnt', String(analyzedCount+1));
      if (analyzedCount===0 && !allowNextWithoutLogin){
        fbModal.hidden = false;
      }

      // allow next run
      btnSend.disabled = false;
    } catch(e){
      alert('Analyze failed. Please try again.\n'+e.message);
    } finally{
      sendSpinner.hidden = true;
      recState.textContent = 'Idle';
      chunks = [];
    }
  }

  async function insertSession({goal, duration_sec, level_label}){
    try{
      const { data, error, status } = await sb.from('sessions')
        .insert({
          user_id: currentUser?.id ?? null,
          client_id: CLIENT_ID,
          goal, duration_sec, level_label,
          created_at: nowIso()
        })
        .select('id')
        .single();

      if (error) console.warn('insert error', error);
      else {
        // local + remote stats
        localSessions += 1;
        localStorage.setItem('ec_sessions', String(localSessions));
        await refreshUserStats();
        await refreshLeaderboard();
      }
    } catch(e){ console.error(e); }
  }

  // --- Stats / Leaderboard
  async function refreshUserStats(){
    try{
      // sessions for this signed user or local device
      if (currentUser){
        const { data, error } = await sb.from('sessions')
          .select('created_at')
          .eq('user_id', currentUser.id)
          .order('created_at', { ascending:false })
          .limit(365);
        if (!error && data){
          sessionsEl.textContent = String(data.length);
          streakEl.textContent = String(calcStreak(data.map(r => r.created_at)));
        }
      } else {
        sessionsEl.textContent = String(localSessions);
        streakEl.textContent = String(calcLocalStreak());
      }
    } catch(e){ console.log(e); }
  }

  async function refreshLeaderboard(){
    if (!currentUser){
      leaderBox.textContent = `You — ${localSessions} sessions (sign in for public board).`;
      return;
    }
    // lightweight "top by sessions"
    const { data, error } = await sb.rpc('top_users_by_sessions').select();
    if (error || !data?.length){
      leaderBox.textContent = `You — sessions saved. Public board will appear once there’s enough data.`;
      return;
    }
    const rows = data.slice(0, 8).map((r,i)=> `${i+1}. ${r.display_text} — ${r.sessions} sessions`).join('\n');
    leaderBox.textContent = rows;
  }

  // compute streak of consecutive days
  function calcStreak(isoDates){
    if (!isoDates.length) return 0;
    const days = [...new Set(isoDates.map(d => d.slice(0,10)))].sort().reverse();
    let streak = 0;
    let cursor = new Date(days[0]);
    const today = new Date(); // allow if last activity is today
    // If last activity not today, still start from that date
    for (let i=0;i<days.length;i++){
      const d = new Date(days[i]);
      if (i===0){
        streak = 1; cursor = d;
      } else {
        const prev = new Date(cursor);
        prev.setDate(prev.getDate()-1);
        if (d.toISOString().slice(0,10) === prev.toISOString().slice(0,10)){
          streak += 1; cursor = d;
        } else break;
      }
    }
    return streak;
  }
  function calcLocalStreak(){
    // not stored per-day for anon; return sessions as rough gauge
    return Math.min(localSessions, 30);
  }

  // --- feedback modal
  q('#btnFeedbackLink').onclick = () => (fbModal.hidden = false);
  fbClose.onclick = () => (fbModal.hidden = true);
  fbSkip.onclick = () => { allowNextWithoutLogin = true; fbModal.hidden = true; };
  stars.addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    fbRating = Number(b.dataset.val);
    [...stars.children].forEach(s=>s.classList.toggle('active', Number(s.dataset.val) <= fbRating));
  });
  fbSend.onclick = async() => {
    // allow empty fields if user clicks Submit (but not fully blank; user can Skip instead)
    if (!fbText.value.trim() && fbRating===0 && !fbName.value.trim()){
      alert('Either add something or press Skip.');
      return;
    }
    try{
      await sb.from('feedback').insert({
        user_id: currentUser?.id ?? null,
        name: fbName.value.trim() || null,
        email: fbEmail.value.trim() || null,
        rating: fbRating || null,
        text: fbText.value.trim() || null,
        created_at: nowIso()
      });
    } catch(e){ console.warn(e); }
    allowNextWithoutLogin = true;
    fbModal.hidden = true;
  };

  // --- utils
  function escapeHtml(s){ return (s || '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])); }

  // init
  renderUser(null);
  sessionsEl.textContent = String(localSessions);
  refreshLeaderboard();
})();
