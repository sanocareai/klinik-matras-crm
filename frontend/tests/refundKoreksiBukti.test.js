// Koreksi Refund — bukti transfer + biaya admin: logika murni + pemasangan layar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAKS_BYTE, formatUkuran, periksaBerkas, jumlahBuktiPengganti, kesiapanBukti, modeBawaan, nilaiAwalRefund, adaPerubahanRefund, bodyKoreksiRefund, ringkasUangRefund, MODE_BUKTI,
  KALIMAT_LAMPIR, kesiapanLampir, bodyLampirBukti, bisaLampirBukti,
} from "../src/features/finance/refundKoreksiLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

const REFUND = { id: "r1", amount: "200000.00", date: "2026-09-22T00:00:00.000Z", cashAccountId: "bank1", paymentMethod: "TRANSFER", transferFeeType: "BI_FAST", transferFeeAmount: "2500.00", transferReference: "TRF-1" };

test("berkas: JPG/PNG/WEBP/PDF ≤ 8 MB diterima; tipe lain, kosong, dan >8 MB ditolak dengan pesan Indonesia", () => {
  const f = (name, type, size) => ({ name, type, size });
  for (const [n, t] of [["a.jpg", "image/jpeg"], ["b.png", "image/png"], ["c.webp", "image/webp"], ["d.pdf", "application/pdf"]]) assert.equal(periksaBerkas(f(n, t, 1000)).ok, true, n);
  assert.equal(periksaBerkas(f("tempel", "", 1000)).ok, false, "tanpa tipe & tanpa ekstensi dikenal");
  assert.equal(periksaBerkas(f("x.pdf", "", 1000)).ok, true, "tipe kosong tapi ekstensi dikenal");
  const besar = periksaBerkas(f("besar.jpg", "image/jpeg", MAKS_BYTE + 1));
  assert.equal(besar.ok, false); assert.match(besar.pesan, /melebihi batas 8 MB/);
  assert.match(periksaBerkas(f("evil.exe", "application/x-msdownload", 10)).pesan, /Jenis berkas tidak diizinkan/);
  assert.equal(periksaBerkas(f("kosong.jpg", "image/jpeg", 0)).pesan, "Berkas kosong");
  assert.equal(periksaBerkas(null).ok, false);
  assert.equal(formatUkuran(8 * 1024 * 1024), "8,0 MB"); assert.equal(formatUkuran(2048), "2 KB"); assert.equal(formatUkuran(12), "12 B");
});

test("kesiapan bukti: pengganti wajib ≥1 bukti; tambah/ganti wajib bukti baru; unggahan berjalan menahan; refund lama tanpa bukti tidak bisa 'gunakan lama'", () => {
  assert.equal(modeBawaan(2), "LAMA"); assert.equal(modeBawaan(0), "GANTI");
  assert.deepEqual(MODE_BUKTI.map((m) => m.kode), ["LAMA", "TAMBAH", "GANTI"]);
  assert.equal(kesiapanBukti({ jumlahLama: 1, mode: "LAMA", jumlahBaru: 0 }).siap, true);
  assert.equal(kesiapanBukti({ jumlahLama: 0, mode: "LAMA", jumlahBaru: 0 }).siap, false);
  assert.match(kesiapanBukti({ jumlahLama: 0, mode: "LAMA", jumlahBaru: 0 }).pesan, /minimal satu bukti/);
  assert.equal(kesiapanBukti({ jumlahLama: 1, mode: "GANTI", jumlahBaru: 0 }).siap, false);
  assert.equal(kesiapanBukti({ jumlahLama: 1, mode: "TAMBAH", jumlahBaru: 0 }).siap, false);
  assert.equal(kesiapanBukti({ jumlahLama: 0, mode: "GANTI", jumlahBaru: 1 }).siap, true);
  assert.equal(kesiapanBukti({ jumlahLama: 1, mode: "TAMBAH", jumlahBaru: 1, sedangUnggah: true }).siap, false);
  assert.equal(kesiapanBukti({ jumlahLama: 8, mode: "TAMBAH", jumlahBaru: 3 }).siap, false, "maksimal 10 bukti");
  assert.deepEqual([jumlahBuktiPengganti({ jumlahLama: 2, mode: "LAMA", jumlahBaru: 0 }), jumlahBuktiPengganti({ jumlahLama: 2, mode: "TAMBAH", jumlahBaru: 1 }), jumlahBuktiPengganti({ jumlahLama: 2, mode: "GANTI", jumlahBaru: 1 })], [2, 3, 1]);
});

