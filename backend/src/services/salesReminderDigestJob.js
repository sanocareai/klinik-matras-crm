// ─── SALES REMINDER — pengingat otomatis, PER TOPIK, ke WA pribadi sales ───
//
// Berbeda dari slaAlertJob.js (real-time, tiap 5 menit, fokus SLA/backlog
// AGREGAT company-wide) dan staleLeadAlertJob.js (harian, fokus urgency
// lead tinggi) — job ini mengirim PESAN TERPISAH per topik, di JAM
// TERJADWAL BERBEDA-BEDA sepanjang hari (revisi 7 September 2026, permintaan
// owner: pesan gabungan 5-topik "kepanjangan, males dibaca" — sekarang tiap
// topik jadi broadcast SENDIRI, jam A/B/C/D/E, bukan ditumpuk jadi 1 chat):
//
//   1. Chat BELUM DIBACA — customer sudah balas, sales BELUM buka sama
//      sekali, > unreadThresholdMinutes. Default jadwal: 09:00 WIB.
//   2. Chat MENGGANTUNG — sales SUDAH buka (isRead=true) tapi belum balas,
//      percakapan "berakhir di pelanggan". BEDA dari #1 murni soal isRead
//      (permintaan owner: nada pesannya beda — #1 "coba dicek", #2 "sudah
//      dilihat tapi kelupaan dibalas"). Default jadwal: 11:00 WIB.
//   3. Data pelanggan belum lengkap — SCOPE SEMPIT, cuma 4 hal yang owner
//      sebut eksplisit (BUKAN semua BLOCKER_RULES di orderReadiness.js
//      frontend, itu daftar lebih luas untuk kebutuhan berbeda/Delivery):
//      alamat, link Google Maps, jadwal pickup (LAYANAN saja, sama aturan
//      dgn orderReadiness.js), catatan/keluhan customer. Cuma order yang
//      dibuat SEJAK config.dataSejakTanggal (default 1 September 2026 —
//      sistem baru mulai running bulan ini). Default jadwal: 13:00 WIB.
//   4. Follow-up H+1 setelah Terkirim — order yang pindah ke DELIVERED
//      KEMARIN (batas kalender WIB, lihat loadStatusTransitionReminderBySales), TAPI
//      belum ada pesan OUTBOUND apa pun ke customer itu sejak itu. Window
//      kalender (bukan geser per jam) SENGAJA supaya tiap order HANYA
//      dilaporkan SATU KALI (permintaan owner). Default jadwal: 15:00 WIB.
//   5. Belum closing HARI INI — nol Order baru (kategori apa saja) sejak
//      00:00 WIB hari ini. Default jadwal: 17:00 WIB (akhir hari) — kalau
//      dicek dari pagi, HAMPIR SEMUA sales pasti "belum closing" (belum
//      waktunya), jadi jam berapa pun disebut — tekanan palsu, bukan
//      pengingat berguna.
//   6. Mulai Diproses KEMARIN — order yang pindah ke status PROCESSING
//      kemarin (SAMA pola windowing kalender WIB & pengecualian "sudah
//      ada outbound sejak itu" dengan poin 4/Follow-up H+1, cuma toStatus
//      beda), mengingatkan sales utk: pantau progres di grup produksi,
//      kirim update dokumentasi ke customer, dan pastikan semua request
//      customer sudah dipenuhi SEBELUM dikirim (permintaan owner 7 Sep
//      2026). Default jadwal: 14:00 WIB.
//   7. Terkirim TAPI BELUM LUNAS — DIKOREKSI 9 September 2026 (masih hari
//      yang sama dibuat): AWALNYA topik cron terjadwal (10:00 WIB, PERSISTEN
//      tiap hari) sama seperti 6 topik lain — TAPI owner minta diubah jadi
//      REAL-TIME juga, TANPA jadwal jam sama sekali: "gaperlu jadwal jam,
//      jadi selalu kirim info/broadcast ketika dari tim delivery update".
//      Sekarang loader (`loadUnpaidDeliveredBySales`) + composer
//      (`composeUnpaidDeliveredMessage`) di file ini TETAP di sini (dipakai
//      ULANG oleh leaderRecapJob.js untuk angka rekap, DAN oleh
//      services/deliveryCompletionNotify.js yang memicu WA real-time-nya
//      begitu POST /armada/jobs/:id/complete membuat status order jadi
//      DELIVERED) — TIDAK ADA LAGI cron/topik terjadwal untuk poin ini di
//      file ini. `unpaidDeliveredEnabled` di DEFAULT_CONFIG TETAP ada,
//      sekarang dicek oleh deliveryCompletionNotify.js (bukan cron di sini)
//      sebagai flag staging real-time-nya.
//
// RIWAYAT (7 September 2026, permintaan owner — "gahanya riwayat broadcast
// yang dibikin manual, tapi yang dikirim otomatis juga"): tiap kali SATU
// topik berhasil dikirim ke SATU sales, ditulis 1 baris StaffBroadcast
// (kind=AUTO_REMINDER) — TABEL YANG SAMA dengan broadcast manual
// (routes/staffBroadcast.js), jadi tab "Riwayat" di halaman Broadcast Sales
// otomatis merekap KEDUANYA tanpa endpoint/state kedua.
//
// PENERIMA: SENGAJA CUMA role SALES aktif (BUKAN Novi/leader — permintaan
// eksplisit owner: "jangan ke sales leader, nanti ada skema notifikasi
// beda utk itu"). Filter `role === "SALES"` SAMA PERSIS dengan yang sudah
// dipakai routes/analytics.js #sales-report (Novi ber-role ADMIN, otomatis
// tidak ikut) — bukan aturan baru, konsisten dgn precedent yang ada.
//
// STAGED UNTUK REVIEW: `enabled: false` by default, SAMA pola dgn
// slaAlert/staleLeadAlert (config-gated, bukan code-gated) — job ini AMAN
// di-deploy apa adanya (tidak pernah kirim WA sungguhan) sampai admin
// eksplisit set enabled:true di data/settings.json setelah meninjau contoh
// pesannya (lihat scripts/preview-sales-reminder-digest.js).

