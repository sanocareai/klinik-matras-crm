// Riwayat referensi historis dari file (Okt 2026) — LIHAT + pratinjau + simpan catatan referensi.
// CATATAN REFERENSI, BUKAN TRANSAKSI: tidak ada rute di sini yang menulis stock_movements, saldo, GR, Material Issue, adjustment, atau jurnal.
//   Baca  : inventory:read   (GET /, /ringkasan, /impor)
//   Tulis : inventory:write  (POST /pratinjau — tanpa penulisan; POST /impor — hanya tabel referensi, wajib konfirmasi hash pratinjau;
//           POST /segarkan — tindakan MANUAL menyimpan snapshot status sebagai revisi, wajib { konfirmasi: true })
//   Membuka/menyegarkan tampilan hanya memakai GET: murni baca-saja (status terkini dihitung saat GET; tidak menambah revisi/audit).
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { LABEL_REFERENSI, pratinjauReferensi, simpanReferensi, muatTerkini, segarkanStatus } from "../services/stokRiwayatReferensi.js";

export const riwayatReferensiRouter = express.Router();
riwayatReferensiRouter.use(requireAuth);

const BATAS_CSV = 4 * 1024 * 1024;
function handleErr(err, res) {
  if (typeof err.statusCode === "number") return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  console.error("Riwayat referensi error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}
function masukan(body) {
  const b = body || {};
  for (const k of ["pakaiCsv", "beliCsv"]) if (b[k] != null && (typeof b[k] !== "string" || b[k].length > BATAS_CSV)) { const e = new Error(`${k} harus teks CSV (maks 4 MB)`); e.statusCode = 400; throw e; }
  if (!b.pakaiCsv && !b.beliCsv) { const e = new Error("Minimal satu berkas (pakaiCsv atau beliCsv) wajib diisi"); e.statusCode = 400; throw e; }
  if (b.alias != null && (typeof b.alias !== "object" || Array.isArray(b.alias))) { const e = new Error("alias harus objek { nama di file: kode material }"); e.statusCode = 400; throw e; }
  let mulai = null; if (b.mulai) { mulai = new Date(b.mulai); if (Number.isNaN(mulai.getTime())) { const e = new Error("mulai bukan tanggal valid (ISO)"); e.statusCode = 400; throw e; } }
  return { pakaiCsv: b.pakaiCsv || "", beliCsv: b.beliCsv || "", alias: b.alias || {}, mulai, namaBerkasPakai: String(b.namaBerkasPakai || "Pemakaian Bahan.csv").slice(0, 200), namaBerkasBeli: String(b.namaBerkasBeli || "Data Pembelian Supplier.csv").slice(0, 200) };
}
// Baris tersimpan + STATUS TERKINI (diturunkan dari kondisi dokumen resmi sekarang; tidak menunggu impor ulang). statusTersimpan = status pada revisi aktif.
const baris = ({ baris: r, terkini, berubah }) => ({
  id: r.id, kunci: r.kunci, revisi: r.revisi, jenis: r.jenis, label: LABEL_REFERENSI,
  material: r.material ? { id: r.material.id, kode: r.material.code, nama: r.material.name, satuan: r.material.unit } : null, namaDiFile: r.namaDiFile, nomorOrder: r.nomorOrder,
  jumlah: r.jumlah == null ? null : Number(r.jumlah), satuanFile: r.satuanFile, satuanMaster: r.satuanMaster,
  tanggalOrder: r.tanggalOrder ? r.tanggalOrder.toISOString().slice(0, 10) : null, tanggalPemakaian: null, tanggalKirim: r.tanggalKirim ? r.tanggalKirim.toISOString().slice(0, 10) : null,
  suratJalan: r.suratJalan, vendor: r.vendor, labelBulanFile: r.labelBulanFile, sumberFile: r.sumberFile, sumberBaris: r.sumberBaris, waktuImpor: r.impor?.waktuImpor || null,
  statusVerifikasi: terkini.status, statusTersimpan: r.statusVerifikasi, revisiTertinggal: berubah, antrean: r.antrean, alasanBlocker: r.alasanBlocker, peringatan: terkini.peringatan, dokumenResmi: terkini.dokumenResmi,
});
const cocok = (h, f) => {
  const r = h.baris;
  if (f.materialId && r.materialId !== f.materialId) return false;
  if (f.order && r.nomorOrder !== f.order) return false;
  if (f.jenis && r.jenis !== f.jenis) return false;
  if (f.status && h.terkini.status !== f.status) return false;
  if (f.antrean === "ADA" ? !r.antrean : f.antrean && r.antrean !== f.antrean) return false;
  if (f.q) { const q = f.q.toLowerCase(); if (![r.namaDiFile, r.nomorOrder, r.material?.code, r.material?.name].some((x) => String(x || "").toLowerCase().includes(q))) return false; }
  return true;
};

// GET /api/inventory/riwayat-referensi?materialId=&order=&status=&antrean=&jenis=&q=&limit=&offset=   (status = STATUS TERKINI)
riwayatReferensiRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { materialId, order, status, antrean, jenis, q } = req.query;
    if (materialId && !/^[0-9a-f-]{36}$/i.test(String(materialId))) return res.status(400).json({ error: "materialId tidak valid" });
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500); const offset = Math.max(Number(req.query.offset) || 0, 0);
    if (req.query.semuaRevisi === "1") {
      const rows = await prisma.stokRiwayatReferensi.findMany({ where: { ...(materialId && { materialId: String(materialId) }), ...(order && { nomorOrder: String(order).trim().toUpperCase() }) }, orderBy: [{ kunci: "asc" }, { revisi: "asc" }], take: limit, skip: offset, include: { material: { select: { id: true, code: true, name: true, unit: true } }, impor: { select: { waktuImpor: true } } } });
      return res.json({ label: LABEL_REFERENSI, bukanSaldo: true, riwayatRevisi: true, baris: rows.map((r) => ({ id: r.id, kunci: r.kunci, revisi: r.revisi, aktif: r.aktif, statusVerifikasi: r.statusVerifikasi, dokumenResmi: r.dokumenResmi, waktuImpor: r.impor?.waktuImpor || null, jumlah: r.jumlah == null ? null : Number(r.jumlah), material: r.material ? { kode: r.material.code } : null, nomorOrder: r.nomorOrder })) });
    }
    const { hasil } = await muatTerkini(prisma);
    const f = { materialId: materialId && String(materialId), order: order && String(order).trim().toUpperCase(), status: status && String(status), antrean: antrean && String(antrean), jenis: jenis && String(jenis), q: q && String(q).trim() };
    const pilih = hasil.filter((h) => cocok(h, f)).sort((a, b) => (b.baris.tanggalOrder?.getTime?.() || 0) - (a.baris.tanggalOrder?.getTime?.() || 0) || a.baris.kunci.localeCompare(b.baris.kunci));
    res.json({ label: LABEL_REFERENSI, bukanSaldo: true, total: pilih.length, limit, offset, baris: pilih.slice(offset, offset + limit).map(baris) });
  } catch (err) { handleErr(err, res); }
});

