// KOREKSI "pengiriman manual masuk rute yang SUDAH SELESAI" (kasus RES-03102026-018-U1 / rute Bandung RTE-161026-02, keputusan Owner 19 Okt 2026).
//
// Barang sudah benar-benar dikirim bersama rute itu, tetapi tidak pernah masuk Route Planner karena pencatatan Produksinya belum selesai (sistem hanya punya job PICKUP, tidak ada tempat mengunggah bukti kirim).
// Koreksi ini mencatat KENYATAAN itu di sisi Delivery dan hanya itu:
//   • membuat TEPAT SATU job pengiriman COMPLETED di rute tersebut (atau memakai satu-satunya job pengiriman aktif unit itu — tidak pernah job ganda), tertaut ke unit, order, rute, driver/helper/kendaraan rute;
//   • bukti kirim (foto asli) disalin ke direktori bukti Delivery resmi (data/job-photos, pola nama yang sama dengan unggahan resmi POST /jobs/:id/photos), diverifikasi checksum SHA-256, ditautkan di job.proofPhotoUrls,
//     dan checksum + sumbernya dicatat di event audit. Bila transaksi gagal, berkas yang baru disalin dihapus lagi (tidak ada koreksi setengah jadi);
//   • unit → Terkirim lewat SATU fungsi domain (services/statusUnitLintasWorkspace.js) bila belum Terkirim (Run Produksi yang belum ditutup diberi penanda dilepas, TIDAK ditutup); bila Sales sudah lebih dulu menandai
//     unit/order Terkirim lewat alur resmi, status itu dibiarkan apa adanya;
//   • WAKTU KEJADIAN JUJUR: bila jam serah-terima tidak terbukti, hanya TANGGAL yang disimpan (completedAt dikosongkan, bukan diisi jam karangan); waktu pencatatan koreksi tersimpan terpisah sebagai waktu audit;
//   • satu event audit + satu aktivitas (unit dan order) dengan nama pelaku, alasan, sumber bukti.
// YANG TIDAK DILAKUKAN (sengaja): tidak menyentuh job lain di rute, tidak mengubah status rute (tetap COMPLETED, tanpa event ROUTE_COMPLETED baru), tidak membuat tahap/QC/stok/jurnal/bukti Produksi,
// tidak mengirim WA (tidak memanggil lapisan notifikasi), tidak menutup Production Run, tidak mengubah status ORDER (keputusan Sales).
// Idempoten: kunci event deterministik; panggilan ulang = tidak ada tulisan baru.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const here = path.dirname(fileURLToPath(import.meta.url));
export const JOB_PHOTOS_DIR_DEFAULT = path.join(here, "../../data/job-photos"); // direktori YANG SAMA dengan multer di routes/armada.js
const BATAS_FOTO_BYTE = 8 * 1024 * 1024; // batas yang sama dengan unggahan resmi
const UNIT_BISA_DIKOREKSI = Object.freeze(["RECEIVED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "DELIVERED"]);
const kunciEvent = (unitId, routeId) => `koreksi-rute:${unitId}:${routeId}`;
export const AKSI_KOREKSI_TANPA_JAM = "JOB_COMPLETED_KOREKSI_TANPA_JAM";

// ── Berkas bukti: validasi + hash (murni baca)
export function periksaBerkasFoto(berkas, { sha256Diharapkan = null } = {}) {
  let stat;
  try { stat = fs.statSync(berkas); } catch { throw new KoreksiRuteError(`Berkas foto tidak ditemukan: ${berkas}`, "FOTO_TIDAK_ADA", 400); }
  if (!stat.isFile()) throw new KoreksiRuteError("Jalur foto bukan berkas", "FOTO_BUKAN_BERKAS", 400);
  if (stat.size === 0 || stat.size > BATAS_FOTO_BYTE) throw new KoreksiRuteError(`Ukuran foto tidak sah (${stat.size} byte; maksimum ${BATAS_FOTO_BYTE})`, "FOTO_UKURAN", 400);
  const isi = fs.readFileSync(berkas);
  let mime = null; let ext = null;
  if (isi[0] === 0xff && isi[1] === 0xd8 && isi[2] === 0xff) { mime = "image/jpeg"; ext = ".jpg"; }
  else if (isi[0] === 0x89 && isi.subarray(1, 4).toString("latin1") === "PNG") { mime = "image/png"; ext = ".png"; }
  else throw new KoreksiRuteError("Isi berkas bukan gambar JPEG/PNG", "FOTO_BUKAN_GAMBAR", 400);
  const sha256 = crypto.createHash("sha256").update(isi).digest("hex");
  if (sha256Diharapkan && sha256Diharapkan.toLowerCase() !== sha256) throw new KoreksiRuteError(`Checksum foto tidak cocok (diharapkan ${sha256Diharapkan}, dihitung ${sha256})`, "FOTO_CHECKSUM", 409);
  return { isi, sha256, mime, ext, ukuranByte: stat.size };
}

async function muat(db, { unitCode, routeCode }) {
  const unit = await db.unit.findUnique({ where: { unitCode }, include: { order: { select: { id: true, orderNumber: true, status: true, statusLocked: true, deliveryAddress: true, deliveryConfirmedDate: true, penjualanKaryawanId: true } } } });
  if (!unit) throw new KoreksiRuteError(`Unit ${unitCode} tidak ditemukan`, "UNIT_TIDAK_ADA", 404);
  const route = await db.route.findUnique({ where: { code: routeCode } });
  if (!route) throw new KoreksiRuteError(`Rute ${routeCode} tidak ditemukan`, "RUTE_TIDAK_ADA", 404);
  const jobRute = await db.job.findMany({ where: { routeId: route.id }, orderBy: { sequence: "asc" }, select: { id: true, type: true, status: true, sequence: true, orderId: true, completedAt: true, units: { select: { unit: { select: { unitCode: true, status: true } } } } } });
  const jobUnit = await db.jobUnit.findMany({ where: { unitId: unit.id }, select: { job: { select: { id: true, type: true, status: true, routeId: true, sequence: true, proofPhotoUrls: true } } } });
  const runs = await db.productionRun.findMany({ where: { unitId: unit.id }, select: { id: true, status: true, currentPhase: true, revision: true, deliveryReleasedAt: true, deliveryRelease: true } });
  // Kepemilikan Delivery V2: rute yang dikelola writer V2 (cohort/GLOBAL) atau sudah punya state V2 TIDAK boleh ditulis langsung di sisi V1 — proyeksinya akan melenceng. Koreksi ini hanya untuk rute V1-saja.
  const flags = await loadV2Flags(db);
  const keputusan = await deliveryWriterDecision(db, flags, { routeId: route.id });
  const stateV2 = await db.deliveryRouteState.findUnique({ where: { routeId: route.id }, select: { routeId: true } });
  const v2 = { dikelola: keputusan.enabled === true || !!stateV2, pagarV1: flags[V2_FLAGS.DELIVERY_V1_WRITER_FENCE]?.enabled === true };
  return { unit, route, jobRute, jobUnit: jobUnit.map((j) => j.job), runs, v2 };
}

const hariWib = (d) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

function nilaiPreconditions({ unit, route, jobUnit, v2 }, { waktuTerkirim = null, tanggalKejadian = null } = {}) {
  const rintangan = [];
  const sudahDiRute = jobUnit.find((j) => j.type === "DELIVERY" && j.routeId === route.id && j.status === "COMPLETED");
  if (sudahDiRute && unit.status === "DELIVERED") return { rintangan, sudahDiterapkan: true, jobSudahAda: sudahDiRute };
  if (v2.dikelola) rintangan.push({ kode: "RUTE_DI_DELIVERY_V2", pesan: `Rute ${route.code} dikelola Delivery V2 (writer/state V2); koreksi V1 langsung ditolak — gunakan command V2` });
  if (v2.pagarV1) rintangan.push({ kode: "DELIVERY_V1_DIPAGARI", pesan: "Penulisan Delivery V1 sedang dipagari (final catch-up V2); tunggu pagar dibuka" });
  if (route.status !== "COMPLETED") rintangan.push({ kode: "RUTE_BELUM_SELESAI", pesan: `Rute ${route.code} berstatus ${route.status}; koreksi ini khusus rute yang sudah selesai (untuk rute berjalan pakai Route Planner biasa)` });
  if (!UNIT_BISA_DIKOREKSI.includes(unit.status)) rintangan.push({ kode: "UNIT_STATUS_TIDAK_SESUAI", pesan: `Unit ${unit.unitCode} berstatus ${unit.status}` });
  if (unit.status === "DELIVERED" && jobUnit.some((j) => j.type === "DELIVERY" && j.status === "COMPLETED")) rintangan.push({ kode: "UNIT_SUDAH_PUNYA_PENGIRIMAN_SELESAI", pesan: `Unit ${unit.unitCode} sudah punya job pengiriman selesai di rute lain` });
  if (unit.order.penjualanKaryawanId) rintangan.push({ kode: "ORDER_PKR", pesan: "Order Penjualan Karyawan memakai konfirmasi kesiapan fisik sendiri; tidak dikoreksi lewat jalur ini" });
  if (unit.order.status === "CANCELLED") rintangan.push({ kode: "ORDER_STATUS_TIDAK_SESUAI", pesan: `Order ${unit.order.orderNumber} berstatus ${unit.order.status}` });
  const aktif = jobUnit.filter((j) => j.type === "DELIVERY" && ACTIVE_JOB_STATUSES.includes(j.status));
  if (aktif.length > 1) rintangan.push({ kode: "JOB_AKTIF_GANDA", pesan: `Unit punya ${aktif.length} job pengiriman aktif; rapikan lebih dulu`, jobIds: aktif.map((j) => j.id) });
  if (aktif.length === 1 && aktif[0].routeId && aktif[0].routeId !== route.id) rintangan.push({ kode: "JOB_AKTIF_DI_RUTE_LAIN", pesan: "Job pengiriman aktif unit ini sudah berada di rute lain", jobId: aktif[0].id });
  const hariRute = route.date.toISOString().slice(0, 10);
  if (waktuTerkirim && tanggalKejadian) rintangan.push({ kode: "WAKTU_GANDA", pesan: "Isi salah satu: waktuTerkirim (jam terbukti) ATAU tanggalKejadian (jam tidak diketahui), bukan keduanya" });
  else if (!waktuTerkirim && !tanggalKejadian) rintangan.push({ kode: "WAKTU_WAJIB", pesan: "Isi waktuTerkirim (jam terbukti) atau tanggalKejadian (jam tidak diketahui)" });
  if (waktuTerkirim) {
    if (Number.isNaN(waktuTerkirim.getTime())) rintangan.push({ kode: "WAKTU_TIDAK_VALID", pesan: "Waktu terkirim tidak valid" });
    else if (waktuTerkirim.getTime() > Date.now()) rintangan.push({ kode: "WAKTU_DI_MASA_DEPAN", pesan: "Waktu terkirim tidak boleh di masa depan" });
    else if (hariRute !== hariWib(waktuTerkirim)) rintangan.push({ kode: "WAKTU_BUKAN_HARI_RUTE", pesan: `Waktu terkirim (${hariWib(waktuTerkirim)} WIB) harus pada tanggal rute (${hariRute})` });
  }
  if (tanggalKejadian) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalKejadian)) rintangan.push({ kode: "TANGGAL_TIDAK_VALID", pesan: "tanggalKejadian harus YYYY-MM-DD" });
    else if (tanggalKejadian !== hariRute) rintangan.push({ kode: "TANGGAL_BUKAN_HARI_RUTE", pesan: `tanggalKejadian (${tanggalKejadian}) harus sama dengan tanggal rute (${hariRute})` });
  }
  return { rintangan, sudahDiterapkan: false, jobAktif: aktif[0] ?? null };
}

