const Groq = require("groq-sdk");
const { SYSTEM_PROMPT, FEW_SHOT } = require("./extractionPrompt");

async function extractWithGroq(rawDump) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set on the server.");
  }
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  // Groq's free tier caps at 8,000 tokens/minute total (prompt + few-shot + input + output),
  // much tighter than Gemini/Claude. Keep the raw dump small and cap output tokens too,
  // to leave enough headroom within that budget.
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...FEW_SHOT, // already { role: "user"|"assistant", content } — same shape OpenAI-style APIs expect
    { role: "user", content: `RAW INVOICE DUMP:\n${rawDump.slice(0, 4200)}` },
  ];

  const modelsToTry = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
  let lastErr;

  for (const model of modelsToTry) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages,
        temperature: 0.1,
        max_tokens: 3500,
        response_format: { type: "json_object" },
      });
      const text = completion.choices[0].message.content;
      if (!text || !text.trim()) {
        throw new Error("Model returned an empty response (likely ran out of output tokens mid-JSON).");
      }
      return parseJsonLoose(text);
    } catch (e) {
      lastErr = e;
      // If this model name is invalid/decommissioned, try the next one; otherwise fail.
      if (!String(e.message).includes("decommissioned") && !String(e.message).includes("not found")) {
        throw e;
      }
    }
  }
  throw lastErr;
}

// Strip markdown fences if present, then extract the outermost {...} block in
// case the model added any stray text before/after the JSON, before parsing.
function parseJsonLoose(text) {
  let cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned);
}

module.exports = { extractWithGroq };