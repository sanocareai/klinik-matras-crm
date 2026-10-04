// P12D — desain modern Aplikasi Dokumentasi: model tampilan murni (dieksekusi langsung) + kontrak komponen (pola text-scan proyek ini, tanpa jsdom).
// Kontrak matriks/minimum/kekurangan tetap milik backend (tes paritas ada di documentationApp.test.js); di sini dijaga: tidak ada store/antrean paralel,
// tidak ada API yang mengubah tahap/status, bottom nav maks. 4, aksi tulis hanya lewat canWrite server, dan pembersihan Blob/isolasi draf tidak disentuh.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOC_NAV_TABS, DOC_TAB_KEYS, DOC_GROUP_KEYS, docCompleteness, docGroupOf, docStatusChip, docTabOf, groupStats, missingTotal, sortForCamera, suggestCategory, thumbMeta,
} from "../src/features/production/documentation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..", "src");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (...p) => strip(fs.readFileSync(path.join(SRC, ...p), "utf8"));
const DOC_DIR = path.join(SRC, "features", "production", "docApp");
const DOC_FILES = fs.readdirSync(DOC_DIR).filter((f) => f.endsWith(".jsx")).map((f) => [f, read("features", "production", "docApp", f)]);
const PAGE = read("pages", "produksi", "ProductionDocumentation.jsx");
const ALL = PAGE + "\n" + DOC_FILES.map(([, s]) => s).join("\n");

const cat = (key, group, extra = {}) => ({ key, label: key, group, applicable: true, min: 2, count: 2, missing: 0, status: "LENGKAP", items: [], history: [], ...extra });
const CATS = [
  cat("B1", "BEFORE"), cat("B2", "BEFORE", { count: 0, missing: 2, status: "KURANG" }),
  cat("P1", "PROCESS", { status: "KURANG", count: 1, missing: 1 }), cat("P2", "PROCESS", { applicable: false, status: "NA" }),
  cat("A1", "AFTER", { count: 0, status: "MENUNGGU" }),
];

test("bottom navigation: tepat 4 tab (Unit, Kamera, Draf, Akun); tab tak dikenal jatuh ke Unit; kelompok tak dikenal jatuh ke Before", () => {
  assert.deepEqual(DOC_NAV_TABS.map((t) => t.label), ["Unit", "Kamera", "Draf", "Akun"]);
  assert.ok(DOC_NAV_TABS.length <= 4); assert.deepEqual([...DOC_TAB_KEYS], ["unit", "kamera", "draf", "akun"]);
  for (const bad of [null, undefined, "", "meja", "x"]) assert.equal(docTabOf(bad), "unit");
  for (const t of DOC_TAB_KEYS) assert.equal(docTabOf(t), t);
  assert.deepEqual([...DOC_GROUP_KEYS], ["BEFORE", "PROCESS", "AFTER"]); assert.equal(docGroupOf("zzz"), "BEFORE"); assert.equal(docGroupOf("AFTER"), "AFTER");
});

test("kelengkapan & chip status dari angka SERVER (tidak dihitung ulang): lengkap / kurang N / belum dimulai / berjalan", () => {
  assert.deepEqual(docCompleteness({ required: 12, satisfied: 9 }), { required: 12, satisfied: 9, pct: 75 });
  assert.equal(docCompleteness({ required: 0, satisfied: 0 }).pct, 0); assert.equal(docCompleteness({ required: 4, satisfied: 9 }).pct, 100); assert.equal(docCompleteness(null).pct, 0);
  assert.equal(missingTotal([{ missing: 2 }, { missing: 3 }]), 5); assert.equal(missingTotal(undefined), 0);
  const item = (docs) => ({ docs: { flags: {}, missing: [], ...docs } });
  assert.deepEqual(docStatusChip(item({ flags: { lengkap: true } })), { key: "LENGKAP", label: "Lengkap", tone: "green" });
  assert.deepEqual(docStatusChip(item({ missing: [{ missing: 2 }, { missing: 1 }] })), { key: "KURANG", label: "Kurang 3 foto", tone: "red" });
  assert.equal(docStatusChip(item({ flags: { belumDimulai: true } })).key, "BELUM");
  assert.equal(docStatusChip(item({})).key, "BERJALAN");
  assert.equal(docStatusChip({}).key, "BERJALAN", "tanpa data docs tidak melempar");
});

