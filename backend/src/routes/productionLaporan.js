// LAPORAN PRODUKSI TERPADU — /api/production-v2/laporan/*. BACA-SAJA (tidak ada mutasi). requireAuth sudah dipasang di productionExperienceRouter.
// Empat tab: ringkasan · biaya-order · kinerja · bahan-gudang. Cakupan = SEMUA unit non-batal (bukan hanya kohort rencana V2). Periode = hari kalender WIB (`from`/`to`, standar DateRangePicker app).
// IZIN (diputuskan di server, bukan hanya UI):
//   PRODUCTION_REPORT_READ (ADMIN/OWNER/Production Lead) → ringkasan, biaya-order, kinerja, bahan-gudang · PRODUCTION_REPORT_WAREHOUSE (Gudang) → hanya bahan-gudang.
//   NOMINAL (Rp: HPP, harga, subtotal, susut) hanya untuk pemegang FINANCE_READ; selain itu nilai dikirim null dan kolom Rp dibuang dari Excel.
import express from "express";
import { prisma } from "../db.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { DASAR_TANGGAL, bahanGudang, bangunKonteks, biayaPerOrder, kinerja, ringkasOrder, ringkasan, rincianOrder, saringUrutOrder } from "../services/laporanProduksi.js";
import { DEFINISI, buatBerkas } from "../services/laporanProduksiDokumen.js";
import { MASALAH, STATUS_BIAYA } from "../lib/domain/laporanProduksi.js";

export const productionLaporanRouter = express.Router();
const UUID_ATAU_CUID = /^[A-Za-z0-9_-]{8,64}$/;
const TABS = ["ringkasan", "biaya-order", "kinerja", "bahan-gudang"];

const caps = (u) => {
  const full = hasPermission(u, P.PRODUCTION_REPORT_READ);
  return { full, gudang: full || hasPermission(u, P.PRODUCTION_REPORT_WAREHOUSE), harga: hasPermission(u, P.FINANCE_READ), targetWrite: hasPermission(u, P.PRODUCTION_TARGET_WRITE), self: hasPermission(u, P.PRODUCTION_REPORT_SELF) };
};
const boleh = (c, tab) => (tab === "bahan-gudang" ? c.gudang : c.full);
const deny = (res) => res.status(403).json({ error: "Anda tidak punya akses ke laporan ini", code: "REPORT_FORBIDDEN" });
function galat(err, res) {
  if (Number.isInteger(err?.statusCode)) return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  console.error("[laporan-produksi]", err);
  return res.status(500).json({ error: "Terjadi kesalahan di server" });
}
const halaman = (q) => { const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 25)); const page = Math.max(1, Number(q.page) || 1); return { page, pageSize }; };
const sorot = (o) => { const { unit, ...rest } = o; return { ...rest, unitKode: unit.map((u) => u.unitCode) }; };

productionLaporanRouter.get("/meta", (req, res) => {
  const c = caps(req.user);
  if (!c.gudang && !c.self) return deny(res);
  res.set("Cache-Control", "no-store");
  res.json({
    capabilities: { ringkasan: c.full, biayaOrder: c.full, kinerja: c.full, bahanGudang: c.gudang, harga: c.harga, targetWrite: c.targetWrite, self: c.self },
    definisi: DEFINISI, masalah: Object.fromEntries(Object.entries(MASALAH).map(([k, v]) => [k, { label: v.label, aksi: v.aksi }])),
    statusBiaya: Object.values(STATUS_BIAYA).map(({ key, label, tone }) => ({ key, label, tone })), dasarTanggal: DASAR_TANGGAL,
  });
});

async function konteks(req) { return bangunKonteks(prisma, { from: req.query.from, to: req.query.to, termasukMasuk: req.query.termasukMasuk }); }

productionLaporanRouter.get("/ringkasan", async (req, res) => {
  try {
    const c = caps(req.user); if (!boleh(c, "ringkasan")) return deny(res);
    const ctx = await konteks(req);
    res.set("Cache-Control", "no-store");
    res.json({ dasarTanggal: DASAR_TANGGAL, cakupan: { unitNonBatal: ctx.units.length, pergerakanDiluarCakupan: ctx.movKeluarUnit }, ...(await ringkasan(prisma, ctx, { izinHarga: c.harga })) });
  } catch (err) { galat(err, res); }
});

