import { createServerFn } from "@tanstack/react-start";
import { verifySession } from "./auth.server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { query, queryOne, execute } from "./db";
import { sendOtpEmail } from "./email";

// WhatsApp HTTP client — pure ESM, safe to import (no Puppeteer/CJS globals)
import { enqueueWA, getWAStatus, disconnectWA, initializeWA, enqueueWABulk, sendWAMedia, pauseWACampaign } from "./whatsapp";


// Helper to generate a 4-digit OTP
function generateOtp(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Helper to generate a UUID
function generateId(): string {
  return crypto.randomUUID();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 1. Check Email Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const checkEmailServerFn = createServerFn({ method: "POST" })
  .validator((email: string) => {
    if (!email || !email.includes("@")) throw new Error("Invalid email");
    return email;
  })
  .handler(async ({ data: email }) => {
    const existingUser = await queryOne<any>(
      "SELECT id FROM User WHERE email = ? LIMIT 1",
      [email]
    );
    return { exists: !!existingUser };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 2. Send OTP Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const sendOtpServerFn = createServerFn({ method: "POST" })
  .validator((email: string) => {
    if (!email || !email.includes("@")) throw new Error("Invalid email");
    return email;
  })
  .handler(async ({ data: email }) => {
    // Check if email already registered
    const existingUser = await queryOne<any>(
      "SELECT id FROM User WHERE email = ? LIMIT 1",
      [email]
    );

    if (existingUser) {
      throw new Error("Email already registered");
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

    // Clean up previous OTPs for this email
    await execute("DELETE FROM OtpCode WHERE email = ?", [email]);

    // Globally clean up expired OTPs from the database
    await execute("DELETE FROM OtpCode WHERE expiresAt < NOW()");

    // Create new OTP
    await execute(
      "INSERT INTO OtpCode (id, email, code, expiresAt, createdAt) VALUES (?, ?, ?, ?, NOW())",
      [generateId(), email, code, expiresAt]
    );

    // Send OTP via email in the background (non-blocking) to optimize performance
    sendOtpEmail(email, code)
      .then(() => {
        console.log(`[OTP] âœ… Verification code sent to ${email}`);
      })
      .catch((err: any) => {
        console.error(`[OTP] âŒ Failed to send email to ${email}:`, err.message);
      });

    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 2. Verify OTP Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const verifyOtpServerFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; code: string }) => {
    if (!data.email || !data.code) throw new Error("Invalid inputs");
    return data;
  })
  .handler(async ({ data }) => {
    // Allow test bypass for development domains
    if (data.code === "1234" && (data.email.endsWith("@example.com") || data.email.endsWith("@mediflowai.com"))) {
      return { success: true };
    }

    const validCode = await queryOne<any>(
      "SELECT * FROM OtpCode WHERE email = ? AND code = ? AND expiresAt > NOW() ORDER BY createdAt DESC LIMIT 1",
      [data.email, data.code]
    );

    if (!validCode) {
      throw new Error("Invalid or expired verification code");
    }

    // Clean up all OTPs for this email after successful verification
    await execute("DELETE FROM OtpCode WHERE email = ?", [data.email]);

    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 3. Signup Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const signupServerFn = createServerFn({ method: "POST" })
  .validator((data: {
    name: string;
    phone: string;
    email: string;
    clinicName: string;
    practiceSize: string;
    password?: string;
    plan?: string;
  }) => {
    if (!data.name || !data.phone || !data.email || !data.clinicName || !data.practiceSize) {
      throw new Error("Required fields missing");
    }
    return data;
  })
  .handler(async ({ data }) => {
    // Check if user already exists
    const existingUser = await queryOne<any>(
      "SELECT id FROM User WHERE email = ? OR phone = ? LIMIT 1",
      [data.email, data.phone]
    );

    if (existingUser) {
      throw new Error("A user with this email or phone number already exists");
    }

    const rawPassword = data.password || "MediFlow123";
    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    const userId = generateId();
    const tenantId = "clinic-" + Math.floor(100000 + Math.random() * 900000).toString();
    const selectedPlan = data.plan || "Solo";

    await execute(
      `INSERT INTO User (id, tenantId, name, email, phone, clinicName, practiceSize, password, subscriptionPlan, subscriptionExpiresAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 14 DAY), NOW(), NOW())`,
      [userId, tenantId, data.name, data.email, data.phone, data.clinicName, data.practiceSize, hashedPassword, selectedPlan]
    );

    // Log initial trialing subscription log
    await execute(
      `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
       VALUES (?, ?, 'None', 'Trialing', 'None', ?, 0.00, 'monthly', NOW(), 'System')`,
      [generateId(), userId, selectedPlan]
    );

    return { success: true, userId };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 4. Login Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const loginServerFn = createServerFn({ method: "POST" })
  .validator((data: { username: string; password?: string; rememberMe?: boolean }) => {
    if (!data.username) throw new Error("Username/Email is required");
    return data;
  })
  .handler(async ({ data }) => {
    const rawPassword = data.password || "MediFlow123";
    const { setCookie } = await import("@tanstack/react-start/server");

    // ── 1. Try main clinic owner (User table) ──
    const user = await queryOne<any>(
      "SELECT * FROM User WHERE email = ? OR phone = ? LIMIT 1",
      [data.username, data.username]
    );

    if (user) {
      const passwordMatch = await bcrypt.compare(rawPassword, user.password);
      if (!passwordMatch) throw new Error("Incorrect password");

      if (user.subscriptionStatus === "Cancelled") {
        throw new Error("Your clinic account is deactivated. Please contact MediFlow AI support at infomedinex@gmail.com.");
      }
      if (user.subscriptionExpiresAt) {
        const expiry = new Date(user.subscriptionExpiresAt);
        if (expiry < new Date()) {
          throw new Error("Your subscription or trial period has ended. Please contact support at infomedinex@gmail.com to renew.");
        }
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(
        Date.now() + (data.rememberMe ? 30 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000)
      );
      await execute(
        "INSERT INTO Session (id, userId, token, expiresAt, createdAt) VALUES (?, ?, ?, ?, NOW())",
        [generateId(), user.id, token, expiresAt]
      );
      setCookie("session_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: data.rememberMe ? 30 * 24 * 60 * 60 : undefined,
      });
      return {
        success: true,
        role: "admin",
        redirectTo: "/dashboard",
        user: { id: user.id, name: user.name, email: user.email, clinicName: user.clinicName },
      };
    }

    // ── 2. Try sub-user (SubUser table — reception / doctor) ──
    const subUser = await queryOne<any>(
      "SELECT su.*, u.subscriptionStatus, u.subscriptionExpiresAt FROM SubUser su JOIN User u ON su.tenantId COLLATE utf8mb4_unicode_ci = u.tenantId COLLATE utf8mb4_unicode_ci WHERE su.email COLLATE utf8mb4_unicode_ci = ? OR su.phone COLLATE utf8mb4_unicode_ci = ? LIMIT 1",
      [data.username, data.username]
    );

    if (subUser) {
      if (!subUser.isActive) {
        throw new Error("Your staff account has been deactivated. Please contact your clinic administrator.");
      }
      const passwordMatch = await bcrypt.compare(rawPassword, subUser.password);
      if (!passwordMatch) throw new Error("Incorrect password");

      // Check parent clinic subscription
      if (subUser.subscriptionStatus === "Cancelled") {
        throw new Error("Your clinic account is deactivated. Please contact your clinic admin.");
      }
      if (subUser.subscriptionExpiresAt) {
        const expiry = new Date(subUser.subscriptionExpiresAt);
        if (expiry < new Date()) {
          throw new Error("Your clinic subscription has expired. Please contact your clinic admin.");
        }
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
      await execute(
        "INSERT INTO SubUserSession (id, subUserId, token, expiresAt) VALUES (?, ?, ?, ?)",
        [crypto.randomUUID(), subUser.id, token, expiresAt]
      );
      setCookie("sub_session_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 8 * 60 * 60,
      });
      return {
        success: true,
        role: subUser.role,          // "reception" | "doctor"
        redirectTo: "/dashboard",    // both redirect to clinic dashboard for now
        user: { id: subUser.id, name: subUser.name, email: subUser.email, clinicName: "" },
      };
    }

    // ── 3. Nothing found ──
    throw new Error("No account found with this email or phone number");
  });


// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 5. Logout Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const logoutServerFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const { getCookie, deleteCookie } = await import("@tanstack/react-start/server");
    const token = getCookie("session_token");
    const subToken = getCookie("sub_session_token");

    if (token) {
      await execute("DELETE FROM Session WHERE token = ?", [token]);
      deleteCookie("session_token", {
        path: "/",
      });
    }

    if (subToken) {
      await execute("DELETE FROM SubUserSession WHERE token = ?", [subToken]);
      deleteCookie("sub_session_token", {
        path: "/",
      });
    }

    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 6. Reset Password Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const resetPasswordServerFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; password?: string }) => {
    if (!data.email) throw new Error("Email is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await queryOne<any>(
      "SELECT id FROM User WHERE email = ? LIMIT 1",
      [data.email]
    );

    if (!user) {
      throw new Error("No user registered with this email address");
    }

    const rawPassword = data.password || "MediFlow123";
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    await execute(
      "UPDATE User SET password = ?, updatedAt = NOW() WHERE email = ?",
      [hashedPassword, data.email]
    );

    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 7. Get Current User Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const getCurrentUserServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const { getCookie, deleteCookie } = await import("@tanstack/react-start/server");
    const token = getCookie("session_token");
    const subToken = getCookie("sub_session_token");

    if (!token && !subToken) return null;

    const user = await verifySession();
    if (!user) {
      if (token) {
        deleteCookie("session_token", {
          path: "/",
        });
      }
      if (subToken) {
        deleteCookie("sub_session_token", {
          path: "/",
        });
      }
      return null;
    }

    return user;
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 8. Settings & Profile CRUD Server Functions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getClinicProfileServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    const profile = await queryOne<any>(
      "SELECT * FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
      [user.tenantId]
    );

    return profile || null;
  });

export const updateProfileServerFn = createServerFn({ method: "POST" })
  .validator((data: { name: string; phone: string; clinicName: string; practiceSize: string }) => {
    if (!data.name || !data.phone || !data.clinicName || !data.practiceSize) {
      throw new Error("Required fields missing");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    // Save/update ClinicProfile
    await execute(
      `INSERT INTO ClinicProfile (id, tenantId, clinicName, clinicianName, phone, practiceSize)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE clinicName = ?, clinicianName = ?, phone = ?, practiceSize = ?`,
      [
        generateId(),
        user.tenantId,
        data.clinicName,
        data.name,
        data.phone,
        data.practiceSize,
        data.clinicName,
        data.name,
        data.phone,
        data.practiceSize
      ]
    );

    // Sync to User table for session/compatibility
    await execute(
      `UPDATE User SET name = ?, phone = ?, clinicName = ?, practiceSize = ?, updatedAt = NOW() WHERE id = ?`,
      [data.name, data.phone, data.clinicName, data.practiceSize, user.id]
    );

    return { success: true };
  });


export const uploadProfilePhotoServerFn = createServerFn({ method: "POST" })
  .validator((data: { base64: string; fileName: string }) => {
    if (!data.base64) throw new Error("No image data provided");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const cloudinary = await import("cloudinary");
    const cloud = cloudinary.v2;
    cloud.config({
      cloud_name: process.env["CLOUDINARY_CLOUD_NAME"],
      api_key: process.env["CLOUDINARY_API_KEY"],
      api_secret: process.env["CLOUDINARY_API_SECRET"],
    });

    const result = await cloud.uploader.upload(data.base64, {
      folder: "mediflow/profiles",
      public_id: `profile_${user.id}`,
      overwrite: true,
      transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
    });

    const photoUrl = result.secure_url;
    await execute("UPDATE User SET profilePhoto = ?, updatedAt = NOW() WHERE id = ?", [photoUrl, user.id]);

    return { success: true, url: photoUrl };
  });

export const updatePasswordServerFn = createServerFn({ method: "POST" })
  .validator((data: { currentPass: string; newPass: string }) => {
    if (!data.currentPass || !data.newPass) {
      throw new Error("Passwords cannot be empty");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    if (user.role === "reception" || user.role === "doctor") {
      const dbSubUser = await queryOne<any>("SELECT password FROM SubUser WHERE id = ? LIMIT 1", [user.id]);
      if (!dbSubUser) throw new Error("User not found");

      const match = await bcrypt.compare(data.currentPass, dbSubUser.password);
      if (!match) throw new Error("Incorrect current password");

      const hashedNew = await bcrypt.hash(data.newPass, 10);
      await execute("UPDATE SubUser SET password = ?, updatedAt = NOW() WHERE id = ?", [hashedNew, user.id]);
      return { success: true };
    }

    const dbUser = await queryOne<any>("SELECT password FROM User WHERE id = ? LIMIT 1", [user.id]);
    if (!dbUser) throw new Error("User not found");

    const match = await bcrypt.compare(data.currentPass, dbUser.password);
    if (!match) throw new Error("Incorrect current password");

    const hashedNew = await bcrypt.hash(data.newPass, 10);
    await execute("UPDATE User SET password = ?, updatedAt = NOW() WHERE id = ?", [hashedNew, user.id]);

    return { success: true };
  });

export const sendEmailChangeOtpServerFn = createServerFn({ method: "POST" })
  .validator((email: string) => {
    if (!email || !email.includes("@")) throw new Error("Invalid email address");
    return email;
  })
  .handler(async ({ data: newEmail }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    // Check if new email is already registered by another user
    const existing = await queryOne<any>("SELECT id FROM User WHERE email = ? LIMIT 1", [newEmail]);
    if (existing) throw new Error("Email already registered by another user");

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

    await execute("DELETE FROM OtpCode WHERE email = ?", [newEmail]);
    await execute(
      "INSERT INTO OtpCode (id, email, code, expiresAt, createdAt) VALUES (?, ?, ?, ?, NOW())",
      [crypto.randomUUID(), newEmail, code, expiresAt]
    );

    // Send OTP in background
    sendOtpEmail(newEmail, code).catch((err) => {
      console.error("[Email Change OTP] Background send failed:", err.message);
    });

    return { success: true };
  });

export const updateEmailServerFn = createServerFn({ method: "POST" })
  .validator((data: { newEmail: string; code: string }) => {
    if (!data.newEmail || !data.code) throw new Error("Required verification details missing");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    // Verify OTP
    const valid = await queryOne<any>(
      "SELECT id FROM OtpCode WHERE email = ? AND code = ? AND expiresAt > NOW() LIMIT 1",
      [data.newEmail, data.code]
    );
    if (!valid) throw new Error("Invalid or expired verification code");

    // Perform Email update
    await execute("UPDATE User SET email = ?, updatedAt = NOW() WHERE id = ?", [data.newEmail, user.id]);

    // Cleanup OTP
    await execute("DELETE FROM OtpCode WHERE email = ?", [data.newEmail]);

    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 9. Booking & Appointment Server Functions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getClinicByTenantIdServerFn = createServerFn({ method: "GET" })
  .validator((tenantId: string) => {
    if (!tenantId) throw new Error("Tenant ID is required");
    return tenantId;
  })
  .handler(async ({ data: tenantId }) => {
    let clinic = await queryOne<any>(
      "SELECT clinicName, practiceSize FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
      [tenantId]
    );
    if (!clinic) {
      clinic = await queryOne<any>(
        "SELECT clinicName, practiceSize FROM User WHERE tenantId = ? LIMIT 1",
        [tenantId]
      );
    }
    if (!clinic) throw new Error("Clinic not found");
    return { name: clinic.clinicName, practiceSize: clinic.practiceSize };
  });

export const createAppointmentServerFn = createServerFn({ method: "POST" })
  .validator((data: { tenantId: string; name: string; email: string; phone: string; dateTime: string; reason: string; doctorId?: string; timeSlot?: string; whatsapp?: string; appointmentType?: string; patientId?: string | null }) => {
    if (!data.tenantId || !data.name || !data.email || !data.phone || !data.dateTime || !data.reason) {
      throw new Error("Required booking fields missing");
    }
    return data;
  })
  .handler(async ({ data }) => {
    // Plan check: Solo limit is 500 monthly appointments
    const tenant = await queryOne<any>("SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1", [data.tenantId]);
    const plan = tenant?.subscriptionPlan || "Solo";
    if (plan === "Solo") {
      const [monthCount] = await query<any>(
        "SELECT COUNT(*) as count FROM Appointment WHERE tenantId = ? AND dateTime >= DATE_FORMAT(NOW(), '%Y-%m-01')",
        [data.tenantId]
      );
      const count = monthCount?.count || monthCount?.COUNT || 0;
      if (Number(count) >= 500) {
        throw new Error("This clinic has reached the monthly limit of 500 appointments under the Solo plan. Please contact the clinic administrator to upgrade.");
      }
    }

    const id = crypto.randomUUID();
    const dateVal = new Date(data.dateTime);
    const docId = data.doctorId || null;
    const tSlot = data.timeSlot || null;

    await execute(
      `INSERT INTO Appointment (id, tenantId, name, email, phone, dateTime, reason, status, doctorId, timeSlot, whatsapp, appointmentType, patientId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, NOW())`,
      [id, data.tenantId, data.name, data.email, data.phone, dateVal, data.reason, docId, tSlot, data.whatsapp || null, data.appointmentType || null, data.patientId || null]
    );

    // Queue WhatsApp notification on backend
    if (typeof window === "undefined") {
      try {
        const waConfig = await queryOne<any>("SELECT isEnabled FROM WhatsAppConfig WHERE tenantId = ? LIMIT 1", [data.tenantId]);
        if (waConfig && waConfig.isEnabled) {
          const waStatus = await getWAStatus(data.tenantId);
          if (waStatus.state === "CONNECTED") {
            const clinic = await queryOne<any>("SELECT clinicName FROM User WHERE tenantId = ? LIMIT 1", [data.tenantId]);
            const clinicName = clinic ? clinic.clinicName : "Clinic";

            let docName = "";
            if (docId) {
              const doc = await queryOne<any>("SELECT name FROM Doctor WHERE id = ? LIMIT 1", [docId]);
              if (doc) docName = doc.name;
            }

            const dateStr = dateVal.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
            const timeStr = tSlot || dateVal.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            const docText = docName ? ` with *${docName}*` : "";

            const waMessage = `Hello *${data.name}*,\n\nYour appointment at *${clinicName}*${docText} is confirmed for *${dateStr}* at *${timeStr}*.\n\nThank you for choosing HealthSync AI!\n\n_This is an automated notification message._`;
            await enqueueWA(data.tenantId, data.phone, waMessage);
          }
        }
      } catch (waErr: any) {
        console.error("[WhatsApp] Failed to enqueue booking message:", waErr.message);
      }
    }

    return { success: true, appointmentId: id };
  });

export const getAppointmentsServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    const isDoctor = user.role === "doctor" && user.doctorId;
    let sql = `SELECT apt.*, d.name as doctorName
       FROM Appointment apt
       LEFT JOIN Doctor d ON apt.doctorId = d.id
       WHERE apt.tenantId = ?`;
    let params = [user.tenantId];
    if (isDoctor) {
      sql += ` AND apt.doctorId = ?`;
      params.push(user.doctorId);
    }
    sql += ` ORDER BY apt.dateTime ASC`;

    const appointments = await query<any>(sql, params);

    return appointments.map((apt) => ({
      id: apt.id,
      tenantId: apt.tenantId,
      name: apt.name,
      email: apt.email,
      phone: apt.phone,
      dateTime: apt.dateTime instanceof Date ? apt.dateTime.toISOString() : new Date(apt.dateTime).toISOString(),
      reason: apt.reason,
      status: apt.status,
      doctorId: apt.doctorId,
      doctorName: apt.doctorName || "",
      timeSlot: apt.timeSlot,
      whatsapp: apt.whatsapp || "",
      appointmentType: apt.appointmentType || "",
      patientId: apt.patientId || "",
      createdAt: apt.createdAt instanceof Date ? apt.createdAt.toISOString() : new Date(apt.createdAt).toISOString()
    }));
  });

export const updateAppointmentServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string; name: string; email: string; phone: string; dateTime: string; reason: string; status: string; doctorId?: string; timeSlot?: string; whatsapp?: string; appointmentType?: string; patientId?: string | null }) => {
    if (!data.id || !data.name || !data.email || !data.phone || !data.dateTime || !data.reason || !data.status) {
      throw new Error("Required fields missing");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    // Verify appointment belongs to the same tenantId
    const apt = await queryOne<any>("SELECT id FROM Appointment WHERE id = ? AND tenantId = ? LIMIT 1", [data.id, user.tenantId]);
    if (!apt) throw new Error("Appointment not found or unauthorized");

    const dateVal = new Date(data.dateTime);
    const docId = data.doctorId || null;
    const tSlot = data.timeSlot || null;

    await execute(
      `UPDATE Appointment SET name = ?, email = ?, phone = ?, dateTime = ?, reason = ?, status = ?, doctorId = ?, timeSlot = ?, whatsapp = ?, appointmentType = ?, patientId = ? WHERE id = ?`,
      [data.name, data.email, data.phone, dateVal, data.reason, data.status, docId, tSlot, data.whatsapp || null, data.appointmentType || null, data.patientId || null, data.id]
    );

    // Queue WhatsApp notification for status change
    if (typeof window === "undefined") {
      try {
        const waConfig = await queryOne<any>("SELECT isEnabled FROM WhatsAppConfig WHERE tenantId = ? LIMIT 1", [user.tenantId]);
        if (waConfig && waConfig.isEnabled) {
          const status = await getWAStatus(user.tenantId);
          if (status.state === "CONNECTED") {
            const clinic = await queryOne<any>("SELECT clinicName FROM User WHERE tenantId = ? LIMIT 1", [user.tenantId]);
            const clinicName = clinic ? clinic.clinicName : "Clinic";
            
            let statusMessage = "";
            if (data.status === "Confirmed") {
              statusMessage = `Your appointment at *${clinicName}* has been *Confirmed*.`;
            } else if (data.status === "Cancelled") {
              statusMessage = `Your appointment at *${clinicName}* has been *Cancelled*.`;
            } else if (data.status === "Completed") {
              statusMessage = `Your visit at *${clinicName}* has been marked as *Completed*.`;
            }

            if (statusMessage) {
              const waMessage = `Hello *${data.name}*,\n\n${statusMessage}\n\n_HealthSync AI Automated Update_`;
              await enqueueWA(user.tenantId, data.phone, waMessage);
            }
          }
        }
      } catch (waErr: any) {
        console.error("[WhatsApp] Failed to send update message:", waErr.message);
      }
    }

    return { success: true };
  });

export const deleteAppointmentServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("ID is required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    // Verify appointment belongs to the same tenantId
    const apt = await queryOne<any>("SELECT id FROM Appointment WHERE id = ? AND tenantId = ? LIMIT 1", [id, user.tenantId]);
    if (!apt) throw new Error("Appointment not found or unauthorized");

    await execute("DELETE FROM Appointment WHERE id = ?", [id]);

    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Clinic Timetable Settings Server Functions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getClinicHoursServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    const hours = await query<any>("SELECT * FROM ClinicHours WHERE tenantId = ? ORDER BY dayOfWeek ASC", [user.tenantId]);

    return hours.map((h) => ({
      id: h.id,
      tenantId: h.tenantId,
      dayOfWeek: h.dayOfWeek,
      openTime: h.openTime,
      closeTime: h.closeTime,
      isClosed: !!h.isClosed
    }));
  });

export const saveClinicHoursServerFn = createServerFn({ method: "POST" })
  .validator((data: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }>) => {
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    for (const h of data) {
      await execute(
        `INSERT INTO ClinicHours (id, tenantId, dayOfWeek, openTime, closeTime, isClosed)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE openTime = ?, closeTime = ?, isClosed = ?`,
        [crypto.randomUUID(), user.tenantId, h.dayOfWeek, h.openTime, h.closeTime, h.isClosed ? 1 : 0, h.openTime, h.closeTime, h.isClosed ? 1 : 0]
      );
    }
    return { success: true };
  });

// ──────────────────────────────────────────────
// Departments Settings Server Functions
// ──────────────────────────────────────────────

export const getDepartmentsServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    const list = await query<any>("SELECT * FROM Department WHERE tenantId = ? ORDER BY name ASC", [user.tenantId]);
    return list;
  });

export const createDepartmentServerFn = createServerFn({ method: "POST" })
  .validator((name: string) => {
    if (!name) throw new Error("Name is required");
    return name;
  })
  .handler(async ({ data: name }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    await execute(
      "INSERT INTO Department (id, tenantId, name) VALUES (?, ?, ?)",
      [crypto.randomUUID(), user.tenantId, name]
    );
    return { success: true };
  });

export const deleteDepartmentServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("ID is required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    await execute("DELETE FROM Department WHERE id = ? AND tenantId = ?", [id, user.tenantId]);
    return { success: true };
  });

