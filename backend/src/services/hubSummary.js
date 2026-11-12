// Main Hub — ringkasan Task & Meeting (Okt 2026). Kontrak: HUB tetap SATU-
// SATUNYA sumber data task/meeting (tidak ada duplikasi ke SANSS); SANSS
// hanya MEMBACA ringkasan lewat API privat server-ke-server HUB
// (POST {HUB_INTERNAL_URL}/api/sso/summary), dan token layanan TIDAK PERNAH
// dikirim ke browser.
//
// PRINSIP KEAMANAN (sama seperti services/hubSso.js):
//  1. Status aktif & izin SELALU dibaca ulang dari DB di sini — klaim di JWT
//     (req.user) hanya dipakai untuk tahu SIAPA (userId), tidak pernah untuk
//     BOLEH APA. Ini BERBEDA dari middleware/authorize.js#requirePermission
//     yang dipakai route lain (mempercayai req.user.roles dari JWT) — route
//     ini sengaja TIDAK memakai requirePermission untuk alasan itu.
//  2. "Leader" = penandaan yang SUDAH ADA dan terbukti (UserDivision.isLeader,
//     dipakai sejak C2.1 untuk Laporan Divisi RINCI) — BUKAN tebakan baru,
//     dan BUKAN "semua user dianggap leader". Admin/Owner menetapkannya
//     secara eksplisit lewat Pengguna & Divisi (0 baris sampai ditetapkan).
//  3. Pantauan lintas leader HANYA untuk pemegang HUB_LEADER_MONITOR
//     (Owner-only di tahap ini, lihat constants/permissions.js). "Tugas
//     Saya"/"Hasil Meeting" (ringkasan MILIK SENDIRI) cukup HUB_ACCESS yang
//     sudah ada — itu TIDAK membuka data siapa pun selain pemiliknya.
//  4. Filter dari browser (mis. ?division=) HANYA BOLEH MEMPERSEMPIT set yang
//     sudah dihitung dari DB di sini — tidak pernah memperluasnya.

import { prisma } from "../db.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { hubRoleFor, hubSsoConfig } from "../lib/domain/hubSso.js";
import { canMonitorLeaders, MAX_LEADERS_PER_CALL, normalizeDivisionFilter } from "../lib/domain/hubSummary.js";

const ENTITY = ENTITY_TYPES.HUB_SSO;
const SUMMARY_TIMEOUT_MS = 8000;

function audit(db, { eventType, entityId, actorId = null, metadata = {} }) {
  return recordActivity(db, { entityType: ENTITY, entityId, eventType, actorId, actorType: "USER", metadata });
}

/** Peran SEKARANG (pola sama dengan readIdentity di services/hubSso.js) — dibaca ulang dari DB, bukan dari JWT. */
async function readFreshUser(db, userId) {
  if (typeof userId !== "string" || !userId) return null;
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, active: true } });
  if (!user) return null;
  const rows = await db.userRole.findMany({ where: { userId: user.id }, select: { role: true } });
  const roles = rows.length > 0 ? rows.map((r) => r.role) : [user.role];
  return { user, roles };
}

async function callHubSummary(subs) {
  const config = hubSsoConfig();
  if (!config.ready) return { ok: false, reason: "not_ready" };
  try {
    const res = await fetch(`${config.hubInternalUrl}/api/sso/summary`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-service-token": config.serviceToken },
      body: JSON.stringify({ subs }),
      redirect: "error",
      signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
    });
    if (res.status !== 200) return { ok: false, reason: "http", status: res.status };
    const body = await res.json().catch(() => null);
    if (!body || !Array.isArray(body.results)) return { ok: false, reason: "malformed" };
    return { ok: true, results: body.results };
  } catch (err) {
    return { ok: false, reason: "unreachable", error: err?.name || "error" };
  }
}

const EMPTY_SUMMARY = Object.freeze({ tasks: { total: 0, overdueCount: 0, items: [] }, meetings: { items: [] } });

/**
 * "Tugas Saya" / "Hasil Meeting" di Main Hub — ringkasan MILIK SENDIRI.
 * @returns {Promise<{ok:true, connected:boolean, summary:object}
 *   | {ok:false, reason:"unavailable"|"no_permission"|"user_inactive"}>}
 */
