// C1 — Pengajuan Biaya Produksi & Gudang: alur, permission per workspace, sumber dana, duplikat (peringatan), dan
// anti double-counting terhadap Inventory / Pembelian / Tagihan Supplier / Pengeluaran.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const PB = "/api/finance/expense-submissions";
let seq = 0;

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const u = {};
  for (const [k, roles] of Object.entries({ pl: ["PRODUCTION_LEAD"], pl2: ["PRODUCTION_LEAD"], wh: ["WAREHOUSE"], fin: ["FINANCE"], adm: ["ADMIN"], disp: ["DISPATCHER"], sales: ["SALES"] })) u[k] = await createTestUser({ roles });
  const c = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, makeClient(server.baseUrl, v.token)]));
  const mesin = await testPrisma.workCenter.create({ data: { code: `WC-${++seq}`, name: "Mesin Quilting 1" } });
  const gudang = await testPrisma.warehouse.create({ data: { code: `WH-${++seq}`, name: "Gudang Jakarta" } });
  const material = await createTestMaterial({ code: `MAT-${++seq}`, name: "Busa Uji" });
  const { order, unit } = await createTestUnit();
  return { u, c, bank, mesin, gudang, material, order, unit };
}

const bodyProduksi = (ctx, extra = {}) => ({
  workspace: "PRODUKSI", expenseType: "SERVIS_MESIN", date: "2026-09-24", amount: 450_000, workCenterId: ctx.mesin.id,
  vendorName: "Bengkel Uji", metadata: { pekerjaan: "Ganti jarum & setel" }, sumberDana: "BELUM_DIBAYAR", ...extra,
});
const bodyGudang = (ctx, extra = {}) => ({
  workspace: "WAREHOUSE", expenseType: "KURIR_LOGISTIK", date: "2026-09-24", amount: 120_000, warehouseId: ctx.gudang.id,
  vendorName: "Kurir Uji", metadata: { tujuan: "Bandung" }, sumberDana: "BELUM_DIBAYAR", ...extra,
});
const buat = (client, body) => client.post(PB, body);
const ajukan = (client, id, kunci = `k-${id}`) => client.post(`${PB}/${id}/ajukan`, {}, { "Idempotency-Key": kunci });
async function tambahBukti(id, userId) {
  await testPrisma.expenseSubmissionProof.create({ data: { submissionId: id, url: "https://example.test/nota-uji.jpg", version: 1, uploadedById: userId } });
}
async function feDari(id) {
  return testPrisma.finExpense.findUnique({ where: { id }, include: { category: { include: { account: true } } } });
}

// ── alur Produksi ────────────────────────────────────────────────────────────────────────────────────────────────

