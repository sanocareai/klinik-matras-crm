// Papan Produksi Harian (D-014) — layar utama kepala produksi / QC Leader.
//
// Menggantikan model kiosk scan yang dibatalkan. Satu orang meng-update
// SELURUH proses, terkumpul, bukan tiap pekerja scan di stasiunnya.
//
// Alur harian:
//   pagi  → GET  /board          (lihat unit di produksi + target hari ini)
//         → POST /targets        (tetapkan target hari ini)
//   sore  → POST /units/:id/done (catat tahap yang selesai hari ini)
//         → GET  /board          (ringkasan untuk dilaporkan ke grup)

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import {
  getUnitStatus, recordStageDone, resolveNextStageForUnits, StageTransitionError,
} from "../services/unitStageEngine.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../utils/wib.js";
import { prisma } from "../db.js";
import { notifyReadyForDelivery } from "../services/customerNotifications.js";

export const productionRouter = express.Router();
productionRouter.use(requireAuth);

function handleErr(err, res) {
  if (err instanceof StageTransitionError) return res.status(err.statusCode).json({ error: err.message });
  console.error("Production error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

// Tanggal target disimpan sebagai DATE polos (hari kerja, bukan instant).
// "Hari ini" HARUS ditentukan menurut WIB, bukan UTC — container backend jalan
// di UTC, jadi tanpa ini order jam 00:00–07:00 WIB terhitung di hari SEBELUMNYA
// (bug kelas yang sudah pernah nyata di analytics.js — CLAUDE.md §11).
function resolveTargetDate(input) {
  if (input) return new Date(`${input}T00:00:00.000Z`); // sudah YYYY-MM-DD dari UI
  const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return new Date(`${nowWib.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

// Status unit yang dianggap "ada di bengkel" — kandidat untuk dikerjakan.
const IN_WORKSHOP = ["RECEIVED", "IN_PRODUCTION"];

// GET /api/production/board?date=YYYY-MM-DD
// Papan harian: target hari ini + unit lain yang ada di bengkel.
productionRouter.get("/board", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const targetDate = resolveTargetDate(req.query.date);

    const targets = await prisma.productionTarget.findMany({
      where: { targetDate },
      include: {
        unit: {
          include: {
            currentStage: true,
            service: true,
            order: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } },
          },
        },
      },
    });

    const targetedUnitIds = targets.map((t) => t.unitId);

    const available = await prisma.unit.findMany({
      where: { status: { in: IN_WORKSHOP }, id: { notIn: targetedUnitIds } },
      include: {
        currentStage: true,
        service: true,
        order: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });

    // `unit.currentStage` (relasi Prisma mentah) NULL untuk unit yang belum
    // pernah di-START — TAPI unit itu tetap punya tahap BERIKUTNYA yang sah
    // (tahap pertama jalurnya). Papan ini perlu tahu tahap itu supaya tombol
    // "Tandai Selesai" aktif sejak unit pertama kali masuk target, bukan baru
    // aktif setelah ada yang men-start-nya duluan — precis kegunaan mode
    // retrospektif (D-014). resolveNextStageForUnits menghitungnya batch,
    // pakai logika SAMA dengan resolveCurrentTarget di engine (D-003: satu
    // sumber kebenaran, bukan diduplikasi di sini).
    const allUnits = [...targets.map((t) => t.unit), ...available];
    const nextStageByUnitId = await resolveNextStageForUnits(allUnits);

    // Hitung berapa target hari ini yang SUDAH bergerak (ada log COMPLETE/SKIP
    // hari ini) — ini angka yang dilaporkan kepala produksi ke grup sore hari.
    //
    // unit_id adalah kolom UUID — filter "in: []" pada Prisma/Postgres valid
    // (hasil kosong), tapi placeholder string palsu seperti "-" DITOLAK keras
    // oleh Postgres ("invalid input syntax for type uuid"). Jadi kalau belum
    // ada target sama sekali, lewati query ini sepenuhnya alih-alih memaksakan
    // filter dengan nilai tidak valid.
    const movedUnitIds = [];
    if (targetedUnitIds.length > 0) {
      const from = startOfDayWIB(targetDate.toISOString().slice(0, 10));
      const to = endOfDayExclusiveWIB(targetDate.toISOString().slice(0, 10));
      const movedLogs = await prisma.unitStageLog.findMany({
        where: {
          unitId: { in: targetedUnitIds },
          action: { in: ["COMPLETE", "SKIP"] },
          createdAt: { gte: from, lt: to },
        },
        select: { unitId: true },
      });
      movedUnitIds.push(...new Set(movedLogs.map((l) => l.unitId)));
    }

    // Tempelkan tahap TERHITUNG (bukan currentStage mentah) ke tiap unit,
    // supaya frontend tidak pernah perlu menghitung jalur sendiri.
    const withComputedStage = (unit) => ({ ...unit, nextStage: nextStageByUnitId[unit.id] || null });

    res.json({
      date: targetDate.toISOString().slice(0, 10),
      targets: targets.map((t) => ({
        ...t,
        unit: withComputedStage(t.unit),
        moved: movedUnitIds.includes(t.unitId),
      })),
      available: available.map(withComputedStage),
      summary: { total: targets.length, moved: movedUnitIds.length },
    });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/production/targets  { unitIds: [], date?, note? }
// Tetapkan target hari ini. Idempotent — unit yang sudah jadi target di
// tanggal yang sama tidak diduplikasi (unique constraint + skipDuplicates).
productionRouter.post("/targets", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const { unitIds, date, note } = req.body;
    if (!Array.isArray(unitIds) || unitIds.length === 0) {
      return res.status(400).json({ error: "unitIds wajib diisi" });
    }
    const targetDate = resolveTargetDate(date);
    await prisma.productionTarget.createMany({
      data: unitIds.map((unitId) => ({ targetDate, unitId, createdById: req.user.id, note })),
      skipDuplicates: true,
    });
    res.json({ ok: true, count: unitIds.length });
  } catch (err) {
    handleErr(err, res);
  }
});

// DELETE /api/production/targets/:id — batalkan target (salah pilih itu wajar,
// dan production_targets memang BUKAN ledger append-only — lihat D-014).
productionRouter.delete("/targets/:id", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    await prisma.productionTarget.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Target tidak ditemukan" });
    handleErr(err, res);
  }
});

// POST /api/production/units/:id/done  { photoUrls?, note? }
// Catat tahap unit SUDAH SELESAI (mode retrospektif — lihat recordStageDone).
productionRouter.post("/units/:id/done", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const { photoUrls, note } = req.body;
    const before = await prisma.unit.findUnique({ where: { id: req.params.id }, select: { status: true } });
    await recordStageDone(req.params.id, { actorId: req.user.id, photoUrls, note });
    const status = await getUnitStatus(req.params.id);

    // FR-N trigger 3/4: "Siap dikirim" — HANYA saat status BENAR-BENAR baru
    // pindah ke READY_FOR_DELIVERY (bukan sudah di sana sebelumnya), supaya
    // tidak terkirim dobel kalau endpoint ini dipanggil lagi untuk unit yang
    // sama. Best-effort, lihat catatan di customerNotifications.js.
    if (before?.status !== "READY_FOR_DELIVERY" && status.unit.status === "READY_FOR_DELIVERY") {
      const order = await prisma.order.findUnique({
        where: { id: status.unit.orderId },
        select: { orderNumber: true, customer: { select: { id: true, name: true } } },
      });
      if (order?.customer) {
        notifyReadyForDelivery(status.unit.unitCode, order.orderNumber, order.customer.id, order.customer.name);
      }
    }

    res.json(status);
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/production/orders/:orderId/documentation
// Berkas dokumentasi satu order: SEMUA foto dari SEMUA tahap seluruh unitnya,
// urut kronologis — inilah yang di-forward sales ke customer (D-015).
//
// Sengaja mengembalikan data mentah + terkelompok, BUKAN mengirim apa pun ke
// WhatsApp: asumsi yang dipakai adalah sales yang forward manual, ada manusia
// yang memeriksa dulu sebelum sesuatu sampai ke customer.
productionRouter.get("/orders/:orderId/documentation", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      select: { id: true, orderNumber: true, customer: { select: { name: true } } },
    });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const logs = await prisma.unitStageLog.findMany({
      where: {
        unit: { orderId: req.params.orderId },
        action: { in: ["COMPLETE", "SKIP"] },
      },
      include: {
        stage: { select: { code: true, labelId: true, phase: true } },
        unit: { select: { unitCode: true, merk: true, ukuran: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // Hanya tahap yang benar-benar punya foto yang masuk berkas dokumentasi.
    const entries = logs
      .filter((l) => l.photoUrls.length > 0)
      .map((l) => ({
        unitCode: l.unit.unitCode,
        stageLabel: l.stage.labelId,
        photoUrls: l.photoUrls,
        note: l.note,
        recordedAt: l.createdAt,
      }));

    res.json({ order, entries, totalPhotos: entries.reduce((n, e) => n + e.photoUrls.length, 0) });
  } catch (err) {
    handleErr(err, res);
  }
});
