// EXPORT EXCEL FINANCE — PEMBAYARAN & VERIFIKASI (B3.9). Yang dikunci: berkas = data yang SAMA dengan layar
// (GET /customer-payments & GET /penerimaan/lunas-belum-dicatat): baris, urutan, nominal (ANGKA), total, ringkasan kartu; filter status
// & periode diikuti; mode `ids` (baris yang tampil setelah filter sisi-klien) menghormati urutan layar; batas hari WIB; izin (SALES 403,
// tanpa login 401); kolom sensitif hanya untuk Admin Keuangan; formula dinetralkan.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const PERIODE = { from: "2026-09-01", to: "2026-09-30" };
const QS = "from=2026-09-01&to=2026-09-30";
let n = 0;

async function buatOrder(nama) {
  const customer = await testPrisma.customer.create({ data: { name: nama } });
  return testPrisma.order.create({
    data: { customerId: customer.id, value: 2_000_000, category: "LAYANAN", orderNumber: `SAN-X-${String(++n).padStart(3, "0")}`, status: "DELIVERED", paymentStatus: "BELUM_BAYAR" },
  });
}

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "SANOBANK Kemal", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const a = makeClient(server.baseUrl, admin.token);
  const oA = await buatOrder("Ibu Erni");
  const oB = await buatOrder("Pak Budi");
  const oC = await buatOrder("Bu Sari");
  const bayar = (order, data) => testPrisma.payment.create({ data: { orderId: order.id, recordedById: sales.user.id, ...data } });
  // P1 terverifikasi (dengan catatan berawalan "=" untuk uji formula), P2 menunggu, P3 dibatalkan, P4 tepat di batas WIB, P5 dibagi 2 order.
  const p1 = await bayar(oA, { amount: 400_000, method: "TRANSFER", cashAccountId: bank.id, createdAt: new Date("2026-09-10T03:00:00Z"), proofPhotoUrl: "/media/payment-proofs/bukti-1.jpg", referenceNumber: "REF-001", notes: "=CATATAN RAHASIA", internalNote: "catatan internal finance" });
  await testPrisma.paymentVerification.create({ data: { paymentId: p1.id, verifiedById: admin.user.id } });
  const p2 = await bayar(oB, { amount: 250_000, method: "CASH", createdAt: new Date("2026-09-12T05:00:00Z") });
  const p3 = await bayar(oC, { amount: 100_000, method: "QRIS", createdAt: new Date("2026-09-15T05:00:00Z"), cancelledAt: new Date("2026-09-16T05:00:00Z"), cancelledById: admin.user.id, cancelReason: "salah input" });
  const p4 = await bayar(oA, { amount: 50_000, method: "TRANSFER", cashAccountId: bank.id, createdAt: new Date("2026-09-05T20:00:00Z") }); // 6 Sep 03:00 WIB
  const p5 = await bayar(oB, { amount: 300_000, method: "TRANSFER", cashAccountId: bank.id, createdAt: new Date("2026-09-20T05:00:00Z") });
  const alok = await a.post(`/api/finance/customer-payments/${p5.id}/allocations`, { allocations: [{ orderId: oB.id, amount: 100_000 }, { orderId: oC.id, amount: 200_000 }] });
  assert.equal(alok.status, 200, JSON.stringify(alok.body));
  return { bank, admin, finance, sales, a, oA, oB, oC, p1, p2, p3, p4, p5 };
}

const layar = async (a, status = "") => (await a.get(`/api/finance/customer-payments?${QS}${status ? `&status=${status}` : ""}`)).body.payments;

