// KONTROL PARITY PKR "ledger = dokumen" SAAT ADA JURNAL PEMBALIK (23 Okt 2026). Akar masalah: sisi ledger menghitung jurnal PKR asli (REVERSED) tetapi TIDAK jurnal pembaliknya (sumber REVERSAL).
// Di produksi pemicunya KOREKSI NILAI PKR-22102026-010 (Rp1.300.000 → Rp1.250.000, dokumen tetap AKTIF; selisih kontrol Rp1.300.000 = nilai jurnal asli yang dibalik), BUKAN pembatalan.
// Pembatalan memicu cacat yang sama (dokumen batal dikeluarkan dari sisi dokumen). Basis kini TANGGAL BUKU dan NETO di kedua sisi.
// Skenario (semua nominal Rp, dihitung tangan di komentar):
//   A  10 Okt  3.000.000 aktif
//   B  12 Okt  1.300.000 dibatalkan 22 Okt            (batal DALAM periode yang sama)
//   C  15 Sep  2.000.000 dibatalkan  5 Okt            (batal LINTAS periode: dibuat Sep, dibalik Okt)
//   D  14 Okt    500.000 → Koreksi nilai 800.000      (jurnal asli dibalik + pengganti, tanggal sama)
//   E  20 Okt    700.000 → Koreksi 900.000, dibatalkan 2 Nov (replay: dibalik pengganti terakhir di bulan lain)
//   Ledger neto per periode: Sep = +2.000.000 | Okt = 3.000.000 + 0 − 2.000.000 + 800.000 + 900.000 = 2.700.000 | Nov = −900.000.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { reverseJournal } from "../../src/services/finance/journal.js";
import { postPenjualanKaryawan, entriPenjualanAktif, koreksiJurnalPenjualan } from "../../src/services/finance/posting/penjualanKaryawan.js";
import { labaRugi } from "../../src/services/finance/reports.js";
import { bacaLaporanTerinci } from "../../src/services/finance/laporanTerinci/index.js";
import { sumMoney, moneyToNumber } from "../../src/services/finance/money.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const D = (s) => new Date(`${s}T00:00:00.000Z`);
const jml = (xs) => moneyToNumber(sumMoney(xs));
const SEP = { fromStr: "2026-09-01", toStr: "2026-09-30" }; const OKT = { fromStr: "2026-10-01", toStr: "2026-10-31" }; const NOV = { fromStr: "2026-11-01", toStr: "2026-11-30" };
const SEPOKT = { fromStr: "2026-09-01", toStr: "2026-10-31" }; const OKTNOV = { fromStr: "2026-10-01", toStr: "2026-11-30" }; const SEMUA = { fromStr: "2026-09-01", toStr: "2026-11-30" };
let nomorKe = 0;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const admin = await createTestUser({ roles: ["ADMIN"] }); const sales = await createTestUser({ roles: ["SALES"] });
  return { admin, sales };
}
async function pkr(w, { tgl, total }) {
  nomorKe += 1;
  const p = await testPrisma.finPenjualanKaryawan.create({ data: { nomor: `PKR-${tgl.slice(8, 10)}${tgl.slice(5, 7)}2026-${String(nomorKe).padStart(3, "0")}`, date: D(tgl), sellerId: w.sales.user.id, buyerName: "Kerabat Uji", total,
    status: "AKTIF", items: { create: [{ name: "Kasur Uji", quantity: 1, unitPrice: total, sortOrder: 0 }] } } });
  await testPrisma.$transaction((tx) => postPenjualanKaryawan(tx, { penjualanId: p.id, userId: w.admin.user.id }));
  return p;
}
/** Koreksi nilai persis seperti route: total diperbarui, lalu jurnal asli dibalik + pengganti (tanggal = tanggal dokumen). */
async function koreksi(w, p, totalBaru) {
  await testPrisma.$transaction(async (tx) => {
    await tx.finPenjualanKaryawan.update({ where: { id: p.id }, data: { total: totalBaru } });
    await koreksiJurnalPenjualan(tx, { penjualanId: p.id, userId: w.admin.user.id, alasan: "koreksi nilai (uji)" });
  });
}
/** Batalkan persis seperti route: balik jurnal yang berlaku pada TANGGAL BUKU batal + tandai dokumen DIBATALKAN dengan cancelledAt yang sama (instan siang WIB). */
async function batal(w, p, tglBuku) {
  await testPrisma.$transaction(async (tx) => {
    const entri = await entriPenjualanAktif(tx, p.id);
    await reverseJournal(tx, { entryId: entri.id, date: D(tglBuku), reason: `Penjualan karyawan ${p.nomor} dibatalkan (uji)`, userId: w.admin.user.id });
    await tx.finPenjualanKaryawan.update({ where: { id: p.id }, data: { status: "DIBATALKAN", cancelledAt: new Date(`${tglBuku}T05:00:00.000Z`), cancelReason: "uji" } }); // 05:00Z = 12:00 WIB, tanggal buku sama
  });
}
async function skenario(w) {
  const A = await pkr(w, { tgl: "2026-10-10", total: 3_000_000 });
  const B = await pkr(w, { tgl: "2026-10-12", total: 1_300_000 }); await batal(w, B, "2026-10-22");
  const C = await pkr(w, { tgl: "2026-09-15", total: 2_000_000 }); await batal(w, C, "2026-10-05");
  const Dd = await pkr(w, { tgl: "2026-10-14", total: 500_000 }); await koreksi(w, Dd, 800_000);
  const E = await pkr(w, { tgl: "2026-10-20", total: 700_000 }); await koreksi(w, E, 900_000); await batal(w, E, "2026-11-02");
  return { A, B, C, D: Dd, E };
}
const HARAP = [[SEP, 2_000_000], [OKT, 2_700_000], [NOV, -900_000], [SEPOKT, 4_700_000], [OKTNOV, 1_800_000], [SEMUA, 3_800_000]];
const hitungSnapshot = async () => ({
  jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(),
  nilai: jml((await testPrisma.finJournalLine.findMany({ select: { debit: true, credit: true } })).flatMap((l) => [l.debit, l.credit])),
  pkr: await testPrisma.finPenjualanKaryawan.count(),
});

