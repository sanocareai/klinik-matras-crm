// Hub navigasi Finance: pemetaan rute lama → hub/tab, deep-link, izin, badge (tanpa hitungan baru), pemasangan di sidebar & registri halaman.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FINANCE_HUBS, cariItemHub, hubAktif, hubTerlihat, petaRuteLama, badgeItem, badgeHub } from "../src/lib/financeHubs.js";
import { isSidebarItemActive } from "../src/lib/sidebarActive.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

// Seluruh rute Finance yang ada di sidebar LAMA (sebelum hub) — tidak boleh ada yang hilang dari hub.
const RUTE_SIDEBAR_LAMA = [
  "/finance/dashboard", "/finance/pemasukan", "/finance/payments", "/finance/cash", "/finance/expenses", "/finance/pengajuan-divisi", "/finance/purchases",
  "/finance/kasbon", "/finance/penjualan-karyawan", "/finance/pengecualian-lunas", "/finance/uang-muka", "/finance/invoices", "/finance/receivables",
  "/finance/suppliers", "/finance/purchase-orders", "/finance/retur-supplier", "/finance/biaya-bahan", "/finance/journal", "/finance/ledger",
  "/finance/reconciliation", "/finance/persediaan-awal", "/finance/reports", "/finance/laporan-divisi", "/finance/accounts", "/finance/settings",
];

test("sepuluh hub; sidebar jauh lebih pendek dari 5 section/25 item lama", () => {
  assert.equal(FINANCE_HUBS.length, 10);
  assert.deepEqual(FINANCE_HUBS.map((h) => h.label), [
    "Ringkasan", "Penjualan & Piutang", "Pengeluaran & Biaya", "Pembelian & Supplier", "Kas & Bank", "Transaksi Karyawan", "Persediaan & HPP", "Pembukuan", "Laporan", "Pengaturan",
  ]);
  assert.ok(FINANCE_HUBS.length < RUTE_SIDEBAR_LAMA.length / 2);
});

test("setiap rute sidebar lama masih dapat dicapai lewat tab hub (tidak ada rute yang hilang)", () => {
  const rute = new Set(petaRuteLama().map((r) => r.rute.split("?")[0]));
  for (const r of RUTE_SIDEBAR_LAMA) assert.ok(rute.has(r), `rute ${r} hilang dari hub`);
});

test("rute lama membuka hub + tab yang benar (deep-link)", () => {
  const cek = (p, s, hub, tab) => { const h = cariItemHub(p, s); assert.equal(h?.hub.key, hub, `${p}${s}`); assert.equal(h?.item.key, tab, `${p}${s}`); };
  cek("/finance/payments", "", "penjualan", "verifikasi");
  cek("/finance/payments", "?tab=perlu", "penjualan", "verifikasi");
  cek("/finance/payments", "?tab=lunas_crm", "penjualan", "rekon-sales");
  cek("/finance/receivables", "", "penjualan", "piutang");
  cek("/finance/receivables", "?tab=refund", "penjualan", "piutang");
  cek("/finance/invoices", "", "penjualan", "invoice");
  cek("/finance/suppliers", "", "pembelian", "supplier");
  cek("/finance/suppliers", "?tab=aging", "pembelian", "aging");
  cek("/finance/suppliers", "?tab=pembayaran", "pembelian", "supplier");
  cek("/finance/cash", "", "kas", "saldo");
  cek("/finance/cash", "?tab=mutasi", "kas", "mutasi");
  cek("/finance/cash", "?tab=transfer", "kas", "saldo");
  cek("/finance/reconciliation", "?periode=2026-09", "kas", "rekon-bank");
  cek("/finance/penjualan-karyawan", "", "karyawan", "penjualan-karyawan");
  cek("/finance/persediaan-awal", "", "persediaan", "persediaan-awal");
  cek("/finance/settings", "", "pengaturan", "pengaturan");
  cek("/finance/pengecualian-lunas", "", "pengaturan", "pengecualian");
  assert.equal(cariItemHub("/finance/tidak-ada", ""), null);
  assert.equal(cariItemHub("/inbox", ""), null);
});

