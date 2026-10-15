// LAPORAN KEUANGAN TERINCI + PENANDA MUTU ANGKA — parity layar ↔ Excel ↔ ledger, drilldown, jembatan (residual Rp0), PKR terpisah, HPP/penanda mutu, beban per divisi,
// konflik atribusi, gap (BELUM_BERHARGA vs PKR Rp0), izin, kondisi tanpa data, dan BACA-SAJA (tidak ada tabel yang berubah). Dunia skenario meniru kasus audit 15 Okt 2026.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal, reverseJournal, recordPostingGap } from "../../src/services/finance/journal.js";
import { postPaymentReceived, postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { postPenjualanKaryawan } from "../../src/services/finance/posting/penjualanKaryawan.js";
import { recomputeOrderPaymentStatus } from "../../src/services/paymentLedger.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const NOTA = "/media/finance-receipts/tes.jpg";
const FROM = "2026-10-01"; const TO = "2026-10-15";
const Q = `from=${FROM}&to=${TO}`;
const D = (s) => new Date(`${s}T00:00:00.000Z`);
const WIB = (s, jam = 10) => new Date(`${s}T${String(jam).padStart(2, "0")}:00:00.000+07:00`);
let seq = 0;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const k = (u) => makeClient(server.baseUrl, u.token);
  return { bank, admin, fin, sales, a: k(admin), f: k(fin), s: k(sales), anon: makeClient(server.baseUrl, null) };
}

/** Order + (opsional) pembayaran terverifikasi + (opsional) pengakuan + job serah + unit. */
async function buatOrder(w, { nilai, ongkir = null, status = "DELIVERED", kategori = "LAYANAN", bayar = null, bayarTgl = null, akui = null, serah = null, nama = "Pelanggan Uji", unit = 1, pkrId = null }) {
  seq += 1;
  const c = await testPrisma.customer.create({ data: { phone: `62812${String(Date.now()).slice(-6)}${seq}`, name: `${nama} ${seq}`, pipelineStage: "TRANSACTION" } });
  const o = await testPrisma.order.create({ data: { customerId: c.id, value: nilai, ongkir, category: kategori, status, orderNumber: `${kategori === "SEWA" ? "SWS" : "RES"}-UJI-${String(seq).padStart(3, "0")}`, penjualanKaryawanId: pkrId } });
  if (nilai > 0) await testPrisma.orderItem.create({ data: { orderId: o.id, layananName: "Paket Upgrade", harga: nilai, sortOrder: 0 } });
  const unitIds = [];
  for (let i = 1; i <= unit; i += 1) unitIds.push((await testPrisma.unit.create({ data: { orderId: o.id, unitCode: `${o.orderNumber}-U${i}`, seq: i, merk: "Uji", ukuran: "100 x 200", status: "DELIVERED" } })).id);
  if (bayar) {
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: bayar, method: "TRANSFER", recordedById: w.admin.user.id, cashAccountId: w.bank.id, createdAt: WIB(bayarTgl) } });
    await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.admin.user.id } });
    await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: w.admin.user.id }));
    await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, o.id));
    await testPrisma.order.update({ where: { id: o.id }, data: { paidAt: WIB(bayarTgl) } });
  }
  if (serah) {
    const j = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: o.id, status: "COMPLETED", scheduledDate: D(serah), completedAt: WIB(serah, 14) } });
    for (const u of unitIds) await testPrisma.jobUnit.create({ data: { jobId: j.id, unitId: u } });
  }
  let entri = null;
  if (akui) { const r = await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: w.admin.user.id, date: D(akui) })); entri = r.entry ?? null; }
  return { o, c, unitIds, entri };
}

async function biaya(w, { kode, division, amount, tgl, desk }) {
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: kode } });
  const r = await w.a.post("/api/finance/expenses", { date: tgl, amount, description: desk ?? `uji ${kode}`, categoryId: kat.id, division, mode: "LANGSUNG", cashAccountId: w.bank.id, receiptUrl: NOTA });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await w.a.post(`/api/finance/expenses/${r.body.id}/approve`, {})).status, 200);
}

