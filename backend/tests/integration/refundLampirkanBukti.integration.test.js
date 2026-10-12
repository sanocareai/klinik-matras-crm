// "LAMPIRKAN BUKTI" TANPA KOREKSI pada refund, terhadap PostgreSQL sungguhan. Yang dikunci:
//  (1) refund legacy tanpa bukti diberi bukti: jurnal, saldo rekening, nominal, biaya admin, status, dan BARIS fin_refunds identik (updatedAt pun tidak bergeser); dampak keuangan Rp0;
//  (2) bukti kedua bisa menyusul bertahap; lampiran lama ikut terhitung; batas 10 per dokumen;
//  (3) replay (Idempotency-Key sama) & dua permintaan paralel dengan bukti sama → tepat satu tautan;
//  (4) tautan & bukti tak bisa diubah/dihapus/dipindah; bukti yang sudah dipakai tak bisa dilampirkan lagi;
//  (5) peran: hanya finance:admin; (6) refund tak bertransaksi diblokir; versi lama yang sudah dikoreksi boleh;
//  (7) unggahan gagal tidak meninggalkan berkas/baris, lampir gagal tidak menghilangkan bukti STAGED; (8) riwayat + URL bertanda-tangan; (9) koreksi sesudahnya bisa "Gunakan bukti lama".
import "./setup/env.js";
import "./setup/refundBuktiTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postPaymentReceived, postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { bersihkanBuktiStaged, REFUND_BUKTI_DIR } from "../../src/services/finance/refundBukti.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const LAMPIRAN_LAMA = `/media/finance-receipts/${"a".repeat(40)}.jpg`;
const JPEG = (n = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
const PDF = () => Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
const berkasDiDisk = () => fs.existsSync(REFUND_BUKTI_DIR) ? fs.readdirSync(REFUND_BUKTI_DIR) : [];

const POLA_SIMPAN = /\/refunds\/[^/]+\/(koreksi|info|lampirkan-bukti)$/;
function denganKunci(c) {
  const post = c.post;
  return { ...c, post: (path, body, headers) => post(path, body, headers ?? (POLA_SIMPAN.test(path) && !body?.preview ? { "Idempotency-Key": `uji-${randomUUID()}` } : undefined)) };
}

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  return {
    bank, admin, finance, sales,
    a: denganKunci(makeClient(server.baseUrl, admin.token, { tanpaStepUp: true })),
    a0: makeClient(server.baseUrl, admin.token, { tanpaStepUp: true }),
    f: denganKunci(makeClient(server.baseUrl, finance.token)),
    s: denganKunci(makeClient(server.baseUrl, sales.token)),
  };
}

