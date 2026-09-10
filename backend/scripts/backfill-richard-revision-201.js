// Backfill SATU KALI (10 September 2026) — kasus Richard, RES-30082026-201.
// Lihat catatan panjang di schema.prisma RevisionTrigger.KOMPLAIN_ANTAR
// untuk kronologinya: driver antar 2 kasur, customer QC di tempat & minta
// 1 kasur dipendekkan lagi, kasur diambil balik HARI ITU JUGA — tapi job
// pengiriman aslinya sudah COMPLETED, jadi tidak pernah masuk sistem Retur
// (UnitRevision) sama sekali. Sales sudah lapor komplain (Order.hasComplaint,
// PATCH /orders/:id/complaint) dan dispatcher sudah bikin job pengambilan
// AD-HOC (di luar sistem Retur) untuk mencatat pengambilan baliknya — script
// ini MENYAMBUNGKAN yang sudah terjadi itu ke sistem Retur yang sebenarnya
// (supaya bisa lahir job pengiriman baru untuk besok — endpoint POST /jobs
// biasa MENOLAK order yang sudah DELIVERED, lihat komentar panjang di
// POST /revisions/:id/create-delivery-job), BUKAN membangun ulang riwayat.
//
// Owner mengonfirmasi (10 Sep 2026): produksi SUDAH SELESAI merevisi, siap
// dikirim besok — jadi status UnitRevision di-set LANGSUNG ke READY_REDELIVER
// (bukan jalan REQUESTED→PICKUP_SCHEDULED→IN_REWORK step-by-step yang
// normalnya dipakai untuk revisi yang BELUM terjadi) — dan job pengambilan
// yang SUDAH ADA (dibuat ad-hoc, completedAt mencerminkan kejadian nyata
// 8 Sept) ditempelkan sebagai jobId, bukan dibuat baru (owner konfirmasi:
// "Ya, pakai yang sudah ada").
//
// PEMAKAIAN (dry-run dulu):
//   node scripts/backfill-richard-revision-201.js
//   node scripts/backfill-richard-revision-201.js --apply

import { prisma } from "../src/db.js";

const APPLY = process.argv.includes("--apply");

const ORDER_NUMBER = "RES-30082026-201";
const EXISTING_PICKUP_JOB_ID = "7410ff7b-a476-41be-8bb3-cf5756a8d308";
const COMPLAINT_TEXT =
  "Ada 2 kasur, yang satu perlu dibalikin untuk dipendekkan (dipotong) sesuai permintaan customer — sudah dikonfirmasi sales.";

async function main() {
  const unit = await prisma.unit.findFirst({
    where: { order: { orderNumber: ORDER_NUMBER } },
    include: { order: { select: { id: true, orderNumber: true, status: true } } },
  });
  if (!unit) throw new Error(`Unit untuk order ${ORDER_NUMBER} tidak ditemukan`);

  const pickupJob = await prisma.job.findUnique({ where: { id: EXISTING_PICKUP_JOB_ID } });
  if (!pickupJob) throw new Error(`Job pengambilan ${EXISTING_PICKUP_JOB_ID} tidak ditemukan`);
  if (pickupJob.orderId !== unit.orderId) {
    throw new Error(`Job pengambilan ${EXISTING_PICKUP_JOB_ID} bukan milik order ${ORDER_NUMBER}`);
  }

  const existingRevision = await prisma.unitRevision.findFirst({
    where: { unitId: unit.id, status: { notIn: ["CONFIRMED", "CANCELLED"] } },
  });
  if (existingRevision) {
    throw new Error(`Unit ${unit.unitCode} sudah punya revisi aktif (${existingRevision.id}, status ${existingRevision.status}) — tidak dijalankan lagi supaya tidak dobel`);
  }

  console.log(`Unit: ${unit.unitCode} (${unit.id}), status saat ini: ${unit.status}`);
  console.log(`Order: ${unit.order.orderNumber}, status: ${unit.order.status}`);
  console.log(`Job pengambilan yang akan ditempel: ${pickupJob.id} (selesai ${pickupJob.completedAt})`);
  console.log(`Rencana: buat UnitRevision (trigger=KOMPLAIN_ANTAR, status=READY_REDELIVER, jobId=job pengambilan di atas), lalu buat job DELIVERY baru (UNSCHEDULED) untuk besok.`);

  if (!APPLY) {
    console.log("\n[dry-run] Tidak ada perubahan disimpan. Jalankan ulang dengan --apply untuk benar-benar menyimpan.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const revision = await tx.unitRevision.create({
      data: {
        unitId: unit.id,
        trigger: "KOMPLAIN_ANTAR",
        complaint: COMPLAINT_TEXT,
        status: "READY_REDELIVER",
        jobId: pickupJob.id,
      },
    });

    const deliveryJob = await tx.job.create({
      data: {
        type: "DELIVERY",
        orderId: unit.orderId,
        accessNotes: `Pengiriman ulang setelah revisi komplain saat antar — ${COMPLAINT_TEXT}`,
      },
    });
    await tx.jobUnit.create({ data: { jobId: deliveryJob.id, unitId: unit.id } });
    await tx.unitRevision.update({ where: { id: revision.id }, data: { jobId: deliveryJob.id } });

    return { revisionId: revision.id, deliveryJobId: deliveryJob.id };
  });

  console.log(`\n[applied] UnitRevision dibuat: ${result.revisionId}`);
  console.log(`[applied] Job pengiriman baru (UNSCHEDULED, siap dijadwalkan besok): ${result.deliveryJobId}`);
  console.log("Langkah berikutnya: dispatcher jadwalkan job ini lewat Jadwal & Penugasan / Route Planner seperti biasa.");
}

main()
  .catch((err) => {
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