/** BACA-SAJA. Menggambarkan keadaan sekarang, SELURUH record/berkas yang akan ditambah atau diubah, dan dampak ke laporan rute. Aman dijalankan di production. */
export async function pratinjauKoreksiPengirimanRute(db, { unitCode, routeCode, waktuTerkirim = null, tanggalKejadian = null, foto = null, jobPhotosDir = JOB_PHOTOS_DIR_DEFAULT, catatanBukti = null }) {
  const data = await muat(db, { unitCode, routeCode });
  const { unit, route, jobRute, runs } = data;
  const cek = nilaiPreconditions(data, { waktuTerkirim, tanggalKejadian });
  const selesaiSebelum = jobRute.filter((j) => j.status === "COMPLETED").length;
  const sudah = cek.sudahDiterapkan;
  const rintangan = [...cek.rintangan];
  let berkas = null;
  if (foto?.path) {
    try {
      const f = periksaBerkasFoto(foto.path, { sha256Diharapkan: foto.sha256 ?? null });
      berkas = { sumber: foto.path, sha256: f.sha256, ukuranByte: f.ukuranByte, mime: f.mime, tujuanDirektori: jobPhotosDir, polaNama: `<jobId>-<waktu>-<acak>${f.ext}`, urlAkanTerbentuk: "/media/job-photos/<jobId>-…", akanDisalin: !sudah };
    } catch (e) { rintangan.push({ kode: e.code ?? "FOTO", pesan: e.message }); }
  } else if (!sudah) rintangan.push({ kode: "FOTO_WAJIB", pesan: "Bukti kirim (foto) belum diberikan" });
  const urutBaru = Math.max(0, ...jobRute.map((j) => j.sequence ?? 0)) + 1;
  const unitSudahTerkirim = unit.status === "DELIVERED";
  return {
    kondisiSekarang: {
      unit: { kode: unit.unitCode, status: unit.status },
      order: { nomor: unit.order.orderNumber, status: unit.order.status, statusLocked: unit.order.statusLocked, tanggalKirimPasti: unit.order.deliveryConfirmedDate?.toISOString().slice(0, 10) ?? null, alamatAda: !!unit.order.deliveryAddress },
      run: runs.map((r) => ({ id: r.id, status: r.status, fase: r.currentPhase, revisi: r.revision, dilepas: !!r.deliveryReleasedAt, jenisPelepasan: r.deliveryRelease?.kind ?? null })),
      jobUnit: data.jobUnit.map((j) => ({ id: j.id, type: j.type, status: j.status, routeId: j.routeId, sequence: j.sequence })),
      rute: { kode: route.code, status: route.status, tanggal: route.date.toISOString().slice(0, 10), jumlahJob: jobRute.length, jobSelesai: selesaiSebelum, stopSaatIni: jobRute.map((j) => ({ urut: j.sequence, job: j.id, status: j.status })) },
    },
    waktu: waktuTerkirim ? { jenis: "JAM_TERBUKTI", waktuTerkirim: waktuTerkirim.toISOString() } : { jenis: "TANGGAL_SAJA", tanggalKejadian, jamKejadian: "tidak diketahui (completedAt dikosongkan, bukan diisi karangan)", catatanBukti },
    sudahDiterapkan: sudah,
    rintangan,
    layak: rintangan.length === 0,
    recordAkanDitulis: sudah ? [] : [
      cek.jobAktif ? { tabel: "jobs", aksi: "UPDATE", id: cek.jobAktif.id, ringkas: `job pengiriman aktif dipakai ulang → COMPLETED, masuk ${route.code} stop ke-${urutBaru}` } : { tabel: "jobs", aksi: "INSERT", ringkas: `1 job DELIVERY COMPLETED di ${route.code} stop ke-${urutBaru}; order ${unit.order.orderNumber}; driver/helper/kendaraan disalin dari rute; proofPhotoUrls = foto bukti; completedAt ${waktuTerkirim ? "= jam terbukti" : "KOSONG (jam tidak diketahui)"}; completedBy/podEditedBy = pelaku koreksi` },
      { tabel: "job_units", aksi: "INSERT", ringkas: `tautkan job ke unit ${unit.unitCode}` },
      { tabel: "delivery_execution_events", aksi: "INSERT", ringkas: `1 event ${waktuTerkirim ? "JOB_COMPLETED" : AKSI_KOREKSI_TANPA_JAM} (kunci ${kunciEvent(unit.id, route.id)}); payload memuat alasan, checksum foto, sumber bukti; ${waktuTerkirim ? "" : "TIDAK ikut timeline jam (timeline menulis 'Tidak tersedia' untuk jam), "}tanpa notifikasi` },
      { tabel: "activity_events", aksi: "INSERT", ringkas: `2 baris DELIVERY_MANUAL_RECORDED (unit dan order) dengan nama pelaku, alasan, rute, stop, ${waktuTerkirim ? "jam" : "tanggal"}, tautan foto` },
      unitSudahTerkirim ? { tabel: "units", aksi: "TIDAK DIUBAH", ringkas: "unit sudah DELIVERED (ditandai Sales lewat alur resmi); tidak ditulis ulang" } : { tabel: "units", aksi: "UPDATE", ringkas: "status → DELIVERED lewat fungsi domain tunggal; Run diberi penanda dilepas (tidak ditutup)" },
      { tabel: "Order", aksi: "TIDAK DIUBAH", ringkas: `status order tetap ${unit.order.status}${unit.order.statusLocked ? " (terkunci manual Sales)" : ""}` },
      { tabel: "routes / job lain di rute", aksi: "TIDAK DIUBAH", ringkas: "status rute tetap COMPLETED; lima job lama tidak disentuh" },
      { tabel: "production_runs_v2", aksi: "TIDAK DIUBAH", ringkas: "Run tetap menyimpan riwayat sebenarnya; boleh ditutup administratif kemudian" },
    ],
    berkasAkanDitambah: berkas ? [berkas] : [],
    dampakLaporanRute: sudah ? null : {
      sebelum: { stop: jobRute.length, selesai: selesaiSebelum, unit: jobRute.reduce((n, j) => n + j.units.length, 0) },
      sesudah: { stop: jobRute.length + (cek.jobAktif ? 0 : 1), selesai: selesaiSebelum + 1, unit: jobRute.reduce((n, j) => n + j.units.length, 0) + 1 },
      catatan: "Waktu mulai/tiba rute dan event rute selesai tidak berubah. Stop Rika tampil tanpa waktu tiba/berangkat" + (waktuTerkirim ? "." : " dan tanpa jam selesai (hanya tanggal) — tidak ada data nyata, tidak dikarang. Konsekuensi: job tanpa completedAt tidak terhitung di laporan insentif driver per periode."),
    },
  };
}

