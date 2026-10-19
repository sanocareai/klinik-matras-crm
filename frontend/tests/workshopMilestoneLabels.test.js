// Milestone global "Diterima di Workshop" — kosakata frontend = cermin backend (workshopMilestone.js), dan pemakaiannya di Backlog Rencana, Order Produksi, Unit 360.
// Pola text-scan proyek ini (tanpa jsdom); fungsi murni dieksekusi langsung.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "../src/features/production/productionLabels.js";
import * as M from "../../backend/src/lib/domain/workshopMilestone.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("paritas frontend ↔ backend: urutan & label milestone global; status jadwal; teks histori tanpa bukti", () => {
  assert.deepEqual(L.GLOBAL_STATUS_TABS.map((t) => t.key), [...M.GLOBAL_STATUS_FLOW]);
  assert.deepEqual(L.GLOBAL_STATUS_TABS.map((t) => t.label), M.GLOBAL_STATUS_FLOW.map((k) => M.GLOBAL_STATUS[k].label));
  assert.deepEqual(L.GLOBAL_STATUS_TABS.map((t) => t.label), ["Menunggu Dijemput", "Pengambilan", "Diterima di Workshop", "Diproses", "Siap Kirim", "Dalam Pengiriman", "Terkirim"]);
  assert.deepEqual([...L.GLOBAL_STATUS_ACTIVE_KEYS], M.GLOBAL_STATUS_FLOW.filter((k) => k !== "TERKIRIM"));
  for (const [k, v] of Object.entries(M.SCHEDULE_STATUS)) assert.equal(L.SCHEDULE_STATUS_LABEL[k], v.label, k);
  assert.equal(L.LEGACY_NOT_CONFIRMED_TEXT, M.LEGACY_NOT_CONFIRMED);
});

test("statusOf memakai globalStatus server (berbasis bukti) lebih dulu; tanpa itu jatuh ke peta tampilan lama (tidak menebak)", () => {
  const g = (key, label, detail = null) => ({ key, label, detail });
  const a = L.statusOf({ globalStatus: g("DITERIMA_WORKSHOP", "Diterima di Workshop"), status: "RECEIVED", unitStatusDisplay: { key: "DIPROSES", label: "Diproses" } });
  assert.equal(a.label, "Diterima di Workshop"); assert.equal(a.key, "DITERIMA_WORKSHOP"); assert.equal(a.tone, "accent");
  const b = L.statusOf({ globalStatus: g("PENGAMBILAN", "Pengambilan", "Pickup selesai — menunggu Terima Unit di Workshop"), status: "RECEIVED" });
  assert.equal(b.label, "Pengambilan"); assert.equal(b.detail, "Pickup selesai — menunggu Terima Unit di Workshop");
  assert.equal(L.statusOf({ globalStatus: g("DALAM_PENGIRIMAN", "Dalam Pengiriman") }).label, "Dalam Pengiriman");
  // tanpa globalStatus (payload lama / Mode Latihan): peta lama utuh
  assert.equal(L.statusOf({ status: "RECEIVED" }).label, "Diproses");
  assert.equal(L.statusOf({ status: "AWAITING_PICKUP" }).label, "Pengambilan");
  assert.equal(L.viewStatus({ globalStatus: g("DITERIMA_WORKSHOP", "Diterima di Workshop"), unit: { status: "RECEIVED" } }).label, "Diterima di Workshop");
  assert.equal(L.scheduleStatusText({ scheduleStatus: { key: "MENUNGGU_BAHAN", label: "Menunggu bahan" } }), "Menunggu bahan");
  assert.equal(L.scheduleStatusText({}), null, "tidak ada status jadwal dari server = tidak ditampilkan");
  assert.equal(L.receivedBasisText({ receivedBasisLabel: "Diterima petugas lewat custody" }), "Diterima petugas lewat custody");
  assert.equal(L.receivedBasisText({}), null);
  assert.equal(L.presenceNeedsNote({ confirmed: false }), true); assert.equal(L.presenceNeedsNote({ confirmed: true }), false); assert.equal(L.presenceNeedsNote(null), false);
});

