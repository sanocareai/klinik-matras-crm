// Perbaikan unit order kategori BARU yang terlanjur lahir salah (D-051,
// 4 September 2026).
//
// LATAR: sampai commit ini, services/unitProvisioning.js#createUnitsForOrder
// memakai unitStatusFromOrderStatus(order.status) untuk SEMUA kategori order
// — order baru selalu Order.status="PENDING", jadi SEMUA unit (termasuk
// kategori BARU, kasur yang dibuat dari nol, bukan barang lama customer)
// lahir AWAITING_PICKUP dan langsung dapat Job type PICKUP ("Pengambilan")
// dari ensurePickupJobForOrder(). Itu salah kaprah: tidak ada apa pun untuk
// "diambil" dari customer pada order BARU — unitnya seharusnya langsung
// RECEIVED (setara "sudah di workshop, siap mulai produksi"), TANPA job
// pickup sama sekali. Contoh nyata yang memicu perbaikan ini: order
// NEW-30082026-022..026 (Leo Witarsa) muncul di Delivery Hub sebagai job
// "Pengambilan" padahal kategorinya BARU.
//
// Kode sudah diperbaiki (createUnitsForOrder sekarang bercabang lewat
// order.category) — script ini HANYA membereskan data yang SUDAH TERLANJUR
// dibuat sebelum perbaikan itu ada.
//
// LINGKUP PERBAIKAN (sengaja SEMPIT, bukan "semua unit BARU bermasalah"):
//   - Order.category === "BARU"
//   - Unit.status === "AWAITING_PICKUP"   (BUKAN IN_TRANSIT_IN — itu berarti
//     job pickup-nya SUDAH di-EN_ROUTE/lebih jauh, ada aktivitas manusia
//     nyata di baliknya, perlu ditinjau manual, bukan ditimpa otomatis)
//   - Job PICKUP terkait berstatus UNSCHEDULED (belum disentuh dispatcher
//     sama sekali — aman dihapus, SAMA aturannya dengan
//     ensurePickupJobForOrder() yang cuma menggabung ke job UNSCHEDULED)
//
// Unit yang TIDAK memenuhi ketiganya (mis. job pickup sudah SCHEDULED/
// ASSIGNED — dispatcher sudah menugaskan driver sungguhan untuk "mengambil"
// sesuatu yang sebenarnya tidak perlu diambil) DICETAK sebagai peringatan,
// TIDAK disentuh — itu perlu keputusan manusia (mungkin drivernya perlu
// diberi tahu untuk batal), bukan skrip yang menghapus job diam-diam.
//
// PERBAIKAN PER UNIT (dalam satu transaksi):
//   1. Hapus baris JobUnit yang menautkan unit ini ke job PICKUP tsb.
//   2. Kalau job itu jadi tidak berisi unit apa pun lagi, hapus job-nya
//      (JobUnit.job onDelete:Cascade menghapus baris JobUnit lain job itu
//      juga, tapi kita hapus SATU baris JobUnit dulu baru cek sisa —
//      urutan ini supaya unit LAIN di job yang sama, kalau ada, tidak ikut
//      kehilangan job-nya tanpa alasan).
//   3. Unit.status -> RECEIVED.
//   4. syncOrderStatus(order) — supaya Order.status ikut ter-hitung ulang
//      kalau unit ini kebetulan satu-satunya penentu status order.
//
// DEFAULT DRY-RUN — tidak mengubah apa pun sampai dijalankan dengan --apply.
// Pola sama dengan scripts/fix-lid-customers.js / backfill-missing-units.js.
// Script ini 2 FASE (lihat komentar fixOrderStatusFase2() di bawah untuk
// alasan fase 2 ditambahkan belakangan): fase 1 Unit.status + job pickup
// palsu, fase 2 Order.status yang ketinggalan karena syncOrderStatus()
// no-op sebelum currentStageId terisi. Keduanya jalan dalam satu run.
//
//   docker compose exec backend node scripts/fix-baru-order-units.js
//   docker compose exec backend node scripts/fix-baru-order-units.js --apply

