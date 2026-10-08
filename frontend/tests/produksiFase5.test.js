// Fase 5 — Corner, Selesaikan Produksi, rangkaian dokumentasi, status terpadu (logika klien + kontrak sumber).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildStepPayload, validateCornerDoneForm, validateCornerStartForm, validateStepForm } from "../src/features/production/experience.js";

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const vague = { fabricChangeRequested: true, needsSalesConfirmation: true, missing: ["motif", "warna"] };
const clear = { fabricChangeRequested: true, needsSalesConfirmation: false, missing: [] };
const none = { fabricChangeRequested: false, needsSalesConfirmation: false, missing: [] };
const ok = { requestChecked: true, fabricMode: "NEW_INSTALLED", requestMatch: "SESUAI", salesConfirmation: "Sales: polos abu" };

test("mulai Corner (cermin server): periksa permintaan, kain lama/baru, kesesuaian; 'Perlu konfirmasi Sales' menuntut hasil konfirmasi; tidak menebak", () => {
  assert.equal(validateCornerStartForm(ok, vague), null);
  assert.match(validateCornerStartForm({ ...ok, requestChecked: false }, vague), /sudah Anda periksa/);
  assert.match(validateCornerStartForm({ ...ok, fabricMode: undefined }, vague), /kain lama dipakai kembali atau kain baru dipasang/);
  assert.match(validateCornerStartForm({ ...ok, requestMatch: undefined }, vague), /sesuai permintaan Sales atau ada perbedaan/);
  assert.match(validateCornerStartForm({ ...ok, salesConfirmation: "" }, vague), /Perlu konfirmasi Sales: tulis hasil konfirmasi Sales untuk motif dan warna/);
  assert.equal(validateCornerStartForm({ ...ok, salesConfirmation: "" }, clear), null, "detail tertulis: konfirmasi tambahan tidak wajib");
  assert.match(validateCornerStartForm({ ...ok, fabricMode: "OLD_REUSED", requestMatch: "SESUAI" }, clear), /Sales meminta ganti kain tetapi kain lama dipakai kembali/);
  assert.equal(validateCornerStartForm({ ...ok, fabricMode: "OLD_REUSED", requestMatch: "SESUAI", salesConfirmation: "" }, none), null, "tanpa permintaan kain: kain lama boleh");
  assert.match(validateCornerStartForm({ ...ok, requestMatch: "ADA_PERBEDAAN" }, clear), /Jelaskan perbedaan/);
});

test("jahit selesai (cermin server): pekerjaan Corner wajib; perbedaan dicatat atau 'tidak ada perbedaan'", () => {
  assert.equal(validateCornerDoneForm({ cornerWork: "Jahit ulang", noDifference: true }), null);
  assert.match(validateCornerDoneForm({ cornerWork: "" }), /pekerjaan Corner/i);
  assert.match(validateCornerDoneForm({ cornerWork: "Jahit ulang" }), /catatan perbedaan/i);
  assert.equal(validateCornerDoneForm({ cornerWork: "Jahit ulang", differenceNote: "List lebih lebar" }), null);
});

test("payload & validasi tahap 10/11 hanya berubah untuk Run kontrak Fase 5 (V2); Run lama memakai kontrak lama", () => {
  const form10 = { mattressStyle: "BIASA", fabricSpec: "Knit putih", borderColor: "Abu", ...ok, requestNote: " beda " };
  assert.deepEqual(Object.keys(buildStepPayload(10, form10, {})).sort(), ["borderColor", "fabricSpec", "materials", "mattressStyle", "note"].sort(), "kontrak lama tanpa kolom Fase 5");
  const p = buildStepPayload(10, form10, { cornerV2: true });
  assert.deepEqual([p.requestChecked, p.fabricMode, p.requestMatch, p.requestNote, p.salesConfirmation], [true, "NEW_INSTALLED", "SESUAI", "beda", "Sales: polos abu"]);
  const p11 = buildStepPayload(11, { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true }, cornerWork: " Jahit ", noDifference: true }, { cornerV2: true });
  assert.deepEqual([p11.cornerWork, p11.noDifference, p11.differenceNote], ["Jahit", true, undefined]);
  const media = [{ status: "done", kind: "image" }];
  assert.equal(validateStepForm(10, form10, { mediaItems: media, track: "RESTORATION" }), null, "Run lama: tanpa pemeriksaan permintaan");
  assert.match(validateStepForm(10, { ...form10, requestChecked: false }, { mediaItems: media, track: "RESTORATION", cornerV2: true, cornerBrief: vague }), /sudah Anda periksa/);
  assert.match(validateStepForm(11, { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, { mediaItems: media, track: "RESTORATION", cornerV2: true }), /pekerjaan Corner/i);
});

