// ─── SALES REMINDER DIGEST (beberapa kali sehari) ──────────────────────────
//
// Berbeda dari slaAlertJob.js (real-time, tiap 5 menit, fokus SLA/backlog
// AGREGAT company-wide) dan staleLeadAlertJob.js (harian, fokus urgency
// lead tinggi) — job ini SATU pesan WA konsolidasi PER SALES PERSON,
// dikirim beberapa kali sehari (bukan real-time terus-menerus, permintaan
// owner 7 September 2026: "takut terganggu, jangan tiap jam"), berisi
// SEMUA hal yang perlu diingatkan ke sales itu HARI INI:
//
//   1. Chat BELUM DIBACA — customer sudah balas, sales BELUM buka sama
//      sekali, > unreadThresholdMinutes.
//   2. Chat MENGGANTUNG — sales SUDAH buka (isRead=true) tapi belum balas
//      (belum ada outbound baru), percakapan "berakhir di pelanggan",
//      > hangingThresholdMinutes. BEDA dari #1 murni soal isRead — dua-duanya
//      sama-sama "belum dibalas", cuma beda apakah sudah dilihat atau belum
//      (permintaan owner, supaya nada pesannya bisa beda: #1 "coba dicek",
//      #2 "sudah dilihat tapi kelupaan dibalas").
//   3. Data pelanggan belum lengkap — SCOPE SEMPIT, cuma 4 hal yang owner
//      sebut eksplisit (BUKAN semua BLOCKER_RULES di orderReadiness.js
//      frontend, itu daftar lebih luas untuk kebutuhan berbeda/Delivery):
//      alamat, link Google Maps, jadwal pickup (LAYANAN saja, sama aturan
//      dgn orderReadiness.js), catatan/keluhan customer.
//   4. Belum closing HARI INI — nol Order baru (kategori apa saja) sejak
//      00:00 WIB hari ini. Dikirim HANYA di slot AKHIR HARI (lihat
//      `eodHour`) — kalau dicek dari pagi, HAMPIR SEMUA sales pasti "belum
//      closing" (belum waktunya), jadi jam berapa pun disebut. Menyebutnya
//      dari pagi cuma bikin sales dapat tekanan palsu, bukan pengingat
//      berguna.
//   5. Follow-up H+1 setelah Terkirim — order yang baru pindah ke
//      DELIVERED sekitar followUpAfterDeliveryHours lalu, TAPI belum ada
//      pesan OUTBOUND apa pun ke customer itu sejak transisi itu (minta
//      review/testimoni, dst). Sama pola timing dengan #4 — cuma
//      relevan/berguna dicek di slot akhir hari juga.
//
// PENERIMA: SENGAJA CUMA role SALES aktif (BUKAN Novi/leader — permintaan
// eksplisit owner: "jangan ke sales leader, nanti ada skema notifikasi
// beda utk itu"). Filter `role === "SALES"` SAMA PERSIS dengan yang sudah
// dipakai routes/analytics.js #sales-report (Novi ber-role ADMIN, otomatis
// tidak ikut) — bukan aturan baru, konsisten dgn precedent yang ada.
//
// STAGED UNTUK REVIEW (7 September 2026): `enabled: false` by default,
// SAMA pola dgn slaAlert/staleLeadAlert (config-gated, bukan code-gated) —
// job ini AMAN di-deploy apa adanya (tidak pernah kirim WA sungguhan)
// sampai admin eksplisit set enabled:true di data/settings.json setelah
// meninjau contoh pesannya (lihat scripts/preview-sales-reminder-digest.js).
//
// REUSE, BUKAN REIMPLEMENTASI:
//   - Channel WA + fallback: sendText/getDefaultOpsSession, pola SAMA
//     dengan slaAlertJob.js/staleLeadAlertJob.js.
//   - Directory nomor sales: dibaca dari `slaAlert.salesPhoneDirectory`
//     yang SUDAH ADA (bukan directory baru) — 1 sumber kebenaran nomor WA
//     sales, sama seperti staleLeadAlertJob.js.
//   - Tidak ada state/tabel baru — semua dihitung LANGSUNG dari kondisi
//     SEKARANG tiap kali job jalan (beda dari slaAlertJob.js yang punya
//     cooldown/eskalasi kompleks) — aman karena job ini SUDAH throttled ke
//     beberapa slot waktu tetap per hari, bukan tiap 5 menit, jadi tidak
//     butuh dedup tambahan: begitu sales membalas/melengkapi/closing,
//     item itu otomatis hilang dari digest berikutnya.

import cron from "node-cron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { sendText, getDefaultOpsSession } from "./wahaClient.js";
import { startOfDayWIB, nowPartsWIB } from "../utils/wib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, "../../data/settings.json");

