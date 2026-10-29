// Catatan pemakaian historis (Fase 1): impor idempoten, nilai asli utuh, penanda "Perlu dicek", tautan ke ISSUE lama tanpa penggandaan, tanpa efek stok/biaya/jurnal.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { rencanakanImpor, terapkanImpor, evaluasiUlang, ambilCatatanHistoris, ringkasCatatanUnits, riwayatCatatanUnit } from "../../src/services/catatanPemakaianHistoris.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, spek, qty, sat, harga = "", total = "") => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},${spek},BAHAN,"${qty}",${sat},${harga},${total},,,,QC OK`;
const csv = (rows) => ["JURNAL RINCIAN", "Data", HDR, ...rows].join("\n");
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);

async function dunia() {
  const m = {};
  m.busa = await createTestMaterial({ code: "T-BUSA", name: "BUSA ROLL TES", unit: "KG" });
  m.kain = await createTestMaterial({ code: "T-KAIN", name: "KAIN LAVA TES", unit: "METER" });
  m.lem = await createTestMaterial({ code: "T-LEM", name: "LEM I-SR TES 13 KG", unit: "CAN" });
  m.soft = await createTestMaterial({ code: "T-SOFT", name: "BUSA SOFT TES", unit: "SHEET" });
  m.tanpa = await createTestMaterial({ code: "T-TANPA", name: "BAHAN TANPA CATATAN", unit: "PCS" });
  m.swapA = await createTestMaterial({ code: "T-SWAP-A", name: "BUSA REBONDED TES 120X200", unit: "SHEET" });
  m.swapB = await createTestMaterial({ code: "T-SWAP-B", name: "BUSA REBONDED TES 200X200", unit: "SHEET" });
  const buka = WIB("2026-09-01");
  await seedBalance(m.busa.id, 50, { createdAt: buka }); await seedBalance(m.kain.id, 4, { createdAt: buka }); await seedBalance(m.lem.id, 3, { createdAt: buka });
  await seedBalance(m.soft.id, 10, { createdAt: buka }); await seedBalance(m.swapA.id, 5, { createdAt: buka }); await seedBalance(m.swapB.id, 5, { createdAt: buka });
  const mk = async (no) => { const { order, unit } = await createTestUnit({ status: "DELIVERED" }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "DELIVERED" } }); return unit; };
  const u1 = await mk("RES-01092026-901"); const u2 = await mk("RES-02092026-902"); const u3 = await mk("RES-03092026-903");
  // ISSUE lama (cara impor September): createMany bertanggal, tanpa pelaku
  const lama = (unit, mat, qty, no) => testPrisma.stockMovement.create({ data: { materialId: mat.id, type: "ISSUE", qty: -qty, unitId: unit.id, note: `Impor pemakaian Sept 2026 — order asli: X -> ${no}`, createdAt: WIB("2026-09-01") } });
  await lama(u1, m.busa, 3, "RES-01092026-901");   // Excel 1,2 → BEDA
  await lama(u1, m.kain, 1.7, "RES-01092026-901"); // Excel 1,7 → SAMA
  await lama(u1, m.lem, 1.5, "RES-01092026-901");  // Excel "1,5 KG" → satuan beda
  await lama(u1, m.swapA, 1, "RES-01092026-901");  // Excel memuat varian B → ISSUE lama tanpa pasangan
  return { m, u1, u2, u3 };
}
const CSV = csv([
  baris(1, "RES-01092026-901", "1 Sep 26", "Bahan Lapisan", "BUSA ROLL TES", "HR", "1,2", "KG", "Rp 36.000", "Rp 43.200"),
  baris(2, "RES-01092026-901", "1 Sep 26", "Bahan Lapisan", "KAIN LAVA TES", "COVER", "1,7", "METER"),
  baris(3, "RES-01092026-901", "1 Sep 26", "Lain-lain", "LEM I-SR TES 13 KG", "SEMPROT", "1,5", "KG", "Rp 3.842", "Rp 5.763"),
  baris(4, "RES-01092026-901", "1 Sep 26", "Bahan Fondasi", "BUSA REBONDED TES 200X200", "", "1,0", "LEMBAR"),
  baris(5, "RES-01092026-901", "1 Sep 26", "Bahan Lapisan", "MEMORY FOAM KILOAN", "", "2,0", "KG"),
  baris(6, "RES-01092026-901", "1 Sep 26", "Lain-lain", "BAHAN GAIB XYZ", "", "1,0", "PCS"),
  baris(7, "RES-02092026-902", "2 Sep 26", "Bahan Lapisan", "BUSA SOFT TES", "", "1,0", "LEMBAR"),
  baris(8, "RES-02092026-902", "2 Sep 26", "Bahan Lapisan", "KAIN LAVA TES", "", "10,0", "METER"),
  baris(9, "RES-02092026-902", "2 Sep 26", "Bahan Lapisan", "BAHAN TANPA CATATAN", "", "1,0", "PCS"),
  baris(10, "RES-02092026-902", "2 Sep 26", "Lain-lain", "BUSA ROLL TES", "", "0,0", "KG"),
  baris(11, "RES-03092026-903", "3 Sep 26", "Bahan Lapisan", "BUSA SOFT TES", "", "2,0", "LEMBAR"),
  baris(12, "RES-03092026-903", "3 Sep 26", "Bahan Lapisan", "BUSA SOFT TES", "", "2,0", "LEMBAR"),
  baris(13, "RES-03092026-903", "3 Sep 26", "Lain-lain", "BUSA ROLL TES", "", "abc", "KG"),
]);
const flagKode = (n) => (n.flags ?? []).map((f) => f.kode).sort();