/** Dunia skenario audit: tiap kelas jembatan terwakili, PKR, gap resmi (BELUM_BERHARGA + PKR Rp0), biaya berdivisi (konflik + sensitif + belum teratribusi). */
async function skenario(w) {
  const h = {};
  h.A = await buatOrder(w, { nilai: 1_000_000, ongkir: 50_000, bayar: 1_050_000, bayarTgl: "2026-10-05", serah: "2026-10-06", akui: "2026-10-06", unit: 2 });         // lunas+diakui P (+ongkir)
  h.B = await buatOrder(w, { nilai: 200_000, kategori: "SEWA", status: "SEWA_DIAMBIL", bayar: 200_000, bayarTgl: "2026-10-03", serah: "2026-09-29", akui: "2026-09-29" }); // diakui sebelum P
  h.C = await buatOrder(w, { nilai: 800_000, status: "PROCESSING", bayar: 800_000, bayarTgl: "2026-10-04" });                                                          // lunas belum diserahkan
  h.D = await buatOrder(w, { nilai: 1_500_000, bayar: 1_500_000, bayarTgl: "2026-10-08", serah: "2026-09-09" });                                                      // diserahkan, tak pernah diakui, tanpa gap
  h.E = await buatOrder(w, { nilai: 2_000_000, bayar: 2_000_000, bayarTgl: "2026-09-20", serah: "2026-10-07", akui: "2026-10-07" });                                  // diakui P, lunas periode lain
  h.F = await buatOrder(w, { nilai: 900_000, serah: "2026-10-08", akui: "2026-10-08" });                                                                              // diakui P, belum lunas
  h.H = await buatOrder(w, { nilai: 600_000, status: "CANCELLED", serah: "2026-09-30", akui: "2026-09-30" });                                                         // pengakuan lama dibalik di P
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: h.H.entri.id, date: D("2026-10-06"), reason: "Order dibatalkan (uji)", userId: w.admin.user.id }));
  // Gap resmi: order nilai Rp0 sudah diserahkan → NILAI_ORDER_NOL (BELUM_BERHARGA) // ongkir NULL seperti di produksi (kolom nullable) — regresi bug yang ditangkap rehearsal rilis
  h.G = await buatOrder(w, { nilai: 0, ongkir: null, serah: "2026-10-09", akui: "2026-10-09" });
  // PKR: dokumen Rp3.000.000 + order CRM operasional bernilai Rp0 dengan gap PKR (hanya untuk pembeda jenis)
  const pkr = await testPrisma.finPenjualanKaryawan.create({ data: { nomor: "PKR-10102026-001", date: D("2026-10-10"), sellerId: w.sales.user.id, buyerName: "Kerabat Uji", total: 3_000_000, status: "AKTIF",
    items: { create: [{ name: "Kasur Uji", quantity: 1, unitPrice: 3_000_000, sortOrder: 0 }] } } });
  await testPrisma.$transaction((tx) => postPenjualanKaryawan(tx, { penjualanId: pkr.id, userId: w.admin.user.id }));
  h.P = await buatOrder(w, { nilai: 0, status: "READY", pkrId: pkr.id, unit: 1 });
  await testPrisma.$transaction((tx) => recordPostingGap(tx, { source: "PENGAKUAN_PENDAPATAN", sourceId: h.P.o.id, reason: "NILAI_ORDER_NOL", detail: "Order PKR operasional bernilai Rp0 (uji)" }));
  // Retur 4-2100 pada order A (jurnal manual Dr Retur / Cr Bank) — satu baris kontra pendapatan
  const retur = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.RETUR_PENJUALAN } });
  const bankAkun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  await testPrisma.$transaction((tx) => postJournal(tx, { date: D("2026-10-12"), description: "Retur uji", source: "MANUAL", userId: w.admin.user.id, lines: [
    { accountId: retur.id, debit: 100_000, orderId: h.A.o.id, description: "Retur" }, { accountId: bankAkun.id, credit: 100_000, cashAccountId: w.bank.id },
  ] }));
  // Beban: BBM Delivery, BBM Produksi (KONFLIK: dokumen Produksi vs kategori BBM → Delivery), Gaji (SENSITIF), jurnal manual (BELUM TERATRIBUSI), pembelian bahan manual (beban pokok)
  await biaya(w, { kode: "BBM", division: "DELIVERY", amount: 100_000, tgl: "2026-10-02" });
  await biaya(w, { kode: "BBM", division: "PRODUKSI", amount: 70_000, tgl: "2026-10-03" });
  await biaya(w, { kode: "GAJI_KARYAWAN", division: "UMUM", amount: 400_000, tgl: "2026-10-05", desk: "gaji uji rahasia" });
  await biaya(w, { kode: "UPAH_PRODUKSI", division: "PRODUKSI", amount: 250_000, tgl: "2026-10-06" });
  const beban = await testPrisma.finAccount.findUnique({ where: { code: "6-1900" } });
  await testPrisma.$transaction((tx) => postJournal(tx, { date: D("2026-10-12"), description: "Jurnal manual tanpa dokumen", source: "MANUAL", userId: w.admin.user.id, lines: [
    { accountId: beban.id, debit: 10_500 }, { accountId: bankAkun.id, credit: 10_500, cashAccountId: w.bank.id },
  ] }));
  return h;
}

