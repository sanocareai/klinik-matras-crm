// Backfill RescheduleCase untuk job LAMA (13 September 2026, D-160 lanjutan
// — permintaan owner: "gapapa yang kasur lama catat menjadi rsc juga biar
// konsisten"). Job yang pernah direschedule SEBELUM fitur RescheduleCase
// live (migration 20260913140000_reschedule_case, diterapkan 12 September
// 2026 13:33 WIB) cuma punya Job.rescheduleReason terisi, tanpa nomor
// kasus RSC-... sama sekali — contoh nyata: Yogi A (RES-19082026-077),
// direschedule jam 12:20, SATU JAM SEBELUM fitur ini live.
//
// SUMBER DATA per job:
//   - JobIssueLog (type RESCHEDULED) — kalau ADA, itu job yang direschedule
//     lewat jalur AFTER_FAILURE/PROACTIVE yang sudah ada SEBELUM fitur ini
//     (POST /issues/:jobId/reschedule atau PATCH /jobs/:id proaktif).
//     Jumlah baris = jumlah ronde sungguhan, cause & previous/newScheduledDate
//     diambil dari baris TERAKHIR (ronde paling baru).
//   - Job.rescheduleReason TANPA JobIssueLog sama sekali — job yang dicatat
//     lewat "Catatan Reschedule" retroaktif (POST /jobs/:id/reschedule-note,
//     job SUDAH Selesai) — jalur ITU MEMANG TIDAK PERNAH menulis
//     JobIssueLog (murni catatan, bukan perubahan status). Round = 1,
//     cause ditebak dari ada/tidaknya JobIssueLog type FAILED untuk job
//     itu (kalau pernah Gagal beneran, AFTER_FAILURE; kalau tidak,
//     PROACTIVE — dispatcher-initiated).
//
// createdAt kasus di-set ke job.rescheduledAt (WAKTU ASLI reschedule-nya
// terjadi, BUKAN waktu skrip ini dijalankan) — supaya urutan kasus di
// daftar Kendala & Reschedule tetap kronologis benar, bukan semua
// menumpuk di "hari ini" seolah baru terjadi.
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/backfill-reschedule-cases.js
//   docker compose exec backend node scripts/backfill-reschedule-cases.js --apply

import { prisma } from "../src/db.js";
import { generateRescheduleCaseNumber } from "../src/services/orderNumberGenerator.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (cuma pratinjau, tidak menulis apa pun)"}`);

  const jobs = await prisma.job.findMany({
    where: { rescheduleReason: { not: null }, rescheduleCaseId: null },
    select: {
      id: true, status: true, completedAt: true, scheduledDate: true,
      rescheduleReason: true, rescheduledAt: true, rescheduledById: true, customerConfirmedReschedule: true,
      order: { select: { orderNumber: true, customer: { select: { name: true } } } },
      issueLogs: {
        where: { type: { in: ["RESCHEDULED", "FAILED"] } },
        orderBy: { createdAt: "asc" },
        select: { type: true, cause: true, previousScheduledDate: true, newScheduledDate: true, createdAt: true },
      },
    },
    orderBy: { rescheduledAt: "asc" },
  });

  if (jobs.length === 0) {
    console.log("Tidak ada job yang perlu di-backfill — semua job dengan rescheduleReason sudah punya kasus.");
    return;
  }

  console.log(`\nDitemukan ${jobs.length} job untuk di-backfill:\n`);

  const rencana = jobs.map((job) => {
    const rescheduleLogs = job.issueLogs.filter((l) => l.type === "RESCHEDULED");
    const pernahGagal = job.issueLogs.some((l) => l.type === "FAILED");
    const round = Math.max(1, rescheduleLogs.length);
    const terakhir = rescheduleLogs[rescheduleLogs.length - 1] || null;
    const cause = terakhir?.cause || (pernahGagal ? "AFTER_FAILURE" : "PROACTIVE");
    const previousScheduledDate = terakhir?.previousScheduledDate ?? null;
    const newScheduledDate = terakhir?.newScheduledDate ?? job.scheduledDate ?? null;
    const status = job.status === "COMPLETED" ? "SELESAI" : "AKTIF";
    const resolvedAt = status === "SELESAI" ? job.completedAt : null;

    return { job, round, cause, previousScheduledDate, newScheduledDate, status, resolvedAt };
  });

  for (const r of rencana) {
    const { job } = r;
    console.log(
      `- ${job.order?.orderNumber || job.id} (${job.order?.customer?.name || "?"}) · ` +
      `ronde ${r.round} · ${r.cause} · status kasus akan jadi ${r.status} · ` +
      `direschedule ${job.rescheduledAt?.toISOString().slice(0, 10) || "?"}`
    );
  }

  if (!APPLY) {
    console.log("\nJalankan ulang dengan --apply untuk benar-benar menulis.");
    return;
  }

  let sukses = 0;
  for (const r of rencana) {
    const { job } = r;
    const caseNumber = await generateRescheduleCaseNumber();
    await prisma.$transaction(async (tx) => {
      const created = await tx.rescheduleCase.create({
        data: {
          caseNumber, jobId: job.id,
          status: r.status, round: r.round, cause: r.cause,
          reason: job.rescheduleReason,
          previousScheduledDate: r.previousScheduledDate, newScheduledDate: r.newScheduledDate,
          customerConfirmed: !!job.customerConfirmedReschedule,
          createdById: job.rescheduledById,
          createdAt: job.rescheduledAt || undefined,
          resolvedAt: r.resolvedAt,
        },
      });
      await tx.job.update({ where: { id: job.id }, data: { rescheduleCaseId: created.id } });
    });
    sukses++;
    console.log(`✓ ${job.order?.orderNumber || job.id} -> ${caseNumber}`);
  }

  console.log(`\nSelesai. ${sukses}/${jobs.length} job diberi nomor kasus.`);
}

main()
  .catch((err) => {
    console.error("Gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
