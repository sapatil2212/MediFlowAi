// ─────────────────────────────────────────────────────────────────────────────
// tenant-notifications.ts
//
// Client-callable server functions for the tenant WhatsApp "Notifications"
// panel. The tenant is ALWAYS resolved from the verified session; the client
// never supplies a tenantId. Server-only modules are imported lazily inside the
// handlers so nothing server-side reaches the client bundle.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";

async function sessionUser() {
  const { verifySession } = await import("./auth.server");
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  return user;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export const getTenantNotificationCenterServerFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<Json> => {
    const user = await sessionUser();
    const { tenantNotificationCenter } = await import("./notify-tenant");
    return tenantNotificationCenter(user);
  },
);

export const saveTenantNotificationSettingsServerFn = createServerFn({ method: "POST" })
  .validator((data: Record<string, unknown>) => {
    if (!data || typeof data !== "object") throw new Error("Invalid settings");
    return data;
  })
  .handler(async ({ data }): Promise<Json> => {
    const user = await sessionUser();
    const { saveTenantNotificationSettings } = await import("./notify-tenant");
    return saveTenantNotificationSettings(user, data);
  });

export const setTenantCustomerConsentServerFn = createServerFn({ method: "POST" })
  .validator((data: { phone: string; optedIn: boolean }) => {
    if (!data || typeof data.phone !== "string" || typeof data.optedIn !== "boolean") {
      throw new Error("A phone number and choice are required");
    }
    return { phone: data.phone.slice(0, 32), optedIn: data.optedIn };
  })
  .handler(async ({ data }): Promise<Json> => {
    const user = await sessionUser();
    const { setTenantCustomerConsent } = await import("./notify-tenant");
    return setTenantCustomerConsent(user, data);
  });
