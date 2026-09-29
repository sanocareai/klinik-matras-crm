// Alur Verifikasi Pembayaran (kasus Handry 29 Sep 2026): rekening bisa ditetapkan SEBELUM verifikasi; verifikasi tidak meloloskan uang yang belum bisa dibukukan;
// pembayaran terverifikasi yang masih "Posting Tertunda" tetap bisa dikoreksi; verifikasi tidak pernah menggerakkan saldo dua kali.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { verifikasiPembayaran } from "../../src/services/finance/pembayaran.js";
import { koreksiPembayaran, blokirKoreksiBatch } from "../../src/services/finance/koreksiPembayaran.js";
import { bukukanPembayaran } from "../../src/services/finance/hooks.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

let n = 0;
async function dunia({ petakan = false } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const pt = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", accountId: akunBank.id } });
  if (petakan) await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_TRANSFER, pt.id);
  const finance = (await createTestUser({ roles: ["FINANCE"] })).user;
  const sales = (await createTestUser({ roles: ["SALES"] })).user;
  return { pt, kem, finance, sales };
}

/** DP dicatat sales: pembukuan dicoba saat dicatat (gagal → Posting Tertunda), persis seperti routes/orders.js. */
async function dp(w, { amount = 1_600_000, cashAccountId = null } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: ".HANDRY" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 3_000_000, category: "BARU", orderNumber: `NEW-UJI-${String(++n).padStart(3, "0")}`, status: "PENDING" } });
  const p = await testPrisma.payment.create({ data: { orderId: order.id, amount, method: "TRANSFER", cashAccountId, recordedById: w.sales.id } });
  await testPrisma.$transaction((tx) => bukukanPembayaran(tx, { paymentId: p.id, userId: w.sales.id }));
  return { p, order };
}
const verif = (w, id, extra = {}) => testPrisma.$transaction((tx) => verifikasiPembayaran(tx, { paymentId: id, userId: w.finance.id, ...extra }));
async function saldoRek(rek) {
  const baris = await testPrisma.finJournalLine.findMany({ where: { cashAccountId: rek.id, entry: { status: { in: ["POSTED", "REVERSED"] } } } });
  return baris.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
}
const jurnalAktif = (id) => testPrisma.finJournalEntry.count({ where: { source: "PEMBAYARAN_ORDER", sourceId: id, status: "POSTED" } });
const gapTerbuka = (id) => testPrisma.finPostingGap.count({ where: { sourceId: id, resolvedAt: null } });

test("Pemetaan kosong + tanpa rekening: DP jadi Posting Tertunda; Verifikasi DITOLAK (422) dengan pesan jelas, tanpa verifikasi dan tanpa perubahan", async () => {
  const w = await dunia();
  const { p } = await dp(w);
  assert.equal(await jurnalAktif(p.id), 0);
  assert.equal(await gapTerbuka(p.id), 1);
  await assert.rejects(verif(w, p.id), (e) => e.statusCode === 422 && e.code === "BELUM_BISA_DIBUKUKAN" && /Pilih dulu rekening/.test(e.message));
  assert.equal(await testPrisma.paymentVerification.count({ where: { paymentId: p.id } }), 0);
  assert.equal(await jurnalAktif(p.id), 0);
  assert.equal(await gapTerbuka(p.id), 1, "gap tetap terbuka");
});

test("Finance memilih rekening SAAT verifikasi: rekening tersimpan, jurnal Dr Bank / Cr Uang Muka terbentuk, gap tertutup, terverifikasi, audit tercatat", async () => {
  const w = await dunia();
  const { p, order } = await dp(w);
  const r = await verif(w, p.id, { cashAccountId: w.kem.id });
  assert.deepEqual(r.orderIds, [order.id]);
  assert.equal((await testPrisma.payment.findUnique({ where: { id: p.id } })).cashAccountId, w.kem.id);
  assert.equal(await jurnalAktif(p.id), 1);
  assert.equal(await saldoRek(w.kem), 1_600_000);
  assert.equal(await saldoRek(w.pt), 0);
  assert.equal(await gapTerbuka(p.id), 0);
  assert.equal(await testPrisma.paymentVerification.count({ where: { paymentId: p.id } }), 1);
  const ev = await testPrisma.activityEvent.findMany({ where: { entityId: p.id } });
  assert.ok(ev.some((e) => e.metadata.aksi === "atur_rekening_sebelum_verifikasi"));
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).paymentStatus, "DP");
});

