// KOREKSI REFUND — BUKTI TRANSFER + BIAYA ADMIN BANK, terhadap PostgreSQL sungguhan. Yang dikunci:
//  (1) bukti: gunakan lama / tambah / ganti; refund legacy tanpa bukti WAJIB upload; bukti lama tetap melekat ke dokumen lama (append-only, trigger DB);
//  (2) keamanan berkas: isi (bukan ekstensi) menentukan tipe, 8 MB, peran, URL bertanda-tangan, tidak statis, tidak yatim;
//  (3) angka: refund 200.000 + admin 2.500 → kredit bank 202.500; koreksi fee 0→2.500, 2.500→0, 2.500→5.000; reversal + pengganti seimbang;
//  (4) pengaman: Idempotency-Key, revisi optimistis, replay & paralel, periode/rekonsiliasi terkunci, potensi biaya admin ganda;
//  (5) laporan: refund = nominal pelanggan saja; biaya admin hanya di beban; mutasi bank = total keluar; export tidak menghitung ganda.
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
import { unggahBukti, bersihkanBuktiStaged, REFUND_BUKTI_DIR } from "../../src/services/finance/refundBukti.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const LAMPIRAN_LAMA = `/media/finance-receipts/${"a".repeat(40)}.jpg`;
const JPEG = (n = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]);
const PDF = () => Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
const WEBP = () => Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(32, 1)]);
const berkasDiDisk = () => fs.existsSync(REFUND_BUKTI_DIR) ? fs.readdirSync(REFUND_BUKTI_DIR) : [];

