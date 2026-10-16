// Uji murni logika pratinjau opname (tanpa DB). Setiap kasus = satu aturan runbook cutover persediaan.
import test from "node:test";
import assert from "node:assert/strict";
import { hitungPreview, normalisasiBaris, normalisasiLog, KOLOM_HITUNG, KOLOM_LOG, KELAS } from "../src/services/opnameCutover.js";

const M = { id: "m1", code: "KAIN-A", name: "Kain A", unit: "METER", active: true };
const M2 = { id: "m2", code: "BUSA-B", name: "Busa B", unit: "SHEET", active: true };
const T = (s) => new Date(`2026-10-31T${s}:00+07:00`);
const mv = (id, materialId, qty, at, extra = {}) => ({ id, materialId, type: qty > 0 ? "RECEIPT" : "ISSUE", qty, createdAt: at, note: extra.note || null, dokumenId: extra.dok === undefined ? "d" : extra.dok, tanpaDokumen: extra.dok === null });
const dasar = () => ({
  [KOLOM_HITUNG.materialId]: "m1", [KOLOM_HITUNG.kode]: "KAIN-A", [KOLOM_HITUNG.satuan]: "METER", [KOLOM_HITUNG.lokasi]: "RAW-MATERIAL",
  [KOLOM_HITUNG.status]: "DIHITUNG", [KOLOM_HITUNG.qtyRak]: 100, [KOLOM_HITUNG.mulai]: "2026-10-31 08:00", [KOLOM_HITUNG.selesai]: "2026-10-31 09:00",
  [KOLOM_HITUNG.penghitung]: "Andi", [KOLOM_HITUNG.pemeriksa]: "Budi", [KOLOM_HITUNG.bukti]: "FOTO-001",
});
const row = (o = {}, n = 10) => normalisasiBaris({ ...dasar(), ...o }, n);
const prev = (baris, ledgerMap, extra = {}) => hitungPreview({ materials: [M, M2], baris, ledger: new Map(Object.entries(ledgerMap)), ...extra });
const kode = (m) => m.isu.map((i) => i.kode);

test("kolom kosong BUKAN nol: DIHITUNG tanpa angka diblokir; angka 0 harus berstatus NOL_FISIK", () => {
  const p = prev([row({ [KOLOM_HITUNG.qtyRak]: "" })], { m1: [mv("a", "m1", 100, T("07:00"))] });
  assert.ok(kode(p.materials[0]).includes("KOSONG_BUKAN_NOL"));
  assert.equal(p.materials[0].statusAkhir, KELAS.PERLU_HITUNG_ULANG);
  const p0 = prev([row({ [KOLOM_HITUNG.qtyRak]: 0 })], { m1: [mv("a", "m1", 100, T("07:00"))] });
  assert.ok(kode(p0.materials[0]).includes("NOL_HARUS_EKSPLISIT"));
});

test("NOL_FISIK eksplisit: wajib bukti; ledger positif → kelas NOL_FISIK_LEDGER_POSITIF dengan selisih negatif penuh", () => {
  const tanpaBukti = prev([row({ [KOLOM_HITUNG.status]: "NOL_FISIK", [KOLOM_HITUNG.qtyRak]: 0, [KOLOM_HITUNG.bukti]: "" })], { m1: [mv("a", "m1", 40, T("07:00"))] });
  assert.ok(kode(tanpaBukti.materials[0]).includes("NOL_TANPA_BUKTI"));
  const ok = prev([row({ [KOLOM_HITUNG.status]: "NOL_FISIK", [KOLOM_HITUNG.qtyRak]: 0 })], { m1: [mv("a", "m1", 40, T("07:00"))] });
  assert.equal(ok.materials[0].kelas, KELAS.NOL_FISIK_LEDGER_POSITIF);
  assert.equal(ok.materials[0].delta, -40);
  assert.equal(ok.materials[0].statusAkhir, KELAS.NOL_FISIK_LEDGER_POSITIF);
});