// ──────────────────────────────────────────────
// Doctors Management Server Functions
// ──────────────────────────────────────────────

export const getDoctorsServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    const doctors = await query<any>(
      `SELECT d.*, dept.name as departmentName
       FROM Doctor d
       LEFT JOIN Department dept ON d.departmentId = dept.id
       WHERE d.tenantId = ?
       ORDER BY d.name ASC`,
      [user.tenantId]
    );

    return doctors;
  });

export const saveDoctorServerFn = createServerFn({ method: "POST" })
  .validator((data: { id?: string; name: string; email: string; phone: string; qualifications: string; departmentId: string }) => {
    if (!data.name || !data.email || !data.phone || !data.qualifications || !data.departmentId) {
      throw new Error("Missing required fields");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    // Plan check: Solo limit is 1 doctor profile in directory
    if (!data.id) {
      const tenant = await queryOne<any>("SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1", [user.tenantId]);
      const plan = tenant?.subscriptionPlan || "Solo";
      if (plan === "Solo") {
        const [docsCount] = await query<any>("SELECT COUNT(*) as count FROM Doctor WHERE tenantId = ?", [user.tenantId]);
        const count = docsCount?.count || docsCount?.COUNT || 0;
        if (Number(count) >= 1) {
          throw new Error("Your current plan (Solo) only allows 1 Doctor Profile. Please upgrade your plan to add more doctors to the directory.");
        }
      }
    }

    if (data.id) {
      await execute(
        `UPDATE Doctor SET name = ?, email = ?, phone = ?, qualifications = ?, departmentId = ?
         WHERE id = ? AND tenantId = ?`,
        [data.name, data.email, data.phone, data.qualifications, data.departmentId, data.id, user.tenantId]
      );
      return { success: true, doctorId: data.id };
    } else {
      const id = crypto.randomUUID();
      await execute(
        `INSERT INTO Doctor (id, tenantId, name, email, phone, qualifications, departmentId)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, user.tenantId, data.name, data.email, data.phone, data.qualifications, data.departmentId]
      );
      return { success: true, doctorId: id };
    }
  });

export const deleteDoctorServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("ID is required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const doc = await queryOne("SELECT id FROM Doctor WHERE id = ? AND tenantId = ? LIMIT 1", [id, user.tenantId]);
    if (!doc) throw new Error("Doctor not found or unauthorized");

    await execute("DELETE FROM Doctor WHERE id = ?", [id]);
    await execute("DELETE FROM DoctorSchedule WHERE doctorId = ?", [id]);
    await execute("DELETE FROM DoctorLeave WHERE doctorId = ?", [id]);
    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Doctor schedules & leaves server functions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getDoctorScheduleServerFn = createServerFn({ method: "GET" })
  .validator((doctorId: string) => {
    if (!doctorId) throw new Error("Doctor ID is required");
    return doctorId;
  })
  .handler(async ({ data: doctorId }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const schedules = await query<any>("SELECT * FROM DoctorSchedule WHERE doctorId = ? ORDER BY dayOfWeek ASC", [doctorId]);
    return schedules.map((s) => ({
      id: s.id,
      doctorId: s.doctorId,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      slotDuration: s.slotDuration,
      breaks: (() => {
        try { return s.breaks ? (typeof s.breaks === "string" ? JSON.parse(s.breaks) : s.breaks) : []; }
        catch { return []; }
      })(),
    }));
  });

export const saveDoctorScheduleServerFn = createServerFn({ method: "POST" })
  .validator((data: { doctorId: string; schedules: Array<{ dayOfWeek: number; startTime: string; endTime: string; slotDuration: number; breaks?: Array<{start:string;end:string;label:string}> }> }) => {
    if (!data.doctorId || !data.schedules) throw new Error("Required parameters missing");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    await execute("DELETE FROM DoctorSchedule WHERE doctorId = ?", [data.doctorId]);
    for (const s of data.schedules) {
      const breaksJson = JSON.stringify(s.breaks ?? []);
      await execute(
        `INSERT INTO DoctorSchedule (id, doctorId, dayOfWeek, startTime, endTime, slotDuration, breaks)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), data.doctorId, s.dayOfWeek, s.startTime, s.endTime, s.slotDuration || 30, breaksJson]
      );
    }
    return { success: true };
  });