test("Backlog Rencana: tab Semua · Pengambilan · Diterima di Workshop · Diproses; default Semua (himpunan lama); kartu menampilkan status global + dasar bukti + jadwal", () => {
  const hook = read("features", "production", "useBacklog.js");
  const tabs = [...hook.match(/BACKLOG_STATUS_TABS = Object\.freeze\(\[(.*?)\]\);/s)[1].matchAll(/\{ key: "(\w+)", label: "([^"]+)" \}/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tabs, [["SEMUA", "Semua"], ["MENUNGGU_DIJEMPUT", "Menunggu Dijemput"], ["PENGAMBILAN", "Pengambilan"], ["DITERIMA_WORKSHOP", "Diterima di Workshop"], ["DIPROSES", "Diproses"]]);
  assert.match(hook, /useState\("SEMUA"\)/);
  assert.match(read("api.js"), /getProductionV2Backlog: \(\{ status = "SEMUA"/);
  const card = strip(read("features", "production", "BacklogCard.jsx"));
  assert.match(card, /statusOf\(\{ globalStatus: c\.globalStatus/);
  assert.match(card, /data-testid="status-detail"/); assert.match(card, /data-testid="schedule-badge"/);
  assert.doesNotMatch(card, /statusTone\(c\.unitStatus\?\.key\)/, "badge status tidak lagi memakai status tampilan lama");
});

test("Order Produksi: tab = Status order (displayStatus di server, hitungan displayStatusCounts); milestone global dipakai untuk Posisi; himpunan V1 off-board memakai statusIn mentah", () => {
  const wo = strip(read("pages", "bengkel", "ProductionWorkOrders.jsx"));
  assert.match(wo, /DISPLAY_STATUS_TABS/); assert.doesNotMatch(wo, /GLOBAL_STATUS_TABS/, "tab saring = Status order, bukan milestone campuran");
  assert.match(wo, /api\.getWorkOrders\(queryServer\(/); assert.match(wo, /displayStatus: displayParam/);
  assert.equal((wo.match(/displayStatusCounts/g) || []).length, 2);
  assert.match(wo, /const ACTIVE_KEYS = Object\.freeze\(\["PENGAMBILAN", "DIPROSES", "SIAP_KIRIM"\]\)/);
  assert.match(wo, /data-testid="posisi-perhatian"/, "posisi yang perlu perhatian (mis. sudah dijemput · belum diterima workshop) tampil terpisah dari status order");
  const v1 = strip(read("features", "production", "v1Source.jsx"));
  assert.match(v1, /getWorkOrders\(\{ statusIn: "RECEIVED,IN_PRODUCTION", real: "1"/, "himpunan lama (unit tersimpan RECEIVED/IN_PRODUCTION) tetap persis sama");
});

test("Unit 360: Ringkasan memisahkan status global · posisi unit (+dasar bukti) · status jadwal", () => {
  const d = strip(read("features", "production", "UnitOverviewDrawer.jsx"));
  assert.match(d, /<Field label="Status global"/); assert.match(d, /<Field label="Status jadwal"/); assert.match(d, /<Field label="Posisi unit" value=\{\[d\.identity\.presence\?\.label, receivedBasisText\(d\.identity\)\]/);
});

test("tombol 'Unit Tiba di Workshop' diganti 'Terima Unit di Workshop' di semua teks tampilan; command custody tidak berubah", () => {
  for (const f of [["features", "production", "ScheduleModals.jsx"], ["pages", "bengkel", "ProductionPlannerV2.jsx"], ["pages", "bengkel", "ProductionWorkflowSettings.jsx"], ["features", "production", "experience.js"]]) {
    assert.doesNotMatch(read(...f), /Unit Tiba di Workshop/, f.join("/"));
    assert.match(read(...f), /Terima Unit di Workshop/, f.join("/"));
  }
  // endpoint/command yang dipanggil tetap yang resmi (konfirmasi kedatangan -> acceptUnitCustody di server)
  assert.match(read("api.js"), /confirm-arrival/);
});
