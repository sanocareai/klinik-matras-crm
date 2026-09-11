// Endpoint produksi Sano Hub Phase 1 — kiosk scan & QC.
//
// Dipasang di index.js di balik requirePermission — aman walau belum ada
// user yang punya role produksi (lihat docs/sano-hub/PHASE-0.md).

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import {
  startStage, completeStage, failStage, skipStage, recordQcFitTest, getUnitStatus, resolveBlocker,
  pauseStage, resumeStage,
  StageTransitionError,
} from "../services/unitStageEngine.js";
import { buildUnitPath } from "../lib/domain/routing.js";
import {
  deriveProductionStatus, describeProductionStatus, isReworkTarget, PRODUCTION_PRIORITY_VALUES,
} from "../lib/domain/productionState.js";
import { deriveOverdue, deriveAtRisk } from "../lib/domain/productionExceptions.js";
import { groupIntoAttempts, deriveStageLogStatus, summarizeAttempt } from "../lib/domain/stageExecution.js";
import { mapRouteStagesToVisualization } from "../lib/domain/productionRouting.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { tryProvisionUnitRoute, changeUnitRoute, assignStage } from "../services/productionRouting.js";
import { postStockMovement } from "../services/inventoryLedger.js";
import { prisma } from "../db.js";

export const unitRouter = express.Router();
unitRouter.use(requireAuth);

// Upload foto tahap produksi — pola SAMA dengan routes/products.js (multer
// disk storage + kompresi sudah dilakukan di klien sebelum upload, lihat
// frontend/src/utils/compressImage.js).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const unitPhotosDir = path.join(__dirname, "../../data/unit-photos");
if (!fs.existsSync(unitPhotosDir)) fs.mkdirSync(unitPhotosDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: unitPhotosDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${req.params.id}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB — foto sudah dikompres di klien, ini jaring pengaman
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Hanya file gambar yang diperbolehkan"));
    cb(null, true);
  },
});

