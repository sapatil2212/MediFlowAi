// ─────────────────────────────────────────────────────────────────────────────
// Client-side PDF invoice generator for subscription (AutoPay) payments.
// Reuses the existing `jspdf` dependency. Produces a branded payment receipt /
// tax invoice with full Cashfree transaction references. Used by both the
// tenant billing view and the super-admin dashboard.
// ─────────────────────────────────────────────────────────────────────────────
import { jsPDF } from "jspdf";

export interface SubscriptionInvoiceData {
  clinicName?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  plan?: string | null;
  amount: number;
  currency?: string | null;
  status?: string | null;
  paymentMethod?: string | null;
  paymentType?: string | null; // AUTH | CHARGE
  cfPaymentId?: string | null;
  cfTxnId?: string | null;
  cfOrderId?: string | null;
  subscriptionRef?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
}

function fmtDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtInr(amount: number): string {
  return `Rs ${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Generates and downloads a PDF invoice/receipt for a subscription payment. */
export function downloadSubscriptionInvoice(d: SubscriptionInvoiceData): void {
  const doc = new jsPDF();
  const brand: [number, number, number] = [0, 89, 198]; // #0059C6
  const dark: [number, number, number] = [24, 24, 27];
  const gray: [number, number, number] = [113, 113, 122];

  const invoiceNo = `BMT-${(d.cfPaymentId || d.subscriptionRef || Date.now().toString()).toString().slice(-10).toUpperCase()}`;
  const isReceipt = String(d.status || "").toUpperCase() === "SUCCESS";

  // Header
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...brand);
  doc.text("BookMyTime", 14, 20);

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...gray);
  doc.text("A product of Brightwave Digital Products LLP", 14, 26);
  doc.text("Pune, Maharashtra, India", 14, 31);

  doc.setFont("Helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...dark);
  doc.text(isReceipt ? "PAYMENT RECEIPT" : "INVOICE", 196, 20, { align: "right" });
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...gray);
  doc.text(`Invoice No: ${invoiceNo}`, 196, 26, { align: "right" });
  doc.text(`Date: ${fmtDate(d.paidAt || d.createdAt)}`, 196, 31, { align: "right" });

  doc.setDrawColor(brand[0], brand[1], brand[2]);
  doc.setLineWidth(1);
  doc.line(14, 36, 196, 36);

  // Billed to
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...dark);
  doc.text("Billed To", 14, 46);
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...gray);
  let y = 52;
  if (d.clinicName) { doc.text(String(d.clinicName), 14, y); y += 5; }
  if (d.customerName) { doc.text(String(d.customerName), 14, y); y += 5; }
  if (d.customerEmail) { doc.text(String(d.customerEmail), 14, y); y += 5; }
  if (d.customerPhone) { doc.text(String(d.customerPhone), 14, y); y += 5; }

  // Status badge (right)
  const statusLabel = String(d.status || "PENDING").toUpperCase();
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(statusLabel === "SUCCESS" ? 5 : statusLabel === "FAILED" ? 220 : 217, statusLabel === "SUCCESS" ? 150 : statusLabel === "FAILED" ? 38 : 119, statusLabel === "SUCCESS" ? 105 : 38);
  doc.text(`Status: ${statusLabel}`, 196, 52, { align: "right" });

  // Line items table
  const tableTop = Math.max(y, 66) + 6;
  (doc as any).autoTable({
    startY: tableTop,
    head: [["Description", "Billing", "Amount"]],
    body: [[
      `BookMyTime ${d.plan || ""} Plan${d.paymentType === "AUTH" ? " (Mandate Registration)" : ""}`.trim(),
      "Monthly",
      fmtInr(d.amount),
    ]],
    theme: "striped",
    headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 10 },
    bodyStyles: { fontSize: 9.5, textColor: [45, 55, 72] },
    columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 35 }, 2: { cellWidth: 37, halign: "right" } },
    margin: { left: 14, right: 14 },
  });

  let afterTable = (doc as any).lastAutoTable.finalY + 6;

  // Total
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...dark);
  doc.text("Total Paid", 150, afterTable, { align: "right" });
  doc.text(fmtInr(d.amount), 196, afterTable, { align: "right" });
  afterTable += 10;

  // Payment / transaction reference block
  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.4);
  doc.line(14, afterTable, 196, afterTable);
  afterTable += 7;

  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...dark);
  doc.text("Payment & Transaction Details", 14, afterTable);
  afterTable += 6;

  const rows: Array<[string, string]> = [
    ["Payment Gateway", "Cashfree"],
    ["Payment Method", d.paymentMethod || "-"],
    ["Payment Type", d.paymentType || "-"],
    ["Cashfree Payment ID", d.cfPaymentId || "-"],
    ["Cashfree Transaction ID", d.cfTxnId || "-"],
    ["Cashfree Order ID", d.cfOrderId || "-"],
    ["Subscription Reference", d.subscriptionRef || "-"],
    ["Paid On", fmtDate(d.paidAt || d.createdAt)],
  ];
  doc.setFontSize(9);
  for (const [label, value] of rows) {
    doc.setFont("Helvetica", "normal");
    doc.setTextColor(...gray);
    doc.text(label, 14, afterTable);
    doc.setFont("Helvetica", "bold");
    doc.setTextColor(...dark);
    doc.text(String(value), 80, afterTable);
    afterTable += 5.5;
  }

  // Footer
  const pageH = doc.internal.pageSize.height;
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...gray);
  doc.text("This is a system-generated invoice and does not require a physical signature.", 14, pageH - 14);
  doc.text("For billing queries: bookmytime1355@gmail.com  |  +91 9168 08 1355", 14, pageH - 9);

  doc.save(`Invoice_${invoiceNo}.pdf`);
}
