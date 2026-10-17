// KOREKSI PER DOKUMEN — pengakuan pendapatan terkendali (order Rp0 & diserahkan-belum-diakui), penetapan harga, keputusan atribusi divisi.
// Dikunci: bukti sumber/penyebab/tanggal serah/pratinjau jurnal/dampak; tidak menebak harga-tanggal-nilai; tidak ada massal; idempoten (replay, paralel); periode tertutup; pra-cutoff;
// pembalikan aman (transaksi bergantung ditolak); atomik; izin + PIN step-up + Idempotency-Key; pratinjau tidak menulis; keputusan atribusi tidak mengubah jurnal/total beban.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postPaymentReceived, postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { reverseJournal } from "../../src/services/finance/journal.js";
import { recomputeOrderPaymentStatus } from "../../src/services/paymentLedger.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const NOTA = "/media/finance-receipts/tes.jpg";
const D = (s) => new Date(`${s}T00:00:00.000Z`);
const WIB = (s, jam = 10) => new Date(`${s}T${String(jam).padStart(2, "0")}:00:00.000+07:00`);
let seq = 0; let kunci = 0;
const IK = () => ({ "Idempotency-Key": `uji-koreksi-${Date.now()}-${++kunci}` });

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const k = (u, o) => makeClient(server.baseUrl, u.token, o);
  return { bank, admin, fin, sales, a: k(admin), aTanpa: k(admin, { tanpaStepUp: true }), f: k(fin), s: k(sales), anon: makeClient(server.baseUrl, null) };
}

/** Order diserahkan TANPA pengakuan (meniru produksi). bayar=terverifikasi & terjurnal (Uang Muka Pelanggan). */
async function buatOrder(w, { nilai, ongkir = null, status = "DELIVERED", kategori = "LAYANAN", bayar = null, bayarTgl = null, serah = null, transisi = null, lunasManual = false, itemHarga = null, tanpaItem = false }) {
  seq += 1;
  const c = await testPrisma.customer.create({ data: { phone: `62813${String(Date.now()).slice(-6)}${seq}`, name: `Pelanggan Uji ${seq}`, pipelineStage: "TRANSACTION" } });
  const o = await testPrisma.order.create({ data: { customerId: c.id, value: nilai, ongkir, category: kategori, status, orderNumber: `${kategori === "SEWA" ? "SWS" : "RES"}-KD-${String(seq).padStart(3, "0")}`, ...(lunasManual ? { paymentStatus: "LUNAS" } : {}) } });
  if (!tanpaItem) await testPrisma.orderItem.create({ data: { orderId: o.id, layananName: "Paket Upgrade", harga: itemHarga ?? nilai, sortOrder: 0 } });
  if (bayar) {
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: bayar, method: "TRANSFER", recordedById: w.admin.user.id, cashAccountId: w.bank.id, createdAt: WIB(bayarTgl) } });
    await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.admin.user.id } });
    await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: w.admin.user.id }));
    await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, o.id));
    await testPrisma.order.update({ where: { id: o.id }, data: { paidAt: WIB(bayarTgl) } });
  }
  if (serah) await testPrisma.job.create({ data: { type: "DELIVERY", orderId: o.id, status: "COMPLETED", scheduledDate: D(serah), completedAt: WIB(serah, 14), podStatus: "VERIFIED" } });
  if (transisi) await testPrisma.orderStatusTransition.create({ data: { orderId: o.id, fromStatus: "SHIPPING", toStatus: status, changedById: w.admin.user.id, createdAt: WIB(transisi, 9) } });
  return { o, c };
}
const url = (id, aksi = "") => `/api/finance/koreksi/pengakuan/${id}${aksi}`;
const potret = async () => {
  const t = (await testPrisma.$queryRawUnsafe("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name <> '_prisma_migrations' order by 1")).map((x) => x.table_name);
  const o = {}; for (const n of t) o[n] = (await testPrisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${n}" x`))[0]; return o;
};
const jurnalPengakuan = (orderId) => testPrisma.finJournalEntry.findMany({ where: { idempotencyKey: { startsWith: `PENGAKUAN_PENDAPATAN:${orderId}` } }, include: { lines: { include: { account: { select: { systemKey: true } } } } }, orderBy: { createdAt: "asc" } });
const saldo = async (systemKey, orderId) => {
  const ls = await testPrisma.finJournalLine.findMany({ where: { orderId, account: { systemKey }, entry: { status: { in: ["POSTED", "REVERSED"] } } }, select: { debit: true, credit: true } });
  return ls.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
};
const akuiBody = (extra = {}) => ({ dasarTanggal: "TANGGAL_SERAH_POD", tanggal: "2026-10-06", alasan: "Diserahkan, bukti POD terverifikasi; pengakuan tak pernah terjadi", ...extra });

test("KASUS NORMAL: diserahkan berbukti POD, uang muka Rp1,5 jt → pratinjau tanpa tulis; pengakuan: Dr Piutang/Cr Pendapatan + uang muka jadi pelunasan; piutang Rp0; audit tercatat", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 1_500_000, bayar: 1_500_000, bayarTgl: "2026-10-05", serah: "2026-10-06", transisi: "2026-10-06" });
  const det = await w.f.get(url(o.id));
  assert.equal(det.status, 200, JSON.stringify(det.body));
  assert.equal(det.body.kelas, "PERLU_KEPUTUSAN"); assert.equal(det.body.bukti.serah.tanggal, "2026-10-06"); assert.equal(det.body.bukti.uangMukaDiBuku, 1_500_000);
  assert.ok(det.body.penyebab.length >= 1 && det.body.penyebab.every((p) => p.kode && p.uraian));
  assert.equal(det.body.bukti.totalDibayar, 1_500_000);
  const sebelum = await potret();
  const pr = await w.a.post(url(o.id, "/akui"), akuiBody({ preview: true }));
  assert.equal(pr.status, 200, JSON.stringify(pr.body));
  assert.deepEqual(await potret(), sebelum, "pratinjau tidak menulis apa pun");
  assert.equal(pr.body.pratinjau.jurnal.totalDebit, pr.body.pratinjau.jurnal.totalKredit);
  assert.equal(pr.body.pratinjau.dampak.pendapatanBertambah, 1_500_000);
  const r = await w.a.post(url(o.id, "/akui"), akuiBody(), IK());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const js = await jurnalPengakuan(o.id);
  assert.equal(js.length, 1); assert.equal(js[0].status, "POSTED"); assert.equal(js[0].date.toISOString().slice(0, 10), "2026-10-06");
  assert.equal(await saldo("PIUTANG_USAHA", o.id), 0, "piutang order nol: uang muka sudah memenuhi");
  assert.ok(Math.abs(await saldo("UANG_MUKA_PELANGGAN", o.id)) < 0.005, "uang muka habis dipindah jadi pelunasan");
  assert.equal(Number(js[0].lines.filter((l) => l.account.systemKey === "PENDAPATAN_LAYANAN").reduce((a, l) => a + Number(l.credit), 0)), 1_500_000);
  const ev = await testPrisma.activityEvent.findMany({ where: { entityType: "order", entityId: o.id, eventType: "DOCUMENT_CORRECTED" } });
  assert.equal(ev.length, 1); assert.equal(ev[0].metadata.aksi, "KOREKSI_PENGAKUAN_PENDAPATAN"); assert.equal(ev[0].metadata.dasarTanggal, "TANGGAL_SERAH_POD");
  // replay (kunci beda, order sama) → 200 SUDAH_DIAKUI tanpa jurnal kedua
  const ulang = await w.a.post(url(o.id, "/akui"), akuiBody(), IK());
  assert.equal(ulang.status, 200); assert.equal(ulang.body.status, "SUDAH_DIAKUI");
  assert.equal((await jurnalPengakuan(o.id)).length, 1);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "order", entityId: o.id, eventType: "DOCUMENT_CORRECTED" } }), 1);
});

