// Stock Transfer — Warehouse Tahap 4.
//
// DUA BARIS LEDGER PER TRANSFER, DITULIS DI DUA LANGKAH BERBEDA — lihat
// catatan panjang di schema.prisma di atas model StockTransfer:
//   1. POST /:id/dispatch — movement TRANSFER negatif di lokasi asal.
//   2. POST /:id/receive  — movement TRANSFER positif di lokasi tujuan
//      (qty BISA beda dari yang dikirim — itu `difference`).

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { postStockMovement, lockRowForUpdate, computeStockSnapshot } from "../services/inventoryLedger.js";
import { tampilanTransfer, ketersediaanBaris, jejakDokumenGudang } from "../services/dokumenGudang.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { catatPerubahanDraf } from "../lib/jejakPerubahan.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";

export const stockTransferRouter = express.Router();
stockTransferRouter.use(requireAuth);

class TransferError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (typeof err.statusCode === "number") return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor transfer sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Stock transfer error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}

const TRANSFER_TYPES = [
  "BIN_TO_BIN", "ZONE_TO_ZONE", "WAREHOUSE_TO_WAREHOUSE", "AVAILABLE_TO_QUARANTINE",
  "QUARANTINE_TO_AVAILABLE", "AVAILABLE_TO_DAMAGED", "RETURN_TO_WAREHOUSE",
];

// DRAFT..PICKED lewat PATCH biasa (satu langkah maju). IN_TRANSIT & COMPLETED
// HANYA lewat /dispatch & /receive — dua-duanya menulis ledger, jadi tidak
// boleh dicapai lewat PATCH status generik seperti langkah lain.
const FORWARD_FLOW = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "PICKED"];

const transferInclude = {
  lines: { include: { material: { select: { id: true, code: true, name: true, unit: true } } } },
  sourceLocation: { select: { id: true, code: true, zone: true, locationType: true } },
  destinationLocation: { select: { id: true, code: true, zone: true, locationType: true } },
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
};

function generateTransferCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `TRF-${dd}${mm}${yy}`;
}

// GET /api/inventory/locations — lokasi aktif, untuk pemilih Transfer.
stockTransferRouter.get("/locations", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const locations = await prisma.storageLocation.findMany({
      where: { active: true },
      include: { warehouse: { select: { id: true, code: true, name: true } } },
      orderBy: [{ warehouseId: "asc" }, { zone: "asc" }],
    });
    res.json({ locations });
  } catch (err) {
    handleErr(err, res);
  }
});

stockTransferRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { status, transferType } = req.query;
    const transfers = await prisma.stockTransfer.findMany({
      where: { ...(status && { status }), ...(transferType && { transferType }) },
      include: transferInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    res.json({ transfers: transfers.map((t) => ({ ...t, tampilan: tampilanTransfer(t) })) });
  } catch (err) {
    handleErr(err, res);
  }
});

stockTransferRouter.get("/:id", requirePermission(P.INVENTORY_READ), wajibUuid(), async (req, res) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id }, include: transferInclude });
    if (!transfer) return res.status(404).json({ error: "Stock transfer tidak ditemukan" });
    // UX Tahap 2: status/aksi dalam bahasa petugas (services/dokumenGudang.js), saldo bahan (TOTAL semua lokasi — sistem tidak menyimpan saldo per lokasi), jejak ringan. Akun hanya-lihat tanpa aksi.
    const tulis = hasPermission(req.user, P.INVENTORY_WRITE);
    const tampilan = tampilanTransfer(transfer);
    const ids = new Set(transfer.lines.map((l) => l.materialId));
    const snapshot = (await computeStockSnapshot(prisma)).filter((x) => ids.has(x.materialId));
    res.json({
      ...transfer, tampilan: tulis ? tampilan : { ...tampilan, aksi: [] }, izin: { tulis },
      ketersediaan: ketersediaanBaris(snapshot, transfer.lines, { kunciJumlah: "qtySent" }),
      jejak: await jejakDokumenGudang(prisma, { entityType: ENTITY_TYPES.STOCK_TRANSFER, id: transfer.id, dibuatOleh: transfer.requestedBy?.name ?? null, dibuatPada: transfer.createdAt }),
    });
  } catch (err) {
    handleErr(err, res);
  }
});

