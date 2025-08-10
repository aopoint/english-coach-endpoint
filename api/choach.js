// Vercel serverless function: /api/coach
import { OpenAI } from "openai";
import formidable from "formidable";
import fs from "fs";

// Let Vercel handle body parsing off (it is already off for serverless funcs)
export const config = {
  api: { bodyParser: false }
};

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    // Parse multipart form (files[] + duration_sec + goal)
    const form = formidable({ multiples: true, keepExtensions: true });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    });

    // Grab first file from "files[]"
    let fileObj;
    if (Array.isArray(files["files[]"])) {
      fileObj = files["files[]"][0];
    } else if (files["files[]"]) {
      fileObj = files["files[]"];
    }

    if (!fileObj?.filepath) {
      return res.status(400).json({ ok: false, message: "No audio file received (files[])." });
    }

    const durationSec = Number(fields.duration_sec || 0);
    const goal = String(fields.goal || "Work English");

    // 1) Transcribe with Whisper
    const transcriptResp = await client.audio.transcriptions.create({
      file: fs.createReadStream(fileObj.filepath),
      model: "whisper-1"
    });
    const transcript = transcriptResp.text?.trim() || "";

    // 2) Ask GPT for evaluation JSON
    const systemPrompt = `
You are Speak Coach. Return ONLY a single JSON object with these keys:
  cefr_estimate (A1/A2/B1/B2/C1),
  rationale (string),
  fluency { wpm:number, fillers:number, note:string },
  grammar_issues: [{ error, fix, why }],
  pronunciation: [{ sound_or_word, issue, minimal_pair }],
  one_th ing_to_fix (string),
  next_prompt (string).
No markdown, no extra text. Keep under 120 words of rationale. 
Focus on Arabic→English pitfalls (p/b, v/f, a/the, th→s/z, tense).
    `.trim();

    const userPayload = {
      transcript,
      duration_sec: durationSec,
      goal
    };

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) }
      ],
      temperature: 0.3
    });

    const content = completion.choices[0]?.message?.content || "{}";

    // Return JSON back to the page
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(content);
  } catch (err) {
    console.error("Coach endpoint error:", err);
    return res.status(500).json({ ok: false, message: String(err?.message || err) });
  }
}