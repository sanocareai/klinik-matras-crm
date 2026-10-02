#!/usr/bin/env node
// Ekspor snapshot Mode Demo (P12A): merekam respons bacaan (GET) tujuh halaman Production dari STAGING QA-PV2 → berkas JSON statis untuk frontend.
// Dijalankan di dalam container backend staging SETELAH `qa-pv2.js seed`:
//   docker compose -f docker-compose.staging.yml exec -T backend-staging node scripts/staging/export-demo-snapshot.js > demoSnapshot.json
// Data = sintetis QA-PV2 (pelanggan/order/foto fixture). Tidak pernah membaca production: assertQaPv2Safe() menolak selain staging/test.
import { assertQaPv2Safe, PREFIX } from "./qaPv2Safety.js";
import { wibDate } from "./qaPv2Kit.js";

try { assertQaPv2Safe(); } catch (e) { console.error(e.message); process.exit(2); }
const { prisma } = await import("../../src/db.js");
const { makeKit } = await import("./qaPv2Kit.js");
const { QC_QUEUE_TABS } = await import("../../src/services/productionQcHandoffCommandService.js");
const { DOC_QUEUE_FILTERS } = await import("../../src/lib/domain/productionDocumentation.js");
const { METRICS } = await import("../../src/lib/domain/productionMetrics.js");

const baseUrl = process.env.QA_PV2_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
const kit = makeKit({ baseUrl, jwtSecret: process.env.JWT_SECRET });
const owner = await prisma.user.findUniqueOrThrow({ where: { email: "qa-pv2-owner@staging.invalid" } });
const actor = { token: kit.tokenFor(owner, ["OWNER"]) };
const today = wibDate(0);
const urls = new Set();
const add = (u) => urls.add(u);

// --- tetap ---
add("/production-v2/command-center");
for (let d = -3; d <= 3; d += 1) add(`/production-v2/board?date=${wibDate(d)}`);
for (const u of ["/production/work-centers", "/production/operators", "/master-data/service-catalog", "/inventory/materials?active=true", "/inventory/stock", "/complaints?currentOwner=QC", "/production-v2/warehouse/queue", "/production-v2/targets", "/production-v2/reports/meta"]) add(u);
add("/production-planning/qc/queue"); for (const t of QC_QUEUE_TABS) add(`/production-planning/qc/queue?tab=${t}`);
for (const f of DOC_QUEUE_FILTERS) add(`/production-v2/documentation/queue?filter=${f}`);
// --- laporan KPI (periode bawaan UI: 30 hari terakhir) ---
const period = `from=${wibDate(-29)}&to=${today}`;
for (const g of ["day", "week", "month"]) add(`/production-v2/reports/summary?${period}&granularity=${g}`);
for (const k of ["stations", "operators", "warehouse", "units"]) add(`/production-v2/reports/${k}?${period}`);
for (const m of METRICS) add(`/production-v2/reports/drill/${m.key}?${period}`);
for (const s of ["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"]) for (const l of ["scheduled", "finished"]) add(`/production-v2/reports/stations/${s}/units/${l}?${period}`);
for (const l of ["requested", "openIssues", "overSla", "returnsPending", "returnsPartial", "returnsDone", "shortages", "fgWaiting", "waste"]) add(`/production-v2/reports/warehouse/units/${l}?${period}`);
// --- per unit ---
const units = await prisma.unit.findMany({ where: { unitCode: { startsWith: `${PREFIX}-U` } }, select: { id: true, unitCode: true }, orderBy: { unitCode: "asc" } });
const runs = await prisma.productionRun.findMany({ where: { unitId: { in: units.map((u) => u.id) } }, select: { id: true, unitId: true, plan: { select: { id: true } } } });
for (const u of units) add(`/production-v2/units/${u.id}/overview`);
for (const r of runs) {
  add(`/production-v2/documentation/runs/${r.id}`); add(`/production-v2/runs/${r.id}/card`); add(`/production-v2/runs/${r.id}/report`); add(`/production-planning/qc/runs/${r.id}`);
  if (r.plan?.id) add(`/production-planning/plans/${r.plan.id}`);
}
// daftar PIC untuk drill operator (role:id)
const ops = (await kit.get(actor, `/api/production-v2/reports/operators?${period}`)).operators || [];
for (const o of ops) for (const l of ["assigned", "finished"]) add(`/production-v2/reports/operators/${o.role}:${o.id}/units/${l}?${period}`);

const entries = []; const skipped = [];
for (const url of urls) {
  const res = await fetch(`${baseUrl}/api${url}`, { headers: { Authorization: `Bearer ${actor.token}` } });
  if (res.status !== 200) { skipped.push(`${res.status} ${url}`); continue; }
  entries.push({ url, data: await res.json() });
}
process.stdout.write(JSON.stringify({ format: 1, label: "QA-PV2 demo snapshot", capturedAt: new Date().toISOString(), today, timezone: "WIB (UTC+7)", unitCodes: units.map((u) => u.unitCode), entries }));
console.error(`[snapshot] ${entries.length} entri, ${skipped.length} dilewati`); for (const s of skipped.slice(0, 20)) console.error(`  lewat: ${s}`);
await prisma.$disconnect();
