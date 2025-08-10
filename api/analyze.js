// api/analyze.js
// Vercel serverless (Node 18+)
// POST multipart/form-data: files[] (or file/audio), duration_sec, goal, prompt_text
// Uses Whisper for STT, GPT for feedback JSON with level_score + relevance.
// CORS enabled.

const fs = require("fs");
const { IncomingForm } = require("formidable");
const OpenAI = require("openai");

// ------ Tunables ------
const MODEL_WHISPER = "whisper-1";
const MODEL_CHAT = "gpt-4o-mini-2024-07-18";
const MIN_SECONDS_FOR_ANALYSIS = 8;
const MIN_WORDS_FOR_ANALYSIS = 8;

// ------ Utils ------
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function parseNumber(n, def = 0) {
  const x = typeof n === "string" ? parseFloat(n) : Number(n);
  return Number.isFinite(x) ? x : def;
}

function wordCount(text) {
  const t = (text || "").trim();
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
}

function pick(obj, keys) {
  for (const k of keys) if (obj?.[k]) return obj[k];
  return null;
}

function wpm(transcript, sec) {
  const words = wordCount(transcript);
  return sec ? Math.round((words / sec) * 60) : 0;
}

function ceFRtoFriendly(s) {
  const x = String(s || "").toUpperCase().trim();
  if (x.startsWith("A1")) return "Beginner";
  if (x.startsWith("A2")) return "Elementary";
  if (x.startsWith("B1")) return "Intermediate";
  if (x.startsWith("B2")) return "Advanced";
  if (x.startsWith("C1")) return "Fluent";
  if (x.startsWith("C2")) return "Native-like";
  return s || "Intermediate";
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      multiples: true,
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024,
    });
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

// ------ Handler ------
module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, message: "Analyzer is alive. POST audio here." });
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });
  const openai = new OpenAI({ apiKey });

  try {
    // 1) Parse form
    const { fields, files } = await parseForm(req);
    let fileEntry =
      pick(files, ["files[]", "file", "audio"]) ||
      (Array.isArray(files) && files.length ? files[0] : null);
    fileEntry = Array.isArray(fileEntry) ? fileEntry[0] : fileEntry;

    if (!fileEntry?.filepath) {
      return res.status(400).json({ ok: false, error: "No audio file found (files[]/file/audio)." });
    }

    const durationSec = parseNumber(fields.duration_sec, 0);
    const goal = (fields.goal || "General English").toString();
    const prompt_text = (fields.prompt_text || "").toString();

    // 2) Transcribe
    const tr = await openai.audio.transcriptions.create({
      model: MODEL_WHISPER,
      file: fs.createReadStream(fileEntry.filepath),
      // language: "en", // let Whisper auto-detect unless you want to force EN
    });
    const transcript = (tr?.text || "").trim();

    const tooShort =
      durationSec < MIN_SECONDS_FOR_ANALYSIS || wordCount(transcript) < MIN_WORDS_FOR_ANALYSIS;

    if (!transcript || tooShort) {
      return res.status(200).json({
        fallback: true,
        cefr_estimate: "A1",
        friendly_level: "Beginner",
        rationale:
          "We didn’t catch enough speech to give accurate feedback. Try 45–90 seconds in full sentences.",
        fluency: { wpm: wpm(transcript, durationSec), fillers: 0, note: "—" },
        grammar_issues: [],
        pronunciation: [],
        one_thing_to_fix: "Speak for at least 30–60 seconds in full sentences.",
        next_prompt: "Describe your last weekend (~45s).",
        level_score: 20,
        relevance: { score: 50, note: "Not enough content to assess." },
      });
    }

    // 3) Ask GPT
    const system = `
You are Speak Coach. Analyze the user's spoken English transcript and return ONLY a JSON object.

- Output in English.
- Be specific and concise.
- If the transcript is off-topic from prompt_text, lower "relevance.score" and explain in note.
- Prefer 3–6 grammar items if available.

Schema:
{
  "cefr_estimate": "A1|A2|B1|B2|C1|C2 or friendly label",
  "level_score": 0-100,
  "rationale": "string",
  "fluency": { "wpm": number, "fillers": number, "note": "string" },
  "grammar_issues": [ { "error":"", "fix":"", "why":"" }, ... ],
  "pronunciation": [ { "sound_or_word":"", "issue":"", "minimal_pair":"" }, ... ],
  "one_thing_to_fix": "string",
  "next_prompt": "string",
  "relevance": { "score": 0-100, "note": "string" }
}
`.trim();

    const payload = {
      transcript,
      goal,
      prompt_text,
      duration_sec: Math.round(durationSec),
    };

    const completion = await openai.chat.completions.create({
      model: MODEL_CHAT,
      response_format: { type: "json_object" },
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content || "{}";
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      return res.status(500).json({ ok: false, error: "Model did not return JSON", raw });
    }

    // 4) Post-process
    if (!json.fluency) json.fluency = {};
    if (typeof json.fluency.wpm !== "number") json.fluency.wpm = wpm(transcript, durationSec);

    if (!json.friendly_level && json.cefr_estimate) {
      json.friendly_level = ceFRtoFriendly(json.cefr_estimate);
    }
    if (typeof json.level_score !== "number") json.level_score = 50;
    json.level_score = Math.max(0, Math.min(100, Math.round(json.level_score)));

    if (!json.relevance) json.relevance = { score: 50, note: "—" };
    if (typeof json.relevance.score !== "number") json.relevance.score = 50;
    json.relevance.score = Math.max(0, Math.min(100, Math.round(json.relevance.score)));

    return res.status(200).json(json);
  } catch (err) {
    console.error("analyze error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
};
