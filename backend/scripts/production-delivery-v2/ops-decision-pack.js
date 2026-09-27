#!/usr/bin/env node
// Decision pack Ops (READ-ONLY): fakta + opsi keputusan untuk exception migrasi V2 yang masih terbuka
// (ROUTE_JOB_ASSIGNMENT_MISMATCH per route, CURRENT_STAGE_WITHOUT_SERVICE per unit). Skrip ini tidak
// menulis apa pun dan tidak merekomendasikan pilihan: kepemilikan keputusan ada di Ops.
//   node scripts/production-delivery-v2/ops-decision-pack.js --output=pack.json --markdown=pack.md
import "dotenv/config";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { checksum, dateOnly, parseArgs } from "./common.js";
import { buildRouteAssignmentMismatchException, ROUTE_JOB_ASSIGNMENT_MISMATCH } from "./route-assignment-exceptions.js";

const CURRENT_STAGE_WITHOUT_SERVICE = "CURRENT_STAGE_WITHOUT_SERVICE";
const OPEN_STATUSES = ["OPEN", "KEEP_V1"];

async function latestOpenExceptions(prisma, code) {
  const rows = await prisma.v2MigrationException.findMany({ where: { code }, orderBy: [{ createdAt: "desc" }] });
  const seen = new Set();
  const open = [];
  for (const row of rows) {
    const key = `${row.aggregateType}|${row.aggregateId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (OPEN_STATUSES.includes(row.status)) open.push(row);
  }
  return open;
}

async function latestExceptionsByStatus(prisma, code, status) {
  const rows = await prisma.v2MigrationException.findMany({ where: { code }, orderBy: [{ createdAt: "desc" }] });
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    if (seen.has(row.aggregateId)) continue;
    seen.add(row.aggregateId);
    if (row.status === status) result.push(row);
  }
  return result;
}

async function nameMaps(prisma, userIds, vehicleIds) {
  const [users, vehicles] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    vehicleIds.length ? prisma.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, plateNumber: true } }) : [],
  ]);
  return {
    user: (id) => (id ? users.find((item) => item.id === id)?.name ?? `(tidak dikenal ${id.slice(0, 8)})` : "(kosong)"),
    vehicle: (id) => (id ? vehicles.find((item) => item.id === id)?.plateNumber ?? `(tidak dikenal ${id.slice(0, 8)})` : "(kosong)"),
  };
}

export async function buildOpsDecisionPack(prisma) {
  const [routeExceptions, unitExceptions] = await Promise.all([
    latestOpenExceptions(prisma, ROUTE_JOB_ASSIGNMENT_MISMATCH),
    latestOpenExceptions(prisma, CURRENT_STAGE_WITHOUT_SERVICE),
  ]);

  const routes = routeExceptions.length ? await prisma.route.findMany({
    where: { id: { in: routeExceptions.map((item) => item.aggregateId) } },
    include: {
      jobs: { orderBy: [{ sequence: "asc" }, { id: "asc" }], include: { order: { select: { orderNumber: true, status: true } } } },
      deliveryStateV2: { select: { routeRevision: true, currentPublicationVersion: true, lifecycleStatus: true, migrationSource: true } },
    },
  }) : [];
  const units = unitExceptions.length ? await prisma.unit.findMany({
    where: { id: { in: unitExceptions.map((item) => item.aggregateId) } },
    include: { order: { select: { orderNumber: true, status: true, category: true } }, currentStage: { select: { code: true, labelId: true, phase: true } }, service: { select: { code: true } } },
  }) : [];

  const userIds = new Set();
  const vehicleIds = new Set();
  for (const route of routes) {
    [route.driverId, route.helperId].filter(Boolean).forEach((id) => userIds.add(id));
    if (route.vehicleId) vehicleIds.add(route.vehicleId);
    for (const job of route.jobs) {
      [job.driverId, job.helperId].filter(Boolean).forEach((id) => userIds.add(id));
      if (job.vehicleId) vehicleIds.add(job.vehicleId);
    }
  }
  const names = await nameMaps(prisma, [...userIds], [...vehicleIds]);
  const label = (field, id) => (field === "vehicleId" ? names.vehicle(id) : names.user(id));

  const routeItems = routes.map((route) => {
    const exception = routeExceptions.find((item) => item.aggregateId === route.id);
    const live = buildRouteAssignmentMismatchException(route);
    const liveById = new Map((live?.evidence.mismatchedJobs || []).map((item) => [item.jobId, item]));
    const jobs = route.jobs.map((job) => {
      const mismatch = liveById.get(job.id);
      return {
        jobId: job.id, sequence: job.sequence, status: job.status, orderNumber: job.order?.orderNumber ?? null,
        mismatch: Boolean(mismatch),
        differences: (mismatch?.differences || []).map((difference) => ({
          field: difference.field,
          routeHeader: difference.field === "scheduledDate" ? difference.route : label(difference.field, difference.route),
          job: difference.field === "scheduledDate" ? difference.job : label(difference.field, difference.job),
        })),
      };
    });
    const patterns = {};
    for (const job of jobs) for (const difference of job.differences) {
      const key = `${difference.field}: header=${difference.routeHeader} | job=${difference.job}`;
      patterns[key] = (patterns[key] || 0) + 1;
    }
    return {
      exceptionId: exception.id, exceptionStatus: exception.status, routeId: route.id, routeCode: route.code,
      routeStatus: route.status, routeDate: dateOnly(route.date),
      header: { driver: names.user(route.driverId), helper: names.user(route.helperId), vehicle: names.vehicle(route.vehicleId) },
      v2State: route.deliveryStateV2,
      totalJobs: route.jobs.length, mismatchedJobs: jobs.filter((item) => item.mismatch).length,
      evidenceCurrent: checksum(exception.evidence) === (live ? checksum(live.evidence) : null),
      patterns: Object.entries(patterns).map(([pattern, jobsCount]) => ({ pattern, jobs: jobsCount })).sort((a, b) => b.jobs - a.jobs),
      jobs: jobs.filter((item) => item.mismatch),
      observation: route.status === "DRAFT" && jobs.every((job) => job.differences.every((d) => d.field === "scheduledDate" || d.job === "(kosong)"))
        ? "Route masih DRAFT dan job yang menyimpang belum punya crew/kendaraan sama sekali; crew di header adalah rencana dan baru ditetapkan ke job saat publish. Ini kemungkinan BUKAN drift data."
        : null,
      decisionRequired: "Tentukan crew/kendaraan yang benar untuk setiap job pada route ini.",
      options: [
        ...(route.status === "DRAFT" ? [{ code: "EXCLUDE_DRAFT_ROUTES_FROM_CHECK", meaning: "Usul aturan: pengecekan ROUTE_JOB_ASSIGNMENT_MISMATCH hanya untuk route yang sudah dipublish (route DRAFT tidak masuk V2); butuh persetujuan owner." }] : []),
        { code: "ADOPT_JOB_CREW", meaning: "Header route mengikuti crew/kendaraan job (V1 route dikoreksi)." },
        { code: "ADOPT_ROUTE_CREW", meaning: "Job mengikuti crew/kendaraan header route (V1 job dikoreksi)." },
        { code: "SPLIT_ROUTE", meaning: "Job dipindah ke route lain bila crew memang berbeda." },
        { code: "KEEP_V1", meaning: "Route tetap V1 dan dikeluarkan dari cohort V2 (Driver di route ini tidak ikut canary)." },
      ],
      afterDecision: "Koreksi V1 bila perlu, jalankan reconcileDeliveryRouteFromV1 dengan exceptionId ini (menyelesaikan exception dan memperbarui publication V2).",
    };
  });

  const unitItems = units.map((unit) => {
    const exception = unitExceptions.find((item) => item.aggregateId === unit.id);
    return {
      exceptionId: exception.id, exceptionStatus: exception.status, unitId: unit.id, unitCode: unit.unitCode,
      unitStatus: unit.status, orderNumber: unit.order?.orderNumber ?? null, orderCategory: unit.order?.category ?? null,
      currentStage: unit.currentStage ? { code: unit.currentStage.code, label: unit.currentStage.labelId, phase: unit.currentStage.phase } : null,
      serviceId: unit.serviceId, evidence: exception.evidence,
      decisionRequired: "Unit berada di tahap produksi tetapi tidak punya layanan (service) yang menentukan rute produksinya.",
      options: [
        { code: "ASSIGN_SERVICE", meaning: "Tetapkan layanan yang benar untuk unit ini (Ops/Produksi menentukan layanan)." },
        { code: "CLEAR_STAGE", meaning: "Bila tahap saat ini keliru, kosongkan/ubah tahap sesuai kondisi fisik unit." },
        { code: "KEEP_V1", meaning: "Unit tetap dikelola V1 dan dikeluarkan dari cohort produksi V2." },
      ],
    };
  });

  const resolvedUnitRows = await latestExceptionsByStatus(prisma, CURRENT_STAGE_WITHOUT_SERVICE, "RESOLVED");
  return {
    reportType: "production-delivery-v2-ops-decision-pack", readOnly: true, generatedAt: new Date().toISOString(),
    summary: {
      routesNeedingDecision: routeItems.length,
      mismatchedJobs: routeItems.reduce((sum, item) => sum + item.mismatchedJobs, 0),
      unitsNeedingDecision: unitItems.length,
    },
    routes: routeItems, units: unitItems,
    informational: {
      unitsAlreadyResolved: resolvedUnitRows.map((row) => ({ unitId: row.aggregateId, provenance: row.resolution?.provenance ?? null, disposition: row.resolution?.disposition ?? null, resolvedAt: row.resolvedAt })),
    },
  };
}

export function decisionPackMarkdown(pack) {
  const lines = [`# Decision pack Ops — migrasi V2`, ``, `Dibuat ${pack.generatedAt} (read-only; keputusan ada di Ops).`, ``,
    `- Route perlu keputusan: **${pack.summary.routesNeedingDecision}** (${pack.summary.mismatchedJobs} job)`,
    `- Unit perlu keputusan: **${pack.summary.unitsNeedingDecision}**`, ``];
  for (const route of pack.routes) {
    lines.push(`## Route ${route.routeCode} (${route.routeId.slice(0, 8)}) — ${route.routeStatus}, ${route.routeDate}`, ``, ...(route.observation ? [`> ${route.observation}`, ``] : []),
      `Header: driver **${route.header.driver}**, helper **${route.header.helper}**, kendaraan **${route.header.vehicle}**.`,
      `${route.mismatchedJobs} dari ${route.totalJobs} job menyimpang. Status exception: ${route.exceptionStatus}${route.evidenceCurrent ? "" : " (evidence sudah tidak sama dengan data live — jalankan catch-up)"}.`, ``, `Pola perbedaan:`);
    for (const item of route.patterns) lines.push(`- ${item.pattern} — ${item.jobs} job`);
    lines.push(``, `| Seq | Job | Order | Status | Perbedaan |`, `|---|---|---|---|---|`);
    for (const job of route.jobs) {
      lines.push(`| ${job.sequence ?? "-"} | ${job.jobId.slice(0, 8)} | ${job.orderNumber ?? "-"} | ${job.status} | ${job.differences.map((d) => `${d.field}: ${d.routeHeader} → ${d.job}`).join("; ")} |`);
    }
    lines.push(``, `Keputusan: ${route.decisionRequired}`, ...route.options.map((option) => `- \`${option.code}\` — ${option.meaning}`), `Setelah keputusan: ${route.afterDecision}`, ``);
  }
  if (pack.informational.unitsAlreadyResolved.length) {
    lines.push(`## Informasi: CURRENT_STAGE_WITHOUT_SERVICE sudah RESOLVED (${pack.informational.unitsAlreadyResolved.length} unit)`, ``, `Diselesaikan dengan provenance ${[...new Set(pack.informational.unitsAlreadyResolved.map((u) => u.provenance))].join(", ")} dan dibawa forward selama fingerprint evidence tidak berubah. Tidak perlu keputusan baru.`, ``);
  }
  if (pack.units.length) {
    lines.push(`## Unit tanpa layanan (CURRENT_STAGE_WITHOUT_SERVICE)`, ``, `| Unit | Order | Status unit | Tahap saat ini | Exception |`, `|---|---|---|---|---|`);
    for (const unit of pack.units) lines.push(`| ${unit.unitCode} | ${unit.orderNumber ?? "-"} | ${unit.unitStatus} | ${unit.currentStage ? `${unit.currentStage.code} (${unit.currentStage.label})` : "-"} | ${unit.exceptionStatus} |`);
    lines.push(``, `Keputusan: ${pack.units[0].decisionRequired}`, ...pack.units[0].options.map((option) => `- \`${option.code}\` — ${option.meaning}`), ``);
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("ops-decision-pack.js")) {
  const args = parseArgs();
  const prisma = new PrismaClient();
  buildOpsDecisionPack(prisma)
    .then((pack) => {
      if (args.output) fs.writeFileSync(args.output, `${JSON.stringify(pack, null, 2)}\n`);
      if (args.markdown) fs.writeFileSync(args.markdown, decisionPackMarkdown(pack));
      console.log(JSON.stringify(pack.summary));
    })
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