const terinci = async (c, q = Q) => (await c.get(`/api/finance/reports/income-statement/terinci?${q}`));
const rowsHash = async () => JSON.stringify(await Promise.all(["finJournalEntry", "finJournalLine", "payment", "order", "finPostingGap", "finPenjualanKaryawan", "stockMovement", "job", "unit"].map((t) => testPrisma[t].count())));

test("PARITY LAYAR–LEDGER: kartu terinci = /income-statement (rumus tidak berubah); Σ baris tiap kartu = nilai kartu; kontrol semua OK", async () => {
  const w = await dunia(); await skenario(w);
  const lama = (await w.f.get(`/api/finance/reports/income-statement?${Q}`)).body.ringkasan;
  const r = await terinci(w.f); assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body;
  assert.deepEqual(d.ringkasan, lama, "ringkasan terinci identik dengan laporan Laba Rugi yang ada");
  const nilai = { pendapatan: lama.pendapatanBersih, hpp: lama.bebanPokok, laba_kotor: lama.labaKotor, beban_operasional: lama.bebanOperasional, laba_bersih: lama.labaBersih };
  for (const k of d.kartu) { assert.equal(k.nilai, nilai[k.metrik]); assert.equal(k.totalBaris, k.nilai, `${k.metrik}: Σ baris = kartu`); assert.ok(k.cocok); assert.ok(k.jumlahBaris > 0); }
  assert.ok(d.kontrol.semuaOk, JSON.stringify(d.kontrol.daftar.filter((x) => !x.ok)));
  assert.ok(d.cutoff.diambilPada && d.cutoff.diambilPadaWib && d.cutoff.tanggalBukuTerakhir, "cutoff tercetak");
  // drilldown per kartu: total semua baris = kartu; Σ per akun = kartu; Σ per divisi = kartu
  for (const m of ["pendapatan", "hpp", "laba_kotor", "beban_operasional", "laba_bersih"]) {
    const dd = (await w.f.get(`/api/finance/reports/income-statement/drilldown?${Q}&metrik=${m}`)).body;
    assert.equal(dd.cocok, true, m); assert.equal(dd.totalSemuaBaris, nilai[m]); assert.equal(dd.totalTersaring, nilai[m]);
    assert.equal(Math.round(dd.grupAkun.reduce((s, g) => s + g.nilai, 0) * 100), Math.round(nilai[m] * 100), `${m}: Σ akun`);
    assert.equal(Math.round(dd.grupDivisi.reduce((s, g) => s + g.nilai, 0) * 100), Math.round(nilai[m] * 100), `${m}: Σ divisi`);
    assert.ok(dd.baris.every((b) => b.nomorJurnal && b.akunKode && b.divisi && "kontribusi" in b), "tiap baris: jurnal, akun, divisi");
  }
  // filter akun mempersempit tanpa merusak total semua
  const f1 = (await w.f.get(`/api/finance/reports/income-statement/drilldown?${Q}&metrik=pendapatan&akun=4-1100`)).body;
  assert.ok(f1.jumlah > 0 && f1.baris.every((b) => b.akunKode === "4-1100")); assert.equal(f1.totalSemuaBaris, nilai.pendapatan);
  assert.equal((await w.f.get(`/api/finance/reports/income-statement/drilldown?${Q}&metrik=bukan_metrik`)).status, 400);
});

