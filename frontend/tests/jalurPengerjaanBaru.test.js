// Jalur PENGERJAAN PESANAN (BARU/custom): label tahap 6, tahap tidak berlaku, bahan opsional, tanpa Diagnosis/layanan teknis di UI.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_STEP, STEP_BY_NO, actionLabel, bucketLabelOf, indicatorList, stepOf, validateStepForm } from "../src/features/production/experience.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");
const VID = { status: "done", kind: "video", url: "/media/x.mp4" };

test("tahap 6 bernama Pengerjaan Pesanan hanya pada jalur BUILD; jalur lama tidak berubah", () => {
  assert.equal(stepOf(6, "BUILD").label, "Pengerjaan Pesanan");
  assert.equal(stepOf(6, "RESTORATION").label, STEP_BY_NO[6].label);
  assert.equal(stepOf(6, undefined).label, "Fondasi Baru");
  assert.equal(stepOf(8, "BUILD").label, STEP_BY_NO[8].label);
  assert.equal(BUILD_STEP.no, 6);
});

test("tombol aksi memakai label jalur: Mulai Pengerjaan Pesanan / Kirim Bukti Pengerjaan Pesanan", () => {
  assert.equal(actionLabel({ action: "START", stepNo: 6 }, { track: "BUILD" }), "Mulai Pengerjaan Pesanan");
  assert.equal(actionLabel({ action: "START", stepNo: 6 }, {}), "Mulai Fondasi Baru");
  assert.equal(actionLabel({ action: "EVIDENCE", stepNo: 6 }, { track: "BUILD" }), "Kirim Bukti Pengerjaan Pesanan");
});

test("validasi tahap 6 BUILD: bahan opsional, penjelasan pengerjaan wajib; jalur lama tetap wajib bahan", () => {
  assert.equal(validateStepForm(6, { materials: [], note: "Sesuai spesifikasi" }, { mediaItems: [VID], track: "BUILD" }), null);
  assert.match(validateStepForm(6, { materials: [], note: "" }, { mediaItems: [VID], track: "BUILD" }), /pengerjaan pesanan/i);
  assert.match(validateStepForm(6, { materials: [], note: "Isi fondasi" }, { mediaItems: [VID] }), /bahan Gudang/);
  assert.match(validateStepForm(6, { materials: [], note: "x yy" }, { mediaItems: [], track: "BUILD" }), /video|foto/i, "bukti video tetap wajib");
});

test("bucket Fondasi Baru bernama Pengerjaan Pesanan pada jalur BUILD", () => {
  assert.equal(bucketLabelOf("FONDASI", "BUILD"), "Pengerjaan Pesanan");
  assert.equal(bucketLabelOf("FONDASI", "RESTORATION"), "Fondasi Baru");
  assert.equal(bucketLabelOf("QC", "BUILD"), "QC / Rework");
});

test("indikator layanan TIDAK_BERLAKU tampil hijau (bukan kekurangan data); BOM OPSIONAL netral", () => {
  const list = indicatorList({ service: "TIDAK_BERLAKU", bom: "OPSIONAL" });
  assert.equal(list.find((i) => i.key === "service").tone, "green");
  assert.equal(list.find((i) => i.key === "bom").tone, "neutral");
});

test("Unit 360: tahap tidak berlaku ditulis 'tidak berlaku'; panel Diagnosis diganti catatan pada jalur BUILD", () => {
  const drawer = src("features", "production", "UnitOverviewDrawer.jsx");
  assert.match(drawer, /data-testid="step-na"[^>]*>tidak berlaku</);
  assert.match(drawer, /d\.production\.track === "BUILD"/);
  assert.match(drawer, /data-testid="build-track-note"/);
});

test("lembar bukti & detail pekerja memakai label per jalur (card.track)", () => {
  assert.match(src("features", "production", "workerApp", "workerSheets.jsx"), /stepOf\(stepNo, card\.track\)/);
  assert.match(src("features", "production", "workerApp", "JobDetail.jsx"), /track: card\.track/);
  assert.match(src("features", "production", "components", "StepForm.jsx"), /Penjelasan pengerjaan pesanan/);
});
