// api/analyze.js
// Vercel Node.js Serverless Function
// Accepts multipart/form-data with fields: files[] (audio.webm), duration_sec, goal
// Returns a strict JSON evaluation

const formidable = require("formidable");
const fs = require("node:fs");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: false, keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Use POST" });
    return;
  }

  try {
    const { fields, files } = await parseForm(req);

    // Support several field names from your FE
    const f =
      files?.audio ||
      files?.["files[]"] ||
      files?.file ||
      (files?.files && Array.isArray(files.files) ? files.files[0] : files?.files);

    if (!f || !f.filepath) {
      res.status(400).json({ ok: false, error: "No audio file in form-data (expected files[]/audio/file)." });
      return;
    }

    const durationSec = parseInt(
      (Array.isArray(fields.duration_sec) ? fields.duration_sec[0] : fields.duration_sec) || "0",
      10
    );
    const goal = (Array.isArray(fields.goal) ? fields.goal[0] : fields.goal) || "Work English";

    // 1) Transcribe with Whisper
    const fd = new FormData();
    fd.append("model", "whisper-1");
    fd.append("response_format", "json");
    fd.append("file", fs.createReadStream(f.filepath), f.originalFilename || "audio.webm");

    const trRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: fd,
    });

    if (!trRes.ok) {
      const t = await trRes.text();
      res.status(trRes.status).json({ ok: false, stage: "transcribe", error: t });
      return;
    }

    const trJson = await trRes.json();
    const transcript = trJson.text || "";

    // 2) Evaluate with Chat Completions (JSON-only)
    const prompt = {
      transcript,
      duration_sec: durationSec,
      goal,
    };

    const evalBody = {
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are Speak Coach. Return ONLY a single JSON object with these exact keys: " +
            "cefr_estimate (A1/A2/B1/B2/C1), rationale (string), " +
            "fluency { wpm:number, fillers:number, note:string }, " +
            "grammar_issues: [{ error, fix, why }], " +
            "pronunciation: [{ sound_or_word, issue, minimal_pair }], " +
            "one_think_to_fix (string), next_prompt (string). " +
            "No markdown, no code fences, no extra text.",
        },
        {
          role: "user",
          content: JSON.stringify(prompt),
        },
      ],
    };

    const evRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(evalBody),
    });

    if (!evRes.ok) {
      const t = await evRes.text();
      res.status(evRes.status).json({ ok: false, stage: "evaluate", error: t });
      return;
    }

    const evJson = await evRes.json();
    const content = evJson.choices?.[0]?.message?.content || "{}";
    let result;
    try {
      result = JSON.parse(content);
    } catch {
      // Fallback: if the model returned something odd, wrap it
      result = { raw: content };
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
};