test("A. akar masalah terbukti: basis LAMA (hanya jurnal PKR asli vs dokumen aktif) berselisih pada periode yang memuat pembatalan; basis BARU cocok di semua periode", async () => {
  const w = await dunia(); await skenario(w);
  const d = await bacaLaporanTerinci(testPrisma, { ...OKT, denganBaris: true });
  const lama = jml(d.baris.filter((r) => r.akunTipe === "PENDAPATAN" && r.sumber === "PENJUALAN_KARYAWAN").map((r) => r.efek));   // sisi ledger SEBELUM perbaikan
  const dokAktif = jml((await testPrisma.finPenjualanKaryawan.findMany({ where: { status: "AKTIF", date: { gte: D("2026-10-01"), lte: D("2026-10-31") } } })).map((p) => p.total));
  // Lama: jurnal asli Okt = A 3.000.000 + B 1.300.000 (REVERSED) + D 0 (asli dibalik, pembalik bukan sumber PKR) + pengganti D 800.000 + E asli/pengganti 900.000 → TANPA pembalik C/B/dll.
  assert.notEqual(lama, dokAktif, "basis lama berselisih (di produksi: selisih Rp1.300.000 akibat satu Koreksi nilai PKR)");
  for (const [per, harap] of HARAP) {
    const x = await bacaLaporanTerinci(testPrisma, { ...per, denganBaris: true });
    assert.equal(x.pkr.ringkasan.pendapatanLedger, harap, `ledger neto ${per.fromStr}..${per.toStr}`);
    assert.equal(x.pkr.ringkasan.penjualanDokumenBuku, harap, `dokumen (tanggal buku, neto) ${per.fromStr}..${per.toStr}`);
    assert.equal(x.pkr.ringkasan.selisih, 0);
  }
});

test("B. kontrol kembali 14/14 untuk PKR aktif, batal sama periode, batal lintas periode, koreksi nilai, dan batal setelah koreksi — di semua periode", async () => {
  const w = await dunia(); await skenario(w);
  for (const [per] of HARAP) {
    const d = await bacaLaporanTerinci(testPrisma, { ...per, denganBaris: true });
    assert.equal(d.kontrol.daftar.length, 14, "jumlah kontrol tetap 14");
    assert.ok(d.kontrol.semuaOk, `${per.fromStr}..${per.toStr}: ${d.kontrol.daftar.filter((k) => !k.ok).map((k) => `${k.label} (${k.kiri} vs ${k.kanan})`).join("; ")}`);
    assert.equal(d.kontrol.jumlahGagal, 0);
    const k = d.kontrol.daftar.find((x) => x.kunci === "pkr_ledger_dokumen"); assert.ok(k.ok); assert.equal(k.selisih, 0);
  }
});