test("Berkas = data layar untuk tiap tab status: baris, urutan, nominal (ANGKA), status, total aktif, kepala; ringkasan = kartu layar", async () => {
  const c = await siapkan();
  for (const status of ["belum_verifikasi", "terverifikasi", "dibatalkan", ""]) {
    const rows = await layar(c.a, status);
    const r = await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: PERIODE, filter: { status }, filterLabel: `Tab: ${status || "Semua"}` });
    assert.equal(r.status, 200, `status=${status}`);
    const s = bacaSheet(r.wb, "Uang Masuk");
    assert.equal(s.baris.length, rows.length, `jumlah baris status=${status}`);
    assert.deepEqual(s.baris.map((b) => b["Nominal (Rp)"]), rows.map((p) => p.amount), `urutan & nominal status=${status}`);
    assert.deepEqual(s.baris.map((b) => b["No. Order"]), rows.map((p) => p.order.orderNumber));
    for (const b of s.baris) assert.equal(typeof b["Nominal (Rp)"], "number");
    const aktif = rows.filter((p) => !p.cancelledAt);
    assert.equal(s.total["Nominal (Rp)"], aktif.reduce((x, p) => x + p.amount, 0), `total aktif status=${status}`);
    assert.match(String(s.total["Tanggal & Jam Dicatat"]), new RegExp(`^TOTAL aktif \\(${aktif.length} pembayaran\\)`));
    assert.match(s.kepala[2], /Filter: Tab:/);
    assert.match(s.kepala[1], /Periode: 1 Sep 2026 – 30 Sep 2026/);
  }
  const r = await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: PERIODE, filter: { status: "belum_verifikasi" } });
  assert.match(r.headers.get("content-disposition"), /filename="Finance_Pembayaran_Verifikasi_2026-09-01_sd_2026-09-30\.xlsx"/);
  const s = bacaSheet(r.wb, "Uang Masuk");
  const p2 = s.baris.find((b) => b["No. Order"] === c.oB.orderNumber && b["Nominal (Rp)"] === 250_000);
  assert.equal(p2["Status"], "Menunggu");
  assert.equal(p2["Cara Bayar"], "Tunai");
  assert.equal(p2["Masuk ke Rekening"], "belum dipilih");
  assert.equal(p2["Untuk Order"], "order ini saja");
  assert.equal(p2["Dibagi ke Beberapa Order"], "Tidak");
  const p5 = s.baris.find((b) => b["Nominal (Rp)"] === 300_000);
  assert.equal(p5["Dibagi ke Beberapa Order"], "Ya");
  assert.match(p5["Untuk Order"], new RegExp(`${c.oB.orderNumber}: Rp100\\.000; ${c.oC.orderNumber}: Rp200\\.000|${c.oC.orderNumber}: Rp200\\.000; ${c.oB.orderNumber}: Rp100\\.000`));

  // Sheet Ringkasan = tiga kartu layar (seluruh periode, apa pun tab, pembayaran dibatalkan tidak dihitung).
  const semua = (await layar(c.a, "")).filter((p) => !p.cancelledAt);
  const sudah = semua.filter((p) => p.terverifikasi);
  const belum = semua.filter((p) => !p.terverifikasi);
  const jumlah = (arr) => arr.reduce((x, p) => x + p.amount, 0);
  // Dibaca mentah: bacaSheet menganggap baris berawalan "TOTAL" sebagai baris total, padahal "Total Uang Masuk" di sini baris data biasa.
  const ws = r.wb.getWorksheet("Ringkasan");
  const baris = {};
  for (let i = 7; i <= 9; i++) baris[ws.getCell(`A${i}`).value] = { "Jumlah Pembayaran": ws.getCell(`B${i}`).value, "Nominal (Rp)": ws.getCell(`C${i}`).value };
  assert.equal(ws.getCell("A6").value, "Keterangan");
  assert.equal(baris["Total Uang Masuk (periode ini)"]["Nominal (Rp)"], jumlah(semua));
  assert.equal(baris["Total Uang Masuk (periode ini)"]["Jumlah Pembayaran"], semua.length);
  assert.equal(baris["Menunggu Verifikasi"]["Nominal (Rp)"], jumlah(belum));
  assert.equal(baris["Sudah Diverifikasi"]["Nominal (Rp)"], jumlah(sudah));
  assert.equal(baris["Sudah Diverifikasi"]["Jumlah Pembayaran"], sudah.length);
});

