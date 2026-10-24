// REKONSILIASI PEMAKAIAN — catatan historis, koreksi (catatan · pemakaian per order), dan posting terpadu. Mount: /api/production.
//   Baca        : GET  /units/:id/catatan-historis
//   Catatan     : POST /catatan-historis/:id/{koreksi|konfirmasi|kecualikan}          (tanpa efek stok; Idempotency-Key wajib)
//   Pemakaian   : POST /units/:id/koreksi-pemakaian[/pratinjau] · GET /koreksi-pemakaian · POST /koreksi-pemakaian/:id/{setujui|tolak|batal}   (efek stok; penyetuju ≠ pemohon)
//   Posting     : GET  /posting-historis/rencana · POST /posting-historis/jalankan    (hanya rencana yang hash-nya disetujui; izin inventory:adjustment_approve)
//   Evaluasi    : POST /catatan-historis/evaluasi
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { ambilCatatanHistoris, evaluasiUlang } from "../services/catatanPemakaianHistoris.js";
import { koreksiCatatan, konfirmasiCatatan, kecualikanCatatan, pratinjauKoreksiPemakaian, ajukanKoreksiPemakaian, setujuiKoreksiPemakaian, tolakKoreksiPemakaian, batalkanKoreksiPemakaian, daftarKoreksiPemakaian } from "../services/koreksiPemakaian.js";
import { rencanakanPosting, jalankanPosting } from "../services/postingPemakaianHistoris.js";

export const pemakaianKoreksiRouter = express.Router();
pemakaianKoreksiRouter.use(requireAuth);
function handleErr(err, res) {
  if (Number.isInteger(err?.statusCode) && err.code) return res.status(err.statusCode).json({ error: err.message, code: err.code, ...(err.penghalang ? { penghalang: err.penghalang } : {}) });
  if (err?.name === "LedgerError") return res.status(409).json({ error: err.message, code: "SALDO_TIDAK_CUKUP" });
  console.error("Rekonsiliasi pemakaian error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}
const kunci = (req) => req.get("Idempotency-Key");
const tulisBahan = requireAnyPermission(P.INVENTORY_WRITE, P.UNIT_MATERIAL_WRITE);

pemakaianKoreksiRouter.get("/units/:id/catatan-historis", requirePermission(P.UNIT_READ), wajibUuid(), async (req, res) => {
  try { res.json(await ambilCatatanHistoris(prisma, req.params.id)); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.post("/catatan-historis/:id/koreksi", tulisBahan, wajibUuid(), async (req, res) => {
  try { const h = await koreksiCatatan(prisma, { noteId: req.params.id, perubahan: { qty: req.body?.qty, uom: req.body?.uom, materialId: req.body?.materialId, usedAt: req.body?.usedAt }, alasan: req.body?.alasan, kunci: kunci(req), aktor: req.user }); res.status(h.ulang ? 200 : 201).json(h); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.post("/catatan-historis/:id/konfirmasi", tulisBahan, wajibUuid(), async (req, res) => {
  try { const h = await konfirmasiCatatan(prisma, { noteId: req.params.id, kodePenanda: req.body?.kodePenanda, alasan: req.body?.alasan, kunci: kunci(req), aktor: req.user }); res.status(h.ulang ? 200 : 201).json(h); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.post("/catatan-historis/:id/kecualikan", tulisBahan, wajibUuid(), async (req, res) => {
  try { const h = await kecualikanCatatan(prisma, { noteId: req.params.id, alasan: req.body?.alasan, kunci: kunci(req), aktor: req.user }); res.status(h.ulang ? 200 : 201).json(h); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.post("/catatan-historis/evaluasi", tulisBahan, async (req, res) => {
  try { res.json(await evaluasiUlang(prisma, { actorId: req.user.id, unitIds: Array.isArray(req.body?.unitIds) ? req.body.unitIds : null })); } catch (e) { handleErr(e, res); }
});

pemakaianKoreksiRouter.post("/units/:id/koreksi-pemakaian/pratinjau", tulisBahan, wajibUuid(), async (req, res) => {
  try { res.json(await pratinjauKoreksiPemakaian(prisma, { unitId: req.params.id, materialId: req.body?.materialId, qtyBaru: req.body?.qtyBaru })); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.post("/units/:id/koreksi-pemakaian", tulisBahan, wajibUuid(), async (req, res) => {
  try { const h = await ajukanKoreksiPemakaian(prisma, { unitId: req.params.id, materialId: req.body?.materialId, qtyBaru: req.body?.qtyBaru, alasan: req.body?.alasan, kunci: kunci(req), aktor: req.user, tanggalEfektif: req.body?.tanggalEfektif }); res.status(h.ulang ? 200 : 201).json(h); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.get("/koreksi-pemakaian", requireAnyPermission(P.INVENTORY_READ, P.UNIT_MATERIAL_WRITE), async (req, res) => {
  try { res.json({ koreksi: await daftarKoreksiPemakaian(prisma, { status: req.query.status ? String(req.query.status) : null, unitId: req.query.unitId ? String(req.query.unitId) : null }) }); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.post("/koreksi-pemakaian/:id/setujui", requirePermission(P.INVENTORY_ADJUSTMENT_APPROVE), wajibUuid(), async (req, res) => {
  try { res.json(await setujuiKoreksiPemakaian(prisma, { koreksiId: req.params.id, aktor: req.user, catatan: req.body?.catatan })); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.post("/koreksi-pemakaian/:id/tolak", requirePermission(P.INVENTORY_ADJUSTMENT_APPROVE), wajibUuid(), async (req, res) => {
  try { res.json(await tolakKoreksiPemakaian(prisma, { koreksiId: req.params.id, aktor: req.user, catatan: req.body?.catatan })); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.post("/koreksi-pemakaian/:id/batal", tulisBahan, wajibUuid(), async (req, res) => {
  try { res.json(await batalkanKoreksiPemakaian(prisma, { koreksiId: req.params.id, aktor: req.user, catatan: req.body?.catatan })); } catch (e) { handleErr(e, res); }
});

pemakaianKoreksiRouter.get("/posting-historis/rencana", requireAnyPermission(P.INVENTORY_ADJUSTMENT_APPROVE, P.INVENTORY_READ), async (_req, res) => {
  try { const r = await rencanakanPosting(prisma); res.json({ hash: r.hash, jumlah: r.jumlah, orderUnik: r.orderUnik, transaksi: r.transaksi }); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.post("/posting-historis/jalankan", requirePermission(P.INVENTORY_ADJUSTMENT_APPROVE), async (req, res) => {
  try { res.json(await jalankanPosting(prisma, { persetujuan: { hashDisetujui: req.body?.hashDisetujui, rujukan: req.body?.rujukan, disetujuiOleh: req.user.name }, aktor: req.user, jurnalHPP: req.body?.jurnalHPP === true })); } catch (e) { handleErr(e, res); }
});
