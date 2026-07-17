// ─────────────────────────────────────────────────────────────────────────────
// Client-side PDF invoice generator for ALL Cashfree payments — one-time orders
// AND recurring (AutoPay) subscription charges. Produces a branded tax invoice /
// payment receipt with the product logo, a unique digital invoice number, a
// unique internal transaction reference, and the full set of Cashfree gateway
// references (payment id, transaction id, order id, mode, date/time) plus the
// customer's name, address, email and phone.
//
// System-generated: no physical signature required. Used by both the tenant
// billing view and the super-admin dashboard (view in a new tab or download).
// ─────────────────────────────────────────────────────────────────────────────
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import bmtLogo from "../assets/bmt-logo.png";

export interface InvoiceData {
  // Billed-to party
  clinicName?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  address?: string | null;

  // Line item
  plan?: string | null;
  amount: number;
  currency?: string | null;
  /** Human label for the line item, e.g. "Monthly Subscription", "One-time". */
  transactionType?: string | null;

  // Status + payment metadata
  status?: string | null;
  paymentMethod?: string | null;
  paymentType?: string | null; // AUTH | CHARGE (subscriptions) | one-time

  // Cashfree references
  cfPaymentId?: string | null;
  cfTxnId?: string | null;
  cfOrderId?: string | null;
  subscriptionRef?: string | null;

  // Explicit identifiers (optional — generated when absent)
  invoiceNo?: string | null;
  /** Our internal, unique-per-invoice transaction reference. */
  transactionRef?: string | null;

  // Timestamps
  paidAt?: string | null;
  createdAt?: string | null;
}

// Backwards-compatible alias (older call sites import SubscriptionInvoiceData).
export type SubscriptionInvoiceData = InvoiceData;

function fmtDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtInr(amount: number): string {
  return `Rs ${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Deterministic invoice number derived from the strongest available reference. */
function deriveInvoiceNo(d: InvoiceData): string {
  if (d.invoiceNo) return String(d.invoiceNo);
  const seed = d.cfPaymentId || d.cfTxnId || d.cfOrderId || d.subscriptionRef || d.transactionRef || Date.now().toString();
  return `BMT-${seed.toString().replace(/[^A-Za-z0-9]/g, "").slice(-12).toUpperCase()}`;
}

/** Unique internal transaction reference for our records (stable per payment). */
function deriveTransactionRef(d: InvoiceData): string {
  if (d.transactionRef) return String(d.transactionRef);
  const seed = d.cfPaymentId || d.cfTxnId || d.cfOrderId || d.subscriptionRef || "";
  const base = seed.toString().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `TXN-${base || Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

/** Loads an image URL into a data URL so jsPDF can embed it. Never throws. */
async function loadImageDataUrl(url: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const dims = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
      img.onerror = () => resolve({ width: 1, height: 1 });
      img.src = dataUrl;
    });
    return { dataUrl, width: dims.width, height: dims.height };
  } catch {
    return null;
  }
}

/**
 * Builds the branded invoice PDF document. Shared by both the view (new tab)
 * and download helpers. Async because it embeds the logo image.
 */
