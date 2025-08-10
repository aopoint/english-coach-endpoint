// Serverless handler for /api/analyze (Vercel)
// - Accepts multipart/form-data with fields: files[] (audio file), duration_sec, goal
// - Transcribes with Whisper (forced English)
// - Asks GPT for structured JSON feedback (English-only)
// - Returns JSON or a friendly fallback

const { IncomingForm } = require('formidable');
const { createReadStream } = require('fs');
const OpenAI = require('openai');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function fallbackResponse(reason) {
  return {
    fallback: true,
    cefr_estimate: '',
    rationale: reason || "We didn’t catch enough speech to analyze.",
    fluency: { wpm: 0, fillers: 0, note: "" },
    grammar_issues: [],
    pronunciation: [],
    one_thing_to_fix: "Speak for at least 30–60 seconds in full sentences.",
    next_prompt: "Describe your last weekend in 45 seconds."
  };
}

module.exports = async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res
      .status(200)
      .json({ ok: true, message: 'Analyzer is alive. POST audio here.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // ---- 1) Parse multipart form
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = new IncomingForm({ multiples: true, keepExtensions: true });
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });

    // Find the uploaded file under common keys
    const candidates = ['files[]', 'file', 'audio', 'upload', 'audiofile'];
    let fileEntry = null;
    if (files) {
      for (const k of candidates) {
        if (files[k]) { fileEntry = files[k]; break; }
      }
      if (!fileEntry && Array.isArray(files) && files.length) fileEntry = files[0];
    }
    const f = Array.isArray(fileEntry) ? fileEntry[0] : fileEntry || {};

    const filepath = f.filepath || f.path;
    if (!filepath) {
      return res.status(200).json(fallbackResponse("No audio detected. Please record 60–90 seconds in English."));
    }

    const filename = f.originalFilename || f.newFilename || 'audio.webm';
    const mimetype = f.mimetype || 'audio/webm';
    const durationSec = parseFloat(fields.duration_sec || fields.duration || '0') || 0;
    const goal = (fields.goal || '').toString().trim() || 'General English';

    // ---- 2) Transcribe with Whisper (force English)
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const tr = await openai.audio.transcriptions.create({
      file: createReadStream(filepath),     // Node stream from formidable temp file
      model: 'whisper-1',
      language: 'en',                        // force English decoding
    });

    const transcript = (tr?.text || '').trim();

    // Empty or too short -> fallback
    if (!transcript) {
      return res.status(200).json(fallbackResponse());
    }

    // Guardrail: mostly non-English -> fallback
    const hasArabic = /[\u0600-\u06FF]/.test(transcript);
    const englishTokens = (transcript.match(/[A-Za-z]+/g) || []).length;
    if (hasArabic || englishTokens < 10) {
      return res
        .status(200)
        .json(fallbackResponse("We detected mostly non-English speech. Please speak in English so we can analyze you correctly."));
    }

    // ---- 3) Ask GPT for compact JSON feedback (English-only)
    const system = `
You are Speak Coach. Return ONLY a single JSON object with exactly these keys:
- cefr_estimate (one of A1, A2, B1, B2, C1)
- rationale (string)
- fluency { wpm:number, fillers:number, note:string }
- grammar_issues: [{ error:string, fix:string, why:string }]
- pronunciation: [{ sound_or_word:string, issue:string, minimal_pair:string }]
- one_thing_to_fix (string)
- next_prompt (string)

Hard rules:
- WRITE EVERYTHING IN ENGLISH. Do NOT use Arabic script or any non-Latin characters.
- If the learner uses other languages, still respond in English; if needed, transliterate into English letters (e.g., "marhaba") but prefer English words/examples.
- Keep examples and minimal pairs in English only.
- No markdown, no code fences, no extra keys, no extra text outside the JSON.
`.trim();

    const user = JSON.stringify({
      transcript,
      duration_sec: Math.round(durationSec),
      goal,
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini-2024-07-18',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';

    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      // If model ever returns non-JSON, degrade nicely instead of 500
      return res.status(200).json(fallbackResponse("We couldn’t parse the response. Please try another 60–90s English clip."));
    }

    return res.status(200).json(json);
  } catch (err) {
    console.error('analyze error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Server error' });
  }
};
