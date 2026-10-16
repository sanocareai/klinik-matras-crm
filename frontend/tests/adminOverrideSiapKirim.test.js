// "Admin override: Siap Kirim saat pencatatan produksi belum selesai" (keputusan Admin/Owner, BUKAN klaim pemeriksaan/QC). Pola proyek: fungsi murni dieksekusi dari modul; kontrak tampilan lewat text-scan sumber.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AO_JUDUL, AO_LABEL_RUN_BELUM_DITUTUP, AO_PERNYATAAN, aoAlasanSaklarValid, aoBolehAdmin, aoBolehKirim, aoKunciBaru, aoParseKodeUnit, aoRingkasSaklar, aoSaklarMengizinkan, aoUnitBisaDiOverride } from "../src/features/production/adminOverrideSiapKirimLogic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const src = (...p) => read("src", ...p);

test("aoBolehAdmin: hanya Admin/Owner (multi-role)", () => {
  assert.equal(aoBolehAdmin(["ADMIN"]), true); assert.equal(aoBolehAdmin(["SALES", "OWNER"]), true);
  for (const r of [["PRODUCTION_LEAD"], ["DISPATCHER"], ["WAREHOUSE", "PRODUCTION_WORKER"], [], null, undefined]) assert.equal(aoBolehAdmin(r), false, JSON.stringify(r));
});

test("aoUnitBisaDiOverride: hanya unit yang masih dikerjakan Produksi (bukan siap/berangkat/terkirim/batal)", () => {
  for (const s of ["RECEIVED", "IN_PRODUCTION"]) assert.equal(aoUnitBisaDiOverride({ status: s }), true, s);
  for (const s of ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED", "CANCELLED", "AWAITING_PICKUP", undefined]) assert.equal(aoUnitBisaDiOverride({ status: s }), false, String(s));
  assert.equal(aoUnitBisaDiOverride(null), false);
});

test("aoBolehKirim: pratinjau layak + kode diketik ulang persis + lokasi pengambilan + alasan >= 10 + pernyataan override; TANPA pemeriksa/centang pemeriksaan fisik", () => {
  const ok = { eligible: true, aktif: true, kodeDiketik: " RES-1-U1 ", kodeUnit: "RES-1-U1", locationId: "loc", alasan: "owner menetapkan siap kirim", konfirmasi: true, sibuk: false };
  assert.equal(aoBolehKirim(ok), true);
  for (const o of [{ eligible: false }, { aktif: false }, { aktif: undefined }, { kodeDiketik: "RES-1-U2" }, { kodeDiketik: "" }, { locationId: "" }, { alasan: "sudah" }, { alasan: "x".repeat(501) }, { konfirmasi: false }, { sibuk: true }]) assert.equal(aoBolehKirim({ ...ok, ...o }), false, JSON.stringify(o));
});

test("aoKunciBaru: unik dan sesuai pola Idempotency-Key server", () => {
  const a = aoKunciBaru(); const b = aoKunciBaru();
  assert.notEqual(a, b); assert.match(a, /^[A-Za-z0-9._:-]{12,128}$/);
});

test("teks: judul + label + pernyataan menyebut KEPUTUSAN Admin dan TIDAK mengklaim pemeriksaan fisik/QC", () => {
  assert.equal(AO_JUDUL, "Admin override: Siap Kirim saat pencatatan produksi belum selesai");
  assert.equal(AO_LABEL_RUN_BELUM_DITUTUP, "Admin override: Siap Kirim — pencatatan produksi belum selesai (Run belum ditutup)");
  assert.match(AO_PERNYATAAN, /Admin\) menetapkan unit ini siap untuk proses pengiriman saat pencatatan produksi belum selesai/); assert.match(AO_PERNYATAAN, /bukan hasil pemeriksaan atau QC/);
});

const DIALOG = src("features", "production", "AdminOverrideSiapKirim.jsx");
const LOGIKA = src("features", "production", "adminOverrideSiapKirimLogic.js");
const DRAWER = src("features", "production", "UnitOverviewDrawer.jsx");
const ORDER = src("features", "orders", "OrderTimelineDrawer.jsx");
const KARTU = src("features", "production", "UnitCard.jsx");
const API = src("api.js");
const BADGES = src("features", "armada", "components", "JobBadges.jsx");
const RUTE = src("features", "armada", "components", "RouteCard.jsx");
const UNROUTED = src("features", "armada", "components", "UnroutedJobsPanel.jsx");

