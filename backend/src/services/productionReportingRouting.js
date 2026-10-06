// Pemuat routing BULK untuk laporan (P11): jumlah query KONSTAN (3) berapa pun jumlah unit. Meniru pathForUnit() unitStageEngine
// (intake + modul layanan + finish) tanpa query per unit. BACA-SAJA.
import { buildUnitPath } from "../lib/domain/routing.js";
import { BUILD_STAGE_CODE } from "../lib/domain/productionBuildTrack.js";
import { workshopPathOf } from "./productionWorkshopExecutionCommandService.js";

export async function loadStepContextRouting(prisma, serviceIds) {
  const [stages, modules] = await Promise.all([
    prisma.routingStage.findMany({}),
    serviceIds.length ? prisma.serviceCatalogModule.findMany({ where: { serviceId: { in: serviceIds } }, orderBy: { sequence: "asc" }, include: { stage: true } }) : [],
  ]);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const intake = stages.filter((s) => s.phase === "INTAKE" && s.active);
  const finish = stages.filter((s) => s.phase === "FINISH" && s.active);
  const modulesBy = new Map();
  for (const m of modules) (modulesBy.get(m.serviceId) || modulesBy.set(m.serviceId, []).get(m.serviceId)).push(m.stage);
  const cache = new Map();
  return {
    stageById,
    // null bila jalur tidak valid (mis. tanpa gerbang QC) — applicableStepsFor menerima null (tampilan lengkap).
    // build = unit jalur pengerjaan (pesanan BARU/custom): tanpa INTAKE & tanpa layanan; hanya tahap Pengerjaan Pesanan + FINISH.
    pathFor(serviceId, { build = false } = {}) {
      const key = build ? "@build" : (serviceId || "-");
      if (!cache.has(key)) {
        try {
          const buildStage = stages.find((s) => s.code === BUILD_STAGE_CODE && s.active);
          cache.set(key, workshopPathOf(build ? buildUnitPath([], buildStage ? [buildStage] : [], finish) : buildUnitPath(intake, modulesBy.get(serviceId) || [], finish)));
        } catch { cache.set(key, null); }
      }
      return cache.get(key);
    },
  };
}
