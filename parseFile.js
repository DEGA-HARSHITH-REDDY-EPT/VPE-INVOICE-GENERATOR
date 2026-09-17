const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { PDFParse } = require("pdf-parse"); // v2 API: class-based, not a plain function

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

    // Prefer getTable(): it keeps values grouped by column instead of flattening
    // everything into reading-order text, which is unreliable for invoices (numbers
    // end up in the wrong apparent order). When a row spans multiple line items,
    // each cell holds newline-separated values in matching positions across columns
    // — we zip those back together into clean, unambiguous per-item rows below.
    // Use a fresh parser instance per attempt — a destroyed parser can't be reused.
    try {
      const tableParser = new PDFParse({ data: buf });
      const tableResult = await tableParser.getTable();
      await tableParser.destroy();

      const hasTable = tableResult.pages.some((p) => p.tables && p.tables.length > 0);
      if (hasTable) {
        let out = "";
        for (const page of tableResult.pages) {
          for (const table of page.tables || []) {
            if (table.length === 0) continue;
            const header = table[0].map((h) => (h || "").replace(/\n/g, " ").trim());
            // Skip genuinely empty/noise tables (e.g. a decorative header block with
            // no real cell content) — but don't require multiple columns, since some
            // legitimate tables (like the totals/grand-total block) are single-column.
            const meaningfulHeaderCount = header.filter((h) => h && h.length > 1).length;
            if (meaningfulHeaderCount < 1) continue;
            // Skip tables that are pure noise for extraction purposes (detailed tax-rate
            // breakdowns, boilerplate terms) — we already get Sub Total/GST/NET PAYABLE
            // from the totals table, which is what the extraction actually needs.
            const headerText = header.join(" ").toLowerCase();
            if (headerText.includes("terms & conditions") || headerText.includes("tax detail")) continue;

            out += "TABLE HEADER: " + header.join(" | ") + "\n";
            for (let r = 1; r < table.length; r++) {
              const row = table[r];
              // Split each cell on newlines; a row with N line items has N lines per cell.
              const cellLines = row.map((cell) => String(cell ?? "").split("\n"));
              const maxLines = Math.max(1, ...cellLines.map((l) => l.length));
              for (let li = 0; li < maxLines; li++) {
                const reconstructed = header.map((h, ci) => {
                  const val = (cellLines[ci] && cellLines[ci][li] !== undefined) ? cellLines[ci][li] : (cellLines[ci]?.[0] || "");
                  return `${h}: ${val.trim()}`;
                });
                const lineText = reconstructed.join(" | ").trim();
                // Skip rows that carry no real content (just colons/pipes/blank values).
                const meaningfulValueCount = reconstructed.filter((cell) => {
                  const v = cell.split(":").slice(1).join(":").trim();
                  return v && v !== ":" && v.length > 0;
                }).length;
                if (meaningfulValueCount >= 1) out += lineText + "\n";
              }
            }
            out += "\n";
          }
        }
        // Sanity check: some PDF layouts cause getTable() to misparse structure
        // entirely (e.g. treating a repeated letterhead as a giant single column,
        // which duplicates itself on every row and can even drop the actual product
        // row completely). A wildly oversized dump for what's normally a short
        // single-page invoice is a strong signal of that failure mode — bail out
        // to plain text extraction instead of feeding garbage to the model.
        if (out.trim() && out.length < 6000) return out;
      }
    } catch (e) {
      // getTable can fail on some PDFs (scanned/no clear table structure) — fall
      // through to plain text extraction below.
    }

    const textParser = new PDFParse({ data: buf });
    const result = await textParser.getText();
    await textParser.destroy();
    return result.text;
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

module.exports = { fileToRawDump };