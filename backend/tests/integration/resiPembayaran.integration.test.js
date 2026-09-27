// RESI GABUNGAN FASE 3A — pembayaran/DP Resi: SATU Payment anchor + FinPaymentAllocation ke child, jurnal per child, klaim Lunas level Resi,
// antrean Finance satu Resi, dan jaminan invarian (tanpa uang/pendapatan ganda; order tunggal & groupId NULL identik; BACKFILL_BUNDLE tidak ikut).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { createOrderForCustomer } from "../../src/services/orderCreation.js";
import { paidForOrder } from "../../src/services/finance/allocation.js";
import { bagiProporsional } from "../../src/services/resi.js";
import { hitungAlokasiResi, validasiAlokasiResi, ResiBayarError } from "../../src/services/resiPembayaran.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const kunci = () => ({ "Idempotency-Key": `resi-uji-${randomUUID()}` });
const HARGA = [1_000_000, 500_000, 250_001];
const ONGKIR = 50_000;
const TAGIHAN = [1_050_000, 500_000, 250_001]; // ongkir tambahan menempel di anchor
const TOTAL = 1_800_001;
const DP = 540_000; // 30% × Total Resi

async function dunia({ pembayaran = true, resiInput = true } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const bankAkun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "SANOBANK Uji", kind: "BANK", accountId: bankAkun.id } });
  const sales = await createTestUser({ roles: ["SALES"] });
  const admin = await createTestUser({ roles: ["FINANCE"] }); // FINANCE memegang payment:read/write
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Resi", assignedSalesId: sales.user.id } });
  if (resiInput) await setSetting(testPrisma, SETTING_KEYS.RESI_INPUT_AKTIF, "true");
  if (pembayaran) await setSetting(testPrisma, SETTING_KEYS.RESI_PEMBAYARAN_AKTIF, "true");
  const s = makeClient(server.baseUrl, sales.token);
  const a = makeClient(server.baseUrl, admin.token);
  const r = await s.post("/api/resi", {
    customerId: customer.id, alamat: "Jl. Kemang 1", kota: "Jakarta Selatan", ongkirTambahan: ONGKIR,
    items: HARGA.map((nominal) => ({ merk: "Sano", ukuran: "160x200 cm (Queen)", keluhan: "Pegal", nominal, unitCount: 1 })),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { s, a, sales, admin, customer, bank, groupId: r.body.groupId, anak: r.body.orders.map((o) => o.id), anchorId: r.body.anchorOrderId };
}

const ambilAnak = (groupId) => testPrisma.order.findMany({ where: { groupId }, orderBy: { orderNumber: "asc" }, select: { id: true, orderNumber: true, value: true, ongkir: true, dpTarget: true, paymentStatus: true, paidAt: true, status: true } });
const semuaPayment = (anak) => testPrisma.payment.findMany({ where: { orderId: { in: anak } }, include: { finAllocations: true }, orderBy: { createdAt: "asc" } });
const jurnalBayar = () => testPrisma.finJournalEntry.findMany({ where: { source: "PEMBAYARAN_ORDER" }, include: { lines: true }, orderBy: { createdAt: "asc" } });
const angka = (d) => Number(d);
const bayarResi = (w, body, headers = kunci()) => w.s.post(`/api/resi/${w.groupId}/pembayaran`, { method: "TRANSFER", cashAccountId: w.bank.id, ...body }, headers);

async function akunSistem() {
  const [uangMuka, piutang] = await Promise.all([
    testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.UANG_MUKA_PELANGGAN } }),
    testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_USAHA } }),
  ]);
  return { uangMuka, piutang };
}

/** Invarian jurnal untuk satu Payment Resi: seimbang; Dr kas = nominal; Cr per child = alokasi; tidak ada pendapatan; satu jurnal per payment. */
async function periksaJurnal(w, payment) {
  const { uangMuka, piutang } = await akunSistem();
  const entries = (await jurnalBayar()).filter((e) => e.sourceId === payment.id);
  assert.equal(entries.length, 1, "TEPAT satu jurnal untuk satu Payment (tidak ada uang masuk ganda)");
  const e = entries[0];
  const debit = e.lines.reduce((sum, l) => sum + angka(l.debit), 0);
  const kredit = e.lines.reduce((sum, l) => sum + angka(l.credit), 0);
  assert.equal(debit, payment.amount); assert.equal(kredit, payment.amount, "jurnal seimbang");
  const baris = e.lines.filter((l) => angka(l.debit) > 0);
  assert.equal(baris.length, 1, "Dr Kas/Bank SEKALI");
  assert.equal(baris[0].accountId, w.bank.accountId);
  const kreditBaris = e.lines.filter((l) => angka(l.credit) > 0);
  assert.equal(kreditBaris.length, payment.finAllocations.length, "satu baris kredit PER child sesuai alokasi");
  for (const a of payment.finAllocations) {
    const l = kreditBaris.find((x) => x.orderId === a.orderId);
    assert.ok(l, "baris kredit ada untuk child");
    assert.equal(angka(l.credit), angka(a.amount));
    assert.ok([uangMuka.id, piutang.id].includes(l.accountId), "Cr hanya ke Uang Muka/Piutang — bukan Pendapatan");
  }
  return e;
}