test("Mode ids (baris yang tampil setelah filter klien): urutan ids dihormati; id di luar status/periode dibuang; ids kosong = berkas valid tanpa baris; id sampah tidak menjatuhkan server", async () => {
  const c = await siapkan();
  const r = await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: PERIODE, filter: { status: "" }, ids: [c.p5.id, c.p1.id, c.p2.id] });
  assert.deepEqual(bacaSheet(r.wb, "Uang Masuk").baris.map((b) => b["Nominal (Rp)"]), [300_000, 400_000, 250_000], "urutan mengikuti ids");
  const dibatasi = await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: PERIODE, filter: { status: "belum_verifikasi" }, ids: [c.p1.id, c.p3.id, c.p2.id] });
  assert.deepEqual(bacaSheet(dibatasi.wb, "Uang Masuk").baris.map((b) => b["Nominal (Rp)"]), [250_000], "p1 terverifikasi & p3 dibatalkan bukan bagian tab menunggu");
  const kosong = await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: PERIODE, filter: { status: "" }, ids: [] });
  assert.equal(kosong.status, 200);
  assert.equal(bacaSheet(kosong.wb, "Uang Masuk").baris.length, 0);
  const sampah = await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: PERIODE, ids: ["bukan-uuid", "'; DROP TABLE payments;--", c.p2.id] });
  assert.equal(sampah.status, 200);
  assert.deepEqual(bacaSheet(sampah.wb, "Uang Masuk").baris.map((b) => b["Nominal (Rp)"]), [250_000]);
  assert.equal((await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { ids: "bukan-array" })).status, 400);
});

test("Batas hari WIB: pembayaran 6 Sep 03:00 WIB (5 Sep 20:00 UTC) masuk periode yang mulai 6 Sep dan TIDAK masuk periode yang berakhir 5 Sep — layar & berkas sepakat; jam di sel = WIB", async () => {
  const c = await siapkan();
  const dari6 = { from: "2026-09-06", to: "2026-09-06" };
  const s6 = bacaSheet((await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: dari6 })).wb, "Uang Masuk");
  const l6 = (await c.a.get("/api/finance/customer-payments?from=2026-09-06&to=2026-09-06")).body.payments;
  assert.deepEqual(l6.map((p) => p.amount), [50_000]);
  assert.deepEqual(s6.baris.map((b) => b["Nominal (Rp)"]), [50_000]);
  const waktu = s6.baris[0]["Tanggal & Jam Dicatat"];
  assert.ok(waktu instanceof Date);
  assert.equal(waktu.toISOString().slice(0, 16), "2026-09-06T03:00", "sel menampilkan jam dinding WIB");
  const sampai5 = { from: "2026-09-05", to: "2026-09-05" };
  const s5 = bacaSheet((await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: sampai5 })).wb, "Uang Masuk");
  const l5 = (await c.a.get("/api/finance/customer-payments?from=2026-09-05&to=2026-09-05")).body.payments;
  assert.equal(l5.length, 0);
  assert.equal(s5.baris.length, 0);
});

test("Izin: tanpa login 401; SALES 403 (sama dengan layar); FINANCE boleh tetapi kolom sensitif TIDAK ikut; ADMIN mendapat kolomnya; formula dinetralkan; angka bertipe number", async () => {
  const c = await siapkan();
  assert.equal((await unduhExport(server.baseUrl, null, "pembayaran")).status, 401);
  assert.equal((await unduhExport(server.baseUrl, c.sales.token, "pembayaran", { periode: PERIODE })).status, 403);
  assert.equal((await makeClient(server.baseUrl, c.sales.token).get(`/api/finance/customer-payments?${QS}`)).status, 403);
  assert.equal((await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: { from: "2026-13-45" } })).status, 400);

  const fin = await unduhExport(server.baseUrl, c.finance.token, "pembayaran", { periode: PERIODE });
  assert.equal(fin.status, 200);
  const sf = bacaSheet(fin.wb, "Uang Masuk");
  for (const h of ["Catatan", "Catatan Internal", "Tautan Foto Bukti", "No. Referensi", "Alasan Pembatalan"]) assert.ok(!sf.header.includes(h), `FINANCE tidak boleh melihat kolom ${h}`);
  assert.ok(sf.header.includes("Foto Bukti"), "penanda ada/tidaknya foto bukan sensitif");

  const adm = await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: PERIODE });
  const sa = bacaSheet(adm.wb, "Uang Masuk");
  for (const h of ["Catatan", "Catatan Internal", "Tautan Foto Bukti", "No. Referensi", "Alasan Pembatalan"]) assert.ok(sa.header.includes(h), `ADMIN melihat kolom ${h}`);
  const b1 = sa.baris.find((b) => b["Nominal (Rp)"] === 400_000);
  assert.equal(b1["Catatan"], "'=CATATAN RAHASIA", "catatan berawalan = dinetralkan");
  assert.equal(b1["Catatan Internal"], "catatan internal finance");
  assert.equal(b1["Tautan Foto Bukti"], "/media/payment-proofs/bukti-1.jpg");
  assert.equal(b1["No. Referensi"], "REF-001");
  assert.equal(b1["Status"], "Sudah diverifikasi");
  assert.equal(b1["Diverifikasi Oleh"], c.admin.user.name);
  assert.ok(b1["Tanggal & Jam Verifikasi"] instanceof Date);
  assert.equal(b1["Foto Bukti"], "Ada");
  assert.equal(b1["Cara Bayar"], "Transfer");
  assert.equal(b1["Masuk ke Rekening"], "SANOBANK Kemal");
  const b3 = sa.baris.find((b) => b["Nominal (Rp)"] === 100_000);
  assert.equal(b3["Status"], "Dibatalkan");
  assert.equal(b3["Alasan Pembatalan"], "salah input");
  assert.equal(b3["Dibatalkan Oleh"], c.admin.user.name);
});

