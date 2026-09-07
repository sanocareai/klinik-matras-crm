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
  getUnitStatus, recordStageDone, resolveNextStageForUnits, loadLastCurrentStageLogs,
  loadOpenBlockersByUnit, loadLatestQcFitTestByUnit, StageTransitionError,
} from "../services/unitStageEngine.js";
import { deriveProductionStatus, describeProductionStatus, isReworkTarget, PRODUCTION_COMPLETE_UNIT_STATUSES } from "../lib/domain/productionState.js";
import { deriveStageLogStatus, OPEN_WORK_ACTIONS as EXECUTION_OPEN_WORK_ACTIONS } from "../lib/domain/stageExecution.js";
import {
  deriveOverdue, deriveAtRisk, deriveWorkspaceHealth, buildExceptions, RISK_CONFIG,
} from "../lib/domain/productionExceptions.js";
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

/**
 * unitId yang SUDAH bergerak (ada log COMPLETE/SKIP) pada `targetDate` (WIB) —
 * dipakai /board (summary.moved) dan /command-center (summary.completedToday,
 * flow.completed). Ditarik jadi satu fungsi 6 September 2026 (Production
 * Core Slice 2) supaya dua permukaan itu memakai definisi "selesai hari
 * ini" yang SAMA, bukan salinan kedua yang bisa diam-diam menyimpang.
 *
 * unit_id adalah kolom UUID — filter "in: []" pada Prisma/Postgres valid
 * (hasil kosong), tapi placeholder string palsu seperti "-" DITOLAK keras
 * oleh Postgres ("invalid input syntax for type uuid"). Jadi kalau
 * `unitIds` kosong, lewati query ini sepenuhnya alih-alih memaksakan
 * filter dengan nilai tidak valid.
 */