test("IDEMPOTENCY-KEY sama + isi sama → respons diputar ulang; tanpa kunci → 428; tanpa PIN step-up → 403; tanpa alasan → 400", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 800_000, serah: "2026-10-06" });
  assert.equal((await w.a.post(url(o.id, "/akui"), akuiBody())).status, 428);
  const tanpaPin = await w.aTanpa.post(url(o.id, "/akui"), akuiBody(), IK());
  assert.equal(tanpaPin.status, 403); assert.ok(/STEPUP/.test(tanpaPin.body.code));
  assert.equal((await w.a.post(url(o.id, "/akui"), akuiBody({ alasan: "pendek" }), IK())).status, 400);
  assert.equal((await jurnalPengakuan(o.id)).length, 0, "semua penolakan tidak menulis");
  const h = IK();
  const a1 = await w.a.post(url(o.id, "/akui"), akuiBody(), h); const a2 = await w.a.post(url(o.id, "/akui"), akuiBody(), h);
  assert.equal(a1.status, 201); assert.equal(a2.status, 201); assert.equal(a2.headers.get("idempotent-replayed"), "true");
  assert.equal((await jurnalPengakuan(o.id)).length, 1);
});

test("PARALEL: 6 permintaan serentak untuk satu order → tepat satu jurnal pengakuan", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 1_000_000, serah: "2026-10-06" });
  const hs = await Promise.all(Array.from({ length: 6 }, () => w.a.post(url(o.id, "/akui"), akuiBody(), IK())));
  assert.ok(hs.every((h) => [200, 201].includes(h.status)), JSON.stringify(hs.map((h) => h.status)));
  assert.equal(hs.filter((h) => h.status === 201).length, 1);
  assert.equal((await jurnalPengakuan(o.id)).length, 1);
});

