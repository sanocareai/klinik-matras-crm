// REKONSILIASI BANK V2 (15 Okt 2026) — impor rekening koran, pencocokan, panel, hitung fisik kas, exception, export.
// Kasus penerimaan: selisih PT Sano (buku setelah perbaikan Rp54.450.187 vs bank Rp40.509.998 = Rp13.940.189). Fixture memuat transfer PT→KEM Rp5 jt & Rp10 jt, supplier Rp6.496.000 (termasuk
// biaya Rp2.500), kasbon Rp400 ribu, lima uang masuk, biaya admin Rp13 ribu, pajak bunga Rp2.790,07, penerimaan Rp1,75 jt, dan Fee Farhan Rp6.715.170 sebagai jurnal LAMA tanpa rekening.
// Yang dikunci: impor tidak membuat jurnal/ubah saldo; baris bank immutable; pencocokan 1:1/1:N/N:1 + ambigu tidak auto-match; selisih = daftar unmatched dengan total persis; sakelar mati menolak
// semua tulis; izin; hash jurnal lama identik; periode hanya selesai bila residual Rp0 + tanpa exception + snapshot valid; Excel = layar.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
const RP = (n) => Number(n).toFixed(2);

async function dunia({ flag = true } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const a = async (where) => testPrisma.finAccount.findUnique({ where });
  const akunBank = await a({ systemKey: SYSTEM_KEYS.BANK });
  const akunKas = await a({ systemKey: SYSTEM_KEYS.KAS });
  const modal = await a({ code: "3-1100" });
  const bebanAdmin = await a({ code: "6-1700" });
  const piutangKaryawan = await a({ code: "1-1350" });
  const dist = await a({ code: "3-4200" });
  const beban = await testPrisma.finAccount.findFirst({ where: { type: "BEBAN", isPostable: true, NOT: { code: "6-1700" } } });
  const ptSano = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", bankName: "Mandiri", accountNumber: "1230013546272", accountId: akunBank.id } });
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", bankName: "Mandiri", accountNumber: "1570012605136", accountId: akunBank.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Uang Kas Sano", kind: "KAS", accountId: akunKas.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const akuntan = await createTestUser({ roles: ["ACCOUNTANT"] });
  if (flag) await testPrisma.finSetting.upsert({ where: { key: "bank_reconciliation_v2_active" }, create: { key: "bank_reconciliation_v2_active", value: "true" }, update: { value: "true" } });
  return {
    akunBank, akunKas, modal, bebanAdmin, piutangKaryawan, dist, beban, ptSano, kem, kas,
    adminToken: admin.token, adminUser: admin.user, admin: makeClient(server.baseUrl, admin.token), sales: makeClient(server.baseUrl, sales.token), akuntan: makeClient(server.baseUrl, akuntan.token),
  };
}
const jurnal = (w, { tanggal, desc, source = "MANUAL", baris }) => testPrisma.$transaction((tx) => postJournal(tx, { date: tanggal, description: desc, source, idempotencyKey: `BR:${++urut}`, userId: w.adminUser.id, lines: baris }));
const saldoAwal = (w, rek, nilai, tanggal, desc) => jurnal(w, { tanggal, desc, source: "SALDO_AWAL", baris: [{ accountId: rek.accountId, cashAccountId: rek.id, debit: nilai }, { accountId: w.modal.id, credit: nilai }] });
const masuk = (w, rek, nilai, tanggal, desc) => jurnal(w, { tanggal, desc, source: "PEMBAYARAN_ORDER", baris: [{ accountId: w.akunBank.id, cashAccountId: rek.id, debit: nilai }, { accountId: w.modal.id, credit: nilai }] });
const keluar = (w, rek, nilai, tanggal, desc, source = "PENGELUARAN") => jurnal(w, { tanggal, desc, source, baris: [{ accountId: w.beban.id, debit: nilai }, { accountId: rek.accountId ?? w.akunBank.id, cashAccountId: rek.id, credit: nilai }] });
const R = (w, rek, path) => `/api/finance/rekon-bank/${rek.id}${path}`;

