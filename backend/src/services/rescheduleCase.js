// Kasus Reschedule tersatukan (D-160, 13 September 2026 — audit "skema
// reschedule masih kurang proper dan sistematis"). Lihat catatan panjang di
// schema.prisma model RescheduleCase untuk latar belakang lengkap: KENAPA
// dibangun (JobIssueLog cuma log mentah, tidak punya status "masih aktif
// atau sudah kelar", dan yang paling nyata — job yang direschedule lewat
// jalur lama TIDAK PERNAH dilepas dari Route lamanya, bisa nyangkut diam-
// diam di rute yang sudah COMPLETED, pola sama dengan bug Alwan/
// RTE-110926-01).
//
// SENGAJA TIDAK meniru struktur multi-divisi ComplaintCase (currentOwner,
// ALLOWED_TRANSITIONS antar banyak status) — reschedule murni urusan
// Delivery, tidak pernah pindah tangan ke divisi lain. `openOrAdvanceCase`
// di bawah SENGAJA menerima `tx` (bukan buka transaksi sendiri) karena
// SELALU dipanggil dari DALAM transaksi yang sudah ada di routes/armada.js
// (bersamaan dengan update Job + JobIssueLog) — reschedule harus atomik
// dengan perubahan job itu sendiri, bukan langkah terpisah yang bisa
// setengah-jalan kalau salah satu gagal.

import { generateRescheduleCaseNumber } from "./orderNumberGenerator.js";

export const RESCHEDULE_STATUS_LABEL = {
  AKTIF: "Aktif",
  SELESAI: "Selesai",
  DIBATALKAN: "Dibatalkan",
};

export const RESCHEDULE_CAUSE_LABEL = {
  PROACTIVE: "Proaktif",
  AFTER_FAILURE: "Setelah Gagal",
};

export const rescheduleCaseInclude = {
  job: {
    select: {
      id: true, type: true, status: true,
      order: { select: { id: true, orderNumber: true, customer: { select: { id: true, name: true, phone: true, assignedSalesId: true } } } },
    },
  },
  createdBy: { select: { id: true, name: true } },
};

// Dipanggil dari 2 jalur reschedule yang MENGUBAH job (POST /issues/:jobId/
// reschedule, PATCH /jobs/:id proaktif) — BUKAN dari /jobs/:id/reschedule-
// note (itu catatan retroaktif job yang SUDAH Selesai, tidak pernah
// membuka/melanjutkan kasus, lihat catatan di routes/armada.js).
//
// Job SATU KASUS aktif per job pada satu waktu — kalau job.rescheduleCaseId
// sudah menunjuk kasus yang masih AKTIF, kasus itu DILANJUTKAN (round+1,
// snapshot ronde terbaru menimpa field snapshot), BUKAN bikin kasus baru.
// Histori tiap ronde tetap utuh di JobIssueLog (dicatat terpisah oleh
// pemanggil, tidak diulang di sini).
export async function openOrAdvanceCase(tx, {
  job, cause, reason, previousScheduledDate, newScheduledDate, customerConfirmed, userId,
}) {
  const existingCaseId = job.rescheduleCaseId;
  const existing = existingCaseId
    ? await tx.rescheduleCase.findUnique({ where: { id: existingCaseId } })
    : null;

  if (existing && existing.status === "AKTIF") {
    return tx.rescheduleCase.update({
      where: { id: existing.id },
      data: {
        round: existing.round + 1,
        cause, reason: reason.trim(),
        previousScheduledDate, newScheduledDate,
        customerConfirmed: !!customerConfirmed,
      },
    });
  }

  const caseNumber = await generateRescheduleCaseNumber();
  const created = await tx.rescheduleCase.create({
    data: {
      caseNumber, jobId: job.id,
      cause, reason: reason.trim(),
      previousScheduledDate, newScheduledDate,
      customerConfirmed: !!customerConfirmed,
      createdById: userId,
    },
  });
  await tx.job.update({ where: { id: job.id }, data: { rescheduleCaseId: created.id } });
  return created;
}

// Dipanggil dari POST /jobs/:id/complete — job yang akhirnya BENAR-BENAR
// Selesai menutup kasus reschedule-nya (kalau ada & masih AKTIF). Best-
// effort di dalam transaksi complete yang sudah ada, bukan langkah
// terpisah — job selesai TETAP tercatat selesai walau close case gagal
// (harusnya tidak pernah gagal, cuma UPDATE satu baris).
export async function closeCaseOnJobComplete(tx, jobId) {
  const job = await tx.job.findUnique({ where: { id: jobId }, select: { rescheduleCaseId: true } });
  if (!job?.rescheduleCaseId) return;
  const kase = await tx.rescheduleCase.findUnique({ where: { id: job.rescheduleCaseId }, select: { status: true } });
  if (kase?.status !== "AKTIF") return;
  await tx.rescheduleCase.update({
    where: { id: job.rescheduleCaseId },
    data: { status: "SELESAI", resolvedAt: new Date() },
  });
}

export class RescheduleCaseError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

// POST /reschedule-cases/:id/cancel — dispatcher membatalkan kasus secara
// eksplisit (mis. order dibatalkan total, tidak jadi diantar/diambil sama
// sekali). TIDAK menyentuh job-nya sama sekali — pembatalan job/order
// (kalau memang itu maksudnya) tetap lewat jalur masing-masing yang sudah
// ada, ini cuma menutup kasus reschedule-nya supaya tidak nyangkut AKTIF
// selamanya di daftar Kendala & Reschedule.
export async function cancelCase(tx, caseId, reason) {
  const kase = await tx.rescheduleCase.findUnique({ where: { id: caseId } });
  if (!kase) throw new RescheduleCaseError("Kasus reschedule tidak ditemukan", 404);
  if (kase.status !== "AKTIF") throw new RescheduleCaseError(`Kasus berstatus ${RESCHEDULE_STATUS_LABEL[kase.status]} tidak bisa dibatalkan lagi`);
  if (!reason?.trim()) throw new RescheduleCaseError("Alasan pembatalan wajib diisi");
  return tx.rescheduleCase.update({
    where: { id: caseId },
    data: { status: "DIBATALKAN", cancelReason: reason.trim(), resolvedAt: new Date() },
  });
}
