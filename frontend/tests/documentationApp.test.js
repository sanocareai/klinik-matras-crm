// P10B Aplikasi Dokumentasi — logika murni klien (dieksekusi dari sumber), paritas label dengan kontrak backend, dan struktur layar/menu/route
// (pola text-scan proyek ini, tanpa jsdom).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOC_FILTERS, DOC_GROUP_LABEL, DOC_SOURCE_BADGE, DOC_SOURCE_LABEL, DOC_STATUS, docBatches, docFriendlyError, hasFailed, isRetryableDocError, isUploading, itemsForCorrection, rawMediaUrl, submitState, toSubmitItems,
} from "../src/features/production/documentation.js";
import { PRODUCTION_NAV } from "../src/lib/productionNav.js";
import { DOC_CATEGORIES, DOC_GROUPS, DOC_QUEUE_FILTERS, DOC_SOURCES } from "../../backend/src/lib/domain/productionDocumentation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const LAYOUT = read("components", "Layout.jsx");
const REGISTRY = read("routes", "pageRegistry.jsx");
const PAGE_ONLY = read("pages", "produksi", "ProductionDocumentation.jsx");
const DRAFT_UI = read("features", "production", "DocumentationDraftUi.jsx");
const PAGE = PAGE_ONLY + "\n" + DRAFT_UI;
const CAPTURE = read("features", "production", "components", "EvidenceCapture.jsx");
const DRAWER = read("features", "production", "UnitOverviewDrawer.jsx");
const REPORT = read("pages", "bengkel", "ProductionReportV2.jsx");
const API = read("api.js");
const PENGGUNA = read("pages", "Pengguna.jsx");

test("paritas dengan kontrak backend: sumber, kelompok, filter antrean, 12 kategori tidak digandakan di klien", () => {
  assert.deepEqual(DOC_SOURCE_LABEL, { ...DOC_SOURCES });
  assert.deepEqual(DOC_GROUP_LABEL, { ...DOC_GROUPS });
  assert.deepEqual(DOC_FILTERS.map((f) => f.key), [...DOC_QUEUE_FILTERS]);
  assert.deepEqual(DOC_FILTERS.map((f) => f.label), ["Semua", "Belum Dimulai", "Before Kurang", "Proses Kurang", "After Kurang", "Lengkap"]);
  assert.equal(DOC_CATEGORIES.length, 12);
  for (const k of Object.keys(DOC_SOURCES)) assert.ok(DOC_SOURCE_BADGE[k], `badge ${k}`);
  assert.deepEqual(Object.keys(DOC_STATUS).sort(), ["KURANG", "LENGKAP", "MENUNGGU", "NA"]);
  // Klien tidak menyalin daftar kategori: layar membaca categories dari server.
  assert.doesNotMatch(PAGE, /BEFORE_TEARDOWN|TEARDOWN_DIAGNOSIS|READY_TO_SHIP/);
});

test("toSubmitItems/submitState: hanya foto yang selesai terunggah, urutan layar, keterangan dipangkas; tombol kirim terkunci saat unggah/gagal/kosong/koreksi tanpa alasan", () => {
  const items = [
    { id: "a", status: "done", url: "/media/production-evidence/" + "a".repeat(40) + ".jpg", caption: "  Sudut kiri  " },
    { id: "b", status: "uploading", url: null },
    { id: "c", status: "done", url: "/media/production-evidence/" + "c".repeat(40) + ".jpg", caption: "" },
    { id: "d", status: "error", url: null },
  ];
  assert.deepEqual(toSubmitItems(items), [{ url: items[0].url, caption: "Sudut kiri", order: 1 }, { url: items[2].url, caption: undefined, order: 2 }]);
  assert.equal(isUploading(items), true); assert.equal(hasFailed(items), true);
  assert.match(submitState(items).reason, /Tunggu unggahan/);
  assert.match(submitState([items[0], items[3]]).reason, /gagal/);
  assert.match(submitState([]).reason, /minimal satu foto/);
  assert.deepEqual(submitState([items[0]]), { ok: true, count: 1 });
  assert.match(submitState([items[0]], { correcting: true, reason: "ab" }).reason, /Alasan koreksi/);
  assert.equal(submitState([items[0]], { correcting: true, reason: "foto tertukar" }).ok, true);
});

