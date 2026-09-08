// Backfill "pengambilan sudah selesai" untuk job PICKUP lama yang belum
// pernah ditandai selesai di sistem (8 September 2026, permintaan owner
// langsung: "clear semua id order Ing Suriati... proses id order
// pengambilan nya bisa minta tolong anggap sudah selesai pengambilan" +
// "semua orderan dari tanggal 5 september kebelakang hingga bulan
// sebelumnya anggap proses pengambilan nya sudah ter record, agar tidak
// rancu di rute planner").
//
// INVESTIGASI dulu (BUKAN langsung dieksekusi) — dua temuan penting:
//
// 1. Permintaan #1 (Ing Suriati) TERNYATA sudah BENAR di database — semua
//    3 pickup order Ing Suriati (RES-31082026-221, RES-31082026-222,
//    RES-01092026-001) SUDAH berstatus COMPLETED. Kartu yang "tampil
//    banyak sekali" di Route Planner itu SUDAH selesai — cuma tidak ada
//    tanda visual "sudah beres" di kartunya (ISU TAMPILAN, bukan data,
//    dilaporkan terpisah ke owner, TIDAK diperbaiki script ini).
//
// 2. Permintaan #2 (batch tanggal) itu yang benar-benar actionable —
//    ditemukan 28 job PICKUP belum COMPLETED, TAPI TIDAK SEMUA aman
//    disentuh cuma dengan filter tanggal order polos: beberapa order
//    LAMA (dibuat <= 5 Sep) ternyata job pickup-nya SEDANG AKTIF SEKARANG
//    (1 EN_ROUTE hari ini "Ibu Erni", 1 ASSIGNED hari ini "Calvin", 1
//    SCHEDULED 15 Oktober "Sabbrina") — kalau ikut ditandai selesai, itu
//    MERUSAK data operasional yang SUNGGUHAN sedang berjalan, bukan
//    membereskan data basi. Scope final di bawah SUDAH memfilter itu.
//
// SCOPE (dikonfirmasi owner via AskUserQuestion, 8 September 2026):
//   - job.type = PICKUP, status IN (UNSCHEDULED, ASSIGNED) — SCHEDULED/
//     EN_ROUTE/ARRIVED/COMPLETED/FAILED/CANCELLED TIDAK disentuh sama
//     sekali (itu semua sinyal "sedang/sudah diproses", bukan basi).
//   - order dibuat SEBELUM 6 September 2026 WIB (mencakup s.d. 5 Sep).
//   - scheduledDate NULL ATAU sudah lewat (< hari ini, WIB) — MENGECUALIKAN
//     job yang scheduledDate-nya hari ini/masa depan (operasi AKTIF).
//   - 2 job ASSIGNED yang overdue (dijadwalkan 7 Sep, sudah lewat tanpa
//     ditandai selesai — Julhan RES-02092026-011, Anna Sampetoding
//     RES-04092026-022) DIKONFIRMASI EKSPLISIT ikut ditandai oleh owner
//     lewat AskUserQuestion, bukan tebakan sepihak.
//
// KENAPA BUKAN LEWAT POST /jobs/:id/complete (endpoint POD normal):
// endpoint itu MEWAJIBKAN foto bukti (FR-D-07, "tanpa kecuali") DAN
// mengirim WA ke CUSTOMER ("unit Anda sudah kami terima") — dua-duanya
// SALAH untuk kasus ini: TIDAK ADA foto asli untuk pengambilan
// berminggu-minggu lalu (bikin foto/link palsu = fabrikasi, dilarang
// keras — CLAUDE.md), dan customer TIDAK PERLU dapat notifikasi "baru
// diterima" untuk sesuatu yang sudah lama terjadi (bisa membingungkan).
//
// Script ini REUSE logic sinkronisasi yang SAMA dengan endpoint asli
// (syncOrderStatusForUnits/syncRouteCompletionStatus dari
// services/orderStatusSync.js — SATU sumber kebenaran, bukan duplikasi
// logic kedua) supaya Order.status & Route.status ikut konsisten, TAPI
// SKIP proofPhotoUrls & notifikasi WA. `completedAt` SENGAJA dibiarkan
// NULL (jujur — kita tidak tahu persis kapan sungguhan terjadi), BUKAN
// diisi tanggal karangan. Konsekuensinya: job-job ini akan tampil "Belum
// Lengkap" (tanpa foto bukti) di POD Review — itu MEMANG benar adanya,
// bukan bug (lihat catatan panjang di armada.js soal kenapa tab itu
// sengaja filter dari scheduledDate, bukan completedAt, persis untuk
// mengakomodasi job seperti ini).
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/backfill-complete-stale-pickups.js
//   docker compose exec backend node scripts/backfill-complete-stale-pickups.js --apply