riwayatReferensiRouter.get("/ringkasan", requirePermission(P.INVENTORY_READ), async (_req, res) => {
  try {
    const { hasil, t0 } = await muatTerkini(prisma);
    const hitung = (arr, k) => arr.reduce((o, x) => { const v = k(x); if (v) o[v] = (o[v] || 0) + 1; return o; }, {});
    const pilihImpor = { id: true, waktuImpor: true, berkasPemakaian: true, berkasPembelian: true, mulaiT0: true };
    const impor = (await prisma.stokRiwayatImpor.findFirst({ where: { berkasPemakaian: { not: null } }, orderBy: { waktuImpor: "desc" }, select: pilihImpor })) || (await prisma.stokRiwayatImpor.findFirst({ orderBy: { waktuImpor: "desc" }, select: pilihImpor }));
    const tglOrder = hasil.map((h) => h.fakta.tanggalOrder).filter(Boolean).sort(); const tglKirim = hasil.map((h) => h.fakta.tanggalKirim).filter(Boolean).sort();
    const perStatus = hitung(hasil, (h) => h.terkini.status); const perAntrean = hitung(hasil, (h) => h.baris.antrean);
    res.json({
      label: LABEL_REFERENSI, bukanSaldo: true, perStatus, perAntrean, jumlahAntrean: Object.values(perAntrean).reduce((s, v) => s + v, 0), perJenis: hitung(hasil, (h) => h.baris.jenis),
      perBulanTanggalOrder: hitung(hasil.filter((h) => h.fakta.tanggalOrder), (h) => h.fakta.tanggalOrder.slice(0, 7)), revisiTertinggal: hasil.filter((h) => h.berubah).length, resmiSetelahT0: hasil.filter((h) => h.terkini.dokumenResmi?.setelahT0 === true).length, t0,
      imporTerakhir: impor, cakupan: { tanggalOrderDari: tglOrder[0] || null, tanggalOrderSampai: tglOrder[tglOrder.length - 1] || null, tanggalKirimSampai: tglKirim[tglKirim.length - 1] || null },
      tanggalPemakaian: "Tidak pernah diisi — tidak ada bukti tanggal pemakaian.", t0Aturan: "T0 tidak menyaring baris file; hanya menandai dokumen RESMI yang waktu kejadiannya terbukti setelah T0.",
    });
  } catch (err) { handleErr(err, res); }
});

