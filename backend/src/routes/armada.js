// Armada — jadwal pickup & pengiriman (Sano Hub Phase 1).
//
// SENGAJA MINIMAL per PRD §1.5/§11 Phase 1: penjadwalan MANUAL, TANPA route
// builder, TANPA optimasi rute, TANPA kapasitas kendaraan. Dispatcher pilih
// unit + driver + tanggal; driver dapat daftar berurut, bukan peta.
//
// STATUS UNIT diturunkan dari status Job saat job selesai/gagal — INI
// SIMPLIFIKASI SADAR: PRD memodelkan IN_TRANSIT_IN/IN_TRANSIT_OUT sebagai
// jendela terpisah, tapi belum ada fitur scan intake gudang (FR-P-01) yang
// akan mengonsumsi status IN_TRANSIT_IN. Tanpa fitur itu, unit yang berhenti
// di IN_TRANSIT_IN tidak akan pernah bisa dipindah lagi — jadi PICKUP selesai
// langsung ke RECEIVED. Kalau nanti scan intake dibangun, ini perlu direvisi
// jadi dua langkah.

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../utils/wib.js";
import { sendMedia } from "../services/wahaClient.js";
import { sendWithSessionFallback, resolveSendTarget } from "./conversations.js";
import { buildMessagePreview } from "../utils/messagePreview.js";
import { emitNewMessage, emitConversationUpdate } from "../socket.js";
import { notifyDriverEnRoute, notifyUnitReceived, notifyDelivered } from "../services/customerNotifications.js";
import { recomputeOrderPaymentStatus } from "../services/paymentLedger.js";
import { syncOrderStatusForUnits } from "../services/orderStatusSync.js";
import { ACTIVE_JOB_STATUSES, ELIGIBLE_ORDER_STATUS } from "../services/jobStatus.js";
import { geocodeAddress, routeLegs } from "../services/maps.js";

export const armadaRouter = express.Router();
armadaRouter.use(requireAuth);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jobPhotosDir = path.join(__dirname, "../../data/job-photos");
if (!fs.existsSync(jobPhotosDir)) fs.mkdirSync(jobPhotosDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: jobPhotosDir,
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

// Foto struk/nota — dokumentasi biaya & servis kendaraan (D-035, ditambah
// 22 Agustus 2026 atas permintaan eksplisit "buat pengisiannya simple dan
// ada dokumentasinya"). Dir & batas SAMA dengan `upload` di atas, cuma
// tujuan foldernya beda — dipisah supaya dokumen finansial tidak bercampur
// dengan foto proses job di disk.
const vehicleReceiptsDir = path.join(__dirname, "../../data/vehicle-receipts");
if (!fs.existsSync(vehicleReceiptsDir)) fs.mkdirSync(vehicleReceiptsDir, { recursive: true });
const uploadReceipt = multer({
  storage: multer.diskStorage({
    destination: vehicleReceiptsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Hanya file gambar yang diperbolehkan"));
    cb(null, true);
  },
});

class ArmadaError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof ArmadaError) return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Armada error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

// D-018: kirim foto+ringkasan job selesai/gagal ke grup driver yang
// ditugaskan (Conversation.isDriverGroup). BEST-EFFORT, SELALU dibungkus
// try/catch oleh pemanggil — menyelesaikan job ADALAH kebenaran (Unit/Job
// record), posting ke grup cuma dokumentasi tambahan. Kalau grup belum
// ditetapkan atau WAHA gagal, job TETAP berhasil selesai/gagal, cuma
// dokumentasinya yang tidak terkirim.
//
// TIDAK seperti send-documentation (D-016) yang perlu klik manual sales
// sebelum sampai ke CUSTOMER, ini OTOMATIS — target-nya grup ops INTERNAL,
// pola yang sama dengan "kepala produksi update ke grup" yang Gilang
// sebut sebagai praktik biasa, bukan sesuatu yang perlu direview per pesan.
async function notifyDriverGroup(job, photoUrls, headline) {
  const group = await prisma.conversation.findFirst({ where: { type: "GROUP", isDriverGroup: true } });
  if (!group) return; // belum ditetapkan — diam-diam, bukan error

  const target = resolveSendTarget(group);
  if (!target) return;

  const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://backend:4000";
  const orderNo = job.units[0]?.unit?.order?.orderNumber || job.orderId;
  const unitList = job.units.map((ju) => ju.unit.unitCode).join(", ");

  const savedMessages = [];
  for (let i = 0; i < photoUrls.length; i++) {
    const isLast = i === photoUrls.length - 1;
    const caption = isLast ? `${headline}\n*${orderNo}*\n${unitList}` : "";
    try {
      const { session } = await sendWithSessionFallback(group, (s) =>
        sendMedia(
          target,
          { mimetype: "image/jpeg", filename: photoUrls[i].split("/").pop(), url: `${BACKEND_INTERNAL_URL}${photoUrls[i]}` },
          caption, "media", s
        )
      );
      group.sessionId = session;
      // Simpan Message supaya riwayat grup di Inbox CRM tetap sinkron dengan
      // apa yang benar-benar terkirim ke WhatsApp — sama seperti pola
      // send-product/send-documentation, bukan jalur kirim yang "senyap".
      const msg = await prisma.message.create({
        data: { conversationId: group.id, direction: "OUTBOUND", content: caption, mediaType: "image", mediaUrl: photoUrls[i] },
      });
      savedMessages.push(msg);
    } catch (err) {
      console.error(`[notifyDriverGroup] Gagal kirim foto ${photoUrls[i]}:`, err.message);
    }
    if (!isLast) await new Promise((r) => setTimeout(r, 1500));
  }

  if (savedMessages.length > 0) {
    const last = savedMessages[savedMessages.length - 1];
    const updatedGroup = await prisma.conversation.update({
      where: { id: group.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(last.content, last.mediaType) },
    });
    savedMessages.forEach((m) => emitNewMessage(group.id, m));
    emitConversationUpdate(updatedGroup);
  }
}

// ACTIVE_JOB_STATUSES & ELIGIBLE_ORDER_STATUS dipindah ke
// services/jobStatus.js 24 Agustus 2026 — dipakai juga oleh
// services/armadaAutoJob.js (auto-buat job pickup saat order masuk),
// satu sumber kebenaran supaya definisi "job aktif"/"order layak
// dijadwalkan" tidak drift antara dua file.

const jobInclude = {
  driver: { select: { id: true, name: true } },
  helper: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNumber: true } },
  // BUG DITEMUKAN 31 Agustus 2026 (laporan owner: JobDetailDrawer terasa
  // "kosong" — Kontak & Timeline status Order tidak pernah muncul). Job
  // punya relasi LANGSUNG ke Order (job.orderId, lihat schema.prisma), TAPI
  // jobInclude sebelumnya cuma meng-include Order lewat jalur BERLAPIS
  // job.units[].unit.order (dipakai jobStatus.js customerOf()/orderNumberOf()
  // sebagai FALLBACK). JobDetailDrawer.jsx membaca job.order LANGSUNG
  // (DeliveryTimeline, link telepon Kontak) TANPA fallback ke jalur
  // berlapis itu — jadi job.order selalu `undefined`, bukan cuma kadang
  // kosong. Field yang dipilih SAMA dengan units[].unit.order di bawah
  // (termasuk deliveryAddress/deliveryCity D-032, dipakai prefill alamat).
  order: {
    select: {
      id: true, orderNumber: true, status: true,
      // category (D-051, 4 September 2026) — dipakai DeliveryTimeline.jsx
      // untuk membedakan alur order BARU (3 tahap: Diproses/Siap Kirim/
      // Terkirim, TANPA Menunggu/Pengambilan — tidak ada barang fisik yang
      // diambil dari customer, ini kasur/produk baru yang dibuat dari nol)
      // dari LAYANAN/SEWA (5 tahap penuh, ada fase pengambilan unit lama).
      category: true,
      deliveryAddress: true, deliveryCity: true,
      customer: { select: { id: true, name: true, phone: true, assignedSales: { select: { id: true, name: true } } } },
    },
  },
  payments: {
    select: { id: true, amount: true, method: true, createdAt: true, verifications: { select: { id: true } } },
  },
  units: {
    include: {
      unit: {
        include: {
          order: {
            select: {
              id: true, orderNumber: true,
              // status — dipakai DeliveryTimeline.jsx di JobDetailDrawer
              // (30 Agustus 2026) supaya drawer bisa menampilkan tahap Order
              // (Menunggu/Pengambilan/dst), bukan cuma status Job itu sendiri.
              status: true,
              // category (D-051) — lihat catatan di order.select di atas.
              category: true,
              // D-032 — alamat/kota SALES/rencana (D-027), dipakai FE
              // sebagai prefill saat dispatcher pertama kali isi addressText
              // job ini (belum ada alamat verifikasi lapangan). Keputusan
              // yang sebelumnya ditunda di komentar Order.deliveryAddress —
              // ini jalur baca-saja, tidak menimpa job.addressText yang
              // sudah diisi/diverifikasi driver.
              deliveryAddress: true, deliveryCity: true,
              // assignedSales (D-043, 2 September 2026) — laporan owner:
              // dispatcher perlu tahu SIAPA sales yang pegang order ini
              // (buat koordinasi/tanya-jawab), bukan cuma nama customer.
              customer: { select: { id: true, name: true, phone: true, assignedSales: { select: { id: true, name: true } } } },
            },
          },
        },
      },
    },
  },
};

function deriveStatus(hasDriver, hasDate) {
  if (hasDriver && hasDate) return "ASSIGNED";
  if (hasDate) return "SCHEDULED";
  return "UNSCHEDULED";
}

function toDateOnly(input) {
  if (!input) return null;
  return new Date(`${input}T00:00:00.000Z`);
}

// Geocode alamat teks jadi lat/lng — BEST-EFFORT (FR-L-03 butuh koordinat
// untuk hitung jarak antar-stop). Gagal geocode TIDAK PERNAH menggagalkan
// simpan job; alamat teks tetap tersimpan dan deep link Maps di driver masih
// jalan lewat pencarian teks (lihat mapsUrl() di DriverJobs.jsx).
async function bestEffortGeocode(addressText) {
  try {
    return await geocodeAddress(addressText);
  } catch (err) {
    console.error("[armada] geocode gagal:", err.message);
    return null;
  }
}

// GET /api/armada/driver-group — grup WA yang ditugaskan menerima
// dokumentasi (D-018). ADMIN only: menandai grup butuh CONVERSATION_READ
// untuk melihat daftar grup yang ada, dan DISPATCHER TIDAK punya permission
// itu (lihat permissions.js) — konsisten, bukan pembatasan baru.
// GET /api/armada/groups — daftar percakapan GRUP, untuk admin memilih mana
// "Grup Driver" (D-018). ADMIN only, sama alasannya dengan /driver-group.
armadaRouter.get("/groups", requirePermission(P.USER_MANAGE), async (req, res) => {
  try {
    const groups = await prisma.conversation.findMany({
      where: { type: "GROUP" },
      select: { id: true, groupName: true, groupJid: true, isDriverGroup: true },
      orderBy: { groupName: "asc" },
    });
    res.json(groups);
  } catch (err) {
    handleErr(err, res);
  }
});

armadaRouter.get("/driver-group", requirePermission(P.USER_MANAGE), async (req, res) => {
  try {
    const group = await prisma.conversation.findFirst({
      where: { type: "GROUP", isDriverGroup: true },
      select: { id: true, groupName: true, groupJid: true },
    });
    res.json({ group });
  } catch (err) {
    handleErr(err, res);
  }
});

