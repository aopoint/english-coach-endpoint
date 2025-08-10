// Serverless handler for /api/analyze (Vercel)
// - Accepts multipart/form-data with fields: files[] (audio file), duration_sec, goal
// - Transcribes with Whisper
// - Asks GPT for structured JSON feedback
// - Returns JSON
//
// ENV: set OPENAI_API_KEY in Vercel (Project → Settings → Environment Variables)

const { readFile } = require('fs/promises');
const formidable = require('formidable');
const OpenAI = require('openai');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Analyzer is alive. POST audio here.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // ---- 1) Parse multipart form
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = formidable({ multiples: true, keepExtensions: false });
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    });

    // Accept either files[] or audio/file
    const pick = (obj, keys) => keys.map(k => obj?.[k]).find(Boolean);
    const fileEntry =
      pick(files, ['files[]', 'file', 'audio']) ||
      (Array.isArray(files) && files.length ? files[0] : null);

    const f =
      (Array.isArray(fileEntry) ? fileEntry[0] : fileEntry) || {};

    if (!f.filepath) {
      return res.status(400).json({ ok: false, error: 'No audio file found (expected files[]).' });
    }

    const filename = f.originalFilename || 'audio.webm';
    const mimetype = f.mimetype || 'audio/webm';
    const buffer = await readFile(f.filepath);

    const durationSec = parseFloat(fields.duration_sec || fields.duration || '0') || 0;
    const goal = (fields.goal || '').toString().trim() || 'General English';

    // ---- 2) Transcribe with Whisper
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const fileForOpenAI = await openai.files.toFile(buffer, filename, { type: mimetype });

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
    try { json = JSON.parse(raw); } catch {
      return res.status(500).json({ ok: false, error: 'Model did not return JSON', raw });
    }

    // ---- 4) Return feedback JSON
    return res.status(200).json(json);
  } catch (err) {
    console.error('analyze error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Server error' });
  }
};