const POLA_SIMPAN = /\/refunds\/[^/]+\/(koreksi|info)$/;
function denganKunci(c) {
  const post = c.post;
  return { ...c, post: (path, body, headers) => post(path, body, headers ?? (POLA_SIMPAN.test(path) && !body?.preview ? { "Idempotency-Key": `uji-${randomUUID()}` } : undefined)) };
}

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const bank2 = await testPrisma.finCashAccount.create({ data: { name: "Mandiri", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const produksi = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  return {
    bank, bank2, admin, finance, sales, produksi,
    a: denganKunci(makeClient(server.baseUrl, admin.token, { tanpaStepUp: true })),
    a0: makeClient(server.baseUrl, admin.token, { tanpaStepUp: true }),
    f: denganKunci(makeClient(server.baseUrl, finance.token)),
    s: makeClient(server.baseUrl, sales.token),
    p: makeClient(server.baseUrl, produksi.token),
  };
}

/** Unggah multipart sungguhan lewat HTTP. */
async function unggah(token, { isi, nama = "bukti.jpg", mime = "image/jpeg" }) {
  const fd = new FormData();
  fd.append("berkas", new Blob([isi], { type: mime }), nama);
  const r = await fetch(`${server.baseUrl}/api/finance/refunds/bukti/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  let body = null; try { body = await r.json(); } catch { /* kosong */ }
  return { status: r.status, body };
}
const unggahOk = async (ctx, opsi = { isi: JPEG() }) => { const r = await unggah(ctx.admin.token, opsi); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.bukti; };

/** Refund DISETUJUI: order dibayar penuh, refund dibuat + disetujui. `lampiran: null` = refund legacy TANPA bukti. */
async function refundDisetujui(ctx, { bayar = 2_000_000, nominal = 200_000, fee = "BI_FAST", feeNominal, diakui = false, lampiran = LAMPIRAN_LAMA, tanggal = "2026-09-22", rekening, referensi } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Erni" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: bayar, category: "LAYANAN", orderNumber: `TES-${Date.now()}-${Math.floor(Math.random() * 1e6)}` } });
  const payment = await testPrisma.payment.create({ data: { orderId: order.id, amount: bayar, method: "CASH", recordedById: ctx.admin.user.id } });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: payment.id, userId: ctx.admin.user.id }));
  if (diakui) await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: ctx.admin.user.id }));
  const body = { orderId: order.id, date: tanggal, amount: nominal, reason: "Kasur tidak sesuai", cashAccountId: (rekening ?? ctx.bank).id, ...(lampiran ? { attachmentUrl: lampiran } : {}), ...(referensi ? { transferReference: referensi } : {}) };
  if (fee) Object.assign(body, { paymentMethod: "TRANSFER", transferFeeType: fee, ...(feeNominal !== undefined ? { transferFeeAmount: feeNominal } : {}) });
  const r = await ctx.a.post("/api/finance/refunds", body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ap = await ctx.a.post(`/api/finance/refunds/${r.body.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  return { order, refund: r.body };
}

const rev = async (refundId) => (await testPrisma.finRefund.findUnique({ where: { id: refundId } })).updatedAt.toISOString();
/** Koreksi alur BARU: selalu membawa `bukti` + expectedUpdatedAt. */
async function koreksi(ctx, refundId, body, { klien = ctx.a, headers } = {}) {
  const lengkap = { reason: "Disepakati ulang dengan pelanggan", bukti: { mode: "LAMA" }, expectedUpdatedAt: await rev(refundId), ...body };
  return klien.post(`/api/finance/refunds/${refundId}/koreksi`, lengkap, headers);
}
const jurnalPer = (sourceId) => testPrisma.finJournalEntry.findMany({ where: { source: "REFUND", sourceId }, include: { lines: { include: { account: { select: { systemKey: true, code: true } } } } }, orderBy: { createdAt: "asc" } });
const sumD = (e) => e.lines.reduce((a, l) => a + Number(l.debit), 0);
const sumK = (e) => e.lines.reduce((a, l) => a + Number(l.credit), 0);
async function saldoAkun(systemKey) {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: akun.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(agg._sum.debit || 0) - Number(agg._sum.credit || 0);
}
async function mutasiRekening(cashAccountId) {
  const rek = await testPrisma.finCashAccount.findUnique({ where: { id: cashAccountId } });
  const baris = await testPrisma.finJournalLine.findMany({ where: { cashAccountId, accountId: rek.accountId, entry: { status: { in: ["POSTED", "REVERSED"] } } } });
  return baris.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
}
async function bukuSeimbang() {
  const lines = await testPrisma.finJournalLine.findMany({ select: { debit: true, credit: true } });
  assert.equal(lines.reduce((a, l) => a + Number(l.debit), 0), lines.reduce((a, l) => a + Number(l.credit), 0), "buku besar harus seimbang");
}
const tautan = (refundId) => testPrisma.finRefundEvidenceLink.findMany({ where: { refundId }, include: { evidence: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

// ═══ 1. Jurnal: refund 200.000 + admin 2.500 ═══
test("refund 200.000 + biaya admin 2.500: Dr akun refund 200.000, Dr Beban Administrasi Bank 2.500, Cr rekening 202.500; nominal pelanggan tetap 200.000; total keluar 202.500", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx, { diakui: true, referensi: "TRF-998877" });
  const [j] = await jurnalPer(refund.id);
  assert.equal(sumD(j), 202_500); assert.equal(sumK(j), 202_500);
  const bank = j.lines.find((l) => l.cashAccountId === ctx.bank.id);
  assert.equal(Number(bank.credit), 202_500, "kredit rekening = total keluar");
  assert.equal(Number(j.lines.find((l) => l.account.systemKey === SYSTEM_KEYS.RETUR_PENJUALAN).debit), 200_000, "nominal pelanggan saja");
  assert.equal(Number(j.lines.find((l) => l.account.systemKey === SYSTEM_KEYS.BEBAN_ADMIN_BANK).debit), 2_500);
  assert.match(j.description, /\[Ref TRF-998877\]/);
  const r = await testPrisma.finRefund.findUnique({ where: { id: refund.id } });
  assert.equal(Number(r.amount), 200_000); assert.equal(Number(r.transferFeeAmount), 2_500); assert.equal(r.transferReference, "TRF-998877");
  assert.equal(await mutasiRekening(ctx.bank.id), -202_500);
  const list = (await ctx.a.get("/api/finance/refunds")).body.refunds.find((x) => x.id === refund.id);
  assert.deepEqual([list.nominalDiterima, list.biayaAdmin, list.totalKeluarRekening, list.jumlahBukti], [200_000, 2_500, 202_500, 1]);
  await bukuSeimbang();
});

// ═══ 2. Bukti: gunakan lama / tambah / ganti ═══
test("koreksi memakai bukti lama (lampiran legacy): dokumen pengganti membawa lampiran yang sama; dokumen lama tetap utuh", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx);
  const k = await koreksi(ctx, refund.id, { amount: 250_000 });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const baru = await testPrisma.finRefund.findUnique({ where: { id: k.body.baruId } });
  const lama = await testPrisma.finRefund.findUnique({ where: { id: refund.id } });
  assert.equal(baru.attachmentUrl, LAMPIRAN_LAMA);
  assert.equal(lama.attachmentUrl, LAMPIRAN_LAMA, "lampiran dokumen lama tidak berubah");
  assert.equal(lama.status, "DIBATALKAN"); assert.equal(baru.replacesRefundId, lama.id);
  assert.equal((await tautan(baru.id)).length, 0);
});

test("koreksi mengganti & menambah bukti: relasi eksplisit; bukti dokumen lama tetap melekat ke dokumen lama; bukti DIGUNAKAN tidak bisa diubah/dihapus (trigger DB)", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx);
  const a = await unggahOk(ctx, { isi: JPEG(80), nama: "transfer-1.jpg" });
  const k1 = await koreksi(ctx, refund.id, { amount: 250_000, bukti: { mode: "GANTI", ids: [a.id] } });
  assert.equal(k1.status, 201, JSON.stringify(k1.body));
  const v2 = k1.body.baruId;
  const baru2 = await testPrisma.finRefund.findUnique({ where: { id: v2 } });
  assert.equal(baru2.attachmentUrl, null, "GANTI: lampiran lama tidak dibawa");
  assert.deepEqual((await tautan(v2)).map((t) => [t.evidenceId, t.origin]), [[a.id, "BARU"]]);
  assert.equal((await testPrisma.finRefund.findUnique({ where: { id: refund.id } })).attachmentUrl, LAMPIRAN_LAMA);
  assert.equal((await testPrisma.finRefundEvidence.findUnique({ where: { id: a.id } })).status, "DIGUNAKAN");

  const b = await unggahOk(ctx, { isi: PDF(), nama: "slip.pdf", mime: "application/pdf" });
  const k2 = await koreksi(ctx, v2, { amount: 260_000, bukti: { mode: "TAMBAH", ids: [b.id] } });
  assert.equal(k2.status, 201, JSON.stringify(k2.body));
  const v3 = k2.body.baruId;
  assert.deepEqual((await tautan(v3)).map((t) => [t.evidenceId, t.origin]).sort(), [[a.id, "DIBAWA"], [b.id, "BARU"]].sort());
  assert.deepEqual((await tautan(v2)).map((t) => [t.evidenceId, t.origin]), [[a.id, "BARU"]], "bukti dokumen v2 tetap melekat ke v2");

  // immutabilitas di basis data
  await assert.rejects(() => testPrisma.finRefundEvidence.update({ where: { id: a.id }, data: { originalName: "diubah.jpg" } }), /REFUND_BUKTI_TETAP/);
  await assert.rejects(() => testPrisma.finRefundEvidence.update({ where: { id: a.id }, data: { status: "STAGED", attachedAt: null } }), /REFUND_BUKTI_TETAP|fin_refund_evidences_attached_chk/);
  await assert.rejects(() => testPrisma.finRefundEvidence.delete({ where: { id: a.id } }), /REFUND_BUKTI_TETAP|Foreign key|constraint/i);
  await assert.rejects(() => testPrisma.finRefundEvidenceLink.deleteMany({ where: { refundId: v2 } }), /REFUND_BUKTI_TETAP/);
  await assert.rejects(() => testPrisma.finRefundEvidenceLink.updateMany({ where: { refundId: v2 }, data: { origin: "BARU", refundId: v3 } }), /REFUND_BUKTI_TETAP|Unique/);
  await bukuSeimbang();
});

test("refund legacy TANPA bukti wajib upload saat dikoreksi; GANTI/TAMBAH tanpa berkas ditolak; gagal = tidak ada yang berubah", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx, { lampiran: null });
  const sebelum = { dok: await testPrisma.finRefund.count(), jurnal: await testPrisma.finJournalEntry.count() };
  const k0 = await koreksi(ctx, refund.id, { amount: 250_000 });
  assert.equal(k0.status, 422); assert.equal(k0.body.code, "BUKTI_WAJIB");
  assert.match(k0.body.error, /belum punya bukti transfer/i);
  const k1 = await koreksi(ctx, refund.id, { amount: 250_000, bukti: { mode: "GANTI", ids: [] } });
  assert.equal(k1.body.code, "BUKTI_BARU_WAJIB");
  const k2 = await koreksi(ctx, refund.id, { amount: 250_000, bukti: { mode: "LAMA", ids: [randomUUID()] } });
  assert.equal(k2.body.code, "BUKTI_MODE_TIDAK_SESUAI");
  const k3 = await koreksi(ctx, refund.id, { amount: 250_000, bukti: { mode: "GANTI", ids: [randomUUID()] } });
  assert.equal(k3.status, 409); assert.equal(k3.body.code, "BUKTI_TIDAK_ADA");
  assert.deepEqual({ dok: await testPrisma.finRefund.count(), jurnal: await testPrisma.finJournalEntry.count() }, sebelum);
  const a = await unggahOk(ctx);
  const ok = await koreksi(ctx, refund.id, { amount: 250_000, bukti: { mode: "GANTI", ids: [a.id] } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

// ═══ 3. Keamanan berkas ═══
test("MIME palsu (isi HTML berlabel image/jpeg + ekstensi .jpg) ditolak; >8 MB ditolak; tipe sah JPG/PNG/WEBP/PDF diterima dari ISI; tidak ada berkas tertinggal untuk yang ditolak", async () => {
  const ctx = await siapkan();
  const sebelum = berkasDiDisk().length;
  const palsu = await unggah(ctx.admin.token, { isi: Buffer.from("<html><script>alert(1)</script></html>".padEnd(64, " ")), nama: "evil.jpg", mime: "image/jpeg" });
  assert.equal(palsu.status, 415); assert.equal(palsu.body.code, "TIPE_TIDAK_DIIZINKAN");
  const exe = await unggah(ctx.admin.token, { isi: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]), nama: "x.pdf", mime: "application/pdf" });
  assert.equal(exe.status, 415);
  const besar = await unggah(ctx.admin.token, { isi: Buffer.concat([JPEG(), Buffer.alloc(8 * 1024 * 1024)]), nama: "besar.jpg" });
  assert.equal(besar.status, 413); assert.equal(besar.body.code, "BERKAS_TERLALU_BESAR");
  const kosong = await unggah(ctx.admin.token, { isi: Buffer.alloc(0), nama: "kosong.jpg" });
  assert.ok(kosong.status >= 400 && kosong.status < 500);
  assert.equal(berkasDiDisk().length, sebelum, "penolakan tidak meninggalkan berkas");
  assert.equal(await testPrisma.finRefundEvidence.count(), 0);
  for (const [isi, nama, mime, tipe] of [[JPEG(), "a.png", "image/png", "image/jpeg"], [PNG(), "b.jpg", "image/jpeg", "image/png"], [WEBP(), "c.bin", "application/octet-stream", "image/webp"], [PDF(), "d.jpg", "image/jpeg", "application/pdf"]]) {
    const r = await unggah(ctx.admin.token, { isi, nama, mime });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.bukti.tipe, tipe, `tipe dari ISI, bukan ekstensi/label (${nama})`);
  }
  assert.ok(berkasDiDisk().every((f) => /^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/.test(f)), "nama di disk acak, bukan nama klien");
});

