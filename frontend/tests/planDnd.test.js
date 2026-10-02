// Seret-lepas Rencana Produksi (P12A.1): model keputusan murni + kontrak sumber (handle, sentuh, tanpa optimistic, fallback tombol,
// Status Produksi tidak bisa diseret, Akan Masuk read-only). Pola proyek: fungsi murni dieksekusi dari sumbernya; komponen lewat text-scan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { orderedStationItems } from "../src/features/production/stationOrder.js";
import { stationCapacity, friendlyError } from "../src/features/production/experience.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");
const read = (...p) => raw(...p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const DND_SRC = read("features", "production", "planDnd.js");
const HOOK = read("features", "production", "usePlanDrag.js");
const CARD = read("features", "production", "UnitCard.jsx");
const RENCANA = read("pages", "bengkel", "ProductionRencanaWorkspace.jsx");
const STATUS = read("pages", "bengkel", "ProductionPlannerV2.jsx");

function loadDnd() {
  const src = DND_SRC.replace(/^import .*$/gm, "").replace(/^export /gm, "");
  return new Function("stationCapacity", "orderedStationItems", `${src}\nreturn { DRAG_THRESHOLD_PX, dragMoved, insertIndexAt, listWithInserted, decideDrop, describeTarget };`)(stationCapacity, orderedStationItems);
}
const D = loadDnd();

const unit = (n, { station = null, date = "2026-10-05", seq = null, prio = 0 } = {}) => ({
  runId: `run-${n}`, unit: { unitCode: `U${n}` },
  plan: { id: `plan-${n}`, stationCode: station, productionDate: station ? date : null, stationSequence: seq, priority: prio, revision: 1, workCenter: { id: "wc" }, operator: { id: "op" } },
});
const meja = (code, items, capacity = 3) => ({ code, label: code.replace("TABLE_", "Meja "), capacity, items });
const DATE = "2026-10-05";

test("ambang gerak: ketukan biasa (gerak < 8px) BUKAN seret; gerak ≥ 8px = seret", () => {
  assert.equal(D.DRAG_THRESHOLD_PX, 8);
  assert.equal(D.dragMoved({ x: 10, y: 10 }, { x: 13, y: 12 }), false, "ketukan");
  assert.equal(D.dragMoved({ x: 10, y: 10 }, { x: 10, y: 10 }), false);
  assert.equal(D.dragMoved({ x: 10, y: 10 }, { x: 10, y: 18 }), true);
  assert.equal(D.dragMoved({ x: 0, y: 0 }, { x: 6, y: 6 }), true, "diagonal 8.48px");
});

test("indeks sisip dari posisi pointer + penyisipan daftar", () => {
  assert.equal(D.insertIndexAt(5, [100, 200, 300]), 0);
  assert.equal(D.insertIndexAt(150, [100, 200, 300]), 1);
  assert.equal(D.insertIndexAt(999, [100, 200, 300]), 3);
  assert.equal(D.insertIndexAt(10, []), 0);
  assert.deepEqual(D.listWithInserted(["a", "b", "c"], "x", 1), ["a", "x", "b", "c"]);
  assert.deepEqual(D.listWithInserted(["a", "b", "c"], "a", 3), ["b", "c", "a"], "id yang sudah ada dipindah, bukan digandakan");
  assert.deepEqual(D.listWithInserted(["a"], "x", 99), ["a", "x"], "indeks dijepit");
});

test("backlog → meja: jadwalkan; sisip di tengah = perlu urutkan; di bawah = tidak perlu", () => {
  const a = unit(1, { station: "TABLE_1", seq: 1 }), b = unit(2, { station: "TABLE_1", seq: 2 });
  const stations = [meja("TABLE_1", [a, b])];
  const back = unit(9);
  const mid = D.decideDrop({ view: back, target: { kind: "meja", code: "TABLE_1", index: 1 }, stations, date: DATE });
  assert.equal(mid.type, "place"); assert.deepEqual(mid.orderedIds, ["plan-1", "plan-9", "plan-2"]); assert.equal(mid.needsReorder, true);
  const end = D.decideDrop({ view: back, target: { kind: "meja", code: "TABLE_1", index: 2 }, stations, date: DATE });
  assert.equal(end.type, "place"); assert.equal(end.needsReorder, false, "semua isi meja bernomor manual + masuk paling bawah = posisi terjamin");
  const unsequenced = D.decideDrop({ view: back, target: { kind: "meja", code: "TABLE_2", index: 1 }, stations: [meja("TABLE_2", [unit(5, { station: "TABLE_2" })])], date: DATE });
  assert.equal(unsequenced.needsReorder, true, "meja belum bernomor manual: posisi ditunjuk disimpan eksplisit (kalau tidak, prioritas bisa menaikkan kartu)");
  assert.equal(D.describeTarget(mid, stations, "plan-9"), "Jadwalkan ke Meja 1 · urutan 2");
});

test("kapasitas maksimal 3/meja: meja penuh ditolak dengan pesan Indonesia (server tetap otoritas akhir)", () => {
  const full = meja("TABLE_2", [1, 2, 3].map((n) => unit(n, { station: "TABLE_2", seq: n })));
  const d = D.decideDrop({ view: unit(9), target: { kind: "meja", code: "TABLE_2", index: 0 }, stations: [full], date: DATE });
  assert.equal(d.type, "reject"); assert.match(d.message, /Meja 2 sudah penuh \(3\/3 unit\)\. Pilih meja lain\./);
  // meja penuh tetapi kartunya sendiri di situ = urutkan, bukan ditolak
  const own = D.decideDrop({ view: full.items[0], target: { kind: "meja", code: "TABLE_2", index: 3 }, stations: [full], date: DATE });
  assert.equal(own.type, "reorder"); assert.deepEqual(own.orderedIds, ["plan-2", "plan-3", "plan-1"]);
  assert.equal(D.decideDrop({ view: unit(9), target: { kind: "meja", code: "TABLE_9", index: 0 }, stations: [full], date: DATE }).type, "reject", "meja tak dikenal");
});

test("meja → meja, urutan dalam meja, meja → backlog", () => {
  const a = unit(1, { station: "TABLE_1", seq: 1 }), b = unit(2, { station: "TABLE_1", seq: 2 }), c = unit(3, { station: "TABLE_2", seq: 1 });
  const stations = [meja("TABLE_1", [a, b]), meja("TABLE_2", [c])];
  const move = D.decideDrop({ view: a, target: { kind: "meja", code: "TABLE_2", index: 0 }, stations, date: DATE });
  assert.equal(move.type, "place"); assert.deepEqual(move.orderedIds, ["plan-1", "plan-3"]); assert.equal(move.needsReorder, true);
  const re = D.decideDrop({ view: a, target: { kind: "meja", code: "TABLE_1", index: 1 }, stations, date: DATE });
  assert.equal(re.type, "reorder"); assert.deepEqual(re.orderedIds, ["plan-2", "plan-1"]);
  assert.equal(D.decideDrop({ view: a, target: { kind: "meja", code: "TABLE_1", index: 0 }, stations, date: DATE }).type, "noop", "posisi sama = tidak ada perubahan");
  assert.equal(D.decideDrop({ view: a, target: { kind: "backlog" }, stations, date: DATE }).type, "unschedule");
  assert.equal(D.decideDrop({ view: unit(9), target: { kind: "backlog" }, stations, date: DATE }).type, "noop", "sudah di backlog");
  assert.equal(D.decideDrop({ view: a, target: null, stations, date: DATE }).type, "noop", "lepas di luar sasaran = batal");
});

test("pindah tanggal: hanya kartu yang sudah punya meja; tanggal sama = noop; backlog ditolak dengan petunjuk", () => {
  const a = unit(1, { station: "TABLE_1", seq: 1 });
  assert.deepEqual(D.decideDrop({ view: a, target: { kind: "day", date: "2026-10-06" }, stations: [], date: DATE }), { type: "moveDate", date: "2026-10-06" });
  assert.equal(D.decideDrop({ view: a, target: { kind: "day", date: DATE }, stations: [], date: DATE }).type, "noop");
  const r = D.decideDrop({ view: unit(9), target: { kind: "day", date: "2026-10-06" }, stations: [], date: DATE });
  assert.equal(r.type, "reject"); assert.match(r.message, /belum punya meja/);
});

test("handle & sentuh: hanya handle yang menangkap sentuhan (touch-action:none); kartu lain tetap bisa digulir; ketukan membuka detail", () => {
  assert.equal((CARD.match(/touchAction: "none"/g) || []).length, 1, "touch-action:none HANYA di handle");
  assert.match(CARD, /data-testid="drag-handle"/);
  assert.match(CARD, /h-11 w-11/, "target sentuh 44px");
  assert.match(CARD, /aria-label=\{`Seret \$\{unitCode\} untuk memindahkan`\}/);
  assert.match(CARD, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/, "klik handle tidak membuka kartu");
  assert.match(CARD, /onContextMenu=\{\(e\) => e\.preventDefault\(\)\}/, "tekan-lama tidak memunculkan menu konteks");
  assert.match(CARD, /<button type="button" onClick=\{open\}/, "ketukan kartu = buka Unit 360");
  assert.match(CARD, /data-mutates/, "handle ikut dinonaktifkan di Mode Demo");
  assert.ok(!/draggable=\{draggable && /.test(RENCANA) && !/\bdraggable\b/.test(RENCANA), "Rencana tidak memakai HTML5 draggable (tak jalan di sentuh)");
  assert.ok(!/onDragStart|dataTransfer/.test(RENCANA));
});

test("hook seret: pointer events, ambang gerak, batal (Escape/pointercancel), gulir otomatis, lepas di luar sasaran tidak menyimpan", () => {
  assert.match(HOOK, /"pointermove"/); assert.match(HOOK, /"pointerup"/); assert.match(HOOK, /"pointercancel"/);
  assert.match(HOOK, /dragMoved\(s\.start, p\)/);
  assert.match(HOOK, /e\.key === "Escape"/);
  assert.match(HOOK, /window\.scrollBy/);
  assert.match(HOOK, /export function outerScrollParent/, "gulir otomatis menggulir kontainer halaman (.page-body), bukan hanya window");
  assert.match(HOOK, /s\.scroller\.scrollBy\(0, dy\)/);
  assert.match(HOOK, /if \(moved && resolved\) live\.current\.onDrop/, "tanpa gerak / tanpa sasaran = tidak ada onDrop");
  assert.match(HOOK, /e\.pointerType === "mouse" && e\.button !== 0/);
});

test("TIDAK optimistic: command lalu muat ulang dari server; gagal = muat ulang + pesan; 'Menyimpan…' tampil; ghost + indikator sisip", () => {
  assert.match(RENCANA, /async function commit\(label, fn\) \{[\s\S]*?const out = await fn\(\);\s*await load\(\);/);
  assert.match(RENCANA, /catch \(e\) \{ await load\(\); setError\(friendlyError\(e\)\); \}/);
  assert.match(RENCANA, /data-testid="saving-banner"/);
  assert.ok(!/setBoard\(\(/.test(RENCANA) && !/setBoard\(.*=>/.test(RENCANA.replace(/\.then\(\(\[b, c\]\) => \{ setBoard\(b\)/, "")), "papan hanya diisi dari respons server");
  assert.match(RENCANA, /data-testid="drag-ghost"/);
  assert.match(RENCANA, /data-testid="drop-indicator"/);
  assert.match(RENCANA, /Lepas di sini → /, "slot meja menyorot tujuan");
  assert.match(RENCANA, /data-testid="backlog-drop-hint"/);
});

test("pesan galat Indonesia: meja penuh, revisi berubah, isi meja berubah", () => {
  assert.match(friendlyError({ code: "PLAN_STATION_FULL", status: 409, detail: { capacity: 3 } }), /Meja sudah penuh \(maks\. 3 unit per meja\)\. Kartu dikembalikan/);
  assert.match(friendlyError({ code: "PLAN_REVISION_CONFLICT", status: 409 }), /sudah diubah orang lain\. Kartu dikembalikan/);
  assert.match(friendlyError({ code: "STATION_ORDER_STALE", status: 409 }), /Isi meja berubah saat Anda menyeret/);
});

test("fallback tombol tetap ada & memakai command yang sama: Jadwalkan, Pindahkan, ▲▼", () => {
  assert.match(RENCANA, /Jadwalkan<\/Button>/); assert.match(RENCANA, /Pindahkan<\/Button>/);
  assert.match(RENCANA, /data-testid="order-up"/); assert.match(RENCANA, /data-testid="order-down"/);
  assert.match(RENCANA, /onMove=\{\(v, code\) => setSchedule\(/);
  assert.match(RENCANA, /onClick=\{\(\) => \{ const next = moveStep\(planIds, v\.plan\?\.id, -1\); if \(next\) onReorder\(station, next\); \}\}/);
  // seret & tombol bermuara di fungsi yang sama
  for (const fn of ["placeOn", "unschedule", "reorderStation"]) assert.match(RENCANA, new RegExp(`async function ${fn}\\(`));
  assert.match(RENCANA, /api\.scheduleProductionV2Plan\(plan\.id/);
});

test("Akan Masuk — Pickup Terjadwal: forecast read-only di Rencana (tanpa handle/tombol jadwal) dan di Status", () => {
  const sec = RENCANA.slice(RENCANA.indexOf('data-testid="upcoming-forecast"'), RENCANA.indexOf("</section>", RENCANA.indexOf('data-testid="upcoming-forecast"')));
  assert.match(sec, /Akan Masuk — Pickup Terjadwal/);
  assert.match(sec, /<UpcomingCard /);
  assert.ok(!/DragHandle|onHandleDown|setSchedule|Jadwalkan<\/Button>/.test(sec), "tidak bisa diseret atau dijadwalkan");
  assert.match(sec, /tidak dihitung sebagai WIP, target, atau selesai/);
  assert.match(STATUS, /data-testid="forecast-note"/);
});

test("Status Produksi: kartu TIDAK bisa diseret; tahap hanya berubah lewat proses+bukti (petunjuk tooltip)", () => {
  assert.ok(!/draggable|onDragStart|DragHandle|usePlanDrag|onHandleDown|dataTransfer/.test(STATUS));
  assert.match(STATUS, /Tahap berubah setelah proses dan bukti disimpan/);
});
