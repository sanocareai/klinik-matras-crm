// Satu pintu masuk Gudang: Beranda Gudang. "/gudang" (halaman lama 'Warehouse command center') tidak boleh lagi menjadi halaman — tab tersimpan, bookmark, navigasi dalam-app, dan WorkspaceSwitcher semuanya berujung ke /warehouse/dashboard.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { legacyRedirectFor, tabPathFor } from "../src/lib/legacyProductionRoutes.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(dir, "../src", rel), "utf8").replace(/\r\n/g, "\n");
const semuaSumber = (d = path.join(dir, "../src")) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? semuaSumber(path.join(d, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(d, e.name)] : []));

test("/gudang dan /gudang/* dialihkan ke Beranda Gudang (query dipertahankan); rute baru tidak tersentuh", () => {
  assert.deepEqual(legacyRedirectFor("/gudang"), { to: "/warehouse/dashboard", standalone: false });
  assert.deepEqual(legacyRedirectFor("/gudang/apa-saja"), { to: "/warehouse/dashboard", standalone: false });
  assert.equal(tabPathFor("/gudang"), "/warehouse/dashboard"); assert.equal(tabPathFor("/gudang?x=1"), "/warehouse/dashboard?x=1");
  for (const p of ["/warehouse/dashboard", "/warehouse/inventory", "/warehouse/material-issue/abc", "/warehouse/transfers?tahap=jalan", "/gudangan"]) assert.equal(legacyRedirectFor(p), null, p);
});

test("tab tersimpan /gudang dipulihkan sebagai Beranda Gudang (judul ikut), tab lain tidak berubah; berlaku saat memuat DAN menyimpan", async () => {
  const simpan = new Map(); globalThis.localStorage = { getItem: (k) => (simpan.has(k) ? simpan.get(k) : null), setItem: (k, v) => simpan.set(k, String(v)), removeItem: (k) => simpan.delete(k) };
  const { loadTabs, saveTabs } = await import("../src/lib/openTabs.js");
  simpan.set("open-tabs:v1", JSON.stringify({ activeId: "a", tabs: [{ id: "a", path: "/gudang", title: "Gudang" }, { id: "b", path: "/dashboard", title: "Dashboard" }, { id: "c", path: "/warehouse/material-issue/xyz", title: "Pengeluaran" }] }));
  const m = loadTabs(); assert.equal(m.tabs[0].path, "/warehouse/dashboard"); assert.notEqual(m.tabs[0].title, "Gudang"); assert.equal(m.tabs[0].title, "Gudang · Beranda");
  assert.deepEqual(m.tabs.slice(1).map((t) => t.path), ["/dashboard", "/warehouse/material-issue/xyz"], "tab lain & tautan detail dokumen tidak berubah");
  saveTabs({ tabs: [{ id: "a", path: "/gudang", title: "Gudang" }], activeId: "a" }); assert.equal(JSON.parse(simpan.get("open-tabs:v1")).tabs[0].path, "/warehouse/dashboard");
  delete globalThis.localStorage;
});

test("urutan workspace buatan pengguna yang memuat /gudang tetap berlaku setelah tujuan Gudang pindah", async () => {
  const simpan = new Map(); globalThis.localStorage = { getItem: (k) => (simpan.has(k) ? simpan.get(k) : null), setItem: (k, v) => simpan.set(k, String(v)), removeItem: (k) => simpan.delete(k) };
  const { getWorkspaceOrder } = await import("../src/lib/sidebarOrder.js");
  simpan.set("sidebar-order:__workspaces__", JSON.stringify(["/finance", "/gudang", "/dashboard"])); assert.deepEqual(getWorkspaceOrder(), ["/finance", "/warehouse/dashboard", "/dashboard"]);
  delete globalThis.localStorage;
});

