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
import { requirePermission, requireAnyPermission, hasPermission, rolesOf, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { startOfDayWIB, endOfDayExclusiveWIB, WIB_TZ } from "../utils/wib.js";
import { sendMedia, sendText } from "../services/wahaClient.js";
import { sendWithSessionFallback, resolveSendTarget } from "./conversations.js";
import { buildMessagePreview } from "../utils/messagePreview.js";
import { emitNewMessage, emitConversationUpdate } from "../socket.js";
import { notifyDriverEnRoute, notifyUnitReceived, notifyDelivered, sendCustomerText } from "../services/customerNotifications.js";
import { notifyDriverJobAssigned, notifyDriverRouteChanged, notifyProductionRevisionReady, notifySalesJobFailed, notifySalesJobRescheduled, notifyComplaintCaseOwnerChanged } from "../services/pushNotifications.js";
import {
  openOrAdvanceCase, closeCaseOnJobComplete, cancelCase, RescheduleCaseError,
  RESCHEDULE_STATUS_LABEL, rescheduleCaseInclude,
} from "../services/rescheduleCase.js";
import { notifySalesJobCompleted, notifySalesUnpaidAfterDelivery } from "../services/deliveryCompletionNotify.js";
import { traceRoute } from "../services/routeTracking.js";
import { recomputeOrderPaymentStatus } from "../services/paymentLedger.js";
import { syncOrderStatusForUnits, syncRouteCompletionStatus } from "../services/orderStatusSync.js";
import { ACTIVE_JOB_STATUSES, ELIGIBLE_ORDER_STATUS, STALE_UNSCHEDULED_JOB } from "../services/jobStatus.js";
import { geocodeAddress, routeLegs, DEPOT, buildRouteMapsUrl } from "../services/maps.js";
import { buildRouteSheetImage } from "../services/routeSheetImage.js";
import { produkLineLabel, parseOrderNotesForInvoice } from "../services/invoice.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

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
// Gambar tabel rute (6 September 2026) — dir & static route sudah dibuat di
// index.js (mkdirSync + app.use("/media/route-sheets", ...)); jalur di sini
// cuma perlu MENUNJUK ke folder yang sama untuk fs.writeFileSync-nya
// notifyNatashaImage (lihat definisi function di bawah).
const routeSheetsDir = path.join(__dirname, "../../data/route-sheets");
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

// ⛔ NONAKTIF SEMENTARA (6 September 2026, keputusan owner) — "lagi test
// sistem ya... nice, tapi untuk sekarang stop dulu broadcast ke grupnya,
// kita matangkan dulu sistem saat ini". Owner sendiri yang baru tes fitur
// ini (foto POD otomatis ke grup WA driver) dan MINTA DIPAUSE — bukan
// ditemukan rusak, sengaja dimatikan sampai owner minta nyalakan lagi.
// Pola SAMA PERSIS dengan DELIVERY_NOTIF_AKTIF di services/
// customerNotifications.js (kill-switch satu baris, JANGAN tulis ulang
// fungsinya) — TIDAK ada hubungannya dengan ringkasan rute publish/edit,
// itu TIDAK diminta dipause (lihat notifyNatashaText di bawah — target
// ringkasan rute sekarang chat pribadi Natasha, bukan grup, sejak 6
// September 2026).
const POD_BROADCAST_AKTIF = false;

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
  if (!POD_BROADCAST_AKTIF) return; // diam total — lihat catatan flag di atas
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
      const { result: wahaMsg, session } = await sendWithSessionFallback(group, (s) =>
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
      // externalId (6 September 2026) — TANPA ini, webhook echo fromMe:true
      // tidak bisa mencocokkan baris ini, jadi bikin baris Message KEDUA
      // untuk pengiriman yang SAMA (bug nyata ditemukan+diperbaiki di
      // notifyNatashaText/notifyNatashaImage, lihat catatan lengkap di sana).
      const msg = await prisma.message.create({
        data: {
          conversationId: group.id, direction: "OUTBOUND", content: caption, mediaType: "image", mediaUrl: photoUrls[i],
          externalId: wahaMsg?.id || wahaMsg?._data?.id?._serialized || null,
        },
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

// "RABU, 2 SEPTEMBER" — dipakai header pesan rute ke grup driver di bawah.
// TIDAK reuse formatWIB() (utils/wib.js): fungsi itu SELALU menempel jam +
// akhiran "WIB" (dirancang untuk stempel waktu kejadian), sementara ini
// murni label HARI kalender rute, tanpa jam. WIB_TZ tetap diimpor dari sana
// supaya zona waktunya satu sumber kebenaran, bukan string "Asia/Jakarta"
// disalin ulang.
function hariTanggalWIB(date) {
  return new Date(date).toLocaleString("id-ID", { timeZone: WIB_TZ, weekday: "long", day: "numeric", month: "long" }).toUpperCase();
}

// Kirim TEKS (bukan foto) ke grup driver — Pola SAMA PERSIS dengan
// notifyDriverGroup() di atas (cari grup, resolveSendTarget,
// sendWithSessionFallback, simpan Message, emit socket) — cuma sendText
// menggantikan sendMedia karena tidak ada foto di sini. BEST-EFFORT: dipanggil
// dibungkus try/catch oleh pemanggil.
//
// ⚠️ SAAT INI TIDAK DIPAKAI (6 September 2026) — ringkasan rute
// publish/edit yang dulu dikirim lewat fungsi ini SEKARANG dikirim lewat
// notifyNatashaText (chat pribadi Natasha, laporan owner: "kirim personal
// chat ke natasha... jangan ke grup drivethru", lalu "samakan ke Natasha"
// untuk update juga). SENGAJA TIDAK DIHAPUS — target ini sempat bolak-balik
// beberapa kali dalam satu sesi (grup -> Natasha -> ["gaperlu tinyurl" dst]),
// dibiarkan di sini supaya gampang dibalik lagi tanpa menulis ulang kalau
// owner minta balik ke grup lagi.
async function notifyDriverGroupText(message) {
  const group = await prisma.conversation.findFirst({ where: { type: "GROUP", isDriverGroup: true } });
  if (!group) return;

  const target = resolveSendTarget(group);
  if (!target) return;

  const { result: wahaMsg, session } = await sendWithSessionFallback(group, (s) => sendText(target, message, null, s));
  group.sessionId = session;

  // externalId — lihat catatan bug duplikat baris Message di
  // notifyNatashaText (fungsi aktif yang menggantikan ini sekarang).
  const msg = await prisma.message.create({
    data: { conversationId: group.id, direction: "OUTBOUND", content: message, externalId: wahaMsg?.id || wahaMsg?._data?.id?._serialized || null },
  });
  const updatedGroup = await prisma.conversation.update({
    where: { id: group.id },
    data: { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(message, null) },
  });
  emitNewMessage(group.id, msg);
  emitConversationUpdate(updatedGroup);
}

// ⚠️ SEMENTARA (6 September 2026, keputusan owner: "untuk saat ini ketika
// terbitkan rute coba kirim personal chat ke natasha +62 878-8874-7922
// jangan ke grup drivethru") — ringkasan rute saat PUBLISH (bukan edit
// darurat — itu tetap ke grup driver, tidak diminta diubah) dikirim ke chat
// PRIBADI Natasha, BUKAN ke grup driver, untuk sementara waktu ("untuk saat
// ini" menandakan ini bisa berubah lagi kapan pun). Nomor di-hardcode
// konstanta (bukan field konfigurasi/Setting baru) supaya gampang diubah
// balik ke grup atau ke nomor lain — sudah ada Customer+Conversation
// INDIVIDUAL tercatat untuk nomor ini (diverifikasi di database), jadi
// dipakai langsung, bukan bikin kontak baru.
const NATASHA_PHONE = "6287888747922";

// Dipakai notifyNatashaText DAN notifyNatashaImage — SATU tempat mencari
// percakapan, bukan duplikasi query yang sama 2x.
async function getNatashaConversation() {
  return prisma.conversation.findFirst({
    where: { type: "INDIVIDUAL", customer: { phone: NATASHA_PHONE } },
    include: { customer: true },
  });
}

async function notifyNatashaText(message) {
  const conversation = await getNatashaConversation();
  if (!conversation) return; // belum ada percakapan tercatat — diam-diam, bukan error

  const target = resolveSendTarget(conversation);
  if (!target) return;

  const { result: wahaMsg, session } = await sendWithSessionFallback(conversation, (s) => sendText(target, message, null, s));
  conversation.sessionId = session;

  // BUG NYATA ditemukan+diperbaiki 6 September 2026 (laporan owner: "kirim
  // ulang, ini broadcastnya banyak banget" — diverifikasi lewat 1 panggilan
  // API TERKONTROL: SATU klik ternyata memang cuma 1 pengiriman WhatsApp
  // sungguhan, TAPI menghasilkan 2 baris Message di database — baris KITA
  // di sini [externalId TIDAK PERNAH diisi sebelum baris ini] dan baris
  // KEDUA dari webhook yang meng-echo balik pengiriman fromMe:true yang
  // sama [routes/webhooks.js, sudah py logic dedup by externalId, tapi
  // TIDAK KETEMU karena baris kita tidak punya externalId sama sekali
  // untuk dicocokkan]. Inbox CRM (baca tabel Message ini langsung) jadi
  // menampilkan 2 bubble untuk 1 pengiriman nyata — itu yang terlihat
  // sebagai "banyak banget". Pola perbaikan SAMA PERSIS dengan yang sudah
  // benar di routes/orders.js (invoice/warranty send).
  //
  // externalId UNIK di skema (Message.externalId @unique) — kalau webhook
  // KEBETULAN sudah lebih dulu bikin baris untuk id yang sama (race,
  // meski belum pernah teramati di sample nyata: webhook SELALU belasan-
  // ratusan ms belakangan), P2002 di sini TIDAK BOLEH menggagalkan seluruh
  // notifikasi — pesan WA-nya sendiri SUDAH benar-benar terkirim di titik
  // ini, cuma soal baris DB mana yang "menang" mencatatnya.
  let msg;
  try {
    msg = await prisma.message.create({
      data: {
        conversationId: conversation.id, direction: "OUTBOUND", content: message,
        externalId: wahaMsg?.id || wahaMsg?._data?.id?._serialized || null,
      },
    });
  } catch (e) {
    if (e.code !== "P2002") throw e;
    msg = await prisma.message.findUnique({ where: { externalId: wahaMsg?.id || wahaMsg?._data?.id?._serialized } });
    if (!msg) return; // seharusnya tidak sampai sini, tapi jangan sampai emitNewMessage(undefined)
  }
  const updatedConv = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(message, null) },
  });
  emitNewMessage(conversation.id, msg);
  emitConversationUpdate(updatedConv);
}

// Kirim GAMBAR (bukan teks) ke Natasha — dipakai untuk tabel detail rute
// (buildRouteSheetImage, services/routeSheetImage.js), pengganti screenshot
// Google Sheets manual (laporan owner: "next dalam broadcast gue butuh
// detail informasi... atau bisa ga si broadcast nya ada bentuk gambar
// detail order gitu?"). Pola SAMA dengan notifyDriverGroup (foto POD) di
// atas — buffer disimpan ke disk dulu (WAHA butuh URL yang bisa dijangkau
// sendiri lewat jaringan Docker internal, bukan buffer inline), lalu
// dikirim via sendMedia.
async function notifyNatashaImage(buffer, filename, caption) {
  const conversation = await getNatashaConversation();
  if (!conversation) return;

  const target = resolveSendTarget(conversation);
  if (!target) return;

  fs.writeFileSync(path.join(routeSheetsDir, filename), buffer);
  const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://backend:4000";
  const fileUrl = `${BACKEND_INTERNAL_URL}/media/route-sheets/${filename}`;

  const { result: wahaMsg, session } = await sendWithSessionFallback(conversation, (s) =>
    sendMedia(target, { mimetype: "image/png", filename, url: fileUrl }, caption, "media", s)
  );
  conversation.sessionId = session;

  // externalId — lihat catatan panjang bug duplikat baris Message +
  // guard P2002 di notifyNatashaText di atas, penyebab & fix-nya sama
  // persis di sini.
  let msg;
  try {
    msg = await prisma.message.create({
      data: {
        conversationId: conversation.id, direction: "OUTBOUND", content: caption,
        mediaType: "image", mediaUrl: `/media/route-sheets/${filename}`,
        externalId: wahaMsg?.id || wahaMsg?._data?.id?._serialized || null,
      },
    });
  } catch (e) {
    if (e.code !== "P2002") throw e;
    msg = await prisma.message.findUnique({ where: { externalId: wahaMsg?.id || wahaMsg?._data?.id?._serialized } });
    if (!msg) return;
  }
  const updatedConv = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(caption, "image") },
  });
  emitNewMessage(conversation.id, msg);
  emitConversationUpdate(updatedConv);
}

// Rangkai pesan rute untuk grup driver — format mengikuti contoh yang sudah
// biasa dipakai tim SEBELUM ini (dispatcher ketik manual): hari+tanggal,
// kendaraan+driver, DAFTAR STOP, link peta, lalu "Detail Catatan" freeform
// DARI Route.notes (dispatcher yang isi manual, mis. "WILSON Pagi >
// EMON-helper" — pergantian driver di tengah jalan TIDAK bisa dimodelkan
// sebagai data terstruktur karena sifatnya kasuistik, jadi tetap teks bebas,
// bukan field baru per kasus). `label` opsional untuk membedakan pesan
// publish pertama vs update setelah edit darurat (lihat pemanggil).
//
// KOREKSI 6 September 2026 (laporan owner langsung setelah revisi tinyurl di
// atas): "gue ingin tetep kayak tadi tapi detail gitu, gaperlu tinyurl gitu,
// padahal rute nya banyak" — DUA hal:
// 1. shortenUrl() DICABUT lagi dari sini — link Maps balik ke URL panjang
//    ASLI (kecuali route.manualMapsUrl diisi, lihat poin 3 di bawah).
//    Percobaan tinyurl SEBELUMNYA (commit fec1df49) ternyata bukan yang
//    diinginkan.
// 2. Pesan SEBELUMNYA cuma header (hari/kendaraan/driver) + link + catatan
//    freeform — TIDAK PERNAH menyebutkan stop-nya SATU PUN, padahal Route
//    Card di Route Planner sudah menampilkan tiap stop dengan jelas
//    (customer, tipe Pengambilan/Pengiriman, alamat). Sekarang DAFTAR STOP
//    (nomor urut sesuai sequence, sama seperti Route Card) ditambahkan di
//    antara header dan link Maps — supaya driver bisa baca urutan kerja
//    LANGSUNG dari WA tanpa perlu buka Maps dulu, persis kegunaan link Maps
//    yang selama ini jadi satu-satunya sumber urutan.
// 3. Link SINGKAT ASLI (maps.app.goo.gl) diminta lagi setelah owner tahu
//    itu TIDAK BISA di-generate otomatis (cuma lewat tombol "Copy Link" di
//    UI Google Maps) — "saya generate manual tiap kali" adalah pilihan
//    owner sendiri. route.manualMapsUrl (schema.prisma, migrasi
//    20260906150000) MENGGANTIKAN mapsUrl (parameter auto-generate) kalau
//    diisi dispatcher — lihat input "Link Maps (opsional)" di RouteCard.jsx.
//
// KOREKSI 8 September 2026 (owner kasih TEMPLATE PERSIS via chat) — poin 2
// di atas ("Detail per stop SENGAJA TETAP RINGKAS... dikirim sebagai GAMBAR
// TABEL terpisah") DIBALIK: owner sekarang minta rincian PENUH per stop
// LANGSUNG di teks (EST jam, catatan akses, alamat, produk+ukuran), format
// baris demi baris sudah dicontohkan persis (lihat commit ini). Rincian ini
// SEKARANG TUMPANG TINDIH dengan gambar tabel (buildRouteSheetImage) yang
// dikirim SEBELUM teks ini di kirimRingkasanRuteKeNatasha() — gambar itu
// SENGAJA TIDAK DIHAPUS di perubahan ini (owner cuma minta perbaikan teks,
// bukan minta gambar dicabut); kalau ternyata dianggap duplikat/berlebihan
// setelah dipakai, itu keputusan terpisah yang perlu dikonfirmasi owner dulu.
function formatRouteWaMessage(route, mapsUrl, label = "") {
  const plat = route.vehicle?.plateNumber || "Kendaraan belum diisi";
  const tipeKendaraan = route.vehicle?.type?.trim() ? ` (${route.vehicle.type.trim().toUpperCase()})` : "";
  const driverLine = [route.driver?.name, route.helper?.name].filter(Boolean).join(" + ") || "Driver belum diisi";
  const mapsUrlFinal = route.manualMapsUrl?.trim() || mapsUrl;

  const baris = [
    label ? `${label}\n${hariTanggalWIB(route.date)}` : hariTanggalWIB(route.date),
    `*${plat}${tipeKendaraan} — ${driverLine}*`,
  ];

  // Link Keseluruhan Rute + Catatan Rute DIKELOMPOKKAN di ATAS, SEBELUM
  // daftar stop (9 September 2026, laporan owner — awalnya link ditaruh
  // PALING PERTAMA di seluruh pesan, tapi owner koreksi: cukup di ATAS
  // daftar stop, TETAP setelah header hari/tanggal & kendaraan/driver
  // supaya driver tahu dulu itu rute siapa sebelum lihat link/catatannya.
  // Catatan Rute yang SEBELUMNYA nempel setelah header juga dipindah ke
  // sini, tepat di bawah link, jadi satu blok info rute yang sama —
  // bukan lagi terpisah dua tempat berbeda di pesan.
  baris.push(
    "",
    mapsUrlFinal
      ? `🔗*Link Keseluruhan Rute:* ${mapsUrlFinal}`
      : "(Link keseluruhan rute belum bisa dibuat — belum ada stop dengan alamat/koordinat)"
  );

  const catatanRuteLines = (route.notes || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (catatanRuteLines.length > 0) {
    baris.push("", "*✏️Catatan Rute:*", ...catatanRuteLines.map((l) => `- ${l}`));
  }

  // route.jobs SUDAH terurut sequence asc (routeInclude), sama urutan yang
  // dipakai Route Card di frontend — TIDAK di-sort ulang di sini supaya
  // kedua tempat ini mustahil menampilkan urutan berbeda.
  const stopLines = (route.jobs || []).flatMap((j, idx) => {
    const order = j.order || j.units?.[0]?.unit?.order;
    const nama = order?.customer?.name || "Tanpa nama";
    const isPickup = j.type === "PICKUP";
    const emoji = isPickup ? "🔵" : "🟢";
    const tipe = isPickup ? "Pengambilan" : "Pengiriman";
    const alamat = j.addressText?.trim() || "(alamat belum diisi)";
    return [
      "",
      `${idx + 1}. ${emoji}${nama} - ${tipe}`,
      // Produk+ukuran DIPINDAH ke urutan ke-2 (9 September 2026, laporan
      // owner: "bagus jika ditempatkan dibawah nama customer") — SEBELUMNYA
      // baris paling bawah tiap stop, sekarang langsung di bawah nama biar
      // driver tahu barang apa duluan sebelum baca detail jam/catatan/alamat.
      `🛏️${produkUntukBroadcast(order)}`,
      `🕗EST Jam: ${estJamUntukBroadcast(j.timeWindow)}`,
      `🗒️Catatan: ${j.accessNotes?.trim() || ""}`,
      `📍Alamat: ${alamat}`,
      `🔗Link Maps: ${linkMapsPelanggan(order, j) || "(belum ada link)"}`,
    ];
  });
  baris.push(...stopLines);

  return baris.join("\n");
}

// Laporan Kurir Eksternal (D-161, 13 September 2026, permintaan owner:
// "untuk yang lalamove perlu info juga di grup delivery... ada laporan
// khusus kurir eksternal yang dikirim ke natasha") — job Lalamove TIDAK
// PERNAH masuk Route Planner (lihat catatan panjang di model RescheduleCase
// soal filosofi serupa, dan komentar Job.externalCourierRef), jadi tidak
// ada "rute" yang bisa diterbitkan/dikirim ulang seperti formatRouteWaMessage
// di atas. Ini padanannya: SATU pesan ringkas berisi SEMUA job hari itu yang
// drivernya berflag isExternalCourier, dikirim ke Natasha sama seperti
// broadcast rute (lihat notifyNatashaText).
const EXTERNAL_COURIER_STATUS_LABEL = {
  UNSCHEDULED: "Belum Dijadwalkan", SCHEDULED: "Terjadwal", ASSIGNED: "Ditugaskan",
  EN_ROUTE: "Menuju Lokasi", ARRIVED: "Tiba di Lokasi", COMPLETED: "Selesai", FAILED: "Gagal",
};

// DIPERKAYA (13 September 2026, laporan owner: "gue ingin chat laporan
// kurir eksternal seperti laporan rute yang detail hingga generate gambar
// seperti detail rute") — versi PERTAMA (di atas, sekarang diganti) cuma 4
// baris ringkas per stop, jauh lebih tipis dari formatRouteWaMessage yang
// dipakai broadcast rute biasa (produk+ukuran, EST jam, catatan, alamat,
// link Maps PER stop). Sekarang disamakan persis strukturnya — beda MURNI
// di 2 baris tambahan khusus kurir eksternal (tracking/ongkos) dan TANPA
// "Link Keseluruhan Rute" (job-job ini tujuannya independen, tidak masuk
// akal digabung jadi satu rute Maps).
function formatExternalCourierWaMessage(jobs, date) {
  const baris = [`🛵*Laporan Kurir Eksternal (Lalamove/dst)*`, hariTanggalWIB(date)];
  jobs.forEach((j, idx) => {
    const order = j.order;
    const nama = order?.customer?.name || "Tanpa nama";
    const isPickup = j.type === "PICKUP";
    const emoji = isPickup ? "🔵" : "🟢";
    const tipe = isPickup ? "Pengambilan" : "Pengiriman";
    const alamat = j.addressText?.trim() || "(alamat belum diisi)";
    baris.push(
      "",
      `${idx + 1}. ${emoji}${nama} - ${tipe}`,
      `📦${order?.orderNumber || "-"} · ${EXTERNAL_COURIER_STATUS_LABEL[j.status] || j.status}`,
      `🛏️${produkUntukBroadcast(order)}`,
      `🕗EST Jam: ${estJamUntukBroadcast(j.timeWindow) || "-"}`,
      `🗒️Catatan: ${j.accessNotes?.trim() || ""}`,
      `📍Alamat: ${alamat}`,
      `🔗Link Maps: ${linkMapsPelanggan(order, j) || "(belum ada link)"}`,
    );
    if (j.externalCourierRef) baris.push(`🚚Tracking Lalamove: ${j.externalCourierRef}`);
    if (j.externalCourierCost != null) baris.push(`💰Ongkos: Rp${j.externalCourierCost.toLocaleString("id-ID")}`);
  });
  return baris.join("\n");
}

// Select job Kurir Eksternal — SATU tempat, dipakai gambar (buildRouteSheetImage)
// DAN teks (formatExternalCourierWaMessage) supaya field yang dibutuhkan
// dua-duanya selalu sinkron kalau salah satu berubah nanti. Field order-nya
// SENGAJA dipilih sama dengan yang dipakai stopLines formatRouteWaMessage/
// buildRouteSheetImage (produkLineLabel, parseOrderNotesForInvoice, dst)
// supaya visualnya identik antara laporan rute biasa & laporan ini.
const EXTERNAL_COURIER_JOB_SELECT = {
  id: true, type: true, status: true, addressText: true, timeWindow: true, accessNotes: true,
  lat: true, lng: true,
  externalCourierRef: true, externalCourierCost: true,
  order: {
    select: {
      orderNumber: true, productLine: true, notes: true, locationUrl: true,
      customer: { select: { name: true, phone: true, assignedSales: { select: { name: true } } } },
    },
  },
};

// POST /armada/external-courier/notify-natasha — kirim laporan hari ini
// (atau tanggal lain lewat body.date) ke Natasha. GAMBAR TABEL dulu
// (buildRouteSheetImage — REUSE PENUH, fungsi itu cuma pernah baca
// `route.jobs`, jadi objek palsu `{ jobs }` tanpa Route sungguhan diterima
// apa adanya, TIDAK PERNAH disentuh/diubah), lalu teks — urutan & fungsi
// PERSIS SAMA dengan kirimRingkasanRuteKeNatasha (broadcast rute biasa).
// Best-effort di sisi pengiriman WA (sama pola dgn seluruh notifyNatasha*),
// TAPI kegagalan "tidak ada job" dianggap error nyata (bukan diam-diam
// no-op) — dispatcher yang klik tombol ini WAJIB tahu kalau ternyata tidak
// ada apa pun untuk dikirim, bukan mengira pesannya sudah terkirim.
armadaRouter.post("/external-courier/notify-natasha", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const { date } = req.body;
    // BUG DIPERBAIKI (13 September 2026) — startOfDayWIB butuh STRING
    // "YYYY-MM-DD" (lihat utils/wib.js, template literal `${dateStr}T00:00...`),
    // bukan objek Date. `startOfDayWIB(new Date())` menghasilkan string
    // template rusak ("Fri Sep 13 2026...T00:00:00.000Z") -> Invalid Date.
    // Pola yang sama dipakai routes/auth.js: geser UTC +7 jam lalu potong
    // 10 karakter pertama.
    const todayWIB = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const targetDate = toDateOnly(date || todayWIB);
    const jobs = await prisma.job.findMany({
      where: { scheduledDate: targetDate, driver: { isExternalCourier: true } },
      select: EXTERNAL_COURIER_JOB_SELECT,
      orderBy: { createdAt: "asc" },
    });
    if (jobs.length === 0) throw new ArmadaError("Tidak ada job kurir eksternal untuk tanggal ini");

    try {
      const buffer = await buildRouteSheetImage({ jobs });
      if (buffer) {
        const filename = `kurir-eksternal-${targetDate.toISOString().slice(0, 10)}-${Date.now()}.png`;
        await notifyNatashaImage(buffer, filename, `Detail Kurir Eksternal (Lalamove/dst) — ${hariTanggalWIB(targetDate)}`);
      }
    } catch (err) {
      console.error("[POST /external-courier/notify-natasha] Gagal kirim gambar tabel:", err.message);
    }
    await notifyNatashaText(formatExternalCourierWaMessage(jobs, targetDate));

    res.json({ ok: true, jobCount: jobs.length });
  } catch (err) {
    handleErr(err, res);
  }
});

