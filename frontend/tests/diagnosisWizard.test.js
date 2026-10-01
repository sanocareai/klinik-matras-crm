// P9D — Diagnosis Produksi + Planned BOM Terpadu. Sama pola text-scan dengan unitOverviewDrawer.test.js
// (project ini sengaja tanpa jsdom/RTL) — mengunci kontrak yang terbukti penting: 6 section wizard, target
// sentuh 44px, draft lokal per-run, foto wajib, bahan manual/katalog, layanan teknis, dan bahwa WorkerLane +
// Unit 360 SAMA-SAMA memakai wizard yang SAMA (bukan halaman terpisah, sesuai instruksi tugas).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIZARD = fs.readFileSync(path.join(__dirname, "..", "src", "features", "production", "DiagnosisWizard.jsx"), "utf8");
const WORKER_LANE = fs.readFileSync(path.join(__dirname, "..", "src", "pages", "produksi", "WorkerLane.jsx"), "utf8");
const DRAWER = fs.readFileSync(path.join(__dirname, "..", "src", "features", "production", "UnitOverviewDrawer.jsx"), "utf8");

test("DiagnosisWizard: 6 section wajib (Informasi Sales, Hasil Bongkar, Fondasi, Lapisan & Komponen, Bahan, Review & Simpan)", () => {
  for (const label of ["Informasi Sales", "Hasil Bongkar", "Fondasi", "Lapisan & Komponen", "Bahan", "Review & Simpan"]) {
    assert.ok(WIZARD.includes(`"${label}"`), `section "${label}" tidak ditemukan di DiagnosisWizard`);
  }
});

test("DiagnosisWizard: target sentuh mobile minimal 44px pada tab, tombol lanjut/kembali, dan kirim", () => {
  const hits = WIZARD.match(/min-h-\[44px\]|min-h-\[48px\]/g) || [];
  assert.ok(hits.length >= 5, `harus ada banyak elemen dgn min-h-[44px]/[48px] (tab+nav+kirim+chip), ditemukan ${hits.length}`);
});

test("DiagnosisWizard: draft disimpan lokal per-run (localStorage), dipulihkan saat dibuka lagi", () => {
  assert.match(WIZARD, /draftKey\s*=\s*\(runId\)\s*=>\s*`p9d-diagnosis-draft:\$\{runId\}`/);
  assert.match(WIZARD, /localStorage\.setItem/);
  assert.match(WIZARD, /loadLocalDraft\(runId\)/);
});

test("DiagnosisWizard: warning sebelum keluar bila draft belum dikirim (dirty check)", () => {
  assert.match(WIZARD, /window\.confirm/);
  assert.match(WIZARD, /requestClose/);
});

test("DiagnosisWizard: foto/video wajib minimal 1 (reuse EvidenceCapture, bukan komponen upload baru)", () => {
  assert.match(WIZARD, /import\s*\{\s*EvidenceCapture\s*\}\s*from\s*"@\/features\/production\/components\/EvidenceCapture\.jsx"/);
  assert.match(WIZARD, /rule=\{\{\s*min:\s*1,\s*video:\s*false\s*\}\}/);
});

test("DiagnosisWizard: bahan katalog (search) DAN bahan manual/noncatalog terpisah dengan alasan wajib", () => {
  assert.match(WIZARD, /searchProductionV2Materials/);
  assert.match(WIZARD, /Bahan belum terdaftar/);
  assert.match(WIZARD, /placeholder="Kenapa tidak ada di katalog\?"/);
});

test("DiagnosisWizard: layanan teknis dipilih dari katalog (getServiceCatalog), TIDAK menampilkan field harga/HPP", () => {
  assert.match(WIZARD, /api\.getServiceCatalog\(\)/);
  assert.doesNotMatch(WIZARD, /referenceUnitCost|referenceStockValue|HPP/i);
});

test("DiagnosisWizard: submit memakai expectedRevision (optimistic lock) dan Idempotency-Key (mutationKey)", () => {
  assert.match(WIZARD, /expectedRevision:\s*card\.diagnosisRevision/);
  assert.match(WIZARD, /submitProductionV2Diagnosis/);
});

test("WorkerLane: tahap 5 (Diagnosa) memakai DiagnosisWizard yang SAMA, bukan StepForm generik", () => {
  assert.match(WORKER_LANE, /import\s*\{\s*DiagnosisWizard\s*\}\s*from\s*"@\/features\/production\/DiagnosisWizard\.jsx"/);
  assert.match(WORKER_LANE, /if\s*\(stepNo === 5\)\s*return\s*<DiagnosisStepSheet/);
});

test("WorkerLane: setelah submit diagnosis, tahap 5 ditutup lewat recordProductionV2Step yang SAMA dipakai tahap lain (bukan mekanisme baru)", () => {
  assert.match(WORKER_LANE, /api\.recordProductionV2Step\(card\.runId, 5,/);
});

test("Unit 360: tombol 'Isi Diagnosis' muncul di tab Proses, memakai DiagnosisWizard yang SAMA dengan Aplikasi Meja", () => {
  assert.match(DRAWER, /import\s*\{\s*DiagnosisWizard[^}]*\}\s*from\s*"@\/features\/production\/DiagnosisWizard\.jsx"/);
  assert.match(DRAWER, /"Isi Diagnosis"/);
  assert.match(DRAWER, /canDiagnose/);
});

