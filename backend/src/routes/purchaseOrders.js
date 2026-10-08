// PURCHASE ORDER BAHAN BAKU — dua pintu ke data yang SAMA (services/finance/purchaseOrder.js):
//   • /api/finance/purchase-orders   — Finance: buat, ubah draf, setujui, batalkan, revisi jumlah, lihat harga & riwayat.
//   • /api/inventory/purchase-orders — Gudang: BACA SAJA PO yang bisa diterima, TANPA harga/nilai (Gudang mencatat barang, bukan uang).
// PO tidak pernah menulis stok atau jurnal; lihat catatan di service.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P, hasPermission } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { handleFinanceError } from "./finance.js";
import { bentukPO, daftarPO, daftarRiwayat, buatPO, ubahDraf, setujuiPO, batalkanPO, revisiJumlah } from "../services/finance/purchaseOrder.js";
import { bangunViewPO, namaBerkasPO } from "../services/finance/purchaseOrderDocument.js";
import { renderPurchaseOrderPdf } from "../services/purchaseOrderPdf.js";
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
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

purchaseOrderFinanceRouter.get("/:id", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const po = await bentukPO(prisma, req.params.id, { harga: true });
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    res.json({ ...po, riwayat: await daftarRiwayat(prisma, po.id) });
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
    const id = await prisma.$transaction((tx) => buatPO(tx, { body: req.body, userId: req.user.id, bolehOverride: hasPermission(req.user, P.FINANCE_ADMIN) }));
    const po = await bentukPO(prisma, id, { harga: true });
    res.status(201).json({ ...po, riwayat: await daftarRiwayat(prisma, id) });
  } catch (e) { handleFinanceError(e, res); }
});

purchaseOrderFinanceRouter.patch("/:id", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    await jalankan(res, (tx) => ubahDraf(tx, { id: req.params.id, body: req.body, userId: req.user.id, bolehOverride: hasPermission(req.user, P.FINANCE_ADMIN) }));
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