// Link Maps PER CUSTOMER di tiap stop (9 September 2026, laporan owner:
// "pastikan link google maps tiap customer dicantumkan di broadcast") —
// SEBELUMNYA cuma "📍Alamat" (teks) per stop, link cuma ada SATU untuk
// seluruh rute gabungan di bawah, driver harus buka link gabungan lalu
// cari sendiri urutan ke berapa itu stop yang dimaksud.
//
// KOREKSI (9 September 2026, sesi yang sama — owner tanya lagi "apakah
// udah 1 source code?"): versi PERTAMA fungsi ini utamakan Order.locationUrl
// MENTAH, fallback ke lat/lng — TERBALIK dari mapsUrl() frontend
// (jobStatus.js, dipakai JobDetailDrawer/RouteCard/DriverJobs — SEMUA
// tombol "Buka di Google Maps" yang dispatcher/driver benar-benar klik)
// yang utamakan lat/lng, fallback ke locationUrl mentah. Prioritas KENAPA
// dibalik itu bukan sembarangan — investigasi nyata 8 September 2026
// (customer Steven, RES-26082026-173): link share mentah `maps.app.goo.gl`
// ke pin TANPA alamat resmi kadang RENDER HALAMAN KOSONG di browser
// desktop (WA Web termasuk!), sementara URL `maps/dir` dari koordinat
// SELALU konsisten di semua platform. Koordinat itu SENDIRI datang dari
// link sales yang sama (kebijakan LINK-ONLY geocodeAddress()), dan
// otomatis di-invalidate begitu Order.locationUrl diedit (lihat PATCH
// /orders/:id di orders.js, guard `locationUrl !== sebelum.locationUrl`
// -> job.lat/lng dikosongkan, tergeocode ULANG dari link baru lain kali
// ensureJobsGeocoded() jalan) — jadi TIDAK ada risiko cache basi menang
// diam-diam. Fungsi ini SEKARANG disamakan urutannya PERSIS dengan
// mapsUrl() supaya broadcast & tombol in-app selalu tunjuk ke link yang
// SAMA, bukan dua sumber kebenaran berbeda untuk stop yang sama.
function linkMapsPelanggan(order, job) {
  if (job?.lat != null && job?.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`;
  }
  const raw = order?.locationUrl?.trim();
  if (raw) return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return null;
}

// EST Jam per stop untuk broadcast (8 September 2026) — data lama
// Job.timeWindow (bebas ketik SEBELUM sistem 5-preset, mis. "EST Diatas jam
// 13.00 (40)") bisa sudah berisi prefix "EST"/"Diatas jam" sendiri. Dilucuti
// dulu di sini supaya template yang menambahkan label "🕗EST Jam:" di depan
// tidak dobel jadi "EST Jam: EST DIATAS JAM...". Aturan SAMA PERSIS dengan
// estimasiJamSingkat() di frontend (RouteCard.jsx/UnroutedJobsPanel.jsx) —
// implementasi terpisah karena beda runtime, bukan reuse lintas backend/FE.
function estJamUntukBroadcast(timeWindow) {
  if (!timeWindow || !timeWindow.trim()) return "";
  let s = timeWindow.trim().replace(/^EST:?\s*/i, "");
  s = s.replace(/^di\s*atas\s+jam\s*/i, "Di atas ");
  return s.trim();
}

// Produk+ukuran satu baris untuk broadcast rute (8 September 2026, contoh
// eksplisit owner: "Kasur Speing 180x200") — SENGAJA beda format dari
// produkLabel() di invoice.js (pemisah "·") dan productSummary() di
// frontend (ada "cm"/parens): plain spasi, tanpa pemisah, sesuai contoh
// persis yang diminta. Reuse produkLineLabel()/parseOrderNotesForInvoice()
// yang sudah ada, bukan bikin parser Order.notes ketiga.
function produkUntukBroadcast(order) {
  if (!order) return "-";
  const { ukuranKasur } = parseOrderNotesForInvoice(order.notes);
  return [produkLineLabel(order), ukuranKasur].filter(Boolean).join(" ");
}

// Kirim ringkasan rute LENGKAP ke Natasha — GAMBAR TABEL (detail per stop:
// No. HP, produk+ukuran, estimasi jam) DIIKUTI teks ringkas (header+link+
// catatan), meniru URUTAN persis kebiasaan manual Natasha selama ini
// (screenshot Sheets dulu, teks di bawahnya — lihat contoh nyata yang
// dikirim owner). SATU fungsi dipanggil dari 4 tempat (publish, 2x edit
// darurat, resend) supaya urutan gambar-lalu-teks ini konsisten di semua
// jalur, tidak perlu diingat ulang tiap pemanggil.
//
// Gambar best-effort TERPISAH dari teks (try/catch sendiri) — kalau
// render/kirim gambar gagal (mis. sharp/WAHA bermasalah), teks ringkas
// TETAP terkirim, bukan ikut gagal total karena satu titik kegagalan.
async function kirimRingkasanRuteKeNatasha(route, mapsUrl, label = "") {
  try {
    const buffer = await buildRouteSheetImage(route);
    if (buffer) {
      const filename = `${route.code}-${Date.now()}.png`;
      const caption = label ? `${label} — Detail Rute ${route.code}` : `Detail Rute ${route.code}`;
      await notifyNatashaImage(buffer, filename, caption);
    }
  } catch (err) {
    console.error("[kirimRingkasanRuteKeNatasha] Gagal kirim gambar tabel:", err.message);
  }
  await notifyNatashaText(formatRouteWaMessage(route, mapsUrl, label));
}

// ACTIVE_JOB_STATUSES & ELIGIBLE_ORDER_STATUS dipindah ke
// services/jobStatus.js 24 Agustus 2026 — dipakai juga oleh
// services/armadaAutoJob.js (auto-buat job pickup saat order masuk),
// satu sumber kebenaran supaya definisi "job aktif"/"order layak
// dijadwalkan" tidak drift antara dua file.

const jobInclude = {
  // isOnline/onlineSince (12 September 2026) — supaya AdminHomeScreen (app)
  // bisa tampilkan titik Online/Offline per driver di tab "Driver" TANPA
  // panggilan API kedua, konsisten dengan pola route/id:code/status di
  // bawah (sekali select, dipakai di mana pun job ini muncul).
  // isExternalCourier (13 September 2026, D-161) — supaya badge "Kurir
  // Eksternal" & field ongkos Lalamove di JobDetailDrawer bisa tahu tanpa
  // panggilan API kedua, pola sama dengan isOnline di atas.
  driver: { select: { id: true, name: true, isOnline: true, onlineSince: true, isExternalCourier: true } },
  helper: { select: { id: true, name: true, isOnline: true, onlineSince: true, isExternalCourier: true } },
  vehicle: { select: { id: true, plateNumber: true } },
  // route (D-077) — supaya frontend Penjadwalan bisa menampilkan "diatur
  // di rute RTE-XXX" begitu job.routeId terisi, TANPA panggilan API kedua
  // ke GET /routes/:id cuma untuk kode & status rutenya.
  route: { select: { id: true, code: true, status: true } },
  // revisionLinks (10 September 2026, kasus Richard RES-30082026-201) —
  // laporan owner: "di rute delivery, jadwal dan penugasan bisa tambah
  // badge ... sebagai penanda" — job pengambilan/pengiriman ULANG hasil
  // revisi (Retur) TIDAK PERNAH kelihatan beda dari job biasa di papan
  // Jadwal & Penugasan/Route Planner, driver/dispatcher cuma tahu lewat
  // teks accessNotes kalau kebetulan dibaca. Field terbalik dari
  // UnitRevision.jobId (lihat schema.prisma) — biasanya 0 atau 1 baris,
  // select seminimal mungkin (badge cuma butuh tahu ADA & jenisnya).
  revisionLinks: { select: { id: true, trigger: true, status: true } },
  // complaintCase (D-116, 11 September 2026) — pola PERSIS sama dengan
  // revisionLinks di atas: job yang lahir dari ComplaintCase (Delivery Task,
  // POST /complaints/:id/delivery-task) TIDAK PERNAH kelihatan beda dari job
  // biasa di papan Jadwal & Penugasan tanpa ini. Select seminimal mungkin
  // (badge cuma butuh nomor kasus & kategori/severity).
  complaintCase: { select: { id: true, caseNumber: true, category: true, severity: true, status: true } },
  // rescheduleCase (D-160, 13 September 2026) — pola PERSIS sama dengan
  // complaintCase di atas: kasus reschedule tersatukan (lihat catatan
  // panjang di services/rescheduleCase.js) supaya badge "Reschedule RSC-
  // ..." bisa tampil di JobDetailDrawer/RiwayatRevisiKendala/RouteCard
  // TANPA panggilan API kedua.
  rescheduleCase: { select: { id: true, caseNumber: true, status: true, round: true, reason: true, newScheduledDate: true } },
  // rescheduledBy (6 September 2026) — siapa yang mencatat reschedule
  // (baik dari jalur Gagal->reschedule yang lama, maupun catatan
  // retroaktif job Selesai yang baru, lihat POST /jobs/:id/reschedule-note)
  // supaya JobDetailDrawer bisa tampilkan "dicatat oleh X", bukan cuma ID.
  rescheduledBy: { select: { id: true, name: true } },
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
      // statusLocked (6 September 2026) — dipakai StatusSelect.jsx (D-086)
      // supaya JobDetailDrawer bisa menampilkan ikon 🔒 yang sama kalau
      // status order ini sedang di-override manual, konsisten dengan
      // ArmadaOrders.jsx/ProductionOrders.jsx.
      statusLocked: true,
      // category (D-051, 4 September 2026) — dipakai DeliveryTimeline.jsx
      // untuk membedakan alur order BARU (3 tahap: Diproses/Siap Kirim/
      // Terkirim, TANPA Menunggu/Pengambilan — tidak ada barang fisik yang
      // diambil dari customer, ini kasur/produk baru yang dibuat dari nol)
      // dari LAYANAN/SEWA (5 tahap penuh, ada fase pengambilan unit lama).
      // Dipakai LAGI di Route Planner (redesain Sep 2026) untuk badge "Sewa"
      // di kartu stop — kategori SEWA (prefix ID "SWS") beda alur retur/
      // pengambilan-lagi dari LAYANAN/BARU biasa, dispatcher perlu tahu
      // sekilas tanpa buka drawer.
      category: true,
      // items (redesain Sep 2026) — label layanan/produk ringkas per kartu
      // Route Planner ("apa yang dikerjakan di order ini"), sebelumnya cuma
      // ada di halaman Order. Cukup 1 baris teratas (sortOrder asc) — kartu
      // ini ruang sempit, bukan rincian lengkap add-on.
      items: { select: { layananName: true }, orderBy: { sortOrder: "asc" }, take: 1 },
      // pickupConfirmedDate/deliveryConfirmedDate (redesain Sep 2026) —
      // tanggal PASTI (bukan estimasi teks bebas pickupEstimate/
      // deliveryEstimate) untuk badge "Pasti: <tanggal>" di kartu Route
      // Planner, supaya dispatcher tidak perlu buka drawer detail cuma untuk
      // konfirmasi tanggal yang sudah disepakati ke customer.
      pickupConfirmedDate: true, deliveryConfirmedDate: true,
      deliveryAddress: true, deliveryCity: true,
      // locationUrl (6 September 2026, laporan owner) — link Google Maps
      // yang SALES sudah dapat & catat langsung dari customer saat input
      // order (pin akurat, bukan hasil geocode alamat teks). Sebelumnya
      // TIDAK PERNAH ikut ter-include ke sini — JobDetailDrawer cuma tahu
      // mapsUrl(job) hasil geocode Job.addressText sendiri, link asli dari
      // sales tidak pernah terlihat dispatcher/driver sama sekali walau
      // sudah ada di data Order sejak awal.
      locationUrl: true,
      // productLine/productType/notes (6 September 2026, laporan owner:
      // broadcast rute butuh "jenis produk, ukuran [khusus kasur]") —
      // notes di-parse lewat parseOrderNotesForInvoice (services/invoice.js,
      // SATU-SATUNYA tempat JSON Order.notes di-parse untuk merk/ukuran,
      // reuse bukan duplikasi ketiga kalinya) untuk ambil ukuranKasur.
      productLine: true, productType: true, notes: true,
      // jobs (8 September 2026, laporan owner: order tampil "Terkirim"
      // padahal cuma job Pengambilan yang beneran selesai, job Pengiriman
      // tidak pernah ada) — dipakai JobDetailDrawer utk mendeteksi order
      // TANPA job DELIVERY sama sekali, supaya bisa ditawarkan tombol
      // "Buka Lagi utk Pengiriman" (POST /orders/:id/reopen-for-delivery)
      // alih-alih dispatcher cuma punya dropdown Status Order polos yang
      // tidak menyentuh Job/Route sama sekali. Cuma id+type+status, bukan
      // detail penuh — frontend cuma perlu tahu ADA/TIDAK job DELIVERY.
      jobs: { select: { id: true, type: true, status: true } },
      // conversations (8 September 2026, laporan owner: mau chat WA cepat
      // dari Route Planner tanpa pindah ke Inbox) — pola SAMA persis dengan
      // GET /orders di routes/orders.js (conversationId untuk buka chat
      // langsung dari baris order): ambil percakapan INDIVIDUAL TERAKHIR
      // saja (bukan grup, bukan riwayat lengkap) supaya query tetap ringan
      // untuk endpoint yang dipanggil berulang kali (list job/rute).
      customer: {
        select: {
          id: true, name: true, phone: true,
          assignedSales: { select: { id: true, name: true } },
          conversations: {
            where: { type: "INDIVIDUAL" },
            orderBy: { lastMessageAt: "desc" }, take: 1,
            select: { id: true },
          },
        },
      },
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
              // statusLocked — lihat catatan di order.select di atas.
              statusLocked: true,
              // category (D-051) — lihat catatan di order.select di atas.
              category: true,
              // items/pickupConfirmedDate/deliveryConfirmedDate (redesain
              // Sep 2026) — sama alasan dengan order.select di atas, jalur
              // fallback ini dipakai job yang cuma py order lewat units[].
              items: { select: { layananName: true }, orderBy: { sortOrder: "asc" }, take: 1 },
              pickupConfirmedDate: true, deliveryConfirmedDate: true,
              // D-032 — alamat/kota SALES/rencana (D-027), dipakai FE
              // sebagai prefill saat dispatcher pertama kali isi addressText
              // job ini (belum ada alamat verifikasi lapangan). Keputusan
              // yang sebelumnya ditunda di komentar Order.deliveryAddress —
              // ini jalur baca-saja, tidak menimpa job.addressText yang
              // sudah diisi/diverifikasi driver.
              deliveryAddress: true, deliveryCity: true,
              // locationUrl — lihat catatan panjang di order.select di atas,
              // fallback ini sama alasannya.
              locationUrl: true,
              // productLine/productType/notes — fallback ini sama alasannya
              // dengan order.select di atas.
              productLine: true, productType: true, notes: true,
              // assignedSales (D-043, 2 September 2026) — laporan owner:
              // dispatcher perlu tahu SIAPA sales yang pegang order ini
              // (buat koordinasi/tanya-jawab), bukan cuma nama customer.
              // conversations (8 September 2026, laporan owner: mau chat WA cepat
      // dari Route Planner tanpa pindah ke Inbox) — pola SAMA persis dengan
      // GET /orders di routes/orders.js (conversationId untuk buka chat
      // langsung dari baris order): ambil percakapan INDIVIDUAL TERAKHIR
      // saja (bukan grup, bukan riwayat lengkap) supaya query tetap ringan
      // untuk endpoint yang dipanggil berulang kali (list job/rute).
      customer: {
        select: {
          id: true, name: true, phone: true,
          assignedSales: { select: { id: true, name: true } },
          conversations: {
            where: { type: "INDIVIDUAL" },
            orderBy: { lastMessageAt: "desc" }, take: 1,
            select: { id: true },
          },
        },
      },
            },
          },
        },
      },
    },
  },
  // issueLogs (9 September 2026, D-110) — riwayat LENGKAP siklus gagal/
  // reschedule per job, lihat komentar panjang di schema.prisma model
  // JobIssueLog. Dipakai IssueRescheduleDrawer.jsx menampilkan timeline
  // penuh (bukan cuma "kegagalan/reschedule TERAKHIR" dari field tunggal
  // Job.failureReason/rescheduleReason yang sudah ada). Array ini KOSONG
  // untuk hampir semua job (yang tidak pernah gagal) — biaya query
  // tambahan minimal.
  issueLogs: {
    orderBy: { createdAt: "asc" },
    include: { createdBy: { select: { id: true, name: true } } },
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
//
// `locationUrlHint` (7 September 2026) — Order.locationUrl kalau ada,
// diteruskan ke geocodeAddress() yang mencobanya PALING PERTAMA (jauh lebih
// akurat dari geocoding teks apa pun). Lihat catatan panjang di
// services/maps.js#geocodeAddress.
async function bestEffortGeocode(addressText, locationUrlHint) {
  try {
    return await geocodeAddress(addressText, locationUrlHint);
  } catch (err) {
    console.error("[armada] geocode gagal:", err.message);
    return null;
  }
}

// Perbaikan-mandiri sekali jalan (7 September 2026, investigasi laporan
// owner: "Buat Peta" di Route Planner "mental kemana-mana"; DIPERKETAT 8
// September 2026 jadi LINK-ONLY, lihat catatan panjang di
// services/maps.js#geocodeAddress) — dipanggil TEPAT SEBELUM
// buildRouteMapsUrl() di 3 titik (publish, resend, dan endpoint "Buat
// Peta" sendiri — 2 titik "edit darurat" yang DULU juga memanggil ini
// SUDAH DICABUT dari auto-broadcast, lihat catatan panjang di PATCH
// /routes/:id soal kenapa). Job yang BELUM punya koordinat (lat null —
// kasus paling sering: job auto-buat dari order sales, lihat catatan
// panjang di services/armadaAutoJob.js soal geocoding yang SENGAJA dilewati
// saat job lahir) di-geocode DI SINI lewat geocodeAddress() — yang SEKARANG
// hanya bisa berhasil kalau ada LINK Maps (Order.locationUrl, atau link
// yang kebetulan nempel di Job.addressText). Job TANPA link SAMA SEKALI
// tetap `lat: null` sesudah ini (BUKAN ditebak dari teks alamat lagi) —
// itu yang bikin buildRouteMapsUrl() mengecualikannya dari URL peta, dan
// badge "Tanpa link Maps" (JobBadges.jsx) muncul di kartunya.
//
// Hasilnya DISIMPAN ke Job (bukan cuma dipakai sekali lalu dibuang) — jadi
// perbaikan ini "menempel": klik "Buat Peta" berikutnya untuk rute yang
// sama tidak perlu resolve link lagi. Best-effort penuh (Promise.allSettled,
// try/catch per job) — kegagalan resolve 1 stop TIDAK BOLEH menggagalkan
// pembuatan link untuk stop lainnya.
//
// Untuk job yang SUDAH punya koordinat TIDAK disentuh di sini (supaya klik
// "Buat Peta" tetap cepat) — upgrade/pembersihan retroaktif itu tugas
// scripts/backfill-job-geocode-from-order-link.js (isi dari link) dan
// scripts/clear-non-link-job-geocode.js (hapus koordinat lama yang BUKAN
// dari link, sisa kebijakan lama sebelum link-only), dijalankan manual.
async function ensureJobsGeocoded(jobs) {
  const perluDiisi = jobs.filter((j) => j.lat == null && (j.order?.locationUrl || j.addressText?.trim()));
  if (perluDiisi.length === 0) return;

  await Promise.allSettled(perluDiisi.map(async (j) => {
    try {
      const geo = await geocodeAddress(j.addressText, j.order?.locationUrl);
      if (!geo) return;
      await prisma.job.update({ where: { id: j.id }, data: { lat: geo.lat, lng: geo.lng } });
      // Ikut diperbarui di array in-memory supaya buildRouteMapsUrl() yang
      // dipanggil SETELAH ini langsung memakai koordinat baru, tanpa perlu
      // fetch ulang route dari database.
      j.lat = geo.lat;
      j.lng = geo.lng;
    } catch (err) {
      console.error(`[armada] Gagal geocode job ${j.id}:`, err.message);
    }
  }));
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
      // isExternalCourier (D-161) — dropdown Driver bisa tandai "Kurir
      // Eksternal (Lalamove/dst)" secara visual sebelum dispatcher assign.
      // hasSim (D-162) — dipakai tab Driver di Pengaturan Delivery utk
      // toggle status SIM per orang (tarif insentif per alamat beda).
      // isFreelance (D-162 lanjutan) — sama, toggle "part time/freelance"
      // yang menyaring orang itu dari daftar Insentif Driver & Helper.
      include: { user: { select: { id: true, name: true, isExternalCourier: true, hasSim: true, isFreelance: true } } },
      orderBy: { user: { name: "asc" } },
    });
    res.json(rows.map((r) => r.user));
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /armada/drivers/:id — field yang boleh diubah lewat sini: hasSim
// & isFreelance (D-162, 13 September 2026). Endpoint SEMPIT SENGAJA (bukan
// PATCH /users/:id umum, itu belum ada sama sekali) — data akun lain
// (nama/email/role/dst) tetap lewat Pengguna & Peran, ini murni atribut
// Delivery-specific (tarif & kelayakan insentif per alamat). Kedua field
// OPSIONAL di body — kirim salah satu saja juga boleh, tidak wajib
// dua-duanya tiap panggilan.
armadaRouter.patch("/drivers/:id", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const { hasSim, isFreelance } = req.body;
    if (hasSim === undefined && isFreelance === undefined) {
      throw new ArmadaError("Tidak ada field yang diubah");
    }
    const data = {};
    if (hasSim !== undefined) {
      if (typeof hasSim !== "boolean") throw new ArmadaError("hasSim wajib boolean");
      data.hasSim = hasSim;
    }
    if (isFreelance !== undefined) {
      if (typeof isFreelance !== "boolean") throw new ArmadaError("isFreelance wajib boolean");
      data.isFreelance = isFreelance;
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, hasSim: true, isFreelance: true },
    });
    res.json(user);
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
    const { type, status, orderStatus, driverId, routeId, date, from, to, q, take, hasConfirmedDate, sortBy } = req.query;

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
    } else if (date === "any") {
      // "any" (D-069, 4 September 2026 — bug NYATA ditemukan owner: panel
      // "Belum Masuk Rute" cuma menampilkan 1 job padahal seharusnya 11).
      // Akar masalahnya BUKAN `take` kurang besar (sudah 500) — pemanggil
      // (Route Planner) sengaja TIDAK mengirim `date` sama sekali supaya
      // dapat job BERTANGGAL dari hari mana pun, tapi tanpa filter apa pun
      // di sini `scheduledDate` tetap `undefined` di bawah dan seluruh
      // kondisi (`date` KOSONG) DIABAIKAN TOTAL — artinya job TANPA
      // tanggal (ratusan, termasuk backlog lama & job COMPLETED lawas)
      // ikut lolos dan bersaing memperebutkan jatah `take` yang SAMA
      // dengan job bertanggal yang sebenarnya dicari. Terverifikasi
      // langsung: 512 job routeId=null TANPA tanggal vs 11 job routeId=null
      // BERTANGGAL — dengan take=500 dan urutan `scheduledDate desc`, cuma
      // 1 dari 11 job bertanggal yang kebagian slot (sisanya kepotong).
      // `date=any` computer secara eksplisit "scheduledDate BUKAN null" di
      // level DATABASE, jadi job tanpa tanggal tidak lagi ikut bersaing
      // jatah `take` — bukan sekadar menaikkan `take` lebih tinggi lagi
      // (itu cuma menunda gejalanya, jumlah job tanpa tanggal akan terus
      // bertambah seiring waktu).
      scheduledDate = { not: null };
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

    // orderStatus & hasConfirmedDate DUA-DUANYA menyaring lewat relasi
    // `order` — digabung jadi SATU objek (pola sama dengan customerWhere di
    // GET /orders) supaya kalau dua-duanya dikirim sekaligus, salah satu
    // tidak diam-diam menimpa yang lain (dua key `order:` terpisah akan
    // saling timpa, persis kesalahan yang sudah pernah dibetulkan di
    // endpoint ini untuk `scheduledDateFilter`).
    const orderWhere = {
      ...(orderStatus && { status: orderStatus }),
      // hasConfirmedDate (9 September 2026, laporan owner: "filter yang
      // sudah punya tanggal pengambilan dan pengiriman pasti") — lihat
      // catatan panjang yang sama di routes/orders.js GET /.
      ...(hasConfirmedDate === "true" && {
        OR: [{ pickupConfirmedDate: { not: null } }, { deliveryConfirmedDate: { not: null } }],
      }),
    };

    const jobs = await prisma.job.findMany({
      where: {
        ...(type && { type }),
        ...(status && { status }),
        // orderStatus (6 September 2026, laporan owner: "filter disini
        // ganti aja sesuai dengan order/pipeline") — filter TERPISAH dari
        // `status` di atas (itu status JOB/armada), ini status ORDER-nya
        // sendiri (Menunggu/Pengambilan/Diproses/Siap Kirim/dst). Job.order
        // adalah relasi LANGSUNG (job.orderId FK), bukan lewat units[], jadi
        // filter relasi Prisma biasa cukup — tidak perlu jalur fallback
        // seperti orderStatusOf() di frontend (itu urusan tampilan kartu
        // yang datanya kadang cuma ke-include lewat units[], BUKAN soal
        // relasi database yang sebenarnya).
        ...(Object.keys(orderWhere).length > 0 && { order: orderWhere }),
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
        // Job usang (D-064) — order induknya sudah DELIVERED/CANCELLED
        // lewat jalur lain, job-nya sendiri tidak pernah disentuh sama
        // sekali. Laporan owner: order "Hotel Discovery" sudah Terkirim di
        // Sales CRM, tapi tetap nongkrong selamanya di "Perlu Dijadwalkan"
        // (Dashboard) & "Belum Masuk Rute" (Route Planner). TIDAK
        // dikondisikan ke `status` yang diminta pemanggil — bahkan yang
        // eksplisit minta status=UNSCHEDULED (persis kasus Dashboard) tetap
        // harus menyaring ini, itu SUMBER bug-nya.
        NOT: STALE_UNSCHEDULED_JOB,
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
        // category/items/pickupConfirmedDate/deliveryConfirmedDate
        // (redesain Route Planner, Sep 2026) — panel "Belum Masuk Rute"
        // memakai endpoint INI (bukan jobInclude di atas), jadi field yang
        // sama perlu ditambahkan di sini juga supaya badge Sewa/label
        // layanan/tanggal pasti konsisten di kedua panel Route Planner.
        order: {
          select: {
            id: true, orderNumber: true, deliveryCity: true, category: true,
            // status (6 September 2026) — laporan owner: Jadwal & Penugasan
            // perlu tampilkan status ORDER (Siap Kirim/Pengambilan/dst),
            // bukan cuma status Job. Dipakai OrderStatusBadge (JobBadges.jsx).
            status: true,
            // statusLocked — lihat catatan di jobInclude.order.select.
            statusLocked: true,
            items: { select: { layananName: true }, orderBy: { sortOrder: "asc" }, take: 1 },
            pickupConfirmedDate: true, deliveryConfirmedDate: true,
            // locationUrl (6 September 2026) — lihat catatan panjang di
            // jobInclude.order.select di atas.
            locationUrl: true,
            // productLine/productType/notes (6 September 2026) — Dashboard
            // Control Tower butuh produk+ukuran di baris antrean "Perlu
            // Dijadwalkan" (produkLineLabel + parseOrderNotesForInvoice,
            // sama pola yang sudah dipakai broadcast rute). Field yang
            // SAMA sudah ditambahkan ke jobInclude di atas untuk keperluan
            // lain — endpoint ini pakai select TERPISAH jadi perlu ditambah
            // di sini juga, bukan otomatis ikut.
            productLine: true, productType: true, notes: true,
            // conversations (8 September 2026) — lihat catatan panjang di
            // jobInclude.order.select di atas; endpoint ini pakai select
            // TERPISAH (override, bukan spread jobInclude.order) jadi perlu
            // ditambah di sini juga.
            // assignedSales (8 September 2026) — SalesBadge (JobBadges.jsx)
            // butuh ini, endpoint ini sebelumnya tidak menyertakannya sama
            // sekali (beda dari jobInclude.order.select di atas yang sudah
            // punya sejak D-043) — akar kenapa baris "sales person" tidak
            // pernah muncul di panel "Belum Masuk Rute" walau sudah ada di
            // kartu stop RouteCard.jsx.
            customer: {
              select: {
                id: true, name: true, phone: true,
                assignedSales: { select: { id: true, name: true } },
                conversations: {
                  where: { type: "INDIVIDUAL" },
                  orderBy: { lastMessageAt: "desc" }, take: 1,
                  select: { id: true },
                },
              },
            },
          },
        },
      },
      // sortBy (9 September 2026) — lihat catatan panjang di GET /orders
      // soal ASC + nulls-last ("paling MENDESAK duluan", bukan "terbaru
      // duluan"). Job.order adalah relasi to-one, Prisma mendukung orderBy
      // lewat field relasinya langsung.
      orderBy: sortBy === "pickupConfirmedDate"
        ? [{ order: { pickupConfirmedDate: { sort: "asc", nulls: "last" } } }, { scheduledDate: "desc" }]
        : sortBy === "deliveryConfirmedDate"
          ? [{ order: { deliveryConfirmedDate: { sort: "asc", nulls: "last" } } }, { scheduledDate: "desc" }]
          : [{ scheduledDate: "desc" }, { sequence: "asc" }, { createdAt: "desc" }],
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

// DELETE /armada/vehicles/:id (D-088, 5 September 2026) — laporan owner:
// "bisa delete armada atau mobil yang udah ditambah/didaftarkan". BELUM ADA
// jalur menghapus kendaraan sama sekali sebelum ini (cuma create+update) —
// kendaraan uji coba/salah input menumpuk selamanya di daftar.
//
// HAPUS PERMANEN hanya kalau kendaraan ini BENAR-BENAR belum pernah dipakai
// (nol job/rute/biaya/servis/insiden) — VehicleExpense/Service/Incident
// SENGAJA `onDelete: Restrict` di schema (lihat komentar di sana: riwayat
// finansial/insiden tidak boleh hilang diam-diam kalau kendaraannya
// dihapus), jadi Prisma akan menolak sendiri kalau salah satu itu masih
// ada — DICEK EKSPLISIT di sini dulu supaya pesannya jelas ("kendaraan ini
// punya riwayat, nonaktifkan saja") alih-alih error Prisma mentah yang
// membingungkan dispatcher. Job/Route pakai `SetNull` (boleh dihapus,
// referensinya cuma dikosongkan) — TETAP ikut dihitung di sini karena
// kehilangan "kendaraan mana yang dulu mengerjakan job ini" adalah
// kehilangan jejak riwayat juga, walau secara teknis DB mengizinkannya.
armadaRouter.delete("/vehicles/:id", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
    if (!vehicle) return res.status(404).json({ error: "Kendaraan tidak ditemukan" });

    const [jobCount, routeCount, expenseCount, serviceCount, incidentCount] = await Promise.all([
      prisma.job.count({ where: { vehicleId: vehicle.id } }),
      prisma.route.count({ where: { vehicleId: vehicle.id } }),
      prisma.vehicleExpense.count({ where: { vehicleId: vehicle.id } }),
      prisma.vehicleService.count({ where: { vehicleId: vehicle.id } }),
      prisma.vehicleIncident.count({ where: { vehicleId: vehicle.id } }),
    ]);
    const totalRiwayat = jobCount + routeCount + expenseCount + serviceCount + incidentCount;
    if (totalRiwayat > 0) {
      throw new ArmadaError(
        `Kendaraan ${vehicle.plateNumber} sudah punya riwayat (${[
          jobCount && `${jobCount} job`, routeCount && `${routeCount} rute`,
          expenseCount && `${expenseCount} biaya`, serviceCount && `${serviceCount} servis`,
          incidentCount && `${incidentCount} insiden`,
        ].filter(Boolean).join(", ")}) — tidak bisa dihapus permanen. Ubah statusnya ke "Nonaktif" saja lewat dropdown status, riwayatnya tetap tersimpan.`
      );
    }

    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    res.json({ ok: true });
  } catch (err) {
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
  // helper (D-077) — pasangan driver, lihat catatan panjang di schema.prisma
  // pada field Route.helperId untuk kenapa field ini ditambahkan.
  helper: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNumber: true, type: true, capacitySlots: true } },
  // lastEditedBy (redesain Sep 2026) — siapa terakhir mengedit rute PUBLISHED
  // ini, dipasangkan dengan Route.lastEditReason/lastEditedAt (kolom biasa,
  // lihat catatan panjang di schema.prisma) supaya UI bisa menampilkan
  // "diedit oleh X, <alasan>" pada rute yang sudah diterbitkan tapi diubah.
  lastEditedBy: { select: { id: true, name: true } },
  jobs: {
    include: jobInclude,
    orderBy: { sequence: "asc" },
  },
};

// `from`/`to` (D-063, 4 September 2026) — laporan owner: tampilan awal Route
// Planner sebaiknya BUKAN satu hari terkunci, tapi rentang (gaya date-range
// picker CRM di Dashboard/Laporan — lib/dateRange.js), baru di-custom ke
// satu hari/rentang tertentu kalau memang perlu. `date` (exact match) TETAP
// dipertahankan apa adanya untuk kompatibilitas pemanggil lama.
armadaRouter.get("/routes", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { date, from, to, status } = req.query;
    let dateWhere;
    if (date) {
      dateWhere = toDateOnly(date);
    } else if (from || to) {
      dateWhere = {};
      if (from) dateWhere.gte = toDateOnly(from);
      // Batas EKSKLUSIF via `lte` pada kolom DATE — sama pola dengan GET
      // /armada/jobs (CLAUDE.md §11), bukan `lt` awal hari berikutnya
      // (kolom ini @db.Date, bukan datetime, jadi lte apa adanya sudah benar).
      if (to) dateWhere.lte = toDateOnly(to);
    }
    const routes = await prisma.route.findMany({
      where: {
        ...(dateWhere !== undefined && { date: dateWhere }),
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

// GET /incentive-summary?from=&to= — jumlah ALAMAT selesai per driver/
// helper dalam rentang tanggal + insentif Rupiah (13 September 2026, D-162
// — GANTI TOTAL dari versi "per jalur" sebelumnya, keputusan eksplisit
// owner setelah dijelaskan cara Klinik Matras SUNGGUHAN menghitung
// insentif: "klinik matras sano menghitungnya 1 pelanggan, lokasi sama,
// tanggal sama ambil dan kirim hingga finish = dihitung 1, tapi jika 1
// pelanggan yang sama order lagi di lain hari/minggu/bulan tetap
// dihitung juga". "Per jalur" (Route) SALAH KAPRAH — 1 rute isinya
// banyak stop customer BERBEDA, itu bukan cara Klinik Matras hitung
// insentif sama sekali.
//
// KUNCI dedup: (orderId, tanggal WIB job selesai). Order yang SAMA
// (pickup+delivery, walau 2 job terpisah) yang tuntas di TANGGAL YANG
// SAMA cuma dihitung 1 — itulah "1 pelanggan, lokasi sama, tanggal sama".
// Order yang SAMA tapi pickup/delivery-nya tuntas di HARI BERBEDA
// (kasus NORMAL — produksi makan waktu di antaranya) dihitung 2, sesuai
// kata kuncinya sendiri "tanggal sama" sebagai syarat, bukan "order
// sama". orderId (bukan customerId) yang dipakai — order BARU dari
// customer yang SAMA di lain hari otomatis "reset"/dihitung lagi karena
// orderId-nya pasti beda, tidak perlu logika reset terpisah.
//
// TIDAK dipisah per Route sama sekali lagi — job lepas (belum/tidak
// pernah masuk Route, mis. Kurir Eksternal) ikut terhitung selama
// statusnya COMPLETED, konsisten dengan makna "alamat yang dia
// selesaikan" apa adanya.
//
// Tarif (owner, verbatim): "Klo yg punya sim 7.000/alamat, Klo gk ada
// 3.000/alamat" — per ORANG (User.hasSim), BUKAN per peran (driver vs
// helper) — seorang helper bisa saja punya SIM juga. asDriver/asHelper
// TETAP dipisah di respons murni untuk TRANSPARANSI (biar kelihatan
// perannya apa saja), tapi `totalAlamat` yang dipakai hitung Rupiah
// adalah GABUNGAN unik lintas peran (1 orang, 1 tanggal, 1 order —
// tetap 1 alamat, walau kebetulan jadi driver di 1 job & helper di job
// lain untuk order yang sama).
const RATE_PER_ALAMAT = { withSim: 7000, withoutSim: 3000 };

armadaRouter.get("/incentive-summary", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { from, to } = req.query;
    // Default "bulan ini" (WIB) kalau tidak dikirim — insentif lazimnya
    // dihitung per periode berjalan, bukan akumulasi dari awal selamanya.
    const now = new Date(Date.now() + 7 * 3600_000);
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const completedAtWhere = {
      gte: from ? toDateOnly(from) : defaultFrom,
      // endOfDayExclusiveWIB, bukan toDateOnly(to) polos — completedAt
      // adalah TIMESTAMP (jam berapa pun di hari itu), toDateOnly(to)
      // sendirian berarti "sebelum jam 00:00 WIB tanggal `to`" — buang
      // seluruh job yang selesai di HARI `to` itu sendiri.
      ...(to && { lt: endOfDayExclusiveWIB(to) }),
    };

    // order.orderNumber/customer.name/addressText (13 September 2026,
    // laporan owner: "ketika diklik bisa kasih detail alamat/resi order
    // mana aja dari masing-masing driver?") — dipakai BUKAN untuk hitung
    // (itu tetap orderId+tanggal, lihat catatan di atas), murni supaya
    // tiap "alamat" di daftar bisa ditelusuri balik ke resi/customer/
    // alamat aslinya tanpa panggilan API kedua per baris.
    const jobs = await prisma.job.findMany({
      where: { status: "COMPLETED", completedAt: completedAtWhere },
      select: {
        orderId: true, completedAt: true, driverId: true, helperId: true, type: true, addressText: true,
        order: { select: { orderNumber: true, customer: { select: { name: true } } } },
      },
    });

    // dedup per orang: 3 Map terpisah (asDriver/asHelper/gabungan),
    // key = "orderId|tanggalWIB" -> { orderNumber, customerName,
    // addressText, date, types: Set } — Map (bukan Set polos lagi)
    // supaya detailnya ikut terbawa, BUKAN cuma dihitung. `types`
    // mengumpulkan PICKUP/DELIVERY yang tuntas di alamat+tanggal itu
    // (biasanya 1, bisa 2 kalau ambil&kirim tuntas di hari yang sama —
    // itulah situasi "= dihitung 1" yang dimaksud, terlihat eksplisit di
    // detailnya, bukan cuma angka tunggal).
    const perOrang = new Map();
    function baris(userId) {
      let b = perOrang.get(userId);
      if (!b) { b = { asDriverMap: new Map(), asHelperMap: new Map(), allMap: new Map() }; perOrang.set(userId, b); }
      return b;
    }
    function catat(map, key, j, tanggalWIB) {
      let entri = map.get(key);
      if (!entri) {
        entri = {
          orderId: j.orderId, orderNumber: j.order?.orderNumber || "-",
          customerName: j.order?.customer?.name || "Tanpa nama",
          addressText: j.addressText?.trim() || "-", date: tanggalWIB, types: new Set(),
        };
        map.set(key, entri);
      }
      entri.types.add(j.type);
    }
    for (const j of jobs) {
      const tanggalWIB = new Date(j.completedAt.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
      const key = `${j.orderId}|${tanggalWIB}`;
      if (j.driverId) { const b = baris(j.driverId); catat(b.asDriverMap, key, j, tanggalWIB); catat(b.allMap, key, j, tanggalWIB); }
      if (j.helperId) { const b = baris(j.helperId); catat(b.asHelperMap, key, j, tanggalWIB); catat(b.allMap, key, j, tanggalWIB); }
    }

    // Set -> array biasa (JSON tidak bisa serialize Set), diurutkan
    // tanggal terbaru dulu — paling relevan buat ditelusuri.
    const ringkasDetail = (map) => [...map.values()]
      .map((e) => ({ ...e, types: [...e.types] }))
      .sort((a, b) => b.date.localeCompare(a.date));

    // isFreelance: false (13 September 2026, laporan owner: "arman, ujang
    // sigit, dan sulaiman jangan dimasukkan ke insentif driver & helper
    // karna mereka part time/freelance") — MURNI menyaring MEREKA dari
    // daftar hasil, job yang sudah dihitung di atas (perOrang) TIDAK
    // disentuh sama sekali, jadi driver/helper LAIN yang bertugas
    // bersama mereka di job yang sama tetap dapat kredit penuh.
    const userIds = [...perOrang.keys()];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds }, isFreelance: false }, select: { id: true, name: true, hasSim: true } })
      : [];

    const orang = users
      .map((u) => {
        const b = perOrang.get(u.id);
        const totalAlamat = b.allMap.size;
        const ratePerAlamat = u.hasSim ? RATE_PER_ALAMAT.withSim : RATE_PER_ALAMAT.withoutSim;
        return {
          id: u.id, name: u.name, hasSim: u.hasSim,
          asDriver: b.asDriverMap.size, asHelper: b.asHelperMap.size,
          totalAlamat, ratePerAlamat, totalInsentif: totalAlamat * ratePerAlamat,
          detail: ringkasDetail(b.allMap),
        };
      })
      .sort((a, b) => b.totalAlamat - a.totalAlamat);

    res.json({
      from: completedAtWhere.gte.toISOString().slice(0, 10),
      to: to || null,
      ratePerAlamat: RATE_PER_ALAMAT,
      orang,
    });
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
    const { date, driverId, helperId, vehicleId, notes } = req.body;
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
        helperId: helperId || null,
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

// Edit rute setelah diterbitkan (redesain Route Planner, Sep 2026,
// docs/ARMADA-REDESIGN-2026.md) — DRAFT tetap bebas diedit seperti biasa.
// PUBLISHED BOLEH diedit juga sekarang, TAPI wajib `reason` (alasan
// singkat) — bukan membuka kunci tanpa syarat: immutability rute yang
// sudah diterbitkan tetap jadi default (komitmen ke driver), `reason`
// adalah jalur darurat yang tercatat (Route.lastEditReason/lastEditedAt/
// lastEditedById), bukan penghapusan aturan itu. IN_PROGRESS/COMPLETED/
// CANCELLED TETAP terkunci — rute yang sedang/sudah dijalankan atau
// dibatalkan bukan kasus "rencana berubah", beda persoalan.
armadaRouter.patch("/routes/:id", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({ where: { id: req.params.id } });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });

    const { driverId, helperId, vehicleId, notes, manualMapsUrl, reason } = req.body;
    const editingPublished = route.status === "PUBLISHED";
    // Edit rute SELESAI — admin only (8 September 2026, permintaan owner
    // langsung: "buat rute yang udah selesai tetap bisa di edit hanya
    // untuk akses admin"). Sebelum ini COMPLETED terkunci total sama
    // seperti CANCELLED/FAILED — tidak ada jalur koreksi kalau ternyata
    // ada salah catat driver/kendaraan/catatan SETELAH rute selesai
    // (mis. laporan lapangan baru masuk belakangan). SENGAJA endpoint yang
    // SAMA dengan edit darurat PUBLISHED (reason wajib, audit trail
    // lastEditReason/lastEditedAt/lastEditedById yang sama) — bukan jalur
    // kedua yang bisa diam-diam berbeda. Cek admin pakai rolesOf() (D-010,
    // JANGAN pernah cek req.user.role === "ADMIN" langsung — field legacy,
    // admin yang cuma dapat role lewat "Pengguna & Peran" akan salah
    // ditolak kalau field lama yang dicek).
    const editingCompleted = route.status === "COMPLETED";
    if (editingCompleted && !rolesOf(req.user).includes("ADMIN")) {
      throw new ArmadaError("Rute yang sudah Selesai cuma bisa diedit oleh Admin", 403);
    }
    if ((editingPublished || editingCompleted) && !reason?.trim()) {
      throw new ArmadaError(`Rute sudah ${editingCompleted ? "Selesai" : "diterbitkan"} — wajib isi alasan untuk mengeditnya`);
    }
    if (!editingPublished && !editingCompleted && route.status !== "DRAFT") {
      throw new ArmadaError(`Rute berstatus ${route.status} tidak bisa diedit`);
    }
    // Dipakai di bawah untuk audit trail (lastEditReason/dst) DAN cascade
    // driver/helper/vehicle ke job — dua kondisi (PUBLISHED/COMPLETED) yang
    // sama-sama "rute terkunci, butuh alasan tercatat", diringkas satu flag.
    const editingLocked = editingPublished || editingCompleted;

    const updated = await prisma.$transaction(async (tx) => {
      const r = await tx.route.update({
        where: { id: req.params.id },
        data: {
          ...(driverId !== undefined && { driverId: driverId || null }),
          ...(helperId !== undefined && { helperId: helperId || null }),
          ...(vehicleId !== undefined && { vehicleId: vehicleId || null }),
          ...(notes !== undefined && { notes: notes?.trim() || null }),
          // manualMapsUrl (6 September 2026) — link Maps pendek ASLI
          // (maps.app.goo.gl) yang dispatcher tempel manual dari Google Maps
          // "Copy Link", lihat catatan panjang di formatRouteWaMessage.
          ...(manualMapsUrl !== undefined && { manualMapsUrl: manualMapsUrl?.trim() || null }),
          ...(editingLocked && {
            lastEditReason: reason.trim(),
            lastEditedAt: new Date(),
            lastEditedById: req.user.id,
          }),
        },
        include: routeInclude,
      });
      // Rute PUBLISHED sudah menyalin driver/helper/vehicle-nya ke SETIAP
      // job anggota saat diterbitkan (lihat POST /routes/:id/publish) — job
      // itulah yang benar-benar dibaca driver app, BUKAN Route.driverId.
      // Kalau field ini diedit di sini tanpa re-cascade, Route dan Job-nya
      // diam-diam beda ("desync") — dispatcher lihat driver baru di kartu
      // rute, tapi driver app/JobDetailDrawer masih tampilkan driver lama.
      //
      // status NOT IN (COMPLETED, FAILED) — BUG NYATA diperbaiki 6 September
      // 2026 (kasus ganti PIC darurat, mis. kecelakaan di tengah rute lalu
      // sisa stop dialihkan ke driver lain/Lalamove). SEBELUM ini, ganti
      // driver di sini menimpa SEMUA job termasuk yang SUDAH terkirim —
      // riwayat pengiriman jadi bilang stop yang sudah selesai dikirim
      // driver LAMA seolah dikirim driver BARU, padahal faktanya bukan.
      // Stop yang sudah tuntas (COMPLETED/FAILED) HARUS tetap mencatat
      // siapa yang benar-benar mengerjakannya — cuma stop yang belum
      // selesai yang wajar ikut penugasan baru.
      if (editingLocked && (driverId !== undefined || helperId !== undefined || vehicleId !== undefined)) {
        await tx.job.updateMany({
          where: { routeId: r.id, status: { notIn: ["COMPLETED", "FAILED"] } },
          data: { driverId: r.driverId, helperId: r.helperId, vehicleId: r.vehicleId },
        });
      }
      return r;
    });
    // Broadcast otomatis DICABUT dari sini (8 September 2026 — laporan
    // owner: "ada pengeditan jalur, ketika proses pengeditan itu tiba-tiba
    // auto broadcast beberapa kali padahal pengeditan rute belum selesai
    // dan belum klik tombol kirim ulang"). AKAR MASALAH: endpoint ini
    // dipanggil SEKALI PER PERUBAHAN (ganti driver, isi catatan saat blur,
    // tempel link Maps manual saat blur, dst) — satu sesi "Edit Darurat"
    // dispatcher WAJAR terdiri dari beberapa perubahan kecil berurutan,
    // dan SEBELUM ini TIAP perubahan itu langsung mengirim broadcast penuh
    // (gambar+teks) ke Natasha sendiri-sendiri — bukan cuma di akhir sesi
    // edit. Sekarang broadcast HANYA lewat aksi eksplisit dispatcher:
    // tombol "Kirim Ulang" (POST /routes/:id/resend-broadcast, RouteCard.jsx)
    // begitu mereka BENAR-BENAR selesai mengedit — audit trail
    // (lastEditReason/lastEditedAt/lastEditedById) TETAP tercatat di atas,
    // cuma pengiriman WA yang tidak lagi otomatis menempel di tiap PATCH.

    // Push notifikasi ke driver BARU (8 September 2026) — kasus ganti PIC
    // darurat mid-route (kecelakaan dst, lihat catatan cascade di atas).
    // HANYA saat driverId benar-benar berganti, bukan tiap PATCH lain di
    // sesi edit darurat yang sama (catatan/link Maps manual).
    if (editingLocked && driverId !== undefined && driverId && driverId !== route.driverId) {
      for (const j of updated.jobs.filter((j) => j.driverId === driverId && j.status !== "COMPLETED" && j.status !== "FAILED")) {
        notifyDriverJobAssigned(j).catch((err) =>
          console.error("[PATCH /routes/:id] Gagal kirim push ke driver:", err.message)
        );
      }
    }

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
// Sama syarat "reason wajib untuk PUBLISHED" dengan PATCH /routes/:id di
// atas — lihat catatan panjang di sana.
armadaRouter.patch("/routes/:id/jobs", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({ where: { id: req.params.id } });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });

    // Anggota LAMA rute ini SEBELUM diedit (12 September 2026) — dipakai
    // buat 2 hal: (1) hitung stop mana yang ditambah/dikeluarkan lewat
    // edit ini, (2) deteksi rute "sedang berjalan" (ada job EN_ROUTE/
    // ARRIVED/COMPLETED) supaya driver dapat notifikasi KHUSUS perubahan
    // mid-rute, lihat notifyDriverRouteChanged di bawah — BEDA dari
    // notifyDriverJobAssigned yang sudah ada (itu generik "job baru",
    // relevan untuk rute yang belum jalan).
    const anggotaLama = await prisma.job.findMany({ where: { routeId: route.id }, select: { id: true, status: true } });
    const IN_PROGRESS_STATUSES = ["EN_ROUTE", "ARRIVED", "COMPLETED"];
    const ruteSudahJalan = anggotaLama.some((j) => IN_PROGRESS_STATUSES.includes(j.status));

    const { reason } = req.body;
    const editingPublished = route.status === "PUBLISHED";
    // Tambah job ke rute SELESAI — admin only (8 September 2026, permintaan
    // owner langsung: "tambah orderan yang ketinggalan dong karna kesalahan
    // admin delivery ga cantumin salah satu order, padahal masuk jalur").
    // SAMA pola persis dengan PATCH /routes/:id (edit driver/kendaraan rute
    // Selesai) — reuse mekanisme yang SUDAH ada (reason wajib, admin-only,
    // audit trail), bukan endpoint kedua yang terpisah. Job yang DITAMBAH
    // TIDAK ikut tertimpa status/tanggalnya (lihat guard STATUS_TUNTAS di
    // bawah — job baru ini belum tuntas, jadi WAJAR dapat scheduledDate/PIC
    // rute ini, persis job yang menyusul masuk ke rute DRAFT biasa) — admin
    // tetap perlu tandai selesai + upload bukti manual sesudahnya lewat
    // JobDetailDrawer (Input Manual / Tambah Bukti, sudah ada).
    const editingCompleted = route.status === "COMPLETED";
    if (editingCompleted && !rolesOf(req.user).includes("ADMIN")) {
      throw new ArmadaError("Rute yang sudah Selesai cuma bisa diubah anggotanya oleh Admin", 403);
    }
    if ((editingPublished || editingCompleted) && !reason?.trim()) {
      throw new ArmadaError(`Rute sudah ${editingCompleted ? "Selesai" : "diterbitkan"} — wajib isi alasan untuk mengubah anggotanya`);
    }
    if (!editingPublished && !editingCompleted && route.status !== "DRAFT") {
      throw new ArmadaError(`Rute berstatus ${route.status} tidak bisa diubah anggotanya`);
    }

    const jobIds = Array.isArray(req.body.jobIds) ? req.body.jobIds : [];

    await prisma.$transaction(async (tx) => {
      // Lepas dulu job lama milik rute ini yang TIDAK ada di daftar baru.
      await tx.job.updateMany({
        where: { routeId: route.id, id: { notIn: jobIds } },
        data: { routeId: null, sequence: null },
      });
      // Status job yang SUDAH tuntas (dipakai 2 guard di bawah) — dicek
      // SEKALI di sini, bukan tebak-tebak per baris (6 September 2026, kasus
      // ganti PIC darurat/kecelakaan mid-rute).
      const STATUS_TUNTAS = ["COMPLETED", "FAILED"];
      const jobLama = await tx.job.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, status: true, driverId: true, helperId: true },
      });
      const statusJobLama = new Map(jobLama.map((j) => [j.id, j.status]));

      // Lalu tempel + urutkan yang baru. Satu per satu (bukan updateMany)
      // karena tiap job butuh nilai `sequence` BERBEDA.
      //
      // scheduledDate ikut disamakan ke Route.date (6 September 2026) — dulu
      // TIDAK disentuh sama sekali di sini, jadi job yang sebelumnya punya
      // scheduledDate lain (atau kosong) bisa diam-diam beda tanggal dari
      // rute yang menampungnya. Route.date sendiri TIDAK PERNAH bisa diedit
      // setelah rute dibuat (lihat PATCH /routes/:id — cuma driver/helper/
      // vehicle/notes yang diterima), jadi menyamakan di titik "masuk rute"
      // ini aman dan tidak akan diam-diam basi lagi belakangan.
      //
      // KECUALI job yang SUDAH TUNTAS (COMPLETED/FAILED) — kalau stop itu
      // masih ikut di jobIds (wajar, stop yang sudah selesai tetap anggota
      // rute), scheduledDate-nya JANGAN ditimpa jadi Route.date; itu tanggal
      // beneran dia dikerjakan, bukan tanggal rencana rute.
      for (let i = 0; i < jobIds.length; i++) {
        const tuntas = STATUS_TUNTAS.includes(statusJobLama.get(jobIds[i]));
        await tx.job.update({
          where: { id: jobIds[i] },
          data: { routeId: route.id, sequence: i + 1, ...(!tuntas && { scheduledDate: route.date }) },
        });
      }

      // Cascade PIC Rute -> job (6 September 2026, laporan owner: "ketika
      // drag card yang belum ada driver ke rute yang udah ada PIC-nya
      // [misal Agung & Diva], otomatis langsung terisi... lalu just in case
      // orderan itu pindah ke rute lain [Apri & Alwan], otomatis keubah
      // juga"). Dulu kaskade Route->Job CUMA jalan saat rute diterbitkan
      // (dulu cabang `editingPublished` di bawah) — rute DRAFT yang SUDAH
      // punya driver (baik dari prefill di bawah, atau dipilih manual
      // dispatcher) TIDAK PERNAH menyalinkan driver itu ke job BARU yang
      // menyusul masuk, jadi kartu job tetap "Belum ditugaskan" sampai rute
      // diterbitkan — padahal rutenya sendiri sudah jelas py PIC di layar.
      // Sekarang SATU aturan berlaku untuk DRAFT maupun PUBLISHED: begitu
      // rute SUDAH punya driver, SEMUA job anggotanya (lama maupun baru
      // saja ditempel/dipindah dari rute lain) ikut disalinkan — konsisten
      // dengan filosofi D-077 "Route otoritas penuh begitu job masuk rute",
      // sebelumnya cuma ditegakkan saat publish, sekarang tiap kali
      // membership rute berubah (drag masuk ATAU pindah antar-rute — job
      // yang dipindah ke rute lain otomatis lepas dari rute asalnya karena
      // routeId cuma bisa menunjuk SATU rute, jadi "pindah PIC" terjadi
      // wajar tanpa langkah tambahan).
      //
      // KECUALI job yang SUDAH TUNTAS (COMPLETED/FAILED) — sama alasan
      // dengan guard scheduledDate di atas (kasus ganti PIC darurat: stop
      // yang sudah terkirim tidak boleh ikut tertimpa).
      if (route.driverId) {
        await tx.job.updateMany({
          where: { routeId: route.id, status: { notIn: STATUS_TUNTAS } },
          data: { driverId: route.driverId, helperId: route.helperId, vehicleId: route.vehicleId },
        });
        await tx.job.updateMany({
          where: { routeId: route.id, status: "UNSCHEDULED" },
          data: { status: "ASSIGNED" },
        });
      } else if (!editingPublished) {
        // Auto-prefill driver/helper RUTE dari job yang di-drag masuk —
        // kebalikan dari kaskade di atas, cuma relevan kalau rute ini
        // MASIH KOSONG PIC-nya sama sekali: "1 rute dipegang pasti oleh 1
        // PIC", dispatcher tidak perlu pilih driver dua kali untuk
        // keputusan yang sama kalau job yang di-drag masuk kebetulan sudah
        // punya driver individual dari Jadwal & Penugasan. Ambil dari stop
        // PERTAMA (urutan jobIds) yang sudah punya driverId — bukan
        // majority vote, predictable & gampang dijelaskan. Rute PUBLISHED
        // TIDAK PERNAH masuk cabang ini (route.driverId wajib terisi
        // sebelum bisa diterbitkan, lihat POST /routes/:id/publish).
        const sumberDriver = jobIds.map((id) => jobLama.find((j) => j.id === id)).find((j) => j?.driverId);
        if (sumberDriver) {
          await tx.route.update({
            where: { id: route.id },
            data: { driverId: sumberDriver.driverId, helperId: sumberDriver.helperId || null },
          });
          // Rute BARU SAJA dapat driver dari prefill ini — susulkan kaskade
          // yang sama seperti di atas supaya SEMUA job di rute ini (bukan
          // cuma sumbernya sendiri) langsung konsisten, tanpa nunggu drag
          // berikutnya baru ke-trigger.
          await tx.job.updateMany({
            where: { routeId: route.id, status: { notIn: STATUS_TUNTAS } },
            data: { driverId: sumberDriver.driverId, helperId: sumberDriver.helperId || null },
          });
          await tx.job.updateMany({
            where: { routeId: route.id, status: "UNSCHEDULED" },
            data: { status: "ASSIGNED" },
          });
        }
      }

      // editingCompleted ikut dicatat di sini juga (8 September 2026) —
      // tanpa ini, menambah job "ketinggalan" ke rute Selesai tidak
      // meninggalkan jejak audit trail sama sekali (lastEditReason dkk),
      // padahal PATCH /routes/:id (edit driver/kendaraan) di atas SUDAH
      // mencatatnya untuk kasus yang sama.
      if (editingPublished || editingCompleted) {
        await tx.route.update({
          where: { id: route.id },
          data: { lastEditReason: reason.trim(), lastEditedAt: new Date(), lastEditedById: req.user.id },
        });
      }
    });

    const updated = await prisma.route.findUnique({ where: { id: route.id }, include: routeInclude });
    // Broadcast otomatis DICABUT dari sini (8 September 2026) — lihat
    // catatan panjang di PATCH /routes/:id di atas. Endpoint ini dipanggil
    // SEKALI PER DRAG (susun ulang/tambah/keluarkan stop) — 1 sesi edit
    // rute PUBLISHED yang menggeser beberapa stop SEBELUM ini mengirim
    // broadcast sebanyak jumlah drag-nya, bukan sekali di akhir. Sekarang
    // dispatcher WAJIB klik "Kirim Ulang" secara sadar begitu benar-benar
    // selesai mengedit.

    // Push notifikasi ke driver (8 September 2026) — rute bisa sudah
    // punya driver SEBELUM diterbitkan (kaskade drag/prefill di atas
    // membuat job langsung ASSIGNED walau rute masih DRAFT), jadi titik
    // "job baru" bisa terjadi DI SINI, bukan cuma saat publish. Best-effort,
    // sedikit redundan dengan notifikasi publish untuk job yang sama itu
    // tidak masalah (lebih baik driver dapat 2x alert daripada 0x).
    if (updated.driverId) {
      for (const j of updated.jobs) {
        notifyDriverJobAssigned(j).catch((err) =>
          console.error("[PATCH /routes/:id/jobs] Gagal kirim push ke driver:", err.message)
        );
      }
    }

    // Notifikasi KHUSUS "rute diubah di tengah jalan" (12 September 2026)
    // — cuma dikirim kalau rute ini SEBELUM diedit sudah punya job yang
    // sedang/sudah dikerjakan (ruteSudahJalan, dihitung di atas SEBELUM
    // transaksi) DAN anggotanya benar-benar berubah (bukan sekadar
    // susun-ulang urutan job yang sama — itu tidak butuh alert terpisah,
    // job list driver otomatis ikut urut baru).
    if (ruteSudahJalan) {
      const anggotaLamaIds = new Set(anggotaLama.map((j) => j.id));
      const anggotaBaruIds = new Set(jobIds);
      const addedCount = jobIds.filter((id) => !anggotaLamaIds.has(id)).length;
      const removedCount = anggotaLama.filter((j) => !anggotaBaruIds.has(j.id)).length;
      notifyDriverRouteChanged(updated, { addedCount, removedCount }).catch((err) =>
        console.error("[PATCH /routes/:id/jobs] Gagal kirim push perubahan rute:", err.message)
      );
    }

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
    //
    // BULAT-BALIK DARI/KE KLINIK (D-076, 4 September 2026) — laporan owner:
    // "buat semua jalur mulai dan berakhir di lokasi klinik matras". DEPOT
    // ditempel sebagai titik PERTAMA dan TERAKHIR sebelum dihitung, jadi
    // plannedDistanceKm/plannedDurationMin sekarang mencerminkan perjalanan
    // BENERAN driver (klinik→stop1→...→stopN→klinik), bukan cuma stop
    // pertama sampai stop terakhir. `route.jobs.length >= 2` DILONGGARKAN
    // jadi `>= 1` — DULU rute 1-stop tidak dapat estimasi sama sekali
    // (routeLegs butuh minimal 2 titik), sekarang selalu ada minimal 1 leg
    // (klinik↔stop) karena depot SELALU punya koordinat (konstanta tetap).
    let plannedDistanceKm = null, plannedDurationMin = null;
    const geocoded = route.jobs.filter((j) => j.lat != null && j.lng != null);
    if (geocoded.length === route.jobs.length && route.jobs.length >= 1) {
      try {
        const stopsRuteSaja = [...route.jobs].sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map((j) => ({ lat: j.lat, lng: j.lng }));
        const legs = await routeLegs([DEPOT, ...stopsRuteSaja, DEPOT]);
        let meters = 0, seconds = 0;
        for (const leg of legs) { if (leg) { meters += leg.distanceMeters; seconds += leg.durationSeconds; } }
        plannedDistanceKm = meters > 0 ? Math.round((meters / 1000) * 100) / 100 : null;
        plannedDurationMin = seconds > 0 ? Math.round(seconds / 60) : null;
      } catch {
        // Diamkan — publish tetap lanjut tanpa estimasi jarak.
      }
    }

    // KLAIM ATOMIK status DRAFT->PUBLISHED (8 September 2026 — laporan owner:
    // "broadcast ada duplicate... di 1 waktu dia bisa mengirim 2-3 pesan
    // duplicate yang sama"). AKAR MASALAH: `route.status !== "DRAFT"` di atas
    // dibaca SEBELUM transaksi ini dimulai — kalau dispatcher klik ganda
    // (atau klik lambat lalu klik lagi karena tombolnya BELUM sempat
    // `disabled` di render berikutnya, ada jeda nyata antara klik dan React
    // benar-benar menonaktifkan tombol), 2-3 request POST /publish nyaris
    // BERSAMAAN bisa SAMA-SAMA lolos pengecekan awal itu, sama-sama
    // menerbitkan, sama-sama memanggil kirimRingkasanRuteKeNatasha di bawah
    // — itu sumber "2-3 pesan duplicate" yang dilaporkan, BUKAN bug di
    // pengiriman WA-nya sendiri.
    //
    // FIX: `updateMany` dengan `where: {status: "DRAFT"}` ATOMIK di level
    // database — Postgres menjamin cuma SATU dari beberapa UPDATE bersamaan
    // yang benar-benar mengubah baris (row lock), sisanya `count` 0. Request
    // yang KALAH berhenti DI SINI (throw), tidak pernah sampai ke transaksi
    // job/kirim WA di bawahnya — jaminan SATU publish = SATU broadcast, apa
    // pun kecepatan klik dispatcher.
    const updatedRoute = await prisma.$transaction(async (tx) => {
      const klaim = await tx.route.updateMany({
        where: { id: route.id, status: "DRAFT" },
        data: { status: "PUBLISHED", publishedAt: new Date(), plannedDistanceKm, plannedDurationMin },
      });
      if (klaim.count === 0) {
        throw new ArmadaError("Rute ini baru saja diterbitkan (mungkin dari klik ganda) — muat ulang halaman untuk lihat status terbaru.");
      }
      // Salin rencana → penugasan berlaku. deriveStatus: job yang sebelumnya
      // UNSCHEDULED (belum py tanggal/driver) naik ke ASSIGNED sekarang juga
      // punya driver+kendaraan; job yang sudah lebih maju (mis. sudah
      // dijadwalkan manual sebelum masuk rute) status-nya TIDAK dimundurkan.
      await tx.job.updateMany({
        where: { routeId: route.id },
        // helperId ikut disalin (D-077) — DULU cuma driverId/vehicleId,
        // helper WAJIB diisi manual satu-satu di Penjadwalan walau rutenya
        // sendiri sudah lengkap. Sekarang Route otoritas PENUH begitu
        // diterbitkan, konsisten dengan guard PATCH /jobs/:id yang menolak
        // job ber-routeId diubah driver/helper/vehicle-nya lewat Penjadwalan.
        //
        // scheduledDate ikut disamakan (6 September 2026) — jaring pengaman
        // untuk job yang sempat masuk rute SEBELUM PATCH /routes/:id/jobs
        // mulai menyamakan tanggalnya sendiri (lihat komentar di sana);
        // tanpa ini job lama begitu bisa terlanjur publish dengan
        // scheduledDate basi walau sudah dipindah ke rute yang benar.
        data: { driverId: route.driverId, helperId: route.helperId, vehicleId: route.vehicleId, scheduledDate: route.date },
      });
      await tx.job.updateMany({
        where: { routeId: route.id, status: "UNSCHEDULED" },
        data: { status: "ASSIGNED" },
      });
      return tx.route.findUnique({ where: { id: route.id }, include: routeInclude });
    });

    // Kirim ringkasan rute + link Maps OTOMATIS (redesain Route Planner, Sep
    // 2026) — MENGGANTIKAN langkah manual "dispatcher susun rute sendiri di
    // Google Maps lalu copy-paste link ke grup WA". BEST-EFFORT murni:
    // publish SUDAH SELESAI (transaksi di atas commit), kegagalan kirim WA
    // di sini TIDAK BOLEH membatalkan publish yang sudah terjadi — cuma
    // dicatat ke log server.
    //
    // Target SEMENTARA chat pribadi Natasha, BUKAN grup driver — lihat
    // catatan lengkap di notifyNatashaText di atas.
    try {
      await ensureJobsGeocoded(updatedRoute.jobs);
      const { url } = buildRouteMapsUrl(updatedRoute.jobs);
      await kirimRingkasanRuteKeNatasha(updatedRoute, url);
    } catch (err) {
      console.error("[publish] Gagal kirim ringkasan rute ke Natasha:", err.message);
    }

    // Push notifikasi ke DRIVER (8 September 2026) — momen PALING SERING
    // jadi titik "job baru" yang sebenarnya driver lihat pertama kali,
    // lihat catatan panjang di services/pushNotifications.js. Best-effort,
    // TIDAK PERNAH menggagalkan response publish yang sudah sukses.
    for (const j of updatedRoute.jobs) {
      notifyDriverJobAssigned(j).catch((err) =>
        console.error("[publish] Gagal kirim push ke driver:", err.message)
      );
    }

    res.json(updatedRoute);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /routes/:id/resend-broadcast — kirim ULANG ringkasan rute + link Maps
// ke Natasha, TANPA mengedit apa pun (6 September 2026, laporan owner:
// "gimana cara gue share broadcast ulang" — jalur SATU-SATUNYA sebelum ini
// cuma lewat "Edit" darurat, yang mewajibkan alasan DAN tercatat sebagai
// riwayat edit [lastEditReason dkk] walau sebenarnya tidak ada yang
// berubah). Endpoint ini TIDAK menyentuh Route/Job sama sekali — murni
// kirim pesan, cocok dipakai kapan pun perlu ("driver bilang belum lihat",
// "mau dikirim ulang di pagi hari", dst), bukan hanya sekali saat publish.
//
// Label "📤 KIRIM ULANG" (beda dari publish tanpa label & edit "🔄 RUTE
// DIPERBARUI") — supaya Natasha tahu ini BUKAN rute baru ATAU koreksi,
// murni pengiriman ulang info yang sama.
armadaRouter.post("/routes/:id/resend-broadcast", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({ where: { id: req.params.id }, include: routeInclude });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });
    if (route.status !== "PUBLISHED") {
      throw new ArmadaError("Cuma rute yang sudah diterbitkan yang bisa dikirim ulang");
    }
    await ensureJobsGeocoded(route.jobs);
    const { url } = buildRouteMapsUrl(route.jobs);
    await kirimRingkasanRuteKeNatasha(route, url, "📤 KIRIM ULANG");
    res.json({ ok: true });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /routes/:id/test-broadcast — kirim ringkasan rute + link Maps ke
// Natasha SEBAGAI TES, TANPA mengubah status rute sama sekali (8 September
// 2026, permintaan owner: "buatkan tombol test draft... agar mudah testing
// dan kirim broadcast draft ke natasha, sebelum finalkan ini" — dipakai
// mengecek format pesan baru sebelum benar-benar menerbitkan rute).
//
// BEDA dari resend-broadcast di atas: itu KHUSUS PUBLISHED (kirim ULANG
// pesan yang SUDAH resmi terkirim sebelumnya). Ini sebaliknya — dirancang
// justru untuk DRAFT (rute yang BELUM diterbitkan sama sekali), supaya
// dispatcher bisa lihat persis bentuk pesan yang akan Natasha terima
// SEBELUM menekan "Terbitkan" sungguhan. Tetap dibolehkan untuk status
// apa pun (tidak ada guard status) — tidak ada ruginya, dan berguna juga
// untuk verifikasi ulang rute yang sudah PUBLISHED tanpa tercatat sebagai
// "Kirim Ulang" resmi.
//
// Label "🧪 TES DRAFT" ditempel SEBELUM label lain (kalau ada) supaya
// Natasha di WA langsung tahu ini BUKAN rute yang harus dijalankan —
// beda dari tanpa-label (publish resmi), "🔄 RUTE DIPERBARUI" (edit), atau
// "📤 KIRIM ULANG" (resend resmi).
armadaRouter.post("/routes/:id/test-broadcast", requirePermission(P.ROUTE_WRITE), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({ where: { id: req.params.id }, include: routeInclude });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });
    if (route.jobs.length === 0) throw new ArmadaError("Rute belum punya job — tambahkan job dulu sebelum tes broadcast");
    await ensureJobsGeocoded(route.jobs);
    const { url } = buildRouteMapsUrl(route.jobs);
    await kirimRingkasanRuteKeNatasha(route, url, "🧪 TES DRAFT — BUKAN RUTE FINAL, JANGAN DIJALANKAN");
    res.json({ ok: true });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /routes/:id/maps-link — link Google Maps multi-stop untuk tombol
// "Buat Peta" di Route Planner (redesain Sep 2026). Dipanggil manual oleh
// dispatcher (mis. untuk preview sebelum publish, atau share ulang secara
// manual) — TERPISAH dari kirim-otomatis-ke-grup di publish/edit di atas,
// yang keduanya juga memanggil buildRouteMapsUrl() yang SAMA (satu sumber
// kebenaran, bukan dua cara membangun URL yang bisa diam-diam beda).
armadaRouter.get("/routes/:id/maps-link", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    // order.locationUrl (7 September 2026) — dipakai ensureJobsGeocoded() di
    // bawah. Query ini SEBELUMNYA cuma `jobs: true` (tanpa order sama
    // sekali) — akar kenapa tombol ini tidak pernah bisa memakai link Maps
    // order walau field-nya sudah ada, lihat catatan panjang di
    // ensureJobsGeocoded/services/maps.js#geocodeAddress.
    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: { jobs: { include: { order: { select: { locationUrl: true } } } } },
    });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });
    await ensureJobsGeocoded(route.jobs);
    res.json(buildRouteMapsUrl(route.jobs));
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /routes/:id/map — link Maps rute untuk tombol "Buka Rute di Maps" di
// app/web driver (10 Sep 2026, laporan owner: "1 rute yang berisi link
// google maps yang di-upload admin delivery di web tampilkan juga di apps
// ... source-nya harus sama dengan yang diinput admin delivery").
//
// PRESEDEN PERSIS SAMA dengan formatRouteWaMessage (broadcast WA):
// route.manualMapsUrl (link pendek yang admin TEMPEL manual di Route Card)
// kalau ada — kalau kosong, fallback ke buildRouteMapsUrl() auto multi-stop.
// Satu sumber kebenaran, bukan cara ketiga membangun link.
//
// Beda dari /maps-link di atas (khusus dispatcher, SELALU auto-generate
// untuk preview sebelum tempel manual) — endpoint ini menghormati link
// manual, dan driver/helper yang mengerjakan rute ini juga boleh akses.
armadaRouter.get("/routes/:id/map", requireAnyPermission(P.JOB_READ, P.JOB_OWN_READ), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: { jobs: { include: { order: { select: { locationUrl: true } } } } },
    });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });

    if (!hasPermission(req.user, P.JOB_READ)) {
      const milikSaya =
        route.driverId === req.user.id || route.helperId === req.user.id ||
        route.jobs.some((j) => j.driverId === req.user.id || j.helperId === req.user.id);
      if (!milikSaya) return res.status(403).json({ error: "Bukan rute Anda" });
    }

    const manual = route.manualMapsUrl?.trim();
    if (manual) return res.json({ url: manual, source: "manual", stopCount: route.jobs.length });

    await ensureJobsGeocoded(route.jobs);
    const { url, stopCount, excludedCount } = buildRouteMapsUrl(route.jobs);
    res.json({ url, source: "auto", stopCount, excludedCount });
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
  // status/category/statusLocked (6 September 2026, laporan owner:
  // "pastikan bisa diedit statusnya di... proof of delivery") — SEBELUM
  // ini order.select di sini cuma id/orderNumber/customer, jadi
  // OrderStatusBadge & StatusSelect (edit status langsung dari POD) tidak
  // bisa jalan sama sekali di halaman ini walau sudah dipasang di Route
  // Planner/Jadwal & Penugasan — beda dari jobInclude.order.select di
  // atas yang sudah lengkap, override sempit ini yang ketinggalan.
  order: {
    select: {
      id: true, orderNumber: true, status: true, category: true, statusLocked: true,
      customer: { select: { id: true, name: true, phone: true } },
    },
  },
  podVerifiedBy: { select: { id: true, name: true } },
  podEditedBy: { select: { id: true, name: true } },
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
  // rescheduleCaseId (D-160, 13 September 2026) — OR tambahan, BUKAN
  // pengganti rescheduleReason. Jalur PROACTIVE sekarang MENULIS
  // rescheduleReason juga (lihat PATCH /jobs/:id di atas), tapi data lama
  // dari SEBELUM perbaikan ini cuma punya rescheduleCaseId sebagai
  // penanda — dua-duanya dicek supaya job lama & baru sama-sama kebaca.
  const pernahDireschedule = !!(job.rescheduleReason || job.rescheduleCaseId);
  if (job.status === "FAILED") return pernahDireschedule ? "RESCHEDULED" : "OPEN";
  // Job yang sudah lewat dari FAILED (SCHEDULED/ASSIGNED/dst setelah
  // di-reschedule) tapi PERNAH gagal — riwayatnya tetap relevan ditelusuri.
  if (pernahDireschedule) return "RESCHEDULED";
  return null;
}

armadaRouter.get("/issues", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { status } = req.query; // OPEN | RESCHEDULED
    const jobs = await prisma.job.findMany({
      where: {
        OR: [{ status: "FAILED" }, { rescheduleReason: { not: null } }, { rescheduleCaseId: { not: null } }],
        // Order dibatalkan (13 September 2026, laporan owner — kasus nyata
        // Mizroza/RES-10092026-050: driver sampai rumah, customer batal
        // sepihak, sales membatalkan order lewat POST /orders/:id/cancel
        // -> gagalkanJobAktif menandai job FAILED otomatis dengan alasan
        // "Order dibatalkan sales", TIDAK PERNAH dimaksudkan actionable)
        // TIDAK PERNAH relevan di sini — tidak ada apa pun yang bisa
        // "dijadwalkan ulang" untuk order yang sudah mati. SENGAJA hanya
        // dicek kalau order-nya ADA (order: null mustahil di skema, tapi
        // defensif) — job tanpa order sama sekali tetap lolos filter ini.
        order: { status: { not: "CANCELLED" } },
      },
      include: {
        ...jobInclude,
        order: { select: { id: true, orderNumber: true, customer: { select: { id: true, name: true, phone: true } } } },
        rescheduledBy: { select: { id: true, name: true } },
        rescheduleCase: { select: { id: true, caseNumber: true, status: true, round: true, cancelReason: true } },
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

    const { job: updated, kase } = await prisma.$transaction(async (tx) => {
      const j = await tx.job.update({
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
          // BUG FIX (D-160, 13 September 2026, audit skema reschedule) —
          // job gagal yang direschedule SEBELUM ini tetap menunjuk routeId
          // lamanya selamanya. Kalau rute itu kebetulan rute lain di
          // dalamnya sudah semua tuntas, syncRouteCompletionStatus SUDAH
          // menandainya COMPLETED — job aktif ini jadi nyangkut diam-diam
          // di rute yang sudah "hijau" (persis pola kasus Alwan/
          // RTE-110926-01, sumber beda). Rute lama tidak lagi relevan
          // untuk tanggal/driver BARU job ini — dilepas total, dispatcher
          // sadar menambahkannya lagi ke rute yang tepat lewat Route
          // Planner kalau memang mau digabung rute.
          routeId: null, sequence: null,
        },
        include: jobInclude,
      });
      // Riwayat lengkap (D-110) — lihat komentar panjang di schema.prisma
      // model JobIssueLog. previousScheduledDate diambil dari job SEBELUM
      // update (biasanya null — job gagal biasanya masih memegang tanggal
      // lama sampai titik ini, tapi diambil dari data asli, bukan diasumsikan).
      await tx.jobIssueLog.create({
        data: {
          jobId: job.id, type: "RESCHEDULED", cause: "AFTER_FAILURE",
          previousScheduledDate: job.scheduledDate, newScheduledDate: nextDate,
          rescheduleReason: reason.trim(), customerConfirmed: !!customerConfirmed,
          createdById: req.user.id,
        },
      });
      // Kasus reschedule tersatukan (D-160) — lihat catatan panjang di
      // services/rescheduleCase.js.
      const k = await openOrAdvanceCase(tx, {
        job, cause: "AFTER_FAILURE", reason: reason.trim(),
        previousScheduledDate: job.scheduledDate, newScheduledDate: nextDate,
        customerConfirmed, userId: req.user.id,
      });
      return { job: j, kase: k };
    });
    notifySalesJobRescheduled(updated, kase).catch((err) =>
      console.error("[POST /issues/:jobId/reschedule] Gagal kirim push ke sales:", err.message)
    );
    res.json({ ...updated, issueStatus: deriveIssueStatus(updated), rescheduleCase: kase });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /jobs/:id/reschedule-note — CATATAN reschedule RETROAKTIF khusus job
// yang SUDAH Selesai (6 September 2026, laporan owner: contoh nyata job
// Pengambilan Julhan — scheduledDate 2 Sep, baru benar-benar dikerjakan/
// completedAt 5 Sep, tapi TIDAK ADA cara mencatat "ini sempat mundur dari
// rencana" karena job Selesai terkunci total dari editing, dan jalur
// reschedule yang sudah ada (di atas) CUMA bisa dipakai dari status Gagal).
//
// SENGAJA TIDAK sama dengan /issues/:jobId/reschedule di atas — endpoint
// itu MENYALAKAN ULANG job (ubah tanggal/driver/status, keluar dari Gagal).
// Ini BUKAN itu: job yang statusnya sudah COMPLETED TIDAK PERNAH berubah
// status/tanggal/driver-nya lewat sini — cuma menambahkan alasan+jejak
// waktu ke field rescheduleReason/rescheduledAt/rescheduledById yang SAMA
// (field-nya sudah ada di skema, dipakai bersama), murni supaya riwayat
// tercatat jujur untuk laporan (job ini otomatis ikut muncul di GET /issues
// sebagai "RESCHEDULED" begitu rescheduleReason terisi — lihat
// deriveIssueStatus di atas, TIDAK perlu endpoint/tampilan terpisah).
//
// scheduledDate (rencana awal) & completedAt (kapan benar-benar selesai)
// TIDAK diulang di sini sebagai input — dua-duanya SUDAH ada di job apa
// adanya, endpoint ini cuma menambahkan ALASAN kenapa dua tanggal itu beda.
armadaRouter.post("/jobs/:id/reschedule-note", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: "Job tidak ditemukan" });
    if (job.status !== "COMPLETED") {
      throw new ArmadaError("Catatan reschedule di sini khusus job yang sudah Selesai — job berstatus Gagal pakai jalur reschedule biasa, job aktif tinggal ganti tanggal langsung.");
    }

    const { reason, customerConfirmed } = req.body;
    if (!reason?.trim()) throw new ArmadaError("Alasan reschedule wajib diisi");

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
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

// POST /reschedule-cases/:id/cancel — dispatcher menutup kasus reschedule
// secara eksplisit (D-160, 13 September 2026 — mis. order dibatalkan
// total, tidak jadi diambil/diantar sama sekali). Lihat catatan panjang di
// services/rescheduleCase.js#cancelCase — TIDAK menyentuh job-nya sama
// sekali, cuma menutup kasusnya supaya tidak nyangkut AKTIF selamanya.
armadaRouter.post("/reschedule-cases/:id/cancel", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const { reason } = req.body;
    const updated = await prisma.$transaction((tx) => cancelCase(tx, req.params.id, reason));
    res.json(updated);
  } catch (err) {
    if (err instanceof RescheduleCaseError) return res.status(err.statusCode).json({ error: err.message });
    handleErr(err, res);
  }
});

// POST /reschedule-cases/:id/notify-customer — kirim WA "jadwal Anda
// berubah" ke customer, TAPI manual (dispatcher klik sendiri), BUKAN
// otomatis (D-160, 13 September 2026). SENGAJA tidak auto-fire dari
// openOrAdvanceCase — customerNotifications.js menegaskan batas KETAT
// "persis 4 notifikasi WA customer" dari PRD, dan 3 dari 4 itu sendiri
// SEDANG DIMATIKAN atas keputusan owner ("sales pegang manual dulu
// komunikasi jadwal ke customer") — menambah trigger otomatis kelima di
// sini akan melanggar batas itu tanpa izin eksplisit. Tombol manual
// tetap memberi nilai (1 klik, bukan pindah ke WA manual) tanpa
// melanggar kebijakan yang sudah didokumentasikan.
armadaRouter.post("/reschedule-cases/:id/notify-customer", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const kase = await prisma.rescheduleCase.findUnique({ where: { id: req.params.id }, include: rescheduleCaseInclude });
    if (!kase) return res.status(404).json({ error: "Kasus reschedule tidak ditemukan" });
    const customer = kase.job?.order?.customer;
    if (!customer?.phone) throw new ArmadaError("Customer belum punya nomor HP tercatat");

    const tipe = kase.job.type === "PICKUP" ? "pengambilan" : "pengiriman";
    const tanggalBaru = kase.newScheduledDate
      ? new Date(kase.newScheduledDate).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" })
      : "-";
    const pesan = `Halo ${customer.name || ""}, jadwal ${tipe} untuk pesanan${kase.job.order?.orderNumber ? ` ${kase.job.order.orderNumber}` : ""} sudah diperbarui menjadi *${tanggalBaru}*. Mohon maaf atas perubahan ini. Terima kasih 🙏`;

    await sendCustomerText(customer.id, pesan);
    const updated = await prisma.rescheduleCase.update({
      where: { id: kase.id }, data: { customerNotifiedAt: new Date() },
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /armada/pod?status=&from=&to= — `from`/`to` (D-085, 5 September 2026,
// laporan owner: "tambahkan tanggal seperti yang lain") memfilter
// `scheduledDate`, BUKAN `completedAt` — sengaja, supaya SEMUA status POD
// (termasuk "Belum Lengkap", yang sering kali job-nya belum sempat
// completedAt sama sekali) tetap konsisten kena filter yang sama. Kalau
// dipakai `completedAt`, tab "Belum Lengkap" akan selalu kosong begitu
// rentang tanggal dipersempit (job yang belum selesai jelas tidak punya
// completedAt), padahal itu justru status yang paling perlu ditindak.
armadaRouter.get("/pod", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const { status, from, to } = req.query; // status: INCOMPLETE | PENDING_REVIEW | VERIFIED | REJECTED
    // Basis query: hanya job yang PERNAH menyelesaikan kunjungan (COMPLETED)
    // ATAU sedang berjalan tapi relevan dipantau — spesifikasi tab "Semua"
    // termasuk "Belum Lengkap", jadi basisnya tidak dibatasi ke COMPLETED
    // saja. Batasnya: job yang statusnya UNSCHEDULED murni (belum berangkat
    // sama sekali) tidak relevan untuk halaman bukti serah terima.
    // Digabung jadi SATU objek scheduledDate (bukan dua spread terpisah) —
    // dua `...(cond && { scheduledDate: {...} })` yang sama-sama menulis
    // key "scheduledDate" akan SALING MENIMPA kalau from & to dua-duanya
    // dikirim (yang satu hilang diam-diam), persis kesalahan yang sudah
    // pernah dibetulkan di GET /orders (routes/orders.js, `customerWhere`).
    const scheduledDateFilter = {
      ...(from && { gte: toDateOnly(from) }),
      // Batas EKSKLUSIF (bukan `lte` mentah) — kolom DATE, `lte` bisa
      // membuang seluruh hari terakhir tergantung representasi jam
      // penyimpanannya. Pola yang sama dipakai di seluruh app (lihat
      // catatan di GET /armada/jobs & routes/analytics.js).
      ...(to && { lt: new Date(toDateOnly(to).getTime() + 86_400_000) }),
    };
    const jobs = await prisma.job.findMany({
      where: {
        status: { notIn: ["UNSCHEDULED"] },
        ...(Object.keys(scheduledDateFilter).length > 0 && { scheduledDate: scheduledDateFilter }),
      },
      include: PIC_INCLUDE_FOR_POD,
      // NULLS LAST (9 September 2026, laporan owner: "urutannya ini sesuai
      // apa ya? gue merasa ini ngacak banget aja") — SEBELUMNYA `desc` polos,
      // yang di Postgres berarti NULL duluan. Mayoritas job "Belum Lengkap"
      // (job belum dijadwalkan ke rute) punya completedAt DAN scheduledDate
      // dua-duanya null, jadi dua kunci sortir itu SAMA-SAMA kosong untuk
      // ratusan baris sekaligus — urutan di antara mereka jadi tidak
      // bermakna sama sekali (kelihatan acak), sementara job yang justru
      // paling relevan (baru selesai/terjadwal) malah tenggelam di bawah.
      // NULLS LAST membalik itu: job dengan tanggal ASLI naik ke atas,
      // terurut dari yang paling baru, job tanpa tanggal sama sekali
      // (paling tidak actionable) turun ke bawah.
      orderBy: [
        { completedAt: { sort: "desc", nulls: "last" } },
        { scheduledDate: { sort: "desc", nulls: "last" } },
      ],
      // Batas dinaikkan dari 500 (9 September 2026, ditemukan lewat audit
      // langsung: 582 job eligible di production, 500 di antaranya SAJA yang
      // pernah sampai ke halaman ini — 82 job lain diam-diam TIDAK PERNAH
      // muncul sama sekali, persis akar "gue kesulitan cari order" yang
      // dilaporkan owner. Pola sama dengan perbaikan batas GET /orders
      // [1 September 2026]: alat internal admin, bukan endpoint publik,
      // volume ribuan masih jauh dari berat bagi query ini.
      take: 3000,
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

// PATCH /api/armada/pod/:jobId/edit { proofPhotoUrls?, completedAt?, driverId?,
// helperId?, reason } — koreksi ADMIN atas Proof of Delivery yang SUDAH
// tersimpan (9 September 2026, laporan owner: "ketika proof of delivery
// sudah di input buat fitur edit khusus admin, karna namanya sistem baru,
// pasti karyawan masih banyak salah"). Beda dari PATCH /jobs/:id/proof-photos
// (menambah foto, dorong ke array lama) — endpoint ini MENGGANTI apa yang
// tersimpan (foto, waktu selesai, driver/helper), untuk kasus foto salah
// upload/waktu keliru dicatat/driver salah pilih, bukan "ada bukti susulan".
//
// Admin only — pola SAMA dengan PATCH /routes/:id (rolesOf(), BUKAN
// req.user.role langsung, lihat catatan panjang di sana) — dispatcher biasa
// tetap bisa VERIFY/REJECT (P.JOB_WRITE), tapi mengubah data yang sudah
// tercatat perlu wewenang lebih tinggi. `reason` WAJIB (audit trail
// podEditReason/podEditedBy/podEditedAt) — pola sama dengan Route.lastEditReason.
//
// Efek samping SENGAJA: podStatus dikosongkan (podVerifiedById/At ikut null,
// podRejectionNote ikut null) begitu ADA perubahan proofPhotoUrls — bukti
// yang jadi dasar verifikasi/penolakan SEBELUMNYA sudah berbeda dari yang
// sekarang, status lama tidak boleh "menempel" ke bukti baru tanpa ditinjau
// ulang. derivePodStatus() otomatis menghitung ulang jadi PENDING_REVIEW
// (masih ada foto) begitu podStatus null — tidak perlu logika status
// terpisah di sini. Edit yang HANYA mengubah completedAt/driver/helper
// (tanpa mengubah foto) TIDAK mereset podStatus — bukti fotonya sendiri
// tidak berubah, tidak ada alasan meminta verifikasi ulang.
armadaRouter.patch("/pod/:jobId/edit", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    if (!rolesOf(req.user).includes("ADMIN")) {
      throw new ArmadaError("Koreksi Proof of Delivery cuma bisa dilakukan Admin", 403);
    }
    const job = await prisma.job.findUnique({ where: { id: req.params.jobId } });
    if (!job) return res.status(404).json({ error: "Job tidak ditemukan" });
    if (job.status !== "COMPLETED") {
      throw new ArmadaError(`Job berstatus ${job.status}, belum ada bukti tersimpan untuk dikoreksi`);
    }

    const { reason, completedAt, driverId, helperId } = req.body;
    if (!reason?.trim()) throw new ArmadaError("Alasan koreksi wajib diisi");

    let proofPhotoUrls;
    if (req.body.proofPhotoUrls !== undefined) {
      proofPhotoUrls = Array.isArray(req.body.proofPhotoUrls) ? req.body.proofPhotoUrls : [];
      if (proofPhotoUrls.length === 0) throw new ArmadaError("Minimal 1 foto bukti wajib ada");
      const isValidUrl = (u) => typeof u === "string" && u.startsWith("/media/job-photos/");
      if (!proofPhotoUrls.every(isValidUrl)) throw new ArmadaError("URL foto tidak valid");
    }

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        ...(proofPhotoUrls !== undefined && {
          proofPhotoUrls,
          podStatus: null, podVerifiedById: null, podVerifiedAt: null, podRejectionNote: null,
        }),
        ...(completedAt && { completedAt: new Date(completedAt) }),
        ...(driverId !== undefined && { driverId: driverId || null }),
        ...(helperId !== undefined && { helperId: helperId || null }),
        podEditedById: req.user.id,
        podEditedAt: new Date(),
        podEditReason: reason.trim(),
      },
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
        // Job usang (D-064, lihat catatan lengkap di services/jobStatus.js)
        // — order induknya sudah DELIVERED/CANCELLED lewat jalur lain,
        // job-nya sendiri tidak pernah disentuh sama sekali (masih
        // UNSCHEDULED). Laporan owner: order lama seperti "Hotel Discovery"
        // yang sudah Terkirim di Sales CRM tetap nangkring selamanya di
        // Papan sebagai "Belum Dijadwalkan"/"Belum ada driver".
        NOT: STALE_UNSCHEDULED_JOB,
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

    // `routeId: null` (D-077) — job yang sudah masuk Route diurutkan LEWAT
    // Route Planner (PATCH /routes/:id/jobs, menulis `sequence` yang sama),
    // BUKAN lewat sini. Tanpa filter ini, drag-drop di Penjadwalan bisa
    // menimpa urutan yang baru saja disusun dispatcher di Route Planner —
    // dua fitur menulis kolom `sequence` yang sama tanpa saling tahu.
    const group = await prisma.job.findMany({
      where: { driverId, type, scheduledDate: toDateOnly(date), status: { in: ACTIVE_JOB_STATUSES }, routeId: null },
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

    // `routeId: null` (D-077) — endpoint ini dipakai DriverRouteGroup di
    // Penjadwalan, yang sejak D-077 cuma menampilkan+mengurutkan job yang
    // BELUM masuk Route (job yang sudah dirutekan punya jarak/durasi
    // sendiri dari Route.plannedDistanceKm/plannedDurationMin, dihitung
    // saat diterbitkan — lihat POST /routes/:id/publish). Tanpa filter ini,
    // job routed & non-routed tercampur satu ringkasan yang membingungkan.
    const jobs = await prisma.job.findMany({
      where: { driverId, type, scheduledDate: toDateOnly(date), status: { in: ACTIVE_JOB_STATUSES }, routeId: null },
      include: jobInclude,
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
    });

    // BULAT-BALIK DARI/KE KLINIK (D-076, 4 September 2026) — laporan owner:
    // "buat semua jalur mulai dan berakhir di lokasi klinik matras". SATU
    // panggilan routeLegs untuk [DEPOT, ...stop, DEPOT] sekaligus — leg
    // pertama & terakhir (klinik↔stop) dipakai HANYA untuk total jarak/
    // durasi, BUKAN masuk ke `legs` yang dikembalikan ke frontend: array
    // `legs` di sini dipakai Armada.jsx sebagai `legToNext` berindeks per
    // JOB (legs[i] = job[i]→job[i+1]) — kalau depot ikut disisipkan di
    // situ, indeksnya akan geser dan salah tempel ke job yang salah.
    // `jobs.length >= 1` (bukan >= 2 seperti sebelumnya) — depot SELALU
    // punya koordinat, jadi rute 1 stop pun sekarang dapat estimasi
    // (klinik→stop→klinik), yang sebelumnya sama sekali tidak dihitung
    // karena routeLegs butuh minimal 2 titik.
    const geocoded = jobs.filter((j) => j.lat != null && j.lng != null);
    let legs = [];
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    let legsError = null;
    if (geocoded.length === jobs.length && jobs.length >= 1) {
      try {
        const semuaLeg = await routeLegs([DEPOT, ...jobs.map((j) => ({ lat: j.lat, lng: j.lng })), DEPOT]);
        legs = semuaLeg.slice(1, -1); // buang leg depot di depan & belakang, sisakan job→job asli
        for (const leg of semuaLeg) {
          if (leg) { totalDistanceMeters += leg.distanceMeters; totalDurationSeconds += leg.durationSeconds; }
        }
      } catch (err) {
        legsError = err.message;
      }
    } else if (jobs.length >= 1) {
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

// POST /api/armada/me/online-status — toggle Online/Offline driver (12
// September 2026, referensi Gojek/Grab driver app, permintaan owner).
// MURNI status, BUKAN "terima order" (order sudah ditentukan PIC-nya oleh
// dispatcher) — kegunaannya gerbang GPS tracking sisi klien: driver-mobile
// BERHENTI mengirim ping posisi sama sekali begitu Offline, apa pun status
// job-nya (lihat useDriverTracking.js RN). requireAuth polos (bukan
// JOB_OWN_WRITE) — endpoint ini murni menulis status MILIK SENDIRI
// (req.user.id), siapa pun yang login boleh, sama pola dengan POST
// /push/subscribe di atas.
armadaRouter.post("/me/online-status", requireAuth, async (req, res) => {
  try {
    const online = !!req.body.online;
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { isOnline: online, onlineSince: online ? new Date() : null },
      select: { id: true, isOnline: true, onlineSince: true },
    });
    res.json(user);
  } catch (err) {
    handleErr(err, res);
  }
});

// ─── Web Push (8 September 2026) — subscribe/unsubscribe device driver ─────
// requireAuth polos (BUKAN requirePermission JOB_OWN_READ) — SIAPA PUN yang
// login boleh subscribe device-nya sendiri (dispatcher/admin juga masuk akal
// mau dapat notifikasi kalau suatu hari relevan), gerbangnya ada di SIAPA
// yang benar-benar dikirimi (job.driverId di notifyDriverJobAssigned), bukan
// di endpoint subscribe ini.
armadaRouter.get("/push/vapid-public-key", requireAuth, (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) return res.status(503).json({ error: "Push notification belum dikonfigurasi" });
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

armadaRouter.post("/push/subscribe", requireAuth, async (req, res) => {
  try {
    const { endpoint, keys } = req.body?.subscription || req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      throw new ArmadaError("Subscription tidak valid (endpoint/keys wajib)");
    }
    // Upsert by endpoint (bukan by userId) — endpoint UNIK per
    // browser+device (kontrak Push API), jadi kunci alami untuk "subscribe
    // ulang" (mis. buka lagi di HP yang sama tidak bikin baris dobel).
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: req.user.id, p256dh: keys.p256dh, auth: keys.auth },
      create: { userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    });
    res.json({ ok: true });
  } catch (err) {
    handleErr(err, res);
  }
});

armadaRouter.post("/push/unsubscribe", requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) throw new ArmadaError("endpoint wajib diisi");
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user.id } });
    res.json({ ok: true });
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
      // locationUrl (7 September 2026) — dipakai geocoding job di bawah,
      // lihat catatan panjang di bestEffortGeocode/services/maps.js.
      include: { order: { select: { status: true, locationUrl: true } } },
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

    const geo = addressText ? await bestEffortGeocode(addressText, units[0]?.order?.locationUrl) : null;

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
    // order.locationUrl (7 September 2026) — dipakai geocoding di bawah kalau
    // addressText berubah, lihat catatan panjang di bestEffortGeocode.
    const existing = await prisma.job.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { order: { select: { locationUrl: true } } },
    });
    if (!["UNSCHEDULED", "SCHEDULED", "ASSIGNED"].includes(existing.status)) {
      throw new ArmadaError(`Job berstatus ${existing.status} tidak bisa diubah lagi lewat sini`);
    }
    const { scheduledDate, driverId, helperId, vehicleId, timeWindow, addressText, accessNotes, estimatedDurationMinutes, rescheduleReason, customerConfirmed } = req.body;

    // SATU SKEMA PENUGASAN (D-077, 4 September 2026) — laporan owner:
    // driver+helper+kendaraan dulu bisa diisi 2 JALUR berbeda (langsung di
    // sini, ATAU di level Route lalu diterbitkan) yang saling menimpa diam-
    // diam saat publish. Sekarang: begitu job punya routeId, Route jadi
    // SATU-SATUNYA otoritas untuk ketiga field itu — endpoint ini MENOLAK
    // (bukan cuma UI yang menyembunyikan tombol) perubahan driverId/
    // helperId/vehicleId untuk job yang sudah masuk rute. Job TANPA
    // routeId (belum masuk rute manapun) tetap bebas diubah langsung di
    // sini seperti sebelumnya — jalur cepat untuk kasus 1 stop sederhana
    // TIDAK dihilangkan, cuma tidak lagi bisa tabrakan dengan Route Planner.
    if (existing.routeId && (driverId !== undefined || helperId !== undefined || vehicleId !== undefined)) {
      const route = await prisma.route.findUnique({ where: { id: existing.routeId }, select: { code: true } });
      throw new ArmadaError(
        `Job ini sudah masuk rute ${route?.code || "?"} — driver/helper/kendaraan diatur di Route Planner, bukan di sini.`
      );
    }

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
      const geo = addressText ? await bestEffortGeocode(addressText, existing.order?.locationUrl) : null;
      data.lat = geo?.lat ?? null;
      data.lng = geo?.lng ?? null;
    }

    const nextDriverId = driverId !== undefined ? driverId : existing.driverId;
    const nextDate = scheduledDate !== undefined ? data.scheduledDate : existing.scheduledDate;
    data.status = deriveStatus(!!nextDriverId, !!nextDate);

    // Reschedule PROAKTIF wajib alasan (9 September 2026, D-110) — sebelum
    // ini, reschedule SETELAH gagal (POST /issues/:jobId/reschedule) wajib
    // alasan + centang konfirmasi pelanggan, tapi reschedule di sini (belum
    // pernah gagal, dispatcher edit tanggal langsung — mis. "pelanggan
    // telepon minta digeser") TIDAK mencatat alasan sama sekali, tanggal
    // berubah diam-diam tanpa jejak. Cuma berlaku untuk perubahan tanggal
    // yang SUDAH TERISI ke tanggal LAIN — job yang baru pertama kali dapat
    // tanggal (existing.scheduledDate null) itu PENJADWALAN AWAL, bukan
    // reschedule, tidak butuh alasan.
    const isReschedule = existing.scheduledDate != null && nextDate != null
      && new Date(existing.scheduledDate).getTime() !== new Date(nextDate).getTime();
    if (isReschedule && !rescheduleReason?.trim()) {
      throw new ArmadaError("Job ini sudah punya tanggal — jelaskan alasan reschedule-nya (mis. permintaan pelanggan)");
    }
    if (isReschedule) {
      // Job.rescheduleReason dkk SEBELUM ini TIDAK PERNAH terisi lewat
      // jalur proaktif (D-160, 13 September 2026, audit skema reschedule)
      // — cuma ditulis ke JobIssueLog, jadi konsumen yang baca field
      // Job.rescheduleReason langsung (RiwayatRevisiKendala, GET /issues)
      // diam-diam kelewat untuk reschedule proaktif. Disamakan dengan
      // jalur AFTER_FAILURE di atas.
      data.rescheduleReason = rescheduleReason.trim();
      data.rescheduledAt = new Date();
      data.rescheduledById = req.user.id;
      data.customerConfirmedReschedule = !!customerConfirmed;
      // BUG FIX yang sama dengan POST /issues/:jobId/reschedule — job
      // routed yang tanggalnya digeser menyimpang dari Route.date tidak
      // boleh diam-diam tetap menunjuk rute lamanya (rute itu dibangun
      // utk tanggal LAMA). Dilepas total, konsisten dengan filosofi
      // "Route otoritas penuh begitu job masuk rute" (D-077) — kebalikannya
      // juga berlaku, job yang keluar dari rencana rute keluar dari rute.
      if (existing.routeId) { data.routeId = null; data.sequence = null; }
    }

    const { job, kase } = await prisma.$transaction(async (tx) => {
      const j = await tx.job.update({ where: { id: req.params.id }, data, include: jobInclude });
      let k = null;
      if (isReschedule) {
        await tx.jobIssueLog.create({
          data: {
            jobId: j.id, type: "RESCHEDULED", cause: "PROACTIVE",
            previousScheduledDate: existing.scheduledDate, newScheduledDate: nextDate,
            rescheduleReason: rescheduleReason.trim(), customerConfirmed: !!customerConfirmed,
            createdById: req.user.id,
          },
        });
        k = await openOrAdvanceCase(tx, {
          job: existing, cause: "PROACTIVE", reason: rescheduleReason.trim(),
          previousScheduledDate: existing.scheduledDate, newScheduledDate: nextDate,
          customerConfirmed, userId: req.user.id,
        });
      }
      return { job: j, kase: k };
    });
    if (kase) {
      notifySalesJobRescheduled(job, kase).catch((err) =>
        console.error("[PATCH /jobs/:id] Gagal kirim push ke sales (reschedule):", err.message)
      );
    }

    // Push notifikasi (8 September 2026) — HANYA saat driver benar-benar
    // BARU/BERGANTI (bukan tiap PATCH lain, mis. ubah catatan/jam) supaya
    // tidak spam notifikasi untuk edit yang tidak relevan bagi driver.
    if (driverId !== undefined && driverId && driverId !== existing.driverId) {
      notifyDriverJobAssigned(job).catch((err) =>
        console.error("[PATCH /jobs/:id] Gagal kirim push ke driver:", err.message)
      );
    }

    res.json(kase ? { ...job, rescheduleCase: kase } : job);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /jobs/:id/external-courier — nomor order/tracking & ongkos Lalamove
// (D-161, 13 September 2026). Endpoint TERPISAH dari PATCH /jobs/:id di
// atas SENGAJA — dua field ini murni administratif (dicatat dispatcher
// kapan pun infonya tersedia, kadang baru diketahui SETELAH unit sudah
// diambil/dikirim), tidak boleh terkunci oleh guard status ketat PATCH
// /jobs/:id (UNSCHEDULED/SCHEDULED/ASSIGNED saja). Tidak ada guard
// "driver harus isExternalCourier" — dispatcher yang tahu konteksnya,
// field yang tidak relevan cukup dibiarkan kosong (tidak tampil di UI).
armadaRouter.patch("/jobs/:id/external-courier", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const { externalCourierRef, externalCourierCost } = req.body;
    const data = {};
    if (externalCourierRef !== undefined) data.externalCourierRef = externalCourierRef?.trim() || null;
    if (externalCourierCost !== undefined) {
      const cost = externalCourierCost === null || externalCourierCost === "" ? null : Number(externalCourierCost);
      if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new ArmadaError("Ongkos tidak valid");
      data.externalCourierCost = cost;
    }
    if (Object.keys(data).length === 0) throw new ArmadaError("Tidak ada field yang diubah");

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

// GET /armada/routes/:id/route-trace — jalur perjalanan sungguhan driver
// (map-matched dari GPS ping) + estimasi ruas tol yang dilalui (8 September
// 2026, permintaan owner: "tracking driver lewat jalan mana aja... tol mana
// aja, dan akumulasi biayanya, walaupun tidak akurat 100%"). Lihat catatan
// panjang di services/routeTracking.js untuk batas kejujuran fitur ini —
// SEMUA angka di sini WAJIB ditandai "Estimasi" oleh pemanggil (frontend),
// TIDAK PERNAH disajikan sebagai tagihan pasti.
armadaRouter.get("/routes/:id/route-trace", requirePermission(P.JOB_READ), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });
    const trace = await traceRoute(route.id);
    res.json(trace);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs/:id/start — driver mulai perjalanan.
//
// proofPhotoUrls WAJIB (8 September 2026, permintaan owner — referensi
// Lalamove/Gojek "dokumentasi tiap proses", dikonfirmasi AskUserQuestion
// mencakup SEMUA tahap) — SEBELUMNYA tahap ini tidak minta apa-apa sama
// sekali. Validasi SAMA PERSIS dengan /complete /fail di bawah (URL harus
// dari upload dir job-photos), disimpan ke Job.startPhotoUrls.
armadaRouter.post("/jobs/:id/start", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), async (req, res) => {
  try {
    const job = await loadOwnedJob(req);
    if (job.status !== "ASSIGNED") throw new ArmadaError(`Job berstatus ${job.status}, tidak bisa dimulai`);

    // Foto TIDAK lagi wajib di start per-job (10 Sep 2026, keputusan owner:
    // "hanya driver memulai perjalanan RUTE" yang perlu dokumentasi — lihat
    // POST /routes/:id/start yang tetap wajib foto muatan). Start per-job
    // ini jalur cadangan untuk job lepas (tanpa rute) — 1 ketuk, tanpa foto.
    const startPhotoUrls = Array.isArray(req.body.proofPhotoUrls) ? req.body.proofPhotoUrls : [];
    const isValidUrl = (u) => typeof u === "string" && u.startsWith("/media/job-photos/");
    if (!startPhotoUrls.every(isValidUrl)) throw new ArmadaError("URL foto tidak valid");

    await prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id: job.id }, data: { status: "EN_ROUTE", startPhotoUrls } });
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
      // Auto-Online (12 September 2026, keputusan owner: semi-otomatis —
      // Offline wajib manual, tapi Online boleh otomatis begitu driver
      // mulai job pertama hari itu, jaga-jaga lupa tap). `isOnline: false`
      // di where = no-op kalau sudah Online, tidak mereset onlineSince
      // tanpa alasan. Driver DAN helper (kalau ada) sama-sama dianggap
      // mulai kerja.
      const pelakuId = [job.driverId, job.helperId].filter(Boolean);
      if (pelakuId.length > 0) {
        await tx.user.updateMany({ where: { id: { in: pelakuId }, isOnline: false }, data: { isOnline: true, onlineSince: new Date() } });
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

// POST /api/armada/routes/:id/start — MULAI SATU RUTE SEKALIGUS (10 Sep
// 2026, laporan owner: "misal ada 7 jalur di 1 mobil yang sama, apakah
// harus foto mulai perjalanan satu per satu?"). Satu mobil = satu kali
// berangkat dari bengkel; foto muatan diambil SEKALI lalu menempel ke
// semua job ASSIGNED di rute ini. Efeknya PERSIS sama dengan memanggil
// POST /jobs/:id/start satu-satu (status EN_ROUTE, unit DELIVERY jadi
// IN_TRANSIT_OUT + sync status order, notif "driver menuju lokasi" ke
// tiap customer) — cuma dikerjakan sekali jalan.
//
// Job yang BUKAN ASSIGNED (mis. sudah EN_ROUTE karena driver start manual,
// atau masih SCHEDULED) dilewati diam-diam — bukan error, batch cuma
// mengurus yang memang siap.
armadaRouter.post("/routes/:id/start", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), async (req, res) => {
  try {
    const route = await prisma.route.findUniqueOrThrow({ where: { id: req.params.id } });

    const startPhotoUrls = Array.isArray(req.body.proofPhotoUrls) ? req.body.proofPhotoUrls : [];
    if (startPhotoUrls.length === 0) throw new ArmadaError("Foto bukti wajib diisi sebelum mulai perjalanan");
    const isValidUrl = (u) => typeof u === "string" && u.startsWith("/media/job-photos/");
    if (!startPhotoUrls.every(isValidUrl)) throw new ArmadaError("URL foto tidak valid");

    const semuaJob = await prisma.job.findMany({ where: { routeId: route.id } });
    const bolehSemua = hasPermission(req.user, P.JOB_WRITE);
    const target = semuaJob.filter(
      (j) => j.status === "ASSIGNED" &&
        (bolehSemua || j.driverId === req.user.id || j.helperId === req.user.id)
    );
    if (target.length === 0) throw new ArmadaError("Tidak ada job 'Siap Dimulai' di rute ini");

    await prisma.$transaction(async (tx) => {
      for (const job of target) {
        await tx.job.update({ where: { id: job.id }, data: { status: "EN_ROUTE", startPhotoUrls } });
        if (job.type === "DELIVERY") {
          const jobUnits = await tx.jobUnit.findMany({ where: { jobId: job.id } });
          const unitIds = jobUnits.map((ju) => ju.unitId);
          await tx.unit.updateMany({ where: { id: { in: unitIds } }, data: { status: "IN_TRANSIT_OUT" } });
          await syncOrderStatusForUnits(tx, unitIds);
        }
      }
      // Auto-Online (12 September 2026) — sama alasan dgn POST
      // /jobs/:id/start, dikumpulkan dari SELURUH job yang dimulai batch
      // ini (rute biasanya 1 driver+helper, tapi dikumpulkan generik
      // jaga-jaga ada campuran).
      const pelakuId = [...new Set(target.flatMap((j) => [j.driverId, j.helperId]).filter(Boolean))];
      if (pelakuId.length > 0) {
        await tx.user.updateMany({ where: { id: { in: pelakuId }, isOnline: false }, data: { isOnline: true, onlineSince: new Date() } });
      }
    });

    const full = await prisma.job.findMany({ where: { id: { in: target.map((j) => j.id) } }, include: jobInclude });
    for (const j of full) {
      const customer = j.units[0]?.unit?.order?.customer;
      if (customer) notifyDriverEnRoute(j, customer.id, customer.name);
    }

    res.json({ started: full.length, jobs: full });
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs/:id/arrive — driver tiba di lokasi.
//
// Foto TIDAK wajib saat tiba (10 Sep 2026, keputusan owner: "kalo udah
// tiba di lokasi gaperlu dokumentasi"). Dokumentasi cuma di 2 titik:
// mulai perjalanan RUTE (foto muatan) & serah terima BERHASIL (foto
// bukti di /complete) — plus /fail (foto + alasan, tetap wajib). Kalau
// driver tetap kirim foto opsional saat tiba, tetap disimpan.
armadaRouter.post("/jobs/:id/arrive", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), async (req, res) => {
  try {
    const job = await loadOwnedJob(req);
    if (job.status !== "EN_ROUTE") throw new ArmadaError(`Job berstatus ${job.status}, belum bisa ditandai tiba`);

    const arrivalPhotoUrls = Array.isArray(req.body.proofPhotoUrls) ? req.body.proofPhotoUrls : [];
    const isValidUrl = (u) => typeof u === "string" && u.startsWith("/media/job-photos/");
    if (!arrivalPhotoUrls.every(isValidUrl)) throw new ArmadaError("URL foto tidak valid");

    const updated = await prisma.job.update({
      where: { id: job.id }, data: { status: "ARRIVED", arrivedAt: new Date(), arrivalPhotoUrls }, include: jobInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/jobs/:id/complete
// { proofPhotoUrls, signatureUrl?, completedAt?, driverId?, helperId?, note? }
// FR-D-03/FR-D-04: foto kondisi (pickup) / penempatan (delivery) — WAJIB.
// signatureUrl OPSIONAL (lihat catatan di schema.prisma) — lapisan tambahan,
// bukan syarat blocking.
//
// SCHEDULED/ASSIGNED ditambahkan ke status yang boleh diselesaikan (D-086,
// 5 September 2026) — laporan owner: adopsi app driver belum penuh, bukti
// serah terima banyak yang masih dikirim manual lewat WhatsApp ke admin
// (bukan lewat app driver, yang seharusnya mengubah status job EN_ROUTE→
// ARRIVED dulu sebelum bisa selesai). Ini JEMBATAN SEMENTARA selama transisi
// itu, BUKAN pelonggaran alur normal — driver yang benar-benar pakai app
// tetap wajar lewat EN_ROUTE→ARRIVED seperti biasa, keduanya tetap ada di
// daftar. Dipakai PodReviewDrawer.jsx (skema input manual) di frontend.
//
// completedAt/driverId/helperId OPSIONAL (D-087, 5 September 2026) —
// laporan owner: "waktu selesai bisa di update manual, tambahkan detail
// driver, helper yang bertanggung jawab". Ketiganya TIDAK dikirim app
// driver (yang jalur normalnya: completedAt = saat itu juga, driver/helper
// = job.driverId/helperId yang sudah ada) — kalau tidak dikirim, PERILAKU
// LAMA berlaku (completedAt = sekarang, driverId/helperId job TIDAK
// disentuh). Cuma dipakai skema input manual, ketika admin tahu job ini
// SEBENARNYA selesai kapan & siapa yang mengerjakannya (dari laporan WA),
// bukan "sekarang, entah siapa".
armadaRouter.post("/jobs/:id/complete", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), async (req, res) => {
  try {
    const job = await loadOwnedJob(req);
    if (!["SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"].includes(job.status)) {
      throw new ArmadaError(`Job berstatus ${job.status}, belum bisa diselesaikan`);
    }
    const proofPhotoUrls = Array.isArray(req.body.proofPhotoUrls) ? req.body.proofPhotoUrls : [];
    if (proofPhotoUrls.length === 0) throw new ArmadaError("Foto bukti wajib diisi sebelum menyelesaikan job");
    const isValidUrl = (u) => typeof u === "string" && u.startsWith("/media/job-photos/");
    if (!proofPhotoUrls.every(isValidUrl)) throw new ArmadaError("URL foto tidak valid");
    const { signatureUrl, completedAt, driverId, helperId } = req.body;
    if (signatureUrl != null && !isValidUrl(signatureUrl)) throw new ArmadaError("URL tanda tangan tidak valid");

    let waktuSelesai = new Date();
    if (completedAt !== undefined) {
      const parsed = new Date(completedAt);
      if (Number.isNaN(parsed.getTime())) throw new ArmadaError("Waktu selesai tidak valid");
      waktuSelesai = parsed;
    }

    const { job: updated, advancedRevisions, advancedComplaintCaseId } = await prisma.$transaction(async (tx) => {
      const j = await tx.job.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED", completedAt: waktuSelesai, proofPhotoUrls, signatureUrl: signatureUrl || null,
          ...(driverId !== undefined && { driverId: driverId || null }),
          ...(helperId !== undefined && { helperId: helperId || null }),
        },
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
      await syncRouteCompletionStatus(tx, job.routeId);
      // Tutup kasus reschedule (D-160, 13 September 2026) — job yang PERNAH
      // direschedule dan AKHIRNYA benar-benar Selesai menutup kasusnya
      // sendiri di sini, pola sama dengan auto-advance UnitRevision/
      // ComplaintCase di bawah. No-op diam-diam kalau job ini tidak pernah
      // punya kasus reschedule sama sekali.
      await closeCaseOnJobComplete(tx, job.id);
      // Auto-advance UnitRevision (9 September 2026, D-109) — job ini bisa
      // saja bukan job pengiriman/pengambilan pertama order (lihat
      // POST /revisions/:id/create-pickup-job & create-delivery-job), jadi
      // begitu SELESAI, revisi yang menunjuk ke job ini harus otomatis maju
      // tanpa dispatcher perlu buka drawer revisi terpisah untuk klik lagi.
      // `status` lama di where SEKALIGUS jadi guard — kalau revisinya sudah
      // dipindah tangan manual ke status lain (jarang, tapi mungkin), tidak
      // ada yang cocok di sini dan auto-advance diam-diam tidak melakukan
      // apa-apa alih-alih menimpa keputusan manusia.
      //
      // Diambil sbg findMany (bukan langsung updateMany) supaya bisa memicu
      // notifyProductionRevisionReady di bawah — updateMany tidak
      // mengembalikan baris yang tersentuh.
      const revisiUntukDiajukan = await tx.unitRevision.findMany({
        where: {
          jobId: job.id,
          status: job.type === "PICKUP" ? "PICKUP_SCHEDULED" : "READY_REDELIVER",
        },
        select: {
          id: true,
          trigger: true,
          unit: { select: { unitCode: true, order: { select: { orderNumber: true } } } },
        },
      });
      if (revisiUntukDiajukan.length > 0) {
        await tx.unitRevision.updateMany({
          where: { id: { in: revisiUntukDiajukan.map((r) => r.id) } },
          data: { status: job.type === "PICKUP" ? "IN_REWORK" : "REDELIVERED" },
        });
      }

      // Auto-advance ComplaintCase (D-116, 11 September 2026) — POLA PERSIS
      // SAMA dengan auto-advance UnitRevision di atas, di dalam TRANSAKSI &
      // `jobUnits` yang SAMA: job pengambilan/inspeksi yang lahir dari
      // POST /complaints/:id/delivery-task (DIJADWALKAN) selesai → kasus
      // maju ke DALAM_PENANGANAN (unit sudah di tangan tim); job pengiriman
      // ulang (DIKIRIM_ULANG) selesai → kasus maju ke KONFIRMASI_CUSTOMER
      // (giliran Sales follow-up). `status` lama di where SEKALIGUS jadi
      // guard yang sama seperti UnitRevision — kalau kasus sudah dipindah
      // manual ke status lain, auto-advance diam-diam tidak melakukan apa-apa.
      let advancedComplaintCaseId = null;
      if (job.complaintCaseId) {
        const expectedStatus = job.type === "PICKUP" ? "DIJADWALKAN" : "DIKIRIM_ULANG";
        const nextStatus = job.type === "PICKUP" ? "DALAM_PENANGANAN" : "KONFIRMASI_CUSTOMER";
        const nextOwner = job.type === "PICKUP" ? "PRODUCTION" : "SALES";
        const kase = await tx.complaintCase.findFirst({ where: { id: job.complaintCaseId, status: expectedStatus } });
        if (kase) {
          await tx.complaintCase.update({ where: { id: kase.id }, data: { status: nextStatus, currentOwner: nextOwner } });
          await recordActivity(tx, {
            entityType: ENTITY_TYPES.COMPLAINT, entityId: kase.id, eventType: EVENT_TYPES.COMPLAINT_STATUS_CHANGED,
            actorId: req.user.id,
            metadata: { from: expectedStatus, to: nextStatus, note: `Job ${job.type === "PICKUP" ? "pengambilan" : "pengiriman ulang"} selesai` },
          });
          advancedComplaintCaseId = kase.id;
        }
      }

      return { job: j, advancedRevisions: job.type === "PICKUP" ? revisiUntukDiajukan : [], advancedComplaintCaseId };
    });
    const full = await prisma.job.findUnique({ where: { id: updated.id }, include: jobInclude });

    // Best-effort, TIDAK PERNAH menggagalkan response job yang sudah beres —
    // lihat komentar notifyDriverGroup di atas.
    const headline = job.type === "PICKUP" ? "✅ Pengambilan selesai" : "✅ Pengiriman selesai";
    notifyDriverGroup(full, proofPhotoUrls, headline).catch((err) =>
      console.error("[jobs/:id/complete] notifyDriverGroup gagal:", err.message)
    );

    // Notifikasi WA ke sales pemilik order (9 Sep 2026, permintaan owner:
    // sistem broadcast) — best-effort, staged (enabled:false default),
    // lihat catatan header services/deliveryCompletionNotify.js. Dua
    // notifier TERPISAH (pesan & topic StaffBroadcast beda) — kegagalan
    // salah satu tidak menggagalkan yang lain.
    notifySalesJobCompleted(updated).catch((err) =>
      console.error("[jobs/:id/complete] notifySalesJobCompleted gagal:", err.message)
    );
    notifySalesUnpaidAfterDelivery(updated).catch((err) =>
      console.error("[jobs/:id/complete] notifySalesUnpaidAfterDelivery gagal:", err.message)
    );

    // Push ke Produksi (D-109) — cuma untuk PICKUP yang barusan membawa unit
    // revisi pulang (IN_REWORK); job DELIVERY biasa/redelivery tidak relevan
    // untuk mereka. Lihat komentar panjang di notifyProductionRevisionReady.
    advancedRevisions.forEach((r) =>
      notifyProductionRevisionReady(r).catch((err) =>
        console.error("[jobs/:id/complete] notifyProductionRevisionReady gagal:", err.message)
      )
    );

    // Complaint Case auto-advance (D-116) — divisi yang BARU pegang bola
    // (Produksi setelah pickup, Sales setelah redelivery) diberi tahu
    // SEKARANG, pola sama dengan notifyProductionRevisionReady di atas.
    if (advancedComplaintCaseId) {
      prisma.complaintCase.findUnique({ where: { id: advancedComplaintCaseId } })
        .then((kase) => kase && notifyComplaintCaseOwnerChanged(kase))
        .catch((err) => console.error("[jobs/:id/complete] notifyComplaintCaseOwnerChanged gagal:", err.message));
    }

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

// PATCH /api/armada/jobs/:id/proof-photos { proofPhotoUrls }
// Tambah bukti SETELAH job sudah COMPLETED (8 September 2026, laporan owner
// — screenshot job Irpus/RES-27082026-177: sudah "Terkirim" tapi tidak bisa
// upload bukti pengambilan/pengiriman manual sama sekali). Akar masalahnya:
// endpoint /complete di atas cuma menerima job yang BELUM Selesai (SCHEDULED/
// ASSIGNED/EN_ROUTE/ARRIVED) — begitu status sudah COMPLETED (termasuk
// banyak job hasil backfill sesi ini: selesaikanJobBelumJalan/
// adminBypassProduction, SENGAJA tanpa foto supaya jujur "Belum Lengkap" di
// POD), tidak ada jalur menambahkan buktinya lagi kalau ternyata belakangan
// ada (customer kirim susulan, dst).
//
// SENGAJA endpoint terpisah dari /complete — job.status TIDAK berubah lagi
// (sudah COMPLETED), tidak ada transisi unit/order/rute yang perlu disentuh,
// murni menambah array proofPhotoUrls yang sudah ada (push, BUKAN replace —
// foto lama yang sudah terunggah tetap dipertahankan).
armadaRouter.patch("/jobs/:id/proof-photos", requireAnyPermission(P.JOB_WRITE, P.JOB_OWN_WRITE), async (req, res) => {
  try {
    const job = await loadOwnedJob(req);
    if (job.status !== "COMPLETED") {
      throw new ArmadaError(`Job berstatus ${job.status}, bukan Selesai — pakai tombol Selesaikan biasa, bukan jalur ini`);
    }
    const tambahan = Array.isArray(req.body.proofPhotoUrls) ? req.body.proofPhotoUrls : [];
    if (tambahan.length === 0) throw new ArmadaError("Minimal 1 foto wajib diunggah");
    const isValidUrl = (u) => typeof u === "string" && u.startsWith("/media/job-photos/");
    if (!tambahan.every(isValidUrl)) throw new ArmadaError("URL foto tidak valid");

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { proofPhotoUrls: { push: tambahan } },
      include: jobInclude,
    });
    res.json(updated);
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
      await syncRouteCompletionStatus(tx, job.routeId);
      // Riwayat lengkap (9 September 2026, D-110) — lihat komentar panjang
      // di schema.prisma model JobIssueLog. Job.failureReason/
      // failurePhotoUrls di atas cuma menyimpan kegagalan TERAKHIR; baris
      // ini snapshot-nya supaya kalau job ini gagal LAGI nanti (setelah
      // sempat dijadwalkan ulang), kegagalan yang SEKARANG tidak hilang
      // tertimpa tanpa jejak.
      await tx.jobIssueLog.create({
        data: {
          jobId: job.id, type: "FAILED",
          failureReason, failurePhotoUrls,
          createdById: req.user.id,
        },
      });
      return j;
    });
    const full = await prisma.job.findUnique({ where: { id: updated.id }, include: jobInclude });

    notifyDriverGroup(full, failurePhotoUrls, `❌ Gagal: ${failureReason}`).catch((err) =>
      console.error("[jobs/:id/fail] notifyDriverGroup gagal:", err.message)
    );

    // Push ke sales pemilik order (D-110) — sebelum ini, sales cuma bisa
    // tahu pengambilan/pengiriman customer-nya GAGAL kalau kebetulan buka
    // Semua Order dan lihat badge merah "Gagal" (persis pola silo yang sama
    // dengan komplain sebelum diperbaiki). Best-effort, tidak boleh
    // menggagalkan response job yang sudah beres ditandai gagal.
    notifySalesJobFailed(full).catch((err) =>
      console.error("[jobs/:id/fail] notifySalesJobFailed gagal:", err.message)
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

// Label singkat per trigger — dipakai di accessNotes job pickup/delivery
// revisi & notifikasi (services/pushNotifications.js). SATU sumber, bukan
// ternary GARANSI/lainnya yang diam-diam salah label begitu trigger ke-3
// (KOMPLAIN_ANTAR, 10 Sep 2026) ditambahkan.
const REVISION_TRIGGER_LABEL = {
  KENYAMANAN: "trial kenyamanan",
  GARANSI: "klaim garansi",
  KOMPLAIN_ANTAR: "komplain saat antar",
};

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
//
// ⚠️ Order.hasComplaint disinkronkan di sini (9 September 2026, D-111) —
// ditemukan lewat pengecekan live production: order Sulaeman Iskandar
// (RES-21082026-121) punya UnitRevision REQUESTED aktif (diajukan lewat
// Delivery > Retur, RevisionRequestDrawer.jsx, endpoint ini), TAPI
// Order.hasComplaint tetap `false` — badge "Ada Komplain" di Sales CRM
// (OrderSection.jsx) dan Semua Order (ArmadaOrders.jsx/ProductionOrders.jsx,
// lihat D-109) TIDAK PERNAH menyala untuk kasus ini, walau Produksi/Delivery
// sedang aktif menangani klaimnya. Sebabnya: dua jalur pencatatan komplain
// yang SAMA SEKALI TERPISAH sejak awal — PATCH /orders/:id/complaint (tombol
// "+ Ajukan Revisi/Komplain" di Sales CRM) menulis Order.hasComplaint TANPA
// pernah membuat UnitRevision, sementara endpoint ini (dipakai Delivery)
// membuat UnitRevision TANPA pernah menyentuh Order.hasComplaint — sales
// yang tidak kebetulan buka Delivery > Retur tidak akan pernah tahu
// customer-nya sedang komplain.
//
// complaintResolvedAt/By SENGAJA di-null-kan lagi di sini — kalau order ini
// SEBELUMNYA pernah komplain lalu sudah tuntas, revisi baru ini adalah
// SIKLUS BARU yang belum selesai (pola sama dengan PATCH /orders/:id/
// complaint, lihat komentar di sana).
armadaRouter.post("/revisions", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const { unitId, trigger, complaint } = req.body;
    if (!unitId) throw new ArmadaError("Unit wajib dipilih");
    if (!["KENYAMANAN", "GARANSI", "KOMPLAIN_ANTAR"].includes(trigger)) throw new ArmadaError("Jenis revisi tidak valid");
    if (!complaint?.trim()) throw new ArmadaError("Keluhan/alasan wajib diisi");

    const unit = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan" });
    if (unit.status !== "DELIVERED") throw new ArmadaError("Hanya unit yang sudah terkirim yang bisa diajukan revisi");

    const revision = await prisma.$transaction(async (tx) => {
      const r = await tx.unitRevision.create({
        data: { unitId, trigger, complaint: complaint.trim(), createdById: req.user.id },
      });
      await tx.order.update({
        where: { id: unit.orderId },
        data: {
          hasComplaint: true,
          complaintDate: new Date(),
          complaintDetail: complaint.trim(),
          complaintResolvedAt: null,
          complaintResolvedById: null,
        },
      });
      return r;
    });
    const full = await prisma.unitRevision.findUnique({ where: { id: revision.id }, include: unitRevisionInclude });
    res.status(201).json(full);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/armada/revisions/:id — perbarui status/job/catatan. CONFIRMED
// otomatis mengisi confirmedAt; CANCELLED wajib catatan alasan.
//
// ⚠️ Permission diperluas (9 September 2026, D-109) — SEBELUMNYA endpoint ini
// terkunci total ke JOB_WRITE (dispatcher/admin), padahal transisi
// IN_REWORK→READY_REDELIVER ("unit selesai direvisi, siap dikirim ulang")
// keputusannya ada di TANGAN PRODUKSI (yang benar-benar mengerjakan
// revisinya), bukan dispatcher — itulah gap "Produksi tidak terlibat sama
// sekali" yang ditemukan di kasus Dewi. requireAnyPermission meloloskan
// JOB_WRITE (semua transisi, seperti sebelumnya) ATAU UNIT_STAGE_WRITE, tapi
// UNIT_STAGE_WRITE dibatasi lebih ketat DI DALAM handler — hanya transisi
// IN_REWORK→READY_REDELIVER persis, field lain (jobId/note/status lain)
// tetap ditolak untuknya. Ini SENGAJA bukan permission baru — pinjam
// UNIT_STAGE_WRITE yang sudah dipegang PRODUCTION_LEAD/PRODUCTION_WORKER/
// QC_LEAD (lihat constants/permissions.js), sama seperti mereka memajukan
// tahap unit lainnya.
armadaRouter.patch("/revisions/:id", requireAnyPermission(P.JOB_WRITE, P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const existing = await prisma.unitRevision.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Revisi tidak ditemukan" });

    const { status, jobId, note } = req.body;
    const bolehSemua = hasPermission(req.user, P.JOB_WRITE);

    if (!bolehSemua) {
      // Jalur PRODUCTION_LEAD/PRODUCTION_WORKER/QC_LEAD (UNIT_STAGE_WRITE
      // saja, tanpa JOB_WRITE) — HANYA transisi status IN_REWORK→
      // READY_REDELIVER, tidak boleh mengubah jobId/note atau status lain
      // (itu ranah dispatcher: menjadwalkan job, membatalkan revisi, dst).
      if (jobId !== undefined || note !== undefined) {
        throw new ArmadaError("Tidak punya izin mengubah field ini — hanya bisa menandai revisi selesai dikerjakan");
      }
      if (status !== "READY_REDELIVER" || existing.status !== "IN_REWORK") {
        throw new ArmadaError("Tidak punya izin untuk transisi status ini");
      }
    }

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

    // Auto-resolve komplain Order (D-109) — begitu revisi dikonfirmasi
    // customer (puas dengan hasil revisi), komplain yang memicunya di Sales
    // CRM ikut ditandai tuntas OTOMATIS, tanpa sales perlu tahu/klik lagi di
    // halaman lain. hasComplaint SENGAJA TIDAK direset (lihat komentar
    // panjang di schema.prisma) — cuma complaintResolvedAt/By yang diisi.
    const revision = await prisma.$transaction(async (tx) => {
      const r = await tx.unitRevision.update({
        where: { id: req.params.id },
        data,
        include: { ...unitRevisionInclude, unit: { select: { orderId: true } } },
      });
      if (status === "CONFIRMED") {
        const order = await tx.order.findUnique({ where: { id: r.unit.orderId }, select: { hasComplaint: true, complaintResolvedAt: true } });
        if (order?.hasComplaint && !order.complaintResolvedAt) {
          await tx.order.update({
            where: { id: r.unit.orderId },
            data: { complaintResolvedAt: new Date(), complaintResolvedById: req.user.id },
          });
        }
      }
      return r;
    });
    // unit di atas cuma dipilih orderId untuk logic — response tetap pakai
    // bentuk unitRevisionInclude yang lengkap (unit.order.customer, dst).
    const full = await prisma.unitRevision.findUnique({ where: { id: revision.id }, include: unitRevisionInclude });
    res.json(full);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/revisions/:id/create-delivery-job (9 September 2026,
// D-109) — pasangan create-pickup-job di bawah: begitu revisi mencapai
// READY_REDELIVER (Produksi sudah selesai mengerjakan ulang), dispatcher
// butuh job PENGIRIMAN baru untuk mengantar balik ke customer. Sama seperti
// kasus pickup, unit ini statusnya DELIVERED (dari pengiriman pertama) —
// job normal (POST /jobs) akan menolaknya (lihat guard `expectedStatus`
// di bawah). SENGAJA menimpa `jobId` (bukan menolak kalau sudah terisi
// seperti create-pickup-job) — di titik ini jobId masih menunjuk job
// PENGAMBILAN lama yang sudah COMPLETED, dan field itu merepresentasikan
// "job yang relevan di fase SEKARANG", bukan riwayat semua job revisi ini.
armadaRouter.post("/revisions/:id/create-delivery-job", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const revision = await prisma.unitRevision.findUnique({
      where: { id: req.params.id },
      include: {
        unit: { select: { id: true, unitCode: true, orderId: true } },
        job: { select: { id: true, type: true, status: true } },
      },
    });
    if (!revision) return res.status(404).json({ error: "Revisi tidak ditemukan" });
    if (revision.status !== "READY_REDELIVER") {
      throw new ArmadaError(`Revisi berstatus ${revision.status} — job pengiriman cuma relevan setelah unit selesai direvisi (Siap Dikirim Ulang)`);
    }
    // Guard duplikat (ditemukan lewat review sendiri, 9 September 2026) —
    // BEDA dari create-pickup-job (yang menolak kalau jobId SUDAH TERISI
    // apa pun isinya), endpoint ini SENGAJA menimpa jobId (lihat komentar
    // panjang di atas), jadi tombol "Buat Job Pengiriman" di drawer TETAP
    // tampil setelah job pertama dibuat (revision.status baru berubah dari
    // READY_REDELIVER saat job itu SELESAI, bukan saat dibuat) — tanpa guard
    // ini, dispatcher yang membuka ulang drawer & klik tombol lagi diam-diam
    // membuat job PENGIRIMAN KEDUA yang tidak pernah ketahuan (jobId
    // ditimpa, job pertama jadi yatim di Jadwal & Penugasan).
    if (revision.job?.type === "DELIVERY" && ACTIVE_JOB_STATUSES.includes(revision.job.status)) {
      throw new ArmadaError("Revisi ini sudah punya job pengiriman aktif — buka job-nya lewat Jadwal & Penugasan, jangan buat baru");
    }

    const jobId = await prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          type: "DELIVERY",
          orderId: revision.unit.orderId,
          accessNotes: `Pengiriman ulang setelah revisi ${REVISION_TRIGGER_LABEL[revision.trigger] || revision.trigger} — ${revision.complaint}`,
        },
      });
      await tx.jobUnit.create({ data: { jobId: job.id, unitId: revision.unit.id } });
      await tx.unitRevision.update({ where: { id: revision.id }, data: { jobId: job.id } });
      return job.id;
    });

    const full = await prisma.unitRevision.findUnique({ where: { id: revision.id }, include: unitRevisionInclude });
    res.status(201).json(full);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/armada/revisions/:id/create-pickup-job (6 September 2026, D-108) —
// laporan owner: order Dewi (Bekasi, RES-18082026-071) sudah diajukan revisi
// (klaim kenyamanan, kasur amblas) tapi TIDAK PERNAH bisa masuk rute Delivery
// — karena sebelum ini, satu-satunya cara "job jemput" nempel ke revisi
// adalah: dispatcher bikin job LEWAT Jadwal & Penugasan biasa, lalu
// TEMPELKAN ID-nya manual ke sini (lihat komentar PATCH di atas). TAPI job
// biasa itu MENOLAK unit yang sudah DELIVERED (lihat guard `expectedStatus`
// di POST /jobs di bawah — dirancang untuk order BARU, bukan jemput ulang
// kasur yang sudah terkirim) — jadi jalur manual itu SECARA STRUKTURAL tidak
// pernah bisa dilewati untuk kasus revisi/klaim garansi. Endpoint ini jalur
// KHUSUS: job PICKUP lahir langsung UNSCHEDULED (persis job normal begitu
// dibuat), tanpa mensyaratkan status unit/order apa pun — supaya dispatcher
// tinggal menjadwalkan & memasukkannya ke rute seperti job lain, TANPA perlu
// tempel ID manual lagi.
armadaRouter.post("/revisions/:id/create-pickup-job", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const revision = await prisma.unitRevision.findUnique({
      where: { id: req.params.id },
      include: { unit: { select: { id: true, unitCode: true, orderId: true } } },
    });
    if (!revision) return res.status(404).json({ error: "Revisi tidak ditemukan" });
    if (revision.jobId) throw new ArmadaError("Revisi ini sudah punya job pengambilan — buka job-nya lewat Jadwal & Penugasan");
    if (!["REQUESTED", "PICKUP_SCHEDULED"].includes(revision.status)) {
      throw new ArmadaError(`Revisi berstatus ${revision.status} — job pengambilan cuma relevan sebelum unit diambil`);
    }

    const jobId = await prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          type: "PICKUP",
          orderId: revision.unit.orderId,
          accessNotes: `Pengambilan untuk ${REVISION_TRIGGER_LABEL[revision.trigger] || revision.trigger} — ${revision.complaint}`,
        },
      });
      await tx.jobUnit.create({ data: { jobId: job.id, unitId: revision.unit.id } });
      await tx.unitRevision.update({
        where: { id: revision.id },
        data: { jobId: job.id, status: "PICKUP_SCHEDULED" },
      });
      return job.id;
    });

    const full = await prisma.unitRevision.findUnique({ where: { id: revision.id }, include: unitRevisionInclude });
    res.status(201).json(full);
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

    const [byStatus, byType, jobsForPod, routeByStatus, vehicleByStatus, driverGroups, externalCourierJobs] = await Promise.all([
      prisma.job.groupBy({ by: ["status"], where: dateWhere, _count: { _all: true } }),
      prisma.job.groupBy({ by: ["type"], where: dateWhere, _count: { _all: true } }),
      prisma.job.findMany({ where: { ...dateWhere, status: "COMPLETED" }, select: { status: true, podStatus: true, proofPhotoUrls: true } }),
      prisma.route.groupBy({ by: ["status"], where: routeDateWhere, _count: { _all: true } }),
      prisma.vehicle.groupBy({ by: ["status"], _count: { _all: true } }), // status ARMADA SEKARANG, sengaja tidak dibatasi rentang tanggal
      prisma.job.groupBy({ by: ["driverId"], where: { ...dateWhere, status: "COMPLETED", driverId: { not: null } }, _count: { _all: true } }),
      // Kurir eksternal (D-161, 13 September 2026) — jumlah job & total
      // ongkos Lalamove/dst di rentang ini, supaya kebiasaan "customer minta
      // cepat, pilih Lalamove" kelihatan biayanya, bukan cuma dicatat per
      // job tanpa rekap sama sekali. TIDAK dibatasi status COMPLETED (beda
      // dari driverGroups di atas) — ongkos relevan dihitung begitu job
      // dibuat/dijalankan, bukan cuma yang sudah tuntas.
      prisma.job.findMany({
        where: { ...dateWhere, driver: { isExternalCourier: true } },
        select: { id: true, status: true, externalCourierCost: true, driver: { select: { name: true } } },
      }),
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
      externalCourier: {
        jobCount: externalCourierJobs.length,
        totalCost: externalCourierJobs.reduce((sum, j) => sum + (j.externalCourierCost || 0), 0),
        missingCost: externalCourierJobs.filter((j) => j.externalCourierCost == null).length,
      },
    });
  } catch (err) {
    handleErr(err, res);
  }
});
