// Laporan owner 4 Okt 2026: dari Aplikasi Meja (Meja Bongkar), panah kembali selalu ke Main Hub, bukan tab sebelumnya.
// Akar: halaman mandiri dibuka lewat window.location.assign (tanpa TabsProvider) dan StandaloneShell hard-code backHref="/portal".
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = fs.readFileSync(path.join(here, "..", "src", "components", "StandaloneShell.jsx"), "utf8");

function fakeStorage(value) {
  globalThis.localStorage = { getItem: () => value, setItem() {} };
}
const { lastActiveTabPath } = await import("../src/lib/openTabs.js");
const store = (tabs, activeId) => JSON.stringify({ tabs, activeId });

test("lastActiveTabPath: mengembalikan path tab AKTIF (bukan tab pertama / bukan Main Hub)", () => {
  fakeStorage(store([{ id: "a", path: "/portal" }, { id: "b", path: "/bengkel/produksi?tab=rencana" }], "b"));
  assert.equal(lastActiveTabPath("/produksi/meja"), "/bengkel/produksi?tab=rencana");
});

test("lastActiveTabPath: tanpa tab tersimpan / rusak / tujuan = halaman mandiri itu sendiri → null (cadangan /portal)", () => {
  fakeStorage(null); assert.equal(lastActiveTabPath("/produksi/meja"), null);
  fakeStorage("{bukan json"); assert.equal(lastActiveTabPath("/produksi/meja"), null);
  fakeStorage(store([{ id: "a", path: "/produksi/meja?x=1" }], "a")); assert.equal(lastActiveTabPath("/produksi/meja"), null);
  fakeStorage(store([{ id: "a", path: "javascript:alert(1)" }], "a")); assert.equal(lastActiveTabPath("/produksi/meja"), null, "hanya path internal");
  fakeStorage(store([{ id: "a", path: "/x" }], "tidak-ada")); assert.equal(lastActiveTabPath("/produksi/meja"), null);
});

test("lastActiveTabPath: parameter ?demo= tidak ikut terbawa (stripDemoParam tetap berlaku)", () => {
  fakeStorage(store([{ id: "a", path: "/bengkel/produksi?demo=1&tab=rencana" }], "a"));
  assert.equal(lastActiveTabPath("/produksi/meja"), "/bengkel/produksi?tab=rencana");
});

test("StandaloneShell: panah kembali memakai tab aktif tersimpan; /portal hanya cadangan; backHref eksplisit tetap menang; onLeave tetap ada", () => {
  assert.match(shell, /backHref \|\| lastActiveTabPath\(pathname\) \|\| "\/portal"/);
  assert.doesNotMatch(shell, /backHref = "\/portal"/, "tidak ada lagi default keras ke Main Hub");
  assert.match(shell, /<Link to=\{target\}/);
  assert.match(shell, /onLeave && !onLeave\(\)/);
});
