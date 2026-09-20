// SESI MOBILE — access token pendek + refresh token yang dirotasi.
//
// Kenapa terpisah dari JWT web 7 hari (middleware/auth.js "sesi geser"):
//   • token web tidak bisa dicabut dan otomatis diperpanjang tiap request;
//   • aplikasi keuangan di HP yang bisa hilang butuh umur token pendek dan
//     pencabutan instan.
// Access token tetap JWT dengan payload yang SAMA dengan token web
// ({id,name,role,roles}) ditambah `typ:"mobile"` dan `sid`, sehingga seluruh
// requirePermission/hasPermission existing bekerja tanpa diubah.

import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_IDLE_DAYS = 14;
export const ABSOLUTE_DAYS = 60;
export const MAX_SESSIONS_PER_USER = 2;

const DAY_MS = 24 * 3600 * 1000;

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function newRefreshToken() {
  return `smr_${randomBytes(32).toString("base64url")}`;
}

export function signAccessToken(user, roles, sessionId) {
  return jwt.sign(
    { id: user.id, name: user.name, role: user.role, roles, typ: "mobile", sid: sessionId },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TTL_SECONDS }
  );
}

function cleanDevice(device = {}) {
  const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return {
    deviceId: str(device.id, 128),
    deviceLabel: str(device.label, 120),
    platform: str(device.platform, 20) || "android",
    appVersion: str(device.appVersion, 40),
  };
}

export function parseDevice(device) {
  return cleanDevice(device);
}

/** Cabut satu sesi + hapus token push perangkatnya. Idempoten. */
export async function revokeSession(db, sessionId, reason = "logout") {
  const res = await db.mobileSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await db.mobileDeviceToken.deleteMany({ where: { sessionId } });
  return res.count;
}

export async function revokeAllForUser(db, userId, reason = "revoked") {
  const sessions = await db.mobileSession.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
  for (const s of sessions) await revokeSession(db, s.id, reason);
  return sessions.length;
}

/**
 * Buat sesi baru. Sesi lama pada perangkat yang sama diganti; jumlah sesi
 * aktif dibatasi MAX_SESSIONS_PER_USER (yang paling lama tidak dipakai dicabut).
 */
export async function createSession(db, { user, roles, device }) {
  const d = cleanDevice(device);
  if (!d.deviceId) {
    throw Object.assign(new Error("ID perangkat wajib dikirim"), { statusCode: 400 });
  }
  const now = new Date();

  const aktif = await db.mobileSession.findMany({
    where: { userId: user.id, revokedAt: null, absoluteExpiresAt: { gt: now } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, deviceId: true },
  });
  const sisa = [];
  for (const s of aktif) {
    if (s.deviceId === d.deviceId) await revokeSession(db, s.id, "diganti_login_baru");
    else sisa.push(s);
  }
  // Setelah sesi baru masuk, total ≤ MAX → yang boleh tersisa MAX-1 lama.
  for (const s of sisa.slice(MAX_SESSIONS_PER_USER - 1)) await revokeSession(db, s.id, "melebihi_batas_perangkat");

  const refreshToken = newRefreshToken();
  const session = await db.mobileSession.create({
    data: {
      userId: user.id,
      deviceId: d.deviceId,
      deviceLabel: d.deviceLabel,
      platform: d.platform,
      appVersion: d.appVersion,
      refreshTokenHash: hashToken(refreshToken),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_IDLE_DAYS * DAY_MS),
      absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_DAYS * DAY_MS),
    },
  });
  return { session, refreshToken };
}

/**
 * Tukar refresh token dengan pasangan baru (ROTASI). Hasil:
 *   { ok:true, session, refreshToken, user }
 *   { ok:false, reason: "invalid" | "reuse" | "revoked" | "expired" | "inactive" }
 * "reuse" = token yang SUDAH diganti dipakai lagi → sesi dicabut seluruhnya.
 */
export async function rotateSession(db, presentedToken, { appVersion = null } = {}) {
  if (!presentedToken || typeof presentedToken !== "string") return { ok: false, reason: "invalid" };
  const hash = hashToken(presentedToken);
  const now = new Date();

  const session = await db.mobileSession.findUnique({
    where: { refreshTokenHash: hash },
    include: { user: { select: { id: true, name: true, role: true, active: true } } },
  });

  if (!session) {
    const lama = await db.mobileSession.findFirst({ where: { prevRefreshTokenHash: hash }, select: { id: true, revokedAt: true } });
    if (lama) {
      if (!lama.revokedAt) await revokeSession(db, lama.id, "refresh_token_dipakai_ulang");
      return { ok: false, reason: "reuse" };
    }
    return { ok: false, reason: "invalid" };
  }

  if (session.revokedAt) return { ok: false, reason: "revoked" };
  if (session.user.active === false) {
    await revokeSession(db, session.id, "akun_dinonaktifkan");
    return { ok: false, reason: "inactive" };
  }
  if (session.refreshExpiresAt <= now || session.absoluteExpiresAt <= now) {
    await revokeSession(db, session.id, "kedaluwarsa");
    return { ok: false, reason: "expired" };
  }

  const refreshToken = newRefreshToken();
  // Update kondisional pada hash lama: dua refresh paralel dengan token yang
  // sama tidak boleh sama-sama menang.
  const idleBaru = new Date(Math.min(now.getTime() + REFRESH_IDLE_DAYS * DAY_MS, session.absoluteExpiresAt.getTime()));
  const upd = await db.mobileSession.updateMany({
    where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
    data: {
      prevRefreshTokenHash: hash,
      refreshTokenHash: hashToken(refreshToken),
      lastSeenAt: now,
      refreshExpiresAt: idleBaru,
      ...(appVersion ? { appVersion: String(appVersion).slice(0, 40) } : {}),
    },
  });
  if (upd.count !== 1) return { ok: false, reason: "invalid" };

  return { ok: true, session, refreshToken, user: session.user };
}


/**
 * Sesi + peran TERKINI pengguna, dibaca dari DB pada setiap request bertoken mobile. Izin TIDAK dipercaya dari JWT (yang membeku selama
 * 15 menit): mencabut peran/menonaktifkan akun harus langsung berlaku pada keputusan keuangan berikutnya, bukan menunggu token kedaluwarsa.
 */
export async function sesiMobileTerkini(db, sessionId) {
  const tak = { aktif: false, role: null, roles: [] };
  if (!sessionId) return tak;
  const s = await db.mobileSession.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, absoluteExpiresAt: true, user: { select: { active: true, role: true, roles: { select: { role: true } } } } },
  });
  if (!s || s.revokedAt || s.absoluteExpiresAt <= new Date() || !s.user || s.user.active === false) return tak;
  const roles = s.user.roles.map((r) => r.role);
  return { aktif: true, role: s.user.role, roles: roles.length > 0 ? roles : [s.user.role] };
}
/** Dipakai requireAuth pada setiap request bertoken mobile: sesi masih sah? */
export async function isMobileSessionActive(db, sessionId) {
  if (!sessionId) return false;
  const s = await db.mobileSession.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, absoluteExpiresAt: true, user: { select: { active: true } } },
  });
  if (!s || s.revokedAt) return false;
  if (s.absoluteExpiresAt <= new Date()) return false;
  if (s.user?.active === false) return false;
  return true;
}
