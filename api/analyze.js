// Serverless handler for /api/analyze (Vercel)
// - Accepts multipart/form-data with fields: files[] (audio file), duration_sec, goal
// - Transcribes with Whisper
// - Asks GPT for structured JSON feedback
// - Returns JSON (falls back to friendly message if audio empty/too short)
//
// ENV: set OPENAI_API_KEY in Vercel (Project → Settings → Environment Variables)

const { readFile } = require('fs/promises');
const { IncomingForm } = require('formidable');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function fallbackJSON(msg) {
  return {
    fallback: true,
    cefr_estimate: '—',
    rationale: msg,
    fluency: { wpm: 0, fillers: 0, note: 'No speech detected.' },
    grammar_issues: [],
    pronunciation: [],
    one_thing_to_fix: 'Speak for at least 30–60 seconds in full sentences.',
    next_prompt: 'Describe your last weekend in 45 seconds.'
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
      form.parse(req, (err, flds, fls) =>
        err ? reject(err) : resolve({ fields: flds, files: fls })
      );
    });

    // Accept either files[] or audio/file
    const pick = (obj, keys) => keys.map(k => obj?.[k]).find(Boolean);
    let fileEntry =
      pick(files, ['files[]', 'file', 'audio']) ||
      (Array.isArray(files) && files.length ? files[0] : null);

    fileEntry = Array.isArray(fileEntry) ? fileEntry[0] : fileEntry || {};

    if (!fileEntry.filepath) {
      return res
        .status(200)
        .json(fallbackJSON('We didn’t receive any audio. Please try again.'));
    }

    const buffer = await readFile(fileEntry.filepath);
    const filename = fileEntry.originalFilename || 'audio.webm';
    const mimetype = fileEntry.mimetype || 'audio/webm';

    // Quick sanity check: empty / almost empty
    const size = buffer?.length || 0;
    if (size < 2000) {
      return res
        .status(200)
        .json(
          fallbackJSON(
            `The audio looked too short to analyze (${size} bytes). Try again closer to the mic.`
          )
        );
    }

    const goal =
      (fields.goal || '').toString().trim() || 'General English';
    const durationSec =
      parseFloat(fields.duration_sec || fields.duration || '0') || 0;

    // ---- 2) Transcribe with Whisper
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const fileForOpenAI = await toFile(buffer, filename, { type: mimetype });

    const tr = await openai.audio.transcriptions.create({
      file: fileForOpenAI,
      model: 'whisper-1',
      // language: 'en', // uncomment if you want to force English
    });

    const transcript = (tr?.text || '').trim();
    const words = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;

    if (!transcript || words < 3) {
      return res
        .status(200)
        .json(
          fallbackJSON(
            'We didn’t catch enough speech to analyze. Please speak for 30–60 seconds in full sentences.'
          )
        );
    }

    // ---- 3) Ask GPT for compact JSON feedback
    const system = `
You are Speak Coach. Return ONLY a single JSON object with these keys:
cefr_estimate (A1/A2/B1/B2/C1),
rationale (string),
fluency { wpm:number, fillers:number, note:string },
grammar_issues: [{ error, fix, why }],
pronunciation: [{ sound_or_word, issue, minimal_pair }],
one_thing_to_fix (string),
next_prompt (string).
No markdown, no code fences, no extra text.
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

    // Validate it's JSON
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      // Friendly fallback if the model failed to return JSON
      return res
        .status(200)
        .json(
          fallbackJSON(
            'I couldn’t build your feedback this time. Please try another recording.'
          )
        );
    }

    // ---- 4) Return feedback JSON
    return res.status(200).json(json);
  } catch (err) {
    console.error('analyze error:', err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || 'Server error' });
  }
};
