// /api/atribusi/iklan — Fase 2 atribusi CTWA: laporan lead & closing per campaign/ad set/ad, referensi pemetaan Ad ID, ekspor ID. HANYA ADMIN.
//
//   GET  /                 ?dari=YYYY-MM-DD&sampai=YYYY-MM-DD (WAJIB, maks 93 hari)&level=campaign|adset|ad&rincian=0|1   (baca-saja, transaksi READ ONLY; atribusi utama = CTWA_AD)
//   GET  /kesehatan        agregat kesehatan capture touch (rekam/gagal/dipulihkan/pending + usia); tanpa identitas (baca-saja)
//   GET  /referensi        daftar referensi Ad→AdSet→Campaign + Ad ID yang belum terpetakan (baca-saja)
//   POST /referensi        impor pemetaan tervalidasi dari ekspor Ads Manager. dryRun DEFAULT true. Menulis HANYA ke meta_ad_references/_imports.
//   GET  /ekspor-id        ?format=json|csv  — satu baris per Ad ID (tanpa data customer) untuk join dengan data spend (Windsor)
//
// Terisolasi: tidak mengubah Dashboard/analytics.js; tidak ada migrasi data lama. Respons hanya agregat/ID iklan (tanpa nomor, nama, chat, clid).
import express from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { parseParameterIklan, hitungLaporanIklan, eksporIdIklan, ParameterError } from "../services/attribution/iklanReport.js";
import { hitungKesehatanCapture } from "../services/attribution/captureHealth.js";
import { hitungD7 } from "../services/attribution/d7.js";
import { pasangRuteSpend } from "./attributionSpend.js";
import { barisDariCsv, jalankanImpor, sidikJari, MAKS_BARIS_IMPOR } from "../services/attribution/adReferensi.js";

export const attributionAdsRouter = express.Router();
attributionAdsRouter.use(requireAuth, requireAdmin);
pasangRuteSpend(attributionAdsRouter);   // Fase 3: /spend, /target, /monitor

let sedangBerjalan = false;   // satu perhitungan laporan sekaligus per proses

attributionAdsRouter.get("/", async (req, res) => {
  let parameter;
  try { parameter = parseParameterIklan(req.query); }
  catch (err) {
    if (err instanceof ParameterError) return res.status(400).json({ error: err.message, code: err.code });
    throw err;
  }
  if (sedangBerjalan) return res.status(429).json({ error: "Laporan atribusi iklan sedang dihitung; coba lagi sebentar", code: "SEDANG_DIHITUNG" });
  sedangBerjalan = true;
  try {
    const laporan = await hitungLaporanIklan(prisma, parameter);
    res.set("Cache-Control", "no-store");
    return res.json(laporan);
  } catch (err) {
    console.error("atribusi/iklan error:", err?.code || err?.name || "ERROR");   // tanpa pesan: galat Prisma bisa memuat nilai kueri
    return res.status(500).json({ error: "Gagal menghitung laporan atribusi iklan" });
  } finally {
    sedangBerjalan = false;
  }
});

// D7: kohort dengan observasi 7 hari PENUH, dari histori (baca-saja). ?dari&sampai (kosong = bawaan periode penuh). Berbagi penjaga konkurensi dengan laporan utama.
attributionAdsRouter.get("/d7", async (req, res) => {
  let parameter;
  try { parameter = parseParameterIklan({ dari: req.query.dari, sampai: req.query.sampai }); }
  catch (err) {
    if (err instanceof ParameterError) return res.status(400).json({ error: err.message, code: err.code });
    throw err;
  }
  if (sedangBerjalan) return res.status(429).json({ error: "Laporan atribusi iklan sedang dihitung; coba lagi sebentar", code: "SEDANG_DIHITUNG" });
  sedangBerjalan = true;
  try {
    const hasil = await hitungD7(prisma, { dari: parameter.dari, sampai: parameter.sampai, hariIni: parameter.hariIni });
    res.set("Cache-Control", "no-store");
    return res.json(hasil);
  } catch (err) {
    console.error("atribusi/iklan/d7 error:", err?.code || err?.name || "ERROR");
    return res.status(500).json({ error: "Gagal menghitung D7 atribusi iklan" });
  } finally {
    sedangBerjalan = false;
  }
});

