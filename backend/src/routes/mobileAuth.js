// AUTH & PERANGKAT MOBILE — Finance Android (S0, 19 September 2026).
//
// Di-mount di /api/mobile. Sesi web (/api/auth/login, JWT 7 hari) TIDAK
// disentuh; aplikasi mobile memakai jalur ini:
//   POST   /api/mobile/auth/login            email+password+perangkat → access(15 mnt)+refresh
//   POST   /api/mobile/auth/refresh          rotasi refresh token
//   POST   /api/mobile/auth/logout           cabut sesi (idempoten)
//   GET    /api/mobile/auth/sessions         daftar sesi/perangkat milik sendiri
//   DELETE /api/mobile/auth/sessions/:id     keluarkan satu perangkat
//   POST   /api/mobile/auth/sessions/revoke-user   (USER_MANAGE) cabut semua sesi satu pengguna
//   POST   /api/mobile/devices               daftar token push (FCM/Expo) perangkat ini
//   DELETE /api/mobile/devices/:deviceId     hapus token push perangkat
//   POST   /api/mobile/me/avatar             ganti foto profil sendiri (sama dengan SANSS Hub; multipart field "file")
//   GET|PUT /api/mobile/notification-prefs   preferensi notifikasi per kategori (S11)
//   GET    /api/mobile/config                versi minimum/maintenance (publik)
//
// Detail desain & keputusan: docs/FINANCE-MOBILE-BACKEND.md, PRD §11 & §17.

import express from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { requireAuth, authenticateBearer } from "../middleware/auth.js";
import { hasPermission, portalsFor } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { capabilitiesFor } from "../services/capabilities.js";
import { loadRoles, gerbangLogin } from "./auth.js";
import { avatarUpload, processAvatarUpload } from "./users.js";
import { createLimiter, clientIp } from "../lib/rateLimit.js";
import { fcmConfigured } from "../services/fcmTransport.js";
import { KATEGORI_NOTIF, bacaPreferensi, financePushEnabled } from "../services/financeNotifications.js";
import {
  ACCESS_TTL_SECONDS, createSession, rotateSession, revokeSession, revokeAllForUser,
  signAccessToken, hashToken, parseDevice,
} from "../services/mobileSession.js";

export const mobileRouter = express.Router();

const refreshLimiter = createLimiter({
  windowMs: 60_000,
  max: 60,
  keyFn: (req) => `mobile-refresh:${clientIp(req)}`,
  message: "Terlalu banyak permintaan. Coba lagi sebentar lagi.",
});

function fail(res, status, error, code) {
  return res.status(status).json({ error, ...(code ? { code } : {}) });
}

function userPayload(user, roles) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    roles,
    avatarUrl: user.avatarUrl ?? null,
    portals: portalsFor({ roles }),
  };
}

function tokenResponse({ user, roles, session, refreshToken }) {
  const caps = capabilitiesFor({ roles, role: user.role });
  const now = Date.now();
  return {
    tokenType: "Bearer",
    accessToken: signAccessToken(user, roles, session.id),
    expiresIn: ACCESS_TTL_SECONDS,
    accessTokenExpiresAt: new Date(now + ACCESS_TTL_SECONDS * 1000).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: (session.refreshExpiresAt instanceof Date ? session.refreshExpiresAt : new Date(session.refreshExpiresAt)).toISOString(),
    session: { id: session.id, deviceId: session.deviceId },
    user: userPayload(user, roles),
    capabilities: caps,
  };
}