test("Pemetaan sudah terisi: DP langsung berjurnal saat dicatat; Verifikasi tidak menambah saldo lagi; verifikasi ulang ditolak 409", async () => {
  const w = await dunia({ petakan: true });
  const { p } = await dp(w);
  assert.equal(await jurnalAktif(p.id), 1);
  await verif(w, p.id);
  assert.equal(await saldoRek(w.pt), 1_600_000, "verifikasi tidak menambah saldo lagi");
  await assert.rejects(verif(w, p.id), (e) => e.statusCode === 409);
  assert.equal(await saldoRek(w.pt), 1_600_000);
  assert.equal(await jurnalAktif(p.id), 1);
});

test("Sudah berjurnal: mengubah rekening lewat Verifikasi ditolak (SUDAH_BERJURNAL) — wajib Koreksi Pembayaran", async () => {
  const w = await dunia({ petakan: true });
  const { p } = await dp(w);
  await assert.rejects(verif(w, p.id, { cashAccountId: w.kem.id }), (e) => e.statusCode === 409 && e.code === "SUDAH_BERJURNAL");
  assert.equal(await testPrisma.paymentVerification.count({ where: { paymentId: p.id } }), 0);
  assert.equal(await saldoRek(w.kem), 0);
});

test("Rekening tidak aktif / cara bayar tidak dikenal ditolak", async () => {
  const w = await dunia();
  const { p } = await dp(w);
  await testPrisma.finCashAccount.update({ where: { id: w.kem.id }, data: { active: false } });
  await assert.rejects(verif(w, p.id, { cashAccountId: w.kem.id }), (e) => e.statusCode === 400);
  await assert.rejects(verif(w, p.id, { cashAccountId: w.pt.id, method: "BITCOIN" }), (e) => e.statusCode === 400);
  assert.equal(await testPrisma.paymentVerification.count({ where: { paymentId: p.id } }), 0);
});

test("Kasus Handry: terverifikasi TANPA jurnal (data lama) + Posting Tertunda → Koreksi Pembayaran tidak lagi diblokir; versi pengganti dibukukan ke rekening benar, gap lama ditutup", async () => {
  const w = await dunia();
  const { p, order } = await dp(w);
  await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.finance.id } }); // seperti Natasha 29 Sep 22:38
  assert.equal((await blokirKoreksiBatch(testPrisma, [p.id])).get(p.id), null, "gap terbuka → boleh dikoreksi");
  const r = await testPrisma.$transaction((tx) => koreksiPembayaran(tx, { paymentId: p.id, body: { cashAccountId: w.kem.id }, alasan: "Rekening penerima sebenarnya KEM", userId: w.finance.id }));
  assert.equal(r.ok, true);
  assert.equal(await saldoRek(w.kem), 1_600_000);
  assert.equal(await saldoRek(w.pt), 0);
  const lama = await testPrisma.payment.findUnique({ where: { id: p.id }, include: { replacedBy: true } });
  assert.ok(lama.cancelledAt);
  assert.equal(await jurnalAktif(lama.replacedBy.id), 1, "jurnal pengganti tertaut ke versi pengganti");
  assert.equal(await gapTerbuka(p.id), 0, "gap pembayaran lama ditutup");
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).paymentStatus, "DP");
  const tot = await testPrisma.finJournalLine.aggregate({ where: { entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  assert.equal(Number(tot._sum.debit), Number(tot._sum.credit));
});

test("Tanpa gap dan tanpa jurnal (bukan Posting Tertunda) Koreksi tetap diblokir JURNAL_TIDAK_ADA (perilaku lama)", async () => {
  const w = await dunia();
  const customer = await testPrisma.customer.create({ data: { name: "X" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 100_000, category: "BARU", orderNumber: "NEW-UJI-X", status: "PENDING" } });
  const p = await testPrisma.payment.create({ data: { orderId: order.id, amount: 100_000, method: "TRANSFER", recordedById: w.sales.id } });
  await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.finance.id } });
  assert.equal((await blokirKoreksiBatch(testPrisma, [p.id])).get(p.id).kode, "JURNAL_TIDAK_ADA");
});

