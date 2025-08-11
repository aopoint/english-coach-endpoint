// app.js
(function () {
  // ===== Config (from /config.js) =====
  const cfg = window.APP_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || "";
  const SUPABASE_KEY = cfg.SUPABASE_ANON_KEY || "";
  const API_URL = cfg.API_URL || "";
  const VERSION = cfg.VERSION || "";

  const ver = document.getElementById("ver");
  const verFoot = document.getElementById("verFoot");
  if (ver) ver.textContent = VERSION;
  if (verFoot) verFoot.textContent = VERSION;

  // ===== Supabase =====
  const supabase =
    SUPABASE_URL && SUPABASE_KEY && window.supabase
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
      : null;

  // ===== Elements =====
  const goalsEl = document.getElementById("goals");
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  const btnSend = document.getElementById("btnSend");
  const btnRnd = document.getElementById("btnRnd");

  const promptEl = document.getElementById("prompt");
  const timerEl = document.getElementById("timer");
  const meterEl = document.getElementById("meter");

  const liveDot = document.getElementById("liveDot");
  const liveText = document.getElementById("liveText");
  const liveDotTop = document.getElementById("liveDotTop");
  const liveTextTop = document.getElementById("liveTextTop");

  const levelLabel = document.getElementById("levelLabel");
  const fillersEl = document.getElementById("fillers");
  const sessionsEl = document.getElementById("sessions");
  const streakEl = document.getElementById("streak");

  const pronBox = document.getElementById("pronBox");
  const gramBox = document.getElementById("gramBox");
  const fixBox = document.getElementById("fixBox");
  const nextBox = document.getElementById("nextBox");
  const leadBox = document.getElementById("leadBox");

  const signinLink = document.getElementById("signinLink");
  const signoutLink = document.getElementById("signoutLink");
  const userNameEl = document.getElementById("userName");
  const openFeedback = document.getElementById("openFeedback");

  // Feedback modal
  const fbModal = document.getElementById("feedbackModal");
  const fbClose = document.getElementById("fbClose");
  const fbSend = document.getElementById("fbSend");
  const fbSkip = document.getElementById("fbSkip");
  const fbName = document.getElementById("fbName");
  const fbEmail = document.getElementById("fbEmail");
  const fbText = document.getElementById("fbText");
  const stars = document.getElementById("stars");

  // ===== State =====
  const prompts = [
    "Describe a recent project you led and one lesson you learned.",
    "Tell me about your last weekend in 45 seconds.",
    "Explain one problem your team faced and how you solved it.",
    "Share a time you had to persuade someone at work. What happened?",
    "Talk about a product you use daily and why you like it."
  ];

  let mediaStream = null;
  let mediaRec = null;
  let chunks = [];
  let t0 = 0;
  let tInt = null;

  let currentUser = null;
  let localSessions = Number(localStorage.getItem("ec_sessions") || "0");
  sessionsEl.textContent = String(localSessions);

  const anonId =
    localStorage.getItem("ec_anon_id") || (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  localStorage.setItem("ec_anon_id", anonId);

  function todayKey() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }
  function loadStreak() {
    return Number(localStorage.getItem("ec_streak") || "0");
  }
  function loadLastDay() {
    return localStorage.getItem("ec_last_day") || "";
  }
  function saveStreak(n) {
    localStorage.setItem("ec_streak", String(n));
  }
  function saveLastDay(k) {
    localStorage.setItem("ec_last_day", k);
  }
  function updateLocalStreakOnAnalyze() {
    const last = loadLastDay();
    const today = todayKey();
    if (last === today) return loadStreak();
    const diffDays =
      (new Date(today).getTime() - new Date(last || today).getTime()) /
      86400000;
    const newStreak = last && diffDays === 1 ? loadStreak() + 1 : 1;
    saveStreak(newStreak);
    saveLastDay(today);
    return newStreak;
  }
  streakEl.textContent = String(loadStreak());

  // ===== Helpers =====
  function setLive(isLive, label) {
    const add = (el) => el && el.classList.add("live");
    const rm = (el) => el && el.classList.remove("live");
    (isLive ? add : rm)(liveDot);
    (isLive ? add : rm)(liveDotTop);
    if (liveText) liveText.textContent = label || (isLive ? "Live" : "Idle");
    if (liveTextTop)
      liveTextTop.textContent = label || (isLive ? "Live" : "Idle");
  }
  setLive(false, "Idle");

  function goal() {
    const a = goalsEl.querySelector(".chip.active");
    return a ? a.dataset.goal : "Work English";
  }
  goalsEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    goalsEl.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
  });

  function fmt(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(Math.floor(sec % 60)).padStart(2, "0");
    return `${m}:${s}`;
  }
  function setTimer(sec) {
    timerEl.textContent = fmt(sec);
    const pct = Math.min(100, Math.floor((sec / 90) * 100));
    meterEl.style.width = pct + "%";
  }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[m]);
  }

  // ===== Auth =====
  async function refreshUser() {
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    currentUser = data?.user || null;
    if (currentUser) {
      userNameEl.textContent =
        currentUser.user_metadata?.name || currentUser.email || "User";
      signinLink.textContent = "Switch account";
      signoutLink.parentElement.classList.remove("hide");
      showLeaderboard();
      computeStreakFromSupabase();
    } else {
      userNameEl.textContent = "Guest";
      signinLink.textContent = "Sign in";
      signoutLink.parentElement.classList.add("hide");
      showLeaderboard();
      streakEl.textContent = String(loadStreak());
    }
  }
  async function signIn() {
    if (!supabase) {
      alert("Supabase missing. Check config.js.");
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname }
    });
    if (error) alert(error.message);
  }
  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    currentUser = null;
    refreshUser();
  }
  signinLink.addEventListener("click", (e) => { e.preventDefault(); signIn(); });
  signoutLink.addEventListener("click", (e) => { e.preventDefault(); signOut(); });
  openFeedback.addEventListener("click", (e)=>{ e.preventDefault(); showFeedback(); });

  if (supabase) {
    supabase.auth.onAuthStateChange(refreshUser);
    refreshUser();
  }

  // ===== Recording =====
  async function startRec() {
    // nudge if guest after 1 session
    if (!currentUser && localSessions >= 1) {
      // soft nudge only
      console.log("Tip: sign in to save progress.");
    }

    setLive(true, "Live");
    btnStart.disabled = true;
    btnStop.disabled = false;
    btnSend.disabled = true;
    btnRnd.disabled = true;
    chunks = [];
    t0 = Date.now();
    setTimer(0);
    meterEl.style.width = "0%";

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setLive(false, "Mic blocked");
      alert("Microphone permission is required.");
      resetControls();
      return;
    }
    mediaRec = new MediaRecorder(mediaStream, { mimeType: "audio/webm" });
    mediaRec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    mediaRec.start(100);
    tInt = setInterval(() => {
      const sec = (Date.now() - t0) / 1000;
      setTimer(sec);
      if (sec >= 120) stopRec(); // 2 min cap
    }, 200);
  }
  function stopRec() {
    try { mediaRec && mediaRec.state !== "inactive" && mediaRec.stop(); } catch {}
    try { mediaStream && mediaStream.getTracks().forEach((t) => t.stop()); } catch {}
    clearInterval(tInt);
    tInt = null;

    setLive(false, "Ready");
    btnStop.disabled = true;
    btnSend.disabled = false;
    btnRnd.disabled = false;
  }
  function resetControls() {
    btnStart.disabled = false;
    btnStop.disabled = true;
    btnSend.disabled = true;
    btnRnd.disabled = false;
    setLive(false, "Idle");
  }
  btnStart.addEventListener("click", startRec);
  btnStop.addEventListener("click", stopRec);

  // ===== Prompts =====
  btnRnd.addEventListener("click", () => {
    if (btnStart.disabled) return; // not while recording
    const i = Math.floor(Math.random() * prompts.length);
    promptEl.textContent = prompts[i];
  });
  (function initPrompt() {
    const i = Math.floor(Math.random() * prompts.length);
    promptEl.textContent = prompts[i];
  })();

  // ===== Feedback modal =====
  let rating = 0;
  stars.addEventListener("click",(e)=>{
    const b = e.target.closest("button"); if(!b) return;
    rating = Number(b.dataset.v||"0");
    stars.querySelectorAll("button").forEach(x=>x.classList.toggle("active", Number(x.dataset.v)<=rating));
  });
  function showFeedback() {
    fbModal.classList.add("show");
    fbModal.setAttribute("aria-hidden","false");
  }
  function hideFeedback() {
    fbModal.classList.remove("show");
    fbModal.setAttribute("aria-hidden","true");
  }
  fbClose.addEventListener("click", hideFeedback);
  fbSkip.addEventListener("click", () => { 
    localStorage.setItem("ec_feedback_offered","1"); 
    hideFeedback(); 
    pendingAnalyze && pendingAnalyze(); 
  });
  fbSend.addEventListener("click", async () => {
    try{
      if (supabase) {
        await supabase.from("feedback").insert({
          user_id: currentUser?.id || null,
          anon_id: anonId,
          name: fbName.value || null,
          email: fbEmail.value || null,
          rating: rating || null,
          text: fbText.value || null
        });
      }
      localStorage.setItem("ec_feedback_done","1");
    }catch(e){ console.warn("feedback insert error", e); }
    hideFeedback();
    pendingAnalyze && pendingAnalyze();
  });

  // ===== Analyze (with gates) =====
  let pendingAnalyze = null;

  btnSend.addEventListener("click", () => runAnalyzeWithGates());

  async function runAnalyzeWithGates() {
    // Gate 1: login after 5 recordings
    if (!currentUser && localSessions >= 5) {
      alert("Please sign in to continue using English Coach.");
      signIn();
      return;
    }

    // Gate 2: offer feedback after first recording (before analyzing second time)
    const offered = localStorage.getItem("ec_feedback_offered") === "1";
    const done = localStorage.getItem("ec_feedback_done") === "1";
    if (localSessions >= 1 && !offered && !done) {
      pendingAnalyze = analyze; // continue after modal
      showFeedback();
      return;
    }

    analyze();
  }

  async function analyze() {
    if (!chunks.length) {
      alert("No audio recorded.");
      return;
    }
    btnSend.disabled = true;
    setLive(false, "Analyzing…");

    const blob = new Blob(chunks, { type: "audio/webm" });
    const fd = new FormData();
    fd.append("files[]", blob, "audio.webm");
    fd.append("duration_sec", Math.round((Date.now() - t0) / 1000));
    fd.append("goal", goal());
    fd.append("prompt_text", promptEl.textContent || "");

    try {
      const res = await fetch(API_URL, { method: "POST", body: fd });
      const json = await res.json();
      renderResult(json);

      // sessions (local)
      localSessions += 1;
      localStorage.setItem("ec_sessions", String(localSessions));
      sessionsEl.textContent = String(localSessions);

      // streak (local-first)
      const s = updateLocalStreakOnAnalyze();
      streakEl.textContent = String(s);

      // ---- Persist to DB ----
      if (supabase) {
        // 1) anonymous aggregate table (to count total sessions + unique users)
        try {
          await supabase.from("anon_sessions").insert({
            anon_id: anonId,
            duration_sec: Math.round((Date.now() - t0) / 1000),
            goal: goal()
          });
        } catch(e) { console.warn("anon_sessions insert", e); }

        // 2) per-user sessions when signed-in
        if (currentUser) {
          try{
            await supabase.from("sessions").insert({
              user_id: currentUser.id,
              duration_sec: Math.round((Date.now() - t0) / 1000),
              level_label: json.friendly_level || json.cefr_estimate || "–",
              goal: goal()
            });
          } catch(e) { console.warn("sessions insert", e); }
          showLeaderboard();
          computeStreakFromSupabase();
        }
      }
    } catch (e) {
      console.error(e);
      alert("Analyze failed. Please try again.");
    } finally {
      resetControls();
    }
  }

  // ===== Render results =====
  function renderResult(json) {
    if (json.fallback) {
      levelLabel.textContent = "Beginner";
      fillersEl.textContent = String(json.fluency?.fillers ?? 0);
      meterEl.style.width = "25%";
      pronBox.innerHTML = `<div class="result">${escapeHtml(
        json.rationale || "Try speaking for 45–90 seconds in full sentences."
      )}</div>`;
      gramBox.innerHTML = `<div class="result">${escapeHtml(
        json.one_thing_to_fix || "Speak for 30–60 seconds."
      )}</div>`;
      fixBox.textContent =
        json.one_thing_to_fix || "Speak for 30–60 seconds.";
      nextBox.textContent =
        json.next_prompt || "Describe your last weekend in 45 seconds.";
      return;
    }

    levelLabel.textContent =
      json.friendly_level || json.cefr_estimate || "–";
    fillersEl.textContent = String(json.fluency?.fillers ?? 0);

    gramBox.innerHTML =
      Array.isArray(json.grammar_issues) && json.grammar_issues.length
        ? json.grammar_issues
            .map(
              (g) => `
      <div class="result">
        <div>→ ${escapeHtml(g.error || "")}</div>
        <div><b>Try:</b> ${escapeHtml(g.fix || "")}</div>
        <div class="muted"><b>Why:</b> ${escapeHtml(g.why || "")}</div>
      </div>`
            )
            .join("")
        : `<div class="result muted">–</div>`;

    pronBox.innerHTML =
      Array.isArray(json.pronunciation) && json.pronunciation.length
        ? json.pronunciation
            .map(
              (p) => `
      <div class="result">
        <div><b>${escapeHtml(p.sound_or_word || "")}</b> — ${escapeHtml(
                p.issue || ""
              )}</div>
        ${p.minimal_pair ? `<div class="muted">Try: ${escapeHtml(p.minimal_pair)}</div>` : ""}
      </div>`
            )
            .join("")
        : `<div class="result muted">–</div>`;

    fixBox.textContent = json.one_thing_to_fix || "—";
    nextBox.textContent = json.next_prompt || "—";
  }

  // ===== Leaderboard (simple) =====
  async function showLeaderboard() {
    if (!supabase || !currentUser) {
      leadBox.innerHTML = `You — ${localSessions} session${localSessions === 1 ? "" : "s"} (sign in to appear on the public board).`;
      return;
    }
    try {
      const { data, error } = await supabase.rpc("top_users_by_sessions");
      if (error) throw error;
      if (!data || !data.length) {
        leadBox.textContent = "No public data yet.";
        return;
      }
      leadBox.innerHTML = data
        .slice(0, 10)
        .map((r, i) => {
          const name = r.display ?? r.email ?? "User";
          return `<div>${i + 1}. ${escapeHtml(name)} — ${r.sessions} session${
            r.sessions === 1 ? "" : "s"
          }</div>`;
        })
        .join("");
    } catch {
      leadBox.textContent = "Leaderboard unavailable.";
    }
  }

  // ===== Streak from Supabase (optional) =====
  async function computeStreakFromSupabase() {
    if (!supabase || !currentUser) return;
    try {
      const { data, error } = await supabase
        .from("sessions")
        .select("created_at")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(180);
      if (error) throw error;
      if (!data || !data.length) { streakEl.textContent = "0"; return; }
      const days = new Set(data.map((r) => String(r.created_at).slice(0, 10)));
      let s = 0; let d = new Date(todayKey());
      for (;;) {
        const key = d.toISOString().slice(0, 10);
        if (!days.has(key)) break;
        s++; d.setDate(d.getDate() - 1);
      }
      streakEl.textContent = String(s);
      saveStreak(s); saveLastDay(todayKey());
    } catch {}
  }
})();
