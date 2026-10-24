// Alat impor terkelola catatan historis: HANYA catatan. Gerbang tertulis; tidak menyentuh stok/valuasi/jurnal/posting; mode menulis hanya 'terapkan'.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const alat = baca("scripts/lib/impor-terkelola-pemakaian-historis.mjs"); const doc = baca("docs/impor-catatan-historis-production.md");

test("alat impor: tidak memuat jalur stok/valuasi/jurnal/posting; satu-satunya penulisan = terapkanImpor + evaluasiUlang di mode 'terapkan' (dan evaluasi di 'lanjut')", () => {
  const kode = alat.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const kata of ["postStockMovement", "jalankanPosting", "rencanakanPosting", "bukukan", "koreksiValuasi", "ajukanKoreksi", "setujuiKoreksi", "stockMovement.create", "stockMovement.update", "finJournal", ".delete(", "deleteMany", "$executeRaw"]) assert.ok(!kode.includes(kata), `alat memuat ${kata}`);
  assert.equal((kode.match(/cat\.terapkanImpor\(/g) ?? []).length, 1, "terapkanImpor dipanggil tepat satu kali");
  assert.equal((kode.match(/cat\.evaluasiUlang\(/g) ?? []).length, 2, "evaluasiUlang hanya di 'terapkan' dan 'lanjut'");
  for (const mode of ["pratinjau", "sebelum", "terapkan", "sesudah", "lanjut", "rekam-akhir", "status"]) assert.ok(kode.includes(`MODE === "${mode}"`), mode);
});

test("gerbang 'terapkan' menolak tanpa menulis: sha256 CSV, hash disetujui, tabel kosong, potret sebelum, hash rencana dihitung ulang dari production, hitungan 2.656 + 29; exit 3 sebelum terapkanImpor", () => {
  const blok = alat.slice(alat.indexOf('MODE === "terapkan"'), alat.indexOf('MODE === "sesudah"'));
  for (const s of ["alat dijalankan dari BERKAS dengan sha256 = --sha-alat = manifest.alat.sha256", "aktor audit = akun ADMIN aktif yang disetujui (email + id cocok)", "sha256 Pemakaian Bahan.csv = manifest", "hash rencana yang disetujui = hash di manifest", "tabel rekonsiliasi masih KOSONG", "potret 'sebelum' ada", "rencana dihitung ulang dari data production = manifest", "hitungan rencana (catatan Excel + referensi LEDGER) = manifest", "GATE DITOLAK", "process.exitCode = 3"]) assert.ok(blok.includes(s), s);
  assert.ok(blok.indexOf("GATE DITOLAK") < blok.indexOf("cat.terapkanImpor("), "gerbang HARUS lebih dulu dari penulisan");
  assert.match(blok, /if \(gagal\) \{ console\.log\([\s\S]*?process\.exitCode = 3; return; \}/);
});

test("fase 'sesudah' membuktikan: nilai asli = CSV, tanpa pergerakan/valuasi/jurnal baru (sidik jari sebelum T0), 254 ISSUE utuh, tanpa posting, impor ulang = nol; dokumen menjelaskan penolakan rollback dan pemulihan maju", () => {
  const blok = alat.slice(alat.indexOf('MODE === "sesudah"'));
  for (const s of ["nilai asli setiap catatan Excel = baris CSV", "sidik jari ${k} (data sebelum T0) identik", "254 ISSUE lama tetap 254", "tidak ada catatan DIPOSTING", "impor ulang berkas yang sama = NOL perubahan", "hash keadaan akhir tabel"]) assert.ok(blok.includes(s), s);
  for (const s of ["exit 10 (ADA DATA)", "menolak", "perbaikan maju", "keputusan pemulihan khusus", "PostgreSQL membatalkan SELURUH transaksi", "--mode=lanjut", "0230e650a0c4c8de631247bfef01c47c7fa533f12fb534e9eea840fef6b00d62"]) assert.ok(doc.includes(s), s);
});

test("aktor audit: akun ADMIN yang benar-benar menjalankan impor; sumber 'Excel Admin Sales yang dikonfirmasi Owner' di peristiwa; tidak mengatasnamakan PIC; byte alat diverifikasi sendiri; uji berhenti-setelah-commit hanya lewat env khusus", () => {
  assert.ok(alat.includes('const SUMBER_LABEL = "Excel Admin Sales yang dikonfirmasi Owner"')); assert.ok(alat.includes("const NAMA_BERKAS = `${SUMBER_LABEL} — "));
  assert.ok(alat.includes('roles.includes("ADMIN")')); assert.ok(alat.includes("u.id === id")); assert.ok(alat.includes("tidak ada peristiwa yang mengatasnamakan PIC pemakaian historis"));
  assert.ok(alat.includes("fileURLToPath(import.meta.url)")); assert.ok(alat.includes('IMPOR_UJI_BERHENTI_SETELAH_COMMIT === "1"'));
  const lanjut = alat.slice(alat.indexOf('MODE === "lanjut"'), alat.indexOf('MODE === "rekam-akhir"')); assert.ok(lanjut.includes("--sha-alat") && lanjut.includes("ambilAktor()") && lanjut.includes("LANJUT DITOLAK"));
  const status = alat.slice(alat.indexOf('MODE === "status"'), alat.indexOf('MODE === "lanjut"')); assert.ok(!/prisma\.\w+\.(create|update|delete)/.test(status), "status baca-saja");
  for (const s of ["RUNBG", "nohup", "--mode=status", "--sha-alat", "--aktor-email", "SHA256SUMS", "SEBAGIAN/LAIN"]) assert.ok(doc.includes(s), s);
});
