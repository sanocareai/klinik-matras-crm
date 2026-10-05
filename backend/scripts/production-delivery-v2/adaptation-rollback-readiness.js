#!/usr/bin/env node
// Kesiapan rollback + pemulihan run ADAPTASI (simplifikasi slice 2). Kode lama (sebelum slice 2) tidak mengenal kebijakan adaptasi: tahap SKIPPED terbaca "dikerjakan"
// dan run adaptasi yang sudah "siap diselesaikan" TERKUNCI (409 CUSTODY_QC_NOT_SATISFIED; tidak ada Selesaikan Produksi, dan fase QC bukan lagi gerbang aktif sehingga QC-waive tidak berlaku).
// Skrip ini TIDAK menghapus/menimpa catatan bisnis apa pun. Dua mode:
//   node scripts/production-delivery-v2/adaptation-rollback-readiness.js
//        (default, BACA-SAJA) daftar run adaptasi non-terminal + klasifikasi + jumlah bukti SKIPPED. Exit 1 bila ada run adaptasi non-terminal (rollback BELUM dianjurkan).
//   node scripts/production-delivery-v2/adaptation-rollback-readiness.js --finish --actor=<userId ADMIN/OWNER> --run=<runId[,runId]> [--yes]
//        menutup run yang DIPILIH lewat command resmi finishProduction (kode KANDIDAT/terbaru, idempoten; tahap sisa dicatat SKIPPED, QC "tidak dilakukan", retur sisa bahan tetap wajib,
//        satu handoff Delivery). Tanpa --yes hanya mencetak pratinjau. Jalankan dari release KANDIDAT (skema tetap karena migration dipertahankan saat rollback aplikasi).
// Pemakaian aman di production: lewat container kandidat satu-kali, mis.
//   docker run --rm --env-file backend/.env <image-kandidat> node scripts/production-delivery-v2/adaptation-rollback-readiness.js
import { prisma } from "../../src/db.js";
import { finishProduction, previewFinishProduction } from "../../src/services/productionStepCommandService.js";