test("TANPA BUKTI: tak ada POD/riwayat status → SERAH_TIDAK_TERBUKTI; dasar POD ditolak; Keputusan Owner wajib bukti referensi; tanggal tak boleh sebelum cutoff / masa depan / bukan kalender", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 700_000, status: "DELIVERED" });
  const det = (await w.f.get(url(o.id))).body;
  assert.ok(det.tahan.some((t) => t.kode === "SERAH_TIDAK_TERBUKTI"));
  assert.ok(det.pilihanTanggal.find((p) => p.dasar === "TANGGAL_SERAH_POD").tersedia === false);
  const tolak = async (b, kode, status = [400, 422]) => { const r = await w.a.post(url(o.id, "/akui"), b, IK()); assert.ok(status.includes(r.status), `${kode}: ${r.status} ${JSON.stringify(r.body)}`); assert.equal(r.body.code, kode); };
  await tolak(akuiBody(), "BUKTI_TANGGAL_TIDAK_ADA");
  await tolak(akuiBody({ dasarTanggal: "KEPUTUSAN_OWNER" }), "BUKTI_REFERENSI_WAJIB");
  await tolak(akuiBody({ dasarTanggal: "KEPUTUSAN_OWNER", buktiReferensi: "Pesan WA Owner 16 Okt", tanggal: "2026-09-01" }), "TANGGAL_SEBELUM_CUTOFF");
  await tolak(akuiBody({ dasarTanggal: "KEPUTUSAN_OWNER", buktiReferensi: "Pesan WA Owner 16 Okt", tanggal: "2099-01-01" }), "TANGGAL_MASA_DEPAN");
  await tolak(akuiBody({ dasarTanggal: "KEPUTUSAN_OWNER", buktiReferensi: "Pesan WA Owner 16 Okt", tanggal: "2026-02-31" }), "TANGGAL_TIDAK_VALID");
  assert.equal((await jurnalPengakuan(o.id)).length, 0);
  const ok = await w.a.post(url(o.id, "/akui"), akuiBody({ dasarTanggal: "KEPUTUSAN_OWNER", buktiReferensi: "Pesan WA Owner 16 Okt: barang diterima", tanggal: "2026-10-10" }), IK());
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityType: "order", entityId: o.id, eventType: "DOCUMENT_CORRECTED" } });
  assert.equal(ev.metadata.buktiReferensi, "Pesan WA Owner 16 Okt: barang diterima");
});

test("PRA-CUTOFF: diserahkan sebelum buku besar mulai → ditahan; hanya Keputusan Owner + akuiPraCutoff + tanggal ≥ cutoff", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 1_190_000, serah: "2026-09-10", transisi: "2026-09-10" });
  const det = (await w.f.get(url(o.id))).body;
  assert.ok(det.tahan.some((t) => t.kode === "DISERAHKAN_SEBELUM_CUTOFF")); assert.equal(det.praCutoff, true);
  assert.equal(det.pilihanTanggal.find((p) => p.dasar === "TANGGAL_SERAH_POD").tersedia, false);
  const r1 = await w.a.post(url(o.id, "/akui"), akuiBody({ tanggal: "2026-09-10" }), IK());
  assert.equal(r1.status, 422);
  const r2 = await w.a.post(url(o.id, "/akui"), akuiBody({ dasarTanggal: "KEPUTUSAN_OWNER", buktiReferensi: "Keputusan Owner 17 Okt", tanggal: "2026-10-12" }), IK());
  assert.equal(r2.status, 422); assert.equal(r2.body.code, "PERSETUJUAN_PRA_CUTOFF_DIPERLUKAN");
  const r3 = await w.a.post(url(o.id, "/akui"), akuiBody({ dasarTanggal: "KEPUTUSAN_OWNER", buktiReferensi: "Keputusan Owner 17 Okt", tanggal: "2026-10-12", akuiPraCutoff: true }), IK());
  assert.equal(r3.status, 201, JSON.stringify(r3.body));
  assert.equal((await jurnalPengakuan(o.id))[0].date.toISOString().slice(0, 10), "2026-10-12");
});

test("LUNAS TANPA PEMBAYARAN, PKR, status belum diserahkan, order digabung: ditahan keras (tidak ada override)", async () => {
  const w = await dunia();
  const l = await buatOrder(w, { nilai: 900_000, serah: "2026-10-06", lunasManual: true });
  const dl = (await w.f.get(url(l.o.id))).body;
  assert.ok(dl.tahan.some((t) => t.kode === "LUNAS_TANPA_PEMBAYARAN"));
  const rl = await w.a.post(url(l.o.id, "/akui"), akuiBody(), IK()); assert.equal(rl.status, 422); assert.equal(rl.body.code, "LUNAS_TANPA_PEMBAYARAN");
  const p = await buatOrder(w, { nilai: 500_000, status: "PROCESSING", serah: "2026-10-06" });
  const rp = await w.a.post(url(p.o.id, "/akui"), akuiBody(), IK()); assert.equal(rp.status, 422); assert.equal(rp.body.code, "STATUS_BELUM_DISERAHKAN");
  const g = await buatOrder(w, { nilai: 500_000, serah: "2026-10-06" });
  const tujuan = await buatOrder(w, { nilai: 100_000, status: "PROCESSING" });
  await testPrisma.order.update({ where: { id: g.o.id }, data: { mergedIntoOrderId: tujuan.o.id } });
  const rg = await w.a.post(url(g.o.id, "/akui"), akuiBody(), IK()); assert.equal(rg.status, 422); assert.equal(rg.body.code, "ORDER_DIGABUNG");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENGAKUAN_PENDAPATAN" } }), 0);
});

