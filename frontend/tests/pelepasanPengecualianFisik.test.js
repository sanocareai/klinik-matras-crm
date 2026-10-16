// "Tandai Siap Kirim berdasarkan pemeriksaan fisik" (pengecualian Admin/Owner). Pola proyek: fungsi murni dieksekusi dari modul; kontrak tampilan lewat text-scan sumber.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PF_LABEL_RUN_BELUM_DITUTUP, pfBolehAdmin, pfBolehKirim, pfKunciBaru, pfUnitBisaDilepas } from "../src/features/production/pelepasanFisikLogic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

test("pfBolehAdmin: hanya Admin/Owner (multi-role)", () => {
  assert.equal(pfBolehAdmin(["ADMIN"]), true); assert.equal(pfBolehAdmin(["SALES", "OWNER"]), true);
  for (const r of [["PRODUCTION_LEAD"], ["DISPATCHER"], ["WAREHOUSE", "PRODUCTION_WORKER"], [], null, undefined]) assert.equal(pfBolehAdmin(r), false, JSON.stringify(r));
});

test("pfUnitBisaDilepas: hanya unit yang masih dikerjakan Produksi (bukan siap/berangkat/terkirim/batal)", () => {
  for (const s of ["RECEIVED", "IN_PRODUCTION"]) assert.equal(pfUnitBisaDilepas({ status: s }), true, s);
  for (const s of ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED", "CANCELLED", "AWAITING_PICKUP", undefined]) assert.equal(pfUnitBisaDilepas({ status: s }), false, String(s));
  assert.equal(pfUnitBisaDilepas(null), false);
});

test("pfBolehKirim: butuh pratinjau layak + kode diketik ulang persis + lokasi + alasan >= 10 + verifikasi fisik, dan tidak sedang proses", () => {
  const ok = { eligible: true, kodeDiketik: " RES-1-U1 ", kodeUnit: "RES-1-U1", locationId: "loc", alasan: "barang sudah dilihat jadi", verif: true, sibuk: false };
  assert.equal(pfBolehKirim(ok), true);
  for (const o of [{ eligible: false }, { kodeDiketik: "RES-1-U2" }, { kodeDiketik: "" }, { locationId: "" }, { alasan: "sudah" }, { alasan: "x".repeat(501) }, { verif: false }, { sibuk: true }]) assert.equal(pfBolehKirim({ ...ok, ...o }), false, JSON.stringify(o));
});

test("pfKunciBaru: unik dan sesuai pola Idempotency-Key server", () => {
  const a = pfKunciBaru(); const b = pfKunciBaru();
  assert.notEqual(a, b); assert.match(a, /^[A-Za-z0-9._:-]{12,128}$/);
});

const DIALOG = read("features", "production", "PelepasanPengecualianFisik.jsx");
const DRAWER = read("features", "production", "UnitOverviewDrawer.jsx");
const ORDER = read("features", "orders", "OrderTimelineDrawer.jsx");
const KARTU = read("features", "production", "UnitCard.jsx");
const API = read("api.js");

test("dialog: pratinjau server dulu; kode diketik ulang; lokasi barang sebenarnya; pemeriksa; alasan; verifikasi fisik; galat server tampil; kunci idempotensi diganti setelah galat; tanpa window.prompt", () => {
  assert.match(DIALOG, /api\.getProductionV2DeliveryRelease\(/); assert.match(DIALOG, /api\.releaseProductionV2UnitForDelivery\(/);
  for (const id of ["pf-kode", "pf-lokasi", "pf-pemeriksa", "pf-alasan", "pf-verif", "pf-konfirmasi", "pf-galat", "pf-pratinjau", "pf-sukses", "pf-unit-lain"]) assert.match(DIALOG, new RegExp(`data-testid="${id}"`), id);
  assert.match(DIALOG, /physicalVerified: true/); assert.match(DIALOG, /setKunci\(pfKunciBaru\(\)\)/); assert.doesNotMatch(DIALOG, /window\.(prompt|confirm|alert)/);
  assert.match(DIALOG, /Run, tahap 10–12, dan bukti tahap <b>tidak diubah<\/b>/); assert.match(DIALOG, /Tidak ada QC, foto, serah terima Gudang, atau pergerakan stok yang dibuat/);
  assert.match(DIALOG, /Unit lain pada order ini TIDAK ikut dilepas/);
});

test("label Produksi: 'Run belum ditutup — unit dilepas untuk pengiriman lewat pengecualian' di Unit 360, kartu papan, dan hasil dialog", () => {
  assert.equal(PF_LABEL_RUN_BELUM_DITUTUP, "Run belum ditutup — unit dilepas untuk pengiriman lewat pengecualian");
  assert.match(DIALOG, /data-testid="pf-banner"/);
  assert.match(KARTU, /view\.deliveryRelease/); assert.match(KARTU, /data-testid="pf-kartu-badge"/);
});

test("pintu masuk: Unit 360 (tab Pekerjaan) dan drawer order di Sales, hanya Admin/Owner", () => {
  assert.match(DRAWER, /<PelepasanUnit360 d=\{d\} isAdmin=\{isAdminOwner\}/); assert.match(DRAWER, /isAdminOwner=\{rolesOf\(currentUserLocal\(\)\)\.some\(\(r\) => \["ADMIN", "OWNER"\]\.includes\(r\)\)\}/);
  assert.match(ORDER, /<PelepasanOrderPanel order=\{o\} isAdmin=\{bolehPelepasan\}/); assert.match(ORDER, /bolehPelepasan = Boolean\(o && .*isAdminUser/);
  assert.match(API, /getProductionV2DeliveryRelease: \(unitId\) => request\(`\/production-v2\/units\/\$\{unitId\}\/delivery-release`\)/);
  assert.match(API, /releaseProductionV2UnitForDelivery: .*"Idempotency-Key": idempotencyKey/s);
});
