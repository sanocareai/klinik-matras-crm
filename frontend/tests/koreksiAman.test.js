// Edit & Koreksi Transaksi Aman — jaminan sisi layar. Aturan uang & jurnal dijaga backend
// (backend/tests/integration/financeKoreksiAman.integration.test.js); di sini yang dikunci:
// alur dua langkah (pratinjau server -> PIN -> simpan), token PIN tidak pernah disimpan di storage,
// dan semua dokumen berjurnal memakai menu aksi yang ada (bukan tombol tambahan di tabel).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");

const koreksi = baca("features/finance/KoreksiAman.jsx");
const edit = baca("features/finance/EditDokumen.jsx");
const api = baca("api.js");

test("Token step-up PIN hanya di memori — tidak ke localStorage/sessionStorage", () => {
  assert.ok(!/localStorage|sessionStorage/.test(koreksi));
  assert.match(koreksi, /let tokenStepUp = null/);
});

test("API: header X-Finance-Stepup dikirim untuk koreksi, dan kode galat server ikut terbawa ke UI", () => {
  assert.match(api, /"X-Finance-Stepup": stepUp/);
  assert.match(api, /code = j\.code/);
  assert.match(api, /status: res\.status, code/);
});

test("Koreksi berjurnal = pratinjau server dulu (preview:true), lalu simpan lewat PIN", () => {
  assert.match(edit, /preview: true/);
  assert.match(edit, /kirimKoreksi\(/);
  assert.match(edit, /PratinjauKoreksi/);
  assert.match(koreksi, /preview: true/);
  // Tidak ada kalkulasi jurnal di klien: tombol simpan hanya aktif kalau server bilang jurnal pengganti seimbang.
  assert.match(edit, /!pratinjau\.seimbang/);
  assert.match(koreksi, /!pratinjau\.seimbang/);
});

test("Kode STEPUP_* dikenali sehingga PIN diminta ulang sekali bila token kedaluwarsa", () => {
  assert.match(koreksi, /STEPUP_DIPERLUKAN/);
  assert.match(koreksi, /STEPUP_PIN_BELUM_DIATUR/);
  assert.match(koreksi, /percobaan === 0/);
});

test("Label tombol: Edit untuk yang belum berjurnal, Koreksi untuk yang sudah — lewat menu aksi", () => {
  for (const f of ["pages/finance/FinanceExpenses.jsx", "pages/finance/FinancePurchases.jsx"]) {
    const s = baca(f);
    assert.match(s, /"Koreksi"/);
    assert.match(s, /Riwayat perubahan/);
    assert.match(s, /RiwayatVersiDialog/);
  }
});

test("Transfer & Pemasukan Lain punya Koreksi, Riwayat, Batalkan di menu titik-tiga (tanpa tombol tambahan di tabel)", () => {
  const s = baca("pages/finance/FinanceCash.jsx");
  assert.match(s, /KoreksiDialog/);
  assert.match(s, /jenis="transfers"/);
  assert.match(s, /jenis="other-income"/);
  assert.match(s, /<RowActions \{\.\.\.menuTransfer\(t\)\} \/>/);
  assert.match(s, /<RowActions \{\.\.\.menuPemasukan\(i\)\} \/>/);
});

test("Refund, Tagihan supplier, Uang Muka: aksi Edit/Batalkan/Riwayat sesuai status jurnal", () => {
  const rf = baca("pages/finance/FinanceReceivables.jsx");
  assert.match(rf, /editFinanceRefund/);
  assert.match(rf, /cancelFinanceRefund/);
  const sp = baca("pages/finance/FinanceSuppliers.jsx");
  assert.match(sp, /editFinanceBill/);
  assert.match(sp, /cancelFinanceBill/);
  const um = baca("pages/finance/FinanceUangMuka.jsx");
  assert.match(um, /editUangMuka/);
  // Uang muka: angka tidak bisa dikoreksi — pengguna diarahkan Batalkan lalu catat ulang.
  assert.match(um, /Batalkan lalu catat ulang/);
});

test("PIN Finance bisa diatur di Pengaturan Finance", () => {
  assert.match(baca("pages/finance/FinanceSettings.jsx"), /KartuPinFinance/);
});

test("Semua teks pengguna berbahasa Indonesia (tidak ada label tombol Inggris umum)", () => {
  for (const s of [koreksi, edit]) {
    assert.ok(!/>\s*(Save|Cancel|Confirm|Submit|Preview|History)\s*</.test(s));
  }
});
