// Stock Adjustment (review-gated) — Warehouse Tahap 6.
//
// Beda dengan POST /inventory/movements/adjustment (satu langkah, langsung
// tertulis — DITUTUP Okt 2026 untuk semua peran, menjawab 409): ini WAJIB
// approval orang lain (pengaju != penyetuju) sebelum ledger tersentuh. Lihat
// catatan panjang di schema.prisma di atas model StockAdjustmentRequest —
// SEMUA request wajib approval tanpa kecuali (tidak ada kolom harga untuk
// membedakan "tinggi/rendah nilai" secara jujur).

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { postStockMovement, lockRowForUpdate } from "../services/inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { tampilanPenyesuaian, untukIzin } from "../services/dokumenGudangLain.js";
import { jejakDokumenGudang } from "../services/dokumenGudang.js";
import { catatPerubahanDraf } from "../lib/jejakPerubahan.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { wajibPenyetujuPenyesuaian, wajibBukanPihakPengaju } from "../services/inventorySegregation.js";
import { ASAL_KOREKSI_TIPE, validasiAsalKoreksi, ringkasAsalKoreksi } from "../services/asalKoreksiSaldo.js";
import { KoreksiSaldoError, keadaanBahan, pratinjauKoreksi, ajukanKoreksi, riwayatKoreksiBahan, wajibSaldoBelumBergeser, konteksKoreksiRequest } from "../services/koreksiSaldoBahan.js";

export const stockAdjustmentRouter = express.Router();
stockAdjustmentRouter.use(requireAuth);

class AdjustmentError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof KoreksiSaldoError) return res.status(err.statusCode).json({ error: err.message, code: err.code, ...(err.detail ? { detail: err.detail } : {}) });
  if (typeof err.statusCode === "number") return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor adjustment sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Stock adjustment error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}

const ADJUSTMENT_TYPES = [
  "POSITIVE", "NEGATIVE", "COUNT_DIFFERENCE", "DAMAGE", "EXPIRY", "DATA_CORRECTION", "CONVERSION", "OTHER",
];
const FORWARD_FLOW = ["DRAFT", "WAITING_APPROVAL", "APPROVED"];

const requestInclude = {
  material: { select: { id: true, code: true, name: true, unit: true } },
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
};

function generateCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `ADJ-${dd}${mm}${yy}`;
}

stockAdjustmentRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { status, adjustmentType } = req.query;
    const requests = await prisma.stockAdjustmentRequest.findMany({
      where: { ...(status && { status }), ...(adjustmentType && { adjustmentType }) },
      include: requestInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    const bisaSetujui = hasPermission(req.user, P.INVENTORY_ADJUSTMENT_APPROVE);
    res.json({ requests: requests.map((r) => ({ ...r, tampilan: tampilanPenyesuaian(r, { bisaSetujui, pemohonSama: r.requestedById === req.user.id }) })) });
  } catch (err) {
    handleErr(err, res);
  }
});

// KOREKSI SALDO PER BAHAN (Stok & Lokasi): pratinjau baca-saja + pengajuan ke jalur resmi Penyesuaian Stok. Tidak menulis ledger; persetujuan orang lain + posting tetap di rute /:id di bawah.
//   GET  /koreksi-saldo/bahan/:materialId  (inventory:read)  keadaan saldo, izin, riwayat koreksi bahan
//   POST /koreksi-saldo/pratinjau          (inventory:read)  { materialId, jumlahFisik } -> saldo sebelum, jumlah baru, selisih, dampak stok, izin
//   POST /koreksi-saldo/ajukan             (inventory:write) { materialId, jumlahFisik, saldoDilihat, alasan, catatan?, originType?, originId? } + header Idempotency-Key
stockAdjustmentRouter.get("/koreksi-saldo/bahan/:materialId", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try { res.json({ ...(await keadaanBahan(prisma, req.user, req.params.materialId)), riwayat: await riwayatKoreksiBahan(prisma, req.params.materialId) }); } catch (err) { handleErr(err, res); }
});
stockAdjustmentRouter.post("/koreksi-saldo/pratinjau", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try { res.json(await pratinjauKoreksi(prisma, req.user, req.body ?? {})); } catch (err) { handleErr(err, res); }
});
stockAdjustmentRouter.post("/koreksi-saldo/ajukan", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try { const h = await ajukanKoreksi(prisma, req.user, req.body ?? {}, req.get("Idempotency-Key")); res.status(h.ulang ? 200 : 201).json(h); } catch (err) { handleErr(err, res); }
});

