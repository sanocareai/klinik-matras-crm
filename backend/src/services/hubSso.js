// SSO Task & Meeting (D-200) — inti yang menyentuh database. Aturan murni ada
// di lib/domain/hubSso.js; kontrak lengkap di docs/HUB-SSO.md.
//
// PRINSIP YANG DIJAGA DI SINI
//  1. Pengguna, peran, dan status aktif SELALU dibaca ulang dari DB — klaim di
//     JWT hanya dipakai untuk tahu "siapa", tidak pernah untuk "boleh apa".
//  2. Kode dipakai SEKALI, atomik: UPDATE bersyarat (used_at IS NULL, belum
//     dicabut, belum kedaluwarsa) — dua penukar serentak, satu menang.
//  3. Klaim kode terjadi SEBELUM pengecekan pengguna, di transaksi yang sama:
//     kode yang gagal karena pengguna nonaktif/tanpa izin tetap HANGUS.
//  4. Audit ditulis untuk sukses DAN penolakan, tanpa pernah memuat kode
//     mentah atau token layanan (hanya id handoff atau 16 karakter pertama
//     hash-nya).

import { prisma } from "../db.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { portalsFor } from "../middleware/authorize.js";
import {
  HANDOFF_RETENTION_MS,
  HANDOFF_TTL_SECONDS,
  hashHandoffCode,
  hubRoleFor,
  hubSsoConfig,
  isWellFormedCode,
  isWellFormedStateHash,
  newHandoffCode,
  normalizeRevokeReason,
  resolveDestination,
} from "../lib/domain/hubSso.js";

const ENTITY = ENTITY_TYPES.HUB_SSO;
const SERVICE_ENTITY_ID = "hub-service";
/** Introspeksi berhasil dicatat paling banyak sekali per pengguna per jendela ini (penolakan: selalu). */
const INTROSPECT_AUDIT_EVERY_MS = 5 * 60_000;
const lastIntrospectAudit = new Map();

/** Peran yang berlaku SEKARANG — pola sama dengan loadRoles() di routes/auth.js (tabel user_roles, D-010). */
async function readIdentity(db, userId) {
  if (typeof userId !== "string" || !userId || userId.length > 64) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user) return null;
  const rows = await db.userRole.findMany({ where: { userId: user.id }, select: { role: true } });
  const roles = rows.length > 0 ? rows.map((r) => r.role) : [user.role];
  return { user, roles, hubRole: hubRoleFor({ roles, role: user.role }) };
}

function audit(db, { eventType, entityId, actorId = null, actorType = "USER", metadata = {} }) {
  return recordActivity(db, { entityType: ENTITY, entityId, eventType, actorId, actorType, metadata });
}

const clip = (v, n = 80) => (v === undefined || v === null ? null : String(v).slice(0, n));

// ─── 1. Penerbitan (pengguna login → kode) ──────────────────────────────────

/**
 * @param {{ userId: string, next?: string, stateHash: string, ip?: string|null }} args
 *   `stateHash` WAJIB — SHA-256(state) heksadesimal yang HUB buat di
 *   GET /sso/start dan simpan HttpOnly di browser pengguna (D-200 tahap 4).
 *   Dikembalikan apa adanya saat /internal/exchange supaya HUB bisa
 *   membandingkannya dengan hash cookie-nya sendiri sebelum membuat sesi.
 * @returns {Promise<{ok:true, code:string, id:string, destination:string, expiresAt:Date}
 *   | {ok:false, reason:"user_not_found"|"user_inactive"|"no_permission"|"destination_not_allowed"|"invalid_state"}>}
 */
