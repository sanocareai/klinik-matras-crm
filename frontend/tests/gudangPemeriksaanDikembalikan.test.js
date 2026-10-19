// UX Gudang Tahap 3 — pemeriksaan yang dikembalikan: hasil lama berlabel tidak berlaku, isian awal hanya mengisi formulir (tidak menyimpan), penolakan server tampil sebagai banner, riwayat memuat rincian arsip.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const pd = fs.readFileSync(path.join(dir, "../src/features/warehouse/penerimaan/PenerimaanDetail.jsx"), "utf8").replace(/\r\n/g, "\n");

test("kartu 'Pemeriksaan sebelumnya DIBATALKAN': hasil lama berlabel tidak berlaku, tidak dipakai otomatis, pelaku/waktu/alasan tampil", () => {
  for (const s of ['data-testid="pemeriksaan-sebelumnya"', "Pemeriksaan sebelumnya · tidak berlaku", "tidak dipakai otomatis", "pemeriksaanSebelumnya.oleh", "pemeriksaanSebelumnya.alasan", "waktuTeks(r.pemeriksaanSebelumnya.waktu)", 'data-testid="hasil-lama"']) assert.ok(pd.includes(s), s);
});

test("tombol isian awal hanya mengisi formulir (state), tanpa memanggil API; hanya saat Pemeriksaan, ada izin, dan belum diisi ulang", () => {
  const i = pd.indexOf('data-testid="pakai-isian-awal"'); assert.ok(i > 0);
  const blok = pd.slice(i - 900, i + 60);
  assert.match(blok, /setIsian\(/); assert.doesNotMatch(blok, /api\./, "tidak menyimpan apa pun");
  assert.match(pd, /bolehUbah && r\.status === "INSPECTION" && !r\.pemeriksaanSebelumnya\.sudahDiisiUlang/);
});

test("penolakan server (HASIL_PEMERIKSAAN_BARU_WAJIB) tampil sebagai banner dengan dokumen dimuat ulang; riwayat memuat rincian arsip; konfirmasi mundur menyatakan hasil lama tidak berlaku", () => {
  assert.match(pd, /\["REVISI_BASI", "PERPINDAHAN_TIDAK_SAH", "SUDAH_ADA_HASIL_PEMERIKSAAN", "HASIL_PEMERIKSAAN_BARU_WAJIB"\]/);
  assert.ok(pd.includes('data-testid="jejak-rincian"'));
  const spek = pd.split("\n").find((l) => l.startsWith("  KEMBALI_TIBA: { panel:")); assert.match(spek, /TIDAK BERLAKU/); assert.match(spek, /arsip/); assert.match(spek, /bukti kedatangan tetap utuh/);
  const periksa = pd.split("\n").find((l) => l.startsWith("  KEMBALI_PERIKSA: { panel:")); assert.match(periksa, /tidak dihapus/, "Siap → Pemeriksaan mempertahankan hasil");
});
