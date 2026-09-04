// Backfill (4 September 2026) — Job "hantu" yang nempel ke Order yang
// SUDAH DELIVERED/CANCELLED, tapi Job-nya sendiri belum pernah ditandai
// selesai (COMPLETED/FAILED).
//
// Root cause: dropdown status manual di Sales CRM (PATCH /orders/:id)
// membiarkan admin/sales menutup order "Terkirim" selama tidak ada unit
// yang job-nya EN_ROUTE/ARRIVED (lihat guard di routes/orders.js) — tapi
// guard itu TIDAK menjaring job berstatus UNSCHEDULED/SCHEDULED/ASSIGNED,
// jadi job-job itu tertinggal aktif di board Armada/Route Planner seolah
// masih perlu dikerjakan, padahal order-nya sendiri sudah ditutup lewat
// jalur lain. Ditemukan 4 September 2026 lewat laporan owner: Willy Liu
// order Terkirim/Siap Kirim tapi masih tampak "Tiba di Lokasi"/"Menuju
// Lokasi" di halaman Job. Fix di kode: routes/orders.js sekarang memanggil
// hapusJobBelumJalan() juga di cabang DELIVERED (sebelumnya cuma CANCELLED)
// — script ini membersihkan data LAMA yang sudah kejadian sebelum fix itu.
//
// SENGAJA hapus (bukan mark COMPLETED) — konsisten dengan hapusJobBelumJalan
// di orders.js: job yang belum sungguh-sungguh jalan (bukan EN_ROUTE/ARRIVED)
// tidak punya nilai historis untuk disimpan sebagai "selesai".
//
// Job yang SUDAH EN_ROUTE/ARRIVED TETAP ikut dibersihkan di sini (beda dari
// guard di kode yang mencegah kasus BARU ke depan) — karena order induknya
// SUDAH DELIVERED/CANCELLED, kondisi lapangan itu sendiri sudah menyalip apa
// pun status job-nya; nge-block sekarang cuma bikin data lama tidak pernah
// bisa dibersihkan. Verifikasi manual dulu lewat daftar dry-run di bawah
// sebelum --apply.
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
        `    job ${j.id} type=${j.type} status=${j.status} tanggal=${j.scheduledDate ? j.scheduledDate.toISOString().slice(0, 10) : "-"} driver=${j.driver?.name || "-"} routeId=${j.routeId || "-"}`
      );
    }
  }
  console.log(`Total job yang akan dihapus: ${totalJobs}`);

  if (!APPLY) {
    console.log("\nDRY-RUN — tidak ada yang diubah. Jalankan ulang dengan --apply untuk menerapkan.");
    return;
  }

  const jobIds = orders.flatMap((o) => o.jobs.map((j) => j.id));
  const result = await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
  console.log(`\nDIHAPUS: ${result.count} job (JobUnit ikut terhapus lewat cascade).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
