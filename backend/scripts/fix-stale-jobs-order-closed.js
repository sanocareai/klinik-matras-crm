// Backfill (4 September 2026) — Job "hantu" yang nempel ke Order yang
// SUDAH DELIVERED/CANCELLED, tapi Job-nya sendiri belum pernah ditandai
// selesai (COMPLETED/FAILED).
//
// Root cause: dropdown status manual di Sales CRM (PATCH /orders/:id, cabang
// DELIVERED) cuma memblokir kalau ada unit yang job-nya EN_ROUTE/ARRIVED —
// job yang masih UNSCHEDULED/SCHEDULED/ASSIGNED (atau, untuk data lama,
// ARRIVED) lolos tanpa disinkronkan, jadi nangkring aktif di board Armada/
// Route Planner seolah masih perlu dikerjakan padahal order induknya sudah
// ditutup lewat jalur lain. Ditemukan 4 September 2026 lewat laporan owner:
// order Willy Liu sudah Terkirim/Siap Kirim di Sales CRM, tapi job
// pengambilannya masih tampil "Tiba di Lokasi"/"Menuju Lokasi" di Delivery
// Hub. Audit produksi menemukan 27 order DELIVERED/CANCELLED dengan job
// belum final.
//
// ⚠️ KOREKSI (4 September 2026, setelah diskusi dengan owner): versi
// PERTAMA script ini MENGHAPUS job-job itu — SALAH PENDEKATAN. Data
// Order/Unit di Sales CRM SEMUANYA benar (owner tegaskan langsung), tidak
// ada yang perlu dihapus di sisi Delivery. Yang perlu cuma STATUS Job-nya
// disinkronkan supaya cocok dengan kenyataan (order sudah Terkirim), bukan
// riwayatnya dibuang. Makanya sekarang: UPDATE status jadi COMPLETED
// (+ completedAt), BUKAN deleteMany. Konsisten dengan fungsi
// selesaikanJobBelumJalan() yang baru ditambahkan di routes/orders.js untuk
// mencegah kejadian yang sama ke depan.
//
// SENGAJA TIDAK mengisi proofPhotoUrls — memang tidak ada bukti foto untuk
// pekerjaan yang selesai di luar Armada (servis di tempat/WA manual,
// terutama utk order sebelum akun Driver ada, 19-29 Agustus 2026). Job ini
// akan tetap tampil jujur sebagai "Belum Lengkap" di verifikasi POD, bukan
// berpura-pura terdokumentasi penuh — itu keputusan sadar, bukan bug.
//
// Jalankan:
//   node scripts/fix-stale-jobs-order-closed.js            (dry-run, default)
//   node scripts/fix-stale-jobs-order-closed.js --apply     (terapkan)

import { prisma } from "../src/db.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["DELIVERED", "CANCELLED"] },
      jobs: { some: { status: { notIn: ["COMPLETED", "FAILED"] } } },
    },
    include: {
      customer: { select: { name: true } },
      jobs: {
        where: { status: { notIn: ["COMPLETED", "FAILED"] } },
        include: { driver: { select: { name: true } } },
      },
    },
  });

  console.log(`Order tertutup (DELIVERED/CANCELLED) dengan job belum final: ${orders.length}`);
  let totalJobs = 0;
  for (const o of orders) {
    console.log(`- ${o.id} | ${o.customer?.name || "?"} | order.status=${o.status} | category=${o.category}`);
    for (const j of o.jobs) {
      totalJobs += 1;
      console.log(
        `    job ${j.id} type=${j.type} status=${j.status} -> COMPLETED | tanggal=${j.scheduledDate ? j.scheduledDate.toISOString().slice(0, 10) : "-"} driver=${j.driver?.name || "-"} routeId=${j.routeId || "-"}`
      );
    }
  }
  console.log(`Total job yang akan disinkron jadi COMPLETED: ${totalJobs}`);

  if (!APPLY) {
    console.log("\nDRY-RUN — tidak ada yang diubah. Jalankan ulang dengan --apply untuk menerapkan.");
    return;
  }

  const jobIds = orders.flatMap((o) => o.jobs.map((j) => j.id));
  const result = await prisma.job.updateMany({
    where: { id: { in: jobIds } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  console.log(`\nDISINKRON: ${result.count} job -> COMPLETED (Order/Unit tidak disentuh sama sekali).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