riwayatReferensiRouter.get("/impor", requirePermission(P.INVENTORY_READ), async (_req, res) => {
  try {
    const impor = await prisma.stokRiwayatImpor.findMany({ orderBy: { waktuImpor: "desc" }, take: 50, select: { id: true, waktuImpor: true, diimporOleh: true, berkasPemakaian: true, hashPemakaian: true, berkasPembelian: true, hashPembelian: true, hashKonten: true, mulaiT0: true, ringkasan: true } });
    res.json({ impor });
  } catch (err) { handleErr(err, res); }
});

riwayatReferensiRouter.get("/material/:materialId", requirePermission(P.INVENTORY_READ), wajibUuid("materialId"), async (req, res) => {
  try {
    const { hasil } = await muatTerkini(prisma, { materialId: req.params.materialId });
    res.json({ label: LABEL_REFERENSI, bukanSaldo: true, baris: hasil.slice(0, 500).map(baris) });
  } catch (err) { handleErr(err, res); }
});

// POST /segarkan — TINDAKAN MANUAL: menyimpan snapshot status terkini (kondisi dokumen resmi berubah) sebagai REVISI append-only + audit. Tidak diperlukan untuk MELIHAT status terkini (GET sudah terkini). Tanpa impor ulang file. Idempoten.
// Hanya inventory:write; wajib { konfirmasi: true } agar tidak terpicu tak sengaja oleh klien/otomasi.
riwayatReferensiRouter.post("/segarkan", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    if (req.body?.konfirmasi !== true) return res.status(400).json({ error: "Menyimpan snapshot status adalah tindakan manual: kirim { konfirmasi: true }", code: "KONFIRMASI_DIPERLUKAN" });
    res.json({ label: LABEL_REFERENSI, ...(await segarkanStatus(prisma, { userId: req.user.id })) }); } catch (err) { handleErr(err, res); }
});

// POST /pratinjau — TIDAK menulis apa pun. Mengembalikan hashKonten yang wajib dikirim kembali saat impor.
riwayatReferensiRouter.post("/pratinjau", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const masuk = masukan(req.body);
    const h = await prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return pratinjauReferensi(tx, masuk); }, { timeout: 120_000 });
    res.json({ label: LABEL_REFERENSI, hashKonten: h.hashKonten, ringkasan: h.ringkasan, antrean: h.rows.filter((r) => r.antrean).slice(0, 500), contoh: h.rows.filter((r) => !r.antrean).slice(0, 50), jumlahTampil: { antrean: Math.min(h.rows.filter((r) => r.antrean).length, 500), contoh: Math.min(h.rows.filter((r) => !r.antrean).length, 50) } });
  } catch (err) { handleErr(err, res); }
});

// POST /impor — menyimpan CATATAN REFERENSI saja. Idempoten (ulang = dilewati; berubah = revisi baru). Wajib { konfirmasiHash } dari pratinjau yang sama.
riwayatReferensiRouter.post("/impor", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const masuk = masukan(req.body);
    const hasil = await simpanReferensi(prisma, masuk, { userId: req.user.id, konfirmasiHash: req.body?.konfirmasiHash });
    res.status(201).json({ label: LABEL_REFERENSI, ...hasil, catatan: "Tidak ada movement, saldo, GR, Material Issue, adjustment, atau jurnal yang dibuat." });
  } catch (err) { handleErr(err, res); }
});