// PUT /api/armada/driver-group { conversationId }
// Index unik parsial di database (migrasi 20260801110000) yang SEBENARNYA
// menjamin cuma satu grup aktif — endpoint ini cuma perlu urus "matikan yang
// lama, nyalakan yang baru" dalam satu transaksi supaya tidak ada jendela
// waktu dua-duanya true (yang akan membentur index itu).
armadaRouter.put("/driver-group", requirePermission(P.USER_MANAGE), async (req, res) => {
  try {
    const { conversationId } = req.body;
    if (!conversationId) throw new ArmadaError("conversationId wajib diisi");
    const target = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!target) throw new ArmadaError("Percakapan tidak ditemukan", 404);
    if (target.type !== "GROUP") throw new ArmadaError("Hanya percakapan GRUP yang bisa ditandai");

    await prisma.$transaction([
      prisma.conversation.updateMany({ where: { isDriverGroup: true }, data: { isDriverGroup: false } }),
      prisma.conversation.update({ where: { id: conversationId }, data: { isDriverGroup: true } }),
    ]);
    res.json({ ok: true, group: { id: target.id, groupName: target.groupName } });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/armada/drivers — daftar user berrole DRIVER, untuk dropdown
// penugasan dispatcher. Endpoint terpisah dari GET /api/users (dipakai luas
// di seluruh CRM untuk manajemen user) supaya scope-nya tetap sempit dan
// tidak menyentuh endpoint yang lebih sensitif itu.
armadaRouter.get("/drivers", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const rows = await prisma.userRole.findMany({
      where: { role: "DRIVER" },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: "asc" } },
    });
    res.json(rows.map((r) => r.user));
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/armada/helpers — daftar TERPISAH dari /drivers (D-037, 31
// Agustus 2026). SENGAJA query role HELPER, bukan DRIVER — kolam nama
// pendamping tidak pernah tercampur dengan pilihan driver, walau satu
// orang secara teknis bisa punya dua-duanya (lihat catatan enum Role).
armadaRouter.get("/helpers", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const rows = await prisma.userRole.findMany({
      where: { role: "HELPER" },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: "asc" } },
    });
    res.json(rows.map((r) => r.user));
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/armada/board?date=YYYY-MM-DD&type=PICKUP|DELIVERY
// GET /api/armada/jobs — DAFTAR job dengan filter, untuk halaman
// "Jadwal & Penugasan" (Delivery Tahap 2).
//
// TERPISAH dari GET /board dengan sengaja, bukan menggantikannya. /board
// menjawab pertanyaan berbeda: "job tipe X pada tanggal Y, plus unit apa saja
// yang masih bisa dijadwalkan" — bentuknya melayani papan penjadwalan per
// driver dan TIDAK BISA menampilkan lintas-tipe atau lintas-tanggal (type
// wajib diisi, tanggal tunggal). Endpoint ini menjawab "tunjukkan job yang
// cocok dengan filter ini", yang dibutuhkan tampilan tabel.
//
// SEMUA filter opsional. Tanpa parameter apa pun ia mengembalikan job terbaru
// — jangan diubah jadi wajib berfilter, halaman tabel membuka keadaan default
// itu saat pertama dibuka.
armadaRouter.get("/jobs", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { type, status, driverId, routeId, date, from, to, q, take } = req.query;

    // Rentang tanggal memakai batas WIB, BUKAN `new Date(x)` polos — container
    // backend jalan di UTC, jadi batas polos menggeser jendela 7 jam dan job
    // pagi hari terhitung di hari sebelumnya (CLAUDE.md §11).
    let scheduledDate;
    if (date === "none") {
      // "none" (D-062, 4 September 2026) — job yang BELUM PERNAH dikasih
      // tanggal sama sekali (bukan "tanggal tertentu di masa lalu/depan").
      // Dibutuhkan Route Planner untuk menunjukkan backlog job yang masih
      // nyangkut di Jadwal & Penugasan tanpa tanggal — SEBELUM ini backlog
      // itu tidak pernah kelihatan sama sekali di Route Planner (halaman
      // itu selalu query per-tanggal spesifik, job tanpa tanggal tidak
      // cocok filter tanggal APA PUN). Laporan owner: "banyak order yang
      // belum dijadwalkan dan belum masuk rute" tapi panel kiri Route
      // Planner selalu kosong.
      scheduledDate = null;
    } else if (date) {
      scheduledDate = toDateOnly(date);
    } else if (from || to) {
      scheduledDate = {};
      if (from) scheduledDate.gte = toDateOnly(from);
      // Batas EKSKLUSIF: `lte` pada kolom DATE membuang seluruh hari terakhir
      // di beberapa kasus timezone. Lihat bug yang pernah terjadi di
      // routes/analytics.js.
      if (to) scheduledDate.lte = toDateOnly(to);
    }

    const cari = (q || "").trim();

    const jobs = await prisma.job.findMany({
      where: {
        ...(type && { type }),
        ...(status && { status }),
        // "none" = job yang BELUM punya driver — ini yang dicari dispatcher
        // tiap pagi, dan tidak bisa diungkapkan dengan driverId biasa.
        ...(driverId === "none" ? { driverId: null } : driverId ? { driverId } : {}),
        // routeId=none — job yang BELUM masuk rute mana pun. Ini panel kiri
        // Route Planner: "job yang perlu dikelompokkan". Job yang statusnya
        // sudah COMPLETED/FAILED/CANCELLED tidak relevan untuk itu, jadi
        // pemanggil (frontend) menggabungkan ini dengan filter status=UNSCHEDULED
        // atau SCHEDULED sendiri — endpoint ini tidak menebak maksudnya.
        ...(routeId === "none" ? { routeId: null } : routeId ? { routeId } : {}),
        ...(scheduledDate !== undefined && { scheduledDate }),
        ...(cari && {
          OR: [
            { addressText: { contains: cari, mode: "insensitive" } },
            { order: { orderNumber: { contains: cari, mode: "insensitive" } } },
            { order: { customer: { name: { contains: cari, mode: "insensitive" } } } },
            { order: { customer: { phone: { contains: cari } } } },
          ],
        }),
      },
      include: {
        ...jobInclude,
        vehicle: { select: { id: true, plateNumber: true, type: true } },
        route: { select: { id: true, code: true, status: true } },
        // deliveryCity (D-058, 4 September 2026) — laporan owner: bantu
        // dispatcher mengelompokkan job searah di Route Planner ("Belum
        // Masuk Rute" panel kiri). Job.addressText adalah teks bebas
        // (snapshot alamat lengkap), tidak cocok dijadikan kunci
        // pengelompokan — Order.deliveryCity (diisi sales, dropdown kota
        // tetap) yang dipakai.
        order: { select: { id: true, orderNumber: true, deliveryCity: true, customer: { select: { id: true, name: true, phone: true } } } },
      },
      orderBy: [{ scheduledDate: "desc" }, { sequence: "asc" }, { createdAt: "desc" }],
      take: Math.min(Number(take) || 200, 500),
    });

    res.json({ jobs });
  } catch (err) {
    handleErr(err, res);
  }
});

// ─── ARMADA (Vehicle) — Delivery Tahap 3 ────────────────────────────────────
// CRUD dasar. Permission memakai P.ROUTE_WRITE (bukan permission baru): fleet
// management di sini SATU alur dengan perencanaan rute (dispatcher yang
// menugaskan kendaraan ke rute juga yang menambahkan kendaraan baru). Kalau
// nanti muncul role "fleet manager" terpisah dari dispatcher, pisahkan.

armadaRouter.get("/vehicles", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { status } = req.query;
    const vehicles = await prisma.vehicle.findMany({
      where: { ...(status && { status }) },
      orderBy: { plateNumber: "asc" },
    });
    res.json({ vehicles });
  } catch (err) {
    handleErr(err, res);
  }
});

armadaRouter.post("/vehicles", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const {
      plateNumber, type, capacitySlots, mileageKm, nextServiceDate, notes,
      // D-035 — detail fisik & dokumen (semua opsional, lihat schema.prisma)
      brand, model, year, color, chassisNumber, engineNumber,
      stnkNumber, stnkExpiry, taxExpiry, kirExpiry,
      insurancePolicy, insuranceExpiry, picDriverId,
    } = req.body;
    if (!plateNumber?.trim()) throw new ArmadaError("Nomor polisi wajib diisi");
    if (!type?.trim()) throw new ArmadaError("Tipe kendaraan wajib diisi");
    const slots = Number(capacitySlots);
    if (!Number.isFinite(slots) || slots < 1) throw new ArmadaError("Kapasitas slot harus angka minimal 1");

    const vehicle = await prisma.vehicle.create({
      data: {
        plateNumber: plateNumber.trim().toUpperCase(),
        type: type.trim(),
        capacitySlots: slots,
        mileageKm: mileageKm !== undefined ? Number(mileageKm) : null,
        nextServiceDate: nextServiceDate ? toDateOnly(nextServiceDate) : null,
        notes: notes?.trim() || null,
        brand: brand?.trim() || null,
        model: model?.trim() || null,
        year: year ? Number(year) : null,
        color: color?.trim() || null,
        chassisNumber: chassisNumber?.trim() || null,
        engineNumber: engineNumber?.trim() || null,
        stnkNumber: stnkNumber?.trim() || null,
        stnkExpiry: stnkExpiry ? toDateOnly(stnkExpiry) : null,
        taxExpiry: taxExpiry ? toDateOnly(taxExpiry) : null,
        kirExpiry: kirExpiry ? toDateOnly(kirExpiry) : null,
        insurancePolicy: insurancePolicy?.trim() || null,
        insuranceExpiry: insuranceExpiry ? toDateOnly(insuranceExpiry) : null,
        picDriverId: picDriverId || null,
      },
    });
    res.status(201).json(vehicle);
  } catch (err) {
    // Unique constraint plateNumber — pesan yang jelas, bukan "Server error".
    if (err.code === "P2002") return res.status(409).json({ error: "Nomor polisi ini sudah terdaftar" });
    handleErr(err, res);
  }
});

armadaRouter.patch("/vehicles/:id", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const {
      plateNumber, type, capacitySlots, status, active, mileageKm, nextServiceDate, notes,
      brand, model, year, color, chassisNumber, engineNumber,
      stnkNumber, stnkExpiry, taxExpiry, kirExpiry,
      insurancePolicy, insuranceExpiry, picDriverId,
    } = req.body;
    const vehicle = await prisma.vehicle.update({
      where: { id: req.params.id },
      data: {
        ...(plateNumber !== undefined && { plateNumber: plateNumber.trim().toUpperCase() }),
        ...(type !== undefined && { type: type.trim() }),
        ...(capacitySlots !== undefined && { capacitySlots: Number(capacitySlots) }),
        ...(status !== undefined && { status }),
        ...(active !== undefined && { active }),
        ...(mileageKm !== undefined && { mileageKm: mileageKm === null ? null : Number(mileageKm) }),
        ...(nextServiceDate !== undefined && { nextServiceDate: nextServiceDate ? toDateOnly(nextServiceDate) : null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(brand !== undefined && { brand: brand?.trim() || null }),
        ...(model !== undefined && { model: model?.trim() || null }),
        ...(year !== undefined && { year: year ? Number(year) : null }),
        ...(color !== undefined && { color: color?.trim() || null }),
        ...(chassisNumber !== undefined && { chassisNumber: chassisNumber?.trim() || null }),
        ...(engineNumber !== undefined && { engineNumber: engineNumber?.trim() || null }),
        ...(stnkNumber !== undefined && { stnkNumber: stnkNumber?.trim() || null }),
        ...(stnkExpiry !== undefined && { stnkExpiry: stnkExpiry ? toDateOnly(stnkExpiry) : null }),
        ...(taxExpiry !== undefined && { taxExpiry: taxExpiry ? toDateOnly(taxExpiry) : null }),
        ...(kirExpiry !== undefined && { kirExpiry: kirExpiry ? toDateOnly(kirExpiry) : null }),
        ...(insurancePolicy !== undefined && { insurancePolicy: insurancePolicy?.trim() || null }),
        ...(insuranceExpiry !== undefined && { insuranceExpiry: insuranceExpiry ? toDateOnly(insuranceExpiry) : null }),
        ...(picDriverId !== undefined && { picDriverId: picDriverId || null }),
      },
    });
    res.json(vehicle);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "Nomor polisi ini sudah terdaftar" });
    handleErr(err, res);
  }
});

// ═══ D-035: BIAYA, SERVIS, INSIDEN KENDARAAN ═══════════════════════════════
//
// PERMISSION: mencatat butuh ROUTE_WRITE (dispatcher/admin), membaca butuh
// JOB_READ. Driver SENGAJA belum bisa input sendiri di v1 — di lapangan
// supir menyerahkan struk fisik dan dispatcher yang memasukkan. Kolom
// `driverId` tetap merekam SIAPA yang memakai/mengeluarkan, terlepas dari
// siapa yang mengetik. Kalau nanti terbukti perlu supir input langsung di
// SPBU (kualitas data odometer lebih akurat), itu penambahan terpisah.

// GET /api/armada/expenses?vehicleId=&driverId=&from=&to=&category=
armadaRouter.get("/expenses", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { vehicleId, driverId, from, to, category } = req.query;
    const where = {
      ...(vehicleId && { vehicleId }),
      ...(driverId && { driverId }),
      ...(category && { category }),
      ...((from || to) && {
        date: { ...(from && { gte: toDateOnly(from) }), ...(to && { lte: toDateOnly(to) }) },
      }),
    };
    const rows = await prisma.vehicleExpense.findMany({
      where,
      include: {
        vehicle: { select: { id: true, plateNumber: true } },
        driver: { select: { id: true, name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    res.json(rows);
  } catch (err) { handleErr(err, res); }
});

armadaRouter.post("/expenses", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const { vehicleId, driverId, date, category, amount, odometerKm, liters, receiptUrl, notes, routeId } = req.body;
    if (!vehicleId) throw new ArmadaError("Kendaraan wajib dipilih");
    if (!date) throw new ArmadaError("Tanggal wajib diisi");
    if (!category) throw new ArmadaError("Kategori wajib dipilih");
    const nominal = Number(amount);
    if (!Number.isFinite(nominal) || nominal <= 0) throw new ArmadaError("Nominal harus angka lebih dari 0");
    // Liter cuma bermakna untuk BBM — menyimpannya di kategori lain bikin
    // hitungan km/liter di ringkasan jadi salah (lihat catatan schema.prisma).
    const litersNum = category === "BBM" && liters != null && liters !== "" ? Number(liters) : null;
    if (litersNum != null && (!Number.isFinite(litersNum) || litersNum <= 0)) {
      throw new ArmadaError("Jumlah liter harus angka lebih dari 0");
    }
    const odo = odometerKm != null && odometerKm !== "" ? Number(odometerKm) : null;
    if (odo != null && (!Number.isFinite(odo) || odo < 0)) throw new ArmadaError("Odometer harus angka");

    const row = await prisma.vehicleExpense.create({
      data: {
        vehicleId, driverId: driverId || null, date: toDateOnly(date), category,
        amount: Math.round(nominal), odometerKm: odo, liters: litersNum,
        receiptUrl: receiptUrl || null, notes: notes?.trim() || null,
        routeId: routeId || null, recordedById: req.user.id,
      },
      include: {
        vehicle: { select: { id: true, plateNumber: true } },
        driver: { select: { id: true, name: true } },
      },
    });
    // Odometer terbaru ikut memperbarui kilometer kendaraan — supaya angka km
    // di daftar armada tidak perlu diketik ulang terpisah dan tidak menyimpang
    // dari catatan pengisian BBM. Hanya kalau lebih besar (odometer tidak
    // pernah mundur; input yang lebih kecil berarti salah ketik atau backdate).
    if (odo != null) {
      await prisma.vehicle.updateMany({
        where: { id: vehicleId, OR: [{ mileageKm: null }, { mileageKm: { lt: odo } }] },
        data: { mileageKm: odo },
      });
    }
    res.status(201).json(row);
  } catch (err) { handleErr(err, res); }
});

armadaRouter.delete("/expenses/:id", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    await prisma.vehicleExpense.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { handleErr(err, res); }
});

