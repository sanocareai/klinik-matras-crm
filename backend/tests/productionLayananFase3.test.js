// Fase 3 Produksi LAYANAN — domain murni: racikan rencana (PLAN_RACIKAN), total tinggi atas->bawah, rencana vs aktual, atribut katalog.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as B2 from "../src/lib/domain/productionComponents.js";
import {
  COMPONENT_SECTIONS, QC_SECTION_KEYS, buildComparison, materialAttributes, normalizeSectionData, summarizeResultLayers,
} from "../src/lib/domain/productionComponents.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const manual = (text) => ({ kind: "MANUAL", text });
const before = { data: { layers: [{ material: manual("Busa kuning"), thicknessCm: 6, condition: "AUS" }, { material: { kind: "UNKNOWN" }, thicknessCm: 4, condition: "KEMPES" }] }, version: 1 };

test("PLAN_RACIKAN terdaftar sebagai seksi biasa (BUKAN seksi QC), bentuk sama dengan AFTER", () => {
  assert.equal(COMPONENT_SECTIONS.PLAN_RACIKAN.label, "Racikan rencana");
  assert.equal(QC_SECTION_KEYS.includes("PLAN_RACIKAN"), false, "PIC Meja dan PIC QC sama-sama boleh menentukan racikan");
  const plan = { foundation: { action: "REPAIR", system: "BONNELL" }, layers: [{ action: "REPLACE", material: manual("Busa baru"), thicknessCm: 7 }, { action: "KEEP", fromOrder: 2 }] };
  const after = { ...plan };
  assert.deepEqual(Object.keys(normalizeSectionData("PLAN_RACIKAN", plan)), Object.keys(normalizeSectionData("AFTER", after)));
  assert.throws(() => normalizeSectionData("PLAN_RACIKAN", { layers: [] }), (e) => e.code === "COMPONENT_PLAN_EMPTY");
  assert.throws(() => normalizeSectionData("PLAN_RACIKAN", { layers: [{ action: "REPLACE", thicknessCm: 3 }] }), (e) => e.code === "COMPONENT_MATERIAL_REQUIRED", "ganti/perbaiki wajib menyebut bahan (katalog/manual/tidak diketahui)");
  assert.throws(() => normalizeSectionData("PLAN_RACIKAN", { layers: [{ action: "HAPUS", material: manual("x") }] }), (e) => e.code === "COMPONENT_ACTION_REQUIRED");
  assert.equal(normalizeSectionData("PLAN_RACIKAN", { layers: [{ action: "REPLACE", material: { kind: "UNKNOWN" } }] }).layers[0].thicknessCm, null, "ketebalan boleh kosong (tidak dikarang)");
});

test("total tinggi: dari ketebalan yang diketahui; KEEP mewarisi catatan awal (dibaca); kosong = belum lengkap bukan 0", () => {
  const d = normalizeSectionData("PLAN_RACIKAN", { layers: [{ action: "REPLACE", material: manual("Busa A"), thicknessCm: 7 }, { action: "KEEP", fromOrder: 2 }, { action: "REPLACE", material: manual("Busa B") }] });
  const s = summarizeResultLayers(d, before.data);
  assert.deepEqual([s.totalThicknessCm, s.totalComplete, s.unknownThicknessCount], [11, false, 1]);
  assert.deepEqual(s.perLayer.map((l) => l.source), ["DICATAT", "DARI_CATATAN_AWAL", null]);
  assert.match(s.label, /belum lengkap/);
  const none = summarizeResultLayers(normalizeSectionData("PLAN_RACIKAN", { layers: [{ action: "REPLACE", material: manual("Busa A") }] }), null);
  assert.equal(none.totalThicknessCm, null); assert.match(none.label, /belum dicatat/);
  const full = summarizeResultLayers(normalizeSectionData("PLAN_RACIKAN", { layers: [{ action: "REPLACE", material: manual("Busa A"), thicknessCm: 5 }, { action: "REPLACE", material: manual("Busa B"), thicknessCm: 2.5 }] }));
  assert.deepEqual([full.totalThicknessCm, full.totalComplete], [7.5, true]);
  assert.equal(summarizeResultLayers(null), null);
});