test("C1. impor: nilai ASLI utuh; setiap baris punya keadaan + penanda; TIDAK menulis stok/biaya/jurnal", async () => {
  const w = await dunia();
  const mv0 = await testPrisma.stockMovement.count(); const jur0 = await testPrisma.finJournalEntry.count(); const val0 = await testPrisma.finStockMovementValuation.count();
  const rencana = await rencanakanImpor(testPrisma, { csvText: CSV, namaBerkas: "uji.csv" });
  const r = await terapkanImpor(testPrisma, rencana, {});
  assert.equal(r.batchBaru, true); assert.equal(r.dibuat, 13 + 1, "13 baris Excel + 1 catatan LEDGER (ISSUE lama tanpa pasangan)");
  assert.equal(await testPrisma.stockMovement.count(), mv0, "tidak ada pergerakan stok baru"); assert.equal(await testPrisma.finJournalEntry.count(), jur0); assert.equal(await testPrisma.finStockMovementValuation.count(), val0);

  const byRow = Object.fromEntries((await testPrisma.unitUsageNote.findMany({ where: { origin: "EXCEL" } })).map((n) => [n.sourceRow, n]));
  const nomor = (i) => byRow[3 + i]; // catatan ke-i: record header = ke-3, data pertama = ke-4
  const n1 = nomor(1), n2 = nomor(2), n3 = nomor(3), n4 = nomor(4), n5 = nomor(5), n6 = nomor(6);
  // 1) jumlah beda dengan ISSUE lama → Perlu dicek (tidak diubah otomatis)
  assert.equal(n1.state, "PERLU_DICEK"); assert.deepEqual(flagKode(n1), ["ISSUE_LAMA_BERBEDA"]); assert.equal(n1.rawQty, "1,2"); assert.equal(Number(n1.qty), 1.2);
  // 2) sama → tertaut (tidak digandakan)
  assert.equal(n2.state, "TERCATAT_DI_STOK"); assert.equal(n2.linkKind, "ISSUE_LAMA_SAMA"); assert.ok(n2.stockMovementId);
  // 3) LEM "1,5 KG" pada bahan CAN: TIDAK dikonversi; nilai asli tetap; perlu dikonfirmasi
  assert.equal(n3.state, "PERLU_DICEK"); assert.ok(flagKode(n3).includes("SATUAN_BEDA_MASTER")); assert.equal(n3.rawQty, "1,5"); assert.equal(n3.rawUom, "KG"); assert.equal(Number(n3.qty), 1.5);
  const f3 = n3.flags.find((f) => f.kode === "SATUAN_BEDA_MASTER"); assert.match(f3.teks, /1,5 KG/); assert.match(f3.aksi, /Tidak dikonversi otomatis/); assert.equal(f3.data.kemasanKg, 13);
  // 4) varian tertukar: Excel varian B tanpa ISSUE → bergantung pada ISSUE lama tanpa pasangan di unit yang sama
  assert.equal(n4.state, "PERLU_DICEK"); assert.ok(flagKode(n4).includes("BERGANTUNG_ISSUE_LAMA"));
  // 5) KILOAN BUKAN komponen lama (cara beli): tanpa bukti asal → perlu dicek (BLOK); komponen lama eksplisit diuji di kiloanAsalBahan; 6) bahan tak dikenal → tidak ditebak
  assert.equal(n5.state, "PERLU_DICEK"); assert.deepEqual(flagKode(n5), ["ASAL_BAHAN_PERLU_DICEK", "NAMA_TIDAK_DI_KATALOG"]); assert.equal(n6.state, "PERLU_DICEK"); assert.deepEqual(flagKode(n6), ["NAMA_TIDAK_DI_KATALOG"]); assert.equal(n6.materialId, null);
  // order 2: soft aman; kain tidak cukup (saldo 4, sudah dipakai 1,7 oleh ISSUE lama → 2,3 tersisa; butuh 10); bahan tanpa catatan; qty 0
  assert.equal(nomor(7).state, "SIAP_POSTING"); assert.equal(nomor(8).state, "PERLU_DICEK"); assert.ok(flagKode(nomor(8)).includes("SALDO_TIDAK_CUKUP"));
  assert.equal(nomor(9).state, "PERLU_DICEK"); assert.ok(flagKode(nomor(9)).includes("TANPA_SALDO_PEMBUKA")); assert.equal(nomor(10).state, "TIDAK_DIHITUNG");
  // order 3: baris berulang ditahan (tidak diam-diam digandakan); jumlah tak terbaca ditandai
  assert.ok(flagKode(nomor(11)).includes("BARIS_BERULANG") && flagKode(nomor(12)).includes("BARIS_BERULANG")); assert.notEqual(nomor(11).sourceKey, nomor(12).sourceKey);
  assert.ok(flagKode(nomor(13)).includes("QTY_TIDAK_VALID")); assert.equal(nomor(13).rawQty, "abc");
  // catatan LEDGER untuk ISSUE lama tanpa pasangan
  const led = await testPrisma.unitUsageNote.findMany({ where: { origin: "LEDGER" } }); assert.equal(led.length, 1); assert.equal(led[0].state, "PERLU_DICEK"); assert.deepEqual(flagKode(led[0]), ["ISSUE_TANPA_PASANGAN"]); assert.equal(led[0].materialId, w.m.swapA.id);
  // setiap catatan punya peristiwa IMPOR
  assert.equal(await testPrisma.unitUsageNoteEvent.count({ where: { kind: "IMPOR" } }), 14);
});