import { prisma } from "../src/db.js";
import { syncOrderStatusForUnits, syncRouteCompletionStatus } from "../src/services/orderStatusSync.js";

const APPLY = process.argv.includes("--apply");

// Order.createdAt (timestamptz) — batas WIB dinyatakan sebagai offset
// +07:00 eksplisit (CLAUDE.md §11 — Indonesia tidak pernah pakai DST,
// offset tetap) supaya tidak bergantung timezone container (UTC).
const CUTOFF_ORDER_CREATED = new Date("2026-09-06T00:00:00+07:00"); // order dibuat < ini = s.d. 5 Sep WIB

// Job.scheduledDate BEDA — kolom itu `@db.Date` (tanpa jam, timezone-naive
// di Postgres), disimpan/dibaca sebagai tengah malam UTC dari tanggal
// kalendernya (pola SAMA dengan toDateOnly() di routes/armada.js). Sempat
// salah pakai offset +07:00 di sini (seperti CUTOFF_ORDER_CREATED di
// atas) — TERBUKTI SALAH lewat pengujian langsung: Postgres membandingkan
// APA ADANYA sebagai tanggal kalender, "2026-09-07T17:00:00Z" ikut
// dianggap tanggal 7 juga (bukan "lewat tengah malam ke tanggal 8"),
// akibatnya job scheduledDate=7 Sep OVERDUE (Julhan, Anna Sampetoding)
// malah TIDAK ikut ter-filter. Perbaikan: SELALU UTC-midnight polos untuk
// kolom @db.Date, jangan digeser offset WIB sama sekali.
const HARI_INI = new Date("2026-09-08T00:00:00.000Z"); // scheduledDate < ini = sudah lewat

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (cuma pratinjau)"}\n`);

  const jobs = await prisma.job.findMany({
    where: {
      type: "PICKUP",
      status: { in: ["UNSCHEDULED", "ASSIGNED"] },
      order: { createdAt: { lt: CUTOFF_ORDER_CREATED } },
      OR: [{ scheduledDate: null }, { scheduledDate: { lt: HARI_INI } }],
    },
    select: {
      id: true, status: true, scheduledDate: true, routeId: true,
      order: { select: { orderNumber: true, createdAt: true } },
      units: { select: { unitId: true } },
    },
    orderBy: { order: { createdAt: "asc" } },
  });

  console.log(`${jobs.length} job PICKUP stale ditemukan (scope lihat catatan kepala file):\n`);
  for (const j of jobs) {
    const tgl = j.scheduledDate ? j.scheduledDate.toISOString().slice(0, 10) : "(belum dijadwalkan)";
    console.log(`  ${j.order.orderNumber} — job ${j.id.slice(0, 8)}, status ${j.status}, dijadwalkan ${tgl}`);
  }

  if (!APPLY) {
    console.log("\nJalankan ulang dengan --apply untuk benar-benar menulis ke database.");
    return;
  }

  let berhasil = 0;
  for (const j of jobs) {
    await prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id: j.id }, data: { status: "COMPLETED" } });
      const unitIds = j.units.map((u) => u.unitId);
      if (unitIds.length > 0) {
        await tx.unit.updateMany({ where: { id: { in: unitIds } }, data: { status: "RECEIVED" } });
        await syncOrderStatusForUnits(tx, unitIds);
      }
      await syncRouteCompletionStatus(tx, j.routeId);
    });
    console.log(`${j.order.orderNumber}: ditandai selesai.`);
    berhasil++;
  }
  console.log(`\nSelesai — ${berhasil} job ditandai COMPLETED (tanpa foto bukti, tanpa notifikasi WA — lihat catatan kepala file).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
