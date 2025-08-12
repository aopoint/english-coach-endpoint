/* global supabase, window, document */

(function () {
  // ----- CONFIG -----
  const { SUPABASE_URL, SUPABASE_ANON_KEY, API_URL, VERSION } =
    window.APP_CONFIG || {};
  document.getElementById("ver").textContent = VERSION ? `v${VERSION}` : "";

  // ----- SUPABASE -----
  const sb =
    SUPABASE_URL && SUPABASE_ANON_KEY
      ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;

  let currentUser = null;
  let localSessions = Number(localStorage.getItem("ec_sessions") || "0");
  let allowNextWithoutLogin = false; // flipped after feedback submit for guests

  // ----- UI refs -----
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  const btnSend = document.getElementById("btnSend");
  const btnRnd = document.getElementById("btnRnd");
  const sendSpinner = document.getElementById("sendSpinner");
  const sendText = document.getElementById("sendText");

  const timerEl = document.getElementById("timer");
  const meterEl = document.getElementById("meter");
  const goalsEl = document.getElementById("goals");
  const promptEl = document.getElementById("prompt");
  const liveChip = document.getElementById("liveChip");

  const levelLabelEl = document.getElementById("levelLabel");
  const fillersEl = document.getElementById("fillers");
  const streakEl = document.getElementById("streak");
  const sessionsEl = document.getElementById("sessions");

  const pronBox = document.getElementById("pronBox");
  const gramBox = document.getElementById("gramBox");
  const fixBox = document.getElementById("fixBox");
  const nextBox = document.getElementById("nextBox");
  const boardBox = document.getElementById("boardBox");
  const localSessionsEl = document.getElementById("localSessions");

  const authLink = document.getElementById("authLink");
  const whoami = document.getElementById("whoami");
  const feedbackLink = document.getElementById("feedbackLink");

  const fbDialog = document.getElementById("fbDialog");
  const fbForm = document.getElementById("fbForm");
  const fbName = document.getElementById("fbName");
  const fbEmail = document.getElementById("fbEmail");
  const fbText = document.getElementById("fbText");
  const fbSkip = document.getElementById("fbSkip");
  const fbClose = document.getElementById("fbClose");
  const starsRow = document.getElementById("stars");
  const fbHint = document.getElementById("fbHint");

  const toast = document.getElementById("toast");
  const recState = document.getElementById("recState");

  // ----- State -----
  let goal = "Work English";
  let chunks = [];
  let mediaStream = null;
  let mediaRec = null;
  let recording = false;
  let tStart = null;
  let tTimer = null;
  let tmpStreak = Number(localStorage.getItem("ec_streak") || "0");
  let lastDate = localStorage.getItem("ec_last_date") || ""; // yyyy-mm-dd

  // ----- Helpers -----
  const fmt = (sec) =>
    `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

  function setLive(on) {
    liveChip.classList.toggle("live", on);
    liveChip.classList.toggle("idle", !on);
    liveChip.textContent = on ? "Live" : "Idle";
    recState.textContent = on ? "Live" : "Idle";
    recState.classList.toggle("live", on);
    recState.classList.toggle("idle", !on);
  }

  function setMeter(sec) {
    const MAX = 90;
    const pct = Math.min(100, Math.round((sec / MAX) * 100));
    meterEl.style.width = `${pct}%`;
    // color thresholds
    const color =
      sec < 30 ? "var(--bad)" : sec < 45 ? "var(--warn)" : "var(--good)";
    meterEl.style.background = color;
  }

  function nowISODate() { return new Date().toISOString().slice(0, 10); }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2200);
  }

  function lockSend(locked) {
    btnSend.disabled = locked;
    sendSpinner.classList.toggle("hidden", !locked);
    sendText.textContent = locked ? "Analyzing…" : "Send & Analyze";
  }

  // ----- Auth -----
  if (sb) {
    sb.auth.onAuthStateChange(async (_evt, session) => {
      currentUser = session?.user || null;
      whoami.textContent = currentUser
        ? (currentUser.user_metadata?.full_name || currentUser.email || "User")
        : "Guest";
      if (currentUser) {
        authLink.textContent = "Sign out";
        loadLeaderboard();
      } else {
        authLink.textContent = "Sign in / Register";
        boardBox.textContent =
          "You — " + localSessions + " session(s). Sign in for public board.";
      }
    });
  }

  authLink.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!sb) return showToast("Auth unavailable.");
    if (currentUser) {
      await sb.auth.signOut();
      return;
    }
    // Pick a provider quickly (Google). You can add FB/email UI later.
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.href }
    });
    if (error) showToast(error.message);
  });

  // Open feedback modal explicitly
  feedbackLink.addEventListener("click", (e) => {
    e.preventDefault();
    fbDialog.showModal();
  });

  // ----- Goals -----
  goalsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    goalsEl.querySelectorAll(".chip").forEach((n) => n.classList.remove("active"));
    b.classList.add("active");
    goal = b.dataset.goal;
  });

  // ----- Recording -----
  async function startRec() {
    if (recording) return;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return showToast("Mic permission is required.");
    }
    chunks = [];
    const mime =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    mediaRec = new MediaRecorder(mediaStream, { mimeType: mime });
    mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRec.start();

    recording = true;
    btnStart.disabled = true;
    btnStop.disabled = false;
    btnSend.disabled = true;
    btnRnd.disabled = true;
    setLive(true);

    tStart = Date.now();
    tTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - tStart) / 1000);
      timerEl.textContent = fmt(sec);
      setMeter(sec);
    }, 250);
  }

  function stopRec() {
    if (!recording) return;
    mediaRec.stop();
    mediaStream.getTracks().forEach((t) => t.stop());
    clearInterval(tTimer);
    recording = false;
    btnStart.disabled = false;
    btnStop.disabled = true;
    btnSend.disabled = chunks.length === 0;
    btnRnd.disabled = false;
    setLive(false);
  }

  btnStart.addEventListener("click", startRec);
  btnStop.addEventListener("click", stopRec);

  // ----- Randomize prompt -----
  const PROMPTS = [
    "Describe a recent challenge you faced at work and how you handled it.",
    "Tell me about your last weekend in 45 seconds.",
    "Explain one problem your team faced and how you solved it.",
    "What is one skill you want to improve and why?",
    "Describe your last travel experience in brief."
  ];
  btnRnd.addEventListener("click", () => {
    if (btnRnd.disabled) return;
    promptEl.value = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  });

  // ----- Analyze -----
  btnSend.addEventListener("click", async () => {
    if (!chunks.length) return showToast("Nothing to send.");
    const durSec = Math.max(1, Math.floor((Date.now() - tStart) / 1000));
    const blob = new Blob(chunks, { type: "audio/webm" });

    // Gating: if this is the 2nd analysis and guest, ask feedback first (but allow skip).
    if (localSessions === 1 && !allowNextWithoutLogin) {
      fbDialog.showModal();
      return; // continue after user closes/submit
    }
    // Gating: after 5, require sign-in (still save local session in DB as anonymous).
    if (localSessions >= 5 && !currentUser) {
      showToast("Please sign in to continue.");
      return;
    }

    lockSend(true);
    try {
      const fd = new FormData();
      fd.append("files[]", blob, "audio.webm");
      fd.append("duration_sec", String(durSec));
      fd.append("goal", goal);
      fd.append("prompt_text", promptEl.value || "");

      const res = await fetch(API_URL, { method: "POST", body: fd });
      const json = await res.json();

      // Render
      const level =
        json.friendly_level ||
        json.cefr_estimate ||
        (json.fluency?.note ? "—" : "—");

      levelLabelEl.textContent = level;
      fillersEl.textContent = String(json.fluency?.fillers ?? 0);
      fixBox.textContent = json.one_thing_to_fix || "—";
      nextBox.textContent = json.next_prompt || "—";

      // grammar list
      const grammar = Array.isArray(json.grammar_issues) ? json.grammar_issues : [];
      gramBox.innerHTML = grammar.length
        ? grammar.map(g => `→ ${g.error}\nTry: ${g.fix}\nWhy: ${g.why}\n`).join("\n")
        : "—";

      // pronunciation list
      const pr = Array.isArray(json.pronunciation) ? json.pronunciation : [];
      pronBox.innerHTML = pr.length
        ? pr.map(p => `${p.sound_or_word} — ${p.issue}\nTry: ${p.minimal_pair}`).join("\n")
        : "—";

      // Update counts / streak
      localSessions += 1;
      localStorage.setItem("ec_sessions", String(localSessions));
      sessionsEl.textContent = String(localSessions);
      localSessionsEl.textContent = String(localSessions);

      // daily streak
      const today = nowISODate();
      if (lastDate !== today) {
        tmpStreak = (lastDate ? tmpStreak + 1 : 1);
        lastDate = today;
        localStorage.setItem("ec_streak", String(tmpStreak));
        localStorage.setItem("ec_last_date", today);
      }
      streakEl.textContent = String(tmpStreak);

      // Save session in DB (guest or user)
      if (sb) {
        await sb.from("sessions").insert({
          user_id: currentUser?.id ?? null,
          duration_sec: durSec,
          level_label: level,
          goal
        });
      }
    } catch (err) {
      console.error(err);
      showToast("Analyze failed. Please try again.");
    } finally {
      lockSend(false);
      // reset one recording
      chunks = [];
      btnSend.disabled = true;
      timerEl.textContent = "00:00";
      meterEl.style.width = "0";
      meterEl.style.background = "var(--bad)";
    }
  });

  // ----- Feedback modal -----
  let rating = 0;
  starsRow.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    rating = Number(b.dataset.rate);
    starsRow.querySelectorAll("button").forEach((n) =>
      n.classList.toggle("active", Number(n.dataset.rate) <= rating)
    );
  });

  fbForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    // Require SOME content (rating OR text OR name/email). Otherwise ask to Skip.
    const hasContent =
      rating > 0 || !!fbText.value.trim() || !!fbName.value.trim() || !!fbEmail.value.trim();

    if (!hasContent) {
      fbHint.textContent = "Please write something (or choose stars) — or press Skip.";
      fbHint.style.color = "#ffb8c6";
      return;
    }

    try {
      if (sb) {
        await sb.from("feedback").insert({
          user_id: currentUser?.id ?? null,
          name: fbName.value.trim() || null,
          email: fbEmail.value.trim() || null,
          rating: rating || null,
          text: fbText.value.trim() || null
        });
      }
      allowNextWithoutLogin = true;
      fbDialog.close();
      showToast("Thanks for your feedback!");
    } catch (err) {
      console.error(err);
      showToast("Could not save feedback (still continuing).");
      allowNextWithoutLogin = true;
      fbDialog.close();
    }
  });

  fbSkip.addEventListener("click", () => {
    allowNextWithoutLogin = true;
    fbDialog.close();
  });
  fbClose.addEventListener("click", () => fbDialog.close());

  // ----- Leaderboard (simple) -----
  async function loadLeaderboard() {
    if (!sb || !currentUser) return;
    try {
      // If you created a SQL function `top_users_by_sessions()`
      const { data, error } = await sb.rpc("top_users_by_sessions");
      if (error) throw error;
      if (!Array.isArray(data) || !data.length) {
        boardBox.textContent = "No public data yet.";
        return;
      }
      boardBox.textContent = data
        .slice(0, 10)
        .map((r, i) => `${i + 1}. ${r.display_text || r.email || "User"} — ${r.sessions} sessions`)
        .join("\n");
    } catch (e) {
      console.warn(e.message);
      boardBox.textContent = "Public board temporarily unavailable.";
    }
  }

  // ----- Init render -----
  sessionsEl.textContent = String(localSessions);
  localSessionsEl.textContent = String(localSessions);
  streakEl.textContent = String(tmpStreak || 0);
})();
