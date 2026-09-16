const Groq = require("groq-sdk");
const { SYSTEM_PROMPT, FEW_SHOT } = require("./extractionPrompt");

async function extractWithGroq(rawDump) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set on the server.");
  }
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  // Groq uses OpenAI-style chat messages: system + alternating user/assistant.
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...FEW_SHOT, // already { role: "user"|"assistant", content } — same shape OpenAI-style APIs expect
    { role: "user", content: `RAW INVOICE DUMP:\n${rawDump.slice(0, 60000)}` },
  ];

  const modelsToTry = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
  let lastErr;

  for (const model of modelsToTry) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages,
        temperature: 0.1,
        response_format: { type: "json_object" },
      });
      const text = completion.choices[0].message.content;
      const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
      return JSON.parse(cleaned);
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

module.exports = { extractWithGroq };