/**
 * Menerapkan koreksi dalam transaksi pemanggil. TIDAK memanggil notifikasi apa pun. Idempoten.
 * `aktorId` harus pengguna ADMIN/OWNER; `waktuTerkirim` (jam terbukti) ATAU `tanggalKejadian` (jam tidak diketahui); `alasan` >= 10 karakter.
 * `bukti` ({ urls, sha256, ukuranByte, mime, sumber }) sudah disalin ke direktori bukti oleh pemanggil (lihat terapkanKoreksiPengirimanRute); `jobId` = id job baru yang sudah dipakai pada nama berkas.
 */
export async function terapkanKoreksiPengirimanRuteInTx(tx, { unitCode, routeCode, aktorId, waktuTerkirim = null, tanggalKejadian = null, alasan, namaPenerima = null, bukti = null, jobId = null, catatanBukti = null }) {
  const teks = String(alasan ?? "").trim();
  if (teks.length < 10) throw new KoreksiRuteError("Alasan koreksi wajib diisi (minimal 10 karakter)", "ALASAN_WAJIB", 400);
  if (waktuTerkirim != null && !(waktuTerkirim instanceof Date)) throw new KoreksiRuteError("waktuTerkirim harus Date", "WAKTU_TIDAK_VALID", 400);
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
  const cek = nilaiPreconditions(data, { waktuTerkirim, tanggalKejadian });
  if (sudahAda || cek.sudahDiterapkan) return { diterapkan: false, sudahDiterapkan: true, jobId: cek.jobSudahAda?.id ?? sudahAda?.jobId ?? null };
  if (cek.rintangan.length) throw new KoreksiRuteError(`Koreksi ditolak: ${cek.rintangan.map((r) => r.pesan).join("; ")}`, cek.rintangan[0].kode, 409, { rintangan: cek.rintangan });

  const urut = Math.max(0, ...data.jobRute.map((j) => j.sequence ?? 0)) + 1;
  const sekarang = new Date();
  const urls = bukti?.urls ?? [];
  const dataJob = {
    status: "COMPLETED", routeId: route.id, sequence: urut, scheduledDate: route.date, driverId: route.driverId, helperId: route.helperId, vehicleId: route.vehicleId,
    completedAt: waktuTerkirim ?? null, proofPhotoUrls: urls, proofRecipientName: namaPenerima?.trim() || "Tidak disebutkan (input admin)",
    proofNote: `Koreksi data oleh ${aktor.name}${waktuTerkirim ? "" : " (jam serah-terima tidak diketahui; hanya tanggal " + (tanggalKejadian) + ")"}: ${teks}`.slice(0, 2000), completedById: aktor.id,
    podEditedById: aktor.id, podEditedAt: sekarang, podEditReason: teks.slice(0, 500),
  };
  let job;
  if (cek.jobAktif) {
    job = await tx.job.update({ where: { id: cek.jobAktif.id }, data: dataJob });
    if (!(await tx.jobUnit.findFirst({ where: { jobId: job.id, unitId: unit.id } }))) await tx.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  } else {
    job = await tx.job.create({ data: { ...(jobId ? { id: jobId } : {}), type: "DELIVERY", orderId: unit.orderId, addressText: unit.order.deliveryAddress ?? null, ...dataJob, units: { create: [{ unitId: unit.id }] } } });
  }
  // SATU jalur status lintas workspace: unit → Terkirim bila belum (Run yang belum ditutup dilepas, tidak ditutup). Unit yang sudah Terkirim lewat Sales tidak ditulis ulang.
  let status = { diubah: [], run: { dibatalkan: [], dilepas: [], peringatan: [], returGudang: [] } };
  if (unit.status !== "DELIVERED") {
    status = await ubahStatusUnitInTx(tx, { unitIds: [unit.id], ke: KE_STATUS.TERKIRIM, aktor: aktor.id, sumber: SUMBER_STATUS.DELIVERY_JOB, jobId: job.id, sinkronOrder: false, alasan: teks });
    await syncOrderStatusForUnits(tx, [unit.id], { forceStagedUnitIds: new Set([unit.id]) }); // order terkunci manual Sales tidak ditimpa (aturan D-006)
  }
  const ringkasBukti = bukti ? { sha256: bukti.sha256, ukuranByte: bukti.ukuranByte, mime: bukti.mime, sumberBerkas: bukti.sumber ?? null } : null;
  const payloadDasar = { manualCorrection: true, reason: teks, recipientName: dataJob.proofRecipientName, note: dataJob.proofNote, proofPhotoUrls: urls, buktiFoto: ringkasBukti, catatanBukti, tanggalKejadian: tanggalKejadian ?? hariWib(waktuTerkirim), waktuDicatatKoreksi: sekarang.toISOString() };
  if (waktuTerkirim) {
    await createExecutionEvent(tx, {
      idempotencyKey: kunci, action: "JOB_COMPLETED", actorId: aktor.id, jobId: job.id, routeId: route.id,
      payload: { status: "COMPLETED", ...payloadDasar, jamKejadian: "terbukti" },
      time: { occurredAt: waktuTerkirim, source: "ADMIN_WEB", timeQuality: TIME_QUALITY.LATE_SYNC },
    });
  } else {
    // Jam tidak diketahui: event ini SENGAJA bukan JOB_COMPLETED (timeline akan menulis "Tidak tersedia" untuk jam, bukan memakai waktu pencatatan sebagai waktu kejadian).
    await createExecutionEvent(tx, {
      idempotencyKey: kunci, action: AKSI_KOREKSI_TANPA_JAM, actorId: aktor.id, jobId: job.id, routeId: route.id,
      payload: { status: "COMPLETED", ...payloadDasar, jamKejadian: "tidak diketahui" },
      time: { occurredAt: null, source: "ADMIN_WEB", timeQuality: "TANGGAL_SAJA" },
    });
  }
  const metadata = { unitCode: unit.unitCode, orderNumber: unit.order.orderNumber, routeCode: route.code, routeId: route.id, jobId: job.id, stopSequence: urut, tanggalKejadian: payloadDasar.tanggalKejadian, waktuTerkirim: waktuTerkirim ? waktuTerkirim.toISOString() : null, jamKejadian: waktuTerkirim ? "terbukti" : "tidak diketahui", waktuDicatatKoreksi: payloadDasar.waktuDicatatKoreksi, reason: teks, deciderName: aktor.name, jobDipakaiUlang: !!cek.jobAktif, fotoBukti: urls, fotoSha256: ringkasBukti?.sha256 ?? null, catatanBukti };
  await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unit.id, eventType: EVENT_TYPES.DELIVERY_MANUAL_RECORDED, actorId: aktor.id, metadata });
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: unit.orderId, eventType: EVENT_TYPES.DELIVERY_MANUAL_RECORDED, actorId: aktor.id, metadata });
  return { diterapkan: true, sudahDiterapkan: false, jobId: job.id, sequence: urut, unit: status.diubah, run: status.run, jobDipakaiUlang: !!cek.jobAktif, bukti: ringkasBukti, urls };
}

