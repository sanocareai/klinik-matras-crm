import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { rolesOf } from "../middleware/authorize.js";
// Batas rentang tanggal WIB — WAJIB dipakai, jangan `new Date(from)` polos.
// Container backend jalan di UTC, jadi batas polos menggeser jendela 7 jam
// (lihat CLAUDE.md §11 "TANGGAL & TIMEZONE").
import { startOfDayWIB, endOfDayExclusiveWIB, parseTanggalKalender } from "../utils/wib.js";
import { syncCustomerOrderAggregate } from "../services/customerOrderAggregate.js";
import { recomputeOrderPaymentStatus } from "../services/paymentLedger.js";
import { createUnitsForOrder } from "../services/unitProvisioning.js";
import { syncOrderStatus } from "../services/orderStatusSync.js";
import { sendText } from "../services/wahaClient.js";
import { sendWithSessionFallback, resolveSendTarget, SessionResolutionError, SESSION_UNKNOWN_ERROR } from "./conversations.js";
import { buildMessagePreview } from "../utils/messagePreview.js";
import { emitNewMessage, emitConversationUpdate } from "../socket.js";

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

// D-025 (revisi 19 Agustus 2026): kunci transaksi — order yang SUDAH LUNAS
// (bukan sekadar sudah terkirim) tidak boleh diedit SALES/role lain lagi,
// cuma ADMIN. Dipasang di semua endpoint yang mengubah field NON-STATUS
// (item layanan, harga, catatan, berat badan, pembayaran, jumlah unit) —
// status sendiri TETAP ikut alur D-006 (dihitung otomatis / override
// eksplisit), itu sudah punya jalur audit terpisah, jadi TIDAK ikut dikunci
// di sini (lihat pemisahan di PATCH /:id di bawah).
//
// ⚠️ PEMICU AWALNYA `status === "DELIVERED"`, DIUBAH setelah tes pilot nyata:
// order yang SUDAH TERKIRIM tapi BELUM LUNAS (mis. COD belum ditagih, invoice
// masih jalan) ternyata tetap butuh diedit sales — typo harga/layanan yang
// baru ketahuan setelah kasur sampai bukan kasus langka. Uang yang sudah
// pindah tangan (LUNAS) itu yang sebenarnya butuh dijaga dari perubahan
// diam-diam, bukan status pengirimannya. paymentStatus sendiri bukan label
// bebas — dihitung dari ledger Payment (services/paymentLedger.js:
// SUM(Payment) vs Order.value), jadi ini pemicu yang punya dasar data nyata.
//
// Kalau ADMIN yang mengedit order yang sudah LUNAS, otomatis TERCATAT ke
// OrderRevisionLog (ledger append-only) — supaya transaksi yang harusnya
// sudah selesai tetap punya jejak siapa/kapan/kenapa berubah lagi. Biasanya
// ini terjadi karena revisi/komplain dari pelanggan — sales menandainya lewat
// PATCH /:id/complaint (TIDAK dikunci — itu memang jalur "ajukan revisi"-nya,
// DAN tetap mensyaratkan status DELIVERED seperti semula, terpisah dari kunci
// pembayaran ini), lalu admin yang menindaklanjuti edit datanya di sini.
//
// Kalau revisinya butuh kasur fisik dibawa balik & dikerjakan ulang, itu
// beda sistem — sudah ada di Sano Hub: POST/PATCH /api/armada/revisions
// (model UnitRevision, menu "Revisi/Retur"), dan itu SUDAH admin/dispatcher-
// gated dari awal (P.JOB_WRITE). Ledger di sini murni jejak audit perubahan
// DATA order di CRM, bukan pengganti alur operasional itu.
//
// Return null (response error sudah dikirim) kalau diblokir/order tidak ada;
// return { id, paymentStatus } kalau boleh lanjut.
async function guardOrderLocked(req, res, orderId, aksi) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, paymentStatus: true } });
  if (!order) { res.status(404).json({ error: "Order tidak ditemukan" }); return null; }
  if (order.paymentStatus === "LUNAS") {
    if (!rolesOf(req.user).includes("ADMIN")) {
      res.status(403).json({
        error: `Order ini sudah LUNAS — cuma admin yang bisa ${aksi}. ` +
          `Kalau pelanggan minta revisi, tandai lewat "Ajukan Revisi" (komplain) di profilnya supaya admin tahu dan bisa menindaklanjuti.`,
      });
      return null;
    }
    await prisma.orderRevisionLog.create({
      data: { orderId, editedById: req.user?.id || null, note: aksi.charAt(0).toUpperCase() + aksi.slice(1) },
    }).catch((e) => console.warn("[order-lock] gagal catat revision log:", e.message));
  }
  return order;
}