// PATCH — koreksi catatan biaya (salah ketik nominal/kategori/odometer,
// dst) tanpa perlu hapus+buat ulang. TIDAK termasuk vehicleId/routeId —
// pindah kendaraan berarti catatan yang berbeda, bukan koreksi.
armadaRouter.patch("/expenses/:id", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const { date, category, amount, odometerKm, liters, driverId, receiptUrl, notes } = req.body;
    const data = {};
    if (date !== undefined) data.date = toDateOnly(date);
    if (category !== undefined) data.category = category;
    if (amount !== undefined) {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) throw new ArmadaError("Nominal harus angka lebih dari 0");
      data.amount = Math.round(n);
    }
    if (odometerKm !== undefined) data.odometerKm = odometerKm === null || odometerKm === "" ? null : Number(odometerKm);
    if (liters !== undefined) data.liters = liters === null || liters === "" ? null : Number(liters);
    if (driverId !== undefined) data.driverId = driverId || null;
    if (receiptUrl !== undefined) data.receiptUrl = receiptUrl || null;
    if (notes !== undefined) data.notes = notes?.trim() || null;

    const row = await prisma.vehicleExpense.update({
      where: { id: req.params.id },
      data,
      include: {
        vehicle: { select: { id: true, plateNumber: true } },
        driver: { select: { id: true, name: true } },
      },
    });
    // Odometer boleh dikoreksi TURUN (beda dari POST create yang cuma naik
    // otomatis) — di sini user secara eksplisit mengedit, jadi kepercayaan
    // ada di input manusia, bukan aturan "odometer tidak pernah mundur".
    res.json(row);
  } catch (err) { handleErr(err, res); }
});

// POST /api/armada/expenses/:id/receipt — upload foto struk untuk catatan
// biaya yang SUDAH ADA (alur: catat dulu nominalnya cepat, foto menyusul —
// atau sebaliknya, upload dulu baru catat, lihat POST /receipts/upload).
armadaRouter.post("/expenses/:id/receipt", requirePermission(P.ROUTE_WRITE), uploadReceipt.single("receipt"), async (req, res) => {
  try {
    if (!req.file) throw new ArmadaError("File foto wajib disertakan");
    const url = `/media/vehicle-receipts/${req.file.filename}`;
    const row = await prisma.vehicleExpense.update({
      where: { id: req.params.id }, data: { receiptUrl: url },
      include: { vehicle: { select: { id: true, plateNumber: true } }, driver: { select: { id: true, name: true } } },
    });
    res.json(row);
  } catch (err) { handleErr(err, res); }
});

// POST /api/armada/receipts/upload — upload BEBAS (belum tentu untuk
// expense yang sudah ada, dipakai form "Tambah" supaya foto bisa dipilih
// SEBELUM baris expense-nya disimpan — pengisian jadi satu langkah, bukan
// simpan-dulu-baru-upload). Balikin URL saja, disisipkan ke body POST
// /expenses / POST /services sebagai receiptUrl.
armadaRouter.post("/receipts/upload", requirePermission(P.ROUTE_WRITE), uploadReceipt.single("receipt"), async (req, res) => {
  try {
    if (!req.file) throw new ArmadaError("File foto wajib disertakan");
    res.json({ url: `/media/vehicle-receipts/${req.file.filename}` });
  } catch (err) { handleErr(err, res); }
});

// ─── SERVIS ────────────────────────────────────────────────────────────────
armadaRouter.get("/services", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { vehicleId, from, to } = req.query;
    const rows = await prisma.vehicleService.findMany({
      where: {
        ...(vehicleId && { vehicleId }),
        ...((from || to) && {
          date: { ...(from && { gte: toDateOnly(from) }), ...(to && { lte: toDateOnly(to) }) },
        }),
      },
      include: { vehicle: { select: { id: true, plateNumber: true } } },
      orderBy: [{ date: "desc" }],
      take: 500,
    });
    res.json(rows);
  } catch (err) { handleErr(err, res); }
});

armadaRouter.post("/services", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const { vehicleId, date, type, odometerKm, cost, workshop, description, receiptUrl, nextServiceKm, nextServiceDate } = req.body;
    if (!vehicleId) throw new ArmadaError("Kendaraan wajib dipilih");
    if (!date) throw new ArmadaError("Tanggal wajib diisi");
    if (!type) throw new ArmadaError("Jenis servis wajib dipilih");
    const odo = Number(odometerKm);
    // WAJIB (beda dari expense) — interval servis kendaraan niaga ditentukan
    // kilometer, bukan tanggal. Lihat catatan di schema.prisma.
    if (!Number.isFinite(odo) || odo < 0) throw new ArmadaError("Odometer wajib diisi (angka)");
    const biaya = Number(cost);
    if (!Number.isFinite(biaya) || biaya < 0) throw new ArmadaError("Biaya harus angka");

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.vehicleService.create({
        data: {
          vehicleId, date: toDateOnly(date), type, odometerKm: odo, cost: Math.round(biaya),
          workshop: workshop?.trim() || null, description: description?.trim() || null,
          receiptUrl: receiptUrl || null,
          nextServiceKm: nextServiceKm ? Number(nextServiceKm) : null,
          nextServiceDate: nextServiceDate ? toDateOnly(nextServiceDate) : null,
          recordedById: req.user.id,
        },
        include: { vehicle: { select: { id: true, plateNumber: true } } },
      });
      // Sinkronkan ke kolom lama Vehicle.nextServiceDate/mileageKm supaya
      // papan & alert yang sudah ada tetap benar tanpa perlu tahu tabel baru.
      await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          ...(created.nextServiceDate && { nextServiceDate: created.nextServiceDate }),
          mileageKm: odo,
        },
      });
      return created;
    });
    res.status(201).json(row);
  } catch (err) { handleErr(err, res); }
});

// PATCH — koreksi catatan servis (pola sama dengan PATCH /expenses/:id).
armadaRouter.patch("/services/:id", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const { date, type, odometerKm, cost, workshop, description, receiptUrl, nextServiceKm, nextServiceDate } = req.body;
    const data = {};
    if (date !== undefined) data.date = toDateOnly(date);
    if (type !== undefined) data.type = type;
    if (odometerKm !== undefined) {
      const n = Number(odometerKm);
      if (!Number.isFinite(n) || n < 0) throw new ArmadaError("Odometer harus angka");
      data.odometerKm = n;
    }
    if (cost !== undefined) {
      const n = Number(cost);
      if (!Number.isFinite(n) || n < 0) throw new ArmadaError("Biaya harus angka");
      data.cost = Math.round(n);
    }
    if (workshop !== undefined) data.workshop = workshop?.trim() || null;
    if (description !== undefined) data.description = description?.trim() || null;
    if (receiptUrl !== undefined) data.receiptUrl = receiptUrl || null;
    if (nextServiceKm !== undefined) data.nextServiceKm = nextServiceKm === null || nextServiceKm === "" ? null : Number(nextServiceKm);
    if (nextServiceDate !== undefined) data.nextServiceDate = nextServiceDate ? toDateOnly(nextServiceDate) : null;

    const row = await prisma.vehicleService.update({
      where: { id: req.params.id }, data,
      include: { vehicle: { select: { id: true, plateNumber: true } } },
    });
    res.json(row);
  } catch (err) { handleErr(err, res); }
});

// POST /api/armada/services/:id/receipt — upload foto nota servis, sama pola
// dengan POST /expenses/:id/receipt.
armadaRouter.post("/services/:id/receipt", requirePermission(P.ROUTE_WRITE), uploadReceipt.single("receipt"), async (req, res) => {
  try {
    if (!req.file) throw new ArmadaError("File foto wajib disertakan");
    const url = `/media/vehicle-receipts/${req.file.filename}`;
    const row = await prisma.vehicleService.update({
      where: { id: req.params.id }, data: { receiptUrl: url },
      include: { vehicle: { select: { id: true, plateNumber: true } } },
    });
    res.json(row);
  } catch (err) { handleErr(err, res); }
});

// ─── INSIDEN ───────────────────────────────────────────────────────────────
armadaRouter.get("/incidents", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { vehicleId, driverId, from, to } = req.query;
    const rows = await prisma.vehicleIncident.findMany({
      where: {
        ...(vehicleId && { vehicleId }),
        ...(driverId && { driverId }),
        ...((from || to) && {
          date: { ...(from && { gte: toDateOnly(from) }), ...(to && { lte: toDateOnly(to) }) },
        }),
      },
      include: {
        vehicle: { select: { id: true, plateNumber: true } },
        driver: { select: { id: true, name: true } },
      },
      orderBy: [{ date: "desc" }],
      take: 500,
    });
    res.json(rows);
  } catch (err) { handleErr(err, res); }
});

armadaRouter.post("/incidents", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const {
      vehicleId, driverId, date, type, severity, description, photoUrls,
      location, repairCost, faultParty, insuranceClaim, downtimeDays,
    } = req.body;
    if (!vehicleId) throw new ArmadaError("Kendaraan wajib dipilih");
    if (!date) throw new ArmadaError("Tanggal wajib diisi");
    if (!type) throw new ArmadaError("Jenis insiden wajib dipilih");
    if (!severity) throw new ArmadaError("Tingkat keparahan wajib dipilih");
    if (!description?.trim()) throw new ArmadaError("Kronologi wajib diisi");

    // Snapshot nama supir — catatan insiden harus tetap terbaca utuh walau
    // akun supirnya kelak dihapus (FK-nya SetNull, lihat schema.prisma).
    let driverName = null;
    if (driverId) {
      const d = await prisma.user.findUnique({ where: { id: driverId }, select: { name: true } });
      driverName = d?.name || null;
    }

    const row = await prisma.vehicleIncident.create({
      data: {
        vehicleId, driverId: driverId || null, driverName,
        date: toDateOnly(date), type, severity,
        description: description.trim(),
        photoUrls: Array.isArray(photoUrls) ? photoUrls : [],
        location: location?.trim() || null,
        repairCost: repairCost != null && repairCost !== "" ? Math.round(Number(repairCost)) : null,
        ...(faultParty && { faultParty }),
        ...(insuranceClaim && { insuranceClaim }),
        downtimeDays: downtimeDays != null && downtimeDays !== "" ? Number(downtimeDays) : null,
        recordedById: req.user.id,
      },
      include: {
        vehicle: { select: { id: true, plateNumber: true } },
        driver: { select: { id: true, name: true } },
      },
    });
    res.status(201).json(row);
  } catch (err) { handleErr(err, res); }
});

// PATCH — biaya perbaikan & status klaim sering baru diketahui belakangan.
armadaRouter.patch("/incidents/:id", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const { repairCost, faultParty, insuranceClaim, downtimeDays, resolvedAt, description, severity } = req.body;
    const row = await prisma.vehicleIncident.update({
      where: { id: req.params.id },
      data: {
        ...(repairCost !== undefined && { repairCost: repairCost === null || repairCost === "" ? null : Math.round(Number(repairCost)) }),
        ...(faultParty !== undefined && { faultParty }),
        ...(insuranceClaim !== undefined && { insuranceClaim }),
        ...(downtimeDays !== undefined && { downtimeDays: downtimeDays === null || downtimeDays === "" ? null : Number(downtimeDays) }),
        ...(resolvedAt !== undefined && { resolvedAt: resolvedAt ? toDateOnly(resolvedAt) : null }),
        ...(description !== undefined && { description: description.trim() }),
        ...(severity !== undefined && { severity }),
      },
      include: {
        vehicle: { select: { id: true, plateNumber: true } },
        driver: { select: { id: true, name: true } },
      },
    });
    res.json(row);
  } catch (err) { handleErr(err, res); }
});