test("koreksi: foto lama ikut sebagai item selesai (URL kanonis), urut sesuai order; batch per pengiriman", () => {
  const signed = (n) => `/media/production-evidence/${String(n).repeat(40)}.jpg?exp=123&sig=abc`;
  const matrixItems = [
    { evidenceId: "e1", origin: "DOC", url: signed("b"), caption: "kedua", order: 2, kind: "image", createdAt: "2026-10-02T01:00:00Z", actorName: "Rudi", source: "MANUAL" },
    { evidenceId: "e1", origin: "DOC", url: signed("a"), caption: "pertama", order: 1, kind: "image", createdAt: "2026-10-02T01:00:00Z", actorName: "Rudi", source: "MANUAL" },
    { evidenceId: "s1", origin: "STEP", url: signed("c"), createdAt: "2026-10-02T00:00:00Z" },
    { evidenceId: "e2", origin: "DOC", url: signed("d"), order: 1, kind: "image", createdAt: "2026-10-02T02:00:00Z", source: "MANUAL" },
  ];
  const prefill = itemsForCorrection(matrixItems, "e1");
  assert.deepEqual(prefill.map((i) => [i.url, i.caption, i.status]), [[`/media/production-evidence/${"a".repeat(40)}.jpg`, "pertama", "done"], [`/media/production-evidence/${"b".repeat(40)}.jpg`, "kedua", "done"]]);
  assert.equal(prefill[0].previewUrl, signed("a"));
  assert.equal(rawMediaUrl(signed("a")), `/media/production-evidence/${"a".repeat(40)}.jpg`);
  assert.deepEqual(docBatches(matrixItems).map((b) => [b.evidenceId, b.count]), [["e1", 2], ["e2", 1]], "foto tahap (STEP) tidak bisa dikoreksi dari sini");
});

test("pesan galat ramah & aturan kunci idempoten: jaringan putus = coba lagi dengan kunci sama; ditolak server = kunci baru", () => {
  assert.match(docFriendlyError({ status: 0, code: "NETWORK" }), /Koneksi terputus/);
  assert.match(docFriendlyError({ status: 503, code: "DOC_WRITER_OFF" }), /belum aktif/);
  assert.match(docFriendlyError({ status: 409, code: "DOC_MEDIA_ALREADY_SUBMITTED" }), /sudah tercatat/);
  assert.match(docFriendlyError({ status: 409, code: "DOC_MEDIA_OTHER_UNIT" }), /unit lain/);
  assert.match(docFriendlyError({ status: 403 }), /izin/);
  assert.equal(docFriendlyError({ status: 400, message: "Pesan server" }), "Pesan server");
  assert.equal(isRetryableDocError({ status: 0 }), true); assert.equal(isRetryableDocError({ status: 502 }), true);
  assert.equal(isRetryableDocError({ status: 409 }), false); assert.equal(isRetryableDocError({ status: 403 }), false);
});

test("menu & route: Aplikasi Dokumentasi di 'MODE KERJA' sejajar Aplikasi Meja/Corner/Andon TV; halaman mandiri /produksi/dokumentasi", () => {
  const mode = PRODUCTION_NAV.find((sec) => sec.section === "MODE KERJA");
  assert.deepEqual(mode.items.map((x) => x.label), ["Aplikasi Meja", "Aplikasi Corner", "Aplikasi Dokumentasi", "Andon TV"]);
  assert.equal(mode.items.find((x) => x.label === "Aplikasi Dokumentasi").to, "/produksi/dokumentasi");
  assert.match(REGISTRY, /path: "\/produksi\/dokumentasi", render: \(\) => <DemoPage><ProductionDocumentation \/><\/DemoPage>/); // P12A: dibungkus Mode Demo (admin-only)
  const standalone = REGISTRY.slice(REGISTRY.indexOf("export const STANDALONE_PAGES"), REGISTRY.indexOf("export function standalonePageFor"));
  assert.ok(standalone.includes("/produksi/dokumentasi"), "mandiri (PWA), bukan halaman sidebar");
  assert.match(PENGGUNA, /PRODUCTION_DOCUMENTER: "Petugas Dokumentasi"/);
});

