// app.js
window.addEventListener("DOMContentLoaded", () => {
  const C = window.APP_CONFIG || {};
  const API_URL = C.API_URL || "";
  const VERSION = C.VERSION || "";
  const SUPABASE_URL = C.SUPABASE_URL || "";
  const SUPABASE_KEY = C.SUPABASE_ANON_KEY || "";

  // version
  document.getElementById("ver").textContent = VERSION;
  document.getElementById("verFoot").textContent = VERSION;

  // local session counters
  let localSessions = Number(localStorage.getItem("ec_sessions") || "0");
  let localStreak = Number(localStorage.getItem("ec_streak") || "0");

  // supabase (optional)
  const supa = (SUPABASE_URL && SUPABASE_KEY && window.supabase)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

  // ui refs
  const goalsEl = document.getElementById("goals");
  const btnStart = document.getElementById("btnStart");
  const btnStop  = document.getElementById("btnStop");
  const btnSend  = document.getElementById("btnSend");
  const btnRnd   = document.getElementById("btnRnd");
  const timerEl  = document.getElementById("timer");
  const meterEl  = document.getElementById("meter");
  const promptEl = document.getElementById("prompt");

  const liveDot = document.getElementById("liveDot");
  const liveText = document.getElementById("liveText");
  const liveDotTop = document.getElementById("liveDotTop");
  const liveTextTop = document.getElementById("liveTextTop");

  const levelLabel = document.getElementById("levelLabel");
  const fillersEl  = document.getElementById("fillers");
  const sessionsEl = document.getElementById("sessions");
  const streakEl   = document.getElementById("streak");

  const pronBox = document.getElementById("pronBox");
  const gramBox = document.getElementById("gramBox");
  const fixBox  = document.getElementById("fixBox");
  const nextBox = document.getElementById("nextBox");
  const leadBox = document.getElementById("leadBox");

  const signinLink = document.getElementById("signinLink");
  const signoutWrap= document.getElementById("signoutWrap");
  const signoutLink= document.getElementById("signoutLink");
  const userNameEl = document.getElementById("userName");

  // feedback modal
  const fbModal = document.getElementById("feedbackModal");
  const fbClose = document.getElementById("fbClose");
  const fbSend  = document.getElementById("fbSend");
  const fbSkip  = document.getElementById("fbSkip");
  const fbName  = document.getElementById("fbName");
  const fbEmail = document.getElementById("fbEmail");
  const fbText  = document.getElementById("fbText");
  const stars   = document.getElementById("stars");
  let fbRating  = 0;

  // state
  let goal = "Work English";
  let mediaStream = null, mediaRec = null, chunks = [];
  let startTime = 0, timerInt = null, lastBlob = null;
  const MAX_SEC = 95;

  // helpers
  const setLive = (isLive) => {
    const dotCol = isLive ? "#22d3ee" : "#666";
    [liveDot, liveDotTop].forEach(d => d.style.background = dotCol);
    [liveText, liveTextTop].forEach(t => t.textContent = isLive ? "Live" : "Idle");
  };
  const pad = (n)=>String(n).padStart(2,"0");
  const fmtTime = (sec)=>`${pad(Math.floor(sec/60))}:${pad(Math.floor(sec%60))}`;
  const wpm = (txt,sec)=>!sec?0:Math.round((txt.trim().split(/\s+/).filter(Boolean).length/sec)*60);
  const friendlyLevel = (s)=>{
    if(!s) return "Beginner";
    s=String(s).toUpperCase();
    if(s.startsWith("A1"))return"Beginner";
    if(s.startsWith("A2"))return"Elementary";
    if(s.startsWith("B1"))return"Intermediate";
    if(s.startsWith("B2"))return"Advanced";
    if(s.startsWith("C1"))return"Fluent";
    if(s.startsWith("C2"))return"Native-like";
    return s;
  };
  const prompts = [
    "Describe a recent project you led and one lesson you learned.",
    "Explain one problem your team faced and how you solved it.",
    "Tell me about your last weekend in 45 seconds.",
    "Describe a challenge you faced in your project and how you overcame it."
  ];
  const pickPrompt = ()=>prompts[Math.floor(Math.random()*prompts.length)];

  // goal change
  goalsEl.addEventListener("click",(e)=>{
    const b = e.target.closest("button");
    if(!b) return;
    [...goalsEl.children].forEach(c=>c.classList.remove("active"));
    b.classList.add("active");
    goal = b.dataset.goal;
  });

  // randomize prompt
  btnRnd.addEventListener("click",()=>{
    promptEl.textContent = pickPrompt();
  });

  // record
  btnStart.addEventListener("click", async ()=>{
    try{
      mediaStream = await navigator.mediaDevices.getUserMedia({audio:true});
    }catch(err){
      alert("Microphone permission denied.");
      return;
    }
    chunks = [];
    mediaRec = new MediaRecorder(mediaStream);
    mediaRec.ondataavailable = (e)=>{ if(e.data && e.data.size>0) chunks.push(e.data); };
    mediaRec.onstop = ()=>{ lastBlob = new Blob(chunks,{type:"audio/webm"}); btnSend.disabled = !lastBlob; };

    mediaRec.start();
    startTime = Date.now();
    btnStart.disabled = true;
    btnStop.disabled = false;
    btnSend.disabled = true;
    setLive(true);

    timerInt = setInterval(()=>{
      const sec = Math.min(MAX_SEC, (Date.now()-startTime)/1000);
      timerEl.textContent = fmtTime(sec);
      const pct = Math.floor((sec/MAX_SEC)*100);
      meterEl.style.width = `${pct}%`;
      if(sec>=MAX_SEC) stopRec();
    }, 200);
  });

  function stopRec(){
    try{ mediaRec && mediaRec.state==="recording" && mediaRec.stop(); }catch{}
    try{ mediaStream && mediaStream.getTracks().forEach(t=>t.stop()); }catch{}
    clearInterval(timerInt);
    btnStart.disabled = false;
    btnStop.disabled  = true;
    setLive(false);
  }
  btnStop.addEventListener("click", stopRec);

  // analyze
  btnSend.addEventListener("click", async ()=>{
    if(!lastBlob){ alert("No audio to send yet."); return; }
    btnSend.disabled = true;

    const durSec = Math.round((Date.now()-startTime)/1000);
    const fd = new FormData();
    fd.append("files[]", lastBlob, "audio.webm");
    fd.append("duration_sec", String(durSec));
    fd.append("goal", goal);
    fd.append("prompt_text", promptEl.textContent || "");

    try{
      const r = await fetch(API_URL, { method:"POST", body: fd });
      const json = await r.json();

      // fallback from server (too short etc.)
      if(json.fallback){
        levelLabel.textContent = "–";
        fillersEl.textContent = json.fluency?.fillers ?? 0;
        fixBox.textContent = json.one_thing_to_fix || "Speak 30–60s in full sentences.";
        nextBox.textContent = json.next_prompt || pickPrompt();
        gramBox.innerHTML = "–";
        pronBox.innerHTML = "–";
      }else{
        const lvl = json.friendly_level || friendlyLevel(json.cefr_estimate);
        levelLabel.textContent = lvl;
        fillersEl.textContent = json.fluency?.fillers ?? 0;
        fixBox.textContent = json.one_thing_to_fix || "—";
        nextBox.textContent = json.next_prompt || pickPrompt();

        const gram = Array.isArray(json.grammar_issues) ? json.grammar_issues : [];
        gramBox.innerHTML = gram.length
          ? gram.map(g=>`→ ${escapeHTML(g.error)}<br>Try: ${escapeHTML(g.fix)}<br>Why: ${escapeHTML(g.why)}`).join("<hr style='border:0;border-top:1px dashed #2b2e38;margin:8px 0'>")
          : "<div class='muted'>–</div>";

        const pr = Array.isArray(json.pronunciation) ? json.pronunciation : [];
        pronBox.innerHTML = pr.length
          ? pr.map(p=>`${escapeHTML(p.sound_or_word)} — ${escapeHTML(p.issue)}<br><span class='muted'>${escapeHTML(p.minimal_pair || "")}</span>`).join("<hr style='border:0;border-top:1px dashed #2b2e38;margin:8px 0'>")
          : "<div class='muted'>–</div>";
      }

      // count local sessions & streak
      localSessions += 1;
      sessionsEl.textContent = String(localSessions);
      localStorage.setItem("ec_sessions", String(localSessions));

      const today = new Date().toISOString().slice(0,10);
      const last  = localStorage.getItem("ec_lastday");
      if(!last || (new Date(today)-new Date(last)===86400000)){ localStreak += 1; }
      if(last!==today) localStorage.setItem("ec_lastday", today);
      localStorage.setItem("ec_streak", String(localStreak));
      streakEl.textContent = String(localStreak);

      // prompt feedback the first time (optional)
      if(!localStorage.getItem("ec_fb_done")){
        showFeedback(true); // block until sent/skipped
      }
    }catch(err){
      console.error(err);
      alert("Analyze failed. Check API URL in config.js.");
    }finally{
      btnSend.disabled = false;
    }
  });

  function escapeHTML(s){ return String(s||"").replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

  // auth (optional)
  signinLink.addEventListener("click", async (e)=>{
    e.preventDefault();
    if(!supa){ alert("Supabase keys missing in config.js"); return; }
    try{
      const { data, error } = await supa.auth.signInWithOAuth({ provider:"google", options:{ redirectTo: location.origin }});
      if(error) throw error;
    }catch(err){ alert("Sign-in failed"); }
  });
  signoutLink?.addEventListener("click", async (e)=>{
    e.preventDefault();
    if(!supa) return;
    await supa.auth.signOut();
    userNameEl.textContent = "Guest";
    signoutWrap.classList.add("hide");
  });

  // show current user if signed in
  if(supa){
    supa.auth.getUser().then(({data})=>{
      if(data?.user){ userNameEl.textContent = data.user.email || "User"; signoutWrap.classList.remove("hide"); }
    });
    supa.auth.onAuthStateChange((_e,session)=>{
      if(session?.user){ userNameEl.textContent = session.user.email || "User"; signoutWrap.classList.remove("hide"); }
      else{ userNameEl.textContent = "Guest"; signoutWrap.classList.add("hide"); }
    });
  }

  // feedback modal wiring
  function showFeedback(blocking=false){
    fbModal.classList.add("show");
    return new Promise(resolve=>{
      const close = ()=>{
        fbModal.classList.remove("show");
        localStorage.setItem("ec_fb_done","1");
        resolve();
      };
      fbClose.onclick = close;
      fbSkip.onclick  = close;
      fbSend.onclick  = async ()=>{
        const payload = {
          name: fbName.value.trim() || null,
          email: fbEmail.value.trim() || null,
          text: fbText.value.trim() || null,
          rating: fbRating || null,
        };
        try{
          if(supa){
            await supa.from("feedback").insert({
              name: payload.name, email: payload.email, text: payload.text, rating: payload.rating
            });
          }
        }catch{} finally { close(); }
      };
      // stars
      [...stars.querySelectorAll("button")].forEach(b=>{
        b.onclick = ()=>{ fbRating = Number(b.dataset.v); [...stars.children].forEach(x=>x.classList.remove("sel")); b.classList.add("sel"); };
      });
      if(!blocking){ /* nothing extra */ }
    });
  }
  document.getElementById("openFeedback").onclick = (e)=>{ e.preventDefault(); showFeedback(false); };

  // init counters
  sessionsEl.textContent = String(localSessions);
  streakEl.textContent   = String(localStreak);
  setLive(false);
});
