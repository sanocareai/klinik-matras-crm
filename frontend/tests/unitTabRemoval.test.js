// P12B.4 — tab/menu "Unit" dihapus dari workspace Production: detail unit = drawer Unit 360 di Order Produksi (?unit=<id>); URL & tab lama dimigrasi.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { legacyRedirectFor, tabPathFor, unitDetailPath, isLegacyProductionRoute } from "../src/lib/legacyProductionRoutes.js";
import { loadTabs } from "../src/lib/openTabs.js";
import { withParam } from "../src/lib/hubTabs.js";
import { unitFacts, V2_SECTIONS_UNAVAILABLE } from "../src/features/production/unitOrderFallbackModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ID = "43934470-98eb-40bd-9113-d586f276b380";

test("redirect URL Unit lama → drawer Unit 360 di Order Produksi; hanya satu segmen id; rute lain tidak terpengaruh", () => {
  assert.equal(legacyRedirectFor(`/bengkel/units/${ID}`).to, `/bengkel/order-produksi?unit=${ID}`);
  assert.equal(legacyRedirectFor(`/bengkel/units/${ID}/`).to, `/bengkel/order-produksi?unit=${ID}`);
  assert.equal(legacyRedirectFor(`/bengkel/units/${ID}?x=1`).to, `/bengkel/order-produksi?unit=${ID}`);
  assert.equal(legacyRedirectFor(`/bengkel/units/${ID}`).standalone, false);
  assert.equal(legacyRedirectFor(`/bengkel/units/${ID}/extra`), null); assert.equal(legacyRedirectFor("/bengkel/units"), null);
  assert.equal(isLegacyProductionRoute(`/bengkel/units/${ID}`), true);
  assert.equal(unitDetailPath("a b/c"), "/bengkel/order-produksi?unit=a%20b%2Fc");
  assert.equal(legacyRedirectFor(unitDetailPath("a b/c")), null, "tujuan baru tidak dialihkan lagi");
  assert.equal(tabPathFor(`/bengkel/units/${ID}`), `/bengkel/order-produksi?unit=${ID}`);
});

test("tab tersimpan lama: tab 'Unit' dimigrasi ke Order Produksi (judul ikut diganti), tab lain & aktif tetap aman", () => {
  const store = { v: JSON.stringify({ activeId: "t2", tabs: [
    { id: "t1", path: "/bengkel/ringkasan", title: "Ringkasan" },
    { id: "t2", path: `/bengkel/units/${ID}`, title: "Unit" },
    { id: "t3", path: "/armada/jobs", title: "Jobs" },
  ] }) };
  globalThis.localStorage = { getItem: () => store.v, setItem() {} };
  try {
    const loaded = loadTabs();
    assert.deepEqual(loaded.tabs.map((t) => t.path), ["/bengkel/ringkasan", `/bengkel/order-produksi?unit=${ID}`, "/armada/jobs"]);
    assert.equal(loaded.tabs[1].title, "Order Produksi", "tidak tersisa tab berlabel 'Unit'");
    assert.equal(loaded.tabs[0].title, "Ringkasan"); assert.equal(loaded.tabs[2].title, "Jobs");
    assert.equal(loaded.activeId, "t2", "tab aktif tetap");
    assert.equal(loaded.tabs.length, 3, "tidak ada tab yang hilang");
  } finally { delete globalThis.localStorage; }
});

test("tidak ada lagi jalur UI ke halaman Unit lama: route & komponen dihapus; semua pemanggil memakai drawer (?unit=)", () => {
  assert.equal(fs.existsSync(path.join(here, "..", "src", "pages", "bengkel", "ProductionUnitDetail.jsx")), false);
  const reg = src("routes", "pageRegistry.jsx");
  assert.doesNotMatch(reg, /ProductionUnitDetail|\/bengkel\/units\/:id/);
  for (const f of ["pages/bengkel/ProductionWorkOrders.jsx", "pages/bengkel/ProductionMaterialUsage.jsx", "pages/bengkel/ProductionScopeRevisions.jsx", "pages/bengkel/ProductionPlannerV2.jsx", "features/production/UnitOverviewDrawer.jsx", "pages/bengkel/ProductionOrdersHub.jsx"]) {
    const code = strip(src(...f.split("/")));
    assert.doesNotMatch(code, /bengkel\/units\/|Buka Detail Unit|Detail unit \(lama\)/, f);
  }
  assert.match(strip(src("pages", "bengkel", "ProductionMaterialUsage.jsx")), /navigate\(unitDetailPath\(m\.unit\.id\)\)/);
  assert.match(strip(src("pages", "bengkel", "ProductionScopeRevisions.jsx")), /navigate\(unitDetailPath\(selected\.unitId\)\)/);
  assert.match(strip(src("pages", "bengkel", "ProductionPlannerV2.jsx")), /unitDetailPath\(item\.unit\.id\)/);
  // sidebar tidak punya menu Unit
  const nav = src("lib", "productionNav.js");
  assert.doesNotMatch(nav, /label: "Unit"|bengkel\/units/);
});

