// ─────────────────────────────────────────────────────────────────────────────
// Server-only Cashfree one-time-order reconciliation.
//
// This lives in its OWN module (never imported by a client route) because it is
// a plain async function — not a createServerFn — that touches the DB (db.ts →
// dotenv, mariadb). If it lived in auth.ts, any client route that statically
// imports auth.ts would drag db.ts + dotenv into the browser bundle (Vite dev
// does not tree-shake unused exports), crashing hydration with
// "Cannot read properties of undefined (reading 'reduce')" from dotenv's
// Node-only argument parser. Keeping it isolated here guarantees it stays
// server-side in both dev and production.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { query, queryOne, execute } from "./db";

/**
 * Writes/updates a row in PaymentHistory keyed by orderId. Never throws — a
 * logging failure must not break reconciliation.
 */
async function upsertPaymentHistory(fields: {
  userId?: string | null;
  tenantId?: string | null;
  orderId: string;
  cfPaymentId?: string | null;
  plan?: string | null;
  amount: number;
  currency?: string;
  status: string;
  orderStatus?: string | null;
  paymentMode?: string | null;
  failureReason?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO PaymentHistory
         (id, userId, tenantId, orderId, cfPaymentId, plan, amount, currency, status, orderStatus, paymentMode, failureReason, customerName, customerEmail, customerPhone, gateway, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Cashfree', NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         userId = COALESCE(?, userId),
         tenantId = COALESCE(?, tenantId),
         cfPaymentId = COALESCE(?, cfPaymentId),
         plan = COALESCE(?, plan),
         amount = ?,
         status = ?,
         orderStatus = COALESCE(?, orderStatus),
         paymentMode = COALESCE(?, paymentMode),
         failureReason = ?,
         customerName = COALESCE(?, customerName),
         customerEmail = COALESCE(?, customerEmail),
         customerPhone = COALESCE(?, customerPhone),
         updatedAt = NOW()`,
      [
        crypto.randomUUID(), fields.userId ?? null, fields.tenantId ?? null, fields.orderId, fields.cfPaymentId ?? null,
        fields.plan ?? null, fields.amount, fields.currency || "INR", fields.status, fields.orderStatus ?? null,
        fields.paymentMode ?? null, fields.failureReason ?? null, fields.customerName ?? null, fields.customerEmail ?? null, fields.customerPhone ?? null,
        fields.userId ?? null, fields.tenantId ?? null, fields.cfPaymentId ?? null, fields.plan ?? null,
        fields.amount, fields.status, fields.orderStatus ?? null, fields.paymentMode ?? null, fields.failureReason ?? null,
        fields.customerName ?? null, fields.customerEmail ?? null, fields.customerPhone ?? null,
      ]
    );
  } catch (err: any) {
    console.warn("[PaymentHistory] Failed to upsert record for order", fields.orderId, ":", err.message);
  }
}

/** Maps a Cashfree `payment_group` to a human-readable payment-mode label. */
function formatCashfreePaymentMode(paymentGroup: string, paymentMethod: any): string {
  const group = (paymentGroup || "").toLowerCase();
  switch (group) {
    case "upi":
    case "upi_ppi":
    case "upi_ppi_offline":
    case "upi_credit_card":
      return "UPI";
    case "credit_card":
    case "credit_card_emi": {
      const network = paymentMethod?.card?.card_network || paymentMethod?.card?.card_type;
      return network ? `${network} Credit Card` : "Credit Card";
    }
    case "debit_card":
    case "debit_card_emi": {
      const network = paymentMethod?.card?.card_network || paymentMethod?.card?.card_type;
      return network ? `${network} Debit Card` : "Debit Card";
    }
    case "prepaid_card":
      return "Prepaid Card";
    case "net_banking":
      return "Net Banking";
    case "wallet":
      return "Wallet";
    case "pay_later":
      return "Pay Later";
    case "cardless_emi":
      return "Cardless EMI";
    case "bank_transfer":
      return "Bank Transfer";
    case "cash":
      return "Cash";
    case "paypal":
      return "PayPal";
    default:
      return "Cashfree";
  }
}

/**
 * Fetches all payment attempts for a Cashfree order and returns the most recent
 * one regardless of outcome. Never throws — returns null on any lookup issue.
 */
async function getLatestCashfreePaymentAttempt(
  host: string,
  appId: string | undefined,
  secretKey: string | undefined,
  orderId: string
): Promise<any | null> {
  try {
    const response = await fetch(`https://${host}/pg/orders/${orderId}/payments`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": appId || "",
        "x-client-secret": secretKey || "",
        "x-api-version": "2023-08-01",
      },
    });
    if (!response.ok) return null;
    const payments = await response.json();
    if (!Array.isArray(payments) || payments.length === 0) return null;
    return payments
      .slice()
      .sort((a: any, b: any) => new Date(b.payment_completion_time || b.payment_time).getTime() - new Date(a.payment_completion_time || a.payment_time).getTime())[0];
  } catch (err: any) {
    console.warn("[CASHFREE] Could not fetch payment attempts:", err.message);
    return null;
  }
}

