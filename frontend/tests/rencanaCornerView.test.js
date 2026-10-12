// Corner di Rencana Produksi — kontrak tampilan (text-scan, tanpa jsdom): satu read-model server, tanpa drag/kapasitas/target/urutan Corner, tanpa tombol eksekusi tahap.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("papan Corner: data dari server (corner-board), empat kelompok dari server, tidak menurunkan hambatan/aktor di klien", () => {
  const v = strip(read("features", "production", "RencanaCornerView.jsx"));
  assert.match(v, /api\.getProductionV2CornerBoard\(\)/);
  assert.match(v, /\(data\?\.groups \|\| \[\]\)\.map/);
  assert.doesNotMatch(v, /next\.actor|\.next\b|cornerStatusOf|deriveNextAction/, "klien tidak menebak dari next.actor");
  for (const id of ["corner-view", "corner-card", "corner-pic", "corner-qc", "corner-request", "corner-blockers", "corner-needs-action"]) assert.ok(v.includes(`data-testid="${id}"`) || v.includes("data-testid={`" + id), id);
  assert.match(v, /aria-label=\{`Buka Unit 360 \$\{item\.unit\.unitCode\}`\}/, "klik kartu membuka Unit 360 (drawer yang sama)");
});

test("tanpa drag, kapasitas, target, atau urutan Corner dan tanpa tombol eksekusi tahap", () => {
  const v = strip(read("features", "production", "RencanaCornerView.jsx"));
  assert.doesNotMatch(v, /DragHandle|onPointerDown|data-drag|usePlanDrag|capacity|kapasitas|stationSequence|reorder|api\.(recordProductionV2Step|startProductionV2|completeProductionV2)/i);
  assert.doesNotMatch(v, /Mulai Corner|Selesaikan|Kirim ke Corner/);
  assert.match(v, /Aplikasi Corner/);
});

test("penetapan PIC: command khusus (hanya operatorId + expectedRevision rencana), konflik memuat ulang data terbaru, izin pengalihan dari server", () => {
  const v = strip(read("features", "production", "RencanaCornerView.jsx"));
  assert.match(v, /api\.setProductionV2CornerOperator\(item\.runId, \{ operatorId: value, expectedRevision: item\.plan\.revision \}\)/);
  assert.match(v, /e\?\.code === "PLAN_REVISION_CONFLICT" \? "Rencana unit ini sudah diubah orang lain/);
  assert.match(v, /const reloadThenShow = useCallback\(async \(msg\) => \{ await load\(\); setError\(msg\); \}/);
  assert.match(v, /const handleError = \(msg\) => \{ reloadThenShow\(msg\); \}/);
  assert.match(v, /item\.assign/); assert.match(v, /a\.allowed/);
  const api = read("api.js");
  assert.match(api, /setProductionV2CornerOperator: \(runId, data, idempotencyKey = mutationKey\("corner-pic"\)\)/);
  assert.match(api, /\/production-v2\/runs\/\$\{runId\}\/corner-operator/);
  assert.doesNotMatch(strip(read("features", "production", "RencanaCornerView.jsx")), /api\.(schedule|planAndSchedule|createProductionV2Plan|scheduleProductionPlan)/, "tidak memakai command jadwal");
});

test("Rencana: dua tampilan Meja/Corner (URL ?tampilan=corner), Meja tetap utuh; kartu Meja 'Corner tidak diperlukan' membawa alasan + pemutus", () => {
  const ws = read("pages", "bengkel", "ProductionRencanaWorkspace.jsx");
  assert.match(ws, /searchParams\.get\("tampilan"\) === "corner"/);
  assert.match(ws, /data-testid=\{`tampilan-\$\{k\}`\}/); assert.match(ws, /<RencanaCornerView /);
  for (const keep of ["backlog-panel", "meja-grid", "planner-kpi", "WeekStrip", "StationPicPicker", "usePlanDrag"]) assert.ok(ws.includes(keep), `Meja tetap: ${keep}`);
  const pc = read("features", "production", "PlanCard.jsx");
  assert.match(pc, /data-testid|testid="row-corner-na"/); assert.match(pc, /view\.cornerDecision\.decidedBy/);
});
