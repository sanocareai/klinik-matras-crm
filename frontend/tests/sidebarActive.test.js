// Tes P8.2 (UI Polish) — matriks "menu aktif" sidebar. Lihat src/lib/sidebarActive.js.
import test from "node:test";
import assert from "node:assert/strict";

import { isSidebarItemActive, searchParamsSatisfy } from "../src/lib/sidebarActive.js";

const ringkasan = { to: "/bengkel/ringkasan" };
const rencanaProduksi = { to: "/bengkel/production-v2" };
const orderProduksi = { to: "/bengkel/order-produksi" };
const riwayat = { to: "/bengkel/order-produksi?tab=work-order&status=DELIVERED" };
const legacyPapanProduksi = { to: "/bengkel" };
const legacyWorkOrders = { to: "/bengkel/work-orders" };
const DIVISION_ITEMS = [ringkasan, rencanaProduksi, orderProduksi, riwayat, legacyPapanProduksi, legacyWorkOrders];

// Matriks: [item, pathname, search] -> hasil aktif yang diharapkan.
const MATRIX = [
  ["Ringkasan aktif di /bengkel/ringkasan", ringkasan, "/bengkel/ringkasan", "", true],
  ["Ringkasan TIDAK aktif di halaman lain", ringkasan, "/bengkel/production-v2", "", false],
  ["Rencana Produksi aktif tepat di pathnya", rencanaProduksi, "/bengkel/production-v2", "", true],
  ["Legacy Papan Produksi (/bengkel) TIDAK ikut aktif untuk /bengkel/production-v2 (bug prefix NavLink lama)", legacyPapanProduksi, "/bengkel/production-v2", "", false],
  ["Legacy Papan Produksi (/bengkel) TIDAK ikut aktif untuk /bengkel/order-produksi", legacyPapanProduksi, "/bengkel/order-produksi", "", false],
  ["Legacy Papan Produksi (/bengkel) TIDAK ikut aktif untuk /bengkel/ringkasan (route baru manapun)", legacyPapanProduksi, "/bengkel/ringkasan", "", false],
  ["Legacy Papan Produksi (/bengkel) aktif HANYA di pathnya sendiri persis", legacyPapanProduksi, "/bengkel", "", true],
  ["Legacy Work Orders TIDAK ikut aktif untuk Order Produksi (route baru tidak mengaktifkan legacy & sebaliknya)", legacyWorkOrders, "/bengkel/order-produksi", "", false],
  ["Order Produksi aktif tanpa query", orderProduksi, "/bengkel/order-produksi", "", true],
  ["Order Produksi TIDAK aktif bersamaan saat di URL Riwayat (query cocok saudara lebih spesifik)", orderProduksi, "/bengkel/order-produksi", "?tab=work-order&status=DELIVERED", false],
  ["Riwayat TIDAK aktif di URL Order Produksi polos", riwayat, "/bengkel/order-produksi", "", false],
  ["Riwayat aktif tepat saat query cocok", riwayat, "/bengkel/order-produksi", "?tab=work-order&status=DELIVERED", true],
  ["Riwayat tetap aktif walau ada parameter TAMBAHAN di luar yang diwajibkan", riwayat, "/bengkel/order-produksi", "?tab=work-order&status=DELIVERED&extra=1", true],
  ["Order Produksi TETAP aktif kalau query TIDAK cocok syarat Riwayat (mis. tab lain)", orderProduksi, "/bengkel/order-produksi", "?tab=semua-order", true],
];

for (const [name, item, pathname, search, expected] of MATRIX) {
  test(`active-menu matrix: ${name}`, () => {
    assert.equal(isSidebarItemActive(item, DIVISION_ITEMS, pathname, search), expected);
  });
}

test("searchParamsSatisfy: string kosong selalu terpenuhi", () => {
  assert.equal(searchParamsSatisfy("", "?apapun=1"), true);
  assert.equal(searchParamsSatisfy(null, ""), true);
});

test("searchParamsSatisfy: seluruh pasangan wajib harus cocok nilainya", () => {
  assert.equal(searchParamsSatisfy("?a=1&b=2", "?a=1&b=2"), true);
  assert.equal(searchParamsSatisfy("?a=1&b=2", "?a=1&b=3"), false);
  assert.equal(searchParamsSatisfy("?a=1&b=2", "?a=1"), false);
});

test("searchParamsSatisfy: query URL boleh punya parameter tambahan di luar yang diwajibkan", () => {
  assert.equal(searchParamsSatisfy("?a=1", "?a=1&z=99"), true);
});

test("isSidebarItemActive: item dengan pathname berbeda tidak pernah aktif, apapun query-nya", () => {
  assert.equal(isSidebarItemActive(rencanaProduksi, DIVISION_ITEMS, "/warehouse/inventory", ""), false);
});
