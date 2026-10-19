// KOREKSI "pengiriman manual masuk rute yang SUDAH SELESAI" (kasus RES-03102026-018-U1 / rute Bandung RTE-161026-02, keputusan Owner 19 Okt 2026).
//
// Barang sudah benar-benar dikirim bersama rute itu, tetapi tidak pernah masuk Route Planner karena pencatatan Produksinya belum selesai. Koreksi ini mencatat KENYATAAN itu di sisi Delivery dan hanya itu:
//   • membuat TEPAT SATU job pengiriman COMPLETED di rute tersebut (atau memakai satu-satunya job pengiriman aktif unit itu bila ada — tidak pernah job ganda);
//   • unit → Terkirim lewat SATU fungsi domain (services/statusUnitLintasWorkspace.js): Run Produksi yang belum ditutup diberi penanda "dilepas untuk pengiriman" (kind DISPATCH_ROUTE_PLANNER, via JOB_COMPLETE), TIDAK ditutup;
//   • satu event eksekusi (JOB_COMPLETED, ditandai koreksi manual) dan satu aktivitas dengan nama pelaku + alasan.
// YANG TIDAK DILAKUKAN (sengaja): tidak menyentuh job lain di rute (tidak membuka ulang/menghitung ulang), tidak mengubah status rute (tetap COMPLETED, tidak ada event ROUTE_COMPLETED baru), tidak membuat tahap/QC/foto/stok/bukti Produksi,
// tidak membuat foto bukti serah-terima palsu, tidak mengirim notifikasi WA (tidak ada yang dipanggil dari lapisan notifikasi), tidak menyentuh status ORDER (status order = keputusan Sales lewat dropdown resmi, yang kini menerima unit Terkirim).
// Idempoten: kunci event deterministik; panggilan ulang = tidak ada tulisan baru.
import { ACTIVE_JOB_STATUSES } from "./jobStatus.js";
import { ubahStatusUnitInTx, KE_STATUS, SUMBER_STATUS } from "./statusUnitLintasWorkspace.js";
import { syncOrderStatusForUnits } from "./orderStatusSync.js";
import { createExecutionEvent, lockRoute } from "./deliveryExecution.js";
import { TIME_QUALITY } from "./deliveryTimeline.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { V2_FLAGS, deliveryWriterDecision, loadV2Flags } from "./v2FeatureFlags.js";

export class KoreksiRuteError extends Error {
  constructor(message, code = "KOREKSI_RUTE_DITOLAK", statusCode = 409, extra = null) { super(message); this.name = "KoreksiRuteError"; this.code = code; this.statusCode = statusCode; if (extra) this.extra = extra; }
}

const UNIT_BISA_DIKOREKSI = Object.freeze(["RECEIVED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"]);
const kunciEvent = (unitId, routeId) => `koreksi-rute:${unitId}:${routeId}`;

async function muat(db, { unitCode, routeCode }) {
  const unit = await db.unit.findUnique({ where: { unitCode }, include: { order: { select: { id: true, orderNumber: true, status: true, statusLocked: true, deliveryAddress: true, deliveryConfirmedDate: true, penjualanKaryawanId: true } } } });
  if (!unit) throw new KoreksiRuteError(`Unit ${unitCode} tidak ditemukan`, "UNIT_TIDAK_ADA", 404);
  const route = await db.route.findUnique({ where: { code: routeCode } });
  if (!route) throw new KoreksiRuteError(`Rute ${routeCode} tidak ditemukan`, "RUTE_TIDAK_ADA", 404);
  const jobRute = await db.job.findMany({ where: { routeId: route.id }, orderBy: { sequence: "asc" }, select: { id: true, type: true, status: true, sequence: true, orderId: true, completedAt: true, units: { select: { unit: { select: { unitCode: true, status: true } } } } } });
  const jobUnit = await db.jobUnit.findMany({ where: { unitId: unit.id }, select: { job: { select: { id: true, type: true, status: true, routeId: true, sequence: true } } } });
  const runs = await db.productionRun.findMany({ where: { unitId: unit.id }, select: { id: true, status: true, currentPhase: true, revision: true, deliveryReleasedAt: true, deliveryRelease: true } });
  // Kepemilikan Delivery V2: rute yang dikelola writer V2 (cohort/GLOBAL) atau sudah punya state V2 TIDAK boleh ditulis langsung di sisi V1 — proyeksinya akan melenceng. Koreksi ini hanya untuk rute V1-saja.
  const flags = await loadV2Flags(db);
  const keputusan = await deliveryWriterDecision(db, flags, { routeId: route.id });
  const stateV2 = await db.deliveryRouteState.findUnique({ where: { routeId: route.id }, select: { routeId: true } });
  const v2 = { dikelola: keputusan.enabled === true || !!stateV2, pagarV1: flags[V2_FLAGS.DELIVERY_V1_WRITER_FENCE]?.enabled === true };
  return { unit, route, jobRute, jobUnit: jobUnit.map((j) => j.job), runs, v2 };
}