test("JEMBATAN omzet Sales Lunas → pendapatan Finance: tiap komponen tepat, residual Rp0, PKR terpisah, order temuan ditandai", async () => {
  const w = await dunia(); const h = await skenario(w);
  const j = (await terinci(w.f)).body.jembatan;
  assert.deepEqual(j.residual, { sales: 0, bruto: 0, retur: 0, bersih: 0, nol: true });
  const L = Object.fromEntries(j.langkah.map((l) => [l.kunci, l]));
  // omzet Lunas periode: A 1.000.000 + B 200.000 + C 800.000 + D 1.500.000 (E lunas 20 Sep; F belum lunas; H batal)
  assert.equal(L.omzet.nominal, 3_500_000); assert.equal(L.omzet.jumlahOrder, 4);
  assert.equal(L.LUNAS_BELUM_DISERAHKAN.nominal, -800_000, "pengurang bertanda negatif"); assert.equal(L.LUNAS_DISERAHKAN_BELUM_DIAKUI.nominal, -1_500_000); assert.equal(L.LUNAS_DISERAHKAN_BELUM_DIAKUI.temuan, true);
  assert.equal(L.LUNAS_DIAKUI_SEBELUM.nominal, -200_000); assert.equal(L.nilai_diakui.nominal, 1_000_000);
  assert.equal(L.ongkir.nominal, 50_000); assert.equal(L.bruto_A.nominal, 1_050_000);
  assert.equal(L.DIAKUI_LUNAS_LAIN.nominal, 2_000_000); assert.equal(L.DIAKUI_BELUM_LUNAS.nominal, 900_000);
  assert.equal(L.PEMBALIK_PENGAKUAN_LAMA.nominal, -600_000, "pembalik pengakuan lama (dibalik di periode ini)");
  assert.equal(L.bruto_order.nominal, 1_050_000 + 2_000_000 + 900_000 - 600_000);
  assert.equal(L.pkr.nominal, 3_000_000, "PKR terpisah dari order");
  assert.equal(L.retur.nominal, -100_000); assert.equal(L.bersih.nominal, 1_050_000 + 2_000_000 + 900_000 - 600_000 + 3_000_000 - 100_000);
  const ringkas = (await terinci(w.f)).body.ringkasan; assert.equal(L.bersih.nominal, ringkas.pendapatanBersih);
  // order rincian: kelas benar & tanggal
  const per = (n) => j.detailOrder.find((x) => x.nomor === n);
  assert.equal(per(h.D.o.orderNumber).kelas, "LUNAS_DISERAHKAN_BELUM_DIAKUI");
  assert.equal(per(h.C.o.orderNumber).kelas, "LUNAS_BELUM_DISERAHKAN");
  assert.equal(per(h.A.o.orderNumber).tanggalSerah, "2026-10-06"); assert.deepEqual(per(h.A.o.orderNumber).tanggalJurnal.includes("2026-10-06"), true);
  assert.ok(!j.detailOrder.some((x) => x.nomor === h.P.o.orderNumber), "order operasional PKR tidak dijumlahkan sebagai order biasa");
  // PKR tersendiri
  const pkr = (await terinci(w.f)).body.pkr;
  assert.equal(pkr.ringkasan.pendapatanLedger, 3_000_000); assert.equal(pkr.ringkasan.penjualanDokumen, 3_000_000); assert.equal(pkr.ringkasan.selisih, 0);
  assert.equal(pkr.dokumen[0].nomor, "PKR-10102026-001"); assert.equal(pkr.dokumen[0].statusPemenuhan, "BELUM_DISERAHKAN"); assert.equal(pkr.ringkasan.belumDiserahkan, 1);
});