// ── flag ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("Flag RESI_PEMBAYARAN_AKTIF default MATI (server-authoritative): semua endpoint pembayaran/klaim/verifikasi menolak 403 tanpa menulis apa pun", async () => {
  const w = await dunia({ pembayaran: false });
  assert.equal((await w.s.get("/api/resi/status")).body.pembayaranAktif, false);
  const sebelum = { p: await testPrisma.payment.count(), a: await testPrisma.finPaymentAllocation.count(), j: await testPrisma.finJournalEntry.count() };
  for (const r of [
    await w.s.get(`/api/resi/${w.groupId}/pembayaran/pratinjau`),
    await bayarResi(w, { tipe: "DP" }),
    await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {}, kunci()),
    await w.a.get(`/api/finance/penerimaan/resi/${w.groupId}/pratinjau`),
    await w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/verifikasi`, { mode: "REKENING", cashAccountId: w.bank.id }, kunci()),
    await w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/tolak`, { reason: "x" }, kunci()),
  ]) {
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, "RESI_PEMBAYARAN_MATI");
  }
  assert.deepEqual({ p: await testPrisma.payment.count(), a: await testPrisma.finPaymentAllocation.count(), j: await testPrisma.finJournalEntry.count() }, sebelum);
  // antrean Finance tanpa bagian Resi saat flag mati
  const q = await w.a.get("/api/finance/penerimaan/lunas-belum-dicatat");
  assert.equal(q.status, 200); assert.equal("resi" in q.body, false);
  await setSetting(testPrisma, SETTING_KEYS.RESI_PEMBAYARAN_AKTIF, "true");
  assert.equal((await w.s.get("/api/resi/status")).body.pembayaranAktif, true);
});

