// "Admin override: Siap Kirim saat pencatatan produksi belum selesai" (keputusan Admin/Owner, BUKAN klaim pemeriksaan/QC). Pola proyek: fungsi murni dieksekusi dari modul; kontrak tampilan lewat text-scan sumber.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AO_JUDUL, AO_LABEL_RUN_BELUM_DITUTUP, AO_PERNYATAAN, aoBolehAdmin, aoBolehKirim, aoKunciBaru, aoUnitBisaDiOverride } from "../src/features/production/adminOverrideSiapKirimLogic.js";

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
  const ok = { eligible: true, kodeDiketik: " RES-1-U1 ", kodeUnit: "RES-1-U1", locationId: "loc", alasan: "owner menetapkan siap kirim", konfirmasi: true, sibuk: false };
  assert.equal(aoBolehKirim(ok), true);
  for (const o of [{ eligible: false }, { kodeDiketik: "RES-1-U2" }, { kodeDiketik: "" }, { locationId: "" }, { alasan: "sudah" }, { alasan: "x".repeat(501) }, { konfirmasi: false }, { sibuk: true }]) assert.equal(aoBolehKirim({ ...ok, ...o }), false, JSON.stringify(o));
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
const DRIVER = read("..", "driver-mobile", "src", "components", "JobCard.js");

test("dialog: pratinjau server dulu; kode diketik ulang; lokasi pengambilan; alasan; pernyataan override; TANPA pemeriksa dan TANPA centang pemeriksaan fisik; galat server tampil; kunci diganti setelah galat; tanpa window.prompt", () => {
  assert.match(DIALOG, /api\.getProductionV2DeliveryRelease\(/); assert.match(DIALOG, /api\.releaseProductionV2UnitForDelivery\(/);
  for (const id of ["ao-kode", "ao-lokasi", "ao-alasan", "ao-verif", "ao-konfirmasi", "ao-galat", "ao-pratinjau", "ao-sukses", "ao-unit-lain"]) assert.match(DIALOG, new RegExp(`data-testid="${id}"`), id);
  assert.match(DIALOG, /adminOverrideConfirmed: true/); assert.match(DIALOG, /setKunci\(aoKunciBaru\(\)\)/); assert.doesNotMatch(DIALOG, /window\.(prompt|confirm|alert)/);
  assert.doesNotMatch(DIALOG, /physicalVerified|inspectorUserId|ao-pemeriksa|Pemeriksa fisik|sudah diperiksa|diperiksa langsung|pemeriksaan fisik<\/|dilihat langsung/i, "tidak ada isian/klaim pemeriksaan fisik");
  assert.doesNotMatch(LOGIKA, /physical|inspector|diperiksa/i);
  assert.match(DIALOG, /Lokasi pengambilan/); assert.match(DIALOG, /Unit lain pada order ini TIDAK ikut ditetapkan/); assert.match(DIALOG, /Tidak ada klaim pemeriksaan fisik atau QC/);
});

test("Route Planner: badge jujur 'override Admin' + lokasi pengambilan di kartu rute dan panel job; app Driver menampilkan unit + lokasi pengambilan", () => {
  assert.match(BADGES, /export function OverrideAdminBadge/); assert.match(BADGES, /Siap Kirim — override Admin \(pencatatan produksi belum selesai\)/); assert.match(BADGES, /data-testid="badge-override-admin"/);
  assert.doesNotMatch(BADGES.slice(BADGES.indexOf("export function OverrideAdminBadge"), BADGES.indexOf("export function OverrideAdminBadge") + 900), /diperiksa|pemeriksaan|QC lulus/i);
  assert.match(RUTE, /<OverrideAdminBadge job=\{j\} \/>/); assert.match(UNROUTED, /<OverrideAdminBadge job=\{j\} \/>/);
  assert.match(DRIVER, /job\.overrideAdmin/); assert.match(DRIVER, /override-admin-banner/); assert.match(DRIVER, /ambil di \{o\.pickupLocationCode/);
  assert.doesNotMatch(DRIVER.slice(DRIVER.indexOf("override-admin-banner") - 200, DRIVER.indexOf("override-admin-banner") + 700), /diperiksa|pemeriksaan|QC lulus/i);
});

test("pintu masuk: Unit 360 (tab Pekerjaan) dan drawer order di Sales, hanya Admin/Owner; label Produksi di kartu papan dan banner", () => {
  assert.match(DRAWER, /<AdminOverrideUnit360 d=\{d\} isAdmin=\{isAdminOwner\}/); assert.match(DRAWER, /isAdminOwner=\{rolesOf\(currentUserLocal\(\)\)\.some\(\(r\) => \["ADMIN", "OWNER"\]\.includes\(r\)\)\}/);
  assert.match(ORDER, /<AdminOverrideOrderPanel order=\{o\} isAdmin=\{bolehOverrideAdmin\}/); assert.match(ORDER, /bolehOverrideAdmin = Boolean\(o && .*isAdminUser/);
  assert.match(DIALOG, /data-testid="ao-banner"/); assert.match(KARTU, /view\.deliveryRelease/); assert.match(KARTU, /data-testid="ao-kartu-badge"/);
  assert.match(API, /getProductionV2DeliveryRelease: \(unitId\) => request\(`\/production-v2\/units\/\$\{unitId\}\/delivery-release`\)/);
  assert.match(API, /releaseProductionV2UnitForDelivery: .*"Idempotency-Key": idempotencyKey/s);
});