async function unggah(token, { isi, nama = "bukti.jpg", mime = "image/jpeg" }) {
  const fd = new FormData();
  fd.append("berkas", new Blob([isi], { type: mime }), nama);
  const r = await fetch(`${server.baseUrl}/api/finance/refunds/bukti/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  let body = null; try { body = await r.json(); } catch { /* kosong */ }
  return { status: r.status, body };
}
const unggahOk = async (ctx, opsi = { isi: JPEG() }) => { const r = await unggah(ctx.admin.token, opsi); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.bukti; };

async function refundDisetujui(ctx, { bayar = 2_000_000, nominal = 200_000, fee = "BI_FAST", lampiran = null, referensi } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Erni" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: bayar, category: "LAYANAN", orderNumber: `TES-${Date.now()}-${Math.floor(Math.random() * 1e6)}` } });
  const payment = await testPrisma.payment.create({ data: { orderId: order.id, amount: bayar, method: "CASH", recordedById: ctx.admin.user.id } });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: payment.id, userId: ctx.admin.user.id }));
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: ctx.admin.user.id }));
  const body = { orderId: order.id, date: "2026-09-22", amount: nominal, reason: "Kasur tidak sesuai", cashAccountId: ctx.bank.id, ...(lampiran ? { attachmentUrl: lampiran } : {}), ...(referensi ? { transferReference: referensi } : {}) };
  if (fee) Object.assign(body, { paymentMethod: "TRANSFER", transferFeeType: fee });
  const r = await ctx.a.post("/api/finance/refunds", body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { order, refund: r.body };
}
async function refundSetuju(ctx, opsi) {
  const x = await refundDisetujui(ctx, opsi);
  const ap = await ctx.a.post(`/api/finance/refunds/${x.refund.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  return x;
}

const lampir = (ctx, refundId, ids, reason = "Bukti transfer menyusul dari bank", klien = ctx.a, headers) => klien.post(`/api/finance/refunds/${refundId}/lampirkan-bukti`, { reason, bukti: { ids } }, headers);
const tautan = (refundId) => testPrisma.finRefundEvidenceLink.findMany({ where: { refundId }, include: { evidence: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
async function saldoAkun(systemKey) {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: akun.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(agg._sum.debit || 0) - Number(agg._sum.credit || 0);
}
/** Potret KEUANGAN seluruh buku + dokumen refund — dibandingkan sebelum/sesudah lampir. */
async function potret(ctx, refundId) {
  const jurnal = await testPrisma.finJournalEntry.findMany({ include: { lines: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const refund = await testPrisma.finRefund.findUnique({ where: { id: refundId } });
  const rekening = await testPrisma.finJournalLine.aggregate({ where: { cashAccountId: ctx.bank.id }, _sum: { debit: true, credit: true } });
  return JSON.stringify({
    jurnal: jurnal.map((j) => ({ id: j.id, status: j.status, n: j.entryNumber, lines: j.lines.map((l) => [l.accountId, String(l.debit), String(l.credit), l.cashAccountId]).sort() })),
    refund, rekening: [String(rekening._sum.debit), String(rekening._sum.credit)],
    saldo: [await saldoAkun(SYSTEM_KEYS.BANK), await saldoAkun(SYSTEM_KEYS.RETUR_PENJUALAN), await saldoAkun(SYSTEM_KEYS.BEBAN_ADMIN_BANK)],
    jumlahRefund: await testPrisma.finRefund.count(),
  });
}

// ═══ 1 + 2. Refund legacy tanpa bukti → lampir, tidak ada efek keuangan ═══
test("lampirkan bukti pada refund legacy: jurnal, saldo rekening, nominal, biaya admin, status, dan baris dokumen IDENTIK; hanya bukti + tautan yang bertambah; tidak ada dokumen/jurnal baru", async () => {
  const ctx = await siapkan();
  const { refund } = await refundSetuju(ctx, { lampiran: null });
  const bukti = await unggahOk(ctx, { isi: JPEG(80), nama: "slip-bca.jpg" });
  const sebelum = await potret(ctx, refund.id);
  const jurnalSebelum = await testPrisma.finJournalEntry.count();

  const r = await lampir(ctx, refund.id, [bukti.id]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.ditambah, r.body.jumlahBukti, r.body.dokumenSudahDiganti], [1, 1, null]);
  assert.deepEqual(r.body.dampakKeuangan, { jurnalBaru: 0, perubahanSaldo: 0, dokumenBaru: 0, ringkasan: "Rp0 — hanya melampirkan bukti" });
  assert.deepEqual([r.body.ringkasan.nominal, r.body.ringkasan.biayaAdmin, r.body.ringkasan.totalKeluar, r.body.ringkasan.rekening], [200_000, 2_500, 202_500, "BCA Operasional"]);

  assert.equal(await potret(ctx, refund.id), sebelum, "seluruh potret keuangan + baris fin_refunds (termasuk updatedAt) tidak berubah");
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalSebelum);
  const t = await tautan(refund.id);
  assert.deepEqual(t.map((x) => [x.evidenceId, x.origin, x.createdById]), [[bukti.id, "BARU", ctx.admin.user.id]]);
  const ev = await testPrisma.finRefundEvidence.findUnique({ where: { id: bukti.id } });
  assert.equal(ev.status, "DIGUNAKAN"); assert.ok(ev.attachedAt);
  // audit: pelaku, waktu, alasan, jumlah bukti
  const log = await testPrisma.activityEvent.findFirst({ where: { entityType: "fin_refund", entityId: refund.id, eventType: "DOCUMENT_EDITED" }, orderBy: { createdAt: "desc" } });
  assert.equal(log.actorId, ctx.admin.user.id); assert.equal(log.metadata.aksi, "lampirkan_bukti_refund");
  assert.equal(log.metadata.reason, "Bukti transfer menyusul dari bank"); assert.equal(log.metadata.after.jumlahBukti, 1); assert.match(log.metadata.dampakKeuangan, /Rp0/);
  // laporan: export identik kecuali Jumlah Bukti
  const x = await unduhExport(server.baseUrl, ctx.admin.token, "piutang-refund", { periode: { to: "2026-12-31" }, filter: {} });
  const baris = bacaSheet(x.wb, "Refund").baris.find((b) => b["Status"] === "Disetujui");
  assert.deepEqual([baris["Nominal Refund (Rp)"], baris["Biaya Admin (Rp)"], baris["Total Keluar (Rp)"], baris["Jumlah Bukti"]], [200_000, 2_500, 202_500, 1]);
  assert.equal((await ctx.f.get("/api/finance/refunds")).body.refunds.find((q) => q.id === refund.id).jumlahBukti, 1);
});

test("bukti kedua menyusul bertahap; lampiran lama (teks) ikut terhitung; maksimal 10 per dokumen", async () => {
  const ctx = await siapkan();
  const { refund } = await refundSetuju(ctx, { lampiran: LAMPIRAN_LAMA });
  const a = await unggahOk(ctx, { isi: JPEG(), nama: "tahap-1.jpg" });
  const b = await unggahOk(ctx, { isi: PDF(), nama: "tahap-2.pdf", mime: "application/pdf" });
  const r1 = await lampir(ctx, refund.id, [a.id]);
  assert.equal(r1.status, 201); assert.equal(r1.body.jumlahBukti, 2, "lampiran lama + 1 bukti baru");
  const r2 = await lampir(ctx, refund.id, [b.id], "Slip PDF dari mobile banking");
  assert.equal(r2.status, 201); assert.equal(r2.body.jumlahBukti, 3);
  assert.deepEqual((await tautan(refund.id)).map((t) => t.evidenceId), [a.id, b.id]);
  // sampai batas: 3 sudah ada → 7 lagi boleh, 8 ditolak
  const banyak = []; for (let i = 0; i < 8; i++) banyak.push((await unggahOk(ctx, { isi: JPEG(70 + i), nama: `x${i}.jpg` })).id);
  const lebih = await lampir(ctx, refund.id, banyak);
  assert.equal(lebih.status, 400); assert.equal(lebih.body.code, "BUKTI_TERLALU_BANYAK");
  assert.equal((await tautan(refund.id)).length, 2, "gagal = tidak ada tautan baru");
  assert.ok((await testPrisma.finRefundEvidence.findMany({ where: { id: { in: banyak } } })).every((e) => e.status === "STAGED"), "bukti tetap STAGED & bisa dipakai ulang");
  const pas = await lampir(ctx, refund.id, banyak.slice(0, 7));
  assert.equal(pas.status, 201, JSON.stringify(pas.body)); assert.equal(pas.body.jumlahBukti, 10);
});

// ═══ 3. Replay & paralel ═══
test("replay (Idempotency-Key sama) tidak menggandakan bukti/tautan; kunci sama dengan isi berbeda 422; tanpa kunci 428; dua permintaan PARALEL dengan bukti sama → tepat satu tautan", async () => {
  const ctx = await siapkan();
  const { refund } = await refundSetuju(ctx);
  const a = await unggahOk(ctx);
  const kunci = { "Idempotency-Key": `uji-${randomUUID()}` };
  const body = { reason: "Bukti menyusul dari bank", bukti: { ids: [a.id] } };
  const url = `/api/finance/refunds/${refund.id}/lampirkan-bukti`;
  assert.equal((await ctx.a0.post(url, body)).status, 428, "tanpa Idempotency-Key");
  const k1 = await ctx.a0.post(url, body, kunci);
  assert.equal(k1.status, 201, JSON.stringify(k1.body));
  const k2 = await ctx.a0.post(url, body, kunci);
  assert.equal(k2.status, 201); assert.deepEqual(k2.body, k1.body, "replay = respons pertama");
  assert.equal((await ctx.a0.post(url, { ...body, reason: "Alasan yang berbeda sama sekali" }, kunci)).status, 422, "kunci sama, isi beda");
  assert.equal((await tautan(refund.id)).length, 1);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: refund.id, eventType: "DOCUMENT_EDITED" } }), 1, "replay tidak menulis audit kedua");

  // paralel: bukti yang sama, kunci berbeda
  const { refund: r2 } = await refundSetuju(ctx);
  const b = await unggahOk(ctx);
  const kirim = () => ctx.a0.post(`/api/finance/refunds/${r2.id}/lampirkan-bukti`, { reason: "Bukti menyusul paralel", bukti: { ids: [b.id] } }, { "Idempotency-Key": `uji-${randomUUID()}` });
  const [x, y] = await Promise.all([kirim(), kirim()]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409], JSON.stringify([x.body, y.body]));
  assert.equal((await tautan(r2.id)).length, 1, "tepat satu tautan");
  assert.equal(await testPrisma.finRefundEvidenceLink.count({ where: { evidenceId: b.id } }), 1);
});

// ═══ 4. Immutabilitas ═══
test("bukti & tautan yang sudah terlampir tidak bisa diganti/dihapus/dipindah; bukti yang sudah dipakai tidak bisa dilampirkan ke refund lain; hapus lewat API ditolak", async () => {
  const ctx = await siapkan();
  const { refund } = await refundSetuju(ctx);
  const { refund: lain } = await refundSetuju(ctx);
  const a = await unggahOk(ctx);
  assert.equal((await lampir(ctx, refund.id, [a.id])).status, 201);
  await assert.rejects(() => testPrisma.finRefundEvidence.update({ where: { id: a.id }, data: { originalName: "diubah.jpg" } }), /REFUND_BUKTI_TETAP/);
  await assert.rejects(() => testPrisma.finRefundEvidence.delete({ where: { id: a.id } }), /REFUND_BUKTI_TETAP|Foreign key|constraint/i);
  await assert.rejects(() => testPrisma.finRefundEvidenceLink.deleteMany({ where: { refundId: refund.id } }), /REFUND_BUKTI_TETAP/);
  await assert.rejects(() => testPrisma.finRefundEvidenceLink.updateMany({ where: { refundId: refund.id }, data: { refundId: lain.id } }), /REFUND_BUKTI_TETAP|Unique/);
  const hapus = await ctx.a.delete(`/api/finance/refunds/bukti/${a.id}`);
  assert.equal(hapus.status, 409); assert.equal(hapus.body.code, "BUKTI_SUDAH_DIPAKAI");
  const pindah = await lampir(ctx, lain.id, [a.id]);
  assert.equal(pindah.status, 409); assert.equal(pindah.body.code, "BUKTI_SUDAH_DIPAKAI");
  assert.equal((await tautan(lain.id)).length, 0);
  assert.equal((await tautan(refund.id)).length, 1);
  assert.ok(berkasDiDisk().length >= 1, "berkas bukti tetap ada");
});

// ═══ 5. Peran ═══
test("hanya finance:admin: FINANCE murni, SALES, dan tanpa login ditolak; bukti milik orang lain ditolak; tak ada yang berubah", async () => {
  const ctx = await siapkan();
  const { refund } = await refundSetuju(ctx);
  const a = await unggahOk(ctx);
  const sebelum = await potret(ctx, refund.id);
  assert.equal((await lampir(ctx, refund.id, [a.id], undefined, ctx.f)).status, 403, "FINANCE murni");
  assert.equal((await lampir(ctx, refund.id, [a.id], undefined, ctx.s)).status, 403, "SALES");
  assert.equal((await fetch(`${server.baseUrl}/api/finance/refunds/${refund.id}/lampirkan-bukti`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "x-uji" }, body: "{}" })).status, 401);
  const admin2 = await createTestUser({ roles: ["ADMIN"] });
  const c2 = denganKunci(makeClient(server.baseUrl, admin2.token, { tanpaStepUp: true }));
  const orang = await lampir(ctx, refund.id, [a.id], undefined, c2);
  assert.equal(orang.status, 403); assert.equal(orang.body.code, "BUKTI_BUKAN_MILIK");
  assert.equal(await potret(ctx, refund.id), sebelum);
  assert.equal((await tautan(refund.id)).length, 0);
  assert.equal((await testPrisma.finRefundEvidence.findUnique({ where: { id: a.id } })).status, "STAGED");
});