test("Idempotency-Key WAJIB pada pembayaran, klaim Lunas, dan verifikasi Resi (428); kunci tidak valid ditolak", async () => {
  const w = await dunia();
  assert.equal((await w.s.post(`/api/resi/${w.groupId}/pembayaran`, { method: "TRANSFER", tipe: "DP" })).status, 428);
  assert.equal((await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {})).status, 428);
  assert.equal((await w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/verifikasi`, { mode: "REKENING", cashAccountId: w.bank.id })).status, 428);
  assert.equal((await bayarResi(w, { tipe: "DP" }, { "Idempotency-Key": "pendek" })).status, 400);
  assert.equal(await testPrisma.payment.count(), 0);
});

// ── perhitungan alokasi ─────────────────────────────────────────────────────────────────────────────────────────

test("Pratinjau: TAGIHAN = sisa tiap child; DP = dpTarget tiap child (Σ = DP 30% Total Resi); server menghitung, klien tidak menentukan pembagian", async () => {
  const w = await dunia();
  const anak = await ambilAnak(w.groupId);
  assert.deepEqual(anak.map((o) => o.value), HARGA);
  const dpTarget = bagiProporsional(DP, TAGIHAN);
  assert.deepEqual(anak.map((o) => o.dpTarget), dpTarget, "dpTarget child dari Fase 1 = largest-remainder atas tagihan (termasuk ongkir tambahan di anchor)");
  assert.equal(dpTarget.reduce((s, x) => s + x, 0), DP);

  const tagihan = await w.s.get(`/api/resi/${w.groupId}/pembayaran/pratinjau`);
  assert.equal(tagihan.status, 200, JSON.stringify(tagihan.body));
  assert.equal(tagihan.body.nominal, TOTAL);
  assert.deepEqual(tagihan.body.alokasi.map((x) => x.alokasi), TAGIHAN);
  assert.equal(tagihan.body.ringkasan.totalTagihan, TOTAL);

  const dp = await w.s.get(`/api/resi/${w.groupId}/pembayaran/pratinjau?tipe=DP`);
  assert.equal(dp.body.nominal, DP);
  assert.deepEqual(dp.body.alokasi.map((x) => x.alokasi), dpTarget, "alokasi DP PERSIS = Σ dpTarget child");
  assert.equal(await testPrisma.payment.count(), 0, "pratinjau tidak menulis apa pun");

  // Finance melihat pratinjau yang sama sebelum verifikasi
  const fin = await w.a.get(`/api/finance/penerimaan/resi/${w.groupId}/pratinjau`);
  assert.equal(fin.status, 200, JSON.stringify(fin.body));
  assert.deepEqual(fin.body.alokasi.map((x) => x.alokasi), TAGIHAN);
});

test("Unit murni hitungAlokasiResi: largest-remainder — Σ tepat = nominal untuk banyak kombinasi; baris 0 dibuang; tanpa alokasi melebihi sisa", () => {
  const mk = (id, value, dpTarget = 0, ongkir = 0, status = "PENDING") => ({ id, value, ongkir, dpTarget, status, orderNumber: id });
  const anak = [mk("a", 1_000_000, 315_000, 50_000), mk("b", 500_000, 150_000), mk("c", 250_001, 75_000)];
  const kosong = new Map();
  for (const nominal of [1, 2, 3, 7, 99, 1_000, 123_457, 999_999, 1_800_000, 1_800_001]) {
    const h = hitungAlokasiResi({ anak, dibayar: kosong, tipe: "TAGIHAN", nominal });
    assert.equal(h.tulis.reduce((s, x) => s + x.alokasi, 0), nominal, `Σ = ${nominal}`);
    for (const a of h.alokasi) assert.ok(a.alokasi >= 0 && a.alokasi <= a.sisa, "tidak melebihi sisa");
    assert.ok(h.tulis.every((x) => x.alokasi > 0));
  }
  // sisa berbeda setelah pembayaran sebelumnya
  const dibayar = new Map([["a", 400_000], ["b", 500_000]]); // b sudah lunas
  const h = hitungAlokasiResi({ anak, dibayar, tipe: "TAGIHAN" });
  assert.deepEqual(h.alokasi.map((x) => [x.orderId, x.sisa, x.alokasi]), [["a", 650_000, 650_000], ["b", 0, 0], ["c", 250_001, 250_001]]);
  assert.deepEqual(h.tulis.map((x) => x.orderId), ["a", "c"], "child lunas tidak mendapat baris alokasi");
  // child CANCELLED diabaikan
  const dgBatal = hitungAlokasiResi({ anak: [...anak.slice(0, 2), mk("c", 250_001, 75_000, 0, "CANCELLED")], dibayar: kosong, tipe: "TAGIHAN" });
  assert.deepEqual(dgBatal.alokasi.map((x) => x.orderId), ["a", "b"]);
  // penolakan
  const tolak = (fn, code) => assert.throws(fn, (e) => e instanceof ResiBayarError && e.code === code);
  tolak(() => hitungAlokasiResi({ anak, dibayar: kosong, tipe: "TAGIHAN", nominal: 1_800_002 }), "OVER_ALOKASI");
  tolak(() => hitungAlokasiResi({ anak, dibayar: kosong, tipe: "DP", nominal: 540_001 }), "OVER_ALOKASI");
  for (const n of [0, -5, 12.5, "abc"]) tolak(() => hitungAlokasiResi({ anak, dibayar: kosong, nominal: n }), "NOMINAL_TIDAK_VALID");
  tolak(() => hitungAlokasiResi({ anak, dibayar: new Map([["a", 1_050_000], ["b", 500_000], ["c", 250_001]]) }), "TIDAK_ADA_SISA");
  tolak(() => hitungAlokasiResi({ anak, dibayar: kosong, tipe: "LAIN" }), "TIPE_TIDAK_VALID");
  tolak(() => hitungAlokasiResi({ anak: [mk("x", 1, 0, 0, "CANCELLED")], dibayar: kosong }), "RESI_TANPA_ORDER_AKTIF");
});

// ── pembayaran: DP penuh/parsial, pelunasan, rounding, jurnal ─────────────────────────────────────────────────────

test("DP penuh 30%: satu Payment anchor + 3 alokasi = dpTarget; status DP; jurnal Dr Bank sekali, Cr Uang Muka per child; tanpa pendapatan", async () => {
  const w = await dunia();
  const dpTarget = (await ambilAnak(w.groupId)).map((o) => o.dpTarget);
  const r = await bayarResi(w, { tipe: "DP" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.nominal, DP);
  const [p] = await semuaPayment(w.anak);
  assert.equal(await testPrisma.payment.count(), 1, "SATU Payment");
  assert.equal(p.orderId, w.anchorId, "Payment pada order anchor");
  assert.equal(p.amount, DP);
  assert.deepEqual(w.anak.map((id) => p.finAllocations.find((x) => x.orderId === id) && angka(p.finAllocations.find((x) => x.orderId === id).amount)), dpTarget, "alokasi = dpTarget tiap child");
  assert.equal(p.finAllocations.reduce((s, x) => s + angka(x.amount), 0), p.amount, "Σ alokasi = Payment");
  assert.ok((await ambilAnak(w.groupId)).every((o) => o.paymentStatus === "DP"));
  const e = await periksaJurnal(w, p);
  const { uangMuka } = await akunSistem();
  assert.ok(e.lines.filter((l) => angka(l.credit) > 0).every((l) => l.accountId === uangMuka.id), "belum diserahkan → Uang Muka Pelanggan");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENGAKUAN_PENDAPATAN" } }), 0, "tidak ada pengakuan pendapatan");
});

test("DP parsial: alokasi proporsional atas sisa DP dengan largest-remainder; DP kedua melengkapi tepat dpTarget; DP ketiga ditolak (tidak ada sisa DP)", async () => {
  const w = await dunia();
  const dpTarget = (await ambilAnak(w.groupId)).map((o) => o.dpTarget);
  const r1 = await bayarResi(w, { tipe: "DP", nominal: 200_001 });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const ekspektasi = bagiProporsional(200_001, dpTarget);
  assert.deepEqual(r1.body.alokasi.map((x) => x.jumlah), ekspektasi.filter((x) => x > 0));
  const r2 = await bayarResi(w, { tipe: "DP" });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(r2.body.nominal, DP - 200_001, "sisa DP");
  const payments = await semuaPayment(w.anak);
  assert.equal(payments.length, 2);
  for (const [i, id] of w.anak.entries()) {
    const total = payments.flatMap((p) => p.finAllocations).filter((x) => x.orderId === id).reduce((s, x) => s + angka(x.amount), 0);
    assert.equal(total, dpTarget[i], "Σ dua DP = dpTarget child (konsisten dengan Σ dpTarget)");
  }
  for (const p of payments) await periksaJurnal(w, p);
  const r3 = await bayarResi(w, { tipe: "DP" });
  assert.equal(r3.status, 409); assert.equal(r3.body.code, "TIDAK_ADA_SISA");
});

test("Pelunasan setelah DP: sisa tagihan tiap child dilunasi; semua child LUNAS; total dibayar = Total Resi; nol uang/jurnal ganda", async () => {
  const w = await dunia();
  assert.equal((await bayarResi(w, { tipe: "DP" })).status, 201);
  const dpTarget = (await ambilAnak(w.groupId)).map((o) => o.dpTarget);
  const r = await bayarResi(w, { tipe: "TAGIHAN" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.nominal, TOTAL - DP);
  assert.deepEqual(r.body.alokasi.map((x) => x.jumlah), TAGIHAN.map((t, i) => t - dpTarget[i]), "alokasi = sisa tagihan per child");
  assert.equal(r.body.ringkasan.sisaSesudah, 0);
  const anak = await ambilAnak(w.groupId);
  assert.ok(anak.every((o) => o.paymentStatus === "LUNAS"), "semua child LUNAS");
  assert.ok(anak.every((o) => o.paidAt), "paidAt terisi saat transisi LUNAS");
  let dibayarSum = 0;
  for (const id of w.anak) dibayarSum += angka(await paidForOrder(testPrisma, id, { enabled: false }));
  assert.equal(dibayarSum, TOTAL, "Σ paidForOrder seluruh child = Total Resi (tidak dihitung ganda pada anchor)");
  const payments = await semuaPayment(w.anak);
  assert.equal(payments.reduce((s, p) => s + p.amount, 0), TOTAL);
  const jurnal = await jurnalBayar();
  assert.equal(jurnal.length, 2);
  for (const p of payments) await periksaJurnal(w, p);
  assert.equal(jurnal.flatMap((e) => e.lines).reduce((s, l) => s + angka(l.debit), 0), TOTAL, "kas masuk total = TOTAL, sekali");
  const lagi = await bayarResi(w, {});
  assert.equal(lagi.status, 409); assert.equal(lagi.body.code, "TIDAK_ADA_SISA");
});

test("Rounding: nominal kecil/tidak habis dibagi tetap Σ tepat, baris nol tidak ditulis; child yang pendapatannya sudah diakui → Cr Piutang, lainnya Uang Muka", async () => {
  const w = await dunia();
  // child ke-2 sudah DELIVERED dengan pendapatan diakui
  await testPrisma.order.update({ where: { id: w.anak[1] }, data: { status: "DELIVERED" } });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: w.anak[1], userId: w.admin.user.id, date: "2026-09-10" }));
  const r = await bayarResi(w, { tipe: "TAGIHAN", nominal: 7 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ekspektasi = bagiProporsional(7, TAGIHAN);
  const [p] = await semuaPayment(w.anak);
  assert.equal(p.amount, 7);
  assert.equal(p.finAllocations.length, ekspektasi.filter((x) => x > 0).length, "baris alokasi nol tidak ditulis");
  assert.equal(p.finAllocations.reduce((s, x) => s + angka(x.amount), 0), 7, "Σ tepat 7");
  assert.ok(p.finAllocations.every((x) => angka(x.amount) > 0));
  const e = await periksaJurnal(w, p);
  const { piutang, uangMuka } = await akunSistem();
  for (const l of e.lines.filter((x) => angka(x.credit) > 0)) {
    assert.equal(l.accountId, l.orderId === w.anak[1] ? piutang.id : uangMuka.id, "diakui → Piutang; belum → Uang Muka");
  }
});

// ── validasi & penolakan ────────────────────────────────────────────────────────────────────────────────────────

test("Penolakan: nominal nol/negatif/desimal/non-angka, over-alokasi, metode tak valid, rekening nonaktif — tidak ada Payment/alokasi/jurnal tersisa", async () => {
  const w = await dunia();
  for (const nominal of [0, -1, 12.5, "abc"]) {
    const r = await bayarResi(w, { tipe: "TAGIHAN", nominal });
    assert.equal(r.status, 400, `nominal ${nominal}: ${JSON.stringify(r.body)}`);
  }
  const over = await bayarResi(w, { tipe: "TAGIHAN", nominal: TOTAL + 1 });
  assert.equal(over.status, 409); assert.equal(over.body.code, "OVER_ALOKASI");
  const overDp = await bayarResi(w, { tipe: "DP", nominal: DP + 1 });
  assert.equal(overDp.status, 409); assert.equal(overDp.body.code, "OVER_ALOKASI");
  assert.equal((await bayarResi(w, { method: "CRYPTO" })).status, 400);
  assert.equal((await bayarResi(w, { tipe: "LAIN" })).status, 400);
  await testPrisma.finCashAccount.update({ where: { id: w.bank.id }, data: { active: false } });
  assert.equal((await bayarResi(w, {})).status, 400);
  assert.deepEqual([await testPrisma.payment.count(), await testPrisma.finPaymentAllocation.count(), await testPrisma.finJournalEntry.count()], [0, 0, 0]);
});

test("Alokasi dari klien DIABAIKAN: field alokasi/allocations/orderId pada body tidak memengaruhi pembagian (server menghitung ulang)", async () => {
  const w = await dunia();
  const r = await bayarResi(w, { tipe: "DP", alokasi: [{ orderId: w.anak[2], amount: DP }], allocations: [{ orderId: w.anak[2], amount: DP }], orderId: w.anak[2] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const dpTarget = (await ambilAnak(w.groupId)).map((o) => o.dpTarget);
  const [p] = await semuaPayment(w.anak);
  assert.equal(p.orderId, w.anchorId);
  assert.deepEqual(w.anak.map((id) => angka(p.finAllocations.find((x) => x.orderId === id).amount)), dpTarget);
});

test("Invarian alokasi (validasiAlokasiResi) menolak: child beda group/customer, child CANCELLED, nominal nol/negatif, over-alokasi, Σ ≠ Payment, duplikat, kosong", async () => {
  const w = await dunia();
  const grup = await testPrisma.orderGroup.findUnique({ where: { id: w.groupId } });
  const lain = await testPrisma.customer.create({ data: { name: "Bukan Resi" } });
  const asing = await createOrderForCustomer(lain.id, { notes: "{}", unitCount: 1 }, w.sales.user.id);
  await testPrisma.order.update({ where: { id: asing.id }, data: { value: 100_000 } });
  const tolak = async (alokasi, nominalPayment, code) => {
    await assert.rejects(validasiAlokasiResi(testPrisma, { grup, alokasi, nominalPayment }), (e) => e instanceof ResiBayarError && e.code === code, `harus ditolak: ${code}`);
  };
  await tolak([{ orderId: asing.id, amount: 100_000 }], 100_000, "GROUP_BEDA"); // order tunggal / group lain
  await testPrisma.order.update({ where: { id: asing.id }, data: { groupId: w.groupId } }); // masuk group tetapi customer berbeda
  await tolak([{ orderId: asing.id, amount: 100_000 }], 100_000, "CUSTOMER_BEDA");
  await testPrisma.order.update({ where: { id: asing.id }, data: { groupId: null } });
  await testPrisma.order.update({ where: { id: w.anak[2] }, data: { status: "CANCELLED" } });
  await tolak([{ orderId: w.anak[2], amount: 1_000 }], 1_000, "CHILD_DIBATALKAN");
  await testPrisma.order.update({ where: { id: w.anak[2] }, data: { status: "PENDING" } });
  await tolak([{ orderId: w.anak[0], amount: 0 }], 1, "NOMINAL_ALOKASI_TIDAK_VALID");
  await tolak([{ orderId: w.anak[0], amount: -5 }], 1, "NOMINAL_ALOKASI_TIDAK_VALID");
  await tolak([{ orderId: w.anak[0], amount: 1_050_001 }], 1_050_001, "OVER_ALOKASI");
  await tolak([{ orderId: w.anak[0], amount: 100 }, { orderId: w.anak[1], amount: 100 }], 300, "TOTAL_TIDAK_SAMA");
  await tolak([{ orderId: w.anak[0], amount: 100 }, { orderId: w.anak[0], amount: 100 }], 200, "ALOKASI_GANDA");
  await tolak([], 100, "ALOKASI_KOSONG");
  await tolak([{ orderId: "tidak-ada", amount: 100 }], 100, "ORDER_TIDAK_ADA");
  // yang valid lolos
  assert.equal(await validasiAlokasiResi(testPrisma, { grup, alokasi: [{ orderId: w.anak[0], amount: 400_000 }, { orderId: w.anak[1], amount: 100_000 }], nominalPayment: 500_000 }), true);
});

// ── klaim Lunas + antrean Finance + verifikasi ───────────────────────────────────────────────────────────────────

test("Klaim Lunas SEKALI di level Resi → SATU antrean Finance dengan rincian child; child tidak muncul per order; verifikasi membuat 1 Payment + alokasi + jurnal per child", async () => {
  const w = await dunia();
  const klaim = await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {}, kunci());
  assert.equal(klaim.status, 201, JSON.stringify(klaim.body));
  assert.equal(klaim.body.ditandai.length, 3);
  assert.ok((await ambilAnak(w.groupId)).every((o) => o.paymentStatus === "LUNAS" && o.paidAt), "semua child LUNAS, paidAt terisi");
  assert.equal(await testPrisma.payment.count(), 0, "klaim TIDAK membuat Payment");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PEMBAYARAN_ORDER" } }), 0, "klaim tidak menjurnal");
  assert.equal((await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {}, kunci())).status, 409, "klaim kedua ditolak");

  const q = await w.a.get("/api/finance/penerimaan/lunas-belum-dicatat");
  assert.equal(q.status, 200);
  assert.equal(q.body.resi.length, 1, "SATU antrean untuk Resi");
  const item = q.body.resi[0];
  assert.equal(item.groupId, w.groupId); assert.equal(item.lengkap, true);
  assert.equal(item.sisa, TOTAL); assert.equal(item.anak.length, 3);
  assert.deepEqual(item.anak.map((x) => x.sisa), TAGIHAN);
  assert.equal(q.body.items.filter((i) => w.anak.includes(i.orderId)).length, 0, "child tidak muncul sebagai baris per order");

  const pra = await w.a.get(`/api/finance/penerimaan/resi/${w.groupId}/pratinjau`);
  assert.deepEqual(pra.body.alokasi.map((x) => x.alokasi), TAGIHAN);

  const ver = await w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/verifikasi`, {
    mode: "REKENING", method: "TRANSFER", cashAccountId: w.bank.id, alokasi: [{ orderId: w.anak[0], amount: TOTAL }], // diabaikan
  }, kunci());
  assert.equal(ver.status, 201, JSON.stringify(ver.body));
  assert.equal(ver.body.amount, TOTAL);
  const [p] = await semuaPayment(w.anak);
  assert.equal(await testPrisma.payment.count(), 1);
  assert.equal(p.orderId, w.anchorId);
  assert.deepEqual(w.anak.map((id) => angka(p.finAllocations.find((x) => x.orderId === id).amount)), TAGIHAN, "alokasi server, bukan dari klien");
  assert.equal(await testPrisma.paymentVerification.count({ where: { paymentId: p.id } }), 1, "terverifikasi");
  await periksaJurnal(w, p);
  assert.ok((await ambilAnak(w.groupId)).every((o) => o.paymentStatus === "LUNAS"));
  const setelah = await w.a.get("/api/finance/penerimaan/lunas-belum-dicatat");
  assert.equal(setelah.body.resi.length, 0, "antrean bersih setelah verifikasi");
  const lagi = await w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/verifikasi`, { mode: "REKENING", cashAccountId: w.bank.id }, kunci());
  assert.equal(lagi.status, 409, "tidak bisa memverifikasi dua kali (tidak ada sisa)");
});

test("Verifikasi Resi setelah DP: nominal default = sisa; klaim belum lengkap ditolak; SEBELUM_SALDO_AWAL ditolak; tolak klaim mengembalikan status child; minta bukti tercatat", async () => {
  const w = await dunia();
  assert.equal((await bayarResi(w, { tipe: "DP" })).status, 201);
  // klaim belum ada → verifikasi ditolak
  const belum = await w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/verifikasi`, { mode: "REKENING", cashAccountId: w.bank.id }, kunci());
  assert.equal(belum.status, 409); assert.equal(belum.body.code, "KLAIM_BELUM_LENGKAP");
  assert.equal((await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {}, kunci())).status, 201);
  const mode = await w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/verifikasi`, { mode: "SEBELUM_SALDO_AWAL" }, kunci());
  assert.equal(mode.status, 422);
  // minta bukti + tolak
  const bukti = await w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/minta-bukti`, { catatan: "mohon foto transfer" });
  assert.equal(bukti.status, 201, JSON.stringify(bukti.body));
  assert.ok(await testPrisma.activityEvent.count({ where: { eventType: "BUKTI_DIMINTA", entityId: { in: w.anak } } }) >= 1);
  const tolak = await w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/tolak`, { reason: "uang belum masuk" });
  assert.equal(tolak.status, 200, JSON.stringify(tolak.body));
  const anak = await ambilAnak(w.groupId);
  assert.ok(anak.every((o) => o.paymentStatus === "DP" && o.paidAt === null), "kembali DP (sudah ada DP tercatat), paidAt kosong");
  // klaim ulang lalu verifikasi: nominal = sisa setelah DP
  assert.equal((await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {}, kunci())).status, 201);
  const ver = await w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/verifikasi`, { mode: "REKENING", cashAccountId: w.bank.id }, kunci());
  assert.equal(ver.status, 201, JSON.stringify(ver.body));
  assert.equal(ver.body.amount, TOTAL - DP);
});

