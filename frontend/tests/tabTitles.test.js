// Tes P8.1 (UI & Navigation Consolidation) — dedup tab dalam-app & judul tab
// tidak ambigu. Lihat src/lib/tabTitles.js untuk konteks lengkap.
import test from "node:test";
import assert from "node:assert/strict";

import { titleFromPath, findTabIndexByPath } from "../src/lib/tabTitles.js";

test("judul halaman biasa: title-case, strip tanda hubung", () => {
  assert.equal(titleFromPath("/bengkel/work-orders"), "Work Orders");
  assert.equal(titleFromPath("/bengkel/rencana-produksi"), "Rencana Produksi");
});

// P9B.1 — halaman ganti nama tampilan ("Rencana Produksi" P9B -> "Status Produksi") TANPA ganti URL
// (kompatibilitas bookmark/tab lama) — override eksplisit karena title-case umum ("Production V2") tidak
// pernah cocok dengan nama tampilan baru.
test("P9B.1: /bengkel/production-v2 berjudul tab 'Status Produksi' (override, URL tidak berubah)", () => {
  assert.equal(titleFromPath("/bengkel/production-v2"), "Status Produksi");
});

test("segmen ID (UUID) memakai nama resource, bukan ID mentah", () => {
  assert.equal(titleFromPath("/bengkel/units/d8654bcf-20ec-4b84-9721-abcdef123456"), "Unit");
});

test("segmen ambigu (dashboard) diberi prefiks nama divisi", () => {
  assert.equal(titleFromPath("/armada/dashboard"), "Delivery · Dashboard");
  assert.equal(titleFromPath("/warehouse/dashboard"), "Gudang · Dashboard");
});

test("dua tab dashboard divisi berbeda TIDAK berjudul sama (bug lama)", () => {
  const a = titleFromPath("/armada/dashboard");
  const b = titleFromPath("/warehouse/dashboard");
  assert.notEqual(a, b);
});

test("segmen tidak ambigu tanpa divisi dikenal tetap apa adanya (tanpa prefiks)", () => {
  assert.equal(titleFromPath("/dashboard"), "Dashboard");
});

test("query string dibuang sebelum judul diturunkan (menu Riwayat, ?tab=...)", () => {
  assert.equal(titleFromPath("/bengkel/order-produksi?tab=work-order&status=DELIVERED"), "Order Produksi");
});

test("findTabIndexByPath: menemukan tab yang sudah terbuka untuk path yang sama", () => {
  const tabs = [
    { id: "t1", path: "/bengkel/production-v2", title: "Rencana Produksi" },
    { id: "t2", path: "/warehouse/inventory", title: "Stok & Lokasi" },
  ];
  assert.equal(findTabIndexByPath(tabs, "/bengkel/production-v2"), 0);
  assert.equal(findTabIndexByPath(tabs, "/warehouse/inventory"), 1);
});

test("findTabIndexByPath: -1 kalau belum ada tab untuk path itu", () => {
  const tabs = [{ id: "t1", path: "/bengkel/production-v2", title: "Rencana Produksi" }];
  assert.equal(findTabIndexByPath(tabs, "/bengkel/andon"), -1);
});