stockAdjustmentRouter.get("/:id", requirePermission(P.INVENTORY_READ), wajibUuid(), async (req, res) => {
  try {
    const request = await prisma.stockAdjustmentRequest.findUnique({ where: { id: req.params.id }, include: requestInclude });
    if (!request) return res.status(404).json({ error: "Adjustment request tidak ditemukan" });
    const tulis = hasPermission(req.user, P.INVENTORY_WRITE); const bisaSetujui = hasPermission(req.user, P.INVENTORY_ADJUSTMENT_APPROVE); const pemohonSama = request.requestedById === req.user.id;
    // Penyetuju murni (mis. Finance) tidak punya izin tulis tetapi boleh menyetujui: hanya aksi SETUJUI yang ditawarkan kepadanya.
    const t = tampilanPenyesuaian(request, { bisaSetujui, pemohonSama });
    res.json({ ...request, koreksiSaldo: await konteksKoreksiRequest(prisma, request.id, request.status), asal: await ringkasAsalKoreksi(prisma, request), tampilan: tulis ? t : { ...t, aksi: t.aksi.filter((a) => a.kode === "SETUJUI") }, izin: { tulis, bisaSetujui, pemohonSama }, jejak: await jejakDokumenGudang(prisma, { entityType: ENTITY_TYPES.STOCK_ADJUSTMENT, id: request.id, dibuatOleh: request.requestedBy?.name ?? null, dibuatPada: request.createdAt, jenis: "ADJ" }) });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/adjustments { materialId, adjustmentType, adjustmentQty, reason, notes? }
// beforeQty DISNAPSHOT dari saldo ledger BERJALAN saat request dibuat.
stockAdjustmentRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { materialId, adjustmentType, adjustmentQty, saldoBaru, reason, notes, originType, originId } = req.body;
    if (!materialId) throw new AdjustmentError("Item wajib dipilih");
    if (!ADJUSTMENT_TYPES.includes(adjustmentType)) throw new AdjustmentError("Adjustment type tidak valid");
    if (!reason?.trim()) throw new AdjustmentError("Alasan wajib diisi");
    // ASAL koreksi (catatan/pemakaian/pergerakan yang memicu): keduanya terisi atau keduanya kosong; hanya penelusuran, tidak mengubah alur persetujuan.
    if (Boolean(originType) !== Boolean(originId)) throw new AdjustmentError("originType dan originId harus diisi bersamaan");
    if (originType && !ASAL_KOREKSI_TIPE.includes(originType)) throw new AdjustmentError("originType tidak dikenal");
    if (originType) await validasiAsalKoreksi(prisma, { originType, originId, materialId }); // asal harus ada dan menyangkut bahan yang sama (AsalKoreksiError membawa statusCode)

    const [{ balance }] = await prisma.$queryRaw`
      SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${materialId}::uuid
    `;
    // Koreksi saldo "langsung": cukup isi saldo yang BENAR (saldoBaru); selisihnya dihitung dari saldo ledger SAAT INI. Saldo tidak pernah ditimpa — tetap permintaan penyesuaian yang wajib disetujui orang lain.
    const qty = (adjustmentQty === undefined || adjustmentQty === null || adjustmentQty === "") && saldoBaru !== undefined ? Math.round((Number(saldoBaru) - balance) * 10000) / 10000 : Number(adjustmentQty);
    if (saldoBaru !== undefined && (adjustmentQty === undefined || adjustmentQty === null || adjustmentQty === "")) {
      if (!Number.isFinite(Number(saldoBaru)) || Number(saldoBaru) < 0) throw new AdjustmentError("Saldo yang benar harus angka 0 atau lebih");
      if (qty === 0) throw new AdjustmentError("Saldo bahan di sistem sudah sama dengan saldo yang diisi; tidak ada selisih untuk dikoreksi", 409);
    }
    if (!Number.isFinite(qty) || qty === 0) throw new AdjustmentError("Adjustment quantity wajib diisi dan tidak boleh nol");

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.stockAdjustmentRequest.count({ where: { createdAt: { gte: startOfDay } } });
    const adjustmentNumber = `${generateCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const request = await prisma.stockAdjustmentRequest.create({
      data: {
        adjustmentNumber, adjustmentType, materialId, beforeQty: balance, adjustmentQty: qty,
        reason: reason.trim(), notes: notes || null, requestedById: req.user.id, originType: originType || null, originId: originId ? String(originId) : null,
      },
      include: requestInclude,
    });
    res.status(201).json(request);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/adjustments/:id — transisi DRAFT → WAITING_APPROVAL →
// APPROVED (POSTED hanya lewat /post, karena menulis ledger).
// { status?, reason?, notes? }
stockAdjustmentRouter.patch("/:id", requireAnyPermission(P.INVENTORY_WRITE, P.INVENTORY_ADJUSTMENT_APPROVE), wajibUuid(), async (req, res) => {
  try {
    // Penyetuju murni (mis. Finance) hanya boleh memutuskan persetujuan; mengubah isi/mengajukan tetap hak penulis (INVENTORY_WRITE).
    if (!hasPermission(req.user, P.INVENTORY_WRITE) && req.body.status !== "APPROVED") {
      throw new AdjustmentError("Peran penyetuju hanya dapat menyetujui request", 403);
    }
    const preCheck = await prisma.stockAdjustmentRequest.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Adjustment request tidak ditemukan" });
    const { status, reason, notes } = req.body;

    const request = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_adjustment_requests", preCheck.id);
      const existing = await tx.stockAdjustmentRequest.findUnique({ where: { id: preCheck.id } });
      if (!FORWARD_FLOW.includes(existing.status)) {
        throw new AdjustmentError(`Request berstatus ${existing.status} tidak bisa diubah lewat sini`);
      }

      const data = {};
      if (reason !== undefined) {
        if (!reason?.trim()) throw new AdjustmentError("Alasan tidak boleh dikosongkan");
        data.reason = reason.trim();
      }
      if (notes !== undefined) data.notes = notes || null;

      if (status) {
        const currentIdx = FORWARD_FLOW.indexOf(existing.status);
        const nextIdx = FORWARD_FLOW.indexOf(status);
        if (nextIdx === -1 || nextIdx !== currentIdx + 1) {
          throw new AdjustmentError(`Tidak bisa langsung ke status ${status} dari ${existing.status} — harus berurutan`);
        }
        data.status = status;
        if (status === "APPROVED") {
          wajibPenyetujuPenyesuaian(req.user);
          wajibBukanPihakPengaju(req.user, [existing.requestedById], { label: "pemohon" });
          await wajibSaldoBelumBergeser(tx, existing.id, existing.materialId); // koreksi saldo: saldo yang dilihat pengaju harus masih sama (setelah cek izin/pemisahan tugas)
          data.approvedById = req.user.id;
          data.approvedAt = new Date();
        }
      }

      const updated = await tx.stockAdjustmentRequest.update({ where: { id: preCheck.id }, data, include: requestInclude });
      await catatPerubahanDraf(tx, { entityType: ENTITY_TYPES.STOCK_ADJUSTMENT, entityId: updated.id, actorId: req.user.id, nomor: updated.adjustmentNumber, lama: existing, data });
      if (status === "APPROVED") {
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.STOCK_ADJUSTMENT, entityId: updated.id,
          eventType: EVENT_TYPES.DOCUMENT_APPROVED, actorId: req.user.id,
          metadata: { adjustmentNumber: updated.adjustmentNumber },
        });
      }
      return updated;
    });
    res.json(request);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/adjustments/:id/post
// SATU-SATUNYA jalan request ini menulis ledger. Wajib APPROVED.
//
// PERBAIKAN (12 Sept 2026): sebelumnya endpoint ini menulis `adjustmentQty`
// mentah TANPA mengecek saldo berjalan sama sekali — `beforeQty` cuma
// snapshot informational saat REQUEST DIBUAT (bisa berhari-hari sebelum
// approve+post), jadi kalau saldo sudah berubah sejak itu (issue/receipt/
// opname lain berjalan di antaranya, yang realistis untuk alur approval
// berjenjang), posting delta lama itu bisa mendorong saldo ke negatif tanpa
// terdeteksi. postStockMovement() sekarang mengunci material & mengecek
// ulang saldo BERJALAN persis sebelum menulis, bukan beforeQty basi.
stockAdjustmentRouter.post("/:id/post", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const preCheck = await prisma.stockAdjustmentRequest.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Adjustment request tidak ditemukan" });

    const result = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_adjustment_requests", preCheck.id);
      const request = await tx.stockAdjustmentRequest.findUnique({ where: { id: preCheck.id }, include: requestInclude });
      if (request.status !== "APPROVED") throw new AdjustmentError("Hanya request berstatus Approved yang bisa diposting");
      // Pertahanan berlapis: data lama/diubah langsung di DB tidak boleh lolos dengan pemohon = penyetuju.
      if (!request.approvedById || request.approvedById === request.requestedById) {
        throw new AdjustmentError("Request tidak memiliki persetujuan orang lain — tidak dapat diposting", 403);
      }

      await wajibSaldoBelumBergeser(tx, request.id, request.materialId); // koreksi saldo: tolak bila saldo sudah bergeser sejak diajukan
      await postStockMovement(tx, {
        materialId: request.materialId, type: "ADJUSTMENT", qty: request.adjustmentQty,
        reason: request.reason, note: `Stock Adjustment ${request.adjustmentNumber}`,
        stockAdjustmentRequestId: request.id, createdById: req.user.id,
      });
      const updated = await tx.stockAdjustmentRequest.update({
        where: { id: request.id },
        data: { status: "POSTED", postedById: req.user.id, postedAt: new Date() },
        include: requestInclude,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.STOCK_ADJUSTMENT, entityId: request.id,
        eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: { adjustmentNumber: request.adjustmentNumber, adjustmentQty: request.adjustmentQty },
      });
      return updated;
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/adjustments/:id/cancel { reason }
stockAdjustmentRouter.patch("/:id/cancel", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const request = await prisma.stockAdjustmentRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: "Adjustment request tidak ditemukan" });
    if (request.status === "POSTED" || request.status === "CANCELLED") {
      throw new AdjustmentError(`Request berstatus ${request.status} tidak bisa dibatalkan`);
    }
    const { reason } = req.body;
    if (!reason?.trim()) throw new AdjustmentError("Alasan pembatalan wajib diisi");
    const updated = await prisma.stockAdjustmentRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED", notes: [request.notes, `Dibatalkan: ${reason.trim()}`].filter(Boolean).join(" — ") },
      include: requestInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});
