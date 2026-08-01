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
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../utils/wib.js";
import { sendMedia } from "../services/wahaClient.js";
import { sendWithSessionFallback, resolveSendTarget } from "./conversations.js";
import { buildMessagePreview } from "../utils/messagePreview.js";
import { emitNewMessage, emitConversationUpdate } from "../socket.js";
import { notifyPickupScheduled, notifyUnitReceived, notifyDelivered } from "../services/customerNotifications.js";
import { recomputeOrderPaymentStatus } from "../services/paymentLedger.js";
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

// Job dianggap "aktif" (masih akan dikerjakan) — dipakai untuk menyaring
// unit yang SUDAH punya job tipe ini supaya tidak double-booking. FAILED dan
// RESCHEDULED SENGAJA TIDAK termasuk aktif — unit itu harus muncul lagi di
// daftar "available" supaya dispatcher bisa membuat job baru.
const ACTIVE_JOB_STATUSES = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];

const jobInclude = {
  driver: { select: { id: true, name: true } },
  payments: {
    select: { id: true, amount: true, method: true, createdAt: true, verifications: { select: { id: true } } },
  },
  units: {
    include: {
      unit: {
        include: {
          order: { select: { id: true, orderNumber: true, customer: { select: { id: true, name: true, phone: true } } } },
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

// GET /api/armada/board?date=YYYY-MM-DD&type=PICKUP|DELIVERY
armadaRouter.get("/board", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { date, type } = req.query;
    if (!["PICKUP", "DELIVERY"].includes(type)) {
      return res.status(400).json({ error: "type wajib PICKUP atau DELIVERY" });
    }
    const targetDate = toDateOnly(date);

    const jobs = await prisma.job.findMany({
      where: { type, ...(targetDate ? { scheduledDate: targetDate } : { scheduledDate: null }) },
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
      where: { status: { in: eligibleStatus }, id: { notIn: alreadyBookedUnitIds } },
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

    const jobs = await prisma.job.findMany({
      where: { driverId: req.user.id, scheduledDate: { gte: from, lt: to } },
      include: jobInclude,
      orderBy: [{ scheduledDate: "asc" }, { sequence: "asc" }, { createdAt: "asc" }],
    });
    res.json({ jobs });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/armada/jobs/:id
armadaRouter.get("/jobs/:id", requirePermission(P.JOB_OWN_READ), async (req, res) => {
  try {
    const job = await prisma.job.findUniqueOrThrow({ where: { id: req.params.id }, include: jobInclude });
    // Driver TANPA JOB_WRITE penuh hanya boleh lihat job miliknya sendiri.
    // Dispatcher/admin (punya JOB_READ) lolos tanpa cek ini.
    if (!hasPermission(req.user, P.JOB_READ) && job.driverId !== req.user.id) {
      return res.status(403).json({ error: "Bukan job Anda" });
    }
    res.json(job);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs { type, unitIds, scheduledDate?, driverId?, timeWindow?, addressText? }
armadaRouter.post("/jobs", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const { type, unitIds, scheduledDate, driverId, timeWindow, addressText, accessNotes } = req.body;
    if (!["PICKUP", "DELIVERY"].includes(type)) throw new ArmadaError("type wajib PICKUP atau DELIVERY");
    if (!Array.isArray(unitIds) || unitIds.length === 0) throw new ArmadaError("Pilih minimal 1 unit");

    const units = await prisma.unit.findMany({ where: { id: { in: unitIds } } });
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

    const geo = addressText ? await bestEffortGeocode(addressText) : null;

    const job = await prisma.job.create({
      data: {
        type,
        orderId: [...orderIds][0],
        scheduledDate: toDateOnly(scheduledDate),
        driverId: driverId || null,
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

    // FR-N trigger 1/4: "Pickup scheduled" — HANYA saat dibuat LANGSUNG
    // dengan tanggal (bukan diulang tiap PATCH reschedule, supaya dispatcher
    // bebas menyesuaikan jadwal tanpa memicu notifikasi berkali-kali — lihat
    // catatan di customerNotifications.js).
    if (job.type === "PICKUP" && job.scheduledDate) {
      const customer = job.units[0]?.unit?.order?.customer;
      if (customer) notifyPickupScheduled(job, customer.id, customer.name);
    }

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
    const { scheduledDate, driverId, timeWindow, addressText, accessNotes } = req.body;
    const data = {};
    if (scheduledDate !== undefined) data.scheduledDate = toDateOnly(scheduledDate);
    if (driverId !== undefined) data.driverId = driverId || null;
    if (timeWindow !== undefined) data.timeWindow = timeWindow;
    if (accessNotes !== undefined) data.accessNotes = accessNotes;
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
// job harus milik driver yang login, KECUALI user punya JOB_WRITE penuh
// (dispatcher/admin boleh operasikan atas nama driver kalau perlu).
async function loadOwnedJob(req) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: req.params.id } });
  if (!hasPermission(req.user, P.JOB_WRITE) && job.driverId !== req.user.id) {
    throw new ArmadaError("Bukan job Anda", 403);
  }
  return job;
}

// POST /api/armada/jobs/:id/photos — upload multipart, kembalikan URL.
armadaRouter.post("/jobs/:id/photos", requirePermission(P.JOB_OWN_WRITE), upload.array("photos", 6), async (req, res) => {
  try {
    await loadOwnedJob(req);
    const urls = (req.files || []).map((f) => `/media/job-photos/${f.filename}`);
    res.json({ urls });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs/:id/start — driver mulai perjalanan.
armadaRouter.post("/jobs/:id/start", requirePermission(P.JOB_OWN_WRITE), async (req, res) => {
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
      }
    });
    res.json(await prisma.job.findUnique({ where: { id: job.id }, include: jobInclude }));
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs/:id/arrive — driver tiba di lokasi.
armadaRouter.post("/jobs/:id/arrive", requirePermission(P.JOB_OWN_WRITE), async (req, res) => {
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
armadaRouter.post("/jobs/:id/complete", requirePermission(P.JOB_OWN_WRITE), async (req, res) => {
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
armadaRouter.post("/jobs/:id/fail", requirePermission(P.JOB_OWN_WRITE), async (req, res) => {
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
  verifications: { include: { verifiedBy: { select: { id: true, name: true } } } },
  order: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } },
  job: { select: { id: true, type: true } },
};

// POST /api/armada/jobs/:id/payment { amount, method, proofPhotoUrl? }
// Sengaja HANYA untuk job DELIVERY — D-011 lahir dari kasus nyata "customer
// bayar cash ke driver [saat kirim]", bukan saat ambil.
armadaRouter.post("/jobs/:id/payment", requirePermission(P.JOB_OWN_WRITE), async (req, res) => {
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