// PATCH /api/orders/:id — edit order (status, paymentStatus, notes, qty, orderNumber)
// value TIDAK bisa diubah langsung dari sini — dikontrol oleh items
//
// STATUS (Integrasi Fase 1, D-006): tidak lagi field bebas-tulis. Default-nya
// DIHITUNG dari status unit (lihat services/orderStatusSync.js). Mengirim
// `status` di body di sini berarti OVERRIDE MANUAL (mengunci, tercatat siapa/
// kapan/kenapa lewat statusOverrideNote) — dipakai untuk kasus di luar pola
// normal (order dibatalkan, dst). Kirim `releaseStatusOverride: true` untuk
// melepas kunci dan kembali ke hitungan otomatis.
orderRouter.patch("/:id", async (req, res) => {
  const { status, statusOverrideNote, releaseStatusOverride, paymentStatus, quantity, notes, orderNumber,
          merkKasur, ukuranKasur, keluhanCustomer, jenisLayanan, hargaTotal, promoId,
          deliveryCity, deliveryAddress, healthStatus, complaintCategory,
          ongkir, ongkirKlaimGaransi, pickupEstimate, pickupConfirmedDate,
          deliveryEstimate, deliveryConfirmedDate, locationUrl } = req.body;

  // D-025: status/override TETAP lewat jalur lama (tidak dikunci) — yang
  // dikunci HANYA kalau ada field non-status ikut dikirim di request ini.
  const ubahFieldNonStatus = [paymentStatus, quantity, notes, orderNumber, merkKasur, ukuranKasur, keluhanCustomer, jenisLayanan, hargaTotal, promoId, deliveryCity, deliveryAddress, healthStatus, complaintCategory, ongkir, ongkirKlaimGaransi, pickupEstimate, pickupConfirmedDate, deliveryEstimate, deliveryConfirmedDate, locationUrl]
    .some((v) => v !== undefined);
  if (ubahFieldNonStatus) {
    const guarded = await guardOrderLocked(req, res, req.params.id, "mengubah data order");
    if (!guarded) return;
  }

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
          ...(status !== undefined && {
            status, statusLocked: true,
            statusOverrideById: req.user?.id || null,
            statusOverrideAt: new Date(),
            statusOverrideNote: statusOverrideNote || null,
          }),
          ...(releaseStatusOverride === true && {
            statusLocked: false, statusOverrideById: null, statusOverrideAt: null, statusOverrideNote: null,
          }),
          ...(paymentStatus     !== undefined && { paymentStatus }),
          ...(quantity          !== undefined && { quantity: Number(quantity) }),
          ...(notes             !== undefined && { notes }),
          ...(orderNumber       !== undefined && { orderNumber: orderNumber?.trim() || null }),
          // D-026: kirim "" atau null untuk lepas promo dari order ini.
          ...(promoId           !== undefined && { promoId: promoId || null }),
          ...(merkKasur         !== undefined && { merkKasur }),
          ...(ukuranKasur       !== undefined && { ukuranKasur }),
          ...(keluhanCustomer   !== undefined && { keluhanCustomer }),
          ...(jenisLayanan      !== undefined && { jenisLayanan }),
          ...(hargaTotal        !== undefined && { value: hargaTotal ? Number(hargaTotal) : 0 }),
          // D-027: kirim "" untuk mengosongkan lagi.
          ...(deliveryCity      !== undefined && { deliveryCity: deliveryCity || null }),
          ...(deliveryAddress   !== undefined && { deliveryAddress: deliveryAddress || null }),
          // D-028: kategori keluhan cuma relevan kalau healthStatus = SAKIT —
          // dipaksa [] di sini juga (bukan cuma di frontend) supaya data
          // tidak pernah nyangkut kalau sales toggle balik ke Tidak Sakit.
          // Array (multi-pilih) sejak revisi 20 Agustus 2026.
          ...(healthStatus      !== undefined && {
            healthStatus: healthStatus || null,
            complaintCategory: healthStatus === "SAKIT" ? (complaintCategory || []) : [],
          }),
          // D-029: ongkir/estimasi pickup/link lokasi — dikirim "" atau null
          // untuk mengosongkan lagi, sama pola dengan field D-027 di atas.
          ...(ongkir              !== undefined && { ongkir: ongkir === "" || ongkir === null ? null : Number(ongkir) }),
          ...(ongkirKlaimGaransi  !== undefined && { ongkirKlaimGaransi: ongkirKlaimGaransi === "" || ongkirKlaimGaransi === null ? null : Number(ongkirKlaimGaransi) }),
          ...(pickupEstimate      !== undefined && { pickupEstimate: pickupEstimate || null }),
          // "YYYY-MM-DD" polos ditolak Prisma untuk kolom @db.Date, dan teks
          // bebas dari aplikasi versi lama menghasilkan Invalid Date — dua-duanya
          // ditangani parseTanggalKalender(). Lihat catatan di utils/wib.js.
          ...(pickupConfirmedDate !== undefined && {
            pickupConfirmedDate: parseTanggalKalender(pickupConfirmedDate, "Tanggal Pick Up Pasti"),
          }),
          // D-033: pasangan pengiriman dari pickupEstimate/pickupConfirmedDate.
          ...(deliveryEstimate      !== undefined && { deliveryEstimate: deliveryEstimate || null }),
          ...(deliveryConfirmedDate !== undefined && {
            deliveryConfirmedDate: parseTanggalKalender(deliveryConfirmedDate, "Tanggal Kirim Pasti"),
          }),
          ...(locationUrl         !== undefined && { locationUrl: locationUrl || null }),
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

      // Lepas override -> langsung hitung ulang di transaksi yang sama,
      // supaya respons yang dikirim ke klien sudah status yang benar
      // (bukan status lama yang baru "terkunci" sesaat lalu).
      if (releaseStatusOverride === true) {
        await syncOrderStatus(tx, updated.id);
        return tx.order.findUniqueOrThrow({
          where: { id: updated.id },
          include: { items: { orderBy: { sortOrder: "asc" } }, weightEntries: { orderBy: { sortOrder: "asc" } } },
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
    const guarded = await guardOrderLocked(req, res, req.params.id, "mencatat pembayaran baru");
    if (!guarded) return;

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
    const { status, category, paymentStatus, search, from, to, hasComplaint, salesId, promoId, pipelineStage } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);

    // Filter per sales & per tahap pipeline SAMA-SAMA lewat Customer (bukan
    // Order langsung) — digabung jadi SATU objek `customer` supaya kalau
    // dua-duanya dikirim sekaligus, salah satu tidak diam-diam menimpa yang
    // lain (dua `...(cond && { customer: {...} })` terpisah di `where` akan
    // saling timpa karena sama-sama menulis key "customer" yang sama).
    const customerWhere = {
      ...(salesId       && { assignedSalesId: salesId }),
      ...(pipelineStage && { pipelineStage }),
    };

    const where = {
      ...(status        && { status }),
      ...(category      && { category }),
      ...(paymentStatus && { paymentStatus }),
      ...(hasComplaint === "true" && { hasComplaint: true }),
      ...(from && to && { createdAt: { gte: startOfDayWIB(from), lt: endOfDayExclusiveWIB(to) } }),
      ...(Object.keys(customerWhere).length > 0 && { customer: customerWhere }),
      ...(promoId && { promoId }),
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
        // D-026 — cukup id/code/name untuk chip di tabel, tidak perlu round
        // trip terpisah tiap baris.
        promo: { select: { id: true, code: true, name: true } },
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

// D-032 (21 Agustus 2026) — port PERSIS dari buildWaMessage() di
// frontend/src/components/customer/OrderSection.jsx (JANGAN biarkan dua
// definisi ini menyimpang — kalau format pesan berubah, ubah DUA-DUANYA).
// Backend butuh salinannya sendiri karena tombol "Salin pesan WA" (client-
// side, clipboard) dan tombol "Kirim ke Grup WA" (server-side, lewat WAHA)
// sengaja dua jalur terpisah — yang satu tidak bisa memanggil kode di sisi
// yang lain.
const BODY_AREA_LABELS = {
  KEPALA_PUSING:  "Kepala",
  SAKIT_LEHER:    "Leher",
  BAHU:           "Bahu",
  SAKIT_PUNGGUNG: "Punggung",
  SAKIT_PINGGANG: "Pinggang",
  SARAF_KEJEPIT:  "Saraf Kejepit",
  SKOLIOSIS:      "Skoliosis",
};
function formatAngka(n) {
  return (n || 0).toLocaleString("id-ID");
}
function formatTanggalOrder(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
function parseOrderNotesForWa(notes) {
  if (!notes) return { merkKasur: "", ukuranKasur: "", keluhanCustomer: "" };
  try {
    const p = JSON.parse(notes);
    return { merkKasur: p.merkKasur || "", ukuranKasur: p.ukuranKasur || "", keluhanCustomer: p.keluhanCustomer || "" };
  } catch {
    return { merkKasur: "", ukuranKasur: "", keluhanCustomer: notes };
  }
}
function buildWaMessage(order, customer) {
  const info  = parseOrderNotesForWa(order.notes);
  const berat = (order.weightEntries || []).map((w) => w.beratKg).join(", ") || "-";
  const cats  = order.complaintCategory || [];

  const areaSelected = cats.filter((c) => BODY_AREA_LABELS[c]).map((c) => BODY_AREA_LABELS[c]);
  const keluhanLines = [];
  if (areaSelected.length) keluhanLines.push(`- sakit Area ${areaSelected.join(", ")}`);
  if (cats.includes("PEGAL_PEGAL")) keluhanLines.push("- Pegal area seluruh badan");
  if (cats.includes("LAINNYA")) keluhanLines.push("- Lainnya");

  const layanan    = (order.items || []).map((i) => i.layananName).join(", ") || "-";
  const finalBiaya = order.value || 0;
  const biayaAwal = order.promo?.discountPercent
    ? Math.round(finalBiaya / (1 - order.promo.discountPercent / 100))
    : finalBiaya;

  return [
    `Nama : ${customer.name || "-"}`,
    `Tlp : ${customer.phone || "-"}`,
    `Alamat : ${customer.name || "-"}. \n${order.deliveryAddress || "-"}${order.deliveryCity ? `. ${order.deliveryCity}` : ""}.`,
    `Berat badan pengguna : ${berat}`,
    `Keluhan fisik saat bangun tidur :`,
    keluhanLines.length ? keluhanLines.join("\n") : "-",
    `Keluhan kasur : ${info.keluhanCustomer || "-"}`,
    `Ukuran kasur : ${info.ukuranKasur || "-"}`,
    `Merk kasur : ${info.merkKasur || "-"}`,
    `Layanan yang di pilih : ${layanan}`,
    `Biaya : ${formatAngka(biayaAwal)}`,
    `Diskon : ${order.promo ? order.promo.code : "-"}`,
    `Final Biaya : ${formatAngka(finalBiaya)}`,
    `Ongkir : ${formatAngka(order.ongkir)}`,
    `Ongkir claim garansi : ${formatAngka(order.ongkirKlaimGaransi)}`,
    `Pick Up : ${order.pickupEstimate || "-"}`,
    `Est Pick Up : ${order.pickupConfirmedDate ? formatTanggalOrder(order.pickupConfirmedDate) : "-"}`,
    `Kirim : ${order.deliveryEstimate || "-"}`,
    `Est Kirim : ${order.deliveryConfirmedDate ? formatTanggalOrder(order.deliveryConfirmedDate) : "-"}`,
    `Cs : ${customer.assignedSales?.name || "-"}`,
    `Share loct : ${order.locationUrl || "-"}`,
  ].join("\n");
}

// POST /api/orders/:id/send-wa-summary — kirim ringkasan order (format SAMA
// dengan tombol "Salin pesan WA") ke grup WA yang ditandai isSalesGroup
// (D-032). SENGAJA tombol eksplisit (bukan otomatis begitu order disimpan)
// — sales tetap yang memutuskan kapan data sudah lengkap/benar untuk
// dikirim, sama pola dengan "kirim dokumentasi ke customer" (D-016) yang
// juga perlu klik manual, bukan auto-send begitu foto ada.
orderRouter.post("/:id/send-wa-summary", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { include: { assignedSales: { select: { name: true } } } },
        items: { orderBy: { sortOrder: "asc" } },
        weightEntries: { orderBy: { sortOrder: "asc" } },
        promo: { select: { code: true, discountPercent: true } },
      },
    });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const group = await prisma.conversation.findFirst({ where: { type: "GROUP", isSalesGroup: true } });
    if (!group) {
      return res.status(409).json({ error: "Grup WA order belum diatur — atur dulu lewat halaman Order (admin)" });
    }

    const target = resolveSendTarget(group);
    if (!target) return res.status(400).json({ error: "groupJid grup ini tidak tersedia" });

    const text = buildWaMessage(order, order.customer);

    let wahaMsg;
    try {
      ({ result: wahaMsg } = await sendWithSessionFallback(group, (session) =>
        sendText(target, text, null, session)
      ));
    } catch (waErr) {
      if (waErr instanceof SessionResolutionError) {
        return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
      }
      console.error("[send-wa-summary] gagal kirim:", waErr.message);
      return res.status(502).json({ error: `Gagal kirim ke WhatsApp: ${waErr.message}` });
    }

    const msg = await prisma.message.create({
      data: {
        conversationId: group.id,
        direction: "OUTBOUND",
        content: text,
        externalId: wahaMsg?.id || wahaMsg?._data?.id?._serialized || null,
        sentById: req.user.id,
      },
    });
    const updatedGroup = await prisma.conversation.update({
      where: { id: group.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(text, null) },
    });
    emitNewMessage(group.id, msg);
    emitConversationUpdate(updatedGroup);

    res.json({ ok: true, group: { id: group.id, groupName: group.groupName } });
  } catch (err) {
    console.error("[send-wa-summary] error:", err);
    res.status(500).json({ error: "Gagal kirim ringkasan order ke grup WA" });
  }
});

// DELETE /api/orders/:id — hapus order beserta items & weightEntries (cascade
// via FK), DAN unit-unitnya KALAU DAN HANYA KALAU semua unit itu masih benar-
// benar "hantu" (belum disentuh divisi manapun).
//
// ⚠️ REVISI (10 Agustus 2026) dari perilaku SEBELUMNYA yang memblokir hapus
// begitu SATU unit pun ada (`unitCount > 0`). Itu ternyata memblokir hampir
// SEMUA order — POST /customers/:id/orders SELALU membuat 1 unit default
// (lihat services/unitProvisioning.js), jadi order yang baru saja salah
// diinput (belum disentuh Bengkel/Armada/Gudang sama sekali) TETAP tidak bisa
// dihapus, padahal seharusnya bisa. Sekarang dicek LINTAS DIVISI secara
// nyata — bukan sekadar "ada unit atau tidak":
//   - Bengkel : UnitStageLog (ledger tahap), QcFitTest, UnitRevision
//   - Armada  : Job (pickup/pengiriman) — level order, dan JobUnit — level unit
//   - Gudang  : StockMovement (material yang sudah diserap unit)
//   - Kasir   : Payment
//   - Kendali : ScopeRevision (revisi lingkup/harga)
// ProductionTarget SENGAJA tidak dihitung sebagai blocker — Cascade murni
// (target harian, bukan riwayat/ledger), ikut terhapus otomatis bersama unit.
//
// Kalau SEMUA bersih → unit + order dihapus permanen dalam satu transaksi.
// Kalau ADA jejak → tetap ditolak KERAS (append-only ledger tidak boleh
// hilang lewat pintu belakang, sama seperti insiden pipeline_transitions di
// CLAUDE.md §5) — pesannya sekarang membedakan "sudah mulai dikerjakan tapi
// belum ada job/pembayaran/revisi" (bisa coba Batalkan Order, lihat POST
// /:id/cancel) dari "sudah ada uang/jadwal/revisi nyata" (wajib admin/Kendali).
orderRouter.delete("/:id", async (req, res) => {
  try {
    const [units, jobCount, paymentCount, scopeRevisionCount] = await Promise.all([
      prisma.unit.findMany({
        where: { orderId: req.params.id },
        select: {
          id: true,
          _count: { select: { stageLogs: true, jobUnits: true, qcFitTests: true, stockMovements: true, revisions: true } },
        },
      }),
      prisma.job.count({ where: { orderId: req.params.id } }),
      prisma.payment.count({ where: { orderId: req.params.id } }),
      prisma.scopeRevision.count({ where: { orderId: req.params.id } }),
    ]);

    const unitFootprint = units.reduce((n, u) =>
      n + u._count.stageLogs + u._count.jobUnits + u._count.qcFitTests + u._count.stockMovements + u._count.revisions, 0);

    const blockers = [];
    if (unitFootprint > 0) blockers.push(`${unitFootprint} jejak operasional di unit (tahap produksi/QC/material/revisi)`);
    if (jobCount > 0) blockers.push(`${jobCount} penjadwalan pickup/pengiriman`);
    if (paymentCount > 0) blockers.push(`${paymentCount} pembayaran`);
    if (scopeRevisionCount > 0) blockers.push(`${scopeRevisionCount} revisi lingkup kerja`);

    if (blockers.length > 0) {
      const hanyaUnitTersentuh = unitFootprint > 0 && jobCount === 0 && paymentCount === 0 && scopeRevisionCount === 0;
      return res.status(409).json({
        error: `Order tidak bisa dihapus permanen karena sudah punya ${blockers.join(", ")} yang terkait.` +
          (hanyaUnitTersentuh
            ? " Coba \"Batalkan Order\" — riwayat produksinya tetap tersimpan tapi order ditandai batal."
            : " Ada uang/jadwal/revisi nyata yang perlu ditangani manusia — hubungi admin/Kendali."),
      });
    }

    // customerId diambil SEBELUM delete — setelah dihapus tidak ada lagi
    // jalan untuk tahu order ini tadinya milik customer mana.
    const customerId = await prisma.$transaction(async (tx) => {
      // Unit-unit di sini SUDAH dipastikan bersih (unitFootprint === 0) —
      // hapus dulu supaya FK Restrict (Unit→Order) tidak menggagalkan
      // penghapusan Order di baris berikutnya.
      if (units.length > 0) {
        await tx.unit.deleteMany({ where: { orderId: req.params.id } });
      }
      const existing = await tx.order.delete({ where: { id: req.params.id } });
      return existing.customerId;
    });
    await syncCustomerOrderAggregate(customerId);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Order tidak ditemukan" });
    if (err.code === "P2003") {
      return res.status(409).json({ error: "Order tidak bisa dihapus karena masih ada data terkait (unit/pembayaran/penjadwalan). Hubungi admin/Kendali." });
    }
    console.error("delete order error:", err);
    res.status(500).json({ error: "Gagal menghapus order" });
  }
});

// POST /api/orders/:id/cancel — "hapus" yang aman untuk order yang sudah
// punya unit/job/pembayaran (RESTRICT di atas menolak hard-delete-nya).
//
// Order & unit TIDAK DIHAPUS (riwayat tetap ada untuk ditelusuri), cuma
// ditandai CANCELLED — sama seperti PATCH /:id { status } (D-006, statusLocked
// menang mutlak dari sync otomatis), plus unit-unitnya ikut ditandai
// CANCELLED dalam transaksi yang sama.
//
// TETAP DITOLAK kalau ada unit yang SUDAH mulai dikerjakan bengkel
// (currentStageId terisi), sudah ada pembayaran, penjadwalan pickup/
// pengiriman, atau revisi lingkup kerja — itu bukan lagi "salah input murni",
// ada uang/jadwal/pekerjaan fisik nyata yang perlu ditangani manusia secara
// sadar lewat admin/Kendali, bukan tombol otomatis dari drawer Pelanggan.
orderRouter.post("/:id/cancel", async (req, res) => {
  const { reason } = req.body;
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (order.status === "CANCELLED") return res.json(order);

    const [units, jobCount, paymentCount, scopeRevisionCount] = await Promise.all([
      prisma.unit.findMany({
        where: { orderId: req.params.id },
        select: { id: true, status: true, currentStageId: true, unitCode: true },
      }),
      prisma.job.count({ where: { orderId: req.params.id } }),
      prisma.payment.count({ where: { orderId: req.params.id } }),
      prisma.scopeRevision.count({ where: { orderId: req.params.id } }),
    ]);
    const inFlightUnits = units.filter(
      (u) => u.currentStageId != null && u.status !== "CANCELLED" && u.status !== "DELIVERED"
    );

    const blockers = [];
    if (inFlightUnits.length > 0) {
      blockers.push(`${inFlightUnits.length} unit sudah mulai dikerjakan bengkel (${inFlightUnits.map((u) => u.unitCode).join(", ")})`);
    }
    if (jobCount > 0) blockers.push(`${jobCount} penjadwalan pickup/pengiriman`);
    if (paymentCount > 0) blockers.push(`${paymentCount} pembayaran`);
    if (scopeRevisionCount > 0) blockers.push(`${scopeRevisionCount} revisi lingkup kerja`);

    if (blockers.length > 0) {
      return res.status(409).json({
        error: `Order tidak bisa dibatalkan otomatis karena sudah ada ${blockers.join(", ")} — butuh penanganan manual admin/Kendali, bukan sekadar salah input.`,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (units.length > 0) {
        await tx.unit.updateMany({
          where: { id: { in: units.map((u) => u.id) }, status: { not: "CANCELLED" } },
          data: { status: "CANCELLED" },
        });
      }
      const result = await tx.order.update({
        where: { id: req.params.id },
        data: {
          status: "CANCELLED", statusLocked: true,
          statusOverrideById: req.user?.id || null,
          statusOverrideAt: new Date(),
          statusOverrideNote: reason?.trim() || "Dibatalkan — salah input",
        },
      });
      await tx.orderStatusTransition.create({
        data: { orderId: result.id, fromStatus: order.status, toStatus: "CANCELLED", changedById: req.user?.id || null },
      });
      return result;
    });

    await syncCustomerOrderAggregate(updated.customerId);
    res.json(updated);
  } catch (err) {
    console.error("cancel order error:", err);
    res.status(500).json({ error: "Gagal membatalkan order" });
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
    const guarded = await guardOrderLocked(req, res, req.params.orderId, "menambah item layanan");
    if (!guarded) return;

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
    const existing = await prisma.orderItem.findUnique({ where: { id: req.params.itemId }, select: { orderId: true } });
    if (!existing) return res.status(404).json({ error: "Item tidak ditemukan" });
    const guarded = await guardOrderLocked(req, res, existing.orderId, "mengubah item layanan");
    if (!guarded) return;

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
    const existing = await prisma.orderItem.findUnique({ where: { id: req.params.itemId }, select: { orderId: true } });
    if (!existing) return res.status(404).json({ error: "Item tidak ditemukan" });
    const guarded = await guardOrderLocked(req, res, existing.orderId, "menghapus item layanan");
    if (!guarded) return;

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
    const guarded = await guardOrderLocked(req, res, req.params.id, "menambah data berat badan");
    if (!guarded) return;

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
    const existing = await prisma.orderWeightEntry.findUnique({ where: { id: req.params.entryId }, select: { orderId: true } });
    if (!existing) return res.status(404).json({ error: "Data berat badan tidak ditemukan" });
    const guarded = await guardOrderLocked(req, res, existing.orderId, "mengubah data berat badan");
    if (!guarded) return;

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
    const existing = await prisma.orderWeightEntry.findUnique({ where: { id: req.params.entryId }, select: { orderId: true } });
    if (!existing) return res.status(404).json({ error: "Data berat badan tidak ditemukan" });
    const guarded = await guardOrderLocked(req, res, existing.orderId, "menghapus data berat badan");
    if (!guarded) return;

    await prisma.orderWeightEntry.delete({ where: { id: req.params.entryId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UNIT (kasur fisik) PADA SEBUAH ORDER ───────────────────────────────────
// Order dibuat dengan 1 unit secara default (lihat POST /customers/:id/orders).
// Dua endpoint di bawah untuk mengoreksi jumlahnya: order berisi 2 kasur
// ditambah unitnya di sini, order yang ternyata bukan kasur sama sekali
// (ganti kain sofa, ongkos kirim) unit hantunya dihapus — tanpa perlu akses
// database. Lihat services/unitProvisioning.js soal kenapa jumlah unit TIDAK
// diturunkan dari Order.quantity.

// GET /api/orders/:id/units — daftar unit milik order
orderRouter.get("/:id/units", async (req, res) => {
  try {
    const units = await prisma.unit.findMany({
      where: { orderId: req.params.id },
      orderBy: { seq: "asc" },
      include: { currentStage: { select: { code: true, labelId: true } } },
    });
    res.json(units);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders/:id/units — tambah N unit ke order yang sudah ada
orderRouter.post("/:id/units", async (req, res) => {
  const count = req.body?.count === undefined ? 1 : Math.floor(Number(req.body.count));
  if (!Number.isFinite(count) || count < 1 || count > 50) {
    return res.status(400).json({ error: "Jumlah unit harus antara 1 dan 50" });
  }
  try {
    const guarded = await guardOrderLocked(req, res, req.params.id, "menambah unit");
    if (!guarded) return;

    const units = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: req.params.id } });
      if (!order) return null;
      const created = await createUnitsForOrder(tx, { order, count });
      await syncOrderStatus(tx, order.id);
      return created;
    });
    if (units === null) return res.status(404).json({ error: "Order tidak ditemukan" });
    res.status(201).json(units);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/orders/units/:unitId — hapus unit yang salah dibuat.
//
// DIJAGA KETAT dan sengaja: unit yang SUDAH punya jejak operasional tidak
// boleh hilang. `unit_stage_logs` adalah ledger append-only (CLAUDE.md
// sano-hub) — menghapus unitnya sama saja menghapus ledger lewat pintu
// belakang. Begitu juga unit yang sudah masuk job atau sudah menyerap
// material. Yang boleh dihapus hanya unit yang benar-benar belum tersentuh.
orderRouter.delete("/units/:unitId", async (req, res) => {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: req.params.unitId },
      include: {
        _count: { select: { stageLogs: true, jobUnits: true, qcFitTests: true, stockMovements: true } },
      },
    });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan" });

    const guarded = await guardOrderLocked(req, res, unit.orderId, "menghapus unit");
    if (!guarded) return;

    const jejak = unit._count;
    const total = jejak.stageLogs + jejak.jobUnits + jejak.qcFitTests + jejak.stockMovements;
    if (total > 0) {
      return res.status(409).json({
        error:
          "Unit ini sudah punya jejak operasional (tahap produksi, job, QC, atau pemakaian material) " +
          "dan tidak boleh dihapus. Batalkan unitnya lewat status, jangan dihapus.",
        jejak,
      });
    }

    await prisma.unit.delete({ where: { id: req.params.unitId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
