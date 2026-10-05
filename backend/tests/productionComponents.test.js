// Simplifikasi Production slice 3 — kontrak MURNI Catatan Komponen (tanpa DB): normalisasi/validasi, perbandingan Sebelum→Sesudah, KEPEMILIKAN penulis tabel,
// larangan menyentuh stok/BOM/lifecycle, dan migration aditif.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildComparison, normalizeMaterialRef, normalizeMediaItems, normalizeSectionData, materialLabel } from "../src/lib/domain/productionComponents.js";
import { componentMessageLines } from "../src/services/productionComponentNoteService.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, "..", ...p), "utf8");
const U = "11111111-1111-4111-8111-111111111111";
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
const L = (condition = "BAIK", material = { kind: "UNKNOWN" }, extra = {}) => ({ material, condition, ...extra });

test("bahan: katalog (id), Bahan manual (teks >= 2), Tidak diketahui; ref tidak valid ditolak; snapshot katalog bukan dari klien", () => {
  assert.deepEqual(normalizeMaterialRef({ kind: "CATALOG", materialId: U.toUpperCase(), name: "PALSU", code: "X" }, { field: "f" }), { kind: "CATALOG", materialId: U }, "nama/kode dari klien dibuang");
  assert.deepEqual(normalizeMaterialRef({ kind: "MANUAL", text: "  Kapuk  " }, { field: "f" }), { kind: "MANUAL", text: "Kapuk" });
  assert.deepEqual(normalizeMaterialRef({ kind: "UNKNOWN", text: "abaikan" }, { field: "f" }), { kind: "UNKNOWN" });
  assert.equal(code(() => normalizeMaterialRef({ kind: "MANUAL", text: "x" }, { field: "f" })), "COMPONENT_MANUAL_TEXT_REQUIRED");
  assert.equal(code(() => normalizeMaterialRef({ kind: "CATALOG", materialId: "bukan-uuid" }, { field: "f" })), "COMPONENT_MATERIAL_INVALID");
  assert.equal(code(() => normalizeMaterialRef({ kind: "AJAIB" }, { field: "f" })), "COMPONENT_MATERIAL_KIND_INVALID");
  assert.equal(code(() => normalizeMaterialRef(null, { field: "f" })), "COMPONENT_MATERIAL_REQUIRED"); assert.equal(normalizeMaterialRef(null, { field: "f", required: false }), null);
  assert.equal(materialLabel({ kind: "MANUAL", text: "Kapuk" }), "Bahan manual: Kapuk"); assert.equal(materialLabel({ kind: "UNKNOWN" }), "Tidak diketahui"); assert.equal(materialLabel({ kind: "CATALOG", name: "Busa", code: "B1" }), "Busa (B1)");
});

test("seksi LAYERS_BEFORE: >=1 lapisan ATAU 'tidak diketahui' (tidak keduanya); ketebalan opsional 0–100; kondisi wajib (boleh Tidak diketahui); urutan = urutan array", () => {
  const ok = normalizeSectionData("LAYERS_BEFORE", { layers: [L("KEMPES", { kind: "MANUAL", text: "Busa lama" }, { thicknessCm: "5,5", note: " n " }), L("TIDAK_DIKETAHUI")], note: " umum " });
  assert.deepEqual(ok, { layersUnknown: false, layers: [{ material: { kind: "MANUAL", text: "Busa lama" }, thicknessCm: 5.5, condition: "KEMPES", note: "n" }, { material: { kind: "UNKNOWN" }, thicknessCm: null, condition: "TIDAK_DIKETAHUI", note: null }], note: "umum" });
  assert.deepEqual(normalizeSectionData("LAYERS_BEFORE", { layersUnknown: true, layers: [] }), { layersUnknown: true, layers: [], note: null });
  assert.equal(code(() => normalizeSectionData("LAYERS_BEFORE", { layers: [] })), "COMPONENT_LAYERS_REQUIRED");
  assert.equal(code(() => normalizeSectionData("LAYERS_BEFORE", { layersUnknown: true, layers: [L()] })), "COMPONENT_INVALID");
  assert.equal(code(() => normalizeSectionData("LAYERS_BEFORE", { layers: Array.from({ length: 13 }, () => L()) })), "COMPONENT_TOO_MANY_LAYERS");
  assert.equal(code(() => normalizeSectionData("LAYERS_BEFORE", { layers: [L("AJAIB")] })), "COMPONENT_CONDITION_REQUIRED");
  for (const t of [0, -1, 101, "abc"]) assert.equal(code(() => normalizeSectionData("LAYERS_BEFORE", { layers: [L("BAIK", undefined, { thicknessCm: t })] })), "COMPONENT_THICKNESS_INVALID", String(t));
  assert.equal(code(() => normalizeSectionData("LAYERS_BEFORE", { layers: [L("BAIK", undefined, { note: "x".repeat(301) })] })), "COMPONENT_TEXT_TOO_LONG");
});

