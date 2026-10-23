// TANDA & PENYAJIAN LAPORAN FINANCE (audit 23 Okt 2026): akun biaya bersaldo kredit bersih = "pembalik beban bersih" (nominal ledger & rumus laba TIDAK berubah), kartu = Σ akun = Σ jurnal = Excel sampai sen,
// Neraca Saldo menaruh saldo terbalik di sisi yang benar, Neraca & Arus Kas tetap konsisten, drilldown menghitung SELURUH baris yang tersaring, dan pembacaan laporan terinci READ ONLY di database.
// Angka dihitung tangan di komentar (skenario meniru audit: beban debit Rp2.600.000 + Rp12.563.000, pembalik overhead Rp11.372.248 → HPP neto Rp3.790.752).
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
import { labaRugi, neracaSaldo, neraca, arusKas } from "../../src/services/finance/reports.js";
import { bacaLaporanTerinci, drilldownMetrik, jalankanBacaSaja } from "../../src/services/finance/laporanTerinci/index.js";
import { sumMoney, moneyToNumber } from "../../src/services/finance/money.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const D = (s) => new Date(`${s}T00:00:00.000Z`);
const OKT = { fromStr: "2026-10-01", toStr: "2026-10-31" }; const SEPOKT = { fromStr: "2026-09-01", toStr: "2026-10-31" }; const KOSONG = { fromStr: "2026-01-01", toStr: "2026-01-31" };

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akun = Object.fromEntries((await testPrisma.finAccount.findMany()).map((a) => [a.code, a]));
  const bankCoa = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const kasCoa = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: bankCoa.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Uji", kind: "KAS", accountId: kasCoa.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] }); const fin = await createTestUser({ roles: ["FINANCE"] });
  return { akun, bank, kas, admin, fin, a: makeClient(server.baseUrl, admin.token), f: makeClient(server.baseUrl, fin.token) };
}
async function jurnal(w, tgl, baris, opsi = {}) {
  const lines = baris.map(([kode, d = 0, k = 0]) => (kode === "BANK" ? { accountId: w.bank.accountId, cashAccountId: w.bank.id, debit: d, credit: k } : kode === "KAS" ? { accountId: w.kas.accountId, cashAccountId: w.kas.id, debit: d, credit: k } : { accountId: w.akun[kode].id, debit: d, credit: k }));
  return testPrisma.$transaction((tx) => postJournal(tx, { date: D(tgl), description: opsi.desk ?? `uji ${tgl}`, source: "MANUAL", userId: w.admin.user.id, lines }));
}
/**
 * Skenario audit (semua MANUAL, Rp):
 *   5 Sep  pendapatan 20.000.000 (Dr Bank / Cr 4-1100)
 *  15 Sep  overhead produksi 12.563.000 (Dr 5-1300)            ← e1
 *  20 Sep  upah produksi 2.600.000 (Dr 5-1200)
 *  25 Sep  beban lain 500.000 (Dr 6-1900)
 *  28 Sep  retur 100.000 (Dr 4-2100)
 *   5 Okt  PEMBALIK e1 (Cr 5-1300 12.563.000)                  ← lintas bulan
 *   6 Okt  overhead koreksi 1.190.752 (Dr 5-1300)              → Okt: 5-1300 = −12.563.000 + 1.190.752 = −11.372.248 (PEMBALIK BEBAN BERSIH)
 *  10 Okt  pengembalian biaya lain 700.000 (Cr 6-1900)          → Okt: 6-1900 = −700.000 (pembalik beban operasional bersih)
 *  12 Okt  retur dibalik 30.000 (Cr 4-2100)                     → Okt: retur = −30.000 (pembalik retur bersih)
 */
async function skenario(w) {
  await jurnal(w, "2026-09-05", [["BANK", 20_000_000, 0], ["4-1100", 0, 20_000_000]]);
  const e1 = await jurnal(w, "2026-09-15", [["5-1300", 12_563_000, 0], ["BANK", 0, 12_563_000]]);
  await jurnal(w, "2026-09-20", [["5-1200", 2_600_000, 0], ["BANK", 0, 2_600_000]]);
  await jurnal(w, "2026-09-25", [["6-1900", 500_000, 0], ["BANK", 0, 500_000]]);
  await jurnal(w, "2026-09-28", [["4-2100", 100_000, 0], ["BANK", 0, 100_000]]);
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: (e1.entry ?? e1).id, date: D("2026-10-05"), reason: "koreksi overhead (uji)", userId: w.admin.user.id }));
  await jurnal(w, "2026-10-06", [["5-1300", 1_190_752, 0], ["BANK", 0, 1_190_752]]);
  await jurnal(w, "2026-10-10", [["BANK", 700_000, 0], ["6-1900", 0, 700_000]]);
  await jurnal(w, "2026-10-12", [["BANK", 30_000, 0], ["4-2100", 0, 30_000]]);
}
const fm = (n) => moneyToNumber(sumMoney([n]));
const jml = (xs) => moneyToNumber(sumMoney(xs));