test("akses: unggah hanya Admin Keuangan; lihat hanya Finance lewat URL bertanda-tangan pendek; peran lain/tanpa login/tanda tangan salah ditolak; berkas tidak disajikan statis", async () => {
  const ctx = await siapkan();
  assert.equal((await unggah(ctx.sales.token, { isi: JPEG() })).status, 403);
  assert.equal((await unggah(ctx.produksi.token, { isi: JPEG() })).status, 403);
  assert.equal((await unggah(ctx.finance.token, { isi: JPEG() })).status, 403, "FINANCE murni (tanpa finance:admin) tidak boleh mengunggah");
  assert.equal((await fetch(`${server.baseUrl}/api/finance/refunds/bukti/upload`, { method: "POST" })).status, 401);
  const a = await unggahOk(ctx);
  const rel = a.url.split("?")[0];
  // URL bertanda-tangan: tanpa Bearer sah; 5 menit.
  const ok = await fetch(server.baseUrl + a.url);
  assert.equal(ok.status, 200); assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.match(ok.headers.get("content-security-policy"), /sandbox/); assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  const exp = Number(new URL(server.baseUrl + a.url).searchParams.get("exp"));
  assert.ok(exp - Math.floor(Date.now() / 1000) <= 300 + 2, "umur tautan <= 5 menit");
  // tanpa tanda tangan & tanpa Bearer → 401; tanda tangan rusak/kedaluwarsa → 403; Bearer peran lain → 403; Bearer finance → 200
  assert.equal((await fetch(server.baseUrl + rel)).status, 401);
  assert.equal((await fetch(`${server.baseUrl}${rel}?exp=${exp}&sig=${"0".repeat(64)}`)).status, 403);
  assert.equal((await fetch(`${server.baseUrl}${rel}?exp=1&sig=${new URL(server.baseUrl + a.url).searchParams.get("sig")}`)).status, 403);
  assert.equal((await fetch(server.baseUrl + rel, { headers: { Authorization: `Bearer ${ctx.sales.token}` } })).status, 403);
  assert.equal((await fetch(server.baseUrl + rel, { headers: { Authorization: `Bearer ${ctx.produksi.token}` } })).status, 403);
  assert.equal((await fetch(server.baseUrl + rel, { headers: { Authorization: `Bearer ${ctx.finance.token}` } })).status, 200);
  // tanda tangan label lain (media nota biasa) tidak berlaku di sini
  const { signFile } = await import("../../src/lib/mediaSigning.js");
  const nama = rel.split("/").pop();
  const s2 = signFile(nama);
  assert.equal((await fetch(`${server.baseUrl}${rel}?exp=${s2.exp}&sig=${s2.sig}`)).status, 403, "tanda tangan media Finance lain tidak berlaku untuk bukti refund");
  // berkas tak terdaftar di DB → 404 walau ada di disk
  fs.writeFileSync(`${REFUND_BUKTI_DIR}/${"b".repeat(32)}.jpg`, JPEG());
  const { urlBertandaTangan } = await import("../../src/services/finance/refundBukti.js");
  assert.equal((await fetch(server.baseUrl + urlBertandaTangan(`${"b".repeat(32)}.jpg`))).status, 404);
  // daftar bukti dokumen: URL bertanda-tangan hanya untuk pembaca Finance
  const { refund } = await refundDisetujui(ctx);
  assert.equal((await ctx.s.get(`/api/finance/refunds/${refund.id}/bukti`)).status, 403);
  assert.equal((await ctx.p.get(`/api/finance/refunds/${refund.id}/bukti`)).status, 403);
  const daftar = await ctx.f.get(`/api/finance/refunds/${refund.id}/bukti`);
  assert.equal(daftar.status, 200); assert.equal(daftar.body.lampiranLama, LAMPIRAN_LAMA);
  // pengguna lain tidak bisa memakai bukti yang bukan miliknya, dan tidak bisa menghapusnya
  const admin2 = await createTestUser({ roles: ["ADMIN"] });
  const c2 = denganKunci(makeClient(server.baseUrl, admin2.token, { tanpaStepUp: true }));
  const k = await koreksi(ctx, refund.id, { amount: 250_000, bukti: { mode: "GANTI", ids: [a.id] } }, { klien: c2 });
  assert.equal(k.status, 403); assert.equal(k.body.code, "BUKTI_BUKAN_MILIK");
  assert.equal((await c2.delete(`/api/finance/refunds/bukti/${a.id}`)).status, 403);
});