// ═══ 6. Refund tak sah ═══
test("refund draf/ditolak/dibatalkan-tanpa-pengganti diblokir; alasan <5 karakter, tanpa bukti, ID tidak valid, refund tak ada ditolak; versi lama yang sudah dikoreksi BOLEH", async () => {
  const ctx = await siapkan();
  const a = await unggahOk(ctx);
  // draf
  const { refund: draf } = await refundDisetujui(ctx);
  const d = await lampir(ctx, draf.id, [a.id]);
  assert.equal(d.status, 409); assert.equal(d.body.code, "REFUND_BELUM_BERTRANSAKSI"); assert.match(d.body.error ?? d.body.message ?? "", /menunggu persetujuan/);
  // ditolak
  const { refund: tolak } = await refundDisetujui(ctx);
  assert.equal((await ctx.a.post(`/api/finance/refunds/${tolak.id}/reject`, { reason: "Data tidak lengkap" })).status, 200);
  const t = await lampir(ctx, tolak.id, [a.id]);
  assert.equal(t.status, 409); assert.equal(t.body.code, "REFUND_BELUM_BERTRANSAKSI");
  // dibatalkan tanpa pengganti
  const { refund: batal } = await refundSetuju(ctx);
  assert.equal((await ctx.a.post(`/api/finance/refunds/${batal.id}/cancel`, { reason: "Salah input pelanggan" })).status, 200);
  const b = await lampir(ctx, batal.id, [a.id]);
  assert.equal(b.status, 409); assert.equal(b.body.code, "REFUND_BELUM_BERTRANSAKSI");
  // validasi masukan
  const { refund } = await refundSetuju(ctx);
  assert.equal((await lampir(ctx, refund.id, [a.id], "abc")).body.code, "ALASAN_WAJIB");
  assert.equal((await lampir(ctx, refund.id, [])).status, 422);
  assert.equal((await lampir(ctx, refund.id, ["bukan-uuid"])).status, 400);
  assert.equal((await lampir(ctx, randomUUID(), [a.id])).status, 404);
  assert.equal((await lampir(ctx, refund.id, [randomUUID()])).body.code, "BUKTI_TIDAK_ADA");
  assert.equal(await testPrisma.finRefundEvidenceLink.count(), 0, "tak ada tautan dari semua percobaan gagal");
  assert.equal((await testPrisma.finRefundEvidence.findUnique({ where: { id: a.id } })).status, "STAGED");
  // versi lama yang sudah dikoreksi → boleh
  const k = await ctx.a.post(`/api/finance/refunds/${refund.id}/koreksi`, { reason: "Disepakati ulang", amount: 250_000, bukti: { mode: "GANTI", ids: [(await unggahOk(ctx, { isi: JPEG(90) })).id] }, expectedUpdatedAt: (await testPrisma.finRefund.findUnique({ where: { id: refund.id } })).updatedAt.toISOString() });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const lamaSebelum = await potret(ctx, refund.id);
  const lama = await lampir(ctx, refund.id, [a.id], "Bukti transfer versi lama ditemukan");
  assert.equal(lama.status, 201, JSON.stringify(lama.body));
  assert.equal(lama.body.dokumenSudahDiganti, k.body.baruNomor ?? lama.body.dokumenSudahDiganti);
  assert.ok(lama.body.dokumenSudahDiganti, "respons menyebut dokumen pengganti");
  assert.equal(await potret(ctx, refund.id), lamaSebelum, "versi lama tidak berubah selain tautan bukti");
  assert.equal((await tautan(k.body.baruId)).length, 1, "dokumen pengganti tidak ikut berubah");
});

