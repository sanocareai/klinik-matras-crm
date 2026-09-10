// Backfill SATU KALI (10 September 2026) — kasus Richard, RES-30082026-201.
// Lihat catatan panjang di schema.prisma RevisionTrigger.KOMPLAIN_ANTAR
// untuk kronologinya: driver antar 2 kasur, customer QC di tempat & minta
// 1 kasur dipendekkan lagi, kasur diambil balik HARI ITU JUGA — tapi job
// pengiriman aslinya sudah COMPLETED, jadi tidak pernah masuk sistem Retur
// (UnitRevision) sama sekali lewat jalur normal (endpoint POST /jobs biasa
// MENOLAK order yang sudah DELIVERED — lihat komentar panjang di
// POST /revisions/:id/create-delivery-job).
//
// SAAT script ini ditulis, OWNER SENDIRI sudah lebih dulu masuk lewat UI
// Retur dan membuat UnitRevision (trigger KENYAMANAN — belum ada
// KOMPLAIN_ANTAR saat itu, status IN_REWORK, jobId sudah ditempel ke job
// pengambilan ad-hoc yang sama). Script ini REUSE revisi itu (bukan bikin
// duplikat): perbaiki triggernya ke KOMPLAIN_ANTAR yang baru ditambahkan,
// majukan ke READY_REDELIVER (owner konfirmasi 10 Sep: produksi SUDAH
// SELESAI, siap kirim besok), lalu buat job DELIVERY baru — path FALLBACK
// (buat revisi dari nol) tetap ada kalau ternyata belum ada revisi sama
// sekali saat dijalankan.
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

  console.log(`Unit: ${unit.unitCode} (${unit.id}), status saat ini: ${unit.status}`);
  console.log(`Order: ${unit.order.orderNumber}, status: ${unit.order.status}`);

  if (existingRevision) {
    console.log(`Revisi AKTIF sudah ada: ${existingRevision.id} (trigger=${existingRevision.trigger}, status=${existingRevision.status}, jobId=${existingRevision.jobId})`);
    console.log(`Rencana: REUSE revisi ini — set trigger=KOMPLAIN_ANTAR, status=READY_REDELIVER, lalu buat job DELIVERY baru (UNSCHEDULED) untuk besok.`);
  } else {
    console.log(`Belum ada revisi aktif untuk unit ini.`);
    console.log(`Rencana: buat UnitRevision baru (trigger=KOMPLAIN_ANTAR, status=READY_REDELIVER, jobId=job pengambilan ${pickupJob.id}), lalu buat job DELIVERY baru (UNSCHEDULED) untuk besok.`);
  }

  if (!APPLY) {
    console.log("\n[dry-run] Tidak ada perubahan disimpan. Jalankan ulang dengan --apply untuk benar-benar menyimpan.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    let revisionId;
    if (existingRevision) {
      if (existingRevision.status === "READY_REDELIVER" || existingRevision.status === "REDELIVERED") {
        revisionId = existingRevision.id; // sudah di titik yang benar, jangan mundur
      } else {
        const updated = await tx.unitRevision.update({
          where: { id: existingRevision.id },
          data: { trigger: "KOMPLAIN_ANTAR", status: "READY_REDELIVER" },
        });
        revisionId = updated.id;
      }
    } else {
      const created = await tx.unitRevision.create({
        data: {
          unitId: unit.id,
          trigger: "KOMPLAIN_ANTAR",
          complaint: COMPLAINT_TEXT,
          status: "READY_REDELIVER",
          jobId: pickupJob.id,
        },
      });
      revisionId = created.id;
    }

    // Guard sama dengan POST /revisions/:id/create-delivery-job — jangan
    // bikin job pengiriman KEDUA kalau revisi ini sudah punya satu yang aktif.
    const currentJobId = existingRevision?.jobId;
    if (currentJobId && currentJobId !== pickupJob.id) {
      const linkedJob = await tx.job.findUnique({ where: { id: currentJobId } });
      const ACTIVE = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];
      if (linkedJob?.type === "DELIVERY" && ACTIVE.includes(linkedJob.status)) {
        return { revisionId, deliveryJobId: linkedJob.id, reused: true };
      }
    }

    const deliveryJob = await tx.job.create({
      data: {
        type: "DELIVERY",
        orderId: unit.orderId,
        accessNotes: `Pengiriman ulang setelah revisi komplain saat antar — ${COMPLAINT_TEXT}`,
      },
    });
    await tx.jobUnit.create({ data: { jobId: deliveryJob.id, unitId: unit.id } });
    await tx.unitRevision.update({ where: { id: revisionId }, data: { jobId: deliveryJob.id } });

    return { revisionId, deliveryJobId: deliveryJob.id, reused: false };
  });

  console.log(`\n[applied] UnitRevision: ${result.revisionId} (status READY_REDELIVER)`);
  console.log(
    result.reused
      ? `[applied] Sudah ada job pengiriman aktif: ${result.deliveryJobId} — dipakai apa adanya, tidak bikin baru.`
      : `[applied] Job pengiriman baru (UNSCHEDULED, siap dijadwalkan besok): ${result.deliveryJobId}`
  );
  console.log("Langkah berikutnya: dispatcher jadwalkan job ini lewat Jadwal & Penugasan / Route Planner seperti biasa.");
}

main()
  .catch((err) => {
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