test("ORDER Rp0: gap tercatat; Tetapkan Harga butuh bukti + hanya item Rp0 + tidak menebak; setelah itu pengakuan menutup gap; harga tak bisa diubah lagi dari sini", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 0, serah: "2026-10-09", transisi: "2026-10-09", itemHarga: 0 });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: w.admin.user.id, date: D("2026-10-09") })); // → gap NILAI_ORDER_NOL
  assert.equal(await testPrisma.finPostingGap.count({ where: { sourceId: o.id, resolvedAt: null } }), 1);
  const det = (await w.f.get(url(o.id))).body;
  assert.equal(det.kelas, "NILAI_NOL"); assert.ok(det.tahan.some((t) => t.kode === "NILAI_ORDER_NOL")); assert.equal(det.items[0].harga, 0);
  const itemId = det.items[0].id;
  // akui sebelum harga → ditolak
  const dini = await w.a.post(url(o.id, "/akui"), akuiBody({ tanggal: "2026-10-09" }), IK()); assert.equal(dini.status, 422); assert.equal(dini.body.code, "NILAI_ORDER_NOL");
  // harga: tanpa bukti / harga nol / item bukan milik order
  assert.equal((await w.a.post(url(o.id, "/harga"), { harga: [{ itemId, harga: 850_000 }], alasan: "harga dari penawaran", buktiHarga: "" }, IK())).body.code, "BUKTI_HARGA_WAJIB");
  assert.equal((await w.a.post(url(o.id, "/harga"), { harga: [{ itemId, harga: 0 }], alasan: "harga dari penawaran", buktiHarga: "Penawaran PN-0912" }, IK())).body.code, "HARGA_TIDAK_VALID");
  assert.equal((await w.a.post(url(o.id, "/harga"), { harga: [{ itemId: "x", harga: 5 }], alasan: "harga dari penawaran", buktiHarga: "Penawaran PN-0912" }, IK())).body.code, "ITEM_TIDAK_VALID");
  const sebelum = await potret();
  const pr = await w.a.post(url(o.id, "/harga"), { preview: true, harga: [{ itemId, harga: 850_000 }], alasan: "harga dari penawaran", buktiHarga: "Penawaran PN-0912" });
  assert.equal(pr.status, 200, JSON.stringify(pr.body)); assert.equal(pr.body.pratinjau.valueSesudah, 850_000);
  assert.deepEqual(await potret(), sebelum, "pratinjau harga tidak menulis");
  const h = await w.a.post(url(o.id, "/harga"), { harga: [{ itemId, harga: 850_000 }], alasan: "harga dari penawaran", buktiHarga: "Penawaran PN-0912" }, IK());
  assert.equal(h.status, 201, JSON.stringify(h.body));
  assert.equal(Number((await testPrisma.order.findUnique({ where: { id: o.id } })).value), 850_000);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENGAKUAN_PENDAPATAN" } }), 0, "menetapkan harga TIDAK memposting jurnal");
  const lagi = await w.a.post(url(o.id, "/harga"), { harga: [{ itemId, harga: 900_000 }], alasan: "harga dari penawaran", buktiHarga: "Penawaran PN-0912" }, IK());
  assert.equal(lagi.status, 422); assert.equal(lagi.body.code, "ITEM_SUDAH_BERHARGA");
  // pengakuan sesudah harga
  const k = await w.a.post(url(o.id, "/akui"), akuiBody({ tanggal: "2026-10-09" }), IK());
  assert.equal(k.status, 201, JSON.stringify(k.body)); assert.equal(k.body.ringkasan.gapDitutup, 1);
  assert.equal(await testPrisma.finPostingGap.count({ where: { sourceId: o.id, resolvedAt: null } }), 0);
  assert.equal(await saldo("PIUTANG_USAHA", o.id), 850_000, "belum dibayar → piutang muncul");
  const sudah = await w.a.post(url(o.id, "/harga"), { harga: [{ itemId, harga: 900_000 }], alasan: "harga dari penawaran", buktiHarga: "Penawaran PN-0912" }, IK());
  assert.equal(sudah.status, 409);
});

test("PERIODE TERTUTUP: pengakuan ke periode tertutup ditolak tanpa jejak; setelah dibuka berhasil", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 600_000, serah: "2026-10-06" });
  await testPrisma.finPeriod.upsert({ where: { year_month: { year: 2026, month: 10 } }, update: { status: "CLOSED" }, create: { year: 2026, month: 10, status: "CLOSED" } });
  const sebelum = await potret();
  const r = await w.a.post(url(o.id, "/akui"), akuiBody(), IK());
  assert.equal(r.status, 409); assert.equal(r.body.code, "PERIODE_TERTUTUP");
  assert.deepEqual(await potret(), sebelum, "ditolak = tidak ada jejak (jurnal/gap/audit)");
  await testPrisma.finPeriod.update({ where: { year_month: { year: 2026, month: 10 } }, data: { status: "OPEN" } });
  assert.equal((await w.a.post(url(o.id, "/akui"), akuiBody(), IK())).status, 201);
});

