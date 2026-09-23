// Snapshot Insentif Driver — Admin UI (24 September 2026). Frontend TIDAK
// punya harness render komponen (lihat pola sama di
// armadaDeliveryReportIncentiveLabel.test.js) — jaring regresi murah lewat
// teks sumber: memastikan seluruh section yang diminta spec benar-benar ada
// di JSX yang dikirim ke browser, bukan cuma ditulis lalu terhapus lagi
// tanpa sadar di refactor berikutnya.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../src/pages/armada/ArmadaInsentifSnapshot.jsx"), "utf8");

test("Daftar periode & status: tabel + filter status ada", () => {
  assert.match(src, /listIncentiveSnapshots/);
  assert.match(src, /DRAFT.*REVIEWED.*APPROVED.*REJECTED|TabsTrigger value="DRAFT"/s);
});

test("Buat snapshot bulanan/custom: dua mode ada", () => {
  assert.match(src, /mode === "monthly"/);
  assert.match(src, /mode === "custom"/);
  assert.match(src, /Buat Snapshot/);
});

test("Preview per orang sebelum dibuat: memanggil endpoint preview, bukan langsung create", () => {
  assert.match(src, /previewIncentiveSnapshot/);
  assert.match(src, /Lihat Preview/);
});

test("Detail alamat/order/job yang dihitung: field orderId/tanggalWIB/jobIds tampil", () => {
  assert.match(src, /d\.tanggalWIB/);
  assert.match(src, /d\.orderId/);
});

test("Selisih estimasi live vs snapshot: liveComparison ditampilkan", () => {
  assert.match(src, /liveComparison/);
  assert.match(src, /berubah sejak snapshot ini dibuat|liveComparison\.berubah/);
});

test("Review Finance dan Approval Owner: dua aksi terpisah dengan permission berbeda", () => {
  assert.match(src, /reviewIncentiveSnapshot/);
  assert.match(src, /approveIncentiveSnapshot/);
  assert.match(src, /incentiveSnapshotReview/);
  assert.match(src, /incentiveSnapshotApprove/);
});

test("Alasan penolakan: reject wajib mengisi alasan", () => {
  assert.match(src, /rejectIncentiveSnapshot/);
  assert.match(src, /Alasan penolakan/);
});

test("Warning overlap, data berubah, dan kandidat historis belum terverifikasi semuanya ada", () => {
  assert.match(src, /overlapKalender/);
  assert.match(src, /kandidatBelumTerverifikasi/);
  assert.match(src, /Menunggu konfirmasi Ops/);
  assert.match(src, /Data sudah berubah sejak snapshot/);
});

test("TIDAK ada hue 'amber' yang tidak terdaftar di design system (hanya accent/red/orange/green)", () => {
  assert.doesNotMatch(src, /amber/i, "Badge/warna cuma boleh accent/red/orange/green — 'amber' tidak pernah di-generate Tailwind di proyek ini");
});