import { prisma } from "../src/db.js";
import { syncOrderStatus } from "../src/services/orderStatusSync.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "=== MODE APPLY — akan menulis ke database ===" : "=== DRY-RUN — tidak ada yang diubah ===");
  console.log("");

  const units = await prisma.unit.findMany({
    where: {
      status: "AWAITING_PICKUP",
      order: { category: "BARU" },
    },
    include: {
      order: { select: { id: true, orderNumber: true, category: true, customer: { select: { name: true } } } },
      jobUnits: {
        include: { job: { select: { id: true, type: true, status: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (units.length === 0) {
    console.log("Tidak ada unit BARU berstatus AWAITING_PICKUP. Tidak ada yang perlu dikerjakan.");
    return;
  }

  const amanDiperbaiki = [];
  const perluTinjauan = [];

  for (const u of units) {
    const pickupJobUnits = u.jobUnits.filter((ju) => ju.job.type === "PICKUP");
    if (pickupJobUnits.length === 0) {
      // Unit AWAITING_PICKUP tanpa job PICKUP sama sekali (mis. job-nya
      // sempat dihapus manual) — cukup perbaiki status, tidak ada job yang
      // perlu diurus.
      amanDiperbaiki.push({ unit: u, jobUnit: null });
      continue;
    }
    const semuaUnscheduled = pickupJobUnits.every((ju) => ju.job.status === "UNSCHEDULED");
    if (semuaUnscheduled) {
      for (const ju of pickupJobUnits) amanDiperbaiki.push({ unit: u, jobUnit: ju });
    } else {
      perluTinjauan.push({ unit: u, jobUnits: pickupJobUnits });
    }
  }

  console.log(`Unit BARU berstatus AWAITING_PICKUP: ${units.length}`);
  console.log(`  aman diperbaiki otomatis : ${amanDiperbaiki.length}`);
  console.log(`  PERLU TINJAUAN MANUAL    : ${perluTinjauan.length}`);
  console.log("");

  if (perluTinjauan.length > 0) {
    console.log("--- PERLU TINJAUAN MANUAL (job pickup sudah disentuh dispatcher, TIDAK disentuh skrip ini) ---");
    for (const { unit: u, jobUnits } of perluTinjauan) {
      const statuses = jobUnits.map((ju) => `${ju.job.id.slice(0, 8)}:${ju.job.status}`).join(", ");
      console.log(`  ${u.order.orderNumber || u.orderId}  ${u.unitCode}  ${u.order.customer?.name || "?"}  job(${statuses})`);
    }
    console.log("");
  }

  console.log("--- akan diperbaiki: status -> RECEIVED, job PICKUP UNSCHEDULED dihapus ---");
  for (const { unit: u, jobUnit } of amanDiperbaiki) {
    console.log(
      `  ${u.order.orderNumber || u.orderId}  ${u.unitCode}  ${u.order.customer?.name || "?"}` +
      (jobUnit ? `  job ${jobUnit.job.id.slice(0, 8)} dihapus` : "  (tidak ada job pickup terkait)")
    );
  }
  console.log("");

  if (!APPLY) {
    console.log("Dry-run selesai. Jalankan ulang dengan --apply untuk menerapkan.");
    return;
  }

  let berhasil = 0;
  let gagal = 0;
  // Satu job PICKUP bisa menaungi >1 unit (order dengan beberapa unit
  // sekaligus) — kumpulkan dulu per jobId supaya "hapus job kalau sudah
  // tidak berisi unit apa pun lagi" dihitung dengan benar walau beberapa
  // baris amanDiperbaiki menunjuk job yang sama.
  const unitIdsPerJob = new Map();
  for (const { jobUnit } of amanDiperbaiki) {
    if (!jobUnit) continue;
    const set = unitIdsPerJob.get(jobUnit.job.id) || new Set();
    set.add(jobUnit.unitId);
    unitIdsPerJob.set(jobUnit.job.id, set);
  }

  for (const { unit: u, jobUnit } of amanDiperbaiki) {
    try {
      await prisma.$transaction(async (tx) => {
        if (jobUnit) {
          await tx.jobUnit.delete({ where: { id: jobUnit.id } });
          const sisaUnit = await tx.jobUnit.count({ where: { jobId: jobUnit.job.id } });
          if (sisaUnit === 0) await tx.job.delete({ where: { id: jobUnit.job.id } });
        }
        await tx.unit.update({ where: { id: u.id }, data: { status: "RECEIVED" } });
        await syncOrderStatus(tx, u.order.id);
      });
      berhasil += 1;
    } catch (err) {
      gagal += 1;
      console.error(`  GAGAL ${u.order.orderNumber || u.orderId} ${u.unitCode}: ${err.message}`);
    }
  }

  console.log("");
  console.log(`Selesai. Unit diperbaiki: ${berhasil}, gagal: ${gagal}, dilewati (perlu tinjauan manual): ${perluTinjauan.length}`);
}

// ─── FASE 2 (ditambahkan sama hari, ditemukan lewat halaman baru "Semua
// Order"): koreksi Order.status ──────────────────────────────────────────
//
// FASE 1 di atas (main()) memperbaiki Unit.status, dan MEMANGGIL
// syncOrderStatus() supaya Order.status ikut ter-hitung ulang. Tapi
// syncOrderStatus() (orderStatusSync.js#computeOrderStatus) SENGAJA no-op
// selama TIDAK ADA unit order itu yang currentStageId-nya terisi —
// currentStageId baru diisi startStage(), yaitu begitu Produksi BENAR-BENAR
// menekan "Mulai Tahap". Untuk 10 order yang baru saja diperbaiki di FASE 1,
// unit-nya memang belum pernah mulai tahap produksi apa pun (wajar — mereka
// baru saja "dibebaskan" dari AWAITING_PICKUP palsu) — jadi FASE 1 SELESAI
// TANPA benar-benar mengubah Order.status, dan order-order itu TETAP
// tampil "Pengambilan"/"Menunggu" di Sales CRM & halaman Semua Order,
// walau Unit.status-nya sudah benar RECEIVED.
//
// unitProvisioning.js#createUnitsForOrder SUDAH diperbaiki (lihat koreksi
// D-051 lanjutan di sana) supaya order BARU BARU LAHIR langsung dapat
// Order.status=PROCESSING — fase ini HANYA membereskan order LAMA yang
// terlanjur diperbaiki FASE 1 sebelum perbaikan itu ada.
//
// LINGKUP: Order.category=BARU, TIDAK statusLocked, status masih
// PENDING/PICKUP, TAPI semua unit hidupnya SUDAH lewat AWAITING_PICKUP/
// IN_TRANSIT_IN (tidak ada lagi yang benar-benar "menunggu diambil") —
// tanda pasti order ini salah satu korban FASE 1 (atau kejadian serupa).
async function fixOrderStatusFase2() {
  const orders = await prisma.order.findMany({
    where: {
      category: "BARU",
      statusLocked: false,
      status: { in: ["PENDING", "PICKUP"] },
      units: {
        none: { status: { in: ["AWAITING_PICKUP", "IN_TRANSIT_IN"] } },
        some: { status: { not: "CANCELLED" } },
      },
    },
    select: { id: true, orderNumber: true, status: true, customer: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (orders.length === 0) {
    console.log("[Fase 2] Tidak ada Order.status BARU yang perlu dikoreksi.");
    return;
  }

  console.log(`[Fase 2] Order.status akan dikoreksi ke PROCESSING: ${orders.length}`);
  for (const o of orders) {
    console.log(`  ${o.orderNumber || o.id}  ${o.customer?.name || "?"}  ${o.status} -> PROCESSING`);
  }
  console.log("");

  if (!APPLY) return;

  let berhasil = 0, gagal = 0;
  for (const o of orders) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: o.id }, data: { status: "PROCESSING" } });
        await tx.orderStatusTransition.create({
          data: { orderId: o.id, fromStatus: o.status, toStatus: "PROCESSING", changedById: null },
        });
      });
      berhasil += 1;
    } catch (err) {
      gagal += 1;
      console.error(`  GAGAL ${o.orderNumber || o.id}: ${err.message}`);
    }
  }
  console.log(`[Fase 2] Selesai. Order diperbaiki: ${berhasil}, gagal: ${gagal}`);
}

main()
  .then(() => fixOrderStatusFase2())
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