// POST /api/armada/incidents/:id/photos — upload MULTI-foto (kejadian
// kecelakaan biasanya butuh beberapa sudut: kerusakan mobil, plat lawan,
// lokasi) — beda dari receipt tunggal expense/service. Menambahkan ke
// photoUrls yang sudah ada, bukan menimpa (foto boleh diupload bertahap).
armadaRouter.post("/incidents/:id/photos", requirePermission(P.ROUTE_WRITE), uploadReceipt.array("photos", 6), async (req, res) => {
  try {
    if (!req.files?.length) throw new ArmadaError("File foto wajib disertakan");
    const urls = req.files.map((f) => `/media/vehicle-receipts/${f.filename}`);
    const existing = await prisma.vehicleIncident.findUniqueOrThrow({ where: { id: req.params.id }, select: { photoUrls: true } });
    const row = await prisma.vehicleIncident.update({
      where: { id: req.params.id },
      data: { photoUrls: [...existing.photoUrls, ...urls] },
      include: { vehicle: { select: { id: true, plateNumber: true } }, driver: { select: { id: true, name: true } } },
    });
    res.json(row);
  } catch (err) { handleErr(err, res); }
});

// ─── RINGKASAN ARMADA (analitik) ───────────────────────────────────────────
// GET /api/armada/fleet-summary?from=&to=
//
// Menjawab "mobil/supir mana yang lebih hemat" — DENGAN PENYEBUT, bukan cuma
// total rupiah (lihat catatan panjang di schema.prisma#VehicleExpense).
//
// km/liter dihitung metode "tank-to-tank": (odometer tertinggi − terendah) ÷
// total liter dalam periode. Ini PENDEKATAN, bukan angka presisi lab:
// pengisian pertama di periode itu mengisi tangki yang sudah separuh terpakai
// dari periode sebelumnya. Karena itu butuh MINIMAL 2 pengisian ber-odometer
// untuk keluar angkanya — kalau kurang, dikembalikan null dan UI WAJIB
// menampilkan "belum cukup data", BUKAN 0 (yang terbaca sebagai "boros total").
armadaRouter.get("/fleet-summary", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateWhere = (from || to)
      ? { date: { ...(from && { gte: toDateOnly(from) }), ...(to && { lte: toDateOnly(to) }) } }
      : {};

    const [vehicles, expenses, services, incidents] = await Promise.all([
      prisma.vehicle.findMany({
        where: { active: true },
        select: {
          id: true, plateNumber: true, brand: true, model: true, status: true, mileageKm: true,
          stnkExpiry: true, taxExpiry: true, kirExpiry: true, insuranceExpiry: true,
          picDriver: { select: { id: true, name: true } },
        },
        orderBy: { plateNumber: "asc" },
      }),
      prisma.vehicleExpense.findMany({
        where: dateWhere,
        select: { vehicleId: true, driverId: true, category: true, amount: true, odometerKm: true, liters: true,
                  driver: { select: { id: true, name: true } } },
      }),
      prisma.vehicleService.findMany({ where: dateWhere, select: { vehicleId: true, cost: true } }),
      prisma.vehicleIncident.findMany({
        where: dateWhere,
        select: { vehicleId: true, driverId: true, repairCost: true, downtimeDays: true, faultParty: true,
                  driver: { select: { id: true, name: true } }, driverName: true },
      }),
    ]);

    // Hitung km/liter + Rp/km untuk satu kumpulan pengeluaran.
    function hitungEfisiensi(rows) {
      const bbm = rows.filter((e) => e.category === "BBM");
      const totalLiter = bbm.reduce((n, e) => n + (e.liters || 0), 0);
      const odos = bbm.map((e) => e.odometerKm).filter((o) => Number.isFinite(o));
      const cukupData = odos.length >= 2 && totalLiter > 0;
      const jarakKm = cukupData ? Math.max(...odos) - Math.min(...odos) : null;
      const biayaBbm = bbm.reduce((n, e) => n + e.amount, 0);
      return {
        totalLiter: totalLiter || null,
        jarakKm: jarakKm && jarakKm > 0 ? jarakKm : null,
        kmPerLiter: cukupData && jarakKm > 0 ? +(jarakKm / totalLiter).toFixed(2) : null,
        rupiahPerKm: cukupData && jarakKm > 0 ? Math.round(biayaBbm / jarakKm) : null,
        // Alasan angka di atas null — dipakai UI supaya bisa memberi tahu apa
        // yang kurang, bukan sekadar menampilkan strip tanpa penjelasan.
        alasanKosong: cukupData ? null
          : odos.length < 2 ? "Butuh minimal 2 pengisian BBM dengan odometer"
          : "Jumlah liter belum diisi",
      };
    }

    function totalPerKategori(rows) {
      const out = {};
      for (const e of rows) out[e.category] = (out[e.category] || 0) + e.amount;
      return out;
    }

    const perKendaraan = vehicles.map((v) => {
      const eRows = expenses.filter((e) => e.vehicleId === v.id);
      const sRows = services.filter((s) => s.vehicleId === v.id);
      const iRows = incidents.filter((i) => i.vehicleId === v.id);
      return {
        ...v,
        totalBiaya: eRows.reduce((n, e) => n + e.amount, 0),
        perKategori: totalPerKategori(eRows),
        efisiensi: hitungEfisiensi(eRows),
        biayaServis: sRows.reduce((n, s) => n + s.cost, 0),
        jumlahServis: sRows.length,
        jumlahInsiden: iRows.length,
        biayaPerbaikanInsiden: iRows.reduce((n, i) => n + (i.repairCost || 0), 0),
        hariTidakBisaJalan: iRows.reduce((n, i) => n + (i.downtimeDays || 0), 0),
      };
    });

    // Per supir — dikumpulkan dari pengeluaran & insiden yang punya driverId.
    const driverIds = [...new Set([
      ...expenses.map((e) => e.driverId),
      ...incidents.map((i) => i.driverId),
    ].filter(Boolean))];
    const perSupir = driverIds.map((id) => {
      const eRows = expenses.filter((e) => e.driverId === id);
      const iRows = incidents.filter((i) => i.driverId === id);
      const nama = eRows[0]?.driver?.name || iRows[0]?.driver?.name || iRows[0]?.driverName || "—";
      return {
        driverId: id,
        name: nama,
        totalBiaya: eRows.reduce((n, e) => n + e.amount, 0),
        perKategori: totalPerKategori(eRows),
        efisiensi: hitungEfisiensi(eRows),
        jumlahInsiden: iRows.length,
        // Dipisah dari jumlah total: "ditabrak orang" TIDAK sama dengan
        // "kurang hati-hati" (lihat enum FaultParty di schema.prisma).
        insidenSalahSendiri: iRows.filter((i) => i.faultParty === "DRIVER_KITA").length,
        biayaPerbaikanInsiden: iRows.reduce((n, i) => n + (i.repairCost || 0), 0),
      };
    }).sort((a, b) => b.totalBiaya - a.totalBiaya);

    res.json({ periode: { from: from || null, to: to || null }, perKendaraan, perSupir });
  } catch (err) { handleErr(err, res); }
});

// ─── RUTE (Route) — Delivery Tahap 3, Route Planner ─────────────────────────
//
// DUA KOLOM DRIVER YANG BERBEDA ARTI (lihat schema.prisma):
//   Route.driverId = RENCANA dispatcher, boleh berubah selama status DRAFT
//   Job.driverId   = PENUGASAN YANG BERLAKU, dibaca aplikasi driver
// Publish() adalah SATU-SATUNYA tempat nilai dari Route disalin ke Job-nya.
// Sebelum publish, mengubah driver/kendaraan rute TIDAK mengubah apa pun yang
// dilihat driver — itu justru gunanya "Save Draft" vs "Publish Route".

function generateRouteCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `RTE-${dd}${mm}${yy}`;
}

const routeInclude = {
  driver: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNumber: true, type: true, capacitySlots: true } },
  jobs: {
    include: jobInclude,
    orderBy: { sequence: "asc" },
  },
};

armadaRouter.get("/routes", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { date, status } = req.query;
    const routes = await prisma.route.findMany({
      where: {
        ...(date && { date: toDateOnly(date) }),
        ...(status && { status }),
      },
      include: routeInclude,
      orderBy: [{ date: "desc" }, { createdAt: "asc" }],
    });
    res.json({ routes });
  } catch (err) {
    handleErr(err, res);
  }
});

armadaRouter.get("/routes/:id", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({ where: { id: req.params.id }, include: routeInclude });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });
    res.json(route);
  } catch (err) {
    handleErr(err, res);
  }
});

armadaRouter.post("/routes", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const { date, driverId, vehicleId, notes } = req.body;
    if (!date) throw new ArmadaError("Tanggal wajib diisi");
    const targetDate = toDateOnly(date);

    // Kode rute berurut per tanggal: RTE-DDMMYY-01, -02, dst. Dihitung dari
    // jumlah rute yang SUDAH ADA di tanggal itu — cukup untuk volume rute
    // harian yang realistis, tidak butuh tabel counter terpisah seperti
    // OrderSequence (yang mengantisipasi ratusan order/hari).
    const existing = await prisma.route.count({ where: { date: targetDate } });
    const code = `${generateRouteCode(targetDate)}-${String(existing + 1).padStart(2, "0")}`;

    const route = await prisma.route.create({
      data: {
        code,
        date: targetDate,
        driverId: driverId || null,
        vehicleId: vehicleId || null,
        notes: notes?.trim() || null,
        createdById: req.user.id,
      },
      include: routeInclude,
    });
    res.status(201).json(route);
  } catch (err) {
    handleErr(err, res);
  }
});

armadaRouter.patch("/routes/:id", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({ where: { id: req.params.id } });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });
    if (route.status !== "DRAFT") {
      throw new ArmadaError("Rute yang sudah diterbitkan tidak bisa diedit langsung — batalkan lalu buat rute baru");
    }

    const { driverId, vehicleId, notes } = req.body;
    const updated = await prisma.route.update({
      where: { id: req.params.id },
      data: {
        ...(driverId !== undefined && { driverId: driverId || null }),
        ...(vehicleId !== undefined && { vehicleId: vehicleId || null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
      },
      include: routeInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /routes/:id/jobs { jobIds: [...] } — susun ULANG ANGGOTA rute dari
// nol setiap kali dipanggil (bukan tambah satu-satu). Ini pola yang SAMA
// dengan PATCH /route/reorder yang sudah ada — dispatcher drag-drop di UI,
// frontend mengirim urutan LENGKAP hasil akhirnya, bukan delta per langkah.
// Job yang TIDAK ada di jobIds baru tapi sebelumnya milik rute ini DILEPAS
// (routeId & sequence di-null-kan) — itu cara "keluarkan dari rute" di UI.
armadaRouter.patch("/routes/:id/jobs", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({ where: { id: req.params.id } });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });
    if (route.status !== "DRAFT") throw new ArmadaError("Rute yang sudah diterbitkan tidak bisa diubah anggotanya");

    const jobIds = Array.isArray(req.body.jobIds) ? req.body.jobIds : [];

    await prisma.$transaction(async (tx) => {
      // Lepas dulu job lama milik rute ini yang TIDAK ada di daftar baru.
      await tx.job.updateMany({
        where: { routeId: route.id, id: { notIn: jobIds } },
        data: { routeId: null, sequence: null },
      });
      // Lalu tempel + urutkan yang baru. Satu per satu (bukan updateMany)
      // karena tiap job butuh nilai `sequence` BERBEDA.
      for (let i = 0; i < jobIds.length; i++) {
        await tx.job.update({
          where: { id: jobIds[i] },
          data: { routeId: route.id, sequence: i + 1 },
        });
      }
    });

    const updated = await prisma.route.findUnique({ where: { id: route.id }, include: routeInclude });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /routes/:id/publish — DRAFT → PUBLISHED. Satu-satunya tempat rencana
// (Route.driverId/vehicleId) disalin jadi penugasan berlaku (Job.driverId/
// vehicleId) — sebelum ini driver TIDAK melihat job-job tsb di aplikasinya
// sama sekali, walau sudah tersusun rapi di rute.
armadaRouter.post("/routes/:id/publish", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({ where: { id: req.params.id }, include: { jobs: true } });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });
    if (route.status !== "DRAFT") throw new ArmadaError("Rute ini sudah diterbitkan");
    if (route.jobs.length === 0) throw new ArmadaError("Rute belum punya job — tambahkan job dulu sebelum menerbitkan");
    if (!route.driverId) throw new ArmadaError("Rute belum punya driver");

    // Estimasi jarak/durasi — best-effort, SAMA pola dengan GET /route/summary:
    // gagal geocode TIDAK BOLEH menggagalkan publish, cuma legsError terisi.
    let plannedDistanceKm = null, plannedDurationMin = null;
    const geocoded = route.jobs.filter((j) => j.lat != null && j.lng != null);
    if (geocoded.length === route.jobs.length && route.jobs.length >= 2) {
      try {
        const legs = await routeLegs(
          [...route.jobs].sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map((j) => ({ lat: j.lat, lng: j.lng }))
        );
        let meters = 0, seconds = 0;
        for (const leg of legs) { if (leg) { meters += leg.distanceMeters; seconds += leg.durationSeconds; } }
        plannedDistanceKm = meters > 0 ? Math.round((meters / 1000) * 100) / 100 : null;
        plannedDurationMin = seconds > 0 ? Math.round(seconds / 60) : null;
      } catch {
        // Diamkan — publish tetap lanjut tanpa estimasi jarak.
      }
    }

    const [updatedRoute] = await prisma.$transaction([
      prisma.route.update({
        where: { id: route.id },
        data: { status: "PUBLISHED", publishedAt: new Date(), plannedDistanceKm, plannedDurationMin },
        include: routeInclude,
      }),
      // Salin rencana → penugasan berlaku. deriveStatus: job yang sebelumnya
      // UNSCHEDULED (belum py tanggal/driver) naik ke ASSIGNED sekarang juga
      // punya driver+kendaraan; job yang sudah lebih maju (mis. sudah
      // dijadwalkan manual sebelum masuk rute) status-nya TIDAK dimundurkan.
      prisma.job.updateMany({
        where: { routeId: route.id },
        data: { driverId: route.driverId, vehicleId: route.vehicleId },
      }),
      prisma.job.updateMany({
        where: { routeId: route.id, status: "UNSCHEDULED" },
        data: { status: "ASSIGNED" },
      }),
    ]);

    res.json(updatedRoute);
  } catch (err) {
    handleErr(err, res);
  }
});