const DEFAULT_CONFIG = {
  enabled: false, // lihat catatan header — sengaja mati sampai ditinjau owner
  // 5x/hari, jam kerja, Senin-Sabtu — hindari dini hari/Minggu. Slot
  // TERAKHIR (17:00) dobel-peran sbg `eodHour` (poin 4 & 5 hanya muncul di
  // slot ini, lihat catatan header).
  cronExpression: "0 9,11,13,15,17 * * 1-6",
  eodHour: 17, // jam WIB (0-23) tempat poin "belum closing" & "follow-up H+1" ikut disertakan
  unreadThresholdMinutes: 60, // poin 1
  hangingThresholdMinutes: 60, // poin 2
  followUpAfterDeliveryHours: 24, // poin 5 — window H+1, lihat FOLLOWUP_WINDOW_SLACK_HOURS
};

// H+1 dicek dalam JENDELA (bukan "tepat 24 jam"), supaya order yang delivered
// jam berapa pun kemarin tetap tertangkap oleh SATU slot akhir-hari hari ini
// — jendela selebar (24h slot antar hari) + sedikit slack, bukan pas 24.0 jam.
const FOLLOWUP_WINDOW_SLACK_HOURS = 8;

function readConfig() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")); } catch { raw = {}; }
  return {
    ...DEFAULT_CONFIG,
    ...(raw.salesReminderDigest || {}),
    salesPhoneDirectory: raw.slaAlert?.salesPhoneDirectory || [],
  };
}