import cron from "node-cron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { sendText, getDefaultOpsSession } from "./wahaClient.js";
import { readSalesPhoneDirectory, resolveSalesPhone } from "./salesPhoneDirectory.js";
import { startOfDayWIB, nowPartsWIB } from "../utils/wib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, "../../data/settings.json");

const DEFAULT_CONFIG = {
  enabled: false, // lihat catatan header — sengaja mati sampai ditinjau owner
  // Jam WIB berbeda per topik (revisi 7 Sep 2026) — tersebar sepanjang jam
  // kerja, Senin-Sabtu, supaya tidak ada 1 momen "5 topik sekaligus".
  schedule: {
    unread:      "0 9 * * 1-6",
    hanging:     "0 11 * * 1-6",
    incomplete:  "0 13 * * 1-6",
    processing:  "0 14 * * 1-6",
    followUp:    "0 15 * * 1-6",
    zeroClosing: "0 17 * * 1-6",
  },
  unreadThresholdMinutes: 60, // poin 1
  hangingThresholdMinutes: 60, // poin 2
  // Poin 3 & 4 — sistem BARU mulai running September 2026, order Agustus &
  // sebelumnya dibuat SEBELUM kolom alamat/link Maps/dst jadi kebiasaan
  // yang diharapkan sales. Order sebelum tanggal ini TIDAK PERNAH ikut
  // dihitung "perlu dilengkapi" atau "perlu follow-up".
  dataSejakTanggal: "2026-09-01",
  // Poin 7 — lihat catatan header (SEKARANG real-time, bukan cron di file
  // ini). Flag staging dicek oleh services/deliveryCompletionNotify.js.
  unpaidDeliveredEnabled: false,
};

