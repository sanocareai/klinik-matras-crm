// KLAIM LUNAS SALES (1 Okt 2026) — gerbang "Lunas": Sales mengajukan klaim berbukti, Finance memverifikasi, status dihitung dari ledger.
// Memanggil endpoint ASLI lewat testApp (sama dengan yang dipakai web & aplikasi). Fokus: server menolak yang tidak lengkap walau UI dilewati,
// klaim tidak menyentuh uang, Payment tepat satu kali, akses berkas, dan perlindungan upload.

import "./setup/env.js";
import fs from "node:fs";
import path from "node:path";
import { TMP_KLAIM_DIR as TMP_KLAIM } from "./setup/klaimTmpEnv.js";
import "./setup/paymentProofsTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { signFile } from "../../src/lib/mediaSigning.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

// ── bahan ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("bukti-transfer-satu-".repeat(10))]);
const PNG2 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("bukti-transfer-dua--".repeat(10))]);
const PDF = Buffer.from("%PDF-1.4\n% bukti pembayaran\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const HTML = Buffer.from("<html><script>alert(1)</script></html>".padEnd(40, " "));

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findFirst({ where: { systemKey: "BANK" } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "PT Sano - BCA", kind: "BANK", accountId: akunBank.id } });
  const sales = await createTestUser({ roles: ["SALES"] });
  const sales2 = await createTestUser({ roles: ["SALES"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const cSales = makeClient(server.baseUrl, sales.token);
  const cSales2 = makeClient(server.baseUrl, sales2.token);
  const cFin = makeClient(server.baseUrl, finance.token);
  const cAdmin = makeClient(server.baseUrl, admin.token);
  const cDriver = makeClient(server.baseUrl, driver.token);
  return { bank, sales, sales2, finance, admin, driver, cSales, cSales2, cFin, cAdmin, cDriver };
}

async function buatOrder({ value = 1_000_000, paymentStatus = "BELUM_BAYAR", paidAt = null, sales = null } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Susi", assignedSalesId: sales?.user?.id || null } });
  return testPrisma.order.create({
    data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `RES-${Math.random().toString(36).slice(2, 8)}`, status: "PENDING", paymentStatus, paidAt },
  });
}

async function unggah(token, claimId, isi, { nama = "bukti.png", tipe = "image/png", bidang = "berkas" } = {}) {
  const fd = new FormData();
  fd.append(bidang, new Blob([isi], { type: tipe }), nama);
  const res = await fetch(`${server.baseUrl}/api/klaim-lunas/${claimId}/bukti`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  let body = null; try { body = await res.json(); } catch { /* kosong */ }
  return { status: res.status, body };
}

const hariIni = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const LENGKAP = (bank, extra = {}) => ({ paymentDate: hariIni(), amount: 1_000_000, method: "TRANSFER", cashAccountId: bank.id, note: "Transfer BCA atas nama Susi, dicek di mutasi", ...extra });

/** Sales lengkapi semua kecuali mengajukan. */
async function klaimSiap(w, order, extra = {}) {
  const d = await w.cSales.post(`/api/klaim-lunas/order/${order.id}`, LENGKAP(w.bank, extra));
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const id = d.body.klaim.id;
  const u = await unggah(w.sales.token, id, PNG);
  assert.equal(u.status, 201, JSON.stringify(u.body));
  return id;
}

async function fotoKeuangan() {
  const [pay, jurnal, baris] = await Promise.all([testPrisma.payment.count(), testPrisma.finJournalEntry.count(), testPrisma.finJournalLine.count()]);
  return { pay, jurnal, baris };
}

// ── gerbang pengajuan ──────────────────────────────────────────────────────────────────────────────────────────────

test("Draft tanpa bukti & tanpa catatan BOLEH disimpan, tetapi server menolak pengajuannya (422 + daftar kekurangan) — walau UI dilewati", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const d = await w.cSales.post(`/api/klaim-lunas/order/${order.id}`, { amount: 500_000 });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.equal(d.body.klaim.status, "DRAFT");
  const id = d.body.klaim.id;

  const a = await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});
  assert.equal(a.status, 422);
  assert.equal(a.body.code, "KLAIM_TIDAK_LENGKAP");
  const medan = a.body.kekurangan.map((k) => k.field).sort();
  assert.deepEqual(medan, ["evidence", "method", "note", "paymentDate"], "kekurangan dilaporkan");
  assert.ok(a.body.kekurangan.some((k) => k.field === "evidence"), "bukti wajib");
  assert.ok(a.body.kekurangan.some((k) => k.field === "note"), "catatan wajib");
  assert.equal((await testPrisma.orderPaymentClaim.findUnique({ where: { id } })).status, "DRAFT", "tetap draft");
});

