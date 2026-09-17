const Groq = require("groq-sdk");
const { SYSTEM_PROMPT, FEW_SHOT } = require("./extractionPrompt");

// Whether an error means "this model name is unavailable" (deprecated, decommissioned,
// or simply doesn't exist for this account) — in which case we should try the next
// model in the fallback list rather than give up. Groq's actual error text varies
// ("model_not_found", "does not exist", "has been decommissioned", etc.) so this
// checks broadly rather than one exact phrase.
function isModelUnavailableError(e) {
  const msg = String(e.message).toLowerCase();
  return (
    msg.includes("decommissioned") ||
    msg.includes("not found") ||
    msg.includes("model_not_found") ||
    msg.includes("does not exist") ||
    msg.includes("do not have access")
  );
}

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
    { role: "user", content: `RAW INVOICE DUMP:\n${rawDump.slice(0, 2800)}` },
  ];

  const modelsToTry = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
  let lastErr;

  for (const model of modelsToTry) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages,
        temperature: 0,
        max_tokens: 4000,
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
      if (!isModelUnavailableError(e)) {
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

module.exports = { extractWithGroq, extractWithGroqVision };

/**
 * Vision-based extraction for scanned/flattened PDFs that have no real text
 * layer at all (checked upstream — fileToRawDump returns "" in that case).
 * Sends the rendered page image(s) directly to a vision-capable Groq model
 * instead of text, using the same schema/JSON contract.
 */
async function extractWithGroqVision(base64Images) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set on the server.");
  }
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const imageContent = base64Images.map((b64) => ({
    type: "image_url",
    image_url: { url: `data:image/png;base64,${b64}` },
  }));

  // Skip the (large) text few-shot examples here — vision models tokenize images
  // as a fixed chunk regardless of the invoice's text length, so the main budget
  // pressure is different; a plain instruction + the schema is enough context.
  const messages = [
    {
      role: "system",
      content: SYSTEM_PROMPT + "\n\nNOTE: You are being shown this invoice as an IMAGE (it had no extractable text layer), not as text. Read it visually the way a person would.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Extract the line items from this invoice image, following the schema and rules above. Return ONLY the JSON." },
        ...imageContent,
      ],
    },
  ];

  const modelsToTry = ["qwen/qwen3.8-27b"];
  let lastErr;

  for (const model of modelsToTry) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages,
        temperature: 0,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      });
      const text = completion.choices[0].message.content;
      if (!text || !text.trim()) {
        throw new Error("Vision model returned an empty response.");
      }
      return parseJsonLoose(text);
    } catch (e) {
      lastErr = e;
      if (!isModelUnavailableError(e)) {
        throw e;
      }
    }
  }
  throw lastErr;
}