test("klik order = satu drawer pada tab yang sama: ?unit= ditulis ke path tab aktif (replace), bukan tab baru", () => {
  const hook = strip(src("hooks", "useHubParam.js"));
  assert.match(hook, /export function useOpenParam\(param\)/);
  assert.match(hook, /tabsCtx\.replaceActivePath\(path\)/);
  assert.doesNotMatch(hook, /openNewTab|openInActiveTab/, "tidak membuka tab baru");
  assert.match(strip(src("pages", "bengkel", "ProductionOrdersHub.jsx")), /useOpenParam\("unit"\)/);
  assert.equal(withParam("/bengkel/order-produksi?tab=semua", "unit", ID, null), `/bengkel/order-produksi?tab=semua&unit=${ID}`);
  assert.equal(withParam(`/bengkel/order-produksi?tab=semua&unit=${ID}`, "unit", null, null), "/bengkel/order-produksi?tab=semua", "tutup drawer membuang ?unit");
});

test("fallback unit non-V2 di drawer yang sama: fakta order/unit asli + penjelasan jujur bagian V2; tanpa tombol ke halaman lain", () => {
  const timeline = {
    unit: { merk: "King Koil", ukuran: "180 x 200", status: "AWAITING_PICKUP", priority: "NORMAL", productionDueAt: null, updatedAt: "2026-10-04T01:00:00.000Z", serviceLine: null, service: null, currentStage: null, order: { orderNumber: "RES-1", customer: { name: "Vita" } } },
    productionStatus: null,
  };
  const facts = Object.fromEntries(unitFacts(timeline));
  assert.equal(facts["Order"], "RES-1"); assert.equal(facts["Pelanggan"], "Vita"); assert.match(facts["Kasur"], /King Koil/);
  // layanan, prioritas, dan target TIDAK diduplikasi di fakta — hanya ada di UnitV1Actions
  for (const k of ["Layanan", "Layanan Teknis", "Prioritas", "Target selesai"]) assert.equal(facts[k], undefined, `${k} tidak diduplikasi di fakta`);
  assert.deepEqual(V2_SECTIONS_UNAVAILABLE.map(([k]) => k), ["Proses", "Bahan", "Dokumentasi", "QC & Handoff", "Aktivitas"]);
  const comp = strip(src("features", "production", "UnitOrderFallback.jsx"));
  assert.match(comp, /belum memakai alur Production V2/); assert.match(comp, /data-testid="unit-v2-notice"/);
  assert.doesNotMatch(comp, /<button|<Button|navigate|<Link|href=/, "baca-saja, tanpa jalur ke halaman lain");
  const drawer = strip(src("features", "production", "UnitOverviewDrawer.jsx"));
  assert.match(drawer, /api\.getUnitTimeline\(unitId\)/);
});

test("tidak ada yang dihapus selain UI: API /units/:id, entitas Unit, halaman divisi lain, dan href backend tetap", () => {
  const api = src("api.js");
  assert.match(api, /getUnitTimeline: \(unitId\) => request\(`\/units\/\$\{unitId\}\/timeline`\)/); assert.match(api, /getUnitStatus:/); assert.match(api, /getUnitOverview:/);
  const backend = fs.readFileSync(path.join(here, "..", "..", "backend", "src", "lib", "domain", "productionExceptions.js"), "utf8");
  assert.match(backend, /href: `\/bengkel\/units\/\$\{unit\.id\}`/, "tautan lama dari backend tetap valid karena dialihkan klien");
});
