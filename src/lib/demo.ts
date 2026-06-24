import { createServerFn } from "@tanstack/react-start";
import crypto from "crypto";
import { verifyAdminSession } from "./admin.server";
import { execute, query } from "./db";
import { sendDemoAdminNotificationEmail, sendDemoConfirmationEmail } from "./email";

export type DemoAppointmentStatus =
  | "New"
  | "Contacted"
  | "Scheduled"
  | "Completed"
  | "Cancelled";

type DemoAppointmentPayload = {
  name: string;
  email: string;
  phone: string;
  organization: string;
  city: string;
  businessType: string;
  teamSize: string;
  preferredDate: string;
  preferredTime: string;
  preferredMode: string;
  message?: string;
};

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[^\d+ ]/g, "").trim();
  return cleaned || phone.trim();
}

export const createDemoAppointmentServerFn = createServerFn({ method: "POST" })
  .validator((data: DemoAppointmentPayload) => {
    if (
      !data.name ||
      !data.email ||
      !data.phone ||
      !data.organization ||
      !data.city ||
      !data.businessType ||
      !data.teamSize ||
      !data.preferredDate ||
      !data.preferredTime ||
      !data.preferredMode
    ) {
      throw new Error("Please fill in all required fields.");
    }

    if (!/\S+@\S+\.\S+/.test(data.email)) {
      throw new Error("Please enter a valid work email.");
    }

    if (!/^\+?[\d\s()-]{10,18}$/.test(data.phone.trim())) {
      throw new Error("Please enter a valid mobile number.");
    }

    return data;
  })
  .handler(async ({ data }) => {
    const id = crypto.randomUUID();
    const referenceId = `DEMO-${id.slice(0, 8).toUpperCase()}`;

    await execute(
      `INSERT INTO DemoAppointment (
        id, referenceId, name, email, phone, organization, city, businessType, teamSize,
        preferredDate, preferredTime, preferredMode, message, status, source, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New', 'contact-page', NOW(), NOW())`,
      [
        id,
        referenceId,
        data.name.trim(),
        data.email.trim().toLowerCase(),
        normalizePhone(data.phone),
        data.organization.trim(),
        data.city.trim(),
        data.businessType.trim(),
        data.teamSize.trim(),
        data.preferredDate,
        data.preferredTime.trim(),
        data.preferredMode.trim(),
        data.message?.trim() || null,
      ]
    );

    const mailData = {
      ...data,
      email: data.email.trim().toLowerCase(),
      phone: normalizePhone(data.phone),
      referenceId,
    };

    try {
      await Promise.all([
        sendDemoConfirmationEmail(mailData),
        sendDemoAdminNotificationEmail(mailData),
      ]);
    } catch (error: any) {
      console.error("[Demo] Failed to send one or more confirmation emails:", error.message);
    }

    return { success: true, id, referenceId };
  });

export const getDemoAppointmentsServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    return query<any>(
      `SELECT 
        id,
        referenceId,
        name,
        email,
        phone,
        organization,
        city,
        businessType,
        teamSize,
        preferredDate,
        preferredTime,
        preferredMode,
        message,
        status,
        adminNotes,
        source,
        lastContactedAt,
        createdAt,
        updatedAt
       FROM DemoAppointment
       ORDER BY createdAt DESC`
    );
  });

export const updateDemoAppointmentServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string; status: DemoAppointmentStatus; adminNotes?: string }) => {
    if (!data.id || !data.status) {
      throw new Error("Demo appointment id and status are required.");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const shouldSetLastContacted =
      data.status === "Contacted" ||
      data.status === "Scheduled" ||
      data.status === "Completed";

    await execute(
      `UPDATE DemoAppointment
       SET status = ?,
           adminNotes = ?,
           lastContactedAt = ${shouldSetLastContacted ? "NOW()" : "lastContactedAt"},
           updatedAt = NOW()
       WHERE id = ?`,
      [data.status, data.adminNotes?.trim() || null, data.id]
    );

    return { success: true };
  });
