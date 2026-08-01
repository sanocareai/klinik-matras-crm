import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
// Batas rentang tanggal WIB — WAJIB dipakai, jangan `new Date(from)` polos.
// Container backend jalan di UTC, jadi batas polos menggeser jendela 7 jam
// (lihat CLAUDE.md §11 "TANGGAL & TIMEZONE").
import { startOfDayWIB, endOfDayExclusiveWIB } from "../utils/wib.js";
import { syncCustomerOrderAggregate } from "../services/customerOrderAggregate.js";
import { recomputeOrderPaymentStatus } from "../services/paymentLedger.js";

export const orderRouter = express.Router();
orderRouter.use(requireAuth);

// Upload bukti pembayaran DP (D-023) — dir terpisah dari job-photos armada.js
// karena DP dicatat SEBELUM job pickup/delivery mana pun ada, jadi tidak
// punya jobId untuk dijadikan prefix nama file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const paymentProofsDir = path.join(__dirname, "../../data/payment-proofs");
if (!fs.existsSync(paymentProofsDir)) fs.mkdirSync(paymentProofsDir, { recursive: true });
const proofUpload = multer({
  storage: multer.diskStorage({
    destination: paymentProofsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${req.params.id}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Hanya file gambar yang diperbolehkan"));
    cb(null, true);
  },
});

// Helper: hitung ulang Order.value = SUM semua items, update ke DB, LALU
// sinkronkan Customer.orderCount/orderValue (dipakai 3 endpoint di bawah:
// tambah/ubah/hapus item layanan — sentralisasi di sini supaya sync-nya
// tidak perlu diulang manual di tiap endpoint).
async function syncOrderValue(orderId) {
  const agg = await prisma.orderItem.aggregate({
    where: { orderId },
    _sum: { harga: true },
  });
  const total = agg._sum.harga || 0;
  const order = await prisma.order.update({
    where: { id: orderId }, data: { value: total }, select: { customerId: true },
  });
  await syncCustomerOrderAggregate(order.customerId);
  return total;
}

// PATCH /api/orders/:id — edit order (status, paymentStatus, notes, qty, orderNumber)
// value TIDAK bisa diubah langsung dari sini — dikontrol oleh items
orderRouter.patch("/:id", async (req, res) => {
  const { status, paymentStatus, quantity, notes, orderNumber,
          merkKasur, ukuranKasur, keluhanCustomer, jenisLayanan, hargaTotal } = req.body;
  try {
    // Update + catat riwayat status dalam SATU transaksi, supaya tidak pernah
    // ada baris riwayat tanpa perubahan order yang berhasil (dan sebaliknya).
    // Pola ini sama dengan pipeline_transitions di routes/customers.js.
    const order = await prisma.$transaction(async (tx) => {
      const sebelum = await tx.order.findUnique({
        where: { id: req.params.id },
        select: { status: true },
      });
      if (!sebelum) {
        throw Object.assign(new Error("Order tidak ditemukan"), { statusCode: 404 });
      }

      const updated = await tx.order.update({
        where: { id: req.params.id },
        data: {
          ...(status            !== undefined && { status }),
          ...(paymentStatus     !== undefined && { paymentStatus }),
          ...(quantity          !== undefined && { quantity: Number(quantity) }),
          ...(notes             !== undefined && { notes }),
          ...(orderNumber       !== undefined && { orderNumber: orderNumber?.trim() || null }),
          ...(merkKasur         !== undefined && { merkKasur }),
          ...(ukuranKasur       !== undefined && { ukuranKasur }),
          ...(keluhanCustomer   !== undefined && { keluhanCustomer }),
          ...(jenisLayanan      !== undefined && { jenisLayanan }),
          ...(hargaTotal        !== undefined && { value: hargaTotal ? Number(hargaTotal) : 0 }),
        },
        include: {
          items:         { orderBy: { sortOrder: "asc" } },
          weightEntries: { orderBy: { sortOrder: "asc" } },
        },
      });

      // HANYA kalau status BENAR-BENAR berpindah. Form order mengirim seluruh
      // field termasuk status yang tidak berubah — tanpa cek ini riwayat penuh
      // baris "PENDING → PENDING" dan durasi per tahap jadi tidak berguna.
      if (status !== undefined && status !== sebelum.status) {
        await tx.orderStatusTransition.create({
          data: {
            orderId:     updated.id,
            fromStatus:  sebelum.status,
            toStatus:    status,
            changedById: req.user?.id || null,
          },
        });
      }

      return updated;
    });

    // Di LUAR transaksi (sync-nya sendiri melakukan query & update terpisah,
    // tidak perlu ikut atomicity dengan update order — kalau sync gagal,
    // order-nya sendiri tetap berhasil tersimpan, cuma kolom denormalized
    // Customer sesaat tidak sinkron sampai order berikutnya di-sentuh).
    await syncCustomerOrderAggregate(order.customerId);

    res.json(order);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// POST /api/orders/:id/payments/proof — upload multipart, kembalikan URL.
// Sama pola dengan POST /armada/jobs/:id/photos.
orderRouter.post("/:id/payments/proof", proofUpload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File foto wajib diisi" });
  res.json({ url: `/media/payment-proofs/${req.file.filename}` });
});

// POST /api/orders/:id/payments { amount, method, proofPhotoUrl? }
// DP saat konfirmasi order (FR-M-01, D-023) — TANPA jobId, beda dari
// pencatatan driver di stop pengiriman (D-011). Sales/admin mana pun yang
// login boleh mencatat (sama longgarnya dengan PATCH paymentStatus manual
// yang sudah ada — orderRouter tidak pakai gate P.* granular, lihat CLAUDE.md
// sano-hub §"PRD bilang RLS... di sini artinya middleware Express").
orderRouter.post("/:id/payments", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const { amount, method, proofPhotoUrl } = req.body;
    const amountInt = Number(amount);
    if (!Number.isInteger(amountInt) || amountInt <= 0) {
      return res.status(400).json({ error: "Jumlah pembayaran wajib angka bulat lebih dari 0" });
    }
    if (!["CASH", "TRANSFER", "QRIS"].includes(method)) {
      return res.status(400).json({ error: "Metode pembayaran tidak valid" });
    }
    if (proofPhotoUrl != null && !String(proofPhotoUrl).startsWith("/media/payment-proofs/")) {
      return res.status(400).json({ error: "URL foto bukti tidak valid" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: req.params.id, amount: amountInt, method,
          proofPhotoUrl: proofPhotoUrl || null,
          recordedById: req.user.id,
        },
      });
      const status = await recomputeOrderPaymentStatus(tx, req.params.id);
      return { payment, status };
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// ── GET /api/orders — DAFTAR order (order-centric) ────────────────────────
// Sebelumnya TIDAK ADA endpoint daftar order sama sekali: order hanya bisa
// dibuat/diedit lewat profil customer, jadi pertanyaan operasional paling
// dasar — "order mana yang sedang dikerjakan sekarang?" — tidak bisa dijawab
// tanpa membuka pelanggan satu per satu. Tabel Pelanggan pun tidak menolong:
// 1.297 pelanggan sementara hanya ~68 punya order, jadi yang sedang diproses
// tenggelam di antara ribuan lead dingin.
//
// `conversationId` disertakan supaya baris order bisa langsung membuka chat
// customer-nya (?conv=<id>) — sama seperti kartu Kanban Pipeline.
orderRouter.get("/", async (req, res) => {
  try {
    const { status, category, paymentStatus, search, from, to, hasComplaint } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);

    const where = {
      ...(status        && { status }),
      ...(category      && { category }),
      ...(paymentStatus && { paymentStatus }),
      ...(hasComplaint === "true" && { hasComplaint: true }),
      ...(from && to && { createdAt: { gte: startOfDayWIB(from), lt: endOfDayExclusiveWIB(to) } }),
      ...(search && {
        OR: [
          { orderNumber: { contains: search, mode: "insensitive" } },
          { customer: { name:  { contains: search, mode: "insensitive" } } },
          { customer: { phone: { contains: search } } },
        ],
      }),
    };

    const orders = await prisma.order.findMany({
      where,
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        // BUG YANG DIPERBAIKI (ditemukan sebelum sempat dipakai — mobile
        // OrdersScreen.js membuka OrderFormModal edit yang sama dengan
        // konteks 1-customer): tanpa weightEntries di sini, form edit
        // mengira order ini TIDAK PUNYA berat badan tersimpan sama sekali
        // (array kosong), dan logika diff-nya (bandingkan weightEntries
        // lama vs form) akan memperlakukan SEMUA entri berat yang sudah
        // ada sebagai "tidak ada" — berpotensi menduplikasi atau
        // menghapus data berat badan multi-orang yang sudah benar
        // tersimpan. items sudah disertakan sebelumnya justru karena bug
        // yang sama akan terjadi pada baris layanan kalau tidak disertakan.
        weightEntries: { orderBy: { sortOrder: "asc" } },
        customer: {
          select: {
            id: true, name: true, phone: true, city: true, profilePictureUrl: true,
            pipelineStage: true, healthStatus: true,
            assignedSales: { select: { id: true, name: true } },
            conversations: {
              where: { type: "INDIVIDUAL" },
              orderBy: { lastMessageAt: "desc" }, take: 1,
              select: { id: true },
            },
          },
        },
        // Transisi TERAKHIR — dipakai menghitung "sudah berapa lama di status
        // ini". Kalau belum ada riwayat (order lama, sebelum tabel riwayat
        // dibuat), jatuh ke updatedAt dan ditandai `perkiraan: true` supaya UI
        // tidak menyajikan tebakan sebagai fakta.
        statusTransitions: {
          orderBy: { createdAt: "desc" }, take: 1,
          select: { createdAt: true, fromStatus: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    const now = Date.now();
    const items = orders.map(({ customer, statusTransitions, ...o }) => {
      const trans = statusTransitions[0] || null;
      const sejak = trans?.createdAt || o.updatedAt;
      return {
        ...o,
        customerId:   customer?.id || null,
        customerName: customer?.name || null,
        customerPhone: customer?.phone || null,
        customerCity: customer?.city || null,
        profilePictureUrl: customer?.profilePictureUrl || null,
        pipelineStage: customer?.pipelineStage || null,
        healthStatus:  customer?.healthStatus || null,
        assignedSales: customer?.assignedSales || null,
        conversationId: customer?.conversations?.[0]?.id || null,
        statusSince: sejak,
        daysInStatus: Math.floor((now - new Date(sejak).getTime()) / 86_400_000),
        // true = dihitung dari updatedAt karena riwayat belum ada, jadi bisa
        // lebih pendek dari kenyataan (updatedAt berubah tiap edit apa pun).
        daysInStatusPerkiraan: !trans,
      };
    });

    // Ringkasan per status untuk header papan — dihitung di server supaya UI
    // tidak perlu memuat SELURUH order hanya untuk menghitung jumlah kolom.
    const perStatus = await prisma.order.groupBy({
      by: ["status"],
      where: { ...where, status: undefined },
      _count: { _all: true }, _sum: { value: true },
    });

    res.json({
      items,
      total: items.length,
      truncated: items.length >= limit,
      perStatus: perStatus.map((g) => ({
        status: g.status, count: g._count._all, value: g._sum.value || 0,
      })),
    });
  } catch (err) {
    console.error("orders list error:", err);
    res.status(500).json({ error: "Gagal memuat daftar order" });
  }
});

// ── GET /api/orders/:id/timeline — riwayat status satu order ───────────────
orderRouter.get("/:id/timeline", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, createdAt: true },
    });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const rows = await prisma.orderStatusTransition.findMany({
      where: { orderId: req.params.id },
      orderBy: { createdAt: "asc" },
      include: { changedBy: { select: { id: true, name: true } } },
    });

    // Lama tertahan di tiap status = jarak ke transisi BERIKUTNYA (atau ke
    // sekarang untuk status terakhir).
    const now = Date.now();
    const timeline = rows.map((r, i) => {
      const berikut = rows[i + 1];
      const akhir = berikut ? new Date(berikut.createdAt).getTime() : now;
      return {
        fromStatus: r.fromStatus,
        toStatus:   r.toStatus,
        createdAt:  r.createdAt,
        changedBy:  r.changedBy?.name || null,
        // Lama BERADA di toStatus setelah transisi ini.
        hariDiStatus: Math.floor((akhir - new Date(r.createdAt).getTime()) / 86_400_000),
        berjalan: !berikut,
      };
    });

    res.json({
      orderId: order.id,
      statusSekarang: order.status,
      dibuatPada: order.createdAt,
      timeline,
      // Riwayat tidak bisa di-backfill — UI harus menjelaskan ini kalau kosong
      // padahal order sudah lama ada.
      riwayatKosong: timeline.length === 0,
    });
  } catch (err) {
    console.error("order timeline error:", err);
    res.status(500).json({ error: "Gagal memuat riwayat order" });
  }
});

// DELETE /api/orders/:id — hapus order beserta items & weightEntries (cascade via FK)
orderRouter.delete("/:id", async (req, res) => {
  try {
    // customerId diambil SEBELUM delete — setelah dihapus tidak ada lagi
    // jalan untuk tahu order ini tadinya milik customer mana.
    const existing = await prisma.order.delete({ where: { id: req.params.id } });
    await syncCustomerOrderAggregate(existing.customerId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/orders/:id/complaint — tandai order sebagai komplain
// Hanya bisa kalau status order sudah DELIVERED
orderRouter.patch("/:id/complaint", async (req, res) => {
  const { complaintDetail } = req.body;
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (order.status !== "DELIVERED") {
      return res.status(400).json({ error: "Komplain hanya bisa dicatat setelah order berstatus DELIVERED (sudah terkirim/selesai)" });
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        hasComplaint:    true,
        complaintDate:   new Date(),
        complaintDetail: complaintDetail?.trim() || null,
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders/:orderId/items — tambah item layanan
orderRouter.post("/:orderId/items", async (req, res) => {
  const { layananName, harga, sortOrder } = req.body;
  if (!layananName?.trim()) return res.status(400).json({ error: "Nama layanan wajib diisi" });
  if (harga === undefined || harga === null) return res.status(400).json({ error: "Harga wajib diisi" });

  try {
    const item = await prisma.orderItem.create({
      data: {
        orderId: req.params.orderId,
        layananName: layananName.trim(),
        harga: Number(harga),
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
      },
    });
    const newTotal = await syncOrderValue(req.params.orderId);
    res.status(201).json({ item, orderValue: newTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/orders/items/:itemId — edit item layanan
orderRouter.patch("/items/:itemId", async (req, res) => {
  const { layananName, harga, sortOrder } = req.body;
  try {
    const item = await prisma.orderItem.update({
      where: { id: req.params.itemId },
      data: {
        ...(layananName !== undefined && { layananName: layananName.trim() }),
        ...(harga       !== undefined && { harga: Number(harga) }),
        ...(sortOrder   !== undefined && { sortOrder: Number(sortOrder) }),
      },
    });
    const newTotal = await syncOrderValue(item.orderId);
    res.json({ item, orderValue: newTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/orders/items/:itemId — hapus item layanan
orderRouter.delete("/items/:itemId", async (req, res) => {
  try {
    const item = await prisma.orderItem.delete({ where: { id: req.params.itemId } });
    const newTotal = await syncOrderValue(item.orderId);
    res.json({ ok: true, orderValue: newTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders/:id/weight-entries — tambah baris berat badan
orderRouter.post("/:id/weight-entries", async (req, res) => {
  const { label, beratKg, sortOrder } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: "Label wajib diisi" });
  if (!beratKg)       return res.status(400).json({ error: "Berat badan wajib diisi" });
  try {
    const entry = await prisma.orderWeightEntry.create({
      data: {
        orderId:   req.params.id,
        label:     label.trim(),
        beratKg:   Number(beratKg),
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
      },
    });
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/orders/weight-entries/:entryId — edit baris berat badan
orderRouter.patch("/weight-entries/:entryId", async (req, res) => {
  const { label, beratKg, sortOrder } = req.body;
  try {
    const entry = await prisma.orderWeightEntry.update({
      where: { id: req.params.entryId },
      data: {
        ...(label     !== undefined && { label: label.trim() }),
        ...(beratKg   !== undefined && { beratKg: Number(beratKg) }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
      },
    });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/orders/weight-entries/:entryId — hapus baris berat badan
orderRouter.delete("/weight-entries/:entryId", async (req, res) => {
  try {
    await prisma.orderWeightEntry.delete({ where: { id: req.params.entryId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