test("Tolak Payment Resi yang belum diverifikasi (alur Finance yang sudah ada): jurnal dibalik, semua child kembali BELUM_BAYAR", async () => {
  const w = await dunia();
  const r = await bayarResi(w, { tipe: "DP" });
  assert.equal(r.status, 201);
  const tolak = await w.a.post(`/api/finance/pembayaran/${r.body.paymentId}/tolak`, { reason: "salah catat" });
  assert.equal(tolak.status, 200, JSON.stringify(tolak.body));
  assert.ok((await ambilAnak(w.groupId)).every((o) => o.paymentStatus === "BELUM_BAYAR"));
  const entries = await jurnalBayar();
  assert.equal(entries.filter((e) => e.status === "POSTED").length + entries.filter((e) => e.status === "REVERSED").length, entries.length);
  const netto = entries.flatMap((e) => e.lines).reduce((s, l) => s + angka(l.debit) - angka(l.credit), 0);
  assert.equal(netto, 0);
});

// ── concurrency & replay ─────────────────────────────────────────────────────────────────────────────────────────

test("Replay Idempotency-Key SAMA (isi sama) memutar ulang respons pertama tanpa data baru; kunci sama + isi beda = 422", async () => {
  const w = await dunia();
  const h = kunci();
  const a = await bayarResi(w, { tipe: "DP" }, h);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const total = async () => [await testPrisma.payment.count(), await testPrisma.finPaymentAllocation.count(), await testPrisma.finJournalEntry.count()];
  const sebelum = await total();
  const b = await bayarResi(w, { tipe: "DP" }, h);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(b.body, a.body, "respons yang sama");
  assert.deepEqual(await total(), sebelum, "replay tidak menambah Payment/alokasi/jurnal");
  const c = await bayarResi(w, { tipe: "TAGIHAN" }, h);
  assert.equal(c.status, 422);
  assert.deepEqual(await total(), sebelum);
  // klaim Lunas juga idempoten
  const k = kunci();
  const k1 = await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {}, k);
  const k2 = await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {}, k);
  assert.equal(k1.status, 201); assert.equal(k2.status, 201); assert.equal(k2.headers.get("idempotent-replayed"), "true");
});