test("Hanya bukti kurang / hanya catatan kurang: masing-masing ditolak server", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  // lengkap tetapi TANPA bukti
  const d1 = (await w.cSales.post(`/api/klaim-lunas/order/${order.id}`, LENGKAP(w.bank))).body.klaim;
  const tanpaBukti = await w.cSales.post(`/api/klaim-lunas/${d1.id}/ajukan`, {});
  assert.equal(tanpaBukti.status, 422);
  assert.deepEqual(tanpaBukti.body.kekurangan.map((k) => k.field), ["evidence"]);
  // ada bukti tetapi catatan dikosongkan
  await unggah(w.sales.token, d1.id, PNG);
  await w.cSales.patch(`/api/klaim-lunas/${d1.id}`, { note: "   " });
  const tanpaCatatan = await w.cSales.post(`/api/klaim-lunas/${d1.id}/ajukan`, {});
  assert.equal(tanpaCatatan.status, 422);
  assert.deepEqual(tanpaCatatan.body.kekurangan.map((k) => k.field), ["note"]);
  // Transfer tanpa rekening
  await w.cSales.patch(`/api/klaim-lunas/${d1.id}`, { note: "ada catatan", cashAccountId: null });
  const tanpaRekening = await w.cSales.post(`/api/klaim-lunas/${d1.id}/ajukan`, {});
  assert.equal(tanpaRekening.status, 422);
  assert.deepEqual(tanpaRekening.body.kekurangan.map((k) => k.field), ["cashAccountId"]);
});

test("Bukti yang berkasnya hilang dari disk (upload tidak tersimpan) tidak bisa diajukan", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const id = await klaimSiap(w, order);
  const e = await testPrisma.orderPaymentClaimEvidence.findFirst({ where: { claimId: id } });
  fs.unlinkSync(path.join(TMP_KLAIM, e.storedName));
  const a = await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});
  assert.equal(a.status, 422);
  assert.ok(a.body.kekurangan.some((k) => k.field === "evidence"));
});

test("Nominal melebihi sisa tagihan / tanggal masa depan / metode & nominal tidak valid ditolak server", async () => {
  const w = await dunia();
  const order = await buatOrder({ value: 1_000_000, sales: w.sales });
  assert.equal((await w.cSales.post(`/api/klaim-lunas/order/${order.id}`, { amount: -5 })).status, 400);
  assert.equal((await w.cSales.post(`/api/klaim-lunas/order/${order.id}`, { amount: 1.5 })).status, 400);
  assert.equal((await w.cSales.post(`/api/klaim-lunas/order/${order.id}`, { method: "BITCOIN" })).status, 400);
  assert.equal((await w.cSales.post(`/api/klaim-lunas/order/${order.id}`, { paymentDate: "2099-01-01" })).status, 400);
  const id = await klaimSiap(w, order, { amount: 1_500_000 });
  const a = await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});
  assert.equal(a.status, 422);
  assert.equal(a.body.code, "NOMINAL_MELEBIHI_SISA");
});

// ── klaim tidak menyentuh uang ─────────────────────────────────────────────────────────────────────────────────────