test("body koreksi: hanya kolom yang berubah + bukti + revisi optimistis + alasan; biaya admin disusun lewat bodyBiayaTransfer (preset dari server, custom bernominal)", () => {
  const awal = nilaiAwalRefund(REFUND);
  assert.deepEqual([awal.amount, awal.date, awal.paymentMethod, awal.transferFeeType, awal.transferFeeAmount], [200000, "2026-09-22", "TRANSFER", "BI_FAST", ""]);
  assert.equal(adaPerubahanRefund(awal, { ...awal }), false);
  assert.equal(adaPerubahanRefund(awal, { ...awal, transferReference: "TRF-2" }), true);
  const rev = "2026-09-22T05:00:00.000Z";
  const hanyaFee = bodyKoreksiRefund({ awal, form: { ...awal, transferFeeType: "LAINNYA", transferFeeAmount: 5000 }, alasan: " naik ", mode: "LAMA", expectedUpdatedAt: rev });
  assert.deepEqual(hanyaFee, { reason: "naik", bukti: { mode: "LAMA", ids: [] }, expectedUpdatedAt: rev, paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: 5000 });
  const semua = bodyKoreksiRefund({ awal, form: { ...awal, amount: 250000, date: "2026-09-25", cashAccountId: "bank2", transferReference: " TRF-9 " }, alasan: "x", mode: "TAMBAH", idsBaru: ["u1", "u2"], expectedUpdatedAt: rev, konfirmasiBiayaGanda: true, preview: true });
  assert.equal(semua.amount, 250000); assert.equal(semua.date, "2026-09-25"); assert.equal(semua.cashAccountId, "bank2");
  assert.equal(semua.paymentMethod, "TRANSFER", "ganti rekening → biaya dihitung ulang server (tipe tetap dikirim)"); assert.equal(semua.transferFeeType, "BI_FAST"); assert.equal("transferFeeAmount" in semua, false, "preset: nominal TIDAK dikirim");
  assert.equal(semua.transferReference, "TRF-9"); assert.deepEqual(semua.bukti, { mode: "TAMBAH", ids: ["u1", "u2"] }); assert.equal(semua.konfirmasiBiayaGanda, true); assert.equal(semua.preview, true);
  assert.deepEqual(bodyKoreksiRefund({ awal, form: { ...awal, amount: 1 }, alasan: "x", mode: "LAMA", idsBaru: ["u1"], expectedUpdatedAt: rev }).bukti, { mode: "LAMA", ids: [] }, "mode lama tidak membawa id");
  assert.equal("konfirmasiBiayaGanda" in bodyKoreksiRefund({ awal, form: { ...awal, amount: 1 }, alasan: "x", mode: "LAMA", expectedUpdatedAt: rev }), false);
  // refund Tunai lama → pindah ke Transfer BI-FAST
  const tunai = nilaiAwalRefund({ ...REFUND, paymentMethod: "TUNAI", transferFeeType: null, transferFeeAmount: "0.00" });
  assert.deepEqual(bodyKoreksiRefund({ awal: tunai, form: { ...tunai, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" }, alasan: "x", mode: "LAMA", expectedUpdatedAt: rev }).transferFeeType, "BI_FAST");
});

test("ringkasan uang: biaya admin TIDAK ikut nominal pelanggan; total keluar = nominal + biaya", () => {
  assert.deepEqual(ringkasUangRefund({ nominal: 200000, biayaAdmin: 2500 }), { nominalRefund: 200000, biayaAdmin: 2500, totalKeluar: 202500 });
  assert.deepEqual(ringkasUangRefund({ nominal: "200000", biayaAdmin: "" }), { nominalRefund: 200000, biayaAdmin: 0, totalKeluar: 200000 });
});

test("pemasangan: layar Piutang memakai dialog baru untuk refund; api punya unggah/hapus/daftar bukti; riwayat menampilkan rincian versi; teks Indonesia; paste, drag-drop, loading/error/retry ada", () => {
  const hal = baca("../src/pages/finance/FinanceReceivables.jsx");
  assert.match(hal, /import KoreksiRefundDialog from/); assert.match(hal, /<KoreksiRefundDialog\s+refund=\{koreksiUntuk\}/);
  assert.doesNotMatch(hal, /<KoreksiDialog/, "dialog generik tidak lagi dipakai untuk refund");
  const api = baca("../src/api.js");
  assert.match(api, /uploadBuktiRefund: \(file\)/); assert.match(api, /fd\.append\("berkas", file\)/); assert.match(api, /hapusBuktiRefund/); assert.match(api, /getBuktiRefund/);
  const dlg = baca("../src/features/finance/KoreksiRefundDialog.jsx");
  const bersama = baca("../src/features/finance/BuktiUnggah.jsx"); // unggah/paste/drag-drop dipakai BERSAMA koreksi & lampirkan bukti
  const teksSemua = dlg + bersama + baca("../src/features/finance/refundKoreksiLogic.js");
  for (const t of ["Bukti transfer", "Gunakan bukti lama", "Tambah bukti baru", "Ganti bukti pada dokumen pengganti", "Nominal refund pelanggan", "Biaya admin bank", "Total keluar rekening", "Nomor referensi transfer", "Potensi biaya admin tercatat dua kali", "Coba lagi", "Mengunggah…", "Memuat bukti dokumen lama…"]) assert.ok(teksSemua.includes(t), t);
  assert.match(dlg, /onPaste=\{saatPaste\}/); assert.match(dlg, /useUnggahBukti/); assert.match(dlg, /<AreaUnggahBukti/); assert.match(bersama, /onDrop=/); assert.match(bersama, /api\.hapusBuktiRefund/); assert.match(dlg, /expectedUpdatedAt/); assert.match(dlg, /kunciRef\.current \|\|= kunciBaru\(\)/);
  assert.match(dlg, /konfirmasiBiayaGanda: setuju/); assert.match(dlg, /disabled=\{sibuk \|\| !pratinjau\.seimbang \|\| \(r\?\.perluKonfirmasi && !setuju\)\}/);
  assert.match(bersama, /accept="image\/jpeg,image\/png,image\/webp,application\/pdf/);
  assert.doesNotMatch(dlg + bersama, /\b(Upload failed|Loading|Retry|Cancel|Save)\b/);
  const riw = baca("../src/features/finance/KoreksiAman.jsx");
  assert.match(riw, /data\.versiRefund\?\.length > 0/); assert.match(riw, /Rincian tiap versi refund/);
});