export const getDoctorLeavesServerFn = createServerFn({ method: "GET" })
  .validator((doctorId: string) => {
    if (!doctorId) throw new Error("Doctor ID is required");
    return doctorId;
  })
  .handler(async ({ data: doctorId }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const leaves = await query<any>("SELECT * FROM DoctorLeave WHERE doctorId = ? ORDER BY leaveDate ASC", [doctorId]);
    return leaves.map((l) => ({
      id: l.id,
      doctorId: l.doctorId,
      leaveDate: l.leaveDate instanceof Date ? l.leaveDate.toISOString().split("T")[0] : new Date(l.leaveDate).toISOString().split("T")[0],
      reason: l.reason,
      isHoliday: !!l.isHoliday
    }));
  });

export const addDoctorLeaveServerFn = createServerFn({ method: "POST" })
  .validator((data: { doctorId: string; leaveDate: string; reason: string; isHoliday?: boolean }) => {
    if (!data.doctorId || !data.leaveDate) throw new Error("Required leave details missing");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const id = crypto.randomUUID();
    const dateVal = new Date(data.leaveDate);

    await execute(
      `INSERT INTO DoctorLeave (id, doctorId, leaveDate, reason, isHoliday)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = ?, isHoliday = ?`,
      [id, data.doctorId, dateVal, data.reason, data.isHoliday ? 1 : 0, data.reason, data.isHoliday ? 1 : 0]
    );
    return { success: true };
  });

