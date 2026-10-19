// PUSAT KERJA GUDANG (UX Tahap 4) — baca-saja (inventory:read). Semua hitungan dari services/gudangPusatKerja.js (definisi antrean ikut di respons).
//   GET /api/inventory/pusat-kerja               Beranda: perlu dikerjakan (antrean per jenis), terlambat/tertahan (per sebab), selesai terbaru
//   GET /api/inventory/pusat-kerja/antrean/:kode antrean tunggal berhalaman (?offset=&limit=)
//   GET /api/inventory/pusat-kerja/tertahan/:kode sebab tertahan tunggal berhalaman
//   GET /api/inventory/pusat-kerja/perhatian     Pusat Masalah: pengecualian nyata + dampak + pemilik + tindakan resmi + cakupan
//   GET /api/inventory/pusat-kerja/cari?q=       pencarian lintas dokumen Gudang (>= 2 karakter)
// Endpoint ini TIDAK menulis apa pun. Tombol aksi hanya dikembalikan bila pengguna memegang izin; server aksi tetap menegakkan ulang.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { pusatKerja, perluPerhatian, cariGudang, selesai } from "../services/gudangPusatKerja.js";
import { PRODUCTION_READER_MODE, loadV2Flags, resolveProductionReaderState } from "../services/v2FeatureFlags.js";
import { getWarehouseProductionQueue } from "../services/productionExperienceReadService.js";

export const gudangPusatKerjaRouter = express.Router();
gudangPusatKerjaRouter.use(requireAuth);
gudangPusatKerjaRouter.use(requirePermission(P.INVENTORY_READ));

const galat = (err, res) => { console.error("Pusat kerja gudang error:", err); return res.status(500).json({ error: pesanServerAman(err) }); };
const bulat = (v, awal, min, maks) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(maks, Math.max(min, n)) : awal; };

/** Antrean Gudang Produksi V2 hanya bila pembaca Produksi V2 aktif (kohort); selain itu null (tidak dihitung, dinyatakan di respons). */
async function antreanProduksi() {
  try {
    const state = resolveProductionReaderState(await loadV2Flags(prisma));
    if (state.mode === PRODUCTION_READER_MODE.OFF) return null;
    const unitIds = [...state.unitIds]; if (!unitIds.length) return null;
    return await getWarehouseProductionQueue(prisma, { unitIds });
  } catch (e) { console.error("antrean produksi V2 gagal dibaca:", e?.message); return null; }
}

gudangPusatKerjaRouter.get("/", async (req, res) => {
  try { res.json(await pusatKerja(prisma, { user: req.user, batas: bulat(req.query.batas, 8, 1, 50), antreanProduksi: await antreanProduksi() })); } catch (e) { galat(e, res); }
});
gudangPusatKerjaRouter.get("/antrean/:kode", async (req, res) => {
  try {
    const p = await pusatKerja(prisma, { user: req.user, batas: 5000, antreanProduksi: await antreanProduksi() });
    const a = p.antrean.find((x) => x.kode === req.params.kode); if (!a) return res.status(404).json({ error: "Antrean tidak dikenal", code: "ANTREAN_TIDAK_ADA" });
    const offset = bulat(req.query.offset, 0, 0, 100000); const limit = bulat(req.query.limit, 20, 1, 100);
    res.json({ kode: a.kode, judul: a.judul, definisi: a.definisi, jumlah: a.jumlah, offset, limit, item: a.item.slice(offset, offset + limit), lebih: Math.max(0, a.jumlah - offset - limit) });
  } catch (e) { galat(e, res); }
});
gudangPusatKerjaRouter.get("/tertahan/:kode", async (req, res) => {
  try {
    const p = await pusatKerja(prisma, { user: req.user, batas: 5000, antreanProduksi: await antreanProduksi() });
    const a = p.tertahan.find((x) => x.kode === req.params.kode); if (!a) return res.status(404).json({ error: "Sebab tidak dikenal", code: "SEBAB_TIDAK_ADA" });
    const offset = bulat(req.query.offset, 0, 0, 100000); const limit = bulat(req.query.limit, 20, 1, 100);
    res.json({ kode: a.kode, judul: a.judul, definisi: a.definisi, jumlah: a.jumlah, offset, limit, item: a.item.slice(offset, offset + limit), lebih: Math.max(0, a.item.length - offset - limit) });
  } catch (e) { galat(e, res); }
});
gudangPusatKerjaRouter.get("/selesai", async (_req, res) => { try { res.json({ selesaiTerbaru: await selesai(prisma) }); } catch (e) { galat(e, res); } });
gudangPusatKerjaRouter.get("/perhatian", async (req, res) => { try { res.json(await perluPerhatian(prisma, { user: req.user, batas: bulat(req.query.batas, 8, 1, 50) })); } catch (e) { galat(e, res); } });
gudangPusatKerjaRouter.get("/cari", async (req, res) => { try { res.json(await cariGudang(prisma, { q: req.query.q, batas: bulat(req.query.batas, 6, 1, 20), user: req.user })); } catch (e) { galat(e, res); } });