// ═══ 7. Berkas yatim ═══
test("unggahan gagal tidak meninggalkan berkas/baris; lampir gagal tidak menghilangkan bukti STAGED; hapus STAGED menghapus berkas; sapuan membersihkan yang basi", async () => {
  const ctx = await siapkan();
  const awal = berkasDiDisk().length;
  const palsu = await unggah(ctx.admin.token, { isi: Buffer.from("<html><script>alert(1)</script></html>"), nama: "x.jpg", mime: "image/jpeg" });
  assert.equal(palsu.status, 415);
  assert.equal(berkasDiDisk().length, awal); assert.equal(await testPrisma.finRefundEvidence.count(), 0);
  const { refund: draf } = await refundDisetujui(ctx);
  const a = await unggahOk(ctx);
  assert.equal((await lampir(ctx, draf.id, [a.id])).status, 409);
  assert.equal((await testPrisma.finRefundEvidence.findUnique({ where: { id: a.id } })).status, "STAGED");
  assert.equal(berkasDiDisk().length, awal + 1, "berkas utuh setelah lampir gagal");
  const del = await ctx.a.delete(`/api/finance/refunds/bukti/${a.id}`);
  assert.equal(del.status, 200); assert.equal(berkasDiDisk().length, awal);
  const b = await unggahOk(ctx);
  assert.equal((await bersihkanBuktiStaged(testPrisma, { now: Date.now() + 3 * 60 * 60 * 1000 })).dihapus, 1);
  assert.equal(berkasDiDisk().length, awal);
  const { refund } = await refundSetuju(ctx);
  const gone = await lampir(ctx, refund.id, [b.id]);
  assert.equal(gone.status, 409); assert.equal(gone.body.code, "BUKTI_TIDAK_ADA", "bukti yang sudah disapu tidak bisa dilampirkan");
});