async function buildInvoiceDoc(d: InvoiceData): Promise<{ doc: jsPDF; invoiceNo: string }> {
  const doc = new jsPDF();
  const brand: [number, number, number] = [0, 89, 198]; // #0059C6
  const dark: [number, number, number] = [24, 24, 27];
  const gray: [number, number, number] = [113, 113, 122];

  const invoiceNo = deriveInvoiceNo(d);
  const transactionRef = deriveTransactionRef(d);
  const statusLabel = String(d.status || "PENDING").toUpperCase();
  const isReceipt = statusLabel === "SUCCESS";

  // ── Header: logo (left) + document meta (right) ──
  const logo = await loadImageDataUrl(bmtLogo);
  if (logo) {
    const targetH = 14; // mm
    const targetW = Math.min(60, (logo.width / logo.height) * targetH);
    try { doc.addImage(logo.dataUrl, "PNG", 14, 10, targetW, targetH); } catch { /* ignore */ }
  } else {
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(...brand);
    doc.text("BookMyTime", 14, 20);
  }

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...gray);
  doc.text("A product of Brightwave Digital Products LLP", 14, 30);
  doc.text("Pune, Maharashtra, India", 14, 34.5);
  doc.text("bookmytime1355@gmail.com  |  +91 9168 08 1355", 14, 39);

  doc.setFont("Helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...dark);
  doc.text(isReceipt ? "PAYMENT RECEIPT" : "TAX INVOICE", 196, 16, { align: "right" });
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...gray);
  doc.text(`Invoice No: ${invoiceNo}`, 196, 22, { align: "right" });
  doc.text(`Transaction Ref: ${transactionRef}`, 196, 27, { align: "right" });
  doc.text(`Date: ${fmtDate(d.paidAt || d.createdAt)}`, 196, 32, { align: "right" });

  doc.setDrawColor(brand[0], brand[1], brand[2]);
  doc.setLineWidth(1);
  doc.line(14, 44, 196, 44);

  // ── Billed to ──
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...dark);
  doc.text("Billed To", 14, 54);
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...gray);
  let y = 60;
  if (d.clinicName) { doc.setFont("Helvetica", "bold"); doc.setTextColor(...dark); doc.text(String(d.clinicName), 14, y); doc.setFont("Helvetica", "normal"); doc.setTextColor(...gray); y += 5; }
  if (d.customerName) { doc.text(String(d.customerName), 14, y); y += 5; }
  if (d.address) {
    const lines = doc.splitTextToSize(String(d.address), 90);
    doc.text(lines, 14, y);
    y += 5 * lines.length;
  }
  if (d.customerEmail) { doc.text(String(d.customerEmail), 14, y); y += 5; }
  if (d.customerPhone) { doc.text(String(d.customerPhone), 14, y); y += 5; }

  // Status badge (right)
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  const statusColor: [number, number, number] =
    statusLabel === "SUCCESS" ? [5, 150, 105] :
    statusLabel === "FAILED" ? [220, 38, 38] :
    statusLabel === "CANCELLED" ? [113, 113, 122] :
    [217, 119, 6];
  doc.setTextColor(...statusColor);
  doc.text(`Status: ${statusLabel}`, 196, 54, { align: "right" });

  // ── Line items table ──
  const planLabel = `${d.plan ? `BookMyTime ${d.plan} Plan` : "BookMyTime Subscription"}${d.paymentType === "AUTH" ? " (Mandate Registration)" : ""}`.trim();
  const billingLabel = d.transactionType || (d.paymentType === "AUTH" ? "Mandate" : "Monthly");
  const tableTop = Math.max(y, 74) + 6;
  autoTable(doc, {
    startY: tableTop,
    head: [["Description", "Billing", "Amount"]],
    body: [[planLabel, billingLabel, fmtInr(d.amount)]],
    theme: "striped",
    headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 10 },
    bodyStyles: { fontSize: 9.5, textColor: [45, 55, 72] },
    columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 35 }, 2: { cellWidth: 37, halign: "right" } },
    margin: { left: 14, right: 14 },
  });

  let afterTable = ((doc as any).lastAutoTable?.finalY ?? tableTop) + 6;

  // ── Total ──
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...dark);
  doc.text(isReceipt ? "Total Paid" : "Total", 150, afterTable, { align: "right" });
  doc.text(fmtInr(d.amount), 196, afterTable, { align: "right" });
  afterTable += 10;

  // ── Payment / transaction reference block ──
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
    ["Payment Type", d.paymentType || d.transactionType || "-"],
    ["Cashfree Payment ID", d.cfPaymentId || "-"],
    ["Cashfree Transaction ID", d.cfTxnId || "-"],
    ["Cashfree Order ID", d.cfOrderId || "-"],
    ["Subscription Reference", d.subscriptionRef || "-"],
    ["Internal Transaction Ref", transactionRef],
    ["Paid / Attempted On", fmtDate(d.paidAt || d.createdAt)],
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

  // ── Footer ──
  const pageH = doc.internal.pageSize.height;
  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.4);
  doc.line(14, pageH - 20, 196, pageH - 20);
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...gray);
  doc.text("This is a system-generated invoice and does not require a physical signature.", 14, pageH - 14);
  doc.text("For billing queries: bookmytime1355@gmail.com  |  +91 9168 08 1355", 14, pageH - 9);

  return { doc, invoiceNo };
}

/** Generates and downloads a PDF invoice/receipt for any Cashfree payment. */
export async function downloadInvoice(d: InvoiceData): Promise<void> {
  const { doc, invoiceNo } = await buildInvoiceDoc(d);
  doc.save(`Invoice_${invoiceNo}.pdf`);
}

/** Opens the PDF invoice/receipt in a new browser tab for viewing. */
export async function viewInvoice(d: InvoiceData): Promise<void> {
  const { doc } = await buildInvoiceDoc(d);
  const url = doc.output("bloburl");
  window.open(url as any, "_blank", "noopener,noreferrer");
}

// Backwards-compatible wrapper for existing call sites.
export async function downloadSubscriptionInvoice(d: InvoiceData): Promise<void> {
  return downloadInvoice(d);
}