test("rencana vs aktual: dibedakan; perbandingan hanya bila keduanya tercatat; selisih total dihitung, bukan dikarang", () => {
  const plan = { data: normalizeSectionData("PLAN_RACIKAN", { foundation: { action: "REPAIR", system: "BONNELL" }, layers: [{ action: "REPLACE", material: manual("Busa baru"), thicknessCm: 7 }, { action: "KEEP", fromOrder: 2 }] }), version: 2 };
  const only = buildComparison({ layersBefore: before, plan });
  assert.equal(only.status.plan, true); assert.equal(only.planVsActual.available, false); assert.match(only.planVsActual.reason, /aktual belum dicatat/i);
  assert.equal(only.actual, null); assert.deepEqual(only.gaps.map((g) => g.section), ["FOUNDATION_BEFORE", "AFTER"], "celah laporan lama tidak berubah oleh rencana");
  assert.equal(buildComparison({ layersBefore: before }).planVsActual.reason, "Rencana dan hasil aktual belum dicatat");

  const after = { data: normalizeSectionData("AFTER", { foundation: { action: "REPAIR", system: "BONNELL" }, layers: [{ action: "REPLACE", material: manual("Busa baru"), thicknessCm: 6 }, { action: "KEEP", fromOrder: 2 }, { action: "REPLACE", material: manual("Tambahan"), thicknessCm: 1 }] }), version: 1 };
  const c = buildComparison({ layersBefore: before, plan, after });
  assert.deepEqual(c.planVsActual.layers.map((l) => [l.status, l.diffs.join("+")]), [["BERBEDA", "KETEBALAN"], ["SAMA", ""], ["HANYA_AKTUAL", ""]]);
  assert.equal(c.planVsActual.foundation.status, "SAMA");
  assert.deepEqual(c.planVsActual.total, { planCm: 11, actualCm: 11, planComplete: true, actualComplete: true, differenceCm: 0 });
  assert.equal(c.plan.version, 2); assert.equal(c.actual.version, 1);
  assert.equal(c.final.layers.length, 3, "ringkasan hasil akhir lama (Sebelum->Sesudah) tidak berubah");
});

test("atribut katalog: hanya yang tersedia; kosong tidak ditampilkan/dikarang; manual & tidak diketahui tetap sah", () => {
  const full = materialAttributes({ kind: "CATALOG", materialId: "m1", code: "FOAM-1", name: "Busa HR", unit: "PCS", supplier: "CV Busa", itemGroup: "HR FOAM" });
  assert.deepEqual(full.map((a) => a.key), ["code", "name", "unit", "supplier", "itemGroup"]);
  assert.deepEqual(materialAttributes({ kind: "CATALOG", code: "X", name: "Y", unit: "KG" }).map((a) => a.key), ["code", "name", "unit"], "tanpa supplier/kelompok");
  assert.equal(materialAttributes({ kind: "CATALOG", code: "X", name: "Y", unit: "KG" }).some((a) => ["density", "thicknessCm"].includes(a.key)), false, "densitas/ketebalan katalog tidak ada di master -> tidak muncul");
  assert.equal(materialAttributes({ kind: "CATALOG", code: "X", name: "Y", unit: "KG", density: 44 }).find((a) => a.key === "density").value, "44", "muncul bila ada datanya");
  assert.deepEqual(materialAttributes(manual("Latex bekas")).map((a) => a.value), ["Latex bekas", "Belum terhubung katalog"]);
  assert.equal(materialAttributes({ kind: "UNKNOWN" })[0].value, "Tidak diketahui"); assert.deepEqual(materialAttributes(null), []);
});

test("kontrak sumber: rencana/aktual tidak menyentuh stok-BOM-issue; PIC Bahan LAYANAN memakai command & tabel jalur pengerjaan (tanpa tabel baru)", () => {
  const src = (f) => fs.readFileSync(path.join(here, "..", "src", f), "utf8");
  const note = src("services/productionComponentNoteService.js");
  assert.doesNotMatch(note.replace(/\/\/.*$/gm, ""), /stockMovement|materialIssue|plannedBOMLine|materialReservation|productionMaterialReturn/, "catatan komponen bukan penulis stok/BOM/issue/retur");
  const build = src("services/productionBuildCommandService.js");
  assert.match(build, /allowRestoration: true/); assert.match(build, /BUILD_RACIKAN_NOT_APPLICABLE_LAYANAN/);
  const schema = fs.readFileSync(path.join(here, "..", "prisma", "schema.prisma"), "utf8");
  assert.doesNotMatch(schema, /model\s+\w*(PlanRacikan|RacikanRencana|LayananMaterial)\w*/i, "tidak ada tabel paralel untuk racikan/PIC Bahan LAYANAN");
});

test("dokumentasi TIDAK wajib pada analisis/racikan: PLAN_RACIKAN tanpa minimal media; foto opsional (maks 8)", () => {
  assert.equal(COMPONENT_SECTIONS.PLAN_RACIKAN.minMedia ?? 0, 0);
  assert.equal(B2.maxMediaFor("PLAN_RACIKAN"), 8);
  assert.deepEqual(B2.normalizeMediaItems([], { kindOf: () => "image", section: "PLAN_RACIKAN" }), []);
});