// ═══ 4. Perubahan biaya admin ═══
test("koreksi biaya admin 2.500 → 0 → 2.500 → 5.000: jurnal lama dibalik utuh, pengganti seimbang, saldo rekening = total keluar, nominal pelanggan tetap 200.000, dokumen lama immutable", async () => {
  const ctx = await siapkan();
  const { refund: v1 } = await refundDisetujui(ctx, { diakui: true });
  const lama1 = await testPrisma.finRefund.findUnique({ where: { id: v1.id } });
  assert.equal(await mutasiRekening(ctx.bank.id), -202_500);

  // 2.500 → 0 (Sesama Bank)
  const k1 = await koreksi(ctx, v1.id, { paymentMethod: "TRANSFER", transferFeeType: "SESAMA_BANK" });
  assert.equal(k1.status, 201, JSON.stringify(k1.body));
  const v2 = await testPrisma.finRefund.findUnique({ where: { id: k1.body.baruId } });
  assert.deepEqual([Number(v2.amount), Number(v2.transferFeeAmount)], [200_000, 0]);
  assert.equal(await mutasiRekening(ctx.bank.id), -200_000, "saldo = total keluar (tanpa biaya)");
  assert.equal(await saldoAkun(SYSTEM_KEYS.BEBAN_ADMIN_BANK), 0, "biaya admin lama dibalik seluruhnya");
  const j1 = await jurnalPer(v1.id);
  assert.deepEqual(j1.map((e) => e.status), ["REVERSED"], "jurnal lama dibalik, bukan dihapus");
  assert.equal(j1[0].lines.find((l) => l.account.systemKey === SYSTEM_KEYS.BEBAN_ADMIN_BANK).debit.toString(), "2500", "isi jurnal lama tidak berubah");

  // 0 → 2.500 (BI-FAST)
  const k2 = await koreksi(ctx, v2.id, { transferFeeType: "BI_FAST" });
  assert.equal(k2.status, 201, JSON.stringify(k2.body));
  const v3 = await testPrisma.finRefund.findUnique({ where: { id: k2.body.baruId } });
  assert.equal(Number(v3.transferFeeAmount), 2_500);
  assert.equal(await mutasiRekening(ctx.bank.id), -202_500);
  assert.equal(await saldoAkun(SYSTEM_KEYS.BEBAN_ADMIN_BANK), 2_500);

  // 2.500 → 5.000 (Lainnya)
  const k3 = await koreksi(ctx, v3.id, { transferFeeType: "LAINNYA", transferFeeAmount: 5_000 });
  assert.equal(k3.status, 201, JSON.stringify(k3.body));
  const v4 = await testPrisma.finRefund.findUnique({ where: { id: k3.body.baruId } });
  assert.deepEqual([Number(v4.amount), Number(v4.transferFeeAmount)], [200_000, 5_000]);
  assert.equal(await mutasiRekening(ctx.bank.id), -205_000);
  assert.equal(await saldoAkun(SYSTEM_KEYS.BEBAN_ADMIN_BANK), 5_000);
  const [baru] = (await jurnalPer(v4.id)).filter((e) => e.status === "POSTED");
  assert.equal(sumD(baru), 205_000); assert.equal(sumK(baru), 205_000);
  assert.equal(Number(baru.lines.find((l) => l.cashAccountId === ctx.bank.id).credit), 205_000);

  // dokumen lama immutable: v1 hanya berubah status (DIBATALKAN) + alasan; angka & lampiran sama
  const lamaSesudah = await testPrisma.finRefund.findUnique({ where: { id: v1.id } });
  assert.deepEqual([Number(lamaSesudah.amount), Number(lamaSesudah.transferFeeAmount), lamaSesudah.attachmentUrl, lamaSesudah.date.toISOString()], [Number(lama1.amount), Number(lama1.transferFeeAmount), lama1.attachmentUrl, lama1.date.toISOString()]);
  assert.equal(lamaSesudah.status, "DIBATALKAN");
  // retur penjualan (nominal pelanggan) tidak pernah menyertakan biaya admin
  assert.equal(await saldoAkun(SYSTEM_KEYS.RETUR_PENJUALAN), 200_000);
  await bukuSeimbang();
});