attributionAdsRouter.get("/kesehatan", async (_req, res) => {
  try {
    const hasil = await hitungKesehatanCapture(prisma);
    res.set("Cache-Control", "no-store");
    return res.json(hasil);
  } catch (err) {
    console.error("atribusi/iklan/kesehatan error:", err?.code || err?.name || "ERROR");
    return res.status(500).json({ error: "Gagal memuat kesehatan capture" });
  }
});

attributionAdsRouter.get("/referensi", async (_req, res) => {
  try {
    const refs = await prisma.metaAdReference.findMany({
      orderBy: [{ campaignId: "asc" }, { adSetId: "asc" }, { adId: "asc" }],
      select: { adId: true, adSetId: true, campaignId: true, adName: true, adSetName: true, campaignName: true, source: true, syncedAt: true },
    });
    const ids = await eksporIdIklan(prisma);
    res.set("Cache-Control", "no-store");
    return res.json({
      jumlah: refs.length, referensi: refs,
      tidakTerpetakan: ids.filter((x) => x.status === "UNMAPPED").map((x) => ({ adId: x.adId, touch: x.touch, pertama: x.pertama, terakhir: x.terakhir })),
      sumberTersedia: ["ADS_MANAGER_EXPORT", "MANUAL"],
      catatan: "MARKETING_API belum dikonfigurasi (tidak ada kredensial Meta di sistem ini).",
    });
  } catch (err) {
    console.error("atribusi/iklan/referensi error:", err?.code || err?.name || "ERROR");   // tanpa pesan: galat Prisma bisa memuat nilai kueri
    return res.status(500).json({ error: "Gagal memuat referensi iklan" });
  }
});

attributionAdsRouter.post("/referensi", async (req, res) => {
  try {
    const b = req.body || {};
    let rows = b.rows;
    let sidik = null;
    if (typeof b.csv === "string") {
      if (b.csv.length > 2_000_000) return res.status(413).json({ error: "berkas terlalu besar" });
      const p = barisDariCsv(b.csv);
      if (p.galat) return res.status(400).json({ error: `CSV tidak dapat dibaca: ${p.galat}`, code: p.galat });
      rows = p.baris; sidik = sidikJari(b.csv);
    }
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "kirim `csv` (teks) atau `rows` (array)" });
    if (rows.length > MAKS_BARIS_IMPOR) return res.status(413).json({ error: `maksimum ${MAKS_BARIS_IMPOR} baris` });
    const dryRun = b.dryRun !== false;   // DEFAULT true: harus eksplisit dryRun:false untuk menulis
    const hasil = await jalankanImpor(prisma, {
      rows, sumber: b.sumber || "ADS_MANAGER_EXPORT", dryRun, izinkanKoreksi: b.izinkanKoreksi === true,
      namaBerkas: b.namaBerkas, sidik, userId: req.user?.id || null,
    });
    return res.json({ dryRun: hasil.dryRun, ringkasan: hasil.ringkasan, importId: hasil.importId || null, ditolak: hasil.rencana.ditolak, konflik: hasil.rencana.konflik, koreksi: hasil.rencana.koreksi.map((r) => ({ adId: r.adId, sebelumnya: r.sebelumnya, menjadi: { adSetId: r.adSetId, campaignId: r.campaignId } })) });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error("atribusi/iklan/referensi POST error:", err?.code || err?.name || "ERROR");   // tanpa pesan: galat Prisma bisa memuat nilai kueri
    return res.status(500).json({ error: "Gagal memproses impor referensi" });
  }
});

attributionAdsRouter.get("/ekspor-id", async (req, res) => {
  try {
    const baris = await eksporIdIklan(prisma);
    res.set("Cache-Control", "no-store");
    if (req.query.format === "csv") {
      const esc = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const kol = ["campaignId", "adSetId", "adId", "status", "campaignName", "adSetName", "adName", "touch", "pertama", "terakhir"];
      const csv = [kol.join(","), ...baris.map((r) => kol.map((k) => esc(r[k] instanceof Date ? r[k].toISOString() : r[k])).join(","))].join("\n");
      res.set("Content-Type", "text/csv; charset=utf-8");
      return res.send(csv);
    }
    return res.json({ jumlah: baris.length, iklan: baris });
  } catch (err) {
    console.error("atribusi/iklan/ekspor-id error:", err?.code || err?.name || "ERROR");   // tanpa pesan: galat Prisma bisa memuat nilai kueri
    return res.status(500).json({ error: "Gagal mengekspor ID iklan" });
  }
});
