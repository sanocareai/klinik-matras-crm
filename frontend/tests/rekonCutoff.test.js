// B3 — Rekonsiliasi Cutoff: jaminan sisi layar. Angka snapshot & klasifikasi dihitung SERVER (backend/tests/integration/financeRekonCutoff...).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");
const panel = baca("features/finance/RekonCutoff.jsx");
const hal = baca("pages/finance/FinanceReconciliation.jsx");
const api = baca("api.js");

test("Panel memisahkan Snapshot, Posting Setelah Cutoff, Reversal, Saldo Buku Sekarang, Mutasi Bank Asli, dan selisih", () => {
  for (const t of ["Snapshot saat dikonfirmasi", "Posting Setelah Cutoff", "Reversal Setelah Snapshot", "Saldo Buku Sekarang", "Mutasi Bank Asli", "Selisih rekonsiliasi sekarang"]) {
    assert.ok(panel.includes(t), t);
  }
});

test("Enam definisi waktu ditampilkan terpisah", () => {
  for (const t of ["Tgl. Buku", "Dibuat", "Cutoff mutasi bank", "Saldo riil dikonfirmasi", "High-water mark jurnal", "Snapshot dibuat"]) assert.ok(panel.includes(t), t);
});

test("Klien tidak menghitung ulang snapshot: angka dibaca dari respons server", () => {
  assert.ok(!/reduce\([^)]*saldoBuku/.test(panel));
  assert.match(panel, /c\.snapshot\.saldoBuku/);
});

test("Daftar periode: kolom cutoff/snapshot, selisih snapshot, late & tinjau, plus filter Posting Setelah Cutoff dan Perlu Ditinjau", () => {
  assert.match(hal, /Cutoff & Snapshot/);
  assert.match(hal, /Selisih Snapshot/);
  assert.match(hal, /label: "Posting Setelah Cutoff"/);
  assert.match(hal, /label: "Perlu Ditinjau"/);
});

test("API: snapshot, verifikasi, perlu ditinjau, drill-down jurnal, ekspor audit", () => {
  for (const f of ["buatSnapshotRekon", "verifikasiSnapshotRekon", "getRekonPerluDitinjau", "tinjauExceptionRekon", "getBukuJurnalDetail", "eksporAuditRekon"]) assert.match(api, new RegExp(f));
});

test("Exception tidak diperbaiki otomatis: hanya tandai ditinjau dengan catatan wajib", () => {
  assert.match(panel, /Data dokumen dan jurnal tidak diubah/);
  assert.match(panel, /disabled=\{!catatan\.trim\(\)\}/);
});