test("pratinjau menunjukkan lama → baru (nominal, biaya admin, total keluar, rekening, tanggal, referensi), bukti, jurnal dibalik/pengganti, dampak saldo — dan TIDAK menulis apa pun", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx, { referensi: "REF-LAMA" });
  const a = await unggahOk(ctx);
  const hitung = async () => ({ dok: await testPrisma.finRefund.count(), jurnal: await testPrisma.finJournalEntry.count(), tautan: await testPrisma.finRefundEvidenceLink.count(), staged: await testPrisma.finRefundEvidence.count({ where: { status: "STAGED" } }), berkas: berkasDiDisk().length });
  const sebelum = await hitung();
  const pv = await ctx.a.post(`/api/finance/refunds/${refund.id}/koreksi`, {
    reason: "Rekening dan biaya berubah", amount: 250_000, date: "2026-09-25", cashAccountId: ctx.bank2.id, paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: 6_500,
    transferReference: "REF-BARU", bukti: { mode: "TAMBAH", ids: [a.id] }, preview: true,
  });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  const r = pv.body.pratinjau.refund;
  assert.deepEqual([r.nominalLama, r.nominalBaru, r.biayaAdminLama, r.biayaAdminBaru, r.totalKeluarLama, r.totalKeluarBaru], [200_000, 250_000, 2_500, 6_500, 202_500, 256_500]);
  assert.deepEqual([r.rekeningLama, r.rekeningBaru, r.tanggalLama, r.tanggalBaru, r.referensiLama, r.referensiBaru], ["BCA Operasional", "Mandiri", "2026-09-22", "2026-09-25", "REF-LAMA", "REF-BARU"]);
  assert.equal(r.bukti.lama.length, 1); assert.equal(r.bukti.pengganti.length, 2);
  assert.equal(r.bukti.pengganti.filter((b) => b.origin === "BARU").length, 1);
  assert.equal(pv.body.pratinjau.jurnalDibalik.length, 1); assert.equal(pv.body.pratinjau.jurnalPengganti.length, 1); assert.equal(pv.body.pratinjau.seimbang, true);
  const dampak = Object.fromEntries(pv.body.pratinjau.dampakSaldo.map((d) => [d.rekening, d.selisih]));
  assert.equal(dampak["BCA Operasional"], 202_500, "BCA kembali +202.500"); assert.equal(dampak["Mandiri"], -256_500, "Mandiri keluar 256.500");
  assert.deepEqual(await hitung(), sebelum, "pratinjau di-ROLLBACK: tidak ada dokumen, jurnal, tautan, status bukti, maupun berkas yang berubah");
  assert.equal((await testPrisma.finRefundEvidence.findUnique({ where: { id: a.id } })).status, "STAGED");
});

// ═══ 5. Akun biaya admin ═══
test("akun Beban Administrasi Bank tidak ada → koreksi dengan biaya admin gagal tertutup dengan arahan Indonesia; tanpa biaya admin tetap bisa", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx, { fee: "SESAMA_BANK" });
  await testPrisma.finAccount.update({ where: { systemKey: SYSTEM_KEYS.BEBAN_ADMIN_BANK }, data: { active: false } });
  const sebelum = { dok: await testPrisma.finRefund.count(), jurnal: await testPrisma.finJournalEntry.count() };
  const k = await koreksi(ctx, refund.id, { transferFeeType: "BI_FAST" });
  assert.equal(k.status, 409); assert.equal(k.body.code, "AKUN_BIAYA_ADMIN_BELUM_ADA");
  assert.match(k.body.error, /Beban Administrasi Bank/); assert.match(k.body.error, /Bagan Akun/);
  assert.deepEqual({ dok: await testPrisma.finRefund.count(), jurnal: await testPrisma.finJournalEntry.count() }, sebelum);
  const tanpa = await koreksi(ctx, refund.id, { amount: 210_000 });
  assert.equal(tanpa.status, 201, JSON.stringify(tanpa.body));
});

// ═══ 6. Idempotensi, revisi, paralel ═══
test("replay (Idempotency-Key sama) tidak menggandakan dokumen/jurnal/tautan/biaya; isi beda dengan kunci sama ditolak; tanpa kunci 428; revisi basis ditolak", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx);
  const a = await unggahOk(ctx);
  const body = { reason: "Naik biaya admin", transferFeeType: "LAINNYA", transferFeeAmount: 5_000, bukti: { mode: "GANTI", ids: [a.id] }, expectedUpdatedAt: await rev(refund.id) };
  const kunci = { "Idempotency-Key": `uji-${randomUUID()}` };
  assert.equal((await ctx.a0.post(`/api/finance/refunds/${refund.id}/koreksi`, body)).status, 428, "tanpa Idempotency-Key");
  const k1 = await ctx.a0.post(`/api/finance/refunds/${refund.id}/koreksi`, body, kunci);
  assert.equal(k1.status, 201, JSON.stringify(k1.body));
  const k2 = await ctx.a0.post(`/api/finance/refunds/${refund.id}/koreksi`, body, kunci);
  assert.ok([200, 201].includes(k2.status)); assert.equal(k2.body.baruId, k1.body.baruId);
  const k3 = await ctx.a0.post(`/api/finance/refunds/${refund.id}/koreksi`, { ...body, transferFeeAmount: 6_000 }, kunci);
  assert.equal(k3.status, 422);
  assert.equal(await testPrisma.finRefund.count(), 2);
  assert.equal(await testPrisma.finRefundEvidenceLink.count(), 1);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REFUND", status: "POSTED" } }), 1);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1);
  assert.equal(await saldoAkun(SYSTEM_KEYS.BEBAN_ADMIN_BANK), 5_000, "biaya admin hanya dicatat sekali");
  // dokumen yang sudah diganti
  const lagi = await koreksi(ctx, refund.id, { amount: 100_000 });
  assert.equal(lagi.status, 409); assert.equal(lagi.body.code, "SUDAH_DIGANTI");
  // revisi basi pada dokumen terbaru
  const b = await unggahOk(ctx);
  const basi = await ctx.a.post(`/api/finance/refunds/${k1.body.baruId}/koreksi`, { reason: "x lagi", amount: 210_000, bukti: { mode: "TAMBAH", ids: [b.id] }, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(basi.status, 409); assert.equal(basi.body.code, "REVISI_BERUBAH");
  const tanpaRev = await ctx.a.post(`/api/finance/refunds/${k1.body.baruId}/koreksi`, { reason: "x lagi", amount: 210_000, bukti: { mode: "TAMBAH", ids: [b.id] } });
  assert.equal(tanpaRev.status, 400); assert.equal(tanpaRev.body.code, "REVISI_WAJIB");
  assert.equal((await testPrisma.finRefundEvidence.findUnique({ where: { id: b.id } })).status, "STAGED", "kegagalan tidak memakai bukti");
});

