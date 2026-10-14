// DRY-RUN BACA-SAJA: audit dua order yang diduga duplikat + pratinjau penggabungan. TIDAK menulis apa pun (hanya SELECT).
//   docker compose exec backend node scripts/order-gabung-dry-run.js --utama NEW-11102026-023 --duplikat NEW-01092026-001
// Keluaran: bukti (customer/HP/barang/konteks PKR), hambatan (mis. dua job aktif), jejak Delivery nyata per order, jejak keuangan, pembuat order, dan penjelasan kolom Sales ("Rifki")
// vs Penjual PKR ("Kemal"). Penggabungan SENDIRI hanya lewat POST /api/orders/gabung oleh Admin setelah Owner menyetujui hasil ini.
import { prisma } from "../src/db.js";
import { pratinjauGabung } from "../src/services/orderMerge.js";

const arg = (nama, def = null) => { const i = process.argv.indexOf(`--${nama}`); return i >= 0 ? process.argv[i + 1] : def; };
const utama = arg("utama", "NEW-11102026-023");
const duplikat = arg("duplikat", "NEW-01092026-001");

async function pembuat(orderId) {
  const e = await prisma.activityEvent.findMany({ where: { entityType: "order", entityId: orderId }, orderBy: { createdAt: "asc" }, take: 3, select: { eventType: true, actorId: true, createdAt: true } });
  const ids = [...new Set(e.map((x) => x.actorId).filter(Boolean))];
  const u = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nama = new Map(u.map((x) => [x.id, x.name]));
  return e.map((x) => ({ peristiwa: x.eventType, oleh: nama.get(x.actorId) ?? null, pada: x.createdAt.toISOString() }));
}

try {
  const p = await pratinjauGabung(prisma, { utama, duplikat });
  const [bUtama, bDup] = await Promise.all([pembuat(p.utama.id), pembuat(p.duplikat.id)]);
  const salesLead = p.duplikat.customer.salesLead || p.utama.customer.salesLead;
  const laporan = {
    ringkas: p.bolehDigabung ? "BOLEH digabung (semua bukti cukup, tanpa hambatan)" : "TIDAK boleh digabung sebelum hambatan di bawah diselesaikan",
    utama: p.utama, duplikat: p.duplikat, bukti: p.bukti, hambatan: p.hambatan, peringatan: p.peringatan,
    pembuatOrder: { utama: bUtama, duplikat: bDup },
    kolomSales: {
      penjelasan: `Kolom "Sales" pada gambar rute memakai Customer.assignedSales (pemilik lead customer) = ${salesLead ?? "-"}; itu BUKAN penjual PKR. Penjual PKR = ${p.utama.pkr?.penjual ?? "-"}.`,
      salesLeadCustomer: salesLead ?? null, penjualPkr: p.utama.pkr?.penjual ?? null,
    },
    dampakBilaDigabung: p.dampak,
    sidikJariPratinjau: p.sidikJari,
    catatan: "Dry-run baca-saja. Jangan menerapkan penggabungan sebelum Owner menyetujui hasil ini.",
  };
  console.log(JSON.stringify(laporan, null, 2));
  process.exitCode = p.bolehDigabung ? 0 : 2;
} catch (e) {
  console.error("Dry-run gagal:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
