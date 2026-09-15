const { GoogleGenerativeAI } = require("@google/generative-ai");
const { SYSTEM_PROMPT, FEW_SHOT } = require("./extractionPrompt");

async function extractWithGemini(rawDump) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set on the server.");
  }
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-3.6-flash",
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: "application/json" },
  });

  // Convert our Anthropic-style few-shot examples (role: user/assistant) into
  // Gemini's chat history format (role: user/model).
  const history = FEW_SHOT.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(`RAW INVOICE DUMP:\n${rawDump.slice(0, 60000)}`);
  const text = result.response.text();

  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  return JSON.parse(cleaned);
}

module.exports = { extractWithGemini };
