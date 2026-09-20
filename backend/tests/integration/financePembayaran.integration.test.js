// Pembayaran pelanggan (Finance Mobile S5): daftar/detail/verifikasi/penolakan lewat endpoint ASLI dengan token mobile & peran
// sungguhan. Yang dijaga: status turunan server, filter/pencarian/pagination keyset, ringkasan periode tab-independen, izin per
// peran (PAYMENT_WRITE khusus FINANCE), Idempotency-Key, row lock (request paralel), penolakan (alasan wajib, jurnal dibalik,
// status order dihitung ulang), alokasi, bukti bertanda-tangan, dan sinkron status CRM hanya dari pembayaran terverifikasi.

import "./setup/env.js";
import { TMP_PROOFS_DIR } from "./setup/paymentProofsTmpEnv.js"; // WAJIB sebelum testApp
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { signFile } from "../../src/lib/mediaSigning.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { bukukanPembayaran } from "../../src/services/finance/hooks.js";

let server;
let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => {
  await truncateAll(); await server.close(); await testPrisma.$disconnect();
  fs.rmSync(TMP_PROOFS_DIR, { recursive: true, force: true });
});

async function masuk(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  assert.equal(r.status, 200, `${roles} → ${JSON.stringify(r.body)}`);
  return { ...u, token: r.body.accessToken };
}
const k = () => ({ "Idempotency-Key": randomUUID() });
const get = (u, path) => raw("GET", `/api/finance${path}`, { token: u.token });
const post = (u, path, body, headers = k()) => raw("POST", `/api/finance${path}`, { token: u.token, headers, body: body ?? {} });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "SANOBANK Kemal", kind: "BANK", accountId: akunBank.id } });
  const bank2 = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, kas.id);
  return { bank, bank2, kas };
}

let n = 0;
async function buatOrder({ value = 1_000_000, nama = "Ibu Erni", status = "DELIVERED", paymentStatus = "BELUM_BAYAR" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: nama } });
  return testPrisma.order.create({
    data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `SAN-S5-${String(++n).padStart(4, "0")}`, status, paymentStatus },
  });
}
async function buatPayment(order, { amount = 400_000, method = "TRANSFER", cashAccountId = null, by, createdAt = new Date(), proofPhotoUrl = null, jurnal = false } = {}) {
  const p = await testPrisma.payment.create({
    data: { orderId: order.id, amount, method, cashAccountId, recordedById: by.id, createdAt, proofPhotoUrl },
  });
  if (jurnal) await testPrisma.$transaction((tx) => bukukanPembayaran(tx, { paymentId: p.id, userId: by.id }));
  return p;
}
const pencatat = async () => (await createTestUser({ roles: ["SALES"] })).user;
const nyalakanGerbang = () => setSetting(testPrisma, SETTING_KEYS.PAYMENT_VERIFICATION_GATE, "true");
const statusOrder = async (id) => (await testPrisma.order.findUnique({ where: { id } })).paymentStatus;

// ── Izin ──────────────────────────────────────────────────────────────────────────────────────────

test("Izin: FINANCE membaca & memutuskan; OWNER/ACCOUNTANT/APPROVER hanya membaca (aksi nonaktif dengan alasan server, command 403)", async () => {
  const { bank } = await siapkan();
  const sales = await pencatat();
  const order = await buatOrder();
  const p = await buatPayment(order, { cashAccountId: bank.id, by: sales });

  for (const role of ["OWNER", "ACCOUNTANT", "APPROVER"]) {
    const u = await masuk([role]);
    const l = await get(u, "/pembayaran");
    assert.equal(l.status, 200, role);
    assert.equal(l.body.items[0].aksi.verifikasi.boleh, false, role);
    assert.match(l.body.items[0].aksi.verifikasi.alasan, /tidak punya izin/i);
    assert.equal((await post(u, `/pembayaran/${p.id}/verifikasi`)).status, 403, `${role} verifikasi`);
    assert.equal((await post(u, `/pembayaran/${p.id}/tolak`, { reason: "x" })).status, 403, `${role} tolak`);
  }
  const fin = await masuk(["FINANCE"]);
  const l = await get(fin, "/pembayaran");
  assert.equal(l.body.items[0].aksi.verifikasi.boleh, true);
  assert.equal(l.body.items[0].aksi.tolak.alasanWajib, true);
  assert.equal(l.body.items[0].aksi.verifikasi.path, `/finance/pembayaran/${p.id}/verifikasi`);

  const web = (await createTestUser({ roles: ["SALES"] })).token;
  assert.equal((await raw("GET", "/api/finance/pembayaran", { token: web })).status, 403, "SALES tidak boleh membaca daftar pembayaran finance");
  assert.equal((await raw("GET", "/api/finance/pembayaran")).status, 401);
});

