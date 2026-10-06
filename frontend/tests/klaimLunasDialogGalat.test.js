// Dialog Klaim Lunas Finance (Verifikasi / Minta Bukti / Tolak): setelah server menolak (mis. 403 tanpa izin payment:write), dialog TIDAK boleh terkunci. Sebelumnya
// status "sibuk" tidak pernah dilepas saat galat → Batal & penutup dialog nonaktif selamanya, halaman tampak membeku di balik lapisan gelap (laporan Owner 6 Okt 2026).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pesanGalatKlaim, PESAN_TANPA_IZIN_KLAIM } from "../src/features/finance/pesanGalatKlaim.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sumber = fs.readFileSync(path.join(dir, "../src/features/finance/KlaimLunasSales.jsx"), "utf8");

test("403 diterjemahkan jadi pesan izin yang jelas (hanya peran Finance); galat lain memakai pesan aslinya", () => {
  assert.equal(pesanGalatKlaim({ status: 403, message: "Forbidden" }), PESAN_TANPA_IZIN_KLAIM);
  assert.match(PESAN_TANPA_IZIN_KLAIM, /Finance/);
  assert.equal(pesanGalatKlaim({ status: 409, message: "Klaim sudah berubah sejak Anda membukanya. Muat ulang." }), "Klaim sudah berubah sejak Anda membukanya. Muat ulang.");
  assert.equal(pesanGalatKlaim(new Error("Koneksi timeout — coba lagi")), "Koneksi timeout — coba lagi");
  assert.match(pesanGalatKlaim(null), /Gagal memproses/);
});

test("kedua dialog melepas status sibuk bila aksi gagal, dan menampilkan galat DI DALAM dialog", () => {
  // jalankan() mengembalikan true/false; dialog memakainya untuk melepas kunci.
  assert.match(sumber, /async function jalankan\(fn\)[\s\S]*?return false;[\s\S]*?return true;/);
  const reset = sumber.match(/const ok = await onKirim\([\s\S]*?\); if \(!ok\) setSibuk\(false\);/g) ?? [];
  assert.equal(reset.length, 2, "ModalAlasan (tolak/minta bukti) dan ModalVerifikasiKlaim harus sama-sama melepas sibuk saat gagal");
  assert.equal((sumber.match(/<GalatDialog galat=\{galat\} \/>/g) ?? []).length, 2);
  // tidak ada lagi pemicu kirim yang mengunci tanpa menunggu hasil
  assert.doesNotMatch(sumber, /setSibuk\(true\); onKirim\(/);
});

test("kartu galat halaman tidak tampil ganda di belakang dialog yang terbuka", () => {
  assert.match(sumber, /\{pesan && !modal && \(/);
});
