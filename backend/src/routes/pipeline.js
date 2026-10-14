import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
// Batas hari WIB — WAJIB, jangan `new Date(from)` polos (lihat CLAUDE.md §11
// & catatan panjang di utils/wib.js — container backend jalan di UTC).
import { startOfDayWIB, endOfDayExclusiveWIB } from "../utils/wib.js";
import { loadOrderMilestones } from "../services/orderMilestoneService.js";
import { PILIH_KREDIT, nilaiBersih } from "../services/orderNilaiBersih.js";

export const pipelineRouter = express.Router();
pipelineRouter.use(requireAuth);

// GET /api/pipeline/board?from=&to= — pelanggan dikelompokkan per pipeline
// stage. `from`/`to` (opsional) memfilter Customer.createdAt — TANPA filter,
// papan menampilkan SEMUA pelanggan di tiap stage (perilaku lama, dipakai
// kalau frontend tidak mengirim tanggal sama sekali).
// Pembeli aktual Penjualan Karyawan bukan lead Sales. `leadSource: { not }` di Prisma ikut membuang baris NULL — maka NULL ditulis eksplisit supaya pelanggan tanpa sumber tetap tampil.
const BUKAN_PKR = [{ leadSource: null }, { leadSource: { not: "PENJUALAN_KARYAWAN" } }];