test("Pengajuan klaim TIDAK mengubah paymentStatus, paidAt, Payment, jurnal, saldo, maupun piutang; double-click ajukan idempoten", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const sebelum = await fotoKeuangan();
  const id = await klaimSiap(w, order);

  const [a1, a2] = await Promise.all([w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {}), w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {})]);
  assert.ok([a1.status, a2.status].every((s) => s === 200 || s === 201), `kedua ajukan sukses/idempoten: ${a1.status} ${a2.status}`);
  assert.ok(a1.body.diulang || a2.body.diulang, "salah satunya dijawab sebagai pengulangan");
  const k = await testPrisma.orderPaymentClaim.findUnique({ where: { id } });
  assert.equal(k.status, "SUBMITTED");
  assert.equal(k.submitCount, 1, "tepat satu pengajuan tercatat");

  const o = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o.paymentStatus, "BELUM_BAYAR");
  assert.equal(o.paidAt, null);
  assert.deepEqual(await fotoKeuangan(), sebelum, "tidak ada Payment/jurnal baru");
  const audit = await testPrisma.activityEvent.findMany({ where: { entityId: order.id, eventType: "KLAIM_LUNAS" } });
  assert.ok(audit.some((e) => e.metadata?.aksi === "diajukan"), "jejak audit pengajuan");

  // sudah diajukan → tidak bisa diedit / ditambah bukti
  assert.equal((await w.cSales.patch(`/api/klaim-lunas/${id}`, { note: "ubah diam-diam" })).status, 409);
  assert.equal((await unggah(w.sales.token, id, PNG2)).status, 409);
});

test("Order yang SUDAH berstatus Lunas (cara lama) tanpa Payment: tampil 'Bukti belum lengkap', TIDAK dibuatkan Payment otomatis", async () => {
  const w = await dunia();
  const order = await buatOrder({ paymentStatus: "LUNAS", paidAt: new Date("2026-09-25T03:00:00Z"), sales: w.sales });
  const sebelum = await fotoKeuangan();
  const info = await w.cSales.get(`/api/klaim-lunas/order/${order.id}`);
  assert.equal(info.status, 200);
  assert.equal(info.body.buktiBelumLengkap, true);
  assert.equal(info.body.bolehDiklaim, true);
  assert.deepEqual(await fotoKeuangan(), sebelum);
});

// ── Finance ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("Finance Verifikasi: tepat SATU Payment (paralel → satu berhasil, satu 409), bukti klaim jadi bukti Payment, status dihitung dari ledger → LUNAS", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const id = await klaimSiap(w, order);
  await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});

  const antre = await w.cFin.get("/api/finance/penerimaan/klaim-lunas");
  assert.equal(antre.status, 200);
  assert.equal(antre.body.items.length, 1);
  assert.equal(antre.body.menunggu.total, 1_000_000);
  assert.equal(antre.body.items[0].bukti.length, 1);

  const [v1, v2] = await Promise.all([
    w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/verifikasi`, {}),
    w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/verifikasi`, {}),
  ]);
  const sukses = [v1, v2].filter((r) => r.status === 201);
  assert.equal(sukses.length, 1, `tepat satu sukses: ${v1.status}/${v2.status} ${JSON.stringify(v1.body)} ${JSON.stringify(v2.body)}`);
  assert.equal([v1, v2].find((r) => r.status !== 201).status, 409);

  const payments = await testPrisma.payment.findMany({ where: { orderId: order.id }, include: { verifications: true } });
  assert.equal(payments.length, 1, "tepat satu Payment");
  const p = payments[0];
  assert.equal(p.amount, 1_000_000);
  assert.equal(p.cashAccountId, w.bank.id);
  assert.equal(p.recordedById, w.sales.user.id, "pencatat = Sales pengaju; yang memverifikasi = Finance");
  assert.equal(p.verifications.length, 1);
  assert.equal(p.verifications[0].verifiedById, w.finance.user.id);
  assert.equal(p.proofPhotoUrls.length, 1);
  assert.match(p.proofPhotoUrls[0], /^\/media\/payment-proofs\/klaim-[0-9a-f-]{36}\.png$/);
  assert.ok(fs.existsSync(path.join(process.env.PAYMENT_PROOFS_DIR, p.proofPhotoUrls[0].split("/").pop())), "berkas bukti Payment ada");

  const o = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o.paymentStatus, "LUNAS");
  assert.ok(o.paidAt, "paidAt terisi dari ledger");
  const k = await testPrisma.orderPaymentClaim.findUnique({ where: { id } });
  assert.equal(k.status, "VERIFIED");
  assert.equal(k.paymentId, p.id);
  assert.equal((await w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/verifikasi`, {})).status, 409, "verifikasi ulang ditolak");
});

test("Verifikasi sebagian (nominal klaim < tagihan): status order DP, bukan LUNAS — LUNAS hanya bila ledger mencapai tagihan", async () => {
  const w = await dunia();
  const order = await buatOrder({ value: 4_500_000, sales: w.sales });
  const id = await klaimSiap(w, order, { amount: 2_250_000 });
  await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});
  const v = await w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/verifikasi`, {});
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal(v.body.statusBayar, "DP");
  const o = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o.paymentStatus, "DP");
  assert.equal(o.paidAt, null);
});