test("PEMBALIKAN AMAN: balik jurnal hasil koreksi (jurnal balik resmi, dimensi dibawa); transaksi bergantung → 409; jurnal otomatis tidak dibalik dari sini; re-akui memakai kunci ULANG", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 1_000_000, serah: "2026-10-06" });
  assert.equal((await w.a.post(url(o.id, "/balik"), { alasan: "belum ada pengakuan" }, IK())).body.status, "TIDAK_ADA_PENGAKUAN_AKTIF");
  assert.equal((await w.a.post(url(o.id, "/akui"), akuiBody(), IK())).status, 201);
  const pr = await w.a.post(url(o.id, "/balik"), { preview: true, alasan: "salah tanggal serah" });
  assert.equal(pr.status, 200, JSON.stringify(pr.body)); assert.equal(pr.body.pratinjau.dampak.pendapatanBertambah, -1_000_000);
  // transaksi bergantung: pembayaran sesudah pengakuan menyentuh piutang order
  const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: 300_000, method: "TRANSFER", recordedById: w.admin.user.id, cashAccountId: w.bank.id, createdAt: WIB("2026-10-08") } });
  await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.admin.user.id } });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: w.admin.user.id }));
  const bergantung = await w.a.post(url(o.id, "/balik"), { alasan: "salah tanggal serah" }, IK());
  assert.equal(bergantung.status, 409); assert.equal(bergantung.body.code, "ADA_TRANSAKSI_BERGANTUNG");
  assert.equal((await jurnalPengakuan(o.id))[0].status, "POSTED");
  // order lain tanpa ketergantungan → balik berhasil
  const { o: o2 } = await buatOrder(w, { nilai: 400_000, serah: "2026-10-07" });
  assert.equal((await w.a.post(url(o2.id, "/akui"), akuiBody({ tanggal: "2026-10-07" }), IK())).status, 201);
  const b = await w.a.post(url(o2.id, "/balik"), { alasan: "salah tanggal serah" }, IK());
  assert.equal(b.status, 201, JSON.stringify(b.body)); assert.equal(b.body.status, "DIBALIK");
  const js = await jurnalPengakuan(o2.id); assert.equal(js[0].status, "REVERSED");
  assert.equal(await saldo("PIUTANG_USAHA", o2.id), 0); assert.equal(await saldo("PENDAPATAN_LAYANAN", o2.id), 0);
  const ulangBalik = await w.a.post(url(o2.id, "/balik"), { alasan: "salah tanggal serah" }, IK());
  assert.equal(ulangBalik.body.status, "TIDAK_ADA_PENGAKUAN_AKTIF", "idempoten");
  // re-akui sesudah dibalik → jurnal baru dengan kunci ber-sufiks
  const lagi = await w.a.post(url(o2.id, "/akui"), akuiBody({ tanggal: "2026-10-07", akuiSetelahDibalik: true }), IK());
  assert.equal(lagi.status, 201, JSON.stringify(lagi.body));
  assert.equal((await jurnalPengakuan(o2.id)).length, 2, "asli (REVERSED) + pengakuan ulang (jurnal balik berkunci lain)");
  // jurnal OTOMATIS (bukan hasil koreksi) tidak boleh dibalik dari jalur ini
  const { o: o3 } = await buatOrder(w, { nilai: 300_000, serah: "2026-10-07" });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o3.id, userId: w.admin.user.id, date: D("2026-10-07") }));
  const oto = await w.a.post(url(o3.id, "/balik"), { alasan: "mencoba balik otomatis" }, IK());
  assert.equal(oto.status, 422); assert.equal(oto.body.code, "BUKAN_HASIL_KOREKSI");
});

test("PEMBALIKAN ke periode tertutup ditolak (periode pengakuan atau hari ini)", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 500_000, serah: "2026-10-06" });
  assert.equal((await w.a.post(url(o.id, "/akui"), akuiBody(), IK())).status, 201);
  await testPrisma.finPeriod.upsert({ where: { year_month: { year: 2026, month: 10 } }, update: { status: "CLOSED" }, create: { year: 2026, month: 10, status: "CLOSED" } });
  const r = await w.a.post(url(o.id, "/balik"), { alasan: "salah tanggal serah" }, IK());
  assert.equal(r.status, 409); assert.equal(r.body.code, "PERIODE_TERTUTUP");
  assert.equal((await jurnalPengakuan(o.id)).length, 1);
});

test("DAFTAR: dikelompokkan per kelas (perlu keputusan / Rp0 / riwayat pra-buku); tidak ada endpoint massal; angka cocok dengan daftar gap laporan", async () => {
  const w = await dunia();
  const a = await buatOrder(w, { nilai: 1_000_000, bayar: 1_000_000, bayarTgl: "2026-10-05", serah: "2026-10-06" });
  const b = await buatOrder(w, { nilai: 500_000, serah: "2026-08-10", transisi: "2026-08-10" });          // riwayat pra-buku
  const c = await buatOrder(w, { nilai: 0, serah: "2026-10-09", itemHarga: 0 });                          // Rp0
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: c.o.id, userId: w.admin.user.id, date: D("2026-10-09") }));
  const d = (await w.f.get("/api/finance/koreksi/pengakuan")).body;
  assert.equal(d.ringkasan.perluKeputusan.jumlah, 1); assert.equal(d.ringkasan.perluKeputusan.nilai, 1_000_000);
  assert.equal(d.ringkasan.nilaiNol.jumlah, 1); assert.equal(d.ringkasan.riwayatPraBuku.jumlah, 1);
  assert.deepEqual(d.daftar.map((x) => x.nomor).sort(), [a.o.orderNumber, c.o.orderNumber].sort());
  const pra = (await w.f.get("/api/finance/koreksi/pengakuan?kelas=RIWAYAT_PRA_BUKU")).body;
  assert.deepEqual(pra.daftar.map((x) => x.nomor), [b.o.orderNumber]);
  assert.equal((await w.f.get("/api/finance/koreksi/pengakuan?kelas=ngawur")).status, 400);
  const lap = (await w.f.get("/api/finance/reports/income-statement/terinci?from=2026-10-01&to=2026-10-16")).body;
  assert.equal(lap.gap.jumlahTerbuka, 1);
  assert.ok(lap.gap.daftar.every((g) => g.orderId), "daftar gap membawa orderId untuk membuka koreksi");
  assert.ok(lap.gap.tanpaGap.every((g) => g.orderId));
  for (const p of ["/akui-semua", "/massal", "/semua/akui"]) assert.ok([400, 404].includes((await w.a.post(`/api/finance/koreksi/pengakuan${p}`, {}, IK())).status), "tidak ada jalur massal");
});

