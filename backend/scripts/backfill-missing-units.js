// Pemulihan order yang terlanjur dibuat TANPA unit.
//
// Latar: migrasi backfill (20260731100100) membuat unit untuk semua order yang
// ada saat itu. Tapi tidak ada jalur runtime yang membuat unit, jadi setiap
// order yang dibuat SETELAH migrasi itu berhenti tanpa unit — dan karena
// dispatcher menjadwalkan pickup dengan memilih unit ber-status
// AWAITING_PICKUP, order-order itu tidak bisa masuk operasi sama sekali.
// Jalur runtime-nya sekarang sudah ada (services/unitProvisioning.js); script
// ini membereskan yang sempat menumpuk selama jalur itu belum ada.
//
// DEFAULT DRY-RUN — tidak mengubah apa pun sampai dijalankan dengan --apply.
// Pola yang sama dengan scripts/fix-lid-customers.js.
//
//   docker compose exec backend node scripts/backfill-missing-units.js
//   docker compose exec backend node scripts/backfill-missing-units.js --apply
//
// ⚠️ SATU UNIT PER ORDER, bukan sejumlah Order.quantity. Alasannya ada di
// services/unitProvisioning.js: `quantity` terbukti BUKAN jumlah kasur (ada
// order 2 bantal / 2 guling). Order yang benar-benar berisi >1 kasur
// ditambahkan unitnya lewat POST /api/orders/:id/units, dan script ini
// mencetak kandidatnya di bawah supaya bisa diperiksa manusia.

import { prisma } from "../src/db.js";
import { createUnitsForOrder, findOrdersWithoutUnits, unitStatusFromOrderStatus, parseOrderNotes }
  from "../src/services/unitProvisioning.js";

const APPLY = process.argv.includes("--apply");

// Layanan yang jelas BUKAN kasur — order seperti ini tidak boleh dapat unit,
// karena unitnya tidak akan pernah bisa melewati routing produksi kasur
// (Uji Fondasi, Uji Berat Badan, Jahit Corner semuanya spesifik kasur).
//
// ⚠️ DIPERIKSA DI DUA TEMPAT, dan itu perlu. Dry-run pertama terhadap data
// production menemukan RES-01082026-005 dan -006 lolos filter: `layananName`
// keduanya cuma tertulis "Ganti Kain", padahal objeknya BANTAL dan GULING —
// petunjuknya ada di `keluhanCustomer` ("Ganti kain bantal / Kain bantal
// rusak"). Memeriksa nama layanan saja akan membuat dua unit kasur hantu.
const POLA_BUKAN_KASUR = /sofa|kursi|sandaran|divan|spanbon|bantal|guling|ongkos|buang kasur|potong ukuran/i;

// Semua teks yang bisa mengungkap objek sebenarnya dari sebuah order.
function petunjukObjek(order, layanan) {
  const info = parseOrderNotes(order.notes);
  return [
    ...layanan,
    info.keluhanCustomer,
    // notes berformat teks polos (baris lawas) tidak punya struktur —
    // ikutkan apa adanya supaya tidak ada petunjuk yang terlewat.
    typeof order.notes === "string" && !order.notes.trim().startsWith("{") ? order.notes : null,
  ].filter(Boolean).join(" | ");
}

async function main() {
  console.log(APPLY ? "=== MODE APPLY — akan menulis ke database ===" : "=== DRY-RUN — tidak ada yang diubah ===");
  console.log("");

  const orders = await findOrdersWithoutUnits(prisma);
  if (orders.length === 0) {
    console.log("Tidak ada order tanpa unit. Tidak ada yang perlu dikerjakan.");
    return;
  }

  // Ambil item layanan untuk menandai order yang kemungkinan bukan kasur.
  const items = await prisma.orderItem.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
    select: { orderId: true, layananName: true },
  });
  const layananPerOrder = new Map();
  for (const it of items) {
    const arr = layananPerOrder.get(it.orderId) || [];
    arr.push(it.layananName);
    layananPerOrder.set(it.orderId, arr);
  }

  const dicurigai = [];
  const akanDibuat = [];

  for (const o of orders) {
    const layanan = layananPerOrder.get(o.id) || [];
    const petunjuk = petunjukObjek(o, layanan);
    const mencurigakan = POLA_BUKAN_KASUR.test(petunjuk);
    (mencurigakan ? dicurigai : akanDibuat).push({ ...o, layanan, petunjuk });
  }

  console.log(`Order tanpa unit: ${orders.length}`);
  console.log(`  akan dibuatkan 1 unit : ${akanDibuat.length}`);
  console.log(`  DILEWATI (bukan kasur): ${dicurigai.length}`);
  console.log("");

  if (dicurigai.length > 0) {
    console.log("--- DILEWATI, objeknya kemungkinan bukan kasur (periksa manual) ---");
    for (const o of dicurigai) {
      console.log(`  ${o.orderNumber || o.id.slice(0, 8)}  [${o.status}]  ${o.petunjuk}`);
    }
    console.log("");
  }

  console.log("--- akan dibuatkan unit ---");
  for (const o of akanDibuat) {
    const kode = `${o.orderNumber || `LEG-${o.id.slice(0, 8)}`}-U1`;
    console.log(`  ${kode}  status→${unitStatusFromOrderStatus(o.status)}  ${o.layanan.join(" | ") || "(tanpa item)"}`);
  }
  console.log("");

  if (!APPLY) {
    console.log("Dry-run selesai. Jalankan ulang dengan --apply untuk menerapkan.");
    return;
  }

  let berhasil = 0;
  let gagal = 0;
  for (const o of akanDibuat) {
    try {
      // Satu transaksi per order: satu order bermasalah tidak boleh
      // menggagalkan seluruh pemulihan.
      await prisma.$transaction((tx) => createUnitsForOrder(tx, { order: o, count: 1 }));
      berhasil += 1;
    } catch (err) {
      gagal += 1;
      console.error(`  GAGAL ${o.orderNumber || o.id}: ${err.message}`);
    }
  }

  console.log("");
  console.log(`Selesai. Unit dibuat: ${berhasil}, gagal: ${gagal}, dilewati: ${dicurigai.length}`);

  const sisa = await findOrdersWithoutUnits(prisma);
  console.log(`Order tanpa unit setelah pemulihan: ${sisa.length} (harusnya = jumlah yang dilewati)`);
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
