// MUTASI REKENING (2 Okt 2026): mutasi per rekening kas/bank (PT Sano, KEM, Uang Kas) dengan saldo awal, uang masuk/keluar, saldo berjalan, saldo akhir.
// Dikunci: saldo berjalan benar per baris (juga saat difilter pencarian), saldo akhir = kartu Kas & Bank, transfer antar rekening muncul di KEDUA sisi, biaya admin transfer mengurangi
// saldo asal, jurnal pembalik tampil, baris keliru-tanda dan baris tanpa rekening dilaporkan sebagai peringatan (bukan diam-diam), izin, dan berkas Excel = layar.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal, reverseJournal } from "../../src/services/finance/journal.js";
import { postCashTransfer } from "../../src/services/finance/posting/cash.js";
import { saldoKasBank } from "../../src/services/finance/reports.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let urut = 0;
async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const modal = await testPrisma.finAccount.findUnique({ where: { code: "3-1100" } });
  const beban = await testPrisma.finAccount.findFirst({ where: { type: "BEBAN", isPostable: true } });
  const bebanAdmin = await testPrisma.finAccount.findUnique({ where: { code: "6-1700" } });
  const ptSano = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", bankName: "Mandiri", accountNumber: "1230013546272", accountId: akunBank.id } });
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", accountId: akunBank.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Uang Kas Sano", kind: "KAS", accountId: akunKas.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  return { akunBank, akunKas, modal, beban, bebanAdmin, ptSano, kem, kas, admin: makeClient(server.baseUrl, admin.token), adminToken: admin.token, adminUser: admin.user, sales: makeClient(server.baseUrl, sales.token) };
}
const jurnal = (w, { tanggal, desc, source = "MANUAL", baris }) => testPrisma.$transaction((tx) => postJournal(tx, { date: tanggal, description: desc, source, idempotencyKey: `MR:${++urut}`, userId: w.adminUser.id, lines: baris }));
const masuk = (w, rek, akun, nilai, tanggal, desc) => jurnal(w, { tanggal, desc, baris: [{ accountId: akun.id, cashAccountId: rek.id, debit: nilai }, { accountId: w.modal.id, credit: nilai }] });
const keluar = (w, rek, akun, nilai, tanggal, desc) => jurnal(w, { tanggal, desc, source: "PENGELUARAN", baris: [{ accountId: w.beban.id, debit: nilai }, { accountId: akun.id, cashAccountId: rek.id, credit: nilai }] });
const mutasi = (w, rek, q = "") => w.admin.get(`/api/finance/buku/rekening/${rek.id}/mutasi?from=2026-10-01&to=2026-10-31${q}`);

async function skenario() {
  const w = await dunia();
  await masuk(w, w.ptSano, w.akunBank, 67_163_687, "2026-09-30", "Saldo akhir September");
  await masuk(w, w.kem, w.akunBank, 4_000_000, "2026-09-30", "Saldo KEM September");
  await keluar(w, w.ptSano, w.akunBank, 6_493_500, "2026-10-01", "Pembayaran supplier");
  await masuk(w, w.ptSano, w.akunBank, 3_090_000, "2026-10-01", "Penerimaan order Wahyu");
  const tf = await testPrisma.finCashTransfer.create({ data: { transferNumber: "TRF-01102026-001", date: new Date("2026-10-01T00:00:00Z"), amount: 5_000_000, fromAccountId: w.ptSano.id, toAccountId: w.kem.id, feeAmount: 2_500, createdById: w.adminUser.id } });
  await testPrisma.$transaction((tx) => postCashTransfer(tx, { transferId: tf.id, userId: w.adminUser.id }));
  const salah = (await masuk(w, w.kas, w.akunKas, 200_000, "2026-10-01", "Setor kas salah")).entry;
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: salah.id, date: "2026-10-02", reason: "salah input", userId: w.adminUser.id }));
  return w;
}