test("Concurrency/double-click: request paralel dengan kunci SAMA → satu eksekusi; kunci BERBEDA pada pelunasan penuh → tepat satu berhasil, sisanya 409; tidak ada over-alokasi", async () => {
  const w1 = await dunia();
  const h = kunci();
  const kembar = await Promise.all([bayarResi(w1, { tipe: "TAGIHAN" }, h), bayarResi(w1, { tipe: "TAGIHAN" }, h), bayarResi(w1, { tipe: "TAGIHAN" }, h)]);
  assert.ok(kembar.every((r) => [201, 409].includes(r.status)), kembar.map((r) => r.status).join(","));
  assert.ok(kembar.some((r) => r.status === 201));
  assert.equal(await testPrisma.payment.count(), 1, "kunci sama → SATU Payment");
  await truncateAll();

  const w = await dunia();
  const hasil = await Promise.all([1, 2, 3, 4, 5].map(() => bayarResi(w, { tipe: "TAGIHAN" })));
  const sukses = hasil.filter((r) => r.status === 201);
  assert.equal(sukses.length, 1, `tepat satu berhasil: ${hasil.map((r) => r.status).join(",")}`);
  assert.ok(hasil.filter((r) => r.status !== 201).every((r) => r.status === 409), "sisanya ditolak 409 (sisa 0 setelah yang pertama)");
  assert.equal(await testPrisma.payment.count(), 1);
  assert.equal(await testPrisma.finPaymentAllocation.count(), 3);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PEMBAYARAN_ORDER" } }), 1);
  for (const id of w.anak) {
    const o = (await ambilAnak(w.groupId)).find((x) => x.id === id);
    assert.equal(angka(await paidForOrder(testPrisma, id, { enabled: false })), o.value + (o.ongkir || 0), "dibayar tepat = tagihan, tidak lebih");
  }
});