test("Minta Bukti & Tolak: alasan WAJIB dan diaudit; Sales bisa melengkapi lalu mengajukan ulang; tolak lalu ajukan ulang", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const id = await klaimSiap(w, order);
  await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});

  assert.equal((await w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/minta-bukti`, {})).status, 400, "alasan wajib");
  assert.equal((await w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/tolak`, { alasan: " " })).status, 400, "alasan wajib");

  const sebelum = await fotoKeuangan();
  const mb = await w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/minta-bukti`, { alasan: "Mutasi tidak terlihat, kirim screenshot mutasi" });
  assert.equal(mb.status, 201, JSON.stringify(mb.body));
  assert.equal((await testPrisma.orderPaymentClaim.findUnique({ where: { id } })).status, "EVIDENCE_REQUESTED");
  // Sales melihat alasannya, menambah bukti, mengajukan ulang
  const lihat = await w.cSales.get(`/api/klaim-lunas/order/${order.id}`);
  assert.equal(lihat.body.klaim[0].reviewReason, "Mutasi tidak terlihat, kirim screenshot mutasi");
  assert.equal((await unggah(w.sales.token, id, PNG2)).status, 201);
  const ulang = await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});
  assert.equal(ulang.status, 201);
  assert.equal((await testPrisma.orderPaymentClaim.findUnique({ where: { id } })).submitCount, 2);

  const tolak = await w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/tolak`, { alasan: "Uang tidak ditemukan di rekening" });
  assert.equal(tolak.status, 200, JSON.stringify(tolak.body));
  assert.equal((await testPrisma.orderPaymentClaim.findUnique({ where: { id } })).status, "REJECTED");
  // ditolak → tidak bisa diverifikasi
  assert.equal((await w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/verifikasi`, {})).status, 409);
  // resubmit setelah ditolak
  const lagi = await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});
  assert.equal(lagi.status, 201, JSON.stringify(lagi.body));
  assert.equal((await testPrisma.orderPaymentClaim.findUnique({ where: { id } })).status, "SUBMITTED");

  assert.deepEqual(await fotoKeuangan(), sebelum, "minta bukti/tolak/ajukan ulang tidak menyentuh keuangan");
  const o = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o.paymentStatus, "BELUM_BAYAR");
  const aksi = (await testPrisma.activityEvent.findMany({ where: { entityId: order.id, eventType: "KLAIM_LUNAS" } })).map((e) => e.metadata?.aksi);
  for (const a of ["diajukan", "bukti_diminta", "diajukan_ulang", "ditolak"]) assert.ok(aksi.includes(a), `audit ${a}`);
});

test("Verifikasi dengan versi basi (Sales memperbarui setelah Finance membuka) ditolak 409", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const id = await klaimSiap(w, order);
  await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});
  const v = (await testPrisma.orderPaymentClaim.findUnique({ where: { id } })).version;
  const r = await w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/verifikasi`, { versi: v - 1 });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "VERSI_BERBEDA");
  assert.equal(await testPrisma.payment.count(), 0);
});

// ── akses & peran ──────────────────────────────────────────────────────────────────────────────────────────────────