export async function issueHandoff({ userId, next, stateHash, ip = null }, db = prisma) {
  const identity = await readIdentity(db, userId);
  let reason = null;
  if (!identity) reason = "user_not_found";
  else if (identity.user.active === false) reason = "user_inactive";
  else if (!identity.hubRole) reason = "no_permission";

  const destination = reason ? null : resolveDestination(next);
  if (!reason && destination === null) reason = "destination_not_allowed";
  // Dicek TERAKHIR (setelah destination) — urutan ini tidak memengaruhi
  // keamanan (semuanya menolak sebelum kode dibuat), tapi membuat pesan
  // penolakan mengikuti hal PERTAMA yang salah dari sudut pandang pemanggil.
  if (!reason && !isWellFormedStateHash(stateHash)) reason = "invalid_state";

  if (reason) {
    await audit(db, {
      eventType: EVENT_TYPES.HUB_HANDOFF_DENIED,
      entityId: identity?.user.id ?? "unknown",
      actorId: identity?.user.id ?? null,
      metadata: { reason, ip, ...(reason === "destination_not_allowed" ? { attempted: clip(next) } : {}) },
    });
    return { ok: false, reason };
  }

  const code = newHandoffCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + HANDOFF_TTL_SECONDS * 1000);

  const row = await db.$transaction(async (tx) => {
    // Satu kode hidup per pengguna: yang lama (belum terpakai) dicabut, supaya
    // jendela replay tidak menumpuk kalau tombol ditekan berulang.
    await tx.hubHandoff.updateMany({
      where: { userId: identity.user.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    const created = await tx.hubHandoff.create({
      data: { userId: identity.user.id, codeHash: hashHandoffCode(code), destination, stateHash, expiresAt },
      select: { id: true },
    });
    await audit(tx, {
      eventType: EVENT_TYPES.HUB_HANDOFF_ISSUED,
      entityId: created.id,
      actorId: identity.user.id,
      metadata: { destination, hubRole: identity.hubRole, expiresAt: expiresAt.toISOString(), ip },
    });
    return created;
  });

  // Pembersihan baris lama — upaya terbaik, tidak boleh menggagalkan penerbitan.
  db.hubHandoff
    .deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - HANDOFF_RETENTION_MS) } } })
    .catch((err) => console.error("[hubSso] pembersihan handoff lama gagal:", err.message));

  return { ok: true, code, id: row.id, destination, expiresAt };
}

// ─── 2. Pertukaran (HUB, server-ke-server: kode → identitas) ────────────────

/**
 * @returns {Promise<{ok:true, identity:object}
 *   | {ok:false, kind:"invalid"|"denied", reason:string}>}
 *   invalid = kode tidak bisa dipakai (tak dikenal/terpakai/kedaluwarsa/dicabut/cacat)
 *   denied  = kode sah tapi pemiliknya tidak (lagi) boleh — kode tetap hangus
 */
