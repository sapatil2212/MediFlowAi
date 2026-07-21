import "./lib/error-capture";
import { startWhatsAppServer } from "./lib/wa-launcher";
import { startReminderScheduler } from "./lib/reminder-scheduler";

// Start WhatsApp server
startWhatsAppServer();

// Start the appointment reminder scheduler (WhatsApp reminders: 1 day / day-of / 2h / 1h before)
startReminderScheduler();

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

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === CASHFREE_WEBHOOK_PATH) {
        const { handleCashfreeWebhookRequest } = await import("./lib/subscription-webhook");
        return await handleCashfreeWebhookRequest(request);
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