test("HPP & PENANDA MUTU: BELUM_LENGKAP selama konsumsi bahan tak bernilai; estimasi & tak-terbukti terpisah dan TIDAK masuk laba; LENGKAP bila pemakaian bernilai", async () => {
  const w = await dunia(); await skenario(w);
  const d = (await terinci(w.f)).body;
  assert.equal(d.hpp.status, "BELUM_LENGKAP"); assert.equal(d.margin.pesan, "HPP bahan belum lengkap — margin belum final"); assert.equal(d.margin.final, false);
  assert.equal(d.hpp.konsumsiBahan.catatanPemakaianPeriode, 0);
  assert.ok(d.hpp.konsumsiBahan.unitTerkirim >= 3, "unit terkirim dari job selesai periode");
  assert.equal(d.hpp.tidakTerbukti.nominal, null, "biaya tak terbukti = null, bukan Rp0");
  assert.equal(d.hpp.estimasiInformatif.dimasukkanKeLaba, false); assert.equal(d.hpp.estimasiInformatif.periode, null);
  assert.equal(d.hpp.terbukukan.total, d.ringkasan.bebanPokok, "HPP terbukukan = beban pokok ledger (rumus tidak berubah)");
  assert.equal(d.hpp.terbukukan.pemakaianBahanTerbukukan, 0);

  // Dunia terpisah: satu unit terkirim dengan pemakaian bernilai + jurnal PEMAKAIAN_BAHAN → LENGKAP; estimasi tetap di luar laba
  await truncateAll();
  const w2 = await dunia();
  const o = await buatOrder(w2, { nilai: 500_000, bayar: 500_000, bayarTgl: "2026-10-05", serah: "2026-10-06", akui: "2026-10-06" });
  const mat = await testPrisma.material.create({ data: { code: "BHN-UJI", name: "Busa uji", unit: "PCS", referenceUnitCost: 40_000, category: "RAW_MATERIAL" } });
  const mov = await testPrisma.stockMovement.create({ data: { materialId: mat.id, type: "ISSUE", qty: -2, unitId: o.unitIds[0], createdAt: WIB("2026-10-05") } });
  await testPrisma.finStockMovementValuation.create({ data: { movementId: mov.id, materialId: mat.id, unitId: o.unitIds[0], movementType: "ISSUE", costKind: "PEMAKAIAN", qty: -2, status: "DINILAI", unitCostBasis: 35_000, value: 70_000, valuedAt: WIB("2026-10-05") } });
  const hpp = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BEBAN_POKOK_BAHAN } });
  const persed = await testPrisma.finAccount.findUnique({ where: { code: "1-1400" } });
  await testPrisma.$transaction((tx) => postJournal(tx, { date: D("2026-10-05"), description: "Pemakaian bahan uji", source: "PEMAKAIAN_BAHAN", sourceId: mov.id, userId: w2.admin.user.id, lines: [{ accountId: hpp.id, debit: 70_000 }, { accountId: persed.id, credit: 70_000 }] }));
  const l = (await terinci(w2.f)).body;
  assert.equal(l.hpp.status, "LENGKAP"); assert.equal(l.margin.final, true);
  assert.equal(l.hpp.terbukukan.pemakaianBahanTerbukukan, 70_000); assert.equal(l.ringkasan.bebanPokok, 70_000);
  assert.equal(l.hpp.estimasiInformatif.periode, 80_000, "estimasi = harga referensi 40.000 × 2 (informasi saja)"); assert.equal(l.hpp.estimasiInformatif.dimasukkanKeLaba, false);
  assert.equal(l.ringkasan.labaKotor, 500_000 - 70_000, "estimasi TIDAK ikut laba kotor");
});

