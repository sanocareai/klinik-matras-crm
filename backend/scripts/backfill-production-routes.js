// Pre-generate ProductionRoute (Production Core Slice 4A/4D) untuk SELURUH
// layanan aktif di service_catalog, dari konfigurasi ServiceCatalogModule/
// RoutingStage yang LIVE SEKARANG — supaya versi 1 setiap rute sudah ada
// SEBELUM unit pertama diprovisioning lewat PATCH /units/:id/service
// (yang juga bisa membuatnya sendiri secara on-demand, lihat
// services/productionRouting.js#tryProvisionUnitRoute — script ini murni
// mempercepat/mempratinjau, BUKAN satu-satunya jalur pembuatan).
//
// TIDAK MENYENTUH UNIT SAMA SEKALI — unit_id/production_route_id unit yang
// SUDAH ADA tidak diubah oleh script ini (lihat aturan "Do not retroactively
// re-provision historical units" di ticket Slice 4). Ini murni membuat
// baris ProductionRoute + ProductionRouteStage untuk layanan yang BELUM
// punya versi aktif — unit lama TETAP null productionRouteId sampai
// benar-benar diprovisioning ulang lewat jalur resmi.
//
// DEFAULT DRY-RUN — pola SAMA dengan scripts/fix-lid-customers.js /
// backfill-missing-units.js.
//
//   docker compose exec backend node scripts/backfill-production-routes.js
//   docker compose exec backend node scripts/backfill-production-routes.js --apply

import { prisma } from "../src/db.js";
import { resolveOrCreateActiveRoute } from "../src/services/productionRouting.js";
import { buildUnitPath } from "../src/lib/domain/routing.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const services = await prisma.serviceCatalog.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  console.log(`${services.length} layanan aktif ditemukan.\n`);

  let sudahAda = 0, akanDibuat = 0, dilewati = 0, dibuat = 0;

  for (const service of services) {
    const existing = await prisma.productionRoute.findFirst({ where: { serviceId: service.id, active: true } });
    if (existing) {
      sudahAda++;
      console.log(`[SUDAH ADA] ${service.code} — rute v${existing.version} sudah aktif, dilewati.`);
      continue;
    }

    // Pratinjau jalur yang AKAN dipakai — logika SAMA persis dengan
    // resolveOrCreateActiveRoute (dipanggil ulang di sini HANYA untuk
    // pratinjau read-only, tidak menulis apa pun).
    const [intakeStages, finishStages, moduleMappings] = await Promise.all([
      prisma.routingStage.findMany({ where: { phase: "INTAKE", active: true } }),
      prisma.routingStage.findMany({ where: { phase: "FINISH", active: true } }),
      prisma.serviceCatalogModule.findMany({ where: { serviceId: service.id }, orderBy: { sequence: "asc" }, include: { stage: true } }),
    ]);
    const path = buildUnitPath(intakeStages, moduleMappings.map((m) => m.stage), finishStages);

    if (path.length === 0) {
      dilewati++;
      console.log(`[DILEWATI] ${service.code} — tidak ada tahap MODULE terpetakan, tidak ada yang bisa dijadikan rute.`);
      continue;
    }

    akanDibuat++;
    console.log(`[AKAN DIBUAT] ${service.code} (${service.labelId}) — ${path.length} tahap: ${path.map((s) => s.labelId).join(" → ")}`);

    if (APPLY) {
      const route = await prisma.$transaction((tx) => resolveOrCreateActiveRoute(tx, service.id));
      dibuat++;
      console.log(`           -> dibuat: ProductionRoute ${route.id} v${route.version}`);
    }
  }

  console.log(`\nRingkasan: ${sudahAda} sudah ada, ${akanDibuat} ${APPLY ? "dibuat" : "akan dibuat"}, ${dilewati} dilewati (tanpa tahap MODULE).`);
  if (!APPLY && akanDibuat > 0) {
    console.log("Ini DRY-RUN — jalankan ulang dengan --apply untuk benar-benar menulis.");
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
