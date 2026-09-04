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
import { buildInvoiceView, setInvoiceLifecycle, attachOrderToInvoice, detachInvoiceFromBundle } from "../services/invoice.js";
import { renderInvoicePdf } from "../services/invoicePdf.js";
import { buildWarrantyView, markWarrantySent, WARRANTY_YEARS_VALID } from "../services/warranty.js";
import { renderWarrantyPdf } from "../services/warrantyPdf.js";
import { createUnitsForOrder } from "../services/unitProvisioning.js";
import { syncOrderStatus } from "../services/orderStatusSync.js";
import { sendText, sendMedia, isPlaceholderGroupJid } from "../services/wahaClient.js";
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
// Sama dir dengan yang dibuat/di-serve index.js (/media/invoice-pdfs) —
// TIDAK boleh punya definisi terpisah yang bisa drift dari situ.
const invoicePdfsDir = path.join(__dirname, "../../data/invoice-pdfs");
const warrantyPdfsDir = path.join(__dirname, "../../data/warranty-pdfs");
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
// (bukan sekadar sudah terkirim) tidak boleh diedit role lain lagi, cuma
// ADMIN. Dipasang di semua endpoint yang mengubah field NON-STATUS (item
// layanan, harga, catatan, berat badan, pembayaran, jumlah unit) — status
// sendiri TETAP ikut alur D-006 (dihitung otomatis / override eksplisit),
// itu sudah punya jalur audit terpisah, jadi TIDAK ikut dikunci di sini
// (lihat pemisahan di PATCH /:id di bawah).
//
// REVISI 26 Agustus 2026 (permintaan owner): SALES ikut diizinkan mengedit,
// bukan cuma ADMIN — order.js masih dijaga dari role LAIN (produksi,
// driver, gudang, dst) yang memang tidak seharusnya pernah sampai ke
// endpoint ini. Audit trail (OrderRevisionLog di bawah) TETAP tercatat
// untuk SIAPA PUN yang berhasil mengedit LUNAS (dulu cuma tercatat untuk
// admin) — supaya kelonggaran akses ini tidak menghilangkan jejak siapa
// mengubah apa, cuma memperluas SIAPA yang boleh.
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
// ⚠️ DIPERKETAT LAGI (1 September 2026, permintaan eksplisit owner) — ini
// MEMBALIKKAN keputusan 26 Agustus 2026 yang tadinya melonggarkan akses
// LUNAS ke SALES juga. Owner sadar ini kebalikannya (dikonfirmasi lewat
// pertanyaan langsung sebelum diubah): order yang sudah LUNAS sekarang
// HANYA admin yang bisa mengedit — SALES yang perlu revisi WAJIB minta
// admin yang mengeksekusi perubahannya (bukan alur pengajuan/approval
// terpisah — itu opsi B yang TIDAK dipilih, lebih besar & belum diperlukan).
async function guardOrderLocked(req, res, orderId, aksi) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, paymentStatus: true } });
  if (!order) { res.status(404).json({ error: "Order tidak ditemukan" }); return null; }
  if (order.paymentStatus === "LUNAS") {
    const roles = rolesOf(req.user);
    if (!roles.includes("ADMIN")) {
      res.status(403).json({
        error: `Order ini sudah LUNAS dan terkunci — cuma admin yang bisa ${aksi}. ` +
          `Minta admin untuk mengubahnya, atau kalau pelanggan minta revisi, tandai lewat "Ajukan Revisi" (komplain) di profilnya.`,
      });
      return null;
    }
    // Tetap tercatat siapa admin-nya & kapan — jejak audit TIDAK berubah,
    // cuma yang boleh sampai ke titik ini sekarang admin saja.
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
          deliveryEstimate, deliveryConfirmedDate, locationUrl, productLine, productType, dpTarget } = req.body;

  // D-025: status/override TETAP lewat jalur lama (tidak dikunci) — yang
  // dikunci HANYA kalau ada field non-status ikut dikirim di request ini.
  const ubahFieldNonStatus = [paymentStatus, quantity, notes, orderNumber, merkKasur, ukuranKasur, keluhanCustomer, jenisLayanan, hargaTotal, promoId, deliveryCity, deliveryAddress, healthStatus, complaintCategory, ongkir, ongkirKlaimGaransi, pickupEstimate, pickupConfirmedDate, deliveryEstimate, deliveryConfirmedDate, locationUrl, productLine, productType, dpTarget]
    .some((v) => v !== undefined);
  if (ubahFieldNonStatus) {
    const guarded = await guardOrderLocked(req, res, req.params.id, "mengubah data order");
    if (!guarded) return;
  }

  // Override manual ke CANCELLED lewat dropdown ini WAJIB lolos pengaman
  // yang SAMA dengan tombol "Batalkan Order" (checkCancelBlockers di atas)
  // — dua tombol, satu aturan. Dicek DI LUAR transaksi seperti POST
  // /:id/cancel, supaya order yang ditolak tidak pernah menyentuh DB sama
  // sekali (bukan ditulis lalu di-rollback).
  if (status === "CANCELLED") {
    const current = await prisma.order.findUnique({ where: { id: req.params.id }, select: { status: true } });
    if (current && current.status !== "CANCELLED") {
      const { blockers } = await checkCancelBlockers(req.params.id);
      if (blockers.length > 0) {
        return res.status(409).json({
          error: `Order tidak bisa dibatalkan karena sudah ada ${blockers.join(", ")} — pakai "Batalkan Order" untuk detail penanganannya, atau tangani manual lewat admin/Kendali.`,
        });
      }
    }
  }

  try {
    // Update + catat riwayat status dalam SATU transaksi, supaya tidak pernah
    // ada baris riwayat tanpa perubahan order yang berhasil (dan sebaliknya).
    // Pola ini sama dengan pipeline_transitions di routes/customers.js.
    const order = await prisma.$transaction(async (tx) => {
      const sebelum = await tx.order.findUnique({
        where: { id: req.params.id },
        select: { status: true, paymentStatus: true },
      });
      if (!sebelum) {
        throw Object.assign(new Error("Order tidak ditemukan"), { statusCode: 404 });
      }

      // paidAt (30 Agustus 2026) — dropdown manual di sini adalah jalur LAIN
      // ke paymentStatus di luar recomputeOrderPaymentStatus() (services/
      // paymentLedger.js, dipakai jalur Payment/pengiriman) — HARUS pakai
      // aturan transisi yang SAMA supaya basis komisi sales konsisten
      // dari jalur mana pun paymentStatus berubah. Lihat komentar panjang
      // di schema.prisma.
      const paidAtPatch = paymentStatus === undefined ? {}
        : paymentStatus === "LUNAS"
          ? (sebelum.paymentStatus === "LUNAS" ? {} : { paidAt: new Date() })
          : { paidAt: null };

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
          ...paidAtPatch,
          ...(quantity          !== undefined && { quantity: Number(quantity) }),
          ...(notes             !== undefined && { notes }),
          ...(orderNumber       !== undefined && { orderNumber: orderNumber?.trim() || null }),
          // D-026: kirim "" atau null untuk lepas promo dari order ini.
          ...(promoId           !== undefined && { promoId: promoId || null }),
          // productLine (29 Agustus 2026) — TIDAK boleh dikosongkan (bukan
          // nullable di skema, selalu ada nilainya), productType BOLEH
          // dilepas balik ke null (mis. salah pilih, "kosongkan" via "").
          ...(productLine       !== undefined && productLine && { productLine }),
          ...(productType       !== undefined && { productType: productType || null }),
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
          // dpTarget (2 Sep 2026) — DP yang DISEPAKATI dengan customer, murni
          // pembanding di UI/invoice ("DP kurang Rp X"). "" atau null = lepas
          // kesepakatan DP lagi (bukan "sudah dibayar 0" — beda konsep dari
          // Payment ledger yang tetap satu-satunya sumber uang yang MASUK).
          ...(dpTarget            !== undefined && { dpTarget: dpTarget === "" || dpTarget === null ? null : Number(dpTarget) }),
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

        // Kaskade Order -> Unit untuk DUA status terminal (24 Agustus 2026).
        // CANCELLED sudah lolos checkCancelBlockers di atas (tidak ada unit
        // in-flight/job/pembayaran), jadi aman menandai SEMUA unit ikut
        // batal. DELIVERED TIDAK punya blocker terpisah — dropdown ini
        // biasanya dipakai menutup order LAYANAN yang memang tidak lewat
        // alur unit/produksi fisik (servis di tempat, dst), jadi kaskade
        // longgar TANPA blocker, kecuali unit-nya sedang aktif dalam
        // perjalanan (job EN_ROUTE/ARRIVED) — itu satu-satunya kondisi
        // fisik yang benar-benar akan janggal kalau order tiba-tiba
        // "selesai" padahal driver masih di jalan.
        if (status === "CANCELLED") {
          await tx.unit.updateMany({
            where: { orderId: updated.id, status: { not: "CANCELLED" } },
            data: { status: "CANCELLED" },
          });
          // Job yang belum jalan tidak punya alasan lagi untuk ada — lihat
          // catatan lengkap di checkCancelBlockers/hapusJobBelumJalan di
          // atas (31 Agustus 2026, laporan sales tidak bisa membatalkan
          // order gara-gara job kerangka kosong).
          await hapusJobBelumJalan(tx, updated.id);
        } else if (status === "DELIVERED") {
          const unitEnRoute = await tx.unit.findFirst({
            where: {
              orderId: updated.id,
              status: { notIn: ["CANCELLED", "DELIVERED"] },
              jobUnits: { some: { job: { status: { in: ["EN_ROUTE", "ARRIVED"] } } } },
            },
            select: { unitCode: true },
          });
          if (unitEnRoute) {
            throw Object.assign(
              new Error(`Unit ${unitEnRoute.unitCode} masih dalam perjalanan (job aktif) — selesaikan job-nya dulu sebelum menandai order Terkirim.`),
              { statusCode: 409 }
            );
          }
          await tx.unit.updateMany({
            where: { orderId: updated.id, status: { notIn: ["CANCELLED", "DELIVERED"] } },
            data: { status: "DELIVERED" },
          });
          // Job yang belum jalan (UNSCHEDULED/SCHEDULED/ASSIGNED) di-SINKRON
          // jadi COMPLETED, BUKAN dihapus (koreksi 4 September 2026 — data
          // order/unit di sini sudah benar, statusnya saja yang belum
          // nyambung ke Armada). Order ini baru saja ditutup manual lewat
          // dropdown ini (biasanya servis di tempat/LAYANAN yang tidak lewat
          // alur unit fisik), bukan lewat Job selesai di Armada — tanpa baris
          // ini job "hantu" itu tetap nangkring di board Armada/Route Planner
          // seolah masih perlu dikerjakan. Temuan nyata 4 September 2026: 13
          // job berstatus ASSIGNED nempel di rute aktif (driver sungguhan,
          // tanggal sungguhan) untuk order yang di Sales CRM sudah "Terkirim"
          // — guard unitEnRoute di atas cuma menjaring EN_ROUTE/ARRIVED, tidak
          // menjaring ASSIGNED, jadi sales bisa lolos menutup order sementara
          // job pickup-nya masih tergantung. Job yang SUDAH berangkat
          // (EN_ROUTE/ARRIVED) tetap diblokir duluan oleh guard di atas,
          // tidak pernah sampai ke baris ini. TANPA proofPhotoUrls (memang
          // tidak ada bukti foto — pekerjaan ini selesai di luar Armada) —
          // ini SENGAJA, supaya tetap tampil jujur sebagai "Belum Lengkap"
          // di verifikasi POD, bukan berpura-pura terdokumentasi penuh.
          await selesaikanJobBelumJalan(tx, updated.id);
        }
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

// POST /api/orders/:id/payments/:paymentId/cancel { reason? }
// Koreksi salah input (2 Sep 2026, D-023 lanjutan) — ledger TETAP append-
// only (Payment TIDAK PERNAH di-DELETE, lihat komentar di schema.prisma),
// yang berubah cuma ditandai batal supaya keluar dari SUM(payments) dan
// status/paidAt ikut dihitung ulang. Admin-only, pola SAMA dengan
// guardOrderLocked() (rolesOf().includes("ADMIN")) — BUKAN
// requirePermission(P.PAYMENT_WRITE), itu punya FINANCE di sistem Sano Hub
// granular yang sengaja tidak dipakai orderRouter (lihat komentar di atas
// guardOrderLocked).
orderRouter.post("/:id/payments/:paymentId/cancel", async (req, res) => {
  try {
    if (!rolesOf(req.user).includes("ADMIN")) {
      return res.status(403).json({ error: "Cuma admin yang bisa membatalkan entri pembayaran." });
    }
    const { reason } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!payment || payment.orderId !== req.params.id) {
        throw Object.assign(new Error("Entri pembayaran tidak ditemukan"), { statusCode: 404 });
      }
      if (payment.cancelledAt) {
        throw Object.assign(new Error("Entri ini sudah dibatalkan sebelumnya"), { statusCode: 409 });
      }
      await tx.payment.update({
        where: { id: req.params.paymentId },
        data: {
          cancelledAt: new Date(),
          cancelledById: req.user.id,
          cancelReason: reason || null,
        },
      });
      const status = await recomputeOrderPaymentStatus(tx, req.params.id);
      return { status };
    });

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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
    const { status, category, paymentStatus, search, from, to, hasComplaint, salesId, promoId, pipelineStage, hideFinished } = req.query;
    // BUG YANG DIPERBAIKI (1 September 2026, ditemukan owner lewat audit
    // export Excel — "krusial banget, butuh keakuratan tinggi"): batas
    // atas SEBELUMNYA cuma 500, sementara Export Excel di Orders.jsx
    // memakai `items` yang SAMA (state daftar, bukan agregat terpisah)
    // untuk membangun file .xlsx — order ke-501 ke atas diam-diam TIDAK
    // PERNAH masuk file yang didownload, tanpa peringatan apa pun DI
    // DALAM file itu sendiri. Dinaikkan ke 5000 (Agustus 2026 production
    // baru ~220 order/bulan, jauh di bawah ini) — frontend export
    // memanggil dengan `limit=5000` eksplisit, list biasa TETAP default
    // 200 (tidak ada perubahan perilaku/performa utk pemakaian sehari-hari).
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 5000);

    // Filter per sales & per tahap pipeline SAMA-SAMA lewat Customer (bukan
    // Order langsung) — digabung jadi SATU objek `customer` supaya kalau
    // dua-duanya dikirim sekaligus, salah satu tidak diam-diam menimpa yang
    // lain (dua `...(cond && { customer: {...} })` terpisah di `where` akan
    // saling timpa karena sama-sama menulis key "customer" yang sama).
    const customerWhere = {
      ...(salesId       && { assignedSalesId: salesId }),
      ...(pipelineStage && { pipelineStage }),
    };

    // ?hideFinished=true — 26 Agustus 2026, ditemukan lewat pertanyaan owner
    // soal "200 order" yang ternyata cuma plafon default (lihat catatan
    // `limit` di atas), sementara dari 344 order production, 267 di
    // antaranya (DELIVERED+CANCELLED) sudah selesai/tertutup dan tidak perlu
    // ditrack lagi. TIDAK dipakai kalau `status` eksplisit dikirim (mis. tab
    // "Delivered" diklik) — orang yang SENGAJA mau lihat status tertutup
    // tetap bisa, ini cuma default "Semua" supaya berarti "semua yang masih
    // aktif". SENGAJA bukan filter tanggal (mis. 30 hari) — order lama yang
    // MASIH nyangkut di produksi (justru yang paling butuh perhatian, lihat
    // fitur "mandek" di mobile OrdersScreen.js) tidak boleh ikut hilang
    // hanya karena tanggal `createdAt`-nya sudah lewat dari jendela waktu.
    const where = {
      ...(status ? { status } : hideFinished === "true" ? { status: { notIn: ["DELIVERED", "CANCELLED"] } } : {}),
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
        // D-036 (30 Agustus 2026) — supaya Sales CRM bisa lihat status
        // Delivery TANPA pindah halaman ("masing-masing divisi tau order A
        // sudah di tahap mana"). Cuma field ringkas, bukan seluruh job
        // (foto bukti/GPS ping dst tidak relevan di sini). Job FAILED
        // dikecualikan dari agregasi di bawah — itu percobaan yang sudah
        // gagal, bukan status yang relevan ditampilkan ke sales.
        jobs: {
          where: { status: { not: "FAILED" } },
          select: {
            id: true, type: true, status: true, scheduledDate: true,
            driver: { select: { name: true } },
            vehicle: { select: { plateNumber: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        // D-041 (2 Sep 2026) — sama alasannya dengan include di
        // routes/customers.js GET /:id: badge "Invoice Terkirim" di
        // OrderSection.jsx supaya konsisten tampil di kedua sumber data.
        invoice: { select: { invoiceNumber: true, lifecycleStatus: true, sentAt: true, combinedIntoId: true } },
        // units (D-078, 5 September 2026) — laporan owner: "Semua Order"
        // baru menghubungkan Sales (status/pipelineStage) & Delivery
        // (pickup/deliveryJob), TAPI Produksi (tahap unit di Bengkel) masih
        // tidak kelihatan sama sekali dari sini — dispatcher/siapa pun yang
        // buka halaman ini harus pindah ke Bengkel untuk tahu "order ini
        // sekarang di tahap apa PERSISNYA" (Order.status cuma bucket kasar
        // PENDING/PICKUP/PROCESSING/READY/DELIVERED, lihat
        // services/orderStatusSync.js — bucket itu SUDAH agregat weakest-
        // link dari unit, tapi tidak bilang NAMA tahapnya). CANCELLED unit
        // dikecualikan (sama pola dengan `jobs` di atas — bukan hal yang
        // relevan ditampilkan, sudah gagal). Field DIPILIH SEMINIMAL
        // mungkin (bukan seluruh Unit) karena baris ini bisa ratusan.
        units: {
          where: { status: { not: "CANCELLED" } },
          select: {
            id: true, status: true,
            currentStage: { select: { labelId: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    const now = Date.now();
    const items = orders.map(({ customer, statusTransitions, jobs, units, ...o }) => {
      const trans = statusTransitions[0] || null;
      const sejak = trans?.createdAt || o.updatedAt;
      // orderBy createdAt desc di atas -> job PERTAMA per tipe = yang
      // terbaru. Order normal cuma punya 1 job aktif per tipe di satu
      // waktu (PRD §5.2), tapi kalau toh ada sisa lebih dari satu (reschedule
      // lama, dst), yang terbaru itu paling relevan ditampilkan ke sales.
      const pickupJob   = jobs.find((j) => j.type === "PICKUP") || null;
      const deliveryJob = jobs.find((j) => j.type === "DELIVERY") || null;
      const ringkasJob = (j) => j && {
        status: j.status, scheduledDate: j.scheduledDate,
        driverName: j.driver?.name || null, vehiclePlate: j.vehicle?.plateNumber || null,
      };
      // Ringkasan tahap Produksi (D-078) — lihat komentar panjang di include
      // `units` di atas. SEWA lepas total dari Unit/Bengkel (sama alasan
      // dengan orderStatusSync.js), jadi tidak pernah punya productionStage.
      // Unit yang SUDAH DELIVERED dikeluarkan dari perhitungan — itu bukan
      // lagi "sedang di produksi", weakest-link Order.status TIDAK akan
      // pernah menunjuknya juga. Kalau SEMUA unit hidup belum menyentuh
      // stage engine sama sekali (currentStage null — backfill lama, lihat
      // catatan "KENYATAAN DATA" di unitStatus.js), tandai eksplisit
      // "Belum mulai produksi" — BUKAN null (null = "tidak relevan
      // ditampilkan", beda makna dari "relevan tapi belum mulai").
      let productionStage = null;
      if (o.category !== "SEWA") {
        const hidup = units.filter((u) => u.status !== "DELIVERED");
        if (hidup.length > 0) {
          const labelSet = [...new Set(hidup.map((u) => u.currentStage?.labelId).filter(Boolean))];
          productionStage = labelSet.length === 0
            ? { label: "Belum mulai produksi", mixed: false, unitCount: hidup.length }
            : labelSet.length === 1
              ? { label: labelSet[0], mixed: false, unitCount: hidup.length }
              : { label: `${labelSet.length} tahap berbeda`, mixed: true, detail: labelSet, unitCount: hidup.length };
        }
      }
      return {
        ...o,
        productionStage,
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
        pickupJob: ringkasJob(pickupJob),
        deliveryJob: ringkasJob(deliveryJob),
      };
    });

    // Ringkasan per status untuk header papan — dihitung di server supaya UI
    // tidak perlu memuat SELURUH order hanya untuk menghitung jumlah kolom.
    const perStatus = await prisma.order.groupBy({
      by: ["status"],
      where: { ...where, status: undefined },
      _count: { _all: true }, _sum: { value: true },
    });

    // KPI ringkasan (30 Agustus 2026) — BUG YANG DIPERBAIKI: sebelum ini
    // kartu "Total order"/"Nilai order"/"Belum lunas" di Orders.jsx dihitung
    // dari `items` yang SUDAH DIPOTONG `limit` (default 200) — begitu order
    // aktif bulan itu lebih dari 200, kartu diam-diam melaporkan angka
    // undercount TANPA tanda apa pun di kartunya sendiri (cuma ada catatan
    // kecil "dibatasi 200" di footer, gampang terlewat), dan tidak pernah
    // cocok dengan Laporan > Sales/Ringkasan yang aggregate-nya memang
    // unbounded. Ditemukan lewat pertanyaan owner "kenapa beda". Dua agregat
    // di bawah TIDAK terkena `limit` sama sekali (SELECT SUM/COUNT langsung,
    // bukan ambil semua baris) — pola sama dengan `perStatus` di atas. Pakai
    // `AND: [where, ...]` (bukan spread `{...where, status:...}`) supaya
    // filter status yang SUDAH dipilih user (kalau ada) tidak diam-diam
    // tertimpa — dua kondisi digabung, bukan saling mengganti.
    const [aktifAgg, belumLunasAgg] = await Promise.all([
      prisma.order.aggregate({
        where: { AND: [where, { status: { not: "CANCELLED" } }] },
        _count: { _all: true }, _sum: { value: true },
      }),
      prisma.order.aggregate({
        where: { AND: [where, { status: { not: "CANCELLED" }, paymentStatus: { not: "LUNAS" } }] },
        _sum: { value: true },
      }),
    ]);

    res.json({
      items,
      total: items.length,
      truncated: items.length >= limit,
      // summary = angka TRUE untuk seluruh order yang cocok filter (tidak
      // kepotong `limit`) — dipakai kartu KPI. `items`/`total`/`truncated`
      // di atas TETAP untuk tabel/daftar (memang sengaja dibatasi demi
      // kecepatan), dua hal beda tujuan, jangan disatukan.
      summary: {
        totalOrderAktif: aktifAgg._count._all,
        nilaiOrderAktif: aktifAgg._sum.value || 0,
        belumLunas:      belumLunasAgg._sum.value || 0,
      },
      perStatus: perStatus.map((g) => ({
        status: g.status, count: g._count._all, value: g._sum.value || 0,
      })),
    });
  } catch (err) {
    console.error("orders list error:", err);
    res.status(500).json({ error: "Gagal memuat daftar order" });
  }
});

// ── INVOICE (31 Agustus 2026) ──────────────────────────────────────────────
// Semua logikanya di services/invoice.js — route ini sengaja tipis: ambil,
// validasi input seperlunya, kembalikan. Jangan menaruh aturan nominal/status
// di sini (itu yang bikin logika tagihan tersebar & saling bertentangan).

// GET /api/orders/:id/invoice — invoice + seluruh nominal turunannya.
// Membuat draft on-demand kalau order ini lahir SEBELUM fitur invoice ada
// (tidak ada backfill massal — invoice lahir saat pertama kali dibuka).
orderRouter.get("/:id/invoice", async (req, res) => {
  try {
    const view = await buildInvoiceView(req.params.id, { userId: req.user?.id || null });
    if (!view) return res.status(404).json({ error: "Order tidak ditemukan" });
    res.json(view);
  } catch (err) {
    console.error("get invoice error:", err);
    res.status(500).json({ error: "Gagal memuat invoice" });
  }
});

// PATCH /api/orders/:id/invoice — ubah tahap manual (DRAFT/SENT/VIEWED/
// CANCELLED) dan/atau jatuh tempo & catatan cetak. Status uang
// (PAID/PARTIALLY_PAID/OVERDUE) TIDAK bisa diset dari sini — ditolak keras
// oleh setInvoiceLifecycle(), lihat alasannya di services/invoice.js.
orderRouter.patch("/:id/invoice", async (req, res) => {
  const { lifecycleStatus, dueDate, notes, alamatTujuan, namaTujuan } = req.body;
  try {
    // Pastikan invoice-nya ada dulu (order lama belum punya).
    const ada = await buildInvoiceView(req.params.id, { userId: req.user?.id || null });
    if (!ada) return res.status(404).json({ error: "Order tidak ditemukan" });

    if (dueDate !== undefined || notes !== undefined || alamatTujuan !== undefined || namaTujuan !== undefined) {
      await prisma.invoice.update({
        where: { orderId: req.params.id },
        data: {
          // "" / null = kosongkan lagi (pola sama field opsional lain di file ini).
          ...(dueDate !== undefined && {
            dueDate: dueDate ? parseTanggalKalender(dueDate, "Jatuh Tempo") : null,
          }),
          ...(notes !== undefined && { notes: notes || null }),
          // alamatTujuan/namaTujuan: HANYA override tampilan PDF invoice,
          // TIDAK PERNAH menulis balik ke Order/Customer — lihat schema.
          ...(alamatTujuan !== undefined && { alamatTujuan: alamatTujuan || null }),
          ...(namaTujuan !== undefined && { namaTujuan: namaTujuan || null }),
        },
      });
    }
    if (lifecycleStatus !== undefined) {
      await setInvoiceLifecycle(req.params.id, lifecycleStatus);
    }

    res.json(await buildInvoiceView(req.params.id, { userId: req.user?.id || null }));
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error("patch invoice error:", err);
    res.status(500).json({ error: "Gagal memperbarui invoice" });
  }
});

// GET /api/orders/:id/invoice/pdf — preview/download. TIDAK mengubah status
// apa pun (beda dari POST .../send di bawah) — sales boleh intip PDF-nya
// berkali-kali sebelum benar-benar dikirim ke customer.
orderRouter.get("/:id/invoice/pdf", async (req, res) => {
  try {
    const view = await buildInvoiceView(req.params.id, { userId: req.user?.id || null });
    if (!view) return res.status(404).json({ error: "Order tidak ditemukan" });
    const buffer = await renderInvoicePdf(view);
    res.setHeader("Content-Type", "application/pdf");
    // inline (bukan attachment) — buka langsung di tab baru/viewer bawaan
    // browser, konsisten dengan tombol "Preview Invoice" bukan "Download".
    res.setHeader("Content-Disposition", `inline; filename="${view.invoice.invoiceNumber}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error("invoice pdf error:", err);
    res.status(500).json({ error: "Gagal membuat PDF invoice" });
  }
});

// GET /api/orders/:id/invoice/mergeable — order LAIN milik customer yang
// sama, yang invoice-nya masih bisa digabung ke bundle order ini (belum
// terkirim). Dipakai isi picker "Gabungkan dengan Order Lain" di InvoicePanel.
//
// SENGAJA tidak difilter "belum jadi anggota bundle lain" (beda dari versi
// awal 2 Sep 2026) — attachOrderToInvoice() sekarang melakukan UNION 2
// bundle (bukan cuma "tempel ke primary"), jadi order yang sudah tergabung
// di bundle LAIN tetap valid dipilih (2 bundle akan digabung jadi 1). Yang
// TIDAK valid cuma order yang sudah 1 bundle YANG SAMA dengan order ini —
// itu bukan "bisa digabung", itu sudah 1 dokumen yang sama.
orderRouter.get("/:id/invoice/mergeable", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true, customerId: true, invoice: { select: { id: true, combinedIntoId: true } } },
    });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    let idBundleSaatIni = [order.id];
    if (order.invoice) {
      const primaryId = order.invoice.combinedIntoId || order.invoice.id;
      const primaryRow = await prisma.invoice.findUnique({
        where: { id: primaryId },
        select: { orderId: true, bundledInvoices: { select: { orderId: true } } },
      });
      if (primaryRow) {
        idBundleSaatIni = [primaryRow.orderId, ...primaryRow.bundledInvoices.map((b) => b.orderId)];
      }
    }

    const kandidat = await prisma.order.findMany({
      where: {
        customerId: order.customerId,
        id: { notIn: idBundleSaatIni },
        invoice: { sentAt: null, lifecycleStatus: { not: "CANCELLED" } },
      },
      select: { id: true, orderNumber: true, category: true, createdAt: true, invoice: { select: { invoiceNumber: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(kandidat.map((o) => ({
      orderId: o.id, orderNumber: o.orderNumber, category: o.category,
      createdAt: o.createdAt, invoiceNumber: o.invoice?.invoiceNumber || null,
    })));
  } catch (err) {
    console.error("get mergeable orders error:", err);
    res.status(500).json({ error: "Gagal memuat daftar order yang bisa digabung" });
  }
});

// POST /api/orders/:id/invoice/attach { targetOrderId } — gabungkan invoice
// order INI ke invoice order TARGET (target jadi primary bundle). Bukan
// admin-only seperti guardOrderLocked() — ini cuma pengelompokan dokumen,
// bukan mengubah data uang — tapi tetap tolak kalau salah satu order sudah
// LUNAS+terkunci, konsisten dengan aturan edit order yang sudah ada.
orderRouter.post("/:id/invoice/attach", async (req, res) => {
  const { targetOrderId } = req.body;
  if (!targetOrderId) return res.status(400).json({ error: "targetOrderId wajib diisi" });
  try {
    const guardedSource = await guardOrderLocked(req, res, req.params.id, "menggabungkan invoice order ini");
    if (!guardedSource) return;
    const guardedTarget = await guardOrderLocked(req, res, targetOrderId, "menjadi tujuan gabungan invoice");
    if (!guardedTarget) return;

    await prisma.$transaction((tx) => attachOrderToInvoice(tx, {
      sourceOrderId: req.params.id, targetOrderId, userId: req.user?.id || null,
    }));
    res.json(await buildInvoiceView(req.params.id, { userId: req.user?.id || null }));
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error("attach invoice error:", err);
    res.status(500).json({ error: "Gagal menggabungkan invoice" });
  }
});

// POST /api/orders/:id/invoice/detach — lepaskan invoice order ini dari
// bundle-nya, kembali berdiri sendiri seperti sebelum digabung.
orderRouter.post("/:id/invoice/detach", async (req, res) => {
  try {
    const guarded = await guardOrderLocked(req, res, req.params.id, "memisahkan invoice order ini");
    if (!guarded) return;

    await prisma.$transaction((tx) => detachInvoiceFromBundle(tx, { orderId: req.params.id }));
    res.json(await buildInvoiceView(req.params.id, { userId: req.user?.id || null }));
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error("detach invoice error:", err);
    res.status(500).json({ error: "Gagal memisahkan invoice" });
  }
});

// POST /api/orders/:id/invoice/send — generate PDF + kirim ke WhatsApp
// PELANGGAN (BUKAN grup sales seperti /send-wa-summary di atas — dua tombol
// beda tujuan, jangan disatukan). Begitu terkirim, invoice otomatis ditandai
// SENT (satu-satunya tempat status ini boleh berubah selain klik manual di
// InvoicePanel) — "terkirim" di sini punya arti sungguhan: dokumennya benar-
// benar sampai ke WhatsApp customer, bukan sekadar tombol diklik.
orderRouter.post("/:id/invoice/send", async (req, res) => {
  try {
    const view = await buildInvoiceView(req.params.id, { userId: req.user?.id || null });
    if (!view) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (!view.customer.id) {
      return res.status(400).json({ error: "Order ini tidak punya pelanggan yang valid." });
    }

    // Percakapan INDIVIDUAL yang PALING AKTIF dengan pelanggan ini — sumber
    // sessionId (CS-1/CS-2) & JID tujuan, pola identik jalur kirim pesan
    // biasa di conversations.js.
    const conversation = await prisma.conversation.findFirst({
      where: { customerId: view.customer.id, type: "INDIVIDUAL" },
      orderBy: { lastMessageAt: "desc" },
      include: { customer: { select: { phone: true } } },
    });
    if (!conversation) {
      return res.status(409).json({ error: "Belum ada percakapan WhatsApp dengan pelanggan ini — tidak tahu mau kirim ke sesi mana." });
    }
    const target = resolveSendTarget(conversation);
    if (!target) return res.status(400).json({ error: "Nomor WhatsApp pelanggan tidak tersedia." });

    const buffer = await renderInvoicePdf(view);
    const filename = `${view.invoice.invoiceNumber}.pdf`;
    fs.writeFileSync(path.join(invoicePdfsDir, filename), buffer);
    const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://backend:4000";
    const fileUrl = `${BACKEND_INTERNAL_URL}/media/invoice-pdfs/${filename}`;

    // Nama sapaan ikut override manual invoice (invoice.namaTujuan) kalau
    // ada — konsisten dengan nama yang benar-benar tercetak di PDF-nya,
    // supaya sapaan di WA dan nama di dokumen tidak pernah beda.
    const namaSapaan = view.invoice.namaTujuan || view.customer.nama || "Kak";
    const caption =
      `🧾 *Invoice Klinik Matras*\n\n` +
      `Halo ${namaSapaan}, berikut invoice untuk pesanan Anda 🙏\n` +
      `Terima kasih sudah mempercayakan tidur sehat Anda kepada Klinik Matras — Ahlinya Kasur Sehat.\n\n` +
      `Invoice No: ${view.invoice.invoiceNumber}\n` +
      // Gabung invoice lintas-order (2 Sep 2026) — pakai view.orders[]
      // (SEMUA order dalam bundle), bukan view.order (cuma primary).
      // Bug nyata: caption WA cuma nyebut 1 order padahal invoice-nya
      // gabungan 3 order — customer/sales bisa salah kira cuma 1 resi.
      `Order: ${(view.orders || [view.order]).map((o) => o.orderNumber).filter(Boolean).join(", ") || "-"}`;

    let wahaMsg;
    try {
      ({ result: wahaMsg } = await sendWithSessionFallback(conversation, (session) =>
        sendMedia(target, { url: fileUrl, mimetype: "application/pdf", filename }, caption, "document", session)
      ));
    } catch (waErr) {
      if (waErr instanceof SessionResolutionError) {
        return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
      }
      console.error("[invoice/send] gagal kirim:", waErr.message);
      return res.status(502).json({ error: `Gagal kirim invoice ke WhatsApp: ${waErr.message}` });
    }

    const msg = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        content: caption,
        mediaType: "document",
        mediaUrl: `/media/invoice-pdfs/${filename}`,
        externalId: wahaMsg?.id || wahaMsg?._data?.id?._serialized || null,
        sentById: req.user.id,
      },
    });
    const updatedConv = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(caption, "document") },
    });
    emitNewMessage(conversation.id, msg);
    emitConversationUpdate(updatedConv);

    await setInvoiceLifecycle(req.params.id, "SENT");

    res.json(await buildInvoiceView(req.params.id, { userId: req.user?.id || null }));
  } catch (err) {
    console.error("[invoice/send] error:", err);
    res.status(500).json({ error: "Gagal mengirim invoice" });
  }
});

// ─── Kartu Garansi E-Warranty (2 Sep 2026) ──────────────────────────────────
// Sama pola dengan invoice (route tipis, logika di services/warranty.js +
// services/warrantyPdf.js), TAPI TANPA lifecycle draft/sent/viewed — cuma
// "kapan terakhir dikirim & varian berapa tahun" (Order.warrantyYears/
// warrantySentAt di-tulis lewat markWarrantySent()).

// GET /api/orders/:id/warranty/pdf?years=10|20 — preview/download, TIDAK
// menandai apa pun terkirim (sama seperti GET .../invoice/pdf).
orderRouter.get("/:id/warranty/pdf", async (req, res) => {
  try {
    const years = Number(req.query.years) || undefined;
    const view = await buildWarrantyView(req.params.id, { userId: req.user?.id || null, warrantyYears: years });
    if (!view) return res.status(404).json({ error: "Order/pelanggan tidak ditemukan" });
    const buffer = await renderWarrantyPdf(view);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Kartu-Garansi-${view.invoiceNumber}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error("warranty pdf error:", err);
    res.status(500).json({ error: "Gagal membuat PDF kartu garansi" });
  }
});

// POST /api/orders/:id/warranty/send { years } — generate PDF + kirim ke
// WhatsApp pelanggan, pola identik POST .../invoice/send (sesi WA aktif
// customer yang sama, sendMedia lewat URL internal Docker).
orderRouter.post("/:id/warranty/send", async (req, res) => {
  const years = Number(req.body?.years);
  if (!WARRANTY_YEARS_VALID.includes(years)) {
    return res.status(400).json({ error: `Pilih varian garansi ${WARRANTY_YEARS_VALID.join(" atau ")} tahun.` });
  }
  try {
    const view = await buildWarrantyView(req.params.id, { userId: req.user?.id || null, warrantyYears: years });
    if (!view) return res.status(404).json({ error: "Order/pelanggan tidak ditemukan" });
    if (!view.customer.id) {
      return res.status(400).json({ error: "Order ini tidak punya pelanggan yang valid." });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { customerId: view.customer.id, type: "INDIVIDUAL" },
      orderBy: { lastMessageAt: "desc" },
      include: { customer: { select: { phone: true } } },
    });
    if (!conversation) {
      return res.status(409).json({ error: "Belum ada percakapan WhatsApp dengan pelanggan ini — tidak tahu mau kirim ke sesi mana." });
    }
    const target = resolveSendTarget(conversation);
    if (!target) return res.status(400).json({ error: "Nomor WhatsApp pelanggan tidak tersedia." });

    const buffer = await renderWarrantyPdf(view);
    const filename = `Kartu-Garansi-${view.invoiceNumber}-${years}th.pdf`;
    fs.writeFileSync(path.join(warrantyPdfsDir, filename), buffer);
    const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://backend:4000";
    const fileUrl = `${BACKEND_INTERNAL_URL}/media/warranty-pdfs/${filename}`;

    const caption =
      `📜 *Kartu Garansi Klinik Matras — ${years} Tahun*\n\n` +
      `Halo ${view.customer.nama || "Kak"}, berikut kartu e-garansi untuk pesanan Anda 🙏\n\n` +
      `ID Transaksi: ${view.invoiceNumber}\n` +
      `Order: ${view.order.orderNumber || "-"}\n\n` +
      `Simpan dokumen ini — scan QR di dalamnya kapan saja kalau ingin mengajukan klaim garansi.`;

    let wahaMsg;
    try {
      ({ result: wahaMsg } = await sendWithSessionFallback(conversation, (session) =>
        sendMedia(target, { url: fileUrl, mimetype: "application/pdf", filename }, caption, "document", session)
      ));
    } catch (waErr) {
      if (waErr instanceof SessionResolutionError) {
        return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
      }
      console.error("[warranty/send] gagal kirim:", waErr.message);
      return res.status(502).json({ error: `Gagal kirim kartu garansi ke WhatsApp: ${waErr.message}` });
    }

    const msg = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        content: caption,
        mediaType: "document",
        mediaUrl: `/media/warranty-pdfs/${filename}`,
        externalId: wahaMsg?.id || wahaMsg?._data?.id?._serialized || null,
        sentById: req.user.id,
      },
    });
    const updatedConv = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(caption, "document") },
    });
    emitNewMessage(conversation.id, msg);
    emitConversationUpdate(updatedConv);

    await markWarrantySent(req.params.id, years);

    res.json(await buildWarrantyView(req.params.id, { userId: req.user?.id || null, warrantyYears: years }));
  } catch (err) {
    console.error("[warranty/send] error:", err);
    res.status(500).json({ error: "Gagal mengirim kartu garansi" });
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
// "Rp1.590.000" — KHUSUS pesan WA, lihat catatan sama di OrderSection.jsx.
function formatRpWa(n) {
  return `Rp${formatAngka(n)}`;
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
// Dirapikan 21 Agustus 2026 — lihat catatan lengkap di buildWaMessage() milik
// OrderSection.jsx (kedua definisi ini WAJIB tetap sama persis).
// actorName: SIAPA yang mengirim pesan ini SEKARANG (req.user.name di
// pemanggil) — BUKAN customer.assignedSales (pemilik lead di CRM, dua hal
// ini bisa beda orang). BUG NYATA (22 Agustus 2026): Kiki menutup &
// mengisi sebuah order, tapi baris "CS:" di pesan WA menampilkan Risel
// karena leadnya memang pernah/masih ditugaskan ke Risel — customer bisa
// dipegang satu sales sementara order yang sedang diproses dikerjakan
// sales lain (transfer, backup, dst). Baris CS harus mencerminkan siapa
// yang MENGIRIM pesan ini, bukan riwayat kepemilikan lead.
function buildWaMessage(order, customer, actorName) {
  const info  = parseOrderNotesForWa(order.notes);
  const berat = (order.weightEntries || []).map((w) => w.beratKg).join(", ") || "-";
  const cats  = order.complaintCategory || [];

  const areaSelected = cats.filter((c) => BODY_AREA_LABELS[c]).map((c) => BODY_AREA_LABELS[c]);
  const keluhanLines = [];
  if (areaSelected.length) keluhanLines.push(`  • sakit Area ${areaSelected.join(", ")}`);
  if (cats.includes("PEGAL_PEGAL")) keluhanLines.push("  • Pegal area seluruh badan");
  if (cats.includes("LAINNYA")) keluhanLines.push("  • Lainnya");

  const layanan    = (order.items || []).map((i) => i.layananName).join(", ") || "-";
  const finalBiaya = order.value || 0;
  const biayaAwal = order.promo?.discountPercent
    ? Math.round(finalBiaya / (1 - order.promo.discountPercent / 100))
    : finalBiaya;
  const alamatLengkap = `${order.deliveryAddress || "-"}${order.deliveryCity ? `, ${order.deliveryCity}` : ""}`;

  return [
    `📦 *ORDER BARU* — ${order.orderNumber || "-"}`,
    ``,
    `👤 *Data Pelanggan*`,
    `Nama: ${customer.name || "-"}`,
    `No. HP: ${customer.phone || "-"}`,
    `Alamat: ${alamatLengkap}`,
    ``,
    `⚖️ *Kondisi Tubuh*`,
    `Berat Badan: ${berat} kg`,
    `Keluhan Fisik saat Bangun Tidur:`,
    keluhanLines.length ? keluhanLines.join("\n") : "  -",
    `Keluhan Kasur: ${info.keluhanCustomer || "-"}`,
    ``,
    `🛏️ *Spesifikasi Kasur*`,
    `Ukuran: ${info.ukuranKasur || "-"}`,
    `Merk: ${info.merkKasur || "-"}`,
    `Layanan: ${layanan}`,
    ``,
    `💰 *Biaya*`,
    `Harga Awal: ${formatRpWa(biayaAwal)}`,
    `Diskon: ${order.promo ? order.promo.code : "-"}`,
    `*Total: ${formatRpWa(finalBiaya)}*`,
    `Ongkir: ${formatRpWa(order.ongkir)}`,
    `Ongkir Klaim Garansi: ${formatRpWa(order.ongkirKlaimGaransi)}`,
    ``,
    `📅 *Jadwal*`,
    `Pick Up: ${order.pickupEstimate || "-"}${order.pickupConfirmedDate ? ` (Pasti: ${formatTanggalOrder(order.pickupConfirmedDate)})` : ""}`,
    `Kirim: ${order.deliveryEstimate || "-"}${order.deliveryConfirmedDate ? ` (Pasti: ${formatTanggalOrder(order.deliveryConfirmedDate)})` : ""}`,
    ``,
    `📍 Lokasi: ${order.locationUrl || "-"}`,
    `🧑‍💼 CS: ${actorName || customer.assignedSales?.name || "-"}`,
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
    // Dicek DI SINI juga (bukan cuma di buildChatId) supaya sales dapat 409
    // dengan instruksi konkret, bukan 502 "Gagal kirim ke WhatsApp: ..." yang
    // terdengar seperti WhatsApp-nya bermasalah padahal salah pilih grup.
    if (isPlaceholderGroupJid(target)) {
      return res.status(409).json({
        error: "Grup WA order yang dipilih tidak punya alamat WhatsApp asli (grup lama, data belum lengkap). " +
               "Admin perlu memilih ulang grup di halaman Order — pilih grup yang pesannya masih aktif masuk ke Inbox.",
      });
    }

    const text = buildWaMessage(order, order.customer, req.user.name);

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

// Dipakai DUA jalur yang bisa membatalkan order — POST /:id/cancel (tombol
// "Batalkan Order" khusus) DAN PATCH /:id { status: "CANCELLED" } (dropdown
// generik "Ubah Status", SATU-SATUNYA cara ubah status lain — lihat komentar
// di OrderSection.jsx). Sebelum 24 Agustus 2026, cuma jalur PERTAMA yang
// mengecek blocker ini + mengkaskade unit — jalur KEDUA (yang ternyata jauh
// lebih sering dipakai sales sehari-hari, "Batalkan Order" kalah populer dari
// dropdown status) diam-diam melewati semuanya: order jadi CANCELLED tapi
// unit-unitnya TETAP AWAITING_PICKUP/dst selamanya (ghost unit). Ditemukan
// 23 Agustus 2026 (lihat CLAUDE.md armada job real-test): 57 dari 190 unit
// AWAITING_PICKUP order-nya sudah CANCELLED — sebagian besar via jalur ini.
// Sekarang SATU fungsi dipakai KEDUANYA supaya tidak ada lagi jalur kedua
// yang lupa diberi pengaman yang sama.
// Job dianggap "komitmen nyata" (blokir cancel) HANYA kalau driver SUDAH
// bergerak (EN_ROUTE/ARRIVED) atau SUDAH selesai (COMPLETED) — bukan
// sekadar ADA. Ditemukan 31 Agustus 2026 (laporan sales, screenshot):
// sales gagal membatalkan order yang job-nya cuma UNSCHEDULED (kerangka
// otomatis dari armadaAutoJob.js — tanpa driver, tanpa tanggal, TIDAK ADA
// komitmen fisik apa pun). Job seperti ini dibersihkan otomatis saat
// order dibatalkan (lihat hapusJobBelumJalan di bawah), bukan jadi alasan
// menolak sales.
const JOB_STATUS_BLOKIR_CANCEL = ["EN_ROUTE", "ARRIVED", "COMPLETED"];

async function checkCancelBlockers(orderId) {
  const [units, jobsBlokir, paymentCount, scopeRevisionCount] = await Promise.all([
    prisma.unit.findMany({
      where: { orderId },
      select: { id: true, status: true, currentStageId: true, unitCode: true },
    }),
    prisma.job.findMany({
      where: { orderId, status: { in: JOB_STATUS_BLOKIR_CANCEL } },
      select: { id: true },
    }),
    prisma.payment.count({ where: { orderId } }),
    prisma.scopeRevision.count({ where: { orderId } }),
  ]);
  const inFlightUnits = units.filter(
    (u) => u.currentStageId != null && u.status !== "CANCELLED" && u.status !== "DELIVERED"
  );

  const blockers = [];
  if (inFlightUnits.length > 0) {
    blockers.push(`${inFlightUnits.length} unit sudah mulai dikerjakan bengkel (${inFlightUnits.map((u) => u.unitCode).join(", ")})`);
  }
  if (jobsBlokir.length > 0) blockers.push(`${jobsBlokir.length} job pickup/pengiriman sedang berjalan atau sudah selesai`);
  if (paymentCount > 0) blockers.push(`${paymentCount} pembayaran`);
  if (scopeRevisionCount > 0) blockers.push(`${scopeRevisionCount} revisi lingkup kerja`);
  return { blockers, units };
}

// Job yang BELUM jalan (UNSCHEDULED/SCHEDULED/ASSIGNED) tidak punya alasan
// untuk tetap ada begitu order-nya dibatalkan — dihapus, sama seperti
// dispatcher hapus manual lewat DELETE /armada/jobs/:id (guard status
// yang SAMA persis, lihat armada.js). Job EN_ROUTE/ARRIVED/COMPLETED tidak
// akan pernah sampai sini — checkCancelBlockers sudah menolak lebih dulu.
async function hapusJobBelumJalan(tx, orderId) {
  await tx.job.deleteMany({
    where: { orderId, status: { in: ["UNSCHEDULED", "SCHEDULED", "ASSIGNED"] } },
  });
}

// Kebalikan dari hapusJobBelumJalan di atas, dipakai saat order ditutup
// "Terkirim" (bukan dibatalkan) — job yang belum jalan (UNSCHEDULED/
// SCHEDULED/ASSIGNED) DI-SINKRON jadi COMPLETED, BUKAN dihapus (keputusan
// 4 September 2026: order/unit-nya sendiri sudah benar, cuma status Job di
// Armada yang belum nyambung — datanya tetap berharga untuk riwayat, jadi
// jangan dibuang). Job EN_ROUTE/ARRIVED tidak akan pernah sampai sini —
// guard unitEnRoute di pemanggil sudah menolak lebih dulu.
async function selesaikanJobBelumJalan(tx, orderId) {
  await tx.job.updateMany({
    where: { orderId, status: { in: ["UNSCHEDULED", "SCHEDULED", "ASSIGNED"] } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

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

    const { blockers, units } = await checkCancelBlockers(req.params.id);

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
      await hapusJobBelumJalan(tx, req.params.id);
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
  // priceItemId/variantKey/normalPrice/standardPrice (29 Agustus 2026) —
  // SEMUANYA OPSIONAL. Item ketik-bebas di luar katalog tetap sah persis
  // seperti sebelumnya, dan pemanggil lama (mobile OrderFormModal,
  // scopeRevision.js) yang tidak mengirimnya tidak perlu diubah.
  const { layananName, harga, sortOrder, priceItemId, variantKey, normalPrice, standardPrice, kind } = req.body;
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
        // Snapshot harga katalog — disimpan APA ADANYA dari yang dikirim
        // frontend saat layanan dipilih, TIDAK di-lookup ulang di sini.
        // Itu memang tujuannya: order harus memegang angka yang benar-benar
        // ditawarkan saat itu, bukan angka daftar harga versi terbaru.
        ...(priceItemId && { priceItemId }),
        ...(variantKey && { variantKey: String(variantKey) }),
        ...(normalPrice != null && normalPrice !== "" && { normalPrice: Number(normalPrice) }),
        ...(standardPrice != null && standardPrice !== "" && { standardPrice: Number(standardPrice) }),
        ...(kind && { kind }),
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