test("kontrak sumber: kartu permintaan Sales, status terpadu, rangkaian dokumentasi, pratinjau penyelesaian — teks Indonesia, selektor stabil, satu sumber server", () => {
  const card = read("features/production/components/CornerRequestCard.jsx");
  for (const id of ["corner-request-card", "sales-confirm-flag", "req-fabric", "req-motif", "req-color", "req-notes", "req-hint", "corner-na-reason"]) assert.ok(card.includes(`data-testid="${id}"`), id);
  assert.match(card, /Perlu konfirmasi Sales|SALES_CONFIRM_LABEL/);
  assert.match(card, /Konfirmasi Sales dicatat oleh PIC Corner/); assert.match(card, /data-testid="sales-confirmed-meta"/); assert.match(card, /data-testid="sales-confirmed-body"/); assert.match(card, /layanan ganti kain tidak dipesan/);
  assert.doesNotMatch(card, /Sudah dikonfirmasi Sales/, "tidak mengklaim Sales sendiri yang mengisi");
  assert.match(read("pages/bengkel/ProductionReportV2.jsx"), /Konfirmasi Sales dicatat oleh PIC Corner/); assert.match(card, /Corner tidak berlaku/); assert.doesNotMatch(card, /\b(Pending|Required|Not applicable)\b/);
  const form = read("features/production/components/StepForm.jsx");
  for (const id of ["corner-check-block", "request-note", "sales-confirmation", "corner-done-block", "corner-work", "difference-note"]) assert.ok(form.includes(`data-testid="${id}"`), id);
  assert.match(form, /FinishPreviewBlock/); assert.match(form, /contractV2/);
  const fp = read("features/production/components/FinishPreviewBlock.jsx");
  for (const id of ["finish-preview", "finish-statement", "finish-blockers"]) assert.ok(fp.includes(`data-testid="${id}"`), id);
  assert.match(fp, /api\.getProductionV2FinishPreview/); assert.doesNotMatch(fp, /finishProductionV2Run|recordProductionV2Step/, "pratinjau hanya membaca; aksi = konfirmasi tahap 12");
  const lc = read("features/production/components/LifecycleBadge.jsx"); assert.match(lc, /data-testid="lifecycle-badge"/); assert.match(lc, /Corner tidak berlaku/);
  const seq = read("features/production/components/DocSequence.jsx"); assert.match(seq, /data-testid="doc-sequence-step"/); assert.match(seq, /Tidak berlaku/);
  for (const [file, needle] of [["features/production/workerApp/JobDetail.jsx", "LifecycleBadge"], ["features/production/UnitOverviewDrawer.jsx", "LifecycleBadge"], ["features/production/UnitCard.jsx", "LifecycleBadge"], ["features/production/docApp/DocDetail.jsx", "DocSequence"], ["pages/bengkel/ProductionReportV2.jsx", "DocSequence"], ["pages/bengkel/ProductionReportV2.jsx", "LifecycleBadge"]]) assert.ok(read(file).includes(needle), `${file} memakai ${needle}`);
  for (const f of ["UnitOverviewDrawer.jsx", "UnitCard.jsx"]) assert.doesNotMatch(read(`features/production/${f}`), /lifecycleStatusOf|deriveLifecycle/, "tidak menurunkan status sendiri");
});