test("Mutasi PT Sano: saldo awal, masuk/keluar, saldo berjalan per baris, saldo akhir = kartu Kas & Bank; transfer berbiaya mengurangi saldo asal nominal + biaya", async () => {
  const w = await skenario();
  const r = await mutasi(w, w.ptSano);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = r.body;
  assert.equal(m.rekening.nama, "PT Sano");
  assert.equal(m.saldoAwal, "67163687.00");
  assert.equal(m.jumlahMutasi, 3);
  assert.equal(m.totalMasuk, "3090000.00");
  assert.equal(m.totalKeluar, (6_493_500 + 5_002_500).toFixed(2), "transfer 5 jt + biaya admin 2.500 keluar dari bank");
  let saldo = 67_163_687;
  for (const b of m.baris) { saldo += Number(b.masuk ?? 0) - Number(b.keluar ?? 0); assert.equal(Number(b.saldo), saldo, `saldo berjalan ${b.nomor}`); }
  assert.equal(m.saldoAkhir, saldo.toFixed(2));
  assert.equal(m.saldoAkhir, (await saldoKasBank(testPrisma)).find((s) => s.name === "PT Sano").saldo.toFixed(2), "saldo akhir = kartu saldo di tab Rekening");
  assert.deepEqual(m.peringatan, [], "tidak ada peringatan pada data bersih");
  const tf = m.baris.find((b) => b.sumber === "TRANSFER_KAS");
  assert.equal(tf.keluar, "5002500.00");
  assert.match(tf.lawan, /1-1200 Bank/, "akun lawan tampil (rekening tujuan)");
});

test("Transfer tampil di KEDUA sisi: KEM masuk Rp5.000.000, bukan biaya admin; Uang Kas: jurnal pembalik tampil terpisah dan saldo kembali", async () => {
  const w = await skenario();
  const kem = (await mutasi(w, w.kem)).body;
  const tf = kem.baris.find((b) => b.sumber === "TRANSFER_KAS");
  assert.equal(tf.masuk, "5000000.00");
  assert.equal(kem.saldoAkhir, (4_000_000 + 5_000_000).toFixed(2));
  const kas = (await mutasi(w, w.kas)).body;
  assert.equal(kas.jumlahMutasi, 2, "jurnal asli + jurnal balik");
  assert.ok(kas.baris.some((b) => b.membalik), "baris pembalik ditandai");
  assert.equal(kas.saldoAkhir, "0.00");
});

test("Pencarian menyaring baris TANPA mengubah saldo berjalan; periode lain memakai saldo awal yang benar; halaman", async () => {
  const w = await skenario();
  const penuh = (await mutasi(w, w.ptSano)).body;
  const cari = (await mutasi(w, w.ptSano, "&q=wahyu")).body;
  assert.equal(cari.total, 1);
  assert.equal(cari.disaring, true);
  assert.equal(cari.baris[0].saldo, penuh.baris.find((b) => b.keterangan.includes("Wahyu")).saldo, "saldo baris tetap saldo berjalan seluruh periode");
  const nominal = (await mutasi(w, w.ptSano, "&q=3090000")).body;
  assert.equal(nominal.total, 1, "pencarian nominal");
  const hal = (await mutasi(w, w.ptSano, "&limit=2&page=1")).body;
  assert.equal(hal.baris.length, 2);
  assert.equal(hal.adaLagi, true);
  const sep = await w.admin.get(`/api/finance/buku/rekening/${w.ptSano.id}/mutasi?from=2026-09-01&to=2026-09-30`);
  assert.equal(sep.body.saldoAwal, "0.00");
  assert.equal(sep.body.saldoAkhir, "67163687.00");
  assert.equal((await w.admin.get(`/api/finance/buku/rekening/${w.ptSano.id}/mutasi?from=2026-10-31&to=2026-10-01`)).status, 400);
  assert.equal((await w.admin.get(`/api/finance/buku/rekening/00000000-0000-4000-8000-000000000000/mutasi?from=2026-10-01&to=2026-10-31`)).status, 404);
});

