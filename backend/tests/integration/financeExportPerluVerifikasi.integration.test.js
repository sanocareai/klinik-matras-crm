// HOTFIX EXPORT PEMBAYARAN & VERIFIKASI (1 Okt 2026) — tab "Perlu Verifikasi Finance" adalah ANTREAN GABUNGAN: workbook wajib berisi Ringkasan, Payment Menunggu, Klaim Lunas Sales,
// Definisi Angka (BUKAN sheet "Uang Masuk"). XLSX nyata di-parse ulang: tiap transaksi hanya di sheet yang sesuai; jumlah & total tiap sheet = payload layar; saringan dipertahankan;
// sheet kosong memuat pesan penjelasan. Fixture: 1 Payment menunggu, 1 klaim berbukti lengkap, 1 klaim tanpa bukti (klaim lama), 1 Payment terverifikasi, 1 Payment dibatalkan (+ tumpang tindih).
import "./setup/env.js";
import "./setup/klaimTmpEnv.js";
import "./setup/paymentProofsTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const PERIODE = { from: "2026-09-01", to: "2026-09-30" };
let seq = 0;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  await testPrisma.user.update({ where: { id: sales.user.id }, data: { name: "Kiki Sales" } });
  const order = async (nama, { value, ps = "BELUM_BAYAR", status = "READY", paidAt = null }) => {
    seq += 1;
    const c = await testPrisma.customer.create({ data: { name: nama, phone: `62814${String(seq).padStart(7, "0")}`, pipelineStage: "TRANSACTION", assignedSalesId: sales.user.id } });
    return testPrisma.order.create({ data: { customerId: c.id, orderNumber: `PV-${seq}`, category: "LAYANAN", status, value, paymentStatus: ps, paidAt } });
  };
  const bayar = (o, amount, tgl, { method = "TRANSFER", verif = false, batal = false } = {}) => testPrisma.payment.create({
    data: { orderId: o.id, amount, method, recordedById: sales.user.id, createdAt: new Date(tgl), ...(verif && { verifications: { create: { verifiedById: finance.user.id } } }), ...(batal && { cancelledAt: new Date(), cancelReason: "salah catat" }) },
  });
  return { admin, finance, sales, a: makeClient(server.baseUrl, admin.token), order, bayar };
}

