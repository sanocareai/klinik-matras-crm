// Modul Uang Muka Operasional — jaminan struktur UI. Aturan uang & jurnal diuji di
// backend/tests/integration/financeUangMuka.integration.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "latin1");

test("Halaman Finance memuat lima bagian: Berikan Uang Muka, Saldo Aktif, Pertanggungjawaban, Pengembalian, Riwayat", () => {
  const src = baca("pages/finance/FinanceUangMuka.jsx");
  for (const teks of ["Berikan Uang Muka", "Saldo Aktif", "Pertanggungjawaban", "Pengembalian", "Riwayat"]) {
    assert.ok(src.includes(teks), `teks "${teks}" harus ada`);
  }
  for (const status of ["AKTIF", "SEBAGIAN", "SELESAI", "DIBATALKAN"]) {
    assert.ok(src.includes(status) || baca("features/finance/shared.jsx").includes(status), `status ${status}`);
  }
});

test("Berikan uang muka memakai pilihan metode transfer (biaya admin) dan tenggat wajib; tanpa langkah /pay untuk pertanggungjawaban", () => {
  const src = baca("pages/finance/FinanceUangMuka.jsx");
  assert.match(src, /<CaraBayarTransfer\b/);
  assert.match(src, /denganBiaya\(f\)/);
  assert.match(src, /Tenggat pertanggungjawaban/);
  assert.ok(!/payFinanceExpense|Catat Pembayaran/.test(src), "pertanggungjawaban tidak boleh punya langkah Bayar");
  assert.match(src, /tanpa uang keluar lagi/i);
});

test("Saldo, tenggat lewat, dan angka turunan dibaca dari server — tidak dihitung di klien", () => {
  const src = baca("pages/finance/FinanceUangMuka.jsx");
  assert.match(src, /u\.saldo/);
  assert.match(src, /u\.lewatTempo/);
  assert.ok(!/amount\s*-\s*u\.dipertanggungjawabkan|u\.amount\s*-\s*u\.dikembalikan/.test(src), "saldo tidak boleh dihitung ulang di klien");
});

test("Pembatalan lewat alasan wajib (reversal resmi)", () => {
  const src = baca("pages/finance/FinanceUangMuka.jsx");
  assert.match(src, /Alasan membatalkan/);
  assert.match(src, /reversal/i);
});

test("Rute, menu sidebar, dan API terdaftar", () => {
  assert.match(baca("routes/pageRegistry.jsx"), /path: "\/finance\/uang-muka"/);
  assert.match(baca("components/Layout.jsx"), /to: "\/finance\/uang-muka"[^}]*Uang Muka Operasional/);
  const api = baca("api.js");
  for (const fn of ["getUangMuka", "berikanUangMuka", "pertanggungjawabanUangMuka", "kembalikanUangMuka", "batalkanUangMuka", "getUangMukaAktifPengajuan"]) {
    assert.ok(api.includes(`${fn}:`), fn);
  }
});

test("Pengajuan Biaya: sumber Uang muka operasional WAJIB memilih uang muka aktif; tanda Perlu Ditinjau untuk data lama", () => {
  const src = baca("pages/armada/ArmadaPengajuanBiaya.jsx");
  assert.match(src, /getUangMukaAktifPengajuan\(/);
  assert.match(src, /Pilih uang muka aktif milik pengaju atau PIC/);
  assert.match(src, /advanceId: pakaiUangMuka/);
  assert.match(src, /Perlu Ditinjau/);
  assert.match(src, /needsReview/);
});

test("Pilihan (select) tidak memotong huruf turun di mobile", () => {
  const src = baca("features/finance/shared.jsx");
  assert.match(src, /leading-normal[^"]*max-sm:h-11/);
});
