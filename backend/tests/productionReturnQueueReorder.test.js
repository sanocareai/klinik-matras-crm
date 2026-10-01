// Antrean retur sisa bahan + urutan manual unit per meja: aturan murni, kontrak migration (additive), dan pagar kode.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeLeftovers } from "../src/services/productionMaterialReturnService.js";
import { compareStationOrder } from "../src/lib/domain/productionBoard.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "..", rel), "utf8");

test("computeLeftovers: sisa = diserahkan − terpakai − waste − retur; hanya > 0; urut stabil", () => {
  const out = computeLeftovers({
    issued: new Map([["b", 2], ["a", 10], ["c", 3], ["d", 1]]),
    used: new Map([["a", 4], ["c", 3]]),
    wasted: new Map([["a", 1]]),
    returned: new Map([["a", 2], ["d", 1]]),
  });
  assert.deepEqual(out, [{ materialId: "a", qty: 3 }, { materialId: "b", qty: 2 }]);
});

test("computeLeftovers: terpakai melebihi diserahkan (mis. versi rework) tidak menghasilkan retur negatif; desimal dibulatkan 4 digit", () => {
  assert.deepEqual(computeLeftovers({ issued: new Map([["x", 2]]), used: new Map([["x", 4]]), wasted: new Map(), returned: new Map() }), []);
  assert.deepEqual(computeLeftovers({ issued: new Map([["y", 1]]), used: new Map([["y", 0.3333]]), wasted: new Map(), returned: new Map() }), [{ materialId: "y", qty: 0.6667 }]);
});

test("compareStationOrder: urutan manual menang atas prioritas; tanpa nomor = prioritas desc lalu target mulai", () => {
  const sort = (items) => [...items].sort(compareStationOrder).map((x) => x.id);
  // semua bernomor: nomor menang walau prioritas berlawanan
  assert.deepEqual(sort([{ id: "a", stationSequence: 2, priority: 2 }, { id: "b", stationSequence: 1, priority: 0 }, { id: "c", stationSequence: 3, priority: 1 }]), ["b", "a", "c"]);
  // belum ada nomor: prioritas, lalu target mulai paling awal
  assert.deepEqual(sort([
    { id: "a", priority: 0 }, { id: "b", priority: 2, targetStartAt: "2026-10-02T09:00:00Z" }, { id: "c", priority: 2, targetStartAt: "2026-10-02T08:00:00Z" }, { id: "d", priority: 1 },
  ]), ["c", "b", "d", "a"]);
  // campuran: yang bernomor selalu di atas yang belum, apa pun prioritasnya
  assert.deepEqual(sort([{ id: "new", priority: 2 }, { id: "m1", stationSequence: 1, priority: 0 }]), ["m1", "new"]);
});

test("migration 20261012100000: additive murni (tanpa DROP/DELETE/UPDATE/TRUNCATE), kolom & tabel sesuai kontrak", () => {
  const dir = readdirSync(path.join(here, "..", "prisma", "migrations")).find((d) => d.endsWith("production_return_queue_and_station_order"));
  assert.ok(dir, "folder migration ada");
  const sql = read(`prisma/migrations/${dir}/migration.sql`);
  const code = sql.replace(/--.*$/gm, "").replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE)/g, ""); // komentar & aksi FK bukan perintah data
  assert.doesNotMatch(code, /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/i);
  assert.match(sql, /ALTER TABLE "production_run_plans_v2" ADD COLUMN\s+"station_sequence" INTEGER/);
  assert.match(sql, /CREATE TABLE "production_material_returns_v2"/);
  assert.match(sql, /UNIQUE INDEX[^;]*\("run_id", "material_id"\)/);
  assert.match(sql, /ON DELETE RESTRICT/);
});

test("pagar kode: barang jadi hanya diterima setelah retur; retur dibuat di tahap 12; reorder & receive memakai command owner (v2_commands + outbox)", () => {
  const custody = read("src/services/unitCustodyCommandService.js");
  const accept = custody.slice(custody.indexOf("export async function acceptUnitCustody"), custody.indexOf("export async function rejectUnitCustody"));
  assert.match(accept, /assertNoPendingReturnsInTx\(tx, finishedRun\.id\)/);
  assert.doesNotMatch(custody.slice(custody.indexOf("export async function rejectUnitCustody")), /assertNoPendingReturnsInTx/, "penolakan barang jadi tidak diblokir retur");

  const steps = read("src/services/productionStepCommandService.js");
  assert.match(steps, /requestedStep === 12 && transition\?\.handoffReady[\s\S]{0,400}createLeftoverReturnsInTx\(tx,/);

  const ret = read("src/services/productionMaterialReturnService.js");
  for (const needle of ["v2Command.create", "domainOutbox.create", "lockRowForUpdate", "type: \"RETURN\"", "RETURN_NOTE_REQUIRED", "expectedRevision"]) assert.ok(ret.includes(needle), needle);
  const plan = read("src/services/productionPlanningCommandService.js");
  const reorder = plan.slice(plan.indexOf("export async function reorderStationPlans"), plan.indexOf("// 3. Susun/ubah Planned BOM"));
  for (const needle of ["pg_advisory_xact_lock", "STATION_ORDER_STALE", "assertWriterEnabledForUnit", "REORDER_STATION", "production.station.reordered"]) assert.ok(reorder.includes(needle), needle);
  assert.doesNotMatch(reorder, /priority\s*:/, "reorder tidak menyentuh prioritas");
});
