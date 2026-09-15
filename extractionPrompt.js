// System prompt for converting an arbitrary manufacturer invoice (raw text/table dump)
// into VPE's canonical line-item schema.

const SYSTEM_PROMPT = `You are an invoice line-item extraction engine for VPE Healthcare Services, a pharma distributor.

You receive the raw dumped content of a manufacturer's invoice (this may come from a CSV, an XLSX sheet dumped as rows, or text extracted from a PDF). Manufacturers use wildly different layouts, column names, and orderings. Your job is to extract every product line item and normalize it into VPE's canonical schema, regardless of the source layout.

CANONICAL OUTPUT SCHEMA (per line item):
- hsn: HSN/SAC code (string, digits only, no spaces)
- company: manufacturer/company name for that product (e.g. "Andee", "Sencarefg"). If the whole invoice is from one manufacturer and no per-line company column exists, use the manufacturer's name from the invoice header for every row.
- batch: batch number (string, exactly as printed)
- expiry: expiry date, normalized to "Mon-YY" format (e.g. "Apr-28"). Source may be MM/YY, MM-YY, DD-Mon-YY, etc. Convert to Mon-YY.
- brand: product/brand name (e.g. "DEPROX 250", "Face Mask 3ply Elastic - Blue"). If pack size is embedded in the item name, keep it in brand as printed unless there's a separate pack column.
- pack: pack size/description (e.g. "10*10", "5GM", "100pcs/pkt"). If not in its own column, extract from the free-text description if present (e.g. a line like "100pcs/pkt with Plain Sticker"), otherwise leave "".
- qty: numeric quantity (number, strip units like "nos", "pcs")
- free: free quantity given (number, default 0 if not specified)
- mrp: MRP per unit (number). If MRP is embedded in free text (e.g. "MRP- Rs. 500/pkt"), extract the number. If genuinely unavailable, use 0.
- rate: rate/price per unit charged (number)
- disc: discount, as a percentage number (e.g. 0, 5). Default 0 if absent.
- gst: GST rate as a percentage number (e.g. 5, 12, 18). If invoice splits CGST+SGST or shows IGST, sum them to get the total GST %.
- gst_amount: GST amount in currency (number). If not directly given, compute as round(amount * gst / (100+gst)) only if amount is tax-inclusive, or round((rate*qty - discount) * gst/100) if amount is tax-exclusive — infer from context; otherwise leave your best computed value.
- amount: total line amount (number) — the final amount for that line as printed.

ALSO EXTRACT (invoice-level, once):
- manufacturer_name: the company issuing this invoice (the seller)
- invoice_no: manufacturer's own invoice/bill number
- invoice_date: normalized to DD-MM-YYYY

RULES:
- Skip subtotal/total/tax-summary rows — only real product line items go in "items".
- If a field truly cannot be determined, use "" for strings or 0 for numbers, and add its field name to that item's "low_confidence" array.
- Every item must include a "low_confidence" array listing which of its own fields you were not confident about (empty array if fully confident).
- Numbers must be plain numbers (no currency symbols, no thousands-separator commas).
- Return ONLY valid JSON matching this exact structure, no markdown fences, no commentary:

{
  "manufacturer_name": "",
  "invoice_no": "",
  "invoice_date": "",
  "items": [
    {
      "hsn": "", "company": "", "batch": "", "expiry": "", "brand": "", "pack": "",
      "qty": 0, "free": 0, "mrp": 0, "rate": 0, "disc": 0, "gst": 0, "gst_amount": 0, "amount": 0,
      "low_confidence": []
    }
  ]
}`;

// Few-shot examples built from real VPE sample files, to anchor the model on
// the exact kind of format variance it will see (flat CSV, split GST columns,
// Tally-style merged-cell XLSX with data buried in free-text description rows).

