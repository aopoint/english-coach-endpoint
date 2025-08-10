// api/analyze.js
// Serverless handler for /api/analyze (Vercel, Node 18+)
//
// Accepts multipart/form-data:
//   files[] | file | audio  (audio file)
//   duration_sec             (number, optional)
//   goal                     (string, optional)
//   prompt_text              (string, optional; what user tried to answer)
//
// Transcribes with Whisper, asks GPT for structured JSON,
// and returns JSON (or a fallback when too short). CORS/OPTIONS included.

const fs = require("fs");
const { IncomingForm } = require("formidable");
const OpenAI = require("openai");

// ---------- CONFIG ----------
const MIN_SECONDS_FOR_ANALYSIS = 8;
const MIN_WORDS_FOR_ANALYSIS   = 8;
const MODEL_CHAT               = "gpt-4o-mini-2024-07-18";
const MODEL_WHISPER            = "whisper-1";

// ---------- HELPERS ----------
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function parseNumber(n, def = 0) {
  const x = typeof n === "string" ? parseFloat(n) : Number(n);
  return Number.isFinite(x) ? x : def;
}

function wordCount(txt) {
  const t = (txt || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k]) {
      return obj[k];
    }
  }
  return null;
}

function computeWPM(transcript, durationSec) {
  const words = wordCount(transcript);
  if (!durationSec) return 0;
  return Math.round((words / durationSec) * 60);
}

function cefrToFriendly(s) {
  const x = String(s || "").toUpperCase().trim();
  if (!x) return "Beginner";
  if (x.startsWith("A1")) return "Beginner";
  if (x.startsWith("A2")) return "Elementary";
  if (x.startsWith("B1")) return "Intermediate";
  if (x.startsWith("B2")) return "Advanced";
  if (x.startsWith("C1")) return "Fluent";
  if (x.startsWith("C2")) return "Native-like";
  return s; // already friendly
}

// ---------- FORM PARSE ----------
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      multiples: true,
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB
    });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

// ---------- MAIN ----------
module.exports = async (req, res) => {
  cors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res
      .status(200)
      .json({ ok: true, message: "Analyzer is alive. POST audio here." });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // 1) Parse form
    const { fields, files } = await parseForm(req);

    // file may be under files[] / file / audio
    let fileEntry =
      pick(files, ["files[]", "file", "audio"]) ||
      (Array.isArray(files) && files.length ? files[0] : null);

    fileEntry = Array.isArray(fileEntry) ? fileEntry[0] : fileEntry;

    if (!fileEntry || !fileEntry.filepath) {
      return res
        .status(400)
        .json({ ok: false, error: "No audio file found (expected files[]/file/audio)." });
    }

    const filename    = fileEntry.originalFilename || "audio.webm";
    const durationSec = parseNumber(fields.duration_sec || fields.duration, 0);
    const goal        = (fields.goal || "General English").toString();
    const prompt_text = (fields.prompt_text || "").toString();

    // 2) Transcribe with Whisper
    const tr = await openai.audio.transcriptions.create({
      model: MODEL_WHISPER,
      file: fs.createReadStream(fileEntry.filepath),
      // language: "en", // uncomment to force English
    });

    const transcript = (tr?.text || "").trim();

    // Short/empty -> fallback
    const tooShort =
      durationSec < MIN_SECONDS_FOR_ANALYSIS ||
      wordCount(transcript) < MIN_WORDS_FOR_ANALYSIS;

    if (!transcript || tooShort) {
      return res.status(200).json({
        fallback: true,
        cefr_estimate: "A1",
        rationale:
          "We didn’t catch enough speech to give accurate feedback. Try speaking in full sentences for 45–90 seconds.",
        fluency: { wpm: computeWPM(transcript, durationSec), fillers: 0, note: "—" },
        grammar_issues: [],
        pronunciation: [],
        one_thing_to_fix: "Speak for at least 30–60 seconds in full sentences.",
        next_prompt: "Describe your last weekend in ~45 seconds.",
        transcript,               // include for FE if needed
        duration_sec: durationSec,
        goal,
      });
    }

    // 3) Ask GPT for JSON feedback
    const system = `
You are **Speak Coach**. Analyze the user's **spoken English** transcript and return **ONLY** a single JSON object.

Rules:
- Use English for all output.
- Be concise, helpful, and specific.
- If the transcript is off-topic from prompt_text, reflect that in "relevance".
- Surface several grammar items when present (about 3–6 lines).
- Prefer simple, clear wording.

Return JSON with these keys exactly:
{
  "cefr_estimate": "A1|A2|B1|B2|C1|C2 OR a friendly label (Beginner/Elementary/Intermediate/Advanced/Fluent/Native-like)",
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

    const userPayload = {
      transcript,
      duration_sec: Math.round(durationSec),
      goal,
      prompt_text,
    };

    const completion = await openai.chat.completions.create({
      model: MODEL_CHAT,
      response_format: { type: "json_object" },
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content || "{}";

    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      return res.status(500).json({ ok: false, error: "Model did not return JSON", raw });
    }

    // 4) Post-process / guards
    // Ensure arrays
    if (!Array.isArray(json.grammar_issues)) json.grammar_issues = [];
    if (!Array.isArray(json.pronunciation))  json.pronunciation  = [];

    // Fluency + WPM
    if (!json.fluency) json.fluency = {};
    if (typeof json.fluency.wpm !== "number") {
      json.fluency.wpm = computeWPM(transcript, durationSec);
    }
    if (typeof json.fluency.fillers !== "number") json.fluency.fillers = 0;
    if (typeof json.fluency.note !== "string")   json.fluency.note = "—";

    // Friendly level + score
    if (json.cefr_estimate) {
      json.friendly_level = cefrToFriendly(json.cefr_estimate);
    } else if (json.friendly_level) {
      // ok
    } else {
      json.friendly_level = "Intermediate";
    }

    if (typeof json.level_score !== "number") json.level_score = 50;
    json.level_score = Math.max(0, Math.min(100, Math.round(json.level_score)));

    // Relevance guard
    if (!json.relevance) json.relevance = { score: 50, note: "—" };
    if (typeof json.relevance.score !== "number") json.relevance.score = 50;
    json.relevance.score = Math.max(0, Math.min(100, Math.round(json.relevance.score)));

    // 5) Return (include transcript so FE can compute relevancy too)
    return res.status(200).json({
      ...json,
      transcript,
      duration_sec: Math.round(durationSec),
      goal,
    });
  } catch (err) {
    console.error("analyze error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
};