armadaRouter.patch("/routes/:id/cancel", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({ where: { id: req.params.id } });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });
    if (["COMPLETED", "CANCELLED"].includes(route.status)) {
      throw new ArmadaError(`Rute berstatus ${route.status} tidak bisa dibatalkan`);
    }
    // Job-nya SENGAJA TIDAK dilepas dari rute (routeId dibiarkan menunjuk ke
    // rute yang dibatalkan) — riwayat "rute ini pernah direncanakan lalu
    // dibatalkan" tetap terbaca. Dispatcher yang menyusun ulang secara manual
    // lewat rute baru, bukan sistem yang diam-diam melepaskannya.
    const updated = await prisma.route.update({
      where: { id: req.params.id }, data: { status: "CANCELLED" }, include: routeInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// HAPUS PERMANEN rute (D-059, 4 September 2026, DIPERLUAS D-061 hari yang
// sama) — laporan owner: rute DRAFT yang salah pilih/salah tanggal/dibuat
// coba-coba selama ini cuma bisa "Batalkan" (CANCELLED, tetap tersimpan
// selamanya sebagai riwayat) — papan Route Planner lama-lama penuh bangkai
// rute yang sebenarnya tidak pernah dipakai sama sekali dan tidak bermakna
// sebagai riwayat. D-061: owner mencoba Batalkan lalu MINTA rute yang
// SUDAH dibatalkan itu juga bisa dihapus — CANCELLED ditambahkan ke daftar
// yang boleh, konsisten dengan alasan yang sama (rute batal = tidak pernah
// benar-benar berjalan, tidak ada apa pun yang hilang kalau dihapus).
//
// TETAP menolak PUBLISHED/COMPLETED — begitu diterbitkan, itu sudah jadi
// komitmen nyata ke driver (dan mungkin sudah dikerjakan sebagian);
// menghapusnya akan membuang jejak yang harus tetap ada. Rute PUBLISHED
// yang mau dihapus HARUS dibatalkan dulu (jadi CANCELLED) — dua langkah
// sengaja, bukan longgar sekaligus.
//
// Job di dalamnya TIDAK ikut terhapus — Job.routeId onDelete:SetNull
// (schema.prisma) otomatis melepaskannya balik ke "Belum Masuk Rute" begitu
// baris Route-nya hilang, PERSIS seperti kalau dispatcher mengeluarkannya
// satu-satu sebelum menghapus rutenya sendiri.
armadaRouter.delete("/routes/:id", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: { expenses: { select: { id: true } } },
    });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });
    if (!["DRAFT", "CANCELLED"].includes(route.status)) {
      throw new ArmadaError(`Rute berstatus ${route.status} tidak bisa dihapus permanen — batalkan dulu, baru bisa dihapus`);
    }
    if (route.expenses.length > 0) {
      // Draft normal tidak akan pernah sampai sini (biaya kendaraan dicatat
      // setelah rute berjalan, bukan saat masih draft) — jaring pengaman
      // untuk kasus tepi (data lama/manual), bukan alur biasa.
      throw new ArmadaError("Rute ini sudah punya catatan biaya kendaraan — tidak bisa dihapus permanen, pakai \"Batalkan\"");
    }
    await prisma.route.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    handleErr(err, res);
  }
});

// ─── PROOF OF DELIVERY — Delivery Tahap 4 ───────────────────────────────────
//
// SISI VERIFIKASI, bukan sumber data baru. Foto & tanda tangan sudah diisi
// driver lewat POST /jobs/:id/complete (Phase 2) — endpoint di bawah cuma
// membaca job yang SUDAH punya bukti, dan mencatat hasil tinjauan admin.
//
// EMPAT status di UI, DUA di database — turunannya:
//   Belum Lengkap      → job belum COMPLETED, atau COMPLETED tanpa proofPhotoUrls
//   Menunggu Verifikasi → COMPLETED + ada foto, podStatus masih NULL
//   Terverifikasi        → podStatus = VERIFIED
//   Ditolak               → podStatus = REJECTED
// Dihitung DI SINI (backend), bukan diserahkan ke frontend menebak — supaya
// filter status di query string dan status yang ditampilkan selalu konsisten.
function derivePodStatus(job) {
  if (job.status !== "COMPLETED" || job.proofPhotoUrls.length === 0) return "INCOMPLETE";
  if (job.podStatus === "VERIFIED") return "VERIFIED";
  if (job.podStatus === "REJECTED") return "REJECTED";
  return "PENDING_REVIEW";
}

const PIC_INCLUDE_FOR_POD = {
  ...jobInclude,
  order: { select: { id: true, orderNumber: true, customer: { select: { id: true, name: true, phone: true } } } },
  podVerifiedBy: { select: { id: true, name: true } },
};

// ─── KENDALA & RESCHEDULE — Delivery Tahap 5 ────────────────────────────────
//
// ⚠️ CAKUPAN JUJUR: spesifikasi minta kolom Category, Priority, Reported By,
// Current Owner, dan tab Escalated/Resolved — TIDAK SATU PUN itu ada
// strukturnya di sistem (tidak ada ticketing/ownership terpisah dari job
// itu sendiri). Membangun dropdown kategori atau status eskalasi yang tidak
// pernah benar-benar ditentukan siapa pun sama dengan checklist POD yang
// tidak pernah dicentang siapa pun di Tahap 4 — jadi TIDAK dibangun.
//
// Yang NYATA dan dibangun: daftar job GAGAL (failureReason + failurePhotoUrls
// sudah wajib diisi driver sejak Phase 2), dan kemampuan BARU menjadwalkan
// ulangnya — itu satu-satunya bagian yang sebelumnya benar-benar buntu.
function deriveIssueStatus(job) {
  if (job.status === "FAILED") return job.rescheduleReason ? "RESCHEDULED" : "OPEN";
  // Job yang sudah lewat dari FAILED (SCHEDULED/ASSIGNED/dst setelah
  // di-reschedule) tapi PERNAH gagal — riwayatnya tetap relevan ditelusuri.
  if (job.rescheduleReason) return "RESCHEDULED";
  return null;
}

armadaRouter.get("/issues", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { status } = req.query; // OPEN | RESCHEDULED
    const jobs = await prisma.job.findMany({
      where: { OR: [{ status: "FAILED" }, { rescheduleReason: { not: null } }] },
      include: {
        ...jobInclude,
        order: { select: { id: true, orderNumber: true, customer: { select: { id: true, name: true, phone: true } } } },
        rescheduledBy: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
    });
    const withDerived = jobs.map((j) => ({ ...j, issueStatus: deriveIssueStatus(j) }));
    const filtered = status ? withDerived.filter((j) => j.issueStatus === status) : withDerived;
    res.json({ jobs: filtered });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /issues/:jobId/reschedule — satu-satunya jalan keluar dari status
// FAILED. Menetapkan tanggal/driver/kendaraan baru dan MENYALAKAN JOB
// KEMBALI (deriveStatus) — dipakai fungsi yang SAMA dengan PATCH /jobs/:id
// biasa, supaya job yang dijadwalkan ulang masuk alur normal (start/arrive/
// complete) tanpa perlu mengubah guard status di endpoint lain.
armadaRouter.post("/issues/:jobId/reschedule", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.jobId } });
    if (!job) return res.status(404).json({ error: "Job tidak ditemukan" });
    if (job.status !== "FAILED") throw new ArmadaError("Hanya job berstatus Gagal yang bisa dijadwalkan ulang lewat sini");

    const { scheduledDate, timeWindow, driverId, helperId, vehicleId, reason, customerConfirmed } = req.body;
    if (!scheduledDate) throw new ArmadaError("Tanggal baru wajib diisi");
    if (!reason?.trim()) throw new ArmadaError("Alasan reschedule wajib diisi");

    const nextDate = toDateOnly(scheduledDate);
    const nextDriverId = driverId || null;

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        scheduledDate: nextDate,
        timeWindow: timeWindow || null,
        driverId: nextDriverId,
        helperId: helperId || null,
        vehicleId: vehicleId || null,
        status: deriveStatus(!!nextDriverId, !!nextDate),
        rescheduleReason: reason.trim(),
        rescheduledById: req.user.id,
        rescheduledAt: new Date(),
        customerConfirmedReschedule: !!customerConfirmed,
      },
      include: jobInclude,
    });
    res.json({ ...updated, issueStatus: deriveIssueStatus(updated) });
  } catch (err) {
    handleErr(err, res);
  }
});

armadaRouter.get("/pod", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { status } = req.query; // INCOMPLETE | PENDING_REVIEW | VERIFIED | REJECTED
    // Basis query: hanya job yang PERNAH menyelesaikan kunjungan (COMPLETED)
    // ATAU sedang berjalan tapi relevan dipantau — spesifikasi tab "Semua"
    // termasuk "Belum Lengkap", jadi basisnya tidak dibatasi ke COMPLETED
    // saja. Batasnya: job yang statusnya UNSCHEDULED murni (belum berangkat
    // sama sekali) tidak relevan untuk halaman bukti serah terima.
    const jobs = await prisma.job.findMany({
      where: { status: { notIn: ["UNSCHEDULED"] } },
      include: PIC_INCLUDE_FOR_POD,
      orderBy: [{ completedAt: "desc" }, { scheduledDate: "desc" }],
      take: 300,
    });
    const withDerived = jobs.map((j) => ({ ...j, derivedPodStatus: derivePodStatus(j) }));
    const filtered = status ? withDerived.filter((j) => j.derivedPodStatus === status) : withDerived;
    res.json({ jobs: filtered });
  } catch (err) {
    handleErr(err, res);
  }
});

armadaRouter.patch("/pod/:jobId/verify", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.jobId } });
    if (!job) return res.status(404).json({ error: "Job tidak ditemukan" });
    if (job.status !== "COMPLETED") throw new ArmadaError("Job belum selesai — belum ada bukti untuk diverifikasi");
    if (job.proofPhotoUrls.length === 0) throw new ArmadaError("Job ini belum punya foto bukti");

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        podStatus: "VERIFIED",
        podVerifiedById: req.user.id,
        podVerifiedAt: new Date(),
        podRejectionNote: null, // verifikasi baru membersihkan catatan penolakan lama
      },
      include: PIC_INCLUDE_FOR_POD,
    });
    res.json({ ...updated, derivedPodStatus: derivePodStatus(updated) });
  } catch (err) {
    handleErr(err, res);
  }
});

armadaRouter.patch("/pod/:jobId/reject", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const { note } = req.body;
    if (!note?.trim()) throw new ArmadaError("Alasan penolakan wajib diisi — driver perlu tahu apa yang harus diperbaiki");

    const job = await prisma.job.findUnique({ where: { id: req.params.jobId } });
    if (!job) return res.status(404).json({ error: "Job tidak ditemukan" });
    if (job.status !== "COMPLETED") throw new ArmadaError("Job belum selesai — belum ada bukti untuk ditinjau");

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { podStatus: "REJECTED", podVerifiedById: req.user.id, podVerifiedAt: new Date(), podRejectionNote: note.trim() },
      include: PIC_INCLUDE_FOR_POD,
    });
    res.json({ ...updated, derivedPodStatus: derivePodStatus(updated) });
  } catch (err) {
    handleErr(err, res);
  }
});

