// P12B.3 — Order Produksi: klik menu langsung menampilkan daftar order asli aktif; Aktif/Semua/Riwayat = filter ringan di halaman yang sama;
// klik baris membuka Unit 360 (dengan fallback untuk unit non-V2); membaca order asli tidak butuh V2 maupun Mode Latihan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isOutsideV2 } from "../src/features/production/unit360Availability.js";
import { pickParam, withParam } from "../src/lib/hubTabs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HUB = strip(src("pages", "bengkel", "ProductionOrdersHub.jsx"));
const WO = strip(src("pages", "bengkel", "ProductionWorkOrders.jsx"));

test("tanpa halaman perantara: hub langsung merender daftar (bukan bilah tab/wizard/pemilih mode), default Aktif", () => {
  assert.doesNotMatch(HUB, /TabbedHub|wizard|Wizard|pilih mode|Pilih mode|step|Langkah|DemoPage|getDemoAccess/);
  assert.match(HUB, /useHubParam\("tab", ORDER_SCOPE_KEYS, "aktif"\)/, "default Aktif");
  assert.match(HUB, /return \(\s*<ProductionWorkOrders\s+scope=\{scope\}/, "jalur bawaan = daftar langsung");
  const reg = strip(src("routes", "pageRegistry.jsx"));
  assert.match(reg, /path: "\/bengkel\/order-produksi", render: \(\) => <ProductionOrdersHub \/>/, "tanpa DemoPage: Mode Latihan bukan syarat");
  assert.deepEqual([...src("pages", "bengkel", "ProductionWorkOrders.jsx").matchAll(/\{ key: "(aktif|semua|riwayat)", label: "(\w+)" \}/g)].map((m) => m[1]), ["aktif", "semua", "riwayat"]);
});

test("filter ringan di baris saring halaman yang sama (satu tablist), bukan bilah tab terpisah di atas halaman", () => {
  assert.match(WO, /onScopeChange && ORDER_SCOPES\.map/);
  assert.match(WO, /data-testid="order-filter"/);
  assert.match(WO, /data-testid=\{`order-scope-\$\{sc\.key\}`\}/);
  assert.match(WO, /title=\{onScopeChange \|\| scope \? "Order Produksi" : "Work Order"\}/);
  assert.doesNotMatch(WO, /Order Produksi Aktif|Riwayat Order Produksi/, "judul tunggal 'Order Produksi'");
  assert.match(WO, /scope === "riwayat" \|\| scope === "semua" \? \[\]/, "status rinci hanya untuk Aktif");
});

test("membaca order asli TIDAK butuh Production V2 / Mode Latihan: daftar hanya memakai getWorkOrders", () => {
  const calls = [...WO.matchAll(/\bapi\.(?!js\b)(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)], ["getWorkOrders"]);
  assert.doesNotMatch(WO + HUB, /readerMode|getDemoAccess|activateDemo|isDemoActive|production-v2/);
});

test("loading, kosong, dan galat tampil langsung pada daftar", () => {
  assert.match(WO, /TableSkeletonRows/); assert.match(WO, /<EmptyState[\s\S]{0,200}Tidak ada unit yang cocok/);
  assert.match(WO, /\{error && <div className="rounded-btn bg-redbg[^"]*">\{error\}<\/div>\}/);
  assert.match(WO, /\.catch\(\(e\) => setError\(e\.message\)\)/);
});

test("klik baris/kartu membuka Unit 360 (drawer kanonis), bukan halaman lama; unit non-V2 mendapat fallback data order asli", () => {
  assert.match(WO, /<TR key=\{u\.id\} clickable data-testid="order-row"[^>]*onClick=\{\(\) => setDetailUnit\(u\)\}/);
  assert.match(WO, /data-testid="order-row" data-unit-code=\{u\.unitCode\}\s*onClick=\{\(\) => setDetailUnit\(u\)\}/, "kartu mobile juga");
  assert.match(WO, /<UnitOverviewDrawer unitId=\{openUnitId\} onClose=\{\(\) => setDetailUnit\(null\)\} onChanged=\{load\} \/>/);
  assert.doesNotMatch(WO, /<Modal\b|navigate\(|useNavigate/, "tanpa modal ringkas terpisah dan tanpa navigasi ke halaman/tab lain");
  const drawer = strip(src("features", "production", "UnitOverviewDrawer.jsx"));
  assert.match(drawer, /import \{ isOutsideV2 \} from "@\/features\/production\/unit360Availability\.js"/);
  assert.match(drawer, /if \(!isOutsideV2\(e\)\) \{ setError\(friendlyError\(e\)\); return; \}/);
  assert.match(drawer, /api\.getUnitTimeline\(unitId\)/);
  assert.match(drawer, /\{unavailable && <div data-testid="unit-overview-fallback"><UnitOrderFallback /);
});

test("aturan ketersediaan Unit 360: 404/UNIT_NOT_FOUND/READER_OFF = di luar V2; galat lain tetap galat", () => {
  assert.equal(isOutsideV2({ status: 404 }), true);
  assert.equal(isOutsideV2({ code: "UNIT_NOT_FOUND" }), true);
  assert.equal(isOutsideV2({ code: "PRODUCTION_V2_READER_OFF" }), true);
  for (const e of [{ status: 500 }, { status: 403 }, { status: 0, code: "NETWORK" }, new Error("x"), null, undefined]) assert.equal(isOutsideV2(e), false);
});

test("?tab= bertahan: pickParam/withParam — default Aktif tidak mengotori URL untuk parameter non-tab; tab selalu ditulis", () => {
  const keys = ["aktif", "semua", "riwayat"];
  assert.equal(pickParam(keys, "riwayat", "aktif"), "riwayat"); assert.equal(pickParam(keys, "x", "aktif"), "aktif"); assert.equal(pickParam(keys, null, "aktif"), "aktif");
  assert.equal(withParam("/bengkel/order-produksi", "tab", "semua", "aktif"), "/bengkel/order-produksi?tab=semua");
  assert.equal(withParam("/bengkel/order-produksi?tab=semua", "tab", "aktif", "aktif"), "/bengkel/order-produksi?tab=aktif");
  assert.equal(withParam("/bengkel/order-produksi", "view", "order", "units"), "/bengkel/order-produksi?view=order");
  assert.equal(withParam("/bengkel/order-produksi?view=order&tab=riwayat", "view", "units", "units"), "/bengkel/order-produksi?tab=riwayat", "kembali ke tampilan bawaan menghapus ?view");
  const hook = strip(src("hooks", "useHubParam.js"));
  assert.match(hook, /replaceActivePath\(path\)/); assert.match(hook, /replace: true/);
});

test("Status order (Semua Order level order, D-086) tetap ada sebagai tampilan sekunder — bukan langkah wajib", () => {
  assert.match(HUB, /useHubParam\("view", \["units", "order"\], "units"\)/);
  assert.match(HUB, /if \(view === "order"\) \{[\s\S]{0,500}<ProductionOrders \/>/);
  assert.match(HUB, /data-testid="order-open-status"/); assert.match(HUB, /data-testid="order-back-to-units"/);
});

test("slice ini hanya navigasi & pembacaan: aturan tahap, izin, dan writer cohort tidak disentuh (tanpa panggilan tulis baru di daftar)", () => {
  assert.doesNotMatch(WO + HUB, /recordProductionV2Step|api\.(create|update|set|delete|post|patch)\w*/);
  assert.doesNotMatch(src("hooks", "useHubParam.js"), /api\./);
});
