// RENCANA ADMIN (dipasang di /api/production): kalender mingguan, rincian hari, antrean kerja per tindakan, dan perintah jadwal per unit TANPA Production Run.
//   GET  /rencana/minggu?start=YYYY-MM-DD          ringkasan 7 hari (kapasitas, terencana Admin/V2, target selesai, perhatian)         UNIT_READ
//   GET  /rencana/hari?date=YYYY-MM-DD             rincian meja + daftar unit hari itu (Rencana Admin dan V2 pada kalender yang sama)   UNIT_READ
//   GET  /rencana/antrean?tab&q&sort&page          antrean: Siap dijadwalkan · Butuh keputusan · Menunggu unit tiba · Terjadwal          UNIT_READ
//   GET  /units/:id/jadwal                         riwayat jadwal Admin (nilai lama/baru, pelaku, bisa-undo)                            UNIT_READ
//   POST /units/:id/jadwal                         jadwalkan/pindahkan/ubah target-prioritas (Idempotency-Key, expectedRevision)        UNIT_ROUTING_WRITE
//   POST /units/:id/jadwal/keluarkan               keluarkan dari jadwal                                                                UNIT_ROUTING_WRITE
//   POST /units/:id/jadwal/undo                    batalkan perubahan terakhir bila belum ada dampak                                    UNIT_ROUTING_WRITE
// TIDAK ada endpoint di sini yang membuat Run/tahap/QC/penerimaan/pemakaian bahan/stok/jurnal/pesan. Aktivasi V2 tetap lewat jalur Rencana V2 (konfirmasi terpisah).
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { batalkanJadwalInTx, getAntrean, getHari, getMinggu, jadwalkanUnitInTx, parseAntreanQuery, riwayatJadwal, undoJadwalInTx } from "../services/productionRencanaJadwalService.js";
import { kapasitasHari } from "../lib/domain/productionRencanaAdmin.js";
import { BOARD_DEFAULTS } from "../lib/domain/productionBoard.js";

export const productionRencanaJadwalRouter = express.Router();
productionRencanaJadwalRouter.use(requireAuth);

function handleErr(err, res) {
  if (Number.isInteger(err?.statusCode) && err.code) return res.status(err.statusCode).json({ error: err.message, code: err.code, ...(err.details ? { detail: err.details } : {}) });
  console.error("Rencana Admin error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}
const izin = (user) => ({ jadwalkan: hasPermission(user, P.UNIT_ROUTING_WRITE), aktivasiV2: hasPermission(user, P.PRODUCTION_SETTINGS_WRITE) });
const kunci = (req) => req.get("Idempotency-Key");

productionRencanaJadwalRouter.get("/rencana/minggu", requirePermission(P.UNIT_READ), async (req, res) => {
  try { res.json({ ...(await getMinggu(prisma, { start: req.query.start })), izin: izin(req.user) }); } catch (err) { handleErr(err, res); }
});
productionRencanaJadwalRouter.get("/rencana/hari", requirePermission(P.UNIT_READ), async (req, res) => {
  try { res.json({ ...(await getHari(prisma, { date: req.query.date })), izin: izin(req.user) }); } catch (err) { handleErr(err, res); }
});
productionRencanaJadwalRouter.get("/rencana/antrean", requirePermission(P.UNIT_READ), async (req, res) => {
  try { res.json({ ...(await getAntrean(prisma, { query: parseAntreanQuery(req.query) })), kapasitas: kapasitasHari(BOARD_DEFAULTS), stations: BOARD_DEFAULTS.stations, izin: izin(req.user) }); } catch (err) { handleErr(err, res); }
});
productionRencanaJadwalRouter.get("/units/:id/jadwal", requirePermission(P.UNIT_READ), wajibUuid(), async (req, res) => {
  try { res.json(await riwayatJadwal(prisma, req.params.id)); } catch (err) { handleErr(err, res); }
});
productionRencanaJadwalRouter.post("/units/:id/jadwal", requirePermission(P.UNIT_ROUTING_WRITE), wajibUuid(), async (req, res) => {
  try {
    const b = req.body || {};
    const hasil = await prisma.$transaction((tx) => jadwalkanUnitInTx(tx, { unitId: req.params.id, actorId: req.user.id, idempotencyKey: kunci(req), expectedRevision: b.expectedRevision ?? 0, input: b, expectedUnit: b.expectedUnit ?? null }));
    res.status(hasil.replayed || hasil.noChange ? 200 : 201).json(hasil);
  } catch (err) { handleErr(err, res); }
});
productionRencanaJadwalRouter.post("/units/:id/jadwal/keluarkan", requirePermission(P.UNIT_ROUTING_WRITE), wajibUuid(), async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => batalkanJadwalInTx(tx, { unitId: req.params.id, actorId: req.user.id, idempotencyKey: kunci(req), expectedRevision: req.body?.expectedRevision, note: req.body?.note }));
    res.status(hasil.replayed ? 200 : 201).json(hasil);
  } catch (err) { handleErr(err, res); }
});
productionRencanaJadwalRouter.post("/units/:id/jadwal/undo", requirePermission(P.UNIT_ROUTING_WRITE), wajibUuid(), async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => undoJadwalInTx(tx, { unitId: req.params.id, eventId: req.body?.eventId, actorId: req.user.id, idempotencyKey: kunci(req) }));
    res.status(hasil.replayed ? 200 : 201).json(hasil);
  } catch (err) { handleErr(err, res); }
});