test("A. pembalik overhead lintas bulan: nominal ledger tidak berubah; penanda 'pembalik beban bersih' ada pada akun yang bersaldo kredit bersih; rumus laba utuh", async () => {
  const w = await dunia(); await skenario(w);
  const okt = await labaRugi(testPrisma, { from: D(OKT.fromStr), to: D(OKT.toStr) });
  const r = okt.ringkasan;
  assert.equal(r.bebanPokok, -11_372_248, "HPP Oktober = saldo normal (debit − kredit) apa adanya, negatif");
  assert.equal(r.bebanOperasional, -700_000);
  assert.equal(r.retur, -30_000); assert.equal(r.pendapatanBersih, 30_000, "retur bersaldo kredit MENAMBAH pendapatan bersih");
  assert.equal(r.labaKotor, 30_000 + 11_372_248); assert.equal(r.labaBersih, 30_000 + 11_372_248 + 700_000, "laba = pendapatan bersih − beban pokok − beban operasional (rumus tidak berubah)");
  const b5 = okt.bebanPokok.find((x) => x.code === "5-1300"); assert.equal(b5.nilai, -11_372_248); assert.equal(b5.pembalikBebanBersih, true);
  assert.equal(okt.bebanOperasional.find((x) => x.code === "6-1900").pembalikBebanBersih, true);
  assert.equal(okt.retur.find((x) => x.code === "4-2100").pembalikReturBersih, true);
  assert.equal(r.pembalikBebanPokok, -11_372_248); assert.equal(r.pembalikBebanOperasional, -700_000);
  // Sep–Okt: 5-1300 netto +1.190.752 (BUKAN pembalik); HPP neto 2.600.000 + 1.190.752 = 3.790.752; 6-1900 = 500.000 − 700.000 = −200.000 (pembalik); retur = 100.000 − 30.000 = 70.000
  const so = (await labaRugi(testPrisma, { from: D(SEPOKT.fromStr), to: D(SEPOKT.toStr) }));
  assert.equal(so.ringkasan.bebanPokok, 3_790_752); assert.ok(!so.bebanPokok.find((x) => x.code === "5-1300").pembalikBebanBersih);
  assert.equal(so.bebanOperasional.find((x) => x.code === "6-1900").nilai, -200_000); assert.equal(so.bebanOperasional.find((x) => x.code === "6-1900").pembalikBebanBersih, true);
  assert.equal(so.ringkasan.pembalikBebanPokok, 0); assert.equal(so.ringkasan.retur, 70_000);
  assert.equal(so.ringkasan.labaBersih, fm(20_000_000 - 70_000 - 3_790_752 - (-200_000)));
});

