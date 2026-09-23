import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import {
  acknowledgeDriverCursor,
  readDriverDelta,
  readDriverFullSnapshot,
} from "../services/driverSnapshotV2.js";
import {
  V2_FLAGS,
  assertDeliveryReaderGate,
  isFlagEnabled,
  loadV2Flags,
} from "../services/v2FeatureFlags.js";

export const deliveryV2Router = express.Router();
deliveryV2Router.use(requireAuth);

async function requireDriverV2Reader(req, res, next) {
  try {
    const flags = await loadV2Flags(prisma);
    assertDeliveryReaderGate(flags);
    if (!isFlagEnabled(flags, V2_FLAGS.DRIVER_SNAPSHOT_READER, {
      userId: req.user.id,
      deviceId: req.get("X-Device-Id") || null,
    })) {
      return res.status(503).json({ error: "Driver snapshot V2 belum aktif untuk perangkat ini", code: "V2_READER_DISABLED" });
    }
    next();
  } catch (error) {
    next(error);
  }
}

function sendError(error, res) {
  const status = error.statusCode || 500;
  const body = { error: status >= 500 ? "Sinkronisasi V2 sedang tidak tersedia" : error.message };
  if (error.code) body.code = error.code;
  if (error.details && status < 500) body.details = error.details;
  if (status >= 500) console.error("[delivery-v2]", error);
  res.status(status).json(body);
}

deliveryV2Router.get("/v2/me/snapshot", requirePermission(P.JOB_OWN_READ), requireDriverV2Reader, async (req, res) => {
  try {
    res.json(await readDriverFullSnapshot(prisma, {
      userId: req.user.id,
      cursor: req.query.cursor || null,
      limit: req.query.limit,
    }));
  } catch (error) {
    sendError(error, res);
  }
});

deliveryV2Router.get("/v2/me/changes", requirePermission(P.JOB_OWN_READ), requireDriverV2Reader, async (req, res) => {
  try {
    res.json(await readDriverDelta(prisma, {
      userId: req.user.id,
      cursor: req.query.cursor,
      limit: req.query.limit,
    }));
  } catch (error) {
    sendError(error, res);
  }
});

deliveryV2Router.post("/v2/me/cursor", requirePermission(P.JOB_OWN_READ), requireDriverV2Reader, async (req, res) => {
  try {
    const deviceId = String(req.get("X-Device-Id") || req.body?.deviceId || "").trim();
    if (!deviceId) return res.status(400).json({ error: "X-Device-Id wajib diisi" });
    await acknowledgeDriverCursor(prisma, {
      userId: req.user.id,
      deviceId,
      cursor: req.body?.cursor,
      device: req.body?.device || {},
    });
    res.json({ ok: true });
  } catch (error) {
    sendError(error, res);
  }
});