test("Concurrency: tiga DP parsial paralel (kunci berbeda) semuanya berhasil berurutan tanpa melampaui dpTarget child; DP penuh paralel hanya satu", async () => {
  const w = await dunia();
  const dpTarget = (await ambilAnak(w.groupId)).map((o) => o.dpTarget);
  const hasil = await Promise.all([1, 2, 3].map(() => bayarResi(w, { tipe: "DP", nominal: 100_000 })));
  assert.deepEqual(hasil.map((r) => r.status), [201, 201, 201], JSON.stringify(hasil.map((r) => r.body)));
  const payments = await semuaPayment(w.anak);
  assert.equal(payments.length, 3);
  for (const [i, id] of w.anak.entries()) {
    const total = payments.flatMap((p) => p.finAllocations).filter((x) => x.orderId === id).reduce((s, x) => s + angka(x.amount), 0);
    assert.ok(total <= dpTarget[i], `child ${i}: Σ alokasi ${total} ≤ dpTarget ${dpTarget[i]}`);
  }
  for (const p of payments) await periksaJurnal(w, p);
  await truncateAll();

  const w2 = await dunia();
  const penuh = await Promise.all([1, 2, 3, 4].map(() => bayarResi(w2, { tipe: "DP" })));
  assert.equal(penuh.filter((r) => r.status === 201).length, 1, penuh.map((r) => r.status).join(","));
  assert.equal(await testPrisma.payment.count(), 1);
});

// ── batas alur: cancel, backfill, order tunggal, guard per-order ──────────────────────────────────────────────────

