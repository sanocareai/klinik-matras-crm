// Tes P8.2 (UI Polish) — migrasi/dedup tab tersimpan. Lihat src/lib/tabTitles.js (dedupeTabs) dan src/lib/splitPathQuery.js (canonicalizeTabPath).
import test from "node:test";
import assert from "node:assert/strict";

import { dedupeTabs, findTabIndexByPath } from "../src/lib/tabTitles.js";
import { canonicalizeTabPath } from "../src/lib/splitPathQuery.js";

test("canonicalizeTabPath: path tanpa query tidak berubah", () => {
  assert.equal(canonicalizeTabPath("/warehouse/dashboard"), "/warehouse/dashboard");
});

test("canonicalizeTabPath: urutan parameter query diurutkan (kanonik)", () => {
  assert.equal(canonicalizeTabPath("/bengkel/order-produksi?status=DELIVERED&tab=work-order"), canonicalizeTabPath("/bengkel/order-produksi?tab=work-order&status=DELIVERED"));
});

test("dedupeTabs: tab Dashboard dobel dari state lama dibersihkan jadi satu", () => {
  const tabs = [
    { id: "t1", path: "/warehouse/dashboard", title: "Dashboard" },
    { id: "t2", path: "/bengkel/production-v2", title: "Rencana Produksi" },
    { id: "t3", path: "/warehouse/dashboard", title: "Dashboard" },
  ];
  const out = dedupeTabs(tabs, "t2");
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((t) => t.path), ["/warehouse/dashboard", "/bengkel/production-v2"]);
});

test("dedupeTabs: TIDAK menghapus tab aktif yang valid — menang atas duplikat lebih awal", () => {
  const tabs = [
    { id: "t1", path: "/warehouse/dashboard", title: "Dashboard (lama)" },
    { id: "t2", path: "/warehouse/dashboard", title: "Dashboard (aktif)" },
  ];
  const out = dedupeTabs(tabs, "t2");
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "t2");
  assert.equal(out[0].title, "Dashboard (aktif)");
});

test("dedupeTabs: urutan relatif tab yang tersisa mengikuti kemunculan pertama path itu", () => {
  const tabs = [
    { id: "t1", path: "/a", title: "A" },
    { id: "t2", path: "/b", title: "B" },
    { id: "t3", path: "/a", title: "A dobel" },
    { id: "t4", path: "/c", title: "C" },
  ];
  const out = dedupeTabs(tabs, "t1");
  assert.deepEqual(out.map((t) => t.path), ["/a", "/b", "/c"]);
});

test("dedupeTabs: canonicalize route+query — dua path beda urutan parameter dianggap satu tab", () => {
  const tabs = [
    { id: "t1", path: "/bengkel/order-produksi?tab=work-order&status=DELIVERED", title: "Riwayat" },
    { id: "t2", path: "/bengkel/order-produksi?status=DELIVERED&tab=work-order", title: "Riwayat (dobel urutan beda)" },
  ];
  const out = dedupeTabs(tabs, "t1");
  assert.equal(out.length, 1);
});

test("dedupeTabs: tanpa duplikat sama sekali, daftar tidak berubah (idempoten)", () => {
  const tabs = [
    { id: "t1", path: "/a", title: "A" },
    { id: "t2", path: "/b", title: "B" },
  ];
  const out = dedupeTabs(tabs, "t1");
  assert.deepEqual(out, tabs);
});

test("dedupeTabs: idempoten — dijalankan dua kali menghasilkan hasil yang sama", () => {
  const tabs = [
    { id: "t1", path: "/warehouse/dashboard", title: "Dashboard" },
    { id: "t2", path: "/warehouse/dashboard", title: "Dashboard" },
    { id: "t3", path: "/armada/dashboard", title: "Delivery · Dashboard" },
  ];
  const once = dedupeTabs(tabs, "t1");
  const twice = dedupeTabs(once, "t1");
  assert.deepEqual(once, twice);
});

test("findTabIndexByPath: urutan parameter query beda tetap dianggap tab yang sama (kanonik)", () => {
  const tabs = [{ id: "t1", path: "/bengkel/order-produksi?tab=work-order&status=DELIVERED", title: "Riwayat" }];
  assert.equal(findTabIndexByPath(tabs, "/bengkel/order-produksi?status=DELIVERED&tab=work-order"), 0);
});
