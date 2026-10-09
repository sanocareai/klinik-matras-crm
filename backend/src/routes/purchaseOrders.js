// PURCHASE ORDER BAHAN BAKU — dua pintu ke data yang SAMA (services/finance/purchaseOrder.js):
//   • /api/finance/purchase-orders   — Finance: buat, ubah draf, setujui, batalkan, revisi jumlah, lihat harga & riwayat.
//   • /api/inventory/purchase-orders — Gudang: BACA SAJA PO yang bisa diterima, TANPA harga/nilai (Gudang mencatat barang, bukan uang).
// PO tidak pernah menulis stok atau jurnal; lihat catatan di service.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P, hasPermission, rolesOf } from "../middleware/authorize.js";
import { wajibIdempotencyKey } from "../middleware/idempotency.js";
import { aktorDariSesi, bentukBarangAkanDatang, catatKedatanganPO, daftarBarangAkanDatang, koreksiKedatangan, pastikanDrafPenerimaan, WORKSPACE } from "../services/finance/kedatangan.js";
import { galatKedatangan, terimaBukti } from "./barangAkanDatang.js";
import { prisma } from "../db.js";
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { handleFinanceError } from "./finance.js";
import { bentukPO, daftarPO, daftarRiwayat, buatPO, ubahDraf, setujuiPO, batalkanPO, revisiJumlah } from "../services/finance/purchaseOrder.js";
import { bangunViewPO, namaBerkasPO } from "../services/finance/purchaseOrderDocument.js";
import { renderPurchaseOrderPdf } from "../services/purchaseOrderPdf.js";
import { pratinjauDuplikat, daftarKatalog, bacaAsalSku, perbaikiSku } from "../services/finance/skuBaru.js";
import { pandanganPenagihan, buatTagihanDariPO, ubahTagihanPO, evaluasiTagihanPO } from "../services/finance/purchaseOrderBill.js";

// ── Finance ──────────────────────────────────────────────────────────────
export const purchaseOrderFinanceRouter = express.Router();
purchaseOrderFinanceRouter.use(requireAuth);
purchaseOrderFinanceRouter.use(idempotency);

purchaseOrderFinanceRouter.get("/", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { status, supplierId, q } = req.query;
    res.json({ purchaseOrders: await daftarPO(prisma, { status, supplierId, q, harga: true }) });
  } catch (e) { handleFinanceError(e, res); }
});

// ── KEDATANGAN barang (PO terintegrasi Finance–Gudang). Data & aturan SAMA dengan halaman Gudang "Barang Akan Datang" (services/finance/kedatangan.js); Finance melihat versi lengkap
// (harga, nilai, termin, jatuh tempo per penerimaan). Mencatat kedatangan TIDAK menulis stok/jurnal. Aktor/peran/workspace dari sesi. Rute statis SEBELUM /:id.
purchaseOrderFinanceRouter.get("/kedatangan", requirePermission(P.FINANCE_READ), async (req, res) => {
  try { res.json(await daftarBarangAkanDatang(prisma, { status: req.query.status || null, q: req.query.q || null, finance: true })); } catch (e) { galatKedatangan(e, res); }
});
purchaseOrderFinanceRouter.post("/bukti-kedatangan", requirePermission(P.FINANCE_POST), terimaBukti);
purchaseOrderFinanceRouter.post("/penerimaan/:receiptId/koreksi-kedatangan", requirePermission(P.FINANCE_POST), wajibIdempotencyKey, async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.receiptId)) return res.status(404).json({ error: "Penerimaan tidak ditemukan" });
    const aktor = aktorDariSesi(req.user, WORKSPACE.FINANCE, rolesOf(req.user));
    const hasil = await prisma.$transaction((tx) => koreksiKedatangan(tx, { receiptId: req.params.receiptId, perubahan: req.body?.perubahan, alasan: req.body?.alasan, revisiDiharapkan: req.body?.revisi, aktor }));
    const rec = await prisma.goodsReceipt.findUnique({ where: { id: hasil.receiptId }, select: { purchaseOrderId: true } });
    res.json({ ...hasil, kedatangan: await bentukBarangAkanDatang(prisma, rec.purchaseOrderId, { finance: true }) });
  } catch (e) { galatKedatangan(e, res); }
});