test("Peringatan: baris beban salah-tanda (data lama) tidak dihitung sebagai uang masuk tetapi DILAPORKAN; jurnal manual lama tanpa rekening DILAPORKAN", async () => {
  const w = await skenario();
  // meniru data produksi lama (dibuat langsung, melewati aturan baru)
  await testPrisma.finJournalEntry.create({ data: { entryNumber: "JV-LAMA-1", date: new Date("2026-10-01T00:00:00Z"), description: "biaya admin lama", source: "TRANSFER_KAS", status: "POSTED", lines: { create: [
    { lineNo: 1, accountId: w.akunBank.id, debit: 0, credit: 2_500, cashAccountId: w.ptSano.id }, { lineNo: 2, accountId: w.bebanAdmin.id, debit: 2_500, credit: 0, cashAccountId: w.ptSano.id } ] } } });
  await testPrisma.finJournalEntry.create({ data: { entryNumber: "JV-LAMA-2", date: new Date("2026-10-01T00:00:00Z"), description: "Fee Farhan Agustus", source: "MANUAL", status: "POSTED", lines: { create: [
    { lineNo: 1, accountId: w.beban.id, debit: 6_715_170, credit: 0 }, { lineNo: 2, accountId: w.akunBank.id, debit: 0, credit: 6_715_170 } ] } } });
  const m = (await mutasi(w, w.ptSano)).body;
  const kode = m.peringatan.map((p) => p.kode).sort();
  assert.deepEqual(kode, ["BARIS_SALAH_TANDA", "BARIS_TANPA_REKENING"]);
  assert.equal(m.peringatan.find((p) => p.kode === "BARIS_SALAH_TANDA").nilai, "2500.00");
  assert.equal(m.peringatan.find((p) => p.kode === "BARIS_TANPA_REKENING").nilai, "-6715170.00");
  assert.equal(m.jumlahMutasi, 4, "mutasi 3 + baris kredit 2.500 pada akun bank bertanda PT Sano (itu uang keluar sungguhan)");
  const kartu = (await saldoKasBank(testPrisma)).find((s) => s.name === "PT Sano").saldo;
  assert.equal(Number(m.saldoAkhir), kartu, "definisi saldo tunggal (15 Okt 2026): baris salah-tanda tidak lagi menaikkan kartu — kartu = mutasi, dan baris keliru tetap DILAPORKAN");
  assert.equal(m.paritas.cocok, true);
});

test("Izin: Finance/Admin boleh baca; Sales 403; tanpa login 401", async () => {
  const w = await skenario();
  assert.equal((await w.sales.get(`/api/finance/buku/rekening/${w.ptSano.id}/mutasi?from=2026-10-01&to=2026-10-31`)).status, 403);
  const res = await fetch(`${server.baseUrl}/api/finance/buku/rekening/${w.ptSano.id}/mutasi?from=2026-10-01&to=2026-10-31`);
  assert.equal(res.status, 401);
});

test("Export Excel Mutasi Rekening = layar: saldo awal, tiap baris dengan saldo berjalan, total, ringkasan; rekening wajib; Sales ditolak", async () => {
  const w = await skenario();
  const layar = (await mutasi(w, w.ptSano)).body;
  const r = await unduhExport(server.baseUrl, w.adminToken, "mutasi-rekening", { periode: { from: "2026-10-01", to: "2026-10-31" }, filter: { cashAccountId: w.ptSano.id } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.headers.get("content-disposition"), /Mutasi_Rekening_2026-10-01_sd_2026-10-31\.xlsx/);
  const s = bacaSheet(r.wb, "Mutasi");
  assert.match(s.kepala[0], /Mutasi Rekening — PT Sano/);
  assert.equal(s.baris[0]["Keterangan"], "Saldo awal periode");
  assert.equal(s.baris[0]["Saldo Berjalan (Rp)"], Number(layar.saldoAwal));
  const baris = s.baris.slice(1);
  assert.equal(baris.length, layar.baris.length);
  layar.baris.forEach((b, i) => {
    assert.equal(baris[i]["No. Jurnal"], b.nomor);
    assert.equal(baris[i]["Saldo Berjalan (Rp)"], Number(b.saldo));
    assert.equal(baris[i]["Masuk (Rp)"], b.masuk === null ? null : Number(b.masuk));
    assert.equal(baris[i]["Keluar (Rp)"], b.keluar === null ? null : Number(b.keluar));
  });
  assert.equal(s.total["Saldo Berjalan (Rp)"], Number(layar.saldoAkhir));
  const ring = bacaSheet(r.wb, "Ringkasan");
  assert.deepEqual(ring.baris.slice(0, 4).map((b) => b["Nilai (Rp)"]), [Number(layar.saldoAwal), Number(layar.totalMasuk), Number(layar.totalKeluar), Number(layar.saldoAkhir)]);

  assert.equal((await unduhExport(server.baseUrl, w.adminToken, "mutasi-rekening", { periode: { from: "2026-10-01", to: "2026-10-31" }, filter: {} })).status, 400, "rekening wajib");
  const dari = await createTestUser({ roles: ["SALES"] });
  assert.equal((await unduhExport(server.baseUrl, dari.token, "mutasi-rekening", { periode: { from: "2026-10-01", to: "2026-10-31" }, filter: { cashAccountId: w.ptSano.id } })).status, 403);
});