test("C. kartu = Σ akun = Σ jurnal = laporan PKR = Excel sampai sen; Laba Rugi baku tidak berubah (kartu pendapatan = labaRugi())", async () => {
  const w = await dunia(); await skenario(w);
  for (const [per, harap] of HARAP) {
    const d = await bacaLaporanTerinci(testPrisma, { ...per, denganBaris: true });
    const lr = await labaRugi(testPrisma, { from: D(per.fromStr), to: D(per.toStr) });
    const kartu = Object.fromEntries(d.kartu.map((k) => [k.metrik, k]));
    assert.equal(kartu.pendapatan.nilai, lr.ringkasan.pendapatanBersih, "kartu = Laba Rugi baku");
    assert.equal(jml(d.baris.filter((b) => b.akunTipe === "PENDAPATAN").map((b) => b.efek)), kartu.pendapatan.nilai, "Σ baris jurnal = kartu");
    const akunPkr = lr.pendapatan.find((a) => a.code === "4-1250"); assert.equal(akunPkr?.nilai ?? 0, harap, "akun 4-1250 Laba Rugi baku = ledger PKR neto");
    assert.equal(d.pkr.ringkasan.pendapatanLedger, harap);
    // jurnal pembalik ikut di Rincian: sumber REVERSAL yang membalik jurnal PKR
    const pembalik = d.baris.filter((b) => b.akunKode === "4-1250" && b.sumber === "REVERSAL");
    assert.ok(pembalik.every((b) => b.membalik?.sumber === "PENJUALAN_KARYAWAN"));
    const ex = await unduhExport(server.baseUrl, w.admin.token, "laporan-keuangan", { periode: { from: per.fromStr, to: per.toStr }, filter: {} });
    assert.equal(ex.status, 200, JSON.stringify(ex.json));
    const ring = bacaSheet(ex.wb, "Ringkasan");
    const barisPend = ring.baris.find((x) => x["Uraian"] === "Pendapatan Bersih"); assert.equal(Number(barisPend["Nilai (Rp)"]), kartu.pendapatan.nilai, "Excel Ringkasan = kartu");
    const kontrolPkr = ring.baris.find((x) => /pkr/i.test(String(x["Uraian"])) && /Kontrol/.test(String(x["Uraian"]))); assert.ok(kontrolPkr, "baris kontrol PKR ada di Excel"); assert.equal(kontrolPkr["Status"], "OK");
    const rin = bacaSheet(ex.wb, "Rincian Jurnal");
    assert.equal(jml(rin.baris.filter((x) => String(x["Akun"]).startsWith("4-1250")).map((x) => x["Efek ke Laba Bersih (Rp)"])), harap, "Σ Excel Rincian Jurnal akun 4-1250 = ledger PKR neto");
    assert.equal(jml(rin.baris.map((x) => x["Efek ke Laba Bersih (Rp)"])), d.kartu.find((k) => k.metrik === "laba_bersih").nilai, "Σ Excel rincian = laba bersih");
    const sheetPkr = bacaSheet(ex.wb, "PKR"); const dokExcel = sheetPkr.baris.filter((b) => /^PKR-/.test(String(b["No. PKR"])));
    assert.equal(dokExcel.length, d.pkr.dokumen.length, "Excel PKR = laporan PKR (jumlah dokumen)");
    assert.equal(Object.keys(sheetPkr.baris[0]).at(-1), "Tanggal batal", "kolom baru di ujung kanan");
    for (const x of d.pkr.dokumen.filter((y) => y.dibatalkanPadaPeriode)) assert.ok(x.tanggalBatal && x.status === "DIBATALKAN");
  }
});