/** Fixture lima transaksi + satu order tumpang tindih. */
async function fixture(w) {
  const oMenunggu = await w.order("Pelanggan Menunggu", { value: 1_000_000, ps: "DP" });
  const pMenunggu = await w.bayar(oMenunggu, 300_000, "2026-09-10T05:00:00Z");                       // 1 Payment MENUNGGU (TRANSFER)
  const oVerif = await w.order("Pelanggan Terverifikasi", { value: 800_000, ps: "LUNAS", paidAt: new Date("2026-09-11T05:00:00Z") });
  const pVerif = await w.bayar(oVerif, 800_000, "2026-09-11T05:00:00Z", { verif: true });           // 1 Payment TERVERIFIKASI
  const oBatal = await w.order("Pelanggan Dibatalkan", { value: 500_000, ps: "DP" });
  const pBatal = await w.bayar(oBatal, 123_000, "2026-09-12T05:00:00Z", { method: "CASH", batal: true }); // 1 Payment DIBATALKAN
  const oKlaim = await w.order("Pelanggan Klaim Lengkap", { value: 600_000 });
  const klaim = await testPrisma.orderPaymentClaim.create({ data: { orderId: oKlaim.id, status: "SUBMITTED", paymentDate: "2026-09-13", amount: 600_000, method: "TRANSFER", note: "transfer BCA", createdById: w.sales.user.id, submittedAt: new Date("2026-09-13T08:00:00Z"), submitCount: 1 } });
  await testPrisma.orderPaymentClaimEvidence.create({ data: { claimId: klaim.id, storedName: `bukti-${seq}.png`, originalName: "bukti.png", mimeType: "image/png", sizeBytes: 100, sha256: "a".repeat(64), uploadedById: w.sales.user.id } }); // 1 klaim LENGKAP
  const oLama = await w.order("Pelanggan Klaim Lama", { value: 400_000, ps: "LUNAS", status: "DELIVERED", paidAt: new Date("2026-09-14T05:00:00Z") }); // 1 klaim TANPA BUKTI (Lunas tanpa Payment)
  const oDiminta = await w.order("Pelanggan Bukti Diminta", { value: 450_000 });
  const kDiminta = await testPrisma.orderPaymentClaim.create({ data: { orderId: oDiminta.id, status: "EVIDENCE_REQUESTED", paymentDate: "2026-09-15", amount: 450_000, method: "TRANSFER", note: "x", createdById: w.sales.user.id, submittedAt: new Date("2026-09-15T08:00:00Z"), submitCount: 1, reviewReason: "foto kurang jelas", reviewedAt: new Date("2026-09-16T03:00:00Z") } });
  await testPrisma.orderPaymentClaimEvidence.create({ data: { claimId: kDiminta.id, storedName: `bukti-b${seq}.png`, originalName: "b.png", mimeType: "image/png", sizeBytes: 100, sha256: "b".repeat(64), uploadedById: w.sales.user.id } });
  // tumpang tindih: order Lunas (klaim lama) yang JUGA punya Payment menunggu 200.000 → satu pekerjaan Finance
  const oGanda = await w.order("Pelanggan Tumpang Tindih", { value: 700_000, ps: "LUNAS", status: "DELIVERED", paidAt: new Date("2026-09-17T05:00:00Z") });
  const pGanda = await w.bayar(oGanda, 200_000, "2026-09-17T05:00:00Z");
  return { oMenunggu, oVerif, oBatal, oKlaim, oLama, oDiminta, oGanda, pMenunggu, pVerif, pBatal, pGanda };
}

const nomorDi = (s) => s.baris.map((b) => b["No. Order"]);

