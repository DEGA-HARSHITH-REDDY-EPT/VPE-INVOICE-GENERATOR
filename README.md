# VPE Invoice Converter — setup

## Run it
```
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # your Claude API key
node server.js
```
Then open http://localhost:3000

## How it works
1. Upload a manufacturer invoice (PDF/CSV/XLSX) in the browser.
2. Server parses it to plain text/rows (parseFile.js) and sends it to Claude
   with a schema + few-shot prompt built from your real sample invoices
   (extractionPrompt.js).
3. You review/edit the extracted line items in the browser (low-confidence
   cells are highlighted yellow).
4. Fill in buyer/order details (these come from the VPE order, not the
   manufacturer's invoice).
5. Click "Download CSV" or "Download XLSX" — generates a file in the exact
   VPE standard format (buildVpeInvoice.js), ready to re-upload to the admin
   panel.

## Next steps to harden for production
- Swap manual buyer/order entry for an auto-fill from your order DB by Order ID.
- Add auth (this currently has none).
- Add a "save extraction as new few-shot example" button so you can keep
  improving accuracy as new manufacturer formats show up, without touching code.
- Consider OCR (e.g. via a Claude image call) for scanned/image-only PDFs —
  pdf-parse only reads embedded text.
