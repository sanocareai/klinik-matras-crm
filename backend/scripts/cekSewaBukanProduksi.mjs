// CEK BACA-SAJA "kasur sewa bukan pekerjaan Produksi" atas DB yang ditunjuk DATABASE_URL (dipakai skrip rilis: image baru vs data production, sebelum dan sesudah switch).
// Sesi DB dipaksa READ ONLY (satu koneksi, default_transaction_read_only=on) — tidak ada tulis apa pun.
// Keluaran: baris "CEK ok|gagal <uraian>"; exit 1 bila ada yang gagal.
import { PrismaClient } from "@prisma/client";
import { listWorkOrders, hitungKelengkapanDaftar } from "../src/services/productionOrderList.js";
import { listWorkList } from "../src/services/productionWorkListService.js";
import { antreanHpp } from "../src/services/finance/hppOrder.js";
import { bangunKonteks } from "../src/services/laporanProduksi.js";

const url = new URL(process.env.DATABASE_URL);
url.searchParams.set("connection_limit", "1");
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
let gagal = 0;
const cek = (nama, lulus, info = "") => { if (!lulus) gagal += 1; console.log(`CEK ${lulus ? "ok   " : "gagal"} ${nama}${info ? ` — ${info}` : ""}`); };

try {
  await prisma.$executeRawUnsafe("SET default_transaction_read_only = on");
  const ro = await prisma.$queryRawUnsafe("show default_transaction_read_only");
  cek("sesi DB baca-saja", ro?.[0]?.default_transaction_read_only === "on");

  const sewa = await prisma.$queryRawUnsafe(`select u.unit_code from units u join "Order" o on o.id = u.order_id where coalesce(u.work_category::text, o.category::text) = 'SEWA'`);
  const kodeSewa = new Set(sewa.map((r) => r.unit_code));
  const [{ n: nProduksi }] = await prisma.$queryRawUnsafe(`select count(*)::int n from units u join "Order" o on o.id = u.order_id where coalesce(u.work_category::text, o.category::text) <> 'SEWA'`);
  const [{ n: nSemua }] = await prisma.$queryRawUnsafe(`select count(*)::int n from units`);
  console.log(`INFO  unit sewa ${kodeSewa.size}, unit Produksi ${nProduksi}, semua unit ${nSemua}`);

  // Order Produksi: total = unit non-sewa; tak satu pun unit sewa di seluruh halaman; hitungan chip = total
  const pertama = await listWorkOrders(prisma, { pageSize: "200" });
  cek("Order Produksi: total = jumlah unit non-sewa", pertama.total === nProduksi, `${pertama.total} vs ${nProduksi}`);
  let bocor = 0; let dilihat = 0;
  for (let page = 1; page <= Math.ceil(pertama.total / 200); page += 1) {
    const d = page === 1 ? pertama : await listWorkOrders(prisma, { pageSize: "200", page: String(page) });
    dilihat += d.units.length; bocor += d.units.filter((u) => kodeSewa.has(u.unitCode)).length;
  }
  cek("Order Produksi: tidak ada unit sewa di semua halaman", bocor === 0 && dilihat === nProduksi, `${bocor} bocor, ${dilihat} baris dilihat`);
  const chip = pertama.statusCounts.reduce((a, s) => a + s.count, 0);
  cek("Order Produksi: hitungan chip status = total (sewa tidak dihitung)", chip === nProduksi, `${chip}`);
  const cari = await listWorkOrders(prisma, { q: "SWS-", pageSize: "200" });
  cek("Order Produksi: pencarian 'SWS-' tidak memuat unit sewa", !cari.units.some((u) => kodeSewa.has(u.unitCode)), `${cari.total} hasil`);

  const kel = await hitungKelengkapanDaftar(prisma, {});
  cek("Kelengkapan: total unit = unit non-sewa", kel.totalUnit === nProduksi, `${kel.totalUnit}`);

  const aktif = await listWorkList(prisma, { pageSize: "100" });
  const unitAktif = aktif.orders.flatMap((o) => (o.units ?? []).map((u) => u.unitCode));
  cek("Status Produksi: tidak ada unit sewa di halaman aktif", !unitAktif.some((k) => kodeSewa.has(k)), `${aktif.counts.aktif} order aktif, ${aktif.counts.riwayat} riwayat`);

  const k = await bangunKonteks(prisma, {});
  const lapSewa = k.units.filter((u) => kodeSewa.has(u.unitCode));
  const [{ n: sewaBerbiaya }] = await prisma.$queryRawUnsafe(`select count(distinct u.id)::int n from units u join "Order" o on o.id = u.order_id join stock_movements sm on sm.unit_id = u.id where coalesce(u.work_category::text, o.category::text) = 'SEWA' and u.status <> 'CANCELLED'`);
  cek("Laporan Produksi: unit sewa hanya yang punya pergerakan stok", lapSewa.length === sewaBerbiaya, `${lapSewa.length} vs ${sewaBerbiaya}`);

  const hari = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const antre = await antreanHpp(prisma, { fromStr: "2026-11-01", toStr: hari });
  const antreSewa = antre.baris.filter((b) => kodeSewa.has(b.unitKode));
  cek("Antrean HPP Order (1 Nov s.d. hari ini): unit sewa tanpa biaya tidak masuk", antreSewa.every((b) => b.adaPemakaian), `${antre.ringkasan.unit} unit, ${antre.ringkasan.unitSewaDilewati} sewa dilewati`);
} catch (e) {
  gagal += 1; console.log(`CEK gagal pengecualian: ${e?.message?.slice(0, 300)}`);
} finally {
  await prisma.$disconnect();
}
console.log(gagal ? `HASIL GAGAL ${gagal}` : "HASIL LULUS");
process.exit(gagal ? 1 : 0);
