// Goods Receipt — Warehouse Tahap 2B.
//
// Dokumen PROSES di depan ledger inventory yang sudah ada (routes/
// inventory.js). TIDAK PERNAH menyimpan angka stok sendiri — status
// berjalan DRAFT → SCHEDULED → ARRIVED → INSPECTION → READY_FOR_PUTAWAY →
// COMPLETED, dan baris stock_movements RECEIPT baru ditulis SATU KALI, saat
// putaway dikonfirmasi. Lihat catatan panjang di schema.prisma di atas
// model GoodsReceipt untuk alasan lengkapnya.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { postStockMovement, lockRowForUpdate } from "../services/inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
// D-180 — nilai RUPIAH penerimaan barang masuk buku besar (Dr Persediaan,
// Cr Utang Barang Belum Ditagih). TIDAK menulis pergerakan stok apa pun:
// kuantitasnya sudah ditulis postStockMovement() di atas, fungsi ini cuma
// MEMBACA baris itu beserta unitCost-nya. Lihat catatan lengkap di
// services/finance/posting/supplier.js.
import { postGoodsReceiptValue } from "../services/finance/posting/supplier.js";
import { JournalError } from "../services/finance/journal.js";
import { AccountError } from "../services/finance/accounts.js";
// Fase 1 integrasi Finance→Gudang: penerimaan boleh bersumber dari PO bahan baku (services/finance/purchaseOrder.js). PO tidak
// pernah menulis stok; yang dilakukan di sini hanya MEMBACA PO untuk mengisi dokumen, membatasi jumlah baik, dan menilai stok.
import { siapkanPenerimaanDariPO, validasiBarisPenerimaanPO, periksaPutaway, selesaiPutaway, bentukPO } from "../services/finance/purchaseOrder.js";
import { catatPerubahanDraf } from "../lib/jejakPerubahan.js";
import { tampilanPenerimaan, penghalangBatalJadwal, penghalangBatalTiba, tidakPernahBerisi } from "../services/penerimaanStatus.js";
import { nomorPenerimaanBaru, STATUS_PO_BISA_DITERIMA } from "../services/finance/kedatangan.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";

export const goodsReceiptRouter = express.Router();
goodsReceiptRouter.use(requireAuth);

class ReceiptError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (typeof err.statusCode === "number") return res.status(err.statusCode).json({ error: err.message, ...(typeof err.code === "string" && { code: err.code }) });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor receipt sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Goods receipt error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}

// Jejak ringan dokumen (batal/pulihkan/kembali ke Draf/batalkan tiba/dibuat ulang) untuk halaman detail. Hanya baca.
const TEKS_JEJAK = { KEMBALI_KE_DRAF: "Dikembalikan ke Draf", JADWAL_DIBATALKAN: "Penerimaan dibatalkan", DIPULIHKAN: "Dipulihkan ke Draf", TIBA_DIBATALKAN: "Catatan tiba dibatalkan (kembali Terjadwal)", DIBUAT_ULANG_DARI: "Dibuat ulang dari dokumen lama", DIBUAT_ULANG_MENJADI: "Dibuatkan penerimaan baru" };
async function jejakDokumen(id) {
  const ev = await prisma.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: id }, orderBy: { createdAt: "asc" }, take: 40 });
  const pelaku = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(ev.map((e) => e.actorId).filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return ev.filter((e) => TEKS_JEJAK[e.metadata?.aksi]).map((e) => ({
    id: e.id, waktu: e.createdAt, aksi: e.metadata.aksi, teks: TEKS_JEJAK[e.metadata.aksi], oleh: pelaku.get(e.actorId) ?? null, alasan: e.metadata.alasan ?? null,
    tautan: e.metadata.dariId ? { id: e.metadata.dariId, nomor: e.metadata.dariNomor } : e.metadata.keId ? { id: e.metadata.keId, nomor: e.metadata.keNomor } : null,
  }));
}

const SOURCE_TYPES = [
  "PURCHASE_ORDER", "SUPPLIER_DELIVERY", "PRODUCTION_RETURN",
  "CUSTOMER_RETURN", "INTER_WAREHOUSE_TRANSFER", "MANUAL",
];

// Urutan maju yang sah. REJECTED dijangkau lewat endpoint terpisah
// (/reject) dari status mana pun sebelum COMPLETED — bukan bagian dari
// urutan maju ini.
const FORWARD_FLOW = ["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"];

const receiptInclude = {
  // purchaseOrderLine (tanpa harga): satuan beli & faktor konversi — jumlah penerimaan PO dalam SATUAN BELI, stok bertambah dalam satuan stok.
  lines: { include: { material: { select: { id: true, code: true, name: true, unit: true } }, purchaseOrderLine: { select: { unit: true, purchaseUnit: true, conversionFactor: true } } } },
  createdBy: { select: { id: true, name: true } },
  // Sumber PO (NULL = penerimaan TANPA PO). Tanpa harga: Gudang tidak melihat nilai uang.
  purchaseOrder: { select: { id: true, poNumber: true, status: true } },
};