pipelineRouter.get("/board", async (req, res) => {
  try {
    const { from, to } = req.query;
    // staffUserId: null — profil internal karyawan (Penjualan Karyawan → Order CRM) bukan lead Sales, tidak masuk papan pipeline.
    const where = (from && to)
      ? { createdAt: { gte: startOfDayWIB(from), lt: endOfDayExclusiveWIB(to) }, staffUserId: null, OR: BUKAN_PKR }
      : { staffUserId: null, OR: BUKAN_PKR };

    const customers = await prisma.customer.findMany({
      where,
      include: {
        orders: { include: PILIH_KREDIT }, // nilai kolom/kartu = BERSIH dari Nota Kredit aktif (Okt 2026)
        assignedSales: { select: { id: true, name: true } },
        // `id` percakapan terakhir dipilih supaya kartu Kanban bisa deep-link
        // langsung ke chat customer (?conv=<id>) — sebelumnya kartu tidak
        // punya jalan ke Inbox sama sekali, sales harus mencari manual.
        // type INDIVIDUAL: grup WA internal bukan percakapan customer.
        conversations: {
          where: { type: "INDIVIDUAL" },
          orderBy: { lastMessageAt: "desc" },
          take: 1,
          select: { id: true, lastMessageAt: true, unreadCount: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const now = Date.now();
    const STAGES = ["NEW", "PROSPECT", "TRANSACTION", "REVIEWED", "SPAM"];

    const board = {};
    STAGES.forEach((s) => { board[s] = []; });

    // Status global tingkat order (milestone) untuk order TERBARU tiap pelanggan — satu batch untuk seluruh papan.
    const latestOf = (os) => (os.length ? os.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] : null);
    const latestOrders = customers.map((c) => latestOf(c.orders)).filter(Boolean);
    const latestMs = await loadOrderMilestones(prisma, latestOrders);
    customers.forEach(({ orders, conversations, ...c }) => {
      const stage = c.pipelineStage || "NEW";
      const daysSince = Math.floor((now - new Date(c.updatedAt).getTime()) / 86_400_000);
      // CANCELLED dikecualikan dari nilai — konsisten dengan seluruh endpoint
      // lain (analytics, sales-report, GET /customers). Tanpa ini, total per
      // kolom Kanban (dan nilai di tiap kartu) bisa menghitung uang dari deal
      // yang sudah batal seolah masih berjalan.
      const ordersAktif = orders.filter((o) => o.status !== "CANCELLED");
      // Nilai kartu/kolom = order PASTI saja: PENDING ("Menunggu", belum pasti,
      // keputusan Owner 30 Sep 2026) tidak dihitung, sama dengan Laporan.
      // Nilainya tetap dikirim terpisah (pendingValue) untuk ditampilkan.
      const totalValue = ordersAktif.reduce((sum, o) => sum + (o.status === "PENDING" ? 0 : nilaiBersih(o)), 0);
      const pendingValue = ordersAktif.reduce((sum, o) => sum + (o.status === "PENDING" ? nilaiBersih(o) : 0), 0);
      const conv = conversations?.[0] || null;
      if (!board[stage]) board[stage] = [];
      board[stage].push({
        ...c,
        orderCount: ordersAktif.length,
        totalValue,
        pendingValue,
        daysSince,
        conversationId: conv?.id || null,
        lastMessageAt: conv?.lastMessageAt || null,
        unreadCount: conv?.unreadCount || 0,
        // Status order TERBARU — supaya kartu Kanban menunjukkan tahap
        // pengerjaan, bukan cuma stage penjualan. Dua hal berbeda: customer
        // bisa COMPLETED sementara kasurnya masih PROCESSING.
        latestOrderStatus: orders.length
          ? orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0].status
          : null,
        // Status global (milestone) order terbaru: unit tertinggal + rincian; latestOrderStatus lama tetap untuk kompatibilitas.
        latestOrderMilestone: latestOf(orders) ? latestMs.get(latestOf(orders).id) ?? null : null,
      });
    });

    res.json(board);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pipeline/order-board?from=&to= — pipeline BERBASIS ORDER (30 Sep
// 2026, permintaan owner): papan /board di atas mengelompokkan PELANGGAN per
// stage penjualan (New/Prospek/Transaksi/Reviewed/Spam), sedangkan ini
// mengelompokkan ORDER per status pengerjaan (Menunggu → Pengambilan →
// Diproses → Siap Kirim → Pengiriman → Terkirim, plus Sewa & Dibatalkan).
// Status order dihitung otomatis dari unit (orderStatusSync), jadi papan ini
// READ-ONLY — tidak ada drag. Filter tanggal = Order.createdAt (WIB), sama
// dengan Laporan. Order milik pelanggan SPAM dikecualikan (D-041). Sales =
// sales yang ditugaskan ke pelanggan, sama dengan papan pelanggan.
// `inOmset` = status ini dihitung omset (Menunggu & Dibatalkan tidak).
const ORDER_BOARD_STATUSES = ["PENDING", "PICKUP", "PROCESSING", "READY", "SHIPPING", "DELIVERED", "SEWA_DIKIRIM", "SEWA_DIAMBIL", "CANCELLED"];
pipelineRouter.get("/order-board", async (req, res) => {
  try {
    const { from, to } = req.query;
    const createdAt = (from && to)
      ? { createdAt: { gte: startOfDayWIB(from), lt: endOfDayExclusiveWIB(to) } }
      : {};
    const orders = await prisma.order.findMany({
      where: { ...createdAt, penjualanKaryawanId: null, customer: { pipelineStage: { not: "SPAM" } } }, // order Penjualan Karyawan bukan deal Sales
      select: {
        id: true, orderNumber: true, status: true, value: true, category: true,
        paymentStatus: true, createdAt: true, updatedAt: true, ...PILIH_KREDIT,
        customer: {
          select: {
            id: true, name: true, phone: true, city: true, assignedSalesId: true,
            assignedSales: { select: { id: true, name: true } },
            conversations: {
              where: { type: "INDIVIDUAL" }, orderBy: { lastMessageAt: "desc" }, take: 1, select: { id: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const now = Date.now();
    const board = {};
    ORDER_BOARD_STATUSES.forEach((st) => { board[st] = []; });
    const milestones = await loadOrderMilestones(prisma, orders);
    for (const { customer, ...o } of orders) {
      if (!board[o.status]) board[o.status] = [];
      const { orderCredits, ...oo } = o;
      board[o.status].push({
        ...oo,
        value: nilaiBersih(o), // kartu papan order = nilai BERSIH; `nilaiKotor` = Order.value mentah
        nilaiKotor: o.value,
        milestone: milestones.get(o.id) ?? null, // status global tingkat order; kolom papan TETAP menurut Order.status tersimpan (kompatibel)
        daysSince: Math.floor((now - new Date(o.updatedAt).getTime()) / 86_400_000),
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerCity: customer.city,
        assignedSalesId: customer.assignedSalesId,
        assignedSalesName: customer.assignedSales?.name || null,
        conversationId: customer.conversations?.[0]?.id || null,
      });
    }
    res.json({ statuses: ORDER_BOARD_STATUSES, board });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
