// ─── Backfill status LUNAS utk order Juli 2026 (3 Sep 2026) ─────────────────
// Permintaan owner: Juli sudah "closed" secara bisnis, tapi sebagian sales
// lupa ubah paymentStatus ke LUNAS secara manual (paymentStatus order lama
// memang field manual, TIDAK diturunkan dari ledger `payments` — lihat
// CLAUDE.md §19). Script ini SEKALI JALAN, bukan logic permanen di aplikasi.
//
// Cakupan: SEMUA order dengan Order.createdAt jatuh di bulan Juli 2026
// (kalender WIB), KECUALI yang statusnya CANCELLED (order batal tidak
// pernah "lunas", menandainya LUNAS akan menyesatkan, bukan "melengkapi"
// data yang sales lupa).
//
// paidAt diisi = createdAt order itu sendiri (BUKAN tanggal karangan) —
// satu-satunya tanggal yang benar-benar kita TAHU untuk order ini adalah
// kapan dia dibuat; itu juga otomatis jatuh di Juli karena memang begitu
// filternya. Ini sengaja BUKAN menebak "kapan uangnya benar-benar masuk"
// (tidak ada catatan ledger utk order lama), cuma memenuhi permintaan
// eksplisit "tanggal lunasnya di Juli semua" dengan fakta yang sudah ada.
//
// DEFAULT = dry-run (cuma menampilkan apa yang AKAN berubah). Jalankan
// dengan --apply untuk benar-benar menulis.
import { prisma } from "../src/db.js";
import { startOfMonthWIB, endOfMonthExclusiveWIB, formatWIB } from "../src/utils/wib.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const dariJuli = startOfMonthWIB(2026, 7);
  const sampaiAgustus = endOfMonthExclusiveWIB(2026, 7);

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: dariJuli, lt: sampaiAgustus },
      status: { not: "CANCELLED" },
    },
    select: {
      id: true, orderNumber: true, createdAt: true, value: true,
      paymentStatus: true, paidAt: true, status: true,
      customer: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Rentang: ${formatWIB(dariJuli)} s/d sebelum ${formatWIB(sampaiAgustus)}`);
  console.log(`Order Juli (non-CANCELLED) ditemukan: ${orders.length}\n`);

  const sudahLunas = orders.filter((o) => o.paymentStatus === "LUNAS");
  const akanDiubah = orders.filter((o) => o.paymentStatus !== "LUNAS");
  const paidAtPerluDisesuaikan = orders.filter((o) => {
    if (!o.paidAt) return true;
    return o.paidAt < dariJuli || o.paidAt >= sampaiAgustus;
  });

  console.log(`Sudah LUNAS sebelumnya: ${sudahLunas.length}`);
  console.log(`Akan diubah paymentStatus → LUNAS: ${akanDiubah.length}`);
  console.log(`paidAt akan diisi/disesuaikan ke createdAt (belum di Juli atau kosong): ${paidAtPerluDisesuaikan.length}\n`);

  if (akanDiubah.length > 0) {
    console.log("Contoh order yang statusnya berubah (maks 15 ditampilkan):");
    for (const o of akanDiubah.slice(0, 15)) {
      console.log(`  ${o.orderNumber || o.id} — ${o.customer?.name || "?"} — ${o.paymentStatus} → LUNAS — Rp${(o.value || 0).toLocaleString("id-ID")}`);
    }
    if (akanDiubah.length > 15) console.log(`  ...dan ${akanDiubah.length - 15} lainnya`);
  }

  if (!APPLY) {
    console.log("\n[DRY-RUN] Tidak ada yang ditulis. Jalankan ulang dengan --apply untuk menerapkan.");
    return;
  }

  console.log("\nMenerapkan perubahan...");
  let jumlahDiubah = 0;
  await prisma.$transaction(async (tx) => {
    for (const o of orders) {
      const perluUbahStatus = o.paymentStatus !== "LUNAS";
      const perluUbahPaidAt = !o.paidAt || o.paidAt < dariJuli || o.paidAt >= sampaiAgustus;
      if (!perluUbahStatus && !perluUbahPaidAt) continue;
      await tx.order.update({
        where: { id: o.id },
        data: {
          paymentStatus: "LUNAS",
          paidAt: o.createdAt,
        },
      });
      jumlahDiubah++;
    }
  });
  console.log(`Selesai. ${jumlahDiubah} order diperbarui.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
