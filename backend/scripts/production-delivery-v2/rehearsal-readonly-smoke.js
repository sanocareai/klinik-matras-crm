#!/usr/bin/env node
// Smoke BACA-SAJA kode kandidat terhadap SALINAN DB production yang sudah dimigrasi (rehearsal restore). Tanpa server HTTP, tanpa job latar, tanpa penulisan:
// hanya memanggil read-model kandidat pada data nyata (cohort unit, run, papan, command center, Unit 360, laporan, catatan komponen) dan memastikan tidak ada exception/bentuk rusak.
//   DATABASE_URL=<salinan> node scripts/production-delivery-v2/rehearsal-readonly-smoke.js
import { prisma } from "../../src/db.js";
import { loadV2Flags, resolveProductionReaderState } from "../../src/services/v2FeatureFlags.js";
import { getAndonBoard, getProductionBoard, getProductionCommandCenter, getProductionReport, getRunCard, listWorkerQueue } from "../../src/services/productionExperienceReadService.js";
import { getUnitOverview } from "../../src/services/productionUnitOverviewService.js";
import { getComponentNotes } from "../../src/services/productionComponentNoteService.js";

const out = []; let bad = 0;
const check = async (name, fn) => { try { const r = await fn(); out.push(`OK   ${name}${r ? ` — ${r}` : ""}`); } catch (e) { bad += 1; out.push(`FAIL ${name} — ${e.code || ""} ${String(e.message).slice(0, 200)}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const flags = await loadV2Flags(prisma);
const reader = resolveProductionReaderState(flags);
const unitIds = [...reader.unitIds];
out.push(`reader mode=${reader.mode} cohort=${unitIds.length} unit`);
const today = new Date().toISOString().slice(0, 10);
await check("papan produksi (getProductionBoard)", async () => { const r = await getProductionBoard(prisma, { date: today, unitIds }); assert(r && typeof r === "object", "bentuk"); return `stations=${(r.stations || []).length}`; });
await check("command center", async () => { const r = await getProductionCommandCenter(prisma, { unitIds }); assert(r && r.kpi, "kpi"); return `columns=${(r.columns || []).length}`; });
await check("andon", async () => { const r = await getAndonBoard(prisma, { date: today, unitIds }); assert(r, "andon"); });
for (const lane of ["TABLE", "CORNER"]) await check(`antrean pekerja ${lane}`, async () => { const r = await listWorkerQueue(prisma, { unitIds, userId: "rehearsal-none", lane, all: true }); assert(r && Array.isArray(r.items ?? r), "items"); return `items=${(r.items ?? r).length}`; });
// Cohort production bisa nyaris kosong; agar read-model diuji pada data NYATA, sampel run dari seluruh DB (tiap status; hingga 12 per status) dibaca dengan cohort = unit sampel (baca-saja).
const sampleRuns = await prisma.$queryRawUnsafe("select id::text, unit_id::text as \"unitId\", status::text, adaptation_policy as \"adaptationPolicy\" from (select r.*, row_number() over (partition by r.status order by r.created_at desc) rn from production_runs_v2 r) x where rn <= 12 order by status");
const runs = [...new Map([...(unitIds.length ? await prisma.productionRun.findMany({ where: { unitId: { in: unitIds } }, select: { id: true, unitId: true, status: true, adaptationPolicy: true } }) : []), ...sampleRuns].map((r) => [r.id, r])).values()];
const scope = [...new Set([...unitIds, ...runs.map((r) => r.unitId)])];
out.push(`run diuji: ${runs.length} (sampel nyata per status: ${[...new Set(runs.map((r) => r.status))].join("/")}; adaptasi: ${runs.filter((r) => r.adaptationPolicy).length})`);
for (const run of runs) {
  await check(`kartu run ${run.id.slice(0, 8)}`, async () => { const c = await getRunCard(prisma, run.id, { unitIds: scope }); assert(c && c.runId === run.id, "kartu"); assert(c.progress && "skipped" in c.progress, "progres tanpa skipped/remaining (kontrak slice 2)"); return `bucket=${c.bucket} adaptation=${!!c.adaptation}`; });
  await check(`laporan run ${run.id.slice(0, 8)}`, async () => { const r = await getProductionReport(prisma, run.id, { unitIds: scope }); assert(r && r.components && r.components.comparison, "blok komponen"); assert(!/undefined/.test(r.message), "pesan berisi undefined"); return `ready=${r.ready} komponenTercatat=${r.components.comparison.recordedAny}`; });
}
for (const unitId of scope.slice(0, 40)) {
  await check(`Unit 360 ${unitId.slice(0, 8)}`, async () => { const o = await getUnitOverview(prisma, unitId, { unitIds: scope }); assert(o === null || o.identity, "identity"); return o ? `unit=${o.identity.unitCode} qcStatus=${o.production?.qcStatus}` : "unit tidak punya run"; });
  await check(`catatan komponen ${unitId.slice(0, 8)}`, async () => { const n = await getComponentNotes(prisma, unitId); assert(n && n.comparison && n.comparison.gaps.length === 3, "unit lama harus 'belum dicatat' (3 celah, tidak ada data karangan)"); return "kosong: 3 celah"; });
}
await check("objek slice 2/3 pada salinan: kosong/NULL (tanpa backfill)", async () => {
  const q = async (s) => Number((await prisma.$queryRawUnsafe(s))[0].c);
  const a = await q("select count(*)::int c from production_runs_v2 where adaptation_policy is not null"); const b = await q("select count(*)::int c from production_operation_runs_v2 where delay_kind is not null or delay_note is not null");
  const c = await q("select count(*)::int c from production_settings"); const d = await q("select count(*)::int c from unit_component_entries_v2");
  assert(a === 0 && b === 0 && c === 0 && d === 0, `adaptasi=${a} tunda=${b} setelan=${c} komponen=${d}`); return "adaptasi=0 tunda=0 setelan=0 komponen=0";
});
console.log(out.join("\n")); console.log(`\nSMOKE BACA-SAJA: ${bad ? `${bad} GAGAL` : "semua lulus"}`);
await prisma.$disconnect(); process.exit(bad ? 1 : 0);
