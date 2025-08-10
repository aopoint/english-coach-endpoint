// Serverless handler for /api/analyze (Vercel)
// - Accepts multipart/form-data with fields: files[] (audio file), duration_sec, goal
// - Transcribes with Whisper
// - Asks GPT for structured JSON feedback
// - Returns JSON
//
// ENV: set OPENAI_API_KEY in Vercel (Project → Settings → Environment Variables)

const { readFile } = require('fs/promises');
const { IncomingForm } = require('formidable');
const OpenAI = require('openai');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  cors(res);

  // Preflight
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
    const form = new IncomingForm({ multiples: true, keepExtensions: true });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });

    // ---- pick first file regardless of field name (files[], file, audio, etc.)
    let f = null;
    if (files) {
      const values = Object.values(files);
      if (values.length) {
        const first = values[0];
        f = Array.isArray(first) ? first[0] : first;
      }
    }

    if (!f || !(f.filepath || f.path)) {
      return res
        .status(400)
        .json({ ok: false, error: 'No audio file found (expected files[]/file/audio).' });
    }

    const filePath = f.filepath || f.path;
    const filename =
      f.originalFilename || f.newFilename || f.name || 'audio.webm';
    const mimetype = f.mimetype || f.type || 'audio/webm';

    const buffer = await readFile(filePath);

    // normalize fields possibly coming as arrays
    const fieldVal = (obj, key, fallback = '') => {
      const v = obj?.[key];
      return Array.isArray(v) ? (v[0] ?? fallback) : (v ?? fallback);
    };

    const durationSec =
      parseFloat(fieldVal(fields, 'duration_sec', fieldVal(fields, 'duration', '0'))) || 0;
    const goal =
      (fieldVal(fields, 'goal', 'General English') || 'General English').toString().trim();

    // ---- 2) Transcribe with Whisper
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Prefer SDK helper if available, otherwise fall back to uploads helper
    let fileForOpenAI;
    if (openai.files && typeof openai.files.toFile === 'function') {
      fileForOpenAI = await openai.files.toFile(buffer, filename, { type: mimetype });
    } else {
      // fallback (older/newer SDKs)
      try {
        const { toFile } = require('openai/uploads');
        fileForOpenAI = await toFile(buffer, filename, { type: mimetype });
      } catch {
        const { Blob } = require('buffer');
        fileForOpenAI = new Blob([buffer], { type: mimetype });
      }
    }

    const tr = await openai.audio.transcriptions.create({
      file: fileForOpenAI,
      model: 'whisper-1',
      // language: 'en', // optional
    });

    const transcript = (tr?.text || '').trim();
    if (!transcript) {
      return res.status(400).json({ ok: false, error: 'Transcription empty.' });
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
      return res
        .status(500)
        .json({ ok: false, error: 'Model did not return JSON', raw });
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