export const deleteDoctorLeaveServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("ID is required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    await execute("DELETE FROM DoctorLeave WHERE id = ?", [id]);
    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// WhatsApp Management Server Functions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getWhatsAppStatusServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    
    let status = await getWAStatus(user.tenantId);
    // If the session is fully disconnected (and not currently initializing or paired),
    // trigger initialization automatically so the user is immediately presented with a QR code.
    if (status.state === "DISCONNECTED") {
      await initializeWA(user.tenantId);
      status = await getWAStatus(user.tenantId);
    }
    
    return status;
  });

export const disconnectWhatsAppServerFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    await disconnectWA(user.tenantId);
    return { success: true };
  });

export const sendTestWaServerFn = createServerFn({ method: "POST" })
  .validator((data: { phone: string; message: string }) => {
    if (!data.phone || !data.message) throw new Error("Phone and message are required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    const status = await getWAStatus(user.tenantId);
    if (status.state !== "CONNECTED") {
      throw new Error("WhatsApp is not connected. Please scan the QR code first.");
    }
    await enqueueWA(user.tenantId, data.phone, data.message);
    return { success: true, queued: true };
  });

export const getWhatsAppConfigServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    const config = await queryOne<any>(
      "SELECT * FROM WhatsAppConfig WHERE tenantId = ? LIMIT 1",
      [user.tenantId]
    );

    return config || null;
  });

export const saveWhatsAppConfigServerFn = createServerFn({ method: "POST" })
  .validator((data: { phoneNumber: string; isEnabled: boolean }) => {
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    await execute(
      `INSERT INTO WhatsAppConfig (id, tenantId, phoneNumber, isEnabled)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE phoneNumber = ?, isEnabled = ?`,
      [
        generateId(),
        user.tenantId,
        data.phoneNumber || null,
        data.isEnabled ? 1 : 0,
        data.phoneNumber || null,
        data.isEnabled ? 1 : 0
      ]
    );

    return { success: true };
  });


// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Public Clinic Info & Slots Retrieval
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getClinicInfoAndSlotsServerFn = createServerFn({ method: "GET" })
  .validator((data: { tenantId: string; date?: string; doctorId?: string }) => {
    if (!data.tenantId) throw new Error("Tenant ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    // 1. Resolve clinic details
    let clinicName = "";
    const profile = await queryOne<any>("SELECT clinicName FROM ClinicProfile WHERE tenantId = ? LIMIT 1", [data.tenantId]);
    if (profile) {
      clinicName = profile.clinicName;
    } else {
      const userClinic = await queryOne<any>("SELECT clinicName FROM User WHERE tenantId = ? LIMIT 1", [data.tenantId]);
      if (!userClinic) throw new Error("Clinic not found");
      clinicName = userClinic.clinicName;
    }

    // 2. Resolve active departments
    const departments = await query<any>("SELECT * FROM Department WHERE tenantId = ? ORDER BY name ASC", [data.tenantId]);

    // 3. Resolve active doctors
    const doctors = await query<any>(
      `SELECT d.*, dept.name as departmentName
       FROM Doctor d
       LEFT JOIN Department dept ON d.departmentId = dept.id
       WHERE d.tenantId = ?
       ORDER BY d.name ASC`,
      [data.tenantId]
    );

    // 4. If date and doctorId are selected, compute dynamic available slots
    let slots: string[] = [];
    if (data.date && data.doctorId) {
      const selectedDate = new Date(data.date);
      const dayOfWeek = selectedDate.getDay(); // 0 is Sunday, 6 is Saturday
      const dateStr = selectedDate.toISOString().split("T")[0];

      // A. Check if the clinic is closed on this day
      const clinicHours = await queryOne<any>(
        "SELECT * FROM ClinicHours WHERE tenantId = ? AND dayOfWeek = ? LIMIT 1",
        [data.tenantId, dayOfWeek]
      );
      
      const clinicClosed = clinicHours ? !!clinicHours.isClosed : (dayOfWeek === 0 || dayOfWeek === 6); // fallback Sat/Sun closed

      if (!clinicClosed) {
        // B. Check if the doctor is on holiday/leave on this date
        const leave = await queryOne<any>(
          "SELECT id FROM DoctorLeave WHERE doctorId = ? AND leaveDate = ? LIMIT 1",
          [data.doctorId, dateStr]
        );

        if (!leave) {
          // C. Get doctor schedule for this day of the week
          const docSchedule = await queryOne<any>(
            "SELECT * FROM DoctorSchedule WHERE doctorId = ? AND dayOfWeek = ? LIMIT 1",
            [data.doctorId, dayOfWeek]
          );

          if (docSchedule) {
            const startTimeStr = docSchedule.startTime; // e.g. "09:00"
            const endTimeStr = docSchedule.endTime; // e.g. "17:00"
            const duration = docSchedule.slotDuration || 30; // in minutes

            // Parse start and end times
            const [startHour, startMin] = startTimeStr.split(":").map(Number);
            const [endHour, endMin] = endTimeStr.split(":").map(Number);

            const startObj = new Date(selectedDate);
            startObj.setHours(startHour, startMin, 0, 0);

            const endObj = new Date(selectedDate);
            endObj.setHours(endHour, endMin, 0, 0);

            // Get existing bookings for this doctor on this day
            const existingBookings = await query<any>(
              `SELECT dateTime, timeSlot FROM Appointment
               WHERE doctorId = ? AND DATE(dateTime) = ? AND status != 'Cancelled'`,
              [data.doctorId, dateStr]
            );
            
            const bookedSlots = existingBookings.map((b) => b.timeSlot || "");

            // Generate time slots
            const temp = new Date(startObj);
            while (temp < endObj) {
              const slotTimeStr = temp.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true
              });
              
              // Only include if not already booked
              if (!bookedSlots.includes(slotTimeStr)) {
                slots.push(slotTimeStr);
              }
              
              temp.setMinutes(temp.getMinutes() + duration);
            }
          }
        }
      }
    }

    return {
      clinicName: clinicName,
      departments,
      doctors,
      slots
    };
  });

// ══════════════════════════════════════════════════════════════
// DASHBOARD OVERVIEW — Live Stats & Timeline
// ══════════════════════════════════════════════════════════════