test("dialog: pratinjau server dulu; kode diketik ulang; lokasi pengambilan; alasan; pernyataan override; TANPA pemeriksa dan TANPA centang pemeriksaan fisik; galat server tampil; kunci diganti setelah galat; tanpa window.prompt", () => {
  assert.match(DIALOG, /api\.getProductionV2DeliveryRelease\(/); assert.match(DIALOG, /api\.releaseProductionV2UnitForDelivery\(/);
  for (const id of ["ao-kode", "ao-lokasi", "ao-alasan", "ao-verif", "ao-konfirmasi", "ao-galat", "ao-pratinjau", "ao-sukses", "ao-unit-lain"]) assert.match(DIALOG, new RegExp(`data-testid="${id}"`), id);
  assert.match(DIALOG, /adminOverrideConfirmed: true/); assert.match(DIALOG, /setKunci\(aoKunciBaru\(\)\)/); assert.doesNotMatch(DIALOG, /window\.(prompt|confirm|alert)/);
  assert.doesNotMatch(DIALOG, /physicalVerified|inspectorUserId|ao-pemeriksa|Pemeriksa fisik|sudah diperiksa|diperiksa langsung|pemeriksaan fisik<\/|dilihat langsung/i, "tidak ada isian/klaim pemeriksaan fisik");
  assert.doesNotMatch(LOGIKA, /physical|inspector|diperiksa/i);
  assert.match(DIALOG, /Lokasi pengambilan/); assert.match(DIALOG, /Unit lain pada order ini TIDAK ikut ditetapkan/); assert.match(DIALOG, /Tidak ada klaim pemeriksaan fisik atau QC/);
});

test("Route Planner: badge jujur 'override Admin' + lokasi pengambilan di kartu rute dan panel job; app Driver di branch OTA terpisah", () => {
  assert.match(BADGES, /export function OverrideAdminBadge/); assert.match(BADGES, /Siap Kirim — override Admin \(pencatatan produksi belum selesai\)/); assert.match(BADGES, /data-testid="badge-override-admin"/);
  assert.doesNotMatch(BADGES.slice(BADGES.indexOf("export function OverrideAdminBadge"), BADGES.indexOf("export function OverrideAdminBadge") + 900), /diperiksa|pemeriksaan|QC lulus/i);
  assert.match(RUTE, /<OverrideAdminBadge job=\{j\} \/>/); assert.match(UNROUTED, /<OverrideAdminBadge job=\{j\} \/>/);
});

test("pintu masuk: Unit 360 (tab Pekerjaan) dan drawer order di Sales, hanya Admin/Owner; label Produksi di kartu papan dan banner", () => {
  assert.match(DRAWER, /<AdminOverrideUnit360 d=\{d\} isAdmin=\{isAdminOwner\}/); assert.match(DRAWER, /isAdminOwner=\{rolesOf\(currentUserLocal\(\)\)\.some\(\(r\) => \["ADMIN", "OWNER"\]\.includes\(r\)\)\}/);
  assert.match(ORDER, /<AdminOverrideOrderPanel order=\{o\} isAdmin=\{bolehOverrideAdmin\}/); assert.match(ORDER, /bolehOverrideAdmin = Boolean\(o && .*isAdminUser/);
  assert.match(DIALOG, /data-testid="ao-banner"/); assert.match(KARTU, /view\.deliveryRelease/); assert.match(KARTU, /data-testid="ao-kartu-badge"/);
  assert.match(API, /getProductionV2DeliveryRelease: \(unitId\) => request\(`\/production-v2\/units\/\$\{unitId\}\/delivery-release`\)/);
  assert.match(API, /releaseProductionV2UnitForDelivery: .*"Idempotency-Key": idempotencyKey/s);
});

test("saklar: tombol dialog mati bila server bilang override tidak aktif; parse kode unit; alasan saklar; label ringkas", () => {
  assert.equal(aoSaklarMengizinkan({ overrideAktif: true }), true);
  for (const pv of [null, undefined, {}, { overrideAktif: false }, { overrideAktif: "true" }]) assert.equal(aoSaklarMengizinkan(pv), false, JSON.stringify(pv));
  assert.deepEqual(aoParseKodeUnit(" A-U1, B-U2\nA-U1 ,, "), ["A-U1", "B-U2"]); assert.deepEqual(aoParseKodeUnit(""), []); assert.equal(aoParseKodeUnit(Array.from({ length: 80 }, (_, i) => "K" + i).join(",")).length, 50);
  assert.equal(aoAlasanSaklarValid("pendek"), false); assert.equal(aoAlasanSaklarValid("menghentikan override baru"), true); assert.equal(aoAlasanSaklarValid("x".repeat(301)), false);
  assert.deepEqual(aoRingkasSaklar(null), { aktif: false, label: "Nonaktif" }); assert.deepEqual(aoRingkasSaklar({ enabled: false }), { aktif: false, label: "Nonaktif" });
  assert.equal(aoRingkasSaklar({ enabled: true, unitCodes: [] }).label, "Aktif — semua unit yang memenuhi syarat"); assert.match(aoRingkasSaklar({ enabled: true, unitCodes: ["A-U1"] }).label, /dibatasi: A-U1/);
});

test("UI saklar: dialog menampilkan blok saklar mati; kartu Pengaturan Produksi (hanya yang boleh menulis) memuat saklar+laporan dengan tindakan aman; API saklar/laporan terdaftar", () => {
  const SAKLAR = src("features", "production", "AdminOverrideSaklarCard.jsx"); const PENGATURAN = src("pages", "bengkel", "ProductionWorkflowSettings.jsx");
  assert.match(DIALOG, /data-testid="ao-saklar-mati"/); assert.match(DIALOG, /aktif: aoSaklarMengizinkan\(pv\)/);
  for (const id of ["ao-saklar-card", "ao-saklar-status", "ao-saklar-unit", "ao-saklar-alasan", "ao-saklar-aktifkan", "ao-saklar-hentikan", "ao-laporan", "ao-laporan-baris"]) assert.match(SAKLAR, new RegExp(`data-testid="${id}"`), id);
  assert.match(SAKLAR, /unit yang sudah dilepas, Run, dan audit tidak berubah/); assert.doesNotMatch(SAKLAR, /window\.(prompt|confirm|alert)/);
  assert.match(PENGATURAN, /\{canWrite && <AdminOverrideSaklarCard canWrite=\{canWrite\} \/>\}/);
  assert.match(API, /getAdminOverrideSwitch: \(\) => request\("\/production-v2\/admin-override\/switch"\)/); assert.match(API, /setAdminOverrideSwitch: \(data\) => request\("\/production-v2\/admin-override\/switch", \{ method: "PUT"/); assert.match(API, /getAdminOverrideReport/);
});