// Diekspor (7 Sep 2026) sbg readSalesReminderConfig — services/
// leaderRecapJob.js WAJIB pakai ambang batas (unreadThresholdMinutes dkk)
// & dataSejakTanggal yang SAMA PERSIS dengan file ini, supaya "item ini
// masih belum diselesaikan sales" di rekap Novi konsisten dengan apa yang
// sungguh-sungguh dikirim ke sales-nya, bukan aturan kedua yang bisa drift.
export function readConfig() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")); } catch { raw = {}; }
  const stored = raw.salesReminderDigest || {};
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    schedule: { ...DEFAULT_CONFIG.schedule, ...(stored.schedule || {}) },
  };
}

// Parse minimal notes JSON Order — SAMA bentuk dgn parseOrderNotes() di
// frontend/src/utils/format.js (merkKasur/ukuranKasur/keluhanCustomer/
// jenisKasurLainnya), duplikasi SENGAJA (backend & frontend runtime
// terpisah, tidak ada modul bersama) — kalau bentuk JSON itu berubah,
// WAJIB diperbarui di DUA tempat.
function keluhanFromNotes(notes) {
  if (!notes) return "";
  try { return JSON.parse(notes).keluhanCustomer || ""; } catch { return ""; }
}

async function kirimWA(phone, pesan, label) {
  try {
    await sendText(phone, pesan, null, getDefaultOpsSession());
    console.log(`[sales-reminder] (${label}) terkirim ke`, phone);
    return true;
  } catch (err) {
    console.warn(`[sales-reminder] Gagal kirim WA (${label}) ke ${phone}:`, err.message);
    return false;
  }
}

// ── Poin 1 & 2: chat belum dibalas, dipecah per status baca ────────────────
// Pola query SAMA dgn checkUnansweredMessages() di slaAlertJob.js (DISTINCT
// ON pesan terakhir per conversation), ditambah kolom isRead & assignedToId
// untuk pengelompokan per sales + pemisahan dua kategori.
// `export` (7 Sep 2026) — dipakai ULANG oleh services/leaderRecapJob.js
// (rekap harian Novi), supaya query & aturan ambang batasnya SATU sumber
// kebenaran dengan reminder per-sales di file ini, tidak diimplementasi
// ulang.
export async function loadUnansweredBySales(config, now) {
  // Scope sejak config.dataSejakTanggal (7 Sep 2026, permintaan owner:
  // "customer September dan bulan selanjutnya aja") — SAMA cutoff yang
  // sudah dipakai loadIncompleteDataBySales/loadStatusTransitionReminderBySales,
  // sekarang berlaku JUGA di sini supaya chat pelanggan LAMA (sebelum
  // sistem reminder ini mulai berjalan) tidak ikut memicu pengingat.
  const cutoff = startOfDayWIB(config.dataSejakTanggal);
  const rows = await prisma.$queryRaw`
    SELECT c.id AS "conversationId", c."assignedToId", c."isRead", cu.name AS "customerName", cu.phone AS "customerPhone",
           m."createdAt" AS "lastInboundAt"
    FROM "Conversation" c
    JOIN "Customer" cu ON cu.id = c."customerId"
    JOIN LATERAL (
      SELECT direction, "createdAt"
      FROM "Message"
      WHERE "conversationId" = c.id
      ORDER BY "createdAt" DESC
      LIMIT 1
    ) m ON true
    WHERE c.type = 'INDIVIDUAL'
      AND c.status != 'RESOLVED'
      AND c."assignedToId" IS NOT NULL
      AND m.direction = 'INBOUND'
      AND cu."createdAt" >= ${cutoff}
  `;

  const unread = new Map(); // salesId -> [{nama, menit}]
  const hanging = new Map();

  for (const row of rows) {
    const elapsedMinutes = (now - new Date(row.lastInboundAt).getTime()) / 60_000;
    const threshold = row.isRead ? config.hangingThresholdMinutes : config.unreadThresholdMinutes;
    if (elapsedMinutes < threshold) continue;

    const bucket = row.isRead ? hanging : unread;
    if (!bucket.has(row.assignedToId)) bucket.set(row.assignedToId, []);
    bucket.get(row.assignedToId).push({
      nama: row.customerName || row.customerPhone || "(tanpa nama)",
      menit: Math.floor(elapsedMinutes),
    });
  }

  return { unread, hanging };
}

