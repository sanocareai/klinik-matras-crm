// Fase 1 kerangka bersama Sales CRM (31 Okt 2026): sidebar (ikon SVG, workspace ringkas, tombol bantuan), header (kolom pencarian),
// tab aplikasi (identitas tab kembar, judul menu). Tes statis atas sumber + fungsi murni; tampilan terukur di browser terpisah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { konteksTabKembar, konteksDivisiTab, titleFromPath } from "../src/lib/tabTitles.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const layout = baca("src/components/Layout.jsx");
const topbar = baca("src/components/Topbar.jsx");
const palette = baca("src/components/ui/command-palette.jsx");
const css = baca("src/styles/sanss-crm.css");
const ikon = baca("src/components/sanssIcons.jsx");
const cssTanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");
const bagian14 = cssTanpaKomentar.slice(cssTanpaKomentar.indexOf(":root .app-shell.crm-skin .sidebar-link .nav-icon,"));

test("Ikon: setiap menu Sales CRM punya ikon SVG di peta; pemetaan hanya untuk divisi growth", () => {
  const growth = layout.slice(layout.indexOf("growth: {"), layout.indexOf("// ── PRODUCTION OPERATIONS"));
  const rute = [...growth.matchAll(/\{ to: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(rute.length >= 15, "daftar menu growth terbaca");
  for (const r of rute) assert.ok(ikon.includes(`"${r}":`), `ikon untuk ${r}`);
  assert.ok(layout.includes("const sectionsVisible = crmShell ? denganIkonSales(sectionsBase) : sectionsBase;"));
  assert.ok(layout.includes('const crmShell = divisionKey === "growth" && !IS_DRIVER_APP && !CRM_SKIN_OFF;'));
  assert.ok(layout.includes('crmShell && "crm-skin"'));
});

test("Ikon: keluarga SVG inline (currentColor, tanpa aset/URL luar) — aman untuk PWA/precache", () => {
  assert.ok(!/https?:|href=|<image|url\(|fetch\(|import .* from "[^.@]/.test(ikon.replace(/import React from "react";/, "")), "tanpa aset eksternal");
  assert.ok(ikon.includes('fill="currentColor"') && ikon.includes("opacity: 0.35"));
  assert.ok(!/url\(/.test(bagian14), "CSS shell tanpa url()");
});

test("Menu, urutan, badge, hak akses tidak disentuh: Layout hanya memetakan ikon per rute", () => {
  assert.ok(layout.includes("denganIkonSales(sections)") && layout.includes("{ ...it, Icon: IKON_NAV_SALES[it.to] }"));
  assert.ok(!/Pelanggan.*Lainnya|"Lainnya"/.test(layout.slice(layout.indexOf("growth: {"), layout.indexOf("// ── PRODUCTION OPERATIONS"))), "tidak ada pemindahan menu ke Lainnya");
});

test("Pencarian: kolom terlihat HANYA saat crmShell; tombol lama utuh untuk divisi lain; palette sama", () => {
  assert.ok(topbar.includes("{!crmShell && ("), "tombol lama tetap untuk divisi lain");
  assert.ok(topbar.includes('className="topbar-searchfield"') && topbar.includes('className="topbar-searchbtn"'));
  assert.ok(topbar.includes("halaman={crmShell ? halaman : undefined}") && topbar.includes("onPilih={crmShell ?"));
  assert.ok(topbar.includes('"⌘ K" : "Ctrl K"'), "pintasan sesuai platform");
  // placeholder hanya menyebut yang didukung: halaman/menu
  assert.ok(topbar.includes("Cari halaman atau menu…") && !/Cari pelanggan, order/.test(topbar.slice(topbar.indexOf("topbar-searchfield"))));
  assert.ok(palette.includes('aktif ? "Cari halaman atau menu…" : "Cari pelanggan, percakapan, halaman…"'), "tanpa halaman: tampilan lama");
});

test("Palette: daftar halaman = menu yang boleh dilihat (sumber sama dengan sidebar); Enter/panah/Esc", () => {
  assert.ok(layout.includes("visibleSections(division.sections, isAdmin).flatMap("));
  assert.ok(palette.includes('e.key === "ArrowDown"') && palette.includes('e.key === "Enter"'));
  assert.ok(palette.includes("(e.metaKey || e.ctrlKey) && (e.key === \"k\" || e.key === \"K\")"), "Ctrl/⌘ K tetap");
});

test("CSS shell: semua aturan di bawah .crm-skin (kecuali palette & dropdown workspace yang di-portal ke body); tanpa font/@import baru", () => {
  const aturan = bagian14.split("}").map((b) => b.split("{")[0].trim()).filter(Boolean);
  for (const sel of aturan.join(",").split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("@") && !/^\d|^from|^to/.test(s)))
    assert.ok(sel.includes(".crm-skin") || sel.includes(".crm-ws-menu") || sel.startsWith(".palette-input-ringkas") || sel.startsWith("}"), `selektor di luar tema: ${sel}`);
  assert.ok(!/font-family|@font-face|@import/.test(cssTanpaKomentar));
});

test("Pencarian HP: kolom jadi tombol ikon ≤1100px; hamburger disembunyikan hanya ≥1025px", () => {
  assert.ok(css.includes("@media (max-width: 1100px)") && css.includes(".topbar-searchbtn { display: flex; margin-left: auto; }"));
  assert.ok(css.includes("@media (min-width: 1025px)") && css.includes(".topbar-hamburger-btn { display: none !important; }"));
});

test("Sidebar: nav scroll terpisah, bantuan = satu tombol kecil, workspace nama pendek", () => {
  const promo = baca("src/features/settings/SidebarPromo.jsx");
  assert.ok(promo.includes("if (ringkas)") && promo.includes('className="sidebar-help-btn"') && promo.includes('navigate("/copilot")'));
  assert.ok(layout.includes("<SidebarPromo ringkas={crmShell} />") && layout.includes("ringkas={crmShell}"));
  const ws = baca("src/components/WorkspaceSwitcher.jsx");
  assert.ok(ws.includes('short: "Sales CRM"') && ws.includes("ringkas && aktif?.short ? aktif.short : judul"));
  assert.ok(css.includes(":root .app-shell.crm-skin .sidebar-nav {"), "nav discroll sendiri (bagian 11)");
});

test("Tab: fungsi tab utuh (tutup, tambah, drag, klik kanan); konteks hanya muncul di tema Sales CRM", () => {
  const strip = baca("src/components/TabStrip.jsx");
  for (const k of ["closeTab(tab.id)", "openNewTab(\"/portal\")", "onDragStart", "onContextMenu", "closeOthers"]) assert.ok(strip.includes(k), k);
  assert.ok(baca("src/index.css").includes(".tab-chip-konteks { display: none; }"), "divisi lain tidak berubah");
  assert.ok(css.includes("display: inline-block;\n  flex-shrink: 1;"));
});

test("Identitas tab kembar: konteks hanya untuk judul yang sama; unik tidak diberi konteks", () => {
  const tabs = [
    { id: "a", title: "Laporan", path: "/laporan" }, { id: "b", title: "Laporan", path: "/armada/reports" },
    { id: "c", title: "Pelanggan", path: "/customers" }, { id: "d", title: "Delivery · Dashboard", path: "/armada/dashboard" },
  ];
  const k = konteksTabKembar(tabs);
  assert.equal(k.get("a"), "Sales CRM"); assert.equal(k.get("b"), "Delivery");
  assert.equal(k.get("c"), null); assert.equal(k.get("d"), null);
  assert.equal(konteksDivisiTab("/warehouse/inventory"), "Gudang");
  assert.equal(konteksDivisiTab("/marketing/laporan-biaya"), "Marketing");
});

test("Identitas tab kembar: divisi sama + query beda → petunjuk dari query; tanpa petunjuk → nomor urut posisi dalam kelompok kembar", () => {
  const k = konteksTabKembar([
    { id: "a", title: "Order", path: "/orders?tab=papan" }, { id: "b", title: "Order", path: "/orders?tab=tabel" }, { id: "c", title: "Order", path: "/orders" },
  ]);
  assert.equal(k.get("a"), "Sales CRM · papan"); assert.equal(k.get("b"), "Sales CRM · tabel"); assert.equal(k.get("c"), "Sales CRM · 3");
});

test("Judul tab dari URL memakai nama menu Sales CRM (bukan slug Inggris); divisi lain tak berubah", () => {
  assert.equal(titleFromPath("/customers"), "Pelanggan");
  assert.equal(titleFromPath("/orders"), "Order");
  assert.equal(titleFromPath("/komplain"), "Kasus Komplain");
  assert.equal(titleFromPath("/armada/orders"), "Delivery · Orders");
  assert.equal(titleFromPath("/warehouse/inventory"), "Stok & Lokasi");
});

test("Breadcrumb: rute Sales CRM yang dulu jatuh ke slug mentah kini berlabel", () => {
  for (const r of ['"/orders":      ["Data", "Order"]', '"/komplain":    ["Data", "Kasus Komplain"]', '"/copilot":     ["AI & Otomasi", "Tanya Sano"]']) assert.ok(topbar.includes(r), r);
});

test("PWA: tidak menyentuh manifest, service worker, index.html, atau aset publik (cek sumber build)", () => {
  const vite = baca("vite.config.js");
  assert.ok(vite.includes('display: "standalone"') && vite.includes("injectManifest"), "konfigurasi PWA masih seperti semula");
  assert.ok(!/sanss-crm|sanssIcons|topbar-search/.test(vite), "konfigurasi PWA tidak merujuk berkas shell");
});

test("Ruang vertikal: kelas pengait inert di PageContainer/PageHeader; margin bawaan h1/p dinolkan hanya di tema", () => {
  const page = baca("src/components/ui/page.jsx");
  assert.ok(page.includes('"page-container mx-auto w-full p-4 md:p-8"') && page.includes("page-title") && page.includes("page-subtitle"));
  assert.ok(css.includes(":root .app-shell.crm-skin .page-title { margin: 0; }"));
  assert.ok(css.includes("height: 56px;") && css.includes("height: 42px;"));
});