// ── SKU baru dari PO + Katalog Supplier (rute statis SEBELUM /:id). Membuat/memperbaiki SKU = finance:admin; membaca katalog = finance:read.
// Pratinjau TIDAK menulis apa pun (SKU baru baru lahir saat draf PO disimpan, atomik dengan PO-nya).
purchaseOrderFinanceRouter.post("/sku/cek-duplikat", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try { res.json(await pratinjauDuplikat(prisma, { supplierId: req.body?.supplierId, materialBaru: req.body?.materialBaru })); } catch (e) { handleFinanceError(e, res); }
});
purchaseOrderFinanceRouter.get("/sku/:materialId", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.materialId)) return res.status(404).json({ error: "Material tidak ditemukan" });
    const a = await bacaAsalSku(prisma, req.params.materialId);
    if (!a) return res.status(404).json({ error: "Material tidak ditemukan" });
    res.json(a);
  } catch (e) { handleFinanceError(e, res); }
});
purchaseOrderFinanceRouter.patch("/sku/:materialId", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.materialId)) return res.status(404).json({ error: "Material tidak ditemukan" });
    await prisma.$transaction((tx) => perbaikiSku(tx, { materialId: req.params.materialId, body: req.body, userId: req.user.id }));
    res.json(await bacaAsalSku(prisma, req.params.materialId));
  } catch (e) { handleFinanceError(e, res); }
});
purchaseOrderFinanceRouter.get("/katalog-supplier", requirePermission(P.FINANCE_READ), async (req, res) => {
  try { res.json({ katalog: await daftarKatalog(prisma, { supplierId: req.query.supplierId, materialId: req.query.materialId, q: req.query.q, aktif: req.query.aktif, harga: true }) }); } catch (e) { handleFinanceError(e, res); }
});

// ── Faktur supplier atas PO (Fase 2): pencocokan per baris. Persetujuan lewat POST /api/finance/bills/:id/approve (body.catatanTinjauanHarga bila harga berbeda).
// Faktur/pembayaran TIDAK menambah stok. Rute /faktur/* sebelum /:id.
purchaseOrderFinanceRouter.get("/faktur/:billId", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const ev = await evaluasiTagihanPO(prisma, req.params.billId);
    if (!ev) return res.status(404).json({ error: "Faktur atas PO tidak ditemukan" });
    res.json(ev);
  } catch (e) { handleFinanceError(e, res); }
});

purchaseOrderFinanceRouter.patch("/faktur/:billId", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const id = await prisma.$transaction((tx) => ubahTagihanPO(tx, { billId: req.params.billId, body: req.body, userId: req.user.id, adalahAdmin: hasPermission(req.user, P.FINANCE_ADMIN) }));
    res.json(await evaluasiTagihanPO(prisma, id));
  } catch (e) { handleFinanceError(e, res); }
});

purchaseOrderFinanceRouter.get("/:id/penagihan", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const v = await pandanganPenagihan(prisma, req.params.id);
    if (!v) return res.status(404).json({ error: "PO tidak ditemukan" });
    res.json(v);
  } catch (e) { handleFinanceError(e, res); }
});

purchaseOrderFinanceRouter.post("/:id/faktur", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const id = await prisma.$transaction((tx) => buatTagihanDariPO(tx, { poId: req.params.id, body: req.body, userId: req.user.id, bolehOverride: hasPermission(req.user, P.FINANCE_ADMIN) }));
    res.status(201).json(await evaluasiTagihanPO(prisma, id));
  } catch (e) { handleFinanceError(e, res); }
});

// PDF Purchase Order (sistem dokumen SANSS yang sama dengan invoice). Hanya Finance (memuat harga & nilai). Murni baca: tidak mengubah PO, stok, atau jurnal.
purchaseOrderFinanceRouter.get("/:id/pdf", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "PO tidak ditemukan" });
    const view = await bangunViewPO(prisma, req.params.id);
    if (!view) return res.status(404).json({ error: "PO tidak ditemukan" });
    const buffer = await renderPurchaseOrderPdf(view);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${namaBerkasPO(view.po.poNumber)}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (err) {
    if (err?.statusCode) return handleFinanceError(err, res);
    console.error("po pdf error:", err);
    res.status(500).json({ error: "Gagal membuat PDF Purchase Order" });
  }
});

purchaseOrderFinanceRouter.post("/:id/kedatangan", requirePermission(P.FINANCE_POST), wajibIdempotencyKey, async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "PO tidak ditemukan" });
    const aktor = aktorDariSesi(req.user, WORKSPACE.FINANCE, rolesOf(req.user));
    const hasil = await catatKedatanganPO(prisma, { poId: req.params.id, receiptId: req.body?.receiptId || null, masukan: req.body, aktor });
    res.status(201).json({ ...hasil, kedatangan: await bentukBarangAkanDatang(prisma, req.params.id, { finance: true }) });
  } catch (e) { galatKedatangan(e, res); }
});