test("selisih memakai ledger PADA WAKTU HITUNG, bukan saldo hari ini: penerimaan setelah hitung tidak menghapus selisih nol", () => {
  const p = prev([row()], { m1: [mv("a", "m1", 100, T("07:00")), mv("g", "m1", 50, T("14:00"))] }, { cutoff: T("23:59") });
  const m = p.materials[0];
  assert.equal(m.ledgerSaatHitung, 100); assert.equal(m.delta, 0); assert.equal(m.kelas, KELAS.SESUAI);
  assert.equal(m.ledgerCutoff, 150); assert.equal(m.fisikProyeksiCutoff, 150); assert.equal(m.adjustmentCutoffDiperlukan, 0);
});

test("pergerakan di jendela hitung wajib masuk log; YA/TIDAK menentukan ledger pembanding", () => {
  const ledger = { m1: [mv("a", "m1", 100, T("07:00")), mv("i", "m1", -10, T("08:30"), { note: "Issue MI-311026-01" })] };
  const tanpaLog = prev([row({ [KOLOM_HITUNG.qtyRak]: 100 })], ledger);
  assert.ok(kode(tanpaLog.materials[0]).includes("PERGERAKAN_JENDELA_TAK_TERCATAT"));
  const log = (t) => normalisasiLog([{ [KOLOM_LOG.dokumen]: "MI-311026-01", [KOLOM_LOG.kode]: "KAIN-A", [KOLOM_LOG.qty]: -10, [KOLOM_LOG.waktu]: "2026-10-31 08:30", [KOLOM_LOG.tercermin]: t }]);
  const tidak = prev([row({ [KOLOM_HITUNG.qtyRak]: 100 })], ledger, { logJendela: log("TIDAK") });
  assert.equal(tidak.materials[0].ledgerSaatHitung, 100); assert.equal(tidak.materials[0].delta, 0);
  const ya = prev([row({ [KOLOM_HITUNG.qtyRak]: 90 })], ledger, { logJendela: log("YA") });
  assert.equal(ya.materials[0].ledgerSaatHitung, 90); assert.equal(ya.materials[0].delta, 0);
  const kosongKeputusan = prev([row()], ledger, { logJendela: log("") });
  assert.ok(kode(kosongKeputusan.materials[0]).includes("LOG_TANPA_KEPUTUSAN"));
});

test("GR tertunda, perjalanan, sisa produksi, dan milik customer TIDAK masuk jumlah fisik; mismatch dokumen diperingatkan", () => {
  const b = row({ [KOLOM_HITUNG.qtyRak]: 80, [KOLOM_HITUNG.qtyGrFisik]: 30, [KOLOM_HITUNG.qtyPerjalanan]: 12, [KOLOM_HITUNG.qtyProduksi]: 5, [KOLOM_HITUNG.qtyCustomer]: 7 });
  const p = prev([b], { m1: [mv("a", "m1", 80, T("07:00"))] }, { pending: [{ jenis: "GR_TERTUNDA", dok: "GR-1", materialCode: "KAIN-A", qty: 40 }] });
  const m = p.materials[0];
  assert.equal(m.fisikMilikSano, 80); assert.equal(m.delta, 0);
  assert.deepEqual(m.dikecualikan, { grFisikBelumDiposting: 30, dalamPerjalanan: 12, sisaDiProduksi: 5, milikCustomer: 7 });
  assert.ok(kode(m).includes("GR_FISIK_BEDA_DOKUMEN"));
  assert.equal(m.statusAkhir, KELAS.SESUAI, "peringatan tidak memblokir");
});

test("staging Issue dihitung sebagai fisik milik SANO (ledger belum dikurangi) dan dipisah kolomnya", () => {
  const b = row({ [KOLOM_HITUNG.qtyRak]: 70, [KOLOM_HITUNG.qtyStaging]: 30 });
  const p = prev([b], { m1: [mv("a", "m1", 100, T("07:00"))] }, { pending: [{ jenis: "ISSUE_TERTUNDA", dok: "MI-1", materialCode: "KAIN-A", qty: 30 }] });
  assert.equal(p.materials[0].fisikMilikSano, 100); assert.equal(p.materials[0].delta, 0);
  assert.ok(!kode(p.materials[0]).includes("STAGING_TANPA_ISSUE"));
});