// ─── LOGIN ────────────────────────────────────────────────────────────────
mobileRouter.post("/auth/login", async (req, res) => {
  try {
    const { email, password, device } = req.body || {};
    if (!email || !password) return fail(res, 400, "Email dan password wajib diisi");

    const gerbang = gerbangLogin(req, res, email);
    if (!gerbang) return;

    const user = await prisma.user.findUnique({ where: { email: String(email).trim() } });
    if (!user) { gerbang.gagal(); return fail(res, 401, "Email atau password salah"); }
    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) { gerbang.gagal(); return fail(res, 401, "Email atau password salah"); }
    if (user.active === false) return fail(res, 403, "Akun ini sudah dinonaktifkan. Hubungi admin kalau ini keliru.");

    const roles = await loadRoles(user);
    const caps = capabilitiesFor({ roles, role: user.role });
    if (!caps.financeApp) {
      return fail(res, 403, "Aplikasi ini untuk tim Finance. Akun Anda tidak punya akses Finance.", "NOT_FINANCE_TEAM");
    }

    const parsed = parseDevice(device);
    if (!parsed.deviceId) return fail(res, 400, "ID perangkat wajib dikirim");

    const { session, refreshToken } = await createSession(prisma, { user, roles, device });
    gerbang.berhasil();
    res.json(tokenResponse({ user, roles, session, refreshToken }));
  } catch (err) {
    if (err?.statusCode) return fail(res, err.statusCode, err.message);
    console.error("[mobileAuth] login:", err);
    fail(res, 500, "Terjadi kesalahan di server");
  }
});

// ─── REFRESH (ROTASI) ─────────────────────────────────────────────────────
const PESAN_REFRESH = {
  invalid: ["Sesi tidak valid, silakan login ulang", "REFRESH_INVALID"],
  reuse: ["Sesi dicabut karena token dipakai ulang. Silakan login ulang.", "REFRESH_REUSED"],
  revoked: ["Sesi sudah dicabut, silakan login ulang", "SESSION_REVOKED"],
  expired: ["Sesi sudah berakhir, silakan login ulang", "SESSION_EXPIRED"],
  inactive: ["Akun ini sudah dinonaktifkan. Hubungi admin kalau ini keliru.", "ACCOUNT_INACTIVE"],
};

mobileRouter.post("/auth/refresh", refreshLimiter, async (req, res) => {
  try {
    const { refreshToken, device } = req.body || {};
    const hasil = await rotateSession(prisma, refreshToken, { appVersion: device?.appVersion });
    if (!hasil.ok) {
      const [msg, code] = PESAN_REFRESH[hasil.reason] || PESAN_REFRESH.invalid;
      return fail(res, 401, msg, code);
    }
    // Role dibaca ULANG dari database tiap refresh: perubahan peran berlaku
    // paling lambat 15 menit (umur access token).
    const roles = await loadRoles(hasil.user);
    const caps = capabilitiesFor({ roles, role: hasil.user.role });
    if (!caps.financeApp) {
      await revokeSession(prisma, hasil.session.id, "tidak_lagi_tim_finance");
      return fail(res, 403, "Akun Anda tidak lagi punya akses Finance.", "NOT_FINANCE_TEAM");
    }
    const sessionBaru = await prisma.mobileSession.findUnique({ where: { id: hasil.session.id } });
    res.json(tokenResponse({ user: hasil.user, roles, session: sessionBaru, refreshToken: hasil.refreshToken }));
  } catch (err) {
    console.error("[mobileAuth] refresh:", err);
    fail(res, 500, "Terjadi kesalahan di server");
  }
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────
// Selalu 200: klien yang token aksesnya sudah kedaluwarsa tetap bisa keluar
// dengan mengirim refresh token-nya.
mobileRouter.post("/auth/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (refreshToken) {
      const hash = hashToken(refreshToken);
      const s = await prisma.mobileSession.findFirst({
        where: { OR: [{ refreshTokenHash: hash }, { prevRefreshTokenHash: hash }] },
        select: { id: true },
      });
      if (s) await revokeSession(prisma, s.id, "logout");
    } else {
      const user = await authenticateBearer(req);
      if (user?.sid) await revokeSession(prisma, user.sid, "logout");
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[mobileAuth] logout:", err);
    fail(res, 500, "Terjadi kesalahan di server");
  }
});

// ─── SESI / PERANGKAT ─────────────────────────────────────────────────────
mobileRouter.get("/auth/sessions", requireAuth, async (req, res) => {
  try {
    const sessions = await prisma.mobileSession.findMany({
      where: { userId: req.user.id, revokedAt: null, absoluteExpiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, deviceId: true, deviceLabel: true, platform: true, appVersion: true, createdAt: true, lastSeenAt: true },
    });
    res.json({ sessions: sessions.map((s) => ({ ...s, current: s.id === req.user.sid })) });
  } catch (err) {
    console.error("[mobileAuth] sessions:", err);
    fail(res, 500, "Terjadi kesalahan di server");
  }
});