test("IZIN: baca = finance:read; tulis = finance:admin; SALES 403; anonim 401; ID rusak 400; order tak ada 404", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 600_000, serah: "2026-10-06" });
  assert.equal((await w.anon.get("/api/finance/koreksi/pengakuan")).status, 401);
  assert.equal((await w.s.get("/api/finance/koreksi/pengakuan")).status, 403);
  assert.equal((await w.f.get(url(o.id))).status, 200);
  for (const aksi of ["/akui", "/balik", "/harga"]) {
    assert.equal((await w.f.post(url(o.id, aksi), { preview: true, ...akuiBody() })).status, 403, `finance ${aksi}`);
    assert.equal((await w.s.post(url(o.id, aksi), akuiBody(), IK())).status, 403, `sales ${aksi}`);
  }
  assert.equal((await w.a.get("/api/finance/koreksi/pengakuan/!!!")).status, 400);
  assert.equal((await w.a.get("/api/finance/koreksi/pengakuan/ordertidakada123")).status, 404);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENGAKUAN_PENDAPATAN" } }), 0);
});

// ── ATRIBUSI DIVISI ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function biaya(w, { kode, division, amount, tgl, desk }) {
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: kode } });
  const r = await w.a.post("/api/finance/expenses", { date: tgl, amount, description: desk ?? `uji ${kode}`, categoryId: kat.id, division, mode: "LANGSUNG", cashAccountId: w.bank.id, receiptUrl: NOTA });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await w.a.post(`/api/finance/expenses/${r.body.id}/approve`, {})).status, 200);
  return r.body;
}
const bebanDivisi = async (w, q = "from=2026-10-01&to=2026-10-31") => (await w.f.get(`/api/finance/reports/income-statement/terinci?${q}`)).body;

test("ATRIBUSI: konflik (dokumen Produksi vs kategori BBM→Delivery) → daftar menunggu → keputusan dengan alasan → laporan memakai keputusan; total beban & jurnal TIDAK berubah; riwayat sebelum/sesudah; cabut kembali ke konflik", async () => {
  const w = await dunia();
  const e = await biaya(w, { kode: "BBM", division: "PRODUKSI", amount: 70_000, tgl: "2026-10-03" });
  const lap0 = await bebanDivisi(w);
  assert.equal(lap0.bebanDivisi.konflik.jumlahBaris, 1);
  assert.equal(lap0.bebanDivisi.konflik.baris[0].dokumenId, e.id); assert.equal(lap0.bebanDivisi.konflik.baris[0].dokumenModul, "pengeluaran");
  const totalSebelum = lap0.bebanDivisi.totalDivisi; const jurnalSebelum = await testPrisma.finJournalEntry.count();
  const dft = (await w.f.get("/api/finance/koreksi/atribusi?from=2026-10-01&to=2026-10-31")).body;
  assert.equal(dft.ringkasan.menunggu, 1); assert.equal(dft.daftar[0].status, "MENUNGGU_KEPUTUSAN"); assert.deepEqual(dft.daftar[0].kandidat.map((k) => k.scope).sort(), ["DELIVERY", "PRODUCTION"]);
  assert.equal(dft.ringkasan.nilaiMenunggu, 70_000);
  const det = (await w.f.get(`/api/finance/koreksi/atribusi/pengeluaran/${e.id}?scope=DELIVERY`)).body;
  assert.equal(det.pratinjau.bisaDiputuskan, true); assert.equal(det.pratinjau.sesudah.scope, "DELIVERY"); assert.equal(det.pratinjau.bukti.length >= 2, true);
  assert.equal(det.pratinjau.dampak.nilaiBeban, 70_000);
  const post = (b) => w.a.post(`/api/finance/koreksi/atribusi/pengeluaran/${e.id}`, b, IK());
  assert.equal((await post({ scope: "DELIVERY", alasan: "pendek" })).status, 400);
  assert.equal((await post({ scope: "SALES", alasan: "Biaya ini untuk tim Sales, bukti nota" })).body.code, "SCOPE_BUKAN_KANDIDAT");
  const r = await post({ scope: "DELIVERY", alasan: "BBM dipakai armada Delivery (nota SPBU terlampir)" });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.status, "DIPUTUSKAN");
  const lap1 = await bebanDivisi(w);
  assert.equal(lap1.bebanDivisi.konflik.jumlahBaris, 0, "konflik terselesaikan");
  assert.equal(lap1.bebanDivisi.totalDivisi, totalSebelum, "total beban sama");
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalSebelum, "tidak ada jurnal baru");
  const delivery = lap1.bebanDivisi.divisi.find((d) => d.scope === "DELIVERY"); assert.equal(delivery.total, 70_000);
  assert.ok(!lap1.bebanDivisi.divisi.find((d) => d.scope === "PRODUCTION"), "tidak lagi di Produksi");
  assert.ok(lap1.kontrol.semuaOk, JSON.stringify(lap1.kontrol.daftar.filter((k) => !k.ok)));
  // idempoten: keputusan sama → 200, tidak ada baris baru
  const lagi = await post({ scope: "DELIVERY", alasan: "BBM dipakai armada Delivery (nota SPBU terlampir)" });
  assert.equal(lagi.status, 200); assert.equal(lagi.body.status, "SUDAH_DIPUTUSKAN");
  assert.equal(await testPrisma.finAttributionDecision.count({ where: { documentId: e.id } }), 1);
  // ganti keputusan → yang lama dicabut (riwayat tetap)
  const ganti = await post({ scope: "PRODUCTION", alasan: "Koreksi: ternyata BBM untuk truk produksi" });
  assert.equal(ganti.body.status, "DIGANTI");
  const riw = (await w.f.get(`/api/finance/koreksi/atribusi/pengeluaran/${e.id}`)).body.riwayat;
  assert.equal(riw.length, 2); assert.equal(riw.filter((x) => !x.dicabutPada).length, 1); assert.equal(riw[0].scope, "DELIVERY"); assert.equal(riw[1].scope, "PRODUCTION"); assert.ok(riw[0].alasanPencabutan);
  const cabut = await w.a.post(`/api/finance/koreksi/atribusi/pengeluaran/${e.id}/cabut`, { alasan: "Keputusan dicabut, tunggu bukti tambahan" }, IK());
  assert.equal(cabut.body.status, "DICABUT");
  assert.equal((await bebanDivisi(w)).bebanDivisi.konflik.jumlahBaris, 1, "konflik kembali setelah keputusan dicabut");
  const ev = await testPrisma.activityEvent.findMany({ where: { entityType: "fin_expense", entityId: e.id, eventType: "DOCUMENT_CORRECTED" } });
  assert.equal(ev.length, 3, "diputuskan, diganti, dicabut: masing-masing satu catatan audit");
});

