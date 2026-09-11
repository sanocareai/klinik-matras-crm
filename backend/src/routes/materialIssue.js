// Material Issue — Warehouse Tahap 3.
//
// Alur REQUEST → APPROVAL → PICKING → ISSUE di depan ledger yang sudah ada
// (routes/inventory.js POST /movements/issue tetap berfungsi untuk jalur
// "keluarkan sekarang ke unit tertentu" — TIDAK diubah). Ini jalur untuk
// permintaan yang perlu di-approve dulu dan belum tentu terikat satu Unit.
//
// "Reserved" DIHITUNG dari sini, bukan disimpan — lihat RESERVED_STATUSES
// di bawah, dipakai juga oleh GET /inventory/stock.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { postStockMovement, lockRowForUpdate, RESERVED_STATUSES } from "../services/inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const materialIssueRouter = express.Router();
materialIssueRouter.use(requireAuth);

class IssueError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (typeof err.statusCode === "number") return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor issue sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Material issue error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

const SOURCE_TYPES = ["PRODUCTION_WORK_ORDER", "MAINTENANCE_REQUEST", "INTERNAL_REQUEST", "SAMPLE_REQUEST", "MANUAL"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

// Integrasi Produksi (13 Sept 2026) — fungsi MURNI, diekspor supaya dites
// langsung tanpa Express/DB (pola sama dengan lib/domain/*.js). SATU tempat
// dipakai POST / dan PATCH /:id supaya aturannya tidak bisa drift antara
// keduanya: PRODUCTION_WORK_ORDER TIDAK PUNYA ARTI tanpa unit yang
// ditunjuk — itu yang membedakan integrasi nyata dari sekadar teks bebas
// sourceReference.
export function requiresUnitLink(sourceType) {
  return sourceType === "PRODUCTION_WORK_ORDER";
}

// Status yang MEREGISTRASI stok sebagai Reserved — definisi kanonik sekarang
// di services/inventoryLedger.js (dipakai juga oleh computeStockSnapshot).
// Diekspor ULANG di sini supaya import lama (`from "./materialIssue.js"`,
// dipakai routes/inventory.js & routes/replenishment.js) tetap jalan tanpa
// perlu mengubah lokasi impor di file lain.
export { RESERVED_STATUSES };

// Urutan maju yang sah. CANCELLED dijangkau lewat endpoint terpisah
// (/cancel) dari status mana pun sebelum ISSUED.
const FORWARD_FLOW = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED", "ISSUED"];

const issueInclude = {
  lines: { include: { material: { select: { id: true, code: true, name: true, unit: true } } } },
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  issuedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  // Integrasi Produksi — supaya UI Gudang bisa langsung tampilkan unit/order/
  // pelanggan tanpa request terpisah (sama pola dengan m.unit di
  // ProductionMaterialUsage.jsx sisi Bengkel).
  unit: {
    select: {
      id: true, unitCode: true,
      order: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } },
    },
  },
};

function generateIssueCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `MI-${dd}${mm}${yy}`;
}

// GET /api/inventory/material-issues?status=&sourceType=&priority=
materialIssueRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { status, sourceType, priority } = req.query;
    const issues = await prisma.materialIssue.findMany({
      where: { ...(status && { status }), ...(sourceType && { sourceType }), ...(priority && { priority }) },
      include: issueInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    res.json({ issues });
  } catch (err) {
    handleErr(err, res);
  }
});

