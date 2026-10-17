// SAKLAR + LAPORAN "Admin override: Siap Kirim saat pencatatan produksi belum selesai" (16 Okt 2026, kasus RES-03102026-018-U1).
//
// SAKLAR (v2_feature_flags, key `production_admin_override_siap_kirim`) — FAIL-CLOSED: baris tidak ada / enabled=false / tabel tidak terbaca = override BARU DITOLAK.
//  - `config.unitCodes` (opsional) = daftar putih kode unit (kanari: mis. hanya unit Rika). Kosong = semua unit yang memenuhi syarat.
//  - Mematikan saklar HANYA menghentikan override BARU. Unit yang sudah dilepas TIDAK diubah, rekam audit TIDAK dihapus, penutupan administratif Run tetap berjalan, dan job/rute yang sudah terbentuk
//    ditangani lewat prosedur di docs/RUNBOOK-ADMIN-OVERRIDE-SIAP-KIRIM.md (bukan lewat rollback kode, yang ditolak guard setelah ada Run ter-override).
//  - Perubahan saklar tercatat (aktivitas PRODUCTION_SETTING_CHANGED + pelaku + alasan wajib); tanpa restart backend (dibaca dari DB tiap permintaan).
//
// LAPORAN (baca-saja): semua Run yang pernah di-override beserta unit, order, job pengiriman, rute, driver, dan TINDAKAN yang disarankan untuk tiap keadaan job.
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const ADMIN_OVERRIDE_SWITCH_KEY = "production_admin_override_siap_kirim";

function switchError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}

const rapi = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x ?? "").trim()).filter(Boolean))].sort();

/** Keadaan saklar. Fail-closed: error/tidak ada baris = nonaktif. */
export async function readAdminOverrideSwitch(db) {
  try {
    const row = await db.v2FeatureFlag.findUnique({ where: { key: ADMIN_OVERRIDE_SWITCH_KEY } });
    if (!row) return { enabled: false, unitCodes: [], reason: null, updatedAt: null, updatedById: null, configured: false };
    return { enabled: row.enabled === true, unitCodes: rapi(row.config?.unitCodes), reason: row.reason ?? null, updatedAt: row.updatedAt, updatedById: row.updatedById ?? null, configured: true };
  } catch {
    return { enabled: false, unitCodes: [], reason: "Saklar tidak terbaca (fail-closed)", updatedAt: null, updatedById: null, configured: false, unavailable: true };
  }
}

/** Lempar 409 bila override BARU tidak boleh untuk unit ini. */
export async function assertAdminOverrideAllowed(db, unitCode) {
  const sw = await readAdminOverrideSwitch(db);
  if (!sw.enabled) {
    throw switchError("Admin override Siap Kirim belum diaktifkan (atau sudah dihentikan). Hubungi Owner untuk mengaktifkannya.", 409, "ADMIN_OVERRIDE_DISABLED", { reason: sw.reason });
  }
  if (sw.unitCodes.length > 0 && !sw.unitCodes.includes(String(unitCode))) {
    throw switchError(`Admin override Siap Kirim sedang dibatasi untuk unit tertentu (${sw.unitCodes.join(", ")}); unit ${unitCode} belum termasuk.`, 409, "ADMIN_OVERRIDE_UNIT_NOT_ALLOWED", { unitCodes: sw.unitCodes });
  }
  return sw;
}

/** Ubah saklar (Admin/Owner; dicek di route). Alasan wajib. Tidak menyentuh unit/Run/audit yang ada. */
export async function setAdminOverrideSwitch(prisma, { actorId, enabled, unitCodes = [], reason }) {
  if (typeof enabled !== "boolean") throw switchError("enabled wajib true/false", 400, "ADMIN_OVERRIDE_SWITCH_INVALID");
  const alasan = String(reason ?? "").trim().replace(/\s+/g, " ");
  if (alasan.length < 10) throw switchError("Alasan perubahan saklar wajib diisi (minimal 10 karakter)", 400, "ADMIN_OVERRIDE_SWITCH_REASON_REQUIRED");
  if (alasan.length > 300) throw switchError("Alasan maksimal 300 karakter", 400, "ADMIN_OVERRIDE_SWITCH_REASON_REQUIRED");
  const kode = rapi(unitCodes);
  if (kode.length > 50) throw switchError("Daftar kode unit maksimal 50", 400, "ADMIN_OVERRIDE_SWITCH_INVALID");
  return prisma.$transaction(async (tx) => {
    const sebelum = await readAdminOverrideSwitch(tx);
    const data = { enabled, scope: "GLOBAL", config: { unitCodes: kode }, reason: alasan, updatedById: actorId || null };
    await tx.v2FeatureFlag.upsert({ where: { key: ADMIN_OVERRIDE_SWITCH_KEY }, create: { key: ADMIN_OVERRIDE_SWITCH_KEY, ...data }, update: data });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.PRODUCTION_SETTING, entityId: ADMIN_OVERRIDE_SWITCH_KEY, eventType: EVENT_TYPES.PRODUCTION_SETTING_CHANGED, actorId: actorId || null,
      metadata: {
        key: ADMIN_OVERRIDE_SWITCH_KEY, label: "Admin override: Siap Kirim saat pencatatan produksi belum selesai", from: sebelum.enabled ? `AKTIF${sebelum.unitCodes.length ? ` (${sebelum.unitCodes.join(", ")})` : ""}` : "NONAKTIF",
        to: enabled ? `AKTIF${kode.length ? ` (${kode.join(", ")})` : ""}` : "NONAKTIF", reason: alasan,
      },
    });
    return readAdminOverrideSwitch(tx);
  });
}