export const getDashboardStatsServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    const todayStr = new Date().toISOString().split("T")[0];
    const isDoctor = user.role === "doctor" && user.doctorId;

    let todayAppointmentsQuery = `SELECT a.*, d.name as doctorName FROM Appointment a LEFT JOIN Doctor d ON a.doctorId = d.id WHERE a.tenantId = ? AND DATE(a.dateTime) = ?`;
    let todayAppointmentsParams = [user.tenantId, todayStr];
    if (isDoctor) {
      todayAppointmentsQuery += ` AND a.doctorId = ?`;
      todayAppointmentsParams.push(user.doctorId);
    }
    todayAppointmentsQuery += ` ORDER BY a.dateTime ASC`;
    const todayAppointments = await query<any>(todayAppointmentsQuery, todayAppointmentsParams);

    let allCountsQuery = `SELECT COUNT(*) as total, SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status='Confirmed' THEN 1 ELSE 0 END) as confirmed, SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END) as cancelled FROM Appointment WHERE tenantId = ?`;
    let allCountsParams = [user.tenantId];
    if (isDoctor) {
      allCountsQuery += ` AND doctorId = ?`;
      allCountsParams.push(user.doctorId);
    }
    const [allCounts] = await query<any>(allCountsQuery, allCountsParams);

    let todayCountsQuery = `SELECT COUNT(*) as total, SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status='Confirmed' THEN 1 ELSE 0 END) as confirmed, SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed FROM Appointment WHERE tenantId = ? AND DATE(dateTime) = ?`;
    let todayCountsParams = [user.tenantId, todayStr];
    if (isDoctor) {
      todayCountsQuery += ` AND doctorId = ?`;
      todayCountsParams.push(user.doctorId);
    }
    const [todayCounts] = await query<any>(todayCountsQuery, todayCountsParams);

    let patientCountQuery = "SELECT COUNT(*) as total FROM Patient WHERE tenantId = ?";
    let patientCountParams = [user.tenantId];
    if (isDoctor) {
      patientCountQuery = "SELECT COUNT(DISTINCT patientId) as total FROM Appointment WHERE tenantId = ? AND doctorId = ?";
      patientCountParams = [user.tenantId, user.doctorId];
    }
    const [patientCount] = await query<any>(patientCountQuery, patientCountParams);

    let recentAppointmentsQuery = `SELECT a.*, d.name as doctorName FROM Appointment a LEFT JOIN Doctor d ON a.doctorId = d.id WHERE a.tenantId = ?`;
    let recentAppointmentsParams = [user.tenantId];
    if (isDoctor) {
      recentAppointmentsQuery += ` AND a.doctorId = ?`;
      recentAppointmentsParams.push(user.doctorId);
    }
    recentAppointmentsQuery += ` ORDER BY a.createdAt DESC LIMIT 5`;
    const recentAppointments = await query<any>(recentAppointmentsQuery, recentAppointmentsParams);

    return {
      todayAppointments,
      allTimeCounts: { total: Number(allCounts?.total||0), pending: Number(allCounts?.pending||0), confirmed: Number(allCounts?.confirmed||0), completed: Number(allCounts?.completed||0), cancelled: Number(allCounts?.cancelled||0) },
      todayCounts: { total: Number(todayCounts?.total||0), pending: Number(todayCounts?.pending||0), confirmed: Number(todayCounts?.confirmed||0), completed: Number(todayCounts?.completed||0) },
      totalPatients: Number(patientCount?.total||0),
      recentAppointments,
    };
  });

// ══════════════════════════════════════════════════════════════
// ANALYTICS — Live Chart Data
// ══════════════════════════════════════════════════════════════

export const getAnalyticsServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    const isDoctor = user.role === "doctor" && user.doctorId;

    let byDayOfWeekQuery = `SELECT DAYOFWEEK(dateTime) as dow, COUNT(*) as count FROM Appointment WHERE tenantId = ? AND dateTime >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    let byDayOfWeekParams = [user.tenantId];
    if (isDoctor) {
      byDayOfWeekQuery += ` AND doctorId = ?`;
      byDayOfWeekParams.push(user.doctorId);
    }
    byDayOfWeekQuery += ` GROUP BY DAYOFWEEK(dateTime) ORDER BY dow`;
    const byDayOfWeek = await query<any>(byDayOfWeekQuery, byDayOfWeekParams);

    let monthlyTrendQuery = `SELECT DATE_FORMAT(dateTime, '%Y-%m') as month, COUNT(*) as count FROM Appointment WHERE tenantId = ? AND dateTime >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`;
    let monthlyTrendParams = [user.tenantId];
    if (isDoctor) {
      monthlyTrendQuery += ` AND doctorId = ?`;
      monthlyTrendParams.push(user.doctorId);
    }
    monthlyTrendQuery += ` GROUP BY DATE_FORMAT(dateTime, '%Y-%m') ORDER BY month`;
    const monthlyTrend = await query<any>(monthlyTrendQuery, monthlyTrendParams);

    let statusBreakdownQuery = "SELECT status, COUNT(*) as count FROM Appointment WHERE tenantId = ?";
    let statusBreakdownParams = [user.tenantId];
    if (isDoctor) {
      statusBreakdownQuery += ` AND doctorId = ?`;
      statusBreakdownParams.push(user.doctorId);
    }
    statusBreakdownQuery += ` GROUP BY status`;
    const statusBreakdown = await query<any>(statusBreakdownQuery, statusBreakdownParams);

    let topDoctorsQuery = `SELECT d.name, COUNT(a.id) as count FROM Appointment a LEFT JOIN Doctor d ON a.doctorId = d.id WHERE a.tenantId = ? AND d.name IS NOT NULL`;
    let topDoctorsParams = [user.tenantId];
    if (isDoctor) {
      topDoctorsQuery += ` AND a.doctorId = ?`;
      topDoctorsParams.push(user.doctorId);
    }
    topDoctorsQuery += ` GROUP BY a.doctorId, d.name ORDER BY count DESC LIMIT 5`;
    const topDoctors = await query<any>(topDoctorsQuery, topDoctorsParams);

    let patientCountQuery = "SELECT COUNT(*) as total FROM Patient WHERE tenantId = ?";
    let patientCountParams = [user.tenantId];
    if (isDoctor) {
      patientCountQuery = "SELECT COUNT(DISTINCT patientId) as total FROM Appointment WHERE tenantId = ? AND doctorId = ?";
      patientCountParams = [user.tenantId, user.doctorId];
    }
    const [patientCount] = await query<any>(patientCountQuery, patientCountParams);

    let totalsQuery = `SELECT COUNT(*) as total, SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END) as cancelled FROM Appointment WHERE tenantId = ?`;
    let totalsParams = [user.tenantId];
    if (isDoctor) {
      totalsQuery += ` AND doctorId = ?`;
      totalsParams.push(user.doctorId);
    }
    const [totals] = await query<any>(totalsQuery, totalsParams);
    const total = Number(totals?.total||0);
    const completed = Number(totals?.completed||0);
    const cancelled = Number(totals?.cancelled||0);
    const completionRate = total - cancelled > 0 ? Math.round((completed/(total-cancelled))*100) : 0;
    const dowMap: Record<number,string> = {1:"Sun",2:"Mon",3:"Tue",4:"Wed",5:"Thu",6:"Fri",7:"Sat"};

    return {
      byDayOfWeek: byDayOfWeek.map((r: any) => ({ day: dowMap[Number(r.dow)]||String(r.dow), count: Number(r.count) })),
      monthlyTrend: monthlyTrend.map((r: any) => ({ month: r.month, count: Number(r.count) })),
      statusBreakdown: statusBreakdown.map((r: any) => ({ status: r.status, count: Number(r.count) })),
      topDoctors: topDoctors.map((r: any) => ({ name: r.name, count: Number(r.count) })),
      scorecard: { totalPatients: Number(patientCount?.total||0), totalAppointments: total, completionRate },
    };
  });

// ══════════════════════════════════════════════════════════════
// PATIENT CRUD
// ══════════════════════════════════════════════════════════════

export const getPatientsServerFn = createServerFn({ method: "GET" })
  .validator((data: { search?: string; page?: number }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    const page = data.page || 1; const pageSize = 20; const offset = (page-1)*pageSize;
    const search = data.search ? `%${data.search}%` : "%";
    const patients = await query<any>(
      `SELECT p.*, (SELECT MAX(a.dateTime) FROM Appointment a WHERE a.patientId = p.id OR (a.name = p.name AND a.tenantId = p.tenantId)) as lastVisit FROM Patient p WHERE p.tenantId = ? AND (p.name LIKE ? OR p.patientNo LIKE ? OR p.phone LIKE ? OR p.email LIKE ?) ORDER BY p.createdAt DESC LIMIT ? OFFSET ?`,
      [user.tenantId, search, search, search, search, pageSize, offset]
    );
    const [countRow] = await query<any>(`SELECT COUNT(*) as total FROM Patient WHERE tenantId = ? AND (name LIKE ? OR patientNo LIKE ? OR phone LIKE ? OR email LIKE ?)`, [user.tenantId, search, search, search, search]);
    return { patients, total: Number(countRow?.total||0), page, pageSize };
  });

export const checkPatientDuplicateServerFn = createServerFn({ method: "POST" })
  .validator((data: { email?: string | null; phone?: string | null }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    if (!data.email && !data.phone) return { exists: false };
    
    let sql = "SELECT * FROM Patient WHERE tenantId = ? AND (";
    const params: any[] = [user.tenantId];
    const subConds: string[] = [];
    if (data.email) {
      subConds.push("email = ?");
      params.push(data.email);
    }
    if (data.phone) {
      subConds.push("phone = ?");
      params.push(data.phone);
    }
    sql += subConds.join(" OR ") + ") LIMIT 1";
    
    const existing = await queryOne<any>(sql, params);
    if (existing) {
      return { exists: true, patient: existing };
    }
    return { exists: false };
  });

export const createPatientServerFn = createServerFn({ method: "POST" })
  .validator((data: { name: string; age?: number; gender?: string; phone?: string | null; email?: string | null; address?: string | null; chiefComplaint?: string; notes?: string | null; dob?: string | null; bloodGroup?: string | null; }) => {
    if (!data.name) throw new Error("Patient name is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    // Plan check: Solo limit is 500 patients
    const tenant = await queryOne<any>("SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1", [user.tenantId]);
    const plan = tenant?.subscriptionPlan || "Solo";
    if (plan === "Solo") {
      const [patientCount] = await query<any>("SELECT COUNT(*) as total FROM Patient WHERE tenantId = ?", [user.tenantId]);
      const total = patientCount?.total || patientCount?.TOTAL || 0;
      if (Number(total) >= 500) {
        throw new Error("You have reached the maximum limit of 500 patient records under the Solo plan. Please upgrade your plan to add more patients.");
      }
    }

    const [lastP] = await query<any>("SELECT patientNo FROM Patient WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 1", [user.tenantId]);
    let nextNum = 1;
    if (lastP?.patientNo) { const m = String(lastP.patientNo).match(/P-(\d+)/); if (m) nextNum = parseInt(m[1])+1; }
    const patientNo = `P-${String(nextNum).padStart(3,"0")}`;
    const cryptoMod = await import("crypto");
    const id = cryptoMod.randomUUID();
    await execute(`INSERT INTO Patient (id,tenantId,patientNo,name,age,gender,phone,email,address,chiefComplaint,notes,dob,bloodGroup,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [id, user.tenantId, patientNo, data.name, data.age||null, data.gender||null, data.phone||null, data.email||null, data.address||null, data.chiefComplaint||null, data.notes||null, data.dob||null, data.bloodGroup||null]);
    return { success: true, patientId: id, patientNo };
  });

