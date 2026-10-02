// KLAIM LUNAS DARI CHAT — foto bukti transfer di Inbox jadi Bukti Pembayaran pada draf klaim. Endpoint ASLI lewat testApp + database nyata.
// Fokus: foto hanya dari chat pelanggan pemilik order, draf+bukti terbentuk, idempoten, aturan klaim lama tetap berlaku (gerbang, klaim aktif milik
// orang lain, peran), dan TIDAK ADA efek ke uang (Payment/jurnal) sampai Finance memverifikasi.

import "./setup/env.js";
import fs from "node:fs";
import path from "node:path";
import { TMP_KLAIM_DIR as TMP_KLAIM } from "./setup/klaimTmpEnv.js";
import { TMP_CHAT_UPLOADS } from "./setup/chatUploadsTmpEnv.js";
import "./setup/paymentProofsTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => {
  await truncateAll();
  // folder sementara dipakai bersama semua tes di berkas ini — kosongkan agar hitungan berkas per tes bermakna
  for (const dir of [TMP_KLAIM, TMP_CHAT_UPLOADS]) for (const nama of fs.readdirSync(dir)) fs.rmSync(path.join(dir, nama), { force: true });
});
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("bukti-transfer-bca-".repeat(20))]);
const hariIni = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
let urut = 0;

async function dunia({ gerbang = true } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  if (gerbang) await setSetting(testPrisma, SETTING_KEYS.KLAIM_LUNAS_GATE_AKTIF, "true");
  const akunBank = await testPrisma.finAccount.findFirst({ where: { systemKey: "BANK" } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "PT Sano - BCA", kind: "BANK", accountId: akunBank.id } });
  const sales = await createTestUser({ roles: ["SALES"] });
  const sales2 = await createTestUser({ roles: ["SALES"] });
  const driver = await createTestUser({ roles: ["DRIVER"] });
  return {
    bank, sales, sales2, driver,
    cSales: makeClient(server.baseUrl, sales.token), cSales2: makeClient(server.baseUrl, sales2.token), cDriver: makeClient(server.baseUrl, driver.token),
  };
}

/** Pelanggan + percakapan + order + pesan foto (berkas sungguhan di folder unggahan chat). */
async function chatPelanggan({ mediaType = "image", isi = JPEG, ext = "jpg", value = 1_000_000, tipeChat = "INDIVIDUAL" } = {}) {
  urut += 1;
  const customer = await testPrisma.customer.create({ data: { name: `Ibu Susi ${urut}`, phone: `62812000${String(urut).padStart(4, "0")}` } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `RES-${Math.random().toString(36).slice(2, 8)}`, status: "PENDING", paymentStatus: "BELUM_BAYAR" },
  });
  const conversation = await testPrisma.conversation.create({ data: { customerId: customer.id, channel: "WHATSAPP", type: tipeChat, sessionId: "CS-1" } });
  const nama = `17908${urut}-bukti.${ext}`;
  fs.writeFileSync(path.join(TMP_CHAT_UPLOADS, nama), isi);
  const pesan = await testPrisma.message.create({
    data: { conversationId: conversation.id, direction: "INBOUND", content: "", mediaType, mediaUrl: `/uploads/${nama}`, externalId: `false_62812_${urut}_ABCDEF${urut}` },
  });
  return { customer, order, conversation, pesan, nama };
}

const fotoKeuangan = async () => ({
  pay: await testPrisma.payment.count(), jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(),
});
const berkasKlaim = () => fs.readdirSync(TMP_KLAIM).length;