test("dua koreksi PARALEL pada refund yang sama: tepat satu berhasil, satu 409; tidak ada dokumen/jurnal/tautan ganda", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx);
  const a = await unggahOk(ctx); const b = await unggahOk(ctx);
  const upd = await rev(refund.id);
  const kirim = (ids, nominal) => ctx.a.post(`/api/finance/refunds/${refund.id}/koreksi`, { reason: "Paralel dua penulis", amount: nominal, bukti: { mode: "GANTI", ids }, expectedUpdatedAt: upd });
  const [x, y] = await Promise.all([kirim([a.id], 210_000), kirim([b.id], 220_000)]);
  const kode = [x.status, y.status].sort();
  assert.deepEqual(kode, [201, 409], JSON.stringify([x.body, y.body]));
  assert.equal(await testPrisma.finRefund.count(), 2);
  assert.equal(await testPrisma.finRefundEvidenceLink.count(), 1);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REFUND", status: "POSTED" } }), 1);
  assert.equal(await testPrisma.finRefundEvidence.count({ where: { status: "DIGUNAKAN" } }), 1);
  assert.equal(await testPrisma.finRefundEvidence.count({ where: { status: "STAGED" } }), 1, "bukti pihak yang kalah tetap STAGED (bisa dipakai ulang atau dibersihkan)");
  await bukuSeimbang();
});

// ═══ 7. Periode / rekonsiliasi / dokumen tidak aktif ═══
test("diblokir: sudah dicocokkan ke mutasi bank, periode rekonsiliasi SELESAI, sudah diganti, belum disetujui — tanpa mengubah apa pun", async () => {
  const ctx = await siapkan();
  const a = await refundDisetujui(ctx);
  const baris = await testPrisma.finJournalLine.findFirst({ where: { cashAccountId: ctx.bank.id, entry: { source: "REFUND", sourceId: a.refund.id } } });
  const st = await testPrisma.finBankStatement.create({ data: { cashAccountId: ctx.bank.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), openingBalance: 0, closingBalance: 0, status: "DRAFT" } });
  await testPrisma.finBankStatementLine.create({ data: { statementId: st.id, date: new Date("2026-09-22"), description: "Refund", amount: -202500, status: "COCOK", matchedLineId: baris.id } });
  const k1 = await koreksi(ctx, a.refund.id, { amount: 210_000 });
  assert.equal(k1.status, 409); assert.equal(k1.body.code, "SUDAH_DIREKONSILIASI");

  const b = await refundDisetujui(ctx);
  await testPrisma.finBankStatement.create({ data: { cashAccountId: ctx.bank2.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), openingBalance: 0, closingBalance: 0, status: "SELESAI" } });
  const k2 = await koreksi(ctx, b.refund.id, { cashAccountId: ctx.bank2.id });
  assert.equal(k2.status, 409); assert.equal(k2.body.code, "PERIODE_REKON_SELESAI");

  const c = await ctx.a.post("/api/finance/refunds", { orderId: b.order.id, date: "2026-09-23", amount: 50_000, reason: "Tambahan", cashAccountId: ctx.bank.id, attachmentUrl: LAMPIRAN_LAMA });
  assert.equal(c.status, 201);
  const k3 = await koreksi(ctx, c.body.id, { amount: 40_000 });
  assert.equal(k3.status, 409); assert.equal(k3.body.code, "BELUM_DISETUJUI");
  // yang sudah diganti
  const dok = await testPrisma.finRefund.count(); const jr = await testPrisma.finJournalEntry.count();
  const k4 = await koreksi(ctx, a.refund.id, { amount: 210_000 });
  assert.equal(k4.status, 409);
  assert.deepEqual([await testPrisma.finRefund.count(), await testPrisma.finJournalEntry.count()], [dok, jr], "penolakan tidak mengubah apa pun");
  assert.equal(await testPrisma.finRefundEvidenceLink.count(), 0);
});

