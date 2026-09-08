// Backfill "siap kirim" untuk order LAYANAN yang pengambilannya sudah
// benar-benar selesai secara fisik tapi tidak pernah dilacak lewat sistem
// produksi sama sekali (8 September 2026, permintaan owner langsung —
// laporan screenshot Lim Fie Boen: "statusnya masih diproses... dia
// tinggal kirim, dan siap masuk pengiriman, dan resi pengambilan nya
// sudah selesai tapi tidak terekam sistem, gaada proof of delivery nya,
// karna gue minta orderan ini gapapa" + daftar susulan Royhan Arief/
// Julhan/Windy Satya).
//
// INVESTIGASI (bukan tebakan) sebelum menulis script ini:
//   - Keenam unit di bawah: current_stage_id KOSONG, 0 baris unit_stage_logs,
//     service_id belum ditetapkan — tidak pernah "dibuka" di Bengkel sama
//     sekali, walau job PICKUP-nya sendiri sudah COMPLETED.
//   - Gerbang QC wajib (fit_test/Uji Berat Badan) butuh referenceWeightKg
//     SUNGGUHAN (kolom NOT NULL) — 4 dari 6 order TIDAK punya data berat
//     badan apa pun di OrderWeightEntry. Bahkan 2 yang punya (205: Suami
//     65kg, 016: Ibu 95kg) itu cuma ANGKA MASUKAN sales, BUKAN verdict QC
//     sungguhan (PAS/TERLALU_KERAS/TERLALU_EMPUK) — tidak ada satu pun
//     yang benar-benar diuji, jadi TIDAK ADA order di bawah yang dapat
//     entri qc_fit_tests asli. Menulis verdict karangan = fabrikasi data
//     QC, dilarang keras.
//   - 7 dari 8 tahap produksi aktif mewajibkan foto (requiresPhoto) — tidak
//     ada foto asli untuk satu pun unit ini, jadi berjalan tahap-demi-tahap
//     lewat recordStageDone() juga tidak jujur dilakukan.
//
// KEPUTUSAN (dikonfirmasi owner via AskUserQuestion, 8 September 2026):
// SATU catatan bypass administratif per unit (adminBypassProduction() di
// services/unitStageEngine.js) — BUKAN 8 baris "selesai" palsu per tahap.
// Unit langsung READY_FOR_DELIVERY, job Pengiriman baru otomatis muncul
// (suggestDeliveryJob, jalur SAMA dengan produksi normal), Order.status
// ikut terhitung ulang (syncOrderStatus).
//
// RES-03092026-018 (Royhan Arief) BEDA KASUS — isinya cuma "Biaya Buang
// Kasur/Divan per pcs", BUKAN pekerjaan produksi/upgrade sama sekali.
// Dikonfirmasi owner: order ini SELESAI di pengambilan, TIDAK butuh job
// Pengiriman. Ditutup lewat PATCH status=DELIVERED biasa (jalur yang SAMA
// dipakai dropdown manual UI, unit-nya TIDAK disentuh script ini).
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/backfill-admin-bypass-production.js
//   docker compose exec backend node scripts/backfill-admin-bypass-production.js --apply

import { prisma } from "../src/db.js";
import { adminBypassProduction } from "../src/services/unitStageEngine.js";
import { selesaikanJobBelumJalan } from "../src/services/orderStatusSync.js";
import { syncCustomerOrderAggregate } from "../src/services/customerOrderAggregate.js";

const APPLY = process.argv.includes("--apply");
const OWNER_USER_ID = "cmqzoxqwi00004gmyzxawj970"; // OWNER (Admin), admin@klinikmatras.com — lihat CLAUDE.md §1
const OTORISASI = "Diotorisasi owner langsung (chat 8 September 2026) — pengambilan sudah selesai secara fisik, tidak pernah dilacak lewat sistem produksi.";

// Order yang butuh bypass produksi penuh -> Siap Kirim -> job Pengiriman baru.
const ORDER_NUMBERS_BYPASS_PRODUKSI = [
  "RES-30082026-205", // Lim Fie Boen
  "RES-30082026-206", // Lim Fie Boen
  "RES-03092026-017", // Royhan Arief
  "RES-02092026-011", // Julhan
  "RES-03092026-016", // Windy Satya
];

// Order yang TIDAK butuh pengiriman sama sekali (jasa buang kasur) — tutup
// langsung sebagai Terkirim, tanpa job Pengiriman.
const ORDER_NUMBERS_TUTUP_LANGSUNG = [
  "RES-03092026-018", // Royhan Arief — Biaya Buang Kasur/Divan per pcs
];

async function bypassProduksi(orderNumber) {
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: { units: true },
  });
  if (!order) { console.log(`  ${orderNumber}: TIDAK DITEMUKAN — dilewati.`); return; }

  const unitsPerlu = order.units.filter((u) => u.status !== "CANCELLED" && u.status !== "DELIVERED");
  if (unitsPerlu.length === 0) { console.log(`  ${orderNumber}: tidak ada unit yang perlu di-bypass.`); return; }

  for (const u of unitsPerlu) {
    console.log(`  ${orderNumber} — unit ${u.unitCode} (status sekarang: ${u.status})`);
    if (APPLY) {
      await adminBypassProduction(u.id, { actorId: OWNER_USER_ID, note: `${orderNumber} — ${OTORISASI}` });
    }
  }
}

async function tutupLangsung(orderNumber) {
  const order = await prisma.order.findUnique({ where: { orderNumber } });
  if (!order) { console.log(`  ${orderNumber}: TIDAK DITEMUKAN — dilewati.`); return; }
  console.log(`  ${orderNumber} — tutup langsung sebagai Terkirim (status sekarang: ${order.status}), TANPA job Pengiriman.`);
  if (!APPLY) return;

  await prisma.$transaction(async (tx) => {
    const sebelum = order.status;
    await tx.unit.updateMany({
      where: { orderId: order.id, status: { notIn: ["CANCELLED", "DELIVERED"] } },
      data: { status: "DELIVERED" },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "DELIVERED", statusLocked: true,
        statusOverrideById: OWNER_USER_ID, statusOverrideAt: new Date(),
        statusOverrideNote: `${OTORISASI} Order ini jasa buang kasur — tidak ada pengiriman balik.`,
      },
    });
    if (sebelum !== "DELIVERED") {
      await tx.orderStatusTransition.create({
        data: { orderId: order.id, fromStatus: sebelum, toStatus: "DELIVERED", changedById: OWNER_USER_ID },
      });
    }
    // Job yang belum jalan (kalau ada sisa) disinkron selesai juga — pola
    // sama dengan jalur manual PATCH /orders/:id, lihat routes/orders.js.
    await selesaikanJobBelumJalan(tx, order.id);
  });
  await syncCustomerOrderAggregate(order.customerId);
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (cuma pratinjau)"}\n`);

  console.log("== Bypass produksi -> Siap Kirim -> job Pengiriman baru ==");
  for (const on of ORDER_NUMBERS_BYPASS_PRODUKSI) await bypassProduksi(on);

  console.log("\n== Tutup langsung sebagai Terkirim (tanpa job Pengiriman) ==");
  for (const on of ORDER_NUMBERS_TUTUP_LANGSUNG) await tutupLangsung(on);

  if (!APPLY) {
    console.log("\nJalankan ulang dengan --apply untuk benar-benar menulis ke database.");
  } else {
    console.log("\nSelesai.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