test("C2. impor ULANG berkas yang sama = nol perubahan; berkas berubah hanya menambah baris baru", async () => {
  await dunia();
  const a = await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: CSV, namaBerkas: "uji.csv" }), {});
  const n0 = await testPrisma.unitUsageNote.count(); const e0 = await testPrisma.unitUsageNoteEvent.count(); const b0 = await testPrisma.usageImportBatch.count();
  const b = await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: CSV, namaBerkas: "uji.csv" }), {});
  assert.equal(a.dibuat > 0, true); assert.equal(b.batchBaru, false); assert.equal(b.dibuat, 0); assert.equal(b.dilewati, a.dibuat);
  assert.equal(await testPrisma.unitUsageNote.count(), n0); assert.equal(await testPrisma.unitUsageNoteEvent.count(), e0); assert.equal(await testPrisma.usageImportBatch.count(), b0);
  // versi berkas baru (satu baris tambahan; baris lama sama persis) → batch baru, hanya satu catatan baru
  const csv2 = CSV + "\n" + baris(14, "RES-02092026-902", "2 Sep 26", "Lain-lain", "BUSA SOFT TES", "", "1,0", "LEMBAR");
  const c = await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv2, namaBerkas: "uji-v2.csv" }), {});
  assert.equal(c.batchBaru, true); assert.equal(c.dibuat, 1); assert.equal(await testPrisma.unitUsageNote.count(), n0 + 1);
});

