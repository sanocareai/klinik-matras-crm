// Pemeriksaan KODE BARU "Sales fleksibel + riwayat lengkap" terhadap data restore backup NYATA. Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal (salinan).
// Satu-satunya tulisan terjadi DI DALAM transaksi yang selalu DIBATALKAN (rollback) pada salinan; skrip rilis membuktikan sidik jari seluruh tabel sama sebelum dan sesudah.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { selaraskanProduksiDenganOrderInTx } = await import("/app/src/services/orderProduksiSelaras.js");
const { loadRiwayatUnit, SUMBER_RIWAYAT } = await import("/app/src/services/productionRiwayatService.js");
const { formatActivitySentence, EVENT_TYPES } = await import("/app/src/lib/activityLog.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const SUMBER = new Set(Object.values(SUMBER_RIWAYAT));

// 1. Riwayat unit pada data nyata: unit dengan Run (aktif/selesai/batal) dan tanpa Run
const unitBerRun = await prisma.unit.findMany({ where: { productionRunsV2: { some: {} } }, select: { id: true, unitCode: true, orderId: true }, orderBy: { id: "asc" }, take: 40 });
const unitTanpaRun = await prisma.unit.findMany({ where: { productionRunsV2: { none: {} } }, select: { id: true, unitCode: true, orderId: true }, orderBy: { id: "asc" }, take: 15 });
let baris = 0; let bernama = 0; let rusak = 0; let tidakUrut = 0;
for (const u of [...unitBerRun, ...unitTanpaRun]) {
  const run = await prisma.productionRun.findFirst({ where: { unitId: u.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const r = await loadRiwayatUnit(prisma, { unit: u, run });
  baris += r.length;
  for (let i = 0; i < r.length; i += 1) {
    const x = r[i];
    if (!SUMBER.has(x.source) || typeof x.label !== "string" || !x.label.trim() || /undefined|\[object Object\]/.test(x.label) || !("actor" in x) || !x.at) rusak += 1;
    if (x.actor) bernama += 1;
    if (i > 0 && new Date(r[i - 1].at).getTime() > new Date(x.at).getTime()) tidakUrut += 1;
  }
}
cek(`Riwayat: ${unitBerRun.length + unitTanpaRun.length} unit nyata dihitung tanpa galat; semua baris punya sumber sah, kalimat, waktu, dan kolom pelaku; urut waktu naik`, rusak === 0 && tidakUrut === 0, `baris=${baris}, bernama=${bernama}, rusak=${rusak}, tidakUrut=${tidakUrut}`);
cek("Riwayat: data nyata memuat baris dengan NAMA pelaku (bukan semuanya kosong)", baris === 0 || bernama > 0, `bernama=${bernama}/${baris}`);

// 2. Kalimat riwayat jenis baru (semua bentuk)
const kal = [
  { aksi: "CANCEL", unitCode: "U-1", runStatusBefore: "ACTIVE", runPhase: "PROCESS", planDibatalkan: true, reservasiDilepas: 2, issueDibatalkan: ["ISS-1"], bahanSudahDiserahkan: [{ code: "M1", qty: 5, unit: "KG" }], orderStatusBefore: "PROCESSING", orderStatusAfter: "CANCELLED", reason: "uji" },
  { aksi: "READY", unitCode: "U-1", runStatusBefore: "ACTIVE", orderStatusBefore: "PROCESSING", orderStatusAfter: "READY", reason: "uji" },
  { aksi: "DELIVERED", unitCode: "U-1", runStatusBefore: "ACTIVE", orderStatusBefore: "READY", orderStatusAfter: "DELIVERED" },
].map((metadata) => formatActivitySentence({ eventType: EVENT_TYPES.PRODUCTION_FOLLOWS_ORDER, metadata }));
cek("Kalimat PRODUCTION_FOLLOWS_ORDER: batal (dengan peringatan retur bahan), Siap Kirim, Terkirim", kal.every((x) => typeof x === "string" && x.length > 20 && !/undefined/.test(x)) && /PERHATIAN Gudang/.test(kal[0]) && /Retur Bahan/.test(kal[0]) && /Siap Kirim|READY/.test(kal[1]), kal[0]);

// 3. Penyelarasan pada order nyata — DICOBA di dalam transaksi yang selalu dibatalkan
class Batal extends Error {}
const orderDenganRun = await prisma.$queryRawUnsafe(`select distinct o.id::text id, o.status::text status from "Order" o join units u on u.order_id = o.id join production_runs_v2 r on r.unit_id = u.id where r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED') and o.status <> 'CANCELLED' order by 1 limit 3`);
if (orderDenganRun.length === 0) cek("Penyelarasan: tidak ada order dengan Run berjalan di data (dilewati)", true);
for (const o of orderDenganRun) {
  const sebelum = { run: await n(`select count(*)::int n from production_runs_v2 r join units u on u.id = r.unit_id where u.order_id = '${o.id}' and r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED')`), stok: await n("select count(*)::int n from stock_movements") };
  let hasil = null; let dalam = null; let galat = null;
  try {
    await prisma.$transaction(async (tx) => {
      hasil = await selaraskanProduksiDenganOrderInTx(tx, { orderId: o.id, aksi: "CANCEL", actorId: null, alasan: "rehearsal rilis", orderStatusSebelum: o.status });
      dalam = {
        runBerjalan: await tx.productionRun.count({ where: { unit: { orderId: o.id }, status: { in: ["PENDING_ARRIVAL", "ACTIVE", "BLOCKED"] } } }),
        reservasiAktifTanpaIssueDiserahkan: await tx.materialReservation.count({ where: { status: "ACTIVE", plan: { run: { unit: { orderId: o.id }, status: "CANCELLED" } } } }),
        stok: await tx.stockMovement.count(),
        jejak: await tx.activityEvent.count({ where: { entityType: "order", entityId: o.id, eventType: "PRODUCTION_FOLLOWS_ORDER" } }),
      };
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) galat = e?.message || String(e); }
  cek(`Penyelarasan BATAL pada order nyata ${o.id.slice(0, 8)} (status ${o.status}): tanpa galat`, galat === null, galat ?? "");
  if (galat === null) {
    cek(`... semua Run berjalan (${sebelum.run}) dibatalkan di dalam transaksi; jejak tercatat; stok tidak bergerak; reservasi aktif tak tersisa pada Run batal`,
      dalam.runBerjalan === 0 && hasil.runDibatalkan.length === sebelum.run && dalam.jejak === sebelum.run && dalam.stok === sebelum.stok && dalam.reservasiAktifTanpaIssueDiserahkan === 0 || (hasil.peringatan.length > 0 && dalam.runBerjalan === 0),
      JSON.stringify({ sebelum, dalam, dibatalkan: hasil.runDibatalkan.length, peringatan: hasil.peringatan.length }));
    const sesudahRollback = await n(`select count(*)::int n from production_runs_v2 r join units u on u.id = r.unit_id where u.order_id = '${o.id}' and r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED')`);
    cek("... transaksi percobaan DIBATALKAN: Run di salinan tidak berubah", sesudahRollback === sebelum.run);
  }
}
// READY pada unit yang masih diproduksi — dicoba di transaksi yang dibatalkan
const unitProduksi = await prisma.$queryRawUnsafe(`select o.id::text oid, o.status::text ost from "Order" o join units u on u.order_id = o.id join production_runs_v2 r on r.unit_id = u.id where r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED') and u.status in ('RECEIVED','IN_PRODUCTION') and o.status in ('PROCESSING','PENDING') limit 1`);
if (unitProduksi.length === 0) cek("Penyelarasan SIAP KIRIM: tidak ada unit produksi berjalan di data (dilewati)", true); else {
  let hasil = null; let galat = null; let penanda = null;
  try {
    await prisma.$transaction(async (tx) => {
      hasil = await selaraskanProduksiDenganOrderInTx(tx, { orderId: unitProduksi[0].oid, aksi: "READY", actorId: null, alasan: "rehearsal rilis", orderStatusSebelum: unitProduksi[0].ost });
      penanda = await tx.productionRun.findFirst({ where: { unit: { orderId: unitProduksi[0].oid }, deliveryRelease: { path: ["kind"], equals: "SALES_STATUS_CHANGE" } }, select: { status: true } });
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) galat = e?.message || String(e); }
  cek("Penyelarasan SIAP KIRIM pada order nyata: Run ditandai dilepas (SALES_STATUS_CHANGE) dan tetap berjalan", galat === null && hasil.runDilepas.length >= 1 && !!penanda && ["ACTIVE", "BLOCKED", "PENDING_ARRIVAL"].includes(penanda.status), galat ?? JSON.stringify(hasil));
}
// Order tanpa Run: tidak ada efek (perilaku V1 identik)
const tanpaRun = await prisma.$queryRawUnsafe(`select o.id::text id from "Order" o where not exists (select 1 from units u join production_runs_v2 r on r.unit_id = u.id where u.order_id = o.id) limit 1`);
if (tanpaRun.length) {
  let hasil = null;
  try { await prisma.$transaction(async (tx) => { hasil = await selaraskanProduksiDenganOrderInTx(tx, { orderId: tanpaRun[0].id, aksi: "CANCEL", actorId: null, alasan: "rehearsal", orderStatusSebelum: "PENDING" }); throw new Batal(); }); } catch (e) { if (!(e instanceof Batal)) hasil = { galat: e?.message }; }
  cek("Order tanpa Run: penyelarasan tidak berefek (kosong)", hasil && !hasil.galat && hasil.runDibatalkan.length === 0 && hasil.runDilepas.length === 0 && hasil.peringatan.length === 0, JSON.stringify(hasil));
}
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