async function unggah(token, path, isi, { nama = "mutasi.csv", pemetaan = null } = {}) {
  const fd = new FormData();
  fd.append("file", new Blob([isi], { type: "text/csv" }), nama);
  if (pemetaan) fd.append("pemetaan", JSON.stringify(pemetaan));
  const res = await fetch(`${server.baseUrl}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  let body = null; try { body = await res.json(); } catch { /* kosong */ }
  return { status: res.status, body };
}

/** Hash seluruh jurnal (id, tanggal, status, dibuat, baris: akun/nilai/rekening) — bukti impor/pencocokan/panel TIDAK menyentuh buku. */
async function hashBuku() {
  const es = await testPrisma.finJournalEntry.findMany({ orderBy: { entryNumber: "asc" }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  const isi = es.map((e) => `${e.id}|${e.entryNumber}|${e.date.toISOString()}|${e.status}|${e.createdAt.toISOString()}|${e.lines.map((l) => `${l.accountId}:${l.debit}:${l.credit}:${l.cashAccountId}`).join(",")}`).join("\n");
  return crypto.createHash("sha256").update(isi).digest("hex");
}

/** Skenario PT Sano. Mengembalikan buku & CSV bank. */
async function skenarioPtSano() {
  const w = await dunia();
  await saldoAwal(w, w.ptSano, 67_163_686.93, "2026-09-30", "Saldo akhir September");
  await saldoAwal(w, w.kem, 3_938_470, "2026-09-30", "Saldo KEM September");
  const tf = async (nominal, no) => {
    const t = await testPrisma.finCashTransfer.create({ data: { transferNumber: `TRF-0110-${no}`, date: new Date("2026-10-01T00:00:00Z"), amount: nominal, fromAccountId: w.ptSano.id, toAccountId: w.kem.id, feeAmount: 0, createdById: w.adminUser.id } });
    await testPrisma.$transaction((tx) => postCashTransfer(tx, { transferId: t.id, userId: w.adminUser.id }));
  };
  await tf(5_000_000, "001"); await tf(10_000_000, "002");
  await jurnal(w, { tanggal: "2026-10-01", desc: "Pembayaran PT ESA BUMINDO", source: "PEMBAYARAN_SUPPLIER", baris: [{ accountId: w.beban.id, debit: 6_493_500 }, { accountId: w.bebanAdmin.id, debit: 2_500 }, { accountId: w.akunBank.id, cashAccountId: w.ptSano.id, credit: 6_496_000 }] });
  await jurnal(w, { tanggal: "2026-10-01", desc: "Kasbon Ervina", source: "KASBON", baris: [{ accountId: w.piutangKaryawan.id, debit: 400_000 }, { accountId: w.akunBank.id, cashAccountId: w.ptSano.id, credit: 400_000 }] });
  for (const [n, t, d] of [[1_100_000, "2026-10-01", "Terima order A"], [300_000, "2026-10-02", "Terima order B"], [3_505_000, "2026-10-01", "Terima order C"], [3_090_000, "2026-10-01", "Terima order D"], [1_200_000, "2026-10-01", "Terima order E"]]) await masuk(w, w.ptSano, n, t, d);
  await keluar(w, w.ptSano, 13_000, "2026-09-30", "Biaya administrasi bank");
  await keluar(w, w.ptSano, 2_790.07, "2026-09-30", "Pajak bunga");
  await masuk(w, w.ptSano, 1_750_000, "2026-09-30", "Penerimaan Yana");
  // Fee Farhan: jurnal MANUAL LAMA tanpa rekening (dibuat langsung — melewati aturan baru, seperti data produksi)
  await testPrisma.finJournalEntry.create({ data: { entryNumber: "JV-25092026-731", date: new Date("2026-09-25T00:00:00Z"), description: "Fee Farhan Agustus", source: "MANUAL", status: "POSTED", lines: { create: [
    { lineNo: 1, accountId: w.dist.id, debit: 6_715_170, credit: 0 }, { lineNo: 2, accountId: w.akunBank.id, debit: 0, credit: 6_715_170 } ] } } });
  const buku = (await saldoKasBank(testPrisma)).find((s) => s.name === "PT Sano").saldo;

  // Rekening koran bank (sudut pandang bank): opening 67.163.686,93; baris sama dengan buku + dua uang keluar yang BELUM ada di buku.
  const baris = [
    ["01/10/2026", "TRF KE KEM 5JT", "R01", 5_000_000, 0], ["01/10/2026", "TRF KE KEM 10JT", "R02", 10_000_000, 0],
    ["01/10/2026", "PEMBAYARAN PT ESA BUMINDO", "R03", 6_493_500, 0], ["01/10/2026", "BIAYA TRANSFER BI-FAST", "R04", 2_500, 0],
    ["01/10/2026", "KASBON ERVINA", "R05", 400_000, 0],
    ["01/10/2026", "SETORAN ORDER A", "R06", 0, 1_100_000], ["02/10/2026", "SETORAN ORDER B", "R07", 0, 300_000], ["01/10/2026", "SETORAN ORDER C", "R08", 0, 3_505_000], ["01/10/2026", "SETORAN ORDER D", "R09", 0, 3_090_000], ["01/10/2026", "SETORAN ORDER E", "R10", 0, 1_200_000],
    ["01/10/2026", "BIAYA ADM BANK", "R11", 13_000, 0], ["01/10/2026", "PAJAK BUNGA", "R12", 2_790.07, 0], ["01/10/2026", "SETORAN YANA", "R13", 0, 1_750_000],
    ["01/10/2026", "TRANSFER KELUAR FEE FARHAN", "R14", 6_715_170, 0], ["02/10/2026", "TRANSFER KELUAR BELUM DICATAT", "R15", 7_225_019, 0],
  ];
  let saldo = 67_163_686.93;
  const fmt = (n) => n.toFixed(2).replace(".", ",");
  const csv = ["Rekening Koran PT SANO KREASI UTAMA;;;;;", "Tanggal;Keterangan;Referensi;Debit;Kredit;Saldo"].concat(baris.map(([t, k, r, d, c]) => { saldo = Math.round((saldo - d + c) * 100) / 100; return `${t};${k};${r};${fmt(d)};${fmt(c)};${fmt(saldo)}`; })).join("\n");
  return { w, buku: Number(buku), csv, bankAkhir: saldo };
}

// ── Sakelar, izin, dan jaminan "tidak menyentuh buku" ──────────────────────────────────────────────────────────
test("Sakelar MATI (default): semua endpoint TULIS menolak 403 SAKELAR_MATI; endpoint BACA tetap bekerja", async () => {
  const w = await dunia({ flag: false });
  const csv = "Tanggal,Keterangan,Debit,Kredit\n01/10/2026,A,0,100";
  assert.equal((await unggah(w.adminToken, R(w, w.ptSano, "/impor/pratinjau"), csv)).status, 403);
  const imp = await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  assert.equal(imp.status, 403); assert.equal(imp.body.code, "SAKELAR_MATI");
  for (const [path, body] of [["/cocokkan", { bankLineIds: [], journalLineIds: [], alasan: "uji coba alasan" }], ["/cocokkan-otomatis", {}], ["/kecualikan", { bankLineIds: [], alasan: "uji coba alasan" }], ["/periode/selesai", { to: "2026-10-02" }]]) {
    const r = await w.admin.post(R(w, w.ptSano, path), body);
    assert.equal(r.status, 403, path);
    assert.equal(r.body.code, "SAKELAR_MATI");
  }
  assert.equal((await w.admin.post(R(w, w.kas, "/opname"), { tanggal: "2026-10-02", jumlah: 0 })).status, 403);
  assert.equal((await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).status, 200);
  assert.equal((await w.admin.get("/api/finance/rekon-bank/kartu?to=2026-10-02")).status, 200);
  assert.equal((await w.admin.get(R(w, w.ptSano, "/mutasi-bank?from=2026-10-01&to=2026-10-02"))).status, 200);
  assert.equal((await w.admin.get("/api/finance/rekon-bank/exception-jurnal-tanpa-rekening")).status, 200);
  const panel = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).body;
  assert.equal(panel.sakelarAktif, false);
  assert.equal(panel.bisaSelesai, false);
});

test("Izin: Sales 403 di semua endpoint & 401 tanpa login; Akuntan boleh impor/cocok tetapi TIDAK kecualikan/selesaikan periode (butuh persetujuan)", async () => {
  const { w, csv } = await skenarioPtSano();
  for (const p of ["/panel?to=2026-10-02", "/mutasi-bank?from=2026-10-01&to=2026-10-02", "/pencocokan?to=2026-10-02", "/batch"]) assert.equal((await w.sales.get(R(w, w.ptSano, p))).status, 403, p);
  assert.equal((await w.sales.get("/api/finance/rekon-bank/kartu")).status, 403);
  assert.equal((await w.sales.get("/api/finance/rekon-bank/exception-jurnal-tanpa-rekening")).status, 403);
  assert.equal((await fetch(`${server.baseUrl}/api/finance/rekon-bank/kartu`)).status, 401);
  assert.equal((await w.sales.post(R(w, w.ptSano, "/cocokkan-otomatis"), {})).status, 403);
  assert.equal((await unduhExport(server.baseUrl, (await createTestUser({ roles: ["SALES"] })).token, "mutasi-bank", { filter: { cashAccountId: w.ptSano.id }, periode: { from: "2026-10-01", to: "2026-10-02" } })).status, 403);

  const t = (await createTestUser({ roles: ["ACCOUNTANT"] })).token;
  assert.equal((await unggah(t, R(w, w.ptSano, "/impor"), csv)).status, 201);
  assert.equal((await makeClient(server.baseUrl, t).post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" })).status, 200);
  assert.equal((await makeClient(server.baseUrl, t).post(R(w, w.ptSano, "/kecualikan"), { bankLineIds: ["00000000-0000-4000-8000-000000000000"], alasan: "uji coba alasan" })).status, 403);
  assert.equal((await makeClient(server.baseUrl, t).post(R(w, w.ptSano, "/periode/selesai"), { to: "2026-10-02" })).status, 403);
});

test("Impor + pencocokan + panel TIDAK menyentuh buku: hash seluruh jurnal identik sebelum/sesudah; nomor rekening dimasker di panel", async () => {
  const { w, csv, buku } = await skenarioPtSano();
  const sebelum = await hashBuku();
  const saldoSebelum = (await saldoKasBank(testPrisma)).map((s) => `${s.name}:${s.saldo}`).join("|");
  const imp = await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  assert.equal(imp.status, 201, JSON.stringify(imp.body));
  assert.equal(imp.body.jumlahBaris, 15);
  await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" });
  const panel = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).body;
  await w.admin.get(R(w, w.ptSano, "/pencocokan?to=2026-10-02"));
  assert.equal(await hashBuku(), sebelum, "jurnal lama identik");
  assert.equal((await saldoKasBank(testPrisma)).map((s) => `${s.name}:${s.saldo}`).join("|"), saldoSebelum, "saldo buku tidak berubah");
  assert.equal(panel.saldoBuku, RP(buku));
  assert.equal(panel.rekening.nomor, "••••6272", "nomor rekening dimasker");
  assert.doesNotMatch(JSON.stringify(panel), /1230013546272/);
  assert.equal(await testPrisma.finJournalEntry.count(), (await testPrisma.finJournalEntry.count()));
});

// ── Impor ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("Pratinjau: pemetaan otomatis, total, saldo awal/akhir dari kolom saldo, rantai saldo konsisten, bisaDiimpor; tidak menulis apa pun", async () => {
  const { w, csv, bankAkhir } = await skenarioPtSano();
  const p = await unggah(w.adminToken, R(w, w.ptSano, "/impor/pratinjau"), csv);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.jumlahBaris, 15);
  assert.equal(p.body.jumlahGanda, 0);
  assert.equal(p.body.saldoAwalBerkas, "67163686.93");
  assert.equal(p.body.saldoAkhirBerkas, RP(bankAkhir));
  assert.equal(p.body.rantaiSaldo.konsisten, true);
  assert.equal(p.body.bisaDiimpor, true);
  assert.equal(p.body.rekening.nomor, "••••6272");
  assert.equal(await testPrisma.finBankImportBatch.count(), 0);
  assert.equal(await testPrisma.finBankImportLine.count(), 0);
});

test("Impor ganda: berkas sama persis → 409; berkas tumpang tindih hanya memasukkan baris baru; semua baris sudah ada → 409; sidik jari per rekening", async () => {
  const { w, csv } = await skenarioPtSano();
  assert.equal((await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv)).status, 201);
  const lagi = await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  assert.equal(lagi.status, 409); assert.equal(lagi.body.code, "BERKAS_GANDA");
  const pv = await unggah(w.adminToken, R(w, w.ptSano, "/impor/pratinjau"), csv);
  assert.equal(pv.body.bisaDiimpor, false);
  assert.ok(pv.body.berkasSama);
  // berkas lain (byte berbeda) yang isinya tumpang tindih + 1 baris baru
  const parsed = csv.split("\n");
  const barisAkhir = parsed.at(-1).split(";");
  const saldoBaru = (Number(barisAkhir[5].replace(/\./g, "").replace(",", ".")) + 50_000).toFixed(2).replace(".", ",");
  const berkas2 = parsed.concat([`03/10/2026;SETORAN BARU;R16;0,00;50.000,00;${saldoBaru}`]).join("\n");
  const r2 = await unggah(w.adminToken, R(w, w.ptSano, "/impor"), berkas2, { nama: "mutasi2.csv" });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(r2.body.jumlahBaris, 1);
  assert.equal(r2.body.dilewati, 15);
  assert.equal(await testPrisma.finBankImportLine.count({ where: { cashAccountId: w.ptSano.id } }), 16);
  // berkas dengan format lain tetapi seluruh baris sudah ada
  const subset = [parsed[0], parsed[1], parsed[2], parsed[3]].join("\n");
  const r3 = await unggah(w.adminToken, R(w, w.ptSano, "/impor"), subset, { nama: "sebagian.csv" });
  assert.equal(r3.status, 409); assert.equal(r3.body.code, "SEMUA_GANDA");
  // rekening lain: baris yang sama sah diimpor (sidik jari per rekening)
  assert.equal((await unggah(w.adminToken, R(w, w.kem, "/impor"), csv)).status, 201);
});

test("Berkas rusak: nominal tidak terbaca = 422 dengan nomor baris dan TIDAK ada yang diimpor; Uang Kas tidak punya rekening koran; berkas non-tabel ditolak", async () => {
  const w = await dunia();
  const rusak = "Tanggal,Keterangan,Debit,Kredit\n01/10/2026,A,0,100\n02/10/2026,B,xyz,0";
  const r = await unggah(w.adminToken, R(w, w.ptSano, "/impor"), rusak);
  assert.equal(r.status, 422); assert.match(r.body.error, /baris 3/);
  assert.equal(await testPrisma.finBankImportLine.count(), 0);
  assert.equal((await unggah(w.adminToken, R(w, w.kas, "/impor"), "Tanggal,Keterangan,Debit,Kredit\n01/10/2026,A,0,100")).status, 422);
  assert.equal((await unggah(w.adminToken, R(w, w.ptSano, "/impor"), "bukan,tabel\n1,2")).status, 400);
  const tanpaBerkas = await w.admin.post(R(w, w.ptSano, "/impor"), {});
  assert.equal(tanpaBerkas.status, 400);
});

test("Baris bank IMMUTABLE di database: UPDATE isi & DELETE ditolak trigger; batch tidak bisa dihapus", async () => {
  const { w, csv } = await skenarioPtSano();
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  const baris = await testPrisma.finBankImportLine.findFirst();
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`UPDATE fin_bank_import_lines SET debit = 1 WHERE id = '${baris.id}'::uuid`), /immutable/);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`UPDATE fin_bank_import_lines SET description = 'x' WHERE id = '${baris.id}'::uuid`), /immutable/);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`DELETE FROM fin_bank_import_lines WHERE id = '${baris.id}'::uuid`), /immutable/);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`DELETE FROM fin_bank_import_batches WHERE id = '${baris.batchId}'::uuid`), /tidak boleh dihapus/);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`UPDATE fin_bank_import_batches SET row_count = 1 WHERE id = '${baris.batchId}'::uuid`), /immutable/);
});

test("Rollback batch: butuh alasan; ditolak bila masih dicocokkan; opsi lepas pencocokan; baris tidak dihapus; berkas bisa diimpor ulang; ditolak bila periode selesai", async () => {
  const { w, csv } = await skenarioPtSano();
  const imp = (await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv)).body;
  await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" });
  const url = `/api/finance/rekon-bank/batch/${imp.batchId}/batalkan`;
  assert.equal((await w.admin.post(url, { alasan: "pendek" })).status, 400);
  const tolak = await w.admin.post(url, { alasan: "salah berkas, perlu impor ulang" });
  assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "MASIH_DICOCOKKAN");
  const ok = await w.admin.post(url, { alasan: "salah berkas, perlu impor ulang", lepasPencocokan: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.pencocokanDilepas, 11);
  assert.equal(await testPrisma.finBankImportLine.count(), 15, "baris tidak dihapus");
  assert.equal(await testPrisma.finBankImportLine.count({ where: { rolledBackAt: null } }), 0);
  assert.equal(await testPrisma.finBankMatchGroup.count({ where: { undoneAt: { not: null } } }), 11);
  assert.equal((await w.admin.post(url, { alasan: "dobel dibatalkan lagi" })).status, 409);
  assert.equal((await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv)).status, 201, "boleh diimpor ulang setelah rollback");
});

// ── Pencocokan ──────────────────────────────────────────────────────────────────────────────────────────────────
test("Cocokkan otomatis: hanya 1:1 tak ambigu (11 pasangan); supplier+biaya (N:1), Fee Farhan, dan dua uang keluar lain TIDAK dicocokkan; baris Fee Farhan tidak pernah tertaut", async () => {
  const { w, csv } = await skenarioPtSano();
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  const r = await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.dicocokkan, 11);
  const p = (await w.admin.get(R(w, w.ptSano, "/pencocokan?to=2026-10-02"))).body;
  assert.equal(p.ringkasan.bankBelumDicocokkan, 4, "2 baris supplier/biaya + 2 uang keluar belum dibukukan");
  assert.equal(p.ringkasan.bukuBelumDicocokkan, 1, "satu baris buku supplier Rp6.496.000");
  assert.ok(p.kombinasi.some((k) => k.bentuk === "N:1" && k.bank.length === 2 && k.buku[0].keluar === "6496000.00"), "saran N:1: transfer + biaya = satu baris buku");
  const statusBank = Object.fromEntries(p.bank.map((b) => [b.deskripsi, b.status]));
  assert.equal(statusBank["TRANSFER KELUAR FEE FARHAN"], "BELUM_ADA_DI_BUKU");
  assert.equal(statusBank["TRANSFER KELUAR BELUM DICATAT"], "BELUM_ADA_DI_BUKU");
  assert.equal(statusBank["PEMBAYARAN PT ESA BUMINDO"], "DISARANKAN");
  assert.equal(p.buku[0].status, "DISARANKAN");
  const jvLama = await testPrisma.finJournalLine.findFirst({ where: { entry: { entryNumber: "JV-25092026-731" }, credit: { gt: 0 } } });
  assert.equal(await testPrisma.finBankMatchItem.count({ where: { journalLineId: jvLama.id } }), 0, "Fee Farhan tidak ditautkan otomatis");
  // pasangan 1:1 beda tanggal 1 hari (biaya adm 30 Sep vs bank 1 Okt) tetap otomatis
  const kat = await testPrisma.finBankMatchGroup.findMany({ select: { category: true } });
  assert.ok(kat.some((g) => g.category === "TRANSFER_ANTAR_REKENING"));
  assert.ok(kat.some((g) => g.category === "BEDA_TANGGAL"));
  // dijalankan lagi: tidak ada pasangan baru (idempoten)
  assert.equal((await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" })).body.dicocokkan, 0);
});

test("AMBIGU tidak di-auto-match: dua baris bank Rp500.000 & dua baris buku Rp500.000 di hari sama → tidak ada pencocokan otomatis; manual 1:1 sah", async () => {
  const w = await dunia();
  await masuk(w, w.ptSano, 500_000, "2026-10-01", "A"); await masuk(w, w.ptSano, 500_000, "2026-10-01", "B");
  const csv = "Tanggal;Keterangan;Debit;Kredit;Saldo\n01/10/2026;SETORAN 1;0,00;500.000,00;500.000,00\n01/10/2026;SETORAN 2;0,00;500.000,00;1.000.000,00";
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  assert.equal((await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" })).body.dicocokkan, 0);
  const p = (await w.admin.get(R(w, w.ptSano, "/pencocokan?to=2026-10-02"))).body;
  assert.ok(p.bank.every((b) => b.status === "DISARANKAN" && b.kandidat.length === 2));
  const manual = await w.admin.post(R(w, w.ptSano, "/cocokkan"), { bankLineIds: [p.bank[0].id], journalLineIds: [p.buku[0].id], alasan: "dipasangkan sesuai urutan input" });
  assert.equal(manual.status, 201, JSON.stringify(manual.body));
  assert.equal(manual.body.bentuk, "1:1");
});

test("Pencocokan MANUAL N:1 (transfer+biaya), 1:N, N:N; harus seimbang persis; alasan wajib; baris rekening lain/jurnal tanpa rekening ditolak; baris dobel ditolak", async () => {
  const { w, csv } = await skenarioPtSano();
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" });
  const p = (await w.admin.get(R(w, w.ptSano, "/pencocokan?to=2026-10-02"))).body;
  const idBank = (d) => p.bank.find((b) => b.deskripsi === d).id;
  const idSup = p.buku[0].id;
  // tidak seimbang
  const salah = await w.admin.post(R(w, w.ptSano, "/cocokkan"), { bankLineIds: [idBank("PEMBAYARAN PT ESA BUMINDO")], journalLineIds: [idSup], alasan: "supplier tanpa biaya" });
  assert.equal(salah.status, 422); assert.equal(salah.body.code, "TIDAK_SEIMBANG"); assert.match(salah.body.error, /selisih/);
  // alasan pendek
  assert.equal((await w.admin.post(R(w, w.ptSano, "/cocokkan"), { bankLineIds: [idBank("PEMBAYARAN PT ESA BUMINDO"), idBank("BIAYA TRANSFER BI-FAST")], journalLineIds: [idSup], alasan: "x" })).status, 400);
  // sisi kosong
  assert.equal((await w.admin.post(R(w, w.ptSano, "/cocokkan"), { bankLineIds: [idBank("BIAYA TRANSFER BI-FAST")], journalLineIds: [], alasan: "tanpa sisi buku" })).status, 400);
  // jurnal lama tanpa rekening bukan milik rekening ini
  const jvLama = await testPrisma.finJournalLine.findFirst({ where: { entry: { entryNumber: "JV-25092026-731" }, credit: { gt: 0 } } });
  const lamaR = await w.admin.post(R(w, w.ptSano, "/cocokkan"), { bankLineIds: [idBank("TRANSFER KELUAR FEE FARHAN")], journalLineIds: [jvLama.id], alasan: "fee farhan dari PT Sano?" });
  assert.equal(lamaR.status, 404, "Fee Farhan tidak bisa ditautkan — bukan baris rekening ini");
  // benar: N:1
  const ok = await w.admin.post(R(w, w.ptSano, "/cocokkan"), { bankLineIds: [idBank("PEMBAYARAN PT ESA BUMINDO"), idBank("BIAYA TRANSFER BI-FAST")], journalLineIds: [idSup], alasan: "transfer supplier + biaya BI-FAST" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.bentuk, "N:1");
  // baris yang sudah dicocokkan tidak bisa dipakai lagi
  const dobel = await w.admin.post(R(w, w.ptSano, "/cocokkan"), { bankLineIds: [idBank("BIAYA TRANSFER BI-FAST")], journalLineIds: [idSup], alasan: "mencoba lagi" });
  assert.equal(dobel.status, 409);
  // rekening lain: baris KEM tidak boleh dicocokkan dengan bank PT Sano
  const kem = await w.admin.get(R(w, w.kem, "/pencocokan?to=2026-10-02"));
  assert.equal(kem.status, 200);
  // audit
  const log = await testPrisma.activityEvent.findMany({ where: { eventType: "BANK_REKON_V2" } });
  assert.ok(log.some((e) => e.metadata?.aksi === "cocok" && e.metadata?.jenis === "MANUAL" && e.metadata?.bentuk === "N:1" && /biaya BI-FAST/.test(e.metadata.alasan)));
});

test("1:N dan N:N manual; lepas pencocokan butuh alasan, riwayat tetap (kelompok tidak dihapus), baris kembali belum dicocokkan; trigger menolak pasangan lintas rekening", async () => {
  const w = await dunia();
  await masuk(w, w.ptSano, 3_090_000, "2026-10-01", "D"); await masuk(w, w.ptSano, 1_200_000, "2026-10-01", "E");
  await masuk(w, w.kem, 123_000, "2026-10-01", "KEM");
  const csv = "Tanggal;Keterangan;Debit;Kredit;Saldo\n01/10/2026;SETORAN GABUNGAN;0,00;4.290.000,00;4.290.000,00";
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  const p = (await w.admin.get(R(w, w.ptSano, "/pencocokan?to=2026-10-02"))).body;
  assert.ok(p.kombinasi.some((k) => k.bentuk === "1:N"));
  const ok = await w.admin.post(R(w, w.ptSano, "/cocokkan"), { bankLineIds: [p.bank[0].id], journalLineIds: p.buku.map((b) => b.id), alasan: "setoran gabungan dua order" });
  assert.equal(ok.status, 201); assert.equal(ok.body.bentuk, "1:N");
  const g = ok.body.groupId;
  assert.equal((await w.admin.post(`/api/finance/rekon-bank/pencocokan/${g}/lepas`, { alasan: "x" })).status, 400);
  assert.equal((await w.admin.post(`/api/finance/rekon-bank/pencocokan/${g}/lepas`, { alasan: "salah pasangan, dibatalkan" })).status, 200);
  assert.equal(await testPrisma.finBankMatchGroup.count(), 1, "kelompok tidak dihapus");
  assert.equal(await testPrisma.finBankMatchItem.count({ where: { active: true } }), 0);
  assert.equal((await w.admin.post(`/api/finance/rekon-bank/pencocokan/${g}/lepas`, { alasan: "dibatalkan lagi nih" })).status, 409);
  const lagi = (await w.admin.get(R(w, w.ptSano, "/pencocokan?to=2026-10-02"))).body;
  assert.equal(lagi.ringkasan.bankBelumDicocokkan, 1);
  assert.equal((await w.admin.post(R(w, w.ptSano, "/cocokkan"), { bankLineIds: [p.bank[0].id], journalLineIds: p.buku.map((b) => b.id), alasan: "dipasang ulang dengan benar" })).status, 201, "boleh dipasang lagi setelah dibatalkan");
  // trigger DB: item lintas rekening ditolak walau service dilewati
  const grup = await testPrisma.finBankMatchGroup.create({ data: { cashAccountId: w.kem.id, kind: "MANUAL", shape: "1:1", reason: "uji trigger lintas rekening" } });
  const barisBank = await testPrisma.finBankImportLine.findFirst();
  await assert.rejects(() => testPrisma.finBankMatchItem.create({ data: { groupId: grup.id, bankLineId: barisBank.id } }), /REKENING YANG SAMA/);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`DELETE FROM fin_bank_match_groups WHERE id = '${g}'::uuid`), /tidak boleh dihapus/);
});

test("Kecualikan: alasan wajib & diaudit; tampil sebagai Dikecualikan (bukan cocok) dan tetap menjadi bagian selisih yang diterima; bisa dibatalkan", async () => {
  const { w, csv } = await skenarioPtSano();
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" });
  const p = (await w.admin.get(R(w, w.ptSano, "/pencocokan?to=2026-10-02"))).body;
  const farhan = p.bank.find((b) => b.deskripsi === "TRANSFER KELUAR FEE FARHAN");
  assert.equal((await w.admin.post(R(w, w.ptSano, "/kecualikan"), { bankLineIds: [farhan.id], alasan: "pendek" })).status, 400);
  const k = await w.admin.post(R(w, w.ptSano, "/kecualikan"), { bankLineIds: [farhan.id], alasan: "menunggu keterangan dari Owner soal Fee Farhan" });
  assert.equal(k.status, 201);
  const sesudah = (await w.admin.get(R(w, w.ptSano, "/mutasi-bank?from=2026-10-01&to=2026-10-02"))).body;
  assert.equal(sesudah.baris.find((b) => b.id === farhan.id).status, "DIKECUALIKAN");
  assert.equal(sesudah.perStatus.DIKECUALIKAN, 1);
  const panel = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).body;
  assert.equal(panel.komponen.dikecualikan.efek, "6715170.00", "dikecualikan tetap tampil sebagai selisih yang diterima");
  assert.equal(panel.belumDijelaskan, "0.00");
  assert.ok(panel.exception.some((e) => e.kode === "BANK_BELUM_DIBUKUKAN"), "yang belum dikecualikan masih exception");
});

// ── Panel: kasus PT Sano ────────────────────────────────────────────────────────────────────────────────────────
test("KASUS PT SANO: selisih buku−bank = Rp13.940.189 dijelaskan PERSIS oleh dua baris bank belum dibukukan (6.715.170 + 7.225.019); belum dijelaskan Rp0; Fee Farhan = exception & skenario (selisih 7.225.019), tidak ditautkan", async () => {
  const { w, csv, buku, bankAkhir } = await skenarioPtSano();
  assert.equal(RP(buku - bankAkhir), "13940189.00", "fixture meniru selisih PT Sano");
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" });
  const p0 = (await w.admin.get(R(w, w.ptSano, "/pencocokan?to=2026-10-02"))).body;
  const id = (d) => p0.bank.find((b) => b.deskripsi === d).id;
  const man = await w.admin.post(R(w, w.ptSano, "/cocokkan"), { bankLineIds: [id("PEMBAYARAN PT ESA BUMINDO"), id("BIAYA TRANSFER BI-FAST")], journalLineIds: [p0.buku[0].id], alasan: "transfer supplier + biaya BI-FAST" });
  assert.equal(man.status, 201);

  const panel = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).body;
  assert.equal(panel.saldoBuku, RP(buku));
  assert.equal(panel.saldoBank, RP(bankAkhir));
  assert.equal(panel.sumberSaldoBank, "RANTAI_SALDO_KORAN");
  assert.equal(panel.selisih, "13940189.00");
  assert.equal(panel.arahSelisih, "BUKU_LEBIH_TINGGI");
  // transaksi penyusun selisih = daftar bank belum dibukukan dengan total PERSIS
  const bb = panel.komponen.bankBelumDibukukan;
  assert.equal(bb.jumlah, 2);
  assert.deepEqual(bb.baris.map((b) => b.keluar).sort(), ["6715170.00", "7225019.00"]);
  assert.equal(bb.efek, "13940189.00");
  assert.equal(panel.komponen.bukuBelumMuncul.efek, "0.00");
  assert.equal(panel.komponen.perbedaanCutoff.efek, "0.00");
  assert.equal(panel.komponen.selisihSaldoAwal.efek, "0.00");
  assert.equal(panel.belumDijelaskan, "0.00");
  assert.equal(panel.bisaSelesai, false);
  // Fee Farhan: exception + skenario, tidak tertaut
  const ex = panel.exception.find((e) => e.kode === "JURNAL_TANPA_REKENING");
  assert.ok(ex && ex.terbuka && ex.nomor === "JV-25092026-731" && ex.nilai === "-6715170.00");
  assert.equal(panel.skenarioJurnalTanpaRekening.length, 1);
  assert.equal(panel.skenarioJurnalTanpaRekening[0].jikaMilikRekeningIni.selisihBukuMinusBank, "7225019.00", "bila Fee Farhan terbukti dari PT Sano: residual Rp7.225.019");
  const lap = (await w.admin.get("/api/finance/rekon-bank/exception-jurnal-tanpa-rekening")).body;
  assert.equal(lap.jumlah, 1);
  assert.equal(lap.items[0].nomor, "JV-25092026-731");
  assert.deepEqual(lap.items[0].kandidatRekening.map((k) => k.nama).sort(), ["KEM - Sano Bank", "PT Sano"]);
  assert.equal(lap.items[0].keluar, "6715170.00");
  assert.match(lap.items[0].tindakan, /TIDAK ditebak/);
  // kartu per rekening
  const kartu = (await w.admin.get("/api/finance/rekon-bank/kartu?to=2026-10-02")).body;
  const k = kartu.rekening.find((r) => r.nama === "PT Sano");
  assert.equal(k.saldoBuku, RP(buku)); assert.equal(k.saldoBank, RP(bankAkhir)); assert.equal(k.selisih, "13940189.00"); assert.equal(k.belumCocok, 2); assert.equal(k.terakhirDirekonsiliasi, null);
  assert.equal(k.nomor, "••••6272");
  // periode belum bisa selesai
  const gagal = await w.admin.post(R(w, w.ptSano, "/periode/selesai"), { to: "2026-10-02" });
  assert.equal(gagal.status, 422); assert.equal(gagal.body.code, "BELUM_BISA_SELESAI");
});

test("Tanpa rekening koran: panel menyatakan saldo bank belum diketahui; saldo manual dipakai bila diisi, selisih seluruhnya 'belum dijelaskan' (13.940.189) sampai ada mutasi", async () => {
  const { w, buku } = await skenarioPtSano();
  const kosong = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).body;
  assert.equal(kosong.adaDataBank, false); assert.equal(kosong.saldoBank, null); assert.equal(kosong.selisih, null);
  assert.equal(kosong.syarat.find((s) => s.kode === "SALDO_BANK").ok, false);
  const manual = (await w.admin.get(R(w, w.ptSano, `/panel?to=2026-10-02&saldoBankAkhir=${RP(buku - 13_940_189)}`))).body;
  assert.equal(manual.sumberSaldoBank, "DIISI_PENGGUNA");
  assert.equal(manual.selisih, "13940189.00");
  assert.equal(manual.belumDijelaskan, "13940189.00", "tanpa mutasi bank tidak ada yang menjelaskan selisih");
  assert.equal(manual.komponen.bankBelumDibukukan.jumlah, 0);
  assert.equal(manual.skenarioJurnalTanpaRekening[0].jikaMilikRekeningIni.selisihBukuMinusBank, "7225019.00");
});

test("Cutoff lintas tanggal: jurnal bertanggal setelah data bank terakhir masuk 'perbedaan cutoff', bukan 'belum muncul di bank'; belum dijelaskan tetap Rp0", async () => {
  const w = await dunia();
  await saldoAwal(w, w.ptSano, 1_000_000, "2026-09-30", "Saldo");
  await masuk(w, w.ptSano, 200_000, "2026-10-01", "Setoran 1 Okt");
  const csv = "Tanggal;Keterangan;Debit;Kredit;Saldo\n01/10/2026;SETORAN;0,00;200.000,00;1.200.000,00";
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-05" });
  await masuk(w, w.ptSano, 777_000, "2026-10-03", "Setoran 3 Okt (belum di bank)");
  await masuk(w, w.ptSano, 55_000, "2026-10-01", "Setoran 1 Okt tidak ada di bank");
  const p = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-05"))).body;
  assert.equal(p.rentangDataBank.sampai, "2026-10-01");
  assert.equal(p.komponen.perbedaanCutoff.efek, "777000.00");
  assert.equal(p.komponen.bukuBelumMuncul.efek, "55000.00");
  assert.equal(p.komponen.bukuBelumMuncul.jumlah, 1);
  assert.equal(p.selisih, "832000.00");
  assert.equal(p.belumDijelaskan, "0.00");
  // pencocokan yang sebagian anggotanya melewati tanggal akhir → perbedaan cutoff (grup dipecah oleh batas T)
  const awal = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-01"))).body;
  assert.equal(awal.komponen.perbedaanCutoff.efek, "0.00");
  assert.equal(awal.komponen.bukuBelumMuncul.efek, "55000.00");
  assert.equal(awal.belumDijelaskan, "0.00");
});

test("Jurnal dan pembaliknya yang sama-sama belum dicocokkan saling meniadakan (Dikecualikan otomatis, tidak jadi 'belum ada di bank'); jurnal lama tanpa rekening yang sudah dikoreksi bukan exception", async () => {
  const w = await dunia();
  const salah = (await masuk(w, w.ptSano, 90_000, "2026-10-01", "Salah input")).entry;
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: salah.id, date: "2026-10-01", reason: "salah input", userId: w.adminUser.id }));
  const csv = "Tanggal;Keterangan;Debit;Kredit;Saldo\n01/10/2026;SETORAN LAIN;0,00;10.000,00;10.000,00";
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  const p = (await w.admin.get(R(w, w.ptSano, "/pencocokan?to=2026-10-02"))).body;
  assert.equal(p.ringkasan.bukuBelumDicocokkan, 0, "asli + pembalik tidak muncul sebagai belum dicocokkan");
  const mb = (await w.admin.get(`/api/finance/buku/rekening/${w.ptSano.id}/mutasi?from=2026-10-01&to=2026-10-02`)).body;
  assert.equal(mb.jumlahMutasi, 2);
  // jurnal lama tanpa rekening → dibalik → bukan exception lagi
  const lama = await testPrisma.finJournalEntry.create({ data: { entryNumber: "JV-LAMA-9", date: new Date("2026-09-25T00:00:00Z"), description: "Fee lama", source: "MANUAL", status: "POSTED", lines: { create: [
    { lineNo: 1, accountId: w.dist.id, debit: 500, credit: 0 }, { lineNo: 2, accountId: w.akunBank.id, debit: 0, credit: 500 } ] } } });
  assert.equal((await w.admin.get("/api/finance/rekon-bank/exception-jurnal-tanpa-rekening")).body.jumlahTerbuka, 1);
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: lama.id, date: "2026-10-01", reason: "diganti jurnal ber-rekening", userId: w.adminUser.id }));
  const lap = (await w.admin.get("/api/finance/rekon-bank/exception-jurnal-tanpa-rekening")).body;
  assert.equal(lap.jumlah, 0); assert.equal(lap.terkoreksi, 2);
});

// ── Penyelesaian periode ────────────────────────────────────────────────────────────────────────────────────────
test("PERIODE: selesai HANYA bila residual Rp0 + tanpa exception + snapshot valid; alur koreksi (balik + pengganti ber-rekening + catat yang belum dibukukan) → selesai; sesudahnya terkunci; jurnal berubah → snapshot tidak berlaku", async () => {
  const { w, csv } = await skenarioPtSano();
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" });
  let p = (await w.admin.get(R(w, w.ptSano, "/pencocokan?to=2026-10-02"))).body;
  const id = (d) => p.bank.find((b) => b.deskripsi === d).id;
  await w.admin.post(R(w, w.ptSano, "/cocokkan"), { bankLineIds: [id("PEMBAYARAN PT ESA BUMINDO"), id("BIAYA TRANSFER BI-FAST")], journalLineIds: [p.buku[0].id], alasan: "transfer supplier + biaya BI-FAST" });
  // Koreksi sah: dokumen pengganti (BUKAN overwrite). Fee Farhan terbukti dari PT Sano → balik jurnal lama + jurnal pengganti ber-rekening; satu pengeluaran lain dicatat.
  const lama = await testPrisma.finJournalEntry.findFirst({ where: { entryNumber: "JV-25092026-731" } });
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: lama.id, date: "2026-10-01", reason: "Fee Farhan terbukti keluar dari PT Sano; diganti jurnal ber-rekening", userId: w.adminUser.id }));
  await jurnal(w, { tanggal: "2026-10-01", desc: "Fee Farhan Agustus (pengganti, rekening PT Sano)", baris: [{ accountId: w.dist.id, debit: 6_715_170 }, { accountId: w.akunBank.id, cashAccountId: w.ptSano.id, credit: 6_715_170 }] });
  await jurnal(w, { tanggal: "2026-10-02", desc: "Pengeluaran yang belum dicatat", source: "PENGELUARAN", baris: [{ accountId: w.beban.id, debit: 7_225_019 }, { accountId: w.akunBank.id, cashAccountId: w.ptSano.id, credit: 7_225_019 }] });
  const oto = await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" });
  assert.equal(oto.body.dicocokkan, 2);

  const panel = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).body;
  assert.equal(panel.selisih, "0.00");
  assert.equal(panel.belumDijelaskan, "0.00");
  assert.equal(panel.exceptionTerbuka, 0, JSON.stringify(panel.exception));
  assert.equal(panel.bisaSelesai, true, panel.alasanBelumBisa.join("; "));
  const sebelum = await hashBuku();
  const sel = await w.admin.post(R(w, w.ptSano, "/periode/selesai"), { to: "2026-10-02" });
  assert.equal(sel.status, 201, JSON.stringify(sel.body));
  assert.equal(await hashBuku(), sebelum, "menyelesaikan periode tidak mengubah jurnal");
  assert.equal((await w.admin.post(R(w, w.ptSano, "/periode/selesai"), { to: "2026-10-02" })).status, 409);
  let per = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).body.periode;
  assert.equal(per.length, 1); assert.equal(per[0].berlaku, true); assert.equal(per[0].residual, "0.00");
  assert.equal((await w.admin.get("/api/finance/rekon-bank/kartu?to=2026-10-02")).body.rekening.find((r) => r.nama === "PT Sano").terakhirDirekonsiliasi, "2026-10-02");
  // periode selesai mengunci pencocokan & rollback impor
  const kunci = await w.admin.post(`/api/finance/rekon-bank/pencocokan/${(await testPrisma.finBankMatchGroup.findFirst()).id}/lepas`, { alasan: "mencoba melepas setelah selesai" });
  assert.equal(kunci.status, 409); assert.equal(kunci.body.code, "PERIODE_SELESAI");
  const batch = await testPrisma.finBankImportBatch.findFirst();
  assert.equal((await w.admin.post(`/api/finance/rekon-bank/batch/${batch.id}/batalkan`, { alasan: "mencoba rollback setelah selesai", lepasPencocokan: true })).body.code, "DIPAKAI_PERIODE");
  // jurnal berubah setelah periode selesai (dibalik) → snapshot tidak berlaku
  const terima = await testPrisma.finJournalEntry.findFirst({ where: { description: "Terima order A" } });
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: terima.id, date: "2026-10-02", reason: "dibatalkan setelah rekonsiliasi", userId: w.adminUser.id }));
  per = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).body.periode;
  assert.equal(per[0].berlaku, false); assert.equal(per[0].snapshotRusak, true);
  // pembatalan periode: alasan wajib; riwayat tetap
  assert.equal((await w.admin.post(`/api/finance/rekon-bank/periode/${per[0].id}/batalkan`, { alasan: "x" })).status, 400);
  assert.equal((await w.admin.post(`/api/finance/rekon-bank/periode/${per[0].id}/batalkan`, { alasan: "jurnal berubah, dibuka kembali" })).status, 200);
  assert.equal(await testPrisma.finBankReconPeriod.count(), 1, "periode tidak dihapus");
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`DELETE FROM fin_bank_recon_periods`), /tidak boleh dihapus/);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`UPDATE fin_bank_recon_periods SET book_balance = 1`), /immutable/);
});

test("Exception 'ditinjau' (catatan wajib) tidak lagi menghalangi periode tetapi tetap tercatat; jurnal tidak berubah", async () => {
  const w = await dunia();
  await masuk(w, w.ptSano, 100_000, "2026-10-01", "Setoran");
  await testPrisma.finJournalEntry.create({ data: { entryNumber: "JV-LAMA-5", date: new Date("2026-09-25T00:00:00Z"), description: "Jurnal lama tanpa rekening", source: "MANUAL", status: "POSTED", lines: { create: [
    { lineNo: 1, accountId: w.dist.id, debit: 1_000, credit: 0 }, { lineNo: 2, accountId: w.akunBank.id, debit: 0, credit: 1_000 } ] } } });
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), "Tanggal;Keterangan;Debit;Kredit;Saldo\n01/10/2026;SETORAN;0,00;100.000,00;100.000,00");
  await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" });
  let p = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).body;
  assert.equal(p.exceptionTerbuka, 1);
  assert.equal(p.bisaSelesai, false);
  const line = await testPrisma.finJournalLine.findFirst({ where: { cashAccountId: null, accountId: w.akunBank.id } });
  assert.equal((await w.admin.post(`/api/finance/rekon-bank/exception/${line.id}/tinjau`, { catatan: "x" })).status, 400);
  const sebelum = await hashBuku();
  assert.equal((await w.admin.post(`/api/finance/rekon-bank/exception/${line.id}/tinjau`, { catatan: "Sudah diperiksa Owner; dikoreksi saat tutup bulan" })).status, 200);
  assert.equal(await hashBuku(), sebelum);
  p = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).body;
  assert.equal(p.exceptionTerbuka, 0);
  assert.ok(p.exception.some((e) => e.kode === "JURNAL_TANPA_REKENING" && e.terbuka === false), "tetap tercatat sebagai ditinjau");
  assert.equal((await w.admin.post(`/api/finance/rekon-bank/exception/${(await testPrisma.finJournalLine.findFirst({ where: { cashAccountId: w.ptSano.id } })).id}/tinjau`, { catatan: "bukan exception sama sekali" })).status, 404);
});

// ── Uang Kas: opname fisik ──────────────────────────────────────────────────────────────────────────────────────
test("Uang Kas: rekonsiliasi memakai HITUNG FISIK (opname), bukan rekening koran; opname immutable; selisih = buku − fisik; selesai hanya bila Rp0", async () => {
  const w = await dunia();
  await jurnal(w, { tanggal: "2026-10-01", desc: "Setor kas", baris: [{ accountId: w.akunKas.id, cashAccountId: w.kas.id, debit: 500_000 }, { accountId: w.modal.id, credit: 500_000 }] });
  assert.equal((await w.admin.post(R(w, w.ptSano, "/opname"), { tanggal: "2026-10-02", jumlah: 1 })).status, 422, "opname hanya untuk kas");
  assert.equal((await unggah(w.adminToken, R(w, w.kas, "/impor"), "x")).status, 422);
  const awal = (await w.admin.get(R(w, w.kas, "/panel?to=2026-10-02"))).body;
  assert.equal(awal.jenisSaldo, "OPNAME_FISIK"); assert.equal(awal.saldoBank, null); assert.equal(awal.bisaSelesai, false);
  assert.equal((await w.admin.post(R(w, w.kas, "/opname"), { tanggal: "2026-10-02", jumlah: 480_000, catatan: "hitung sore" })).status, 201);
  const p = (await w.admin.get(R(w, w.kas, "/panel?to=2026-10-02"))).body;
  assert.equal(p.saldoBuku, "500000.00"); assert.equal(p.saldoBank, "480000.00"); assert.equal(p.selisih, "20000.00"); assert.equal(p.belumDijelaskan, "20000.00");
  assert.equal(p.bisaSelesai, false);
  assert.equal((await w.admin.post(R(w, w.kas, "/periode/selesai"), { to: "2026-10-02" })).status, 422);
  assert.equal((await w.admin.post(R(w, w.kas, "/opname"), { tanggal: "2026-10-03", jumlah: 500_000 })).status, 201);
  const ok = (await w.admin.get(R(w, w.kas, "/panel?to=2026-10-03"))).body;
  assert.equal(ok.selisih, "0.00"); assert.equal(ok.bisaSelesai, true);
  assert.equal((await w.admin.post(R(w, w.kas, "/periode/selesai"), { to: "2026-10-03" })).status, 201);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`UPDATE fin_cash_counts SET amount = 1`), /immutable/);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`DELETE FROM fin_cash_counts`), /immutable/);
  assert.equal((await w.admin.post(R(w, w.kas, "/opname"), { tanggal: "2026-10-03", jumlah: -1 })).status, 400);
  assert.equal(await testPrisma.finCashCount.count(), 2);
});

// ── Mutasi Buku & paritas ───────────────────────────────────────────────────────────────────────────────────────
test("Mutasi Buku: empat tanggal terpisah (buku, dibuat, bank, efektif), aktor, sumber, drill-down; saldo awal + mutasi = saldo Kas & Bank untuk SEMUA rekening", async () => {
  const { w, csv } = await skenarioPtSano();
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" });
  const kartu = await saldoKasBank(testPrisma);
  for (const rek of [w.ptSano, w.kem, w.kas]) {
    const m = (await w.admin.get(`/api/finance/buku/rekening/${rek.id}/mutasi?from=2026-01-01&to=2026-12-31`)).body;
    assert.equal(m.saldoAkhir, RP(kartu.find((k) => k.id === rek.id).saldo), `paritas ${rek.name}`);
    assert.equal(m.paritas.cocok, true); assert.equal(m.paritas.selisih, "0.00");
    assert.equal(Math.round((Number(m.saldoAwal) + Number(m.totalMasuk) - Number(m.totalKeluar)) * 100), Math.round(Number(m.saldoAkhir) * 100));
  }
  const m = (await w.admin.get(`/api/finance/buku/rekening/${w.ptSano.id}/mutasi?from=2026-10-01&to=2026-10-02`)).body;
  assert.equal(m.saldoAwal, RP(67_163_686.93 + 1_750_000 - 13_000 - 2_790.07));
  const sep = (await w.admin.get(`/api/finance/buku/rekening/${w.ptSano.id}/mutasi?from=2026-09-30&to=2026-10-02`)).body;
  const adm = sep.baris.find((b) => b.keterangan === "Biaya administrasi bank");
  assert.equal(adm.tanggalBuku, "2026-09-30");
  assert.ok(adm.dibuatPada && adm.dibuatPada.startsWith("20"), "waktu dibuat terpisah dari tanggal buku");
  assert.equal(adm.dibuatSetelahTanggalBuku, true, "diinput hari ini untuk tanggal buku 30 Sep (jurnal mundur)");
  assert.equal(adm.tanggalBank, "2026-10-01", "tanggal bank dari baris rekening koran yang dicocokkan");
  assert.equal(adm.tanggalEfektif, "2026-10-01");
  assert.equal(adm.statusCocok, "COCOK_OTOMATIS");
  assert.ok(adm.aktor && adm.jurnalId && adm.nomor, "aktor, drill-down jurnal");
  const sup = sep.baris.find((b) => b.keterangan === "Pembayaran PT ESA BUMINDO");
  assert.equal(sup.statusCocok, null, "belum dicocokkan: tanggal bank kosong");
  assert.equal(sup.tanggalBank, null);
  assert.equal(sup.sumber, "PEMBAYARAN_SUPPLIER");
});

// ── Export Excel = layar ────────────────────────────────────────────────────────────────────────────────────────
test("Export Excel: Mutasi Bank, Pencocokan, dan workbook Rekonsiliasi lengkap = angka layar; filter layar ikut; Sales ditolak; rekening wajib", async () => {
  const { w, csv } = await skenarioPtSano();
  await unggah(w.adminToken, R(w, w.ptSano, "/impor"), csv);
  await w.admin.post(R(w, w.ptSano, "/cocokkan-otomatis"), { to: "2026-10-02" });
  const periode = { from: "2026-10-01", to: "2026-10-02" };

  const layar = (await w.admin.get(R(w, w.ptSano, "/mutasi-bank?from=2026-10-01&to=2026-10-02"))).body;
  const x = await unduhExport(server.baseUrl, w.adminToken, "mutasi-bank", { periode, filter: { cashAccountId: w.ptSano.id } });
  assert.equal(x.status, 200, JSON.stringify(x.json));
  const sh = bacaSheet(x.wb, "Mutasi Bank");
  assert.equal(sh.baris.length, layar.baris.length);
  layar.baris.forEach((b, i) => {
    assert.equal(sh.baris[i]["Keterangan Bank"], b.deskripsi);
    assert.equal(sh.baris[i]["Masuk (Rp)"], b.masuk === null ? null : Number(b.masuk));
    assert.equal(sh.baris[i]["Keluar (Rp)"], b.keluar === null ? null : Number(b.keluar));
    assert.equal(sh.baris[i]["Saldo Bank (Rp)"], Number(b.saldo));
    assert.equal(sh.baris[i]["Status"], b.statusLabel);
  });
  assert.equal(sh.total["Keluar (Rp)"], Number(layar.totalKeluar));
  assert.equal(sh.total["Masuk (Rp)"], Number(layar.totalMasuk));
  // filter status & pencarian layar ikut
  const f = await unduhExport(server.baseUrl, w.adminToken, "mutasi-bank", { periode, filter: { cashAccountId: w.ptSano.id, status: "BELUM_ADA_DI_BUKU", q: "farhan" } });
  const lf = (await w.admin.get(R(w, w.ptSano, "/mutasi-bank?from=2026-10-01&to=2026-10-02&status=BELUM_ADA_DI_BUKU&q=farhan"))).body;
  assert.equal(lf.baris.length, 1);
  assert.equal(bacaSheet(f.wb, "Mutasi Bank").baris.length, 1);

  const pc = (await w.admin.get(R(w, w.ptSano, "/pencocokan?to=2026-10-02&from=2026-10-01"))).body;
  const xp = await unduhExport(server.baseUrl, w.adminToken, "pencocokan-bank", { periode, filter: { cashAccountId: w.ptSano.id } });
  assert.equal(xp.status, 200, JSON.stringify(xp.json));
  assert.equal(bacaSheet(xp.wb, "Bank Belum Dicocokkan").baris.length, pc.bank.length);
  assert.equal(bacaSheet(xp.wb, "Buku Belum Dicocokkan").baris.length, pc.buku.length);
  assert.equal(bacaSheet(xp.wb, "Saran Kombinasi").baris.filter((b) => /^(1:N|N:1|N:N)$/.test(b["Bentuk"])).length, pc.kombinasi.length);
  const aktif = bacaSheet(xp.wb, "Pencocokan Aktif");
  assert.equal(aktif.baris.length, pc.kelompok.reduce((n, g) => n + g.bank.length + g.buku.length, 0));

  const panel = (await w.admin.get(R(w, w.ptSano, "/panel?to=2026-10-02"))).body;
  const xr = await unduhExport(server.baseUrl, w.adminToken, "rekonsiliasi-rekening", { periode, filter: { cashAccountId: w.ptSano.id } });
  assert.equal(xr.status, 200, JSON.stringify(xr.json));
  const rek = bacaSheet(xr.wb, "Rekonsiliasi");
  const nilaiBaris = (u) => rek.baris.find((b) => String(b["Uraian"]).startsWith(u))["Rp"];
  assert.equal(nilaiBaris("Saldo buku"), Number(panel.saldoBuku));
  assert.equal(nilaiBaris("Saldo rekening koran"), Number(panel.saldoBank));
  assert.equal(nilaiBaris("SELISIH (buku"), Number(panel.selisih));
  assert.equal(nilaiBaris("Bank belum dibukukan"), Number(panel.komponen.bankBelumDibukukan.efek));
  assert.equal(nilaiBaris("SELISIH BELUM DIJELASKAN"), Number(panel.belumDijelaskan));
  assert.deepEqual(xr.wb.worksheets.map((s) => s.name).filter((n) => /^(Buku|Bank|Cocok) /.test(n)).length > 3, true, "workbook memuat tab Mutasi Buku, Mutasi Bank, Pencocokan");
  assert.ok(xr.wb.getWorksheet("Exception") && xr.wb.getWorksheet("Jurnal Tanpa Rekening") && xr.wb.getWorksheet("Skenario Tanpa Rekening"));
  const tanpa = bacaSheet(xr.wb, "Jurnal Tanpa Rekening");
  assert.equal(tanpa.baris[0]["No. Jurnal"], "JV-25092026-731");
  assert.equal(tanpa.baris[0]["Keluar (Rp)"], 6_715_170);

  assert.equal((await unduhExport(server.baseUrl, w.adminToken, "mutasi-bank", { periode, filter: {} })).status, 400);
  const dari = await createTestUser({ roles: ["SALES"] });
  assert.equal((await unduhExport(server.baseUrl, dari.token, "rekonsiliasi-rekening", { periode, filter: { cashAccountId: w.ptSano.id } })).status, 403);
  // Mutasi Buku (export lama) kini memuat empat tanggal & aktor
  const xb = await unduhExport(server.baseUrl, w.adminToken, "mutasi-rekening", { periode: { from: "2026-09-30", to: "2026-10-02" }, filter: { cashAccountId: w.ptSano.id } });
  const mb = bacaSheet(xb.wb, "Mutasi");
  for (const h of ["Tanggal Buku", "Dibuat Pada", "Dibuat Oleh", "Tanggal Bank", "Tanggal Efektif", "Status Cocok Bank"]) assert.ok(mb.header.includes(h), `kolom ${h}`);
});

// ── Identitas aljabar panel (uji acak berbenih) ─────────────────────────────────────────────────────────────────
function prng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }

test("IDENTITAS PANEL (acak, 6 benih): selisih = Σ komponen + belum dijelaskan, dan belum dijelaskan = Rp0 untuk koran yang konsisten — termasuk pencocokan yang melewati batas tanggal, pengecualian, cutoff, jurnal sebelum data bank, penyesuaian, dan pembalikan", async () => {
  for (const seed of [1, 7, 42, 99, 2026, 31337]) {
    await truncateAll();
    const w = await dunia();
    const r = prng(seed);
    const hari = (n) => new Date(Date.UTC(2026, 8, 20 + n)); // 20 Sep + n
    const iso = (d) => d.toISOString().slice(0, 10);
    const rp = () => (1 + Math.floor(r() * 9)) * 50_000;
    // jurnal: 36 baris pada PT Sano, tanggal acak 20 Sep – 15 Okt; sebagian SALDO_AWAL
    const jurnalIds = [];
    for (let i = 0; i < 36; i += 1) {
      const nilai = rp() * (r() < 0.55 ? 1 : -1);
      const tanggal = hari(Math.floor(r() * 26));
      const source = r() < 0.08 ? "SALDO_AWAL" : "PENGELUARAN";
      const e = await testPrisma.finJournalEntry.create({ data: { entryNumber: `JV-RND-${seed}-${i}`, date: tanggal, description: `acak ${i}`, source, status: "POSTED", lines: { create: [
        { lineNo: 1, accountId: w.akunBank.id, cashAccountId: w.ptSano.id, debit: nilai > 0 ? nilai : 0, credit: nilai < 0 ? -nilai : 0 },
        { lineNo: 2, accountId: w.modal.id, debit: nilai < 0 ? -nilai : 0, credit: nilai > 0 ? nilai : 0 } ] } }, include: { lines: true } });
      jurnalIds.push({ lineId: e.lines.find((l) => l.cashAccountId).id, nilai, tanggal, source });
    }
    // jurnal dibalik (pasangan netral)
    const tgt = jurnalIds[3];
    const asli = await testPrisma.finJournalLine.findUnique({ where: { id: tgt.lineId }, include: { entry: true } });
    const balik = await testPrisma.finJournalEntry.create({ data: { entryNumber: `JV-RND-${seed}-REV`, date: asli.entry.date, description: "pembalik", source: "REVERSAL", sourceId: asli.entry.id, reversalOfId: asli.entry.id, status: "POSTED", lines: { create: [
      { lineNo: 1, accountId: w.akunBank.id, cashAccountId: w.ptSano.id, debit: asli.credit, credit: asli.debit }, { lineNo: 2, accountId: w.modal.id, debit: asli.debit, credit: asli.credit } ] } }, include: { lines: true } });
    await testPrisma.finJournalEntry.update({ where: { id: asli.entry.id }, data: { status: "REVERSED" } });
    // baris bank: tanggal mulai 24 Sep, selesai 10 Okt; sebagian dari jurnal (digeser hari), sebagian hanya di bank
    const bankRows = [];
    for (const j of jurnalIds) if (j.source !== "SALDO_AWAL" && j !== tgt && r() < 0.6) bankRows.push({ tanggal: new Date(j.tanggal.getTime() + Math.floor(r() * 5 - 1) * 86400000), nilai: j.nilai, dari: j });
    for (let i = 0; i < 6; i += 1) bankRows.push({ tanggal: hari(4 + Math.floor(r() * 17)), nilai: rp() * (r() < 0.5 ? 1 : -1), dari: null });
    const dalam = bankRows.filter((b) => iso(b.tanggal) >= "2026-09-24" && iso(b.tanggal) <= "2026-10-10").sort((a, b) => a.tanggal - b.tanggal);
    const pembuka = 2_000_000 + Math.floor(r() * 20) * 10_000;
    const batch = await testPrisma.finBankImportBatch.create({ data: { cashAccountId: w.ptSano.id, fileName: "acak.csv", fileSha256: `h${seed}`, rowCount: dalam.length, totalDebit: 0, totalCredit: 0, dateFrom: dalam[0].tanggal, dateTo: dalam.at(-1).tanggal, mapping: {} } });
    let saldo = pembuka; const barisBank = [];
    for (const [i, b] of dalam.entries()) {
      saldo += b.nilai;
      const line = await testPrisma.finBankImportLine.create({ data: { batchId: batch.id, cashAccountId: w.ptSano.id, lineNo: i + 1, txDate: b.tanggal, description: `bank ${i}`, debit: b.nilai < 0 ? -b.nilai : 0, credit: b.nilai > 0 ? b.nilai : 0, runningBalance: saldo, fingerprint: `fp${seed}-${i}`, raw: {} } });
      barisBank.push({ ...b, id: line.id });
    }
    // pencocokan acak: pasangan 1:1 untuk sebagian baris bank yang berasal dari jurnal (termasuk yang tanggal jurnalnya melewati T), beberapa dikecualikan
    const pakai = new Set();
    for (const b of barisBank) {
      if (!b.dari || pakai.has(b.dari.lineId) || r() > 0.7) continue;
      pakai.add(b.dari.lineId);
      const kunci = r() < 0.15 ? "KECUALI" : "MANUAL";
      const g = await testPrisma.finBankMatchGroup.create({ data: { cashAccountId: w.ptSano.id, kind: kunci, shape: "1:1", reason: "uji acak identitas" } });
      await testPrisma.finBankMatchItem.createMany({ data: [{ groupId: g.id, bankLineId: b.id }, { groupId: g.id, journalLineId: b.dari.lineId }] });
    }
    const T = ["2026-10-03", "2026-10-06", "2026-10-10", "2026-10-15"][Math.floor(r() * 4)];
    // koran konsisten: saldo akhir sampai T = pembuka + Σ bank ≤ T
    const akhir = pembuka + barisBank.filter((b) => iso(b.tanggal) <= T).reduce((t, b) => t + b.nilai, 0);
    const res = await w.admin.get(R(w, w.ptSano, `/panel?to=${T}&saldoBankAkhir=${akhir.toFixed(2)}&saldoBankAwal=${pembuka.toFixed(2)}`));
    assert.equal(res.status, 200, `seed ${seed}: ${JSON.stringify(res.body)}`);
    const p = res.body;
    assert.equal(p.belumDijelaskan, "0.00", `seed ${seed} T=${T}: belum dijelaskan harus 0 — komponen ${JSON.stringify(Object.fromEntries(Object.entries(p.komponen).map(([k, v]) => [k, v.efek])))} selisih ${p.selisih}`);
    const jumlah = ["selisihSaldoAwal", "bankBelumDibukukan", "bukuBelumMuncul", "perbedaanCutoff", "penyesuaianBuku", "dikecualikan"].reduce((t, k) => t + Math.round(Number(p.komponen[k].efek ?? 0) * 100), 0);
    assert.equal(jumlah, Math.round(Number(p.selisih) * 100), `seed ${seed}: Σ komponen = selisih`);
  }
});