// ── Poin 3: data pelanggan wajib dilengkapi (scope sempit, lihat header) ───
// BUKAN CUMA exclude CANCELLED (ditemukan lewat preview 7 Sep 2026,
// production): 304 dari ~388 order sudah DELIVERED — kalau ikut dihitung,
// digest banjir "kurang link Google Maps" pada order yang SUDAH SELESAI
// bertahun-tahun, tidak ada apa pun yang bisa ditindaklanjuti sales dari
// situ. Scope ke order yang MASIH AKTIF saja (belum Terkirim/Dibatalkan),
// DAN dibuat sejak config.dataSejakTanggal.
export async function loadIncompleteDataBySales(config) {
  const orders = await prisma.order.findMany({
    where: {
      status: { notIn: ["CANCELLED", "DELIVERED"] },
      createdAt: { gte: startOfDayWIB(config.dataSejakTanggal) },
    },
    select: {
      id: true, orderNumber: true, category: true, notes: true,
      deliveryAddress: true, locationUrl: true,
      pickupConfirmedDate: true, pickupEstimate: true,
      customer: { select: { name: true, phone: true, assignedSalesId: true } },
    },
  });

  const bySales = new Map(); // salesId -> [{ orderNumber, nama, missing: [] }]
  for (const o of orders) {
    const salesId = o.customer?.assignedSalesId;
    if (!salesId) continue;

    const missing = [];
    if (!(o.deliveryAddress || "").trim()) missing.push("alamat");
    if (!o.locationUrl) missing.push("link Google Maps");
    // Jadwal pickup cuma relevan utk LAYANAN — SAMA aturan dgn
    // frontend/src/utils/orderReadiness.js (BARU/SEWA tidak pernah lewat
    // tahap pickup sama sekali).
    if (o.category === "LAYANAN" && !(o.pickupConfirmedDate || o.pickupEstimate)) missing.push("jadwal pickup");
    if (!keluhanFromNotes(o.notes)) missing.push("catatan/keluhan customer");
    if (missing.length === 0) continue;

    if (!bySales.has(salesId)) bySales.set(salesId, []);
    bySales.get(salesId).push({
      orderNumber: o.orderNumber || o.id,
      nama: o.customer?.name || o.customer?.phone || "(tanpa nama)",
      missing,
    });
  }
  return bySales;
}

// ── Poin 7: order sudah TERKIRIM tapi belum LUNAS ──────────────────────────
// PERSISTEN (bukan window kalender seperti poin 4) — order ini terus lolos
// filter SELAMA paymentStatus belum LUNAS, berapa hari pun. `export` (sama
// alasan loader lain di file ini) — dipakai ulang leaderRecapJob.js supaya
// angka yang dilihat Novi konsisten dgn yang dikirim ke sales-nya.
export async function loadUnpaidDeliveredBySales(config) {
  const orders = await prisma.order.findMany({
    where: {
      status: "DELIVERED",
      paymentStatus: { not: "LUNAS" },
      createdAt: { gte: startOfDayWIB(config.dataSejakTanggal) },
    },
    select: {
      id: true, orderNumber: true, paymentStatus: true,
      customer: { select: { name: true, phone: true, assignedSalesId: true } },
    },
  });

  const bySales = new Map(); // salesId -> [{ orderNumber, nama, paymentStatus }]
  for (const o of orders) {
    const salesId = o.customer?.assignedSalesId;
    if (!salesId) continue;
    if (!bySales.has(salesId)) bySales.set(salesId, []);
    bySales.get(salesId).push({
      orderNumber: o.orderNumber || o.id,
      nama: o.customer?.name || o.customer?.phone || "(tanpa nama)",
      paymentStatus: o.paymentStatus,
    });
  }
  return bySales;
}