test("segmen Before/Proses/After: ringkasan hanya kategori yang berlaku; saran 'Ambil Foto' = kekurangan pertama di kelompok, lalu fallback", () => {
  assert.deepEqual(groupStats(CATS, "BEFORE"), { applicable: 2, missing: 2, photos: 2 });
  assert.deepEqual(groupStats(CATS, "PROCESS"), { applicable: 1, missing: 1, photos: 1 }, "kategori tidak berlaku tidak dihitung");
  assert.deepEqual(groupStats(CATS, "AFTER"), { applicable: 1, missing: 0, photos: 0 });
  assert.equal(suggestCategory(CATS, "BEFORE").key, "B2", "kekurangan pertama di kelompok");
  assert.equal(suggestCategory(CATS, "PROCESS").key, "P1");
  assert.equal(suggestCategory(CATS, "AFTER").key, "A1", "tanpa kekurangan: kategori berlaku pertama di kelompok");
  const none = [cat("P2", "PROCESS", { applicable: false, status: "NA" }), cat("B2", "BEFORE", { missing: 1, status: "KURANG" })];
  assert.equal(suggestCategory(none, "PROCESS").key, "B2", "kelompok kosong: kekurangan pertama di mana pun");
  assert.equal(suggestCategory([cat("X", "AFTER", { applicable: false })], "AFTER"), null); assert.equal(suggestCategory([], "BEFORE"), null); assert.equal(suggestCategory(undefined, "BEFORE"), null);
});

test("thumbnail: sumber, waktu, pengunggah dari item server apa adanya (tanpa mengarang); urutan kamera = kurang terbanyak dulu, stabil", () => {
  const m = thumbMeta({ source: "QC", createdAt: "2026-10-02T03:04:00Z", actorName: "Sari" });
  assert.equal(m.source, "QC"); assert.equal(m.actor, "Sari"); assert.match(m.time, /\d/);
  assert.deepEqual(thumbMeta({}), { source: "—", time: "—", actor: "—" });
  assert.equal(thumbMeta({ source: "DRIVER_PICKUP" }).source, "Driver Pickup");
  const u = (id, ...ms) => ({ id, docs: { missing: ms.map((n) => ({ missing: n })) } });
  assert.deepEqual(sortForCamera([u("a"), u("b", 1), u("c", 3), u("d", 1)]).map((x) => x.id), ["c", "b", "d", "a"]);
  assert.deepEqual(sortForCamera(undefined), []);
});

