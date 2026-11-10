// HPP PER ORDER (Nov 2026) — /api/finance/hpp-order/*. requireAuth dipasang PER RUTE (router di-mount di /api/finance).
//   GET  /hpp-order/antrean?from&to&status&q          antrean unit terkirim untuk PIC (baca)
//   GET  /hpp-order/unit/:unitId                      rincian satu unit (baca)
//   POST /hpp-order/biaya-tanpa-stok/pratinjau        pratinjau jalur + harga + kandidat ganda (TIDAK menulis)
//   POST /hpp-order/biaya-tanpa-stok                  ajukan (Idempotency-Key wajib) — tanpa stok, tanpa jurnal
//   GET  /hpp-order/biaya-tanpa-stok?status           daftar (persetujuan)
//   GET  /hpp-order/biaya-tanpa-stok/:id/riwayat      jejak audit
//   POST /hpp-order/biaya-tanpa-stok/:id/setujui      ADMIN, orang lain dari pencatat
//   POST /hpp-order/biaya-tanpa-stok/:id/tolak        ADMIN, orang lain dari pencatat
//   POST /hpp-order/biaya-tanpa-stok/:id/batalkan     pencatat (DIAJUKAN) atau ADMIN
//   POST /hpp-order/unit/:unitId/konfirmasi           konfirmasi pemakaian lengkap (Idempotency-Key wajib)
//   POST /hpp-order/unit/:unitId/cabut-konfirmasi     cabut konfirmasi (alasan)
//   GET  /hpp-order/laporan?from&to                   laporan berdampingan (baca; nominal hanya finance:read)
// Tidak ada rute yang menulis stok, jurnal, saldo, PSA, atau cutover.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAnyPermission, PERMISSIONS as P, hasPermission } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import {
  HppOrderError, antreanHpp, rincianUnit, pratinjauBiayaTanpaStok, ajukanBiayaTanpaStok, daftarBiayaTanpaStok, riwayatBiayaTanpaStok,
  setujuiBiayaTanpaStok, akhiriBiayaTanpaStok, konfirmasiLengkap, cabutKonfirmasi, laporanHppOrder, bolehNominal, bolehMenyetujui, adminBahan, SUMBER_JENIS,
} from "../services/finance/hppOrder.js";
import { DASAR_HARGA } from "../lib/domain/hppOrder.js";
import { LaporanTerinciError } from "../services/finance/laporanTerinci/index.js";
import { PembetulanError } from "../services/pembetulanBahanUnit.js";

export const financeHppOrderRouter = express.Router();
const baca = [requireAuth, requireAnyPermission(P.FINANCE_READ, P.UNIT_MATERIAL_WRITE, P.PRODUCTION_REPORT_READ)];
const tulis = [requireAuth, requireAnyPermission(P.UNIT_MATERIAL_WRITE, P.FINANCE_APPROVE)];

function galat(e, res) {
  if (e instanceof HppOrderError || e instanceof LaporanTerinciError || e instanceof PembetulanError) return res.status(e.statusCode).json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.detail ? { detail: e.detail } : {}) });
  if (/immutable/.test(String(e?.message || ""))) return res.status(409).json({ error: "Data biaya ini sudah terkunci; koreksi lewat entri pengganti.", code: "TERKUNCI" });
  console.error("[hpp-order]", e);
  return res.status(500).json({ error: "Terjadi kesalahan di server" });
}
const kunciDari = (req) => String(req.get("Idempotency-Key") || req.body?.kunci || "");
const periode = (q) => ({ fromStr: String(q.from || ""), toStr: String(q.to || "") });

