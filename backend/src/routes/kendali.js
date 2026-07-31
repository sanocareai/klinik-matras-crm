// Kendali — dashboard lintas portal (PRD §7.7, FR-C). Sano Hub Phase 1.
//
// SEMUANYA di sini dihitung dari data yang BENAR-BENAR ADA, bukan ditebak.
// Dua metrik yang PRD minta (FR-C-01 "unit berisiko lewat tanggal janji",
// FR-C-04 "on-time delivery rate") SENGAJA TIDAK dibangun — Order tidak
// punya kolom tanggal janji kirim sama sekali, jadi tidak ada dasar untuk
// menghitungnya. Frontend menampilkan ini sebagai catatan eksplisit
// ("belum bisa dihitung"), bukan diam-diam dihilangkan begitu saja.
//
// Cycle time per tahap HANYA dari baris requires_photo... — bukan, HANYA
// dari baris COMPLETE yang punya duration_seconds terisi (bukan NULL).
// Pencatatan retrospektif (D-014) sengaja menyimpan NULL kalau durasi
// memang tidak terukur — rata-rata di sini WAJIB mengecualikan NULL, dan
// jumlah sampel WAJIB ditampilkan supaya tidak disalahartikan sebagai data
// lengkap.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";

export const kendaliRouter = express.Router();
kendaliRouter.use(requireAuth);

// GET /api/kendali/overview
kendaliRouter.get("/overview", requirePermission(P.DASHBOARD_READ), async (req, res) => {
  try {
    // 1. Unit per status — potret LIVE sekarang, bukan agregat historis.
    const statusCounts = await prisma.unit.groupBy({ by: ["status"], _count: true });
    const byStatus = Object.fromEntries(statusCounts.map((s) => [s.status, s._count]));

    // 2. Unit terblokir — DERIVED dari ledger (log TERAKHIR di tahap sekarang
    // = FAIL), bukan kolom status (D-014/unitStageEngine.js, prinsip yang
    // sama). Raw SQL: mengecek log terakhir per unit itu murah dalam SATU
    // query lewat subquery berkorelasi, dibanding N+1 dari Prisma per unit.
    const blocked = await prisma.$queryRaw`
      SELECT u.id, u.unit_code AS "unitCode", rs.label_id AS "stageLabel",
             usl.block_reason AS "blockReason", usl.created_at AS "blockedSince"
      FROM units u
      JOIN routing_stages rs ON rs.id = u.current_stage_id
      JOIN LATERAL (
        SELECT action, block_reason, created_at FROM unit_stage_logs
        WHERE unit_id = u.id AND stage_id = u.current_stage_id
        ORDER BY created_at DESC LIMIT 1
      ) usl ON true
      WHERE u.current_stage_id IS NOT NULL AND usl.action = 'FAIL'
      ORDER BY usl.created_at ASC
    `;

    // 3. Cycle time per tahap — HANYA baris COMPLETE dengan duration_seconds
    // terisi. sampleCount ikut dikembalikan supaya UI bisa jujur soal "ini
    // dari berapa banyak data" alih-alih menyembunyikan ukuran sampel.
    const cycleTimeRaw = await prisma.$queryRaw`
      SELECT rs.code AS "stageCode", rs.label_id AS "stageLabel",
             AVG(usl.duration_seconds)::float AS "avgSeconds",
             COUNT(*)::int AS "sampleCount"
      FROM unit_stage_logs usl
      JOIN routing_stages rs ON rs.id = usl.stage_id
      WHERE usl.action = 'COMPLETE' AND usl.duration_seconds IS NOT NULL
      GROUP BY rs.code, rs.label_id, rs.sequence, rs.phase
      ORDER BY rs.phase, rs.sequence
    `;

    // 4. Alasan kegagalan job (pickup+delivery) — FR-C-04 bagian yang BISA
    // dihitung tanpa tanggal janji: "kenapa kunjungan gagal", bukan "apa
    // tepat waktu".
    const jobFailures = await prisma.job.groupBy({
      by: ["type", "failureReason"],
      where: { status: "FAILED" },
      _count: true,
      orderBy: { _count: { failureReason: "desc" } },
    });

    // 5. Rework rate — QC yang TIDAK lolos TANPA override customer (override
    // berarti unit tetap lanjut, lihat unitStageEngine.js recordQcFitTest).
    const [totalQc, reworkQc] = await Promise.all([
      prisma.qcFitTest.count(),
      prisma.qcFitTest.count({ where: { verdict: { not: "PAS" }, customerPreferenceOverride: null } }),
    ]);

    // 6. Aktivitas driver HARI INI — job selesai/gagal, per driver.
    const todayStart = new Date(`${new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
    const driverJobsToday = await prisma.job.findMany({
      where: { updatedAt: { gte: todayStart }, status: { in: ["COMPLETED", "FAILED"] }, driverId: { not: null } },
      select: { driverId: true, status: true, driver: { select: { name: true } } },
    });
    const byDriver = {};
    for (const j of driverJobsToday) {
      const key = j.driverId;
      byDriver[key] ??= { driverName: j.driver?.name || "—", completed: 0, failed: 0 };
      if (j.status === "COMPLETED") byDriver[key].completed++;
      else byDriver[key].failed++;
    }

    res.json({
      units: {
        byStatus,
        totalUnits: statusCounts.reduce((n, s) => n + s._count, 0),
        blocked,
      },
      cycleTime: cycleTimeRaw,
      jobFailures: jobFailures.map((f) => ({ type: f.type, reason: f.failureReason, count: f._count })),
      rework: { totalQc, reworkQc, reworkRate: totalQc > 0 ? reworkQc / totalQc : null },
      driverActivity: Object.entries(byDriver).map(([driverId, v]) => ({ driverId, ...v })),
      // Ditandai eksplisit supaya frontend TIDAK menebak-nebak kenapa field
      // ini kosong — sengaja belum dibangun, bukan bug.
      unavailable: {
        atRiskUnits: "Order belum punya kolom tanggal janji kirim (promisedDeliveryDate) — belum bisa dihitung.",
        onTimeDeliveryRate: "Sama seperti di atas — butuh tanggal janji kirim untuk dibandingkan.",
      },
    });
  } catch (err) {
    console.error("Kendali overview error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});