test("Produksi: servis mesin → draf, wajib mesin, diajukan jadi SATU FinExpense (5/6-…, divisi PRODUKSI), disetujui Finance lalu dibayar", async () => {
  const ctx = await siapkan();
  const tanpaMesin = await buat(ctx.c.pl, bodyProduksi(ctx, { workCenterId: undefined }));
  assert.equal(tanpaMesin.status, 201, "draf boleh belum lengkap");
  const gagal = await ajukan(ctx.c.pl, tanpaMesin.body.id);
  assert.equal(gagal.status, 422); assert.match(gagal.body.error, /wajib memilih mesin/);
  assert.equal(await testPrisma.finExpense.count(), 0);

  const d = await buat(ctx.c.pl, bodyProduksi(ctx, { unitId: ctx.unit.id, picUserId: ctx.u.pl.user.id }));
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.equal(d.body.division, "PRODUKSI"); assert.equal(d.body.orderId, ctx.order.id, "unit selalu ikut order-nya");
  assert.equal(d.body.workCenter.name, "Mesin Quilting 1");
  await tambahBukti(d.body.id, ctx.u.pl.user.id);
  const aj = await ajukan(ctx.c.pl, d.body.id);
  assert.equal(aj.status, 200, JSON.stringify(aj.body));
  assert.equal(aj.body.status, "MENUNGGU_PERSETUJUAN");
  const fe = await feDari(aj.body.finExpenseId);
  assert.equal(fe.division, "PRODUKSI"); assert.equal(fe.category.code, "MAINT_MESIN"); assert.equal(fe.category.account.code, "6-1150");
  assert.equal(fe.mode, "UTANG", "sumber dana 'belum dibayar' dihormati untuk pengaju non-Finance");
  assert.equal(fe.unitId, ctx.unit.id); assert.equal(fe.orderId, ctx.order.id);

  const ap = await ctx.c.fin.post(`/api/finance/expenses/${fe.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal((await ctx.c.pl.get(`${PB}/${d.body.id}`)).body.status, "DISETUJUI");
  const pay = await ctx.c.fin.post(`/api/finance/expenses/${fe.id}/pay`, { cashAccountId: ctx.bank.id });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal((await ctx.c.pl.get(`${PB}/${d.body.id}`)).body.status, "DIBAYAR");
  assert.equal(await testPrisma.finExpense.count(), 1);
});

test("Produksi: lembur & kebutuhan mendesak wajib alasan; jenis biaya dipetakan ke akun resmi (5-1200 / 5-1300)", async () => {
  const ctx = await siapkan();
  const lembur = await buat(ctx.c.pl, bodyProduksi(ctx, { expenseType: "LEMBUR", workCenterId: undefined, metadata: { jumlahJam: 3, jumlahOrang: 4 } }));
  await tambahBukti(lembur.body.id, ctx.u.pl.user.id);
  const tanpaAlasan = await ajukan(ctx.c.pl, lembur.body.id);
  assert.equal(tanpaAlasan.status, 422); assert.match(tanpaAlasan.body.error, /Alasan mendesak/);
  assert.equal((await ctx.c.pl.patch(`${PB}/${lembur.body.id}`, { urgentReason: "Order kilat pelanggan besok pagi" })).status, 200);
  const ok = await ajukan(ctx.c.pl, lembur.body.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await feDari(ok.body.finExpenseId)).category.account.code, "5-1200");
  const ops = await buat(ctx.c.pl, bodyProduksi(ctx, { expenseType: "BIAYA_OPERASIONAL", workCenterId: undefined, metadata: { keperluan: "Kabel & selotip" } }));
  await tambahBukti(ops.body.id, ctx.u.pl.user.id);
  const okOps = await ajukan(ctx.c.pl, ops.body.id);
  assert.equal((await feDari(okOps.body.finExpenseId)).category.account.code, "5-1300");
});

// ── alur Gudang ──────────────────────────────────────────────────────────────────────────────────────────────────

test("Gudang: kurir & bongkar muat (kategori resmi baru) menghasilkan FinExpense divisi GUDANG; jenis tanpa metadata wajib ditolak", async () => {
  const ctx = await siapkan();
  const k = await buat(ctx.c.wh, bodyGudang(ctx, { materialId: ctx.material.id }));
  assert.equal(k.status, 201, JSON.stringify(k.body));
  assert.equal(k.body.material.code, ctx.material.code); assert.equal(k.body.warehouse.name, "Gudang Jakarta");
  await tambahBukti(k.body.id, ctx.u.wh.user.id);
  const aj = await ajukan(ctx.c.wh, k.body.id);
  assert.equal(aj.status, 200, JSON.stringify(aj.body));
  const fe = await feDari(aj.body.finExpenseId);
  assert.equal(fe.division, "GUDANG"); assert.equal(fe.category.code, "KURIR_EKSTERNAL");

  const bm = await buat(ctx.c.wh, bodyGudang(ctx, { expenseType: "BONGKAR_MUAT", metadata: { keperluan: "Bongkar kontainer busa" }, amount: 300_000 }));
  await tambahBukti(bm.body.id, ctx.u.wh.user.id);
  const ajBm = await ajukan(ctx.c.wh, bm.body.id);
  assert.equal(ajBm.status, 200, JSON.stringify(ajBm.body));
  const feBm = await feDari(ajBm.body.finExpenseId);
  assert.equal(feBm.category.code, "BONGKAR_MUAT_GUDANG"); assert.equal(feBm.category.account.code, "6-1900");

  const tanpaMeta = await buat(ctx.c.wh, bodyGudang(ctx, { expenseType: "PERAWATAN_FASILITAS", metadata: {} }));
  const gagal = await ajukan(ctx.c.wh, tanpaMeta.body.id);
  assert.equal(gagal.status, 422); assert.match(gagal.body.error, /Keperluan wajib diisi/);
  // pilihan tautan hanya yang berlaku untuk workspace
  const salah = await buat(ctx.c.wh, bodyGudang(ctx, { workCenterId: ctx.mesin.id }));
  assert.equal(salah.status, 422); assert.match(salah.body.error, /mesin tidak berlaku/);
  const kendaraan = await buat(ctx.c.wh, bodyGudang(ctx, { vehicleId: "00000000-0000-0000-0000-000000000000" }));
  assert.equal(kendaraan.status, 422);
});

// ── catat atas nama, revisi ─────────────────────────────────────────────────────────────────────────────────────

test("Catat atas nama: Finance boleh untuk pengaju Produksi/Gudang; pengaju sendiri & Dispatcher tidak; requestedBy ≠ actor ≠ PIC tercatat terpisah", async () => {
  const ctx = await siapkan();
  const f = await buat(ctx.c.fin, bodyProduksi(ctx, { requestedById: ctx.u.pl.user.id, picUserId: ctx.u.pl2.user.id, requestedAt: "2026-09-24T03:00:00Z", sourceNote: "Diminta lewat WhatsApp grup produksi", urgentReason: "Mesin macet" }));
  assert.equal(f.status, 201, JSON.stringify(f.body));
  assert.equal(f.body.requestedById, ctx.u.pl.user.id, "pemohon = Produksi");
  assert.equal(f.body.createdById, ctx.u.fin.user.id, "pencatat = Finance");
  assert.equal(f.body.picUserId, ctx.u.pl2.user.id, "PIC berbeda dari pemohon");
  assert.equal(f.body.sourceNote, "Diminta lewat WhatsApp grup produksi"); assert.equal(f.body.urgentReason, "Mesin macet");
  const w = await buat(ctx.c.fin, bodyGudang(ctx, { requestedById: ctx.u.wh.user.id }));
  assert.equal(w.status, 201);

  const sendiri = await buat(ctx.c.pl, bodyProduksi(ctx, { requestedById: ctx.u.pl2.user.id }));
  assert.equal(sendiri.status, 403); assert.match(sendiri.body.error, /Hanya Finance/);
  const disp = await buat(ctx.c.disp, bodyProduksi(ctx, { requestedById: ctx.u.pl.user.id }));
  assert.equal(disp.status, 403, "Dispatcher tidak punya akses workspace Produksi (dan tidak boleh catat atas nama di sini)");
});

test("Revisi: Finance minta revisi (alasan wajib) → PERLU_REVISI; pemilik memperbaiki & mengajukan ulang → FinExpense baru, tanpa jurnal dari yang lama", async () => {
  const ctx = await siapkan();
  const d = await buat(ctx.c.pl, bodyProduksi(ctx));
  await tambahBukti(d.body.id, ctx.u.pl.user.id);
  const aj = await ajukan(ctx.c.pl, d.body.id);
  const feLama = aj.body.finExpenseId;
  assert.equal((await ctx.c.fin.post(`${PB}/${d.body.id}/minta-revisi`, { reason: " " }, { "Idempotency-Key": "revisi-kunci-0" })).status, 400);
  const rv = await ctx.c.fin.post(`${PB}/${d.body.id}/minta-revisi`, { reason: "Nominal tidak cocok dengan nota" }, { "Idempotency-Key": "revisi-kunci-1" });
  assert.equal(rv.status, 200, JSON.stringify(rv.body));
  assert.equal(rv.body.status, "PERLU_REVISI");
  assert.equal(await testPrisma.finJournalEntry.count(), 0, "revisi tidak menyentuh buku besar");
  assert.equal((await ctx.c.pl2.patch(`${PB}/${d.body.id}`, { amount: 400_000 })).status, 403, "orang lain tidak boleh memperbaiki");
  assert.equal((await ctx.c.pl.patch(`${PB}/${d.body.id}`, { amount: 400_000 })).status, 200);
  const ulang = await ajukan(ctx.c.pl, d.body.id, "ajukan-ulang-1");
  assert.equal(ulang.status, 200, JSON.stringify(ulang.body));
  assert.notEqual(ulang.body.finExpenseId, feLama);
  assert.equal(Number((await feDari(ulang.body.finExpenseId)).amount), 400_000);
});

// ── sumber dana ──────────────────────────────────────────────────────────────────────────────────────────────────

test("Sumber dana: uang muka aktif (wajib dipilih), talangan pribadi → reimbursement ke pemohon, rekening/belum dibayar → utang", async () => {
  const ctx = await siapkan();
  // uang muka milik pemohon Produksi
  const um = await ctx.c.adm.post("/api/finance/uang-muka", {
    holderId: ctx.u.pl.user.id, division: "PRODUKSI", purpose: "Uang belanja perbaikan mendesak", date: "2026-09-20", dueDate: "2026-09-30", amount: 1_000_000, cashAccountId: ctx.bank.id,
  });
  assert.equal(um.status, 201, JSON.stringify(um.body));
  const aktif = await ctx.c.pl.get(`${PB}/uang-muka-aktif`);
  assert.equal(aktif.status, 200); assert.equal(aktif.body.items.length, 1);

  const tanpaPilih = await buat(ctx.c.pl, bodyProduksi(ctx, { sumberDana: "UANG_MUKA_OPERASIONAL" }));
  await tambahBukti(tanpaPilih.body.id, ctx.u.pl.user.id);
  const gagal = await ajukan(ctx.c.pl, tanpaPilih.body.id);
  assert.equal(gagal.status, 422); assert.match(gagal.body.error, /uang muka aktif/);
  assert.equal((await ctx.c.pl.patch(`${PB}/${tanpaPilih.body.id}`, { advanceId: um.body.id })).status, 200);
  const ok = await ajukan(ctx.c.pl, tanpaPilih.body.id, "uang-muka-kunci-1");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await feDari(ok.body.finExpenseId)).mode, "UANG_MUKA");
  // uang muka milik orang lain tidak boleh dipakai
  const orangLain = await buat(ctx.c.pl2, bodyProduksi(ctx, { sumberDana: "UANG_MUKA_OPERASIONAL", advanceId: um.body.id }));
  assert.equal(orangLain.status, 403, JSON.stringify(orangLain.body));

  const talangan = await buat(ctx.c.pl, bodyProduksi(ctx, { sumberDana: "TALANGAN_PRIBADI", amount: 100_000 }));
  await tambahBukti(talangan.body.id, ctx.u.pl.user.id);
  const feT = await feDari((await ajukan(ctx.c.pl, talangan.body.id)).body.finExpenseId);
  assert.equal(feT.mode, "REIMBURSEMENT"); assert.equal(feT.reimburseToId, ctx.u.pl.user.id);
  const rek = await buat(ctx.c.pl, bodyProduksi(ctx, { sumberDana: "REKENING_PERUSAHAAN", amount: 110_000 }));
  await tambahBukti(rek.body.id, ctx.u.pl.user.id);
  assert.equal((await feDari((await ajukan(ctx.c.pl, rek.body.id)).body.finExpenseId)).mode, "UTANG");
});

// ── duplikat & klik ganda ────────────────────────────────────────────────────────────────────────────────────────

test("Duplikat hanya PERINGATAN: menampilkan tanggal, nominal, PIC, konteks, dan bukti; tidak memblokir", async () => {
  const ctx = await siapkan();
  const a = await buat(ctx.c.pl, bodyProduksi(ctx, { picUserId: ctx.u.pl.user.id }));
  await tambahBukti(a.body.id, ctx.u.pl.user.id);
  const q = `division=PRODUKSI&expenseType=SERVIS_MESIN&date=2026-09-25&amount=450000&workCenterId=${ctx.mesin.id}`;
  const cek = await ctx.c.pl.get(`${PB}/duplicate-check?${q}`);
  assert.equal(cek.status, 200);
  assert.equal(cek.body.kandidat.length, 1);
  const k = cek.body.kandidat[0];
  assert.equal(k.amount, 450_000); assert.equal(k.adaBukti, true); assert.equal(k.picNameSnapshot !== undefined, true);
  assert.match(k.konteks, /mesin Mesin Quilting 1/); assert.ok(k.date && k.pemohon);
  const kembar = await buat(ctx.c.pl, bodyProduksi(ctx, { date: "2026-09-25" }));
  assert.equal(kembar.status, 201, "duplikat tidak diblokir");
  assert.equal((await ctx.c.pl.get(`${PB}/duplicate-check?${q.replace("450000", "999999")}`)).body.kandidat.length, 0, "nominal beda bukan kandidat");
  // pemegang workspace lain tidak bisa mengintip divisi Produksi lewat duplicate-check
  assert.equal((await ctx.c.wh.get(`${PB}/duplicate-check?${q}`)).status, 403);
});

test("Klik ganda / permintaan paralel: tepat satu FinExpense per pengajuan", async () => {
  const ctx = await siapkan();
  const d = await buat(ctx.c.pl, bodyProduksi(ctx));
  await tambahBukti(d.body.id, ctx.u.pl.user.id);
  // Klik ganda dengan kunci SAMA: lapisan idempotensi HTTP boleh menjawab 409 "sedang diproses" — yang wajib: satu sukses, satu FinExpense.
  const sama = await Promise.all([...Array(6)].map(() => ajukan(ctx.c.pl, d.body.id, "kunci-sama-paralel")));
  assert.ok(sama.every((r) => [200, 409].includes(r.status)) && sama.some((r) => r.status === 200), JSON.stringify(sama.map((r) => [r.status, r.body?.error])));
  assert.equal(await testPrisma.finExpense.count(), 1);
  // Permintaan paralel dengan kunci BERBEDA (klik dari dua tab): kunci baris membuat semuanya menerima pengajuan yang sama.
  const beda = await Promise.all([...Array(5)].map((_, i) => ajukan(ctx.c.pl, d.body.id, `kunci-beda-paralel-${i}`)));
  assert.ok(beda.every((r) => [200, 409].includes(r.status)), JSON.stringify(beda.map((r) => [r.status, r.body?.error])));
  const idFe = new Set([...sama, ...beda].filter((r) => r.status === 200).map((r) => r.body.finExpenseId));
  assert.equal(idFe.size, 1, "semua jawaban sukses menunjuk FinExpense yang sama");
  assert.equal(await testPrisma.finExpense.count(), 1);
  const s = await testPrisma.expenseSubmission.findUnique({ where: { id: d.body.id } });
  assert.ok(s.finExpenseId);
});

// ── permission per workspace ─────────────────────────────────────────────────────────────────────────────────────

test("Permission server-side: PRODUCTION_LEAD hanya Produksi, WAREHOUSE hanya Gudang, peran lain (mis. Sales/Dispatcher) tidak; hanya milik sendiri", async () => {
  const ctx = await siapkan();
  assert.equal((await ctx.c.wh.get(`${PB}/config?workspace=PRODUKSI`)).status, 403);
  assert.equal((await ctx.c.pl.get(`${PB}/config?workspace=WAREHOUSE`)).status, 403);
  assert.equal((await ctx.c.sales.get(`${PB}/config?workspace=PRODUKSI`)).status, 403);
  const cfgPl = await ctx.c.pl.get(`${PB}/config?workspace=PRODUKSI`);
  assert.equal(cfgPl.status, 200); assert.equal(cfgPl.body.bolehCatatAtasNama, false);
  assert.ok(!cfgPl.body.expenseTypes.some((t) => /BAHAN|MATERIAL/.test(t.code)), "tidak ada jenis biaya untuk bahan/stok");
  assert.equal((await ctx.c.fin.get(`${PB}/config?workspace=WAREHOUSE`)).body.bolehCatatAtasNama, true);

  assert.equal((await buat(ctx.c.wh, bodyProduksi(ctx))).status, 403);
  assert.equal((await buat(ctx.c.pl, bodyGudang(ctx))).status, 403);
  assert.equal((await buat(ctx.c.sales, bodyGudang(ctx))).status, 403);

  const milikPl = await buat(ctx.c.pl, bodyProduksi(ctx));
  const milikWh = await buat(ctx.c.wh, bodyGudang(ctx));
  assert.equal((await ctx.c.wh.get(`${PB}/${milikPl.body.id}`)).status, 404, "Gudang tidak melihat pengajuan Produksi");
  assert.equal((await ctx.c.pl.get(`${PB}/${milikWh.body.id}`)).status, 404);
  assert.equal((await ctx.c.pl2.get(`${PB}/${milikPl.body.id}`)).status, 403, "sesama Produksi hanya melihat miliknya");
  assert.equal((await ctx.c.pl2.patch(`${PB}/${milikPl.body.id}`, { amount: 1 })).status, 403);
  assert.equal((await ctx.c.wh.post(`${PB}/${milikPl.body.id}/ajukan`, {}, { "Idempotency-Key": "kunci-orang-lain-1" })).status, 404);
  const daftarPl = await ctx.c.pl.get(PB);
  assert.deepEqual(daftarPl.body.submissions.map((s) => s.id), [milikPl.body.id]);
  const daftarFin = await ctx.c.fin.get(PB);
  assert.equal(daftarFin.body.submissions.length, 2, "Finance melihat semua");
  assert.equal((await ctx.c.wh.get(`${PB}?division=PRODUKSI`)).status, 403);
  // pilihan tautan
  assert.equal((await ctx.c.wh.get(`${PB}/opsi?workspace=PRODUKSI`)).status, 403);
  const opsi = await ctx.c.pl.get(`${PB}/opsi?workspace=PRODUKSI&q=${ctx.unit.unitCode.slice(0, 4)}`);
  assert.equal(opsi.status, 200); assert.equal(opsi.body.mesin[0].name, "Mesin Quilting 1");
});

// ── anti double-counting ─────────────────────────────────────────────────────────────────────────────────────────

test("Anti double-counting: jenis biaya untuk bahan/stok ditolak dengan arahan modul yang benar; tidak ada FinExpense/jurnal", async () => {
  const ctx = await siapkan();
  for (const [client, ws, tipe] of [[ctx.c.pl, "PRODUKSI", "BAHAN_TAMBAHAN"], [ctx.c.wh, "WAREHOUSE", "MATERIAL"], [ctx.c.wh, "WAREHOUSE", "BAHAN_BAKU"], [ctx.c.wh, "WAREHOUSE", "TRANSFER_STOK"]]) {
    const r = await buat(client, { workspace: ws, expenseType: tipe, date: "2026-09-24", amount: 1_000_000 });
    assert.equal(r.status, 422, `${ws}/${tipe}`);
    assert.match(r.body.error, /urusan stok\/pembelian/); assert.match(r.body.error, /Penerimaan Barang/);
  }
  assert.equal(await testPrisma.expenseSubmission.count(), 0);
  assert.equal(await testPrisma.finExpense.count(), 0); assert.equal(await testPrisma.finJournalEntry.count(), 0);
});

test("Anti double-counting: dokumen Inventory/Pembelian/Tagihan/Pengeluaran yang sudah ada ditolak; satu dokumen tidak boleh dicatat dua kali", async () => {
  const ctx = await siapkan();
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-240926-01", sourceType: "MANUAL", supplier: "PT Uji", status: "COMPLETED" } });
  const mi = await testPrisma.materialIssue.create({ data: { issueNumber: "MI-240926-01", sourceType: "MANUAL", status: "ISSUED" } });
  const sup = await testPrisma.finSupplier.create({ data: { code: "SUP-X", name: "PT X" } });
  const bill = await testPrisma.finSupplierBill.create({ data: { billNumber: "BILL-240926-001", supplierId: sup.id, billDate: new Date("2026-09-24"), amount: 1_000_000, description: "Busa", status: "MENUNGGU_APPROVAL" } });
  const cat = await testPrisma.finPurchaseCategory.findFirst();
  const pur = await testPrisma.finPurchase.create({ data: { purchaseNumber: "PUR-240926-001", date: new Date("2026-09-24"), amount: 500_000, description: "Kain", categoryId: cat.id, status: "MENUNGGU_APPROVAL" } });

  // dokumen stok sebagai tautan pada jenis biaya yang BUKAN biaya pendamping → ditolak
  for (const [no, label] of [["GR-240926-01", "Penerimaan Barang"], ["MI-240926-01", "Pengeluaran Material"], ["BILL-240926-001", "Tagihan Supplier"], ["PUR-240926-001", "Pembelian"]]) {
    const r = await buat(ctx.c.wh, bodyGudang(ctx, { expenseType: "BONGKAR_MUAT", metadata: { keperluan: "x" }, documentRef: no }));
    assert.equal(r.status, 409, no); assert.match(r.body.error, new RegExp(label)); assert.match(r.body.error, /terhitung dua kali/);
  }
  // Pembelian/Tagihan ditolak walau untuk kurir (biaya pendamping hanya boleh merujuk GR/TRF)
  assert.equal((await buat(ctx.c.wh, bodyGudang(ctx, { documentRef: "BILL-240926-001" }))).status, 409);
  assert.equal((await buat(ctx.c.wh, bodyGudang(ctx, { documentRef: "PUR-240926-001" }))).status, 409);
  // teks bebas yang menyebut dokumen yang sudah ada ditolak
  const teks = await buat(ctx.c.wh, bodyGudang(ctx, { description: "Ongkos kirim untuk tagihan BILL-240926-001" }));
  assert.equal(teks.status, 409);
  // pengeluaran yang sudah ada
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const exp = await testPrisma.finExpense.create({ data: { expenseNumber: "EXP-240926-001", date: new Date("2026-09-24"), amount: 50_000, description: "x", categoryId: kat.id, division: "GUDANG", mode: "UTANG", status: "MENUNGGU_APPROVAL" } });
  assert.equal((await buat(ctx.c.wh, bodyGudang(ctx, { documentRef: exp.expenseNumber }))).status, 409);

  // kurir untuk GR = konteks yang sah, tetapi HANYA satu pengajuan per dokumen
  const ok = await buat(ctx.c.wh, bodyGudang(ctx, { documentRef: "GR-240926-01" }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const dobel = await buat(ctx.c.wh, bodyGudang(ctx, { documentRef: "GR-240926-01", amount: 130_000 }));
  assert.equal(dobel.status, 409); assert.match(dobel.body.error, /sudah dipakai pada pengajuan/);
  // draf tidak bisa menyelundupkan dokumen belakangan: ubah draf & ajukan tetap dijaga
  const d2 = await buat(ctx.c.wh, bodyGudang(ctx, { amount: 90_000 }));
  assert.equal((await ctx.c.wh.patch(`${PB}/${d2.body.id}`, { documentRef: "MI-240926-01" })).status, 409);
  await testPrisma.expenseSubmission.update({ where: { id: d2.body.id }, data: { description: "Kurir untuk PUR-240926-001" } });
  await tambahBukti(d2.body.id, ctx.u.wh.user.id);
  assert.equal((await ajukan(ctx.c.wh, d2.body.id)).status, 409, "guard berjalan lagi saat diajukan");

  // tidak ada efek ke Inventory / Pembelian / Tagihan / jurnal
  assert.equal(await testPrisma.stockMovement.count(), 0); assert.equal(await testPrisma.finJournalEntry.count(), 0);
  assert.equal(await testPrisma.finSupplierBill.count(), 1); assert.equal(await testPrisma.finPurchase.count(), 1);
  assert.equal(await testPrisma.finExpense.count(), 1, "hanya EXP yang sengaja dibuat di fixture");
});

test("Konteks Produksi: unit harus milik order yang dipilih; kendaraan/rute/job ditolak; pengajuan lama tidak berubah bentuknya", async () => {
  const ctx = await siapkan();
  const lain = await createTestUnit();
  const salah = await buat(ctx.c.pl, bodyProduksi(ctx, { unitId: ctx.unit.id, orderId: lain.order.id }));
  assert.equal(salah.status, 422); assert.match(salah.body.error, /unit selalu ikut order/i);
  assert.equal((await buat(ctx.c.pl, bodyProduksi(ctx, { vehicleId: "00000000-0000-0000-0000-000000000000" }))).status, 422);
  assert.equal((await buat(ctx.c.pl, bodyProduksi(ctx, { workCenterId: "00000000-0000-0000-0000-000000000000" }))).status, 404);
  await testPrisma.workCenter.update({ where: { id: ctx.mesin.id }, data: { active: false } });
  assert.equal((await buat(ctx.c.pl, bodyProduksi(ctx))).status, 404, "mesin nonaktif ditolak");
  // metadata non-finansial tidak bisa mengubah nominal
  const d = await buat(ctx.c.fin, bodyGudang(ctx));
  const m = await ctx.c.fin.post(`${PB}/${d.body.id}/metadata`, { reason: "koreksi", changes: { amount: 1 } });
  assert.equal(m.status, 400);
});

test("Pilihan terakhir untuk input cepat: mesin, gudang, material, PIC, sumber dana, jenis biaya milik pengguna", async () => {
  const ctx = await siapkan();
  await buat(ctx.c.pl, bodyProduksi(ctx, { picUserId: ctx.u.pl2.user.id }));
  const r = await ctx.c.pl.get(`${PB}/recent?division=PRODUKSI`);
  assert.equal(r.status, 200);
  assert.equal(r.body.mesin[0].label, "Mesin Quilting 1"); assert.equal(r.body.pilihanPic[0].id, ctx.u.pl2.user.id);
  assert.deepEqual(r.body.sumberDana, ["BELUM_DIBAYAR"]); assert.deepEqual(r.body.jenisBiaya, ["SERVIS_MESIN"]);
  const tpl = await ctx.c.pl.post(`${PB}/templates`, { label: "Servis quilting rutin", division: "PRODUKSI", payload: { expenseType: "SERVIS_MESIN", workCenterId: ctx.mesin.id, amount: 450000 } });
  assert.equal(tpl.status, 201);
  assert.equal((await ctx.c.pl.get(`${PB}/templates`)).body.templates.length, 1);
  assert.equal((await ctx.c.pl2.get(`${PB}/templates`)).body.templates.length, 0, "template milik pembuatnya");
});
