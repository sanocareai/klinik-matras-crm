// Custody unit Gudang V2 (P1–P2): antrean inbound/return, terima, tolak. Semua pesan berbahasa Indonesia.
// Penulisan HANYA lewat unitCustodyCommandService (command owner). Read/write memakai permission inventori.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import {
  acceptUnitCustody, listCustodyHandoffs, rejectUnitCustody,
} from "../services/unitCustodyCommandService.js";

export const unitCustodyRouter = express.Router();
unitCustodyRouter.use(requireAuth);

const STATUSES = ["OFFERED", "ACCEPTED", "REJECTED", "CANCELLED", "SUPERSEDED"];
const DIRECTIONS = ["INBOUND", "RETURN"];

function handleErr(err, res) {
  if (Number.isInteger(err?.statusCode)) {
    return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.details ? { details: err.details } : {}) });
  }
  if (err?.code === "P2002") return res.status(409).json({ error: "Data custody sudah ada atau sedang diproses", code: "CUSTODY_DUPLICATE" });
  console.error("Unit custody error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

// GET /api/inventory/unit-custody?status=OFFERED&direction=INBOUND — antrean Gudang (status=REJECTED = antrean exception).
unitCustodyRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : "OFFERED";
    const direction = req.query.direction ? String(req.query.direction) : null;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "Status tidak valid", code: "CUSTODY_STATUS_INVALID" });
    if (direction && !DIRECTIONS.includes(direction)) return res.status(400).json({ error: "Arah serah-terima tidak valid", code: "CUSTODY_DIRECTION_INVALID" });
    res.json({ items: await listCustodyHandoffs(prisma, { status, direction, limit: req.query.limit }) });
  } catch (err) { handleErr(err, res); }
});

// POST /api/inventory/unit-custody/:id/accept  { locationId, expectedRevision }  + header Idempotency-Key
unitCustodyRouter.post("/:id/accept", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const result = await acceptUnitCustody(prisma, {
      handoffId: req.params.id, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey,
      expectedRevision: req.body?.expectedRevision, locationId: req.body?.locationId,
    });
    res.json(result);
  } catch (err) { handleErr(err, res); }
});

// POST /api/inventory/unit-custody/:id/reject  { reason, expectedRevision }  + header Idempotency-Key
unitCustodyRouter.post("/:id/reject", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const result = await rejectUnitCustody(prisma, {
      handoffId: req.params.id, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey,
      expectedRevision: req.body?.expectedRevision, reason: req.body?.reason,
    });
    res.json(result);
  } catch (err) { handleErr(err, res); }
});