export async function exchangeHandoff({ code, ip = null }, db = prisma) {
  if (!isWellFormedCode(code)) {
    await audit(db, {
      eventType: EVENT_TYPES.HUB_HANDOFF_REJECTED,
      entityId: "unknown",
      actorType: "SERVICE",
      metadata: { reason: "malformed", ip },
    });
    return { ok: false, kind: "invalid", reason: "malformed" };
  }

  const codeHash = hashHandoffCode(code);
  const now = new Date();

  return db.$transaction(async (tx) => {
    // Klaim atomik. Predikat dievaluasi ulang oleh Postgres setelah menunggu
    // kunci baris, jadi dua penukar serentak tidak bisa sama-sama menang.
    const claimed = await tx.hubHandoff.updateMany({
      where: { codeHash, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    if (claimed.count !== 1) {
      const row = await tx.hubHandoff.findUnique({
        where: { codeHash },
        select: { id: true, userId: true, usedAt: true, revokedAt: true },
      });
      const reason = !row ? "unknown_code" : row.usedAt ? "replay" : row.revokedAt ? "revoked" : "expired";
      await audit(tx, {
        eventType: EVENT_TYPES.HUB_HANDOFF_REJECTED,
        entityId: row?.id ?? codeHash.slice(0, 16),
        actorId: row?.userId ?? null,
        actorType: "SERVICE",
        metadata: { reason, ip },
      });
      return { ok: false, kind: "invalid", reason };
    }

    const row = await tx.hubHandoff.findUnique({
      where: { codeHash },
      select: { id: true, userId: true, destination: true, stateHash: true },
    });
    const identity = await readIdentity(tx, row.userId);

    let reason = null;
    if (!identity || identity.user.active === false) reason = "user_inactive";
    else if (!identity.hubRole) reason = "no_permission";
    // Tujuan divalidasi ULANG saat ditukar — barisnya bisa saja tidak lagi lolos.
    else if (resolveDestination(row.destination) === null) reason = "destination_not_allowed";

    if (reason) {
      await audit(tx, {
        eventType: EVENT_TYPES.HUB_HANDOFF_REJECTED,
        entityId: row.id,
        actorId: row.userId,
        actorType: "SERVICE",
        metadata: { reason, ip },
      });
      return { ok: false, kind: "denied", reason };
    }

    await audit(tx, {
      eventType: EVENT_TYPES.HUB_HANDOFF_EXCHANGED,
      entityId: row.id,
      actorId: row.userId,
      actorType: "SERVICE",
      metadata: { destination: row.destination, hubRole: identity.hubRole, ip },
    });
    return {
      ok: true,
      identity: {
        sub: identity.user.id,
        name: identity.user.name,
        email: identity.user.email,
        roles: identity.roles,
        hubRole: identity.hubRole,
        active: true,
        destination: row.destination,
        // Hash saja, bukan `state` asli (yang SANSS tidak pernah punya) —
        // HUB membandingkannya dengan SHA-256 cookie-nya sendiri.
        stateHash: row.stateHash,
      },
    };
  });
}

// ─── 3. Introspeksi (HUB memvalidasi ulang sesinya) ─────────────────────────

/** Selalu 200 untuk pemanggil sah: pengguna tak dikenal = { active:false }. */
export async function introspectUser({ sub, ip = null }, db = prisma) {
  const identity = await readIdentity(db, sub);
  const active = !!identity && identity.user.active !== false;
  const hubRole = active ? identity.hubRole : null;

  if (!active || !hubRole) {
    await audit(db, {
      eventType: EVENT_TYPES.HUB_INTROSPECT_DENIED,
      entityId: identity?.user.id ?? clip(sub, 64) ?? "unknown",
      actorId: identity?.user.id ?? null,
      actorType: "SERVICE",
      metadata: { reason: !identity ? "unknown_user" : !active ? "user_inactive" : "no_permission", ip },
    });
    return { sub: identity?.user.id ?? clip(sub, 64), active: false, hubRole: null, roles: [] };
  }

  const last = lastIntrospectAudit.get(identity.user.id) ?? 0;
  if (Date.now() - last >= INTROSPECT_AUDIT_EVERY_MS) {
    lastIntrospectAudit.set(identity.user.id, Date.now());
    if (lastIntrospectAudit.size > 5000) lastIntrospectAudit.clear();
    await audit(db, {
      eventType: EVENT_TYPES.HUB_INTROSPECTED,
      entityId: identity.user.id,
      actorId: identity.user.id,
      actorType: "SERVICE",
      metadata: { hubRole, ip },
    });
  }
  return {
    sub: identity.user.id,
    active: true,
    hubRole,
    roles: identity.roles,
    name: identity.user.name,
    email: identity.user.email,
  };
}

/** Hanya untuk tes: kosongkan sampling audit introspeksi. */
export function resetIntrospectAuditThrottle() {
  lastIntrospectAudit.clear();
}

// ─── 4. Pencabutan (kode yang belum terpakai milik satu pengguna) ───────────

export async function revokeHandoffs({ userId, reason, ip = null }, db = prisma) {
  const why = normalizeRevokeReason(reason);
  const now = new Date();
  const result = await db.hubHandoff.updateMany({
    where: { userId, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now },
  });
  await audit(db, {
    eventType: EVENT_TYPES.HUB_HANDOFF_REVOKED,
    entityId: clip(userId, 64) ?? "unknown",
    actorType: "SERVICE",
    metadata: { reason: why, revoked: result.count, ip },
  });
  return { revoked: result.count };
}

// ─── Audit kegagalan autentikasi layanan ────────────────────────────────────

export function auditServiceDenied({ reason, path, ip = null }, db = prisma) {
  return audit(db, {
    eventType: EVENT_TYPES.HUB_SERVICE_DENIED,
    entityId: SERVICE_ENTITY_ID,
    actorType: "SERVICE",
    metadata: { reason, path: clip(path, 120), ip },
  });
}

// ─── 5. Notifikasi KELUAR ke HUB (D-200 tahap 4) ────────────────────────────
// Arah terbalik dari semua di atas: SANSS memberi tahu HUB, bukan sebaliknya.
// Dipicu oleh logout, "nonaktifkan user", dan "cabut peran Task & Meeting".

const REVOKE_NOTIFY_TIMEOUT_MS = 5000;

/**
 * Beri tahu HUB (POST {hubInternalUrl}/api/sso/revoke, alamat PRIVAT + token
 * layanan) untuk mencabut SEMUA sesi HUB milik satu pengguna SANSS.
 *
 * SENGAJA best-effort dan TIDAK PERNAH melempar: dipanggil SETELAH mutasi
 * pemanggil sudah commit (logout tetap berhasil, user tetap dinonaktifkan)
 * walau HUB sedang mati/tidak terjangkau — HUB punya jaring pengaman sendiri
 * (introspeksi berkala ≤60 detik) untuk kasus itu. Karena itu pula fungsi ini
 * TIDAK menerima parameter `db` transaksi pemanggil: panggilan jaringan yang
 * macet di dalam transaksi database bisa menahan kunci baris untuk apa pun
 * yang menunggunya.
 *
 * @returns {Promise<{ok:boolean}>}
 */
export async function notifyHubRevoke({ sub, reason }, fetchImpl = fetch) {
  const why = normalizeRevokeReason(reason);
  const config = hubSsoConfig();
  // SSO mati atau belum dikonfigurasi lengkap → tidak ada HUB nyata untuk
  // diberi tahu. Bukan kegagalan (tidak diaudit sebagai gagal) — ini keadaan
  // normal sebelum tahap rollout SSO benar-benar dinyalakan.
  if (!config.ready) return { ok: false };

  const entityId = clip(sub, 64) ?? "unknown";
  try {
    const res = await fetchImpl(`${config.hubInternalUrl}/api/sso/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-service-token": config.serviceToken },
      body: JSON.stringify({ sub, reason: why }),
      redirect: "error", // redirect di sini berarti permintaan meninggalkan alamat privat
      signal: AbortSignal.timeout(REVOKE_NOTIFY_TIMEOUT_MS),
    });
    if (res.status === 200) {
      await audit(prisma, { eventType: EVENT_TYPES.HUB_REVOKE_NOTIFIED, entityId, actorType: "SERVICE", metadata: { reason: why } });
      return { ok: true };
    }
    console.warn(`[hubSso] HUB menolak permintaan revoke: HTTP ${res.status}`);
    await audit(prisma, {
      eventType: EVENT_TYPES.HUB_REVOKE_NOTIFY_FAILED,
      entityId,
      actorType: "SERVICE",
      metadata: { reason: why, httpStatus: res.status },
    });
    return { ok: false };
  } catch (err) {
    console.warn(`[hubSso] HUB tidak terjangkau untuk revoke (${err?.name || "error"})`);
    await audit(prisma, {
      eventType: EVENT_TYPES.HUB_REVOKE_NOTIFY_FAILED,
      entityId,
      actorType: "SERVICE",
      metadata: { reason: why, error: err?.name || "error" },
    }).catch(() => {});
    return { ok: false };
  }
}

/**
 * Sinkronisasi akses Task & Meeting setelah SATU perubahan pada pengguna:
 * dipanggil dari routes/users.js setelah `active` menjadi false, atau setelah
 * satu peran dihapus.
 *
 * `deactivated: true` selalu mencabut (tidak perlu dicek ulang — nonaktif
 * berarti nonaktif). Untuk penghapusan peran, dicek DULU apakah orang itu
 * MASIH punya hubRole (mis. mencabut role SALES dari seseorang yang juga
 * ADMIN tidak memengaruhi Task & Meeting sama sekali) — supaya perubahan
 * peran yang tidak relevan tidak memaksa logout paksa yang tidak perlu.
 * Kedua sisi (kode handoff SANSS yang belum terpakai + sesi HUB) dicabut
 * bersamaan.
 */
export async function syncHubAccessOnUserChange(userId, { deactivated = false, reason } = {}, db = prisma) {
  if (!deactivated) {
    const identity = await readIdentity(db, userId);
    const stillHasAccess = identity && identity.user.active !== false && identity.hubRole;
    if (stillHasAccess) return { ok: true, skipped: true };
  }
  const why = reason ?? (deactivated ? "deactivated" : "role_changed");
  await revokeHandoffs({ userId, reason: why }, db);
  return notifyHubRevoke({ sub: userId, reason: why });
}

// ─── Kartu portal (D-200 tahap 4) ────────────────────────────────────────────

/**
 * Entri portal "Task & Meeting" untuk landing page SANSS, atau `null` kalau
 * tidak boleh tampil. HANYA tampil kalau (a) SSO menyala DAN dikonfigurasi
 * benar, DAN (b) pengguna ini punya HUB_ACCESS — dua syarat, dicek di sini
 * (bukan lewat daftar role statis PORTALS) supaya satu-satunya tempat yang
 * memutuskan "siapa boleh Task & Meeting" tetap constants/permissions.js
 * (lihat hubRoleFor).
 *
 * `path` adalah URL LENGKAP ke origin HUB (bukan rute SPA relatif) — HUB
 * membuat state anti-CSRF di GET /sso/start, jadi masuk WAJIB dimulai dari
 * sana, tidak bisa berupa navigasi klien biasa. Frontend (Portal.jsx)
 * mendeteksi ini lewat awalan "http" dan melakukan navigasi penuh
 * (window.location), bukan React Router.
 */
export function hubPortalEntry(user) {
  const config = hubSsoConfig();
  if (!config.ready) return null;
  if (!hubRoleFor(user)) return null;
  return {
    key: "hub",
    label: "Task & Meeting",
    description: "Workspace tugas & rapat tim — identitas tetap dari SANSS.",
    path: `${config.baseUrl}/sso/start`,
  };
}

/** `portalsFor(user)` (aturan role yang sudah ada, TIDAK diubah) + kartu Task
 *  & Meeting kalau berlaku. Dipakai routes/auth.js — satu-satunya tambahan di
 *  respons portal, tidak menyentuh portalsFor/PORTALS itu sendiri. */
export function portalsWithHub(user) {
  const hub = hubPortalEntry(user);
  const portals = portalsFor(user);
  return hub ? [...portals, hub] : portals;
}
