// Riwayat referensi dari file: tampilan terpisah & berlabel jelas; tanggal pemakaian tidak pernah ditampilkan sebagai fakta; tidak ada jalur tulis ke ledger dari UI ini.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LABEL_REFERENSI, STATUS_REFERENSI, ANTREAN_REFERENSI, bolehImpor, teksJumlah, teksTanggal, teksSumber } from "../src/features/warehouse/riwayatReferensiLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");
const tab = baca("../src/features/warehouse/components/RiwayatReferensiTab.jsx");
const bahan = baca("../src/features/warehouse/components/RiwayatReferensiBahan.jsx");
const api = baca("../src/api.js");

test("label: bukan transaksi, bukan saldo, bukan bukti tanggal pemakaian", () => {
  assert.match(LABEL_REFERENSI, /bukan transaksi resmi/); assert.match(LABEL_REFERENSI, /bukan saldo/); assert.match(LABEL_REFERENSI, /bukan bukti tanggal pemakaian/);
  for (const [k, v] of Object.entries(STATUS_REFERENSI)) { assert.ok(v.label && v.arti && v.tone, k); }
  assert.match(STATUS_REFERENSI.PERLU_PEMERIKSAAN.arti, /BUKAN stok masuk/);
  assert.ok(ANTREAN_REFERENSI.SATUAN_BEDA && ANTREAN_REFERENSI.TANPA_PASANGAN && ANTREAN_REFERENSI.PEMETAAN_PERLU_KONFIRMASI);
});

test("teks tampil: jumlah apa adanya dengan satuan file; tanggal pemakaian selalu 'tidak ada bukti'", () => {
  assert.equal(teksJumlah({ jumlah: 3, satuanFile: "METER" }), "3 METER"); assert.equal(teksJumlah({ jumlah: null }), "tidak terbaca");
  const t = teksTanggal({ jenis: "PEMAKAIAN_ORDER", tanggalOrder: "2026-09-23" }); assert.match(t, /Tanggal order 2026-09-23/); assert.match(t, /Tanggal pemakaian: tidak ada bukti/);
  assert.match(teksTanggal({ jenis: "PENERIMAAN_TERBUKTI_TANPA_GR", tanggalKirim: "2026-10-06" }), /Tanggal kirim aktual 2026-10-06/);
  assert.equal(teksSumber({ sumberFile: "Pemakaian.csv", sumberBaris: [4, 9] }), "Pemakaian.csv · baris 4, 9");
});

test("hak: hanya peran penulis stok yang melihat tombol impor (server tetap memutuskan)", () => {
  assert.equal(bolehImpor(["WAREHOUSE"]), true); assert.equal(bolehImpor(["SALES"]), false); assert.equal(bolehImpor(["PRODUCTION_LEAD"]), false); assert.equal(bolehImpor(undefined), false);
});

test("UI: banner label, ringkasan, antrean, pratinjau sebelum simpan dengan hash; tidak memanggil API ledger/adjustment/GR", () => {
  assert.match(tab, /data-testid="label-referensi"/); assert.match(tab, /data-testid="ringkasan-referensi"/); assert.match(tab, /konfirmasiHash:\s*pv\.hashKonten/);
  assert.match(tab, /Simpan sebagai catatan referensi/); assert.match(tab, /Antrean penyelesaian/);
  for (const terlarang of ["receiveStock", "returnStock", "wasteStock", "adjustStock", "createAdjustmentRequest", "putaway", "createMaterialIssue", "postAdjustment"]) assert.ok(!tab.includes(terlarang) && !bahan.includes(terlarang), terlarang);
  assert.match(api, /imporRiwayatReferensi/); assert.match(api, /\/inventory\/riwayat-referensi\/impor/);
});

test("per bahan: bagian terpisah dari Movement History, berlabel referensi", () => {
  const drawer = baca("../src/features/warehouse/components/ItemDetailDrawer.jsx");
  assert.match(drawer, /<RiwayatReferensiBahan materialId=\{materialId\} \/>/);
  assert.ok(drawer.indexOf("Riwayat pergerakan") < drawer.indexOf("<RiwayatReferensiBahan"), "ditampilkan SESUDAH dan terpisah dari ledger");
  assert.match(bahan, /Riwayat referensi dari file \(bukan transaksi\)/); assert.match(bahan, /data-testid="riwayat-referensi-bahan"/);
});