export async function getOwnSummary({ userId }, db = prisma) {
  const identity = await readFreshUser(db, userId);
  if (!identity || identity.user.active === false) return { ok: false, reason: "user_inactive" };
  if (!hubRoleFor({ roles: identity.roles })) return { ok: false, reason: "no_permission" };

  const config = hubSsoConfig();
  if (!config.ready) return { ok: false, reason: "unavailable" };

  const result = await callHubSummary([userId]);
  if (!result.ok) return { ok: false, reason: "unavailable" };
  const own = result.results.find((r) => r.sub === userId);
  return { ok: true, connected: !!own, summary: own ? { tasks: own.tasks, meetings: own.meetings } : EMPTY_SUMMARY };
}

/**
 * "Pantauan Leader" — ringkasan LINTAS leader/divisi. Owner-only (tahap ini)
 * lewat HUB_LEADER_MONITOR. `divisionFilter`, kalau diisi, HANYA MEMPERSEMPIT
 * set leader yang sudah dihitung dari DB — nilai tak dikenal diabaikan
 * (tidak pernah memperluas ke "semua divisi").
 * @returns {Promise<{ok:true, leaders:object[]}
 *   | {ok:false, reason:"unavailable"|"no_permission"|"user_inactive"}>}
 */
export async function getLeaderMonitorSummary({ userId, divisionFilter, ip = null }, db = prisma) {
  const identity = await readFreshUser(db, userId);
  if (!identity || identity.user.active === false) {
    await audit(db, { eventType: EVENT_TYPES.HUB_SUMMARY_DENIED, entityId: userId ?? "unknown", actorId: userId, metadata: { reason: "user_inactive", ip } });
    return { ok: false, reason: "user_inactive" };
  }
  // Dibangun dari peran yang BARU DIBACA dari DB (identity.roles), BUKAN
  // req.user — persis titik yang dulu bisa dipakai memperluas akses lewat
  // klaim JWT kedaluwarsa kalau peran ini dicek dari sana.
  if (!canMonitorLeaders({ roles: identity.roles })) {
    await audit(db, { eventType: EVENT_TYPES.HUB_SUMMARY_DENIED, entityId: userId, actorId: userId, metadata: { reason: "no_permission", ip } });
    return { ok: false, reason: "no_permission" };
  }

  const config = hubSsoConfig();
  if (!config.ready) {
    await audit(db, { eventType: EVENT_TYPES.HUB_SUMMARY_DENIED, entityId: userId, actorId: userId, metadata: { reason: "hub_not_ready", ip } });
    return { ok: false, reason: "unavailable" };
  }

  const division = normalizeDivisionFilter(divisionFilter);
  const leaderRows = await db.userDivision.findMany({
    where: { isLeader: true, ...(division ? { division } : {}) },
    select: { userId: true, division: true, user: { select: { id: true, name: true, email: true, active: true } } },
  });

  // Satu orang bisa jadi leader di lebih dari satu divisi — gabungkan baris
  // yang sama userId-nya jadi satu entri dengan daftar divisi, sebelum
  // dipotong ke batas panggilan HUB (urut nama supaya tampilan stabil).
  const byUser = new Map();
  for (const row of leaderRows) {
    if (row.user.active === false) continue; // staf nonaktif tidak tampil sebagai leader dipantau
    const existing = byUser.get(row.userId);
    if (existing) existing.divisions.push(row.division);
    else byUser.set(row.userId, { userId: row.userId, name: row.user.name, email: row.user.email, divisions: [row.division] });
  }
  const leaders = [...byUser.values()].sort((a, b) => (a.name || "").localeCompare(b.name || "")).slice(0, MAX_LEADERS_PER_CALL);

  if (leaders.length === 0) {
    await audit(db, { eventType: EVENT_TYPES.HUB_SUMMARY_LEADER_VIEWED, entityId: userId, actorId: userId, metadata: { leaderCount: 0, division, ip } });
    return { ok: true, leaders: [] };
  }

  const result = await callHubSummary(leaders.map((l) => l.userId));
  const bySub = result.ok ? new Map(result.results.map((r) => [r.sub, r])) : new Map();

  const shaped = leaders.map((l) => {
    const hub = bySub.get(l.userId);
    return {
      userId: l.userId,
      name: l.name,
      divisions: l.divisions,
      connected: !!hub,
      summary: hub ? { tasks: hub.tasks, meetings: hub.meetings } : EMPTY_SUMMARY,
    };
  });

  await audit(db, { eventType: EVENT_TYPES.HUB_SUMMARY_LEADER_VIEWED, entityId: userId, actorId: userId, metadata: { leaderCount: shaped.length, division, hubReachable: result.ok, ip } });
  return { ok: true, leaders: shaped };
}