async function movedUnitIdsForDate(unitIds, targetDate) {
  if (!unitIds || unitIds.length === 0) return new Set();
  const dateStr = targetDate.toISOString().slice(0, 10);
  const from = startOfDayWIB(dateStr);
  const to = endOfDayExclusiveWIB(dateStr);
  const movedLogs = await prisma.unitStageLog.findMany({
    where: { unitId: { in: unitIds }, action: { in: ["COMPLETE", "SKIP"] }, createdAt: { gte: from, lt: to } },
    select: { unitId: true },
  });
  return new Set(movedLogs.map((l) => l.unitId));
}

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

    // productionStatus level-UNIT (Production Core Slice 1/2) — DUA query
    // batch (log terakhir + blocker terbuka), TIDAK bertambah seiring
    // jumlah unit — lihat loadLastCurrentStageLogs/loadOpenBlockersByUnit.
    // isReworkTarget TIDAK dihitung di sini (lihat catatan di
    // GET /units/:id/timeline) — unit yang sedang dirework tampil
    // IN_PROGRESS/QUEUED/BLOCKED, tetap benar, cuma kurang spesifik.
    const [lastLogByUnitId, blockerByUnitId] = await Promise.all([
      loadLastCurrentStageLogs(allUnits),
      loadOpenBlockersByUnit(allUnits.map((u) => u.id)),
    ]);

    // Hitung berapa target hari ini yang SUDAH bergerak (ada log COMPLETE/SKIP
    // hari ini) — ini angka yang dilaporkan kepala produksi ke grup sore hari.
    const movedUnitIds = [...await movedUnitIdsForDate(targetedUnitIds, targetDate)];

    // Tempelkan tahap TERHITUNG (bukan currentStage mentah) + productionStatus
    // ke tiap unit, supaya frontend tidak pernah perlu menghitung jalur atau
    // status sendiri.
    const withComputedStage = (unit) => {
      const nextStage = nextStageByUnitId[unit.id] || null;
      const lastLog = lastLogByUnitId[unit.id] || null;
      const blocker = blockerByUnitId[unit.id] || null;
      const productionStatus = deriveProductionStatus({
        unit, lastLog, hasOpenBlocker: !!blocker, currentStageRequiresQc: !!nextStage?.requiresQc,
      });
      return {
        ...unit, nextStage, productionStatus,
        productionStatusReason: describeProductionStatus(productionStatus, lastLog, blocker),
      };
    };

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

    // BERKAS DOKUMENTASI LINTAS DIVISI (19 Agustus 2026). SEBELUMNYA endpoint
    // ini HANYA membaca unit_stage_logs — jadi foto driver (saat menjemput
    // kasur & saat mengantar) beserta tanda tangan customer tidak pernah ikut,
    // padahal ketiganya bagian dari satu perjalanan order yang sama dan
    // sama-sama sudah tersimpan rapi di database.
    //
    // Akibat pemisahan itu: sales yang ingin menunjukkan "kasur Bapak sudah
    // kami jemput, ini prosesnya, ini bukti sudah sampai" harus membuka dua
    // tempat berbeda — dan bukti pengiriman praktis tidak pernah dipakai.
    //
    // Sekarang satu order = satu berkas, TERKATEGORI mengikuti urutan nyata
    // di lapangan: Penjemputan → Produksi → Pengiriman.
    const [logs, jobs] = await Promise.all([
      prisma.unitStageLog.findMany({
        where: {
          unit: { orderId: req.params.orderId },
          action: { in: ["COMPLETE", "SKIP"] },
        },
        include: {
          stage: { select: { code: true, labelId: true, phase: true } },
          unit: { select: { unitCode: true, merk: true, ukuran: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.job.findMany({
        where: { orderId: req.params.orderId },
        select: {
          type: true, status: true, completedAt: true, createdAt: true,
          proofPhotoUrls: true, signatureUrl: true,
          driver: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    // Bentuk entry SENGAJA seragam untuk ketiga kategori — supaya UI bisa
    // merender & mengirimkannya ke customer dengan satu jalur yang sama
    // (POST /conversations/:id/send-documentation), tanpa cabang per sumber.
    const entryJob = (j, kategori) => ({
      kategori,
      unitCode: null, // job itu level ORDER, bukan per unit (D-006: satu job bisa bawa sebagian unit)
      stageLabel: j.type === "PICKUP" ? "Penjemputan kasur" : "Serah terima di customer",
      photoUrls: j.proofPhotoUrls,
      note: j.driver?.name ? `Oleh driver ${j.driver.name}` : null,
      recordedAt: j.completedAt || j.createdAt,
    });

    const entries = [
      // 1. PENJEMPUTAN — bukti kondisi kasur SAAT DIAMBIL. Ini juga yang
      //    melindungi tim kalau nanti ada sengketa "kasur saya tidak begini
      //    waktu diambil".
      ...jobs
        .filter((j) => j.type === "PICKUP" && j.proofPhotoUrls.length > 0)
        .map((j) => entryJob(j, "PENJEMPUTAN")),

      // 2. PRODUKSI — per tahap, per unit. Hanya tahap yang benar-benar
      //    punya foto yang masuk berkas.
      ...logs
        .filter((l) => l.photoUrls.length > 0)
        .map((l) => ({
          kategori: "PRODUKSI",
          unitCode: l.unit.unitCode,
          stageLabel: l.stage.labelId,
          photoUrls: l.photoUrls,
          note: l.note,
          recordedAt: l.createdAt,
        })),

      // 3. PENGIRIMAN — bukti sudah sampai.
      ...jobs
        .filter((j) => j.type === "DELIVERY" && j.proofPhotoUrls.length > 0)
        .map((j) => entryJob(j, "PENGIRIMAN")),
    ];

    // Tanda tangan customer DIPISAH dari `entries`, bukan dijadikan salah satu
    // foto biasa. Dua alasan: (a) sifatnya OPSIONAL dengan sengaja — penerima
    // tidak selalu ada di tempat (lihat catatan di schema.prisma Job.signatureUrl),
    // jadi ketiadaannya normal dan tidak boleh terlihat seperti dokumentasi
    // yang bolong; (b) mengirimkan balik tanda tangan seseorang ke WhatsApp-nya
    // sendiri tidak ada gunanya — ini bukti internal, bukan bahan forward.
    const ttd = jobs.find((j) => j.type === "DELIVERY" && j.signatureUrl);

    res.json({
      order,
      entries,
      tandaTangan: ttd
        ? { url: ttd.signatureUrl, waktu: ttd.completedAt, driver: ttd.driver?.name || null }
        : null,
      totalPhotos: entries.reduce((n, e) => n + e.photoUrls.length, 0),
    });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/production/work-orders?status=&serviceLine=&q=&stage=
// DAFTAR SELURUH unit, untuk halaman "Work Order" (Production Tahap 1).
//
// BEDA DENGAN /board: papan harian sengaja SEMPIT — cuma unit berstatus
// RECEIVED/IN_PRODUCTION, karena itu yang relevan dikerjakan hari ini.
// Endpoint ini LEBAR: seluruh unit apa pun statusnya, supaya kepala
// produksi bisa menelusuri "kasur si A sekarang di mana" tanpa harus tahu
// unit itu sedang di bengkel atau tidak. Menambah cara MELIHAT, tidak
// mengubah cara papan harian bekerja.
//
// ⚠️ KENYATAAN DATA (diverifikasi langsung di production sebelum endpoint
// ini ditulis): 199 unit ada, TAPI `service_id`, `service_line`, dan
// `current_stage_id` NULL di SELURUHNYA — unit di-backfill dari Order
// (lihat catatan "PHASE 0" di schema.prisma), belum satu pun pernah masuk
// stage engine. Jadi kolom Tahap/Layanan akan kosong sampai unit benar-
// benar diadopsi ke engine (Tahap 2). Itu keadaan sebenarnya, bukan bug —
// UI menampilkannya apa adanya, bukan menebak.
productionRouter.get("/work-orders", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const { status, serviceLine, q } = req.query;
    const where = {
      ...(status && { status }),
      ...(serviceLine && { serviceLine }),
      ...(q?.trim() && {
        OR: [
          { unitCode: { contains: q.trim(), mode: "insensitive" } },
          { order: { orderNumber: { contains: q.trim(), mode: "insensitive" } } },
          { order: { customer: { name: { contains: q.trim(), mode: "insensitive" } } } },
        ],
      }),
    };

    const units = await prisma.unit.findMany({
      where,
      include: {
        currentStage: { select: { id: true, code: true, labelId: true, phase: true, requiresQc: true } },
        service: { select: { id: true, code: true, labelId: true, serviceLine: true } },
        order: {
          select: {
            id: true, orderNumber: true, status: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    });

    // productionStatus level-UNIT (Production Core Slice 1/2) — DUA query
    // batch, lihat catatan di GET /board soal isReworkTarget TIDAK dihitung
    // di endpoint list, dan kenapa ini TIDAK menjadi 1+N seiring jumlah unit.
    const unitIds = units.map((u) => u.id);
    const [lastLogByUnitId, blockerByUnitId] = await Promise.all([
      loadLastCurrentStageLogs(units),
      loadOpenBlockersByUnit(unitIds),
    ]);
    const unitsWithStatus = units.map((u) => {
      const lastLog = lastLogByUnitId[u.id] || null;
      const blocker = blockerByUnitId[u.id] || null;
      const productionStatus = deriveProductionStatus({
        unit: u, lastLog, hasOpenBlocker: !!blocker, currentStageRequiresQc: !!u.currentStage?.requiresQc,
      });
      return {
        ...u, productionStatus,
        productionStatusReason: describeProductionStatus(productionStatus, lastLog, blocker),
        // Kolom "Execution State"/"Elapsed" (Production Core Slice 3P) —
        // SENGAJA dihitung dari `lastLog` yang SUDAH batch-loaded di atas
        // (loadLastCurrentStageLogs, satu query untuk SELURUH daftar), BUKAN
        // query/attempt-reconstruction per unit — itu tetap tugas Unit Detail
        // (`getUnitStatus().execution`, lihat unitStageEngine.js). Yang
        // ditampilkan di sini cuma "sejak kapan segmen SEKARANG dimulai"
        // (currentSegmentStartedAt, null kalau tidak sedang berjalan) —
        // frontend menghitung tickingnya sendiri lewat setInterval (spec
        // "live timer TANPA per-second DB write"), bukan backend yang
        // menghitung ulang tiap request.
        executionState: lastLog ? deriveStageLogStatus(lastLog.action) : "NOT_STARTED",
        currentSegmentStartedAt: EXECUTION_OPEN_WORK_ACTIONS.has(lastLog?.action) ? lastLog.createdAt : null,
      };
    });

    // Hitungan per status untuk seluruh katalog (TIDAK ikut filter status —
    // supaya angka di tab tidak berubah-ubah saat tab dipindah, pola yang
    // sama dengan tab berhitung di halaman lain).
    const statusCounts = await prisma.unit.groupBy({ by: ["status"], _count: { _all: true } });

    res.json({
      units: unitsWithStatus,
      statusCounts: statusCounts.map((s) => ({ status: s.status, count: s._count._all })),
    });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/production/qc-queue — unit yang currentStage-nya gerbang QC
// (requiresQc=true), untuk halaman QC Inspection (Production Tahap 3).
//
// TIDAK ADA tabel/kolom baru untuk "antrean QC" — status per unit DIHITUNG
// dari log TERAKHIR unit+tahap itu, persis logika resolveCurrentTarget di
// unitStageEngine.js (READY = belum di-START, IN_PROGRESS = sedang
// berjalan siap diputuskan, BLOCKED = percobaan QC sebelumnya gagal dan
// belum di-restart). Query kecil (unit di bengkel jumlahnya puluhan, bukan
// ribuan) jadi lookup log per unit di sini aman tanpa index tambahan.
// PERMISSION: UNIT_READ, bukan QC_WRITE (diperbaiki 21 Agustus 2026).
// Endpoint ini MEMBACA daftar unit yang menunggu QC — bukan memutuskan
// hasilnya. Sebelumnya dijaga QC_WRITE, sehingga Kepala Produksi (
// PRODUCTION_LEAD) dapat 403 dan TIDAK BISA melihat unit mana saja yang
// tertahan di gerbang QC — padahal itu antrean di lantai produksinya
// sendiri, dan Uji Berat Badan WAJIB dilewati SETIAP unit (satu-satunya
// tahap requires_qc=true), jadi dia buta terhadap penyebab paling umum
// unit berhenti bergerak.
//
// Pemisahan tugas TIDAK berubah: yang MEMUTUSKAN verdict tetap hanya
// pemegang QC_WRITE lewat POST /units/:id/stages/:stageId/qc (lihat
// routes/units.js). Melihat antrean ≠ meluluskan QC.
productionRouter.get("/qc-queue", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const units = await prisma.unit.findMany({
      where: { currentStage: { requiresQc: true } },
      include: {
        currentStage: { select: { id: true, code: true, labelId: true, requiresPhoto: true } },
        service: { select: { id: true, labelId: true, serviceLine: true } },
        order: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });

    // Ditarik ke loadLastCurrentStageLogs()/loadOpenBlockersByUnit() —
    // sebelumnya query batch log diduplikasi di sini secara manual; sekarang
    // board/work-orders/qc-queue memakai definisi yang SAMA, bukan salinan
    // kedua yang bisa diam-diam menyimpang. DUA query batch, TIDAK
    // bertambah seiring jumlah unit (Production Core Slice 2 — lihat audit
    // performa di komentar routes/production.js bagian atas file).
    const unitIds = units.map((u) => u.id);
    const [lastByUnit, blockerByUnitId] = await Promise.all([
      loadLastCurrentStageLogs(units),
      loadOpenBlockersByUnit(unitIds),
    ]);

    const withState = units.map((u) => {
      const last = lastByUnit[u.id];
      const blocker = blockerByUnitId[u.id] || null;
      const qcState = !last ? "READY" : last.action === "START" ? "IN_PROGRESS" : last.action === "FAIL" ? "BLOCKED" : "READY";
      // sinceAt = sejak kapan unit ini di kondisi qcState SEKARANG (31 Agustus
      // 2026 — laporan owner: halaman ini tidak tampil tanggal sama sekali).
      // Pakai createdAt log terakhir kalau ada (jam persis START/FAIL-nya),
      // fallback ke Unit.createdAt untuk yang belum pernah tersentuh log QC
      // sama sekali (qcState READY sejak lahir).
      //
      // productionStatus (Production Core Slice 1/2) — kosakata KANONIK yang
      // sama dipakai board/work-orders, ditambahkan DI SAMPING qcState lama
      // (dipertahankan apa adanya — halaman ini sudah membacanya). Seluruh
      // unit di sini currentStage.requiresQc=true by construction (lihat
      // `where` di atas), jadi currentStageRequiresQc selalu true.
      const productionStatus = deriveProductionStatus({
        unit: u, lastLog: last || null, hasOpenBlocker: !!blocker, currentStageRequiresQc: true,
      });
      return {
        ...u, qcState, sinceAt: last?.createdAt || u.createdAt,
        productionStatus, productionStatusReason: describeProductionStatus(productionStatus, last || null, blocker),
      };
    });

    res.json({ units: withState });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/production/material-usage?q=&materialId= — Bahan Produksi
// (Tahap 5). Daftar LINTAS ORDER seluruh bahan yang sudah dipakai per
// unit, supaya pengecekan tidak perlu buka Work Order satu-satu. Sumbernya
// stock_movements yang SAMA dengan yang dicatat dari halaman Detail Unit
// (POST /units/:id/materials) — tidak ada agregasi/tabel tersendiri, jadi
// tidak mungkin drift dari angka yang sebenarnya tercatat di ledger.
productionRouter.get("/material-usage", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const { materialId, q } = req.query;
    const where = { unitId: { not: null }, type: { in: ["ISSUE", "RETURN"] } };
    if (materialId) where.materialId = materialId;
    if (q?.trim()) {
      const term = q.trim();
      where.unit = {
        OR: [
          { unitCode: { contains: term, mode: "insensitive" } },
          { order: { orderNumber: { contains: term, mode: "insensitive" } } },
          { order: { customer: { name: { contains: term, mode: "insensitive" } } } },
        ],
      };
    }

    const movements = await prisma.stockMovement.findMany({
      where,
      select: {
        id: true, type: true, qty: true, note: true, createdAt: true,
        material: { select: { id: true, code: true, name: true, unit: true } },
        createdBy: { select: { id: true, name: true } },
        unit: {
          select: {
            id: true, unitCode: true,
            order: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ movements });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/production/report?from=&to= — Laporan Produksi (Tahap 6).
// Throughput, durasi per tahap, tingkat kelulusan QC. Rentang default 30
// hari terakhir kalau from/to tidak dikirim (konsisten dengan Laporan CRM
// lain — sentinel lebar dipakai HANYA kalau salah satu sengaja dikosongkan
// oleh UI, bukan default diam-diam).
//
// SEMUA angka di sini DIHITUNG dari unit_stage_logs/qc_fit_tests, ledger
// yang SAMA dipakai stage engine — tidak ada tabel ringkasan terpisah yang
// bisa drift. Jujur: unit_stage_logs masih 0 baris di production sampai
// unit pertama diadopsi ke engine (lihat unitStatus.js).
productionRouter.get("/report", requirePermission(P.DASHBOARD_READ), async (req, res) => {
  try {
    const { from, to } = req.query;
    const mulai = from ? startOfDayWIB(from) : new Date(Date.now() - 30 * 86_400_000);
    const selesai = to ? endOfDayExclusiveWIB(to) : new Date();

    // Throughput — unit menyelesaikan tahap FINISH per hari (WIB), sinyal
    // "berapa kasur benar-benar rampung", bukan sekadar tahap apapun selesai.
    const throughputRows = await prisma.$queryRaw`
      SELECT to_char(date_trunc('day', l.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS bucket,
             COUNT(*)::int AS count
      FROM unit_stage_logs l
      JOIN routing_stages s ON s.id = l.stage_id
      WHERE l.action = 'COMPLETE' AND s.phase = 'FINISH'
        AND l.created_at >= ${mulai} AND l.created_at < ${selesai}
      GROUP BY 1 ORDER BY 1
    `;

    // Durasi per tahap — rata-rata durationSeconds dari log COMPLETE (satu-
    // satunya action yang mengisi kolom itu, lihat unitStageEngine.js
    // finishStageInternal). Diagregasi atas SELURUH rentang, bukan per hari.
    const durationGroups = await prisma.unitStageLog.groupBy({
      by: ["stageId"],
      where: {
        action: "COMPLETE", durationSeconds: { not: null },
        createdAt: { gte: mulai, lt: selesai },
      },
      _avg: { durationSeconds: true },
      _count: { _all: true },
    });
    const stageIds = durationGroups.map((g) => g.stageId);
    const stages = stageIds.length
      ? await prisma.routingStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, code: true, labelId: true, phase: true } })
      : [];
    const stageById = Object.fromEntries(stages.map((s) => [s.id, s]));
    const stageDuration = durationGroups
      .map((g) => ({
        stage: stageById[g.stageId],
        avgHours: g._avg.durationSeconds != null ? g._avg.durationSeconds / 3600 : null,
        sampleCount: g._count._all,
      }))
      .filter((g) => g.stage)
      .sort((a, b) => (a.stage.phase + a.stage.code).localeCompare(b.stage.phase + b.stage.code));

    // Tingkat kelulusan QC — "lulus" = verdict PAS ATAU override customer
    // (D-005/D-009), persis definisi "lulus" di recordQcFitTest sendiri.
    const [totalQc, passedQc, byVerdictRaw] = await Promise.all([
      prisma.qcFitTest.count({ where: { createdAt: { gte: mulai, lt: selesai } } }),
      prisma.qcFitTest.count({
        where: {
          createdAt: { gte: mulai, lt: selesai },
          OR: [{ verdict: "PAS" }, { customerPreferenceOverride: { not: null } }],
        },
      }),
      prisma.qcFitTest.groupBy({
        by: ["verdict"],
        where: { createdAt: { gte: mulai, lt: selesai } },
        _count: { _all: true },
      }),
    ]);

    res.json({
      range: { from: mulai.toISOString(), to: selesai.toISOString() },
      throughput: throughputRows,
      stageDuration,
      qc: {
        total: totalQc,
        passed: passedQc,
        passRate: totalQc > 0 ? passedQc / totalQc : null,
        byVerdict: byVerdictRaw.map((v) => ({ verdict: v.verdict, count: v._count._all })),
      },
    });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/production/command-center?date=YYYY-MM-DD — Production Core
// Slice 2E. SATU endpoint teragregasi (bukan beberapa request kecil dari
// frontend) untuk "apa yang terjadi, kenapa, apa yang perlu diperhatikan,
// apa selanjutnya" — menggantikan WorkspaceHero yang sebelumnya cuma
// menghitung target hari ini di pages/Bengkel.jsx.
//
// PERFORMA (audit STEP 0, Production Core Slice 2): endpoint ini memuat
// SELURUH unit yang secara produksi masih berjalan (non-terminal) SATU
// KALI, lalu men-derive productionStatus/overdue/at-risk/exception murni
// di memori (fungsi MURNI dari lib/domain/productionExceptions.js) — TIDAK
// ADA query di dalam loop per-unit. Total query TETAP walau jumlah unit
// bertambah dari puluhan ke ratusan:
//   1. unit.findMany (unit non-terminal + relasi order/currentStage)
//   2. loadOpenBlockersByUnit (batch)
//   3. loadLastCurrentStageLogs (batch)
//   4. loadLatestQcFitTestByUnit (batch)
//   5. productionTarget.findMany (target hari ini)
//   6. movedUnitIdsForDate (batch, HANYA kalau ada target)
// Lihat tests/queryBatching.test.js untuk bukti tertulis jumlah panggilan
// batch TIDAK bertambah seiring N.
productionRouter.get("/command-center", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const now = new Date();
    const targetDate = resolveTargetDate(req.query.date);

    // Unit yang SECARA PRODUKSI masih berjalan — lebih LEBAR dari IN_WORKSHOP
    // (RECEIVED/IN_PRODUCTION): unit yang masih AWAITING_PICKUP/IN_TRANSIT_IN
    // tetap bisa overdue (janjinya sudah lewat sebelum sempat diambil), jadi
    // overdue/at-risk dihitung atas populasi ini, BUKAN cuma yang sudah masuk
    // bengkel — lihat isProductionEligible() di lib/domain/productionExceptions.js.
    const units = await prisma.unit.findMany({
      where: { status: { notIn: [...PRODUCTION_COMPLETE_UNIT_STATUSES, "CANCELLED"] } },
      select: {
        id: true, unitCode: true, status: true, priority: true, productionDueAt: true,
        serviceId: true, currentStageId: true, orderId: true,
        currentStage: { select: { phase: true, requiresQc: true } },
        order: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } },
      },
    });
    const unitIds = units.map((u) => u.id);

    const [blockerByUnitId, lastLogByUnitId, latestQcByUnitId, targetRows] = await Promise.all([
      loadOpenBlockersByUnit(unitIds),
      loadLastCurrentStageLogs(units),
      loadLatestQcFitTestByUnit(unitIds),
      prisma.productionTarget.findMany({ where: { targetDate }, select: { unitId: true } }),
    ]);
    const targetUnitIds = targetRows.map((t) => t.unitId);
    const movedToday = await movedUnitIdsForDate(targetUnitIds, targetDate);

    const reworkUnitIds = new Set();
    let unitsWithDueDate = 0;
    let inProgressCount = 0, waitingQcCount = 0, queuedCount = 0, blockedCount = 0, overdueCount = 0, severeOverdueCount = 0, atRiskCount = 0;
    // pausedCount (Production Core Slice 3Q) — SEBELUM Slice 3, action PAUSE
    // tidak pernah ditulis, jadi status PAUSED mustahil muncul di sini.
    // SEKARANG bisa, dan HARUS dihitung eksplisit — tanpa ini, unit yang
    // sedang dijeda diam-diam tidak masuk bucket manapun (bukan queued, bukan
    // inProgress, bukan blocked), "hilang" dari ringkasan Command Center.
    // SENGAJA cuma hitungan (bukan Touch/Paused Time KPI apa pun — itu di
    // luar lingkup Slice 3, lihat lib/domain/stageExecution.js).
    let pausedCount = 0;

    for (const unit of units) {
      const blocker = blockerByUnitId[unit.id] || null;
      const lastLog = lastLogByUnitId[unit.id] || null;
      const latestQc = latestQcByUnitId[unit.id] || null;
      const rework = isReworkTarget({ latestQc, currentStagePhase: unit.currentStage?.phase });
      if (rework) reworkUnitIds.add(unit.id);

      const status = deriveProductionStatus({
        unit, lastLog, hasOpenBlocker: !!blocker,
        currentStageRequiresQc: !!unit.currentStage?.requiresQc, isReworkTarget: rework,
      });

      if (status === "IN_PROGRESS") inProgressCount++;
      else if (status === "WAITING_QC") waitingQcCount++;
      else if (status === "QUEUED" || status === "NOT_STARTED") queuedCount++;
      else if (status === "PAUSED") pausedCount++;
      if (blocker) blockedCount++;

      if (unit.productionDueAt) unitsWithDueDate++;
      const overdue = deriveOverdue({ unit, now });
      if (overdue.isOverdue) {
        overdueCount++;
        if (overdue.overdueMinutes >= RISK_CONFIG.SEVERE_OVERDUE_HOURS * 60) severeOverdueCount++;
      } else if (!blocker) {
        // atRisk TIDAK dihitung untuk unit yang sudah blocked — konsisten
        // dengan buildExceptionsForUnit() (hindari unit yang sama dihitung
        // dua kali di dua metrik berbeda untuk kondisi yang sama).
        const risk = deriveAtRisk({ unit, now, hasOpenBlocker: false, overdue });
        if (risk.isAtRisk) atRiskCount++;
      }
    }

    const unscheduledCount = units.filter(
      (u) => IN_WORKSHOP.includes(u.status) && !targetUnitIds.includes(u.id)
    ).length;

    const exceptions = buildExceptions({ units, blockersByUnitId: blockerByUnitId, reworkUnitIds, now })
      .slice(0, RISK_CONFIG.MAX_EXCEPTIONS_RETURNED);

    const workspaceHealth = deriveWorkspaceHealth({
      blockedCount, overdueCount, atRiskCount, severeOverdueCount,
    });

    res.json({
      date: targetDate.toISOString().slice(0, 10),
      summary: {
        unitsInWorkshop: units.filter((u) => IN_WORKSHOP.includes(u.status)).length,
        // targetToday/completedToday: SELALU angka nyata dari production_targets
        // (planning system yang sudah ada sejak D-014) — 0 kalau memang belum
        // ada target hari ini diset, BUKAN "unavailable". Lihat unitsWithDueDate
        // di bawah untuk metrik yang MEMANG bisa genuinely tidak tersedia.
        targetToday: targetUnitIds.length,
        completedToday: movedToday.size,
        inProgress: inProgressCount + waitingQcCount,
        queued: queuedCount,
        paused: pausedCount,
        blocked: blockedCount,
        atRisk: atRiskCount,
        overdue: overdueCount,
        // Dasar perhitungan atRisk/overdue — 0 di sini berarti BELUM ADA unit
        // yang punya productionDueAt sama sekali, jadi atRisk/overdue di atas
        // bukan "0 aman", tapi "belum bisa dihitung". Frontend WAJIB
        // membedakan dua keadaan ini (lihat pages/Bengkel.jsx).
        unitsWithDueDate,
      },
      workspaceHealth,
      exceptions,
      flow: {
        queued: queuedCount,
        inProgress: inProgressCount,
        paused: pausedCount,
        waitingQc: waitingQcCount,
        rework: reworkUnitIds.size,
        completed: movedToday.size,
      },
      unscheduledUnits: { count: unscheduledCount },
    });
  } catch (err) {
    handleErr(err, res);
  }
});