export const updatePatientServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string; name?: string; age?: number; gender?: string; phone?: string | null; email?: string | null; address?: string | null; chiefComplaint?: string; notes?: string | null; dob?: string | null; bloodGroup?: string | null; }) => {
    if (!data.id) throw new Error("Patient ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    const existing = await queryOne<any>("SELECT * FROM Patient WHERE id = ? AND tenantId = ? LIMIT 1", [data.id, user.tenantId]);
    if (!existing) throw new Error("Patient not found");
    await execute(`UPDATE Patient SET name=?,age=?,gender=?,phone=?,email=?,address=?,chiefComplaint=?,notes=?,dob=?,bloodGroup=? WHERE id=? AND tenantId=?`,
      [data.name??existing.name, data.age??existing.age, data.gender??existing.gender, data.phone??existing.phone, data.email??existing.email, data.address??existing.address, data.chiefComplaint??existing.chiefComplaint, data.notes??existing.notes, data.dob??existing.dob, data.bloodGroup??existing.bloodGroup, data.id, user.tenantId]);
    return { success: true };
  });

export const deletePatientServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => { if (!data.id) throw new Error("Patient ID is required"); return data; })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    await execute("DELETE FROM SoapNote WHERE patientId = ?", [data.id]);
    await execute("DELETE FROM Patient WHERE id = ? AND tenantId = ?", [data.id, user.tenantId]);
    return { success: true };
  });

export const getPatientChartServerFn = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => { if (!data.patientId) throw new Error("Patient ID required"); return data; })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    const patient = await queryOne<any>("SELECT * FROM Patient WHERE id = ? AND tenantId = ? LIMIT 1", [data.patientId, user.tenantId]);
    if (!patient) throw new Error("Patient not found");
    const soapNotes = await query<any>("SELECT * FROM SoapNote WHERE patientId = ? ORDER BY createdAt DESC LIMIT 20", [data.patientId]);

    // Fetch prescriptions for this patient
    const prescriptionsRaw = await query<any>("SELECT * FROM Prescription WHERE patientId = ? ORDER BY createdAt DESC LIMIT 20", [data.patientId]);
    const prescriptions = prescriptionsRaw.map((r: any) => ({
      id: r.id,
      patientId: r.patientId,
      medications: (() => {
        try { return typeof r.medications === "string" ? JSON.parse(r.medications) : r.medications; }
        catch { return []; }
      })(),
      notes: r.notes,
      createdAt: r.createdAt
    }));

    const isDoctor = user.role === "doctor" && user.doctorId;
    let aptSql = `SELECT a.*, d.name as doctorName FROM Appointment a LEFT JOIN Doctor d ON a.doctorId = d.id WHERE (a.patientId = ? OR (a.name = ? AND a.tenantId = ?))`;
    let aptParams = [data.patientId, patient.name, user.tenantId];
    if (isDoctor) {
      aptSql += ` AND a.doctorId = ?`;
      aptParams.push(user.doctorId);
    }
    aptSql += ` ORDER BY a.dateTime DESC LIMIT 10`;

    const appointments = await query<any>(aptSql, aptParams);
    return { patient, soapNotes, prescriptions, appointments };
  });

// ══════════════════════════════════════════════════════════════
// SOAP NOTES — AI Scribe Persistence & Generation
// ══════════════════════════════════════════════════════════════

export const generateSoapNoteServerFn = createServerFn({ method: "POST" })
  .validator((data: { transcript: string; specialty: string; language: string }) => {
    if (!data.transcript) throw new Error("Transcript is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key is not configured in .env file.");
    }

    const specialtyPrompt = `You are an expert AI clinical scribe. Synthesize the following doctor-patient encounter transcript into a professional, structured SOAP note for the specialty "${data.specialty}" in the language "${data.language}".
Provide the response in raw JSON format with the following keys:
- subjective: A detailed subjective description of the patient's narrative, chief complaint, history of present illness (HPI), etc.
- objective: Objective findings including physical exams, vitals, general appearance, etc.
- assessment: Clinical assessment, differential diagnosis, and findings.
- plan: Treatment plan, medications, referrals, patient education, and follow-ups.

Only return a valid JSON object matching this structure. Do not wrap the JSON in markdown code blocks or add any other text outside the JSON object.

Transcript:
"${data.transcript}"`;

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:8080",
          "X-Title": "HealthSync AI"
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "You are an accurate, secure clinical note generator. You output only clean JSON." },
            { role: "user", content: specialtyPrompt }
          ],
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("OpenRouter API error:", errorText);
        throw new Error(`OpenRouter API error: ${response.statusText}`);
      }

      const resJson = await response.json();
      const content = resJson.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from AI scribe model.");
      }

      const soapNote = JSON.parse(content.trim());
      return {
        success: true,
        subjective: soapNote.subjective || "",
        objective: soapNote.objective || "",
        assessment: soapNote.assessment || "",
        plan: soapNote.plan || ""
      };
    } catch (e: any) {
      console.error("Failed to generate SOAP note via OpenRouter:", e);
      throw new Error(e.message || "Failed to generate SOAP note.");
    }
  });

