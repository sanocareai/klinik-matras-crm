// AKSES "MILIK SENDIRI" untuk Pengajuan Biaya workspace DELIVERY oleh Driver/Helper/
// Leader Driver (izin delivery:expense:own:read|write). Semua aturan ditegakkan di
// SERVER; klien hanya menampilkan/menyembunyikan tombol.
//
// Pengguna "own-only" = TIDAK punya jalur lama (finance:post / finance:expense:submit /
// finance:admin). Pengguna jalur lama tidak berubah sedikit pun.

import { SubmissionError } from "./service.js";
import { ownOnly, JALUR_LAMA } from "./ownPolicy.js";

export { ownOnly, JALUR_LAMA };

// Status yang boleh diubah PEMILIK (own-only): draf atau diminta revisi.
export const STATUS_EDITABLE_OWN = ["DRAFT", "PERLU_REVISI"];

// Field yang TIDAK boleh diisi own-only: mencatat atas nama orang lain, uang muka,
// PIC, order, dan catatan sumber/urgensi milik Finance. Dibuang diam-diam? Tidak:
// ditolak eksplisit supaya klien tahu.
const TERLARANG = ["requestedById", "advanceId", "picUserId", "orderId", "costCenter", "requestedAt", "urgentReason", "sourceNote", "paymentMethod"];
const SUMBER_DANA_OWN = ["TALANGAN_PRIBADI"];

export function sanitasiBodyOwn(body = {}) {
  for (const k of TERLARANG) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== "") {
      throw new SubmissionError(`Field "${k}" tidak boleh diisi dari akun ini`, 403);
    }
  }
  if (body.sumberDana && !SUMBER_DANA_OWN.includes(body.sumberDana)) {
    throw new SubmissionError("Sumber dana untuk akun ini hanya boleh 'Ditanggung driver/karyawan dulu'", 403);
  }
  const bersih = { ...body };
  for (const k of TERLARANG) delete bersih[k];
  return bersih;
}

/** Pengajuan harus DELIVERY dan milik sendiri; selain itu 404 (tidak membocorkan keberadaan). */
export async function pastikanMilikSendiri(db, id, user, { statusBoleh = null, semuaDivisi = false } = {}) {
  const s = await db.expenseSubmission.findUnique({
    where: { id },
    select: { id: true, division: true, status: true, requestedById: true, createdById: true },
  });
  if (!s || (!semuaDivisi && s.division !== "DELIVERY") || (s.requestedById !== user.id && s.createdById !== user.id)) {
    throw new SubmissionError("Pengajuan tidak ditemukan", 404);
  }
  if (statusBoleh && !statusBoleh.includes(s.status)) {
    throw new SubmissionError(`Pengajuan berstatus ${s.status} — tidak bisa diubah`, 409);
  }
  return s;
}

/**
 * Relasi harus berkaitan dengan pengguna:
 *  - job    : pengguna driver/helper di job itu
 *  - route  : pengguna driver/helper di rute itu
 *  - vehicle: pengguna PIC kendaraan, atau driver/helper di rute/job yang memakai kendaraan itu
 *  - driverId/helperId: hanya diri sendiri atau rekan di job/rute yang sama
 * Data relasi tidak tersedia (mis. tanpa job/rute) => hanya field kosong yang lolos, sehingga
 * kendaraan tanpa keterkaitan jelas ditolak (bukan dibiarkan lolos).
 */
export async function pastikanRelasiMilikSendiri(db, user, body = {}) {
  const uid = user.id;
  const orang = new Set([uid]);
  let terhubungKendaraan = false;

  if (body.jobId) {
    const j = await db.job.findUnique({ where: { id: body.jobId }, select: { driverId: true, helperId: true, vehicleId: true } });
    if (!j || (j.driverId !== uid && j.helperId !== uid)) throw new SubmissionError("Job ini bukan tugas Anda", 403);
    [j.driverId, j.helperId].filter(Boolean).forEach((x) => orang.add(x));
    if (j.vehicleId && j.vehicleId === body.vehicleId) terhubungKendaraan = true;
  }
  if (body.routeId) {
    const r = await db.route.findUnique({ where: { id: body.routeId }, select: { driverId: true, helperId: true, vehicleId: true } });
    if (!r || (r.driverId !== uid && r.helperId !== uid)) throw new SubmissionError("Rute ini bukan tugas Anda", 403);
    [r.driverId, r.helperId].filter(Boolean).forEach((x) => orang.add(x));
    if (r.vehicleId && r.vehicleId === body.vehicleId) terhubungKendaraan = true;
  }
  if (body.vehicleId && !terhubungKendaraan) {
    const pic = await db.vehicle.findFirst({ where: { id: body.vehicleId, picDriverId: uid }, select: { id: true } });
    const dipakai = pic || await db.route.findFirst({
      where: { vehicleId: body.vehicleId, OR: [{ driverId: uid }, { helperId: uid }] }, select: { id: true },
    }) || await db.job.findFirst({
      where: { vehicleId: body.vehicleId, OR: [{ driverId: uid }, { helperId: uid }] }, select: { id: true },
    });
    if (!dipakai) throw new SubmissionError("Kendaraan ini tidak terkait dengan Anda", 403);
  }
  for (const k of ["driverId", "helperId"]) {
    if (body[k] && !orang.has(body[k])) throw new SubmissionError("Driver/helper hanya boleh diri sendiri atau rekan di job/rute yang sama", 403);
  }
}
