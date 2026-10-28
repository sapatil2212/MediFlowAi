import "./lib/error-capture";
import { startWhatsAppServer } from "./lib/wa-launcher";
import { startReminderScheduler } from "./lib/reminder-scheduler";
import { startMonthlyReportScheduler } from "./lib/monthly-report-scheduler";
import { startNotificationWorker } from "./lib/notify-dispatcher";

// Start WhatsApp server
startWhatsAppServer();

// Durable WhatsApp notification worker: dispatches booking confirmations,
// reminders and lifecycle updates as approved Utility templates.
startNotificationWorker();

// 5-minute maintenance cycle (reminder jobs, template sync, alerts, sweeps)
startReminderScheduler();

// Start the automated monthly clinical audit report scheduler (1st of each month with rate-limited email)
startMonthlyReportScheduler();

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Stable public endpoint for Cashfree subscription webhooks. Handled here in
// the request entry because this TanStack Start version has no file-based
// server routes. Configure this URL in the Cashfree dashboard:
//   https://<your-domain>/api/cashfree/webhook
const CASHFREE_WEBHOOK_PATH = "/api/cashfree/webhook";

// Stable public endpoint for Meta WhatsApp Cloud API webhooks. Configure this
// URL in the Meta app dashboard: https://<your-domain>/api/whatsapp/webhook
const WA_WEBHOOK_PATH = "/api/whatsapp/webhook";

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === CASHFREE_WEBHOOK_PATH) {
        const { handleCashfreeWebhookRequest } = await import("./lib/subscription-webhook");
        return await handleCashfreeWebhookRequest(request);
      }

      // Meta WhatsApp Cloud API webhook. Handles BOTH GET (verify handshake)
      // and POST (status + inbound callbacks) — do not gate on method here.
      if (url.pathname === WA_WEBHOOK_PATH) {
        const { handleWaWebhook } = await import("./lib/whatsapp-webhook");
        return await handleWaWebhook(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
