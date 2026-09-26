// Web Pengajuan Biaya: dukungan PERLU_REVISI (label, badge, filter, detail, edit sesuai kontrak backend)
// dan fallback aman untuk status yang tidak dikenal. Modul murni diuji langsung; halaman diperiksa lewat
// teks sumber (frontend tidak punya harness render — pola sama dengan armadaPembayaranInsentifUI.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  STATUS_LABEL, STATUS_VARIANT, STATUS_FILTERS, statusLabel, statusVariant, bolehEditAjukan, bolehTarik, bolehBatalkan, labelAjukan,
  deskripsiAudit, riwayatRevisi,
} from "../src/features/armada/pengajuanBiayaStatus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const halaman = readFileSync(join(__dirname, "../src/pages/armada/ArmadaPengajuanBiaya.jsx"), "utf8");

test("PERLU_REVISI punya label Indonesia, badge oranye, dan masuk filter status", () => {
  assert.equal(STATUS_LABEL.PERLU_REVISI, "Perlu Revisi");
  assert.equal(statusLabel("PERLU_REVISI"), "Perlu Revisi");
  assert.equal(statusVariant("PERLU_REVISI"), "orange");
  assert.ok(STATUS_FILTERS.includes("PERLU_REVISI"));
  for (const s of STATUS_FILTERS.filter(Boolean)) assert.ok(STATUS_LABEL[s], `${s} punya label`);
  for (const s of Object.keys(STATUS_LABEL)) assert.ok(STATUS_VARIANT[s], `${s} punya varian badge`);
});

test("fallback aman: status yang tidak dikenal tidak pernah memecahkan tampilan", () => {
  assert.equal(statusLabel("STATUS_BARU_DARI_SERVER"), "Status tidak dikenal (STATUS_BARU_DARI_SERVER)");
  assert.equal(statusLabel(undefined), "—");
  assert.equal(statusLabel(null), "—");
  assert.equal(statusVariant("STATUS_BARU_DARI_SERVER"), "neutral");
  assert.equal(bolehEditAjukan("STATUS_BARU_DARI_SERVER"), false, "tanpa aksi untuk status asing");
  assert.equal(bolehTarik("STATUS_BARU_DARI_SERVER"), false);
  assert.equal(bolehBatalkan("STATUS_BARU_DARI_SERVER"), false);
});

test("aturan edit MENGIKUTI kontrak backend: edit/ajukan = DRAFT|PERLU_REVISI; tarik = MENUNGGU; batalkan = DRAFT|PERLU_REVISI", () => {
  for (const s of ["DRAFT", "PERLU_REVISI"]) { assert.equal(bolehEditAjukan(s), true, s); assert.equal(bolehBatalkan(s), true, s); assert.equal(bolehTarik(s), false, s); }
  assert.equal(bolehTarik("MENUNGGU_PERSETUJUAN"), true);
  for (const s of ["MENUNGGU_PERSETUJUAN", "OTOMATIS_DISETUJUI", "DISETUJUI", "DIBAYAR", "DITOLAK", "DIBATALKAN"]) {
    assert.equal(bolehEditAjukan(s), false, s);
    assert.equal(bolehBatalkan(s), false, s);
  }
  assert.equal(labelAjukan("PERLU_REVISI"), "Ajukan Ulang");
  assert.equal(labelAjukan("DRAFT"), "Ajukan");
});

test("histori revisi: permintaan (siapa, kapan, alasan) dan pengajuan ulang, urut lama ke baru; tarik/batalkan tidak ikut", () => {
  const audit = [
    { field: "status", before: "PERLU_REVISI", after: "MENUNGGU_PERSETUJUAN", reason: "Diajukan ulang setelah revisi", createdAt: "2026-09-24T05:00:00Z", actor: { name: "Agung" } },
    { field: "status", before: "MENUNGGU_PERSETUJUAN", after: "PERLU_REVISI", reason: "Foto buram", createdAt: "2026-09-24T03:00:00Z", actor: { name: "Reviewer" } },
    { field: "status", before: "MENUNGGU_PERSETUJUAN", after: "DRAFT", reason: "Ditarik kembali oleh pemohon", createdAt: "2026-09-23T03:00:00Z", actor: { name: "Agung" } },
    { field: "draft", before: null, after: "amount", reason: null, createdAt: "2026-09-24T04:00:00Z", actor: { name: "Agung" } },
  ];
  const h = riwayatRevisi(audit);
  assert.deepEqual(h.map((x) => [x.jenis, x.oleh, x.alasan]), [["diminta", "Reviewer", "Foto buram"], ["diajukan-ulang", "Agung", null]]);
  assert.deepEqual(riwayatRevisi([]), []);
  assert.deepEqual(riwayatRevisi(undefined), []);
});

test("deskripsi audit berbahasa Indonesia dan membedakan revisi, tarik, batalkan", () => {
  const d = (field, before, after, reason = null) => deskripsiAudit({ field, before, after, reason });
  assert.equal(d("status", "MENUNGGU_PERSETUJUAN", "PERLU_REVISI", "Foto buram"), "Diminta revisi — Foto buram");
  assert.equal(d("status", "MENUNGGU_PERSETUJUAN", "DRAFT"), "Ditarik kembali oleh pemohon");
  assert.equal(d("status", "DRAFT", "DIBATALKAN", "Salah"), "Dibatalkan — Salah");
  assert.equal(d("status", "PERLU_REVISI", "MENUNGGU_PERSETUJUAN"), "Diajukan ulang setelah revisi");
  assert.equal(d("vendorName", "A", "B", "typo"), 'Koreksi vendorName: "A" menjadi "B" — typo', "koreksi metadata lama tetap terbaca");
});

test("halaman: memakai modul status bersama, detail menampilkan alasan/reviewer/waktu + riwayat revisi, tanpa mutation baru", () => {
  assert.match(halaman, /pengajuanBiayaStatus\.js/);
  assert.match(halaman, /revisionReason/);
  assert.match(halaman, /revisionRequestedBy/);
  assert.match(halaman, /revisionRequestedAt/);
  assert.match(halaman, /riwayatRevisi\(/);
  assert.match(halaman, /deskripsiAudit\(/);
  assert.match(halaman, /labelAjukan\(/);
  assert.doesNotMatch(halaman, /const STATUS_LABEL\s*=|const STATUS_VARIANT\s*=/, "tidak ada peta status ganda di halaman");
  // hanya API mutation yang SUDAH ada dipakai
  const api = readFileSync(join(__dirname, "../src/api.js"), "utf8");
  assert.doesNotMatch(api, /minta-revisi/, "web tidak memanggil minta-revisi (bukan bagian scope web)");
});
