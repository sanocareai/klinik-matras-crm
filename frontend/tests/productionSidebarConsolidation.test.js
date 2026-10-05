// P12B.2 — Sidebar Consolidation: matriks menu per peran, akordeon Mode Kerja, hub gabungan memakai halaman/endpoint lama, Pengaturan, persistensi tab.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_NAV, PRODUCTION_SETTINGS_ROLES, sectionIsOpen } from "../src/lib/productionNav.js";
import { filterMenuByPermission, visibleSections } from "../src/lib/menuVisibility.js";
import { SETTINGS_TABS, canOpenSettings, canWriteTarget, settingsTabsFor } from "../src/lib/productionSettings.js";
import { pickTab, withTabParam } from "../src/lib/hubTabs.js";
import { loadToggledSections, saveToggledSections, resetSidebarPreferences } from "../src/lib/sidebarSections.js";
import { isSidebarItemActive } from "../src/lib/sidebarActive.js";
import { TABS as KPI_TABS, tabsFor } from "../src/features/production/reporting.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Menu yang tampil untuk seperangkat peran (persis cara Layout.jsx: filterMenuByPermission → visibleSections).
const menuFor = (roles, divisiSaya = []) => {
  const base = filterMenuByPermission({ sections: PRODUCTION_NAV.map((s) => ({ ...s, items: [...s.items] })) }, { roles, divisiSaya });
  return visibleSections(base.sections, false).map((s) => ({ section: s.section, labels: s.items.map((i) => i.label) }));
};
const flat = (m) => m.flatMap((s) => s.labels);

test("struktur final: urutan section & menu persis sesuai keputusan", () => {
  assert.deepEqual(PRODUCTION_NAV.map((s) => [s.section, s.items.map((i) => i.label)]), [
    ["OPERASIONAL", ["Ringkasan", "Order Produksi", "Status Produksi", "Rencana Produksi", "Bahan Produksi"]], // Slice 1: menu QC disembunyikan sementara (rute & halaman tetap ada)
    ["MODE KERJA", ["Aplikasi Meja", "Aplikasi Corner", "Aplikasi Dokumentasi", "Andon TV"]],
    ["KONTROL & LAPORAN", ["KPI & Laporan", "Biaya Produksi", "Komplain & Revisi"]],
    ["ADMINISTRASI", ["Pengaturan"]],
  ]);
  assert.equal(PRODUCTION_NAV.at(-1).section, "ADMINISTRASI", "Pengaturan paling bawah");
  assert.equal(PRODUCTION_NAV.at(-1).pinBottom, true);
});

