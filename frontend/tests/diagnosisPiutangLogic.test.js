// Diagnosis Piutang (layar) — logika murni: rekonsiliasi per kategori, penyaringan, teks umur. Angka dihitung server; klien hanya menyaring.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { barisRekonsiliasi, saringDiagnosis, teksUmurPengakuan, URUTAN_KATEGORI, LABEL_POSISI_BUKU } from "../src/features/finance/diagnosisPiutangLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const KATEGORI = {
  TAGIHAN_SAH: { label: "Tagihan sah", tingkat: "tagih" }, LUNAS_TANPA_PAYMENT: { label: "Lunas di CRM, belum ada pembayaran", tingkat: "periksa" },
  PAYMENT_BELUM_MENUTUP: { label: "Pembayaran belum menutup piutang", tingkat: "periksa" }, NILAI_BEDA_PENGAKUAN: { label: "Nilai order berubah setelah diakui", tingkat: "koreksi" },
  KREDIT_LAINNYA: { label: "Saldo kredit", tingkat: "periksa" },
};
const data = (over = {}) => ({
  neraca: 33_550_000, kategori: KATEGORI,
  rekonsiliasi: { selisih: 0, perKategori: {
    TAGIHAN_SAH: { jumlah: 14, total: 13_940_000 }, LUNAS_TANPA_PAYMENT: { jumlah: 4, total: 14_460_000 }, PAYMENT_BELUM_MENUTUP: { jumlah: 1, total: 6_450_000 },
    NILAI_BEDA_PENGAKUAN: { jumlah: 4, total: -1_300_000 }, KREDIT_LAINNYA: { jumlah: 0, total: 0 },
  } },
  ...over,
});

test("rekonsiliasi: urutan tampil (tindakan dulu, tagihan sah terakhir), kategori kosong disembunyikan, total = neraca", () => {
  const r = barisRekonsiliasi(data());
  assert.deepEqual(r.baris.map((b) => b.kode), ["NILAI_BEDA_PENGAKUAN", "PAYMENT_BELUM_MENUTUP", "LUNAS_TANPA_PAYMENT", "TAGIHAN_SAH"]);
  assert.equal(r.total, 33_550_000);
  assert.equal(r.neraca, 33_550_000);
  assert.equal(r.cocok, true);
  assert.equal(r.baris[0].tingkat, "koreksi");
  assert.deepEqual(URUTAN_KATEGORI.at(-1), "TAGIHAN_SAH");
});

test("rekonsiliasi: ditandai TIDAK cocok bila server melaporkan selisih atau jumlahnya menyimpang dari neraca", () => {
  assert.equal(barisRekonsiliasi(data({ rekonsiliasi: { ...data().rekonsiliasi, selisih: 100 } })).cocok, false);
  assert.equal(barisRekonsiliasi(data({ neraca: 40_000_000 })).cocok, false);
  const kosong = barisRekonsiliasi(null);
  assert.deepEqual(kosong.baris, []);
  assert.equal(kosong.total, 0);
});

test("penyaringan: bawaan menyembunyikan tagihan sah; memilih kategori menampilkan kategori itu saja (termasuk tagihan sah)", () => {
  const baris = [
    { orderId: "1", kategori: "TAGIHAN_SAH" }, { orderId: "2", kategori: "LUNAS_TANPA_PAYMENT" }, { orderId: "3", kategori: "NILAI_BEDA_PENGAKUAN" },
  ];
  assert.deepEqual(saringDiagnosis(baris).map((b) => b.orderId), ["2", "3"]);
  assert.deepEqual(saringDiagnosis(baris, { hanyaTindakan: false }).map((b) => b.orderId), ["1", "2", "3"]);
  assert.deepEqual(saringDiagnosis(baris, { kategori: "TAGIHAN_SAH" }).map((b) => b.orderId), ["1"]);
  assert.deepEqual(saringDiagnosis(null), []);
});

test("teks umur pengakuan", () => {
  assert.equal(teksUmurPengakuan(0), "diakui hari ini");
  assert.equal(teksUmurPengakuan(12), "diakui 12 hari lalu");
  assert.equal(teksUmurPengakuan(null), null);
  assert.equal(teksUmurPengakuan(undefined), null);
});

test("layar memakai endpoint & komponen diagnosis (tidak menghitung saldo di klien)", () => {
  const api = fs.readFileSync(path.join(dir, "../src/api.js"), "utf8");
  assert.match(api, /getFinancePiutangDiagnosis[^\n]*receivables\/diagnosis/);
  const halaman = fs.readFileSync(path.join(dir, "../src/pages/finance/FinanceReceivables.jsx"), "utf8");
  assert.match(halaman, /<DiagnosisPiutang \/>/);
  const komponen = fs.readFileSync(path.join(dir, "../src/features/finance/DiagnosisPiutang.jsx"), "utf8");
  assert.doesNotMatch(komponen, /api\.(post|put|patch|delete|create|update)/i, "komponen ini hanya membaca");
});

test("keringanan lunas: setiap posisi buku dari server punya label & catatan; 'belum tercatat di buku' ditandai merah", () => {
  for (const k of ["BELUM_DI_BUKU", "SUDAH_DI_BUKU", "BELUM_DISERAHKAN", "DIAKUI_TANPA_SALDO"]) {
    assert.ok(LABEL_POSISI_BUKU[k]?.label && LABEL_POSISI_BUKU[k]?.catatan, k);
  }
  assert.equal(LABEL_POSISI_BUKU.BELUM_DI_BUKU.varian, "red");
});