// Keadaan job pengiriman terhadap penanganan: menentukan tindakan yang aman (lihat runbook). Murni.
export function klasifikasiJobOverride(job) {
  if (!job) return { kode: "TANPA_JOB", tindakan: "Belum ada job pengiriman. Tidak ada yang perlu dilepas; unit tetap Siap Kirim dan muncul sebagai kandidat biasa di Route Planner." };
  const s = job.status;
  const rute = job.route ?? null;
  if (["COMPLETED"].includes(s)) return { kode: "SELESAI", tindakan: "Job sudah selesai. Tidak ada tindakan; audit override tetap." };
  if (["FAILED", "RESCHEDULED"].includes(s)) return { kode: "GAGAL_ATAU_DIJADWAL_ULANG", tindakan: "Ditangani lewat alur gagal/jadwal ulang biasa (Kasus Reschedule). Tidak ada tindakan khusus override." };
  if (["EN_ROUTE", "ARRIVED"].includes(s)) return { kode: "SEDANG_BERJALAN", tindakan: "Driver sedang di jalan. JANGAN dihapus/dibatalkan dari sini; biarkan driver menyelesaikan atau menandai gagal lewat app (alur biasa)." };
  if (!rute) return { kode: "TANPA_RUTE", tindakan: "Job belum masuk rute. Hapus job (DELETE /armada/jobs/:id) bila tidak jadi dikirim; unit tetap Siap Kirim dan kembali menjadi kandidat biasa." };
  if (rute.status === "DRAFT") return { kode: "RUTE_DRAFT", tindakan: "Rute masih draf. Keluarkan job dari rute (PATCH /armada/routes/:id/jobs tanpa job ini) lalu hapus job bila perlu; atau hapus rute draf." };
  if (["PUBLISHED"].includes(rute.status)) return { kode: "RUTE_TERBIT_BELUM_JALAN", tindakan: "Rute sudah terbit ke driver. Batalkan rute (PATCH /armada/routes/:id/cancel) atau hapus job (DELETE /armada/jobs/:id, hanya UNSCHEDULED/SCHEDULED/ASSIGNED); beri tahu driver. Unit tetap Siap Kirim." };
  return { kode: "RUTE_LAIN", tindakan: `Rute berstatus ${rute.status}; tangani lewat alur Delivery biasa.` };
}

/** Laporan baca-saja semua override + job/rute terkait + tindakan yang disarankan. */
export async function adminOverrideReport(prisma, { limit = 200 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const runs = await prisma.productionRun.findMany({
    where: { deliveryReleasedAt: { not: null } }, orderBy: { deliveryReleasedAt: "desc" }, take,
    select: {
      id: true, status: true, revision: true, deliveryReleasedAt: true, deliveryRelease: true,
      unit: { select: { id: true, unitCode: true, status: true, storageLocation: true, order: { select: { id: true, orderNumber: true, status: true } } } },
    },
  });
  const unitIds = runs.map((r) => r.unit.id);
  const jobUnits = unitIds.length
    ? await prisma.jobUnit.findMany({
      where: { unitId: { in: unitIds }, job: { type: "DELIVERY" } },
      select: { unitId: true, job: { select: { id: true, status: true, driverId: true, driver: { select: { id: true, name: true } }, route: { select: { id: true, code: true, status: true } } } } },
    })
    : [];
  const jobPerUnit = new Map();
  for (const ju of jobUnits) { if (!jobPerUnit.has(ju.unitId)) jobPerUnit.set(ju.unitId, []); jobPerUnit.get(ju.unitId).push(ju.job); }
  const items = runs.map((r) => {
    const jobs = jobPerUnit.get(r.unit.id) ?? [];
    const rek = r.deliveryRelease ?? {};
    return {
      runId: r.id, runStatus: r.status, overrideAt: r.deliveryReleasedAt, decidedBy: rek.decidedBy ?? null, reason: rek.reason ?? null, pickupLocation: rek.pickupLocation ?? null,
      unit: { id: r.unit.id, unitCode: r.unit.unitCode, status: r.unit.status, storageLocation: r.unit.storageLocation }, order: r.unit.order,
      runBelumDitutup: ["ACTIVE", "BLOCKED", "PENDING_ARRIVAL"].includes(r.status),
      jobs: jobs.map((j) => ({ id: j.id, status: j.status, driver: j.driver ?? null, route: j.route ?? null, ...klasifikasiJobOverride(j) })),
      tanpaJob: jobs.length === 0 ? klasifikasiJobOverride(null) : null,
    };
  });
  const sw = await readAdminOverrideSwitch(prisma);
  return {
    saklar: sw,
    ringkas: {
      total: items.length, runBelumDitutup: items.filter((i) => i.runBelumDitutup).length,
      jobBisaDitangani: items.reduce((n, i) => n + i.jobs.filter((j) => ["TANPA_RUTE", "RUTE_DRAFT", "RUTE_TERBIT_BELUM_JALAN"].includes(j.kode)).length, 0),
      jobSedangBerjalan: items.reduce((n, i) => n + i.jobs.filter((j) => j.kode === "SEDANG_BERJALAN").length, 0),
    },
    items,
  };
}