/** Inti pembuatan Transfer (dipakai POST / dan "Buat ulang"): validasi + nomor urut + baris. `db` boleh transaksi. */
export async function createStockTransfer({ transferType, sourceLocationId, destinationLocationId, notes, lines }, userId, db = prisma) {
  if (!TRANSFER_TYPES.includes(transferType)) throw new TransferError("Transfer type tidak valid");
  if (!sourceLocationId || !destinationLocationId) throw new TransferError("Lokasi asal dan tujuan wajib dipilih");
  if (sourceLocationId === destinationLocationId) throw new TransferError("Lokasi asal dan tujuan tidak boleh sama");
  if (!Array.isArray(lines) || lines.length === 0) throw new TransferError("Minimal satu item wajib diisi");
  for (const l of lines) {
    if (!l.materialId) throw new TransferError("Setiap baris wajib memilih item");
    const qty = Number(l.qtySent);
    if (!Number.isFinite(qty) || qty <= 0) throw new TransferError("Qty Sent wajib lebih dari 0");
  }
  const [source, destination] = await Promise.all([
    db.storageLocation.findUnique({ where: { id: sourceLocationId } }),
    db.storageLocation.findUnique({ where: { id: destinationLocationId } }),
  ]);
  if (!source) throw new TransferError("Lokasi asal tidak ditemukan", 404);
  if (!destination) throw new TransferError("Lokasi tujuan tidak ditemukan", 404);
  const today = new Date();
  const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const existing = await db.stockTransfer.count({ where: { createdAt: { gte: startOfDay } } });
  const transferNumber = `${generateTransferCode(today)}-${String(existing + 1).padStart(2, "0")}`;
  return db.stockTransfer.create({
    data: {
      transferNumber, transferType, sourceLocationId, destinationLocationId,
      notes: notes || null, requestedById: userId,
      lines: { create: lines.map((l) => ({ materialId: l.materialId, qtySent: Number(l.qtySent) })) },
    },
    include: transferInclude,
  });
}

// POST /api/inventory/transfers
// { transferType, sourceLocationId, destinationLocationId, notes?, lines: [{materialId, qtySent}] }
stockTransferRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    res.status(201).json(await createStockTransfer(req.body, req.user.id));
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/transfers/:id — header + transisi DRAFT..PICKED.
stockTransferRouter.patch("/:id", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const preCheck = await prisma.stockTransfer.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Stock transfer tidak ditemukan" });
    const { notes, status } = req.body;

    const transfer = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_transfers", preCheck.id);
      const existing = await tx.stockTransfer.findUnique({ where: { id: preCheck.id } });
      if (!FORWARD_FLOW.includes(existing.status)) {
        throw new TransferError(`Transfer berstatus ${existing.status} tidak bisa diubah lewat sini`);
      }

      const data = {};
      if (notes !== undefined) data.notes = notes || null;

      // Retry/klik ganda: status yang diminta SUDAH berlaku → bukan langkah baru (tanpa galat, tanpa catatan ganda)
      if (status && status !== existing.status) {
        const currentIdx = FORWARD_FLOW.indexOf(existing.status);
        const nextIdx = FORWARD_FLOW.indexOf(status);
        if (nextIdx === -1) throw new TransferError("Status tidak valid dari sini — gunakan /dispatch untuk In Transit");
        if (nextIdx !== currentIdx + 1) {
          throw new TransferError(`Tidak bisa langsung ke status ${status} dari ${existing.status} — harus berurutan`);
        }
        data.status = status;
        if (status === "APPROVED") {
          data.approvedById = req.user.id;
          data.approvedAt = new Date();
        }
      }

      const updated = await tx.stockTransfer.update({ where: { id: preCheck.id }, data, include: transferInclude });
      await catatPerubahanDraf(tx, { entityType: ENTITY_TYPES.STOCK_TRANSFER, entityId: updated.id, actorId: req.user.id, nomor: updated.transferNumber, lama: existing, data });
      if (data.status === "APPROVED") {
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.STOCK_TRANSFER, entityId: updated.id,
          eventType: EVENT_TYPES.DOCUMENT_APPROVED, actorId: req.user.id,
          metadata: { transferNumber: updated.transferNumber },
        });
      }
      return { ...updated, ulang: !!(status && status === existing.status && Object.keys(data).length === 0) };
    });
    res.json(transfer);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/transfers/:id/dispatch