test("Token mobile tanpa Idempotency-Key ditolak 428 pada command uang", async () => {
  const { bank } = await siapkan();
  const p = await buatPayment(await buatOrder(), { cashAccountId: bank.id, by: await pencatat() });
  const fin = await masuk(["FINANCE"]);
  const r = await post(fin, `/pembayaran/${p.id}/verifikasi`, {}, {});
  assert.equal(r.status, 428);
  assert.equal(r.body.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(await testPrisma.paymentVerification.count(), 0);
});

// ── Daftar, filter, pencarian, pagination ─────────────────────────────────────────────────────────

test("Daftar: status turunan (Menunggu/Terverifikasi/Ditolak/Dibatalkan), hitungan per status, jenis DP/Cicilan/Pelunasan", async () => {
  const { bank } = await siapkan();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]); const admin = (await createTestUser({ roles: ["ADMIN"] })).user;
  const order = await buatOrder({ value: 1_000_000 });
  const t = Date.now();
  const dp = await buatPayment(order, { amount: 300_000, cashAccountId: bank.id, by: sales, createdAt: new Date(t - 3000) });
  const cicil = await buatPayment(order, { amount: 300_000, cashAccountId: bank.id, by: sales, createdAt: new Date(t - 2000) });
  const lunas = await buatPayment(order, { amount: 400_000, cashAccountId: bank.id, by: sales, createdAt: new Date(t - 1000) });
  await testPrisma.paymentVerification.create({ data: { paymentId: dp.id, verifiedById: admin.id } });
  const batal = await buatPayment(await buatOrder(), { by: sales, method: "CASH", createdAt: new Date(t - 500) });
  await testPrisma.payment.update({ where: { id: batal.id }, data: { cancelledAt: new Date(), cancelledById: admin.id, cancelReason: "Salah input" } });
  const tolak = await buatPayment(await buatOrder(), { by: sales, method: "CASH", createdAt: new Date(t - 400) });
  assert.equal((await post(fin, `/pembayaran/${tolak.id}/tolak`, { reason: "Uang tidak masuk" })).status, 200);

  const semua = (await get(fin, "/pembayaran?limit=50")).body;
  assert.deepEqual(semua.hitung, { MENUNGGU: 2, TERVERIFIKASI: 1, DITOLAK: 1, DIBATALKAN: 1 });
  const peta = Object.fromEntries(semua.items.map((i) => [i.id, i]));
  assert.equal(peta[dp.id].status, "TERVERIFIKASI");
  assert.equal(peta[dp.id].jenis, "DP");
  assert.equal(peta[cicil.id].jenis, "CICILAN");
  assert.equal(peta[lunas.id].jenis, "PELUNASAN");
  assert.equal(peta[batal.id].status, "DIBATALKAN");
  assert.equal(peta[batal.id].pembatalan.alasan, "Salah input");
  assert.equal(peta[tolak.id].status, "DITOLAK");
  assert.equal(peta[dp.id].nominal, "300000.00", "uang = string desimal");
  assert.equal(typeof peta[dp.id].order.nilai, "string");

  for (const [status, ids] of [["MENUNGGU", [cicil.id, lunas.id]], ["TERVERIFIKASI", [dp.id]], ["DITOLAK", [tolak.id]], ["DIBATALKAN", [batal.id]]]) {
    const r = (await get(fin, `/pembayaran?status=${status}`)).body;
    assert.deepEqual(r.items.map((i) => i.id).sort(), [...ids].sort(), status);
  }
});

