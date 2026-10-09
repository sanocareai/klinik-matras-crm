// BARANG AKAN DATANG — halaman Gudang atas data PO yang SAMA dengan Finance (services/finance/kedatangan.js). Tidak ada PO Gudang terpisah.
//   • GET  /api/inventory/barang-akan-datang            — daftar PO + status (Menunggu Kedatangan, Diterima Sebagian, Terlambat, Perlu Diperiksa, Siap Disimpan, Selesai, Dibatalkan). TANPA harga/total/utang/pembayaran.
//   • GET  /api/inventory/barang-akan-datang/:poId      — detail: item (dipesan/datang/baik/ditolak/masuk stok/sisa + pendamping), semua pengiriman (surat jalan, tanggal tiba, PIC, bukti, kekurangan, riwayat).
//   • POST /api/inventory/barang-akan-datang/:poId/kedatangan        — catat barang tiba (Gudang). Wajib Idempotency-Key. Aktor/peran/workspace dari sesi.
//   • POST /api/inventory/barang-akan-datang/penerimaan/:id/koreksi  — koreksi kedatangan (alasan wajib + revisi data). Wajib Idempotency-Key.
//   • POST /api/inventory/barang-akan-datang/bukti                   — unggah foto surat jalan/bukti (opsional).
// Finance memakai logika yang sama lewat /api/finance/purchase-orders (…/kedatangan, …/koreksi-kedatangan). Memeriksa baik/ditolak dan "Simpan ke Stok" tetap di Penerimaan Barang (inventory:write).
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { idempotency, wajibIdempotencyKey } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P, rolesOf } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { aktorDariSesi, bentukBarangAkanDatang, catatKedatangan, daftarBarangAkanDatang, koreksiKedatangan, KedatanganError, WORKSPACE } from "../services/finance/kedatangan.js";

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const receiptProofsDir = path.join(__dirname, "../../data/receipt-proofs");
if (!fs.existsSync(receiptProofsDir)) fs.mkdirSync(receiptProofsDir, { recursive: true });

// Bukti kedatangan/surat jalan: foto (sudah dikompres di klien). Nama berkas acak (tidak bisa ditebak); disajikan statis di /media/receipt-proofs.
export const unggahBukti = multer({
  storage: multer.diskStorage({
    destination: receiptProofsDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname) || ".jpg"}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (file.mimetype.startsWith("image/") ? cb(null, true) : cb(new KedatanganError("Hanya file gambar yang diperbolehkan", 400))),
});
export const terimaBukti = (req, res, next) => unggahBukti.single("foto")(req, res, (e) => {
  if (e) return res.status(e.statusCode ?? 400).json({ error: e.message });
  if (!req.file) return res.status(400).json({ error: "Foto bukti wajib dipilih" });
  return res.status(201).json({ url: `/media/receipt-proofs/${req.file.filename}` });
});

export function galatKedatangan(err, res) {
  if (typeof err?.statusCode === "number") return res.status(err.statusCode).json({ error: err.message, ...(err.code && { code: err.code }) });
  if (err?.code === "P2002") return res.status(409).json({ error: "Nomor penerimaan bentrok — coba lagi" });
  if (err?.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Kedatangan error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

// ── Gudang ───────────────────────────────────────────────────────────────
export const barangAkanDatangRouter = express.Router();
barangAkanDatangRouter.use(requireAuth);
barangAkanDatangRouter.use(idempotency);

barangAkanDatangRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try { res.json(await daftarBarangAkanDatang(prisma, { status: req.query.status || null, q: req.query.q || null, finance: false })); } catch (e) { galatKedatangan(e, res); }
});

barangAkanDatangRouter.post("/bukti", requirePermission(P.INVENTORY_WRITE), terimaBukti);

barangAkanDatangRouter.post("/penerimaan/:receiptId/koreksi", requirePermission(P.INVENTORY_WRITE), wajibIdempotencyKey, async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.receiptId)) return res.status(404).json({ error: "Penerimaan tidak ditemukan" });
    const aktor = aktorDariSesi(req.user, WORKSPACE.GUDANG, rolesOf(req.user));
    const hasil = await prisma.$transaction((tx) => koreksiKedatangan(tx, { receiptId: req.params.receiptId, perubahan: req.body?.perubahan, alasan: req.body?.alasan, revisiDiharapkan: req.body?.revisi, aktor }));
    const rec = await prisma.goodsReceipt.findUnique({ where: { id: hasil.receiptId }, select: { purchaseOrderId: true } });
    res.json({ ...hasil, po: await bentukBarangAkanDatang(prisma, rec.purchaseOrderId, { finance: false }) });
  } catch (e) { galatKedatangan(e, res); }
});

barangAkanDatangRouter.get("/:poId", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.poId)) return res.status(404).json({ error: "PO tidak ditemukan" });
    const po = await bentukBarangAkanDatang(prisma, req.params.poId, { finance: false });
    if (!po || po.status === "DRAFT") return res.status(404).json({ error: "PO tidak ditemukan" }); // draf belum menjadi komitmen: tidak terlihat oleh Gudang
    res.json(po);
  } catch (e) { galatKedatangan(e, res); }
});

barangAkanDatangRouter.post("/:poId/kedatangan", requirePermission(P.INVENTORY_WRITE), wajibIdempotencyKey, async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.poId)) return res.status(404).json({ error: "PO tidak ditemukan" });
    const aktor = aktorDariSesi(req.user, WORKSPACE.GUDANG, rolesOf(req.user));
    const hasil = await prisma.$transaction((tx) => catatKedatangan(tx, { poId: req.params.poId, receiptId: req.body?.receiptId || null, masukan: req.body, aktor }));
    res.status(201).json({ ...hasil, po: await bentukBarangAkanDatang(prisma, req.params.poId, { finance: false }) });
  } catch (e) { galatKedatangan(e, res); }
});