// Wajib status PICKED. Validasi shortage terhadap saldo ledger BERJALAN di
// dalam transaksi yang sama, sama pola dengan POST /material-issues/:id/issue.
stockTransferRouter.post("/:id/dispatch", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const preCheck = await prisma.stockTransfer.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Stock transfer tidak ditemukan" });

    const result = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_transfers", preCheck.id);
      const transfer = await tx.stockTransfer.findUnique({ where: { id: preCheck.id }, include: transferInclude });
      if (transfer.status === "IN_TRANSIT") return { ...transfer, ulang: true }; // klik ganda/retry: saldo SUDAH dikurangi sekali
      if (transfer.status !== "PICKED") throw new TransferError("Hanya transfer berstatus Picked yang bisa dikirim");

      for (const line of transfer.lines) {
        await postStockMovement(tx, {
          materialId: line.materialId, type: "TRANSFER", qty: -line.qtySent,
          location: transfer.sourceLocation.code, note: `Dispatch ${transfer.transferNumber}`,
          stockTransferId: transfer.id, createdById: req.user.id,
        });
      }
      const updated = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "IN_TRANSIT", dispatchedAt: new Date() },
        include: transferInclude,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.STOCK_TRANSFER, entityId: transfer.id,
        eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: { transferNumber: transfer.transferNumber, step: "dispatch" },
      });
      return updated;
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/transfers/:id/receive { lines?: [{lineId, qtyReceived}] }
// Wajib status IN_TRANSIT. qtyReceived default ke qtySent — override per
// baris untuk kasus barang susut/rusak di perjalanan.
stockTransferRouter.post("/:id/receive", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const preCheck = await prisma.stockTransfer.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Stock transfer tidak ditemukan" });
    const overrides = Object.fromEntries((req.body.lines || []).map((l) => [l.lineId, l.qtyReceived]));

    const result = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_transfers", preCheck.id);
      const transfer = await tx.stockTransfer.findUnique({ where: { id: preCheck.id }, include: transferInclude });
      if (transfer.status === "COMPLETED") return { ...transfer, ulang: true }; // klik ganda/retry: saldo SUDAH dibukukan sekali
      if (transfer.status !== "IN_TRANSIT") throw new TransferError("Hanya transfer berstatus In Transit yang bisa diterima");

      for (const line of transfer.lines) {
        const qty = overrides[line.id] != null && overrides[line.id] !== "" ? Number(overrides[line.id]) : line.qtySent;
        if (!Number.isFinite(qty) || qty < 0) throw new TransferError(`Jumlah diterima untuk ${line.material.code} tidak valid`);

        // qty 0 = seluruhnya hilang/rusak di jalan — tetap catat qtyReceived
        // di baris transfer, tapi TIDAK ada baris ledger (postStockMovement
        // menolak qty nol; movement nol memang tidak berarti apa-apa).
        if (qty > 0) {
          await postStockMovement(tx, {
            materialId: line.materialId, type: "TRANSFER", qty,
            location: transfer.destinationLocation.code, note: `Receive ${transfer.transferNumber}`,
            stockTransferId: transfer.id, createdById: req.user.id,
          });
        }
        await tx.stockTransferLine.update({ where: { id: line.id }, data: { qtyReceived: qty } });
      }
      const updated = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "COMPLETED", receivedAt: new Date() },
        include: transferInclude,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.STOCK_TRANSFER, entityId: transfer.id,
        eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: { transferNumber: transfer.transferNumber, step: "receive" },
      });
      return updated;
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/transfers/:id/cancel { reason }
// Hanya sebelum IN_TRANSIT — begitu barang dikirim, tidak ada "batal" tanpa
// alur retur fisik, itu di luar cakupan endpoint ini.
stockTransferRouter.patch("/:id/cancel", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const preCheck = await prisma.stockTransfer.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Stock transfer tidak ditemukan" });
    const { reason } = req.body;
    if (!reason?.trim()) throw new TransferError("Alasan pembatalan wajib diisi");

    const updated = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_transfers", preCheck.id);
      const transfer = await tx.stockTransfer.findUnique({ where: { id: preCheck.id } });
      if (transfer.status === "CANCELLED") return { ...(await tx.stockTransfer.findUnique({ where: { id: transfer.id }, include: transferInclude })), ulang: true }; // retry: sudah dibatalkan
      if (!FORWARD_FLOW.includes(transfer.status)) {
        throw new TransferError(`Transfer berstatus ${transfer.status} tidak bisa dibatalkan lewat sini`);
      }
      const result = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "CANCELLED", notes: [transfer.notes, `Dibatalkan: ${reason.trim()}`].filter(Boolean).join(" — ") },
        include: transferInclude,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.STOCK_TRANSFER, entityId: transfer.id,
        eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: req.user.id,
        metadata: { transferNumber: transfer.transferNumber, reason: reason.trim() },
      });
      return result;
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/transfers/:id/buat-ulang { alasan }
// Transfer DIBATALKAN → transfer BARU berstatus Draf (tipe, lokasi, item, jumlah sama; aturan pembuatan sama). Dokumen lama tidak diubah/dihapus; saling tertaut di jejak; aman diulang (satu dokumen baru).
stockTransferRouter.post("/:id/buat-ulang", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const alasan = String(req.body?.alasan ?? "").trim();
    if (alasan.length < 3 || alasan.length > 300) throw new TransferError("Alasan wajib diisi (3–300 karakter)");
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_transfers", req.params.id);
      const lama = await tx.stockTransfer.findUnique({ where: { id: req.params.id }, include: transferInclude });
      if (!lama) throw new TransferError("Stock transfer tidak ditemukan", 404);
      if (lama.status !== "CANCELLED") throw new TransferError(`Hanya transfer yang Dibatalkan yang bisa dibuat ulang (sekarang: ${tampilanTransfer(lama).label}).`, 409);
      const sudah = await tx.activityEvent.findFirst({ where: { entityType: ENTITY_TYPES.STOCK_TRANSFER, entityId: lama.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, metadata: { path: ["aksi"], equals: "DIBUAT_ULANG_MENJADI" } }, orderBy: { createdAt: "desc" } });
      if (sudah?.metadata?.keId) {
        const ada = await tx.stockTransfer.findUnique({ where: { id: sudah.metadata.keId }, include: transferInclude });
        if (ada && ada.status !== "CANCELLED") return { dok: ada, baru: false, lama };
      }
      const baru = await createStockTransfer({
        transferType: lama.transferType, sourceLocationId: lama.sourceLocationId, destinationLocationId: lama.destinationLocationId,
        notes: `Dibuat ulang dari ${lama.transferNumber}: ${alasan}`, lines: lama.lines.map((l) => ({ materialId: l.materialId, qtySent: l.qtySent })),
      }, req.user.id, tx);
      await recordActivity(tx, { entityType: ENTITY_TYPES.STOCK_TRANSFER, entityId: baru.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: "DIBUAT_ULANG_DARI", nomor: baru.transferNumber, dariId: lama.id, dariNomor: lama.transferNumber, alasan } });
      await recordActivity(tx, { entityType: ENTITY_TYPES.STOCK_TRANSFER, entityId: lama.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: "DIBUAT_ULANG_MENJADI", nomor: lama.transferNumber, keId: baru.id, keNomor: baru.transferNumber, alasan } });
      return { dok: baru, baru: true, lama };
    });
    res.status(hasil.baru ? 201 : 200).json({ ...hasil.dok, tampilan: tampilanTransfer(hasil.dok), dariId: hasil.lama.id, dariNomor: hasil.lama.transferNumber, ulang: !hasil.baru });
  } catch (err) {
    handleErr(err, res);
  }
});