test("Klaim Lunas dari Sales: sheet ikut di tab Perlu Verifikasi & tab Klaim (daftar sama dengan layar, klaimIds = baris yang tampil); hanyaKlaim tanpa daftar pembayaran & tanpa periode", async () => {
  const c = await siapkan();
  const buatKlaim = async (nama, value) => {
    const customer = await testPrisma.customer.create({ data: { name: nama, assignedSalesId: c.sales.user.id } });
    const order = await testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `KLM-${++n}`, status: "DELIVERED", paymentStatus: "LUNAS", paidAt: new Date() } });
    await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: c.admin.user.id }));
    return order;
  };
  const k1 = await buatKlaim("Klaim Satu", 1_100_000);
  const k2 = await buatKlaim("Klaim Dua", 2_200_000);
  const layarKlaim = (await c.a.get("/api/finance/penerimaan/lunas-belum-dicatat")).body;
  assert.equal(layarKlaim.items.length, 2);

  const r = await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: PERIODE, ids: [], filter: { status: "belum_verifikasi", sertakanKlaim: true, hanyaKlaim: false } });
  const sk = bacaSheet(r.wb, "Klaim Lunas Sales");
  assert.equal(sk.baris.length, 2);
  assert.deepEqual(sk.baris.map((b) => b["No. Order"]), layarKlaim.items.map((i) => i.orderNumber), "urutan = layar");
  assert.deepEqual(sk.baris.map((b) => b["Perlu Dicek (Rp)"]), layarKlaim.items.map((i) => i.sisa));
  assert.equal(sk.total["Perlu Dicek (Rp)"], layarKlaim.semua.total);
  assert.equal(sk.baris[0]["Sales"], c.sales.user.name);
  assert.equal(typeof sk.baris[0]["Nilai Order (Rp)"], "number");

  const sebagian = await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: PERIODE, filter: { sertakanKlaim: true, klaimIds: [k2.id] } });
  assert.deepEqual(bacaSheet(sebagian.wb, "Klaim Lunas Sales").baris.map((b) => b["No. Order"]), [k2.orderNumber]);
  assert.equal(bacaSheet(sebagian.wb, "Klaim Lunas Sales").total["Perlu Dicek (Rp)"], 2_200_000);

  const hanya = await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { filter: { hanyaKlaim: true, klaimIds: [k1.id] } });
  assert.equal(hanya.status, 200);
  assert.deepEqual(hanya.wb.worksheets.map((w) => w.name), ["Klaim Lunas Sales"], "tanpa daftar pembayaran");
  assert.deepEqual(bacaSheet(hanya.wb, "Klaim Lunas Sales").baris.map((b) => b["No. Order"]), [k1.orderNumber]);
  assert.match(bacaSheet(hanya.wb, "Klaim Lunas Sales").kepala[1], /tidak terikat periode/);
  assert.match(hanya.headers.get("content-disposition"), /Finance_Pembayaran_Verifikasi_per_\d{4}-\d{2}-\d{2}\.xlsx/);

  const tanpa = await unduhExport(server.baseUrl, c.admin.token, "pembayaran", { periode: PERIODE });
  assert.ok(!tanpa.wb.getWorksheet("Klaim Lunas Sales"), "tab lain tidak membawa sheet klaim");
});
