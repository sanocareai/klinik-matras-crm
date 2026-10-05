// Usulan Prioritas Pagi — lihat catatan desain lengkap di services/morningPriority.js.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAnyPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import {
  requestMorningPriority, dismissMorningPriority, listMorningPriorityRequests,
  MorningPriorityError,
} from "../services/morningPriority.js";

export const morningPriorityRouter = express.Router();
morningPriorityRouter.use(requireAuth);

function handleErr(err, res) {
  if (err instanceof MorningPriorityError) return res.status(err.status).json({ error: err.message });
  console.error("[morning-priority]", err);
  res.status(500).json({ error: "Terjadi kesalahan di server" });
}

// Dilihat DUA sisi: Dispatcher (Route Planner) dan Production (papan koordinasi) — digabung lewat
// requireAnyPermission, datanya sama-sama tidak sensitif (koordinasi internal, bukan data pelanggan/harga).
morningPriorityRouter.get("/", requireAnyPermission(P.JOB_WRITE, P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    const status = req.query.status === "ALL" ? null : (req.query.status || "APPROVED");
    if (status && !["PENDING", "APPROVED", "DISMISSED"].includes(status)) {
      return res.status(400).json({ error: "status harus salah satu dari: PENDING, APPROVED, DISMISSED, ALL" });
    }
    res.json(await listMorningPriorityRequests({ status }));
  } catch (err) { handleErr(err, res); }
});

// Menandai BERLAKU LANGSUNG (lihat catatan revisi desain di services/morningPriority.js — Nadya/Natasha
// sudah diskusi langsung tiap pagi, gerbang approve terpisah cuma menambah klik). JOB_WRITE — permission
// yang sudah dipegang DISPATCHER; sengaja BUKAN UNIT_ROUTING_WRITE umum (dispatcher dapat kemampuan
// SEMPIT lewat endpoint khusus ini, bukan izin produksi umum).
morningPriorityRouter.post("/", requireAnyPermission(P.JOB_WRITE, P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    const { orderId, note, suggestedPriority } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId wajib diisi" });
    const created = await requestMorningPriority({
      orderId, requestedById: req.user.id, note, suggestedPriority: suggestedPriority || "HIGH",
    });
    res.status(201).json(created);
  } catch (err) { handleErr(err, res); }
});

// Batalkan — Dispatcher ATAU Production, dua arah (lihat catatan desain: koordinasi, bukan gerbang satu arah).
morningPriorityRouter.patch("/:id/dismiss", requireAnyPermission(P.JOB_WRITE, P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    const updated = await dismissMorningPriority({ id: req.params.id, decidedById: req.user.id });
    res.json(updated);
  } catch (err) { handleErr(err, res); }
});