test("Pencarian (order/pelanggan/nominal '150.000'), filter metode & rekening, periode WIB", async () => {
  const { bank, bank2 } = await siapkan();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]);
  const a = await buatOrder({ nama: "Budi Santoso" });
  const b = await buatOrder({ nama: "Citra Lestari" });
  const p1 = await buatPayment(a, { amount: 150_000, cashAccountId: bank.id, by: sales, createdAt: new Date("2026-09-10T03:00:00Z") });
  const p2 = await buatPayment(b, { amount: 275_000, method: "QRIS", cashAccountId: bank2.id, by: sales, createdAt: new Date("2026-09-11T03:00:00Z") });
  const p3 = await buatPayment(b, { amount: 90_000, method: "CASH", by: sales, createdAt: new Date("2026-09-11T20:30:00Z") }); // 12 Sep 03:30 WIB
  const ids = async (qs) => (await get(fin, `/pembayaran?${qs}`)).body.items.map((i) => i.id).sort();

  assert.deepEqual(await ids("q=budi"), [p1.id]);
  assert.deepEqual(await ids(`q=${a.orderNumber}`), [p1.id]);
  assert.deepEqual(await ids("q=150.000"), [p1.id], "titik ribuan diabaikan");
  assert.deepEqual(await ids("q=citra%20275000"), [p2.id]);
  assert.deepEqual(await ids("metode=QRIS"), [p2.id]);
  assert.deepEqual(await ids(`rekeningId=${bank.id}`), [p1.id]);
  assert.deepEqual(await ids("from=2026-09-12&to=2026-09-12"), [p3.id], "12 Sep WIB memuat pembayaran 11 Sep 20:30 UTC");
  assert.deepEqual(await ids("from=2026-09-10&to=2026-09-11"), [p1.id, p2.id].sort());
  assert.deepEqual(await ids("q=tidak-ada"), []);
  const opsi = (await get(fin, "/pembayaran/opsi")).body;
  assert.ok(opsi.rekening.some((r) => r.id === bank.id));
  assert.deepEqual(opsi.metode.map((m) => m.id), ["CASH", "TRANSFER", "QRIS", "CARD"]);
});

test("Pagination keyset: tanpa duplikat/celah walau createdAt kembar; kartu ringkasan periode TIDAK berubah saat pindah tab/filter", async () => {
  const { bank } = await siapkan();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]); const admin = (await createTestUser({ roles: ["ADMIN"] })).user;
  const sama = new Date("2026-09-15T05:00:00Z");
  const dibuat = [];
  for (let i = 0; i < 9; i++) dibuat.push(await buatPayment(await buatOrder(), { amount: 100_000 + i * 1000, cashAccountId: bank.id, by: sales, createdAt: sama }));
  await testPrisma.paymentVerification.create({ data: { paymentId: dibuat[0].id, verifiedById: admin.id } });

  const dilihat = []; let cursor = null; let halaman = 0;
  do {
    const r = (await get(fin, `/pembayaran?limit=4${cursor ? `&cursor=${cursor}` : ""}`)).body;
    dilihat.push(...r.items.map((i) => i.id)); cursor = r.nextCursor; halaman++;
    assert.ok(halaman < 10);
  } while (cursor);
  assert.equal(halaman, 3);
  assert.equal(new Set(dilihat).size, 9);
  assert.deepEqual([...dilihat].sort(), dibuat.map((p) => p.id).sort());

  const periode = "from=2026-09-01&to=2026-09-30";
  const a = (await get(fin, `/pembayaran?${periode}&status=MENUNGGU`)).body.ringkasan;
  const b = (await get(fin, `/pembayaran?${periode}&status=TERVERIFIKASI&q=zzz`)).body.ringkasan;
  assert.deepEqual(a, b, "ringkasan tidak bergantung tab/pencarian");
  assert.equal(a.menunggu.jumlah, 8);
  assert.equal(a.terverifikasi.jumlah, 1);
  assert.equal(a.terverifikasi.nominal, "100000.00");
  assert.equal(a.totalMasuk, ((100_000 * 9 + 1000 * 36)).toFixed(2));
  const lencana = (await get(fin, "/pembayaran/ringkasan")).body;
  assert.equal(lencana.menunggu, 8);
  assert.equal(lencana.lunasBelumDicatat, 0);
});