/**
 * Reconciles a single one-time Cashfree order into the PaymentHistory ledger
 * WITHOUT mutating the user's subscription/access. Used by the Super Admin
 * "Sync with Cashfree" action. Returns the reconciled ledger status
 * ("SUCCESS" | "FAILED" | "CANCELLED" | "PENDING") or null. Never throws.
 */
export async function reconcileOrderPaymentHistory(orderId: string): Promise<string | null> {
  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const environment = process.env.CASHFREE_ENV || "production";
  const host = environment === "production" ? "api.cashfree.com" : "sandbox.cashfree.com";

  try {
    const response = await fetch(`https://${host}/pg/orders/${orderId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": appId || "",
        "x-client-secret": secretKey || "",
        "x-api-version": "2023-08-01",
      },
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[CASHFREE][reconcile] Order ${orderId} lookup failed: ${response.status} ${errText}`);
      return null;
    }

    const orderData = await response.json();
    const orderStatus = String(orderData.order_status || "").toUpperCase();
    const orderAmount = Number(orderData.order_amount) || 0;

    const parts = orderId.split("_");
    const tenantId = parts[1] === "renew" ? parts[2] : null;
    const customerId = orderData?.customer_details?.customer_id || null;
    let user: any = null;
    if (tenantId) {
      user = await queryOne<any>("SELECT id, tenantId FROM User WHERE tenantId = ? LIMIT 1", [tenantId]);
    }
    if (!user && customerId) {
      user = await queryOne<any>("SELECT id, tenantId FROM User WHERE id = ? LIMIT 1", [customerId]);
    }

    const latestAttempt = await getLatestCashfreePaymentAttempt(host, appId, secretKey, orderId);
    const paymentMode = latestAttempt
      ? formatCashfreePaymentMode(latestAttempt.payment_group, latestAttempt.payment_method)
      : null;

    const attemptStatus = String(latestAttempt?.payment_status || "").toUpperCase();
    let ledgerStatus: string;
    if (orderStatus === "PAID" || attemptStatus === "SUCCESS") {
      ledgerStatus = "SUCCESS";
    } else if (attemptStatus === "USER_DROPPED" || attemptStatus === "CANCELLED" || attemptStatus === "VOID") {
      ledgerStatus = "CANCELLED";
    } else if (attemptStatus === "FAILED") {
      ledgerStatus = "FAILED";
    } else if (attemptStatus === "PENDING" || attemptStatus === "NOT_ATTEMPTED" || orderStatus === "ACTIVE") {
      ledgerStatus = "PENDING";
    } else if (orderStatus === "EXPIRED" || orderStatus === "TERMINATED") {
      ledgerStatus = "CANCELLED";
    } else {
      ledgerStatus = "FAILED";
    }

    const plan = orderAmount >= 1400 ? "Premium" : orderAmount > 0 ? "Basic" : null;
    const failureReason = ledgerStatus === "SUCCESS" || ledgerStatus === "PENDING"
      ? null
      : (latestAttempt?.payment_message
          || latestAttempt?.error_details?.error_description
          || `Order status: ${orderStatus}`);

    await upsertPaymentHistory({
      userId: user?.id ?? null,
      tenantId: tenantId ?? user?.tenantId ?? null,
      orderId,
      cfPaymentId: latestAttempt?.cf_payment_id ? String(latestAttempt.cf_payment_id) : null,
      plan,
      amount: orderAmount,
      status: ledgerStatus,
      orderStatus,
      paymentMode,
      failureReason,
      customerName: orderData?.customer_details?.customer_name ?? null,
      customerEmail: orderData?.customer_details?.customer_email ?? null,
      customerPhone: orderData?.customer_details?.customer_phone ?? null,
    });

    return ledgerStatus;
  } catch (err: any) {
    console.warn(`[CASHFREE][reconcile] Exception reconciling order ${orderId}:`, err.message);
    return null;
  }
}
