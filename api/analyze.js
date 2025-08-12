// api/analyze.js
const fs = require("fs");
const { IncomingForm } = require("formidable");
const OpenAI = require("openai");

const MODEL_CHAT    = "gpt-4o-mini-2024-07-18";
const MODEL_WHISPER = "whisper-1";
const MIN_SEC = 8, MIN_WORDS = 8;

function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
}
const wc = s => (String(s||'').trim().split(/\s+/).filter(Boolean).length);
const wpm = (t,sec)=> sec>0 ? Math.round((wc(t)/sec)*60) : 0;

module.exports = async (req,res)=>{
  cors(res);
  if (req.method==="OPTIONS") return res.status(200).end();
  if (req.method==="GET") return res.status(200).json({ ok:true, message:"Analyzer is alive. POST audio here." });
  if (req.method!=="POST") return res.status(405).json({ ok:false, error:"Method not allowed" });

  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ ok:false, error:"Missing OPENAI_API_KEY" });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try{
    const { fields, files } = await new Promise((resolve,reject)=>{
      const form = new IncomingForm({ multiples:true, keepExtensions:true, maxFileSize: 50*1024*1024 });
      form.parse(req,(err,fields,files)=> err?reject(err):resolve({fields,files}));
    });

    let f = files["files[]"] || files["file"] || files["audio"];
    if (Array.isArray(f)) f = f[0];
    if (!f?.filepath) return res.status(400).json({ ok:false, error:"No audio file found." });

    const duration = Number(fields.duration_sec||fields.duration||0) || 0;
    const goal     = String(fields.goal||'General English');
    const prompt_text = String(fields.prompt_text||'');

    // Transcribe
    const tr = await openai.audio.transcriptions.create({
      model: MODEL_WHISPER,
      file: fs.createReadStream(f.filepath)
    });
    const transcript = (tr?.text||'').trim();

    if (!transcript || duration<MIN_SEC || wc(transcript)<MIN_WORDS) {
      return res.status(200).json({
        fallback:true,
        cefr_estimate:"A1",
        friendly_level:"Beginner",
        fluency:{ wpm:wpm(transcript,duration), fillers:0, note:"Very short utterance." },
        grammar_issues:[],
        pronunciation:[],
        one_thing_to_fix:"Speak for at least 30–60 seconds in full sentences.",
        next_prompt:"Describe your last weekend in 45 seconds."
      });
    }

    const system = `
You are Speak Coach. Analyze spoken-English transcripts and return ONLY a JSON object.

Rules:
- Output must be English and concise.
- If the transcript drifts off-topic compared to "prompt_text", reflect that in "relevance.note" and reduce "relevance.score".
- Try to surface multiple *specific* grammar items (3–6) when present.
- Try to surface 1–3 pronunciation items based on words actually present in the transcript. If none are evident, you may infer common ESL pitfalls (e.g., "th", v/w, r/l) using words in the transcript; else leave the array empty.
- Prefer simple wording.

Return EXACT keys:
{
  "cefr_estimate": "A1|A2|B1|B2|C1|C2 or friendly label",
  "friendly_level": "Beginner|Elementary|Intermediate|Advanced|Fluent|Native-like",
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

    const userPayload = { transcript, duration_sec: Math.round(duration), goal, prompt_text };

    const completion = await openai.chat.completions.create({
      model: MODEL_CHAT,
      temperature: 0.3,
      response_format: { type:"json_object" },
      messages: [
        { role:"system", content: system },
        { role:"user",   content: JSON.stringify(userPayload) }
      ]
    });

    let json = {};
    try { json = JSON.parse(completion?.choices?.[0]?.message?.content||'{}'); }
    catch { return res.status(500).json({ ok:false, error:"Model did not return JSON" }); }

    // post-process defaults
    json.friendly_level ||= json.cefr_estimate || "Intermediate";
    json.fluency ||= {};
    json.fluency.wpm ??= wpm(transcript,duration);
    json.level_score = Math.max(0, Math.min(100, Math.round(Number(json.level_score||50))));
    if (!json.relevance) json.relevance = { score: 50, note: "—" };

    return res.status(200).json(json);
  }catch(err){
    console.error(err);
    return res.status(500).json({ ok:false, error: err.message||'Server error' });
  }
};
