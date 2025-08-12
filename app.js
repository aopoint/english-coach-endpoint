/* =========================================================
   English Coach — app.js (v1.3.4)
   - Supabase auth (Google, Email link)
   - Recording, analyze, render results
   - Session + streak counters
   - Feedback gate (after first real analysis only)
   - Defensive selectors (won’t explode if an id is missing)
   ========================================================= */

(function () {
  // ---------------------------
  // Config
  // ---------------------------
  const { SUPABASE_URL, SUPABASE_ANON_KEY, API_URL, VERSION } =
    window.APP_CONFIG || {};

  // Write version in footer if element exists
  safeText("ver", VERSION || "");

  // Supabase client
  let supa = null;
  try {
    supa = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (_) {
    console.warn("Supabase client not created (missing CDN or config).");
  }

  // ---------------------------
  // Selectors (tweak here if your IDs differ)
  // ---------------------------
  const $ = (id) => document.getElementById(id);

  const els = {
    // status header
    liveChip: $("liveChip") || $("live"), // tiny dot
    levelText: $("levelVal") || $("levelLabel") || $("level"),
    fillersText: $("fillers"),
    sessionsText: $("sessions"),
    streakText: $("streak"),

    // left column
    goals: $("goals"),
    startBtn: $("btnStart") || $("startBtn"),
    stopBtn: $("btnStop") || $("stopBtn"),
    sendBtn: $("btnSend") || $("sendBtn"),
    timer: $("timer"),
    meter: $("meter"),
    prompt: $("prompt"),
    randomBtn: $("btnRnd") || $("randomize"),

    // main result panels
    pronBox: $("pronBox"),
    gramBox: $("gramBox"),
    fixBox: $("fixBox"),
    nextBox: $("nextBox"),

    // feedback modal
    fbBackdrop: $("fbBack"),
    fbBox: $("fbBox"),
    fbName: $("fbName"),
    fbEmail: $("fbEmail"),
    fbText: $("fbText"),
    fbSend: $("fbSend"),
    fbSkip: $("fbSkip"),
    fbClose: $("fbClose"),
    fbStarsWrap: $("stars"),

    // auth
    signInLink: $("signin"),
    feedbackLink: $("feedbackLink") || $("feedback"),
    signOutLink: $("signout"),
    topEmailPill: $("topEmailPill"),       // optional
    topAvatarImg: $("topAvatarImg")        // optional
  };

  // ---------------------------
  // State
  // ---------------------------
  let mediaRec = null;
  let mediaStream = null;
  let chunks = [];
  let timerInt = null;
  let recStartAt = 0;

  // local counters
  let localSessions = Number(localStorage.getItem("ec_sessions") || "0");
  let streakStartISO = localStorage.getItem("ec_streak_dt") || "";
  let streakCount = Number(localStorage.getItem("ec_streak") || "0");
  const sinceFeedback = localStorage.getItem("ec_since_fb") || ""; // marker
  const feedbackDone = localStorage.getItem("ec_feedback_done") === "1";

  // init UI counters
  if (els.sessionsText) els.sessionsText.textContent = String(localSessions);
  if (els.streakText) els.streakText.textContent = String(streakCount);

  // hide feedback modal by default (safety)
  hideFeedback();

  // wire up auth state if Supabase exists
  if (supa) supa.auth.onAuthStateChange(_onAuth);

  // Try to get current user for header immediately
  _refreshHeader();

  // ---------------------------
  // Recording
  // ---------------------------
  attach(els.startBtn, "click", startRecording);
  attach(els.stopBtn, "click", stopRecording);
  attach(els.sendBtn, "click", handleAnalyze);
  attach(els.randomBtn, "click", handleRandomizePrompt);

  // goal buttons
  if (els.goals) {
    els.goals.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      els.goals.querySelectorAll("button").forEach((n) => n.classList.remove("active"));
      b.classList.add("active");
      els.goals.dataset.goal = b.dataset.goal || "Work English";
    });
  }

  function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Microphone not available in this browser.");
      return;
    }
    if (timerInt) return; // already recording

    // reset UI
    setTimer(0);
    setMeter(0);
    setLive(true);
    setBusy(els.sendBtn, true, true); // disabled, show spinner style
    chunks = [];

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        mediaStream = stream;
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";

        mediaRec = new MediaRecorder(stream, { mimeType: mime });
        mediaRec.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        mediaRec.onstop = () => {
          // nothing here; we send on "Analyze"
        };

        mediaRec.start(100);
        recStartAt = Date.now();
        timerInt = setInterval(updateTimer, 200);
        buttonStates(true);
      })
      .catch((err) => {
        console.error(err);
        alert("Could not start microphone. Check permissions.");
        resetRecState();
      });
  }

  function stopRecording() {
    if (!mediaRec) return;
    try {
      mediaRec.stop();
      mediaStream?.getTracks()?.forEach((t) => t.stop());
    } catch (_) {}
    resetTimerOnly();
    buttonStates(false);
  }

  function buttonStates(isRecording) {
    if (els.startBtn) els.startBtn.disabled = isRecording;
    if (els.stopBtn) els.stopBtn.disabled = !isRecording;
  }

  function updateTimer() {
    const sec = Math.floor((Date.now() - recStartAt) / 1000);
    setTimer(sec);
    const pct = Math.min(1, sec / 90);
    setMeter(Math.round(pct * 100));
  }

  function resetTimerOnly() {
    clearInterval(timerInt);
    timerInt = null;
    setLive(false);
  }

  function resetRecState() {
    resetTimerOnly();
    mediaRec = null;
    mediaStream = null;
    chunks = [];
    buttonStates(false);
  }

  function setTimer(sec) {
    if (!els.timer) return;
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    els.timer.textContent = `${m}:${s}`;
  }

  function setMeter(pct) {
    if (!els.meter) return;
    els.meter.style.setProperty("--pct", String(pct));
  }

  function setLive(on) {
    if (!els.liveChip) return;
    els.liveChip.classList.toggle("on", !!on);
  }

  // ---------------------------
  // Analyze
  // ---------------------------
  async function handleAnalyze() {
    // if we never stopped, stop now
    if (mediaRec) stopRecording();

    // ensure we have some audio
    if (!chunks.length) {
      flash(els.sendBtn); // small visual feedback
      return;
    }

    const durationSec = Math.max(1, Math.round((Date.now() - recStartAt) / 1000));
    const goal = (els.goals?.dataset.goal || "Work English").toString();
    const promptText = (els.prompt?.value || "").toString();

    // Build a Blob
    const blob = new Blob(chunks, { type: "audio/webm" });
    const fd = new FormData();
    fd.append("file", blob, "audio.webm");
    fd.append("duration_sec", String(durationSec));
    fd.append("goal", goal);
    fd.append("prompt_text", promptText);

    setBusy(els.sendBtn, true);
    try {
      const res = await fetch(API_URL, { method: "POST", body: fd });
      const json = await res.json();

      // Render UI from JSON
      renderResults(json);

      // Save session in DB
      try {
        await insertSession(json, durationSec, goal);
      } catch (e) {
        console.warn("Insert session failed:", e?.message || e);
      }

      // IMPORTANT: only after *real* analysis (not fallback),
      // bump local session count and maybe show feedback.
      if (!json.fallback) {
        __bumpLocalSession();
        __feedbackGateAfterAnalysis();
      }
    } catch (err) {
      console.error(err);
      alert("Analyze failed. Please try again.");
    } finally {
      setBusy(els.sendBtn, false);
      // reset chunks so next recording is fresh
      chunks = [];
    }
  }

  function renderResults(json) {
    // level/fillers
    if (els.levelText) els.levelText.textContent =
      json.friendly_level || json.cefr_estimate || "-";
    if (els.fillersText) els.fillersText.textContent =
      String(json?.fluency?.fillers ?? 0);

    // grammar
    if (els.gramBox) {
      els.gramBox.innerHTML = (Array.isArray(json.grammar_issues) ? json.grammar_issues : [])
        .map(g => (
          `→ ${escapeHtml(g.error)}<br>` +
          `Try: ${escapeHtml(g.fix)}<br>` +
          `Why: ${escapeHtml(g.why)}`
        ))
        .join("<hr>");
      if (!els.gramBox.innerHTML.trim()) els.gramBox.textContent = "–";
    }

    // pronunciation
    if (els.pronBox) {
      els.pronBox.innerHTML = (Array.isArray(json.pronunciation) ? json.pronunciation : [])
        .map(p => (
          `<div><b>${escapeHtml(p.sound_or_word || "")}</b> — ${escapeHtml(p.issue || "")}<br>` +
          (p.minimal_pair ? `Try: ${escapeHtml(p.minimal_pair)}` : "") +
          `</div>`
        ))
        .join("<hr>");
      if (!els.pronBox.innerHTML.trim()) els.pronBox.textContent = "–";
    }

    // what to fix now
    if (els.fixBox) {
      els.fixBox.textContent = json.one_thing_to_fix || "–";
    }

    // next prompt
    if (els.nextBox) {
      els.nextBox.textContent = json.next_prompt || "–";
    }
  }

  async function insertSession(json, durationSec, goal) {
    if (!supa) return; // no-op if no supabase

    const {
      data: { user },
    } = await supa.auth.getUser();

    const payload = {
      user_id: user?.id || null,
      duration_sec: durationSec,
      level_label: json.friendly_level || json.cefr_estimate || null,
      goal: goal || null
    };

    const { error } = await supa.from("sessions").insert(payload);
    if (error) throw error;

    // Update "Sessions" badge in UI if we’re signed in
    if (els.sessionsText) {
      try {
        const { data, error: cErr } = await supa
          .from("sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user?.id || "___none___");

        if (!cErr && Number.isFinite(data)) {
          // head:true returns data=null and count in response; supabase-js v2
          // But some envs still return count via error?.count,
          // so fall back to getUser sessions locally if needed
        }
      } catch (_) {}
    }
  }

  // ---------------------------
  // Feedback gate (modal)
  // ---------------------------
  // stars state
  let fbRating = 0;

  // Wire feedback modal controls
  attach(els.fbSkip, "click", () => {
    markFeedbackDone();
    hideFeedback();
  });
  attach(els.fbClose, "click", () => {
    markFeedbackDone();
    hideFeedback();
  });
  attach(els.fbSend, "click", submitFeedback);

  if (els.fbStarsWrap) {
    // expect star buttons inside #stars with data-rating
    els.fbStarsWrap.addEventListener("click", (e) => {
      const b = e.target.closest("[data-rating]");
      if (!b) return;
      fbRating = Number(b.dataset.rating || 0);
      // simple visual on/off
      [...els.fbStarsWrap.querySelectorAll("[data-rating]")].forEach((star) => {
        const r = Number(star.dataset.rating || 0);
        star.classList.toggle("on", r <= fbRating);
      });
    });
  }

  async function submitFeedback() {
    // Require either a rating or a comment; otherwise ask user to Skip
    const hasSomething = fbRating > 0 || (els.fbText && els.fbText.value.trim());
    if (!hasSomething) {
      alert("Please rate or write a quick note — or press Skip.");
      return;
    }

    const name = els.fbName?.value?.trim() || null;
    const email = els.fbEmail?.value?.trim() || null;
    const text = els.fbText?.value?.trim() || null;

    // Best effort insert
    try {
      await supa?.from("feedback").insert({
        user_id: (await supa?.auth.getUser())?.data?.user?.id || null,
        name,
        email,
        rating: fbRating || null,
        text
      });
    } catch (_) {}

    markFeedbackDone();
    hideFeedback();
  }

  function markFeedbackDone() {
    localStorage.setItem("ec_feedback_done", "1");
  }

  function __feedbackGateAfterAnalysis() {
    // Show only after the very first successful analysis
    // and only if not already shown/done
    const shown = localStorage.getItem("ec_since_fb") || "";
    if (!shown) {
      localStorage.setItem("ec_since_fb", new Date().toISOString());
    }
    const alreadyDone = localStorage.getItem("ec_feedback_done") === "1";
    if (!alreadyDone && localSessions === 1) {
      showFeedback();
    }
  }

  function showFeedback() {
    if (!els.fbBackdrop || !els.fbBox) return;
    els.fbBackdrop.style.display = "block";
    els.fbBox.style.display = "block";
  }

  function hideFeedback() {
    if (els.fbBackdrop) els.fbBackdrop.style.display = "none";
    if (els.fbBox) els.fbBox.style.display = "none";
  }

  // ---------------------------
  // Local sessions + streak
  // ---------------------------
  function __bumpLocalSession() {
    // sessions
    localSessions += 1;
    localStorage.setItem("ec_sessions", String(localSessions));
    if (els.sessionsText) els.sessionsText.textContent = String(localSessions);

    // streak (per-day)
    const today = new Date();
    const dStr = today.toISOString().slice(0, 10);
    if (!streakStartISO) {
      streakStartISO = dStr;
      streakCount = 1;
    } else {
      // compare last played date to today
      const last = streakStartISO;
      if (last === dStr) {
        // same day → keep
      } else {
        const diff = dayDiff(last, dStr);
        if (diff === 1) {
          streakCount += 1;
          streakStartISO = dStr;
        } else if (diff > 1) {
          // reset
          streakCount = 1;
          streakStartISO = dStr;
        }
      }
    }
    localStorage.setItem("ec_streak", String(streakCount));
    localStorage.setItem("ec_streak_dt", streakStartISO);
    if (els.streakText) els.streakText.textContent = String(streakCount);
  }

  // ---------------------------
  // Auth (Google + Email link)
  // ---------------------------
  attach(els.signInLink, "click", (e) => {
    e.preventDefault();
    // default to Google (you can add an email entry UI in your header)
    startGoogle();
  });

  attach(els.signOutLink, "click", async (e) => {
    e.preventDefault();
    try { await supa?.auth.signOut(); } catch (_) {}
    _refreshHeader();
  });

  async function startGoogle() {
    try {
      await supa?.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: location.origin }
      });
    } catch (e) {
      alert("Google sign-in failed.");
    }
  }

  // OPTIONAL: call this if you have an email input (id="emailForLink") and a
  // button hooked to this function.
  async function startEmailLink(email) {
    if (!email) return;
    try {
      const { error } = await supa?.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin }
      });
      if (error) throw error;
      alert("Check your email for a sign-in link.");
    } catch (e) {
      alert("Could not send email link.");
    }
  }

  function _onAuth() {
    _refreshHeader();
  }

  async function _refreshHeader() {
    if (!supa) return;
    const { data: { user } } = await supa.auth.getUser();

    const emailText = user?.email || "Guest";
    if (els.topEmailPill) els.topEmailPill.textContent = emailText;

    // avatar (google picture if available in user metadata)
    if (els.topAvatarImg) {
      const url =
        user?.user_metadata?.avatar_url ||
        user?.user_metadata?.picture ||
        "";
      if (url) {
        els.topAvatarImg.src = url;
        els.topAvatarImg.style.display = "inline-block";
      } else {
        els.topAvatarImg.style.display = "none";
      }
    }
  }

  // ---------------------------
  // Helpers
  // ---------------------------
  function setBusy(btn, on, ghost) {
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle("is-busy", !!on);
    if (ghost) btn.classList.toggle("is-ghost", !!on);
  }

  function attach(el, ev, fn) {
    if (!el) return;
    el.addEventListener(ev, fn);
  }

  function flash(el) {
    if (!el) return;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 600);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function dayDiff(isoA, isoB) {
    const a = new Date(isoA + "T00:00:00Z").getTime();
    const b = new Date(isoB + "T00:00:00Z").getTime();
    return Math.round((b - a) / 86400000);
  }

  function safeText(id, text) {
    const n = $(id);
    if (n) n.textContent = text;
  }

  async function handleRandomizePrompt() {
    if (!els.prompt) return;
    const samples = [
      "Describe a recent project you led and one lesson you learned.",
      "Talk about your last weekend in ~45 seconds.",
      "Explain one problem your team faced and how you solved it.",
      "Describe a challenge you faced in your project and how you overcame it.",
      "What is one skill you want to improve and why?"
    ];
    const pick = samples[Math.floor(Math.random() * samples.length)];
    els.prompt.value = pick;
  }
})();
/* ===== Feedback modal hardening (append at bottom) ===== */
(function hardenFeedbackModal() {
  function _fbToggle(on) {
    const back = document.getElementById('fbBack');
    const box  = document.getElementById('fbBox');
    [back, box].forEach(el => el && el.classList.toggle('open', !!on));
  }
  // global fallbacks used by app.js show/hide
  window.showFeedback = () => _fbToggle(true);
  window.hideFeedback = () => _fbToggle(false);

  // Ensure hidden once DOM is ready (covers script-in-<head> without defer)
  document.addEventListener('DOMContentLoaded', () => _fbToggle(false));
})();
