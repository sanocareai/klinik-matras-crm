// KANDIDAT GABUNGAN (pembaca + biaya + koreksi + drawer): Catatan Historis per periode satuan, referensi Agustus tidak berlaku pada satuan baru, transfer bahan bertransisi, koreksi penambahan bertanggal klaim sesudah SO.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { pratinjauTransisi, terapkanTransisi } from "../../src/services/transisiSatuanBahan.js";
import { tautkanSO } from "../../src/services/pengamanHistorisPascaSO.js";
import { rencanakanImpor, terapkanImpor, ambilCatatanHistoris } from "../../src/services/catatanPemakaianHistoris.js";
import { computeStockSnapshot } from "../../src/services/inventoryLedger.js";
import { ringkasanBahan } from "../../src/services/finance/hargaBerlaku.js";
import { saldoTransfer, selisihTransfer } from "../../src/services/selisihTransfer.js";
import { ajukanKoreksiPemakaian, setujuiKoreksiPemakaian } from "../../src/services/koreksiPemakaian.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const HARI = 86400_000; const HASH = "f5d08fab2c0b38a0b84ebbf712a1655723133af599c69b64b758a626f5033a9d";
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
let seq = 0; const kunci = (p = "k") => `${p}-${Date.now()}-${++seq}-uji-gabungan-satuan`;

async function aktor() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const owner = await createTestUser({ roles: ["OWNER"] }); const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  return { owner, lead, B: { id: owner.user.id, name: owner.user.name, roles: ["OWNER"] }, L: { id: lead.user.id, name: lead.user.name, roles: ["PRODUCTION_LEAD"] } };
}
async function transisi(B, m, saldoBaru = 720) {
  const minta = { materialId: m.id, satuanBaru: "METER", saldoBaru };
  const p = await pratinjauTransisi(testPrisma, { aktor: B, transisi: [minta] }); assert.equal(p.bolehDiterapkan, true, JSON.stringify(p.transisi[0].penghalang));
  await terapkanTransisi(testPrisma, { aktor: B, transisi: [{ ...minta, hashPratinjau: p.transisi[0].hash }], sumber: "SO uji", alasan: "Satuan mengikuti Excel SO", rujukanHash: HASH, kunci: kunci("tr") });
  await new Promise((r) => setTimeout(r, 20));
}

