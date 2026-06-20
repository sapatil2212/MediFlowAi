import { queryOne } from "./db";

export async function verifyAdminSession() {
  const { getCookie } = await import("@tanstack/react-start/server");
  const token = getCookie("admin_session_token");
  if (!token) return null;

  const session = await queryOne<any>(
    `SELECT s.id as sessionId, s.token, s.expiresAt, a.id as adminId, a.name, a.email
     FROM SuperAdminSession s
     JOIN SuperAdmin a ON s.adminId = a.id
     WHERE s.token = ? AND s.expiresAt > NOW()
     LIMIT 1`,
    [token]
  );

  if (!session) return null;

  return {
    id: session.adminId,
    name: session.name,
    email: session.email,
  };
}
