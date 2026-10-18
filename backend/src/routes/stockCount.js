// Stock Count / Stock Opname — Warehouse Tahap 5.
//
// v1 POST /inventory/movements/adjustment (satu langkah) DITUTUP untuk semua peran
// (Okt 2026, pemisahan tugas). Stock Count = dokumen untuk sesi hitung terjadwal,
// banyak item sekaligus, dengan blind count opsional; selisihnya hanya diselesaikan
// penyetuju yang bukan pembuat/penugas/pengisi hitungan. Lihat catatan panjang di schema.prisma di
// atas model StockCount.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { postStockMovement, lockRowForUpdate } from "../services/inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { wajibPenyetujuPenyesuaian, wajibBukanPihakPengaju } from "../services/inventorySegregation.js";
import { muatPergerakanSesi, selisihTersesuaikan, AKSI_TANDA_PERGERAKAN, AKSI_TANDA_DIRESET } from "../services/pergerakanSesiHitung.js";
import { lockMaterialBalance } from "../services/inventoryLedger.js";
import { muatIdentitasHitung, AKSI_PERIKSA_HITUNGAN } from "../services/identitasHitung.js";
import { tampilanOpname, untukIzin } from "../services/dokumenGudangLain.js";
import { jejakDokumenGudang } from "../services/dokumenGudang.js";

// Penanda pelaku di activity_events (eventType DOCUMENT_EDITED) — dipakai complete untuk memisahkan pengisi/penyerah hitungan dari penyetuju.
const AKSI_ISI_HITUNGAN = "HASIL_HITUNG_DIISI";
const AKSI_SERAHKAN_HITUNGAN = "HITUNGAN_DISERAHKAN";

export const stockCountRouter = express.Router();
stockCountRouter.use(requireAuth);

class CountError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (typeof err.statusCode === "number") {
    const kode = typeof err.code === "string" && /^[A-Z][A-Z0-9_]{2,40}$/.test(err.code) ? { code: err.code } : {};
    return res.status(err.statusCode).json({ error: err.message, ...kode });
  }
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor count sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Stock count error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}

const COUNT_TYPES = ["CYCLE_COUNT", "FULL_STOCK_OPNAME"];
const COUNT_METHODS = ["BY_ITEM", "BY_CATEGORY", "BY_LOCATION", "BY_BATCH", "RANDOM_SAMPLING", "FULL_WAREHOUSE"];

const countInclude = {
  lines: { include: { material: { select: { id: true, code: true, name: true, unit: true } } } },
  assignedTo: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

function generateCountCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `CC-${dd}${mm}${yy}`;
}

stockCountRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { status, countType } = req.query;
    const counts = await prisma.stockCount.findMany({
      where: { ...(status && { status }), ...(countType && { countType }) },
      include: countInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    res.json({ counts: counts.map((c) => ({ ...c, tampilan: tampilanOpname(c) })) });
  } catch (err) {
    handleErr(err, res);
  }
});

stockCountRouter.get("/:id", requirePermission(P.INVENTORY_READ), wajibUuid(), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id }, include: countInclude });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    // Snapshot saldo (systemQty per baris) + waktu mulai direkam saat Start; pergerakan ledger sesudahnya ditampilkan agar penghitung menandainya.
    const { pergerakan } = await muatPergerakanSesi(prisma, count);
    const identitas = await muatIdentitasHitung(prisma, count);
    // UX Tahap 2: status/aksi dalam bahasa petugas; aturan pemisahan tugas TIDAK diubah, hanya dijelaskan (izin.* memberi tahu layar mengapa suatu tombol tidak ada).
    const tulis = hasPermission(req.user, P.INVENTORY_WRITE); const bisaMenyetujuiSelisih = hasPermission(req.user, P.INVENTORY_ADJUSTMENT_APPROVE);
    const adaSelisih = count.lines.some((l) => l.systemQty != null && l.countedQty != null && Number(l.countedQty) !== Number(l.systemQty));
    const bisaPeriksa = !(req.user.id === count.assignedToId || identitas.penghitung.some((p) => p.id === req.user.id));
    res.json({
      ...count,
      identitas,
      sesi: { snapshotPada: count.startedAt, belumDitandai: pergerakan.filter((p) => p.tanda === null).length },
      pergerakanSesi: pergerakan,
      tampilan: untukIzin(tampilanOpname(count, { adaSelisih, bisaMenyetujuiSelisih, bisaPeriksa }), tulis), izin: { tulis, bisaMenyetujuiSelisih, bisaPeriksa }, adaSelisih,
      jejak: await jejakDokumenGudang(prisma, { entityType: ENTITY_TYPES.STOCK_COUNT, id: count.id, dibuatOleh: count.createdBy?.name ?? null, dibuatPada: count.createdAt, jenis: "OPNAME" }),
    });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts
// { countType, countMethod, scheduledDate?, blindCount?, notes?, assignedToId?, lines: [{materialId}] }
stockCountRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { countType, countMethod, scheduledDate, blindCount, notes, assignedToId, lines } = req.body;
    if (!COUNT_TYPES.includes(countType)) throw new CountError("Count type tidak valid");
    if (!COUNT_METHODS.includes(countMethod)) throw new CountError("Count method tidak valid");
    if (!Array.isArray(lines) || lines.length === 0) throw new CountError("Minimal satu item wajib diisi");
    for (const l of lines) {
      if (!l.materialId) throw new CountError("Setiap baris wajib memilih item");
    }

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.stockCount.count({ where: { createdAt: { gte: startOfDay } } });
    const countNumber = `${generateCountCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const count = await prisma.stockCount.create({
      data: {
        countNumber, countType, countMethod,
        scheduledDate: scheduledDate ? new Date(`${scheduledDate}T00:00:00.000Z`) : null,
        blindCount: blindCount !== undefined ? !!blindCount : true,
        notes: notes || null,
        assignedToId: assignedToId || null,
        createdById: req.user.id,
        lines: { create: lines.map((l) => ({ materialId: l.materialId })) },
      },
      include: countInclude,
    });
    res.status(201).json(count);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/stock-counts/:id — header saja, TIDAK termasuk status
// (status berjalan lewat /start, /submit, /recount, /complete — masing-masing
// punya efek samping menulis ledger atau snapshot yang tidak cocok dengan
// PATCH generik satu-status-maju seperti dokumen lain).
stockCountRouter.patch("/:id", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const existing = await prisma.stockCount.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      throw new CountError(`Count berstatus ${existing.status} tidak bisa diubah lagi`);
    }
    const { scheduledDate, blindCount, notes, assignedToId } = req.body;
    const data = {};
    if (scheduledDate !== undefined) data.scheduledDate = scheduledDate ? new Date(`${scheduledDate}T00:00:00.000Z`) : null;
    if (blindCount !== undefined) data.blindCount = !!blindCount;
    if (notes !== undefined) data.notes = notes || null;
    if (assignedToId !== undefined) data.assignedToId = assignedToId || null;

    const count = await prisma.stockCount.update({ where: { id: req.params.id }, data, include: countInclude });
    res.json(count);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts/:id/start
// SCHEDULED → IN_PROGRESS. Snapshot systemQty SEKALI dari saldo ledger
// BERJALAN — baseline blind count, tidak dihitung ulang setelah ini.
stockCountRouter.post("/:id/start", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const preCheck = await prisma.stockCount.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Stock count tidak ditemukan" });

    const result = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_counts", preCheck.id);
      const count = await tx.stockCount.findUnique({ where: { id: preCheck.id }, include: countInclude });
      if (count.status !== "SCHEDULED") throw new CountError("Hanya count berstatus Scheduled yang bisa dimulai");

      // Kunci material (urut id) SEBELUM membaca saldo: pergerakan yang sedang diposting selesai dulu (masuk snapshot), yang menyusul menunggu sampai Start commit
      // sehingga bercap waktu SESUDAH startedAt (masuk daftar pergerakan sesi). Tanpa kunci, pergerakan di sela baca-saldo dan startedAt hilang dari keduanya.
      for (const id of [...new Set(count.lines.map((l) => l.materialId))].sort()) await lockMaterialBalance(tx, id);
      for (const line of count.lines) {
        const [{ balance }] = await tx.$queryRaw`
          SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${line.materialId}::uuid
        `;
        await tx.stockCountLine.update({ where: { id: line.id }, data: { systemQty: balance } });
      }
      return tx.stockCount.update({
        where: { id: count.id },
        data: { status: "IN_PROGRESS", startedAt: new Date() },
        include: countInclude,
      });
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/stock-counts/:id/lines/:lineId
// Isi hasil hitung fisik (countedQty) selama IN_PROGRESS, atau alasan
// selisih (reason) selama IN_PROGRESS/WAITING_REVIEW.
stockCountRouter.patch("/:id/lines/:lineId", requirePermission(P.INVENTORY_WRITE), wajibUuid("id", "lineId"), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id } });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (!["IN_PROGRESS", "WAITING_REVIEW"].includes(count.status)) {
      throw new CountError(`Count berstatus ${count.status} tidak bisa diisi hasil hitungnya`);
    }
    const line = await prisma.stockCountLine.findFirst({ where: { id: req.params.lineId, stockCountId: count.id } });
    if (!line) return res.status(404).json({ error: "Baris item tidak ditemukan" });

    const { countedQty, reason, notes } = req.body;
    const toNum = (v) => (v === undefined ? undefined : v === "" || v === null ? null : Number(v));
    const qtyBerubah = countedQty !== undefined && toNum(countedQty) !== (line.countedQty == null ? null : Number(line.countedQty));
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.stockCountLine.update({
        where: { id: line.id },
        data: {
          ...(countedQty !== undefined && { countedQty: toNum(countedQty) }),
          ...(reason !== undefined && { reason: reason || null }),
          ...(notes !== undefined && { notes: notes || null }),
        },
        include: { material: { select: { id: true, code: true, name: true, unit: true } } },
      });
      // Pelaku pengisi hasil hitung dicatat (tabel baris tak punya kolom pelaku): penyelesai selisih tidak boleh termasuk di dalamnya.
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: { aksi: AKSI_ISI_HITUNGAN, countNumber: count.countNumber, lineId: line.id, ...(countedQty !== undefined && { countedQtyBaru: toNum(countedQty) }) },
      });
      if (qtyBerubah) {
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
          metadata: { aksi: AKSI_TANDA_DIRESET, countNumber: count.countNumber, materialId: line.materialId, alasan: "hasil hitung diubah — tanda pergerakan material ini harus diulang" },
        });
      }
      return u;
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts/:id/submit
// IN_PROGRESS → WAITING_REVIEW. Wajib SEMUA baris sudah punya countedQty —
// count yang setengah jadi tidak bisa masuk review.
stockCountRouter.post("/:id/submit", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id }, include: countInclude });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (count.status !== "IN_PROGRESS") throw new CountError("Hanya count berstatus In Progress yang bisa disubmit");
    const belumDihitung = count.lines.filter((l) => l.countedQty == null);
    if (belumDihitung.length > 0) {
      throw new CountError(`${belumDihitung.length} item belum diisi hasil hitungnya`);
    }
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.stockCount.update({
        where: { id: count.id },
        data: { status: "WAITING_REVIEW", submittedAt: new Date() },
        include: countInclude,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: { aksi: AKSI_SERAHKAN_HITUNGAN, countNumber: count.countNumber },
      });
      return u;
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts/:id/recount
// WAITING_REVIEW → IN_PROGRESS. systemQty TIDAK di-snapshot ulang — baseline
// tetap dari Start Count pertama.
stockCountRouter.post("/:id/recount", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id } });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (count.status !== "WAITING_REVIEW") throw new CountError("Hanya count berstatus Waiting Review yang bisa dihitung ulang");
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.stockCount.update({ where: { id: count.id }, data: { status: "IN_PROGRESS" }, include: countInclude });
      // Hitung ulang = fisik baru; tanda lama bisa basi (fisik baru mungkin sudah memuat pergerakan yang tadinya "belum") → semua tanda direset.
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: { aksi: AKSI_TANDA_DIRESET, countNumber: count.countNumber, materialId: null, alasan: "hitung ulang" },
      });
      return u;
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts/:id/complete
// SATU-SATUNYA jalan sebuah Stock Count menjadi baris ledger nyata. Wajib
// WAITING_REVIEW. Untuk tiap baris dengan countedQty ≠ systemQty, WAJIB
// reason terisi, lalu tulis SATU StockMovement ADJUSTMENT (qty = selisih).
// Baris tanpa selisih dilewati — tidak ada yang perlu disesuaikan.
stockCountRouter.post("/:id/complete", requireAnyPermission(P.INVENTORY_WRITE, P.INVENTORY_ADJUSTMENT_APPROVE), wajibUuid(), async (req, res) => {
  try {
    const preCheck = await prisma.stockCount.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Stock count tidak ditemukan" });

    const result = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_counts", preCheck.id);
      const count = await tx.stockCount.findUnique({ where: { id: preCheck.id }, include: countInclude });
      if (count.status !== "WAITING_REVIEW") throw new CountError("Hanya count berstatus Waiting Review yang bisa diselesaikan");

      // Kunci material (urut id) SEBELUM membaca pergerakan sesi, supaya tidak ada pergerakan menyelip antara pemeriksaan dan penulisan.
      for (const id of [...new Set(count.lines.map((l) => l.materialId))].sort()) await lockMaterialBalance(tx, id);
      const { pergerakan } = await muatPergerakanSesi(tx, count, { sampai: new Date() });
      const { baris: hasilBaris, belumDitandai } = selisihTersesuaikan(count.lines, pergerakan);
      if (belumDitandai.length > 0) {
        const e = new CountError(`${belumDitandai.length} pergerakan selama sesi hitung belum ditandai (sudah/belum masuk hitungan fisik). Tandai satu per satu — sistem tidak menebak.`, 409);
        e.code = "PERGERAKAN_SESI_BELUM_DITANDAI";
        throw e;
      }
      // Opname Penuh (cutover): hasil hitung WAJIB diperiksa akun lain, dan pemeriksa tidak boleh menjadi penyetuju. Cycle Count rutin tidak dikenai syarat ini.
      if (count.countType === "FULL_STOCK_OPNAME") {
        const { pemeriksaIds } = await muatIdentitasHitung(tx, count);
        if (pemeriksaIds.length === 0) {
          const e = new CountError("Opname Penuh belum diperiksa. Satu petugas lain (bukan penghitung) harus memeriksa hasil hitung lewat tombol \"Saya memeriksa hitungan ini\" setelah hitungan diserahkan; pemeriksaan batal bila angka diubah.", 409);
          e.code = "PEMERIKSA_BELUM_ADA";
          throw e;
        }
        wajibBukanPihakPengaju(req.user, pemeriksaIds, { label: "pemeriksa hitungan" });
      }
      const selisihPerBaris = new Map(hasilBaris.map((h) => [h.lineId, h]));
      const berselisih = count.lines.filter((l) => selisihPerBaris.get(l.id).berselisih);
      for (const l of berselisih) {
        if (!l.reason?.trim()) throw new CountError(`Alasan wajib diisi untuk selisih pada ${l.material.code}`);
      }
      // Pemisahan tugas: selisih = penulisan ADJUSTMENT ke ledger → penyetuju khusus, bukan pembuat/penugas hitungan.
      if (berselisih.length === 0 && !hasPermission(req.user, P.INVENTORY_WRITE)) {
        throw new CountError("Hitungan tanpa selisih diselesaikan oleh pemegang akses gudang", 403);
      }
      if (berselisih.length > 0) {
        wajibPenyetujuPenyesuaian(req.user);
        const pelakuHitung = await tx.activityEvent.findMany({
          where: { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED },
          select: { actorId: true, metadata: true },
        });
        const pengisi = pelakuHitung.filter((e) => [AKSI_ISI_HITUNGAN, AKSI_SERAHKAN_HITUNGAN, AKSI_TANDA_PERGERAKAN].includes(e.metadata?.aksi)).map((e) => e.actorId);
        wajibBukanPihakPengaju(req.user, [count.createdById, count.assignedToId, ...pengisi], { label: "pembuat/penugas/pengisi hitungan" });
      }

      for (const line of berselisih) {
        const variance = selisihPerBaris.get(line.id).selisih;
        await postStockMovement(tx, {
          materialId: line.materialId, type: "ADJUSTMENT", qty: variance,
          reason: line.reason.trim(), note: `Stock Count ${count.countNumber}`,
          stockCountId: count.id, createdById: req.user.id,
        });
      }
      const updated = await tx.stockCount.update({
        where: { id: count.id },
        data: { status: "COMPLETED", reviewedById: req.user.id, completedAt: new Date() },
        include: countInclude,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id,
        eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: { countNumber: count.countNumber, varianceLines: berselisih.length, pergerakanSesi: pergerakan.length },
      });
      return updated;
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts/:id/periksa { catatan? }
// Petugas LAIN (bukan penghitung/penugas) menyatakan telah memeriksa hasil hitung yang sudah diserahkan. Identitas = akun yang login. Batal otomatis bila angka diubah/hitung ulang.
stockCountRouter.post("/:id/periksa", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const catatan = typeof req.body?.catatan === "string" ? req.body.catatan.trim().slice(0, 500) : "";
    const result = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_counts", req.params.id);
      const count = await tx.stockCount.findUnique({ where: { id: req.params.id }, include: countInclude });
      if (!count) throw new CountError("Stock count tidak ditemukan", 404);
      if (count.status !== "WAITING_REVIEW") throw new CountError("Hanya hitungan yang sudah diserahkan (Waiting Review) yang bisa diperiksa");
      if (count.lines.some((l) => l.countedQty == null)) throw new CountError("Masih ada item yang belum diisi hasil hitungnya");
      const sebelum = await muatIdentitasHitung(tx, count);
      if (req.user.id === count.assignedToId || sebelum.penghitung.some((p) => p.id === req.user.id)) {
        const e = new CountError("Anda adalah penghitung/penugas hitungan ini — pemeriksa harus petugas lain", 403);
        e.code = "PEMERIKSA_SAMA_DENGAN_PENGHITUNG";
        throw e;
      }
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: { aksi: AKSI_PERIKSA_HITUNGAN, countNumber: count.countNumber, ...(catatan && { catatan }) },
      });
      return muatIdentitasHitung(tx, count);
    });
    res.json({ identitas: result });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts/:id/pergerakan/:movementId/tanda { tercermin: true|false }
// Penghitung menyatakan apakah pergerakan yang terjadi SELAMA sesi sudah ikut terhitung di fisik. Wajib boolean eksplisit — tidak ada nilai bawaan.
stockCountRouter.post("/:id/pergerakan/:movementId/tanda", requirePermission(P.INVENTORY_WRITE), wajibUuid("id", "movementId"), async (req, res) => {
  try {
    if (typeof req.body?.tercermin !== "boolean") throw new CountError("Tanda wajib eksplisit: tercermin = true (sudah masuk hitungan fisik) atau false (belum)");
    const result = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_counts", req.params.id);
      const count = await tx.stockCount.findUnique({ where: { id: req.params.id }, include: countInclude });
      if (!count) throw new CountError("Stock count tidak ditemukan", 404);
      if (!["IN_PROGRESS", "WAITING_REVIEW"].includes(count.status)) throw new CountError(`Count berstatus ${count.status} tidak bisa menandai pergerakan`);
      const { pergerakan } = await muatPergerakanSesi(tx, count, { sampai: new Date() });
      if (!pergerakan.some((p) => p.id === req.params.movementId)) throw new CountError("Pergerakan itu bukan bagian dari sesi hitung ini", 404);
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: { aksi: AKSI_TANDA_PERGERAKAN, countNumber: count.countNumber, movementId: req.params.movementId, tercermin: req.body.tercermin },
      });
      return (await muatPergerakanSesi(tx, count, { sampai: new Date() })).pergerakan;
    });
    res.json({ pergerakanSesi: result, belumDitandai: result.filter((p) => p.tanda === null).length });
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/stock-counts/:id/cancel { reason }
stockCountRouter.patch("/:id/cancel", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id } });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (count.status === "COMPLETED" || count.status === "CANCELLED") {
      throw new CountError(`Count berstatus ${count.status} tidak bisa dibatalkan`);
    }
    const { reason } = req.body;
    if (!reason?.trim()) throw new CountError("Alasan pembatalan wajib diisi");
    const updated = await prisma.stockCount.update({
      where: { id: count.id },
      data: { status: "CANCELLED", notes: [count.notes, `Dibatalkan: ${reason.trim()}`].filter(Boolean).join(" — ") },
      include: countInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});
