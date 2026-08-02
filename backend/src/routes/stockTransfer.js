// Stock Transfer — Warehouse Tahap 4.
//
// DUA BARIS LEDGER PER TRANSFER, DITULIS DI DUA LANGKAH BERBEDA — lihat
// catatan panjang di schema.prisma di atas model StockTransfer:
//   1. POST /:id/dispatch — movement TRANSFER negatif di lokasi asal.
//   2. POST /:id/receive  — movement TRANSFER positif di lokasi tujuan
//      (qty BISA beda dari yang dikirim — itu `difference`).

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";

export const stockTransferRouter = express.Router();
stockTransferRouter.use(requireAuth);

class TransferError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof TransferError) return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor transfer sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Stock transfer error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
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
    res.json({ transfers });
  } catch (err) {
    handleErr(err, res);
  }
});

stockTransferRouter.get("/:id", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id }, include: transferInclude });
    if (!transfer) return res.status(404).json({ error: "Stock transfer tidak ditemukan" });
    res.json(transfer);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/transfers
// { transferType, sourceLocationId, destinationLocationId, notes?, lines: [{materialId, qtySent}] }
stockTransferRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { transferType, sourceLocationId, destinationLocationId, notes, lines } = req.body;
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
      prisma.storageLocation.findUnique({ where: { id: sourceLocationId } }),
      prisma.storageLocation.findUnique({ where: { id: destinationLocationId } }),
    ]);
    if (!source) return res.status(404).json({ error: "Lokasi asal tidak ditemukan" });
    if (!destination) return res.status(404).json({ error: "Lokasi tujuan tidak ditemukan" });

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.stockTransfer.count({ where: { createdAt: { gte: startOfDay } } });
    const transferNumber = `${generateTransferCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const transfer = await prisma.stockTransfer.create({
      data: {
        transferNumber, transferType, sourceLocationId, destinationLocationId,
        notes: notes || null, requestedById: req.user.id,
        lines: { create: lines.map((l) => ({ materialId: l.materialId, qtySent: Number(l.qtySent) })) },
      },
      include: transferInclude,
    });
    res.status(201).json(transfer);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/transfers/:id — header + transisi DRAFT..PICKED.
stockTransferRouter.patch("/:id", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const existing = await prisma.stockTransfer.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Stock transfer tidak ditemukan" });
    if (!FORWARD_FLOW.includes(existing.status)) {
      throw new TransferError(`Transfer berstatus ${existing.status} tidak bisa diubah lewat sini`);
    }

    const { notes, status } = req.body;
    const data = {};
    if (notes !== undefined) data.notes = notes || null;

    if (status) {
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

    const transfer = await prisma.stockTransfer.update({ where: { id: req.params.id }, data, include: transferInclude });
    res.json(transfer);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/transfers/:id/dispatch
// Wajib status PICKED. Validasi shortage terhadap saldo ledger BERJALAN di
// dalam transaksi yang sama, sama pola dengan POST /material-issues/:id/issue.
stockTransferRouter.post("/:id/dispatch", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id }, include: transferInclude });
    if (!transfer) return res.status(404).json({ error: "Stock transfer tidak ditemukan" });
    if (transfer.status !== "PICKED") throw new TransferError("Hanya transfer berstatus Picked yang bisa dikirim");

    const result = await prisma.$transaction(async (tx) => {
      for (const line of transfer.lines) {
        const [{ balance }] = await tx.$queryRaw`
          SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${line.materialId}::uuid
        `;
        if (line.qtySent > balance) {
          throw new TransferError(`Stok ${line.material.code} tidak cukup — tersedia ${balance}, dikirim ${line.qtySent}`);
        }
        await tx.stockMovement.create({
          data: {
            materialId: line.materialId, type: "TRANSFER", qty: -line.qtySent,
            location: transfer.sourceLocation.code, note: `Dispatch ${transfer.transferNumber}`,
            stockTransferId: transfer.id, createdById: req.user.id,
          },
        });
      }
      return tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "IN_TRANSIT", dispatchedAt: new Date() },
        include: transferInclude,
      });
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/transfers/:id/receive { lines?: [{lineId, qtyReceived}] }
// Wajib status IN_TRANSIT. qtyReceived default ke qtySent — override per
// baris untuk kasus barang susut/rusak di perjalanan.
stockTransferRouter.post("/:id/receive", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id }, include: transferInclude });
    if (!transfer) return res.status(404).json({ error: "Stock transfer tidak ditemukan" });
    if (transfer.status !== "IN_TRANSIT") throw new TransferError("Hanya transfer berstatus In Transit yang bisa diterima");

    const overrides = Object.fromEntries((req.body.lines || []).map((l) => [l.lineId, l.qtyReceived]));

    const result = await prisma.$transaction(async (tx) => {
      for (const line of transfer.lines) {
        const qty = overrides[line.id] != null && overrides[line.id] !== "" ? Number(overrides[line.id]) : line.qtySent;
        if (!Number.isFinite(qty) || qty < 0) throw new TransferError(`Jumlah diterima untuk ${line.material.code} tidak valid`);

        await tx.stockMovement.create({
          data: {
            materialId: line.materialId, type: "TRANSFER", qty,
            location: transfer.destinationLocation.code, note: `Receive ${transfer.transferNumber}`,
            stockTransferId: transfer.id, createdById: req.user.id,
          },
        });
        await tx.stockTransferLine.update({ where: { id: line.id }, data: { qtyReceived: qty } });
      }
      return tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "COMPLETED", receivedAt: new Date() },
        include: transferInclude,
      });
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/transfers/:id/cancel { reason }
// Hanya sebelum IN_TRANSIT — begitu barang dikirim, tidak ada "batal" tanpa
// alur retur fisik, itu di luar cakupan endpoint ini.
stockTransferRouter.patch("/:id/cancel", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id } });
    if (!transfer) return res.status(404).json({ error: "Stock transfer tidak ditemukan" });
    if (!FORWARD_FLOW.includes(transfer.status)) {
      throw new TransferError(`Transfer berstatus ${transfer.status} tidak bisa dibatalkan lewat sini`);
    }
    const { reason } = req.body;
    if (!reason?.trim()) throw new TransferError("Alasan pembatalan wajib diisi");
    const updated = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: "CANCELLED", notes: [transfer.notes, `Dibatalkan: ${reason.trim()}`].filter(Boolean).join(" — ") },
      include: transferInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});
