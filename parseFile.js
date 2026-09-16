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

      // Merged cells: XLSX/openpyxl-style libraries only store the value in the
      // top-left cell of a merged range; every other cell in that range reads as
      // blank. When a merge is purely a wide label (e.g. a whole row merged as
      // one "row 4" cell), forward-filling loses nothing real — but when a merge
      // wipes out what should have been separate Qty/Rate/Amount cells (a
      // manufacturer export quirk we've seen), there's no data left to recover
      // from the cell grid alone; that gets handled downstream via totals-based
      // inference in the LLM prompt instead.
      if (ws["!merges"]) {
        for (const range of ws["!merges"]) {
          const topLeftAddr = XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c });
          const topLeftCell = ws[topLeftAddr];
          if (!topLeftCell) continue;
          for (let r = range.s.r; r <= range.e.r; r++) {
            for (let c = range.s.c; c <= range.e.c; c++) {
              if (r === range.s.r && c === range.s.c) continue;
              const addr = XLSX.utils.encode_cell({ r, c });
              if (!ws[addr]) ws[addr] = { ...topLeftCell };
            }
          }
        }
      }

      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      out += `--- Sheet: ${sheetName} ---\n`;
      for (const row of rows) {
        const cells = row.map((c) => (c === "" || c === null || c === undefined ? "" : String(c).trim()));
        // Skip fully-empty rows to keep the dump compact.
        if (cells.every((c) => c === "")) continue;
        // Collapse consecutive duplicate cells (an artifact of forward-filling merged
        // cells above) down to one — otherwise a wide merge prints the same text
        // 8+ times in a row and bloats token usage for no benefit.
        const collapsed = [];
        for (const c of cells) {
          if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== c || c === "") {
            collapsed.push(c);
          }
        }
        out += collapsed.join(" | ") + "\n";
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