// ═══ 8. Riwayat + URL bertanda-tangan ═══
test("riwayat memuat 'Bukti dilampirkan' dengan nama pelaku, waktu, alasan, jumlah bukti; daftar bukti memberi URL bertanda-tangan yang bisa dibuka; peran lain ditolak", async () => {
  const ctx = await siapkan();
  const { refund } = await refundSetuju(ctx);
  const a = await unggahOk(ctx, { isi: JPEG(), nama: "slip-1.jpg" });
  const b = await unggahOk(ctx, { isi: PDF(), nama: "slip-2.pdf", mime: "application/pdf" });
  assert.equal((await lampir(ctx, refund.id, [a.id], "Slip BCA menyusul dari bank")).status, 201);
  assert.equal((await lampir(ctx, refund.id, [b.id], "Slip PDF mobile banking")).status, 201);
  const NAMA = ctx.admin.user.name;
  const rw = (await ctx.a.get(`/api/finance/riwayat-versi/refunds/${refund.id}`)).body;
  const lampiran = rw.versi.filter((v) => v.aksi === "Bukti dilampirkan");
  assert.equal(lampiran.length, 2);
  assert.deepEqual(lampiran.map((v) => [v.aktor, v.alasan]), [[NAMA, "Slip BCA menyusul dari bank"], [NAMA, "Slip PDF mobile banking"]]);
  assert.ok(lampiran.every((v) => v.waktu));
  const susulan = rw.versiRefund[0].lampiranSusulan;
  assert.deepEqual(susulan.map((s) => [s.oleh, s.jumlahDitambah, s.jumlahSesudah, s.nama]), [[NAMA, 1, 1, ["slip-1.jpg"]], [NAMA, 1, 2, ["slip-2.pdf"]]]);
  assert.equal(rw.versiRefund[0].jumlahBukti, 2);
  assert.ok(!JSON.stringify(rw).includes("exp="), "riwayat tidak memuat URL berkas");
  // daftar bukti dokumen: URL bertanda-tangan
  assert.equal((await ctx.s.get(`/api/finance/refunds/${refund.id}/bukti`)).status, 403);
  const daftar = (await ctx.f.get(`/api/finance/refunds/${refund.id}/bukti`));
  assert.equal(daftar.status, 200); assert.equal(daftar.body.berkas.length, 2);
  const buka = await fetch(server.baseUrl + daftar.body.berkas[0].url);
  assert.equal(buka.status, 200); assert.equal(buka.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await fetch(server.baseUrl + daftar.body.berkas[0].url.split("?")[0])).status, 401, "tanpa tanda tangan ditolak");
});