test("B. kartu = Σ akun = Σ jurnal = Excel sampai sen (Okt, Sep–Okt); kontrol parity OK termasuk Σ akun beban; Laba Kotor/Bersih konsisten", async () => {
  const w = await dunia(); await skenario(w);
  for (const per of [OKT, SEPOKT]) {
    const d = await bacaLaporanTerinci(testPrisma, { ...per, denganBaris: true });
    const lr = await labaRugi(testPrisma, { from: D(per.fromStr), to: D(per.toStr) });
    const kartu = Object.fromEntries(d.kartu.map((k) => [k.metrik, k]));
    assert.equal(kartu.hpp.nilai, lr.ringkasan.bebanPokok); assert.equal(kartu.hpp.totalBaris, kartu.hpp.nilai); assert.ok(kartu.hpp.cocok);
    assert.equal(jml(lr.bebanPokok.map((x) => x.nilai)), kartu.hpp.nilai, "Σ akun beban pokok (Laba Rugi) = kartu");
    assert.equal(jml(d.baris.filter((b) => b.akunTipe === "BEBAN_POKOK").map((b) => b.nilai)), kartu.hpp.nilai, "Σ baris jurnal = kartu");
    assert.equal(jml(d.akunPerMetrik.hpp.map((a) => a.nilai)), kartu.hpp.nilai, "Σ akunPerMetrik = kartu");
    assert.equal(jml(lr.bebanOperasional.map((x) => x.nilai)), kartu.beban_operasional.nilai);
    assert.equal(kartu.laba_bersih.nilai, jml([lr.ringkasan.pendapatanBersih, -lr.ringkasan.bebanPokok, -lr.ringkasan.bebanOperasional]));
    assert.equal(kartu.laba_kotor.nilai, jml([lr.ringkasan.pendapatanBersih, -lr.ringkasan.bebanPokok]));
    assert.ok(d.kontrol.semuaOk, d.kontrol.daftar.filter((k) => !k.ok).map((k) => k.label).join("; "));
    assert.ok(d.kontrol.daftar.some((k) => k.kunci === "akun_beban_pokok") && d.kontrol.daftar.some((k) => k.kunci === "akun_beban_operasional"));
    assert.equal(d.bebanDivisi.residual, 0);
    // Excel (endpoint asli)
    const ex = await unduhExport(server.baseUrl, w.admin.token, "laporan-keuangan", { periode: { from: per.fromStr, to: per.toStr }, filter: {} });
    assert.equal(ex.status, 200, JSON.stringify(ex.json));
    const sheetLR = bacaSheet(ex.wb, "Laba Rugi");
    const bp = sheetLR.baris.filter((x) => x["Seksi"] === "Beban Pokok"); const bo = sheetLR.baris.filter((x) => x["Seksi"] === "Beban Operasional");
    assert.equal(jml(bp.map((x) => x["Nilai (Rp)"] ?? x["Nilai"])), kartu.hpp.nilai, "Excel Σ Beban Pokok = kartu");
    assert.equal(jml(bo.map((x) => x["Nilai (Rp)"] ?? x["Nilai"])), kartu.beban_operasional.nilai, "Excel Σ Beban Operasional = kartu");
    const ring = bacaSheet(ex.wb, "Ringkasan");
    for (const k of d.kartu) { const baris = ring.baris.find((x) => x["Uraian"] === k.label); assert.ok(baris, k.label); assert.equal(Number(baris["Nilai (Rp)"]), k.nilai, `Excel Ringkasan ${k.label}`); }
    const rin = bacaSheet(ex.wb, "Rincian Jurnal"); assert.equal(rin.baris.length, d.baris.length);
    assert.equal(jml(rin.baris.map((x) => x["Efek ke Laba Bersih (Rp)"])), kartu.laba_bersih.nilai, "Excel Σ rincian jurnal = Laba Bersih");
    // penanda pembalik di Excel
    if (per === OKT) {
      const baris5 = sheetLR.baris.find((x) => String(x["Kode"]) === "5-1300"); assert.match(String(baris5["Sifat"]), /Pembalik beban bersih/);
      const bar6 = sheetLR.baris.find((x) => String(x["Kode"]) === "6-1900"); assert.match(String(bar6["Sifat"]), /Pembalik beban bersih/);
      assert.ok(ring.baris.some((x) => /pembalik beban bersih/i.test(String(x["Keterangan"] ?? ""))), "Ringkasan Excel menjelaskan pembalik");
    }
  }
});

