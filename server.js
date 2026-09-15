const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const { fileToRawDump } = require("./parseFile");
const { SYSTEM_PROMPT, FEW_SHOT } = require("./extractionPrompt");
const { buildVpeInvoiceRows, rowsToCsv, rowsToXlsxBuffer } = require("./buildVpeInvoice");
const { extractWithGemini } = require("./gemini");

// Which LLM to use for extraction: "gemini" (free tier) or "claude" (paid, generally more accurate).
// Set LLM_PROVIDER=claude in your environment to switch back.
const LLM_PROVIDER = process.env.LLM_PROVIDER || "gemini";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ dest: path.join(__dirname, "uploads") });

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// 1) Upload a manufacturer invoice -> parse to raw text -> LLM-extract -> return structured items
app.post("/api/extract", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const rawDump = await fileToRawDump(req.file.path, req.file.originalname);
    if (!rawDump || !rawDump.trim()) {
      return res.status(422).json({ error: "Could not read any content from this file (empty or unsupported/scanned PDF)." });
    }

    let parsed;

    if (LLM_PROVIDER === "gemini") {
      try {
        parsed = await extractWithGemini(rawDump);
      } catch (e) {
        return res.status(502).json({ error: "Gemini extraction failed: " + e.message });
      }
    } else {
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
      }
      const messages = [
        ...FEW_SHOT,
        { role: "user", content: `RAW INVOICE DUMP:\n${rawDump.slice(0, 60000)}` },
      ];
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
      });
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock) return res.status(502).json({ error: "No text response from model" });
      try {
        const cleaned = textBlock.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
        parsed = JSON.parse(cleaned);
      } catch (e) {
        return res.status(502).json({ error: "Model did not return valid JSON", raw: textBlock.text });
      }
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Extraction failed" });
  }
});

// 2) Take reviewed/edited items + header info -> generate VPE-format CSV or XLSX
app.post("/api/export/:format", (req, res) => {
  try {
    const { format } = req.params; // "csv" | "xlsx"
    const { buyer = {}, order = {}, items = [] } = req.body;

    const rows = buildVpeInvoiceRows({ buyer, order, items });

    if (format === "csv") {
      const csv = "\uFEFF" + rowsToCsv(rows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="invoice_${order.invNo || "VPE"}.csv"`);
      return res.send(csv);
    }

    if (format === "xlsx") {
      const buf = rowsToXlsxBuffer(rows);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="invoice_${order.invNo || "VPE"}.xlsx"`);
      return res.send(buf);
    }

    res.status(400).json({ error: "format must be csv or xlsx" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VPE invoice tool running on http://localhost:${PORT}`));