export const saveSoapNoteServerFn = createServerFn({ method: "POST" })
  .validator((data: { patientId: string; appointmentId?: string; specialty?: string; subjective: string; objective: string; assessment: string; plan: string; rawTranscript?: string; }) => {
    if (!data.patientId) throw new Error("Patient ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    const cryptoMod = await import("crypto");
    const id = cryptoMod.randomUUID();
    await execute(`INSERT INTO SoapNote (id,tenantId,patientId,appointmentId,specialty,subjective,objective,assessment,plan,rawTranscript,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
      [id, user.tenantId, data.patientId, data.appointmentId||null, data.specialty||null, data.subjective, data.objective, data.assessment, data.plan, data.rawTranscript||null]);
    return { success: true, soapNoteId: id };
  });

// ══════════════════════════════════════════════════════════════
// PRESCRIPTIONS — Voice Prescription Parsing & Saving
// ══════════════════════════════════════════════════════════════

export const generatePrescriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: { transcript: string; language: string }) => {
    if (!data.transcript) throw new Error("Voice prescription instructions are required.");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key is not configured in .env file.");
    }

    const prompt = `You are a medical AI assistant. Extract and format a structured medical prescription from the following doctor's voice prescription instructions.
Format the output in raw JSON format with the following structure:
{
  "medications": [
    {
      "name": "Drug name (e.g., Amoxicillin)",
      "dosage": "Dosage (e.g., 500mg)",
      "frequency": "Frequency (e.g., Three times daily / TID)",
      "route": "Route (e.g., Oral)",
      "duration": "Duration (e.g., 7 days)",
      "instructions": "Specific instructions (e.g., Take with meals)"
    }
  ],
  "notes": "Any clinical directions or additional notes (e.g., avoid alcohol, drink plenty of water)"
}

If no medications are found, return an empty array for "medications".
Only return a valid JSON object matching this structure. Do not wrap the JSON in markdown code blocks or add any other text outside the JSON object.

Voice Instructions:
"${data.transcript}"`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Gemini API error:", errorText);
        throw new Error(`Gemini API error: ${response.statusText}`);
      }

      const resJson = await response.json();
      const content = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) {
        throw new Error("Empty response from Gemini model.");
      }

      const prescription = JSON.parse(content.trim());
      return {
        success: true,
        medications: prescription.medications || [],
        notes: prescription.notes || ""
      };
    } catch (e: any) {
      console.error("Failed to generate prescription via Gemini:", e);
      throw new Error(e.message || "Failed to generate prescription.");
    }
  });

export const savePrescriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: { patientId: string; medications: any[]; notes?: string }) => {
    if (!data.patientId) throw new Error("Patient ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    const cryptoMod = await import("crypto");
    const id = cryptoMod.randomUUID();
    const medsJson = JSON.stringify(data.medications);
    await execute(`INSERT INTO Prescription (id, tenantId, patientId, medications, notes, createdAt) VALUES (?, ?, ?, ?, ?, NOW())`,
      [id, user.tenantId, data.patientId, medsJson, data.notes || null]);
    return { success: true, prescriptionId: id };
  });


export const getAppointmentsPagedServerFn = createServerFn({ method: "GET" })
  .validator((data: { search?: string; status?: string; dateFilter?: string; page?: number }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    const page = data.page||1; const pageSize = 20; const offset = (page-1)*pageSize;
    const conditions: string[] = ["a.tenantId = ?"];
    const params: any[] = [user.tenantId];

    const isDoctor = user.role === "doctor" && user.doctorId;
    if (isDoctor) {
      conditions.push("a.doctorId = ?");
      params.push(user.doctorId);
    }

    if (data.search) { conditions.push("(a.name LIKE ? OR a.email LIKE ? OR a.phone LIKE ?)"); const s = `%${data.search}%`; params.push(s,s,s); }
    if (data.status && data.status !== "All") { conditions.push("a.status = ?"); params.push(data.status); }
    if (data.dateFilter === "today") conditions.push("DATE(a.dateTime) = CURDATE()");
    else if (data.dateFilter === "week") conditions.push("a.dateTime >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
    else if (data.dateFilter === "month") conditions.push("a.dateTime >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
    const where = `WHERE ${conditions.join(" AND ")}`;
    const appointments = await query<any>(`SELECT a.*, d.name as doctorName FROM Appointment a LEFT JOIN Doctor d ON a.doctorId = d.id ${where} ORDER BY a.dateTime DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    const [countRow] = await query<any>(`SELECT COUNT(*) as total FROM Appointment a ${where}`, params);

    let summaryQuery = `SELECT COUNT(*) as total, SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status='Confirmed' THEN 1 ELSE 0 END) as confirmed, SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END) as cancelled FROM Appointment WHERE tenantId = ?`;
    let summaryParams = [user.tenantId];
    if (isDoctor) {
      summaryQuery += " AND doctorId = ?";
      summaryParams.push(user.doctorId);
    }
    const [summary] = await query<any>(summaryQuery, summaryParams);

    return { appointments, total: Number(countRow?.total||0), page, pageSize, summary: { total: Number(summary?.total||0), pending: Number(summary?.pending||0), confirmed: Number(summary?.confirmed||0), completed: Number(summary?.completed||0), cancelled: Number(summary?.cancelled||0) } };
  });

// ─────────────────────────────────────────────────────────────
// Sub-User Management (Reception / Doctor accounts per tenant)
// ─────────────────────────────────────────────────────────────

export const getSubUsersServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    const rows = await query<any>(
      "SELECT id, name, email, phone, role, doctorId, isActive, createdAt FROM SubUser WHERE tenantId = ? ORDER BY createdAt DESC",
      [user.tenantId]
    );
    return rows;
  });

export const createSubUserServerFn = createServerFn({ method: "POST" })
  .validator((data: { name: string; email: string; phone?: string; role: "reception" | "doctor"; doctorId?: string; password: string }) => {
    if (!data.name || !data.email || !data.role || !data.password) throw new Error("Name, email, role, and password are required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    // Plan check: Solo limit is 1 Doctor, 1 Receptionist
    const tenant = await queryOne<any>("SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1", [user.tenantId]);
    const plan = tenant?.subscriptionPlan || "Solo";
    if (plan === "Solo") {
      if (data.role === "doctor") {
        const [docsCount] = await query<any>("SELECT COUNT(*) as count FROM SubUser WHERE tenantId = ? AND role = 'doctor'", [user.tenantId]);
        const count = docsCount?.count || docsCount?.COUNT || 0;
        if (Number(count) >= 1) {
          throw new Error("Your current plan (Solo) only allows 1 Doctor Dashboard. Please upgrade your plan to create more doctor sub-users.");
        }
      } else if (data.role === "reception") {
        const [recepsCount] = await query<any>("SELECT COUNT(*) as count FROM SubUser WHERE tenantId = ? AND role = 'reception'", [user.tenantId]);
        const count = recepsCount?.count || recepsCount?.COUNT || 0;
        if (Number(count) >= 1) {
          throw new Error("Your current plan (Solo) only allows 1 Reception Dashboard. Please upgrade your plan to create more reception sub-users.");
        }
      }
    }

    const existing = await queryOne<any>(
      "SELECT id FROM SubUser WHERE tenantId = ? AND email = ? LIMIT 1",
      [user.tenantId, data.email]
    );
    if (existing) throw new Error("A sub-user with this email already exists in your clinic");

    const hashed = await bcrypt.hash(data.password, 10);
    const id = crypto.randomUUID();
    await execute(
      `INSERT INTO SubUser (id, tenantId, name, email, phone, role, doctorId, password, isActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, user.tenantId, data.name, data.email, data.phone || null, data.role, data.doctorId || null, hashed]
    );
    return { success: true, id };
  });

export const updateSubUserServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string; name?: string; phone?: string; role?: string; doctorId?: string; password?: string; isActive?: number }) => {
    if (!data.id) throw new Error("Sub-user ID required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    // Plan check for role updates
    if (data.role) {
      const existingSub = await queryOne<any>("SELECT role FROM SubUser WHERE id = ? AND tenantId = ? LIMIT 1", [data.id, user.tenantId]);
      if (existingSub && existingSub.role !== data.role) {
        const tenant = await queryOne<any>("SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1", [user.tenantId]);
        const plan = tenant?.subscriptionPlan || "Solo";
        if (plan === "Solo") {
          if (data.role === "doctor") {
            const [docsCount] = await query<any>("SELECT COUNT(*) as count FROM SubUser WHERE tenantId = ? AND role = 'doctor'", [user.tenantId]);
            const count = docsCount?.count || docsCount?.COUNT || 0;
            if (Number(count) >= 1) {
              throw new Error("Your current plan (Solo) only allows 1 Doctor Dashboard. Please upgrade your plan to change role.");
            }
          } else if (data.role === "reception") {
            const [recepsCount] = await query<any>("SELECT COUNT(*) as count FROM SubUser WHERE tenantId = ? AND role = 'reception'", [user.tenantId]);
            const count = recepsCount?.count || recepsCount?.COUNT || 0;
            if (Number(count) >= 1) {
              throw new Error("Your current plan (Solo) only allows 1 Reception Dashboard. Please upgrade your plan to change role.");
            }
          }
        }
      }
    }

    const fields: string[] = [];
    const params: any[] = [];

    if (data.name)     { fields.push("name = ?");     params.push(data.name); }
    if (data.phone !== undefined) { fields.push("phone = ?"); params.push(data.phone || null); }
    if (data.role)     { fields.push("role = ?");     params.push(data.role); }
    if (data.doctorId !== undefined) { fields.push("doctorId = ?"); params.push(data.doctorId || null); }
    if (data.isActive !== undefined) { fields.push("isActive = ?"); params.push(data.isActive); }
    if (data.password) {
      const hashed = await bcrypt.hash(data.password, 10);
      fields.push("password = ?");
      params.push(hashed);
    }

    if (fields.length === 0) return { success: true };

    params.push(data.id, user.tenantId);
    await execute(
      `UPDATE SubUser SET ${fields.join(", ")} WHERE id = ? AND tenantId = ?`,
      params
    );
    return { success: true };
  });

export const deleteSubUserServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("Sub-user ID required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    await execute("DELETE FROM SubUserSession WHERE subUserId = ?", [id]);
    await execute("DELETE FROM SubUser WHERE id = ? AND tenantId = ?", [id, user.tenantId]);
    return { success: true };
  });
export const subUserLoginServerFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; password: string; tenantId: string }) => {
    if (!data.email || !data.password || !data.tenantId) throw new Error("Email, password, and clinic ID are required");
    return data;
  })
  .handler(async ({ data }) => {
    const subUser = await queryOne<any>(
      "SELECT * FROM SubUser WHERE email = ? AND tenantId = ? LIMIT 1",
      [data.email, data.tenantId]
    );
    if (!subUser) throw new Error("No account found with this email in this clinic");
    if (!subUser.isActive) throw new Error("This account has been deactivated. Please contact your clinic admin.");

    const match = await bcrypt.compare(data.password, subUser.password);
    if (!match) throw new Error("Incorrect password");

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hrs
    await execute(
      "INSERT INTO SubUserSession (id, subUserId, token, expiresAt) VALUES (?, ?, ?, ?)",
      [crypto.randomUUID(), subUser.id, token, expiresAt]
    );

    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie("sub_session_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });

    return {
      success: true,
      user: { id: subUser.id, name: subUser.name, email: subUser.email, role: subUser.role, tenantId: subUser.tenantId },
    };
  });

// ──────────────────────────────────────────────
// WhatsApp Hub Server Functions
// ──────────────────────────────────────────────

export const getWATemplatesServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    return query("SELECT * FROM WATemplate WHERE tenantId = ? ORDER BY createdAt DESC", [user.id]);
  });

export const saveWATemplateServerFn = createServerFn({ method: "POST" })
  .validator((data: {
    id?: string;
    name: string;
    category: string;
    headerType: string;
    headerText?: string | null;
    headerImageUrl?: string | null;
    bodyText: string;
    footerText?: string | null;
    ctaButtons?: any;
    quickReplyButtons?: any;
    variables?: any;
  }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    
    const id = data.id || crypto.randomUUID();
    const ctaJson = data.ctaButtons ? JSON.stringify(data.ctaButtons) : null;
    const qrJson = data.quickReplyButtons ? JSON.stringify(data.quickReplyButtons) : null;
    const varsJson = data.variables ? JSON.stringify(data.variables) : null;

    if (data.id) {
      await execute(
        `UPDATE WATemplate SET 
          name = ?, category = ?, headerType = ?, headerText = ?, headerImageUrl = ?, 
          bodyText = ?, footerText = ?, ctaButtons = ?, quickReplyButtons = ?, variables = ? 
         WHERE id = ? AND tenantId = ?`,
        [
          data.name, data.category, data.headerType, data.headerText || null, data.headerImageUrl || null,
          data.bodyText, data.footerText || null, ctaJson, qrJson, varsJson, id, user.id
        ]
      );
    } else {
      await execute(
        `INSERT INTO WATemplate (
          id, tenantId, name, category, headerType, headerText, headerImageUrl, 
          bodyText, footerText, ctaButtons, quickReplyButtons, variables
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, user.id, data.name, data.category, data.headerType, data.headerText || null, data.headerImageUrl || null,
          data.bodyText, data.footerText || null, ctaJson, qrJson, varsJson
        ]
      );
    }
    return { success: true, id };
  });

