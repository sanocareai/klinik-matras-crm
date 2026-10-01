// Antrean retur sisa bahan (Gudang) + urutan manual unit per meja (Rencana Produksi): logika murni dieksekusi dari sumber,
// struktur layar dipindai (pola text-scan proyek ini, tanpa jsdom).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareStationOrder, dropPosition, hasManualOrder, moveRelativeTo, moveStep, orderedStationItems } from "../src/features/production/stationOrder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const RENCANA = read("pages", "bengkel", "ProductionRencanaWorkspace.jsx");
const QUEUE = read("pages", "warehouse", "WarehouseProductionQueue.jsx");
const API = read("api.js");
const FG = read("features", "warehouse", "finishedGoods.js");

test("compareStationOrder: urutan manual menang atas prioritas; tanpa nomor = prioritas desc lalu target mulai; bernomor selalu di atas", () => {
  const ids = (items) => orderedStationItems(items).map((v) => v.id);
  const v = (id, plan) => ({ id, plan });
  assert.deepEqual(ids([v("a", { stationSequence: 2, priority: 2 }), v("b", { stationSequence: 1, priority: 0 }), v("c", { stationSequence: 3, priority: 1 })]), ["b", "a", "c"]);
  assert.deepEqual(ids([v("a", { priority: 0 }), v("b", { priority: 2, targetStartAt: "2026-10-02T09:00:00Z" }), v("c", { priority: 2, targetStartAt: "2026-10-02T08:00:00Z" }), v("d", { priority: 1 })]), ["c", "b", "d", "a"]);
  assert.deepEqual(ids([v("new", { priority: 2 }), v("m1", { stationSequence: 1, priority: 0 })]), ["m1", "new"]);
  assert.equal(compareStationOrder({ stationSequence: 1 }, { stationSequence: 1 }), 0);
  assert.equal(hasManualOrder([v("a", { priority: 1 })]), false);
  assert.equal(hasManualOrder([v("a", { priority: 1, stationSequence: 1 })]), true);
});

test("moveStep: naik/turun satu langkah; di ujung atau id tak dikenal = null (tombol tidak mengirim apa pun)", () => {
  assert.deepEqual(moveStep(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveStep(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  assert.equal(moveStep(["a", "b", "c"], "a", -1), null);
  assert.equal(moveStep(["a", "b", "c"], "c", 1), null);
  assert.equal(moveStep(["a", "b"], "zzz", 1), null);
});

test("moveRelativeTo: seret ke sebelum/sesudah sasaran; tanpa perubahan = null; id asing = null", () => {
  assert.deepEqual(moveRelativeTo(["a", "b", "c"], "c", "a", "before"), ["c", "a", "b"]);
  assert.deepEqual(moveRelativeTo(["a", "b", "c"], "a", "c", "after"), ["b", "c", "a"]);
  assert.deepEqual(moveRelativeTo(["a", "b", "c"], "a", "c", "before"), ["b", "a", "c"]);
  assert.equal(moveRelativeTo(["a", "b", "c"], "a", "b", "before"), null, "sudah di posisi itu");
  assert.equal(moveRelativeTo(["a", "b", "c"], "a", "a", "after"), null);
  assert.equal(moveRelativeTo(["a", "b"], "x", "a", "before"), null);
  assert.equal(dropPosition(10, { top: 0, height: 100 }), "before");
  assert.equal(dropPosition(80, { top: 0, height: 100 }), "after");
});

test("Rencana: urutan manual lewat seret DAN tombol Naik/Turun, memanggil satu command reorder berisi daftar lengkap; prioritas bukan lagi sort klien", () => {
  assert.match(RENCANA, /api\.reorderProductionV2Station\(\{ productionDate: date, stationCode: station\.code, orderedPlanIds \}\)/);
  assert.match(RENCANA, /data-testid="order-up"[\s\S]{0,200}Naikkan urutan/);
  assert.match(RENCANA, /data-testid="order-down"[\s\S]{0,200}Turunkan urutan/);
  assert.match(RENCANA, /onDrop=\{\(e\) => onDropCard\(e, v\)\}/);
  assert.match(RENCANA, /moveRelativeTo\(planIds, dragged\.plan\.id, target\.plan\.id/);
  assert.match(RENCANA, /orderedStationItems\(station\.items\)/);
  assert.doesNotMatch(RENCANA, /\(b\.plan\?\.priority \?\? 0\) - \(a\.plan\?\.priority \?\? 0\)/, "tidak ada sort prioritas lokal yang menimpa urutan manual");
  assert.match(RENCANA, /Urutan diatur manual/); assert.match(RENCANA, /Urutan bawaan: prioritas/);
  assert.match(API, /reorderProductionV2Station:[\s\S]{0,200}\/production-v2\/stations\/reorder/);
});

test("Gudang: tab Retur Sisa + kartu Terima Retur (jumlah, catatan wajib bila kurang); barang jadi diblokir sampai retur diterima", () => {
  assert.match(QUEUE, /\["return", "Retur Sisa"\]/);
  assert.match(QUEUE, /api\.receiveProductionV2MaterialReturn\(r\.id, \{ expectedRevision: r\.revision, qty, note: note \|\| undefined \}\)/);
  assert.match(QUEUE, /data-testid="receive-return"/);
  assert.match(QUEUE, /Catatan selisih \(wajib\)/);
  assert.match(QUEUE, /h\.returnPending \?[\s\S]{0,400}Terima retur sisa bahan/, "kartu barang jadi tidak menawarkan Periksa & Simpan saat retur pending");
  assert.match(API, /receiveProductionV2MaterialReturn:[\s\S]{0,200}material-returns\/\$\{id\}\/receive/);
  assert.match(FG, /case "RETURN_PENDING"/);
});

test("QA P10A: Unit 360 menampilkan status retur; tab Retur Sisa punya empty state; galat urutan dimuat-ulang lalu ditampilkan dan digulirkan ke pandangan", () => {
  const DRAWER = read("features", "production", "UnitOverviewDrawer.jsx");
  assert.match(DRAWER, /l\.returnStatus === "PENDING"[\s\S]{0,200}Retur menunggu Gudang/);
  assert.match(DRAWER, /l\.returnStatus === "RECEIVED"[\s\S]{0,200}Retur diterima Gudang/);
  assert.match(QUEUE, /data-testid="return-empty"[\s\S]{0,200}Tidak ada retur sisa menunggu/);
  assert.match(RENCANA, /catch \(e\) \{ await load\(\); setError\(friendlyError\(e\)\); \}/, "load() mengosongkan galat, jadi galat diset SETELAH muat ulang");
  assert.match(RENCANA, /alertRef\.current\?\.scrollIntoView/);
});