materialIssueRouter.get("/:id", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const issue = await prisma.materialIssue.findUnique({ where: { id: req.params.id }, include: issueInclude });
    if (!issue) return res.status(404).json({ error: "Material issue tidak ditemukan" });
    res.json(issue);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/material-issues
// { sourceType, unitId?, sourceReference?, department?, requiredDate?, priority?, notes?,
//   lines: [{materialId, requestedQty, sourceLocation?}] }
//
// unitId WAJIB kalau sourceType = PRODUCTION_WORK_ORDER — inilah yang
// membuat permintaan material BENAR-BENAR terhubung ke unit produksi
// (bukan cuma teks bebas di sourceReference seperti sebelumnya). Sumber
// lain (Maintenance/Internal/Sample/Manual) tidak punya Unit untuk
// ditunjuk, jadi unitId tetap opsional untuk itu.
materialIssueRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { sourceType, unitId, sourceReference, department, requiredDate, priority, notes, lines } = req.body;
    if (!SOURCE_TYPES.includes(sourceType)) throw new IssueError("Source type tidak valid");
    if (requiresUnitLink(sourceType) && !unitId) {
      throw new IssueError("Unit produksi wajib dipilih untuk permintaan dari Work Order Produksi");
    }
    if (priority && !PRIORITIES.includes(priority)) throw new IssueError("Priority tidak valid");
    if (!Array.isArray(lines) || lines.length === 0) throw new IssueError("Minimal satu item wajib diisi");
    for (const l of lines) {
      if (!l.materialId) throw new IssueError("Setiap baris wajib memilih item");
      const qty = Number(l.requestedQty);
      if (!Number.isFinite(qty) || qty <= 0) throw new IssueError("Requested quantity wajib lebih dari 0");
    }

    if (unitId) {
      const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } });
      if (!unit) return res.status(404).json({ error: "Unit produksi tidak ditemukan" });
    }

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.materialIssue.count({ where: { createdAt: { gte: startOfDay } } });
    const issueNumber = `${generateIssueCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const issue = await prisma.materialIssue.create({
      data: {
        issueNumber, sourceType,
        unitId: unitId || null,
        sourceReference: sourceReference || null,
        department: department || null,
        requestedById: req.user.id,
        requiredDate: requiredDate ? new Date(`${requiredDate}T00:00:00.000Z`) : null,
        priority: priority || "NORMAL",
        notes: notes || null,
        createdById: req.user.id,
        lines: {
          create: lines.map((l) => ({
            materialId: l.materialId,
            requestedQty: Number(l.requestedQty),
            sourceLocation: l.sourceLocation || null,
          })),
        },
      },
      include: issueInclude,
    });
    res.status(201).json(issue);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/material-issues/:id
// Header fields + transisi status MAJU satu langkah. APPROVED menandai
// approvedBy/approvedAt OTOMATIS — bukan field yang dikirim klien, supaya
// tidak ada yang bisa "menyetujui atas nama orang lain" lewat body request.
// { sourceReference?, department?, requiredDate?, priority?, notes?, status? }
materialIssueRouter.patch("/:id", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const preCheck = await prisma.materialIssue.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Material issue tidak ditemukan" });

    const { unitId, sourceReference, department, requiredDate, priority, notes, status } = req.body;

    const issue = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "material_issues", preCheck.id);
      const existing = await tx.materialIssue.findUnique({ where: { id: preCheck.id } });
      if (existing.status === "ISSUED" || existing.status === "CANCELLED") {
        throw new IssueError(`Issue berstatus ${existing.status} tidak bisa diubah lagi`);
      }

      const data = {};
      if (unitId !== undefined) {
        if (unitId) {
          const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true } });
          if (!unit) throw new IssueError("Unit produksi tidak ditemukan", 404);
        } else if (requiresUnitLink(existing.sourceType)) {
          throw new IssueError("Unit produksi wajib diisi untuk permintaan dari Work Order Produksi");
        }
        data.unitId = unitId || null;
      }
      if (sourceReference !== undefined) data.sourceReference = sourceReference || null;
      if (department !== undefined) data.department = department || null;
      if (requiredDate !== undefined) data.requiredDate = requiredDate ? new Date(`${requiredDate}T00:00:00.000Z`) : null;
      if (priority !== undefined) {
        if (!PRIORITIES.includes(priority)) throw new IssueError("Priority tidak valid");
        data.priority = priority;
      }
      if (notes !== undefined) data.notes = notes || null;

      if (status) {
        const currentIdx = FORWARD_FLOW.indexOf(existing.status);
        const nextIdx = FORWARD_FLOW.indexOf(status);
        if (nextIdx === -1) throw new IssueError("Status tidak valid");
        if (nextIdx !== currentIdx + 1) {
          throw new IssueError(`Tidak bisa langsung ke status ${status} dari ${existing.status} — harus berurutan`);
        }
        if (status === "ISSUED") {
          throw new IssueError("Status ISSUED hanya ditetapkan lewat POST /:id/issue");
        }
        data.status = status;
        if (status === "APPROVED") {
          data.approvedById = req.user.id;
          data.approvedAt = new Date();
        }
      }

      const updated = await tx.materialIssue.update({ where: { id: preCheck.id }, data, include: issueInclude });
      if (status === "APPROVED") {
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.MATERIAL_ISSUE, entityId: updated.id,
          eventType: EVENT_TYPES.DOCUMENT_APPROVED, actorId: req.user.id,
          metadata: { issueNumber: updated.issueNumber },
        });
      }
      return updated;
    });
    res.json(issue);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/material-issues/:id/lines/:lineId
// Picking: sesuaikan lokasi sumber/catatan sebelum issue. requestedQty
// SENGAJA tidak bisa diubah di sini — itu Reserved yang sudah dikomit saat
// approval; kalau kebutuhannya berubah, batalkan lalu ajukan ulang, supaya
// riwayat permintaan asli tidak diam-diam ditimpa.
materialIssueRouter.patch("/:id/lines/:lineId", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const issue = await prisma.materialIssue.findUnique({ where: { id: req.params.id } });
    if (!issue) return res.status(404).json({ error: "Material issue tidak ditemukan" });
    if (issue.status === "ISSUED" || issue.status === "CANCELLED") {
      throw new IssueError(`Issue berstatus ${issue.status} tidak bisa diubah lagi`);
    }
    const line = await prisma.materialIssueLine.findFirst({ where: { id: req.params.lineId, materialIssueId: issue.id } });
    if (!line) return res.status(404).json({ error: "Baris item tidak ditemukan" });

    const { sourceLocation, notes } = req.body;
    const updated = await prisma.materialIssueLine.update({
      where: { id: line.id },
      data: {
        ...(sourceLocation !== undefined && { sourceLocation: sourceLocation || null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
      include: { material: { select: { id: true, code: true, name: true, unit: true } } },
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/material-issues/:id/issue
// SATU-SATUNYA jalan sebuah Material Issue menjadi baris ledger nyata.
// Wajib status PICKED. Untuk tiap baris, issuedQty DEFAULT ke requestedQty
// (kasus umum: keluar persis sesuai reservasi) — bisa dioverride PER BARIS
// lewat body { lines: [{ lineId, issuedQty }] } untuk shortage parsial.
//
// Baris didobel-kunci di dalam SATU transaksi: dokumen ini sendiri (lock
// "material_issues" — cegah dua klik/dua request paralel men-double-post
// issue YANG SAMA) dan tiap material yang disentuh (lock di dalam
// postStockMovement() — cegah race lintas dokumen berbeda yang menyentuh
// material sama). Keduanya WAJIB, satu tidak menggantikan yang lain.
materialIssueRouter.post("/:id/issue", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const preCheck = await prisma.materialIssue.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Material issue tidak ditemukan" });

    const overrides = Object.fromEntries((req.body.lines || []).map((l) => [l.lineId, l.issuedQty]));

    const result = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "material_issues", preCheck.id);
      const issue = await tx.materialIssue.findUnique({ where: { id: preCheck.id }, include: issueInclude });
      if (issue.status !== "PICKED") {
        throw new IssueError("Hanya issue berstatus Picked yang bisa dikeluarkan");
      }

      for (const line of issue.lines) {
        const qty = overrides[line.id] != null && overrides[line.id] !== "" ? Number(overrides[line.id]) : line.requestedQty;
        if (!Number.isFinite(qty) || qty <= 0) throw new IssueError(`Jumlah keluar untuk ${line.material.code} tidak valid`);

        await postStockMovement(tx, {
          materialId: line.materialId, type: "ISSUE", qty: -qty,
          location: line.sourceLocation || undefined,
          unitId: issue.unitId || undefined,
          note: `Material Issue ${issue.issueNumber}`, materialIssueId: issue.id,
          createdById: req.user.id,
        });
        await tx.materialIssueLine.update({ where: { id: line.id }, data: { issuedQty: qty } });
      }
      const updated = await tx.materialIssue.update({
        where: { id: issue.id },
        data: { status: "ISSUED", issuedById: req.user.id, issuedAt: new Date() },
        include: issueInclude,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.MATERIAL_ISSUE, entityId: issue.id,
        eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: { issueNumber: issue.issueNumber, lineCount: issue.lines.length },
      });
      return updated;
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/material-issues/:id/cancel { reason }
materialIssueRouter.patch("/:id/cancel", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const preCheck = await prisma.materialIssue.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Material issue tidak ditemukan" });
    const { reason } = req.body;
    if (!reason?.trim()) throw new IssueError("Alasan pembatalan wajib diisi");

    const updated = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "material_issues", preCheck.id);
      const issue = await tx.materialIssue.findUnique({ where: { id: preCheck.id } });
      if (issue.status === "ISSUED" || issue.status === "CANCELLED") {
        throw new IssueError(`Issue berstatus ${issue.status} tidak bisa dibatalkan`);
      }
      const result = await tx.materialIssue.update({
        where: { id: issue.id },
        data: { status: "CANCELLED", notes: [issue.notes, `Dibatalkan: ${reason.trim()}`].filter(Boolean).join(" — ") },
        include: issueInclude,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.MATERIAL_ISSUE, entityId: issue.id,
        eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: req.user.id,
        metadata: { issueNumber: issue.issueNumber, reason: reason.trim() },
      });
      return result;
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});
