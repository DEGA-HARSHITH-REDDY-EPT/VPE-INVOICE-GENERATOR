const { GoogleGenerativeAI } = require("@google/generative-ai");
const { SYSTEM_PROMPT, FEW_SHOT } = require("./extractionPrompt");

async function extractWithGemini(rawDump) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set on the server.");
  }
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  // Try the primary model first; fall back to alternatives if it's overloaded (503).
  const modelsToTry = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.5-pro"];
  let lastErr;

  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: { responseMimeType: "application/json" },
      });

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
      // Only retry with next model on overload/unavailable errors; otherwise fail fast.
      if (!String(e.message).includes("503") && !String(e.message).includes("overloaded")) {
        throw e;
      }
    }
  }
  throw lastErr;
}

module.exports = { extractWithGemini };