test("seksi FOUNDATION_BEFORE & AFTER: sistem/kondisi wajib; tindakan wajib; diganti butuh sistem; dipertahankan tanpa bahan boleh; AFTER kosong ditolak", () => {
  assert.deepEqual(normalizeSectionData("FOUNDATION_BEFORE", { system: "BONNELL", condition: "RUSAK", material: { kind: "UNKNOWN" } }), { system: "BONNELL", material: { kind: "UNKNOWN" }, condition: "RUSAK", note: null });
  assert.equal(code(() => normalizeSectionData("FOUNDATION_BEFORE", { condition: "BAIK" })), "COMPONENT_SYSTEM_REQUIRED");
  assert.equal(code(() => normalizeSectionData("FOUNDATION_BEFORE", { system: "AJAIB", condition: "BAIK" })), "COMPONENT_SYSTEM_INVALID");
  const a = normalizeSectionData("AFTER", { foundation: { action: "KEEP" }, layers: [{ action: "KEEP", fromOrder: 2 }, { action: "REPLACE", material: { kind: "MANUAL", text: "Lateks" }, thicknessCm: 3 }] });
  assert.deepEqual(a.foundation, { action: "KEEP", system: null, material: null, note: null }); assert.equal(a.layers[0].fromOrder, 2); assert.equal(a.layers[0].material, null);
  assert.equal(code(() => normalizeSectionData("AFTER", { foundation: { action: "REPLACE" } })), "COMPONENT_SYSTEM_REQUIRED");
  assert.equal(code(() => normalizeSectionData("AFTER", { layers: [{ action: "REPAIR" }] })), "COMPONENT_MATERIAL_REQUIRED");
  assert.equal(code(() => normalizeSectionData("AFTER", { layers: [] })), "COMPONENT_AFTER_EMPTY");
  assert.equal(code(() => normalizeSectionData("AFTER", { layers: [{ action: "KEEP", fromOrder: 99 }] })), "COMPONENT_INVALID");
  assert.equal(code(() => normalizeSectionData("NGAWUR", {})), "COMPONENT_SECTION_INVALID"); assert.equal(code(() => normalizeSectionData("AFTER", [])), "COMPONENT_INVALID");
});

test("foto: hanya gambar dari store bukti, tanpa duplikat, maks 8, keterangan dipangkas", () => {
  const kindOf = (u) => (u.startsWith("/media/production-evidence/") ? (u.endsWith(".mp4") ? "video" : "image") : null);
  assert.deepEqual(normalizeMediaItems([{ url: "/media/production-evidence/a.png", caption: " c " }, "/media/production-evidence/b.png"], { kindOf }).map((m) => [m.url, m.caption, m.order]), [["/media/production-evidence/a.png", "c", 1], ["/media/production-evidence/b.png", null, 2]]);
  assert.equal(code(() => normalizeMediaItems([{ url: "/media/production-evidence/v.mp4" }], { kindOf })), "COMPONENT_MEDIA_INVALID", "video ditolak");
  assert.equal(code(() => normalizeMediaItems([{ url: "/lain/a.png" }], { kindOf })), "COMPONENT_MEDIA_INVALID");
  assert.equal(code(() => normalizeMediaItems([{ url: "/media/production-evidence/a.png" }, { url: "/media/production-evidence/a.png" }], { kindOf })), "COMPONENT_MEDIA_DUPLICATE");
  assert.equal(code(() => normalizeMediaItems(Array.from({ length: 9 }, (_, i) => ({ url: `/media/production-evidence/${i}.png` })), { kindOf })), "COMPONENT_TOO_MANY_MEDIA");
  assert.deepEqual(normalizeMediaItems(null, { kindOf }), []);
});