test("Peran: Sales lain tidak bisa melihat/mengubah/mengunggah ke klaim orang lain (404); Driver ditolak; Sales tidak bisa memakai endpoint Finance", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const id = await klaimSiap(w, order);

  assert.equal((await w.cSales2.get(`/api/klaim-lunas/order/${order.id}`)).body.klaim.length, 0, "Sales lain tidak melihat klaim ini");
  assert.equal((await w.cSales2.patch(`/api/klaim-lunas/${id}`, { note: "x" })).status, 404);
  assert.equal((await w.cSales2.post(`/api/klaim-lunas/${id}/ajukan`, {})).status, 404);
  assert.equal((await unggah(w.sales2.token, id, PNG2)).status, 404);
  assert.equal((await w.cSales2.post(`/api/klaim-lunas/${id}/tarik`, {})).status, 404);
  assert.equal((await w.cDriver.get(`/api/klaim-lunas/order/${order.id}`)).status, 403);

  await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});
  for (const r of [
    await w.cSales.get("/api/finance/penerimaan/klaim-lunas"),
    await w.cSales.get(`/api/finance/penerimaan/klaim-lunas/${id}`),
    await w.cSales.post(`/api/finance/penerimaan/klaim-lunas/${id}/verifikasi`, {}),
    await w.cSales.post(`/api/finance/penerimaan/klaim-lunas/${id}/tolak`, { alasan: "coba-coba" }),
    await w.cSales.post(`/api/finance/penerimaan/klaim-lunas/${id}/minta-bukti`, { alasan: "coba-coba" }),
    await w.cDriver.get("/api/finance/penerimaan/klaim-lunas"),
  ]) assert.equal(r.status, 403, `endpoint Finance harus 403 untuk non-Finance (dapat ${r.status})`);
  assert.equal(await testPrisma.payment.count(), 0);
});

test("Tarik klaim: hanya pemilik, tidak bisa setelah diverifikasi; klaim ditarik tidak muncul di antrean Finance", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const id = await klaimSiap(w, order);
  await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});
  assert.equal((await w.cSales.post(`/api/klaim-lunas/${id}/tarik`, {})).status, 200);
  assert.equal((await w.cFin.get("/api/finance/penerimaan/klaim-lunas")).body.items.length, 0);
  assert.equal((await w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/verifikasi`, {})).status, 409);

  const order2 = await buatOrder({ sales: w.sales });
  const id2 = await klaimSiap(w, order2);
  await w.cSales.post(`/api/klaim-lunas/${id2}/ajukan`, {});
  await w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id2}/verifikasi`, {});
  assert.equal((await w.cSales.post(`/api/klaim-lunas/${id2}/tarik`, {})).status, 409);
});

test("Satu klaim aktif per order; draft idempoten (double-click 'buat draft' tidak menggandakan)", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const [a, b] = await Promise.all([w.cSales.post(`/api/klaim-lunas/order/${order.id}`, {}), w.cSales.post(`/api/klaim-lunas/order/${order.id}`, {})]);
  assert.ok([a.status, b.status].every((s) => s === 200 || s === 201), `${a.status}/${b.status}`);
  assert.equal(await testPrisma.orderPaymentClaim.count({ where: { orderId: order.id } }), 1);
  const lain = await w.cSales2.post(`/api/klaim-lunas/order/${order.id}`, {});
  assert.equal(lain.status, 409, "Sales lain tidak bisa membuka klaim kedua saat masih ada yang aktif");
});

// ── upload ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test("Upload: tipe ditentukan dari ISI (HTML berlabel image/png ditolak), ukuran dibatasi, nama di disk dibuat server, nama klien dibersihkan", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const d = (await w.cSales.post(`/api/klaim-lunas/order/${order.id}`, {})).body.klaim;
  const berkasAwal = fs.readdirSync(TMP_KLAIM).length; // folder dipakai bersama tes lain — bandingkan selisih, bukan angka mutlak

  const html = await unggah(w.sales.token, d.id, HTML, { nama: "bukti.png", tipe: "image/png" });
  assert.equal(html.status, 415, JSON.stringify(html.body));
  assert.equal(html.body.code, "TIPE_TIDAK_DIIZINKAN");
  const exe = await unggah(w.sales.token, d.id, Buffer.from("MZ".padEnd(64, "\0")), { nama: "virus.exe", tipe: "application/octet-stream" });
  assert.equal(exe.status, 415);
  const besar = await unggah(w.sales.token, d.id, Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]));
  assert.equal(besar.status, 413);
  assert.equal((await unggah(w.sales.token, d.id, PNG, { bidang: "salah" })).status, 400, "tanpa field berkas");
  assert.equal(await testPrisma.orderPaymentClaimEvidence.count(), 0, "berkas ditolak tidak tercatat");
  assert.equal(fs.readdirSync(TMP_KLAIM).length, berkasAwal, "berkas ditolak tidak menyentuh disk");

  assert.equal((await unggah(w.sales.token, d.id, PNG, { nama: "rusak\u0000.png" })).status, 400, "header multipart rusak = 400, bukan 500");
  const ok = await unggah(w.sales.token, d.id, PNG, { nama: "../../etc/passwd<script>.html" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const e = await testPrisma.orderPaymentClaimEvidence.findFirst();
  assert.match(e.storedName, /^[a-f0-9]{32}\.png$/, "nama di disk buatan server, ekstensi dari tipe terdeteksi (bukan dari nama klien)");
  assert.doesNotMatch(e.originalName, /[\\/<>\u0000]/);
  assert.equal(e.mimeType, "image/png");
  assert.equal((await unggah(w.sales.token, d.id, PDF, { nama: "struk.pdf", tipe: "application/pdf" })).status, 201, "PDF diizinkan");

  // isi identik pada klaim yang sama tidak digandakan
  const dup = await unggah(w.sales.token, d.id, PNG);
  assert.equal(dup.status, 200);
  assert.equal(await testPrisma.orderPaymentClaimEvidence.count(), 2);
  assert.equal(fs.readdirSync(TMP_KLAIM).length, berkasAwal + 2, "salinan duplikat dihapus dari disk");
});