test("BEBAN PER DIVISI: akun→divisi→dokumen→jurnal, konflik ditandai, belum teratribusi terpisah, Σ = ledger; data sensitif disamarkan untuk Finance non-admin", async () => {
  const w = await dunia(); await skenario(w);
  const d = (await terinci(w.f)).body; const bd = d.bebanDivisi;
  assert.equal(bd.totalDivisi, bd.totalLedger); assert.equal(bd.residual, 0);
  assert.equal(bd.totalLedger, d.ringkasan.bebanPokok + d.ringkasan.bebanOperasional);
  const div = (s) => bd.divisi.find((x) => x.scope === s);
  assert.equal(div("DELIVERY").operasional, 100_000); assert.equal(div("PRODUCTION").operasional, 70_000, "dokumen berdivisi Produksi mengikuti divisi eksplisit");
  assert.equal(div("PRODUCTION").bebanPokok, 250_000); assert.equal(div("SHARED").operasional, 400_000, "gaji UMUM → Biaya Bersama");
  assert.equal(bd.belumTeratribusi.nominal, 10_500, "jurnal manual tanpa dokumen"); assert.equal(bd.belumTeratribusi.jumlahBaris, 1);
  assert.equal(bd.konflik.jumlahBaris, 1); assert.equal(bd.konflik.nominal, 70_000);
  assert.deepEqual(bd.konflik.baris[0].kandidat.sort(), ["DELIVERY", "PRODUCTION"]); assert.equal(bd.konflik.baris[0].divisiTerpilih, "PRODUCTION");
  // drilldown beban: setiap baris punya divisi + dokumen
  const dd = (await w.f.get(`/api/finance/reports/income-statement/drilldown?${Q}&metrik=beban_operasional&divisi=DELIVERY`)).body;
  assert.equal(dd.jumlah, dd.baris.length); assert.ok(dd.baris.every((b) => b.divisi === "DELIVERY" && b.dokumen?.nomor));
  // sensitif: Finance non-admin tidak melihat uraian gaji; Admin melihat; nominal tetap sama
  const gajiF = (await w.f.get(`/api/finance/reports/income-statement/drilldown?${Q}&metrik=beban_operasional&akun=6-1100`)).body.baris[0];
  const gajiA = (await w.a.get(`/api/finance/reports/income-statement/drilldown?${Q}&metrik=beban_operasional&akun=6-1100`)).body.baris[0];
  assert.match(gajiF.deskripsi, /sensitif/); assert.doesNotMatch(JSON.stringify(gajiF), /rahasia/); assert.match(gajiA.deskripsi, /rahasia/); assert.equal(gajiF.nilai, gajiA.nilai);
});

test("GAP: delapan→daftar pemeriksaan; BELUM_BERHARGA dibedakan dari order operasional PKR Rp0; jumlah = banner; celah tanpa gap terdaftar terpisah", async () => {
  const w = await dunia(); const h = await skenario(w);
  const d = (await terinci(w.f)).body; const g = d.gap;
  assert.equal(g.jumlahTerbuka, 2); assert.equal(g.jumlahTerbuka, d.catatan.gapTerbuka); assert.ok(g.sesuaiBanner);
  const bb = g.daftar.find((x) => x.order.nomor === h.G.o.orderNumber); const pk = g.daftar.find((x) => x.order.nomor === h.P.o.orderNumber);
  assert.equal(bb.jenis, "BELUM_BERHARGA"); assert.equal(bb.akunSemestinya, "4-1100 Pendapatan Jasa Layanan"); assert.match(bb.tindakan, /harga/);
  assert.equal(pk.jenis, "PKR_OPERASIONAL_RP0"); assert.match(pk.dampak.pendapatan, /Tidak ada/);
  assert.deepEqual(g.ringkasanJenis.map((x) => x.jenis).sort(), ["BELUM_BERHARGA", "PKR_OPERASIONAL_RP0"]);
  assert.ok(g.tanpaGap.some((x) => x.nomor === h.D.o.orderNumber && x.jenis === "DISERAHKAN_BELUM_DIAKUI"), "order D diserahkan tak diakui, tanpa gap");
  assert.ok(!g.tanpaGap.some((x) => x.nomor === h.G.o.orderNumber), "order dengan gap resmi tidak terdaftar ganda");
});