armadaRouter.get("/board", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { date, type } = req.query;
    if (!["PICKUP", "DELIVERY"].includes(type)) {
      return res.status(400).json({ error: "type wajib PICKUP atau DELIVERY" });
    }
    const targetDate = toDateOnly(date);

    // Job UNSCHEDULED (scheduledDate null) SELALU ikut tampil di tanggal
    // manapun yang sedang dilihat dispatcher — 24 Agustus 2026, bagian dari
    // jembatan otomatis Sales->Delivery (services/armadaAutoJob.js). Tanpa
    // OR ini, job yang auto-dibuat begitu sales input order (belum
    // dijadwalkan) TIDAK PERNAH terlihat sama sekali: query lama cuma
    // mencocokkan scheduledDate PERSIS tanggal yang dipilih (yang defaultnya
    // selalu hari ini di frontend), jadi job tanpa tanggal jatuh ke celah
    // yang tidak pernah ke-query — regresi dari "unit tampil di daftar
    // available" (yang sudah tidak lagi berlaku begitu unit itu dapat job).
    const jobs = await prisma.job.findMany({
      where: {
        type,
        ...(targetDate ? { OR: [{ scheduledDate: targetDate }, { scheduledDate: null }] } : { scheduledDate: null }),
      },
      include: jobInclude,
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
    });

    // Unit yang SUDAH terikat job aktif tipe ini — dikecualikan dari "available".
    const alreadyBookedUnitIds = (
      await prisma.jobUnit.findMany({
        where: { job: { type, status: { in: ACTIVE_JOB_STATUSES } } },
        select: { unitId: true },
      })
    ).map((ju) => ju.unitId);

    const eligibleStatus = type === "PICKUP" ? ["AWAITING_PICKUP"] : ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"];
    const available = await prisma.unit.findMany({
      where: {
        status: { in: eligibleStatus },
        id: { notIn: alreadyBookedUnitIds },
        order: { status: { in: ELIGIBLE_ORDER_STATUS[type] } },
      },
      include: {
        order: { select: { id: true, orderNumber: true, customer: { select: { id: true, name: true, phone: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({ date: date || null, type, jobs, available });
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/armada/route/reorder { driverId, date, type, jobIds: [...] }
// FR-L-03: dispatcher urutkan stop SATU driver, SATU tanggal, SATU tipe
// secara manual — bukan VRP otomatis (PRD §1.5 melarangnya untuk v1).
// jobIds HARUS mencakup persis semua job aktif di grup itu (tidak kurang,
// tidak lebih) — mencegah drag-drop parsial yang diam-diam menghapus urutan
// job lain yang lupa disertakan klien.
armadaRouter.patch("/route/reorder", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const { driverId, date, type, jobIds } = req.body;
    if (!driverId) throw new ArmadaError("driverId wajib diisi");
    if (!date) throw new ArmadaError("date wajib diisi");
    if (!["PICKUP", "DELIVERY"].includes(type)) throw new ArmadaError("type wajib PICKUP atau DELIVERY");
    if (!Array.isArray(jobIds) || jobIds.length === 0) throw new ArmadaError("jobIds wajib diisi");

    const group = await prisma.job.findMany({
      where: { driverId, type, scheduledDate: toDateOnly(date), status: { in: ACTIVE_JOB_STATUSES } },
      select: { id: true },
    });
    const groupIds = new Set(group.map((j) => j.id));
    const requestIds = new Set(jobIds);
    if (groupIds.size !== requestIds.size || [...groupIds].some((id) => !requestIds.has(id))) {
      throw new ArmadaError("jobIds harus mencakup persis semua job aktif driver ini di tanggal itu");
    }

    await prisma.$transaction(
      jobIds.map((id, index) => prisma.job.update({ where: { id }, data: { sequence: index } }))
    );
    res.json({ ok: true });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/armada/route/summary?driverId=&date=&type= — jarak/durasi antar
// stop berurutan (FR-L-03). Rute HARUS sudah diurutkan (sequence bukan null)
// sebelum dipanggil — kalau belum, kembalikan stops apa adanya tanpa legs
// (bukan urutan createdAt yang tidak berarti sebagai rute).
armadaRouter.get("/route/summary", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { driverId, date, type } = req.query;
    if (!driverId) throw new ArmadaError("driverId wajib diisi");
    if (!date) throw new ArmadaError("date wajib diisi");
    if (!["PICKUP", "DELIVERY"].includes(type)) throw new ArmadaError("type wajib PICKUP atau DELIVERY");

    const jobs = await prisma.job.findMany({
      where: { driverId, type, scheduledDate: toDateOnly(date), status: { in: ACTIVE_JOB_STATUSES } },
      include: jobInclude,
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
    });

    const geocoded = jobs.filter((j) => j.lat != null && j.lng != null);
    let legs = [];
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    let legsError = null;
    if (geocoded.length === jobs.length && jobs.length >= 2) {
      try {
        legs = await routeLegs(jobs.map((j) => ({ lat: j.lat, lng: j.lng })));
        for (const leg of legs) {
          if (leg) { totalDistanceMeters += leg.distanceMeters; totalDurationSeconds += leg.durationSeconds; }
        }
      } catch (err) {
        legsError = err.message;
      }
    } else if (jobs.length >= 2) {
      legsError = "Ada stop yang belum punya koordinat (geocode gagal atau alamat kosong) — jarak tidak bisa dihitung";
    }

    res.json({ jobs, legs, totalDistanceMeters, totalDurationSeconds, legsError });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/armada/my-jobs?date=YYYY-MM-DD — driver sendiri, hari ini ±1
// (PRD §9.3: "drivers read only jobs assigned to them, dated today ±1").
armadaRouter.get("/my-jobs", requirePermission(P.JOB_OWN_READ), async (req, res) => {
  try {
    const centerDateStr = req.query.date || new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const centerDate = toDateOnly(centerDateStr);
    const from = new Date(centerDate); from.setUTCDate(from.getUTCDate() - 1);
    const to = new Date(centerDate); to.setUTCDate(to.getUTCDate() + 2); // +1 hari, eksklusif

    // D-037 (31 Agustus 2026) — helper melihat job yang sama dengan driver
    // TERPISAH: OR driverId/helperId, bukan cuma driverId. Helper accompany
    // driver di lapangan, wajar kalau dia juga mau lihat "Job Saya" hari itu.
    const jobs = await prisma.job.findMany({
      where: {
        OR: [{ driverId: req.user.id }, { helperId: req.user.id }],
        scheduledDate: { gte: from, lt: to },
      },
      include: jobInclude,
      orderBy: [{ scheduledDate: "asc" }, { sequence: "asc" }, { createdAt: "asc" }],
    });
    res.json({ jobs });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/armada/jobs/:id
//
// BUG DITEMUKAN 31 Agustus 2026 (laporan owner: admin/dispatcher dapat
// "Anda tidak punya akses untuk aksi ini" saat buka Detail Job dari
// Jadwal & Penugasan). Sebelumnya gerbang di sini cuma requirePermission
// (P.JOB_OWN_READ) — ADMIN/DISPATCHER TIDAK PERNAH memegang JOB_OWN_READ
// (lihat ROLE_PERMISSIONS di constants/permissions.js, itu permission
// KHUSUS driver/helper), jadi mereka ditolak di gerbang TERLUAR sebelum
// sempat sampai ke pengecekan kepemilikan job di bawah — pengecekan itu
// jadi mati, tidak pernah tercapai untuk siapa pun kecuali driver/helper.
// requireAnyPermission meloloskan siapa saja yang punya JOB_READ (dispatcher/
// admin, lihat langsung SEMUA job) ATAU JOB_OWN_READ (driver/helper, masih
// disaring lebih lanjut oleh `milikSaya` di bawah).
armadaRouter.get("/jobs/:id", requireAnyPermission(P.JOB_READ, P.JOB_OWN_READ), async (req, res) => {
  try {
    const job = await prisma.job.findUniqueOrThrow({ where: { id: req.params.id }, include: jobInclude });
    // Driver/helper TANPA JOB_READ penuh hanya boleh lihat job miliknya
    // sendiri (D-037: driver ATAU helper). Dispatcher/admin (punya
    // JOB_READ) lolos tanpa cek ini.
    const milikSaya = job.driverId === req.user.id || job.helperId === req.user.id;
    if (!hasPermission(req.user, P.JOB_READ) && !milikSaya) {
      return res.status(403).json({ error: "Bukan job Anda" });
    }
    res.json(job);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs { type, unitIds, scheduledDate?, driverId?, helperId?, vehicleId?, timeWindow?, addressText? }
armadaRouter.post("/jobs", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const { type, unitIds, scheduledDate, driverId, helperId, vehicleId, timeWindow, addressText, accessNotes } = req.body;
    if (!["PICKUP", "DELIVERY"].includes(type)) throw new ArmadaError("type wajib PICKUP atau DELIVERY");
    if (!Array.isArray(unitIds) || unitIds.length === 0) throw new ArmadaError("Pilih minimal 1 unit");

    const units = await prisma.unit.findMany({
      where: { id: { in: unitIds } },
      include: { order: { select: { status: true } } },
    });
    if (units.length !== unitIds.length) throw new ArmadaError("Ada unit yang tidak ditemukan");

    // PRD §5.2: satu job pickup/delivery hanya boleh membawa unit dari SATU
    // order (batching hotel DI DALAM satu order tetap boleh — D-006 — tapi
    // MENCAMPUR unit dari order berbeda ke satu job tidak).
    const orderIds = new Set(units.map((u) => u.orderId));
    if (orderIds.size > 1) throw new ArmadaError("Semua unit dalam satu job harus dari order yang sama");

    const expectedStatus = type === "PICKUP" ? ["AWAITING_PICKUP"] : ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"];
    const wrongStatus = units.find((u) => !expectedStatus.includes(u.status));
    if (wrongStatus) {
      throw new ArmadaError(
        `Unit ${wrongStatus.unitCode} berstatus ${wrongStatus.status}, tidak bisa dijadwalkan untuk ${type === "PICKUP" ? "pengambilan" : "pengiriman"}`
      );
    }
    // Validasi server-side, BUKAN cuma filter tampilan GET /board — kalau
    // cuma disaring di daftar "available", unitId tetap bisa dikirim
    // langsung lewat API dan lolos (lihat catatan ELIGIBLE_ORDER_STATUS).
    const wrongOrderStatus = units.find((u) => !ELIGIBLE_ORDER_STATUS[type].includes(u.order.status));
    if (wrongOrderStatus) {
      throw new ArmadaError(
        `Unit ${wrongOrderStatus.unitCode} order-nya berstatus ${wrongOrderStatus.order.status}, tidak bisa dijadwalkan untuk ${type === "PICKUP" ? "pengambilan" : "pengiriman"}`
      );
    }

    if (vehicleId) {
      const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
      if (!vehicle || !vehicle.active) throw new ArmadaError("Kendaraan tidak ditemukan atau tidak aktif");
    }

    const geo = addressText ? await bestEffortGeocode(addressText) : null;

    const job = await prisma.job.create({
      data: {
        type,
        orderId: [...orderIds][0],
        scheduledDate: toDateOnly(scheduledDate),
        driverId: driverId || null,
        helperId: helperId || null,
        vehicleId: vehicleId || null,
        timeWindow: timeWindow || null,
        addressText: addressText || null,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        accessNotes: accessNotes || null,
        status: deriveStatus(!!driverId, !!scheduledDate),
        units: { create: unitIds.map((unitId) => ({ unitId })) },
      },
      include: jobInclude,
    });

    // Trigger "Pickup dijadwalkan" DIHAPUS 31 Agustus 2026 (keputusan
    // owner) — digantikan notifyDriverEnRoute di POST /jobs/:id/start,
    // supaya tetap PERSIS 4 notifikasi (lihat customerNotifications.js).
    // Notifikasi lama ini sering terkirim jauh-jauh hari sebelum
    // pengambilan sungguhan, kurang actionable dibanding "driver sudah
    // di jalan sekarang".

    res.status(201).json(job);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/armada/jobs/:id — reschedule/reassign. HANYA untuk job yang
// belum berjalan (edit job yang sudah EN_ROUTE/COMPLETED lewat sini akan
// membingungkan driver yang mungkin sedang di jalan).
armadaRouter.patch("/jobs/:id", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const existing = await prisma.job.findUniqueOrThrow({ where: { id: req.params.id } });
    if (!["UNSCHEDULED", "SCHEDULED", "ASSIGNED"].includes(existing.status)) {
      throw new ArmadaError(`Job berstatus ${existing.status} tidak bisa diubah lagi lewat sini`);
    }
    const { scheduledDate, driverId, helperId, vehicleId, timeWindow, addressText, accessNotes, estimatedDurationMinutes } = req.body;
    const data = {};
    if (scheduledDate !== undefined) data.scheduledDate = toDateOnly(scheduledDate);
    if (driverId !== undefined) data.driverId = driverId || null;
    if (helperId !== undefined) data.helperId = helperId || null;
    if (vehicleId !== undefined) {
      if (vehicleId) {
        const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
        if (!vehicle || !vehicle.active) throw new ArmadaError("Kendaraan tidak ditemukan atau tidak aktif");
      }
      data.vehicleId = vehicleId || null;
    }
    if (timeWindow !== undefined) data.timeWindow = timeWindow;
    if (accessNotes !== undefined) data.accessNotes = accessNotes;
    // Estimasi durasi pengerjaan (D-043) — menit bulat, null = belum diisi.
    if (estimatedDurationMinutes !== undefined) {
      data.estimatedDurationMinutes = estimatedDurationMinutes === null || estimatedDurationMinutes === ""
        ? null
        : Math.max(0, Math.round(Number(estimatedDurationMinutes)) || 0) || null;
    }
    // Re-geocode HANYA kalau alamat teksnya benar-benar berubah — supaya
    // PATCH lain (ganti driver, reschedule) tidak boros kuota Geocoding API
    // untuk alamat yang sama persis.
    if (addressText !== undefined && addressText !== existing.addressText) {
      data.addressText = addressText;
      const geo = addressText ? await bestEffortGeocode(addressText) : null;
      data.lat = geo?.lat ?? null;
      data.lng = geo?.lng ?? null;
    }

    const nextDriverId = driverId !== undefined ? driverId : existing.driverId;
    const nextDate = scheduledDate !== undefined ? data.scheduledDate : existing.scheduledDate;
    data.status = deriveStatus(!!nextDriverId, !!nextDate);

    const job = await prisma.job.update({ where: { id: req.params.id }, data, include: jobInclude });
    res.json(job);
  } catch (err) {
    handleErr(err, res);
  }
});

// DELETE /api/armada/jobs/:id — hanya job yang belum berjalan (salah pilih
// unit itu wajar; job aktif TIDAK boleh dihapus, cukup ditandai FAILED).
armadaRouter.delete("/jobs/:id", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const existing = await prisma.job.findUniqueOrThrow({ where: { id: req.params.id } });
    if (!["UNSCHEDULED", "SCHEDULED", "ASSIGNED"].includes(existing.status)) {
      throw new ArmadaError(`Job berstatus ${existing.status} tidak bisa dihapus — tandai FAILED kalau batal`);
    }
    await prisma.job.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    handleErr(err, res);
  }
});

// Guard bersama untuk endpoint driver (start/arrive/complete/fail/photos):
// job harus milik driver ATAU helper yang login (D-037, 31 Agustus 2026 —
// keduanya sama-sama di lapangan, siapa pun yang pegang HP saat itu boleh
// menekan tombolnya), KECUALI user punya JOB_WRITE penuh (dispatcher/admin
// boleh operasikan atas nama driver/helper kalau perlu).
//
// BUG DITEMUKAN 31 Agustus 2026 — sebelum ini, gerbang requirePermission di
// SEMUA endpoint di bawah cuma minta JOB_OWN_WRITE, padahal ADMIN/DISPATCHER
// TIDAK PERNAH memegang JOB_OWN_WRITE (permission itu khusus driver/helper).
// Niat komentar di atas ("dispatcher/admin boleh operasikan atas nama
// driver") jadi tidak pernah tercapai — mereka ditolak di gerbang terluar
// sebelum sampai ke pengecekan `milikSaya` di sini. Sekarang requireAny
// Permission(JOB_WRITE, JOB_OWN_WRITE) di tiap route meloloskan keduanya,
// dan fungsi ini tetap jadi lapis penyaring baris untuk yang cuma
// JOB_OWN_WRITE.
async function loadOwnedJob(req) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: req.params.id } });
  const milikSaya = job.driverId === req.user.id || job.helperId === req.user.id;
  if (!hasPermission(req.user, P.JOB_WRITE) && !milikSaya) {
    throw new ArmadaError("Bukan job Anda", 403);
  }
  return job;
}

// POST /api/armada/jobs/:id/photos — upload multipart, kembalikan URL.
armadaRouter.post("/jobs/:id/photos", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), upload.array("photos", 6), async (req, res) => {
  try {
    await loadOwnedJob(req);
    const urls = (req.files || []).map((f) => `/media/job-photos/${f.filename}`);
    res.json({ urls });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs/:id/positions — driver kirim ping GPS (D-034).
//
// BATCH, bukan satu titik: HP driver di lapangan sering offline, jadi ping
// diantre lokal (pola sama dengan syncQueue.js/submitJobAction.js yang sudah
// dipakai foto bukti) lalu dikirim SEKALIGUS begitu sinyal kembali. Endpoint
// tunggal-titik akan memaksa mobile melakukan N request berurutan untuk
// mengosongkan antrean — mahal dan gampang gagal separuh jalan.
//
// SENGAJA TIDAK membatasi status job (EN_ROUTE saja) di sini — kalau job
// sudah ARRIVED/COMPLETED saat ping yang diantre lama akhirnya terkirim,
// pingnya tetap tercatat (riwayat rute yang jujur), cuma dispatcher tidak
// akan menganggapnya "posisi sekarang" (lihat GET /jobs/:id/positions/latest
// yang membaca status job juga).
armadaRouter.post("/jobs/:id/positions", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), async (req, res) => {
  try {
    await loadOwnedJob(req);
    const pings = Array.isArray(req.body.pings) ? req.body.pings : [req.body];
    const valid = pings.filter((p) =>
      Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180 && p.recordedAt
    );
    if (valid.length === 0) throw new ArmadaError("Tidak ada ping valid (lat/lng/recordedAt wajib)");

    await prisma.jobPositionPing.createMany({
      data: valid.map((p) => ({
        jobId: req.params.id,
        driverId: req.user.id,
        lat: p.lat,
        lng: p.lng,
        accuracy: Number.isFinite(p.accuracy) ? p.accuracy : null,
        recordedAt: new Date(p.recordedAt),
      })),
    });
    res.status(201).json({ diterima: valid.length, ditolak: pings.length - valid.length });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/armada/tracking — posisi TERAKHIR tiap job yang SEDANG EN_ROUTE,
// untuk papan Live Tracking dispatcher (D-034, menggantikan trackingMock.js).
// DISTINCT ON per job — bukan JOIN biasa, karena yang dibutuhkan cuma 1 baris
// (ping terbaru) per job, bukan seluruh riwayat.
//
// TIDAK ADA filter tanggal "hari ini" — status EN_ROUTE itu sendiri SUDAH
// berarti "job ini sedang berlangsung sekarang" (cuma dicapai lewat
// POST .../start, yang cuma masuk akal driver panggil di hari job-nya).
// Menambah filter `scheduledDate >= new Date()` di sini justru berisiko kena
// bug kelas yang dilarang CLAUDE.md §11: container jalan UTC, `new Date()`
// tanpa lewat utils/wib.js bisa menghitung "hari ini" mundur/maju 7 jam dari
// yang dimaksud WIB.
armadaRouter.get("/tracking", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const jobs = await prisma.job.findMany({
      where: { status: "EN_ROUTE" },
      include: {
        driver: { select: { id: true, name: true } },
        // lat/lng SUDAH ADA di select default (bukan lewat include) —
        // dipetakan eksplisit sbg destinationLat/Lng di bawah. Fase 2
        // (30 Agustus 2026): kolom ini sekarang bisa terisi dari fallback
        // Nominatim juga (lihat services/maps.js), bukan cuma Google, jadi
        // pin tujuan di peta Live Tracking punya kans jauh lebih besar
        // untuk terisi hari ini.
        order: { select: { orderNumber: true, customer: { select: { name: true } } } },
      },
    });
    if (jobs.length === 0) return res.json([]);

    // job_id di job_position_pings bertipe uuid — tanpa cast ::uuid[] di
    // sini, driver Postgres node-postgres mengirim array param sebagai
    // text[] dan query gagal total ("operator does not exist: uuid = text",
    // ditemukan 23 Agustus 2026 saat tes end-to-end job pickup nyata:
    // endpoint ini 500 setiap kali dipanggil, papan Live Tracking mati).
    const latest = await prisma.$queryRaw`
      SELECT DISTINCT ON (job_id) job_id, lat, lng, accuracy, recorded_at
      FROM job_position_pings
      WHERE job_id = ANY(${jobs.map((j) => j.id)}::uuid[])
      ORDER BY job_id, recorded_at DESC
    `;
    const byJob = new Map(latest.map((p) => [p.job_id, p]));

    res.json(jobs.map((j) => {
      const p = byJob.get(j.id);
      return {
        jobId: j.id, type: j.type, addressText: j.addressText,
        destinationLat: j.lat, destinationLng: j.lng,
        driverName: j.driver?.name || null,
        orderNumber: j.order?.orderNumber || null,
        customerName: j.order?.customer?.name || null,
        lastPosition: p ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy, recordedAt: p.recorded_at } : null,
      };
    }));
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs/:id/start — driver mulai perjalanan.
armadaRouter.post("/jobs/:id/start", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), async (req, res) => {
  try {
    const job = await loadOwnedJob(req);
    if (job.status !== "ASSIGNED") throw new ArmadaError(`Job berstatus ${job.status}, tidak bisa dimulai`);

    await prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id: job.id }, data: { status: "EN_ROUTE" } });
      // DELIVERY EN_ROUTE = driver SUDAH membawa kasur dari bengkel — unit
      // resmi "dalam perjalanan keluar". PICKUP EN_ROUTE tidak mengubah
      // status unit (kasur masih di rumah customer, belum dipegang driver).
      if (job.type === "DELIVERY") {
        const jobUnits = await tx.jobUnit.findMany({ where: { jobId: job.id } });
        await tx.unit.updateMany({
          where: { id: { in: jobUnits.map((ju) => ju.unitId) } },
          data: { status: "IN_TRANSIT_OUT" },
        });
        await syncOrderStatusForUnits(tx, jobUnits.map((ju) => ju.unitId));
      }
    });
    const full = await prisma.job.findUnique({ where: { id: job.id }, include: jobInclude });

    // FR-N trigger 1/4: "Driver menuju lokasi" — GANTI "Pickup dijadwalkan"
    // (31 Agustus 2026, keputusan owner) supaya tetap PERSIS 4 notifikasi.
    // Berlaku utk PICKUP MAUPUN DELIVERY (lama cuma PICKUP) — customer tahu
    // PERSIS kapan harus siap-siap, bukan cuma "suatu hari nanti".
    const customer = full.units[0]?.unit?.order?.customer;
    if (customer) notifyDriverEnRoute(full, customer.id, customer.name);

    res.json(full);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs/:id/arrive — driver tiba di lokasi.
armadaRouter.post("/jobs/:id/arrive", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), async (req, res) => {
  try {
    const job = await loadOwnedJob(req);
    if (job.status !== "EN_ROUTE") throw new ArmadaError(`Job berstatus ${job.status}, belum bisa ditandai tiba`);
    const updated = await prisma.job.update({
      where: { id: job.id }, data: { status: "ARRIVED", arrivedAt: new Date() }, include: jobInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs/:id/complete { proofPhotoUrls, signatureUrl?, note? }
// FR-D-03/FR-D-04: foto kondisi (pickup) / penempatan (delivery) — WAJIB.
// signatureUrl OPSIONAL (lihat catatan di schema.prisma) — lapisan tambahan,
// bukan syarat blocking.
armadaRouter.post("/jobs/:id/complete", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), async (req, res) => {
  try {
    const job = await loadOwnedJob(req);
    if (!["ARRIVED", "EN_ROUTE"].includes(job.status)) {
      throw new ArmadaError(`Job berstatus ${job.status}, belum bisa diselesaikan`);
    }
    const proofPhotoUrls = Array.isArray(req.body.proofPhotoUrls) ? req.body.proofPhotoUrls : [];
    if (proofPhotoUrls.length === 0) throw new ArmadaError("Foto bukti wajib diisi sebelum menyelesaikan job");
    const isValidUrl = (u) => typeof u === "string" && u.startsWith("/media/job-photos/");
    if (!proofPhotoUrls.every(isValidUrl)) throw new ArmadaError("URL foto tidak valid");
    const { signatureUrl } = req.body;
    if (signatureUrl != null && !isValidUrl(signatureUrl)) throw new ArmadaError("URL tanda tangan tidak valid");

    const updated = await prisma.$transaction(async (tx) => {
      const j = await tx.job.update({
        where: { id: job.id },
        data: { status: "COMPLETED", completedAt: new Date(), proofPhotoUrls, signatureUrl: signatureUrl || null },
      });
      const jobUnits = await tx.jobUnit.findMany({ where: { jobId: job.id } });
      // Lihat catatan simplifikasi di kepala file: PICKUP selesai langsung ke
      // RECEIVED (bukan IN_TRANSIT_IN dulu) — belum ada fitur scan intake
      // gudang yang akan mengonsumsi status antara itu.
      await tx.unit.updateMany({
        where: { id: { in: jobUnits.map((ju) => ju.unitId) } },
        data: { status: job.type === "PICKUP" ? "RECEIVED" : "DELIVERED" },
      });
      await syncOrderStatusForUnits(tx, jobUnits.map((ju) => ju.unitId));
      return j;
    });
    const full = await prisma.job.findUnique({ where: { id: updated.id }, include: jobInclude });

    // Best-effort, TIDAK PERNAH menggagalkan response job yang sudah beres —
    // lihat komentar notifyDriverGroup di atas.
    const headline = job.type === "PICKUP" ? "✅ Pengambilan selesai" : "✅ Pengiriman selesai";
    notifyDriverGroup(full, proofPhotoUrls, headline).catch((err) =>
      console.error("[jobs/:id/complete] notifyDriverGroup gagal:", err.message)
    );

    // FR-N trigger 2 & 4/4: "Unit sampai bengkel" (PICKUP) / "Terkirim"
    // (DELIVERY) — ke CUSTOMER, beda dari notifyDriverGroup di atas yang
    // ke grup ops internal.
    const customer = full.units[0]?.unit?.order?.customer;
    const orderNumber = full.units[0]?.unit?.order?.orderNumber;
    if (customer) {
      if (job.type === "PICKUP") notifyUnitReceived(orderNumber, customer.id, customer.name);
      else notifyDelivered(orderNumber, customer.id, customer.name);
    }

    res.json(full);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs/:id/fail { failureReason, failurePhotoUrls, note? }
// FR-D-07: "every failure requires a reason code and a photo. No exceptions."
armadaRouter.post("/jobs/:id/fail", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), async (req, res) => {
  try {
    const job = await loadOwnedJob(req);
    if (["COMPLETED", "FAILED"].includes(job.status)) {
      throw new ArmadaError(`Job berstatus ${job.status}, tidak bisa ditandai gagal lagi`);
    }
    const { failureReason } = req.body;
    const failurePhotoUrls = Array.isArray(req.body.failurePhotoUrls) ? req.body.failurePhotoUrls : [];
    if (!failureReason) throw new ArmadaError("Alasan kegagalan wajib diisi");
    if (failurePhotoUrls.length === 0) throw new ArmadaError("Foto wajib diisi saat menandai gagal (FR-D-07, tanpa kecuali)");
    const isValidUrl = (u) => typeof u === "string" && u.startsWith("/media/job-photos/");
    if (!failurePhotoUrls.every(isValidUrl)) throw new ArmadaError("URL foto tidak valid");

    const updated = await prisma.$transaction(async (tx) => {
      const j = await tx.job.update({
        where: { id: job.id },
        data: { status: "FAILED", failureReason, failurePhotoUrls },
      });
      // DELIVERY yang gagal: unit masih fisik di tangan driver (IN_TRANSIT_OUT
      // di-set saat /start), tapi percobaan kirim ini GAGAL — kembalikan ke
      // READY_FOR_DELIVERY supaya muncul lagi di "available" dan dispatcher
      // bisa membuat job baru. TANPA ini unit terjebak permanen di
      // IN_TRANSIT_OUT, tidak pernah bisa dijadwalkan ulang.
      //
      // PICKUP yang gagal TIDAK perlu ini — status unit tidak pernah berubah
      // dari AWAITING_PICKUP sejak awal (lihat /start), jadi sudah otomatis
      // muncul lagi di available begitu job ini bukan lagi "aktif".
      if (job.type === "DELIVERY") {
        const jobUnits = await tx.jobUnit.findMany({ where: { jobId: job.id } });
        await tx.unit.updateMany({
          where: { id: { in: jobUnits.map((ju) => ju.unitId) }, status: "IN_TRANSIT_OUT" },
          data: { status: "READY_FOR_DELIVERY" },
        });
        await syncOrderStatusForUnits(tx, jobUnits.map((ju) => ju.unitId));
      }
      return j;
    });
    const full = await prisma.job.findUnique({ where: { id: updated.id }, include: jobInclude });

    notifyDriverGroup(full, failurePhotoUrls, `❌ Gagal: ${failureReason}`).catch((err) =>
      console.error("[jobs/:id/fail] notifyDriverGroup gagal:", err.message)
    );

    res.json(full);
  } catch (err) {
    handleErr(err, res);
  }
});

// ── Pembayaran tunai (D-011) ────────────────────────────────────────────
// payments APPEND-ONLY (lihat catatan di schema.prisma) — endpoint ini
// hanya pernah INSERT, tidak pernah UPDATE baris Payment. "Sudah
// diverifikasi?" dibaca dari ADA-TIDAKNYA baris PaymentVerification.

const paymentInclude = {
  recordedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  verifications: { include: { verifiedBy: { select: { id: true, name: true } } } },
  order: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } },
  job: { select: { id: true, type: true } },
};

// POST /api/armada/jobs/:id/payment { amount, method, proofPhotoUrl? }
// Sengaja HANYA untuk job DELIVERY — D-011 lahir dari kasus nyata "customer
// bayar cash ke driver [saat kirim]", bukan saat ambil.
armadaRouter.post("/jobs/:id/payment", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), async (req, res) => {
  try {
    const job = await loadOwnedJob(req);
    if (job.type !== "DELIVERY") {
      throw new ArmadaError("Pembayaran hanya dicatat di job pengiriman");
    }
    const { amount, method, proofPhotoUrl } = req.body;
    const amountInt = Number(amount);
    if (!Number.isInteger(amountInt) || amountInt <= 0) {
      throw new ArmadaError("Jumlah pembayaran wajib angka bulat lebih dari 0");
    }
    if (!["CASH", "TRANSFER", "QRIS"].includes(method)) {
      throw new ArmadaError("Metode pembayaran tidak valid");
    }
    if (proofPhotoUrl != null && !String(proofPhotoUrl).startsWith("/media/job-photos/")) {
      throw new ArmadaError("URL foto bukti tidak valid");
    }

    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          orderId: job.orderId, jobId: job.id, amount: amountInt, method,
          proofPhotoUrl: proofPhotoUrl || null,
          recordedById: req.user.id,
        },
      });
      await recomputeOrderPaymentStatus(tx, job.orderId);
      return p;
    });
    res.status(201).json(await prisma.payment.findUnique({ where: { id: payment.id }, include: paymentInclude }));
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/armada/payments?driverId=&date=&orderId= — rekonsiliasi finance
// DAN riwayat pembayaran satu order (dipakai Orders.jsx). date difilter
// berdasarkan HARI WIB (utils/wib.js), bukan UTC polos — lihat aturan
// tanggal/timezone di CLAUDE.md root §11.
armadaRouter.get("/payments", requirePermission(P.PAYMENT_READ), async (req, res) => {
  try {
    const { driverId, date, orderId } = req.query;
    const where = {};
    if (driverId) where.recordedById = driverId;
    if (orderId) where.orderId = orderId;
    if (date) {
      where.createdAt = { gte: startOfDayWIB(date), lt: endOfDayExclusiveWIB(date) };
    }
    const payments = await prisma.payment.findMany({
      where, include: paymentInclude, orderBy: { createdAt: "desc" },
    });
    res.json(payments);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/payments/:id/verify — finance menandai payment ini
// sudah dicocokkan dengan uang yang benar-benar diterima. INSERT baris
// baru, bukan update — kalau sudah pernah diverifikasi, unique constraint
// menolak (satu payment cuma sekali verifikasi).
armadaRouter.post("/payments/:id/verify", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    await prisma.paymentVerification.create({
      data: { paymentId: req.params.id, verifiedById: req.user.id },
    });
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id }, include: paymentInclude });
    res.json(payment);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "Pembayaran ini sudah diverifikasi" });
    if (err.code === "P2003") return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
    handleErr(err, res);
  }
});

// ─── REVISI (Delivery Tahap 6, "Retur" di menu) ─────────────────────────────
//
// Lihat catatan panjang di schema.prisma di atas model UnitRevision untuk
// kenapa ini BUKAN refund/replace/reject: kasur dibawa kembali, direvisi,
// diantar ulang — diulang sampai customer puas, atau sampai klaim garansi
// selesai ditangani. jobId cuma pointer ke Job pickup/delivery yang dibuat
// dispatcher SEPERTI BIASA lewat Jadwal & Penugasan — tidak ada mesin
// dispatch baru di sini.

const unitRevisionInclude = {
  unit: {
    select: {
      id: true, unitCode: true, merk: true, ukuran: true,
      order: { select: { id: true, orderNumber: true, customer: { select: { id: true, name: true, phone: true } } } },
    },
  },
  job: { select: { id: true, type: true, status: true, scheduledDate: true, driver: { select: { id: true, name: true } } } },
  createdBy: { select: { id: true, name: true } },
};

// GET /api/armada/revisions?status=&trigger=
armadaRouter.get("/revisions", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { status, trigger } = req.query;
    const revisions = await prisma.unitRevision.findMany({
      where: { ...(status && { status }), ...(trigger && { trigger }) },
      include: unitRevisionInclude,
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    res.json({ revisions });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/armada/revisions/units?q= — cari unit yang SUDAH terkirim, untuk
// pemilih di form pengajuan revisi. Hanya status DELIVERED — mengajukan
// revisi atas kasur yang belum sampai ke customer tidak masuk akal.
armadaRouter.get("/revisions/units", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (q.length < 2) return res.json({ units: [] });
    const units = await prisma.unit.findMany({
      where: {
        status: "DELIVERED",
        OR: [
          { unitCode: { contains: q, mode: "insensitive" } },
          { order: { orderNumber: { contains: q, mode: "insensitive" } } },
          { order: { customer: { name: { contains: q, mode: "insensitive" } } } },
        ],
      },
      select: {
        id: true, unitCode: true, merk: true, ukuran: true,
        order: { select: { orderNumber: true, customer: { select: { name: true } } } },
      },
      take: 20,
    });
    res.json({ units });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/revisions — ajukan revisi baru untuk sebuah unit.
armadaRouter.post("/revisions", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const { unitId, trigger, complaint } = req.body;
    if (!unitId) throw new ArmadaError("Unit wajib dipilih");
    if (!["KENYAMANAN", "GARANSI"].includes(trigger)) throw new ArmadaError("Jenis revisi tidak valid");
    if (!complaint?.trim()) throw new ArmadaError("Keluhan/alasan wajib diisi");

    const unit = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan" });
    if (unit.status !== "DELIVERED") throw new ArmadaError("Hanya unit yang sudah terkirim yang bisa diajukan revisi");

    const revision = await prisma.unitRevision.create({
      data: { unitId, trigger, complaint: complaint.trim(), createdById: req.user.id },
      include: unitRevisionInclude,
    });
    res.status(201).json(revision);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/armada/revisions/:id — perbarui status/job/catatan. CONFIRMED
// otomatis mengisi confirmedAt; CANCELLED wajib catatan alasan.
armadaRouter.patch("/revisions/:id", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const existing = await prisma.unitRevision.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Revisi tidak ditemukan" });

    const { status, jobId, note } = req.body;
    const data = {};
    if (jobId !== undefined) data.jobId = jobId || null;
    if (note !== undefined) data.note = note || null;
    if (status) {
      const VALID = ["REQUESTED", "PICKUP_SCHEDULED", "IN_REWORK", "READY_REDELIVER", "REDELIVERED", "CONFIRMED", "CANCELLED"];
      if (!VALID.includes(status)) throw new ArmadaError("Status tidak valid");
      if (status === "CANCELLED" && !note?.trim() && !existing.note?.trim()) {
        throw new ArmadaError("Alasan pembatalan wajib diisi");
      }
      data.status = status;
      data.confirmedAt = status === "CONFIRMED" ? new Date() : existing.confirmedAt;
    }

    const revision = await prisma.unitRevision.update({
      where: { id: req.params.id },
      data,
      include: unitRevisionInclude,
    });
    res.json(revision);
  } catch (err) {
    handleErr(err, res);
  }
});

// ─── LAPORAN DELIVERY (Tahap 7) ─────────────────────────────────────────────
//
// `scheduledDate`/`Route.date` adalah kolom `@db.Date` (kalender murni, tanpa
// jam) — BEDA dengan `createdAt` di analytics.js yang timestamp. Karena tidak
// ada komponen jam, tidak ada ambiguitas zona waktu untuk kolom ini: "2026-08-02"
// tersimpan sebagai tanggal itu sendiri, bukan sebuah instant yang bisa
// bergeser hari tergantung zona container. Helper WIB di utils/wib.js SENGAJA
// tidak dipakai di sini karena masalah yang diselesaikannya (instant UTC vs
// kalender WIB) tidak berlaku untuk kolom tanpa komponen jam.
//
// ⚠️ KONTEKS PENTING: saat endpoint ini ditulis, tabel jobs MASIH KOSONG di
// production (0 baris, sama seperti saat Vehicle/Route dibangun Tahap 3).
// Setiap chart/tabel di halaman ini akan tampil kosong sampai dispatcher
// benar-benar memakai modul Delivery — itu BUKAN bug, itu keadaan sebenarnya.
armadaRouter.get("/reports/summary", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateWhere = from && to ? { scheduledDate: { gte: toDateOnly(from), lt: new Date(toDateOnly(to).getTime() + 86_400_000) } } : {};
    const routeDateWhere = from && to ? { date: { gte: toDateOnly(from), lt: new Date(toDateOnly(to).getTime() + 86_400_000) } } : {};

    const [byStatus, byType, jobsForPod, routeByStatus, vehicleByStatus, driverGroups] = await Promise.all([
      prisma.job.groupBy({ by: ["status"], where: dateWhere, _count: { _all: true } }),
      prisma.job.groupBy({ by: ["type"], where: dateWhere, _count: { _all: true } }),
      prisma.job.findMany({ where: { ...dateWhere, status: "COMPLETED" }, select: { status: true, podStatus: true, proofPhotoUrls: true } }),
      prisma.route.groupBy({ by: ["status"], where: routeDateWhere, _count: { _all: true } }),
      prisma.vehicle.groupBy({ by: ["status"], _count: { _all: true } }), // status ARMADA SEKARANG, sengaja tidak dibatasi rentang tanggal
      prisma.job.groupBy({ by: ["driverId"], where: { ...dateWhere, status: "COMPLETED", driverId: { not: null } }, _count: { _all: true } }),
    ]);

    const podCounts = { INCOMPLETE: 0, PENDING_REVIEW: 0, VERIFIED: 0, REJECTED: 0 };
    jobsForPod.forEach((j) => { podCounts[derivePodStatus(j)]++; });

    const driverIds = driverGroups.map((g) => g.driverId);
    const drivers = driverIds.length
      ? await prisma.user.findMany({ where: { id: { in: driverIds } }, select: { id: true, name: true } })
      : [];
    const driverName = Object.fromEntries(drivers.map((d) => [d.id, d.name]));
    const driverProductivity = driverGroups
      .map((g) => ({ driverId: g.driverId, name: driverName[g.driverId] || "—", completed: g._count._all }))
      .sort((a, b) => b.completed - a.completed);

    res.json({
      range: { from: from || null, to: to || null },
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
      byType: byType.map((r) => ({ type: r.type, count: r._count._all })),
      pod: podCounts,
      byRouteStatus: routeByStatus.map((r) => ({ status: r.status, count: r._count._all })),
      byVehicleStatus: vehicleByStatus.map((r) => ({ status: r.status, count: r._count._all })),
      driverProductivity,
    });
  } catch (err) {
    handleErr(err, res);
  }
});