test("TAB PERLU VERIFIKASI: sheet Ringkasan, Payment Menunggu, Klaim Lunas Sales, Definisi Angka — TANPA sheet 'Uang Masuk'; setiap transaksi hanya di sheet yang sesuai; jumlah & total = payload layar", async () => {
  const w = await dunia();
  const f = await fixture(w);
  const r = await unduhExport(server.baseUrl, w.admin.token, "pembayaran", { periode: PERIODE, filter: { status: "belum_verifikasi", sertakanKlaim: true, hanyaKlaim: false } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.wb.worksheets.map((s) => s.name), ["Ringkasan", "Payment Menunggu", "Klaim Lunas Sales", "Definisi Angka"]);
  assert.ok(!r.wb.getWorksheet("Uang Masuk"), "antrean gabungan BUKAN 'Uang Masuk'");

  // ── payload LAYAR (endpoint yang sama dipakai halaman) ──
  const layarPay = (await w.a.get(`/api/finance/customer-payments?from=${PERIODE.from}&to=${PERIODE.to}&status=belum_verifikasi`)).body.payments;
  const layarBerbukti = (await w.a.get("/api/finance/penerimaan/klaim-lunas")).body.items;
  const layarLama = (await w.a.get("/api/finance/penerimaan/lunas-belum-dicatat")).body.items;

  const sp = bacaSheet(r.wb, "Payment Menunggu");
  assert.equal(sp.baris.length, layarPay.length, "jumlah Payment menunggu = layar");
  assert.equal(sp.total["Nominal (Rp)"], layarPay.reduce((s, p) => s + p.amount, 0), "total nominal = layar");
  assert.deepEqual(new Set(nomorDi(sp)), new Set([f.oMenunggu.orderNumber, f.oGanda.orderNumber]));
  // Payment terverifikasi & dibatalkan TIDAK ada di antrean
  for (const o of [f.oVerif, f.oBatal]) assert.ok(!nomorDi(sp).includes(o.orderNumber), `${o.orderNumber} tidak boleh di Payment Menunggu`);

  const sk = bacaSheet(r.wb, "Klaim Lunas Sales");
  const orderKlaimLayar = new Set([...layarBerbukti.map((k) => k.order.orderNumber), ...layarLama.map((i) => i.orderNumber)]);
  assert.equal(sk.baris.length, orderKlaimLayar.size, "satu baris per order klaim (berbukti didahulukan, tanpa dobel)");
  assert.deepEqual(new Set(nomorDi(sk)), new Set([f.oKlaim.orderNumber, f.oLama.orderNumber, f.oDiminta.orderNumber, f.oGanda.orderNumber]));
  for (const o of [f.oMenunggu, f.oVerif, f.oBatal]) assert.ok(!nomorDi(sk).includes(o.orderNumber), `${o.orderNumber} bukan klaim`);
  const jenis = Object.fromEntries(sk.baris.map((b) => [b["No. Order"], b["Jenis"]]));
  assert.match(jenis[f.oKlaim.orderNumber], /Klaim berbukti — menunggu verifikasi/);
  assert.match(jenis[f.oDiminta.orderNumber], /bukti diminta/);
  assert.match(jenis[f.oLama.orderNumber], /Klaim lama/);
  const bukti = Object.fromEntries(sk.baris.map((b) => [b["No. Order"], b["Bukti"]]));
  assert.equal(bukti[f.oKlaim.orderNumber], "Ada"); assert.equal(bukti[f.oLama.orderNumber], "Belum lengkap");
  assert.equal(sk.total["Perlu Dicek (Rp)"], 600_000 + 450_000 + 400_000 + sk.baris.find((b) => b["No. Order"] === f.oGanda.orderNumber)["Perlu Dicek (Rp)"]);

  // ── Ringkasan: angka dari fungsi yang sama, tanpa hitung ganda ──
  const rg = bacaSheet(r.wb, "Ringkasan");
  const baris = (u) => rg.baris.find((x) => String(x["Keterangan"]).trim().startsWith(u));
  const nominalGanda = sk.baris.find((b) => b["No. Order"] === f.oGanda.orderNumber)["Perlu Dicek (Rp)"];
  assert.equal(baris("Payment menunggu verifikasi")["Jumlah"], 2); assert.equal(baris("Payment menunggu verifikasi")["Nominal (Rp)"], 500_000);
  assert.equal(baris("Klaim Lunas Sales (jumlah)")["Jumlah"], 4); assert.equal(baris("Klaim Lunas Sales (jumlah)")["Nominal (Rp)"], 600_000 + 450_000 + 400_000 + nominalGanda);
  assert.equal(baris("— klaim berbukti menunggu verifikasi")["Jumlah"], 1);
  assert.equal(baris("— klaim berbukti, bukti diminta")["Jumlah"], 1); assert.equal(baris("— klaim berbukti, bukti diminta")["Nominal (Rp)"], 450_000);
  assert.equal(baris("— klaim lama, bukti belum lengkap")["Jumlah"], 2);
  assert.equal(baris("Bukti belum lengkap (ringkas)")["Jumlah"], 2);
  assert.equal(baris("Bukti diminta (ringkas)")["Jumlah"], 1);
  const tumpang = baris("Dikurangi")["Jumlah"]; assert.equal(tumpang, -1);
  assert.equal(baris("Dikurangi")["Nominal (Rp)"], -200_000, "min(Payment menunggu 200.000, klaim) — nominal yang sama tidak dihitung dua kali");
  const total = rg.total; // baris "TOTAL ANTREAN…" dikenali sebagai baris total oleh pembaca sheet
  assert.match(String(Object.values(total)[0]), /^TOTAL ANTREAN/);
  assert.equal(total["Jumlah"], 2 + 4 - 1);
  assert.equal(total["Nominal (Rp)"], 500_000 + (600_000 + 450_000 + 400_000 + nominalGanda) - 200_000);
  // identitas: total = Payment menunggu + klaim − tumpang tindih
  assert.equal(total["Jumlah"], baris("Payment menunggu verifikasi")["Jumlah"] + baris("Klaim Lunas Sales (jumlah)")["Jumlah"] + tumpang);
  // Definisi Angka + metadata
  assert.ok(r.wb.getWorksheet("Definisi Angka").rowCount >= 7);
  // Antrean "Perlu Verifikasi" TIDAK terikat periode (6 Okt 2026): label menyatakan semua periode, bukan rentang yang dikirim klien.
  assert.match(String(sp.kepala[1]), /Semua periode/);
  assert.match(String(r.wb.getWorksheet("Payment Menunggu").getRow(5).getCell(1).value), /Zona waktu: WIB/);
});

test("TIAP TAB: Uang Masuk Terverifikasi / Dibatalkan / Semua = persis payload layar (jumlah & total); transaksi hanya di tab yang sesuai", async () => {
  const w = await dunia();
  const f = await fixture(w);
  const layar = async (status) => (await w.a.get(`/api/finance/customer-payments?from=${PERIODE.from}&to=${PERIODE.to}&status=${status}`)).body.payments;
  for (const [status, ekspektasi] of [["terverifikasi", [f.oVerif.orderNumber]], ["dibatalkan", [f.oBatal.orderNumber]], ["", [f.oMenunggu.orderNumber, f.oVerif.orderNumber, f.oBatal.orderNumber, f.oGanda.orderNumber]]]) {
    const r = await unduhExport(server.baseUrl, w.admin.token, "pembayaran", { periode: PERIODE, filter: { status } });
    const s = bacaSheet(r.wb, "Uang Masuk");
    const ly = await layar(status);
    assert.equal(s.baris.length, ly.length, `tab '${status || "semua"}': jumlah baris`);
    assert.equal(s.total["Nominal (Rp)"], ly.filter((p) => !p.cancelledAt).reduce((a, p) => a + p.amount, 0), `tab '${status || "semua"}': total aktif`);
    assert.deepEqual(new Set(nomorDi(s)), new Set(ekspektasi), `tab '${status || "semua"}': transaksi yang sesuai`);
    assert.ok(r.wb.getWorksheet("Definisi Angka"));
    assert.ok(!r.wb.getWorksheet("Klaim Lunas Sales"), "tab pembayaran biasa tidak membawa sheet klaim");
  }
  // tab Klaim Lunas dari Sales: hanya klaim (+ definisi), tanpa periode
  const k = await unduhExport(server.baseUrl, w.admin.token, "pembayaran", { filter: { hanyaKlaim: true } });
  assert.deepEqual(k.wb.worksheets.map((x) => x.name), ["Klaim Lunas Sales", "Definisi Angka"]);
  assert.equal(bacaSheet(k.wb, "Klaim Lunas Sales").baris.length, 4);
});

test("SARINGAN dipertahankan di antrean: cara bayar, pencarian, chip bukti, alokasi, rekening — Payment Menunggu mengikuti; klaim tidak ikut saringan Payment", async () => {
  const w = await dunia();
  const f = await fixture(w);
  const ekspor = async (filter) => bacaSheet((await unduhExport(server.baseUrl, w.admin.token, "pembayaran", { periode: PERIODE, filter: { status: "belum_verifikasi", sertakanKlaim: true, hanyaKlaim: false, ...filter } })).wb, "Payment Menunggu");
  assert.equal((await ekspor({ metode: "CASH" })).baris.length, 0, "tidak ada Payment CASH yang menunggu");
  assert.equal((await ekspor({ metode: "TRANSFER" })).baris.length, 2);
  const cari = await ekspor({ q: "Menunggu" });
  assert.deepEqual(nomorDi(cari), [f.oMenunggu.orderNumber]);
  assert.deepEqual(nomorDi(await ekspor({ q: "300.000" })), [f.oMenunggu.orderNumber], "pencarian nominal bertitik ribuan");
  assert.equal((await ekspor({ bukti: "ada" })).baris.length, 0); assert.equal((await ekspor({ bukti: "tanpa" })).baris.length, 2);
  assert.equal((await ekspor({ alokasi: "ada" })).baris.length, 0);
  // klaim tidak terpengaruh saringan Payment
  const r = await unduhExport(server.baseUrl, w.admin.token, "pembayaran", { periode: PERIODE, filter: { status: "belum_verifikasi", sertakanKlaim: true, hanyaKlaim: false, metode: "CASH" } });
  assert.equal(bacaSheet(r.wb, "Klaim Lunas Sales").baris.length, 4);
  // periode lain → antrean TIDAK terikat periode: Payment menunggu (dari September) dan klaim tetap ikut — sama persis dengan periode September
  const okt = await unduhExport(server.baseUrl, w.admin.token, "pembayaran", { periode: { from: "2026-10-01", to: "2026-10-31" }, filter: { status: "belum_verifikasi", sertakanKlaim: true, hanyaKlaim: false } });
  const sep = await unduhExport(server.baseUrl, w.admin.token, "pembayaran", { periode: PERIODE, filter: { status: "belum_verifikasi", sertakanKlaim: true, hanyaKlaim: false } });
  assert.equal(bacaSheet(okt.wb, "Payment Menunggu").baris.length, bacaSheet(sep.wb, "Payment Menunggu").baris.length);
  assert.ok(bacaSheet(okt.wb, "Payment Menunggu").baris.length > 0);
  assert.equal(bacaSheet(okt.wb, "Klaim Lunas Sales").baris.length, 4);
});

test("SHEET KOSONG memuat 'Tidak ada data sesuai periode dan filter' (bukan tabel kosong tanpa penjelasan); antrean kosong seluruhnya tetap berisi 4 sheet", async () => {
  const w = await dunia();
  const r = await unduhExport(server.baseUrl, w.admin.token, "pembayaran", { periode: PERIODE, filter: { status: "belum_verifikasi", sertakanKlaim: true, hanyaKlaim: false } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.wb.worksheets.map((s) => s.name), ["Ringkasan", "Payment Menunggu", "Klaim Lunas Sales", "Definisi Angka"]);
  for (const nama of ["Payment Menunggu", "Klaim Lunas Sales"]) {
    const ws = r.wb.getWorksheet(nama);
    assert.equal(String(ws.getRow(7).getCell(1).value), "Tidak ada data sesuai periode dan filter", nama);
    assert.equal(bacaSheet(r.wb, nama).baris.length, 0);
  }
  const rg = bacaSheet(r.wb, "Ringkasan");
  assert.equal(rg.total["Jumlah"], 0);
  const semua = await unduhExport(server.baseUrl, w.admin.token, "pembayaran", { periode: PERIODE, filter: { status: "" } });
  assert.equal(String(semua.wb.getWorksheet("Uang Masuk").getRow(7).getCell(1).value), "Tidak ada data sesuai periode dan filter");
});

test("Klaim Lunas dari Sales tanpa izin Payment: Finance dapat; Sales 403 — antrean gabungan tidak membuka data ke peran tanpa izin", async () => {
  const w = await dunia();
  await fixture(w);
  const sales = await unduhExport(server.baseUrl, w.sales.token, "pembayaran", { periode: PERIODE, filter: { status: "belum_verifikasi", sertakanKlaim: true } });
  assert.equal(sales.status, 403);
  const fin = await unduhExport(server.baseUrl, w.finance.token, "pembayaran", { periode: PERIODE, filter: { status: "belum_verifikasi", sertakanKlaim: true } });
  assert.equal(fin.status, 200);
  assert.ok(fin.wb.getWorksheet("Klaim Lunas Sales"));
});