const cat = (name, code) => ({ kind: "CATALOG", materialId: U, name, code });
const entry = (data) => ({ data, version: 1 });

test("perbandingan: tanpa catatan = kosong + 3 celah; sebagian = celah tepat; tahap dilewati tidak menghasilkan baris", () => {
  const none = buildComparison({});
  assert.deepEqual([none.recordedAny, none.complete, none.gaps.length, none.layers.length, none.foundation], [false, false, 3, 0, null]);
  const onlyBefore = buildComparison({ layersBefore: entry({ layers: [{ material: cat("Busa", "B1"), thicknessCm: 5, condition: "AUS", note: null }] }) });
  assert.deepEqual(onlyBefore.gaps.map((g) => g.section), ["FOUNDATION_BEFORE", "AFTER"]);
  assert.deepEqual(onlyBefore.layers.map((r) => [r.outcome, r.final]), [["UNRECORDED", null]], "tanpa hasil akhir karangan");
  assert.equal(onlyBefore.layers[0].before.thicknessCm, 5); assert.equal(onlyBefore.layers[0].before.conditionLabel, "Aus / menipis");
});

test("perbandingan lengkap: dipertahankan/diperbaiki/diganti, fromOrder, komponen tetap digunakan, lapisan lama yang tak muncul di hasil akhir", () => {
  const before = entry({ layers: [{ material: cat("Busa A", "A"), thicknessCm: 5, condition: "KEMPES" }, { material: { kind: "MANUAL", text: "Kapuk" }, thicknessCm: null, condition: "AUS" }, { material: { kind: "UNKNOWN" }, thicknessCm: null, condition: "TIDAK_DIKETAHUI" }] });
  const f = entry({ system: "BONNELL", material: null, condition: "RUSAK" });
  const after = entry({ foundation: { action: "REPLACE", system: "POCKET_SPRING", material: cat("Pocket", "PS"), note: null }, layers: [{ action: "REPLACE", fromOrder: null, material: cat("Busa Baru", "N"), thicknessCm: 6 }, { action: "KEEP", fromOrder: 2, material: null, thicknessCm: null }] });
  const c = buildComparison({ layersBefore: before, foundationBefore: f, after });
  assert.equal(c.complete, true); assert.deepEqual(c.gaps, []);
  assert.deepEqual(c.layers.map((r) => r.outcome), ["REPLACED", "KEPT", "NOT_IN_FINAL"]);
  assert.equal(c.layers[0].final.label, "Busa Baru (N)"); assert.equal(c.layers[0].final.thicknessCm, 6);
  assert.equal(c.layers[1].final.label, "Bahan manual: Kapuk"); assert.deepEqual(c.kept, ["Lapisan 2: Bahan manual: Kapuk"]);
  assert.equal(c.layers[2].before.material, "Tidak diketahui"); assert.equal(c.layers[2].final, null);
  assert.equal(c.foundation.outcome, "REPLACED"); assert.match(c.foundation.final.label, /Pocket spring/); assert.equal(c.foundation.before.systemLabel, "Per bonnell");
  assert.deepEqual(c.final.layers, ["Busa Baru (N)", "Bahan manual: Kapuk"]);
  // REPAIR memakai bahan lama bila tidak ada bahan baru
  const rep = buildComparison({ layersBefore: before, after: entry({ layers: [{ action: "REPAIR", fromOrder: 1, material: null, thicknessCm: null }] }) });
  assert.equal(rep.layers[0].outcome, "REPAIRED"); assert.match(rep.layers[0].final.label, /Busa A \(A\) \(diperbaiki\)/); assert.equal(rep.layers[0].final.thicknessCm, 5);
  // KEEP tanpa data sebelum: tidak dikarang
  const keep = buildComparison({ after: entry({ foundation: { action: "KEEP" }, layers: [{ action: "KEEP" }] }) });
  assert.match(keep.layers[0].final.label, /bahan lama belum dicatat/); assert.equal(keep.layers[0].before, null); assert.equal(keep.layers[0].beforeRecorded, false); assert.match(keep.foundation.final.label, /fondasi lama belum dicatat/);
});