test("penghitung ≠ pemeriksa, waktu lengkap, lokasi wajib; satuan harus sama dengan master", () => {
  const p = prev([row({ [KOLOM_HITUNG.pemeriksa]: "andi", [KOLOM_HITUNG.selesai]: "", [KOLOM_HITUNG.satuan]: "KG", [KOLOM_HITUNG.lokasi]: "" })], { m1: [mv("a", "m1", 100, T("07:00"))] });
  const k = kode(p.materials[0]);
  for (const x of ["PEMERIKSA_SAMA_DENGAN_PENGHITUNG", "WAKTU_TIDAK_LENGKAP", "SATUAN_BEDA", "LOKASI_KOSONG"]) assert.ok(k.includes(x), x);
});

test("nilai: tanpa harga Finance = NILAI_BELUM_DITETAPKAN (sheet/referensi master tidak dipakai); harga sah menghitung nilai terpisah", () => {
  const baris = [row({ [KOLOM_HITUNG.qtyRak]: 90 })];
  const ledger = { m1: [mv("a", "m1", 100, T("07:00"))] };
  const tanpa = prev(baris, ledger);
  assert.equal(tanpa.materials[0].nilai.status, "NILAI_BELUM_DITETAPKAN");
  assert.ok(kode(tanpa.materials[0]).includes("STOK_TANPA_HARGA_FINANCE"));
  const hargaOk = new Map([["KAIN-A", { unitCost: 25000, sumber: "FAKTUR", referensi: "INV-77", catatan: "" }]]);
  const ada = prev(baris, ledger, { hargaFinance: hargaOk, saldoBuku1400: 1_000_000 });
  assert.equal(ada.materials[0].nilai.nilaiSelisih, -250000);
  assert.equal(ada.rekonNilai.nilaiFisikDitetapkan, 2_250_000);
  assert.equal(ada.rekonNilai.penyesuaianJurnalPersediaanAwal, 1_250_000);
  const tanpaDok = prev(baris, ledger, { hargaFinance: new Map([["KAIN-A", { unitCost: 25000, sumber: "FAKTUR", referensi: "", catatan: "" }]]) });
  assert.equal(tanpaDok.materials[0].nilai.status, "HARGA_TIDAK_VALID");
});

test("naik dan turun dijumlah terpisah; material tanpa baris masuk 'tidak dihitung'", () => {
  const b1 = row({ [KOLOM_HITUNG.qtyRak]: 110 });
  const b2 = row({ [KOLOM_HITUNG.materialId]: "m2", [KOLOM_HITUNG.kode]: "BUSA-B", [KOLOM_HITUNG.satuan]: "SHEET", [KOLOM_HITUNG.qtyRak]: 15 }, 11);
  const ledger = { m1: [mv("a", "m1", 100, T("07:00"))], m2: [mv("b", "m2", 20, T("07:00"))] };
  const p = prev([b1, b2], ledger);
  assert.equal(p.ringkasan.selisihQtyNaik, 10); assert.equal(p.ringkasan.selisihQtyTurun, -5);
  const hanyaSatu = prev([b1], ledger);
  assert.equal(hanyaSatu.tidakDihitung.length, 1); assert.equal(hanyaSatu.tidakDihitung[0].kode, "BUSA-B"); assert.equal(hanyaSatu.tidakDihitung[0].perlu, true);
  assert.equal(hanyaSatu.dryRun, true);
});

test("ledger negatif saat hitung ditandai LEDGER_NEGATIF; selisih = fisik − ledger (menaikkan ke angka fisik)", () => {
  const p = prev([row({ [KOLOM_HITUNG.qtyRak]: 12 })], { m1: [mv("a", "m1", -5, T("07:00"))] });
  assert.equal(p.materials[0].kelas, KELAS.LEDGER_NEGATIF); assert.equal(p.materials[0].delta, 17);
});

