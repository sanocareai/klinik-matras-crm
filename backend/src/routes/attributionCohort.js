// GET /api/atribusi/kohort — laporan kohort lead → customer → order → pembayaran (FASE 1 atribusi Meta). BACA-SAJA, hanya ADMIN.
//
// Terisolasi: tidak mengubah dan tidak dipakai oleh Dashboard/analytics.js. Tidak ada migrasi. Transaksi dipaksa READ ONLY oleh Postgres
// (services/attribution/cohortReport.js). Respons hanya agregat — tanpa ID, nama, nomor, isi chat, dan tanpa field campaign/ad.
//
// Query: ?dari=YYYY-MM&sampai=YYYY-MM  (bulan WIB, inklusif; default 4 bulan terakhir; maksimum 24 bulan).
import express from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { parseRentang, hitungLaporanKohort, ParameterError } from "../services/attribution/cohortReport.js";

export const attributionCohortRouter = express.Router();
attributionCohortRouter.use(requireAuth, requireAdmin);

// Satu perhitungan sekaligus per proses: laporan ini memuat seluruh customer sampai bulan akhir, tidak perlu dijalankan paralel.
let sedangBerjalan = false;

attributionCohortRouter.get("/", async (req, res) => {
  let rentang;
  try {
    rentang = parseRentang(req.query);
  } catch (err) {
    if (err instanceof ParameterError) return res.status(400).json({ error: err.message, code: err.code });
    throw err;
  }
  if (sedangBerjalan) return res.status(429).json({ error: "Laporan kohort sedang dihitung; coba lagi sebentar", code: "SEDANG_DIHITUNG" });
  sedangBerjalan = true;
  try {
    const laporan = await hitungLaporanKohort(prisma, rentang);
    res.set("Cache-Control", "no-store");
    return res.json(laporan);
  } catch (err) {
    console.error("atribusi/kohort error:", err?.message || err);
    return res.status(500).json({ error: "Gagal menghitung laporan kohort" });
  } finally {
    sedangBerjalan = false;
  }
});