test("Child yang sudah menerima alokasi TIDAK bisa dibatalkan diam-diam (PATCH status dan /cancel → 409, Fase 3B); order tunggal tanpa alokasi tidak berubah", async () => {
  const w = await dunia();
  // sebelum ada pembayaran: child boleh dibatalkan (perilaku lama); kita uji SETELAH pembayaran
  assert.equal((await bayarResi(w, { tipe: "DP" })).status, 201);
  const child = w.anak[2];
  const patch = await w.s.patch(`/api/orders/${child}`, { status: "CANCELLED" });
  assert.equal(patch.status, 409, JSON.stringify(patch.body));
  assert.match(patch.body.error, /alokasi pembayaran Resi/);
  const cancel = await w.s.post(`/api/orders/${child}/cancel`, { reason: "uji" });
  assert.equal(cancel.status, 409, JSON.stringify(cancel.body));
  assert.notEqual((await testPrisma.order.findUnique({ where: { id: child } })).status, "CANCELLED");
  // order tunggal (groupId NULL) tanpa pembayaran: pembatalan tetap berjalan seperti biasa
  const tunggal = await createOrderForCustomer(w.customer.id, { notes: "{}", unitCount: 1 }, w.sales.user.id);
  const ok = await w.s.patch(`/api/orders/${tunggal.id}`, { status: "CANCELLED" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test("Child CANCELLED sebelum pembayaran: dikecualikan dari alokasi (sisa aktif saja), Σ tetap tepat", async () => {
  const w = await dunia();
  await testPrisma.order.update({ where: { id: w.anak[2] }, data: { status: "CANCELLED" } });
  const pra = await w.s.get(`/api/resi/${w.groupId}/pembayaran/pratinjau`);
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.equal(pra.body.alokasi.length, 2);
  assert.equal(pra.body.nominal, TAGIHAN[0] + TAGIHAN[1]);
  const r = await bayarResi(w, { tipe: "TAGIHAN" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const [p] = await semuaPayment(w.anak);
  assert.equal(p.finAllocations.length, 2);
  assert.ok(!p.finAllocations.some((x) => x.orderId === w.anak[2]));
  assert.equal(p.finAllocations.reduce((s, x) => s + angka(x.amount), 0), p.amount);
  // anchor dibatalkan → pembayaran Resi ditolak sampai Fase 3B
  await truncateAll();
  const w2 = await dunia();
  await testPrisma.order.update({ where: { id: w2.anchorId }, data: { status: "CANCELLED" } });
  const tolak = await bayarResi(w2, { tipe: "DP" });
  assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "ANCHOR_DIBATALKAN");
});

test("Group source BACKFILL_BUNDLE TIDAK masuk alur pembayaran Resi (409) dan child-nya tetap diproses per order seperti sebelumnya", async () => {
  const w = await dunia();
  await testPrisma.orderGroup.update({ where: { id: w.groupId }, data: { source: "BACKFILL_BUNDLE" } });
  for (const r of [
    await w.s.get(`/api/resi/${w.groupId}/pembayaran/pratinjau`),
    await bayarResi(w, { tipe: "DP" }),
    await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {}, kunci()),
  ]) { assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, "GRUP_BACKFILL"); }
  // antrean & verifikasi per-order legacy tetap berlaku untuk child
  await testPrisma.order.update({ where: { id: w.anak[1] }, data: { paymentStatus: "LUNAS", paidAt: new Date() } });
  const q = await w.a.get("/api/finance/penerimaan/lunas-belum-dicatat");
  assert.ok(q.body.items.some((i) => i.orderId === w.anak[1]), "child backfill tampil per order (legacy)");
  const v = await w.a.post("/api/finance/penerimaan/verifikasi", { orderId: w.anak[1], mode: "REKENING", cashAccountId: w.bank.id }, kunci());
  assert.equal(v.status, 201, JSON.stringify(v.body));
});

test("Guard per-order: saat flag ON child Resi BARU tidak bisa diverifikasi/ditolak per order (409 ANAK_RESI); saat flag OFF perilaku lama utuh", async () => {
  const w = await dunia();
  await testPrisma.order.update({ where: { id: w.anak[1] }, data: { paymentStatus: "LUNAS", paidAt: new Date() } });
  for (const r of [
    await w.a.post("/api/finance/penerimaan/verifikasi", { orderId: w.anak[1], mode: "REKENING", cashAccountId: w.bank.id }, kunci()),
    await w.a.post("/api/finance/penerimaan/tolak", { orderId: w.anak[1], reason: "x" }),
    await w.a.post("/api/finance/penerimaan/minta-bukti", { orderId: w.anak[1] }),
  ]) { assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, "ANAK_RESI"); }
  await setSetting(testPrisma, SETTING_KEYS.RESI_PEMBAYARAN_AKTIF, "false");
  const q = await w.a.get("/api/finance/penerimaan/lunas-belum-dicatat");
  assert.ok(q.body.items.some((i) => i.orderId === w.anak[1]), "flag OFF: child tampil per order seperti dulu");
  const v = await w.a.post("/api/finance/penerimaan/verifikasi", { orderId: w.anak[1], mode: "REKENING", cashAccountId: w.bank.id }, kunci());
  assert.equal(v.status, 201, JSON.stringify(v.body));
});

test("Order tunggal / groupId NULL IDENTIK dengan perilaku lama: hasil skenario (DP, jurnal, klaim Lunas, antrean, verifikasi) sama persis dengan flag pembayaran Resi ON maupun OFF", async () => {
  const w = await dunia({ pembayaran: false });
  const skenario = async () => {
    const o = await createOrderForCustomer(w.customer.id, { notes: "{}", unitCount: 1 }, w.sales.user.id);
    await testPrisma.order.update({ where: { id: o.id }, data: { value: 1_000_000 } });
    const dp = await w.s.post(`/api/orders/${o.id}/payments`, { amount: 300_000, method: "TRANSFER", cashAccountId: w.bank.id });
    assert.equal(dp.status, 201, JSON.stringify(dp.body));
    const patch = await w.s.patch(`/api/orders/${o.id}`, { paymentStatus: "LUNAS" });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    const q = await w.a.get("/api/finance/penerimaan/lunas-belum-dicatat");
    const baris = q.body.items.find((i) => i.orderId === o.id);
    assert.ok(baris, "order tunggal selalu tampil per order di antrean lama");
    const v = await w.a.post("/api/finance/penerimaan/verifikasi", { orderId: o.id, mode: "REKENING", cashAccountId: w.bank.id }, kunci());
    assert.equal(v.status, 201, JSON.stringify(v.body));
    const pays = await testPrisma.payment.findMany({ where: { orderId: o.id }, include: { finAllocations: true }, orderBy: { createdAt: "asc" } });
    const jur = await testPrisma.finJournalEntry.findMany({ where: { sourceId: { in: pays.map((p) => p.id) } }, include: { lines: true }, orderBy: { createdAt: "asc" } });
    return {
      status: (await testPrisma.order.findUnique({ where: { id: o.id } })).paymentStatus,
      payments: pays.map((p) => [p.amount, p.finAllocations.length]),
      antrean: [baris.nilaiOrder, baris.sudahDicatat, baris.sisa],
      jurnal: jur.map((e) => e.lines.map((l) => [angka(l.debit), angka(l.credit)]).sort().join("|")),
      adaBagianResi: "resi" in q.body,
    };
  };
  const off = await skenario();
  await setSetting(testPrisma, SETTING_KEYS.RESI_PEMBAYARAN_AKTIF, "true");
  const on = await skenario();
  assert.equal(off.adaBagianResi, false);
  assert.equal(on.adaBagianResi, true, "bagian resi kosong ada saat ON, tanpa memengaruhi order tunggal");
  const { adaBagianResi: _a, ...offInti } = off; const { adaBagianResi: _b, ...onInti } = on;
  assert.deepEqual(onInti, offInti, "order tunggal: hasil identik");
});

// ── perbaikan temuan audit invariants ─────────────────────────────────────────────────────────────

test("Audit #1: admin membatalkan Payment Resi lewat CRM → SEMUA child dihitung ulang (status/paidAt tidak menggantung)", async () => {
  const w = await dunia();
  const r = await bayarResi(w, { tipe: "DP" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok((await ambilAnak(w.groupId)).every((o) => o.paymentStatus === "DP"));
  const adm = makeClient(server.baseUrl, (await createTestUser({ roles: ["ADMIN"] })).token);
  const c = await adm.post(`/api/orders/${w.anchorId}/payments/${r.body.paymentId}/cancel`, { reason: "salah catat" });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.ok((await ambilAnak(w.groupId)).every((o) => o.paymentStatus === "BELUM_BAYAR" && !o.paidAt), "child B/C ikut kembali");
});

test("Audit #2: koreksi alokasi manual atas Payment Resi ditolak (409 ALOKASI_RESI_TERKUNCI) saat flag ON; alokasi tidak berubah", async () => {
  const w = await dunia();
  const r = await bayarResi(w, { tipe: "DP" });
  assert.equal(r.status, 201);
  const fin = makeClient(server.baseUrl, (await createTestUser({ roles: ["OWNER", "FINANCE"] })).token);
  const sebelum = await testPrisma.finPaymentAllocation.findMany({ where: { paymentId: r.body.paymentId }, orderBy: { orderId: "asc" } });
  const x = await fin.post(`/api/finance/customer-payments/${r.body.paymentId}/allocations`, { allocations: [{ orderId: w.anchorId, amount: DP }] });
  assert.equal(x.status, 409, JSON.stringify(x.body));
  assert.equal(x.body.code, "ALOKASI_RESI_TERKUNCI");
  const sesudah = await testPrisma.finPaymentAllocation.findMany({ where: { paymentId: r.body.paymentId }, orderBy: { orderId: "asc" } });
  assert.deepEqual(sesudah.map((a) => [a.orderId, String(a.amount)]), sebelum.map((a) => [a.orderId, String(a.amount)]));
});

test("Audit #3: Sales tidak bisa melunasi diam-diam Resi yang sedang diklaim Lunas (409 KLAIM_LUNAS_AKTIF); Resi tetap di antrean Finance", async () => {
  const w = await dunia();
  assert.equal((await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {}, kunci())).status, 201);
  const b = await bayarResi(w, { tipe: "TAGIHAN" });
  assert.equal(b.status, 409, JSON.stringify(b.body));
  assert.equal(b.body.code, "KLAIM_LUNAS_AKTIF");
  assert.equal(await testPrisma.payment.count(), 0);
  const q = await w.a.get("/api/finance/penerimaan/lunas-belum-dicatat");
  assert.equal(q.body.resi.length, 1);
});

test("Contoh angka 3 child (untuk laporan): DP → sisa → jurnal per child", async (t) => {
  const w = await dunia();
  const dp = await bayarResi(w, { tipe: "DP" });
  const pel = await bayarResi(w, { tipe: "TAGIHAN" });
  const { uangMuka } = await akunSistem();
  const jur = await jurnalBayar();
  const ringkas = jur.map((e) => e.lines.map((l) => `${angka(l.debit) > 0 ? "Dr Bank" : "Cr " + (l.accountId === uangMuka.id ? "Uang Muka" : "Piutang")} ${l.orderId ? "child" + (w.anak.indexOf(l.orderId) + 1) : ""} ${angka(l.debit) || angka(l.credit)}`));
  if (process.env.RESI_CONTOH) console.log(JSON.stringify({ tagihan: TAGIHAN, total: TOTAL, dpTarget: (await ambilAnak(w.groupId)).map((o) => o.dpTarget), dp: dp.body.alokasi.map((x) => x.jumlah), pelunasan: pel.body.alokasi.map((x) => x.jumlah), jurnal: ringkas }, null, 1));
  assert.equal(jur.length, 2);
  t.diagnostic("contoh angka tercetak bila RESI_CONTOH=1");
});
