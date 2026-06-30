import { queryOne } from "./db";

export async function verifySession() {
  const { getCookie } = await import("@tanstack/react-start/server");

  // ── 1. Check main clinic owner session ──
  const token = getCookie("session_token");
  if (token) {
    const session = await queryOne<any>(
      `SELECT s.id as sessionId, s.userId, s.token, s.expiresAt,
              u.id as uid, u.name, u.email, u.phone, u.clinicName, u.practiceSize, u.tenantId,
              u.subscriptionStatus, u.subscriptionPlan, u.subscriptionExpiresAt, u.paymentAmount, u.billingInterval, u.paymentMethod, u.createdAt as uCreatedAt, u.profilePhoto, u.profession
       FROM Session s
       JOIN User u ON s.userId = u.id
       WHERE s.token = ? AND s.expiresAt > ?
       LIMIT 1`,
      [token, new Date()]
    );
    if (session) {
      return {
        id: session.uid,
        name: session.name,
        email: session.email,
        phone: session.phone,
        clinicName: session.clinicName,
        practiceSize: session.practiceSize,
        tenantId: session.tenantId,
        subscriptionStatus: session.subscriptionStatus,
        subscriptionPlan: session.subscriptionPlan,
        subscriptionExpiresAt: session.subscriptionExpiresAt instanceof Date ? session.subscriptionExpiresAt.toISOString() : session.subscriptionExpiresAt,
        paymentAmount: session.paymentAmount,
        billingInterval: session.billingInterval,
        paymentMethod: session.paymentMethod,
        createdAt: session.uCreatedAt instanceof Date ? session.uCreatedAt.toISOString() : session.uCreatedAt,
        profilePhoto: session.profilePhoto || null,
        role: "admin" as const,
        profession: session.profession || "Healthcare and medical",
      };
    }
  }

  // ── 2. Check sub-user session (reception / doctor) ──
  const subToken = getCookie("sub_session_token");
  if (subToken) {
    const subSession = await queryOne<any>(
      `SELECT ss.id as sessionId, ss.subUserId, ss.token, ss.expiresAt,
              su.id as uid, su.name, su.email, su.phone, su.role, su.tenantId, su.isActive, su.doctorId,
              u.clinicName, u.practiceSize, u.profession,
              u.subscriptionStatus, u.subscriptionPlan, u.subscriptionExpiresAt,
              u.paymentAmount, u.billingInterval, u.paymentMethod, u.createdAt as uCreatedAt
       FROM SubUserSession ss
       JOIN SubUser su ON ss.subUserId = su.id
       JOIN User u ON su.tenantId COLLATE utf8mb4_unicode_ci = u.tenantId COLLATE utf8mb4_unicode_ci
       WHERE ss.token = ? AND ss.expiresAt > ?
       LIMIT 1`,
      [subToken, new Date()]
    );
    if (subSession && subSession.isActive) {
      return {
        id: subSession.uid,
        name: subSession.name,
        email: subSession.email,
        phone: subSession.phone,
        clinicName: subSession.clinicName,
        practiceSize: subSession.practiceSize,
        tenantId: subSession.tenantId,
        subscriptionStatus: subSession.subscriptionStatus,
        subscriptionPlan: subSession.subscriptionPlan,
        subscriptionExpiresAt: subSession.subscriptionExpiresAt instanceof Date ? subSession.subscriptionExpiresAt.toISOString() : subSession.subscriptionExpiresAt,
        paymentAmount: subSession.paymentAmount,
        billingInterval: subSession.billingInterval,
        paymentMethod: subSession.paymentMethod,
        createdAt: subSession.uCreatedAt instanceof Date ? subSession.uCreatedAt.toISOString() : subSession.uCreatedAt,
        role: subSession.role as "reception" | "doctor",
        doctorId: subSession.doctorId,
        profession: subSession.profession || "Healthcare and medical",
      };
    }
  }

  // ── 3. Check location session (multi-location sub-accounts) ──
  const locToken = getCookie("location_session_token");
  if (locToken) {
    const locSession = await queryOne<any>(
      `SELECT ls.id as sessionId, ls.locationId, ls.token, ls.expiresAt,
              l.id as lid, l.name as locName, l.email as locEmail, l.phone as locPhone, l.tenantId, l.isActive,
              l.address, l.city, l.state, l.pincode, l.managerName,
              u.clinicName, u.practiceSize, u.profession,
              u.subscriptionStatus, u.subscriptionPlan, u.subscriptionExpiresAt,
              u.paymentAmount, u.billingInterval, u.paymentMethod, u.createdAt as uCreatedAt
       FROM LocationSession ls
       JOIN Location l ON ls.locationId = l.id
       JOIN User u ON l.tenantId COLLATE utf8mb4_unicode_ci = u.tenantId COLLATE utf8mb4_unicode_ci
       WHERE ls.token = ? AND ls.expiresAt > ?
       LIMIT 1`,
      [locToken, new Date()]
    );
    if (locSession && locSession.isActive) {
      return {
        id: locSession.lid,
        name: locSession.locName,
        email: locSession.locEmail,
        phone: locSession.locPhone,
        clinicName: locSession.clinicName,
        practiceSize: locSession.practiceSize,
        tenantId: locSession.tenantId,
        subscriptionStatus: locSession.subscriptionStatus,
        subscriptionPlan: locSession.subscriptionPlan,
        subscriptionExpiresAt: locSession.subscriptionExpiresAt instanceof Date ? locSession.subscriptionExpiresAt.toISOString() : locSession.subscriptionExpiresAt,
        paymentAmount: locSession.paymentAmount,
        billingInterval: locSession.billingInterval,
        paymentMethod: locSession.paymentMethod,
        createdAt: locSession.uCreatedAt instanceof Date ? locSession.uCreatedAt.toISOString() : locSession.uCreatedAt,
        role: "location" as const,
        locationId: locSession.lid,
        locationName: locSession.locName,
        profession: locSession.profession || "Healthcare and medical",
      };
    }
  }

  return null;
}