test("C3. nilai asli dan identitas dikunci trigger; catatan tidak bisa dihapus; peristiwa append-only", async () => {
  await dunia();
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: CSV, namaBerkas: "uji.csv" }), {});
  const n = await testPrisma.unitUsageNote.findFirst({ where: { origin: "EXCEL", rawQty: "1,5" } });
  await assert.rejects(() => testPrisma.unitUsageNote.update({ where: { id: n.id }, data: { rawQty: "1,50" } }), /tidak boleh diubah/);
  await assert.rejects(() => testPrisma.unitUsageNote.update({ where: { id: n.id }, data: { orderNumber: "X" } }), /tidak boleh diubah/);
  await assert.rejects(() => testPrisma.unitUsageNote.delete({ where: { id: n.id } }), /tidak boleh dihapus/);
  const ev = await testPrisma.unitUsageNoteEvent.findFirst();
  await assert.rejects(() => testPrisma.unitUsageNoteEvent.update({ where: { id: ev.id }, data: { reason: "x" } }), /append-only/);
  await assert.rejects(() => testPrisma.unitUsageNoteEvent.delete({ where: { id: ev.id } }), /append-only/);
  // nilai teruraikan boleh berubah (lewat layanan berjejak); raw tetap
  await testPrisma.unitUsageNote.update({ where: { id: n.id }, data: { evaluatedAt: new Date() } });
});

test("C4. tampilan Produksi: ambilCatatanHistoris menampilkan nilai asli, label 'Perlu dicek' + catatan singkat; ringkas; riwayat", async () => {
  const w = await dunia();
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: CSV, namaBerkas: "uji.csv" }), { actorId: null });
  const v = await ambilCatatanHistoris(testPrisma, w.u1.id);
  assert.equal(v.ringkas.total, 7, "6 baris Excel + 1 catatan LEDGER"); assert.equal(v.ringkas.tercatatDiStok, 1); assert.equal(v.ringkas.bukanStok, 0, "KILOAN bukan komponen lama (cara beli): tanpa bukti asal = perlu dicek");
  assert.equal(v.items[0].state, "PERLU_DICEK", "yang perlu dicek tampil paling atas");
  const lem = v.items.find((i) => i.nama === "LEM I-SR TES 13 KG");
  assert.equal(lem.label, "Perlu dicek"); assert.equal(lem.qtyAsli, "1,5"); assert.equal(lem.satuanAsli, "KG"); assert.match(lem.catatan, /Konfirmasi ke Admin Sales/);
  const sama = v.items.find((i) => i.nama === "KAIN LAVA TES"); assert.equal(sama.label, "Sudah tercatat di stok"); assert.match(sama.pergerakan.ref, /^MV-/);
  const nol = await ambilCatatanHistoris(testPrisma, w.u2.id); assert.equal(nol.items.some((i) => i.state === "TIDAK_DIHITUNG"), false, "jumlah 0 tidak tampil sebagai pemakaian"); assert.equal(nol.ringkas.tidakDihitung, 1);
  const r = await ringkasCatatanUnits(testPrisma, [w.u1.id, w.u2.id]); assert.equal(r.get(w.u1.id).perluDicek >= 3, true); assert.equal(r.get(w.u2.id).siapPosting, 1);
  const rw = await riwayatCatatanUnit(testPrisma, w.u1.id); assert.equal(rw[0].kind, "CATATAN_HISTORIS"); assert.match(rw[0].label, /bukan pengeluaran stok baru/);
});