/**
 * Jalur lengkap dengan berkas foto: validasi → salin ke direktori bukti (sebelum transaksi) → transaksi → verifikasi baca-ulang. Gagal/diulang = berkas yang baru disalin dihapus lagi.
 * `foto` = { path, sha256? } (berkas sumber, mis. foto yang sudah ada di sistem atau diserahkan Owner).
 */
export async function terapkanKoreksiPengirimanRute(prisma, { foto = null, jobPhotosDir = JOB_PHOTOS_DIR_DEFAULT, timeoutMs = 30000, ...masukan }) {
  const pratinjau = await pratinjauKoreksiPengirimanRute(prisma, { unitCode: masukan.unitCode, routeCode: masukan.routeCode, waktuTerkirim: masukan.waktuTerkirim ?? null, tanggalKejadian: masukan.tanggalKejadian ?? null, foto, jobPhotosDir });
  if (pratinjau.sudahDiterapkan) return { diterapkan: false, sudahDiterapkan: true };
  if (!pratinjau.layak) throw new KoreksiRuteError(`Koreksi ditolak: ${pratinjau.rintangan.map((r) => r.pesan).join("; ")}`, pratinjau.rintangan[0].kode, 409, { rintangan: pratinjau.rintangan });
  const jobAktifId = pratinjau.kondisiSekarang.jobUnit.find((j) => j.type === "DELIVERY" && ACTIVE_JOB_STATUSES.includes(j.status))?.id ?? null;
  const jobId = jobAktifId ?? crypto.randomUUID();
  let tujuan = null; let bukti = null;
  if (foto?.path) {
    const f = periksaBerkasFoto(foto.path, { sha256Diharapkan: foto.sha256 ?? null });
    fs.mkdirSync(jobPhotosDir, { recursive: true });
    const nama = `${jobId}-${Date.now()}-${Math.random().toString(36).slice(2)}${f.ext}`;
    tujuan = path.join(jobPhotosDir, nama);
    fs.writeFileSync(tujuan, f.isi, { flag: "wx", mode: 0o644 });
    bukti = { urls: [`/media/job-photos/${nama}`], sha256: f.sha256, ukuranByte: f.ukuranByte, mime: f.mime, sumber: foto.keterangan ?? foto.path };
  }
  const hapusSalinan = () => { if (tujuan) { try { fs.unlinkSync(tujuan); } catch { /* sudah tidak ada */ } } };
  let hasil;
  try {
    hasil = await prisma.$transaction((tx) => terapkanKoreksiPengirimanRuteInTx(tx, { ...masukan, bukti, jobId }), { timeout: timeoutMs });
  } catch (e) { hapusSalinan(); throw e; }
  if (!hasil.diterapkan) { hapusSalinan(); return hasil; } // diulang/bersamaan: tidak ada salinan yatim
  if (tujuan) {
    const baca = crypto.createHash("sha256").update(fs.readFileSync(tujuan)).digest("hex");
    if (baca !== bukti.sha256) throw new KoreksiRuteError("PERINGATAN: berkas bukti tidak cocok checksum setelah commit — periksa manual", "FOTO_VERIFIKASI_GAGAL", 500, { jobId: hasil.jobId, tujuan });
  }
  return hasil;
}