productionLaporanRouter.get("/biaya-order", async (req, res) => {
  try {
    const c = caps(req.user); if (!boleh(c, "biaya-order")) return deny(res);
    const ctx = await konteks(req);
    const { orders } = await biayaPerOrder(prisma, ctx, { izinHarga: c.harga });
    const hasil = saringUrutOrder(orders, req.query);
    const { page, pageSize } = halaman(req.query);
    res.set("Cache-Control", "no-store");
    res.json({
      periode: { from: ctx.periode.from, to: ctx.periode.to, days: ctx.periode.days }, dasarTanggal: DASAR_TANGGAL.biaya, izinHarga: c.harga,
      ringkas: ringkasOrder(hasil), // SELURUH hasil setelah filter (bukan halaman): kartu, grafik, dan Excel memakai angka ini
      total: hasil.length, page, pageSize, rows: hasil.slice((page - 1) * pageSize, page * pageSize).map(sorot),
      cakupan: { unitNonBatal: ctx.units.length, orderRelevan: orders.length, pergerakanDiluarCakupan: ctx.movKeluarUnit },
    });
  } catch (err) { galat(err, res); }
});

productionLaporanRouter.get("/biaya-order/:orderId", async (req, res) => {
  try {
    const c = caps(req.user); if (!boleh(c, "biaya-order")) return deny(res);
    if (!UUID_ATAU_CUID.test(req.params.orderId)) return res.status(404).json({ error: "Order tidak ditemukan", code: "REPORT_NOT_FOUND" });
    const ctx = await konteks(req);
    const { orders } = await biayaPerOrder(prisma, ctx, { izinHarga: c.harga });
    const o = orders.find((x) => x.orderId === req.params.orderId);
    if (!o) return res.status(404).json({ error: "Order tidak ada pada periode/filter ini", code: "REPORT_NOT_FOUND" });
    res.set("Cache-Control", "no-store");
    res.json({ periode: { from: ctx.periode.from, to: ctx.periode.to }, dasarTanggal: DASAR_TANGGAL.biaya, izinHarga: c.harga, ...rincianOrder(o, { izinHarga: c.harga }), definisiMasalah: MASALAH,
      catatanFinance: c.harga ? "Nilai persediaan/jurnal Finance berbeda sumber (biaya perolehan PSA/GR) dan tidak dijumlahkan di sini; lihat Finance → Biaya Bahan per Unit." : null,
      catatanGuard: o.adaGuard ? "Order ini memakai SANO GUARD (bahan produksi internal). Hubungan biaya perakitannya ke bahan penyusun belum tersedia, sehingga nilainya TIDAK dijumlahkan sebagai biaya terbukti (risiko hitung ganda dengan bahan penyusun)." : null });
  } catch (err) { galat(err, res); }
});

productionLaporanRouter.get("/kinerja", async (req, res) => {
  try {
    const c = caps(req.user); if (!boleh(c, "kinerja")) return deny(res);
    const ctx = await konteks(req);
    const { _selesai, ...doc } = await kinerja(prisma, ctx, { peran: req.query.peran === "CORNER" ? "CORNER" : "MEJA" });
    res.set("Cache-Control", "no-store");
    res.json({ periode: { from: ctx.periode.from, to: ctx.periode.to, days: ctx.periode.days }, dasarTanggal: DASAR_TANGGAL.selesai, dasarJadwal: DASAR_TANGGAL.jadwal, ...doc });
  } catch (err) { galat(err, res); }
});

productionLaporanRouter.get("/bahan-gudang", async (req, res) => {
  try {
    const c = caps(req.user); if (!boleh(c, "bahan-gudang")) return deny(res);
    const ctx = await konteks(req);
    const g = await bahanGudang(prisma, ctx, { izinHarga: c.harga, q: req.query.q });
    const { page, pageSize } = halaman(req.query);
    res.set("Cache-Control", "no-store");
    res.json({ periode: { from: ctx.periode.from, to: ctx.periode.to, days: ctx.periode.days }, dasarTanggal: DASAR_TANGGAL.biaya, dasarPermintaan: DASAR_TANGGAL.permintaan, izinHarga: c.harga, permintaan: g.permintaan, kelengkapan: g.kelengkapan, total: g.total, totalBahan: g.bahan.length, page, pageSize,
      rows: g.bahan.slice((page - 1) * pageSize, page * pageSize).map(({ ...r }) => r) });
  } catch (err) { galat(err, res); }
});

// GET /export?tab=ringkasan|biaya-order|kinerja|bahan-gudang&format=xlsx + periode & filter yang sama dengan tab. SELURUH hasil (bukan halaman).
productionLaporanRouter.get("/export", async (req, res) => {
  try {
    const tab = String(req.query.tab || "ringkasan"); const format = String(req.query.format || "xlsx");
    if (!TABS.includes(tab)) return res.status(400).json({ error: "Tab tidak dikenal", code: "REPORT_TAB_INVALID" });
    if (format !== "xlsx") return res.status(400).json({ error: "Format harus xlsx", code: "REPORT_FORMAT_INVALID" });
    const c = caps(req.user); if (!boleh(c, tab)) return deny(res);
    const ctx = await konteks(req);
    const { buf, nama } = await buatBerkas(prisma, ctx, tab, req.query, { izinHarga: c.harga, pengekspor: req.user?.name || "" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nama}"`);
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buf);
  } catch (err) { galat(err, res); }
});