function nilaiPreconditions({ unit, route, jobUnit, v2 }, waktuTerkirim) {
  const rintangan = [];
  const sudahDiRute = jobUnit.find((j) => j.type === "DELIVERY" && j.routeId === route.id && j.status === "COMPLETED");
  if (sudahDiRute && unit.status === "DELIVERED") return { rintangan, sudahDiterapkan: true, jobSudahAda: sudahDiRute };
  if (v2.dikelola) rintangan.push({ kode: "RUTE_DI_DELIVERY_V2", pesan: `Rute ${route.code} dikelola Delivery V2 (writer/state V2); koreksi V1 langsung ditolak — gunakan command V2` });
  if (v2.pagarV1) rintangan.push({ kode: "DELIVERY_V1_DIPAGARI", pesan: "Penulisan Delivery V1 sedang dipagari (final catch-up V2); tunggu pagar dibuka" });
  if (route.status !== "COMPLETED") rintangan.push({ kode: "RUTE_BELUM_SELESAI", pesan: `Rute ${route.code} berstatus ${route.status}; koreksi ini khusus rute yang sudah selesai (untuk rute berjalan pakai Route Planner biasa)` });
  if (!UNIT_BISA_DIKOREKSI.includes(unit.status)) rintangan.push({ kode: "UNIT_STATUS_TIDAK_SESUAI", pesan: `Unit ${unit.unitCode} berstatus ${unit.status}` });
  if (unit.order.penjualanKaryawanId) rintangan.push({ kode: "ORDER_PKR", pesan: "Order Penjualan Karyawan memakai konfirmasi kesiapan fisik sendiri; tidak dikoreksi lewat jalur ini" });
  if (["CANCELLED", "DELIVERED"].includes(unit.order.status)) rintangan.push({ kode: "ORDER_STATUS_TIDAK_SESUAI", pesan: `Order ${unit.order.orderNumber} berstatus ${unit.order.status}` });
  const aktif = jobUnit.filter((j) => j.type === "DELIVERY" && ACTIVE_JOB_STATUSES.includes(j.status));
  if (aktif.length > 1) rintangan.push({ kode: "JOB_AKTIF_GANDA", pesan: `Unit punya ${aktif.length} job pengiriman aktif; rapikan lebih dulu`, jobIds: aktif.map((j) => j.id) });
  if (aktif.length === 1 && aktif[0].routeId && aktif[0].routeId !== route.id) rintangan.push({ kode: "JOB_AKTIF_DI_RUTE_LAIN", pesan: "Job pengiriman aktif unit ini sudah berada di rute lain", jobId: aktif[0].id });
  if (waktuTerkirim) {
    if (Number.isNaN(waktuTerkirim.getTime())) rintangan.push({ kode: "WAKTU_TIDAK_VALID", pesan: "Waktu terkirim tidak valid" });
    else if (waktuTerkirim.getTime() > Date.now()) rintangan.push({ kode: "WAKTU_DI_MASA_DEPAN", pesan: "Waktu terkirim tidak boleh di masa depan" });
    else {
      const hariRute = route.date.toISOString().slice(0, 10);
      const hariWib = new Date(waktuTerkirim.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      if (hariRute !== hariWib) rintangan.push({ kode: "WAKTU_BUKAN_HARI_RUTE", pesan: `Waktu terkirim (${hariWib} WIB) harus pada tanggal rute (${hariRute})` });
    }
  }
  return { rintangan, sudahDiterapkan: false, jobAktif: aktif[0] ?? null };
}

/** BACA-SAJA. Menggambarkan keadaan sekarang, apa yang akan ditulis, dan dampak ke laporan rute. Aman dijalankan di production. */
export async function pratinjauKoreksiPengirimanRute(db, { unitCode, routeCode, waktuTerkirim = null }) {
  const data = await muat(db, { unitCode, routeCode });
  const { unit, route, jobRute, runs } = data;
  const cek = nilaiPreconditions(data, waktuTerkirim);
  const selesaiSebelum = jobRute.filter((j) => j.status === "COMPLETED").length;
  const sudah = cek.sudahDiterapkan;
  return {
    kondisiSekarang: {
      unit: { kode: unit.unitCode, status: unit.status },
      order: { nomor: unit.order.orderNumber, status: unit.order.status, statusLocked: unit.order.statusLocked, tanggalKirimPasti: unit.order.deliveryConfirmedDate?.toISOString().slice(0, 10) ?? null },
      run: runs.map((r) => ({ id: r.id, status: r.status, fase: r.currentPhase, revisi: r.revision, dilepas: !!r.deliveryReleasedAt, jenisPelepasan: r.deliveryRelease?.kind ?? null })),
      jobUnit: data.jobUnit,
      rute: { kode: route.code, status: route.status, tanggal: route.date.toISOString().slice(0, 10), jumlahJob: jobRute.length, jobSelesai: selesaiSebelum },
    },
    sudahDiterapkan: sudah,
    rintangan: cek.rintangan,
    layak: cek.rintangan.length === 0,
    rencanaTulis: sudah ? [] : [
      cek.jobAktif ? `Pakai job pengiriman aktif ${cek.jobAktif.id} (tidak membuat job baru) dan pindahkan ke ${route.code}` : `Buat 1 job DELIVERY COMPLETED di ${route.code} (stop ke-${(Math.max(0, ...jobRute.map((j) => j.sequence ?? 0))) + 1}), driver/helper/kendaraan disalin dari rute`,
      "Tautkan job_units ke unit; status unit → DELIVERED lewat fungsi domain tunggal",
      `Run ${runs.map((r) => r.id).join(", ") || "—"}: diberi penanda dilepas (DISPATCH_ROUTE_PLANNER/JOB_COMPLETE); TIDAK ditutup, tahap/QC/foto/stok/bukti tidak dibuat`,
      "1 event eksekusi JOB_COMPLETED (koreksi manual, sumber ADMIN_WEB) + 1 aktivitas dengan nama pelaku dan alasan",
      "Status rute tetap COMPLETED (tanpa event ROUTE_COMPLETED baru); job lain di rute tidak disentuh",
      `Status order TIDAK diubah oleh koreksi ini (saat ini ${unit.order.status}${unit.order.statusLocked ? ", terkunci manual Sales" : ""}); ubah ke Terkirim lewat dropdown Sales resmi sesudahnya`,
    ],
    dampakLaporanRute: sudah ? null : {
      sebelum: { stop: jobRute.length, selesai: selesaiSebelum, unit: jobRute.reduce((n, j) => n + j.units.length, 0) },
      sesudah: { stop: jobRute.length + (cek.jobAktif ? 0 : 1), selesai: selesaiSebelum + 1, unit: jobRute.reduce((n, j) => n + j.units.length, 0) + 1 },
      catatan: "Waktu mulai/tiba rute dan event rute selesai tidak berubah; stop Rika tampil tanpa waktu tiba/berangkat (tidak ada data nyata — tidak dikarang).",
    },
  };
}

/**
 * Menerapkan koreksi dalam transaksi pemanggil. TIDAK memanggil notifikasi apa pun. Idempoten.
 * `aktorId` harus pengguna ADMIN/OWNER; `waktuTerkirim` Date pada tanggal rute (WIB); `alasan` >= 10 karakter.
 */
export async function terapkanKoreksiPengirimanRuteInTx(tx, { unitCode, routeCode, aktorId, waktuTerkirim, alasan, namaPenerima = null }) {
  const teks = String(alasan ?? "").trim();
  if (teks.length < 10) throw new KoreksiRuteError("Alasan koreksi wajib diisi (minimal 10 karakter)", "ALASAN_WAJIB", 400);
  if (!(waktuTerkirim instanceof Date)) throw new KoreksiRuteError("waktuTerkirim wajib (Date)", "WAKTU_WAJIB", 400);
  const aktor = aktorId ? await tx.user.findUnique({ where: { id: aktorId }, select: { id: true, name: true, role: true, active: true, roles: { select: { role: true } } } }) : null;
  const peran = aktor ? [aktor.role, ...(aktor.roles || []).map((r) => r.role)] : [];
  if (!aktor?.active || !peran.some((r) => ["ADMIN", "OWNER"].includes(r))) throw new KoreksiRuteError("Koreksi ini hanya boleh atas nama pengguna ADMIN/OWNER yang aktif", "AKTOR_TIDAK_BERWENANG", 403);

  const awal = await muat(tx, { unitCode, routeCode });
  await lockRoute(tx, awal.route.id);
  await tx.$queryRaw`SELECT id FROM units WHERE id = ${awal.unit.id}::uuid FOR UPDATE`;
  const data = await muat(tx, { unitCode, routeCode }); // baca ulang SETELAH kunci
  const { unit, route } = data;
  const kunci = kunciEvent(unit.id, route.id);
  const sudahAda = await tx.deliveryExecutionEvent.findUnique({ where: { idempotencyKey: kunci } });
  const cek = nilaiPreconditions(data, waktuTerkirim);
  if (sudahAda || cek.sudahDiterapkan) return { diterapkan: false, sudahDiterapkan: true, jobId: cek.jobSudahAda?.id ?? sudahAda?.jobId ?? null };
  if (cek.rintangan.length) throw new KoreksiRuteError(`Koreksi ditolak: ${cek.rintangan.map((r) => r.pesan).join("; ")}`, cek.rintangan[0].kode, 409, { rintangan: cek.rintangan });

  const urut = Math.max(0, ...data.jobRute.map((j) => j.sequence ?? 0)) + 1;
  const sekarang = new Date();
  const dataJob = {
    status: "COMPLETED", routeId: route.id, sequence: urut, scheduledDate: route.date, driverId: route.driverId, helperId: route.helperId, vehicleId: route.vehicleId,
    completedAt: waktuTerkirim, proofPhotoUrls: [], proofRecipientName: namaPenerima?.trim() || "Tidak disebutkan (input admin)",
    proofNote: `Koreksi data oleh admin ${aktor.name}: ${teks}`.slice(0, 2000), completedById: aktor.id,
    podEditedById: aktor.id, podEditedAt: sekarang, podEditReason: teks.slice(0, 500),
  };
  let job;
  if (cek.jobAktif) {
    job = await tx.job.update({ where: { id: cek.jobAktif.id }, data: dataJob });
  } else {
    job = await tx.job.create({ data: { type: "DELIVERY", orderId: unit.orderId, addressText: unit.order.deliveryAddress ?? null, ...dataJob, units: { create: [{ unitId: unit.id }] } } });
  }
  // SATU jalur status lintas workspace: unit → Terkirim, Run yang belum ditutup dilepas (tidak ditutup), tanpa menyentuh order.
  const status = await ubahStatusUnitInTx(tx, { unitIds: [unit.id], ke: KE_STATUS.TERKIRIM, aktor: aktor.id, sumber: SUMBER_STATUS.DELIVERY_JOB, jobId: job.id, sinkronOrder: false, alasan: teks });
  await syncOrderStatusForUnits(tx, [unit.id], { forceStagedUnitIds: new Set([unit.id]) }); // order terkunci manual Sales tidak ditimpa (aturan D-006)
  await createExecutionEvent(tx, {
    idempotencyKey: kunci, action: "JOB_COMPLETED", actorId: aktor.id, jobId: job.id, routeId: route.id,
    payload: { status: "COMPLETED", manualCorrection: true, reason: teks, recipientName: dataJob.proofRecipientName, note: dataJob.proofNote, proofPhotoUrls: [] },
    time: { occurredAt: waktuTerkirim, source: "ADMIN_WEB", timeQuality: TIME_QUALITY.LATE_SYNC },
  });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.UNIT, entityId: unit.id, eventType: EVENT_TYPES.DELIVERY_MANUAL_RECORDED, actorId: aktor.id,
    metadata: { unitCode: unit.unitCode, orderNumber: unit.order.orderNumber, routeCode: route.code, routeId: route.id, jobId: job.id, stopSequence: urut, waktuTerkirim: waktuTerkirim.toISOString(), reason: teks, deciderName: aktor.name, jobDipakaiUlang: !!cek.jobAktif },
  });
  return { diterapkan: true, sudahDiterapkan: false, jobId: job.id, sequence: urut, unit: status.diubah, run: status.run, jobDipakaiUlang: !!cek.jobAktif };
}