test("EXPORT EXCEL = layar = ledger: ringkasan, Laba Rugi, jembatan, PKR, HPP, beban divisi, konflik, gap, rincian jurnal; cutoff & definisi; filter drilldown", async () => {
  const w = await dunia(); const h = await skenario(w);
  const d = (await terinci(w.f)).body;
  const x = await unduhExport(server.baseUrl, w.fin.token, "laporan-keuangan", { periode: { from: FROM, to: TO }, filter: { cutoffLayar: d.cutoff.diambilPadaWib } });
  assert.equal(x.status, 200, JSON.stringify(x.json));
  const nama = x.wb.worksheets.map((s) => s.name);
  for (const s of ["Ringkasan", "Laba Rugi", "Jembatan Pendapatan", "Rincian Order Jembatan", "PKR", "HPP", "Beban per Divisi", "Konflik Atribusi", "Gap Pembukuan", "Rincian Jurnal", "Definisi Angka"]) assert.ok(nama.includes(s), `sheet ${s}`);
  const ring = bacaSheet(x.wb, "Ringkasan");
  assert.match(String(ring.kepala.join(" ")), /Laporan Keuangan/);
  for (const k of d.kartu) assert.equal(ring.baris.find((b) => b.Uraian === k.label)["Nilai (Rp)"], k.nilai, `Excel ${k.label} = layar`);
  assert.ok(ring.baris.some((b) => /HPP bahan belum lengkap — margin belum final/.test(String(b.Uraian))), "penanda mutu tercetak");
  assert.ok(ring.baris.filter((b) => /^Kontrol:/.test(String(b.Uraian))).every((b) => b.Status === "OK" && b["Nilai (Rp)"] === 0), "kontrol parity OK di Excel");
  const cutoffTeks = JSON.stringify(ring); assert.match(cutoffTeks, /Cutoff pembacaan/);
  // Laba Rugi: Σ seksi = kartu
  const lr = bacaSheet(x.wb, "Laba Rugi").baris;
  const sum = (s) => lr.filter((r) => r.Seksi === s).reduce((a, r) => a + Number(r["Nilai (Rp)"]), 0);
  assert.equal(sum("Pendapatan") - sum("Retur & Potongan"), d.ringkasan.pendapatanBersih); assert.equal(sum("Beban Pokok"), d.ringkasan.bebanPokok); assert.equal(sum("Beban Operasional"), d.ringkasan.bebanOperasional);
  // Jembatan: nominal tiap langkah = layar; residual 0
  const jb = bacaSheet(x.wb, "Jembatan Pendapatan").baris;
  const bersihLabel = (t) => t.replace(/^[=+]\s+/, "");
  for (const l of d.jembatan.langkah) assert.equal(jb.find((b) => b.Langkah === (l.subtotal ? `Subtotal — ${bersihLabel(l.label)}` : bersihLabel(l.label)))?.["Nominal (Rp)"], l.nominal, l.label);
  assert.ok(jb.filter((b) => b.Bagian === "Kontrol").every((b) => b["Nominal (Rp)"] === 0));
  const ro = bacaSheet(x.wb, "Rincian Order Jembatan"); assert.equal(ro.baris.length, d.jembatan.detailOrder.length); assert.ok(ro.baris.some((b) => b["No. Order"] === h.D.o.orderNumber));
  assert.equal(bacaSheet(x.wb, "PKR").baris.filter((b) => /^PKR-/.test(String(b["No. PKR"]))).length, d.pkr.dokumen.length);
  const hpp = bacaSheet(x.wb, "HPP").baris; assert.ok(hpp.some((b) => /ESTIMASI INFORMATIF/.test(b.Kelompok)) && hpp.some((b) => /BELUM DAPAT DIBUKTIKAN/.test(b.Kelompok)));
  const dv = bacaSheet(x.wb, "Beban per Divisi"); assert.equal(dv.total["Nilai (Rp)"], d.bebanDivisi.totalDivisi); assert.equal(dv.total["Nilai (Rp)"], d.bebanDivisi.totalLedger);
  const kf = bacaSheet(x.wb, "Konflik Atribusi"); assert.equal(kf.baris.length, d.bebanDivisi.konflik.jumlahBaris); assert.equal(kf.total["Nilai (Rp)"], d.bebanDivisi.konflik.nominal);
  const gp = bacaSheet(x.wb, "Gap Pembukuan").baris; assert.equal(gp.filter((b) => b.Daftar === "Gap resmi").length, d.gap.jumlahTerbuka); assert.equal(gp.filter((b) => b.Daftar === "Tanpa gap (celah)").length, d.gap.tanpaGap.length);
  const rj = bacaSheet(x.wb, "Rincian Jurnal"); assert.equal(rj.baris.length, d.jumlahBaris); assert.equal(rj.total["Efek ke Laba Bersih (Rp)"], d.ringkasan.labaBersih, "Σ rincian jurnal = Laba Bersih kartu");
  assert.ok(bacaSheet(x.wb, "Definisi Angka").baris.some((b) => /Laba Kotor/.test(b.Angka)));
  // filter drilldown: HPP saja
  const f = await unduhExport(server.baseUrl, w.fin.token, "laporan-keuangan", { periode: { from: FROM, to: TO }, filter: { metrik: "hpp" } });
  const rjf = bacaSheet(f.wb, "Rincian Jurnal"); assert.equal(rjf.total["Kontribusi ke Beban Pokok (HPP) (Rp)"], d.ringkasan.bebanPokok); assert.ok(rjf.baris.every((b) => /^5-/.test(b.Akun)));
  const dd = (await w.f.get(`/api/finance/reports/income-statement/drilldown?${Q}&metrik=hpp`)).body; assert.equal(rjf.baris.length, dd.jumlah);
  // sensitif di Excel: Finance non-admin tersamar
  assert.doesNotMatch(JSON.stringify(bacaSheet(x.wb, "Rincian Jurnal").baris), /rahasia/);
});

