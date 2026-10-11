// Keputusan Owner (11 Okt 2026): Mode Latihan dihilangkan dari aplikasi — tidak ada toggle/banner/lencana/dataset; halaman memakai data nyata; ?demo=1 diabaikan dan dibuang.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8").replace(/\r\n/g, "\n");
const CONTROLS = read("features", "production", "demo", "DemoControls.jsx");
const TABS = read("features", "production", "workerApp", "Tabs.jsx");

test("sakelar kode MODE_LATIHAN_TERSEDIA = false; DemoPage memilih pembungkus nonaktif (pass-through) dan DemoBarSlot tidak merender apa pun", () => {
  assert.match(CONTROLS, /export const MODE_LATIHAN_TERSEDIA = false;/);
  assert.match(CONTROLS, /export function DemoPage\(props\) \{\n  return MODE_LATIHAN_TERSEDIA \? <DemoPageAktif \{\.\.\.props\} \/> : <DemoPageNonaktif \{\.\.\.props\} \/>;/);
  assert.match(CONTROLS, /if \(!MODE_LATIHAN_TERSEDIA \|\| !c\?\.eligible\) return null;/);
  // pembungkus nonaktif: hanya children + membuang ?demo=1; tidak memanggil getDemoAccess/activateDemo/installDemoNetworkGuard
  const nonaktif = CONTROLS.slice(CONTROLS.indexOf("function DemoPageNonaktif"), CONTROLS.indexOf("export function DemoPage(props)"));
  assert.match(nonaktif, /n\.delete\("demo"\)/);
  assert.match(nonaktif, /return <>\{children\}<\/>;/);
  assert.doesNotMatch(nonaktif, /getDemoAccess|activateDemo|installDemoNetworkGuard|DemoBar|DemoBadge/);
});

test("aplikasi lantai (Tabs Akun): tidak ada slot/ panel Mode Latihan", () => {
  assert.doesNotMatch(TABS, /akun-latihan/);
  assert.doesNotMatch(TABS, /DemoBarSlot/);
});