test("layar: filter 6 status + counts, pencarian customer/resi/unit, kartu lengkap, kamera-first + galeri, pratinjau/keterangan/urutan/hapus, tombol tulis hanya bila canWrite", () => {
  assert.match(PAGE, /aria-label="Cari customer, resi, atau kode unit"/);
  assert.match(PAGE, /role="tablist" aria-label="Saring antrean dokumentasi"/); assert.match(PAGE, /data\?\.counts\?\.\[f\.key\]/);
  for (const needle of ["item.unit.photoUrl", "item.customerName", "item.orderNumber", "item.services.sales", "item.services.technical", "item.step", "item.station", "item.pic.table", "item.progress", "item.docs.missing", "doc-summary"]) assert.ok(PAGE.includes(needle), needle);
  assert.match(PAGE, /<EvidenceCapture[\s\S]{0,600}imagesOnly withCaption reorderable/);
  assert.match(PAGE, /api\.uploadProductionV2Documentation\(runId, \[blob\], onProgress\)/);
  assert.match(PAGE, /canWrite && \(\s*<div className="flex flex-wrap gap-2">/);
  assert.match(PAGE, /detail\.canWrite/); assert.match(PAGE, /readonly-note/);
  assert.match(PAGE, /api\.submitProductionV2Documentation\(runId, body, key\)/);
  assert.match(PAGE, /api\.correctProductionV2Documentation\(runId, body, key\)/);
  assert.match(PAGE, /manager\.queue\(rec\.id\)/, "Kirim memasukkan draf persisten ke antrean (bukan POST langsung)");
  assert.match(PAGE, /onError=\{\(\) => setBroken\(true\)\}/, "gambar rusak -> fallback, bukan ikon pecah");
  assert.match(PAGE, /\[overflow-wrap:anywhere\]/, "nama panjang tidak meluap");
  assert.match(PAGE, /<StandaloneShell[\s\S]*? wide>/);
  assert.match(PAGE, /Dokumentasi \{item\.docs\.satisfied\}\/\{item\.docs\.required\}/);
  assert.doesNotMatch(PAGE, /orderValue|harga|payment|Rp/, "tanpa harga/pembayaran");
});

test("EvidenceCapture: perilaku bawaan bukti tahap TIDAK berubah (kamera-first, video, galeri, coba lagi); mode dokumentasi lewat prop opsional", () => {
  assert.match(CAPTURE, /accept="image\/\*" capture="environment"/);
  assert.match(CAPTURE, /accept="video\/\*" capture="environment"/);
  assert.match(CAPTURE, /api\.uploadProductionV2Evidence\(runId, \[prepared\], onProgress\)/, "pengunggah bukti tahap tetap default");
  assert.match(CAPTURE, /uploadFile \? await uploadFile\(runId, prepared, onProgress\)/);
  assert.match(CAPTURE, /!imagesOnly &&/); assert.match(CAPTURE, /withCaption &&/); assert.match(CAPTURE, /reorderable && items\.length > 1/);
  assert.match(CAPTURE, /aria-label="Keterangan foto"/); assert.match(CAPTURE, /data-testid="capture-retry"/);
});

test("Unit 360 & Laporan Produksi menampilkan sumber + keterangan dan matriks dokumentasi dari backend yang sama", () => {
  assert.match(DRAWER, /d\.documentation/); assert.match(DRAWER, /MatriksDokumentasi/); assert.match(DRAWER, /DOC_SOURCE_LABEL\[m\.source\]/);
  assert.match(DRAWER, /href="\/produksi\/dokumentasi"/);
  assert.match(REPORT, /SOURCE_LABEL\[m\.source\]/); assert.match(REPORT, /m\.documentation \? m\.stepLabel/);
  assert.match(API, /submitProductionV2Documentation:[\s\S]{0,200}\/production-v2\/documentation\/runs\/\$\{runId\}\/submit/);
  assert.match(API, /correctProductionV2Documentation:[\s\S]{0,200}\/production-v2\/documentation\/runs\/\$\{runId\}\/correct/);
  assert.match(API, /uploadWithProgress\("\/production-v2\/documentation\/upload", fd, onProgress\)/);
});

test("bukti VIDEO tidak dirender sebagai <img> (gambar pecah): MediaThumb memakai <video>, pratinjau besar memutar video; chip sumber ringkas di thumbnail", () => {
  assert.match(PAGE, /function MediaThumb[\s\S]{0,700}<video src=\{item\.url\} muted playsInline preload="metadata"/);
  assert.match(PAGE, /item\.kind !== "video"\) return <SafeImage/);
  assert.match(PAGE, /<video src=\{item\.url\} controls playsInline/);
  assert.match(PAGE, /<MediaThumb item=\{it\} alt=\{it\.caption \|\| cat\.label\} \/>/);
  assert.match(PAGE, /<SourceBadge source=\{it\.source\} compact \/>/);
});