// Finance-first: siapkan/pakai draf penerimaan langsung dari PO (idempoten) — Gudang melihat dan melanjutkan pemeriksaan pada penerimaan yang SAMA.
purchaseOrderFinanceRouter.post("/:id/draf-penerimaan", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "PO tidak ditemukan" });
    const aktor = aktorDariSesi(req.user, WORKSPACE.FINANCE, rolesOf(req.user));
    res.json(await pastikanDrafPenerimaan(prisma, { poId: req.params.id, aktor }));
  } catch (e) { galatKedatangan(e, res); }
});

purchaseOrderFinanceRouter.get("/:id", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const po = await bentukPO(prisma, req.params.id, { harga: true });
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    res.json({ ...po, riwayat: await daftarRiwayat(prisma, po.id), kedatangan: await bentukBarangAkanDatang(prisma, po.id, { finance: true }) });
  } catch (e) { handleFinanceError(e, res); }
});

// Setiap perintah tulis berjalan di SATU transaksi dan mengembalikan PO terbaru (dibaca setelah commit).
async function jalankan(res, fn) {
  const id = await prisma.$transaction(fn);
  const po = await bentukPO(prisma, id, { harga: true });
  return res.json({ ...po, riwayat: await daftarRiwayat(prisma, id) });
}

purchaseOrderFinanceRouter.post("/", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const id = await prisma.$transaction((tx) => buatPO(tx, { body: req.body, userId: req.user.id, bolehOverride: hasPermission(req.user, P.FINANCE_ADMIN), bolehBuatSku: hasPermission(req.user, P.FINANCE_ADMIN) }));
    const po = await bentukPO(prisma, id, { harga: true });
    res.status(201).json({ ...po, riwayat: await daftarRiwayat(prisma, id) });
  } catch (e) { handleFinanceError(e, res); }
});

purchaseOrderFinanceRouter.patch("/:id", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    await jalankan(res, (tx) => ubahDraf(tx, { id: req.params.id, body: req.body, userId: req.user.id, bolehOverride: hasPermission(req.user, P.FINANCE_ADMIN), bolehBuatSku: hasPermission(req.user, P.FINANCE_ADMIN) }));
  } catch (e) { handleFinanceError(e, res); }
});

purchaseOrderFinanceRouter.post("/:id/approve", requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    await jalankan(res, (tx) => setujuiPO(tx, { id: req.params.id, userId: req.user.id }));
  } catch (e) { handleFinanceError(e, res); }
});

// Batal draf = FINANCE_POST (pembuat boleh membuang drafnya); batal PO yang SUDAH disetujui = FINANCE_ADMIN (pola sama dengan
// pembatalan tagihan/pembelian yang sudah disetujui). Izin yang kurang dijawab 403 oleh service, setelah status PO diketahui.
purchaseOrderFinanceRouter.post("/:id/cancel", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    await jalankan(res, (tx) => batalkanPO(tx, {
      id: req.params.id, reason: req.body?.reason, userId: req.user.id,
      bolehBatalkanDisetujui: hasPermission(req.user, P.FINANCE_ADMIN),
    }));
  } catch (e) { handleFinanceError(e, res); }
});

purchaseOrderFinanceRouter.post("/:id/revisi-jumlah", requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    const { lineId, qty, reason } = req.body ?? {};
    await jalankan(res, (tx) => revisiJumlah(tx, { id: req.params.id, lineId, qty, reason, userId: req.user.id }));
  } catch (e) { handleFinanceError(e, res); }
});

// ── Gudang (baca saja, tanpa harga) ──────────────────────────────────────
export const purchaseOrderGudangRouter = express.Router();
purchaseOrderGudangRouter.use(requireAuth);

// Default: hanya PO yang bisa menerima barang. ?status= dapat diperluas (mis. SELESAI) untuk melihat riwayat.
purchaseOrderGudangRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const status = req.query.status || "DISETUJUI,DITERIMA_SEBAGIAN";
    const pos = await daftarPO(prisma, { status, supplierId: req.query.supplierId, q: req.query.q, harga: false });
    res.json({ purchaseOrders: pos.filter((p) => p.status !== "DRAFT") });
  } catch (e) { handleFinanceError(e, res); }
});

purchaseOrderGudangRouter.get("/:id", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const po = await bentukPO(prisma, req.params.id, { harga: false });
    // Draf belum menjadi komitmen: tidak ditampilkan ke Gudang.
    if (!po || po.status === "DRAFT") return res.status(404).json({ error: "PO tidak ditemukan" });
    res.json(po);
  } catch (e) { handleFinanceError(e, res); }
});
