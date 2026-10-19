// Pemeriksaan KODE BARU UX Gudang Tahap 3 terhadap data restore backup NYATA (BACA-SAJA; tidak ada tulisan). Dijalankan di container dari image BARU dengan DATABASE_URL = DB rehearsal.
// Memeriksa: status/aksi tiap dokumen nyata (Pengeluaran Material, Transfer, Opname, Restok, Rusak, Retur, Penyesuaian), ketersediaan & cadangan stok, selisih & perjalanan saldo transfer nyata.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const dg = await import("/app/src/services/dokumenGudang.js");
const lain = await import("/app/src/services/dokumenGudangLain.js");
const sel = await import("/app/src/services/selisihTransfer.js");
const { computeStockSnapshot, RESERVED_STATUSES } = await import("/app/src/services/inventoryLedger.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TABEL = ["goods_receipts", "goods_receipt_lines", "goods_receipt_events", "stock_movements", "material_issues", "stock_transfers", "stock_counts", "replenishment_requests", "damaged_stock_records", "return_records", "stock_adjustment_requests", "warehouse_corrections", "fin_journal_entries", "activity_events"];
const awal = {}; for (const t of TABEL) awal[t] = await n(`select count(*)::int n from ${t}`);

// ── Pengeluaran Material ──
const mis = await prisma.materialIssue.findMany({ include: { lines: true } });
let salahMI = 0; let v2 = 0;
for (const m of mis) {
  const t = dg.tampilanMaterialIssue(m); const kode = t.aksi.map((a) => a.kode);
  if (!t.label || !Array.isArray(t.tahap) || t.tahap.length !== 6) salahMI += 1;
  if (m.productionPlanId) { v2 += 1; if (t.kode !== "V2" || kode.length) salahMI += 1; continue; }
  if (m.status === "ISSUED" && kode.length) salahMI += 1;
  if (m.status === "CANCELLED" && !(kode.length === 1 && kode[0] === "BUAT_ULANG")) salahMI += 1;
  if (m.status === "DRAFT" && !(kode.includes("AJUKAN") && kode.includes("UBAH_ISI"))) salahMI += 1;
  if (["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"].includes(m.status) && !kode.includes("KEMBALIKAN")) salahMI += 1;
  if (m.status === "PICKED" && !kode.includes("KONFIRMASI_KELUAR")) salahMI += 1;
}
cek(`Pengeluaran Material: ${mis.length} dokumen nyata (${v2} milik Produksi V2) — status/tahap benar; V2 tanpa aksi; Dikeluarkan tanpa aksi; Dibatalkan hanya Buat ulang; yang belum keluar bisa dikembalikan`, salahMI === 0, `penyimpangan=${salahMI}`);

// ── Cadangan & ketersediaan: dihitung kode baru = hitung langsung dari tabel ──
const snap = await computeStockSnapshot(prisma);
const reservedSql = new Map((await prisma.$queryRawUnsafe(`select id, sum(q)::float q from (select l.material_id::text id, l.requested_qty::float q from material_issue_lines l join material_issues i on i.id = l.material_issue_id where i.status::text in (${RESERVED_STATUSES.map((s) => `'${s}'`).join(",")}) and i.production_plan_id is null union all select r.material_id::text, r.qty::float from material_reservations_v2 r where r.status = 'ACTIVE') u group by id`)).map((r) => [r.id, r.q]));
const bedaReserved = snap.filter((s) => Math.abs((reservedSql.get(s.materialId) ?? 0) - Number(s.reserved ?? 0)) > 1e-6).length;
cek(`Cadangan stok: ${snap.length} bahan — reserved dari kode baru = dokumen V1 Disetujui..Sudah diambil + reservasi Produksi V2 aktif (hitung langsung)`, bedaReserved === 0, `selisih=${bedaReserved}`);
const aktif = mis.filter((m) => !m.productionPlanId && ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED", "DRAFT"].includes(m.status));
let ketBad = 0; for (const m of aktif) { const ids = new Set(m.lines.map((l) => l.materialId)); const k = dg.ketersediaanBaris(snap.filter((s) => ids.has(s.materialId)), m.lines, { dokumenMencadang: RESERVED_STATUSES.includes(m.status) }); if (k.length !== m.lines.length || k.some((x) => x.cukup !== null && typeof x.cukup !== "boolean")) ketBad += 1; }
cek(`Ketersediaan: ${aktif.length} dokumen belum final — satu hasil per baris, bentuk benar`, ketBad === 0);

// ── Transfer ──
const sts = await prisma.stockTransfer.findMany({ include: { lines: { include: { material: { select: { code: true, name: true, unit: true } } } } } });
let salahST = 0; let terbuka = 0; let jalanN = 0; let selesaiN = 0;
for (const t of sts) {
  const tp = dg.tampilanTransfer(t); const kode = tp.aksi.map((a) => a.kode);
  if (!tp.label || tp.tahap.length !== 6) salahST += 1;
  if (t.status === "IN_TRANSIT") { jalanN += 1; if (!(kode.length === 1 && kode[0] === "TERIMA")) salahST += 1; const sp = await sel.saldoTransfer(prisma, t); if (sp.length !== t.lines.length || sp.some((x) => x.dikirim <= 0 || x.diterima !== null)) salahST += 1; }
  if (t.status === "COMPLETED") {
    selesaiN += 1; const s = await sel.selisihTransfer(prisma, t); const buka = sel.selisihTerbukaQty(s); if (buka > 0) terbuka += 1;
    const tp2 = dg.tampilanTransfer(t, { selisihTerbuka: buka }); const k2 = tp2.aksi.map((a) => a.kode);
    if (buka > 0 ? !(k2.length === 1 && k2[0] === "SELESAIKAN_SELISIH") : k2.length !== 0) salahST += 1;
    const sp = await sel.saldoTransfer(prisma, t); if (sp.some((x) => x.diterima === null)) salahST += 1;
    if (s.some((b) => b.kurang < 0 || b.sisa < 0 || b.sisa > b.kurang)) salahST += 1;
  }
  if (t.status === "CANCELLED" && !(kode.length === 1 && kode[0] === "BUAT_ULANG_TRANSFER")) salahST += 1;
  if (["DRAFT"].includes(t.status) && !(kode.includes("AJUKAN") && kode.includes("UBAH_ISI"))) salahST += 1;
}
cek(`Transfer: ${sts.length} dokumen nyata (${jalanN} dalam perjalanan, ${selesaiN} selesai) — status/aksi benar; saldo perjalanan terhitung; selisih nyata terbuka=${terbuka} (dilaporkan, TIDAK diubah)`, salahST === 0, `penyimpangan=${salahST}`);

// ── Opname, Restok, Rusak, Retur, Penyesuaian ──
async function periksa(nama, baris, fn, finalStatus, final) {
  let salah = 0; for (const r of baris) { const t = fn(r); if (!t.label || !Array.isArray(t.tahap) || !t.tahap.length || t.kode === "TIDAK_DIKENAL") salah += 1; if (finalStatus.includes(r.status) && t.aksi.length !== final) salah += 1; }
  cek(`${nama}: ${baris.length} dokumen nyata — status dikenal, ada alur, dokumen final tanpa aksi`, salah === 0, `penyimpangan=${salah}`);
}
await periksa("Stock Opname", await prisma.stockCount.findMany(), (c) => lain.tampilanOpname(c, { adaSelisih: false, bisaMenyetujuiSelisih: true }), ["COMPLETED", "CANCELLED"], 0);
await periksa("Restok", await prisma.replenishmentRequest.findMany(), (c) => lain.tampilanRestok(c), ["COMPLETED", "REJECTED"], 0);
await periksa("Barang Rusak", await prisma.damagedStockRecord.findMany(), (c) => lain.tampilanRusak(c), ["RESOLVED"], 0);
await periksa("Retur", await prisma.returnRecord.findMany(), (c) => lain.tampilanRetur(c), ["COMPLETED", "CANCELLED"], 0);
await periksa("Penyesuaian Stok", await prisma.stockAdjustmentRequest.findMany(), (c) => lain.tampilanPenyesuaian(c, { bisaSetujui: true, pemohonSama: false }), ["POSTED", "CANCELLED"], 0);

// ── Tahap 3: Penerimaan Barang — pipeline, perpindahan sah, riwayat status; Stok & Lokasi per kelompok ──
const tp = await import("/app/src/services/penerimaanStatus.js");
const grs = await prisma.goodsReceipt.findMany({ include: { lines: true } });
let salahGR = 0; const nomorGanda = new Set(); let adaNomorGanda = false; const perStatus = {};
for (const g of grs) {
  perStatus[g.status] = (perStatus[g.status] ?? 0) + 1; if (nomorGanda.has(g.receiptNumber)) adaNomorGanda = true; nomorGanda.add(g.receiptNumber);
  const t = tp.tampilanPenerimaan(g); const p = t.pipeline; if (!p || p.tahap.length !== 6 || typeof t.berikutnya !== "string" || !Array.isArray(p.pindah)) { salahGR += 1; continue; }
  if (g.status === "COMPLETED" && (p.pindah.length > 0 || !t.aksi.every((a) => a.kode.startsWith("KOREKSI")))) salahGR += 1; // terposting: hanya Koreksi
  if (g.status === "REJECTED" && p.indeks !== null) salahGR += 1;
  for (const x of p.pindah) { const ke = p.tahap.findIndex((y) => y.kode === x.ke); if (x.jenis === "maju" && ke !== p.indeks + 1) salahGR += 1; if (x.jenis === "mundur" && g.status !== "REJECTED" && ke !== p.indeks - 1) salahGR += 1; } // tanpa lompatan
}
cek(`Penerimaan Barang: ${grs.length} dokumen nyata (${JSON.stringify(perStatus)}) — pipeline enam tahap, perpindahan maju/mundur hanya satu langkah sah, terposting tanpa perpindahan, nomor GR unik`, salahGR === 0 && !adaNomorGanda, `penyimpangan=${salahGR}`);
const poGanda = await prisma.$queryRawUnsafe("select count(*)::int n from (select purchase_order_id from goods_receipts where purchase_order_id is not null group by 1 having count(*) > 1) x");
console.log(`INFO  PO dengan lebih dari satu penerimaan: ${poGanda[0].n} (tetap dokumen terpisah; tidak diubah)`);
const slk = await (await import("/app/src/services/stokLokasi.js")).stokLokasi(prisma);
const aktifN = slk.rows.filter((x) => x.aktif).length; const jmlKel = slk.kelompok.kelompok.reduce((a, x) => a + x.total, 0); const jmlJenis = slk.kelompok.jenis.reduce((a, x) => a + x.total, 0); const belumN = slk.kelompok.kelompok.find((x) => x.kode === "BELUM")?.total ?? -1;
cek(`Stok & Lokasi: ${aktifN} bahan aktif — jumlah per kelompok (${jmlKel}) dan per jenis (${jmlJenis}) sama dengan jumlah bahan aktif (tidak ada yang hilang); belum dikelompokkan=${belumN}; setiap bahan punya kelompok`, aktifN === jmlKel && aktifN === jmlJenis && slk.rows.every((x) => !!x.kelompok?.kode));

// ── Jejak: dibangun untuk semua dokumen tanpa galat ──
const contoh = [...mis.slice(0, 40).map((m) => ["material_issue", m.id]), ...sts.slice(0, 40).map((t) => ["stock_transfer", t.id])]; let jejakBad = 0;
for (const [tipe, id] of contoh) { try { const j = await dg.jejakDokumenGudang(prisma, { entityType: tipe, id, dibuatPada: new Date() }); if (!Array.isArray(j) || !j.length) jejakBad += 1; } catch { jejakBad += 1; } }
cek(`Jejak dokumen: ${contoh.length} dokumen nyata — dibangun tanpa galat`, jejakBad === 0);

// ── Tidak ada tulisan ──
let ubah = []; for (const t of TABEL) { const a = await n(`select count(*)::int n from ${t}`); if (a !== awal[t]) ubah.push(t); }
cek("tidak ada baris yang ditulis oleh pemeriksaan ini (pergerakan stok, dokumen Gudang, koreksi, jurnal, aktivitas)", ubah.length === 0, ubah.join(","));
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