test("ATRIBUSI: tanpa konflik ditolak; periode tertutup ditolak; PIN & Idempotency-Key & izin; tidak ada endpoint massal; jenis tak didukung", async () => {
  const w = await dunia();
  const ok = await biaya(w, { kode: "BBM", division: "DELIVERY", amount: 50_000, tgl: "2026-10-04" });
  const x = await w.a.post(`/api/finance/koreksi/atribusi/pengeluaran/${ok.id}`, { scope: "DELIVERY", alasan: "tidak ada konflik di sini" }, IK());
  assert.equal(x.status, 422); assert.equal(x.body.code, "TIDAK_ADA_KONFLIK");
  const e = await biaya(w, { kode: "BBM", division: "PRODUKSI", amount: 80_000, tgl: "2026-10-05" });
  const url2 = `/api/finance/koreksi/atribusi/pengeluaran/${e.id}`;
  const b = { scope: "DELIVERY", alasan: "BBM dipakai armada Delivery (nota SPBU)" };
  assert.equal((await w.a.post(url2, b)).status, 428);
  assert.equal((await w.aTanpa.post(url2, b, IK())).status, 403);
  assert.equal((await w.f.post(url2, b, IK())).status, 403);
  assert.equal((await w.s.get("/api/finance/koreksi/atribusi?from=2026-10-01&to=2026-10-31")).status, 403);
  assert.equal((await w.a.get("/api/finance/koreksi/atribusi/refund/00000000-0000-4000-8000-000000000000")).body.code, "MODUL_TIDAK_DIDUKUNG");
  assert.equal((await w.a.get("/api/finance/koreksi/atribusi/pengeluaran/00000000-0000-4000-8000-000000000000")).status, 404);
  assert.equal((await w.a.get("/api/finance/koreksi/atribusi?from=2026-10-31&to=2026-10-01")).status, 400);
  await testPrisma.finPeriod.upsert({ where: { year_month: { year: 2026, month: 10 } }, update: { status: "CLOSED" }, create: { year: 2026, month: 10, status: "CLOSED" } });
  const t = await w.a.post(url2, b, IK());
  assert.equal(t.status, 409); assert.equal(t.body.code, "PERIODE_TERTUTUP");
  assert.equal(await testPrisma.finAttributionDecision.count(), 0);
  for (const p of ["/massal", "/semua"]) assert.equal((await w.a.post(`/api/finance/koreksi/atribusi${p}`, {}, IK())).status, 404);
});