export const deleteWATemplateServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    await execute("DELETE FROM WATemplate WHERE id = ? AND tenantId = ?", [id, user.id]);
    return { success: true };
  });

export const getWACampaignsServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    return query(`
      SELECT c.*, t.name as templateName 
      FROM WACampaign c
      LEFT JOIN WATemplate t ON c.templateId = t.id
      WHERE c.tenantId = ? ORDER BY c.createdAt DESC
    `, [user.id]);
  });

export const createWACampaignServerFn = createServerFn({ method: "POST" })
  .validator((data: {
    name: string;
    templateId: string | null;
    minDelaySec: number;
    maxDelaySec: number;
    dailyLimit: number;
    recipients: { phone: string; name?: string | null; variables?: any }[];
  }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const campaignId = crypto.randomUUID();
    
    await execute(
      `INSERT INTO WACampaign (
        id, tenantId, name, templateId, status, totalRecipients, sentCount, failedCount, minDelaySec, maxDelaySec, dailyLimit
       ) VALUES (?, ?, ?, ?, 'draft', ?, 0, 0, ?, ?, ?)`,
      [campaignId, user.id, data.name, data.templateId, data.recipients.length, data.minDelaySec, data.maxDelaySec, data.dailyLimit]
    );

    for (const r of data.recipients) {
      const recipientId = crypto.randomUUID();
      const varsJson = r.variables ? JSON.stringify(r.variables) : null;
      await execute(
        `INSERT INTO WACampaignRecipient (id, campaignId, phone, name, variables, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
        [recipientId, campaignId, r.phone, r.name || null, varsJson]
      );
    }

    return { success: true, campaignId };
  });

export const startWACampaignServerFn = createServerFn({ method: "POST" })
  .validator((campaignId: string) => campaignId)
  .handler(async ({ data: campaignId }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const campaign = await queryOne<any>(
      "SELECT * FROM WACampaign WHERE id = ? AND tenantId = ?",
      [campaignId, user.id]
    );
    if (!campaign) throw new Error("Campaign not found");

    let template: any = null;
    if (campaign.templateId) {
      template = await queryOne<any>(
        "SELECT * FROM WATemplate WHERE id = ? AND tenantId = ?",
        [campaign.templateId, user.id]
      );
    }

    const recipients = await query<any>(
      "SELECT * FROM WACampaignRecipient WHERE campaignId = ? AND status = 'pending'",
      [campaignId]
    );

    if (recipients.length === 0) {
      throw new Error("No pending recipients in this campaign");
    }

    const messages = [];
    for (const r of recipients) {
      let body = template ? template.bodyText : "Hello";
      const headerUrl = template?.headerImageUrl || null;
      
      if (r.variables) {
        const variablesObj = typeof r.variables === "string" ? JSON.parse(r.variables) : r.variables;
        if (variablesObj && typeof variablesObj === "object") {
          for (const key of Object.keys(variablesObj)) {
            const replacement = String(variablesObj[key]);
            body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), replacement);
          }
        }
      }

      messages.push({
        recipientId: r.id,
        phone: r.phone,
        body,
        mediaUrl: headerUrl
      });
    }

    await enqueueWABulk(
      user.id,
      campaignId,
      messages,
      campaign.minDelaySec,
      campaign.maxDelaySec
    );

    return { success: true };
  });

export const pauseWACampaignServerFn = createServerFn({ method: "POST" })
  .validator((campaignId: string) => campaignId)
  .handler(async ({ data: campaignId }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    await pauseWACampaign(user.id, campaignId);
    return { success: true };
  });

export const deleteWACampaignServerFn = createServerFn({ method: "POST" })
  .validator((campaignId: string) => campaignId)
  .handler(async ({ data: campaignId }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    try {
      await pauseWACampaign(user.id, campaignId);
    } catch (_) {}

    await execute("DELETE FROM WACampaignRecipient WHERE campaignId = ?", [campaignId]);
    await execute("DELETE FROM WACampaign WHERE id = ? AND tenantId = ?", [campaignId, user.id]);

    return { success: true };
  });

export const getCampaignRecipientsServerFn = createServerFn({ method: "GET" })
  .validator((campaignId: string) => campaignId)
  .handler(async ({ data: campaignId }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    
    return query("SELECT * FROM WACampaignRecipient WHERE campaignId = ?", [campaignId]);
  });

export const getWAAutoRepliesServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    return query("SELECT * FROM WAAutoReply WHERE tenantId = ? ORDER BY priority DESC, createdAt DESC", [user.id]);
  });

export const saveWAAutoReplyServerFn = createServerFn({ method: "POST" })
  .validator((data: {
    id?: string;
    triggerKeyword: string;
    matchType: string;
    replyMessage: string;
    isActive: number;
    priority: number;
  }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const id = data.id || crypto.randomUUID();
    if (data.id) {
      await execute(
        `UPDATE WAAutoReply SET triggerKeyword = ?, matchType = ?, replyMessage = ?, isActive = ?, priority = ? 
         WHERE id = ? AND tenantId = ?`,
        [data.triggerKeyword, data.matchType, data.replyMessage, data.isActive, data.priority, id, user.id]
      );
    } else {
      await execute(
        `INSERT INTO WAAutoReply (id, tenantId, triggerKeyword, matchType, replyMessage, isActive, priority) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, user.id, data.triggerKeyword, data.matchType, data.replyMessage, data.isActive, data.priority]
      );
    }
    return { success: true, id };
  });

export const deleteWAAutoReplyServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    await execute("DELETE FROM WAAutoReply WHERE id = ? AND tenantId = ?", [id, user.id]);
    return { success: true };
  });

export const sendBulkWAServerFn = createServerFn({ method: "POST" })
  .validator((data: {
    numbers: string[];
    message: string;
    minDelay: number;
    maxDelay: number;
  }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const formattedMessages = data.numbers.map((num) => ({
      recipientId: crypto.randomUUID(),
      phone: num,
      body: data.message
    }));

    await enqueueWABulk(user.id, null, formattedMessages, data.minDelay, data.maxDelay);
    return { success: true, count: formattedMessages.length };
  });

export const getWACampaignStatsServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const totalCampaignsResult = await queryOne<any>(
      "SELECT COUNT(*) as count FROM WACampaign WHERE tenantId = ?", [user.id]
    );
    const totalSentResult = await queryOne<any>(
      "SELECT SUM(sentCount) as sent, SUM(failedCount) as failed FROM WACampaign WHERE tenantId = ?", [user.id]
    );
    const activeRulesResult = await queryOne<any>(
      "SELECT COUNT(*) as count FROM WAAutoReply WHERE tenantId = ? AND isActive = 1", [user.id]
    );

    return {
      totalCampaigns: totalCampaignsResult?.count || totalCampaignsResult?.COUNT || 0,
      totalSent: totalSentResult?.sent || totalSentResult?.SENT || 0,
      totalFailed: totalSentResult?.failed || totalSentResult?.FAILED || 0,
      activeAutoReplies: activeRulesResult?.count || activeRulesResult?.COUNT || 0,
    };
  });

export const uploadWATemplateHeaderImageServerFn = createServerFn({ method: "POST" })
  .validator((data: { base64: string }) => {
    if (!data.base64) throw new Error("No image data provided");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const cloudinary = await import("cloudinary");
    const cloud = cloudinary.v2;
    cloud.config({
      cloud_name: process.env["CLOUDINARY_CLOUD_NAME"],
      api_key: process.env["CLOUDINARY_API_KEY"],
      api_secret: process.env["CLOUDINARY_API_SECRET"],
    });

    const result = await cloud.uploader.upload(data.base64, {
      folder: `mediflow/whatsapp_templates/${user.id}`,
      overwrite: true,
    });

    return { success: true, url: result.secure_url };
  });