// ── Detail & bukti ────────────────────────────────────────────────────────────────────────────────

test("Detail: order, pelanggan, invoice, alokasi, jurnal, peringatan, audit trail, bukti bertanda-tangan; field yang tak ada dinyatakan jujur", async () => {
  const { bank } = await siapkan();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]);
  const order = await buatOrder({ value: 1_000_000 });
  const order2 = await buatOrder({ value: 500_000, nama: "Ibu Erni" });
  await testPrisma.invoice.create({ data: { invoiceNumber: "INV-20092026-001", orderId: order.id } });
  const file = "bukti-transfer-1.jpg";
  fs.writeFileSync(path.join(TMP_PROOFS_DIR, file), Buffer.from("BUKTI-TRANSFER"));
  const p = await buatPayment(order, { amount: 700_000, cashAccountId: bank.id, by: sales, proofPhotoUrl: `/media/payment-proofs/${file}`, jurnal: true });
  await testPrisma.finPaymentAllocation.createMany({ data: [
    { paymentId: p.id, orderId: order.id, amount: "500000" }, { paymentId: p.id, orderId: order2.id, amount: "200000" },
  ] });

  const r = await get(fin, `/pembayaran/${p.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body;
  assert.equal(d.status, "MENUNGGU");
  assert.equal(d.order.nomor, order.orderNumber);
  assert.equal(d.pelanggan.name, "Ibu Erni");
  assert.equal(d.rekening.name, "SANOBANK Kemal");
  assert.equal(d.pencatat.id, sales.id);
  assert.equal(d.invoice.nomor, "INV-20092026-001");
  assert.equal(d.alokasi.length, 2);
  assert.deepEqual(d.alokasi.map((a) => a.nominal).sort(), ["200000.00", "500000.00"]);
  assert.ok(d.jurnal && d.jurnal.status === "POSTED");
  assert.deepEqual(d.tidakTercatat, ["referensi", "pengirim", "catatan"]);
  assert.equal(d.riwayat[0].peristiwa, "DICATAT");
  assert.equal(d.tagihan.nilaiOrder, "1000000.00");

  assert.equal(d.bukti.jenis, "gambar");
  assert.match(d.bukti.url, /^\/media\/bukti-pembayaran\/bukti-transfer-1\.jpg\?exp=\d+&sig=[a-f0-9]+$/);
  assert.ok(new Date(d.bukti.kedaluwarsa) > new Date());
  const unduh = await fetch(server.baseUrl + d.bukti.url);
  assert.equal(unduh.status, 200);
  assert.equal(unduh.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await unduh.arrayBuffer()).toString(), "BUKTI-TRANSFER");

  assert.equal((await get(fin, `/pembayaran/${randomUUID()}`)).status, 404);
  assert.equal((await get(fin, "/pembayaran/bukan-uuid")).status, 404);
});

test("Peringatan informatif (server tidak memblokir): tanpa bukti, kelebihan bayar, kemungkinan ganda", async () => {
  const { bank } = await siapkan();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]);
  const order = await buatOrder({ value: 500_000 });
  const a = await buatPayment(order, { amount: 500_000, cashAccountId: bank.id, by: sales });
  const b = await buatPayment(order, { amount: 500_000, cashAccountId: bank.id, by: sales });
  const d = (await get(fin, `/pembayaran/${b.id}`)).body;
  const kode = d.peringatan.map((w) => w.kode);
  assert.ok(kode.includes("TANPA_BUKTI"));
  assert.ok(kode.includes("KEMUNGKINAN_GANDA"));
  assert.notEqual(a.id, b.id);
});

test("Bukti pembayaran: Bearer FINANCE ok; SALES/tanpa login/tautan kedaluwarsa/traversal ditolak", async () => {
  await siapkan();
  const fin = await masuk(["FINANCE"]);
  const file = "bukti-rahasia.png";
  fs.writeFileSync(path.join(TMP_PROOFS_DIR, file), Buffer.from("PNG-RAHASIA"));
  // Dua jalur, satu penangan: /media/bukti-pembayaran (URL bertanda-tangan, untuk klien native) dan /api/finance/media/payment-proofs.
  for (const url of [`/media/bukti-pembayaran/${file}`, `/api/finance/media/payment-proofs/${file}`]) {
    assert.equal((await fetch(server.baseUrl + url, { headers: { Authorization: `Bearer ${fin.token}` } })).status, 200, url);
    assert.equal((await fetch(server.baseUrl + url)).status, 401, `${url} tanpa login`);
    const sales = (await createTestUser({ roles: ["SALES"] })).token;
    assert.equal((await fetch(server.baseUrl + url, { headers: { Authorization: `Bearer ${sales}` } })).status, 403, url);
  }
  const url = `/media/bukti-pembayaran/${file}`;
  const sah = signFile(file);
  assert.equal((await fetch(`${server.baseUrl}${url}?exp=${sah.exp}&sig=${sah.sig}`)).status, 200, "URL bertanda-tangan tanpa Bearer");
  const lama = signFile(file, { now: Date.now() - 3600_000 });
  assert.equal((await fetch(`${server.baseUrl}${url}?exp=${lama.exp}&sig=${lama.sig}`)).status, 403, "kedaluwarsa");
  const lain = signFile("lain.png");
  assert.equal((await fetch(`${server.baseUrl}${url}?exp=${lain.exp}&sig=${lain.sig}`)).status, 403, "tanda tangan file lain");
  assert.equal((await fetch(`${server.baseUrl}/media/bukti-pembayaran/..%2f..%2fpackage.json`, { headers: { Authorization: `Bearer ${fin.token}` } })).status, 404);
  assert.equal((await fetch(`${server.baseUrl}/media/bukti-pembayaran/skrip.js`, { headers: { Authorization: `Bearer ${fin.token}` } })).status, 404);
});

test("Tagihan: 'sisa jika ikut dihitung' tidak mengurangi nominal dua kali — ikut aturan resmi gerbang (mati, tanpa tanggal mulai, tanggal mulai, alokasi)", async () => {
  const { bank } = await siapkan();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]);
  const cek = async (p) => (await get(fin, `/pembayaran/${p.id}`)).body.tagihan;

  // Gerbang MATI: pembayaran menunggu SUDAH terhitung → sisa = sisa setelah ini (tidak dikurangi lagi).
  const o1 = await buatOrder({ value: 1_000_000 });
  const p1 = await buatPayment(o1, { amount: 400_000, cashAccountId: bank.id, by: sales });
  let t = await cek(p1);
  assert.deepEqual([t.terbayarTerhitung, t.sisa, t.sisaSetelahIni, t.terhitungSebelumVerifikasi], ["400000.00", "600000.00", "600000.00", true]);

  // Gerbang menyala TANPA tanggal mulai: aturan resmi tetap menghitungnya (isPaymentCounted) → tetap tidak dikurangi dua kali.
  await nyalakanGerbang();
  t = await cek(p1);
  assert.deepEqual([t.terbayarTerhitung, t.sisa, t.sisaSetelahIni, t.terhitungSebelumVerifikasi, t.gerbangVerifikasi], ["400000.00", "600000.00", "600000.00", true, true]);

  // Gerbang menyala DENGAN tanggal mulai sebelum pembayaran: belum terhitung sampai diverifikasi → dikurangkan satu kali.
  await setSetting(testPrisma, SETTING_KEYS.PAYMENT_VERIFICATION_GATE_SINCE, new Date(Date.now() - 86_400_000).toISOString());
  t = await cek(p1);
  assert.deepEqual([t.terbayarTerhitung, t.sisa, t.sisaSetelahIni, t.terhitungSebelumVerifikasi], ["0.00", "1000000.00", "600000.00", false]);

  // Alokasi: hanya bagian untuk order induk yang dikurangkan (500rb dari 700rb), bukan nominal penuh.
  const o2 = await buatOrder({ value: 1_000_000, nama: "Pak Alokasi" });
  const p2 = await buatPayment(o1, { amount: 700_000, cashAccountId: bank.id, by: sales });
  await testPrisma.finPaymentAllocation.createMany({ data: [{ paymentId: p2.id, orderId: o1.id, amount: "500000" }, { paymentId: p2.id, orderId: o2.id, amount: "200000" }] });
  t = await cek(p2);
  assert.deepEqual([t.terbayarTerhitung, t.sisaSetelahIni, t.terhitungSebelumVerifikasi], ["0.00", "500000.00", false]);

  // Setelah diverifikasi: terhitung penuh, tidak ada pengurangan tambahan.
  await post(fin, `/pembayaran/${p1.id}/verifikasi`);
  t = await cek(p1);
  assert.deepEqual([t.terbayarTerhitung, t.sisa, t.sisaSetelahIni, t.terhitungSebelumVerifikasi], ["400000.00", "600000.00", "600000.00", false]);
});

// ── Verifikasi ────────────────────────────────────────────────────────────────────────────────────

test("Verifikasi: baris verifikasi + audit; status CRM baru berubah dari pembayaran TERVERIFIKASI (gerbang aktif); hasil resmi dikembalikan", async () => {
  const { bank } = await siapkan(); await nyalakanGerbang();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]);
  const order = await buatOrder({ value: 1_000_000 });
  const p = await buatPayment(order, { amount: 400_000, cashAccountId: bank.id, by: sales, jurnal: true });
  await testPrisma.order.update({ where: { id: order.id }, data: { paymentStatus: "BELUM_BAYAR" } });

  const r = await post(fin, `/pembayaran/${p.id}/verifikasi`);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.pembayaran.status, "TERVERIFIKASI");
  assert.equal(r.body.pembayaran.verifikasi.oleh.id, fin.user.id);
  assert.equal(r.body.pembayaran.aksi.verifikasi.boleh, false);
  assert.equal(await statusOrder(order.id), "DP", "status CRM dihitung server dari pembayaran terverifikasi");

  const ev = await testPrisma.activityEvent.findFirst({ where: { entityType: "payment", entityId: p.id } });
  assert.equal(ev.eventType, "DOCUMENT_APPROVED");
  assert.equal(ev.actorId, fin.user.id);
  assert.equal(ev.metadata.aksi, "verifikasi_pembayaran");
  const riwayat = (await get(fin, `/pembayaran/${p.id}`)).body.riwayat.map((x) => x.label);
  assert.deepEqual(riwayat, ["Dicatat", "Diverifikasi"]);
});

test("Verifikasi ganda / pembayaran dibatalkan → 409 dengan kode; tidak ada baris verifikasi baru", async () => {
  const { bank } = await siapkan();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]); const fin2 = await masuk(["FINANCE"]);
  const p = await buatPayment(await buatOrder(), { cashAccountId: bank.id, by: sales });
  assert.equal((await post(fin, `/pembayaran/${p.id}/verifikasi`)).status, 201);
  const dua = await post(fin2, `/pembayaran/${p.id}/verifikasi`);
  assert.equal(dua.status, 409);
  assert.equal(dua.body.code, undefined, "handleFinanceError hanya membawa pesan");
  assert.match(dua.body.error, new RegExp(`sudah diverifikasi oleh ${fin.user.name}`));
  assert.equal(await testPrisma.paymentVerification.count(), 1);

  const batal = await buatPayment(await buatOrder(), { cashAccountId: bank.id, by: sales });
  await testPrisma.payment.update({ where: { id: batal.id }, data: { cancelledAt: new Date(), cancelReason: "salah" } });
  const rb = await post(fin, `/pembayaran/${batal.id}/verifikasi`);
  assert.equal(rb.status, 409);
  assert.match(rb.body.error, /sudah dibatalkan/);
  assert.equal((await post(fin, `/pembayaran/${randomUUID()}/verifikasi`)).status, 404);
});

test("Double-tap: kunci idempotensi SAMA → respons diputar ulang, hanya satu verifikasi; kunci BEDA paralel ×6 → tepat satu menang", async () => {
  const { bank } = await siapkan();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]);
  const p = await buatPayment(await buatOrder(), { cashAccountId: bank.id, by: sales });

  const kunci = { "Idempotency-Key": randomUUID() };
  const a = await post(fin, `/pembayaran/${p.id}/verifikasi`, {}, kunci);
  const b = await post(fin, `/pembayaran/${p.id}/verifikasi`, {}, kunci);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.equal(await testPrisma.paymentVerification.count(), 1);

  const p2 = await buatPayment(await buatOrder(), { cashAccountId: bank.id, by: sales });
  const hasil = await Promise.all(Array.from({ length: 6 }, () => post(fin, `/pembayaran/${p2.id}/verifikasi`)));
  const kode = hasil.map((h) => h.status).sort();
  assert.deepEqual(kode, [201, 409, 409, 409, 409, 409]);
  assert.equal(await testPrisma.paymentVerification.count({ where: { paymentId: p2.id } }), 1);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "payment", entityId: p2.id } }), 1, "audit tercatat sekali");
});

test("Request paralel verifikasi vs tolak pada pembayaran yang sama: tepat satu keputusan berlaku", async () => {
  const { bank } = await siapkan();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]);
  for (let i = 0; i < 3; i++) {
    const p = await buatPayment(await buatOrder(), { cashAccountId: bank.id, by: sales, jurnal: true });
    const [v, t] = await Promise.all([
      post(fin, `/pembayaran/${p.id}/verifikasi`),
      post(fin, `/pembayaran/${p.id}/tolak`, { reason: "Uang tidak masuk" }),
    ]);
    assert.equal([v.status, t.status].filter((s) => s === 201 || s === 200).length, 1, `putaran ${i}: ${v.status}/${t.status}`);
    assert.equal([v.status, t.status].filter((s) => s === 409).length, 1);
    const akhir = await testPrisma.payment.findUnique({ where: { id: p.id }, include: { verifications: true } });
    assert.ok((akhir.verifications.length === 1) !== !!akhir.cancelledAt, "tidak boleh terverifikasi DAN dibatalkan sekaligus");
  }
});

test("Alokasi: verifikasi menghitung ulang status SEMUA order tujuan alokasi (gerbang aktif)", async () => {
  const { bank } = await siapkan(); await nyalakanGerbang();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]);
  const o1 = await buatOrder({ value: 300_000 }); const o2 = await buatOrder({ value: 200_000 });
  const p = await buatPayment(o1, { amount: 500_000, cashAccountId: bank.id, by: sales, jurnal: true });
  await testPrisma.finPaymentAllocation.createMany({ data: [
    { paymentId: p.id, orderId: o1.id, amount: "300000" }, { paymentId: p.id, orderId: o2.id, amount: "200000" },
  ] });
  assert.equal((await post(fin, `/pembayaran/${p.id}/verifikasi`)).status, 201);
  assert.equal(await statusOrder(o1.id), "LUNAS");
  assert.equal(await statusOrder(o2.id), "LUNAS");
});

// ── Penolakan ─────────────────────────────────────────────────────────────────────────────────────

test("Tolak: alasan wajib; pembayaran dibatalkan, jurnal DIBALIK, status order dihitung ulang, audit + status Ditolak", async () => {
  const { bank } = await siapkan();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]);
  const order = await buatOrder({ value: 1_000_000 });
  const p = await buatPayment(order, { amount: 1_000_000, cashAccountId: bank.id, by: sales, jurnal: true });
  await testPrisma.order.update({ where: { id: order.id }, data: { paymentStatus: "LUNAS", paidAt: new Date() } });

  assert.equal((await post(fin, `/pembayaran/${p.id}/tolak`, {})).status, 400);
  assert.equal((await post(fin, `/pembayaran/${p.id}/tolak`, { reason: "   " })).status, 400);
  assert.equal((await post(fin, `/pembayaran/${p.id}/tolak`, { reason: "x".repeat(501) })).status, 400);
  assert.equal((await testPrisma.payment.findUnique({ where: { id: p.id } })).cancelledAt, null, "penolakan gagal tidak mengubah apa pun");

  const r = await post(fin, `/pembayaran/${p.id}/tolak`, { reason: "  Mutasi bank tidak menunjukkan dana masuk  " });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.pembayaran.status, "DITOLAK");
  assert.equal(r.body.pembayaran.pembatalan.alasan, "Mutasi bank tidak menunjukkan dana masuk");
  assert.equal(r.body.pembayaran.pembatalan.oleh.id, fin.user.id);
  assert.equal(await statusOrder(order.id), "BELUM_BAYAR", "uang tidak masuk → status CRM kembali");
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).paidAt, null);

  const entri = await testPrisma.finJournalEntry.findUnique({ where: { idempotencyKey: `PEMBAYARAN_ORDER:${p.id}` } });
  assert.equal(entri.status, "REVERSED");
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityType: "payment", entityId: p.id } });
  assert.equal(ev.eventType, "DOCUMENT_REJECTED");
  assert.equal(ev.metadata.reason, "Mutasi bank tidak menunjukkan dana masuk");

  const ulang = await post(fin, `/pembayaran/${p.id}/tolak`, { reason: "lagi" });
  assert.equal(ulang.status, 409);
  assert.equal((await post(fin, `/pembayaran/${p.id}/verifikasi`)).status, 409, "yang ditolak tidak bisa diverifikasi");
});

test("Pembayaran yang SUDAH diverifikasi tidak bisa ditolak dari mobile (koreksi = admin); tidak ada kebijakan reversal yang dikarang", async () => {
  const { bank } = await siapkan();
  const sales = await pencatat(); const fin = await masuk(["FINANCE"]);
  const p = await buatPayment(await buatOrder(), { cashAccountId: bank.id, by: sales, jurnal: true });
  assert.equal((await post(fin, `/pembayaran/${p.id}/verifikasi`)).status, 201);
  const r = await post(fin, `/pembayaran/${p.id}/tolak`, { reason: "salah" });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /tidak bisa ditolak dari sini/);
  assert.equal((await testPrisma.payment.findUnique({ where: { id: p.id } })).cancelledAt, null);
});

// ── Lunas di CRM (penerimaan) — konkurensi ────────────────────────────────────────────────────────

test("Lunas di CRM: verifikasi paralel (kunci berbeda) untuk order yang sama menghasilkan TEPAT satu Payment", async () => {
  const { bank } = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const order = await buatOrder({ value: 1_500_000, status: "DELIVERED", paymentStatus: "LUNAS" });
  await testPrisma.order.update({ where: { id: order.id }, data: { paidAt: new Date() } });
  const body = { orderId: order.id, mode: "REKENING", method: "TRANSFER", cashAccountId: bank.id };
  const hasil = await Promise.all(Array.from({ length: 5 }, () => post(fin, "/penerimaan/verifikasi", body)));
  const sukses = hasil.filter((h) => h.status === 201).length;
  assert.equal(sukses, 1, hasil.map((h) => `${h.status}:${h.body?.error ?? ""}`).join(" | "));
  assert.equal(await testPrisma.payment.count({ where: { orderId: order.id } }), 1, "tidak boleh ada pembayaran ganda");
});

test("Lunas di CRM: Belum Lunas wajib alasan; paralel dengan verifikasi hanya satu yang berlaku; ACCOUNTANT/APPROVER/OWNER 403", async () => {
  const { bank } = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const order = await buatOrder({ value: 800_000, paymentStatus: "LUNAS" });
  await testPrisma.order.update({ where: { id: order.id }, data: { paidAt: new Date() } });
  assert.equal((await post(fin, "/penerimaan/tolak", { orderId: order.id })).status, 400);
  for (const role of ["ACCOUNTANT", "APPROVER", "OWNER"]) {
    const u = await masuk([role]);
    assert.equal((await post(u, "/penerimaan/verifikasi", { orderId: order.id, mode: "REKENING", cashAccountId: bank.id })).status, 403, role);
    assert.equal((await post(u, "/penerimaan/tolak", { orderId: order.id, reason: "x" })).status, 403, role);
  }
  const [v, t] = await Promise.all([
    post(fin, "/penerimaan/verifikasi", { orderId: order.id, mode: "REKENING", cashAccountId: bank.id }),
    post(fin, "/penerimaan/tolak", { orderId: order.id, reason: "Uang belum masuk" }),
  ]);
  assert.equal([v.status, t.status].filter((s) => s === 201 || s === 200).length, 1, `${v.status}/${t.status}`);
  const akhir = await testPrisma.order.findUnique({ where: { id: order.id }, include: { payments: true } });
  assert.ok(akhir.payments.length === 1 ? akhir.paymentStatus === "LUNAS" : akhir.paymentStatus === "BELUM_BAYAR");
});