test("C. Neraca Saldo: saldo terbalik di sisi yang BENAR (angka positif + penanda); total mutasi tetap seimbang; Neraca & Arus Kas konsisten pada periode yang sama", async () => {
  const w = await dunia(); await skenario(w);
  const ns = await neracaSaldo(testPrisma, { from: D(OKT.fromStr), to: D(OKT.toStr) });
  const baris = (kode) => ns.baris.find((b) => b.code === kode);
  const b5 = baris("5-1300"); assert.equal(b5.saldo, -11_372_248); assert.equal(b5.saldoDebit, 0); assert.equal(b5.saldoKredit, 11_372_248, "beban bersaldo kredit → kolom KREDIT, positif"); assert.equal(b5.saldoTidakNormal, true); assert.equal(b5.sisiSaldo, "KREDIT");
  const b6 = baris("6-1900"); assert.equal(b6.saldoKredit, 700_000); assert.equal(b6.saldoDebit, 0); assert.equal(b6.saldoTidakNormal, true);
  const retur = baris("4-2100"); assert.equal(retur.saldo, -30_000, "kontra pendapatan (normal DEBIT) bersaldo kredit"); assert.equal(retur.saldoKredit, 30_000); assert.equal(retur.saldoTidakNormal, true);
  const bank = baris(w.akun[(await testPrisma.finAccount.findUnique({ where: { id: w.bank.accountId } })).code].code); assert.equal(bank.saldoTidakNormal, false); assert.ok(bank.saldoDebit > 0 && bank.saldoKredit === 0);
  assert.ok(ns.baris.every((b) => b.saldoDebit >= 0 && b.saldoKredit >= 0), "tidak ada angka negatif di kolom saldo");
  assert.equal(ns.total.mutasiDebit, ns.total.mutasiKredit); assert.ok(ns.total.seimbang);
  // saldo normal tetap menurut saldo normal untuk akun yang tidak terbalik
  const nrc = await neraca(testPrisma, { to: D(OKT.toStr) }); assert.ok(nrc.ringkasan.seimbang, `Neraca selisih ${nrc.ringkasan.selisih}`);
  const ak = await arusKas(testPrisma, { from: D(OKT.fromStr), to: D(OKT.toStr) });
  assert.equal(ak.ringkasan.saldoAkhir, jml([ak.ringkasan.saldoAwal, ak.ringkasan.masuk, -ak.ringkasan.keluar]), "saldo akhir = awal + masuk − keluar");
  const bukuBank = await testPrisma.finJournalLine.aggregate({ where: { accountId: w.bank.accountId, entry: { status: { in: ["POSTED", "REVERSED"] }, date: { lte: D(OKT.toStr) } } }, _sum: { debit: true, credit: true } });
  assert.equal(ak.ringkasan.saldoAkhir, jml([Number(bukuBank._sum.debit), -Number(bukuBank._sum.credit)]), "saldo akhir Arus Kas = saldo buku kas/bank");
});

test("D. kas bersaldo kredit & beban kredit bersih di Neraca Saldo: kolom Kredit positif + penanda (bukan negatif di kolom debit)", async () => {
  const w = await dunia();
  await jurnal(w, "2026-10-03", [["6-1900", 250_000, 0], ["KAS", 0, 250_000]]); // kas fisik bersaldo kredit −250.000
  const ns = await neracaSaldo(testPrisma, { from: D("2026-10-01"), to: D("2026-10-31") });
  const kasKode = (await testPrisma.finAccount.findUnique({ where: { id: w.kas.accountId } })).code;
  const k = ns.baris.find((b) => b.code === kasKode); assert.equal(k.saldo, -250_000); assert.equal(k.saldoKredit, 250_000); assert.equal(k.saldoDebit, 0); assert.equal(k.saldoTidakNormal, true);
  const b = ns.baris.find((x) => x.code === "6-1900"); assert.equal(b.saldoDebit, 250_000); assert.equal(b.saldoTidakNormal, false);
  const kontraAset = await testPrisma.finAccount.findFirst({ where: { type: "ASET", normalBalance: "KREDIT", isPostable: true } });
  if (kontraAset) { // akun kontra aset (mis. akumulasi penyusutan) bersaldo normal kredit: tidak ditandai terbalik
    await jurnal(w, "2026-10-04", [["6-1900", 100_000, 0], [kontraAset.code, 0, 100_000]]);
    const n2 = await neracaSaldo(testPrisma, { from: D("2026-10-01"), to: D("2026-10-31") }); const kk = n2.baris.find((x) => x.code === kontraAset.code);
    assert.equal(kk.saldoKredit, 100_000); assert.equal(kk.saldoTidakNormal, false);
  }
});