// ═══ 8. Potensi biaya admin ganda ═══
test("potensi biaya admin ganda: pengeluaran 'biaya admin bank' 2.500 di rekening & tanggal yang sama → peringatan di pratinjau; kecocokan KUAT butuh konfirmasi eksplisit; tidak menghapus transaksi itu; kecocokan lemah hanya peringatan", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx, { fee: "SESAMA_BANK", tanggal: "2026-09-22" });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "ADMIN_BANK" } });
  const e = await ctx.a.post("/api/finance/expenses", { date: "2026-09-22", amount: 2_500, description: "Biaya admin bank transfer refund Ibu Erni", categoryId: kat.id, cashAccountId: ctx.bank.id, mode: "LANGSUNG" });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  const ap = await ctx.a.post(`/api/finance/expenses/${e.body.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));

  const pv = await koreksi(ctx, refund.id, { transferFeeType: "BI_FAST", preview: true });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  const r = pv.body.pratinjau.refund;
  assert.equal(r.perluKonfirmasi, true);
  assert.equal(r.peringatan.length, 1); assert.equal(r.peringatan[0].tingkat, "KUAT"); assert.match(r.peringatan[0].pesan, /sudah tercatat di jurnal/);

  const sebelum = { dok: await testPrisma.finRefund.count(), exp: await testPrisma.finJournalEntry.count({ where: { source: "PENGELUARAN", status: "POSTED" } }) };
  const blok = await koreksi(ctx, refund.id, { transferFeeType: "BI_FAST" });
  assert.equal(blok.status, 409); assert.equal(blok.body.code, "BIAYA_ADMIN_GANDA");
  assert.equal(await testPrisma.finRefund.count(), sebelum.dok, "tidak ada yang tersimpan tanpa konfirmasi");
  const lolos = await koreksi(ctx, refund.id, { transferFeeType: "BI_FAST", konfirmasiBiayaGanda: true });
  assert.equal(lolos.status, 201, JSON.stringify(lolos.body));
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENGELUARAN", status: "POSTED" } }), sebelum.exp, "transaksi pengeluaran TIDAK dihapus/diubah sistem");
  const log = await testPrisma.activityEvent.findFirst({ where: { entityType: "fin_refund", entityId: refund.id, eventType: "DOCUMENT_CORRECTED" } });
  assert.equal(log.metadata.konfirmasiBiayaGanda, true); assert.ok(log.metadata.dugaanBiayaGanda.length >= 1);
});

test("kecocokan LEMAH (selisih 2 hari, tanpa referensi) hanya peringatan: koreksi tetap tersimpan tanpa konfirmasi; referensi transfer yang cocok menaikkannya jadi KUAT", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx, { fee: "SESAMA_BANK", tanggal: "2026-09-24" });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "ADMIN_BANK" } });
  const e = await ctx.a.post("/api/finance/expenses", { date: "2026-09-22", amount: 2_500, description: "Biaya admin bank TRF-555", categoryId: kat.id, cashAccountId: ctx.bank.id, mode: "LANGSUNG" });
  assert.equal((await ctx.a.post(`/api/finance/expenses/${e.body.id}/approve`, {})).status, 200);
  const pvLemah = await koreksi(ctx, refund.id, { transferFeeType: "BI_FAST", preview: true });
  assert.equal(pvLemah.body.pratinjau.refund.peringatan[0].tingkat, "LEMAH"); assert.equal(pvLemah.body.pratinjau.refund.perluKonfirmasi, false);
  const pvKuat = await koreksi(ctx, refund.id, { transferFeeType: "BI_FAST", transferReference: "TRF-555", preview: true });
  assert.equal(pvKuat.body.pratinjau.refund.peringatan[0].tingkat, "KUAT"); assert.equal(pvKuat.body.pratinjau.refund.peringatan[0].referensiCocok, true);
  const simpan = await koreksi(ctx, refund.id, { transferFeeType: "BI_FAST" });
  assert.equal(simpan.status, 201, JSON.stringify(simpan.body));
});

test("biaya admin TIDAK berubah dari dokumen lama: kandidat tetap ditampilkan sebagai peringatan, tetapi koreksi nominal tidak menuntut konfirmasi (tidak menambah eksposur)", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx, { fee: "BI_FAST", tanggal: "2026-09-22" });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "ADMIN_BANK" } });
  const e = await ctx.a.post("/api/finance/expenses", { date: "2026-09-22", amount: 2_500, description: "Biaya admin bank", categoryId: kat.id, cashAccountId: ctx.bank.id, mode: "LANGSUNG" });
  assert.equal((await ctx.a.post(`/api/finance/expenses/${e.body.id}/approve`, {})).status, 200);
  const pv = await koreksi(ctx, refund.id, { amount: 250_000, preview: true });
  assert.equal(pv.body.pratinjau.refund.peringatan[0].tingkat, "KUAT");
  assert.deepEqual([pv.body.pratinjau.refund.eksposurBaru, pv.body.pratinjau.refund.perluKonfirmasi], [false, false]);
  const simpan = await koreksi(ctx, refund.id, { amount: 250_000 });
  assert.equal(simpan.status, 201, JSON.stringify(simpan.body));
});

// ═══ 9. Laporan / export / mutasi ═══
test("laporan: refund = nominal pelanggan saja (Retur 200.000), biaya admin hanya di beban (2.500), mutasi bank = total keluar 202.500; export Excel tidak menghitung ganda dan memuat Referensi + Jumlah Bukti", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx, { diakui: true, referensi: "TRF-777" });
  const a = await unggahOk(ctx);
  const k = await koreksi(ctx, refund.id, { amount: 200_000, transferReference: "TRF-778", bukti: { mode: "TAMBAH", ids: [a.id] }, reason: "Tambah bukti & referensi" });
  assert.equal(k.status, 201, JSON.stringify(k.body));

  const lr = (await ctx.a.get("/api/finance/reports/income-statement?from=2026-09-01&to=2026-09-30")).body;
  assert.equal(lr.ringkasan.retur, 200_000, "laporan refund (retur) = nominal pelanggan saja, tanpa biaya admin");
  const bebanAdmin = lr.bebanOperasional.find((x) => /administrasi bank/i.test(x.name));
  assert.equal(bebanAdmin?.nilai, 2_500, "laporan biaya memuat biaya admin SEKALI (versi lama dibalik)");
  assert.equal(lr.ringkasan.bebanOperasional, 2_500);

  const mut = (await ctx.a.get(`/api/finance/buku/rekening/${ctx.bank.id}/mutasi?from=2026-09-01&to=2026-09-30&limit=100`)).body;
  const aktif = (mut.baris ?? mut.mutasi ?? mut.lines ?? []);
  const bersih = await mutasiRekening(ctx.bank.id);
  assert.equal(bersih, -202_500, "mutasi bank bersih = total keluar (pengeluaran asli dibalik, pengganti keluar sekali)");
  assert.ok(Array.isArray(aktif));
  assert.ok(JSON.stringify(mut).includes("202500"), "API Mutasi Kas & Bank memuat uang keluar 202.500 (total keluar)");
  assert.ok(!JSON.stringify(mut).includes("200000.00,\"kredit\""), "mutasi bank tidak memuat nominal pelanggan saja sebagai uang keluar");

  const r = await unduhExport(server.baseUrl, ctx.admin.token, "piutang-refund", { periode: { to: "2026-12-31" }, filter: {} });
  assert.equal(r.status, 200);
  const s = bacaSheet(r.wb, "Refund");
  const aktifRows = s.baris.filter((b) => b["Status"] === "Disetujui");
  assert.equal(aktifRows.length, 1, "hanya versi pengganti yang Disetujui");
  assert.deepEqual([aktifRows[0]["Nominal Refund (Rp)"], aktifRows[0]["Biaya Admin (Rp)"], aktifRows[0]["Total Keluar (Rp)"]], [200_000, 2_500, 202_500]);
  assert.equal(aktifRows[0]["Rekening"], "BCA Operasional"); assert.equal(aktifRows[0]["Referensi"], "TRF-778");
  assert.equal(aktifRows[0]["Jumlah Bukti"], 2, "lampiran lama + 1 bukti baru");
  assert.equal(s.total["Nominal Refund (Rp)"], 200_000); assert.equal(s.total["Biaya Admin (Rp)"], 2_500); assert.equal(s.total["Total Keluar (Rp)"], 202_500);
  assert.ok(s.header.includes("Referensi") && s.header.includes("Jumlah Bukti"));

  // riwayat: semua versi dengan biaya admin, bukti, pelaku, waktu, alasan
  const rw = (await ctx.a.get(`/api/finance/riwayat-versi/refunds/${k.body.baruId}`)).body;
  assert.equal(rw.versiRefund.length, 2);
  const [v1, v2] = rw.versiRefund;
  assert.deepEqual([v1.biayaAdmin, v1.totalKeluar, v1.jumlahBukti, v1.status, v1.referensi], [2_500, 202_500, 1, "DIBATALKAN", "TRF-777"]);
  assert.deepEqual([v2.biayaAdmin, v2.totalKeluar, v2.jumlahBukti, v2.status, v2.referensi], [2_500, 202_500, 2, "DISETUJUI", "TRF-778"]);
  assert.equal(v1.alasanKoreksi, "Tambah bukti & referensi"); assert.ok(v2.dibuatOleh !== undefined && v2.dibuatPada);
  assert.ok(!JSON.stringify(rw.versiRefund).includes("exp="), "riwayat tidak memuat URL berkas");
});

// ═══ 10. Berkas yatim ═══
test("tidak ada berkas yatim: gagal menyimpan baris → berkas dihapus; hapus bukti STAGED menghapus berkas; sapuan membersihkan yang basi; koreksi gagal tidak menghilangkan/mengunci bukti", async () => {
  const ctx = await siapkan();
  // (a) penyimpanan baris gagal → berkas ikut dihapus
  const sebelum = berkasDiDisk().length;
  const dbRusak = { finRefundEvidence: { count: async () => 0, deleteMany: async () => ({ count: 0 }), findMany: async () => [], create: async () => { throw new Error("DB gagal"); } } };
  await assert.rejects(() => unggahBukti(dbRusak, { berkas: { buffer: JPEG(), originalname: "x.jpg" }, userId: ctx.admin.user.id }), /DB gagal/);
  assert.equal(berkasDiDisk().length, sebelum, "berkas tidak tertinggal saat baris gagal tersimpan");
  // (b) hapus eksplisit (batal koreksi)
  const a = await unggahOk(ctx);
  assert.equal(berkasDiDisk().length, sebelum + 1);
  const del = await ctx.a.delete(`/api/finance/refunds/bukti/${a.id}`);
  assert.equal(del.status, 200); assert.equal(del.body.dihapus, true);
  assert.equal(berkasDiDisk().length, sebelum); assert.equal(await testPrisma.finRefundEvidence.count(), 0);
  // (c) sapuan bukti STAGED basi
  const b = await unggahOk(ctx);
  assert.equal((await bersihkanBuktiStaged(testPrisma)).dihapus, 0, "bukti yang baru diunggah tidak disapu");
  const sapu = await bersihkanBuktiStaged(testPrisma, { now: Date.now() + 3 * 60 * 60 * 1000 }); // 3 jam kemudian
  assert.equal(sapu.dihapus, 1); assert.equal(berkasDiDisk().length, sebelum);
  // (d) koreksi gagal (melebihi uang diterima) → bukti tetap STAGED, bisa dipakai ulang; berkas utuh
  const { refund } = await refundDisetujui(ctx, { bayar: 500_000, nominal: 300_000 });
  const c = await unggahOk(ctx);
  const gagal = await koreksi(ctx, refund.id, { amount: 900_000, bukti: { mode: "GANTI", ids: [c.id] } });
  assert.equal(gagal.status, 409); assert.equal(gagal.body.code, "MELEBIHI_UANG_DITERIMA");
  assert.equal((await testPrisma.finRefundEvidence.findUnique({ where: { id: c.id } })).status, "STAGED");
  assert.equal(berkasDiDisk().length, sebelum + 1);
  const ulang = await koreksi(ctx, refund.id, { amount: 250_000, bukti: { mode: "GANTI", ids: [c.id] } });
  assert.equal(ulang.status, 201, JSON.stringify(ulang.body));
  // bukti yang sudah dipakai tidak bisa dihapus lewat API
  const hapusDipakai = await ctx.a.delete(`/api/finance/refunds/bukti/${c.id}`);
  assert.equal(hapusDipakai.status, 409); assert.equal(hapusDipakai.body.code, "BUKTI_SUDAH_DIPAKAI");
  assert.equal(berkasDiDisk().length, sebelum + 1, "berkas bukti yang dipakai tetap ada");
});

test("refund lama tetap terbaca: biaya admin Rp0 dan bukti kosong; daftar tidak error; migrasi tidak mengisi kolom baru", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx, { fee: null, lampiran: null });
  const row = await testPrisma.finRefund.findUnique({ where: { id: refund.id } });
  assert.equal(Number(row.transferFeeAmount), 0); assert.equal(row.transferReference, null);
  const list = (await ctx.a.get("/api/finance/refunds")).body.refunds.find((x) => x.id === refund.id);
  assert.deepEqual([list.nominalDiterima, list.biayaAdmin, list.totalKeluarRekening, list.jumlahBukti], [200_000, 0, 200_000, 0]);
  const rw = await ctx.a.get(`/api/finance/riwayat-versi/refunds/${refund.id}`);
  assert.equal(rw.status, 200); assert.deepEqual([rw.body.versiRefund[0].biayaAdmin, rw.body.versiRefund[0].jumlahBukti], [0, 0]);
  assert.equal(await testPrisma.finRefundEvidence.count(), 0); assert.equal(await testPrisma.finRefundEvidenceLink.count(), 0);
});

// ═══ 11. Uji perilaku rehearsal skrip rilis (SQL yang SAMA) + guard rollback ═══
test("uji perilaku rehearsal pada skrip rilis: blok SQL menolak 14 data salah, meloloskan 6 data benar, lalu dibatalkan semua (bukti dipakai tak bisa diubah/dihapus; relasi append-only)", async () => {
  const skrip = fs.readFileSync(new URL("../../../scripts/release-refund-bukti-biaya-admin.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const m = /<<'UJISQL'\n([\s\S]*?)\nUJISQL\n/.exec(skrip);
  assert.ok(m, "blok UJISQL tidak ditemukan di skrip rilis");
  const ctx = await siapkan();
  await refundDisetujui(ctx); // contoh baris fin_refunds untuk blok uji
  const sebelum = { ev: await testPrisma.finRefundEvidence.count(), link: await testPrisma.finRefundEvidenceLink.count() };
  await assert.rejects(() => testPrisma.$executeRawUnsafe(m[1]), (e) => {
    const pesan = String(e.message);
    assert.ok(!/TIDAK_DITOLAK/.test(pesan), `ada data salah yang lolos: ${pesan.slice(0, 300)}`);
    assert.match(pesan, /ROLLBACK_UJI tolak=14 lolos=6/);
    return true;
  });
  assert.deepEqual({ ev: await testPrisma.finRefundEvidence.count(), link: await testPrisma.finRefundEvidenceLink.count() }, sebelum, "blok uji dibatalkan seluruhnya");
  assert.equal(await testPrisma.finRefund.count({ where: { transferReference: { not: null } } }), 0);
  assert.match(fs.readFileSync(new URL("../../../scripts/rollback-guard-refund-bukti-biaya-admin.sh", import.meta.url), "utf8"), /transfer_fee_amount > 0 and r\.created_at >= \(select finished_at from _prisma_migrations/);
});