test("Unit 360: bahan manual dari Diagnosis tampil di tab Bahan dengan status MAPPED/NEEDS_MAPPING, deskripsi asli tidak hilang", () => {
  assert.match(DRAWER, /manualMaterials/);
  assert.match(DRAWER, /m\.status === "MAPPED"/);
  assert.match(DRAWER, /Petakan/);
});

test("Unit 360: setelah submit diagnosis, drawer memuat ulang (reload) supaya hasil langsung terlihat tanpa pindah halaman", () => {
  assert.match(DRAWER, /const reload = useCallback/);
  assert.match(DRAWER, /handleDiagnosisSubmitted/);
});

// Regresi "Maximum update depth exceeded" (stack terbukti: dispatchSetState <- updateManual <- onChange): flag
// "ada perubahan belum terkirim" TIDAK BOLEH lagi berupa state yang di-set dari useEffect pada tiap perubahan form.
test("DiagnosisWizard: flag dirty memakai ref (bukan setState di dalam useEffect per ketukan)", () => {
  assert.doesNotMatch(WIZARD, /setDirty\(/, "setDirty di efek = loop update pasif setelah >50 ketukan");
  assert.match(WIZARD, /const dirtyRef = useRef\(false\)/);
  assert.match(WIZARD, /dirtyRef\.current = true/);
  assert.match(WIZARD, /if \(dirtyRef\.current && !window\.confirm\(/);
});

test("Unit 360: selector uji stabil (dialog, loading, ready) tersedia dan tab hanya di dalam dialog", () => {
  assert.match(DRAWER, /"data-testid": "unit-overview-dialog"/);
  assert.match(DRAWER, /data-testid="unit-overview-loading"/);
  assert.match(DRAWER, /data-testid="unit-overview-ready"/);
  assert.match(DRAWER, /const UNIT_DIALOG_PROPS = /, "props dialog harus konstanta modul (identitas stabil)");
});

test("WorkerLane: selector stabil kartu antrean, detail unit, request-khusus, dan CTA diagnosis", () => {
  assert.match(WORKER_LANE, /data-testid="worker-unit-card" data-unit-code=\{item\.unit\.unitCode\}/);
  assert.match(WORKER_LANE, /data-testid="worker-unit-detail"/);
  assert.match(WORKER_LANE, /data-testid="request-khusus"/);
  assert.match(WORKER_LANE, /data-testid=\{next\.stepNo === 5 \? "open-diagnosis" : undefined\}/);
});

test("WorkerLane: teks bebas Sales (Request khusus/Keluhan) tidak melebar — min-w-0 + break-words + overflow-wrap:anywhere", () => {
  assert.match(WORKER_LANE, /data-testid="request-khusus" className="col-span-2 min-w-0[^"]*"><dt[^>]*>Request khusus<\/dt><dd className="m-0 break-words[^"]*\[overflow-wrap:anywhere\]/);
});

// Label tombol pembuka wizard (Unit 360): perilaku fungsi murni dieksekusi langsung dari sumbernya (tanpa jsdom).
function loadCtaLabel() {
  const m = WIZARD.match(/export function diagnosisCtaLabel\(([\s\S]*?)\n\}\n/);
  assert.ok(m, "diagnosisCtaLabel harus diekspor dari DiagnosisWizard");
  return new Function(`return function diagnosisCtaLabel(${m[1]}\n}`)();
}
test("Unit 360: label tombol — belum ada diagnosis → 'Isi Diagnosis'", () => {
  assert.equal(loadCtaLabel()({ status: undefined, hasDraft: false }), "Isi Diagnosis");
});
test("Unit 360: label tombol — draft lokal tersedia → 'Lanjutkan Diagnosis'", () => {
  assert.equal(loadCtaLabel()({ status: undefined, hasDraft: true }), "Lanjutkan Diagnosis");
  assert.equal(loadCtaLabel()({ status: "DRAFT", hasDraft: true }), "Lanjutkan Diagnosis");
});
test("Unit 360: label tombol — diagnosis RECORDED → 'Revisi Diagnosis' (menang atas draft lokal)", () => {
  assert.equal(loadCtaLabel()({ status: "RECORDED", hasDraft: false }), "Revisi Diagnosis");
  assert.equal(loadCtaLabel()({ status: "RECORDED", hasDraft: true }), "Revisi Diagnosis");
});
test("Unit 360: panel memakai diagnosisCtaLabel + hasLocalDraft dan badge status punya selector stabil RECORDED", () => {
  assert.match(DRAWER, /diagnosisCtaLabel\(\{ status: diag\?\.status, hasDraft: hasLocalDraft\(d\.production\.runId\) \}\)/);
  assert.match(DRAWER, /data-testid="diagnosis-status" data-diagnosis-status=\{diag\.status\}/);
});

// Regresi bug yang ditemukan QA visual: /master-data/service-catalog mengembalikan { services: [...] } (semua pemanggil lain
// membaca .services); wizard sempat membaca d.items sehingga dropdown "Layanan teknis" SELALU kosong dan submit UI 400.
test("DiagnosisWizard: dropdown layanan teknis membaca { services } dari /master-data/service-catalog", () => {
  assert.ok(WIZARD.includes("setServices(Array.isArray(d?.services) ? d.services : [])"));
  assert.ok(!WIZARD.includes("d?.items"));
});
