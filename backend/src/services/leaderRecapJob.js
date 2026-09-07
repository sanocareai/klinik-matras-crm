// ─── LEADER RECAP — rekap tim harian ke sales leader (Novi) ────────────────
//
// Berbeda dari salesReminderDigestJob.js (per-topik, ke MASING-MASING sales
// person) dan staleLeadAlertJob.js (jam 08:00, fokus lead urgent/eskalasi
// company-wide — TETAP JALAN, TIDAK disentuh sama sekali oleh file ini) —
// job ini SATU pesan WA per hari, ke LEADER (Novi), isinya rekap SELURUH
// tim sekaligus: untuk TIAP sales aktif, tampilkan status keenam topik yang
// sama dipakai salesReminderDigestJob.js (chat belum dibaca, chat
// menggantung, data belum lengkap, mulai diproses, follow-up H+1, belum
// closing) — REUSE loader-nya LANGSUNG (diekspor dari file itu), TIDAK
// diimplementasi ulang, supaya angka yang dilihat Novi selalu sama persis
// dengan yang sungguh dikirim ke sales-nya.
//
// ESKALASI (7 September 2026, permintaan owner: "sales yang tidak
// merespons reminder-nya sendiri") — dijadwalkan SETELAH semua topik
// per-sales sudah sempat fire hari itu (default 17:30 WIB, 30 menit
// setelah topik terakhir/zeroClosing di 17:00), supaya tiap temuan bisa
// dicek silang: "apakah sales ini SUDAH diingatkan soal ini hari ini
// (StaffBroadcast kind=AUTO_REMINDER, topic cocok, recipientIds berisi
// dia)?" — kalau YA dan kondisinya MASIH ada sekarang, ditandai ⚠️ (sudah
// diingatkan, belum ditindaklanjuti). Kalau baru ketahuan sekarang (belum
// pernah diingatkan hari ini — mis. topik itu jadwalnya SETELAH 17:30,
// atau baru muncul), ditampilkan polos tanpa tanda eskalasi.
//
// RIWAYAT: rekap ini JUGA dicatat sebagai StaffBroadcast(kind=
// AUTO_REMINDER, topic="leaderRecap") — permintaan owner: "masukkan
// history broadcast Novi juga ke tab baru Broadcast Sales" — jadi tab
// Riwayat merekap SEMUA broadcast (manual, per-sales, DAN leader) di satu
// tempat, tanpa endpoint/state kedua.
//
// PENERIMA: User dengan isSalesTeamLead=true (Novi) — dicari lewat flag
// itu, BUKAN hardcode nama "Novi", supaya kalau suatu hari leader lain
// ditambah/diganti, tidak perlu ubah kode (sama prinsip D-010: jangan
// infer peran dari nama).
//
// STAGED UNTUK REVIEW: `enabled: false` by default, sama pola dgn semua
// job WA lain di project ini — aman di-deploy, tidak pernah kirim WA
// sampai owner eksplisit menyalakan setelah meninjau contoh pesan (lihat
// scripts/preview-leader-recap.js).

import cron from "node-cron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { sendText, getDefaultOpsSession } from "./wahaClient.js";
import { readSalesPhoneDirectory, resolveSalesPhone } from "./salesPhoneDirectory.js";
import { startOfDayWIB, nowPartsWIB, formatWIB } from "../utils/wib.js";
import {
  readConfig as readSalesReminderConfig,
  loadUnansweredBySales,
  loadIncompleteDataBySales,
  loadZeroClosingSalesIds,
  loadStatusTransitionReminderBySales,
  daftarSalesAktif,
} from "./salesReminderDigestJob.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, "../../data/settings.json");

const DEFAULT_CONFIG = {
  enabled: false, // lihat catatan header — sengaja mati sampai ditinjau owner
  cronExpression: "30 17 * * 1-6", // 17:30 WIB, Senin-Sabtu — 30 menit setelah topik terakhir (zeroClosing, 17:00)
};

function readConfig() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")); } catch { raw = {}; }
  return { ...DEFAULT_CONFIG, ...(raw.leaderRecap || {}) };
}

async function kirimWA(phone, pesan, label) {
  try {
    await sendText(phone, pesan, null, getDefaultOpsSession());
    console.log(`[leader-recap] (${label}) terkirim ke`, phone);
    return true;
  } catch (err) {
    console.warn(`[leader-recap] Gagal kirim WA (${label}) ke ${phone}:`, err.message);
    return false;
  }
}

// Semua baris StaffBroadcast(kind=AUTO_REMINDER) yang dicatat HARI INI —
// dipakai menandai "sudah diingatkan, masih belum diselesaikan" per topik
// per sales. Dimuat SEKALI (bukan query per sales/topik) — volume kecil.
async function loadRemindedTodaySet(now) {
  const { year, month, day } = nowPartsWIB(new Date(now));
  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const rows = await prisma.staffBroadcast.findMany({
    where: { kind: "AUTO_REMINDER", createdAt: { gte: startOfDayWIB(todayStr) } },
    select: { topic: true, recipientIds: true },
  });
  const set = new Set(); // `${topic}:${salesId}`
  for (const r of rows) for (const id of r.recipientIds) set.add(`${r.topic}:${id}`);
  return set;
}

function tandaiEskalasi(remindedTodaySet, topicKey, salesId) {
  return remindedTodaySet.has(`${topicKey}:${salesId}`) ? " ⚠️ _(sudah diingatkan, belum ditindaklanjuti)_" : "";
}

