const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const pdfParse = require("pdf-parse");

/**
 * Turns any supported manufacturer invoice file into a plain-text "raw dump"
 * suitable for feeding to the LLM extraction step. We deliberately keep this
 * dumb/lossy-safe (no assumptions about column meaning) — the LLM step does
 * the actual interpretation.
 */
async function fileToRawDump(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".csv") {
    return fs.readFileSync(filePath, "utf8");
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const wb = XLSX.readFile(filePath, { cellDates: false });
    let out = "";
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      out += `--- Sheet: ${sheetName} ---\n`;
      for (const row of rows) {
        const cells = row.map((c) => (c === "" || c === null || c === undefined ? "" : String(c).trim()));
        // Skip fully-empty rows to keep the dump compact.
        if (cells.every((c) => c === "")) continue;
        out += cells.join(" | ") + "\n";
      }
    }
    return out;
  }

  if (ext === ".pdf") {
    const buf = fs.readFileSync(filePath);
    const data = await pdfParse(buf);
    return data.text;
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

module.exports = { fileToRawDump };