test("Satu bukti hanya tertaut ke SATU klaim: hapus lewat klaim lain → 404; isi identik dipakai klaim lain memunculkan peringatan untuk Finance", async () => {
  const w = await dunia();
  const o1 = await buatOrder({ sales: w.sales });
  const o2 = await buatOrder({ sales: w.sales });
  const id1 = await klaimSiap(w, o1);
  const id2 = await klaimSiap(w, o2); // PNG yang sama (transfer gabungan) → sha sama
  const e1 = await testPrisma.orderPaymentClaimEvidence.findFirst({ where: { claimId: id1 } });
  const e2 = await testPrisma.orderPaymentClaimEvidence.findFirst({ where: { claimId: id2 } });
  assert.notEqual(e1.storedName, e2.storedName, "berkas fisik terpisah per klaim");
  assert.equal(e1.sha256, e2.sha256);

  assert.equal((await w.cSales.delete(`/api/klaim-lunas/${id2}/bukti/${e1.id}`)).status, 404, "bukti klaim 1 tidak bisa dihapus lewat klaim 2");
  assert.equal(await testPrisma.orderPaymentClaimEvidence.count(), 2);

  await w.cSales.post(`/api/klaim-lunas/${id1}/ajukan`, {});
  await w.cSales.post(`/api/klaim-lunas/${id2}/ajukan`, {});
  const det = await w.cFin.get(`/api/finance/penerimaan/klaim-lunas/${id1}`);
  assert.ok(det.body.peringatan.some((p) => p.kode === "BUKTI_SAMA"), "Finance diperingatkan bukti identik dipakai klaim lain");
});

test("Hapus bukti: hanya saat belum diajukan; berkas fisik ikut terhapus", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const id = await klaimSiap(w, order);
  const e = await testPrisma.orderPaymentClaimEvidence.findFirst({ where: { claimId: id } });
  assert.equal((await w.cSales.delete(`/api/klaim-lunas/${id}/bukti/${e.id}`)).status, 200);
  assert.equal(fs.existsSync(path.join(TMP_KLAIM, e.storedName)), false);
  // tanpa bukti lagi → tidak bisa diajukan
  assert.equal((await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {})).status, 422);
});

// ── akses berkas ───────────────────────────────────────────────────────────────────────────────────────────────────

