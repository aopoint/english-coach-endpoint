(() => {
  // ==== config ====
  const CFG = window.APP_CONFIG || {};
  const { SUPABASE_URL, SUPABASE_ANON_KEY, API_URL, VERSION } = CFG;

  // version to footer
  try { document.getElementById("ver").textContent = VERSION || ""; } catch {}

  // supabase
  const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  // ==== DOM refs ====
  const btnStart = byId('btnStart');
  const btnStop  = byId('btnStop');
  const btnSend  = byId('btnSend');
  const timerEl  = byId('timer');
  const meter    = byId('meterFill');
  const goalsEl  = byId('goals');
  const promptEl = byId('prompt');
  const btnRnd   = byId('btnRnd');

  const liveDot  = byId('liveDot');
  const liveTxt  = byId('liveTxt');
  const levelLabel = byId('levelLabel');
  const fillersEl  = byId('fillers');
  const streakEl   = byId('streak');
  const sessionsEl = byId('sessions');

  const pronBox = byId('pronBox');
  const gramBox = byId('gramBox');
  const fixBox  = byId('fixBox');
  const nextBox = byId('nextBox');
  const boardBox= byId('boardBox');

  const signInLink = byId('signInLink');
  const feedbackLink = byId('feedbackLink');
  const userTag = byId('userTag');

  // dialogs
  const fbDlg = byId('feedbackDlg');
  const fbClose = byId('fbClose');
  const fbSkip  = byId('fbSkip');
  const fbSend  = byId('fbSend');
  const fbName  = byId('fbName');
  const fbEmail = byId('fbEmail');
  const fbText  = byId('fbText');
  const starsEl = byId('stars');

  const authDlg = byId('authDlg');
  const authClose = byId('authClose');
  const authGoogle = byId('authGoogle');
  const authFacebook = byId('authFacebook');
  const authEmail = byId('authEmail');
  const authMagic = byId('authMagic');

  // ==== state ====
  let currentUser = null;
  let mediaStream = null;
  let mediaRec = null;
  let chunks = [];
  let tStart = 0;
  let tInt = null;
  let analyzedCount = Number(localStorage.getItem('ec_sessions') || '0');
  let forcedAuthAfter = 5;   // ask to sign-in after 5 local sessions
  let showFeedbackGate = true;

  // neutral UI state on load
  setAnalyzeEnabled(false);
  setAnalyzeLoading(false);
  setLive(false);

  // seed prompt and randomizer
  const PROMPTS = {
    "Work English":[
      "Describe a recent project you led and one lesson you learned.",
      "Tell me about a challenge your team faced and how you solved it."
    ],
    "Daily Life":[
      "Describe your ideal weekend and why you enjoy it.",
      "Talk about a hobby you recently started."
    ],
    "Interview Prep":[
      "Tell me about a time you handled conflicting priorities.",
      "Explain a complex idea you’ve taught to someone."
    ],
    "Travel":[
      "Describe your last trip and what surprised you most.",
      "Talk about a place you want to visit and why."
    ],
    "Presentation":[
      "Pitch a product in 60 seconds and explain the benefit.",
      "Describe your audience and the key takeaway you want."
    ]
  };

  function setPromptForGoal(goal){
    const items = PROMPTS[goal] || PROMPTS["Work English"];
    promptEl.value = items[0];
  }
  // goal chips
  let goal = "Work English";
  goalsEl.addEventListener('click', (e)=>{
    const b = e.target.closest('.chip');
    if(!b) return;
    goalsEl.querySelectorAll('.chip').forEach(c=>c.classList.remove('chip-on'));
    b.classList.add('chip-on');
    goal = b.dataset.goal;
    setPromptForGoal(goal);
  });
  setPromptForGoal(goal);
  btnRnd.addEventListener('click',()=>{
    const list = PROMPTS[goal] || [];
    if(!list.length) return;
    const next = list[Math.floor(Math.random()*list.length)];
    promptEl.value = next;
  });

  // ==== recorder ====
  btnStart.addEventListener('click', startRec);
  btnStop.addEventListener('click', stopRec);
  btnSend.addEventListener('click', analyzeNow);

  async function startRec(){
    try{
      // reset UI
      chunks = [];
      setAnalyzeEnabled(false);
      setAnalyzeLoading(false);
      meter.style.width = '0%';
      meter.classList.remove('good','warn');

      // get mic
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio:true });
      const options = getSupportedOptions();
      mediaRec = new MediaRecorder(mediaStream, options);
      mediaRec.ondataavailable = (ev)=>{ if(ev.data && ev.data.size>0) chunks.push(ev.data); };
      mediaRec.onstop = ()=>{}; // no-op
      mediaRec.start();

      btnStart.disabled = true;
      btnStop.disabled  = false;
      setLive(true);

      // timer
      tStart = Date.now();
      clearInterval(tInt);
      tInt = setInterval(()=>{
        const sec = Math.floor((Date.now()-tStart)/1000);
        timerEl.textContent = fmt(sec);
        // meter (neutral until 45s, warn 45–60, good 60–90, warn >90)
        const p = Math.min(100, Math.floor((sec/90)*100));
        meter.style.width = `${p}%`;
        meter.classList.remove('good','warn');
        if(sec>=60 && sec<=90) meter.classList.add('good');
        else if(sec>=45)        meter.classList.add('warn');
      }, 200);
    }catch(err){
      alert('Mic permission denied or unavailable.');
    }
  }

  function stopRec(){
    if(!mediaRec) return;
    try{ mediaRec.stop(); }catch{}
    try{ mediaStream.getTracks().forEach(t=>t.stop()); }catch{}
    mediaStream = null; mediaRec = null;
    btnStart.disabled = false;
    btnStop.disabled  = true;
    clearInterval(tInt);
    setLive(false);

    // enable analyze only if we have audio
    setAnalyzeEnabled(chunks.length>0);
  }

  // ==== analyze ====
  async function analyzeNow(){
    if(!chunks.length) return;

    setAnalyzeLoading(true);
    setAnalyzeEnabled(false);

    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    const form = new FormData();
    form.append('files[]', blob, 'speech.webm');
    form.append('duration_sec', getSecFromTimer());
    form.append('goal', goal);
    form.append('prompt_text', promptEl.value || '');

    try{
      const res = await fetch(API_URL, { method:'POST', body: form });
      const json = await res.json();

      // fallback short
      if(json.fallback){
        levelLabel.textContent = 'Beginner';
        fillersEl.textContent = '0';
        pronBox.textContent = '–';
        gramBox.innerHTML = 'Speak for at least 30–60 seconds.';
        fixBox.textContent = json.one_thing_to_fix || 'Speak longer in full sentences.';
        nextBox.textContent = json.next_prompt || 'Describe your last weekend in ~45s.';
        finalizeSession(false);
        return;
      }

      // normal
      levelLabel.textContent = json.friendly_level || json.cefr_estimate || '–';
      fillersEl.textContent  = String(json.fluency?.fillers ?? '0');

      // grammar
      gramBox.innerHTML = (json.grammar_issues||[])
        .map(g=>row(`→ ${esc(g.error)}<br><small>Try: ${esc(g.fix)}</small><br><small>Why: ${esc(g.why)}</small>`))
        .join('') || '–';

      // pron
      pronBox.innerHTML = (json.pronunciation||[])
        .map(p=>row(`<b>${esc(p.sound_or_word)}</b> — ${esc(p.issue)}<br><small>Try: ${esc(p.minimal_pair)}</small>`))
        .join('') || '–';

      fixBox.textContent  = json.one_thing_to_fix || '–';
      nextBox.textContent = json.next_prompt || '–';

      finalizeSession(true);
    }catch(err){
      console.error(err);
      alert('Analyze failed. Please try again.');
    }finally{
      setAnalyzeLoading(false);
      // allow next attempt (if not gated by feedback/auth)
      setAnalyzeEnabled(true);
    }
  }

  function finalizeSession(didAnalyze){
    // local counters
    analyzedCount = Number(localStorage.getItem('ec_sessions') || '0') + 1;
    localStorage.setItem('ec_sessions', String(analyzedCount));

    // sessions UI
    sessionsEl.textContent = String(analyzedCount);
    incrementStreak();

    // store session in supabase (if available)
    if(supabase){
      supabase.from('sessions').insert({
        user_id: currentUser?.id || null,
        duration_sec: getSecFromTimer(),
        level_label: levelLabel.textContent || null,
        goal
      }).catch(()=>{});
    }

    // feedback gate (only once)
    if(showFeedbackGate){
      showFeedbackGate = false;
      openFeedback();
      return;
    }

    // auth gate after N local sessions
    if(!currentUser && analyzedCount >= forcedAuthAfter){
      openAuth();
    }
  }

  // ==== feedback ====
  let rating = 0;
  starsEl.addEventListener('click', (e)=>{
    const b = e.target.closest('button');
    if(!b) return;
    rating = Number(b.dataset.val);
    [...starsEl.children].forEach(btn=>{
      btn.classList.toggle('active', Number(btn.dataset.val) <= rating);
    });
  });

  feedbackLink.addEventListener('click', openFeedback);
  fbClose.addEventListener('click', ()=>fbDlg.close());
  fbSkip.addEventListener('click', ()=>fbDlg.close());
  fbSend.addEventListener('click', async ()=>{
    // require either rating or some text; otherwise ask to skip or add something
    if(rating===0 && !fbText.value.trim()){
      alert('Please add a short note or choose a star rating — or press Skip.');
      return;
    }
    try{
      fbSend.classList.add('loading'); fbSend.disabled = true;
      if(supabase){
        await supabase.from('feedback').insert({
          user_id: currentUser?.id || null,
          name: fbName.value || null,
          email: fbEmail.value || null,
          rating,
          text: fbText.value || null
        });
      }
      fbDlg.close();
    }catch{
      fbDlg.close(); // don’t block usage
    }finally{
      fbSend.classList.remove('loading'); fbSend.disabled = false;
    }
  });

  function openFeedback(){
    fbDlg.showModal();
  }

  // ==== auth ====
  signInLink.addEventListener('click', openAuth);
  authClose.addEventListener('click', ()=>authDlg.close());

  authGoogle.addEventListener('click', ()=>oauth('google'));
  authFacebook.addEventListener('click', ()=>oauth('facebook'));
  authMagic.addEventListener('click', async ()=>{
    const email = authEmail.value.trim();
    if(!email) return alert('Enter an email.');
    try{
      authMagic.classList.add('loading'); authMagic.disabled=true;
      await supabase.auth.signInWithOtp({
        email,
        options:{ emailRedirectTo: location.origin }
      });
      alert('Check your email for the sign-in link.');
      authDlg.close();
    }catch(err){ alert('Email sign-in failed.'); }
    finally{ authMagic.classList.remove('loading'); authMagic.disabled=false; }
  });

  function openAuth(){
    if(!supabase){ alert('Sign-in disabled.'); return; }
    authDlg.showModal();
  }
  async function oauth(provider){
    try{
      await supabase.auth.signInWithOAuth({
        provider, options:{ redirectTo: location.origin }
      });
    }catch(err){ alert('Sign-in failed.'); }
  }

  // handle auth state
  if(supabase){
    supabase.auth.onAuthStateChange((_event, session)=>{
      currentUser = session?.user || null;
      userTag.textContent = currentUser ? (currentUser.email || 'Account')+' ·' : 'Guest ·';
    });
    // try fetch current user on load
    supabase.auth.getSession().then(({ data })=>{
      currentUser = data?.session?.user || null;
      userTag.textContent = currentUser ? (currentUser.email || 'Account')+' ·' : 'Guest ·';
    });
  }

  // ==== helpers ====
  function byId(id){ return document.getElementById(id); }
  function fmt(s){
    const m = Math.floor(s/60).toString().padStart(2,'0');
    const r = Math.floor(s%60).toString().padStart(2,'0');
    return `${m}:${r}`;
  }
  function getSecFromTimer(){
    const [mm, ss] = timerEl.textContent.split(':').map(Number);
    return (mm*60 + ss) || 0;
  }
  function setLive(on){
    liveTxt.textContent = on ? 'Live' : 'Idle';
    liveDot.classList.toggle('on', on);
  }
  function setAnalyzeEnabled(on){
    btnSend.disabled = !on;
  }
  function setAnalyzeLoading(on){
    btnSend.classList.toggle('loading', !!on);
  }
  function row(html){ return `<div class="row">${html}</div>`; }
  function esc(s){ return (s ?? '').toString().replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }

  function getSupportedOptions(){
    // Safari prefers audio/webm;codecs=opus (new), fallback to default
    const t = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
            : '';
    return t ? { mimeType:t } : {};
  }

  // streak (based on local timestamps)
  function incrementStreak(){
    const today = new Date().toISOString().slice(0,10);
    const last = localStorage.getItem('ec_last');
    let s = Number(localStorage.getItem('ec_streak')||'0');

    if(!last) s = 1;
    else {
      const d = daysBetween(last, today);
      if(d===0) { /* same day */ }
      else if(d===1) s += 1;
      else s = 1;
    }
    localStorage.setItem('ec_last', today);
    localStorage.setItem('ec_streak', String(s));
    streakEl.textContent = String(s);
  }
  function daysBetween(a,b){ return Math.floor((new Date(b)-new Date(a))/86400000); }

  // init UI states
  sessionsEl.textContent = String(analyzedCount);
  streakEl.textContent   = String(Number(localStorage.getItem('ec_streak')||'0'));
})();
