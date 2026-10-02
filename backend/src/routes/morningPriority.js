// Usulan Prioritas Pagi — lihat catatan desain lengkap di services/morningPriority.js.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAnyPermission, requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import {
  requestMorningPriority, approveMorningPriority, dismissMorningPriority, listMorningPriorityRequests,
  MorningPriorityError,
} from "../services/morningPriority.js";

export const morningPriorityRouter = express.Router();
morningPriorityRouter.use(requireAuth);

function handleErr(err, res) {
  if (err instanceof MorningPriorityError) return res.status(err.status).json({ error: err.message });
  console.error("[morning-priority]", err);
  res.status(500).json({ error: "Terjadi kesalahan di server" });
}

// Dilihat DUA sisi: Dispatcher (Route Planner, lihat usulannya sendiri) dan Production (papan
// persetujuan) — digabung lewat requireAnyPermission alih-alih dua endpoint, datanya sama-sama
// tidak sensitif (koordinasi internal, bukan data pelanggan/harga).
morningPriorityRouter.get("/", requireAnyPermission(P.JOB_WRITE, P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    // "ALL" = tanpa filter (dipakai Route Planner untuk menampilkan status usulan yang SUDAH diputuskan
    // juga, bukan cuma PENDING) — SENGAJA sentinel eksplisit, bukan string kosong: buildQuery() frontend
    // membuang parameter bernilai "" sebelum terkirim, jadi "?status=" tidak pernah benar-benar sampai.
    const status = req.query.status === "ALL" ? null : (req.query.status || "PENDING");
    if (status && !["PENDING", "APPROVED", "DISMISSED"].includes(status)) {
      return res.status(400).json({ error: "status harus salah satu dari: PENDING, APPROVED, DISMISSED, ALL" });
    }
    res.json(await listMorningPriorityRequests({ status }));
  } catch (err) { handleErr(err, res); }
});

// JOB_WRITE — permission yang sudah dipegang DISPATCHER; sengaja BUKAN UNIT_ROUTING_WRITE (lihat
// catatan desain). ADMIN/OWNER juga punya JOB_WRITE jadi tetap bisa mengusulkan sendiri bila perlu.
morningPriorityRouter.post("/", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const { orderId, note, suggestedPriority } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId wajib diisi" });
    const created = await requestMorningPriority({
      orderId, requestedById: req.user.id, note, suggestedPriority: suggestedPriority || "HIGH",
    });
    res.status(201).json(created);
  } catch (err) { handleErr(err, res); }
});

// UNIT_ROUTING_WRITE — HANYA pemegang sah ProductionPriority yang boleh menyetujui (lihat catatan desain:
// dispatcher mengusulkan, produksi memutuskan — bukan jalur baru yang melonggarkan izin manapun).
morningPriorityRouter.patch("/:id/approve", requirePermission(P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    const updated = await approveMorningPriority({ id: req.params.id, decidedById: req.user.id, priority: req.body.priority });
    res.json(updated);
  } catch (err) { handleErr(err, res); }
});

morningPriorityRouter.patch("/:id/dismiss", requirePermission(P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    const updated = await dismissMorningPriority({ id: req.params.id, decidedById: req.user.id });
    res.json(updated);
  } catch (err) { handleErr(err, res); }
});