test("alur penuh: foto chat → draf (Transfer + tanggal) + bukti → verifikasi Sales → ajukan; tidak menyentuh uang", async () => {
  const w = await dunia();
  const c = await chatPelanggan();
  const sebelum = await fotoKeuangan();

  const kand = await w.cSales.get(`/api/klaim-lunas/dari-pesan/${c.pesan.id}/order`);
  assert.equal(kand.status, 200, JSON.stringify(kand.body));
  assert.equal(kand.body.order.length, 1);
  assert.equal(kand.body.order[0].id, c.order.id);
  assert.equal(kand.body.order[0].bolehDiklaim, true);
  assert.equal(kand.body.order[0].sisa, 1_000_000);

  const r = await w.cSales.post(`/api/klaim-lunas/order/${c.order.id}/dari-pesan`, { messageId: c.pesan.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.dibuatBaru, true);
  assert.equal(r.body.duplikat, false);

  const info = await w.cSales.get(`/api/klaim-lunas/order/${c.order.id}`);
  const klaim = info.body.klaim.find((k) => k.id === r.body.klaimId);
  assert.equal(klaim.status, "DRAFT");
  assert.equal(klaim.method, "TRANSFER");
  assert.equal(String(klaim.paymentDate).slice(0, 10), hariIni());
  assert.equal(klaim.bukti.length, 1);

  // bukti benar-benar tersimpan di penyimpanan KLAIM (salinan), berkas chat asli utuh
  assert.equal(berkasKlaim(), 1);
  assert.ok(fs.existsSync(path.join(TMP_CHAT_UPLOADS, c.nama)));

  // Sales belum mengisi nominal/rekening/catatan → server menolak pengajuan (verifikasi memang di tangan Sales)
  const terlalu = await w.cSales.post(`/api/klaim-lunas/${r.body.klaimId}/ajukan`, {});
  assert.equal(terlalu.status, 422, JSON.stringify(terlalu.body));

  const isi = await w.cSales.patch(`/api/klaim-lunas/${r.body.klaimId}`, { amount: 1_000_000, cashAccountId: w.bank.id, note: "Transfer BCA a.n. Susi, dicek di mutasi 10.15" });
  assert.equal(isi.status, 200, JSON.stringify(isi.body));
  const aju = await w.cSales.post(`/api/klaim-lunas/${r.body.klaimId}/ajukan`, {});
  assert.equal(aju.status, 201, JSON.stringify(aju.body));
  assert.equal(aju.body.klaim.status, "SUBMITTED");

  // mengajukan klaim TIDAK mengubah uang
  assert.deepEqual(await fotoKeuangan(), sebelum);
  const order = await testPrisma.order.findUnique({ where: { id: c.order.id } });
  assert.equal(order.paymentStatus, "BELUM_BAYAR");
});

test("idempoten: foto yang sama dua kali tidak menggandakan draf maupun bukti", async () => {
  const w = await dunia();
  const c = await chatPelanggan();
  const a = await w.cSales.post(`/api/klaim-lunas/order/${c.order.id}/dari-pesan`, { messageId: c.pesan.id });
  const b = await w.cSales.post(`/api/klaim-lunas/order/${c.order.id}/dari-pesan`, { messageId: c.pesan.id });
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.body.duplikat, true);
  assert.equal(b.body.klaimId, a.body.klaimId);
  assert.equal(await testPrisma.orderPaymentClaim.count(), 1);
  assert.equal(await testPrisma.orderPaymentClaimEvidence.count(), 1);
  assert.equal(berkasKlaim(), 1, "salinan kedua harus dibersihkan dari disk");
});

test("foto dari chat pelanggan LAIN ditolak 403 — tidak ada draf, tidak ada berkas", async () => {
  const w = await dunia();
  const milikSusi = await chatPelanggan();
  const orangLain = await chatPelanggan();
  const r = await w.cSales.post(`/api/klaim-lunas/order/${orangLain.order.id}/dari-pesan`, { messageId: milikSusi.pesan.id });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, "PESAN_BUKAN_MILIK_ORDER");
  assert.equal(await testPrisma.orderPaymentClaim.count(), 0);
  assert.equal(berkasKlaim(), 0);
});