// ── 1. Catatan Historis: periode satuan ──
const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan,Total,,,,Catatan QC';
const baris = (no, order, kat, nama, qty, sat) => `${no},${order},1 Sep 26,SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const csv = (rows) => ["JURNAL RINCIAN", "Data", HDR, ...rows].join("\n");

async function dunia1({ barang = "campur" } = {}) {
  const w = await aktor();
  const m = await createTestMaterial({ code: "T-LIST-PER", name: "LIST PERIODE TES", unit: "ROLL", itemGroup: "LIST" });
  await seedBalance(m.id, 20, { createdAt: WIB("2026-09-01") });
  const { order, unit } = await createTestUnit({ status: "DELIVERED" }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: "RES-01092026-951", status: "DELIVERED" } });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -2, unitId: unit.id, note: "Impor pemakaian Sept 2026 — order asli: X -> RES-01092026-951", createdAt: WIB("2026-09-01") } });
  await transisi(w.B, m, 1620);
  if (barang === "campur") await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -5, unitId: unit.id, note: "Pemakaian baru (METER)", createdAt: new Date() } });
  return { ...w, m, unit };
}
const impor = async (rows) => terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv(rows), namaBerkas: "uji.csv" }), {});
const catatan = async (w) => (await testPrisma.unitUsageNote.findMany({ where: { materialId: w.m.id } }));
const flagKode = (n) => (n.flags ?? []).map((f) => f.kode);

test("S1. ledger LINTAS satuan (ROLL lalu METER) tidak dijumlahkan: catatan Excel 2 ROLL → ISSUE_LAMA_LINTAS_SATUAN (tidak dapat dibandingkan), bukan 'tercatat' atau selisih palsu", async () => {
  const w = await dunia1({ barang: "campur" });
  await impor([baris(1, "RES-01092026-951", "Bahan Lapisan", "LIST PERIODE TES", "2,0", "ROLL")]);
  const n = (await catatan(w))[0]; assert.ok(n, "catatan Excel terimpor");
  assert.ok(flagKode(n).includes("ISSUE_LAMA_LINTAS_SATUAN"), JSON.stringify([n.state, flagKode(n)]));
  assert.notEqual(n.state, "TERCATAT_DI_STOK"); assert.ok(!flagKode(n).includes("ISSUE_LAMA_BERBEDA"), "tidak boleh membandingkan 2 ROLL dengan jumlah lintas satuan");
});

test("S2. ledger HANYA periode satuan lama (ROLL) dan catatan Excel dalam ROLL: sebanding walau master sudah METER → tercatat di stok, tanpa 'satuan beda master'", async () => {
  const w = await dunia1({ barang: "lama-saja" });
  const rows = [baris(1, "RES-01092026-951", "Bahan Lapisan", "LIST PERIODE TES", "2,0", "ROLL")];
  await impor(rows);
  const n = (await catatan(w))[0]; assert.ok(n);
  assert.equal(n.state, "TERCATAT_DI_STOK", JSON.stringify([n.state, flagKode(n)])); assert.ok(!flagKode(n).includes("ISSUE_LAMA_SATUAN_BEDA") && !flagKode(n).includes("ISSUE_LAMA_LINTAS_SATUAN"));
});

// ── 2. Referensi Agustus tidak berlaku pada satuan baru ──
test("S3. referensi harga Agustus per ROLL: sebelum transisi tampil; sesudahnya null + penanda satuan tidak cocok di snapshot stok, Harga Berlaku, dan harga GR terakhir hanya dari satuan baru", async () => {
  const w = await aktor();
  const m = await createTestMaterial({ code: "T-REF-1", name: "BAHAN REFERENSI TES", unit: "ROLL", referenceUnitCost: 100000, referenceUnitCostMonth: "2026-08", referenceStockValue: 1000000 });
  await seedBalance(m.id, 10, { type: "RECEIPT", unitCost: 100000, createdAt: WIB("2026-09-01") });
  const sebelum = (await computeStockSnapshot(testPrisma)).find((r) => r.materialId === m.id);
  assert.equal(Number(sebelum.referenceUnitCost), 100000); assert.equal(sebelum.referensiTidakCocok, undefined); assert.equal(Number(sebelum.latestUnitCost), 100000);
  const rb0 = await ringkasanBahan(testPrisma, m.id); assert.equal(Number(rb0.pembanding.referensiAgustus.harga), 100000); assert.equal(Number(rb0.pembanding.biayaPerolehanGRTerakhir?.harga ?? 0), 100000);
  await transisi(w.B, m, 900);
  const sesudah = (await computeStockSnapshot(testPrisma)).find((r) => r.materialId === m.id);
  assert.equal(sesudah.referenceUnitCost, null, "tidak ada angka pembanding"); assert.equal(sesudah.referensiTidakCocok.satuanReferensi, "ROLL"); assert.equal(sesudah.referensiTidakCocok.satuanSekarang, "METER"); assert.match(sesudah.referensiTidakCocok.teks, /tidak berlaku untuk satuan METER/);
  assert.equal(Number(sesudah.referenceStockValue), 1000000, "nilai stok referensi (Rupiah) tidak bergantung satuan");
  assert.equal(sesudah.latestUnitCost, null, "harga penerimaan terakhir per ROLL tidak dipakai untuk METER");
  const rb1 = await ringkasanBahan(testPrisma, m.id);
  assert.equal(rb1.pembanding.referensiAgustus, null); assert.equal(rb1.pembanding.referensiAgustusTidakCocok.satuanReferensi, "ROLL"); assert.equal(rb1.pembanding.biayaPerolehanGRTerakhir, null);
  await seedBalance(m.id, 90, { type: "RECEIPT", unitCost: 1000, createdAt: new Date() });
  const lagi = (await computeStockSnapshot(testPrisma)).find((r) => r.materialId === m.id); assert.equal(Number(lagi.latestUnitCost), 1000, "penerimaan satuan baru kembali menjadi harga terakhir");
});

// ── 3. Transfer dan transisi ──
async function transfer(m, status, { qtySent = 2, qtyReceived = null } = {}) {
  const wh = await testPrisma.warehouse.create({ data: { code: `WH-${++seq}`, name: "Gudang Uji" } });
  const a = await testPrisma.storageLocation.create({ data: { code: `LA-${seq}`, warehouseId: wh.id, locationType: "RAW_MATERIAL_AREA", zone: "A" } });
  const b = await testPrisma.storageLocation.create({ data: { code: `LB-${seq}`, warehouseId: wh.id, locationType: "WIP_AREA", zone: "B" } });
  return testPrisma.stockTransfer.create({ data: { transferNumber: `TR-GAB-${seq}`, transferType: "BIN_TO_BIN", sourceLocationId: a.id, destinationLocationId: b.id, status, lines: { create: [{ materialId: m.id, qtySent, qtyReceived }] } }, include: { lines: { include: { material: true } } } });
}

test("S4. transfer BERJALAN atau selisih kirim/terima belum selesai menahan transisi (jumlah berbasis satuan lama); transfer selesai tanpa selisih tidak", async () => {
  const w = await aktor();
  const m = await createTestMaterial({ code: "T-TRF-1", name: "BAHAN TRANSFER TES", unit: "ROLL" }); await seedBalance(m.id, 20, { createdAt: WIB("2026-09-01") });
  const kode = async () => ((await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: [{ materialId: m.id, satuanBaru: "METER", saldoBaru: 100 }] })).transisi[0].penghalang).map((x) => x.kode);
  assert.ok(!(await kode()).some((k) => /TRANSFER/.test(k)), "tanpa transfer tidak ada penghalang transfer");
  const jalan = await transfer(m, "IN_TRANSIT"); assert.ok((await kode()).includes("TRANSFER_BERJALAN"));
  await testPrisma.stockTransfer.update({ where: { id: jalan.id }, data: { status: "COMPLETED" } }); await testPrisma.stockTransferLine.updateMany({ where: { stockTransferId: jalan.id }, data: { qtyReceived: 1 } });
  assert.ok((await kode()).includes("SELISIH_TRANSFER_TERBUKA"), "kirim 2 terima 1 dan belum diselesaikan");
  await testPrisma.stockTransferLine.updateMany({ where: { stockTransferId: jalan.id }, data: { qtyReceived: 2 } });
  assert.ok(!(await kode()).some((k) => /TRANSFER/.test(k)), "transfer selesai tanpa selisih tidak menahan");
});

test("S5. perjalanan saldo transfer lama sesudah transisi: label satuan SAAT transfer (ROLL), saldo sekarang tidak dibandingkan lintas satuan; bahan tanpa transisi tidak berubah", async () => {
  const w = await aktor();
  const m = await createTestMaterial({ code: "T-TRF-2", name: "BAHAN TRANSFER DUA", unit: "ROLL" }); await seedBalance(m.id, 20, { createdAt: WIB("2026-09-01") });
  const t = await transfer(m, "COMPLETED", { qtySent: 2, qtyReceived: 2 });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "TRANSFER", qty: -2, stockTransferId: t.id, createdAt: WIB("2026-09-05"), note: "Dispatch" } });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "TRANSFER", qty: 2, stockTransferId: t.id, createdAt: WIB("2026-09-06"), note: "Receive TR" } });
  const penuh = await testPrisma.stockTransfer.findUnique({ where: { id: t.id }, include: { lines: { include: { material: true } } } });
  const lama = await saldoTransfer(testPrisma, penuh); assert.equal(lama[0].unit, "ROLL"); assert.equal(lama[0].sekarang, 20, "tanpa transisi: perilaku lama"); assert.equal(lama[0].sekarangTidakDapatDibandingkan, undefined);
  await transisi(w.B, m, 1800);
  const penuh2 = await testPrisma.stockTransfer.findUnique({ where: { id: t.id }, include: { lines: { include: { material: true } } } });
  const baru = await saldoTransfer(testPrisma, penuh2);
  assert.equal(baru[0].unit, "ROLL", "label satuan saat transfer"); assert.equal(baru[0].satuanMaster, "METER"); assert.equal(baru[0].sekarang, null); assert.match(baru[0].sekarangTidakDapatDibandingkan, /tidak dapat dibandingkan/i);
  assert.equal(baru[0].dikirim, 2); assert.equal(baru[0].sebelumKirim, 20);
  assert.deepEqual(await selisihTransfer(testPrisma, penuh2), [], "tanpa selisih");
});

// ── 4. Koreksi penambahan bertanggal klaim sesudah SO = tambahan pemakaian NYATA; pemakaian asal tidak ditulis ulang ──
test("S6. koreksi tambah dengan tanggal klaim SESUDAH SO: pergerakan BARU bertaut (correctsMovementId) dengan alasan dan tanggal dilaporkan tercatat; ISSUE asal (tanggal, jumlah, harga beku) tidak berubah", async () => {
  const w = await aktor();
  const { unit } = await createTestUnit({ status: "DELIVERED", createdAt: new Date(Date.now() - 30 * HARI) });
  const m = await createTestMaterial({ code: "T-KOR-1", name: "BAHAN KOREKSI TES", unit: "METER" });
  await seedBalance(m.id, 50, { type: "RECEIPT", unitCost: 20000, createdAt: new Date(Date.now() - 40 * HARI) });
  const asal = await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -2, unitId: unit.id, createdAt: new Date(Date.now() - 10 * HARI), note: "Pemakaian asal", createdById: w.owner.user.id } });
  await tautkanSO(testPrisma, { aktor: w.B, materialId: m.id, soTanggal: wib(Date.now() - 2 * HARI), sumber: "SO uji", alasan: "Hasil SO ditautkan eksplisit untuk uji", rujukanHash: "hash-manifest-so-uji-0001", kunci: kunci("taut") });
  const sebelum = await testPrisma.stockMovement.findUnique({ where: { id: asal.id } }); const saldo0 = Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m.id }, _sum: { qty: true } }))._sum.qty);
  const hariIni = wib(Date.now()); const ALASAN = "Dua meter lagi terpakai setelah SO, terlewat dicatat";
  const k = await ajukanKoreksiPemakaian(testPrisma, { unitId: unit.id, materialId: m.id, qtyBaru: 4, alasan: ALASAN, kunci: kunci("kor"), aktor: w.L, tanggalPemakaian: hariIni });
  const ok = await setujuiKoreksiPemakaian(testPrisma, { koreksiId: k.id, aktor: w.B, catatan: "disetujui" });
  assert.ok(ok);
  const baru = await testPrisma.stockMovement.findMany({ where: { correctsMovementId: asal.id } });
  assert.equal(baru.length, 1, "tepat satu pergerakan tambahan bertaut"); assert.equal(baru[0].type, "ISSUE"); assert.equal(Number(baru[0].qty), -2, "hanya selisih");
  assert.ok(String(baru[0].reason).includes(ALASAN), "alasan tercatat"); assert.ok(String(baru[0].note).includes(`[dilaporkan ${hariIni}]`), "tanggal pemakaian dilaporkan tercatat: " + baru[0].note);
  const sesudah = await testPrisma.stockMovement.findUnique({ where: { id: asal.id } });
  assert.deepEqual([sesudah.createdAt.toISOString(), String(sesudah.qty), sesudah.note, sesudah.unitCost], [sebelum.createdAt.toISOString(), String(sebelum.qty), sebelum.note, sebelum.unitCost], "ISSUE asal tidak ditulis ulang (tanggal/jumlah/catatan/harga)");
  const val = await testPrisma.finStockMovementValuation.findMany({ where: { movementId: asal.id } });
  assert.equal(val.length, 0, "tidak ada penilaian ulang pada ISSUE asal");
  assert.equal(Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m.id }, _sum: { qty: true } }))._sum.qty), saldo0 - 2, "saldo berkurang tepat sebesar tambahan");
});