test("ATRIBUSI paralel: dua keputusan berbeda serentak untuk satu dokumen → tepat satu keputusan aktif (indeks unik parsial)", async () => {
  const w = await dunia();
  const e = await biaya(w, { kode: "BBM", division: "PRODUKSI", amount: 90_000, tgl: "2026-10-06" });
  const u = `/api/finance/koreksi/atribusi/pengeluaran/${e.id}`;
  const hs = await Promise.all([
    w.a.post(u, { scope: "DELIVERY", alasan: "BBM dipakai armada Delivery (nota SPBU)" }, IK()), w.a.post(u, { scope: "PRODUCTION", alasan: "BBM untuk truk produksi (nota)" }, IK()),
    w.a.post(u, { scope: "DELIVERY", alasan: "BBM dipakai armada Delivery (nota SPBU)" }, IK()),
  ]);
  assert.ok(hs.every((h) => [200, 201].includes(h.status)), JSON.stringify(hs.map((h) => [h.status, h.body])));
  assert.equal(await testPrisma.finAttributionDecision.count({ where: { documentId: e.id, revokedAt: null } }), 1);
});

test("MIGRASI ADITIF: indeks unik parsial menolak dua keputusan aktif untuk dokumen yang sama di level database", async () => {
  const w = await dunia();
  const e = await biaya(w, { kode: "BBM", division: "PRODUKSI", amount: 10_000, tgl: "2026-10-06" });
  const base = { module: "pengeluaran", documentId: e.id, decidedScope: "DELIVERY", previousScope: "PRODUCTION", candidates: ["PRODUCTION", "DELIVERY"], reason: "uji indeks unik parsial" };
  await testPrisma.finAttributionDecision.create({ data: base });
  await assert.rejects(testPrisma.finAttributionDecision.create({ data: base }), /Unique constraint|unique/i);
});

test("DAMPAK uang muka bertanda KEWAJIBAN: dipindah jadi pelunasan = BERKURANG (negatif); piutang & pendapatan benar arahnya", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 1_500_000, bayar: 1_500_000, bayarTgl: "2026-10-05", serah: "2026-10-06", transisi: "2026-10-06" });
  const pr = await w.a.post(url(o.id, "/akui"), akuiBody({ preview: true }));
  assert.equal(pr.status, 200, JSON.stringify(pr.body));
  assert.equal(pr.body.pratinjau.dampak.pendapatanBertambah, 1_500_000);
  assert.equal(pr.body.pratinjau.dampak.piutangUsahaBerubah, 0);
  assert.equal(pr.body.pratinjau.dampak.uangMukaPelangganBerubah, -1_500_000, "uang muka BERKURANG");
  const tanpaBayar = await buatOrder(w, { nilai: 400_000, serah: "2026-10-07", transisi: "2026-10-07" });
  const p2 = await w.a.post(url(tanpaBayar.o.id, "/akui"), akuiBody({ preview: true, tanggal: "2026-10-07" }));
  assert.equal(p2.body.pratinjau.dampak.piutangUsahaBerubah, 400_000); assert.equal(p2.body.pratinjau.dampak.uangMukaPelangganBerubah, 0);
});

test("PENGAKUAN YANG SUDAH DIBALIK (REVERSED saja) tetap tampil di daftar; butuh persetujuan eksplisit; alasan pembalikan ditampilkan; diakui ulang dengan kunci ULANG (kasus NEW-23092026-040)", async () => {
  const w = await dunia();
  const { o } = await buatOrder(w, { nilai: 2_090_000, bayar: 2_090_000, bayarTgl: "2026-10-05", serah: "2026-10-06", transisi: "2026-10-06" });
  const r = await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: w.admin.user.id, date: D("2026-10-06") }));
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: r.entry.id, reason: "belum ada sumber bank", userId: w.admin.user.id }));
  assert.equal((await jurnalPengakuan(o.id))[0].status, "REVERSED");
  const daf = (await w.f.get("/api/finance/koreksi/pengakuan")).body;
  assert.ok(daf.daftar.some((x) => x.orderId === o.id && x.kelas === "PERLU_KEPUTUSAN" && x.bisaDiproses), "order yang pengakuannya dibalik harus muncul");
  const det = (await w.f.get(url(o.id))).body;
  assert.ok(det.tahan.some((t) => t.kode === "PENGAKUAN_DIBALIK_SENGAJA" && /belum ada sumber bank/.test(t.pesan)));
  assert.ok(det.penyebab.some((p) => p.kode === "PENGAKUAN_DIBALIK" && /belum ada sumber bank/.test(p.uraian)));
  const tolak = await w.a.post(url(o.id, "/akui"), akuiBody({ tanggal: "2026-10-06" }), IK());
  assert.equal(tolak.status, 422); assert.equal(tolak.body.code, "PERSETUJUAN_SETELAH_DIBALIK_DIPERLUKAN");
  const ok = await w.a.post(url(o.id, "/akui"), akuiBody({ tanggal: "2026-10-06", akuiSetelahDibalik: true }), IK());
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const js = await jurnalPengakuan(o.id);
  assert.equal(js.filter((e) => e.status === "POSTED" && !e.idempotencyKey.endsWith(`PENGAKUAN_PENDAPATAN:${o.id}`)).length >= 1, true);
  assert.ok(js.some((e) => e.idempotencyKey.includes(":ULANG:")), "kunci ULANG");
  assert.equal((await w.f.get("/api/finance/koreksi/pengakuan")).body.daftar.some((x) => x.orderId === o.id), false, "setelah diakui ulang hilang dari daftar");
});