test("cakupan & antrean jelas; bulan tanggal ORDER tidak diberi label pemakaian terbukti; T0 tidak menyaring", async () => {
  const { namaBulan, teksPerBulan, KETERANGAN_BULAN, TEKS_T0, teksDokumenResmi } = await import("../src/features/warehouse/riwayatReferensiLogic.js");
  assert.equal(namaBulan("2026-08"), "Agustus 2026"); assert.equal(teksPerBulan({ "2026-09": 12, "2026-08": 3, "2026-10": 5 }), "Agustus 2026: 3 · September 2026: 12 · Oktober 2026: 5");
  assert.match(KETERANGAN_BULAN, /TANGGAL ORDER/); assert.match(KETERANGAN_BULAN, /Bukan bukti kapan bahan dipakai/); assert.doesNotMatch(teksPerBulan({ "2026-10": 1 }), /pemakaian/i);
  assert.match(TEKS_T0, /tidak menyaring baris/); assert.match(TEKS_T0, /dokumen RESMI/);
  assert.match(teksDokumenResmi({ jenis: "ISSUE_DI_LEDGER", dokumen: ["MI-1"], setelahT0: true }), /SESUDAH T0/); assert.match(teksDokumenResmi({ jenis: "GOODS_RECEIPT", nomor: "GR-1", setelahT0: false }), /sebelum T0/);
  for (const id of ["kartu-cakupan", "kartu-antrean", "jumlah-antrean", "per-bulan-order", "kartu-t0", "antrean-pratinjau"]) assert.match(tab, new RegExp(`data-testid="${id}"`), id);
  assert.match(tab, /Setelah tanggal itu belum ada data/); assert.doesNotMatch(tab, /Dikecualikan karena T0/);
  assert.match(api, /segarkanRiwayatReferensi/);
});

test("tab BACA-SAJA: tidak ada pemanggilan POST /segarkan otomatis; snapshot hanya tombol manual berlabel dan berizin tulis", () => {
  const tab = fs.readFileSync(path.join(dir, "../src/features/warehouse/components/RiwayatReferensiTab.jsx"), "utf8").replace(/\r\n/g, "\n");
  const bahan = fs.readFileSync(path.join(dir, "../src/features/warehouse/components/RiwayatReferensiBahan.jsx"), "utf8");
  assert.equal((tab.match(/segarkanRiwayatReferensi\(/g) || []).length, 1, "hanya satu pemanggil");
  assert.ok(tab.indexOf("segarkanRiwayatReferensi(") > tab.indexOf("async function simpanSnapshot"), "pemanggil ada di dalam fungsi manual");
  for (const m of tab.matchAll(/useEffect\(/g)) assert.doesNotMatch(tab.slice(m.index, m.index + 400), /segarkan/, "tidak ada efek yang memanggil segarkan");
  assert.doesNotMatch(bahan, /segarkan/, "bagian per bahan murni baca");
  assert.match(tab, /window\.confirm\(/, "konfirmasi eksplisit sebelum menulis");
  assert.match(tab, /\{boleh && <Button[^>]*data-testid="btn-simpan-snapshot"/, "tombol hanya untuk pemegang izin tulis");
  assert.match(tab, /Simpan snapshot status \(manual\)/);
  assert.match(fs.readFileSync(path.join(dir, "../src/api.js"), "utf8"), /segarkan", \{ method: "POST", body: JSON\.stringify\(\{ konfirmasi: true \}\)/);
});

test("dua gerbang dipisah di UI: impor referensi ≠ mulai transaksi operasional", async () => {
  const { TEKS_GERBANG_IMPOR, TEKS_GERBANG_OPERASIONAL, TEKS_T0, TEKS_SEGARKAN } = await import("../src/features/warehouse/riwayatReferensiLogic.js");
  const tab = fs.readFileSync(path.join(dir, "../src/features/warehouse/components/RiwayatReferensiTab.jsx"), "utf8");
  for (const id of ["gerbang-terpisah", "gerbang-impor", "gerbang-operasional"]) assert.match(tab, new RegExp(`data-testid="${id}"`), id);
  assert.match(TEKS_GERBANG_IMPOR, /TIDAK menunggu T0/); assert.match(TEKS_GERBANG_IMPOR, /P1/); assert.match(TEKS_GERBANG_IMPOR, /keputusan GR/);
  assert.match(TEKS_GERBANG_OPERASIONAL, /T0 yang disepakati/); assert.match(TEKS_GERBANG_OPERASIONAL, /PER BAHAN\/DOKUMEN terkait saja/); assert.match(TEKS_GERBANG_OPERASIONAL, /bukan GR atau Material Issue bahan lain yang valid/); assert.match(TEKS_GERBANG_OPERASIONAL, /alur koreksi stok, bukan transaksi rutin/); assert.match(TEKS_GERBANG_OPERASIONAL, /independen dari GR/); assert.match(TEKS_GERBANG_OPERASIONAL, /GR \/ Material Issue baru/); assert.match(TEKS_GERBANG_OPERASIONAL, /Mengimpor catatan referensi tidak membuka gerbang ini/);
  assert.match(TEKS_T0, /BUKAN syarat impor/); assert.match(TEKS_SEGARKAN, /hanya MEMBACA/);
  assert.match(tab, /hanya peringatan, bukan syarat impor/, "label T0 pada panel impor");
  assert.doesNotMatch(tab, /disabled=\{[^}]*mulai/, "tombol impor tidak bergantung pada T0");
});