function resolveSalesPhone(name, directory) {
  if (!name || !Array.isArray(directory)) return null;
  const match = directory.find((d) => d.name?.toLowerCase() === name.toLowerCase());
  return match?.phone || null;
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

async function notifyPhone(phone, pesan, label) {
  if (!phone) {
    console.warn(`[sales-reminder-digest] Tidak ada nomor WA terdaftar — skip (${label})`);
    return false;
  }
  try {
    await sendText(phone, pesan, null, getDefaultOpsSession());
    console.log(`[sales-reminder-digest] Digest (${label}) terkirim ke`, phone);
    return true;
  } catch (err) {
    console.warn(`[sales-reminder-digest] Gagal kirim WA (${label}) ke ${phone}:`, err.message);
    return false;
  }
}

// ── Poin 1 & 2: chat belum dibalas, dipecah per status baca ────────────────
// Pola query SAMA dgn checkUnansweredMessages() di slaAlertJob.js (DISTINCT
// ON pesan terakhir per conversation), ditambah kolom isRead & assignedToId
// untuk pengelompokan per sales + pemisahan dua kategori.
async function loadUnansweredBySales(config, now) {
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
  `;

  const unread = new Map(); // salesId -> [{customerName, menit}]
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
// situ. Scope ke order yang MASIH AKTIF saja (belum Terkirim/Dibatalkan).
async function loadIncompleteDataBySales() {
  const orders = await prisma.order.findMany({
    where: { status: { notIn: ["CANCELLED", "DELIVERED"] } },
    select: {
      id: true, orderNumber: true, category: true, notes: true,
      deliveryAddress: true, locationUrl: true,
      pickupConfirmedDate: true, pickupEstimate: true,
      customer: { select: { name: true, phone: true, assignedSalesId: true } },
    },
  });

  const bySales = new Map(); // salesId -> [{ orderNumber, customerName, missing: [] }]
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

// ── Poin 4: nol closing hari ini (cuma dipakai di slot eodHour) ────────────
async function loadZeroClosingSalesIds(salesList, now) {
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

// ── Poin 5: follow-up H+1 setelah Terkirim (cuma dipakai di slot eodHour) ──
async function loadFollowUpDueBySales(config, now) {
  const windowEnd = new Date(now - config.followUpAfterDeliveryHours * 3_600_000);
  const windowStart = new Date(windowEnd.getTime() - FOLLOWUP_WINDOW_SLACK_HOURS * 3_600_000);

  const transitions = await prisma.orderStatusTransition.findMany({
    where: { toStatus: "DELIVERED", createdAt: { gte: windowStart, lte: windowEnd } },
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
  // sempat di-DELIVERED lalu dikoreksi lalu DELIVERED lagi tercatat 2 baris
  // transisi dalam window yang sama — tanpa ini order itu muncul dobel di
  // pesan). Ambil transisi TERBARU per order.
  const latestPerOrder = new Map(); // orderId -> transition
  for (const t of transitions) {
    const existing = latestPerOrder.get(t.order.id);
    if (!existing || t.createdAt > existing.createdAt) latestPerOrder.set(t.order.id, t);
  }

  const bySales = new Map(); // salesId -> [{ orderNumber, customerName }]
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
    if (outboundSince) continue; // sudah ada follow-up

    if (!bySales.has(salesId)) bySales.set(salesId, []);
    bySales.get(salesId).push({
      orderNumber: t.order.orderNumber || t.order.id,
      nama: t.order.customer?.name || t.order.customer?.phone || "(tanpa nama)",
    });
  }
  return bySales;
}

// Susun 1 pesan WA konsolidasi dari semua bagian yang relevan utk 1 sales.
// Balikin `null` kalau tidak ada satu pun hal untuk dilaporkan (TIDAK kirim
// pesan "semua aman!" tiap slot — permintaan owner: hindari notifikasi
// berlebihan, cukup diam kalau memang tidak ada yang perlu ditindak).
function composeMessage({ salesName, unread, hanging, incomplete, zeroClosing, followUp }) {
  const bagian = [];

  if (unread?.length) {
    bagian.push([
      `📩 *${unread.length} chat belum dibaca* (customer sudah balas):`,
      ...unread.slice(0, 8).map((u) => `- ${u.nama} — ${u.menit} menit lalu`),
      unread.length > 8 ? `...dan ${unread.length - 8} lainnya` : null,
    ].filter(Boolean).join("\n"));
  }

  if (hanging?.length) {
    bagian.push([
      `👀 *${hanging.length} chat sudah dibaca tapi belum dibalas* — jangan sampai percakapan berakhir di pelanggan:`,
      ...hanging.slice(0, 8).map((h) => `- ${h.nama} — ${h.menit} menit lalu`),
      hanging.length > 8 ? `...dan ${hanging.length - 8} lainnya` : null,
    ].filter(Boolean).join("\n"));
  }

  if (incomplete?.length) {
    bagian.push([
      `📋 *${incomplete.length} order perlu dilengkapi datanya*:`,
      ...incomplete.slice(0, 8).map((o) => `- ${o.nama} (${o.orderNumber}) — ${o.missing.join(", ")}`),
      incomplete.length > 8 ? `...dan ${incomplete.length - 8} lainnya` : null,
    ].filter(Boolean).join("\n"));
  }

  if (zeroClosing) {
    bagian.push(`💰 Belum ada order baru yang closing hari ini — yuk semangat, masih ada waktu!`);
  }

  if (followUp?.length) {
    bagian.push([
      `⭐ *${followUp.length} order terkirim kemarin, belum ada follow-up*:`,
      ...followUp.slice(0, 8).map((f) => `- ${f.nama} (${f.orderNumber})`),
      followUp.length > 8 ? `...dan ${followUp.length - 8} lainnya` : null,
      "Follow up untuk minta review/testimoni.",
    ].filter(Boolean).join("\n"));
  }

  if (bagian.length === 0) return null;

  return [
    `👋 Halo *${salesName}*, ini pengingat dari CRM Klinik Matras:`,
    "",
    bagian.join("\n\n"),
  ].join("\n");
}

// Fungsi murni-hitung (TANPA kirim WA) — dipakai job asli DAN
// scripts/preview-sales-reminder-digest.js untuk lihat contoh pesan nyata
// tanpa efek samping. `now` bisa di-override utk testing/preview jam tertentu.
export async function buildDigest({ referenceNow = new Date() } = {}) {
  const config = readConfig();
  const now = referenceNow.getTime();
  // nowPartsWIB() cuma punya year/month/day (bukan jam) — hitung jam WIB
  // manual dengan teknik offset yang sama.
  const jamWib = new Date(now + 7 * 3_600_000).getUTCHours();
  const eodSlot = jamWib === config.eodHour;

  const salesList = await prisma.user.findMany({
    where: { role: "SALES", active: true },
    select: { id: true, name: true },
  });

  const { unread, hanging } = await loadUnansweredBySales(config, now);
  const incompleteBySales = await loadIncompleteDataBySales();
  const zeroClosingIds = eodSlot ? new Set(await loadZeroClosingSalesIds(salesList, now)) : new Set();
  const followUpBySales = eodSlot ? await loadFollowUpDueBySales(config, now) : new Map();

  const hasil = []; // { sales, phone, pesan }
  for (const sales of salesList) {
    const pesan = composeMessage({
      salesName: sales.name,
      unread: unread.get(sales.id),
      hanging: hanging.get(sales.id),
      incomplete: incompleteBySales.get(sales.id),
      zeroClosing: zeroClosingIds.has(sales.id),
      followUp: followUpBySales.get(sales.id),
    });
    if (!pesan) continue;
    hasil.push({
      sales,
      phone: resolveSalesPhone(sales.name, config.salesPhoneDirectory),
      pesan,
    });
  }

  return { config, eodSlot, digests: hasil };
}

export async function runSalesReminderDigestCycle({ referenceNow = new Date(), dryRun = false } = {}) {
  const { config, eodSlot, digests } = await buildDigest({ referenceNow });
  const summary = { enabled: config.enabled, eodSlot, salesWithItems: digests.length, sent: 0, skippedNoPhone: 0 };
  if (!config.enabled) return summary;

  for (const { sales, phone, pesan } of digests) {
    if (dryRun) {
      console.log(`[sales-reminder-digest] (dryRun) TIDAK dikirim ke ${sales.name} (${phone || "no phone"}):\n${pesan}\n`);
      continue;
    }
    if (!phone) { summary.skippedNoPhone++; continue; }
    const ok = await notifyPhone(phone, pesan, `Digest — ${sales.name}`);
    if (ok) summary.sent++;
  }
  return summary;
}

export function startSalesReminderDigestJob() {
  const config = readConfig();
  cron.schedule(config.cronExpression, async () => {
    console.log("[sales-reminder-digest] Cron fired");
    await runSalesReminderDigestCycle();
  }, { timezone: "Asia/Jakarta" });
  console.log(`[sales-reminder-digest] Job terdaftar — jadwal "${config.cronExpression}" (Asia/Jakarta), enabled=${config.enabled}`);
}