test("Akses bukti: pemilik & Finance (Bearer) bisa, Sales lain/tanpa login tidak; URL bertanda-tangan berlaku singkat dan tidak bisa dipalsukan; header aman", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const id = await klaimSiap(w, order);
  const e = await testPrisma.orderPaymentClaimEvidence.findFirst({ where: { claimId: id } });
  const url = `${server.baseUrl}/media/klaim-lunas/${e.storedName}`;
  const ambil = (u, token) => fetch(u, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  assert.equal((await ambil(url)).status, 401);
  assert.equal((await ambil(url, w.sales2.token)).status, 403, "Sales lain");
  assert.equal((await ambil(url, w.driver.token)).status, 403);
  const milik = await ambil(url, w.sales.token);
  assert.equal(milik.status, 200);
  assert.equal(milik.headers.get("content-type"), "image/png");
  assert.equal(milik.headers.get("x-content-type-options"), "nosniff");
  assert.match(milik.headers.get("content-security-policy"), /sandbox/);
  assert.equal((await ambil(url, w.finance.token)).status, 200);
  assert.equal((await ambil(url, w.admin.token)).status, 200);

  // URL bertanda-tangan dari API
  const info = await w.cSales.get(`/api/klaim-lunas/order/${order.id}`);
  const bertanda = info.body.klaim[0].bukti[0].url;
  assert.match(bertanda, /exp=\d+&sig=[0-9a-f]+/);
  assert.equal((await ambil(`${server.baseUrl}${bertanda}`)).status, 200, "tanpa Bearer tetapi bertanda-tangan sah");
  assert.equal((await ambil(`${server.baseUrl}${bertanda.replace(/sig=[0-9a-f]/, "sig=0")}`)).status, 403, "tanda tangan dirusak");
  // tanda tangan untuk berkas lain tidak berlaku
  const lain = signFile("ffffffffffffffffffffffffffffffff.png", { purpose: "klaim-lunas-v1" });
  assert.equal((await ambil(`${url}?exp=${lain.exp}&sig=${lain.sig}`)).status, 403);
  // kedaluwarsa
  const basi = signFile(e.storedName, { purpose: "klaim-lunas-v1", now: Date.now() - 3600_000 });
  assert.equal((await ambil(`${url}?exp=${basi.exp}&sig=${basi.sig}`)).status, 403);
  // tanda tangan media Finance lain (label kunci berbeda) tidak dapat dipakai di sini
  const silang = signFile(e.storedName);
  assert.equal((await ambil(`${url}?exp=${silang.exp}&sig=${silang.sig}`)).status, 403);
  // path traversal / nama di luar pola
  assert.equal((await ambil(`${server.baseUrl}/media/klaim-lunas/..%2F..%2Fpackage.json`, w.admin.token)).status, 404);
});

// ── gerbang status LUNAS ───────────────────────────────────────────────────────────────────────────────────────────

test("Sales tidak bisa lagi menandai LUNAS lewat PATCH order (409 + arahan ke Klaim Lunas); Admin tetap bisa; menurunkan status tidak terkena", async () => {
  const w = await dunia();
  const order = await buatOrder({ sales: w.sales });
  const r = await w.cSales.patch(`/api/orders/${order.id}`, { paymentStatus: "LUNAS" });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "KLAIM_LUNAS_WAJIB");
  assert.match(r.body.error, /Klaim Lunas/);
  const o = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o.paymentStatus, "BELUM_BAYAR");
  assert.equal(o.paidAt, null);

  // field lain tetap bisa diubah Sales; status DP manual tidak terkena gerbang
  assert.equal((await w.cSales.patch(`/api/orders/${order.id}`, { notes: "catatan biasa" })).status, 200);
  assert.equal((await w.cSales.patch(`/api/orders/${order.id}`, { paymentStatus: "DP" })).status, 200);
  // Admin (Owner) tetap dapat menandai LUNAS manual
  assert.equal((await w.cAdmin.patch(`/api/orders/${order.id}`, { paymentStatus: "LUNAS" })).status, 200);
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).paymentStatus, "LUNAS");
});

test("Order yang sudah lunas menurut ledger tidak bisa diklaim; order batal / tanpa harga ditolak", async () => {
  const w = await dunia();
  const lunas = await buatOrder({ sales: w.sales });
  const id = await klaimSiap(w, lunas);
  await w.cSales.post(`/api/klaim-lunas/${id}/ajukan`, {});
  await w.cFin.post(`/api/finance/penerimaan/klaim-lunas/${id}/verifikasi`, {});
  const lagi = await w.cSales.post(`/api/klaim-lunas/order/${lunas.id}`, {});
  assert.equal(lagi.status, 409);
  assert.equal(lagi.body.code, "SUDAH_LUNAS");

  const nol = await buatOrder({ value: 0, sales: w.sales });
  assert.equal((await w.cSales.post(`/api/klaim-lunas/order/${nol.id}`, {})).status, 409);
  const batal = await buatOrder({ sales: w.sales });
  await testPrisma.order.update({ where: { id: batal.id }, data: { status: "CANCELLED" } });
  assert.equal((await w.cSales.post(`/api/klaim-lunas/order/${batal.id}`, {})).status, 409);
});
