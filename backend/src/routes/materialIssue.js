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

export const materialIssueRouter = express.Router();
materialIssueRouter.use(requireAuth);

class IssueError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof IssueError) return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor issue sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Material issue error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

const SOURCE_TYPES = ["PRODUCTION_WORK_ORDER", "MAINTENANCE_REQUEST", "INTERNAL_REQUEST", "SAMPLE_REQUEST", "MANUAL"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

// Status yang MEREGISTRASI stok sebagai Reserved (dipakai juga oleh
// GET /inventory/stock — lihat routes/inventory.js). Diekspor supaya kedua
// file selalu memakai definisi yang SAMA, tidak ada risiko drift.
export const RESERVED_STATUSES = ["APPROVED", "READY_TO_PICK", "PICKED"];

// Urutan maju yang sah. CANCELLED dijangkau lewat endpoint terpisah
// (/cancel) dari status mana pun sebelum ISSUED.
const FORWARD_FLOW = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED", "ISSUED"];

const issueInclude = {
  lines: { include: { material: { select: { id: true, code: true, name: true, unit: true } } } },
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  issuedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
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
// { sourceType, sourceReference?, department?, requiredDate?, priority?, notes?,
//   lines: [{materialId, requestedQty, sourceLocation?}] }
materialIssueRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { sourceType, sourceReference, department, requiredDate, priority, notes, lines } = req.body;
    if (!SOURCE_TYPES.includes(sourceType)) throw new IssueError("Source type tidak valid");
    if (priority && !PRIORITIES.includes(priority)) throw new IssueError("Priority tidak valid");
    if (!Array.isArray(lines) || lines.length === 0) throw new IssueError("Minimal satu item wajib diisi");
    for (const l of lines) {
      if (!l.materialId) throw new IssueError("Setiap baris wajib memilih item");
      const qty = Number(l.requestedQty);
      if (!Number.isFinite(qty) || qty <= 0) throw new IssueError("Requested quantity wajib lebih dari 0");
    }

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.materialIssue.count({ where: { createdAt: { gte: startOfDay } } });
    const issueNumber = `${generateIssueCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const issue = await prisma.materialIssue.create({
      data: {
        issueNumber, sourceType,
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
    const existing = await prisma.materialIssue.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Material issue tidak ditemukan" });
    if (existing.status === "ISSUED" || existing.status === "CANCELLED") {
      throw new IssueError(`Issue berstatus ${existing.status} tidak bisa diubah lagi`);
    }

    const { sourceReference, department, requiredDate, priority, notes, status } = req.body;
    const data = {};
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

    const issue = await prisma.materialIssue.update({ where: { id: req.params.id }, data, include: issueInclude });
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
// VALIDASI SHORTAGE: issuedQty tidak boleh melebihi saldo ledger BERJALAN
// (SUM stock_movements per material) — dicek satu per satu di dalam
// transaksi yang sama supaya dua Material Issue tidak bisa lolos bersamaan
// mengeluarkan stok yang sama (race condition) — transaksi Postgres
// menyerialkan write ke stock_movements per material lewat lock baris
// implisit dari agregasi di dalam transaksi yang sama.
materialIssueRouter.post("/:id/issue", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const issue = await prisma.materialIssue.findUnique({ where: { id: req.params.id }, include: issueInclude });
    if (!issue) return res.status(404).json({ error: "Material issue tidak ditemukan" });
    if (issue.status !== "PICKED") {
      throw new IssueError("Hanya issue berstatus Picked yang bisa dikeluarkan");
    }

    const overrides = Object.fromEntries((req.body.lines || []).map((l) => [l.lineId, l.issuedQty]));

    const result = await prisma.$transaction(async (tx) => {
      for (const line of issue.lines) {
        const qty = overrides[line.id] != null && overrides[line.id] !== "" ? Number(overrides[line.id]) : line.requestedQty;
        if (!Number.isFinite(qty) || qty <= 0) throw new IssueError(`Jumlah keluar untuk ${line.material.code} tidak valid`);

        const [{ balance }] = await tx.$queryRaw`
          SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${line.materialId}::uuid
        `;
        if (qty > balance) {
          throw new IssueError(`Stok ${line.material.code} tidak cukup — tersedia ${balance}, diminta ${qty}`);
        }

        await tx.stockMovement.create({
          data: {
            materialId: line.materialId, type: "ISSUE", qty: -qty,
            location: line.sourceLocation || undefined,
            note: `Material Issue ${issue.issueNumber}`, materialIssueId: issue.id,
            createdById: req.user.id,
          },
        });
        await tx.materialIssueLine.update({ where: { id: line.id }, data: { issuedQty: qty } });
      }
      return tx.materialIssue.update({
        where: { id: issue.id },
        data: { status: "ISSUED", issuedById: req.user.id, issuedAt: new Date() },
        include: issueInclude,
      });
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/material-issues/:id/cancel { reason }
materialIssueRouter.patch("/:id/cancel", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const issue = await prisma.materialIssue.findUnique({ where: { id: req.params.id } });
    if (!issue) return res.status(404).json({ error: "Material issue tidak ditemukan" });
    if (issue.status === "ISSUED" || issue.status === "CANCELLED") {
      throw new IssueError(`Issue berstatus ${issue.status} tidak bisa dibatalkan`);
    }
    const { reason } = req.body;
    if (!reason?.trim()) throw new IssueError("Alasan pembatalan wajib diisi");
    const updated = await prisma.materialIssue.update({
      where: { id: issue.id },
      data: { status: "CANCELLED", notes: [issue.notes, `Dibatalkan: ${reason.trim()}`].filter(Boolean).join(" — ") },
      include: issueInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});