test("pesan Sales: ringkas Sebelum→Sesudah, menyebut data belum dicatat; kosong bila tak ada catatan", () => {
  assert.deepEqual(componentMessageLines(buildComparison({})), []);
  const lines = componentMessageLines(buildComparison({ layersBefore: entry({ layers: [{ material: cat("Busa A", "A"), thicknessCm: 5, condition: "AUS" }] }), after: entry({ layers: [{ action: "KEEP", material: null }] }) })).join("\n");
  assert.match(lines, /KOMPONEN SEBELUM → SESUDAH/); assert.match(lines, /Lapisan 1: Busa A \(A\) 5 cm → Busa A \(A\) 5 cm \(Dipertahankan\)/); assert.match(lines, /Tetap digunakan: Lapisan 1/); assert.match(lines, /Fondasi sebelum dibongkar belum dicatat/);
});

function walkSrc(dir, out = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walkSrc(p, out); else if (/\.js$/.test(e.name)) out.push(p); } return out; }

test("KEPEMILIKAN: tabel catatan komponen hanya ditulis productionComponentNoteService; service tidak menyentuh stok/BOM/reservasi/issue/retur/fase/status/revisi run", () => {
  const files = walkSrc(path.join(here, "..", "src")).map((p) => [path.relative(path.join(here, ".."), p).split(path.sep).join("/"), fs.readFileSync(p, "utf8")]);
  const code = (t) => t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const writers = files.filter(([, t]) => /\.unitComponentEntry\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(code(t))).map(([f]) => f);
  assert.deepEqual(writers, ["src/services/productionComponentNoteService.js"]);
  assert.deepEqual(files.filter(([, t]) => /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?unit_component_entries_v2/i.test(code(t))).map(([f]) => f), [], "tidak ada SQL tulis langsung");
  const svc = code(read("src", "services", "productionComponentNoteService.js"));
  assert.doesNotMatch(svc, /postStockMovement|\.stockMovement\.|\.materialReservation\.|\.materialIssue|\.plannedBOMLine|\.productionMaterialReturn|\.productionMaterialShortage|\.productionRun\.(update|updateMany)|\.productionPhaseRun|\.productionOperationRun|\.productionStepEvidence\.(create|update|delete)|\.unit\.(update|updateMany)|\.finJournal/, "informasi saja");
  assert.doesNotMatch(svc, /inventoryLedger\.js"[^;]*postStockMovement/);
  const upd = (svc.match(/[A-Za-z0-9_.]*\.update\(/g) || []).filter((u) => !/createHash|sha256/.test(u) && u !== ".update(");
  assert.ok(upd.length >= 1 && upd.every((u) => /\.v2Command\.update\($/.test(u)), `hanya v2Command.update (menutup command) yang memutasi: ${upd.join(",")}`);
  assert.match(svc, /lockRowForUpdate\(tx, "units", unitId\)/); assert.match(svc, /COMPONENT_VERSION_CONFLICT/); assert.match(svc, /requestHash/);
  const route = code(read("src", "routes", "productionComponentNotes.js"));
  assert.match(route, /requireAnyPermission\(\.\.\.WRITE_PERMS\)/); assert.match(route, /const WRITE_PERMS = \[P\.UNIT_STAGE_WRITE, P\.PRODUCTION_DOCUMENTATION_WRITE\]/);
});

test("migration slice 3 aditif: satu tabel baru + indeks + FK; tanpa DROP/UPDATE/DELETE/TRUNCATE; LF; versi/seksi dijaga CHECK", () => {
  const dir = path.join(here, "..", "prisma", "migrations");
  const name = fs.readdirSync(dir).find((d) => d.endsWith("production_component_notes_slice3"));
  const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8"); const c = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(c, /\b(DROP|DELETE\s+FROM|TRUNCATE|UPDATE\s+"?\w+"?\s+SET|ALTER\s+TABLE\s+"(?!unit_component_entries_v2)\w+")/i);
  assert.match(c, /CREATE TABLE "unit_component_entries_v2"/); assert.match(c, /UNIQUE INDEX "unit_component_entries_v2_unit_id_section_version_key"/); assert.match(c, /CHECK \("section" IN \('LAYERS_BEFORE', 'FOUNDATION_BEFORE', 'AFTER'\)\)/);
  assert.match(c, /REFERENCES "units"\("id"\) ON DELETE RESTRICT/); assert.equal((c.match(/CREATE TABLE/g) || []).length, 1);
  assert.equal(/\r/.test(sql), false, "LF");
});