// Menempelkan ringkasan kuantitas PO (dipesan/diterima baik/ditolak/belum diterima) ke detail penerimaan — TANPA harga.
async function denganRingkasanPO(receipt) {
  if (!receipt?.purchaseOrderId) return receipt;
  const po = await bentukPO(prisma, receipt.purchaseOrderId, { harga: false, denganPenerimaan: false });
  return { ...receipt, poRingkas: po && { id: po.id, poNumber: po.poNumber, status: po.status, expectedDate: po.expectedDate, lines: po.lines } };
}

function generateReceiptCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `GR-${dd}${mm}${yy}`;
}

// GET /api/inventory/goods-receipts?status=&sourceType=
goodsReceiptRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { status, sourceType } = req.query;
    const receipts = await prisma.goodsReceipt.findMany({
      where: { ...(status && { status }), ...(sourceType && { sourceType }) },
      include: receiptInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    res.json({ receipts: receipts.map((r) => ({ ...r, tampilan: tampilanPenerimaan(r) })) });
  } catch (err) {
    handleErr(err, res);
  }
});

goodsReceiptRouter.get("/:id", requirePermission(P.INVENTORY_READ), wajibUuid(), async (req, res) => {
  try {
    const receipt = await prisma.goodsReceipt.findUnique({ where: { id: req.params.id }, include: receiptInclude });
    if (!receipt) return res.status(404).json({ error: "Goods receipt tidak ditemukan" });
    // Akun tanpa izin tulis Inventory (hanya melihat) tidak ditawari aksi: server tetap menolak 403, tetapi layar tidak menampilkan tombol yang pasti gagal.
    const tulis = hasPermission(req.user, P.INVENTORY_WRITE);
    const tampilan = tampilanPenerimaan(receipt);
    res.json({ ...(await denganRingkasanPO(receipt)), tampilan: tulis ? tampilan : { ...tampilan, aksi: [] }, izin: { tulis }, jejak: await jejakDokumen(receipt.id) });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/goods-receipts
// { sourceType, sourceReference?, supplier?, expectedDate?, notes?, lines: [{materialId, orderedQty?}] }
goodsReceiptRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { purchaseOrderId, expectedDate, notes } = req.body;
    let { sourceType, sourceReference, supplier, lines } = req.body;

    // Dari PO: supplier, referensi, jenis sumber, dan baris item diisi DARI PO (bukan dari isian bebas). Gudang tetap mengisi surat jalan,
    // jumlah datang, baik, dan ditolak lewat tahapan penerimaan seperti biasa. Tanpa purchaseOrderId = jalur lama (tanpa PO).
    let dariPO = null;
    if (purchaseOrderId) {
      dariPO = await siapkanPenerimaanDariPO(prisma, { purchaseOrderId, pilihan: req.body.lines });
      sourceType = "PURCHASE_ORDER";
      sourceReference = dariPO.po.poNumber;
      supplier = dariPO.supplierName;
      lines = dariPO.lines;
    }
    if (!SOURCE_TYPES.includes(sourceType)) throw new ReceiptError("Source type tidak valid");
    if (!Array.isArray(lines) || lines.length === 0) throw new ReceiptError("Minimal satu item wajib diisi");
    for (const l of lines) {
      if (!l.materialId) throw new ReceiptError("Setiap baris wajib memilih item");
    }

    // Nomor berurut per tanggal: GR-DDMMYY-NN, sama pola dengan RTE-DDMMYY-NN
    // di armada.js — dihitung dari jumlah receipt yang SUDAH ADA hari itu,
    // cukup untuk volume harian yang realistis.
    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.goodsReceipt.count({ where: { createdAt: { gte: startOfDay } } });
    const receiptNumber = `${generateReceiptCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const receipt = await prisma.goodsReceipt.create({
      data: {
        receiptNumber, sourceType,
        sourceReference: sourceReference || null,
        supplier: supplier || null,
        purchaseOrderId: dariPO ? dariPO.po.id : null,
        expectedDate: expectedDate ? new Date(`${expectedDate}T00:00:00.000Z`) : null,
        notes: notes || null,
        createdById: req.user.id,
        lines: {
          create: lines.map((l) => ({
            materialId: l.materialId,
            orderedQty: l.orderedQty != null && l.orderedQty !== "" ? Number(l.orderedQty) : null,
            purchaseOrderLineId: l.purchaseOrderLineId || null,
          })),
        },
      },
      include: receiptInclude,
    });
    res.status(201).json(await denganRingkasanPO(receipt));
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/goods-receipts/:id
// Header fields + transisi status MAJU satu langkah pada satu waktu.
// { sourceReference?, supplier?, expectedDate?, receivedDate?, deliveryNote?, notes?, status? }
goodsReceiptRouter.patch("/:id", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const existing = await prisma.goodsReceipt.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Goods receipt tidak ditemukan" });
    if (existing.status === "COMPLETED" || existing.status === "REJECTED") {
      throw new ReceiptError(`Receipt berstatus ${existing.status} tidak bisa diubah lagi${existing.status === "COMPLETED" && existing.purchaseOrderId ? " dari sini — koreksi lewat Koreksi Kedatangan (Barang Akan Datang): wajib alasan, tercatat sebelum–sesudah, dan sesudah Simpan ke Stok memakai pembalik + pengganti bila terbukti aman" : ""}`);
    }

    const { sourceReference, supplier, expectedDate, receivedDate, deliveryNote, notes, status } = req.body;
    // Penerimaan dari PO: supplier & referensi berasal dari PO dan tidak boleh diketik ulang (menjaga tautan PO ↔ penerimaan ↔ tagihan).
    if (existing.purchaseOrderId) {
      if (supplier !== undefined && (supplier || null) !== existing.supplier) throw new ReceiptError("Supplier penerimaan ini berasal dari PO dan tidak bisa diubah");
      if (sourceReference !== undefined && (sourceReference || null) !== existing.sourceReference) throw new ReceiptError("Referensi penerimaan ini berasal dari PO dan tidak bisa diubah");
    }
    const data = {};
    if (sourceReference !== undefined) data.sourceReference = sourceReference || null;
    if (supplier !== undefined) data.supplier = supplier || null;
    if (expectedDate !== undefined) data.expectedDate = expectedDate ? new Date(`${expectedDate}T00:00:00.000Z`) : null;
    if (receivedDate !== undefined) data.receivedDate = receivedDate ? new Date(`${receivedDate}T00:00:00.000Z`) : null;
    if (deliveryNote !== undefined) data.deliveryNote = deliveryNote || null;
    if (notes !== undefined) data.notes = notes || null;

    if (status) {
      const currentIdx = FORWARD_FLOW.indexOf(existing.status);
      const nextIdx = FORWARD_FLOW.indexOf(status);
      if (nextIdx === -1) throw new ReceiptError("Status tidak valid");
      if (nextIdx !== currentIdx + 1) {
        throw new ReceiptError(`Tidak bisa langsung ke status ${status} dari ${existing.status} — harus berurutan`);
      }
      if (status === "COMPLETED") {
        throw new ReceiptError("Status COMPLETED hanya ditetapkan lewat Simpan ke Stok (POST /:id/putaway)");
      }
      // Penerimaan dari PO: "tiba" dicatat LEWAT Catat Barang Tiba (tanggal tiba, jumlah datang, PIC/penerima, catatan wajib; aktor/peran/workspace dari sesi) — dasar termin & audit.
      if (status === "ARRIVED" && existing.purchaseOrderId && existing.arrivalRevision === 0) {
        throw new ReceiptError("Barang dari PO dinyatakan tiba lewat Catat Barang Tiba (Barang Akan Datang), bukan dengan mengganti status — tanggal tiba, jumlah datang, PIC/penerima, dan catatan wajib diisi.");
      }
      data.status = status;
    }

    // Draf boleh diedit, tetapi SETIAP perubahan meninggalkan jejak sebelum–sesudah (siapa/kapan/apa).
    const receipt = await prisma.$transaction(async (tx) => {
      const u = await tx.goodsReceipt.update({ where: { id: req.params.id }, data, include: receiptInclude });
      await catatPerubahanDraf(tx, { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: u.id, actorId: req.user.id, nomor: u.receiptNumber, lama: existing, data });
      return u;
    });
    res.json({ ...receipt, tampilan: tampilanPenerimaan(receipt) });
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/goods-receipts/:id/lines/:lineId
// Isi hasil kedatangan/inspeksi per baris. { receivedQty?, acceptedQty?, rejectedQty?, condition?, notes? }
goodsReceiptRouter.patch("/:id/lines/:lineId", requirePermission(P.INVENTORY_WRITE), wajibUuid("id", "lineId"), async (req, res) => {
  try {
    const receipt = await prisma.goodsReceipt.findUnique({ where: { id: req.params.id } });
    if (!receipt) return res.status(404).json({ error: "Goods receipt tidak ditemukan" });
    if (receipt.status === "COMPLETED" || receipt.status === "REJECTED") {
      throw new ReceiptError(`Receipt berstatus ${receipt.status} tidak bisa diubah lagi${receipt.status === "COMPLETED" && receipt.purchaseOrderId ? " dari sini — koreksi lewat Koreksi Kedatangan (Barang Akan Datang): wajib alasan, tercatat sebelum–sesudah, dan sesudah Simpan ke Stok memakai pembalik + pengganti bila terbukti aman" : ""}`);
    }
    const line = await prisma.goodsReceiptLine.findFirst({ where: { id: req.params.lineId, goodsReceiptId: receipt.id } });
    if (!line) return res.status(404).json({ error: "Baris item tidak ditemukan" });

    const { receivedQty, acceptedQty, rejectedQty, condition, notes } = req.body;
    const toNum = (v) => (v === undefined ? undefined : v === "" || v === null ? null : Number(v));
    // Jumlah DATANG baris PO ditetapkan oleh Catat Barang Tiba dan hanya dikoreksi lewat Koreksi Kedatangan (alasan + riwayat); pemeriksaan (baik/ditolak) tetap di sini.
    if (line.purchaseOrderLineId && receivedQty !== undefined && toNum(receivedQty) !== (line.receivedQty ?? null)) {
      throw new ReceiptError("Jumlah datang barang dari PO dicatat lewat Catat Barang Tiba dan dikoreksi lewat Koreksi Kedatangan (wajib alasan) — tidak diubah dari sini.");
    }
    // Baris penolakan yang sudah diganti supplier: jumlah ditolak tidak boleh turun di bawah pengganti yang sudah tercatat (hubungan pengganti → asal harus tetap masuk akal).
    if (line.purchaseOrderLineId && rejectedQty !== undefined) {
      const pengganti = await prisma.goodsReceiptLine.findMany({ where: { replacementForLineId: line.id, goodsReceipt: { status: { not: "REJECTED" } } }, select: { receivedQty: true } });
      const sudahDiganti = pengganti.reduce((n, r) => n + Math.round(Number(r.receivedQty ?? 0) * 1000), 0) / 1000;
      if (sudahDiganti > 0 && Number(toNum(rejectedQty) ?? 0) < sudahDiganti) throw new ReceiptError(`Jumlah ditolak tidak boleh di bawah ${sudahDiganti}: sebanyak itu sudah dicatat sebagai pengiriman pengganti dari baris ini.`);
    }
    // Baris yang tertaut PO: baik + ditolak ≤ datang, dan baik ≤ sisa PO (pemeriksaan dini; penegakan akhir di putaway). Baris tanpa PO: aturan lama.
    if (line.purchaseOrderLineId) {
      const gabung = (baru, lama) => (baru === undefined ? lama : toNum(baru));
      await validasiBarisPenerimaanPO(prisma, {
        receiptLine: line,
        nilai: {
          receivedQty: gabung(receivedQty, line.receivedQty),
          acceptedQty: gabung(acceptedQty, line.acceptedQty),
          rejectedQty: gabung(rejectedQty, line.rejectedQty),
        },
      });
    }
    const dataBaris = {
      ...(receivedQty !== undefined && { receivedQty: toNum(receivedQty) }),
      ...(acceptedQty !== undefined && { acceptedQty: toNum(acceptedQty) }),
      ...(rejectedQty !== undefined && { rejectedQty: toNum(rejectedQty) }),
      ...(condition !== undefined && { condition: condition || null }),
      ...(notes !== undefined && { notes: notes || null }),
    };
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.goodsReceiptLine.update({ where: { id: line.id }, data: dataBaris, include: { material: { select: { id: true, code: true, name: true, unit: true } } } });
      await catatPerubahanDraf(tx, { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: receipt.id, actorId: req.user.id, nomor: receipt.receiptNumber, lama: line, data: dataBaris, bagian: `baris ${u.material.code}` });
      return u;
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/goods-receipts/:id/kembali-draft   { alasan? }
// Jadwal yang SALAH dikembalikan ke Draf (hanya Terjadwal, barang belum dicatat tiba, belum ada jumlah/pergerakan stok). Tercatat sebelum–sesudah. Tidak menyentuh stok/PO/Finance.
goodsReceiptRouter.post("/:id/kembali-draft", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const alasan = String(req.body?.alasan ?? "").trim().slice(0, 300);
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "goods_receipts", req.params.id);
      const r = await tx.goodsReceipt.findUnique({ where: { id: req.params.id }, include: receiptInclude });
      if (!r) throw new ReceiptError("Penerimaan tidak ditemukan", 404);
      if (r.status === "DRAFT") return r; // sudah Draf: hasil sama (aman diulang)
      if (r.status !== "SCHEDULED") throw new ReceiptError(`Hanya penerimaan yang masih Terjadwal yang bisa dikembalikan ke Draf (sekarang: ${tampilanPenerimaan(r).label}).`, 409);
      const halang = penghalangBatalJadwal(r, await tx.stockMovement.count({ where: { goodsReceiptId: r.id } }));
      if (halang) { const e = new ReceiptError(halang.pesan, 409); e.code = halang.kode; throw e; }
      const u = await tx.goodsReceipt.update({ where: { id: r.id }, data: { status: "DRAFT" }, include: receiptInclude });
      await recordActivity(tx, { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: r.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: "KEMBALI_KE_DRAF", nomor: r.receiptNumber, sebelum: { status: "SCHEDULED" }, sesudah: { status: "DRAFT" }, alasan: alasan || null } });
      return u;
    });
    res.json({ ...hasil, tampilan: tampilanPenerimaan(hasil) });
  } catch (err) { handleErr(err, res); }
});

// POST /api/inventory/goods-receipts/:id/batalkan-jadwal   { alasan }
// Membatalkan penerimaan yang BELUM berpengaruh apa pun (Draf/Terjadwal, barang belum dicatat tiba, tanpa jumlah/pergerakan). Dokumen tidak dihapus: berstatus Dibatalkan beserta alasan dan pelaku.
// Beda dengan Tolak barang (barang sudah tiba lalu ditolak). PO tidak berubah; jadwal baru dapat dibuat dari PO.
goodsReceiptRouter.post("/:id/batalkan-jadwal", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const alasan = String(req.body?.alasan ?? "").trim();
    if (alasan.length < 3 || alasan.length > 300) throw new ReceiptError("Alasan pembatalan wajib diisi (3–300 karakter)", 400);
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "goods_receipts", req.params.id);
      const r = await tx.goodsReceipt.findUnique({ where: { id: req.params.id }, include: receiptInclude });
      if (!r) throw new ReceiptError("Penerimaan tidak ditemukan", 404);
      if (r.status === "REJECTED") return { ...r, _ulang: true }; // sudah dibatalkan/ditolak: hasil sama
      if (!["DRAFT", "SCHEDULED"].includes(r.status)) throw new ReceiptError(`Penerimaan berstatus ${tampilanPenerimaan(r).label} tidak bisa dibatalkan dari sini. ${r.status === "COMPLETED" ? "Pakai Koreksi." : "Pakai Tolak barang bila barang memang ditolak."}`, 409);
      const halang = penghalangBatalJadwal(r, await tx.stockMovement.count({ where: { goodsReceiptId: r.id } }));
      if (halang) { const e = new ReceiptError(halang.pesan, 409); e.code = halang.kode; throw e; }
      const dipakaiPengganti = await tx.goodsReceiptLine.count({ where: { replacementForLine: { goodsReceiptId: r.id }, goodsReceipt: { status: { not: "REJECTED" } } } });
      if (dipakaiPengganti > 0) throw new ReceiptError("Penerimaan ini sudah punya pengiriman pengganti yang tercatat — tidak bisa dibatalkan.", 409);
      const u = await tx.goodsReceipt.update({ where: { id: r.id }, data: { status: "REJECTED", notes: [r.notes, `Dibatalkan sebelum barang tiba: ${alasan}`].filter(Boolean).join(" — ") }, include: receiptInclude });
      await recordActivity(tx, { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: r.id, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: req.user.id, metadata: { aksi: "JADWAL_DIBATALKAN", nomor: r.receiptNumber, sebelum: { status: r.status }, sesudah: { status: "REJECTED", tampil: "Dibatalkan" }, alasan } });
      return u;
    });
    const { _ulang, ...dok } = hasil;
    res.json({ ...dok, ulang: !!_ulang, tampilan: tampilanPenerimaan(dok) });
  } catch (err) { handleErr(err, res); }
});

// ── Pemulihan dokumen (UX Tahap 1) ──────────────────────────────────────────────────────────────────────────────
// Tiga jalan aman untuk salah klik, TANPA menghapus jejak dan TANPA menulis pergerakan stok:
//   • pulihkan      : Dibatalkan (tidak pernah berisi barang) → Draf.
//   • batalkan-tiba : "Barang tiba" yang salah catat (belum ada hasil pemeriksaan, stok, faktur, retur) → kembali Terjadwal; isi catatan lama disimpan utuh di jejak.
//   • buat-ulang    : dokumen Ditolak/Dibatalkan yang tidak aman dipulihkan → dokumen BARU berstatus Draf, kedua dokumen saling tertaut di jejak. Dokumen lama tidak diubah.
const alasanPendek = (v, wajib) => {
  const a = String(v ?? "").trim();
  if (wajib && (a.length < 3 || a.length > 300)) throw new ReceiptError("Alasan wajib diisi (3–300 karakter)", 400);
  return a.slice(0, 300);
};
const statusFakturAktif = { notIn: ["DIBATALKAN", "DITOLAK"] };
const galat409 = (pesan, kode) => { const e = new ReceiptError(pesan, 409); e.code = kode; return e; };

// POST /api/inventory/goods-receipts/:id/pulihkan   { alasan? }
goodsReceiptRouter.post("/:id/pulihkan", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const alasan = alasanPendek(req.body?.alasan, false);
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "goods_receipts", req.params.id);
      const r = await tx.goodsReceipt.findUnique({ where: { id: req.params.id }, include: receiptInclude });
      if (!r) throw new ReceiptError("Penerimaan tidak ditemukan", 404);
      if (r.status === "DRAFT") return r; // sudah Draf: hasil sama (aman diulang)
      if (r.status !== "REJECTED") throw new ReceiptError(`Hanya penerimaan yang Dibatalkan yang bisa dipulihkan (sekarang: ${tampilanPenerimaan(r).label}).`, 409);
      if (!tidakPernahBerisi(r)) throw galat409("Penerimaan ini pernah berisi barang yang ditolak, jadi tidak dipulihkan di tempat. Buat penerimaan baru dari dokumen ini (riwayat saling tertaut).", "PERNAH_BERISI_BARANG");
      if ((await tx.stockMovement.count({ where: { goodsReceiptId: r.id } })) > 0) throw galat409("Penerimaan ini punya pergerakan stok — tidak dipulihkan.", "SUDAH_ADA_PERGERAKAN_STOK");
      if (r.purchaseOrder && !STATUS_PO_BISA_DITERIMA.includes(r.purchaseOrder.status)) throw galat409(`PO ${r.purchaseOrder.poNumber} berstatus ${r.purchaseOrder.status}, sudah tidak menerima barang. Dokumen tidak dipulihkan.`, "PO_TIDAK_BISA_DITERIMA");
      const u = await tx.goodsReceipt.update({ where: { id: r.id }, data: { status: "DRAFT" }, include: receiptInclude });
      await recordActivity(tx, { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: r.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: "DIPULIHKAN", nomor: r.receiptNumber, sebelum: { status: "REJECTED" }, sesudah: { status: "DRAFT" }, alasan: alasan || null } });
      return u;
    });
    res.json({ ...hasil, tampilan: tampilanPenerimaan(hasil) });
  } catch (err) { handleErr(err, res); }
});

// POST /api/inventory/goods-receipts/:id/batalkan-tiba   { alasan }
goodsReceiptRouter.post("/:id/batalkan-tiba", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const alasan = alasanPendek(req.body?.alasan, true);
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "goods_receipts", req.params.id);
      const r = await tx.goodsReceipt.findUnique({ where: { id: req.params.id }, include: receiptInclude });
      if (!r) throw new ReceiptError("Penerimaan tidak ditemukan", 404);
      if (r.status === "SCHEDULED" && !r.arrivedDate && Number(r.arrivalRevision ?? 0) === 0) return r; // sudah kembali Terjadwal: hasil sama
      if (!["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"].includes(r.status)) {
        throw new ReceiptError(`Catatan tiba hanya bisa dibatalkan saat penerimaan menunggu atau sedang diperiksa (sekarang: ${tampilanPenerimaan(r).label}).${r.status === "COMPLETED" ? " Sudah masuk stok: pakai Koreksi." : ""}`, 409);
      }
      const idBaris = r.lines.map((l) => l.id);
      const [pergerakan, fakturLangsung, fakturAlokasi, retur, pengganti] = await Promise.all([
        tx.stockMovement.count({ where: { goodsReceiptId: r.id } }),
        tx.finSupplierBill.count({ where: { goodsReceiptId: r.id, status: statusFakturAktif } }),
        tx.finSupplierBillAllocation.count({ where: { goodsReceiptId: r.id, bill: { status: statusFakturAktif } } }),
        tx.supplierReturnLine.count({ where: { goodsReceiptLineId: { in: idBaris }, supplierReturn: { status: { in: ["DRAFT", "KELUAR", "SELESAI"] } } } }),
        tx.goodsReceiptLine.count({ where: { replacementForLineId: { in: idBaris }, goodsReceipt: { status: { not: "REJECTED" } } } }),
      ]);
      const halang = penghalangBatalTiba(r, { pergerakan, faktur: fakturLangsung + fakturAlokasi, retur, pengganti });
      if (halang) throw galat409(`${halang.pesan} ${halang.langkah}`, halang.kode);
      const sebelum = {
        status: r.status, tanggalTiba: r.arrivedDate ? r.arrivedDate.toISOString().slice(0, 10) : null, penerima: r.arrivalReceiver, catatan: r.arrivalNote, suratJalan: r.deliveryNote ?? null,
        bukti: r.arrivalProofUrls ?? [], revisi: r.arrivalRevision,
        baris: r.lines.map((l) => ({ kode: l.material?.code ?? null, datang: l.receivedQty, pendamping: l.companionQty ?? null, penggantiDariBarisId: l.replacementForLineId ?? null })),
      };
      await tx.goodsReceipt.update({ where: { id: r.id }, data: { status: "SCHEDULED", arrivedDate: null, arrivalRecordedById: null, arrivalRecordedAt: null, arrivalActorRoles: null, arrivalWorkspace: null, arrivalReceiver: null, arrivalNote: null, arrivalProofUrls: [], arrivalRevision: 0 } });
      await tx.goodsReceiptLine.updateMany({ where: { goodsReceiptId: r.id }, data: { receivedQty: null, acceptedQty: null, rejectedQty: null, companionQty: null, replacementForLineId: null } });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: r.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: { aksi: "TIBA_DIBATALKAN", nomor: r.receiptNumber, sebelum, sesudah: { status: "SCHEDULED" }, alasan, catatan: "Catatan tiba sebelumnya tersimpan utuh di sini dan di riwayat kedatangan (tidak dihapus). Item yang tidak ikut tercatat tiba saat itu tidak kembali ke dokumen ini; buat jadwal baru dari PO untuk sisanya." },
      });
      return tx.goodsReceipt.findUnique({ where: { id: r.id }, include: receiptInclude });
    });
    res.json({ ...hasil, tampilan: tampilanPenerimaan(hasil) });
  } catch (err) { handleErr(err, res); }
});

// POST /api/inventory/goods-receipts/:id/buat-ulang   { alasan }   → 201 { ...dokumenBaru, dariId, dariNomor }
goodsReceiptRouter.post("/:id/buat-ulang", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const alasan = alasanPendek(req.body?.alasan, true);
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "goods_receipts", req.params.id);
      const lama = await tx.goodsReceipt.findUnique({ where: { id: req.params.id }, include: receiptInclude });
      if (!lama) throw new ReceiptError("Penerimaan tidak ditemukan", 404);
      if (lama.status !== "REJECTED") throw new ReceiptError(`Penerimaan baru dari dokumen lama hanya untuk yang Ditolak atau Dibatalkan (sekarang: ${tampilanPenerimaan(lama).label}).`, 409);
      // Aman diulang: bila dokumen ini sudah pernah dibuatkan penerimaan baru yang masih berjalan, kembalikan yang itu (tidak menggandakan).
      const sudah = await tx.activityEvent.findFirst({
        where: { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: lama.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, metadata: { path: ["aksi"], equals: "DIBUAT_ULANG_MENJADI" } },
        orderBy: { createdAt: "desc" },
      });
      if (sudah?.metadata?.keId) {
        const aktif = await tx.goodsReceipt.findUnique({ where: { id: sudah.metadata.keId }, include: receiptInclude });
        if (aktif && aktif.status !== "REJECTED") return { dok: aktif, baru: false, lama };
      }
      let data;
      if (lama.purchaseOrderId) {
        const ada = await tx.goodsReceipt.findFirst({ where: { purchaseOrderId: lama.purchaseOrderId, id: { not: lama.id }, status: { in: ["DRAFT", "SCHEDULED"] }, arrivalRevision: 0 }, orderBy: { createdAt: "asc" }, select: { receiptNumber: true } });
        if (ada) throw galat409(`PO ini sudah punya penerimaan ${ada.receiptNumber} yang menunggu barang tiba. Pakai dokumen itu, atau batalkan lebih dulu bila memang tidak dipakai.`, "SUDAH_ADA_JADWAL");
        const dariPO = await siapkanPenerimaanDariPO(tx, { purchaseOrderId: lama.purchaseOrderId });
        data = { sourceType: "PURCHASE_ORDER", sourceReference: dariPO.po.poNumber, supplier: dariPO.supplierName, purchaseOrderId: dariPO.po.id, lines: dariPO.lines };
      } else {
        data = {
          sourceType: lama.sourceType, sourceReference: lama.sourceReference, supplier: lama.supplier, purchaseOrderId: null,
          lines: lama.lines.map((l) => ({ materialId: l.materialId, orderedQty: l.orderedQty ?? null, purchaseOrderLineId: null })),
        };
      }
      const nomor = await nomorPenerimaanBaru(tx);
      const baru = await tx.goodsReceipt.create({
        data: {
          receiptNumber: nomor, sourceType: data.sourceType, sourceReference: data.sourceReference ?? null, supplier: data.supplier ?? null, purchaseOrderId: data.purchaseOrderId,
          expectedDate: lama.expectedDate, notes: `Dibuat ulang dari ${lama.receiptNumber}: ${alasan}`, createdById: req.user.id,
          lines: { create: data.lines.map((l) => ({ materialId: l.materialId, orderedQty: l.orderedQty != null ? Number(l.orderedQty) : null, purchaseOrderLineId: l.purchaseOrderLineId || null })) },
        },
        include: receiptInclude,
      });
      await recordActivity(tx, { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: baru.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: "DIBUAT_ULANG_DARI", nomor: baru.receiptNumber, dariId: lama.id, dariNomor: lama.receiptNumber, dariStatus: tampilanPenerimaan(lama).label, alasan } });
      await recordActivity(tx, { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: lama.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: "DIBUAT_ULANG_MENJADI", nomor: lama.receiptNumber, keId: baru.id, keNomor: baru.receiptNumber, alasan } });
      return { dok: baru, baru: true, lama };
    });
    res.status(hasil.baru ? 201 : 200).json({ ...hasil.dok, tampilan: tampilanPenerimaan(hasil.dok), dariId: hasil.lama.id, dariNomor: hasil.lama.receiptNumber, ulang: !hasil.baru });
  } catch (err) { handleErr(err, res); }
});

// POST /api/inventory/goods-receipts/:id/putaway
// SATU-SATUNYA jalan sebuah baris goods receipt menjadi baris ledger nyata.
// Wajib status READY_FOR_PUTAWAY. Untuk tiap baris dengan acceptedQty > 0,
// membuat SATU StockMovement RECEIPT (qty positif, supplier dari header
// receipt, goodsReceiptId menempel) — lalu menutup receipt jadi COMPLETED.
// Dibungkus transaksi: kalau satu baris gagal, tidak ada ledger yang
// setengah tertulis.
goodsReceiptRouter.post("/:id/putaway", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const preCheck = await prisma.goodsReceipt.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Goods receipt tidak ditemukan" });
    const { location } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      // Kunci dokumen ini DULU (lock "goods_receipts") — mencegah dua request
      // putaway paralel untuk receipt YANG SAMA dua-duanya lolos cek status
      // sebelum salah satu commit (double posting ledger yang sama).
      await lockRowForUpdate(tx, "goods_receipts", preCheck.id);
      const receipt = await tx.goodsReceipt.findUnique({ where: { id: preCheck.id }, include: receiptInclude });
      if (receipt.status !== "READY_FOR_PUTAWAY") {
        throw new ReceiptError("Hanya receipt berstatus Siap Disimpan yang bisa disimpan ke stok");
      }
      const diterima = receipt.lines.filter((l) => l.acceptedQty != null && l.acceptedQty > 0);
      if (diterima.length === 0) {
        throw new ReceiptError("Tidak ada baris dengan Accepted Quantity — isi hasil inspeksi dulu");
      }

      // Penerimaan dari PO: kunci PO, pastikan jumlah baik kumulatif tidak melebihi PO (melebihi = 409, TIDAK ada stok tertulis), dan ambil
      // harga satuan PO untuk menilai stok — itulah yang membuat jurnal Dr Persediaan / Cr Utang Barang Belum Ditagih terbentuk di bawah.
      const cek = await periksaPutaway(tx, receipt);
      for (const line of diterima) {
        // Baris PO berkonversi satuan (mis. 2 BOX × 12 = 24 CAN): stok bertambah dalam satuan stok, harga per satuan stok eksak (unitCostExact) supaya nilai penerimaan tetap persis nilai PO.
        const kv = line.purchaseOrderLineId ? cek?.konversi.get(line.purchaseOrderLineId) : undefined;
        await postStockMovement(tx, {
          materialId: line.materialId, type: "RECEIPT", qty: kv ? kv.qtyStok.toString() : line.acceptedQty,
          unitCost: kv ? kv.hargaStokBulat : line.purchaseOrderLineId ? cek?.harga.get(line.purchaseOrderLineId) : undefined,
          unitCostExact: kv ? kv.hargaStokEksak.toString() : undefined,
          location, supplier: receipt.supplier || null,
          note: kv ? `Simpan ke Stok ${receipt.receiptNumber} (${line.acceptedQty} ${kv.satuanBeli} × ${kv.faktor.toString()})` : `Simpan ke Stok ${receipt.receiptNumber}`, goodsReceiptId: receipt.id,
          createdById: req.user.id,
        });
      }
      const updated = await tx.goodsReceipt.update({
        where: { id: receipt.id },
        data: { status: "COMPLETED", receivedDate: receipt.receivedDate || new Date() },
        include: receiptInclude,
      });
      await selesaiPutaway(tx, {
        receipt, userId: req.user.id,
        ditempatkan: diterima.map((l) => ({ materialId: l.materialId, purchaseOrderLineId: l.purchaseOrderLineId, diterimaBaik: l.acceptedQty, ditolak: l.rejectedQty ?? 0 })),
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: receipt.id,
        eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: { receiptNumber: receipt.receiptNumber, lineCount: diterima.length },
      });

      // Buku besar (D-180) — DIPANGGIL SETELAH postStockMovement di atas,
      // urutannya wajib: fungsi ini membaca ledger yang baru saja ditulis.
      // Kegagalan konfigurasi finance (bagan akun belum dipasang, periode
      // tertutup) TIDAK boleh menggagalkan putaway — gudang harus tetap
      // bisa menempatkan barang. Kegagalan seperti itu sudah dicatat
      // sebagai FinPostingGap di dalam fungsinya sendiri; yang ditangkap di
      // sini hanya JournalError/AccountError yang lolos keluar.
      try {
        await postGoodsReceiptValue(tx, { goodsReceiptId: receipt.id, userId: req.user.id });
      } catch (e) {
        if (!(e instanceof JournalError) && !(e instanceof AccountError)) throw e;
      }
      return updated;
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/goods-receipts/:id/reject { reason }
goodsReceiptRouter.patch("/:id/reject", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const preCheck = await prisma.goodsReceipt.findUnique({ where: { id: req.params.id } });
    if (!preCheck) return res.status(404).json({ error: "Goods receipt tidak ditemukan" });
    const { reason } = req.body;
    if (!reason?.trim()) throw new ReceiptError("Alasan penolakan wajib diisi");

    const updated = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "goods_receipts", preCheck.id);
      const receipt = await tx.goodsReceipt.findUnique({ where: { id: preCheck.id } });
      if (receipt.status === "COMPLETED" || receipt.status === "REJECTED") {
        throw new ReceiptError(`Receipt berstatus ${receipt.status} tidak bisa ditolak`);
      }
      const dipakaiPengganti = await tx.goodsReceiptLine.count({ where: { replacementForLine: { goodsReceiptId: receipt.id }, goodsReceipt: { status: { not: "REJECTED" } } } });
      if (dipakaiPengganti > 0) throw new ReceiptError("Penerimaan ini sudah punya pengiriman pengganti yang tercatat — tidak bisa ditolak seluruhnya.");
      const result = await tx.goodsReceipt.update({
        where: { id: receipt.id },
        data: { status: "REJECTED", notes: [receipt.notes, `Ditolak: ${reason.trim()}`].filter(Boolean).join(" — ") },
        include: receiptInclude,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: receipt.id,
        eventType: EVENT_TYPES.DOCUMENT_REJECTED, actorId: req.user.id,
        metadata: { receiptNumber: receipt.receiptNumber, reason: reason.trim() },
      });
      return result;
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});