function baris1Sales({ sales, unread, hanging, incomplete, processing, followUp, zeroClosingIds, remindedTodaySet }) {
  const item = [];
  const u = unread.get(sales.id);
  if (u?.length) item.push(`📩 ${u.length} chat belum dibaca${tandaiEskalasi(remindedTodaySet, "unread", sales.id)}`);
  const h = hanging.get(sales.id);
  if (h?.length) item.push(`👀 ${h.length} chat menggantung${tandaiEskalasi(remindedTodaySet, "hanging", sales.id)}`);
  const inc = incomplete.get(sales.id);
  if (inc?.length) item.push(`📋 ${inc.length} order data belum lengkap${tandaiEskalasi(remindedTodaySet, "incomplete", sales.id)}`);
  const proc = processing.get(sales.id);
  if (proc?.length) item.push(`🏭 ${proc.length} order Diproses belum di-update ke customer${tandaiEskalasi(remindedTodaySet, "processing", sales.id)}`);
  const fu = followUp.get(sales.id);
  if (fu?.length) item.push(`⭐ ${fu.length} follow-up H+1 belum dilakukan${tandaiEskalasi(remindedTodaySet, "followUp", sales.id)}`);
  if (zeroClosingIds.has(sales.id)) item.push(`💰 belum closing hari ini`);

  if (item.length === 0) return `✅ *${sales.name}* — semua aman`;
  return `*${sales.name}*\n${item.map((i) => `- ${i}`).join("\n")}`;
}

// Fungsi murni-hitung (TANPA kirim WA) — dipakai job asli DAN
// scripts/preview-leader-recap.js.
export async function buildRecap({ referenceNow = new Date() } = {}) {
  const config = readConfig();
  const salesConfig = readSalesReminderConfig();
  const now = referenceNow.getTime();

  const salesList = await daftarSalesAktif();
  const { unread, hanging } = await loadUnansweredBySales(salesConfig, now);
  const incomplete = await loadIncompleteDataBySales(salesConfig);
  const processing = await loadStatusTransitionReminderBySales(salesConfig, now, "PROCESSING");
  const followUp = await loadStatusTransitionReminderBySales(salesConfig, now, "DELIVERED");
  const zeroClosingIds = new Set(await loadZeroClosingSalesIds(salesList, now));
  const remindedTodaySet = await loadRemindedTodaySet(now);

  const barisTim = salesList.map((sales) => baris1Sales({
    sales, unread, hanging, incomplete, processing, followUp, zeroClosingIds, remindedTodaySet,
  }));

  const pesan = [
    `📊 *Rekap Tim Hari Ini* — ${formatWIB(referenceNow)}`,
    "",
    barisTim.join("\n\n"),
  ].join("\n");

  const leaders = await prisma.user.findMany({
    where: { isSalesTeamLead: true, active: true },
    select: { id: true, name: true },
  });

  return { config, pesan, leaders };
}

export async function runLeaderRecapCycle({ referenceNow = new Date(), dryRun = false } = {}) {
  const { config, pesan, leaders } = await buildRecap({ referenceNow });
  const summary = { enabled: config.enabled, leaders: leaders.length, sent: 0, skippedNoPhone: 0, skippedAlreadySent: 0 };

  const directory = readSalesPhoneDirectory();

  // Idempotensi — sama prinsip dgn dispatchSection() di
  // salesReminderDigestJob.js: cek dulu apakah rekap SUDAH tercatat
  // terkirim ke leader ini hari ini sebelum kirim lagi.
  let sudahDikirimHariIni = new Set();
  if (!dryRun && config.enabled) {
    const { year, month, day } = nowPartsWIB(referenceNow);
    const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const existing = await prisma.staffBroadcast.findMany({
      where: { kind: "AUTO_REMINDER", topic: "leaderRecap", createdAt: { gte: startOfDayWIB(todayStr) } },
      select: { recipientIds: true },
    });
    for (const row of existing) for (const id of row.recipientIds) sudahDikirimHariIni.add(id);
  }

  for (const leader of leaders) {
    const phone = resolveSalesPhone(leader.name, directory);
    if (dryRun) {
      console.log(`[leader-recap] (dryRun) TIDAK dikirim ke ${leader.name} (${phone || "no phone"}):\n${pesan}\n`);
      continue;
    }
    if (!config.enabled) continue;
    if (sudahDikirimHariIni.has(leader.id)) { summary.skippedAlreadySent++; continue; }
    if (!phone) { summary.skippedNoPhone++; continue; }

    const ok = await kirimWA(phone, pesan, `Rekap Tim — ${leader.name}`);
    await prisma.staffBroadcast.create({
      data: {
        message: pesan,
        recipientIds: [leader.id],
        scheduledAt: referenceNow,
        status: "SENT",
        sentAt: new Date(),
        kind: "AUTO_REMINDER",
        topic: "leaderRecap",
        results: { [leader.id]: { nama: leader.name, phone, status: ok ? "TERKIRIM" : "GAGAL" } },
      },
    }).catch((err) => console.error("[leader-recap] Gagal catat riwayat:", err.message));
    if (ok) summary.sent++;
  }
  return summary;
}

export function startLeaderRecapJob() {
  const config = readConfig();
  cron.schedule(config.cronExpression, async () => {
    console.log("[leader-recap] Cron fired");
    await runLeaderRecapCycle();
  }, { timezone: "Asia/Jakarta" });
  console.log(`[leader-recap] Job terdaftar — jadwal "${config.cronExpression}" (Asia/Jakarta), enabled=${config.enabled}`);
}