function handleEngineError(err, res) {
  // Duck-typed, bukan cuma `instanceof StageTransitionError` — supaya
  // LedgerError dari services/inventoryLedger.js (POST /:id/materials,
  // "stok tidak cukup") juga dijawab 400 yang jelas, bukan bocor ke 500
  // generik di bawah.
  if (typeof err.statusCode === "number") {
    return res.status(err.statusCode).json({ error: err.message });
  }
  // P2034 = konflik transaksi SERIALIZABLE (Production Core Slice 3I) — dua
  // perintah eksekusi (START/PAUSE/RESUME/COMPLETE) bersamaan pada tahap yang
  // sama, salah satunya kalah lomba. Ini SINYAL SEHAT (Postgres mencegah
  // korupsi data), bukan bug — jawab 409 yang jelas + minta klien coba lagi,
  // JANGAN bocorkan pesan Prisma mentah ke pengguna.
  if (err.code === "P2034") {
    return res.status(409).json({ error: "Ada aksi lain yang bersamaan mengubah tahap ini — coba lagi" });
  }
  console.error("Unit stage engine error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

// POST /api/units/:id/stages/start — mulai tahap berikutnya yang sah
// (atau retry tahap yang sedang blocked).
unitRouter.post("/:id/stages/start", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const result = await startStage(req.params.id, { actorId: req.user.id });
    res.json(result);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/stages/:stageId/complete
unitRouter.post("/:id/stages/:stageId/complete", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const { photoUrls, note } = req.body;
    const log = await completeStage(req.params.id, req.params.stageId, {
      actorId: req.user.id, photoUrls, note,
    });
    res.json(log);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/stages/:stageId/fail — OPEN BLOCKER (Production Core
// Slice 2A). Wajib blockReason (PRD §6.2), tipe divalidasi terhadap
// BLOCK_REASON_VALUES, OTHER wajib catatan jelas — lihat failStage().
// Respons SEKARANG { log, blocker } (Slice 2, tambahan aditif dari { log }
// polos sebelumnya).
unitRouter.post("/:id/stages/:stageId/fail", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const { blockReason, note } = req.body;
    const result = await failStage(req.params.id, req.params.stageId, {
      actorId: req.user.id, blockReason, note,
    });
    res.json(result);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/stages/:stageId/pause — JEDA tahap yang sedang berjalan
// (Production Core Slice 3C). Permission SAMA dengan start/complete/fail —
// siapa pun yang boleh mengerjakan tahap juga boleh menjedanya sendiri.
unitRouter.post("/:id/stages/:stageId/pause", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const { reason, note } = req.body;
    const result = await pauseStage(req.params.id, req.params.stageId, {
      actorId: req.user.id, reason, note,
    });
    res.json(result);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/stages/:stageId/resume — LANJUTKAN tahap yang dijeda.
unitRouter.post("/:id/stages/:stageId/resume", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const result = await resumeStage(req.params.id, req.params.stageId, { actorId: req.user.id });
    res.json(result);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/blockers/:blockerId/resolve — RESOLVE BLOCKER
// (Production Core Slice 2A), perintah EKSPLISIT terpisah dari me-restart
// tahap (startStage() juga auto-resolve, lihat catatan di sana — dua jalur
// menuju satu state akhir konsisten). Permission SAMA dengan membuka blokir
// (UNIT_STAGE_WRITE) — siapa pun yang boleh "Tandai Terhambat" juga boleh
// mencatat penyelesaiannya.
unitRouter.post("/:id/blockers/:blockerId/resolve", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const { resolutionNote } = req.body;
    const blocker = await resolveBlocker(req.params.blockerId, { actorId: req.user.id, resolutionNote });
    res.json(blocker);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/stages/skip — hanya tahap opsional.
unitRouter.post("/:id/stages/skip", requirePermission(P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    const { note } = req.body;
    const log = await skipStage(req.params.id, { actorId: req.user.id, note });
    res.json(log);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/stages/:stageId/qc — putusan Uji Berat Badan (D-005).
// Permission QC_WRITE, TERPISAH dari UNIT_STAGE_WRITE biasa — hanya QC Leader
// (atau role yang diberi QC_WRITE) yang boleh memutuskan verdict.
unitRouter.post("/:id/stages/:stageId/qc", requirePermission(P.QC_WRITE), async (req, res) => {
  try {
    const { verdict, referenceWeightKg, customerPreferenceOverride, educationGiven, note, photoUrls } = req.body;
    const result = await recordQcFitTest(req.params.id, req.params.stageId, {
      actorId: req.user.id, verdict, referenceWeightKg,
      customerPreferenceOverride, educationGiven, note, photoUrls,
    });
    res.json(result);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// PATCH /api/units/:id/service — tetapkan/revisi layanan unit.
//
// CATATAN LINGKUP: ini BUKAN alur ScopeRevision lengkap (D-008) — belum ada
// pencatatan delta harga, belum ada status BLOCKED:awaiting_customer_approval,
// belum ada notifikasi WhatsApp ke customer. Endpoint minimal ini HANYA
// menetapkan service_id supaya jalur produksi unit bisa dihitung — Production
// Lead memutuskan lini/layanan di Uji Fondasi (D-008), tapi alur persetujuan
// customer untuk PERUBAHAN harga masih pekerjaan terpisah, belum dibangun.
unitRouter.patch("/:id/service", requirePermission(P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    const { serviceId } = req.body;
    if (!serviceId) return res.status(400).json({ error: "serviceId wajib diisi" });

    const service = await prisma.serviceCatalog.findUnique({ where: { id: serviceId } });
    if (!service) return res.status(404).json({ error: "Layanan tidak ditemukan di katalog" });

    const existing = await prisma.unit.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "Unit tidak ditemukan" });

    // Update + jejak aktivitas dalam SATU transaksi (Production Core Slice 1)
    // — sebelum ini penetapan/perubahan layanan unit sama sekali tidak
    // tercatat di mana pun selain updatedAt polos.
    const unit = await prisma.$transaction(async (tx) => {
      const updated = await tx.unit.update({
        where: { id: req.params.id },
        data: { serviceId, serviceLine: service.serviceLine },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.UNIT, entityId: req.params.id,
        eventType: EVENT_TYPES.SERVICE_ASSIGNED, actorId: req.user.id,
        metadata: { serviceId, serviceLabel: service.labelId, serviceLine: service.serviceLine },
      });
      // Provisioning rute produksi (Production Core Slice 4D) — BEST-EFFORT,
      // TIDAK PERNAH menggagalkan penetapan layanan di atas kalau gagal, dan
      // TIDAK PERNAH menimpa snapshot unit yang sudah punya riwayat eksekusi
      // (guardrail ada DI DALAM tryProvisionUnitRoute — silent no-op, bukan
      // reject keras; reject keras itu tugas POST /:id/route yang eksplisit).
      await tryProvisionUnitRoute(tx, req.params.id, serviceId, req.user.id);
      return updated;
    });
    res.json(unit);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// PATCH /api/units/:id/production — prioritas & tanggal target produksi
// (Production Core Slice 1). TERPISAH dari stage engine — ini metadata
// perencanaan, BUKAN transisi tahap, jadi tidak lewat unitStageEngine.js.
//
// Permission UNIT_ROUTING_WRITE (level supervisor), SENGAJA BUKAN
// UNIT_STAGE_WRITE — spec eksplisit: pekerja produksi (PRODUCTION_WORKER,
// hanya punya UNIT_STAGE_WRITE) tidak boleh mereprioritaskan pekerjaannya
// sendiri. PRODUCTION_LEAD/QC_LEAD/ADMIN yang punya UNIT_ROUTING_WRITE.
//
// Hanya field yang BENAR-BENAR berubah yang ditulis + dicatat aktivitasnya
// — pola sama dengan order_status_transitions/pipeline_transitions: jangan
// mencatat "X -> X" kalau form mengirim nilai yang sama persis.
unitRouter.patch("/:id/production", requirePermission(P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    const { priority, productionDueAt } = req.body;

    if (priority !== undefined && !PRODUCTION_PRIORITY_VALUES.includes(priority)) {
      return res.status(400).json({ error: `priority harus salah satu dari: ${PRODUCTION_PRIORITY_VALUES.join(", ")}` });
    }

    let parsedDueAt;
    if (productionDueAt !== undefined) {
      parsedDueAt = productionDueAt ? new Date(productionDueAt) : null;
      if (productionDueAt && Number.isNaN(parsedDueAt.getTime())) {
        return res.status(400).json({ error: "productionDueAt bukan tanggal/jam yang valid (pakai format ISO)" });
      }
    }

    const before = await prisma.unit.findUnique({
      where: { id: req.params.id },
      select: { priority: true, productionDueAt: true },
    });
    if (!before) return res.status(404).json({ error: "Unit tidak ditemukan" });

    const data = {};
    if (priority !== undefined && priority !== before.priority) data.priority = priority;
    if (productionDueAt !== undefined) {
      const beforeIso = before.productionDueAt ? before.productionDueAt.toISOString() : null;
      const afterIso = parsedDueAt ? parsedDueAt.toISOString() : null;
      if (afterIso !== beforeIso) data.productionDueAt = parsedDueAt;
    }

    // Tidak ada yang benar-benar berubah — kembalikan apa adanya, JANGAN
    // buka transaksi/tulis aktivitas kosong.
    if (Object.keys(data).length === 0) {
      return res.json(await prisma.unit.findUnique({ where: { id: req.params.id } }));
    }

    const unit = await prisma.$transaction(async (tx) => {
      const updated = await tx.unit.update({ where: { id: req.params.id }, data });

      if ("priority" in data) {
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.UNIT, entityId: req.params.id,
          eventType: EVENT_TYPES.PRIORITY_CHANGED, actorId: req.user.id,
          metadata: { from: before.priority, to: data.priority },
        });
      }
      if ("productionDueAt" in data) {
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.UNIT, entityId: req.params.id,
          eventType: EVENT_TYPES.DUE_DATE_CHANGED, actorId: req.user.id,
          metadata: {
            from: before.productionDueAt ? before.productionDueAt.toISOString() : null,
            to: data.productionDueAt ? data.productionDueAt.toISOString() : null,
          },
        });
      }
      return updated;
    });

    res.json(unit);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/route — tetapkan/ganti rute produksi unit secara
// EKSPLISIT (Production Core Slice 4Q). Permission SAMA dengan
// PATCH /:id/service (UNIT_ROUTING_WRITE) — dua-duanya keputusan
// "jalur produksi unit ini apa", level supervisor yang sama. MENOLAK KERAS
// (409) kalau unit sudah punya riwayat eksekusi dan rutenya akan berubah —
// lihat changeUnitRoute().
unitRouter.post("/:id/route", requirePermission(P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    const result = await changeUnitRoute(req.params.id, { actorId: req.user.id });
    res.json(result);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/stages/:stageId/assign — tugaskan Work Center +
// Operator ke tahap tertentu (Production Core Slice 4H/4I). Permission
// TERPISAH dari UNIT_STAGE_WRITE — mengerjakan tahap ≠ memutuskan siapa
// yang DITUGASKAN mengerjakannya (itu keputusan supervisor).
unitRouter.post("/:id/stages/:stageId/assign", requirePermission(P.PRODUCTION_ASSIGNMENT_WRITE), async (req, res) => {
  try {
    const { workCenterId, operatorId, note } = req.body;
    const result = await assignStage(req.params.id, req.params.stageId, {
      workCenterId, operatorId, actorId: req.user.id, note,
    });
    res.json(result);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// GET /api/units/by-code/:code — cari unit dari hasil scan QR / input kiosk.
// HARUS didaftarkan SEBELUM "/:id" — kalau tidak, Express akan mencocokkan
// "by-code" sebagai path param :id dan endpoint ini tidak pernah kena.
//
// Sekaligus mengembalikan status produksi (getUnitStatus) supaya kiosk bisa
// langsung tahu tombol apa yang harus ditampilkan TANPA menghitung sendiri
// jalur routing di frontend — satu-satunya sumber kebenaran tetap di server.
unitRouter.get("/by-code/:code", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const unit = await prisma.unit.findUnique({ where: { unitCode: req.params.code } });
    if (!unit) return res.status(404).json({ error: `Unit dengan kode "${req.params.code}" tidak ditemukan` });
    const status = await getUnitStatus(unit.id);
    res.json(status);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/photos — upload foto tahap (multipart, field "photos").
// Mengembalikan array URL, dipakai kiosk sebagai photoUrls saat memanggil
// complete/qc. Foto TIDAK langsung menempel ke ledger di sini — upload dan
// penulisan log adalah dua langkah terpisah supaya foto yang gagal diproses
// tidak membuat baris ledger korup.
unitRouter.post("/:id/photos", requirePermission(P.UNIT_STAGE_WRITE), upload.array("photos", 6), async (req, res) => {
  try {
    const urls = (req.files || []).map((f) => `/media/unit-photos/${f.filename}`);
    res.json({ urls });
  } catch (err) {
    handleEngineError(err, res);
  }
});

// GET /api/units/:id — status produksi lengkap, untuk layar kiosk.
unitRouter.get("/:id", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const status = await getUnitStatus(req.params.id);
    res.json(status);
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Unit tidak ditemukan" });
    handleEngineError(err, res);
  }
});

// GET /api/units/:id/timeline — jalur PENUH + riwayat ledger, untuk halaman
// detail unit (Production Tahap 2). BEDA dari GET /:id (getUnitStatus, dipakai
// kiosk): itu cuma tahu tahap yang harus ditindak SEKARANG, ini menyusun
// SELURUH tahap jalur beserta status masing-masing — untuk manusia yang
// ingin melihat progres dari awal, bukan cuma "apa selanjutnya".
//
// Status per tahap DIHITUNG dari log yang sama (unit_stage_logs), TIDAK ada
// sumber kebenaran kedua — kalau log kosong untuk suatu tahap, tahap itu
// NOT_STARTED, apa adanya (bukan ditebak "mestinya sudah lewat").
unitRouter.get("/:id/timeline", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: req.params.id },
      include: {
        service: true,
        currentStage: true,
        order: { select: { id: true, orderNumber: true, status: true, customer: { select: { id: true, name: true, phone: true } } } },
        qcFitTests: { include: { stage: { select: { id: true, labelId: true } }, testedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } },
        // Snapshot rute produksi (Production Core Slice 4D/4J/4K) — relasi
        // FK langsung di Unit, SATU JOIN, TIDAK butuh batch loader terpisah
        // (beda dari StageAssignment yang per-stage, lihat di bawah).
        productionRoute: { include: { stages: { orderBy: { sequence: "asc" }, include: { stage: { select: { id: true, labelId: true, phase: true } }, workCenter: { select: { id: true, code: true, name: true } } } } } },
      },
    });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan" });

    const [intakeStages, finishStages, moduleMappings, logs, activeBlocker, currentStageAssignment] = await Promise.all([
      prisma.routingStage.findMany({ where: { phase: "INTAKE", active: true } }),
      prisma.routingStage.findMany({ where: { phase: "FINISH", active: true } }),
      unit.serviceId
        ? prisma.serviceCatalogModule.findMany({ where: { serviceId: unit.serviceId }, orderBy: { sequence: "asc" }, include: { stage: true } })
        : Promise.resolve([]),
      prisma.unitStageLog.findMany({
        where: { unitId: unit.id },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      // Blokir TERBUKA unit ini (Production Core Slice 2A) — satu query
      // tambahan, wajar untuk endpoint SATU unit (bukan daftar).
      prisma.productionBlocker.findFirst({
        where: { unitId: unit.id, resolvedAt: null },
        include: { openedBy: { select: { id: true, name: true } }, stage: { select: { id: true, labelId: true } } },
      }),
      // Assignment tahap SEKARANG (Production Core Slice 4I) — satu query
      // tambahan, wajar untuk endpoint SATU unit. null kalau belum pernah
      // ditugaskan ATAU unit belum masuk tahap apa pun.
      unit.currentStageId
        ? prisma.stageAssignment.findUnique({
            where: { unitId_stageId: { unitId: unit.id, stageId: unit.currentStageId } },
            include: { workCenter: true, operator: { include: { user: { select: { id: true, name: true } } } } },
          })
        : Promise.resolve(null),
    ]);

    const path = buildUnitPath(intakeStages, moduleMappings.map((m) => m.stage), finishStages);
    const logsByStage = {};
    for (const log of logs) (logsByStage[log.stageId] ??= []).push(log);

    // Status per tahap sekarang PAUSE-aware (Production Core Slice 3O) —
    // deriveStageLogStatus() dari lib/domain/stageExecution.js SUDAH
    // mengenali RESUME (=IN_PROGRESS lagi) dan PAUSE (=state PAUSED
    // tersendiri, TERPISAH dari BLOCKED/FAIL). Definisi TUNGGAL dipakai
    // ulang di sini dan di getUnitStatus() — tidak ada salinan kedua yang
    // bisa diam-diam menyimpang.
    const timeline = path.map((stage) => {
      const stageLogs = logsByStage[stage.id] || [];
      const last = stageLogs[stageLogs.length - 1] || null;
      const status = last ? deriveStageLogStatus(last.action) : "NOT_STARTED";
      return { stage, status, logs: stageLogs, isCurrent: unit.currentStageId === stage.id };
    });

    // Execution History (Slice 3O) — daftar ATTEMPT tahap yang sedang
    // ditindak SEKARANG (SATU unit, jumlah baris kecil — aman, bukan pola
    // daftar/N+1). SENGAJA terpisah dari `activeBlocker`/Activity Timeline
    // generik di atas — ini kosakata level-eksekusi (attempt/touch/paused),
    // bukan audit lintas entitas.
    const currentStageLogs = unit.currentStageId ? (logsByStage[unit.currentStageId] || []) : [];
    const executionHistory = groupIntoAttempts(currentStageLogs).map((attempt) => summarizeAttempt(attempt));

    // productionStatus level-UNIT (Production Core Slice 1/2) — kosakata
    // KANONIK dari lib/domain/productionState.js, di atas status per-tahap
    // yang dihitung untuk `timeline` di atas (dua hal berbeda: status SATU
    // baris tahap vs status unit SECARA KESELURUHAN).
    //
    // Rework/overdue/at-risk dihitung DI SINI (bukan endpoint lain yang
    // menampilkan banyak unit sekaligus — board/work-orders/qc-queue) —
    // datanya (qcFitTests + blocker + path) sudah termuat penuh untuk SATU
    // unit tanpa query tambahan. Endpoint LIST memakai batch loader
    // (loadOpenBlockersByUnit/loadLatestQcFitTestByUnit di
    // unitStageEngine.js) supaya tetap 1 query per jenis data, bukan N+1 —
    // lihat routes/production.js.
    const currentPathStage = path.find((s) => s.id === unit.currentStageId) || null;
    const lastLogForCurrentStage = unit.currentStageId ? (logsByStage[unit.currentStageId]?.slice(-1)[0] || null) : null;
    const latestQc = unit.qcFitTests[0] || null;
    const reworkTarget = isReworkTarget({ latestQc, currentStagePhase: currentPathStage?.phase });
    const productionStatus = deriveProductionStatus({
      unit, lastLog: lastLogForCurrentStage,
      hasOpenBlocker: !!activeBlocker,
      currentStageRequiresQc: !!currentPathStage?.requiresQc,
      isReworkTarget: reworkTarget,
    });

    const overdue = deriveOverdue({ unit });
    const risk = deriveAtRisk({
      unit, hasOpenBlocker: !!activeBlocker, blockerReason: activeBlocker?.reason || null, overdue,
    });

    // Panel Rute Produksi (Production Core Slice 4J/4K) — SELURUHNYA
    // TURUNAN dari data yang sudah dimuat di atas, TIDAK ADA query
    // tambahan lagi di sini:
    //   - route/routeVersion: dari unit.productionRoute (snapshot, null
    //     untuk unit lama — lihat catatan arsitektur di schema.prisma)
    //   - routeVisualization: gabungan snapshot rute + status LIVE per
    //     tahap (`timeline` di atas) — ✓/●/○, lihat
    //     mapRouteStagesToVisualization(). Kosong kalau unit belum punya
    //     snapshot rute; UI menampilkannya sebagai "rute belum tercatat",
    //     BUKAN menebak dari `timeline` mentah.
    //   - nextStage: tahap SETELAH currentStageId di jalur LIVE yang sama
    //     dipakai `timeline` (bukan snapshot — jalur LIVE tetap satu-
    //     satunya sumber kebenaran urutan, D-003).
    //   - workCenter/assignedOperator: dari currentStageAssignment (Slice
    //     4H/4I) — "siapa yang DIHARAPKAN mengerjakan".
    //   - actualPerformer: dari lastLogForCurrentStage.actor — "siapa yang
    //     SUNGGUHAN start/resume tahap ini" (Slice 3), SENGAJA field
    //     TERPISAH dari assignedOperator di atas, tidak pernah saling
    //     menimpa (lihat catatan panjang di schema.prisma StageAssignment).
    const currentIdx = path.findIndex((s) => s.id === unit.currentStageId);
    const nextPathStage = currentIdx >= 0 ? (path[currentIdx + 1] || null) : (path[0] || null);
    const liveStatusByStageId = Object.fromEntries(timeline.map((t) => [t.stage.id, t.status]));
    const routeVisualization = unit.productionRoute
      ? mapRouteStagesToVisualization(
          unit.productionRoute.stages.map((rs) => ({
            stageId: rs.stageId, sequence: rs.sequence, required: rs.required,
            workCenterId: rs.workCenterId, stage: rs.stage, workCenter: rs.workCenter,
          })),
          liveStatusByStageId, unit.currentStageId,
        )
      : [];

    res.json({
      unit, path: timeline, qcFitTests: unit.qcFitTests,
      needsService: !unit.serviceId,
      productionStatus,
      productionStatusReason: describeProductionStatus(productionStatus, lastLogForCurrentStage, activeBlocker),
      // Operasional (Production Core Slice 2H — bagian "Unit Detail").
      activeBlocker,
      overdue,
      risk,
      // Eksekusi tahap SEKARANG (Production Core Slice 3O) — riwayat attempt
      // (START/PAUSE/RESUME/.../terminal) untuk currentStageId unit ini.
      executionHistory,
      // Panel Rute Produksi (Production Core Slice 4).
      route: unit.productionRoute
        ? { id: unit.productionRoute.id, code: unit.productionRoute.code, name: unit.productionRoute.name, version: unit.productionRoute.version }
        : null,
      routeVisualization,
      nextStage: nextPathStage,
      workCenter: currentStageAssignment?.workCenter || null,
      assignedOperator: currentStageAssignment?.operator
        ? { id: currentStageAssignment.operator.id, name: currentStageAssignment.operator.user.name }
        : null,
      actualPerformer: lastLogForCurrentStage?.actor || null,
    });
  } catch (err) {
    handleEngineError(err, res);
  }
});

// ── Bahan baku per unit (Production Tahap 5) ───────────────────────────
//
// TIDAK ADA tabel baru — memakai stock_movements yang sama dengan Gudang
// (StockMovement.unitId sudah ada sejak schema Warehouse, tinggal dipakai).
// Sengaja TIDAK lewat alur dokumen MaterialIssue (approval/picking/issuing)
// — itu didesain untuk gudang yang terpisah dari produksi. Di sini gudang
// dan bengkel satu ruangan yang sama, jadi cukup catat langsung "bahan X
// dipakai untuk unit Y", ledger append-only sama seperti sisi Gudang.
//
// KOREKSI = baris baru, bukan UPDATE (Aturan #2, sama seperti seluruh
// stock_movements lain) — supaya "aslinya salah ketik apa" tetap terlihat,
// bukan menghilang diam-diam. qty positif = pemakaian tambahan (ISSUE,
// ledger negatif); qty negatif = koreksi mengurangi (RETURN, ledger
// positif, mengembalikan sebagian ke stok).
unitRouter.get("/:id/materials", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    // WASTE ikut disertakan (13 Sept 2026, integrasi Produksi) — bahan yang
    // rusak/salah potong SAAT mengerjakan unit ini sekarang bisa dikaitkan
    // ke unitId (lihat POST /movements/waste), jadi histori "bahan apa saja
    // yang tersentuh unit ini" tidak lengkap kalau WASTE dilewati.
    const movements = await prisma.stockMovement.findMany({
      where: { unitId: req.params.id, type: { in: ["ISSUE", "RETURN", "WASTE"] } },
      select: {
        id: true, type: true, qty: true, reason: true, note: true, createdAt: true,
        material: { select: { id: true, code: true, name: true, unit: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalsByMaterial = {};
    for (const m of movements) {
      const key = m.material.id;
      totalsByMaterial[key] ??= { material: m.material, netQty: 0 };
      totalsByMaterial[key].netQty += Number(m.qty);
    }
    const totals = Object.values(totalsByMaterial).map((t) => ({
      material: t.material, usedQty: -t.netQty,
    }));

    res.json({ movements, totals });
  } catch (err) {
    handleEngineError(err, res);
  }
});

// PERBAIKAN (13 Sept 2026, integrasi Warehouse<->Production end-to-end):
// endpoint ini sebelumnya menulis stock_movements LANGSUNG lewat
// prisma.stockMovement.create — TIDAK dikunci, TIDAK dicek saldo cukup
// atau tidak sama sekali. Karena jalur ini dipakai lantai produksi (bukan
// gudang, yang lebih hati-hati lewat Material Issue formal), risikonya
// nyata: dua staf mencatat pemakaian bahan yang sama nyaris bersamaan bisa
// dua-duanya lolos, atau satu staf salah ketik jumlah besar dan mendorong
// saldo ke negatif tanpa peringatan. Sekarang lewat postStockMovement()
// yang sama dipakai seluruh alur Gudang — mengunci material, mengecek
// saldo, dan menolak kalau hasilnya akan negatif.
unitRouter.post("/:id/materials", requirePermission(P.UNIT_MATERIAL_WRITE), async (req, res) => {
  try {
    const { materialId, note } = req.body;
    const rawQty = Number(req.body.qty);
    if (!materialId) return res.status(400).json({ error: "Bahan wajib dipilih" });
    if (!Number.isFinite(rawQty) || rawQty === 0) {
      return res.status(400).json({ error: "Jumlah wajib diisi dan tidak boleh nol" });
    }

    const material = await prisma.material.findUnique({ where: { id: materialId } });
    if (!material) return res.status(404).json({ error: "Bahan tidak ditemukan" });
    if (!material.active) return res.status(400).json({ error: "Bahan ini sudah nonaktif" });

    const unit = await prisma.unit.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan" });

    // rawQty > 0 → pemakaian tambahan (ISSUE, stok berkurang, ledger negatif).
    // rawQty < 0 → koreksi mengurangi (RETURN, stok bertambah, ledger positif).
    const type = rawQty > 0 ? "ISSUE" : "RETURN";
    const ledgerQty = -rawQty;

    const movement = await prisma.$transaction((tx) => postStockMovement(tx, {
      materialId, type, qty: ledgerQty, unitId: unit.id,
      note: note || null, createdById: req.user.id,
    }));
    res.status(201).json(movement);
  } catch (err) {
    handleEngineError(err, res);
  }
});