mobileRouter.delete("/auth/sessions/:id", requireAuth, async (req, res) => {
  try {
    const s = await prisma.mobileSession.findFirst({ where: { id: req.params.id, userId: req.user.id, revokedAt: null }, select: { id: true } });
    if (!s) return fail(res, 404, "Sesi tidak ditemukan");
    await revokeSession(prisma, s.id, "dikeluarkan_pengguna");
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === "P2023") return fail(res, 404, "Sesi tidak ditemukan"); // id bukan UUID
    console.error("[mobileAuth] revoke session:", err);
    fail(res, 500, "Terjadi kesalahan di server");
  }
});

// Admin: cabut semua sesi mobile seorang pengguna (HP hilang / karyawan resign).
mobileRouter.post("/auth/sessions/revoke-user", requireAuth, async (req, res) => {
  try {
    if (!hasPermission(req.user, P.USER_MANAGE)) return fail(res, 403, "Anda tidak punya akses untuk aksi ini");
    const { userId } = req.body || {};
    if (!userId) return fail(res, 400, "userId wajib diisi");
    const jumlah = await revokeAllForUser(prisma, String(userId), "dicabut_admin");
    res.json({ ok: true, dicabut: jumlah });
  } catch (err) {
    console.error("[mobileAuth] revoke-user:", err);
    fail(res, 500, "Terjadi kesalahan di server");
  }
});

// ─── TOKEN PUSH PERANGKAT ─────────────────────────────────────────────────
const POLA_EXPO = /^Expo(nent)?PushToken\[[^\]]+\]$/;