// ── Poin 5: nol closing hari ini ────────────────────────────────────────────
export async function loadZeroClosingSalesIds(salesList, now) {
  const { year, month, day } = nowPartsWIB(new Date(now));
  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const startToday = startOfDayWIB(todayStr);

  const counts = await prisma.order.groupBy({
    by: ["customerId"],
    where: { createdAt: { gte: startToday } },
    _count: true,
  });
  // customerId -> perlu diterjemahkan ke assignedSalesId lewat Customer.
  const customerIds = counts.map((c) => c.customerId);
  const customers = customerIds.length
    ? await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, assignedSalesId: true } })
    : [];
  const closedSalesIds = new Set(customers.map((c) => c.assignedSalesId).filter(Boolean));

  return salesList.filter((s) => !closedSalesIds.has(s.id)).map((s) => s.id);
}

// ── Poin 4: follow-up H+1 setelah Terkirim ──────────────────────────────────
// Window = PERSIS "kemarin" menurut kalender WIB (batas hari, bukan
// "24-32 jam lalu") — permintaan owner: "hanya 1 kali broadcast aja sebagai
// pengingat". Batas kalender TIDAK PERNAH tumpang tindih antar hari (beda
// dari window geser berbasis jam yang bisa dobel/bocor kalau waktu cron
// sedikit meleset) — order yang DELIVERED kemarin (kapan pun jam berapa
// pun) HANYA masuk window ini SATU KALI.
// Generik (7 Sep 2026) — dipakai poin 4 (Follow-up H+1, toStatus=DELIVERED)
// DAN poin 6 (Mulai Diproses, toStatus=PROCESSING). Order yang pindah ke
// `toStatus` KEMARIN, DAN belum ada pesan OUTBOUND apa pun ke customer itu
// sejak transisi tsb (dianggap "sudah ditindaklanjuti", tidak diingatkan
// lagi) — sinyal sengaja generik (bukan cek dokumentasi terkirim
// spesifik), supaya SATU aturan berlaku utk dua konteks (follow-up
// testimoni ATAU update dokumentasi produksi) tanpa cek keluar/masuk yang
// beda-beda tiap kasus.
export async function loadStatusTransitionReminderBySales(config, now, toStatus) {
  const { year, month, day } = nowPartsWIB(new Date(now));
  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const startToday = startOfDayWIB(todayStr);
  const startYesterday = new Date(startToday.getTime() - 86_400_000);

  const transitions = await prisma.orderStatusTransition.findMany({
    where: {
      toStatus,
      createdAt: { gte: startYesterday, lt: startToday },
      order: { createdAt: { gte: startOfDayWIB(config.dataSejakTanggal) } },
    },
    select: {
      createdAt: true,
      order: {
        select: {
          orderNumber: true, id: true,
          customer: {
            select: {
              id: true, name: true, phone: true, assignedSalesId: true,
              conversations: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  // Dedupe per order (ditemukan lewat preview 7 Sep 2026: order yang
  // sempat berpindah status lalu dikoreksi lalu berpindah lagi ke status
  // yang sama tercatat 2 baris transisi dalam window yang sama — tanpa
  // ini order itu muncul dobel di pesan). Ambil transisi TERBARU per order.
  const latestPerOrder = new Map(); // orderId -> transition
  for (const t of transitions) {
    const existing = latestPerOrder.get(t.order.id);
    if (!existing || t.createdAt > existing.createdAt) latestPerOrder.set(t.order.id, t);
  }

  const bySales = new Map(); // salesId -> [{ orderNumber, nama }]
  for (const t of latestPerOrder.values()) {
    const salesId = t.order.customer?.assignedSalesId;
    if (!salesId) continue;

    const convIds = (t.order.customer.conversations || []).map((c) => c.id);
    const outboundSince = convIds.length
      ? await prisma.message.findFirst({
          where: { conversationId: { in: convIds }, direction: "OUTBOUND", createdAt: { gt: t.createdAt } },
          select: { id: true },
        })
      : null;
    if (outboundSince) continue; // sudah ada tindak lanjut

    if (!bySales.has(salesId)) bySales.set(salesId, []);
    bySales.get(salesId).push({
      orderNumber: t.order.orderNumber || t.order.id,
      nama: t.order.customer?.name || t.order.customer?.phone || "(tanpa nama)",
    });
  }
  return bySales;
}

// ── Pesan per TOPIK (bukan lagi digabung) — masing-masing SATU broadcast
// tersendiri, sengaja pendek/fokus 1 hal. `null` = tidak ada yang perlu
// dilaporkan untuk sales ini, TIDAK dikirim sama sekali (diam, bukan
// "semua aman!" tiap kali — permintaan owner: hindari notifikasi
// berlebihan).
function composeUnreadMessage(nama, items) {
  if (!items?.length) return null;
  return [
    `👋 Halo *${nama}*, ada ${items.length} chat yang *belum dibaca* (customer sudah balas):`,
    "",
    ...items.slice(0, 10).map((u) => `- ${u.nama} — ${u.menit} menit lalu`),
    items.length > 10 ? `...dan ${items.length - 10} lainnya` : null,
    "",
    "Yuk segera dicek 🙏",
  ].filter(Boolean).join("\n");
}

function composeHangingMessage(nama, items) {
  if (!items?.length) return null;
  return [
    `👋 Halo *${nama}*, ada ${items.length} chat yang sudah dibaca tapi *belum dibalas*:`,
    "",
    ...items.slice(0, 10).map((h) => `- ${h.nama} — ${h.menit} menit lalu`),
    items.length > 10 ? `...dan ${items.length - 10} lainnya` : null,
    "",
    "Jangan sampai percakapan berakhir di pelanggan ya 🙏",
  ].filter(Boolean).join("\n");
}

function composeIncompleteMessage(nama, items) {
  if (!items?.length) return null;
  return [
    `👋 Halo *${nama}*, ada ${items.length} order yang datanya *belum lengkap*:`,
    "",
    ...items.slice(0, 10).map((o) => `- ${o.nama} (${o.orderNumber}) — ${o.missing.join(", ")}`),
    items.length > 10 ? `...dan ${items.length - 10} lainnya` : null,
    "",
    "Yuk dilengkapi supaya order bisa lanjut diproses 🙏",
  ].filter(Boolean).join("\n");
}

function composeFollowUpMessage(nama, items) {
  if (!items?.length) return null;
  return [
    `👋 Halo *${nama}*, ada ${items.length} order yang terkirim kemarin, *belum ada follow-up*:`,
    "",
    ...items.map((f) => `- ${f.nama} (${f.orderNumber})`),
    "",
    "Follow up untuk minta review/testimoni 🙏",
  ].filter(Boolean).join("\n");
}

// `export` (9 Sep 2026) — dipakai ULANG oleh
// services/deliveryCompletionNotify.js untuk pesan real-time-nya, supaya
// isi/nada pesan SAMA PERSIS dengan yang dulu dipakai cron (sebelum
// dipindah jadi real-time, lihat catatan header di atas), tidak
// diimplementasi ulang.
export function composeUnpaidDeliveredMessage(nama, items) {
  if (!items?.length) return null;
  return [
    `👋 Halo *${nama}*, ada ${items.length} order yang *sudah terkirim* tapi *belum LUNAS*:`,
    "",
    ...items.slice(0, 10).map((o) => `- ${o.nama} (${o.orderNumber}) — ${o.paymentStatus === "DP" ? "baru DP" : "belum bayar"}`),
    items.length > 10 ? `...dan ${items.length - 10} lainnya` : null,
    "",
    "Yuk ditagih supaya lunas 🙏",
  ].filter(Boolean).join("\n");
}

function composeZeroClosingMessage(nama) {
  return `👋 Halo *${nama}*, belum ada order baru yang closing hari ini — yuk semangat, masih ada waktu! 💪`;
}

function composeProcessingMessage(nama, items) {
  if (!items?.length) return null;
  return [
    `👋 Halo *${nama}*, ada ${items.length} order yang mulai *Diproses* kemarin:`,
    "",
    ...items.map((f) => `- ${f.nama} (${f.orderNumber})`),
    "",
    "Yuk pantau progresnya di grup produksi, kirim update dokumentasi ke customer, dan pastikan semua request customer sudah dipenuhi sebelum dikirim 🙏",
  ].filter(Boolean).join("\n");
}

// ── Dispatcher bersama tiap topik — hitung pesan per sales, kirim (kalau
// enabled & bukan dryRun), lalu catat SEBAGAI StaffBroadcast(kind=
// AUTO_REMINDER) supaya muncul di tab Riwayat Broadcast Sales. Message
// TETAP dihitung walau job mati (`enabled:false`) — itulah yang membuat
// scripts/preview-sales-reminder-digest.js bisa menampilkan contoh nyata
// SEBELUM job dinyalakan.
//
// IDEMPOTENSI (7 Sep 2026, permintaan owner: "pastikan broadcast tidak
// mengirim duplikasi... 3-4x dalam 1 waktu") — dimuat SEKALI di awal
// siapa saja yang SUDAH menerima topik ini HARI INI (kalender WIB), dari
// StaffBroadcast (bukan Map in-memory — harus tahan restart & tahan 2
// proses berjalan bersamaan, dua skenario yang PERSIS menyebabkan
// duplikasi di sistem broadcast lain sebelumnya). Kalau `topicKey` sudah
// tercatat utk sales itu hari ini, DILEWATI — tidak peduli kenapa fungsi
// ini terpanggil lagi (cron fire dobel, restart di jam yang sama, trigger
// manual bersamaan jadwal).
async function dispatchSection({ config, dryRun, salesList, label, topicKey, computeMessage }) {
  const summary = { label, salesWithItems: 0, sent: 0, skippedNoPhone: 0, skippedAlreadySent: 0 };
  const directory = readSalesPhoneDirectory();

  let sudahDikirimHariIni = new Set();
  if (!dryRun && config.enabled) {
    const { year, month, day } = nowPartsWIB(new Date());
    const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const existing = await prisma.staffBroadcast.findMany({
      where: { kind: "AUTO_REMINDER", topic: topicKey, createdAt: { gte: startOfDayWIB(todayStr) } },
      select: { recipientIds: true },
    });
    for (const row of existing) for (const id of row.recipientIds) sudahDikirimHariIni.add(id);
  }

  for (const sales of salesList) {
    const pesan = computeMessage(sales);
    if (!pesan) continue;
    summary.salesWithItems++;

    const phone = resolveSalesPhone(sales.name, directory);
    if (dryRun) {
      console.log(`[sales-reminder] (dryRun) (${label}) TIDAK dikirim ke ${sales.name} (${phone || "no phone"}):\n${pesan}\n`);
      continue;
    }
    if (!config.enabled) continue; // job dimatikan — hitung tapi jangan kirim/catat

    if (sudahDikirimHariIni.has(sales.id)) {
      summary.skippedAlreadySent++;
      continue;
    }

    if (!phone) { summary.skippedNoPhone++; continue; }
    const ok = await kirimWA(phone, pesan, `${label} — ${sales.name}`);

    await prisma.staffBroadcast.create({
      data: {
        message: pesan,
        recipientIds: [sales.id],
        scheduledAt: new Date(),
        status: "SENT",
        sentAt: new Date(),
        kind: "AUTO_REMINDER",
        topic: topicKey,
        results: { [sales.id]: { nama: sales.name, phone, status: ok ? "TERKIRIM" : "GAGAL" } },
      },
    }).catch((err) => console.error(`[sales-reminder] Gagal catat riwayat (${label}):`, err.message));

    if (ok) summary.sent++;
  }
  return summary;
}

export async function daftarSalesAktif() {
  return prisma.user.findMany({ where: { role: "SALES", active: true }, select: { id: true, name: true } });
}

export async function runUnreadCycle({ referenceNow = new Date(), dryRun = false } = {}) {
  const config = readConfig();
  const now = referenceNow.getTime();
  const salesList = await daftarSalesAktif();
  const { unread } = await loadUnansweredBySales(config, now);
  return dispatchSection({
    config, dryRun, salesList, label: "Chat Belum Dibaca", topicKey: "unread",
    computeMessage: (s) => composeUnreadMessage(s.name, unread.get(s.id)),
  });
}

export async function runHangingCycle({ referenceNow = new Date(), dryRun = false } = {}) {
  const config = readConfig();
  const now = referenceNow.getTime();
  const salesList = await daftarSalesAktif();
  const { hanging } = await loadUnansweredBySales(config, now);
  return dispatchSection({
    config, dryRun, salesList, label: "Chat Menggantung", topicKey: "hanging",
    computeMessage: (s) => composeHangingMessage(s.name, hanging.get(s.id)),
  });
}

export async function runIncompleteCycle({ referenceNow = new Date(), dryRun = false } = {}) {
  const config = readConfig();
  const salesList = await daftarSalesAktif();
  const incompleteBySales = await loadIncompleteDataBySales(config);
  return dispatchSection({
    config, dryRun, salesList, label: "Data Belum Lengkap", topicKey: "incomplete",
    computeMessage: (s) => composeIncompleteMessage(s.name, incompleteBySales.get(s.id)),
  });
}

export async function runFollowUpCycle({ referenceNow = new Date(), dryRun = false } = {}) {
  const config = readConfig();
  const now = referenceNow.getTime();
  const salesList = await daftarSalesAktif();
  const followUpBySales = await loadStatusTransitionReminderBySales(config, now, "DELIVERED");
  return dispatchSection({
    config, dryRun, salesList, label: "Follow-up H+1", topicKey: "followUp",
    computeMessage: (s) => composeFollowUpMessage(s.name, followUpBySales.get(s.id)),
  });
}

export async function runProcessingCycle({ referenceNow = new Date(), dryRun = false } = {}) {
  const config = readConfig();
  const now = referenceNow.getTime();
  const salesList = await daftarSalesAktif();
  const processingBySales = await loadStatusTransitionReminderBySales(config, now, "PROCESSING");
  return dispatchSection({
    config, dryRun, salesList, label: "Mulai Diproses", topicKey: "processing",
    computeMessage: (s) => composeProcessingMessage(s.name, processingBySales.get(s.id)),
  });
}

export async function runZeroClosingCycle({ referenceNow = new Date(), dryRun = false } = {}) {
  const config = readConfig();
  const now = referenceNow.getTime();
  const salesList = await daftarSalesAktif();
  const zeroIds = new Set(await loadZeroClosingSalesIds(salesList, now));
  return dispatchSection({
    config, dryRun, salesList, label: "Belum Closing", topicKey: "zeroClosing",
    computeMessage: (s) => (zeroIds.has(s.id) ? composeZeroClosingMessage(s.name) : null),
  });
}

export function startSalesReminderDigestJob() {
  const config = readConfig();
  const topik = [
    ["unread", config.schedule.unread, runUnreadCycle, "Chat Belum Dibaca"],
    ["hanging", config.schedule.hanging, runHangingCycle, "Chat Menggantung"],
    ["incomplete", config.schedule.incomplete, runIncompleteCycle, "Data Belum Lengkap"],
    ["processing", config.schedule.processing, runProcessingCycle, "Mulai Diproses"],
    ["followUp", config.schedule.followUp, runFollowUpCycle, "Follow-up H+1"],
    ["zeroClosing", config.schedule.zeroClosing, runZeroClosingCycle, "Belum Closing"],
  ];
  for (const [, expr, fn, label] of topik) {
    cron.schedule(expr, async () => {
      console.log(`[sales-reminder] Cron (${label}) fired`);
      await fn();
    }, { timezone: "Asia/Jakarta" });
  }
  console.log(`[sales-reminder] ${topik.length} topik terdaftar (jadwal masing-masing beda) — enabled=${config.enabled}`);
}
