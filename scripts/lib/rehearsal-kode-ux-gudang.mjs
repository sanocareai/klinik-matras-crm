// Pemeriksaan KODE BARU UX Gudang Tahap 1 terhadap data restore backup NYATA (BACA-SAJA; tidak ada tulisan). Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { berandaGudang } = await import("/app/src/services/gudangBeranda.js");
const { stokLokasi } = await import("/app/src/services/stokLokasi.js");
const { tampilanPenerimaan, penghalangBatalJadwal } = await import("/app/src/services/penerimaanStatus.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const sm0 = await n("select count(*)::int n from stock_movements"), gr0 = await n("select count(*)::int n from goods_receipts"), kor0 = await n("select count(*)::int n from warehouse_corrections");

// Beranda: lima tugas, hitungan konsisten dengan penghitungan langsung dari tabel
const b = await berandaGudang(prisma);
cek("Beranda: tepat 5 tugas dengan jumlah numerik, definisi, dan tautan", b.tugas.length === 5 && b.tugas.every((t) => Number.isInteger(t.jumlah) && t.tautan && t.judul) && Object.keys(b.definisi).length === 5, b.tugas.map((t) => `${t.kode}=${t.jumlah}`).join(" "));
const tugas = Object.fromEntries(b.tugas.map((t) => [t.kode, t]));
const berjalan = await n("select count(*)::int n from goods_receipts where status in ('ARRIVED','INSPECTION','READY_FOR_PUTAWAY') and not (arrival_revision = 0 and arrived_date is null and not exists (select 1 from goods_receipt_lines l where l.goods_receipt_id = goods_receipts.id and (coalesce(l.received_qty,0) <> 0 or coalesce(l.accepted_qty,0) <> 0 or coalesce(l.rejected_qty,0) <> 0 or coalesce(l.companion_qty,0) <> 0)))");
cek("Beranda: 'belum masuk stok' = jumlah penerimaan berjalan yang berisi barang (hitung langsung)", tugas.BELUM_MASUK_STOK.jumlah === berjalan, `${tugas.BELUM_MASUK_STOK.jumlah} vs ${berjalan}`);
cek("Beranda: 'selisih menunggu' = hitungan stok menunggu review + penyesuaian + koreksi", tugas.SELISIH_MENUNGGU.jumlah === (await n("select ((select count(*) from stock_counts where status = 'WAITING_REVIEW') + (select count(*) from stock_adjustment_requests where status in ('WAITING_APPROVAL','APPROVED')) + (select count(*) from warehouse_corrections where status = 'PENDING_APPROVAL'))::int n")));

// Stok & Lokasi: setiap bahan terwakili; null = belum ada catatan (bukan nol)
const s = await stokLokasi(prisma); const nBahan = await n("select count(*)::int n from materials");
cek("Stok & Lokasi: setiap bahan terdaftar muncul sekali", s.rows.length === nBahan && s.ringkasan.terdaftar === nBahan, `${s.rows.length}/${nBahan}`);
const gerak = new Map((await prisma.$queryRawUnsafe("select material_id::text id, count(*)::int n from stock_movements group by 1")).map((r) => [r.id, r.n]));
cek("Stok & Lokasi: saldo kosong (belum diketahui) HANYA untuk bahan tanpa pergerakan; yang bergerak punya angka", s.rows.every((r) => (r.saldo === null) === !(gerak.get(r.materialId) > 0)));
cek("Stok & Lokasi: ringkasan konsisten (ada + belum ada catatan + nol + minus = aktif)", s.ringkasan.ada + s.ringkasan.belumAdaCatatan + s.ringkasan.nolTerhitung + s.ringkasan.minus === s.ringkasan.aktif, JSON.stringify({ aktif: s.ringkasan.aktif, ada: s.ringkasan.ada, belum: s.ringkasan.belumAdaCatatan, nol: s.ringkasan.nolTerhitung, minus: s.ringkasan.minus }));

// Status per penerimaan nyata
const grs = await prisma.goodsReceipt.findMany({ include: { lines: true } });
let salah = 0; let terjadwalBersih = 0;
for (const g of grs) {
  const t = tampilanPenerimaan(g); const kodeAksi = t.aksi.map((a) => a.kode);
  const final = g.status === "REJECTED" || g.status === "COMPLETED";
  if (!t.label || !Array.isArray(t.tahap) || t.tahap.length !== 5) salah += 1;
  if (g.status === "COMPLETED" && !(kodeAksi.length === 1 && /^KOREKSI_/.test(kodeAksi[0]))) salah += 1;
  if (!final && kodeAksi.length === 0) salah += 1;
  if (g.status === "SCHEDULED" && g.arrivalRevision === 0 && !g.arrivedDate) { const h = penghalangBatalJadwal(g, await n(`select count(*)::int n from stock_movements where goods_receipt_id = '${g.id}'`)); if (h === null) terjadwalBersih += 1; else salah += 1; }
}
cek(`Status ${grs.length} penerimaan nyata: label + 5 tahap; Sudah masuk stok hanya aksi Koreksi; yang belum final selalu punya aksi; Terjadwal tanpa tiba boleh dibatalkan`, salah === 0, `penyimpangan=${salah}; terjadwal bersih=${terjadwalBersih}`);
cek("tidak ada pergerakan/penerimaan/koreksi yang ditulis oleh pemeriksaan ini", (await n("select count(*)::int n from stock_movements")) === sm0 && (await n("select count(*)::int n from goods_receipts")) === gr0 && (await n("select count(*)::int n from warehouse_corrections")) === kor0);
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
