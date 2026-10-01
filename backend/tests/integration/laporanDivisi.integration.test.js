// LAPORAN DIVISI (Fase 2) — scope & kebocoran lintas divisi, atribusi (D&T ≠ Marketing), hitung ganda (supplier, uang muka, transfer, AdSpend), versi anggaran + audit,
// jembatan residual Rp0, dry-run legacy (deterministik/SHARED/TIDAK_TERKLASIFIKASI/konflik), dan sakelar MATI.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { postCashTransfer } from "../../src/services/finance/posting/cash.js";
import { postAdSpend } from "../../src/services/finance/posting/expense.js";
import ExcelJS from "exceljs";
import { bacaSheet } from "./setup/exportHelper.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const NOTA = "/media/finance-receipts/tes.jpg";
const P = "from=2026-09-01&to=2026-09-30";
const div = (lap, s) => lap.divisi.find((d) => d.scope === s);

async function dunia({ sakelar = true, workspace = "" } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const bank2 = await testPrisma.finCashAccount.create({ data: { name: "Mandiri", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finA = await createTestUser({ roles: ["FINANCE"] });
  const finB = await createTestUser({ roles: ["FINANCE"] });
  const leaderDel = await createTestUser({ roles: ["DISPATCHER"] });
  const anggotaDel = await createTestUser({ roles: ["DRIVER"] });
  const leaderDnt = await createTestUser({ roles: ["SALES"] });
  const tanpa = await createTestUser({ roles: ["SALES"] });
  await testPrisma.userDivision.createMany({ data: [
    { userId: leaderDel.user.id, division: "DELIVERY", isLeader: true },
    { userId: anggotaDel.user.id, division: "DELIVERY", isLeader: false },
    { userId: leaderDnt.user.id, division: "DIGITAL_TECHNOLOGY", isLeader: true },
  ] });
  if (sakelar) await setSetting(testPrisma, SETTING_KEYS.LAPORAN_DIVISI_AKTIF, "true");
  if (workspace) await setSetting(testPrisma, SETTING_KEYS.LAPORAN_DIVISI_WORKSPACE, workspace);
  const k = (u) => makeClient(server.baseUrl, u.token);
  const kat = async (code) => testPrisma.finExpenseCategory.findUnique({ where: { code } });
  return { bank, bank2, admin, finA, finB, leaderDel, anggotaDel, leaderDnt, tanpa, a: k(admin), fa: k(finA), fb: k(finB), ld: k(leaderDel), ad: k(anggotaDel), lt: k(leaderDnt), tn: k(tanpa), kat };
}

async function biaya(w, { kode, division, amount, mode = "LANGSUNG", tgl = "2026-09-10" }) {
  const k = await w.kat(kode);
  const r = await w.a.post("/api/finance/expenses", { date: tgl, amount, description: `uji ${kode}`, categoryId: k.id, division, mode, cashAccountId: w.bank.id, receiptUrl: NOTA });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await w.a.post(`/api/finance/expenses/${r.body.id}/approve`, {})).status, 200);
  return r.body;
}

async function skenario(w) {
  await biaya(w, { kode: "BBM", division: "DELIVERY", amount: 100_000 });
  await biaya(w, { kode: "LANGGANAN_APLIKASI", division: "DIGITAL_TECHNOLOGY", amount: 50_000 });
  await biaya(w, { kode: "PERLENGKAPAN", division: "UMUM", amount: 30_000 });
  await biaya(w, { kode: "GAJI_KARYAWAN", division: "DELIVERY", amount: 400_000 }); // sensitif, eksplisit Delivery
  await biaya(w, { kode: "BBM", division: "PRODUKSI", amount: 70_000 });             // KONFLIK: dokumen Produksi vs kategori BBM → Delivery
  // jurnal manual tanpa dokumen → TIDAK_TERKLASIFIKASI
  const beban = await testPrisma.finAccount.findUnique({ where: { code: "6-1900" } });
  await testPrisma.$transaction((tx) => postJournal(tx, { date: new Date("2026-09-12T00:00:00Z"), description: "Jurnal manual uji", source: "MANUAL", userId: w.admin.user.id, lines: [{ accountId: beban.id, debit: 20_000 }, { accountId: w.bank.accountId, credit: 20_000 }] }));
  // supplier: tagihan BBM (Delivery) 600.000 disetujui lalu dibayar 600.000 → aktual SEKALI, kas SEKALI
  const sup = await testPrisma.finSupplier.create({ data: { code: "SUP-D", name: "SPBU Mitra" } });
  const katBbm = await w.kat("BBM");
  const bill = (await w.a.post("/api/finance/bills", { supplierId: sup.id, billDate: "2026-09-15", amount: 600_000, description: "BBM kredit", billType: "JASA_OPERASIONAL", expenseCategoryId: katBbm.id })).body;
  await w.a.post(`/api/finance/bills/${bill.id}/approve`, {});
  assert.equal((await w.a.post("/api/finance/supplier-payments", { supplierId: sup.id, date: "2026-09-16", cashAccountId: w.bank.id, allocations: [{ billId: bill.id, amount: 600_000 }] })).status, 201);
  // uang muka Delivery 300.000 (kas keluar) + pertanggungjawaban BBM 250.000 (aktual, TANPA kas lagi)
  const um = (await w.a.post("/api/finance/uang-muka", { holderId: w.anggotaDel.user.id, division: "DELIVERY", purpose: "Uang jalan", date: "2026-09-18", dueDate: "2026-09-30", amount: 300_000, cashAccountId: w.bank.id })).body;
  const pj = (await w.a.post(`/api/finance/uang-muka/${um.id}/pertanggungjawaban`, { date: "2026-09-19", amount: 250_000, description: "BBM trip", categoryId: katBbm.id, payeeName: "SPBU", receiptUrl: NOTA })).body;
  await w.a.post(`/api/finance/expenses/${pj.id}/approve`, {});
  // transfer antarbank berbiaya 6.500 → SHARED (biaya bank), tidak menambah kas gross
  const tf = await testPrisma.finCashTransfer.create({ data: { transferNumber: "TRF-UJI-1", date: new Date("2026-09-20T00:00:00Z"), amount: 1_000_000, fromAccountId: w.bank.id, toAccountId: w.bank2.id, feeAmount: 6_500, createdById: w.finA.user.id } });
  await testPrisma.$transaction((tx) => postCashTransfer(tx, { transferId: tf.id, userId: w.finA.user.id }));
  // AdSpend Meta 1.000.000: satu jurnal (beban + bank) → D&T SEKALI
  const ad = await testPrisma.adSpend.create({ data: { source: "META_ADS", year: 2026, month: 9, amount: 1_000_000 } });
  await testPrisma.$transaction((tx) => postAdSpend(tx, { adSpendId: ad.id, userId: w.admin.user.id }));
  // pengeluaran MENUNGGU persetujuan Marketing → komitmen belum dibukukan (bukan aktual, bukan kas)
  const katMkt = await w.kat("MKT_KONTEN");
  await w.a.post("/api/finance/expenses", { date: "2026-09-22", amount: 90_000, description: "konten", categoryId: katMkt.id, division: "MARKETING", mode: "REIMBURSEMENT", receiptUrl: NOTA });
}

test("SAKELAR MATI: laporan & anggaran menolak 403 LAPORAN_DIVISI_MATI untuk SEMUA (termasuk Admin); dry-run Admin Finance tetap jalan; Finance non-admin tidak boleh dry-run", async () => {
  const w = await dunia({ sakelar: false });
  for (const c of [w.a, w.fa, w.ld]) {
    const r = await c.get(`/api/laporan-divisi/laporan?${P}`);
    assert.equal(r.status, 403, JSON.stringify(r.body)); assert.equal(r.body.code, "LAPORAN_DIVISI_MATI");
  }
  assert.equal((await w.a.post("/api/laporan-divisi/anggaran", { division: "DELIVERY", period: "2026-09", amount: 1 })).status, 403);
  assert.equal((await w.a.get(`/api/laporan-divisi/dry-run?${P}`)).status, 200);
  assert.equal((await w.fa.get(`/api/laporan-divisi/dry-run?${P}`)).status, 403);
  const akses = (await w.a.get("/api/laporan-divisi/akses")).body;
  assert.equal(akses.sakelar.aktif, false); assert.deepEqual(akses.divisi, []);
  assert.equal((await makeClient(server.baseUrl, null).get("/api/laporan-divisi/akses")).status, 401);
});

test("ATRIBUSI + ANGKA (Finance): D&T terpisah dari Marketing; UMUM→SHARED; manual→TIDAK_TERKLASIFIKASI; supplier/uang muka/transfer/AdSpend sekali; jembatan residual Rp0; komitmen terpisah", async () => {
  const w = await dunia();
  await skenario(w);
  const lap = (await w.fa.get(`/api/laporan-divisi/laporan?${P}`)).body;
  assert.equal(lap.akses.level, "SEMUA");
  const del = div(lap, "DELIVERY"); const dnt = div(lap, "DIGITAL_TECHNOLOGY"); const prod = div(lap, "PRODUCTION");
  // Delivery aktual: BBM 100.000 + gaji 400.000 + tagihan BBM 600.000 + pertanggungjawaban 250.000 = 1.350.000 (supplier & uang muka TIDAK dobel)
  assert.equal(del.aktual, 100_000 + 400_000 + 600_000 + 250_000, "tagihan 600.000 dihitung SEKALI; pembayarannya bukan beban; pertanggungjawaban 250.000 sekali");
  // Delivery kas keluar: BBM 100.000 + gaji 400.000 + bayar supplier 600.000 + uang muka 300.000 (pertanggungjawaban tanpa kas)
  assert.equal(del.kasKeluar, 100_000 + 400_000 + 600_000 + 300_000, "uang muka kas keluar sekali (saat diberikan), pertanggungjawaban tanpa kas");
  assert.equal(dnt.aktual, 50_000 + 1_000_000, "langganan + AdSpend sekali"); assert.equal(dnt.kasKeluar, 1_050_000);
  assert.ok(!lap.divisi.some((d) => d.scope === "MARKETING" && d.aktual !== 0), "D&T TIDAK dipetakan diam-diam ke Marketing");
  assert.equal(prod.aktual, 70_000, "dokumen berdivisi Produksi mengikuti divisi eksplisit (kategori BBM = Delivery hanya petunjuk konflik)");
  assert.ok(prod.konflik >= 1, "konflik dicatat untuk Finance");
  const shared = div(lap, "SHARED");
  assert.equal(shared.aktual, 30_000 + 6_500, "UMUM + biaya admin transfer");
  assert.equal(shared.kasKeluar, 30_000 + 6_500, "transfer antarbank: hanya biaya admin yang keluar");
  const tt = div(lap, "TIDAK_TERKLASIFIKASI");
  assert.equal(tt.aktual, 20_000); assert.equal(tt.kasKeluar, 20_000);
  assert.equal(lap.jembatan.aktual.residual, 0); assert.equal(lap.jembatan.kasKeluar.residual, 0); assert.equal(lap.jembatan.status.perhitungan, "COCOK");
  // komitmen terpisah: 90.000 menunggu persetujuan Marketing → BELUM beban & BELUM kas
  const mkt = div(lap, "MARKETING");
  assert.equal(mkt.komitmen.belumDibukukan, 90_000); assert.equal(mkt.aktual, 0); assert.equal(mkt.kasKeluar, 0);
  assert.equal(del.komitmen.dibukukanBelumDibayar, 0, "tagihan sudah lunas dibayar → bukan komitmen");
  // tanpa anggaran → null (bukan 0)
  assert.equal(del.anggaran, null); assert.equal(del.sisaAnggaran, null); assert.equal(del.alert, null);
  // filter kategori memakai mesin yang sama
  const bbm = (await w.fa.get(`/api/laporan-divisi/laporan?${P}&divisi=DELIVERY&kategori=BBM`)).body;
  assert.equal(div(bbm, "DELIVERY").aktual, 100_000 + 600_000 + 250_000);
  assert.equal(bbm.jembatan, null, "jembatan hanya tanpa filter");
  // baris nol → Komponen lain (kelompok Delivery tanpa transaksi tidak ditampilkan satu per satu)
  assert.ok(del.kelompok.every((g) => Math.abs(g.aktual) >= 0.005 || Math.abs(g.kasKeluar) >= 0.005));
  assert.ok(del.komponenLain.daftar.includes("Tol"), "Tol bernilai nol → Komponen lain");
});

test("SCOPE: leader hanya divisinya (tanpa data sensitif); anggota biasa hanya ringkasan; tanpa keanggotaan 403; scope lain 403; workspace belum dibuka → tidak ada akses", async () => {
  const w = await dunia({ workspace: "DELIVERY" });
  await skenario(w);
  // leader Delivery
  const lap = (await w.ld.get(`/api/laporan-divisi/laporan?${P}`)).body;
  assert.deepEqual(lap.divisi.map((d) => d.scope), ["DELIVERY"]);
  assert.equal(lap.akses.level, "LEADER"); assert.equal(lap.jembatan, null, "jembatan hanya Finance");
  assert.equal(lap.sensitifDisaring, true);
  assert.equal(lap.divisi[0].aktual, 100_000 + 600_000 + 250_000, "gaji (sensitif) 400.000 DISARING dari leader");
  assert.equal(lap.divisi[0].tahap, undefined); assert.equal(lap.divisi[0].konflik, undefined);
  for (const s of ["MARKETING", "DIGITAL_TECHNOLOGY", "SHARED", "TIDAK_TERKLASIFIKASI", "PRODUCTION"]) {
    const r = await w.ld.get(`/api/laporan-divisi/laporan?${P}&divisi=${s}`);
    assert.equal(r.status, 403, `${s}: ${JSON.stringify(r.body)}`);
    assert.equal((await w.ld.get(`/api/laporan-divisi/dokumen?${P}&divisi=${s}`)).status, 403);
  }
  assert.equal((await w.ld.get(`/api/laporan-divisi/laporan?${P}&divisi=NGAWUR`)).status, 400);
  // drill-down leader: dokumen Delivery tanpa baris sensitif
  const dok = (await w.ld.get(`/api/laporan-divisi/dokumen?${P}&divisi=DELIVERY`)).body;
  assert.ok(dok.baris.length > 0 && dok.baris.every((b) => b.scope === "DELIVERY" && !b.sensitif));
  assert.ok(!dok.baris.some((b) => /GAJI/.test(b.kategori?.kode ?? "")));
  // anggota biasa Delivery: ringkasan saja
  const agt = (await w.ad.get(`/api/laporan-divisi/laporan?${P}`)).body;
  assert.equal(agt.akses.level, "ANGGOTA"); assert.deepEqual(agt.divisi[0].perKategori, []); assert.ok(agt.divisi[0].kelompok.length > 0);
  const dokAgt = await w.ad.get(`/api/laporan-divisi/dokumen?${P}&divisi=DELIVERY`);
  assert.equal(dokAgt.status, 403); assert.equal(dokAgt.body.code, "RINCIAN_DILARANG");
  assert.equal((await w.ad.post("/api/laporan-divisi/anggaran", { division: "DELIVERY", period: "2026-09", amount: 1 })).status, 403, "anggota biasa tidak boleh mengatur anggaran");
  // leader D&T: workspace D&T BELUM dibuka (hanya DELIVERY) → tidak ada akses sama sekali
  const dnt = await w.lt.get(`/api/laporan-divisi/laporan?${P}`);
  assert.equal(dnt.status, 403); assert.equal(dnt.body.code, "TANPA_AKSES");
  assert.equal((await w.tn.get(`/api/laporan-divisi/laporan?${P}`)).status, 403, "tanpa keanggotaan");
  // buka D&T bertahap lewat sakelar (validasi nilai)
  assert.equal((await w.a.patch("/api/finance/settings", { settings: { laporan_divisi_workspace: "DELIVERY,NGAWUR" } })).status, 400);
  assert.equal((await w.a.patch("/api/finance/settings", { settings: { laporan_divisi_workspace: "DELIVERY,DIGITAL_TECHNOLOGY" } })).status, 200);
  const lap2 = (await w.lt.get(`/api/laporan-divisi/laporan?${P}`)).body;
  assert.deepEqual(lap2.divisi.map((d) => d.scope), ["DIGITAL_TECHNOLOGY"]);
  assert.equal(lap2.divisi[0].aktual, 1_050_000);
  // Finance melihat semuanya (termasuk sensitif)
  const fin = (await w.fa.get(`/api/laporan-divisi/laporan?${P}&divisi=DELIVERY`)).body;
  assert.equal(fin.divisi[0].aktual, 1_350_000); assert.equal(fin.sensitifDisaring, false);
});

test("ANGGARAN: belum diset = null ('Belum ada anggaran'); draf tidak berlaku; pembuat tak boleh menyetujui sendiri; versi baru wajib alasan & menggantikan; sisa/alert over-budget; audit lengkap", async () => {
  const w = await dunia({ workspace: "DELIVERY" });
  await skenario(w);
  const sebelum = div((await w.fa.get(`/api/laporan-divisi/laporan?${P}&divisi=DELIVERY`)).body, "DELIVERY");
  assert.equal(sebelum.anggaran, null);
  // leader membuat DRAF untuk divisinya; divisi lain ditolak
  assert.equal((await w.ld.post("/api/laporan-divisi/anggaran", { division: "PRODUCTION", period: "2026-09", amount: 1 })).status, 403);
  const d1 = await w.ld.post("/api/laporan-divisi/anggaran", { division: "DELIVERY", period: "2026-09", amount: 1_000_000 });
  assert.equal(d1.status, 201, JSON.stringify(d1.body));
  assert.equal(d1.body.anggaran.status, "DRAF"); assert.equal(d1.body.anggaran.version, 1);
  assert.equal(div((await w.fa.get(`/api/laporan-divisi/laporan?${P}&divisi=DELIVERY`)).body, "DELIVERY").anggaran, null, "DRAF belum berlaku");
  // leader tidak punya izin menyetujui
  assert.equal((await w.ld.post(`/api/laporan-divisi/anggaran/${d1.body.anggaran.id}/setujui`, {})).status, 403);
  // Finance A membuat draf sendiri → tidak boleh menyetujui sendiri; Finance B boleh
  const d2 = await w.fa.post("/api/laporan-divisi/anggaran", { division: "WAREHOUSE", period: "2026-09", amount: 500_000 });
  assert.equal(d2.status, 201);
  const sendiri = await w.fa.post(`/api/laporan-divisi/anggaran/${d2.body.anggaran.id}/setujui`, {});
  assert.equal(sendiri.status, 403); assert.equal(sendiri.body.code, "PEMISAHAN_TUGAS");
  assert.equal((await w.fb.post(`/api/laporan-divisi/anggaran/${d1.body.anggaran.id}/setujui`, {})).status, 200);
  let del = div((await w.fa.get(`/api/laporan-divisi/laporan?${P}&divisi=DELIVERY`)).body, "DELIVERY");
  assert.equal(del.anggaran, 1_000_000); assert.equal(del.aktual, 1_350_000);
  assert.equal(del.sisaAnggaran, -350_000); assert.equal(del.alert.jenis, "OVER_BUDGET");
  assert.equal(del.persenTerpakai, 135);
  // versi 2 wajib alasan
  const tanpaAlasan = await w.fa.post("/api/laporan-divisi/anggaran", { division: "DELIVERY", period: "2026-09", amount: 2_000_000 });
  assert.equal(tanpaAlasan.status, 422); assert.equal(tanpaAlasan.body.code, "ALASAN_WAJIB");
  const v2 = await w.fa.post("/api/laporan-divisi/anggaran", { division: "DELIVERY", period: "2026-09", amount: 2_000_000, reason: "Tambahan trip Lebaran" });
  assert.equal(v2.status, 201); assert.equal(v2.body.anggaran.version, 2);
  assert.equal((await w.fb.post(`/api/laporan-divisi/anggaran/${v2.body.anggaran.id}/setujui`, {})).status, 200);
  del = div((await w.fa.get(`/api/laporan-divisi/laporan?${P}&divisi=DELIVERY`)).body, "DELIVERY");
  assert.equal(del.anggaran, 2_000_000); assert.equal(del.sisaAnggaran, 650_000); assert.equal(del.alert, null);
  const semuaVersi = (await w.fa.get("/api/laporan-divisi/anggaran?divisi=DELIVERY")).body.anggaran;
  assert.deepEqual(semuaVersi.map((v) => `${v.version}:${v.status}`).sort(), ["1:DIGANTIKAN", "2:DISETUJUI"], "versi lama tidak dihapus, hanya digantikan");
  // audit: pembuatan, persetujuan, penggantian — dengan aktor & alasan
  const audit = await testPrisma.activityEvent.findMany({ where: { entityType: "fin_division_budget" }, orderBy: { createdAt: "asc" } });
  assert.ok(audit.length >= 5);
  const setuju2 = audit.find((e) => e.metadata.aksi === "disetujui" && e.metadata.version === 2);
  assert.equal(setuju2.actorId, w.finB.user.id); assert.equal(setuju2.metadata.menggantikan[0].version, 1); assert.equal(setuju2.metadata.alasan, "Tambahan trip Lebaran");
  // anggaran tidak mengubah ledger
  const agg = await testPrisma.finJournalLine.aggregate({ _sum: { debit: true, credit: true } });
  assert.equal(Number(agg._sum.debit), Number(agg._sum.credit));
  // divisi lain tetap "Belum ada anggaran" (null), bukan 0
  assert.equal((await w.fa.get(`/api/laporan-divisi/laporan?${P}&divisi=MARKETING`)).body.divisi[0].anggaran, null);
  // SHARED tidak dianggarkan; negatif ditolak; hapus draf
  assert.equal((await w.fa.post("/api/laporan-divisi/anggaran", { division: "SHARED", period: "2026-09", amount: 1 })).status, 400);
  assert.equal((await w.fa.post("/api/laporan-divisi/anggaran", { division: "SALES", period: "2026-09", amount: -5 })).status, 400);
  assert.equal((await w.fa.delete(`/api/laporan-divisi/anggaran/${d2.body.anggaran.id}`)).status, 200);
});

test("DRY-RUN legacy: empat kelompok (deterministik / SHARED / TIDAK_TERKLASIFIKASI / konflik) + di luar divisi; nilai & jumlah transaksi; TIDAK menulis apa pun", async () => {
  const w = await dunia({ sakelar: false });
  await skenario(w);
  const sebelum = { je: await testPrisma.finJournalEntry.count(), jl: await testPrisma.finJournalLine.count(), ex: await testPrisma.finExpense.count(), bud: await testPrisma.finDivisionBudget.count(), act: await testPrisma.activityEvent.count() };
  const r = (await w.a.get(`/api/laporan-divisi/dry-run?${P}`)).body;
  assert.equal(r.bacaSaja, true);
  const k = r.kelompok;
  assert.ok(k.DETERMINISTIK.jumlahTransaksi > 0 && k.SHARED.jumlahTransaksi > 0 && k.TIDAK_TERKLASIFIKASI.jumlahTransaksi > 0 && k.KONFLIK.jumlahTransaksi > 0);
  assert.equal(k.TIDAK_TERKLASIFIKASI.aktual, 20_000); assert.equal(k.TIDAK_TERKLASIFIKASI.perSumber[0].sumber, "MANUAL");
  assert.equal(k.SHARED.aktual, 36_500);
  assert.equal(k.KONFLIK.aktual, 70_000); assert.deepEqual(k.KONFLIK.contoh[0].konflik.sort(), ["DELIVERY", "PRODUCTION"]);
  const totalAktual = Object.values(k).reduce((s, g) => s + g.aktual, 0);
  const beban = await testPrisma.finJournalLine.aggregate({ where: { account: { type: { in: ["BEBAN", "BEBAN_POKOK"] } } }, _sum: { debit: true, credit: true } });
  assert.equal(Math.round(totalAktual), Math.round(Number(beban._sum.debit) - Number(beban._sum.credit)), "empat kelompok + di luar divisi = seluruh beban ledger (tidak ada yang hilang/dobel)");
  assert.deepEqual({ je: await testPrisma.finJournalEntry.count(), jl: await testPrisma.finJournalLine.count(), ex: await testPrisma.finExpense.count(), bud: await testPrisma.finDivisionBudget.count(), act: await testPrisma.activityEvent.count() }, sebelum, "dry-run tidak menulis apa pun");
});

// ═══ PARITAS LAYAR ↔ EXCEL: berkas dibangun dari payload yang SAMA; sheet Ringkasan/Kelompok/Kategori/Tren/Transaksi/Komitmen/Anggaran cocok angka per angka ═══
async function unduh(token, body) {
  const res = await fetch(`${server.baseUrl}/api/laporan-divisi/export`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const tipe = res.headers.get("content-type") || "";
  if (!tipe.includes("spreadsheetml")) return { status: res.status, wb: null, json: await res.json().catch(() => null), headers: res.headers };
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  return { status: res.status, wb, json: null, headers: res.headers };
}
const sama = (a, b, ket) => assert.ok(Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.005, `${ket}: ${a} ≠ ${b}`);

test("PARITAS: export semua tab (Finance) = payload layar — angka tiap divisi, kelompok, kategori, tren, transaksi, komitmen, anggaran; baris TOTAL; sheet Definisi Angka", async () => {
  const w = await dunia();
  await skenario(w);
  // satu anggaran disetujui untuk Delivery supaya kolom anggaran/sisa/peringatan terisi
  const draf = await w.a.post("/api/laporan-divisi/anggaran", { division: "DELIVERY", period: "2026-09", amount: 500_000, reason: "uji" });
  assert.equal(draf.status, 201, JSON.stringify(draf.body));
  assert.equal((await w.fa.post(`/api/laporan-divisi/anggaran/${draf.body.anggaran.id}/setujui`, {})).status, 200);
  const layar = (await w.fa.get(`/api/laporan-divisi/laporan?${P}`)).body;
  const dokLayar = (await w.fa.get(`/api/laporan-divisi/dokumen?${P}&divisi=DELIVERY`)).body;
  const u = await unduh(w.finA.token, { from: "2026-09-01", to: "2026-09-30", divisi: layar.scopeTampil, tab: "semua" });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  const nama = u.wb.worksheets.map((s) => s.name);
  for (const s of ["Ringkasan", "Kelompok", "Kategori", "Tren Bulanan", "Rincian Transaksi", "Komitmen", "Anggaran vs Aktual", "Definisi Angka"]) assert.ok(nama.includes(s), `sheet ${s} tidak ada: ${nama.join(",")}`);

  const rg = bacaSheet(u.wb, "Ringkasan");
  for (const d of layar.divisi) {
    const b = rg.baris.find((x) => x["Divisi"] === d.label);
    assert.ok(b, `divisi ${d.label} tidak ada di sheet Ringkasan`);
    sama(b["Aktual / Beban Diakui (Rp)"], d.aktual, `aktual ${d.scope}`);
    sama(b["Kas Keluar (Rp)"], d.kasKeluar, `kas ${d.scope}`);
    sama(b["Komitmen Menunggu Persetujuan (Rp)"], d.komitmen.belumDibukukan, `komitmen belum ${d.scope}`);
    sama(b["Komitmen Dibukukan Belum Dibayar (Rp)"], d.komitmen.dibukukanBelumDibayar, `komitmen bayar ${d.scope}`);
    assert.equal(b["Status Anggaran"], d.anggaran == null ? "Belum ada anggaran" : "Ada anggaran");
    if (d.anggaran == null) assert.equal(b["Anggaran (Rp)"], null, "Belum ada anggaran harus kosong, BUKAN 0");
  }
  sama(rg.total["Aktual / Beban Diakui (Rp)"], layar.ringkasan.aktual, "TOTAL aktual = ringkasan layar");
  sama(rg.total["Kas Keluar (Rp)"], layar.ringkasan.kasKeluar, "TOTAL kas = ringkasan layar");

  const kl = bacaSheet(u.wb, "Kelompok");
  for (const d of layar.divisi) for (const g of d.kelompok) {
    const b = kl.baris.find((x) => x["Divisi"] === d.label && x["Kelompok"] === g.label);
    assert.ok(b, `kelompok ${d.label}/${g.label} tidak ada di Excel`); sama(b["Aktual (Rp)"], g.aktual, `kelompok ${g.label}`); sama(b["Kas Keluar (Rp)"], g.kasKeluar, `kelompok kas ${g.label}`);
  }
  const kt = bacaSheet(u.wb, "Kategori");
  for (const d of layar.divisi) for (const k of d.perKategori) {
    const b = kt.baris.find((x) => x["Divisi"] === d.label && x["Kode"] === k.kode);
    assert.ok(b, `kategori ${k.kode} tidak ada`); sama(b["Aktual (Rp)"], k.aktual, `kategori ${k.kode}`);
  }
  const tr = bacaSheet(u.wb, "Tren Bulanan");
  for (const d of layar.divisi) for (const t of d.tren) { const b = tr.baris.find((x) => x["Divisi"] === d.label && x["Bulan (WIB)"] === t.bulan); assert.ok(b, `tren ${d.label} ${t.bulan}`); sama(b["Aktual (Rp)"], t.aktual, `tren ${d.scope} ${t.bulan}`); }
  // Transaksi: Σ aktual semua baris = Σ aktual ringkasan (tiap baris dokumen sekali, tanpa hitung ganda)
  const tx = bacaSheet(u.wb, "Rincian Transaksi");
  sama(tx.total["Aktual (Rp)"], layar.ringkasan.aktual, "Σ transaksi = Σ ringkasan");
  sama(tx.total["Kas Keluar (Rp)"], layar.ringkasan.kasKeluar, "Σ kas transaksi = ringkasan");
  assert.equal(tx.baris.filter((x) => x["Divisi"] === "Delivery").length, dokLayar.baris.length, "jumlah baris Delivery = drill-down layar");
  const km = bacaSheet(u.wb, "Komitmen");
  sama(km.total["Jumlah (Rp)"], layar.ringkasan.komitmenBelumDibukukan + layar.ringkasan.komitmenDibukukanBelumDibayar, "Σ komitmen = ringkasan");
  const ag = bacaSheet(u.wb, "Anggaran vs Aktual");
  const del = ag.baris.find((x) => x["Divisi"] === "Delivery"); sama(del["Anggaran (Rp)"], 500_000, "anggaran Delivery"); sama(del["Sisa Anggaran (Rp)"], div(layar, "DELIVERY").sisaAnggaran, "sisa Delivery");
  assert.ok(bacaSheet(u.wb, "Definisi Angka").baris.length >= 6);
  assert.match(u.headers.get("content-disposition"), /\.xlsx/);
});

test("PARITAS tab & scope: leader hanya divisinya; filter kategori ikut; kosong → pesan resmi; anggota tanpa rincian; tanpa izin 403; sakelar MATI 403", async () => {
  const w = await dunia({ workspace: "DELIVERY,DIGITAL_TECHNOLOGY" });
  await skenario(w);
  // leader Delivery minta divisi lain → ditolak (isolasi), bukan dibocorkan
  const lain = await unduh(w.leaderDel.token, { from: "2026-09-01", to: "2026-09-30", divisi: ["DELIVERY", "DIGITAL_TECHNOLOGY", "SHARED"], tab: "dokumen" });
  assert.equal(lain.status, 403, "leader tidak boleh meminta divisi lain");
  const layar = (await w.ld.get(`/api/laporan-divisi/laporan?${P}&divisi=DELIVERY`)).body;
  const u2 = await unduh(w.leaderDel.token, { from: "2026-09-01", to: "2026-09-30", divisi: ["DELIVERY"], tab: "ringkasan" });
  assert.equal(u2.status, 200, JSON.stringify(u2.json));
  const rg = bacaSheet(u2.wb, "Ringkasan");
  assert.deepEqual(rg.baris.map((x) => x["Divisi"]), ["Delivery"]);
  sama(rg.baris[0]["Aktual / Beban Diakui (Rp)"], div(layar, "DELIVERY").aktual, "aktual leader = layar leader");
  // transaksi leader: tanpa baris sensitif (gaji)
  const ut = await unduh(w.leaderDel.token, { from: "2026-09-01", to: "2026-09-30", divisi: ["DELIVERY"], tab: "dokumen" });
  const tx = bacaSheet(ut.wb, "Rincian Transaksi");
  assert.ok(tx.baris.length > 0 && tx.baris.every((x) => x["Divisi"] === "Delivery"));
  assert.ok(!tx.baris.some((x) => /gaji/i.test(`${x["Kategori"]} ${x["Deskripsi"]}`)), "baris sensitif (gaji) tidak boleh ikut untuk non-Finance");
  // filter kategori ikut ke Excel
  const f = await unduh(w.finA.token, { from: "2026-09-01", to: "2026-09-30", divisi: ["DELIVERY"], tab: "dokumen", filter: { kategori: "BBM" } });
  const fl = (await w.fa.get(`/api/laporan-divisi/dokumen?${P}&divisi=DELIVERY&kategori=BBM`)).body;
  const fx = bacaSheet(f.wb, "Rincian Transaksi");
  assert.equal(fx.baris.length, fl.baris.length);
  assert.ok(fx.baris.length > 0 && fx.baris.every((x) => /bbm/i.test(x["Kategori"])), "filter kategori harus ikut");
  // kosong: bulan tanpa data → pesan resmi di sheet
  const kosong = await unduh(w.finA.token, { from: "2026-01-01", to: "2026-01-31", divisi: ["DELIVERY"], tab: "dokumen" });
  assert.equal(kosong.status, 200);
  assert.equal(kosong.wb.getWorksheet("Rincian Transaksi").getCell("A7").value, "Tidak ada data sesuai periode dan filter");
  // anggota biasa: tanpa rincian dokumen; pengguna tanpa keanggotaan 403
  const a = await unduh(w.anggotaDel.token, { from: "2026-09-01", to: "2026-09-30", divisi: ["DELIVERY"], tab: "dokumen" });
  if (a.status === 200) assert.equal(bacaSheet(a.wb, "Rincian Transaksi").baris.length, 0, "anggota biasa tidak boleh melihat rincian dokumen");
  assert.equal((await unduh(w.tanpa.token, { from: "2026-09-01", to: "2026-09-30", divisi: ["DELIVERY"], tab: "ringkasan" })).status, 403);
  // sakelar MATI → export juga ditolak
  await setSetting(testPrisma, SETTING_KEYS.LAPORAN_DIVISI_AKTIF, "false");
  assert.equal((await unduh(w.finA.token, { from: "2026-09-01", to: "2026-09-30", divisi: ["DELIVERY"], tab: "ringkasan" })).status, 403);
});
