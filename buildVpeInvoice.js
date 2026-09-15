const XLSX = require("xlsx");

function fmtMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function csvCell(v) {
  const s = v === undefined || v === null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function numberToWordsIndian(num) {
  // Minimal Indian-number-system words converter for the "Rupees ... Only" line.
  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
    "Eighteen", "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function two(n) {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
  }
  function three(n) {
    if (n >= 100) return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + two(n % 100) : "");
    return two(n);
  }
  n = Math.round(num);
  if (n === 0) return "Zero";
  let parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = n;
  if (crore) parts.push(three(crore) + " Crore");
  if (lakh) parts.push(three(lakh) + " Lakh");
  if (thousand) parts.push(three(thousand) + " Thousand");
  if (hundred) parts.push(three(hundred));
  return parts.join(" ");
}

/**
 * Builds the rows of a VPE-standard invoice (matching the exact layout of
 * Vpe Invoice/invoice_VPE-*.csv) from: header info (seller is always VPE,
 * buyer/order info supplied by the user) + normalized line items.
 */
function buildVpeInvoiceRows({ buyer, order, items }) {
  const rows = [];
  const push = (...cells) => rows.push(cells);

  push("Vpe Healthcare ServicesPvt Ltd");
  push("Address: 12-1-28/B/N, Axis bank building, Nagole-Bandlaguda Road, Hyderabad, Pin: 500068, Telangana, Code: 36");
  push("Phone No: 630 928 6363 | Email ID: info@vpehealthcare.com");
  push("DL No: TS/MDL/2022-95258");
  push("GSTIN No: 36AAHCV6330QIZP | PAN: AAHCV6330Q");
  push("");
  push("BUYER'S DETAILS:");
  push(buyer.name || "");
  push(`Address: ${buyer.address || ""}`);
  push(`Phone No: ${buyer.phone || ""} | Email: ${buyer.email || ""}`);
  push(`DL No: ${buyer.dlNo || ""} | Reg. No: ${buyer.regNo || ""}`);
  push(`GSTIN No: ${buyer.gstin || ""}`);
  push("");
  push(`Order ID: ${order.orderId || ""}`);
  push(`Inv. No: ${order.invNo || ""}`);
  push(`Invoice Date: ${order.invoiceDate || ""}`);
  push(`Invoice Time: ${order.invoiceTime || ""}`);
  push(`Invoice Due Date: ${order.invoiceDueDate || order.invoiceDate || ""}`);
  push(`Ordered By: ${order.orderedBy || ""}`);
  push("");
  push("SNo", "HSN", "Company", "Batch", "Expiry", "Brand", "Pack", "Qty", "Free", "MRP", "Rate", "Disc", "GST", "GST Amount", "Amount");

  let gstTotal = 0;
  let amountTotal = 0;
  items.forEach((it, i) => {
    const gstAmt = Number(it.gst_amount) || 0;
    const amt = Number(it.amount) || 0;
    gstTotal += gstAmt;
    amountTotal += amt;
    push(
      i + 1,
      it.hsn || "",
      it.company || "",
      it.batch || "",
      it.expiry || "",
      it.brand || "",
      it.pack || "",
      it.qty || 0,
      it.free || 0,
      fmtMoney(it.mrp),
      fmtMoney(it.rate),
      fmtMoney(it.disc || 0),
      it.gst || 0,
      fmtMoney(gstAmt),
      fmtMoney(amt)
    );
  });

  push("", "", "", "", "", "", "", "", "", "", "", "", "", fmtMoney(gstTotal), fmtMoney(amountTotal));
  push("");
  push("", "", "", "", "", "", "", "", "", "", "", "", "", "Sub Total", `₹ ${fmtMoney(amountTotal - gstTotal)}`);
  push("", "", "", "", "", "", "", "", "", "", "", "", "", "Less Disc", "₹ 0.00");
  push("", "", "", "", "", "", "", "", "", "", "", "", "", "GST", `₹ ${fmtMoney(gstTotal)}`);
  push("", "", "", "", "", "", "", "", "", "", "", "", "", "Add", "—");
  push("", "", "", "", "", "", "", "", "", "", "", "", "", "Add / Less", "—");
  const netPayable = Math.round(amountTotal);
  push("", "", "", "", "", "", "", "", "", "", "", "", "", "NET PAYABLE", `₹ ${netPayable.toLocaleString("en-IN")}`);
  push("", "", "", "", "", "", "", "", "", "", "", "", "", `Rupees ${numberToWordsIndian(netPayable)} Only`, "");
  push("");
  push("OUR BANK DETAILS:");
  push("A/c Name: Vpe Healthcare Services Private Limited");
  push("Bank: IndusInd Bank, LB Nagar Branch");
  push("A/c No: 25 70751 75151");
  push("IFSC: INDB0000839");
  push("");
  push("Terms & Conditions:");
  push("Goods once sold will not be taken back / exchanged.");
  push("Short Expiries will not be taken back.");
  push("All disputes subject to Hyderabad jurisdiction.");

  return rows;
}

function rowsToCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function rowsToXlsxBuffer(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Invoice");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = { buildVpeInvoiceRows, rowsToCsv, rowsToXlsxBuffer };