test("menu yang dihapus dari sidebar tidak ada lagi (tanpa Legacy, Work Center, Operator, Riwayat, KPI/Komplain terpisah, Susun ulang)", () => {
  const all = PRODUCTION_NAV.flatMap((s) => s.items.map((i) => i.label));
  for (const gone of ["Work Center", "Operator", "Layanan & Tahapan", "Pengajuan Biaya", "Laporan Biaya", "Riwayat", "KPI Produksi", "Kasus Komplain", "Laporan Produksi"]) assert.ok(!all.includes(gone), gone);
  assert.ok(!PRODUCTION_NAV.some((s) => /LEGACY/i.test(s.section) || s.adminOnly));
  const layout = strip(src("components", "Layout.jsx"));
  assert.doesNotMatch(layout, /LEGACY \(ADMIN\)|Inspeksi QC \(lama\)|Papan Produksi \(lama|Antrean Kerja \(lama/);
  assert.match(layout, /divisionKey !== "bengkel" && \(\s*<button/, "tombol Susun ulang menu tidak tampil untuk Production");
});

test("ikon: satu ikon per menu, tidak ada duplikat, dan semuanya terpetakan di Layout", () => {
  const icons = PRODUCTION_NAV.flatMap((s) => s.items.map((i) => i.icon));
  assert.equal(new Set(icons).size, icons.length, "ikon unik");
  const layout = src("components", "Layout.jsx");
  const map = layout.match(/const NAV_ICONS = \{([^}]+)\}/)[1];
  for (const ic of icons) assert.match(map, new RegExp(`\\b${ic}\\b`), ic);
});

test("matriks menu per peran (ADMIN/OWNER, Lead, Operator, QC, Gudang, Dokumenter, Finance, Sales)", () => {
  const ALL = flat(menuFor(["ADMIN"]));
  assert.equal(ALL.length, 13, "ADMIN: seluruh 13 menu (tanpa QC yang disembunyikan sementara)");
  assert.deepEqual(flat(menuFor(["OWNER"])), ALL, "OWNER = ADMIN");
  // Production Lead: semuanya (KPI, Biaya, Pengaturan sesuai gerbang peran)
  assert.deepEqual(flat(menuFor(["PRODUCTION_LEAD"])), ALL);
  // Operator / QC / Gudang / Dokumenter: tanpa KPI & Laporan, Biaya Produksi, Pengaturan; section ADMINISTRASI tidak muncul sama sekali
  for (const role of ["PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE", "PRODUCTION_DOCUMENTER"]) {
    const m = menuFor([role]);
    const labels = flat(m);
    for (const hidden of ["KPI & Laporan", "Biaya Produksi", "Pengaturan"]) assert.ok(!labels.includes(hidden), `${role} tidak melihat ${hidden}`);
    assert.ok(labels.includes("Komplain & Revisi") && !labels.includes("Quality Control"), `${role} tetap melihat menu kerja`);
    assert.ok(!m.some((s) => s.section === "ADMINISTRASI"), `${role}: tanpa section ADMINISTRASI`);
  }
  // Finance: Biaya Produksi ya (gerbang peran lama), Pengaturan/KPI tidak. Sales: tidak ada ketiganya.
  assert.ok(flat(menuFor(["FINANCE"])).includes("Biaya Produksi") && !flat(menuFor(["FINANCE"])).includes("Pengaturan"));
  assert.ok(!flat(menuFor(["SALES"])).includes("Biaya Produksi") && !flat(menuFor(["SALES"])).includes("Pengaturan"));
  // anggota divisi PRODUCTION melihat Biaya Produksi walau perannya lain (bolehDivisi), tetap tanpa Pengaturan
  assert.ok(flat(menuFor(["PRODUCTION_WORKER"], ["PRODUCTION"])).includes("Biaya Produksi"));
  assert.ok(!flat(menuFor(["PRODUCTION_WORKER"], ["PRODUCTION"])).includes("Pengaturan"));
  assert.deepEqual([...PRODUCTION_SETTINGS_ROLES], ["ADMIN", "OWNER", "PRODUCTION_LEAD"]);
});

test("Mode Kerja akordeon: default tertutup; terbuka bila ditandai pengguna atau anaknya aktif; section lain selalu terbuka", () => {
  const mode = PRODUCTION_NAV.find((s) => s.section === "MODE KERJA");
  assert.equal(sectionIsOpen(mode, {}), false, "default tertutup");
  assert.equal(sectionIsOpen(mode, { toggled: true }), true, "dibuka pengguna");
  assert.equal(sectionIsOpen(mode, { activeTo: "/produksi/corner" }), true, "anak aktif → terbuka otomatis");
  assert.equal(sectionIsOpen(mode, { activeTo: "/bengkel/ringkasan" }), false, "bukan anaknya → tetap tertutup");
  assert.equal(sectionIsOpen(mode, { toggled: true, activeTo: "/produksi/corner" }), false, "pengguna menutup section yang anaknya aktif");
  for (const s of PRODUCTION_NAV.filter((x) => !x.collapsible)) assert.equal(sectionIsOpen(s, {}), true, s.section);
});

test("maksimal satu menu aktif dalam sidebar untuk setiap path (termasuk query)", () => {
  const items = PRODUCTION_NAV.flatMap((s) => s.items);
  for (const it of items) {
    const activeCount = items.filter((x) => isSidebarItemActive(x, items, it.to.split("?")[0], "")).length;
    assert.equal(activeCount, 1, `${it.to}: ${activeCount} aktif`);
  }
  for (const p of ["/bengkel/order-produksi", "/bengkel/kpi", "/bengkel/pengaturan", "/bengkel/biaya-produksi", "/bengkel/komplain-revisi"]) {
    assert.ok(items.filter((x) => isSidebarItemActive(x, items, p, "?tab=x")).length <= 1, p);
  }
});

test("status buka/tutup section disimpan sebagai preferensi tampilan SAJA (bukan akses) dan aman bila storage rusak", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  assert.equal(loadToggledSections("bengkel").size, 0);
  saveToggledSections("bengkel", new Set(["MODE KERJA"]));
  assert.deepEqual([...loadToggledSections("bengkel")], ["MODE KERJA"]);
  store.set("sidebar-sections:bengkel", "{rusak"); assert.equal(loadToggledSections("bengkel").size, 0);
  store.set("sidebar-sections:bengkel", JSON.stringify(["MODE KERJA", 7, null])); assert.deepEqual([...loadToggledSections("bengkel")], ["MODE KERJA"]);
  store.set("sidebar-order:bengkel", "{}"); resetSidebarPreferences("bengkel");
  assert.equal(store.has("sidebar-sections:bengkel"), false); assert.equal(store.has("sidebar-order:bengkel"), false);
  // tidak ada kode yang mengaitkan section tersimpan dengan izin
  assert.doesNotMatch(strip(src("lib", "sidebarSections.js")), /roles|permission|izin/i);
  globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(loadToggledSections("bengkel").size, 0); saveToggledSections("bengkel", new Set(["x"])); resetSidebarPreferences("bengkel");
  delete globalThis.localStorage;
});

test("UX sidebar: nama maksimal dua baris, kolom menu scroll sendiri, footer tidak menyusut, Pengaturan menempel di dasar", () => {
  const css = src("index.css");
  assert.match(css, /\.sidebar-link \.nav-label \{[^}]*-webkit-line-clamp: 2/);
  assert.match(css, /\.sidebar-nav \{[^}]*overflow-y: auto; min-height: 0/);
  assert.match(css, /\.sidebar-footer \{ flex-shrink: 0; \}/);
  assert.match(css, /\.nav-section-bottom \{ margin-top: auto; \}/);
  assert.match(css, /\.sidebar-close-mobile/, "drawer mobile ada");
});

// ---------------------------------------------------------------- hub gabungan ------------------------------------------------------------
const HUB_FILES = ["ProductionOrdersHub.jsx", "ProductionCostHub.jsx", "ProductionComplaintsHub.jsx", "ProductionSettings.jsx", "ProductionQcHub.jsx"];
test("hub gabungan memakai halaman & endpoint LAMA: tanpa fetch/api baru, tanpa panggilan jaringan langsung", () => {
  const api = src("api.js");
  for (const f of HUB_FILES) {
    const code = strip(src("pages", "bengkel", f));
    assert.doesNotMatch(code, /\bfetch\(|XMLHttpRequest|axios/, `${f}: tanpa jaringan langsung`);
    for (const m of code.matchAll(/\bapi\.(\w+)/g)) assert.match(api, new RegExp(`\\b${m[1]}\\b`), `${f}: api.${m[1]} harus sudah ada`);
  }
  const orders = src("pages", "bengkel", "ProductionOrdersHub.jsx");
  assert.match(orders, /<ProductionWorkOrders\s+scope=\{scope\}\s+onScopeChange=\{setScope\}/); assert.match(orders, /<ProductionOrders \/>/, "Status order (Semua Order level order) tetap tersedia");
  const cost = src("pages", "bengkel", "ProductionCostHub.jsx");
  assert.match(cost, /<PengajuanBiayaWorkspace workspace="PRODUKSI" embedded view="pengajuan"/); assert.match(cost, /view="status"/); assert.match(cost, /<LaporanBiayaDivisi scope="PRODUCTION"/);
  const comp = src("pages", "bengkel", "ProductionComplaintsHub.jsx");
  assert.match(comp, /<ComplaintCases scope="aktif"/); assert.match(comp, /<ProductionScopeRevisions \/>/); assert.match(comp, /<ComplaintCases scope="riwayat"/);
});

test("tab hub sesuai keputusan: Order Produksi, Biaya Produksi, Komplain & Revisi, Pengaturan, KPI & Laporan", async () => {
  assert.deepEqual([...src("pages", "bengkel", "ProductionWorkOrders.jsx").matchAll(/\{ key: "(\w+)", label: "(\w+)" \}/g)].filter((m) => ["aktif", "semua", "riwayat"].includes(m[1])).map((m) => m[2]), ["Aktif", "Semua", "Riwayat"]);
  assert.deepEqual([...src("pages", "bengkel", "ProductionCostHub.jsx").matchAll(/label: "([^"]+)"/g)].map((m) => m[1]).slice(0, 3), ["Pengajuan", "Status Pengajuan", "Laporan"]);
  assert.deepEqual([...src("pages", "bengkel", "ProductionComplaintsHub.jsx").matchAll(/label: "([^"]+)"/g)].map((m) => m[1]).slice(0, 3), ["Kasus Aktif", "Revisi Unit", "Riwayat"]);
  assert.deepEqual(SETTINGS_TABS.map((t) => t.label), ["Area Kerja", "Operator & PIC", "Layanan & Tahapan", "Target Produksi", "Tampilan"]);
  assert.deepEqual(KPI_TABS.map((t) => t.label), ["Ringkasan KPI", "Produksi", "Meja", "PIC", "Gudang", "Laporan Unit", "Export"]);
  assert.deepEqual(tabsFor({ summary: true, stations: true, operators: true, units: true, warehouse: true }).map((t) => t.label), KPI_TABS.map((t) => t.label));
});

test("KPI & Laporan: Ringkasan KPI dan Produksi memakai SATU dokumen ringkasan; Export tidak memuat data baru", () => {
  const kpi = strip(src("pages", "bengkel", "ProductionKpi.jsx"));
  assert.match(kpi, /part="kpi"/); assert.match(kpi, /part="produksi"/);
  assert.match(kpi, /kind === "export"\) \{ setDoc\(null\)/, "tab Export tidak memanggil endpoint");
  assert.equal(KPI_TABS.find((t) => t.key === "produksi").kind, KPI_TABS.find((t) => t.key === "ringkasan").kind);
  assert.match(kpi, /\}, \[kind, qs\]\);/, "pindah antar tab ringkasan tidak memuat ulang");
});

test("Order Produksi: scope aktif menyembunyikan Terkirim, riwayat hanya Terkirim, semua tanpa penyaringan; default lama tidak berubah", () => {
  const wo = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  assert.match(wo, /if \(scope === "riwayat"\) return "TERKIRIM";/);
  assert.match(wo, /scope === "aktif" \? DISPLAY_STATUS_TABS\.filter\(\(t\) => t\.key !== "TERKIRIM"\)/);
  assert.match(wo, /scope === "riwayat" \? \[\] :/);
  assert.match(wo, /export default function ProductionWorkOrders\(\{ initialStatus = "", scope = "", onScopeChange = null, headerExtra = null, unitId: unitIdProp, onUnitChange = null \} = \{\}\)/);
  const cc = src("pages", "ComplaintCases.jsx");
  assert.match(cc, /scope === "aktif" \? allCases\.filter\(\(c\) => !kasusTutup\(c\)\) : scope === "riwayat" \? allCases\.filter\(kasusTutup\) : allCases/);
  const pb = src("pages", "pengajuanBiaya", "PengajuanBiayaWorkspace.jsx");
  assert.match(pb, /view = "semua"/, "default Gudang/Marketing/Management/HR-GA tidak berubah");
});

// ---------------------------------------------------------------- Pengaturan ---------------------------------------------------------------
test("Pengaturan: ADMIN/OWNER semua tab; Production Lead sesuai izin bawaan; peran lain tidak melihat menu maupun tab", () => {
  const keys = (roles) => settingsTabsFor(roles).map((t) => t.key);
  const ALL = ["area-kerja", "operator", "layanan", "target", "tampilan"];
  assert.deepEqual(keys(["ADMIN"]), ALL); assert.deepEqual(keys(["OWNER"]), ALL);
  assert.deepEqual(keys(["PRODUCTION_LEAD"]), ALL, "Lead memegang work_center/operator/route/report:read bawaan");
  for (const r of ["PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE", "PRODUCTION_DOCUMENTER", "SALES", "FINANCE", "DRIVER"]) { assert.deepEqual(keys([r]), [], r); assert.equal(canOpenSettings([r]), false, r); }
  assert.equal(canWriteTarget(["ADMIN"]), true); assert.equal(canWriteTarget(["OWNER"]), true); assert.equal(canWriteTarget(["PRODUCTION_LEAD"]), false, "Lead hanya melihat riwayat target");
  const page = strip(src("pages", "bengkel", "ProductionSettings.jsx"));
  assert.match(page, /if \(!canOpenSettings\(roles\)\)[\s\S]{0,400}settings-forbidden/);
  assert.match(page, /<TargetPanel canWrite=\{canWriteTarget\(roles\)\}/, "Target memakai panel target harian yang sudah live");
  assert.match(page, /<ProductionWorkCenters \/>/); assert.match(page, /<ProductionOperators \/>/); assert.match(page, /<ProductionServiceStages \/>/);
  assert.match(page, /<ThemeToggle \/>/); assert.match(page, /resetSidebarPreferences\("bengkel"\)/);
});

test("Pengaturan tidak memperluas permission backend (tanpa perubahan izin untuk membuka tab)", () => {
  const perms = fs.readFileSync(path.join(here, "..", "..", "backend", "src", "constants", "permissions.js"), "utf8");
  assert.doesNotMatch(perms, /production_settings|PRODUCTION_SETTINGS/i);
});

// ---------------------------------------------------------------- persistensi tab ----------------------------------------------------------
test("persistensi ?tab=: pickTab memilih tab valid/terlihat, jatuh ke default; withTabParam menyimpan parameter lain", () => {
  const tabs = [{ key: "a" }, { key: "b" }, { key: "c", hidden: true }];
  assert.equal(pickTab(tabs, "b", "a"), "b"); assert.equal(pickTab(tabs, "zzz", "a"), "a"); assert.equal(pickTab(tabs, null, "a"), "a");
  assert.equal(pickTab(tabs, "c", "a"), "a", "tab tersembunyi (tanpa izin) tidak pernah terpilih");
  assert.equal(pickTab([{ key: "x", hidden: true }], "x", "x"), null);
  assert.equal(withTabParam("/bengkel/kpi", "meja"), "/bengkel/kpi?tab=meja");
  assert.equal(withTabParam("/bengkel/kpi?tab=meja&x=1", "pic"), "/bengkel/kpi?tab=pic&x=1");
});

test("persistensi tab: TabbedHub menulis ?tab= ke path tab aktif (replace) dan TabsProvider menyimpannya", () => {
  const hub = strip(src("components", "TabbedHub.jsx"));
  assert.match(hub, /replaceActivePath\(withTabParam\(location\.pathname \+ location\.search, key\)\)/);
  assert.match(hub, /setParams\(\(p\) => \{[\s\S]{0,120}replace: true/);
  const ctx = strip(src("lib", "TabsContext.jsx"));
  assert.match(ctx, /function replaceActivePath\(path\) \{[\s\S]{0,300}navigate\(resolved, \{ replace: true \}\)/);
  assert.match(ctx, /reorderTabs, replaceActivePath \}/);
  assert.match(hub, /keepAlive === false/);
});
