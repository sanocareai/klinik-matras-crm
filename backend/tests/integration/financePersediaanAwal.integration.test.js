// B3.6 — Tutup stok periodik & persediaan awal perpetual (cutover bawaan 1 Okt 2026; jurnal bertanggal 30 Sep 2026).
// Tanggal diatur eksplisit di data uji, jadi tes tidak bergantung pada tanggal hari ini.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postGoodsReceiptValue } from "../../src/services/finance/posting/supplier.js";
import { postStockMovementCost } from "../../src/services/finance/posting/inventory.js";
import { toMoney } from "../../src/services/finance/money.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const WIB = (tgl, jam = "12:00") => new Date(`${tgl}T${jam}:00+07:00`);
let seq = 0;

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const owner = await createTestUser({ roles: ["OWNER"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const ganda = await createTestUser({ roles: ["FINANCE", "WAREHOUSE"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const c = (u, o) => makeClient(server.baseUrl, u.token, o);
  const A = await createTestMaterial({ code: "BUSA-A", name: "Busa A", unit: "SHEET", referenceUnitCost: 10_000 });
  const B = await createTestMaterial({ code: "PLASTIK-B", name: "Plastik B", unit: "KG", referenceUnitCost: 31_080 });
  const KAYU = await createTestMaterial({ code: "KAYU-C", name: "Kayu C", unit: "ROD", referenceUnitCost: 1_609_500 });
  const sup = await testPrisma.finSupplier.create({ data: { code: `SUP-${++seq}`, name: "PT Uji Bahan" } });
  return { bank, owner, admin, finance, gudang, o: c(owner), ad: c(admin), gd: c(ganda), f: c(finance), g: c(gudang), oTanpaPin: c(owner, { tanpaStepUp: true }), A, B, KAYU, sup };
}

async function isi(ctx, id, baris, mode = "ganti") {
  // httpClient hanya punya GET/POST/PATCH/DELETE; kirim PUT langsung lewat fetch.
  const res = await fetch(`${server.baseUrl}/api/finance/persediaan-awal/${id}/baris`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.finance.token}` }, body: JSON.stringify({ baris, mode }),
  });
  return { status: res.status, body: await res.json() };
}
const rowA = (o = {}) => ({ kode: "BUSA-A", qty: 10, satuan: "SHEET", harga: 10_000, sumber: "FAKTUR", referensi: "INV-A-01", ...o });
const rowB = (o = {}) => ({ kode: "PLASTIK-B", qty: "20,5", satuan: "KG", harga: 30_000, sumber: "TAGIHAN", referensi: "BILL-01092026-001", ...o });

async function snapshotSiap(ctx, baris = [rowA(), rowB()]) {
  const d = await ctx.f.post("/api/finance/persediaan-awal", { catatan: "Opname akhir Sep" });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const r = await isi(ctx, d.body.id, baris);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p1 = await ctx.f.post(`/api/finance/persediaan-awal/${d.body.id}/periksa`, { peran: "FINANCE" });
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  const p2 = await ctx.g.post(`/api/finance/persediaan-awal/${d.body.id}/periksa`, { peran: "GUDANG" });
  assert.equal(p2.status, 200, JSON.stringify(p2.body));
  assert.equal(p2.body.snapshot.status, "DIPERIKSA");
  return d.body.id;
}
const posting = (ctx, id, alasan = "Opname 30 Sep disetujui Owner") => ctx.o.post(`/api/finance/persediaan-awal/${id}/posting`, { alasan });

async function saldo(code, sampai = null) {
  const a = await testPrisma.finAccount.findUnique({ where: { code } });
  const agg = await testPrisma.finJournalLine.aggregate({
    where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] }, ...(sampai && { date: { lte: new Date(`${sampai}T00:00:00Z`) } }) } },
    _sum: { debit: true, credit: true },
  });
  return toMoney(agg._sum.debit || 0).minus(toMoney(agg._sum.credit || 0)).toNumber();
}
const jumlahJurnalPembuka = () => testPrisma.finJournalEntry.count({ where: { source: "PERSEDIAAN_AWAL" } });

// ── 1. snapshot valid & pratinjau ────────────────────────────────────────────────────────────────────────────────────

test("Snapshot valid: diperiksa Finance + Gudang → terkunci dengan hash; pratinjau Dr 1-1400 / Cr 5-1100 seimbang dan tidak menulis jurnal", async () => {
  const ctx = await siapkan();
  const id = await snapshotSiap(ctx);
  const d = await ctx.f.get(`/api/finance/persediaan-awal/${id}`);
  assert.equal(d.body.snapshot.cutover, "2026-10-01");
  assert.match(d.body.snapshot.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(d.body.snapshot.lineCount, 2);
  assert.equal(Number(d.body.snapshot.totalValue), 100_000 + 615_000);
  assert.equal(d.body.snapshot.pencatat !== undefined, true);
  const b = d.body.baris.find((x) => x.kode === "PLASTIK-B");
  assert.equal(b.qty, "20.5"); assert.equal(b.nilai, "615000.00"); assert.equal(b.sumberLabel, "Tagihan supplier di sistem");
  assert.equal(d.body.validasi.blocker.length, 0);

  const pr = await ctx.f.get(`/api/finance/persediaan-awal/${id}/pratinjau`);
  assert.equal(pr.status, 200, JSON.stringify(pr.body));
  assert.equal(pr.body.tanggalJurnal, "2026-09-30");
  assert.equal(pr.body.seimbang, true);
  assert.deepEqual(pr.body.baris.map((x) => [x.akun.kode, x.debit, x.kredit]), [["1-1400", "715000.00", "0.00"], ["5-1100", "0.00", "715000.00"]]);
  assert.equal(pr.body.saldoSesudah, "715000.00");
  assert.equal(await jumlahJurnalPembuka(), 0, "pratinjau tidak menulis jurnal");
  // harga referensi master TIDAK dipakai sebagai harga snapshot
  assert.equal(b.harga, "30000.00"); assert.equal(b.hargaReferensi, 31_080);
});

// ── 2. validasi & penolakan ──────────────────────────────────────────────────────────────────────────────────────────

test("Kuantitas negatif, kode duplikat, dan kode tak dikenal ditolak saat isi — tidak ada baris yang tersimpan", async () => {
  const ctx = await siapkan();
  const d = await ctx.f.post("/api/finance/persediaan-awal", {});
  const r = await isi(ctx, d.body.id, [rowA({ qty: -3 }), rowB(), rowB(), { kode: "TIDAK-ADA", qty: 1, satuan: "PCS", harga: 1, sumber: "FAKTUR", referensi: "X" }]);
  assert.equal(r.status, 422); assert.equal(r.body.code, "BARIS_TIDAK_VALID");
  assert.deepEqual(r.body.detail.map((x) => x.kode).sort(), ["KODE_TIDAK_DIKENAL", "MATERIAL_DUPLIKAT", "QTY_NEGATIF"]);
  assert.equal(await testPrisma.finInventoryOpeningLine.count(), 0);
});

test("Harga nol, satuan beda, harga tidak wajar (termasuk kayu Rp386 jt), dan sumber harga kosong memblokir pemeriksaan", async () => {
  const ctx = await siapkan();
  const d = await ctx.f.post("/api/finance/persediaan-awal", {});
  const r = await isi(ctx, d.body.id, [
    rowA({ harga: 0 }),
    rowB({ satuan: "METER" }),
    { kode: "KAYU-C", qty: 240, satuan: "ROD", harga: 1_609_500, sumber: "LAINNYA" },
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const kode = r.body.validasi.blocker.map((x) => x.kode).sort();
  assert.deepEqual(kode, ["HARGA_NOL", "HARGA_TIDAK_WAJAR", "SATUAN_BEDA", "SUMBER_HARGA_KOSONG"]);
  const p = await ctx.f.post(`/api/finance/persediaan-awal/${d.body.id}/periksa`, { peran: "FINANCE" });
  assert.equal(p.status, 422); assert.equal(p.body.code, "SNAPSHOT_TIDAK_VALID");

  // harga 10× referensi juga tidak wajar; dengan penjelasan harga (≥10 karakter) menjadi peringatan saja
  const r2 = await isi(ctx, d.body.id, [rowA({ harga: 100_000 })]);
  assert.ok(r2.body.validasi.blocker.some((x) => x.kode === "HARGA_TIDAK_WAJAR"));
  const r3 = await isi(ctx, d.body.id, [rowA({ harga: 100_000, penjelasanHarga: "Harga faktur baru naik karena busa impor" })]);
  assert.equal(r3.body.validasi.blocker.length, 0);
  assert.ok(r3.body.validasi.peringatan.some((x) => x.kode === "HARGA_TIDAK_WAJAR"));
});

test("Belum diperiksa, pemeriksa sama, bukan Owner, tanpa PIN, tanpa alasan → posting ditolak dan tidak ada jurnal", async () => {
  const ctx = await siapkan();
  const d = await ctx.f.post("/api/finance/persediaan-awal", {});
  await isi(ctx, d.body.id, [rowA()]);
  const belum = await posting(ctx, d.body.id);
  assert.equal(belum.status, 409); assert.equal(belum.body.code, "BELUM_DIPERIKSA");
  // satu orang yang memegang hak Finance dan Gudang tidak boleh memeriksa dua-duanya
  assert.equal((await ctx.gd.post(`/api/finance/persediaan-awal/${d.body.id}/periksa`, { peran: "FINANCE" })).status, 200);
  const sama = await ctx.gd.post(`/api/finance/persediaan-awal/${d.body.id}/periksa`, { peran: "GUDANG" });
  assert.equal(sama.status, 409); assert.equal(sama.body.code, "PEMERIKSA_SAMA");
  // Gudang tidak boleh memeriksa sebagai Finance
  assert.equal((await ctx.g.post(`/api/finance/persediaan-awal/${d.body.id}/periksa`, { peran: "FINANCE" })).status, 403);
  assert.equal((await ctx.g.post(`/api/finance/persediaan-awal/${d.body.id}/periksa`, { peran: "GUDANG" })).status, 200);

  const bukanOwner = await ctx.ad.post(`/api/finance/persediaan-awal/${d.body.id}/posting`, { alasan: "x" });
  assert.equal(bukanOwner.status, 403); assert.equal(bukanOwner.body.code, "BUKAN_OWNER");
  const tanpaPin = await ctx.oTanpaPin.post(`/api/finance/persediaan-awal/${d.body.id}/posting`, { alasan: "x" });
  assert.equal(tanpaPin.status, 403); assert.match(tanpaPin.body.code, /^STEPUP_/);
  const tanpaAlasan = await ctx.o.post(`/api/finance/persediaan-awal/${d.body.id}/posting`, { alasan: " " });
  assert.equal(tanpaAlasan.status, 400); assert.equal(tanpaAlasan.body.code, "ALASAN_WAJIB");
  assert.equal(await jumlahJurnalPembuka(), 0);
});

// ── 3. sekali saja ───────────────────────────────────────────────────────────────────────────────────────────────────

test("Klik ganda & posting paralel: tepat satu jurnal pembuka; snapshot lain untuk cutover yang sama ditolak", async () => {
  const ctx = await siapkan();
  const id = await snapshotSiap(ctx);
  const idLain = await snapshotSiap(ctx, [rowA({ qty: 1 })]);
  const hasil = await Promise.all([...Array(5)].map(() => posting(ctx, id)).concat([posting(ctx, idLain)]));
  const utama = hasil.slice(0, 5);
  assert.ok(utama.every((r) => r.status === 200), JSON.stringify(utama.map((r) => [r.status, r.body?.code])));
  assert.equal(utama.filter((r) => r.body.dibuat).length, 1, "hanya satu permintaan yang benar-benar memposting");
  assert.equal(hasil[5].status, 409); assert.equal(hasil[5].body.code, "SUDAH_ADA_PEMBUKA");
  const ulang = await posting(ctx, id);
  assert.equal(ulang.status, 200); assert.equal(ulang.body.dibuat, false);
  assert.equal(await jumlahJurnalPembuka(), 1);
  assert.equal(await saldo("1-1400"), 715_000);
});

// ── 4. seimbang & tanpa persediaan ganda ──────────────────────────────────────────────────────────────────────────────

test("Jurnal pembuka seimbang dan menyetarakan saldo 1-1400 ke stok fisik walau sudah ada penerimaan Gudang sebelum cutover", async () => {
  const ctx = await siapkan();
  // penerimaan 20 Sep sebelum pembuka: Dr 1-1400 500.000 / Cr 2-1150
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-200926-01", sourceType: "MANUAL", supplier: "PT Uji Bahan", status: "COMPLETED", receivedDate: WIB("2026-09-20") } });
  await testPrisma.stockMovement.create({ data: { materialId: ctx.A.id, type: "RECEIPT", qty: 50, unitCost: 10_000, goodsReceiptId: gr.id, createdAt: WIB("2026-09-20") } });
  await testPrisma.$transaction((tx) => postGoodsReceiptValue(tx, { goodsReceiptId: gr.id, userId: ctx.owner.user.id }));
  assert.equal(await saldo("1-1400"), 500_000);

  const id = await snapshotSiap(ctx); // nilai fisik 715.000
  const pr = await ctx.f.get(`/api/finance/persediaan-awal/${id}/pratinjau`);
  assert.equal(pr.body.saldoBukuSebelum, "500000.00"); assert.equal(pr.body.penyesuaian, "215000.00");
  assert.equal((await posting(ctx, id)).status, 200);
  const e = await testPrisma.finJournalEntry.findFirst({ where: { source: "PERSEDIAAN_AWAL" }, include: { lines: { include: { account: true } } } });
  const d = e.lines.reduce((s, l) => s + Number(l.debit), 0), k = e.lines.reduce((s, l) => s + Number(l.credit), 0);
  assert.equal(d, k); assert.equal(d, 215_000);
  assert.equal(e.date.toISOString().slice(0, 10), "2026-09-30");
  assert.equal(await saldo("1-1400", "2026-09-30"), 715_000, "persediaan = stok fisik, tidak ganda");
  const snap = await testPrisma.finInventoryOpening.findUnique({ where: { id } });
  assert.equal(Number(snap.bookValueBefore), 500_000); assert.equal(Number(snap.adjustment), 215_000);

  // tagihan atas penerimaan itu tetap menutup GRNI sekali — tidak ada utang ganda
  const b = await ctx.o.post("/api/finance/bills", { supplierId: ctx.sup.id, billDate: "2026-09-25", amount: 500_000, description: "Busa A", billType: "BAHAN_BAKU", goodsReceiptId: gr.id });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal((await ctx.o.post(`/api/finance/bills/${b.body.id}/approve`, {})).status, 200);
  assert.equal(await saldo("2-1150"), 0); assert.equal(await saldo("2-1100"), -500_000);
  assert.equal(await saldo("1-1400"), 715_000);
});

// ── 5. reversal & kunci cutover ──────────────────────────────────────────────────────────────────────────────────────

test("Tanggal/metode cutover terkunci setelah posting; reversal resmi membalik jurnal dan membuka kunci", async () => {
  const ctx = await siapkan();
  const id = await snapshotSiap(ctx);
  assert.equal((await posting(ctx, id)).status, 200);
  const k1 = await ctx.o.patch("/api/finance/settings", { settings: { inventory_perpetual_cutover_date: "2026-11-01" } });
  assert.equal(k1.status, 409); assert.equal(k1.body.code, "CUTOVER_TERKUNCI");
  const k2 = await ctx.o.patch("/api/finance/settings", { settings: { inventory_method_before_cutover: "PERPETUAL" } });
  assert.equal(k2.status, 409);
  const buat = await ctx.f.post("/api/finance/persediaan-awal", {});
  assert.equal(buat.status, 409); assert.equal(buat.body.code, "SUDAH_ADA_PEMBUKA");

  // snapshot immutable di DB
  await assert.rejects(testPrisma.finInventoryOpening.update({ where: { id }, data: { totalValue: 1 } }), /immutable/);
  await assert.rejects(testPrisma.finInventoryOpeningLine.updateMany({ where: { openingId: id }, data: { qty: 99 } }), /immutable/);

  assert.equal((await ctx.o.post(`/api/finance/persediaan-awal/${id}/balik`, { alasan: " " })).status, 400);
  const b = await ctx.o.post(`/api/finance/persediaan-awal/${id}/balik`, { alasan: "Hitung ulang gudang" });
  assert.equal(b.status, 200, JSON.stringify(b.body)); assert.equal(b.body.snapshot.status, "DIBALIK");
  const asli = await testPrisma.finJournalEntry.findFirst({ where: { source: "PERSEDIAAN_AWAL" } });
  assert.equal(asli.status, "REVERSED");
  const pembalik = await testPrisma.finJournalEntry.findFirst({ where: { reversalOfId: asli.id } });
  assert.equal(pembalik.status, "POSTED");
  assert.equal(await saldo("1-1400"), 0); assert.equal(await saldo("5-1100"), 0);
  assert.equal((await ctx.o.post(`/api/finance/persediaan-awal/${id}/balik`, { alasan: "lagi" })).body.dibuat, false);
  assert.equal((await posting(ctx, id)).status, 409, "snapshot yang sudah dibalik tidak bisa diposting lagi");
  assert.equal((await ctx.o.patch("/api/finance/settings", { settings: { inventory_perpetual_cutover_date: "2026-10-01" } })).status, 200, "kunci terbuka setelah reversal");
});

test("Isi snapshot terkunci setelah diperiksa; buka kembali mengosongkan pemeriksaan", async () => {
  const ctx = await siapkan();
  const id = await snapshotSiap(ctx);
  const r = await isi(ctx, id, [rowA({ qty: 99 })]);
  assert.equal(r.status, 409); assert.equal(r.body.code, "SNAPSHOT_TERKUNCI");
  const b = await ctx.f.post(`/api/finance/persediaan-awal/${id}/buka-kembali`, { alasan: "koreksi qty" });
  assert.equal(b.status, 200); assert.equal(b.body.snapshot.status, "DRAFT"); assert.equal(b.body.snapshot.financeCheckedById, null);
  assert.equal((await isi(ctx, id, [rowA({ qty: 9 })])).status, 200);
});

// ── 6. pascacutover ──────────────────────────────────────────────────────────────────────────────────────────────────

test("Pascacutover: penerimaan Dr 1-1400/Cr 2-1150, tagihan Dr 2-1150/Cr 2-1100, pemakaian Dr 5-1100/Cr 1-1400 memakai harga stok opname", async () => {
  const ctx = await siapkan();
  // pemakaian 2 Okt SEBELUM pembuka diposting → ditahan (gap), tidak membuat 1-1400 negatif
  const dini = await testPrisma.stockMovement.create({ data: { materialId: ctx.A.id, type: "ISSUE", qty: -2, createdAt: WIB("2026-10-02") } });
  const r0 = await testPrisma.$transaction((tx) => postStockMovementCost(tx, { movementId: dini.id }));
  assert.equal(r0.posted, false); assert.equal(r0.reason, "tunggu_persediaan_awal");
  assert.equal(await testPrisma.finPostingGap.count({ where: { sourceId: dini.id, reason: "PERSEDIAAN_AWAL_BELUM_DIPOSTING" } }), 1);
  assert.equal(await saldo("1-1400"), 0);

  const id = await snapshotSiap(ctx); // A: 10 @ 10.000
  assert.equal((await posting(ctx, id)).status, 200);
  // gap tadi diposting ulang setelah pembuka ada: 2 × 10.000
  const r1 = await testPrisma.$transaction((tx) => postStockMovementCost(tx, { movementId: dini.id }));
  assert.equal(r1.posted, true);
  assert.equal(await saldo("1-1400"), 715_000 - 20_000);

  // penerimaan 3 Okt: 10 @ 12.000
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-031026-01", sourceType: "MANUAL", supplier: "PT Uji Bahan", status: "COMPLETED", receivedDate: WIB("2026-10-03") } });
  await testPrisma.stockMovement.create({ data: { materialId: ctx.A.id, type: "RECEIPT", qty: 10, unitCost: 12_000, goodsReceiptId: gr.id, createdAt: WIB("2026-10-03") } });
  await testPrisma.$transaction((tx) => postGoodsReceiptValue(tx, { goodsReceiptId: gr.id }));
  assert.equal(await saldo("2-1150"), -120_000);
  const bill = await ctx.o.post("/api/finance/bills", { supplierId: ctx.sup.id, billDate: "2026-10-04", amount: 120_000, description: "Busa A Okt", billType: "BAHAN_BAKU", goodsReceiptId: gr.id });
  assert.equal(bill.status, 201, JSON.stringify(bill.body));
  assert.equal((await ctx.o.post(`/api/finance/bills/${bill.body.id}/approve`, {})).status, 200);
  assert.equal(await saldo("2-1150"), 0); assert.equal(await saldo("2-1100"), -120_000, "utang tidak ganda");
  // tagihan bahan baku tanpa penerimaan setelah cutover ditolak (B3.5)
  assert.equal((await ctx.o.post("/api/finance/bills", { supplierId: ctx.sup.id, billDate: "2026-10-04", amount: 1, description: "x", billType: "BAHAN_BAKU" })).status, 422);

  // pemakaian 5 Okt: 5 unit; rata-rata = (8 sisa opname? tidak — basis: opname 10@10.000 + terima 10@12.000) = 11.000
  const pakai = await testPrisma.stockMovement.create({ data: { materialId: ctx.A.id, type: "ISSUE", qty: -5, createdAt: WIB("2026-10-05") } });
  await testPrisma.$transaction((tx) => postStockMovementCost(tx, { movementId: pakai.id }));
  const j = await testPrisma.finJournalEntry.findFirst({ where: { sourceId: pakai.id }, include: { lines: { include: { account: true } } } });
  assert.deepEqual(j.lines.map((l) => [l.account.code, Number(l.debit), Number(l.credit)]).sort(), [["1-1400", 0, 55_000], ["5-1100", 55_000, 0]]);
  assert.equal(await saldo("1-1400"), 715_000 - 20_000 + 120_000 - 55_000);
});

test("Setelah pembuka diposting, penerimaan & pemakaian bertanggal sebelum cutover tidak dijurnal lagi; tagihannya periodik (5-1100)", async () => {
  const ctx = await siapkan();
  const id = await snapshotSiap(ctx);
  assert.equal((await posting(ctx, id)).status, 200);
  const sebelum = await saldo("1-1400");

  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-290926-01", sourceType: "MANUAL", supplier: "PT Uji Bahan", status: "COMPLETED", receivedDate: WIB("2026-09-29") } });
  await testPrisma.stockMovement.create({ data: { materialId: ctx.A.id, type: "RECEIPT", qty: 5, unitCost: 10_000, goodsReceiptId: gr.id, createdAt: WIB("2026-09-29") } });
  const r = await testPrisma.$transaction((tx) => postGoodsReceiptValue(tx, { goodsReceiptId: gr.id }));
  assert.equal(r.posted, false); assert.equal(r.reason, "tertutup_stok_opname");
  const pakai = await testPrisma.stockMovement.create({ data: { materialId: ctx.A.id, type: "ISSUE", qty: -1, createdAt: WIB("2026-09-30", "20:00") } });
  assert.equal((await testPrisma.$transaction((tx) => postStockMovementCost(tx, { movementId: pakai.id }))).reason, "tertutup_stok_opname");
  assert.equal(await saldo("1-1400"), sebelum, "persediaan tidak berubah — sudah tercakup stok opname");

  const b = await ctx.o.post("/api/finance/bills", { supplierId: ctx.sup.id, billDate: "2026-09-29", amount: 50_000, description: "Busa A 29 Sep", billType: "BAHAN_BAKU", goodsReceiptId: gr.id });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal((await ctx.o.post(`/api/finance/bills/${b.body.id}/approve`, {})).status, 200);
  const jb = await testPrisma.finJournalEntry.findFirst({ where: { source: "TAGIHAN_SUPPLIER", sourceId: b.body.id }, include: { lines: { include: { account: true } } } });
  assert.deepEqual(jb.lines.map((l) => l.account.code).sort(), ["2-1100", "5-1100"]);
  assert.equal(await saldo("2-1150"), 0);
});

// ── 7. laporan pengecualian & nama akun ──────────────────────────────────────────────────────────────────────────────

test("Laporan pengecualian: stok negatif, harga referensi kayu, tanpa harga valid, dan pemakaian belum lengkap 8–30 Sep", async () => {
  const ctx = await siapkan();
  await testPrisma.stockMovement.create({ data: { materialId: ctx.B.id, type: "ISSUE", qty: -57.1, createdAt: WIB("2026-09-07", "17:00") } });
  await testPrisma.stockMovement.create({ data: { materialId: ctx.KAYU.id, type: "ADJUSTMENT", qty: 240, createdAt: WIB("2026-08-31") } });
  await testPrisma.stockMovement.create({ data: { materialId: ctx.A.id, type: "ADJUSTMENT", qty: 3, createdAt: WIB("2026-08-31") } });
  const l = await ctx.f.get("/api/finance/persediaan-awal/pengecualian");
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.equal(l.body.stokNegatif.jumlah, 1); assert.equal(l.body.stokNegatif.daftar[0].kode, "PLASTIK-B");
  assert.ok(l.body.hargaReferensiAnomali.daftar.some((x) => x.kode === "KAYU-C" && x.nilaiReferensi === "386280000"));
  assert.deepEqual(l.body.tanpaHargaValid.daftar.map((x) => x.kode).sort(), ["BUSA-A", "KAYU-C"]);
  assert.equal(l.body.pemakaianBelumLengkap.terakhirTercatat, "2026-09-07");
  assert.equal(l.body.pemakaianBelumLengkap.belumTercatatDari, "2026-09-08");
  assert.equal(l.body.pemakaianBelumLengkap.jumlahHari, 23);
  // Gudang boleh membaca laporan & snapshot
  assert.equal((await ctx.g.get("/api/finance/persediaan-awal/pengecualian")).status, 200);
});

test("Akun 5-1100 bernama jelas tanpa mengubah kode/tipe", async () => {
  const ctx = await siapkan();
  const a = await testPrisma.finAccount.findUnique({ where: { code: "5-1100" } });
  assert.equal(a.name, "Beban Bahan Baku / Pemakaian Bahan");
  assert.equal(a.type, "BEBAN_POKOK"); assert.equal(a.systemKey, SYSTEM_KEYS.BEBAN_POKOK_BAHAN);
  const k = await ctx.f.get("/api/finance/persediaan-awal");
  assert.equal(k.body.kebijakan.cutover, "2026-10-01"); assert.equal(k.body.kebijakan.tanggalHitung, "2026-09-30"); assert.equal(k.body.kebijakan.terkunci, false);
});