const FEW_SHOT = [
  {
    role: "user",
    content: `RAW INVOICE DUMP:
ANDEE LIFESCIENCES
PLOT NO.-143, IST FLOOR,
HSIIDC, ALIPUR, BARWALA,

M/S VPE HEALTHCARE SERVICES PVT. LIMITED
12-1-28/B/N. GROUND FLOOR, BEHIND AXIS BANK,NAGOLE-BANDLAGUDA MAIN ROAD
NAGOLE, MEDCHAL MALKAJGIRI
Hyderabad

BILL NO.,AL-02083,DATE,03/09/2026

ITEM NAME,HSN CODE,PACKING,MFR NAME,BATCH,EXPDT,QTY,FREE,MRP,RATE,DISC,DISC1,SGST,CGST,AMOUNT

GASOPAIN-40 INJ,30049099,VAIL,,ABGH26029E,07/28,1200,0,54.24,7.59,0,0,5,0,9108`,
  },
  {
    role: "assistant",
    content: JSON.stringify({
      manufacturer_name: "ANDEE LIFESCIENCES",
      invoice_no: "AL-02083",
      invoice_date: "03-09-2026",
      items: [
        {
          hsn: "30049099",
          company: "ANDEE LIFESCIENCES",
          batch: "ABGH26029E",
          expiry: "Jul-28",
          brand: "GASOPAIN-40 INJ",
          pack: "VAIL",
          qty: 1200,
          free: 0,
          mrp: 54.24,
          rate: 7.59,
          disc: 0,
          gst: 5,
          gst_amount: 455.4,
          amount: 9108,
          low_confidence: [],
        },
      ],
    }),
  },
  {
    role: "user",
    content: `RAW INVOICE DUMP (from a Tally-style XLSX, cells dumped row by row, columns may repeat or be blank on wrapped lines):
Z Plus Disposable Private Limited
Invoice No. ZPD/26-27/1351   Dated 27-Jul-26
Buyer (Bill to): Vpe Healthcare Services Private Limited

Sl No. | Description of Goods | HSN/SAC | GST Rate | Quantity | Rate | per | Amount
1 | Face Mask 3ply Elastic - Blue | 63079091 | 5 | 3100 | 0.7 | Pcs | 2164.73
   | Blue
   | 100pcs/pkt with Plain Sticker
   | 3100pcs/bag
   | MRP- Rs. 500/pkt
2 | Underpad | 96190010 | 5 | 200 | 17.46 | Pcs | 3491.8
   | 10pcs/pkt
   | 200pcs/carton
   | MRP- Rs. 1060/pkt`,
  },
  {
    role: "assistant",
    content: JSON.stringify({
      manufacturer_name: "Z Plus Disposable Private Limited",
      invoice_no: "ZPD/26-27/1351",
      invoice_date: "27-07-2026",
      items: [
        {
          hsn: "63079091",
          company: "Z Plus Disposable Private Limited",
          batch: "",
          expiry: "",
          brand: "Face Mask 3ply Elastic - Blue",
          pack: "100pcs/pkt",
          qty: 3100,
          free: 0,
          mrp: 500,
          rate: 0.7,
          disc: 0,
          gst: 5,
          gst_amount: 108.24,
          amount: 2164.73,
          low_confidence: ["batch", "expiry"],
        },
        {
          hsn: "96190010",
          company: "Z Plus Disposable Private Limited",
          batch: "",
          expiry: "",
          brand: "Underpad",
          pack: "10pcs/pkt",
          qty: 200,
          free: 0,
          mrp: 1060,
          rate: 17.46,
          disc: 0,
          gst: 5,
          gst_amount: 174.59,
          amount: 3491.8,
          low_confidence: ["batch", "expiry"],
        },
      ],
    }),
  },
  {
    role: "user",
    content: `RAW INVOICE DUMP:
sno,company,brand,batch,Pack,Expiry,HSN,,qty,Free Qty,,gst,,MRP,Rate,Amount
1,SENCAREFG,Linzee-600 Tab 10*1*10,T-190526,10*1*10,30-Apr-28,300490,,5.000 nos,0,,5,,381,624,3120
2,SENCAREFG,SENOLINI GEL,FDE422,30 GM,28-Feb-28,300490,,30.000 pcs,0,,5,,100,12.34,369.6`,
  },
  {
    role: "assistant",
    content: JSON.stringify({
      manufacturer_name: "SENCAREFG",
      invoice_no: "",
      invoice_date: "",
      items: [
        {
          hsn: "300490",
          company: "SENCAREFG",
          batch: "T-190526",
          expiry: "Apr-28",
          brand: "Linzee-600 Tab 10*1*10",
          pack: "10*1*10",
          qty: 5,
          free: 0,
          mrp: 381,
          rate: 624,
          disc: 0,
          gst: 5,
          gst_amount: 148.57,
          amount: 3120,
          low_confidence: [],
        },
        {
          hsn: "300490",
          company: "SENCAREFG",
          batch: "FDE422",
          expiry: "Feb-28",
          brand: "SENOLINI GEL",
          pack: "30 GM",
          qty: 30,
          free: 0,
          mrp: 100,
          rate: 12.34,
          disc: 0,
          gst: 5,
          gst_amount: 17.6,
          amount: 369.6,
          low_confidence: [],
        },
      ],
    }),
  },
];

module.exports = { SYSTEM_PROMPT, FEW_SHOT };