test("D. batal lintas periode tampil di KEDUA sisi: C dibuat di Sep (+2.000.000) dan dibalik di Okt (−2.000.000); dokumen batal tampil di laporan PKR kedua periode dengan tanggal batal", async () => {
  const w = await dunia(); const s = await skenario(w);
  const sep = await bacaLaporanTerinci(testPrisma, { ...SEP, denganBaris: true }); const okt = await bacaLaporanTerinci(testPrisma, { ...OKT, denganBaris: true });
  assert.equal(sep.pkr.ringkasan.dibukukanDokumen, 2_000_000); assert.equal(sep.pkr.ringkasan.dibalikDokumen, 0);
  assert.equal(okt.pkr.ringkasan.dibalikDokumen, 3_300_000, "B 1.300.000 (batal 22 Okt) + C 2.000.000 (batal 5 Okt)"); assert.equal(okt.pkr.ringkasan.jumlahDibalik, 2);
  const nomorC = sep.pkr.dokumen.find((d) => d.nomor === s.C.nomor); assert.ok(nomorC, "C tampil di Sep (dibuat)"); assert.equal(nomorC.status, "DIBATALKAN"); assert.equal(nomorC.tanggalBatal, "2026-10-05"); assert.equal(nomorC.dibatalkanPadaPeriode, false);
  const cOkt = okt.pkr.dokumen.find((d) => d.nomor === s.C.nomor); assert.ok(cOkt, "C tampil di Okt (dibatalkan)"); assert.equal(cOkt.dibatalkanPadaPeriode, true);
  assert.equal(okt.pkr.ringkasan.jumlahDokumen, 2, "dokumen AKTIF yang dibuat di Okt: hanya A dan D (B dan E sudah dibatalkan)");
});

test("E. replay/idempoten: posting ulang tidak membuat jurnal ganda; membalik jurnal yang sudah dibalik ditolak (409); pembacaan laporan tidak mengubah jurnal/dokumen", async () => {
  const w = await dunia(); const s = await skenario(w);
  const sebelum = await hitungSnapshot();
  const ulang = await testPrisma.$transaction((tx) => postPenjualanKaryawan(tx, { penjualanId: s.A.id, userId: w.admin.user.id }));
  assert.equal(ulang.created, false, "posting ulang (replay) mengembalikan jurnal yang sama");
  const dibalik = await testPrisma.finJournalEntry.findFirst({ where: { reversalOfId: { not: null }, reversalOf: { sourceId: s.B.id } } });
  await assert.rejects(() => testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: dibalik.reversalOfId, reason: "ulang", userId: w.admin.user.id })), (e) => /sudah pernah dibatalkan|409/.test(String(e.message)));
  assert.deepEqual(await hitungSnapshot(), sebelum, "replay/penolakan tidak mengubah apa pun");
  for (const [per] of HARAP) await bacaLaporanTerinci(testPrisma, { ...per, denganBaris: true });
  await unduhExport(server.baseUrl, w.admin.token, "laporan-keuangan", { periode: { from: OKT.fromStr, to: OKT.toStr }, filter: {} });
  assert.deepEqual(await hitungSnapshot(), sebelum, "membaca laporan & Excel tidak menulis jurnal/dokumen");
});

test("F. regresi: tanpa PKR dibatalkan kontrol tetap cocok; periode kosong tetap nol; PKR yang dibatalkan TANPA jurnal pembalik tidak disembunyikan (selisih terdeteksi)", async () => {
  const w = await dunia();
  await pkr(w, { tgl: "2026-10-10", total: 3_000_000 });
  const ok = await bacaLaporanTerinci(testPrisma, { ...OKT, denganBaris: true }); assert.ok(ok.kontrol.semuaOk); assert.equal(ok.pkr.ringkasan.pendapatanLedger, 3_000_000); assert.equal(ok.pkr.ringkasan.penjualanDokumen, 3_000_000);
  const kosong = await bacaLaporanTerinci(testPrisma, { ...NOV, denganBaris: true }); assert.ok(kosong.kontrol.semuaOk); assert.equal(kosong.pkr.ringkasan.pendapatanLedger, 0); assert.equal(kosong.pkr.dokumen.length, 0);
  // Data rusak sengaja: dokumen ditandai DIBATALKAN tetapi jurnalnya TIDAK dibalik → kontrol HARUS gagal (bukan lolos diam-diam).
  const p2 = await pkr(w, { tgl: "2026-10-11", total: 400_000 });
  await testPrisma.finPenjualanKaryawan.update({ where: { id: p2.id }, data: { status: "DIBATALKAN", cancelledAt: new Date("2026-10-15T05:00:00.000Z") } });
  const rusak = await bacaLaporanTerinci(testPrisma, { ...OKT, denganBaris: true });
  const k = rusak.kontrol.daftar.find((x) => x.kunci === "pkr_ledger_dokumen"); assert.equal(k.ok, false); assert.equal(k.selisih, 400_000, "ledger masih memuat 400.000 yang dokumennya batal tanpa pembalik");
});