// ═══ 9. Setelah lampir, koreksi bisa memakai bukti lama ═══
test("refund legacy tanpa bukti: koreksi 'Gunakan bukti lama' ditolak SEBELUM lampir, berhasil SESUDAH lampir (bukti dibawa sebagai DIBAWA); jurnal koreksi tetap benar", async () => {
  const ctx = await siapkan();
  const { refund } = await refundSetuju(ctx, { lampiran: null });
  const rev = async (id) => (await testPrisma.finRefund.findUnique({ where: { id } })).updatedAt.toISOString();
  const koreksi = async (id, extra) => ctx.a.post(`/api/finance/refunds/${id}/koreksi`, { reason: "Nominal disepakati ulang", amount: 250_000, bukti: { mode: "LAMA" }, expectedUpdatedAt: await rev(id), ...extra });
  const tolak = await koreksi(refund.id);
  assert.equal(tolak.status, 422, JSON.stringify(tolak.body));
  const a = await unggahOk(ctx);
  assert.equal((await lampir(ctx, refund.id, [a.id])).status, 201);
  const ok = await koreksi(refund.id);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual((await tautan(ok.body.baruId)).map((t) => [t.evidenceId, t.origin]), [[a.id, "DIBAWA"]]);
  assert.deepEqual((await tautan(refund.id)).map((t) => [t.evidenceId, t.origin]), [[a.id, "BARU"]], "bukti dokumen lama tetap melekat ke dokumen lama");
  const jurnal = await testPrisma.finJournalEntry.findMany({ where: { source: "REFUND", sourceId: ok.body.baruId }, include: { lines: true } });
  assert.equal(jurnal.length, 1); assert.equal(jurnal[0].lines.reduce((s, l) => s + Number(l.credit), 0), 252_500);
});