test("IZIN & VALIDASI: tanpa login 401; Sales 403 di layar, drilldown, export; Finance & Admin boleh; periode/filter rusak ditolak", async () => {
  const w = await dunia(); await skenario(w);
  for (const p of [`/api/finance/reports/income-statement/terinci?${Q}`, `/api/finance/reports/income-statement/drilldown?${Q}&metrik=pendapatan`]) {
    assert.equal((await w.anon.get(p)).status, 401, p); assert.equal((await w.s.get(p)).status, 403, p); assert.equal((await w.f.get(p)).status, 200, p); assert.equal((await w.a.get(p)).status, 200, p);
  }
  assert.equal((await unduhExport(server.baseUrl, w.sales.token, "laporan-keuangan", { periode: { from: FROM, to: TO } })).status, 403);
  assert.equal((await unduhExport(server.baseUrl, null, "laporan-keuangan", { periode: { from: FROM, to: TO } })).status, 401);
  assert.equal((await unduhExport(server.baseUrl, w.admin.token, "laporan-keuangan", { periode: { from: "2026-02-31", to: TO } })).status, 400);
  assert.equal((await unduhExport(server.baseUrl, w.admin.token, "laporan-keuangan", { periode: { from: TO, to: FROM } })).status, 400);
  assert.equal((await unduhExport(server.baseUrl, w.admin.token, "laporan-keuangan", { periode: { from: FROM, to: TO }, filter: { akun: { $ne: 1 } } })).status, 400);
});

test("TANPA DATA: periode kosong → kartu nol, status TIDAK_BERLAKU, daftar kosong, kontrol OK, Excel tetap terbit; BACA-SAJA: tak ada tabel yang berubah", async () => {
  const w = await dunia();
  const sebelum = await rowsHash();
  const r = await terinci(w.f, "from=2026-01-01&to=2026-01-31"); assert.equal(r.status, 200);
  const d = r.body;
  assert.deepEqual(d.kartu.map((k) => k.nilai), [0, 0, 0, 0, 0]); assert.equal(d.hpp.status, "TIDAK_BERLAKU"); assert.equal(d.margin.final, false);
  assert.equal(d.jumlahBaris, 0); assert.equal(d.jembatan.detailOrder.length, 0); assert.ok(d.jembatan.residual.nol); assert.equal(d.pkr.dokumen.length, 0); assert.equal(d.gap.jumlahTerbuka, 0);
  assert.equal(d.bebanDivisi.divisi.length, 0); assert.ok(d.kontrol.semuaOk); assert.equal(d.ringkasan.marginKotor, null);
  const dd = (await w.f.get("/api/finance/reports/income-statement/drilldown?from=2026-01-01&to=2026-01-31&metrik=laba_bersih")).body; assert.equal(dd.jumlah, 0); assert.equal(dd.totalSemuaBaris, 0);
  const x = await unduhExport(server.baseUrl, w.fin.token, "laporan-keuangan", { periode: { from: "2026-01-01", to: "2026-01-31" } }); assert.equal(x.status, 200);
  assert.equal(bacaSheet(x.wb, "Rincian Jurnal").baris.length, 0);
  assert.equal(await rowsHash(), sebelum, "membaca laporan tidak mengubah data");
  // dunia berisi: seluruh endpoint + export tidak mengubah apa pun
  await skenario(w); const s2 = await rowsHash();
  await terinci(w.f); await w.f.get(`/api/finance/reports/income-statement/drilldown?${Q}&metrik=pendapatan`); await unduhExport(server.baseUrl, w.fin.token, "laporan-keuangan", { periode: { from: FROM, to: TO } });
  assert.equal(await rowsHash(), s2);
});
