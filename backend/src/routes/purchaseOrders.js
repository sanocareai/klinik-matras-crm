// PURCHASE ORDER BAHAN BAKU — dua pintu ke data yang SAMA (services/finance/purchaseOrder.js):
//   • /api/finance/purchase-orders   — Finance: buat, ubah draf, setujui, batalkan, revisi jumlah, lihat harga & riwayat.
//   • /api/inventory/purchase-orders — Gudang: BACA SAJA PO yang bisa diterima, TANPA harga/nilai (Gudang mencatat barang, bukan uang).
// PO tidak pernah menulis stok atau jurnal; lihat catatan di service.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P, hasPermission, rolesOf } from "../middleware/authorize.js";
import { wajibIdempotencyKey } from "../middleware/idempotency.js";
import { aktorDariSesi, bentukBarangAkanDatang, catatKedatanganPO, daftarBarangAkanDatang, jalankanKoreksiKedatangan, pastikanDrafPenerimaan, WORKSPACE } from "../services/finance/kedatangan.js";
import { galatKedatangan, terimaBukti, wajibKunciKecualiPratinjau } from "./barangAkanDatang.js";
import { prisma } from "../db.js";
import { wajibUuid } from "../lib/uuidParam.js";
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { handleFinanceError } from "./finance.js";
import { bentukPO, daftarPO, daftarRiwayat, buatPO, ubahDraf, setujuiPO, batalkanPO, revisiJumlah } from "../services/finance/purchaseOrder.js";
import { bangunViewPO, namaBerkasPO } from "../services/finance/purchaseOrderDocument.js";
import { renderPurchaseOrderPdf } from "../services/purchaseOrderPdf.js";
import { pratinjauDuplikat, daftarKatalog, bacaAsalSku, perbaikiSku } from "../services/finance/skuBaru.js";
import { daftarUangMuka, daftarPenerapan, ringkasUangMukaSupplier, ringkasanKeuanganPO, bayarUangMukaPO, kandidatUntukFaktur, terapkanKeFaktur, batalkanPenerapan } from "../services/finance/uangMukaSupplier.js";
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
purchaseOrderFinanceRouter.post("/penerimaan/:receiptId/koreksi-kedatangan", requirePermission(P.FINANCE_POST), wajibKunciKecualiPratinjau, async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.receiptId)) return res.status(404).json({ error: "Penerimaan tidak ditemukan" });
    const aktor = aktorDariSesi(req.user, WORKSPACE.FINANCE, rolesOf(req.user));
    const hasil = await jalankanKoreksiKedatangan(prisma, { receiptId: req.params.receiptId, perubahan: req.body?.perubahan, alasan: req.body?.alasan, revisiDiharapkan: req.body?.revisi, aktor, finance: true, pratinjau: req.body?.pratinjau === true });
    if (hasil.pratinjau) return res.json(hasil);
    const rec = await prisma.goodsReceipt.findUnique({ where: { id: hasil.receiptId }, select: { purchaseOrderId: true } });
    res.json({ ...hasil, kedatangan: await bentukBarangAkanDatang(prisma, rec.purchaseOrderId, { finance: true }) });
  } catch (e) { galatKedatangan(e, res); }
});