test("Jenis pembayaran (DP / Cicilan / Pelunasan) dihitung server dari urutan pembayaran aktif & nilai tagihan (value + ongkir)", async () => {
  const { jenisUntuk } = await import("../../src/services/finance/pembayaran.js");
  const w = await dunia({ petakan: true });
  const customer = await testPrisma.customer.create({ data: { name: "Jenis" } });
  const buat = (value, ongkir) => testPrisma.order.create({ data: { customerId: customer.id, value, ...(ongkir && { ongkir }), category: "BARU", orderNumber: `NEW-JNS-${String(++n).padStart(3, "0")}`, status: "PENDING" } });
  const bayar = (order, amount, menit) => testPrisma.payment.create({ data: { orderId: order.id, amount, method: "TRANSFER", recordedById: w.sales.id, createdAt: new Date(Date.UTC(2026, 8, 20, 5, menit)) } });
  const sel = { id: true, orderId: true, order: { select: { value: true, ongkir: true, groupId: true, group: { select: { id: true, source: true, anchorOrderId: true } } } } };
  const jenisDari = async (ids) => jenisUntuk(testPrisma, await testPrisma.payment.findMany({ where: { id: { in: ids } }, select: sel }));

  const o1 = await buat(2_600_000);                                 // Handry: DP 1,6 jt lalu pelunasan 1 jt
  const a = await bayar(o1, 1_600_000, 0); const b = await bayar(o1, 1_000_000, 1);
  const j1 = await jenisDari([a.id, b.id]);
  assert.equal(j1.get(a.id), "DP"); assert.equal(j1.get(b.id), "PELUNASAN");

  const o2 = await buat(1_000_000);                                 // tiga kali bayar: DP, Cicilan, Pelunasan
  const c1 = await bayar(o2, 300_000, 0); const c2 = await bayar(o2, 300_000, 1); const c3 = await bayar(o2, 400_000, 2);
  const j2 = await jenisDari([c1.id, c2.id, c3.id]);
  assert.deepEqual([j2.get(c1.id), j2.get(c2.id), j2.get(c3.id)], ["DP", "CICILAN", "PELUNASAN"]);

  const o3 = await buat(500_000, 200_000);                          // ongkir ikut tagihan: bayar 500rb = DP (bukan pelunasan), lalu 200rb = pelunasan
  const d1 = await bayar(o3, 500_000, 0); const d2 = await bayar(o3, 200_000, 1);
  const j3 = await jenisDari([d1.id, d2.id]);
  assert.equal(j3.get(d1.id), "DP"); assert.equal(j3.get(d2.id), "PELUNASAN");

  await testPrisma.payment.update({ where: { id: c2.id }, data: { cancelledAt: new Date() } });   // dibatalkan → tanpa label; yang lain menyesuaikan
  const j4 = await jenisDari([c1.id, c2.id, c3.id]);
  assert.equal(j4.get(c2.id), null);
  assert.equal(j4.get(c3.id), "PELUNASAN" === j4.get(c3.id) ? "PELUNASAN" : "CICILAN"); // 300 + 400 = 700 < 1000 → CICILAN
  assert.equal(j4.get(c3.id), "CICILAN");
});
