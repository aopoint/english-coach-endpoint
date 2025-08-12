<!-- feedback.js -->
<script>
/* feedback.js — self-contained drop-in
   - Default-hide modal (via JS classes) and provide show/hide helpers
   - First-analysis gate (__bumpLocalSession + __feedbackGateAfterAnalysis)
   - Works with either #fbBox OR your existing #fbModal
   - Minimal star rating UX
*/

(function () {
  // ---- DOM refs (support both ids) ----
  const back = ensureBackdrop(); // #fbBack (created if missing)
  const box  = document.getElementById('fbBox') || document.getElementById('fbModal');
  const btnX = document.getElementById('fbClose');
  const btnSkip = document.getElementById('fbSkip');
  const btnSend = document.getElementById('fbSend');
  const nameEl  = document.getElementById('fbName');
  const emailEl = document.getElementById('fbEmail');
  const textEl  = document.getElementById('fbText');
  const starsEl = document.getElementById('stars');

  // ---- style bootstrap for fallback safety (in case CSS didn't ship) ----
  injectCss(`
    #fbBack, #fbBox, #fbModal { display:none; }
    #fbBack.open { display:block; position:fixed; inset:0; background:rgba(0,0,0,.55); backdrop-filter:blur(2px); z-index:9998; }
    #fbBox.open, #fbModal.open { display:block; position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
      width:min(760px,92vw); background:rgba(22,22,28,.94); border:1px solid rgba(255,255,255,.08);
      border-radius:14px; padding:18px; z-index:9999; box-shadow:0 15px 40px rgba(0,0,0,.5);
    }
    .white { color:#fff; }
    .stars button { font-size:18px; background:none; border:0; color:#b9a8ff; cursor:pointer; padding:.25rem .35rem; }
    .stars button.active { color:#8f78ff; }
  `);

  // ---- default hide on load ----
  hideNow();

  // ---- wire close/skip/send ----
  if (btnX)   btnX.onclick   = hideNow;
  if (btnSkip) btnSkip.onclick = hideNow;

  // stars UX
  if (starsEl) {
    starsEl.querySelectorAll('[data-val]').forEach(b => {
      b.addEventListener('click', () => {
        const val = Number(b.dataset.val || 0);
        starsEl.querySelectorAll('[data-val]').forEach(s => {
          s.classList.toggle('active', Number(s.dataset.val) <= val);
        });
        if (btnSend) btnSend.dataset.rating = String(val);
      });
    });
  }

  if (btnSend) {
    btnSend.onclick = async () => {
      // guard: either rating or text must be present—otherwise tell them to use "Skip"
      const rating = Number(btnSend.dataset.rating || 0);
      const text = (textEl?.value || '').trim();
      if (!rating && !text) {
        // Allowed path is to click Skip; keep modal up so user chooses
        return;
      }
      try {
        await tryInsertFeedback({
          name:  (nameEl?.value || '').trim() || null,
          email: (emailEl?.value || '').trim() || null,
          rating: rating || null,
          text
        });
      } catch (_) { /* non-blocking */ }
      localStorage.setItem('ec_feedback_done', '1');
      hideNow();
    };
  }

  // ---- public API ----
  function showNow() {
    if (!back || !box) return;
    back.classList.add('open');
    box.classList.add('open');
  }
  function hideNow() {
    if (back) back.classList.remove('open');
    if (box) box.classList.remove('open');
  }
  window.showFeedback = showNow;
  window.hideFeedback = hideNow;

  // ---- gating helpers ----
  window.__bumpLocalSession = function () {
    const n = Number(localStorage.getItem('ec_sessions') || '0') + 1;
    localStorage.setItem('ec_sessions', String(n));
  };
  window.__feedbackGateAfterAnalysis = function () {
    try {
      const done = localStorage.getItem('ec_feedback_done') === '1';
      if (done) return;
      const n = Number(localStorage.getItem('ec_sessions') || '0');
      if (n >= 1) showNow(); // show after first successful analysis
    } catch (_) {}
  };

  // ---- feedback insert (optional; no-throw on missing supabase) ----
  async function tryInsertFeedback(payload) {
    const s = window.supabase;  // present if you're already using Supabase
    if (!s || !s.createClient) return; // not fatal

    const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

    // tolerate existing global client or make a local one
    const client = window.__fbClient || (window.__fbClient = s.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
    const row = {
      name: payload.name,
      email: payload.email,
      rating: payload.rating,
      text: payload.text,
      created_at: new Date().toISOString()
    };
    // table: public.feedback (your schema)
    await client.from('feedback').insert(row);
  }

  // ---- utils ----
  function ensureBackdrop() {
    let el = document.getElementById('fbBack');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fbBack';
      el.className = 'modal-backdrop';
      document.body.appendChild(el);
    }
    return el;
  }
  function injectCss(css) {
    const tag = document.createElement('style');
    tag.textContent = css;
    document.head.appendChild(tag);
  }
})();
</script>
