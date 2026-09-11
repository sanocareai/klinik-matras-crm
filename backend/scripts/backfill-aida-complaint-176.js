// Backfill SATU KALI (12 September 2026) — kasus Aida, RES-27082026-176,
// komplain CMP-11092026-002. Kronologi dari owner: kasur sudah diambil tim
// delivery, direvisi di produksi 11 September sore, dan 12 September siap
// dikirim — tapi job pengambilan (12ea4946-...) di sistem masih ASSIGNED
// (belum pernah ditandai Selesai lewat app, driver/dispatcher tidak sempat
// isi lewat jalur normal), jadi kasus komplainnya masih nyangkut di status
// DIJADWALKAN dan tidak ada jalan bikin job pengiriman baru.
//
// BEDA dari backfill-richard-revision-201.js (10 Sep 2026, sistem lama
// UnitRevision) — kasus ini sudah lewat ComplaintCase (D-116), jadi script
// ini MEMAKAI fungsi service ASLI (transitionStatus/createDeliveryTask dari
// services/complaintCase.js) untuk jalan status kasusnya, bukan menimpa
// kolom manual — supaya validasi transisi, activity log, DAN notifikasi
// tetap jalan APA ADANYA seperti kalau staf yang klik lewat UI. Cuma bagian
// "job pengambilan selesai" (yang di alur normal butuh foto driver) yang
// ditulis manual di sini, karena memang tidak ada foto untuk kejadian yang
// sudah lewat.
//
// PEMAKAIAN (dry-run dulu):
//   node scripts/backfill-aida-complaint-176.js
//   node scripts/backfill-aida-complaint-176.js --apply

import { prisma } from "../src/db.js";
import { transitionStatus, createDeliveryTask, STATUS_LABEL } from "../src/services/complaintCase.js";
import { syncOrderStatusForUnits } from "../src/services/orderStatusSync.js";

const APPLY = process.argv.includes("--apply");

const CASE_NUMBER = "CMP-11092026-002";
const PICKUP_COMPLETED_AT = new Date("2026-09-11T17:00:00+07:00"); // "kemarin sore tanggal 11"
const ACTOR_NOTE = "Backfill retroaktif — dikonfirmasi owner: kasur sudah diambil, direvisi produksi 11 Sep sore, siap kirim 12 Sep.";

async function main() {
  const kase = await prisma.complaintCase.findUnique({
    where: { caseNumber: CASE_NUMBER },
    include: {
      order: { select: { id: true, orderNumber: true, status: true } },
      unit: { select: { id: true, unitCode: true, status: true } },
      jobs: { select: { id: true, type: true, status: true, completedAt: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!kase) throw new Error(`Kasus ${CASE_NUMBER} tidak ditemukan`);
  if (!kase.unit) throw new Error(`Kasus ${CASE_NUMBER} tidak punya unit tertaut`);

  const pickupJob = kase.jobs.find((j) => j.type === "PICKUP" && j.status !== "COMPLETED");
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("Tidak ada user ber-role ADMIN untuk atribusi aksi ini");

  console.log(`Kasus: ${kase.caseNumber} — status sekarang: ${STATUS_LABEL[kase.status] || kase.status} (owner: ${kase.currentOwner})`);
  console.log(`Order: ${kase.order.orderNumber}, unit: ${kase.unit.unitCode} (status ${kase.unit.status})`);
  console.log(`Job pengambilan belum selesai: ${pickupJob ? `${pickupJob.id} (${pickupJob.status})` : "tidak ada / sudah selesai"}`);
  console.log(`Diatribusikan sebagai: ${admin.name} (${admin.id})`);
  console.log("\nRencana:");
  if (pickupJob) console.log(`  1. Tandai job pengambilan ${pickupJob.id} Selesai (completedAt ${PICKUP_COMPLETED_AT.toISOString()}), unit -> READY_FOR_DELIVERY, sync status order.`);
  console.log(`  2. Jalankan kasus lewat status resmi: DIJADWALKAN -> DALAM_PENANGANAN -> QC -> SIAP_DIKIRIM.`);
  console.log(`  3. Buat Delivery Task (job pengiriman baru, UNSCHEDULED) lewat createDeliveryTask — kasus otomatis -> DIKIRIM_ULANG.`);

  if (!APPLY) {
    console.log("\n[dry-run] Tidak ada perubahan disimpan. Jalankan ulang dengan --apply untuk benar-benar menyimpan.");
    return;
  }

  if (pickupJob) {
    await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: pickupJob.id },
        data: { status: "COMPLETED", completedAt: PICKUP_COMPLETED_AT },
      });
      await tx.unit.update({ where: { id: kase.unit.id }, data: { status: "READY_FOR_DELIVERY" } });
      await syncOrderStatusForUnits(tx, [kase.unit.id]);
    });
    console.log(`[applied] Job pengambilan ${pickupJob.id} ditandai Selesai, unit -> READY_FOR_DELIVERY.`);
  }

  let current = await prisma.complaintCase.findUnique({ where: { id: kase.id }, select: { status: true } });
  const path = ["DALAM_PENANGANAN", "QC", "SIAP_DIKIRIM"];
  for (const status of path) {
    if (current.status === status) continue; // sudah di titik ini, jangan transisi ulang
    const updated = await transitionStatus(kase.id, { status, note: ACTOR_NOTE }, admin.id);
    console.log(`[applied] Kasus -> ${STATUS_LABEL[status] || status}`);
    current = updated;
  }

  const withDeliveryTask = await createDeliveryTask(kase.id, { jobType: "DELIVERY", accessNotes: undefined }, admin.id);
  const deliveryJob = withDeliveryTask.jobs.find((j) => j.type === "DELIVERY" && j.status !== "COMPLETED");
  console.log(`[applied] Kasus -> ${STATUS_LABEL[withDeliveryTask.status]}. Job pengiriman baru: ${deliveryJob?.id} (UNSCHEDULED, siap dijadwalkan).`);
  console.log("\nLangkah berikutnya: dispatcher jadwalkan job pengiriman ini lewat Jadwal & Penugasan / Route Planner seperti biasa.");
}

main()
  .catch((err) => {
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