test("tidak ada pintu masuk alternatif: pageRegistry tak merutekan /gudang; WorkspaceSwitcher menuju Beranda; tidak ada tautan/navigasi ke '/gudang' di kode aplikasi", () => {
  const reg = baca("routes/pageRegistry.jsx"); assert.doesNotMatch(reg, /path: "\/gudang"/); assert.doesNotMatch(reg, /pages\/Gudang\.jsx/);
  assert.match(baca("components/WorkspaceSwitcher.jsx"), /key: "warehouse", label: "Warehouse & Inventory Control", to: "\/warehouse\/dashboard"/);
  assert.match(baca("routes/pageRegistry.jsx"), /base === "\/warehouse"\) return "\/warehouse\/dashboard"/);
  const pelanggar = [];
  for (const f of semuaSumber()) {
    const rel = path.relative(path.join(dir, "../src"), f).split(path.sep).join("/"); if (rel === "pages/Gudang.jsx" || rel === "lib/legacyProductionRoutes.js" || rel === "lib/sidebarOrder.js") continue; // dua pemetaan sah: pengalihan rute lama dan migrasi urutan workspace tersimpan
    const src = fs.readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    if (/["'`]\/gudang(["'`/?]|$)/m.test(src) && !/startsWith\("\/gudang"\)/.test(src)) pelanggar.push(rel);
  }
  assert.deepEqual(pelanggar, [], "berkas yang masih menautkan /gudang");
});

test("halaman Beranda & Stok & Lokasi di sidebar adalah halaman baru; Beranda tidak mengklaim 'Stok aman' atau angka katalog", () => {
  const layout = baca("components/Layout.jsx"); assert.match(layout, /to: "\/warehouse\/dashboard", label: "Beranda"/); assert.match(layout, /to: "\/warehouse\/inventory", label: "Stok & Lokasi"/);
  const reg = baca("routes/pageRegistry.jsx"); assert.match(reg, /path: "\/warehouse\/dashboard\/:jenis\?\/:id\?", render: \(\) => <WarehouseDashboard \/>/); assert.match(reg, /path: "\/warehouse\/inventory"/);
  const beranda = baca("pages/warehouse/WarehouseDashboard.jsx"); assert.doesNotMatch(beranda, /Stok aman|Warehouse command center|aktif di katalog/);
});

test("skrip rilis frontend-saja: allowlist tepat enam berkas perbaikan, backend/prisma/package tidak boleh, hitungan data sebelum=sesudah, dist baru tanpa halaman lama", () => {
  const skrip = fs.readFileSync(path.join(dir, "../../scripts/release-gudang-pintu-masuk.sh"), "utf8").replace(/\r\n/g, "\n");
  const re = new RegExp(skrip.match(/^ALLOWED_RE='(.*)'$/m)[1]);
  for (const f of ["frontend/src/components/WorkspaceSwitcher.jsx", "frontend/src/lib/legacyProductionRoutes.js", "frontend/src/lib/sidebarOrder.js", "frontend/src/pages/Gudang.jsx", "frontend/src/routes/pageRegistry.jsx", "frontend/tests/gudangPintuMasuk.test.js", "scripts/release-gudang-pintu-masuk.sh"]) assert.ok(re.test(f), f);
  for (const f of ["backend/src/routes/materialIssue.js", "backend/prisma/schema.prisma", "frontend/package.json", "frontend/src/api.js", "frontend/dist/index.html", "scripts/release-iklan-tab-frontend.sh"]) assert.ok(!re.test(f), f);
  for (const s of ['die "backend/ di release baru BERBEDA dari release aktif', "dist baru MASIH memuat halaman lama", "hitungan data BERUBAH selama rilis", 'die "image berubah (rilis ini tidak boleh mengganti image)"', "--rollback"]) assert.ok(skrip.includes(s), s);
  assert.doesNotMatch(skrip, /prisma migrate deploy/);
  assert.ok(!skrip.split("\n").some((l) => /^\s*docker (build|compose .*\bbuild\b)/.test(l)), "rilis ini tidak membangun image");
});
