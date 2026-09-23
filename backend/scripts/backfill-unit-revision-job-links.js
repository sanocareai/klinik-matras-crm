// Backfill UnitRevisionJobLink dari UnitRevision.jobId (audit insentif,
// 24 September 2026) — tabel unit_revision_job_links BARU dibuat di slice
// ini (lihat migration 20260924010000_unit_revision_job_link), jadi setiap
// revisi yang jobId-nya SUDAH terisi SEBELUM slice ini perlu baris riwayat
// yang setara ditulis manual sekali, supaya mesin insentif (yang sekarang
// membaca unit_revision_job_links, BUKAN lagi UnitRevision.jobId) langsung
// mengenali job-job yang sudah ada.
//
// HANYA membackfill relasi yang BISA DIBUKTIKAN dari UnitRevision.jobId
// SAAT INI (role = job.type job itu, fakta langsung dari kolomnya sendiri,
// BUKAN tebakan) — SENGAJA TIDAK mencoba menebak job PICKUP LAMA yang
// sudah ditimpa (revisi yang sudah naik ke tahap DELIVERY sebelum slice
// ini ada). Kandidat semacam itu cuma DILAPORKAN (hitungan, bukan daftar
// yang dieksekusi), TIDAK PERNAH ditulis ke unit_revision_job_links —
// menulis tebakan ke tabel yang namanya sendiri berarti "riwayat yang
// TERBUKTI" akan merusak jaminan yang jadi alasan tabel ini dibuat.
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/backfill-unit-revision-job-links.js
//   docker compose exec backend node scripts/backfill-unit-revision-job-links.js --apply
import { prisma } from "../src/db.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const revisions = await prisma.unitRevision.findMany({
    where: { jobId: { not: null } },
    select: { id: true, jobId: true, status: true, job: { select: { id: true, type: true } } },
  });

  let backfilled = 0, sudahAda = 0, jobHilang = 0;
  const rencana = [];
  for (const r of revisions) {
    // Defensif — FK Restrict di schema seharusnya mencegah ini, tapi
    // dicek eksplisit alih-alih diam-diam melempar exception di tengah loop.
    if (!r.job) { jobHilang++; continue; }
    const existing = await prisma.unitRevisionJobLink.findUnique({ where: { jobId: r.jobId } });
    if (existing) { sudahAda++; continue; }
    rencana.push({ unitRevisionId: r.id, jobId: r.jobId, role: r.job.type });
  }

  if (APPLY) {
    for (const item of rencana) {
      await prisma.unitRevisionJobLink.create({ data: item });
      backfilled++;
    }
  }

  // Kandidat historis TAK TERBUKTI (murni hitungan, TIDAK ditulis apa pun):
  // revisi yang jobId SEKARANG menunjuk job DELIVERY dan statusnya sudah
  // melewati PICKUP_SCHEDULED — secara alur (REQUESTED -> PICKUP_SCHEDULED
  // -> IN_REWORK -> READY_REDELIVER -> REDELIVERED -> CONFIRMED) ini
  // MENGISYARATKAN pernah ada job PICKUP sebelumnya, tapi jobId-nya sudah
  // ditimpa create-delivery-job sebelum tabel riwayat ini ada — TIDAK ADA
  // field lain di schema yang membuktikan id job PICKUP itu.
  const kandidatTakTerbukti = await prisma.unitRevision.findMany({
    where: {
      job: { type: "DELIVERY" },
      status: { in: ["READY_REDELIVER", "REDELIVERED", "CONFIRMED"] },
    },
    select: { id: true, status: true, createdAt: true },
  });

  console.log(JSON.stringify({
    mode: APPLY ? "APPLY" : "DRY-RUN",
    totalRevisiDenganJobId: revisions.length,
    sudahAdaLinknya: sudahAda,
    jobHilangDariFK: jobHilang,
    linkBaru: APPLY ? backfilled : rencana.length,
    rencanaAtauHasil: rencana.map((r) => ({ ...r, ditulis: APPLY })),
    kandidatPickupHistorisTakTerbukti: {
      jumlah: kandidatTakTerbukti.length,
      catatan: "HANYA hitungan/daftar — TIDAK ditulis ke unit_revision_job_links. Perlu keputusan manusia kalau ingin ditutup, bukan ditebak otomatis di sini.",
      daftar: kandidatTakTerbukti,
    },
  }, null, 2));
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