mobileRouter.post("/devices", requireAuth, async (req, res) => {
  try {
    if (!req.mobileSessionId) return fail(res, 403, "Hanya sesi aplikasi mobile yang bisa mendaftarkan perangkat");
    const { deviceId, token, provider = "fcm", platform = "android", appVersion } = req.body || {};
    if (!deviceId || !token) return fail(res, 400, "deviceId dan token wajib diisi");
    if (!["fcm", "expo"].includes(provider)) return fail(res, 400, "provider harus fcm atau expo");
    const tokenStr = String(token).trim();
    if (provider === "expo" ? !POLA_EXPO.test(tokenStr) : tokenStr.length < 20 || tokenStr.length > 4096) {
      return fail(res, 400, "Token push tidak valid");
    }

    const session = await prisma.mobileSession.findUnique({ where: { id: req.mobileSessionId }, select: { deviceId: true } });
    if (!session || session.deviceId !== String(deviceId)) {
      return fail(res, 400, "deviceId tidak sama dengan perangkat sesi ini");
    }

    await prisma.$transaction(async (tx) => {
      // Token yang sama tidak boleh dimiliki dua baris (HP dipindah tangan).
      await tx.mobileDeviceToken.deleteMany({
        where: { fcmToken: tokenStr, NOT: { userId: req.user.id, deviceId: String(deviceId) } },
      });
      await tx.mobileDeviceToken.upsert({
        where: { userId_deviceId: { userId: req.user.id, deviceId: String(deviceId) } },
        create: {
          userId: req.user.id, sessionId: req.mobileSessionId, deviceId: String(deviceId),
          platform: String(platform).slice(0, 20), provider, fcmToken: tokenStr,
          appVersion: appVersion ? String(appVersion).slice(0, 40) : null,
        },
        update: {
          sessionId: req.mobileSessionId, platform: String(platform).slice(0, 20), provider, fcmToken: tokenStr,
          appVersion: appVersion ? String(appVersion).slice(0, 40) : null,
        },
      });
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[mobileAuth] register device:", err);
    fail(res, 500, "Terjadi kesalahan di server");
  }
});

mobileRouter.delete("/devices/:deviceId", requireAuth, async (req, res) => {
  try {
    const r = await prisma.mobileDeviceToken.deleteMany({ where: { userId: req.user.id, deviceId: req.params.deviceId } });
    res.json({ ok: true, dihapus: r.count });
  } catch (err) {
    console.error("[mobileAuth] unregister device:", err);
    fail(res, 500, "Terjadi kesalahan di server");
  }
});

// ─── FOTO PROFIL ──────────────────────────────────────────────────────────
// Foto = kolom User.avatarUrl yang SAMA dengan SANSS Hub (web/app lain), jadi mengganti di sini otomatis berlaku di sana dan sebaliknya.
// Token mobile tidak boleh menjangkau /api/users/* (hak akses minimum), maka jalurnya lewat /api/mobile. Hanya foto DIRI SENDIRI.
const avatarLimiter = createLimiter({
  windowMs: 60_000,
  max: 10,
  keyFn: (req) => (req.user?.id ? `mobile-avatar:${req.user.id}` : null),
  message: "Terlalu banyak penggantian foto. Coba lagi sebentar lagi.",
});
mobileRouter.post("/me/avatar", requireAuth, avatarLimiter, (req, res, next) => {
  avatarUpload.single("file")(req, res, (err) => {
    if (err) return fail(res, 400, err.code === "LIMIT_FILE_SIZE" ? "Foto terlalu besar (maksimal 8 MB)" : "Hanya file gambar yang diperbolehkan");
    next();
  });
}, async (req, res) => {
  try {
    if (!req.mobileSessionId) return fail(res, 403, "Hanya sesi aplikasi mobile yang bisa mengganti foto dari sini");
    if (!req.file) return fail(res, 400, "File foto wajib diisi");
    const u = await processAvatarUpload(req.user.id, req.file.buffer);
    res.json({ ok: true, avatarUrl: u.avatarUrl });
  } catch (err) {
    console.error("[mobileAuth] avatar:", err.message);
    fail(res, 500, "Foto tidak bisa diproses. Coba foto lain.");
  }
});

// ─── PREFERENSI NOTIFIKASI (S11) ─────────────────────────────────────────
mobileRouter.get("/notification-prefs", requireAuth, async (req, res) => {
  try {
    res.json({ categories: await bacaPreferensi(prisma, req.user.id), pushEnabled: financePushEnabled(), fcmConfigured: fcmConfigured() });
  } catch (err) {
    console.error("[mobileAuth] prefs get:", err);
    fail(res, 500, "Terjadi kesalahan di server");
  }
});

mobileRouter.put("/notification-prefs", requireAuth, async (req, res) => {
  try {
    const masuk = req.body?.categories;
    if (!masuk || typeof masuk !== "object" || Array.isArray(masuk)) return fail(res, 400, "categories wajib berupa objek");
    const bersih = {};
    for (const [k, v] of Object.entries(masuk)) {
      if (!KATEGORI_NOTIF.includes(k)) return fail(res, 400, `Kategori tidak dikenal: ${String(k).slice(0, 30)}`);
      if (typeof v !== "boolean") return fail(res, 400, "Nilai kategori harus true/false");
      bersih[k] = v;
    }
    const sekarang = await bacaPreferensi(prisma, req.user.id);
    const categories = { ...sekarang, ...bersih };
    await prisma.mobileNotificationPref.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, categories }, update: { categories } });
    res.json({ categories, pushEnabled: financePushEnabled(), fcmConfigured: fcmConfigured() });
  } catch (err) {
    console.error("[mobileAuth] prefs put:", err);
    fail(res, 500, "Terjadi kesalahan di server");
  }
});

// ─── KONFIGURASI PUBLIK ───────────────────────────────────────────────────
mobileRouter.get("/config", (req, res) => {
  const int = (v, d = 0) => (Number.isFinite(Number(v)) && v !== undefined && v !== "" ? Number(v) : d);
  res.json({
    minVersionCode: int(process.env.MOBILE_FINANCE_MIN_VERSION_CODE, 0),
    latestVersionCode: int(process.env.MOBILE_FINANCE_LATEST_VERSION_CODE, 0),
    updateUrl: process.env.MOBILE_FINANCE_UPDATE_URL || null,
    maintenance: {
      active: process.env.MOBILE_MAINTENANCE === "true",
      message: process.env.MOBILE_MAINTENANCE_MESSAGE || "Sedang ada pemeliharaan. Coba lagi beberapa saat lagi.",
    },
    fcmConfigured: fcmConfigured(),
    serverTime: new Date().toISOString(),
  });
});
