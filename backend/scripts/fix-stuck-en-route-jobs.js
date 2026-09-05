// Backfill (5 September 2026) — job PICKUP yang tersangkut EN_ROUTE/ARRIVED
// berhari-hari, memblokir sales/dispatcher menandai order "Terkirim" (guard
// unitEnRoute di routes/orders.js, PATCH /:id cabang DELIVERED — LIHAT
// komentarnya, guard itu MEMANG SENGAJA menolak kalau job masih EN_ROUTE/
// ARRIVED, supaya tidak ada yang bilang "selesai" sementara driver masih di
// jalan).
//
// Ditemukan dari laporan owner: order RES-01092026-004 ditolak sistem saat
// mau ditandai Terkirim ("Unit ... masih dalam perjalanan"), padahal order
// itu sudah Lunas + invoice + garansi terkirim — job Pengambilannya cuma
// lupa ditandai selesai sejak 2 September. Audit produksi menemukan 9 job
// dengan pola sama: dijadwalkan 2 September, ZERO GPS ping tercatat, tidak
// pernah arrivedAt/completedAt — dikonfirmasi owner: "iya sudah finish dan
// terkirim" untuk kasus pertama, dan diminta cek kasus serupa.
//
// Fix: tandai job COMPLETED (+ completedAt) DAN majukan Unit.status persis
// seperti efek samping normal saat job pickup selesai di app (lihat
// routes/armada.js — `status: job.type === "PICKUP" ? "RECEIVED" : "DELIVERED"`)
// — supaya Job dan Unit tetap konsisten, bukan cuma Job-nya saja yang
// "dipalsukan" selesai. TANPA proofPhotoUrls (memang tidak ada bukti foto —
// pekerjaan ini selesai tanpa terdokumentasi lewat app) — job ini akan tetap
// tampil jujur "Belum Lengkap" di verifikasi POD.
//
// Jalankan:
//   node scripts/fix-stuck-en-route-jobs.js            (dry-run, default)
//   node scripts/fix-stuck-en-route-jobs.js --apply     (terapkan)

import { prisma } from "../src/db.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const jobs = await prisma.job.findMany({
    where: { status: { in: ["EN_ROUTE", "ARRIVED"] } },
    include: {
      driver: { select: { name: true } },
      order: { select: { orderNumber: true, status: true, paymentStatus: true } },
      units: { select: { unitId: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  console.log(`Total job EN_ROUTE/ARRIVED: ${jobs.length}`);
  for (const j of jobs) {
    console.log(
      `- ${j.order?.orderNumber} | job ${j.id} | type=${j.type} status=${j.status} -> COMPLETED | driver=${j.driver?.name} | order.status=${j.order?.status} payment=${j.order?.paymentStatus}`
    );
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — tidak ada yang diubah. Jalankan ulang dengan --apply untuk menerapkan.");
    return;
  }

  for (const j of jobs) {
    await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: j.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      const unitIds = j.units.map((u) => u.unitId);
      if (unitIds.length > 0) {
        await tx.unit.updateMany({
          where: { id: { in: unitIds } },
          data: { status: j.type === "PICKUP" ? "RECEIVED" : "DELIVERED" },
        });
      }
    });
    console.log(`Selesai: ${j.order?.orderNumber} (job ${j.id})`);
  }
  console.log(`\nDISINKRON: ${jobs.length} job -> COMPLETED, unit terkait ikut dimajukan.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
