// P12B.2 — rute Production LAMA dialihkan ke halaman kanonis; tidak ada halaman lama yang tampil. Lihat src/lib/legacyProductionRoutes.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_PRODUCTION_REDIRECTS, STANDALONE_TAB_FALLBACK, isLegacyProductionRoute, legacyRedirectFor, tabPathFor } from "../src/lib/legacyProductionRoutes.js";
import { PRODUCTION_NAV } from "../src/lib/productionNav.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

test("pemetaan redirect wajib sesuai keputusan P12B.2", () => {
  const to = (p) => legacyRedirectFor(p)?.to;
  assert.equal(to("/bengkel"), "/bengkel/production-v2");            // Papan Produksi lama → Status Produksi
  assert.equal(to("/bengkel/planning"), "/bengkel/rencana-produksi"); // Rencana lama/P3 → Rencana Produksi
  assert.equal(to("/bengkel/workshop"), "/produksi/meja");            // Antrean Kerja lama/P5 → Aplikasi Meja
  assert.equal(to("/bengkel/work-orders"), "/bengkel/order-produksi?tab=aktif");
  assert.equal(to("/bengkel/orders"), "/bengkel/order-produksi?view=order"); // Semua Order level order → tampilan sekunder Status order
  assert.equal(to("/bengkel/qc"), "/bengkel/quality-control");        // Inspeksi/Antrean QC lama → Quality Control
  assert.equal(to("/bengkel/qc-v2"), "/bengkel/quality-control");
  assert.equal(to("/bengkel/pengajuan-biaya"), "/bengkel/biaya-produksi?tab=pengajuan");
  assert.equal(to("/bengkel/laporan-biaya"), "/bengkel/biaya-produksi?tab=laporan");
  assert.equal(to("/bengkel/work-centers"), "/bengkel/pengaturan?tab=area-kerja");
  assert.equal(to("/bengkel/operators"), "/bengkel/pengaturan?tab=operator");
  assert.equal(to("/bengkel/layanan-tahapan"), "/bengkel/pengaturan?tab=layanan");
  assert.equal(to("/bengkel/scope-revisions"), "/bengkel/komplain-revisi?tab=revisi");
  assert.equal(to("/bengkel/reports"), "/bengkel/kpi?tab=laporan");
});

test("hanya Antrean Kerja lama yang menuju halaman MANDIRI; tab tersimpan tidak pernah menyimpan tujuan mandiri", () => {
  assert.deepEqual(Object.entries(LEGACY_PRODUCTION_REDIRECTS).filter(([, v]) => v.standalone).map(([k]) => k), ["/bengkel/workshop"]);
  assert.equal(legacyRedirectFor("/bengkel/workshop").standalone, true);
  assert.equal(tabPathFor("/bengkel/workshop"), STANDALONE_TAB_FALLBACK);
  assert.equal(tabPathFor("/bengkel/qc"), "/bengkel/quality-control");
  assert.equal(tabPathFor("/bengkel/ringkasan"), "/bengkel/ringkasan", "rute baru tidak diubah");
});

test("query lama dipertahankan; kunci tab Order Produksi lama (work-order/semua-order/status=DELIVERED) diterjemahkan", () => {
  assert.equal(legacyRedirectFor("/bengkel/work-orders?status=DELIVERED").to, "/bengkel/order-produksi?tab=aktif&status=DELIVERED");
  assert.equal(legacyRedirectFor("/bengkel/order-produksi?tab=work-order&status=DELIVERED").to, "/bengkel/order-produksi?tab=riwayat");
  assert.equal(legacyRedirectFor("/bengkel/order-produksi?tab=work-order").to, "/bengkel/order-produksi?tab=aktif");
  assert.equal(legacyRedirectFor("/bengkel/order-produksi?tab=semua-order").to, "/bengkel/order-produksi?view=order");
  assert.equal(legacyRedirectFor("/bengkel/order-produksi?tab=semua"), null, "kunci baru (filter Semua) tidak dialihkan");
  assert.equal(legacyRedirectFor("/bengkel/order-produksi?status=DELIVERED").to, "/bengkel/order-produksi?tab=riwayat");
  assert.equal(legacyRedirectFor("/bengkel/order-produksi"), null);
  assert.equal(legacyRedirectFor("/bengkel/order-produksi?tab=aktif"), null, "kunci baru tidak dialihkan");
});

test("isLegacyProductionRoute: true untuk rute lama, false untuk rute baru dan rute yang dipertahankan", () => {
  for (const p of Object.keys(LEGACY_PRODUCTION_REDIRECTS)) assert.equal(isLegacyProductionRoute(p), true, p);
  for (const p of ["/bengkel/ringkasan", "/bengkel/production-v2", "/bengkel/rencana-produksi", "/bengkel/quality-control", "/bengkel/order-produksi", "/bengkel/materials", "/bengkel/kpi", "/bengkel/andon", "/komplain", "/bengkel/units/abc"]) assert.equal(isLegacyProductionRoute(p), false, p);
});

test("setiap tujuan redirect adalah halaman nyata (terdaftar atau mandiri) dan TIDAK ada rute lama yang masih terdaftar sebagai halaman", () => {
  const reg = src("routes", "pageRegistry.jsx");
  const registered = new Set([...reg.matchAll(/path: "([^"]+)"/g)].map((m) => m[1]));
  for (const [from, { to }] of Object.entries(LEGACY_PRODUCTION_REDIRECTS)) {
    assert.ok(registered.has(to.split("?")[0]), `tujuan ${to} (dari ${from}) harus terdaftar`);
    assert.ok(!registered.has(from), `rute lama ${from} tidak boleh lagi menjadi halaman`);
  }
});

test("tidak ada menu sidebar yang menuju rute lama", () => {
  for (const sec of PRODUCTION_NAV) for (const it of sec.items) assert.equal(isLegacyProductionRoute(it.to), false, it.to);
});

test("pembungkus: resolveEntryPath menerjemahkan lebih dulu, AppFrame mengalihkan tujuan mandiri, TabsProvider menyelaraskan URL, tab tersimpan dimigrasi", () => {
  assert.match(src("routes", "pageRegistry.jsx"), /const translated = tabPathFor\(pathname\);\s*if \(translated !== pathname\) return resolveEntryPath\(translated\)/);
  assert.match(src("App.jsx"), /legacy\?\.standalone\) return <Navigate to=\{legacy\.to\} replace \/>/);
  assert.match(src("lib", "TabsContext.jsx"), /legacyRedirectFor\(location\.pathname \+ location\.search\)[\s\S]{0,200}navigate\(path, \{ replace: true \}\)/);
  assert.match(src("lib", "openTabs.js"), /tabPathFor\(stripDemoParam\(t\.path\)\)/);
});