test("E. periode kosong: semua nol, tanpa baris, kontrol OK, Excel tetap terbit; data tanpa harga TIDAK menjadi biaya Rp0 dan margin tidak final", async () => {
  const w = await dunia(); await skenario(w);
  const kosong = await bacaLaporanTerinci(testPrisma, { ...KOSONG, denganBaris: true });
  assert.equal(kosong.jumlahBaris, 0); assert.ok(kosong.kartu.every((k) => k.nilai === 0 && k.totalBaris === 0)); assert.ok(kosong.kontrol.semuaOk);
  const lr0 = await labaRugi(testPrisma, { from: D(KOSONG.fromStr), to: D(KOSONG.toStr) }); assert.equal(lr0.ringkasan.pembalikBebanPokok, 0); assert.equal(lr0.bebanPokok.length, 0);
  const ns0 = await neracaSaldo(testPrisma, { from: D(KOSONG.fromStr), to: D(KOSONG.toStr) }); assert.equal(ns0.baris.length, 0); assert.ok(ns0.total.seimbang);
  const ex = await unduhExport(server.baseUrl, w.admin.token, "laporan-keuangan", { periode: { from: KOSONG.fromStr, to: KOSONG.toStr }, filter: {} }); assert.equal(ex.status, 200, JSON.stringify(ex.json));
  // data tanpa harga: unit terkirim + pemakaian ISSUE tanpa valuasi pada Oktober
  const cust = await testPrisma.customer.create({ data: { phone: "6281200000001", name: "Pelanggan Tanpa Harga", pipelineStage: "TRANSACTION" } });
  const order = await testPrisma.order.create({ data: { customerId: cust.id, value: 1_000_000, category: "LAYANAN", status: "DELIVERED", orderNumber: "RES-UJI-HRG" } });
  const unit = await testPrisma.unit.create({ data: { orderId: order.id, unitCode: "RES-UJI-HRG-U1", seq: 1, merk: "Uji", ukuran: "100 x 200", status: "DELIVERED" } });
  const job = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, status: "COMPLETED", scheduledDate: D("2026-10-14"), completedAt: new Date("2026-10-14T07:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  const mat = await testPrisma.material.create({ data: { code: "BAHAN-UJI", name: "Bahan Uji", unit: "METER" } });
  await testPrisma.stockMovement.create({ data: { materialId: mat.id, type: "ISSUE", qty: -3, unitId: unit.id, note: "tanpa harga", createdAt: new Date("2026-10-14T03:00:00.000Z") } });
  const hargaSebelum = (await labaRugi(testPrisma, { from: D(OKT.fromStr), to: D(OKT.toStr) })).ringkasan.bebanPokok;
  const d = await bacaLaporanTerinci(testPrisma, { ...OKT });
  assert.equal(d.hpp.status, "BELUM_LENGKAP"); assert.equal(d.hpp.final, false); assert.equal(d.hpp.tidakTerbukti.nominal, null, "biaya yang tak terbukti TIDAK diisi Rp0");
  assert.equal(d.ringkasan.bebanPokok, hargaSebelum, "tanpa harga tidak mengubah laba/HPP");
  assert.ok(d.hpp.alasan.some((a) => /tanpa harga/i.test(a)));
  assert.equal(d.hpp.terbukukan.pembalikBebanBersih, -11_372_248); assert.ok(d.hpp.terbukukan.akun.find((a) => a.kode === "5-1300").pembalikBebanBersih);
  assert.ok(d.akunPerMetrik.hpp.find((a) => a.kode === "5-1300").pembalikBebanBersih); assert.ok(d.akunPerMetrik.beban_operasional.find((a) => a.kode === "6-1900").pembalikBebanBersih);
});

test("F. beban per divisi: total divisi = beban pokok + operasional (residual Rp0) dan pembalik bersih ditandai; Excel divisi sama dengan layar", async () => {
  const w = await dunia(); await skenario(w);
  const d = await bacaLaporanTerinci(testPrisma, { ...OKT });
  assert.equal(d.bebanDivisi.residual, 0); assert.equal(d.bebanDivisi.totalDivisi, jml([d.ringkasan.bebanPokok, d.ringkasan.bebanOperasional]));
  const semuaAkun = d.bebanDivisi.divisi.flatMap((v) => v.akun);
  assert.equal(jml(semuaAkun.map((a) => a.nilai)), d.bebanDivisi.totalDivisi);
  assert.ok(semuaAkun.filter((a) => a.nilai < 0).every((a) => a.pembalikBebanBersih === true) && semuaAkun.some((a) => a.nilai < 0));
  assert.ok(d.bebanDivisi.divisi.filter((v) => v.total < 0).every((v) => v.pembalikBebanBersih === true));
  const ex = await unduhExport(server.baseUrl, w.admin.token, "laporan-keuangan", { periode: { from: OKT.fromStr, to: OKT.toStr }, filter: {} });
  const sd = bacaSheet(ex.wb, "Beban per Divisi"); assert.equal(jml(sd.baris.map((x) => x["Nilai (Rp)"] ?? x["Nilai"])), d.bebanDivisi.totalDivisi);
  assert.ok(sd.baris.some((x) => /Pembalik beban bersih/.test(String(x["Sifat"] ?? ""))), "Excel divisi memberi penanda pembalik");
  const hp = bacaSheet(ex.wb, "HPP"); assert.ok(hp.baris.some((x) => /Pembalik beban bersih/i.test(String(x["Keterangan"] ?? "")) && /5-1300/.test(String(x["Uraian"] ?? ""))));
});

test("G. drilldown: total & jumlah dihitung dari SELURUH baris yang lolos filter di server; daftar dipotong dengan label jelas; filter menyempit tanpa mengubah kartu", async () => {
  const w = await dunia(); await skenario(w);
  const penuh = await drilldownMetrik(testPrisma, { ...SEPOKT, metrik: "hpp" });
  assert.equal(penuh.cocok, true); assert.equal(penuh.jumlahSemua, penuh.jumlah); assert.equal(penuh.penanda.pembalikBebanBersih.label, "Pembalik beban bersih"); assert.equal(penuh.jumlah, penuh.baris.length); assert.equal(penuh.terpotong, false); assert.equal(penuh.sifatNilai, "BIAYA_NETO");
  const f = await drilldownMetrik(testPrisma, { ...SEPOKT, metrik: "hpp", akun: "5-1300" });
  assert.equal(f.nilaiKartu, penuh.nilaiKartu, "filter tidak mengubah kartu"); assert.equal(f.totalTersaring, 1_190_752); assert.equal(f.jumlah, 3);
  const kecil = await drilldownMetrik(testPrisma, { ...SEPOKT, metrik: "hpp", akun: "5-1300", maksBaris: 2 });
  assert.equal(kecil.terpotong, true); assert.equal(kecil.baris.length, 2); assert.equal(kecil.jumlahDitampilkan, 2); assert.equal(kecil.jumlah, 3, "jumlah = SELURUH baris yang tersaring, bukan yang dikirim");
  assert.equal(kecil.totalTersaring, 1_190_752, "total tersaring = Σ SELURUH baris (bukan Σ 2 baris yang dikirim)"); assert.equal(kecil.maksBaris, 2);
  assert.notEqual(jml(kecil.baris.map((b) => b.kontribusi)), kecil.totalTersaring, "Σ baris yang dikirim ≠ total — itu sebabnya klien tidak boleh menghitung sendiri");
  const cari = await drilldownMetrik(testPrisma, { ...SEPOKT, metrik: "beban_operasional", q: "uji 2026-10-10" }); assert.equal(cari.jumlah, 1); assert.equal(cari.totalTersaring, -700_000);
});

test("H. READ ONLY di database: tulisan di dalam transaksi laporan ditolak (SQLSTATE 25006); laporan terinci & drilldown tidak mengubah tabel apa pun", async () => {
  const w = await dunia(); await skenario(w);
  await assert.rejects(() => jalankanBacaSaja(testPrisma, async (tx) => { await tx.finSetting.create({ data: { key: "uji_baca_saja", value: "x" } }); }), (e) => /read-only|25006/i.test(String(e.message) + String(e.code) + String(e.meta?.code ?? "")));
  await assert.rejects(() => jalankanBacaSaja(testPrisma, async (tx) => { await tx.$executeRawUnsafe(`UPDATE fin_journal_lines SET description = 'x'`); }), (e) => /read-only|25006/i.test(String(e.message) + String(e.meta?.code ?? "")));
  assert.equal(await testPrisma.finSetting.count({ where: { key: "uji_baca_saja" } }), 0);
  const tabel = ["fin_journal_entries", "fin_journal_lines", "fin_settings", "fin_posting_gaps", "fin_periods", "activity_events", "stock_movements"];
  const sidik = async () => Object.fromEntries(await Promise.all(tabel.map(async (t) => [t, (await testPrisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]])));
  const s0 = await sidik();
  await bacaLaporanTerinci(testPrisma, { ...OKT, denganBaris: true }); await drilldownMetrik(testPrisma, { ...OKT, metrik: "laba_bersih" });
  assert.deepEqual(await sidik(), s0, "membaca laporan tidak mengubah tabel apa pun");
  assert.equal((await bacaLaporanTerinci(testPrisma, { ...OKT })).cutoff.isolasi.includes("READ ONLY"), true);
});
