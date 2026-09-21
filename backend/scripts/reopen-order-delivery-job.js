// Buka kembali job yang TERLANJUR ditutup otomatis oleh kaskade "order
// DELIVERED" padahal order-nya sudah ditarik balik (mis. ke SHIPPING) —
// koreksi data SATU order (21 September 2026, laporan owner: order
// NEW-30082026-023 job pengirimannya "SELESAI" padahal status order masih
// Pengiriman/belum terkirim). Akar masalahnya sudah diperbaiki di kode
// (routes/orders.js, cabang "tarik balik dari DELIVERED") — script ini
// cuma untuk order yang SUDAH TERLANJUR sebelum perbaikan itu ada.
//
// Memakai logika yang SAMA persis dengan kode (services/orderStatusSync.js
// #bukaKembaliJobHasilKaskadeDelivered), bukan salinan kedua.
//
// PRATINJAU adalah DEFAULT — tanpa --apply tidak ada yang diubah.
//   docker compose exec backend node scripts/reopen-order-delivery-job.js NEW-30082026-023
//   docker compose exec backend node scripts/reopen-order-delivery-job.js NEW-30082026-023 --apply

import { prisma } from "../src/db.js";
import { bukaKembaliJobHasilKaskadeDelivered } from "../src/services/orderStatusSync.js";

const APPLY = process.argv.includes("--apply");
const orderNumber = process.argv.slice(2).find((a) => !a.startsWith("--"));

async function main() {
  if (!orderNumber) throw new Error("Nomor order wajib diisi. Contoh: node scripts/reopen-order-delivery-job.js NEW-30082026-023");

  const order = await prisma.order.findFirst({ where: { orderNumber }, select: { id: true, orderNumber: true, status: true } });
  if (!order) throw new Error(`Order ${orderNumber} tidak ditemukan`);
  console.log(`Order ${order.orderNumber} — status sekarang: ${order.status}`);
  if (order.status === "DELIVERED") {
    throw new Error("Order ini SEDANG berstatus DELIVERED — tidak ada yang perlu dibuka kembali.");
  }

  const hasil = await prisma.$transaction(async (tx) => {
    const r = await bukaKembaliJobHasilKaskadeDelivered(tx, order.id);
    if (!APPLY) throw Object.assign(new Error("PRATINJAU"), { pratinjau: r });
    return r;
  }).catch((e) => {
    if (e.pratinjau) return { ...e.pratinjau, dibatalkanKarenaPratinjau: true };
    throw e;
  });

  console.log(JSON.stringify(hasil, null, 2));
  if (hasil.dibatalkanKarenaPratinjau) {
    console.log("\nPRATINJAU — TIDAK ADA DATA YANG DIUBAH (transaksi di-rollback).");
    console.log(`Kalau sudah benar: node scripts/reopen-order-delivery-job.js ${orderNumber} --apply`);
  }
}

main()
  .catch((e) => { console.error("Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