financeHppOrderRouter.get("/hpp-order/meta", ...baca, (req, res) => {
  res.json({ izin: { nominal: bolehNominal(req.user), mencatat: hasPermission(req.user, P.UNIT_MATERIAL_WRITE), menyetujui: bolehMenyetujui(req.user), otomatis: adminBahan(req.user),
    menyatakanTanpaBahan: hasPermission(req.user, P.UNIT_ROUTING_WRITE) }, sumberJenis: SUMBER_JENIS, dasarHarga: DASAR_HARGA, userId: req.user.id });
});
financeHppOrderRouter.get("/hpp-order/antrean", ...baca, async (req, res) => {
  try { res.set("Cache-Control", "no-store"); res.json(await antreanHpp(prisma, { ...periode(req.query), izinHarga: bolehNominal(req.user), status: req.query.status ?? "", q: req.query.q ?? "" })); } catch (e) { galat(e, res); }
});
financeHppOrderRouter.get("/hpp-order/unit/:unitId", ...baca, async (req, res) => {
  try { res.json(await rincianUnit(prisma, req.params.unitId, { izinHarga: bolehNominal(req.user) })); } catch (e) { galat(e, res); }
});
financeHppOrderRouter.post("/hpp-order/biaya-tanpa-stok/pratinjau", ...tulis, async (req, res) => {
  try { res.json(await pratinjauBiayaTanpaStok(prisma, req.user, req.body || {})); } catch (e) { galat(e, res); }
});
financeHppOrderRouter.post("/hpp-order/biaya-tanpa-stok", ...tulis, async (req, res) => {
  try { const r = await ajukanBiayaTanpaStok(prisma, req.user, req.body || {}, { kunci: kunciDari(req) }); res.status(r.ulang ? 200 : 201).json(r); } catch (e) { galat(e, res); }
});
financeHppOrderRouter.get("/hpp-order/biaya-tanpa-stok", ...baca, async (req, res) => {
  try { res.json(await daftarBiayaTanpaStok(prisma, { status: req.query.status ?? "DIAJUKAN", unitId: req.query.unitId || null, izinHarga: bolehNominal(req.user) })); } catch (e) { galat(e, res); }
});
financeHppOrderRouter.get("/hpp-order/biaya-tanpa-stok/:id/riwayat", ...baca, async (req, res) => {
  try { res.json({ events: await riwayatBiayaTanpaStok(prisma, req.params.id) }); } catch (e) { galat(e, res); }
});
financeHppOrderRouter.post("/hpp-order/biaya-tanpa-stok/:id/setujui", ...tulis, async (req, res) => {
  try { res.json(await setujuiBiayaTanpaStok(prisma, req.user, { id: req.params.id, catatan: req.body?.catatan ?? null, keputusanHarga: req.body?.keputusanHarga ?? null })); } catch (e) { galat(e, res); }
});
financeHppOrderRouter.post("/hpp-order/biaya-tanpa-stok/:id/tolak", ...tulis, async (req, res) => {
  try { res.json(await akhiriBiayaTanpaStok(prisma, req.user, { id: req.params.id, aksi: "TOLAK", alasan: req.body?.alasan })); } catch (e) { galat(e, res); }
});
financeHppOrderRouter.post("/hpp-order/biaya-tanpa-stok/:id/batalkan", ...tulis, async (req, res) => {
  try { res.json(await akhiriBiayaTanpaStok(prisma, req.user, { id: req.params.id, aksi: "BATALKAN", alasan: req.body?.alasan })); } catch (e) { galat(e, res); }
});
financeHppOrderRouter.post("/hpp-order/unit/:unitId/konfirmasi", ...tulis, async (req, res) => {
  try { const r = await konfirmasiLengkap(prisma, req.user, { unitId: req.params.unitId, sidik: req.body?.sidik, alasan: req.body?.alasan }, { kunci: kunciDari(req) }); res.status(r.ulang ? 200 : 201).json(r); } catch (e) { galat(e, res); }
});
financeHppOrderRouter.post("/hpp-order/unit/:unitId/cabut-konfirmasi", ...tulis, async (req, res) => {
  try { res.json(await cabutKonfirmasi(prisma, req.user, { unitId: req.params.unitId, alasan: req.body?.alasan })); } catch (e) { galat(e, res); }
});
financeHppOrderRouter.get("/hpp-order/laporan", ...baca, async (req, res) => {
  try { res.set("Cache-Control", "no-store"); res.json(await laporanHppOrder(prisma, { ...periode(req.query), izinHarga: bolehNominal(req.user), bolehSensitif: hasPermission(req.user, P.FINANCE_ADMIN) })); } catch (e) { galat(e, res); }
});
