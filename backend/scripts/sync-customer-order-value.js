// Sinkron ulang Customer.orderCount / Customer.orderValue ke NILAI BERSIH (Order.value − Nota Kredit aktif) — Okt 2026.
//
// Customer.orderValue adalah kolom TURUNAN yang disimpan (dipakai urutan/filter "VIP ≥ Rp5jt" di daftar pelanggan). Kode baru (syncCustomerOrderAggregate) menghitungnya BERSIH setiap order
// atau nota kredit berubah, tetapi pelanggan yang SUDAH punya nota sebelum rilis ini belum pernah dihitung ulang. Script ini membandingkan kolom tersimpan dengan hitungan bersih untuk SEMUA
// pelanggan dan (hanya dengan --apply) memperbaiki YANG BERKAITAN DENGAN NOTA KREDIT (punya order dengan nota, aktif maupun dibatalkan). Selisih lain (mis. profil staf Penjualan Karyawan
// yang tak pernah disinkron) hanya DILAPORKAN, tidak diubah. Idempoten; HANYA menulis kolom orderCount/orderValue di Customer — tidak menyentuh order, pembayaran, refund, jurnal, nota.
//
//   docker compose exec backend node scripts/sync-customer-order-value.js            # DRY-RUN (default): hanya melaporkan selisih
//   docker compose exec backend node scripts/sync-customer-order-value.js --apply    # tulis
import { prisma } from "../src/db.js";

const APPLY = process.argv.includes("--apply");

const baris = await prisma.$queryRaw`
  WITH hitung AS (
    SELECT c.id, c.name, c."orderCount" AS count_tersimpan, c."orderValue" AS nilai_tersimpan,
           COUNT(o.id) FILTER (WHERE o.status::text <> 'CANCELLED')::int AS count_hitung,
           COALESCE(SUM(GREATEST(0, o.value - COALESCE((SELECT SUM(k.amount) FROM fin_order_credits k WHERE k.order_id = o.id AND k.status = 'AKTIF'), 0)))
                    FILTER (WHERE o.status::text <> 'CANCELLED'), 0)::bigint AS nilai_hitung
    FROM "Customer" c
    LEFT JOIN "Order" o ON o."customerId" = c.id
    GROUP BY c.id, c.name, c."orderCount", c."orderValue"
  )
  SELECT h.*, EXISTS (SELECT 1 FROM "Order" o2 JOIN fin_order_credits k2 ON k2.order_id = o2.id WHERE o2."customerId" = h.id) AS terkait_nota
  FROM hitung h WHERE nilai_tersimpan <> nilai_hitung OR count_tersimpan <> count_hitung ORDER BY name`;

const terkait = baris.filter((b) => b.terkait_nota);
const lain = baris.filter((b) => !b.terkait_nota);
console.log(`${APPLY ? "APPLY" : "DRY-RUN"} — selisih terkait nota kredit: ${terkait.length}; selisih lain (hanya dilaporkan): ${lain.length}`);
for (const b of terkait.slice(0, 200)) {
  console.log(`  [nota] ${b.id}  ${b.name}  orderValue ${Number(b.nilai_tersimpan)} → ${Number(b.nilai_hitung)}  orderCount ${b.count_tersimpan} → ${b.count_hitung}`);
}
for (const b of lain.slice(0, 50)) {
  console.log(`  [info, tidak diubah] ${b.id}  ${b.name}  orderValue ${Number(b.nilai_tersimpan)} vs ${Number(b.nilai_hitung)}  orderCount ${b.count_tersimpan} vs ${b.count_hitung}`);
}
if (!APPLY) {
  console.log("Tidak ada yang diubah (dry-run). Jalankan ulang dengan --apply setelah ditinjau.");
  await prisma.$disconnect();
  process.exit(0);
}
let n = 0;
for (const b of terkait) {
  await prisma.customer.update({ where: { id: b.id }, data: { orderCount: Number(b.count_hitung), orderValue: Number(b.nilai_hitung) } });
  n += 1;
}
console.log(`Diperbarui: ${n} pelanggan.`);
await prisma.$disconnect();