test("hanya foto/PDF: video & pesan grup ditolak; id pesan aneh ditolak", async () => {
  const w = await dunia();
  const video = await chatPelanggan({ mediaType: "video", ext: "mp4" });
  assert.equal((await w.cSales.post(`/api/klaim-lunas/order/${video.order.id}/dari-pesan`, { messageId: video.pesan.id })).body.code, "PESAN_BUKAN_BUKTI");
  const grup = await chatPelanggan({ tipeChat: "GROUP" });
  await testPrisma.conversation.update({ where: { id: grup.conversation.id }, data: { customerId: null, groupJid: "120363@g.us" } });
  assert.equal((await w.cSales.post(`/api/klaim-lunas/order/${grup.order.id}/dari-pesan`, { messageId: grup.pesan.id })).body.code, "PESAN_BUKAN_CHAT_PELANGGAN");
  assert.equal((await w.cSales.post(`/api/klaim-lunas/order/${grup.order.id}/dari-pesan`, { messageId: "../../etc/passwd" })).body.code, "PESAN_TIDAK_VALID");
  assert.equal(await testPrisma.orderPaymentClaim.count(), 0);
});

test("berkas bukan gambar/PDF (isi HTML berlabel .jpg) ditolak 415 sebelum draf dibuat", async () => {
  const w = await dunia();
  const c = await chatPelanggan({ isi: Buffer.from("<html><script>alert(1)</script></html>".padEnd(40, " ")) });
  const r = await w.cSales.post(`/api/klaim-lunas/order/${c.order.id}/dari-pesan`, { messageId: c.pesan.id });
  assert.equal(r.status, 415, JSON.stringify(r.body));
  assert.equal(await testPrisma.orderPaymentClaim.count(), 0);
});

test("berkas hilang dari disk → 404 jelas", async () => {
  const w = await dunia();
  const c = await chatPelanggan();
  fs.unlinkSync(path.join(TMP_CHAT_UPLOADS, c.nama));
  const r = await w.cSales.post(`/api/klaim-lunas/order/${c.order.id}/dari-pesan`, { messageId: c.pesan.id });
  assert.equal(r.status, 404);
  assert.equal(r.body.code, "BERKAS_PESAN_TIDAK_ADA");
});

test("gerbang Klaim Lunas MATI → 403 dan tidak ada berkas tertulis", async () => {
  const w = await dunia({ gerbang: false });
  const c = await chatPelanggan();
  const r = await w.cSales.post(`/api/klaim-lunas/order/${c.order.id}/dari-pesan`, { messageId: c.pesan.id });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, "KLAIM_LUNAS_BELUM_AKTIF");
  assert.equal(berkasKlaim(), 0);
});

test("klaim aktif milik Sales lain tidak bisa ditimpa (409); driver ditolak (403)", async () => {
  const w = await dunia();
  const c = await chatPelanggan();
  assert.equal((await w.cSales.post(`/api/klaim-lunas/order/${c.order.id}/dari-pesan`, { messageId: c.pesan.id })).status, 201);
  const lain = await w.cSales2.post(`/api/klaim-lunas/order/${c.order.id}/dari-pesan`, { messageId: c.pesan.id });
  assert.equal(lain.status, 409, JSON.stringify(lain.body));
  assert.equal(lain.body.code, "KLAIM_AKTIF_ADA");
  const sopir = await w.cDriver.post(`/api/klaim-lunas/order/${c.order.id}/dari-pesan`, { messageId: c.pesan.id });
  assert.equal(sopir.status, 403);
  assert.equal(await testPrisma.orderPaymentClaimEvidence.count(), 1);
});

test("order yang sudah dibatalkan / tanpa harga tidak muncul sebagai kandidat; order lunas tampil dengan alasan", async () => {
  const w = await dunia();
  const c = await chatPelanggan();
  await testPrisma.order.create({ data: { customerId: c.customer.id, value: 500_000, category: "BARU", orderNumber: "NEW-BATAL", status: "CANCELLED", paymentStatus: "BELUM_BAYAR" } });
  await testPrisma.order.create({ data: { customerId: c.customer.id, value: 0, category: "BARU", orderNumber: "NEW-NOL", status: "PENDING", paymentStatus: "BELUM_BAYAR" } });
  const kand = await w.cSales.get(`/api/klaim-lunas/dari-pesan/${c.pesan.id}/order`);
  assert.deepEqual(kand.body.order.map((o) => o.id), [c.order.id]);
});
