/* =========================
   Feedback modal – v1.3.4
   ========================= */

const LS_SESSIONS            = 'ec_sessions';         // total sessions (local)
const LS_SESSIONS_SINCE_FB   = 'ec_since_fb';         // sessions since we last asked
const LS_FEEDBACK_DONE       = 'ec_feedback_done';    // "1" once submitted or skipped

// Grab elements (use your existing IDs)
const fbBack   = document.getElementById('fbBack');   // backdrop
const fbBox    = document.getElementById('fbBox');    // modal container
const fbClose  = document.getElementById('fbClose');  // top-right ×
const fbSkip   = document.getElementById('fbSkip');   // "Skip" button
const fbSend   = document.getElementById('fbSend');   // "Submit feedback & Continue"
const fbName   = document.getElementById('fbName');
const fbEmail  = document.getElementById('fbEmail');
const fbText   = document.getElementById('fbText');
// If you use stars, keep your existing code that sets currentRating (0..5).
let currentRating = window.__fbRating || 0;

// Safety: never show on first paint
function hideFeedback() {
  if (fbBack) { fbBack.classList.remove('open'); fbBack.setAttribute('aria-hidden', 'true'); }
  if (fbBox)  { fbBox.classList.remove('open');  fbBox.setAttribute('aria-hidden', 'true'); }
}
function showFeedback() {
  if (fbBack) { fbBack.classList.add('open'); fbBack.removeAttribute('aria-hidden'); }
  if (fbBox)  { fbBox.classList.add('open');  fbBox.removeAttribute('aria-hidden'); }
}

// Always start hidden (prevents the "stuck modal" issue)
document.addEventListener('DOMContentLoaded', hideFeedback);

// Close handlers
if (fbClose) fbClose.onclick = hideFeedback;
if (fbBack)  fbBack.onclick  = (e) => { if (e.target === fbBack) hideFeedback(); };
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideFeedback(); });

// Submit
if (fbSend) fbSend.onclick = async () => {
  const hasContent =
    (currentRating && currentRating > 0) ||
    (fbText && fbText.value.trim().length > 0) ||
    (fbName && fbName.value.trim().length > 0);

  if (!hasContent) {
    alert('Add a rating or a short note — or click Skip.');
    return;
  }

  // Best-effort insert; never block the UI
  try {
    if (window.supabase && window.supabase.from) {
      await window.supabase.from('feedback').insert({
        name:  fbName?.value?.trim()  || null,
        email: fbEmail?.value?.trim() || null,
        rating: currentRating || null,
        text:  fbText?.value?.trim()  || null,
      });
    }
  } catch (e) {
    console.warn('Feedback insert failed (ignored):', e);
  }

  localStorage.setItem(LS_FEEDBACK_DONE, '1');
  hideFeedback();
};

// Skip
if (fbSkip) fbSkip.onclick = () => {
  localStorage.setItem(LS_FEEDBACK_DONE, '1');
  hideFeedback();
};

// Decide when to show (call this AFTER a successful analysis)
window.__feedbackGateAfterAnalysis = function () {
  const done = localStorage.getItem(LS_FEEDBACK_DONE) === '1';
  let since = Number(localStorage.getItem(LS_SESSIONS_SINCE_FB) || '0');
  since += 1;
  localStorage.setItem(LS_SESSIONS_SINCE_FB, String(since));

  // Show only after the first successful analysis, and only once until the user submits or skips
  if (!done && since >= 1) {
    showFeedback();
    localStorage.setItem(LS_SESSIONS_SINCE_FB, '0'); // reset the counter once we show it
  }
};

// Optional helper you can call after “Send & Analyze” success too
window.__bumpLocalSession = function () {
  const n = Number(localStorage.getItem(LS_SESSIONS) || '0') + 1;
  localStorage.setItem(LS_SESSIONS, String(n));
};

// (Keep your existing version footer logic; bump text here if you want)
try {
  const verEl = document.getElementById('ver');
  if (verEl) verEl.textContent = 'v1.3.4';
} catch {}
