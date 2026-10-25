// REKONSILIASI PEMAKAIAN — catatan historis, koreksi (catatan · pemakaian per order), dan posting terpadu. Mount: /api/production.
//   Baca        : GET  /units/:id/catatan-historis
//   Catatan     : POST /catatan-historis/:id/{koreksi|konfirmasi|kecualikan}          (tanpa efek stok; Idempotency-Key wajib)
//   Pemakaian   : POST /units/:id/koreksi-pemakaian[/pratinjau] · GET /koreksi-pemakaian · POST /koreksi-pemakaian/:id/{setujui|tolak|batal}   (efek stok; penyetuju ≠ pemohon)
//   Posting     : GET  /posting-historis/rencana · POST /posting-historis/jalankan    (hanya rencana yang hash-nya disetujui; izin inventory:adjustment_approve)
//                 jalankan & batch: SEMENTARA hanya akun OWNER yang memulai (403 HANYA_OWNER_MEMULAI); WAJIB membawa konfirmasiManifest (hash, unitIds, isiTransaksi, saldoManifest, daftarOrder, jumlahOrder, jumlahTrx, rujukan[, saldoSyarat])
//                 — selisih dengan rencana server → 409 KONFIRMASI_MANIFEST_TIDAK_COCOK sebelum apa pun dibuat. Konfirmasi manifest BUKAN bukti persetujuan Owner terpisah (lihat services/postingKonfirmasiManifest.js).
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
import { ajukanBatch, mulaiBatch, statusBatchBersama, daftarBatch, lanjutkanBatch, hentikanBatch } from "../services/postingBatchLatar.js";
import { pratinjauPosting } from "../services/postingPratinjau.js";

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
  try { res.json(await evaluasiUlang(prisma, { actorId: req.user.id })); } catch (e) { handleErr(e, res); }
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

/** konfirmasiManifest dari badan permintaan: hanya bentuk datanya yang dinormalisasi; semua pembandingan ke rencana dilakukan di service (wajibKonfirmasiManifest). */
function bacaKonfirmasi(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw Object.assign(new Error("konfirmasiManifest harus objek"), { statusCode: 400, code: "KONFIRMASI_MANIFEST_TIDAK_VALID" });
  return { hash: raw.hash, unitIds: raw.unitIds, daftarOrder: raw.daftarOrder, jumlahOrder: raw.jumlahOrder, jumlahTrx: raw.jumlahTrx, rujukan: raw.rujukan, isiTransaksi: raw.isiTransaksi, saldoManifest: raw.saldoManifest, digestIsi: raw.digestIsi, saldoSyarat: raw.saldoSyarat };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** unitIds opsional (posting SATU order / sebagian): daftar UUID unit; kosong = seluruh rencana. */
function bacaUnitIds(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const arr = Array.isArray(raw) ? raw : String(raw).split(",");
  const ids = arr.map((x) => String(x).trim()).filter(Boolean);
  if (!ids.length || ids.length > 500 || !ids.every((x) => UUID_RE.test(x))) throw Object.assign(new Error("unitIds harus berisi 1–500 UUID unit"), { statusCode: 400, code: "UNIT_IDS_TIDAK_VALID" });
  return ids;
}
pemakaianKoreksiRouter.get("/posting-historis/rencana", requireAnyPermission(P.INVENTORY_ADJUSTMENT_APPROVE, P.INVENTORY_READ), async (req, res) => {
  try { const r = await rencanakanPosting(prisma, { unitIds: bacaUnitIds(req.query?.unitIds) }); res.json({ hash: r.hash, jumlah: r.jumlah, orderUnik: r.orderUnik, transaksi: r.transaksi }); } catch (e) { handleErr(e, res); }
});
// Pratinjau manifest + dampak (stok, HPP berbukti, tanpa harga, tertahan, selisih belum dijurnal). BACA-SAJA; hash = pin persetujuan untuk jalankan/batch.
pemakaianKoreksiRouter.get("/posting-historis/pratinjau", requireAnyPermission(P.INVENTORY_ADJUSTMENT_APPROVE, P.INVENTORY_READ), async (req, res) => {
  try { res.json(await pratinjauPosting(prisma, { unitIds: bacaUnitIds(req.query?.unitIds) })); } catch (e) { handleErr(e, res); }
});
// Sinkron: untuk SATU order / sebagian kecil (unitIds). Rencana besar (puluhan–ratusan order) lewat batch latar di bawah — jangan menahan satu permintaan layar belasan menit.
pemakaianKoreksiRouter.post("/posting-historis/jalankan", requirePermission(P.INVENTORY_ADJUSTMENT_APPROVE), async (req, res) => {
  try { res.json(await jalankanPosting(prisma, { persetujuan: { hashDisetujui: req.body?.hashDisetujui, rujukan: req.body?.rujukan, disetujuiOleh: req.user.name, konfirmasi: bacaKonfirmasi(req.body?.konfirmasiManifest) }, aktor: req.user, jurnalHPP: req.body?.jurnalHPP === true, unitIds: bacaUnitIds(req.body?.unitIds) })); } catch (e) { handleErr(e, res); }
});
// Batch di latar: 202 + id (= hash rencana yang disetujui; idempoten). Progres lewat GET; kelanjutan setelah putus lewat pulihan saat boot atau POST …/lanjut.
pemakaianKoreksiRouter.post("/posting-historis/batch", requirePermission(P.INVENTORY_ADJUSTMENT_APPROVE), async (req, res) => {
  try {
    const b = await ajukanBatch(prisma, { persetujuan: { hashDisetujui: req.body?.hashDisetujui, rujukan: req.body?.rujukan, disetujuiOleh: req.user.name, konfirmasi: bacaKonfirmasi(req.body?.konfirmasiManifest) }, aktor: req.user, jurnalHPP: req.body?.jurnalHPP === true, unitIds: bacaUnitIds(req.body?.unitIds) });
    mulaiBatch(prisma, b.batchId); // tidak ditunggu
    res.status(202).json(b);
  } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.get("/posting-historis/batch", requireAnyPermission(P.INVENTORY_ADJUSTMENT_APPROVE, P.INVENTORY_READ), async (_req, res) => {
  try { res.json({ batch: await daftarBatch(prisma, { limit: 10 }) }); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.get("/posting-historis/batch/:id", requireAnyPermission(P.INVENTORY_ADJUSTMENT_APPROVE, P.INVENTORY_READ), async (req, res) => {
  try { res.json(await statusBatchBersama(prisma, req.params.id)); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.post("/posting-historis/batch/:id/lanjut", requirePermission(P.INVENTORY_ADJUSTMENT_APPROVE), async (req, res) => {
  try { res.status(202).json(await lanjutkanBatch(prisma, req.params.id, req.user)); } catch (e) { handleErr(e, res); }
});
pemakaianKoreksiRouter.post("/posting-historis/batch/:id/hentikan", requirePermission(P.INVENTORY_ADJUSTMENT_APPROVE), async (req, res) => {
  try { res.json(await hentikanBatch(prisma, req.params.id, req.user)); } catch (e) { handleErr(e, res); }
});