const arg = (name) => { const a = process.argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`)); return a === undefined ? null : a.includes("=") ? a.split("=").slice(1).join("=") : true; };
const FINISH = arg("finish") === true; const YES = arg("yes") === true;

function classify(run, skipped) {
  const ops = run.operations;
  const active = ops.find((o) => ["ACTIVE", "PAUSED"].includes(o.status));
  const qcGateSkipped = ops.some((o) => o.status === "SKIPPED" && o.planSnapshot?.qcNotPerformed);
  if (run.status === "PENDING_ARRIVAL") return { key: "PENDING_ARRIVAL", note: "belum tiba — aman" };
  if (active) return { key: "STAGE_RUNNING", note: `tahap ${active.stageCode} ${active.status} — selesaikan/lanjutkan dulu` };
  if (qcGateSkipped) return { key: "LOCKED_UNDER_OLD_CODE", note: "gerbang QC dicatat tidak dilakukan — di kode lama TIDAK bisa ditutup (409 CUSTODY_QC_NOT_SATISFIED)" };
  if (skipped > 0) return { key: "HAS_SKIPPED_STAGES", note: "ada tahap dilewati — kode lama menganggapnya dikerjakan; tahap berikutnya tetap bisa dikerjakan" };
  return { key: "ADAPTATION_NO_SKIP", note: "kebijakan adaptasi aktif tanpa tahap dilewati — kode lama berproses normal" };
}

const runs = await prisma.productionRun.findMany({
  where: { adaptationPolicy: { not: null }, status: { notIn: ["COMPLETED", "CANCELLED"] } },
  include: { unit: { select: { unitCode: true, status: true } }, operations: { select: { stageCode: true, status: true, planSnapshot: true } }, plan: { select: { workCenterId: true } } },
  orderBy: { createdAt: "asc" },
});
const skippedRows = await prisma.$queryRawUnsafe(`select run_id::text as run_id, count(*)::int as n from production_step_evidence_v2 where payload->>'outcome' = 'SKIPPED' group by run_id`);
const skippedBy = new Map(skippedRows.map((r) => [r.run_id, r.n]));
const completed = await prisma.productionRun.count({ where: { adaptationPolicy: { not: null }, status: "COMPLETED" } });
const totalSkippedRows = skippedRows.reduce((s, r) => s + r.n, 0);

console.log(`KESIAPAN ROLLBACK — run adaptasi non-terminal: ${runs.length}; run adaptasi sudah selesai: ${completed}; baris bukti SKIPPED (seluruh DB): ${totalSkippedRows}`);
const table = runs.map((r) => ({ run: r.id, unit: r.unit.unitCode, status: r.status, phase: r.currentPhase, revision: r.revision, skipped: skippedBy.get(r.id) ?? 0, ...classify(r, skippedBy.get(r.id) ?? 0) }));
for (const t of table) console.log(`  ${t.unit.padEnd(14)} run=${t.run} ${t.status}/${t.phase} rev=${t.revision} dilewati=${t.skipped} → ${t.key}: ${t.note}`);

if (!FINISH) {
  const blocking = table.filter((t) => ["LOCKED_UNDER_OLD_CODE", "STAGE_RUNNING"].includes(t.key)).length;
  console.log(blocking || table.length ? `\nHASIL: ${table.length} run adaptasi non-terminal (${blocking} menghalangi rollback). Selesaikan lewat "Selesaikan Produksi" (UI) atau --finish, atau tunda rollback.` : "\nHASIL: tidak ada run adaptasi non-terminal — rollback aplikasi tidak mengunci apa pun. (Bukti SKIPPED/QC 'tidak dilakukan' pada run selesai tetap utuh; hanya tampilannya keliru di kode lama.)");
  await prisma.$disconnect();
  process.exit(table.length ? 1 : 0);
}

const actorId = arg("actor"); const wanted = String(arg("run") || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!actorId || actorId === true || !wanted.length) { console.error("GAGAL: --finish butuh --actor=<userId> dan --run=<runId[,runId]>"); process.exit(2); }
const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, role: true, active: true } });
if (!actor?.active || !["ADMIN", "OWNER"].includes(actor.role)) { console.error("GAGAL: aktor harus pengguna aktif ADMIN/OWNER (override PIC resmi)"); process.exit(2); }
let failures = 0;
for (const runId of wanted) {
  const run = runs.find((r) => r.id === runId);
  if (!run) { console.error(`GAGAL: ${runId} bukan run adaptasi non-terminal`); failures += 1; continue; }
  const prev = await previewFinishProduction(prisma, runId);
  console.log(`\n${run.unit.unitCode}: canFinish=${prev.canFinish} blockers=${JSON.stringify(prev.blockers.map((b) => b.code))} dilewati-nanti=${prev.willSkipSteps.length} retur-wajib=${prev.expectedReturns.length}`);
  if (!prev.canFinish) { console.error("  TIDAK dapat ditutup sekarang — selesaikan penghalangnya dulu"); failures += 1; continue; }
  if (!YES) { console.log("  (pratinjau saja — tambahkan --yes untuk menutup)"); continue; }
  try {
    const res = await finishProduction(prisma, { runId, actorId: actor.id, idempotencyKey: `rollback-recovery-${runId}-${prev.revision}`, expectedRevision: prev.revision, workCenterId: run.plan?.workCenterId ?? null });
    console.log(`  → completed=${res.completed} unit=${res.unitStatus ?? "-"} ${res.waitingFor ? `menunggu ${res.waitingFor}` : ""} ${res.replayed ? "(replay)" : ""}`);
  } catch (e) { console.error(`  GAGAL: ${e.code || ""} ${e.message}`); failures += 1; }
}
await prisma.$disconnect();
process.exit(failures ? 1 : 0);