test("C5. evaluasi ulang idempoten; berubah hanya bila ledger berubah (penerimaan baru melepas 'saldo tidak cukup')", async () => {
  const w = await dunia();
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: CSV, namaBerkas: "uji.csv" }), {});
  const e1 = await evaluasiUlang(testPrisma, {}); assert.equal(e1.berubah, 0, "tanpa perubahan ledger = tanpa perubahan " + JSON.stringify(e1.detail));
  const ev0 = await testPrisma.unitUsageNoteEvent.count();
  await seedBalance(w.m.kain.id, 20, { createdAt: WIB("2026-09-01") }); // saldo bahan bertambah (penerimaan historis berbukti)
  const e2 = await evaluasiUlang(testPrisma, { actorId: null }); assert.ok(e2.berubah >= 1);
  const n = await testPrisma.unitUsageNote.findFirst({ where: { origin: "EXCEL", rawQty: "10,0", rawName: "KAIN LAVA TES" } });
  assert.equal(n.state, "SIAP_POSTING"); assert.equal(await testPrisma.unitUsageNoteEvent.count(), ev0 + e2.berubah);
  const e3 = await evaluasiUlang(testPrisma, {}); assert.equal(e3.berubah, 0, "evaluasi ulang kedua idempoten");
});

test("C6. impor tidak mengubah ISSUE lama, saldo, atau tampilan 'Pemakaian aktual' (catatan terpisah dari ledger)", async () => {
  const w = await dunia();
  const sebelum = await testPrisma.stockMovement.findMany({ orderBy: { id: "asc" } });
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: CSV, namaBerkas: "uji.csv" }), {});
  const sesudah = await testPrisma.stockMovement.findMany({ orderBy: { id: "asc" } });
  assert.deepEqual(sesudah.map((m) => [m.id, String(m.qty), m.createdAt.toISOString()]), sebelum.map((m) => [m.id, String(m.qty), m.createdAt.toISOString()]));
  assert.equal(w.m.busa.id !== undefined, true);
});

test("C7. pemakaian pada unit DIBATALKAN ditandai 'Perlu dicek' (tidak diam-diam dianggap wajar); unit DELIVERED tidak", async () => {
  const kain = await createTestMaterial({ code: "T-KAIN7", name: "KAIN UJI BATAL", unit: "METER" }); await seedBalance(kain.id, 50, { createdAt: WIB("2026-09-01") });
  const mk = async (no, status) => { const { order, unit } = await createTestUnit({ status }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no } }); return unit; };
  const uB = await mk("RES-04092026-904", "CANCELLED"); const uD = await mk("RES-04092026-905", "DELIVERED");
  const csv2 = csv([baris(1, "RES-04092026-904", "4 Sep 26", "Bahan Lapisan", "KAIN UJI BATAL", "", "1,0", "METER"), baris(2, "RES-04092026-905", "4 Sep 26", "Bahan Lapisan", "KAIN UJI BATAL", "", "1,0", "METER")]);
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv2, namaBerkas: "batal.csv" }), {});
  const b = await testPrisma.unitUsageNote.findFirst({ where: { unitId: uB.id } }); const d = await testPrisma.unitUsageNote.findFirst({ where: { unitId: uD.id } });
  assert.equal(b.state, "PERLU_DICEK"); assert.deepEqual(flagKode(b), ["UNIT_DIBATALKAN"]); assert.match(b.flags[0].aksi, /retur/);
  assert.equal(d.state, "SIAP_POSTING");
});