test("sidebar: hub aktif untuk SEMUA halaman di bawahnya (aktifJika) dan tidak untuk hub lain", () => {
  const item = { to: "/finance/payments", aktifJika: (p, s) => hubAktif(p, s) === "penjualan" };
  assert.equal(isSidebarItemActive(item, [], "/finance/receivables", ""), true);
  assert.equal(isSidebarItemActive(item, [], "/finance/payments", "?tab=lunas_crm"), true);
  assert.equal(isSidebarItemActive(item, [], "/finance/cash", ""), false);
  // item biasa tidak terpengaruh (perilaku lama)
  assert.equal(isSidebarItemActive({ to: "/finance/cash" }, [], "/finance/cash", ""), true);
  assert.equal(isSidebarItemActive({ to: "/finance/cash" }, [], "/finance/payments", ""), false);
});

test("izin: Pengajuan Biaya Divisi hanya untuk peran yang sama dengan sidebar lama; hub tanpa item terlihat dibuang", () => {
  const sales = hubTerlihat(["SALES"]);
  const pengeluaran = sales.find((h) => h.key === "pengeluaran");
  assert.deepEqual(pengeluaran.items.map((i) => i.key), ["pengeluaran"]);
  const finance = hubTerlihat(["FINANCE"]).find((h) => h.key === "pengeluaran");
  assert.deepEqual(finance.items.map((i) => i.key), ["pengeluaran", "pengajuan"]);
  assert.equal(hubTerlihat([]).find((h) => h.key === "pengeluaran").to, "/finance/expenses", "`to` hub = item pertama yang terlihat");
});

test("badge: angka antrean server apa adanya; 0/tanpa data = tidak ada badge; hub = jumlah hitungan antrean item-nya", () => {
  const antrean = { jumlahPembayaranBelumVerifikasi: 4, refundMenunggu: 2, pengeluaranMenunggu: 0, pembelianMenunggu: 3, tagihanMenunggu: 1 };
  const penjualan = FINANCE_HUBS.find((h) => h.key === "penjualan");
  const verif = penjualan.items.find((i) => i.key === "verifikasi");
  assert.equal(badgeItem(verif, antrean), 4);
  assert.equal(badgeItem(penjualan.items.find((i) => i.key === "invoice"), antrean), null);
  assert.equal(badgeHub(penjualan, antrean), 6);
  assert.equal(badgeHub(FINANCE_HUBS.find((h) => h.key === "pengeluaran"), antrean), null);
  assert.equal(badgeHub(FINANCE_HUBS.find((h) => h.key === "pembelian"), antrean), 4);
  assert.equal(badgeItem(verif, null), null);
});

test("pemasangan: sidebar Finance dari hub; bilah tab hub membungkus halaman Finance; halaman ber-tab internal terikat ?tab=; route lama tidak dihapus", () => {
  const layout = baca("../src/components/Layout.jsx");
  assert.match(layout, /financeHubNavItems\(\)/);
  assert.match(layout, /section: "MENU FINANCE"/);
  assert.match(layout, /denganBadgeFinance\(division\.sections, antreanFinance\)/);
  assert.doesNotMatch(layout, /label: "Invoice & Jatuh Tempo"/, "nama lama diganti Invoice Pelanggan");
  const reg = baca("../src/routes/pageRegistry.jsx");
  assert.match(reg, /FinanceHubFrame/);
  for (const r of RUTE_SIDEBAR_LAMA) assert.ok(reg.includes(`path: "${r}"`), `rute ${r} dihapus dari registri`);
  for (const f of ["FinanceCash", "FinanceSuppliers", "FinancePayments"]) assert.match(baca(`../src/pages/finance/${f}.jsx`), /useUrlTab\(\[/);
  const frame = baca("../src/features/finance/FinanceHubFrame.jsx");
  assert.match(frame, /role="tablist"/);
  assert.match(frame, /replaceActivePath/);
  const sb = baca("../src/components/SidebarNavSection.jsx");
  assert.match(sb, /item\.badgeN/);
});