test("belum dihitung tetap BELUM_DIHITUNG (bukan nol) dan tidak punya selisih", () => {
  const p = prev([normalisasiBaris({ [KOLOM_HITUNG.materialId]: "m1", [KOLOM_HITUNG.kode]: "KAIN-A" }, 5)], { m1: [mv("a", "m1", 100, T("07:00"))] });
  assert.equal(p.materials[0].kelas, KELAS.BELUM_DIHITUNG); assert.equal(p.materials[0].fisikMilikSano, null); assert.equal(p.materials[0].delta, undefined);
  assert.equal(p.ringkasan.belumDihitung, 1);
});

test("jalur cepat (pergerakan tanpa dokumen) setelah hitung dilaporkan; cut-off sebelum selesai hitung diblokir", () => {
  const ledger = { m1: [mv("a", "m1", 100, T("07:00")), mv("q", "m1", 5, T("15:00"), { dok: null })] };
  const p = prev([row()], ledger, { cutoff: T("23:59") });
  assert.equal(p.materials[0].pergerakanJalurCepat.length, 1);
  const awal = prev([row()], ledger, { cutoff: T("08:00") });
  assert.ok(kode(awal.materials[0]).includes("CUTOFF_SEBELUM_SELESAI"));
});

import { gabungStockCount } from "../src/services/opnameCutover.js";
test("gabungStockCount: angka & waktu dari Stock Count; lembar tidak ditimpa; konflik → BLOCKER; baris baru tanpa metadata tidak ditebak", () => {
  const count = { startedAt: new Date("2026-10-31T01:00:00Z"), submittedAt: new Date("2026-10-31T03:00:00Z"), lines: [
    { id: "l1", materialId: "m1", countedQty: 18, material: { code: "KAIN-A", unit: "METER" } },
    { id: "l2", materialId: "m2", countedQty: 0, material: { code: "BUSA-B", unit: "SHEET" } },
    { id: "l3", materialId: "m3", countedQty: null, material: { code: "X", unit: "PCS" } },
  ] };
  const selesai = new Map([["l1", new Date("2026-10-31T02:00:00Z")]]);
  const lembarKosong = row({ [KOLOM_HITUNG.qtyRak]: "", [KOLOM_HITUNG.status]: "", [KOLOM_HITUNG.mulai]: "", [KOLOM_HITUNG.selesai]: "" });
  const hasil = gabungStockCount([lembarKosong], { count, selesaiPerLine: selesai });
  assert.equal(hasil[0].qtyRak, 18); assert.equal(hasil[0].status, "DIHITUNG"); assert.equal(+hasil[0].selesai, +selesai.get("l1")); assert.equal(+hasil[0].mulai, +count.startedAt);
  assert.equal(hasil[0].pemeriksa, "Budi", "metadata lembar dipertahankan");
  const baru = hasil.find((b) => b.materialId === "m2");
  assert.equal(baru.status, "NOL_FISIK"); assert.equal(baru.qtyRak, 0); assert.equal(baru.lokasi, ""); assert.equal(baru.penghitung, ""); assert.equal(baru.pemeriksa, "");
  assert.ok(!hasil.some((b) => b.materialId === "m3"), "baris yang belum diisi tidak dibuat");
  const konflik = gabungStockCount([row({ [KOLOM_HITUNG.qtyRak]: 20 })], { count, selesaiPerLine: selesai });
  assert.equal(konflik[0].qtyRak, 20, "tidak ditimpa"); assert.deepEqual(konflik[0].konflikStockCount, { lembar: 20, sistem: 18 });
  const p = prev([konflik[0]], { m1: [mv("a", "m1", 20, T("07:00"))] });
  assert.ok(kode(p.materials[0]).includes("HITUNG_BEDA_STOCK_COUNT"));
});