// ── UANG MUKA SUPPLIER (Okt 2026; rute statis SEBELUM /:id). Memakai DP yang sudah ada (FinPurchase UANG_MUKA_PEMBELIAN) — lihat services/finance/uangMukaSupplier.js.
// Baca = finance:read. Bayar uang muka & terapkan ke faktur = finance:post + Idempotency-Key. Batalkan penerapan = finance:admin. Gudang TIDAK punya akses ke rute ini (semua finance:*).
purchaseOrderFinanceRouter.get("/uang-muka", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { supplierId, purchaseOrderId, status } = req.query;
    res.json({ uangMuka: await daftarUangMuka(prisma, { supplierId: POLA_UUID.test(String(supplierId ?? "")) ? supplierId : null, purchaseOrderId: POLA_UUID.test(String(purchaseOrderId ?? "")) ? purchaseOrderId : null, belumDiterapkan: req.query.belumDiterapkan === "1", status: status || null }) });
  } catch (e) { handleFinanceError(e, res); }
});
purchaseOrderFinanceRouter.get("/uang-muka/ringkasan-supplier", requirePermission(P.FINANCE_READ), async (req, res) => {
  try { res.json(await ringkasUangMukaSupplier(prisma, { supplierId: POLA_UUID.test(String(req.query.supplierId ?? "")) ? req.query.supplierId : null })); } catch (e) { handleFinanceError(e, res); }
});
purchaseOrderFinanceRouter.get("/uang-muka/penerapan", requirePermission(P.FINANCE_READ), async (req, res) => {
  try { res.json({ penerapan: await daftarPenerapan(prisma, { supplierId: POLA_UUID.test(String(req.query.supplierId ?? "")) ? req.query.supplierId : null }) }); } catch (e) { handleFinanceError(e, res); }
});
purchaseOrderFinanceRouter.get("/uang-muka/faktur/:billId/kandidat", requirePermission(P.FINANCE_READ), wajibUuid("billId"), async (req, res) => {
  try { res.json(await kandidatUntukFaktur(prisma, req.params.billId)); } catch (e) { handleFinanceError(e, res); }
});
purchaseOrderFinanceRouter.post("/uang-muka/terapkan", requirePermission(P.FINANCE_POST), wajibIdempotencyKey, async (req, res) => {
  try {
    const b = req.body ?? {};
    for (const [k, v] of [["advanceId", b.advanceId], ["billId", b.billId]]) if (!POLA_UUID.test(String(v ?? ""))) return res.status(400).json({ code: "ID_TIDAK_VALID", message: "ID tidak valid." });
    const hasil = await prisma.$transaction((tx) => terapkanKeFaktur(tx, {
      advanceId: b.advanceId, billId: b.billId, amount: b.amount, idempotencyKey: req.get("Idempotency-Key"), konfirmasi: b.konfirmasi, konfirmasiBedaPO: b.konfirmasiBedaPO === true,
      sisaFakturDilihat: b.sisaFakturDilihat, catatan: b.catatan, userId: req.user.id,
    }), { timeout: 20000 });
    res.status(hasil.replay ? 200 : 201).json({ id: hasil.application.id, status: hasil.application.status, jumlah: Number(hasil.application.amount), uangMukaId: hasil.application.advancePurchaseId, fakturId: hasil.application.billId, replay: hasil.replay });
  } catch (e) { handleFinanceError(e, res); }
});
purchaseOrderFinanceRouter.post("/uang-muka/penerapan/:id/batal", requirePermission(P.FINANCE_ADMIN), wajibUuid(), wajibIdempotencyKey, async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => batalkanPenerapan(tx, { applicationId: req.params.id, reason: req.body?.reason, userId: req.user.id }), { timeout: 20000 });
    res.json({ ok: true, id: hasil.id });
  } catch (e) { handleFinanceError(e, res); }
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

purchaseOrderFinanceRouter.get("/:id/penagihan", requirePermission(P.FINANCE_READ), wajibUuid(), async (req, res) => {
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
purchaseOrderFinanceRouter.get("/:id/pdf", requirePermission(P.FINANCE_READ), async (req, res) => { // sudah memvalidasi UUID sendiri (404, kontrak lama dikunci tes) — tidak memakai wajibUuid
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

purchaseOrderFinanceRouter.get("/:id", requirePermission(P.FINANCE_READ), wajibUuid(), async (req, res) => {
  try {
    const po = await bentukPO(prisma, req.params.id, { harga: true });
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    res.json({ ...po, riwayat: await daftarRiwayat(prisma, po.id), kedatangan: await bentukBarangAkanDatang(prisma, po.id, { finance: true }), keuangan: await ringkasanKeuanganPO(prisma, po.id) });
  } catch (e) { handleFinanceError(e, res); }
});

// Uang muka SATU PO: daftar DP + penerapan + ringkasan keuangan (baca) dan "Bayar Uang Muka" (tulis, satu langkah).
purchaseOrderFinanceRouter.get("/:id/uang-muka", requirePermission(P.FINANCE_READ), wajibUuid(), async (req, res) => {
  try {
    const k = await ringkasanKeuanganPO(prisma, req.params.id);
    if (!k) return res.status(404).json({ error: "PO tidak ditemukan" });
    res.json(k);
  } catch (e) { handleFinanceError(e, res); }
});
purchaseOrderFinanceRouter.post("/:id/uang-muka", requirePermission(P.FINANCE_POST), wajibUuid(), wajibIdempotencyKey, async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => bayarUangMukaPO(tx, { poId: req.params.id, body: req.body, userId: req.user.id, bolehAdmin: hasPermission(req.user, P.FINANCE_ADMIN) }), { timeout: 20000 });
    res.status(201).json({ ...hasil, keuangan: await ringkasanKeuanganPO(prisma, req.params.id) });
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

purchaseOrderGudangRouter.get("/:id", requirePermission(P.INVENTORY_READ), wajibUuid(), async (req, res) => {
  try {
    const po = await bentukPO(prisma, req.params.id, { harga: false });
    // Draf belum menjadi komitmen: tidak ditampilkan ke Gudang.
    if (!po || po.status === "DRAFT") return res.status(404).json({ error: "PO tidak ditemukan" });
    res.json(po);
  } catch (e) { handleFinanceError(e, res); }
});
