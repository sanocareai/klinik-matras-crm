// Pembayaran Insentif Driver — Admin/Finance UI (24 September 2026). Frontend
// TIDAK punya harness render komponen (lihat pola sama di
// armadaInsentifSnapshotUI.test.js) — jaring regresi murah lewat teks
// sumber: memastikan seluruh section yang diminta spec benar-benar ada.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../src/pages/armada/ArmadaPembayaranInsentif.jsx"), "utf8");

test("Daftar snapshot APPROVED: periode, total disahkan, dibayar, sisa, progress", () => {
  assert.match(src, /getIncentivePayoutQueue/);
  assert.match(src, /totalRupiah/);
  assert.match(src, /totalDibayar/);
  assert.match(src, /totalSisa/);
  assert.match(src, /progress/);
});

test("Daftar per driver/helper: nama, tarif, nilai final, dibayar, sisa, status", () => {
  assert.match(src, /ratePerAlamat/);
  assert.match(src, /l\.totalRupiah/);
  assert.match(src, /l\.dibayar/);
  assert.match(src, /l\.sisa/);
  assert.match(src, /StatusPembayaranBadge/);
});

test("Aksi Catat Pembayaran: metode, tanggal, nominal, referensi, bukti, catatan", () => {
  assert.match(src, /createIncentivePayout/);
  assert.match(src, /Metode Pembayaran/);
  assert.match(src, /Tanggal Bayar/);
  assert.match(src, /Nominal \(Rupiah\)/);
  assert.match(src, /Nomor Referensi/);
  assert.match(src, /Bukti Pembayaran/);
  assert.match(src, /Catatan/);
});

test("Riwayat pembayaran dan void ada", () => {
  assert.match(src, /getIncentivePayouts/);
  assert.match(src, /voidIncentivePayout/);
  assert.match(src, /Riwayat Pembayaran/);
  assert.match(src, /Batalkan pembayaran ini/);
});

test("Filter periode/status/orang ada", () => {
  assert.match(src, /filterStatus/);
  assert.match(src, /filterOrang/);
});

test("Empty/loading/error state ada", () => {
  assert.match(src, /EmptyState/);
  assert.match(src, /TableSkeletonRows/);
  assert.match(src, /setError/);
});

test("Permission gating: create dan void dipisah lewat capabilities, bukan role", () => {
  assert.match(src, /capabilities\.incentivePayoutCreate/);
  assert.match(src, /capabilities\.incentivePayoutVoid/);
});

test("TIDAK PERNAH memberi label 'Sudah Dibayar' hanya karena APPROVED — status pembayaran SELALU dari ledger", () => {
  // Buang baris komentar kode (//...) sebelum mengecek — komentar SENGAJA
  // menyebut frasa ini untuk MENJELASKAN apa yang TIDAK dilakukan (pola
  // sama dengan disclaimer driver-mobile), bukan teks yang dirender ke UI.
  const tanpaKomentar = src.split("\n").filter((baris) => !baris.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(tanpaKomentar, /Sudah Dibayar/, "label 'Sudah Dibayar' TIDAK BOLEH dirender ke UI hanya karena Snapshot APPROVED");
  assert.match(src, /berarti angkanya SAH/);
});

test("TIDAK ada hue 'amber' yang tidak terdaftar di design system", () => {
  assert.doesNotMatch(src, /amber/i);
});

test("Formatter rupiah/tanggal WIB dipakai dari util BERSAMA (bukan reimplementasi lokal)", () => {
  assert.match(src, /import \{ formatRupiah, formatTanggalWaktu \} from "@\/utils\/format\.js"/, "harus pakai formatRupiah/formatTanggalWaktu bersama, bukan Intl/toLocaleString ditulis ulang di halaman ini");
  assert.doesNotMatch(src, /toLocaleString/, "TIDAK boleh format Rupiah/tanggal manual — satu sumber formatter, bukan dua yang bisa beda hasil");
});

test("Sumber dana Kas/Bank wajib dipilih dan dikirim ke API; jurnal tampil di riwayat", () => {
  assert.match(src, /getIncentivePayoutCashAccounts/);
  assert.match(src, /Sumber Dana \(Kas\/Bank\)/);
  assert.match(src, /cashAccountId/);
  assert.match(src, /journalEntry/);
});