test("tanpa store/antrean paralel: layar dokumentasi tidak menyentuh IndexedDB/localStorage/XHR/fetch sendiri; unggah & kirim hanya lewat draf manager yang ada", () => {
  for (const [name, src] of DOC_FILES) {
    assert.doesNotMatch(src, /indexedDB|localStorage|sessionStorage|XMLHttpRequest|\bfetch\(/, `${name}: tidak boleh punya penyimpanan/jaringan sendiri`);
    assert.doesNotMatch(src, /api\.(upload|submit|correct)ProductionV2Documentation/, `${name}: unggah/kirim hanya lewat manager (documentationDrafts)`);
  }
  assert.doesNotMatch(PAGE, /indexedDB|XMLHttpRequest|\bfetch\(/);
  assert.match(PAGE, /localStorage\.getItem\("user"\)/, "satu-satunya akses: membaca pengguna seperti WorkerLane");
  const detail = Object.fromEntries(DOC_FILES)["DocDetail.jsx"];
  assert.match(detail, /<CaptureSheet manager=\{drafts\.manager\}/); assert.match(detail, /initialFiles=\{capture\.initialFiles\}/);
  const draftUi = read("features", "production", "DocumentationDraftUi.jsx");
  assert.match(draftUi, /manager\.addFiles\(r\.id, initialFiles\)/, "foto dari bilah aksi masuk ke draf yang sama");
  assert.match(draftUi, /manager\.queue\(rec\.id\)/);
});

test("dokumentasi tidak mengubah tahap/status produksi: tidak ada API tahap/QC/penugasan di layar; satu-satunya API baca = antrean & detail dokumentasi", () => {
  const apis = [...new Set([...ALL.matchAll(/\bapi\.(?!js\b)([A-Za-z0-9_]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(apis, ["getProductionV2DocDetail", "getProductionV2DocQueue"]);
  assert.doesNotMatch(ALL, /startUnitStage|completeUnitStage|pauseUnitStage|failUnitStage|qc|assignStage|production-v2\/runs|steps\//i);
  // bukti tersimpan immutable: tidak ada hapus/ubah bukti terkirim dari UI (koreksi = pengiriman versi baru lewat manager)
  assert.doesNotMatch(ALL, /deleteEvidence|removeEvidence|DELETE/);
  assert.match(DOC_FILES.find(([n]) => n === "DocDetail.jsx")[1], /Koreksi \{fmtDocTime\(b\.createdAt\)\}/);
});

test("aksi utama 'Ambil Foto': bilah aksi lengket hanya bila canWrite; kamera belakang + galeri multi + pilih kategori; dilindungi saat tak ada kategori", () => {
  const d = DOC_FILES.find(([n]) => n === "DocDetail.jsx")[1];
  assert.match(d, /const canWrite = !!detail\?\.canWrite && !!drafts\.manager/);
  assert.match(d, /\{canWrite && \(\s*<div className="wa-actionbar" data-testid="doc-actionbar">/);
  assert.match(d, /<Camera size=\{21\} aria-hidden \/> Ambil Foto/);
  assert.match(d, /accept="image\/\*" capture="environment" hidden disabled=\{!selKey\} onChange=\{onInput\} data-testid="bar-camera"/);
  assert.match(d, /accept="image\/\*" multiple hidden disabled=\{!selKey\} onChange=\{onInput\} data-testid="bar-gallery"/);
  assert.match(d, /aria-label="Kategori foto"/); assert.match(d, /data-testid="bar-category"/);
  assert.match(d, /role="tablist" aria-label="Kelompok dokumentasi"/);
  assert.match(d, /data-testid="readonly-note"/); assert.match(d, /!detail\.canWrite/);
  assert.match(d, /data-testid="thumb-meta"/, "sumber/waktu/pengunggah per thumbnail");
  assert.match(d, /data-testid="category-count"/); assert.match(d, /min \{cat\.min\} foto/);
});

test("kerangka Meja/Corner dipakai ulang: WorkerAppShell (tabs), JobPhoto, wa-card/wa-primary/wa-actionbar, AkunTab; tanpa sidebar desktop; tab Kamera/Draf/Akun ada", () => {
  const shell = read("features", "production", "workerApp", "WorkerAppShell.jsx");
  assert.match(shell, /tabs = NAV_TABS/, "default tab Meja/Corner tidak berubah");
  assert.doesNotMatch(shell, /sidebar/i);
  assert.match(PAGE, /<WorkerAppShell tabs=\{DOC_NAV_TABS\}/);
  assert.match(DOC_FILES.find(([n]) => n === "DocUnitCard.jsx")[1], /import \{ JobPhoto \} from "@\/features\/production\/workerApp\/JobCard\.jsx"/);
  const tabs = DOC_FILES.find(([n]) => n === "DocTabs.jsx")[1];
  for (const id of ["tab-unit", "tab-kamera", "tab-draf"]) assert.ok(tabs.includes(`data-testid="${id}"`), id);
  assert.match(tabs, /<AkunTab[^>]*currentKey="dokumentasi"/);
  assert.match(tabs, /<DraftPanel manager=\{manager\} records=\{records\} online=\{online\} onResume=\{onResume\} showEmpty/);
  assert.match(PAGE, /\?t=<unit\|kamera\|draf\|akun>&run=<runId>|docTabOf\(params\.get\("t"\)\)/);
});

test("pembersihan Blob & isolasi draf tidak disentuh: documentationDrafts.js tidak diubah oleh desain; object URL pratinjau tetap dilepas; logout membersihkan draf pengguna", () => {
  const ui = read("features", "production", "DocumentationDraftUi.jsx");
  assert.match(ui, /URL\.revokeObjectURL/); assert.match(ui, /createObjectURL/);
  assert.match(ui, /readPrincipal\(\)/); assert.match(ui, /principalId/);
  assert.match(read("App.jsx"), /purgePrincipalDrafts/);
  assert.match(DOC_FILES.find(([n]) => n === "DocTabs.jsx")[1], /Keluar menghapus draf milik akun ini dari HP/);
});
