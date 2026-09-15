const { GoogleGenerativeAI } = require("@google/generative-ai");
const { SYSTEM_PROMPT, FEW_SHOT } = require("./extractionPrompt");

async function extractWithGemini(rawDump) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set on the server.");
  }
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  // Only gemini-3.6-flash / gemini-3.6-pro are valid on new API keys as of now.
  // On overload (503), retry the same model with a short backoff instead of
  // switching to a deprecated model name.
  const modelsToTry = ["gemini-3.6-flash", "gemini-3.6-pro"];
  const maxRetriesPerModel = 3;
  let lastErr;

  for (const modelName of modelsToTry) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { responseMimeType: "application/json" },
    });

    for (let attempt = 1; attempt <= maxRetriesPerModel; attempt++) {
      try {
        const history = FEW_SHOT.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(`RAW INVOICE DUMP:\n${rawDump.slice(0, 60000)}`);
        const text = result.response.text();
        const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
        return JSON.parse(cleaned);
      } catch (e) {
        lastErr = e;
        const isOverload = String(e.message).includes("503") || String(e.message).includes("overloaded");
        const isNotFound = String(e.message).includes("404");
        if (isNotFound) break; // this model name is invalid, move to next model
        if (isOverload && attempt < maxRetriesPerModel) {
          await new Promise((r) => setTimeout(r, attempt * 2000)); // 2s, 4s backoff
          continue;
        }
        if (!isOverload) throw e; // some other real error, fail fast
      }
    }
  }
  throw lastErr;
}

module.exports = { extractWithGemini };