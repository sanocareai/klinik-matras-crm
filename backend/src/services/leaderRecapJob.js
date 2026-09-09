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
  loadUnpaidDeliveredBySales,
  daftarSalesAktif,
} from "./salesReminderDigestJob.js";
// Poin 2 baru (9 Sep 2026, permintaan owner) — hitung job delivery/armada
// yang SELESAI hari ini, dipakai ulang dari services/deliveryCompletionNotify.js
// (SATU sumber kebenaran dgn notifikasi real-time ke sales), bukan
// diimplementasi ulang di sini.
import { loadJobsCompletedTodayBySales, loadJobsCompletedBetweenBySales } from "./deliveryCompletionNotify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, "../../data/settings.json");

const DEFAULT_CONFIG = {
  enabled: false, // lihat catatan header — sengaja mati sampai ditinjau owner
  cronExpression: "30 17 * * 1-6", // 17:30 WIB, Senin-Sabtu — 30 menit setelah topik terakhir (zeroClosing, 17:00)
  // Rekap Susulan Pagi (9 Sep 2026, permintaan owner: "ada job selesai
  // diatas jam 5 sore kirim ke novi besok jam 7 pagi") — lihat
  // buildMorningCatchup/runMorningCatchupCycle di bawah. Pakai FLAG SAMA
  // (`enabled` di atas) — bukan flag terpisah, karena ini bagian tak
  // terpisahkan dari fitur leaderRecap yang sudah owner nyalakan &
  // pahami, bukan topik baru yang perlu ditinjau ulang.
  morningCatchupCronExpression: "0 7 * * 1-6", // 07:00 WIB, Senin-Sabtu
};

// Jam:menit rekap SORE (HARUS sinkron dgn cronExpression default di atas,
// "30 17" = 17:30) — dipakai buildMorningCatchup() menghitung batas AWAL
// jendela "job yang selesai setelah rekap sore kemarin". Konstanta manual
// (bukan parse cronExpression) — SENGAJA, project ini condong ke simpel
// (lihat CLAUDE.md §2) drpd parser cron generik untuk satu titik pakai ini;
// kalau cronExpression rekap sore diubah owner, WAJIB update ini juga.
const EVENING_RECAP_CUTOFF_MINUTES = 17 * 60 + 30;

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

function baris1Sales({
  sales, unread, hanging, incomplete, processing, followUp, zeroClosingIds, remindedTodaySet,
  unpaidDelivered, completedJobsToday,
}) {
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
  // Poin 7 sales-reminder (9 Sep 2026) — reuse loader, escalation tag SAMA
  // topicKey ("unpaidDelivered") dgn dispatchSection() di
  // salesReminderDigestJob.js, walau topik itu sendiri masih staged
  // (unpaidDeliveredEnabled:false) — rekap Novi tetap tampilkan kondisinya
  // apa adanya, cuma tag ⚠️ "sudah diingatkan"-nya yang baru relevan begitu
  // topik itu dinyalakan owner.
  const up = unpaidDelivered.get(sales.id);
  if (up?.length) item.push(`💳 ${up.length} order terkirim belum LUNAS${tandaiEskalasi(remindedTodaySet, "unpaidDelivered", sales.id)}`);
  // Poin 2 baru (9 Sep 2026) — informasional (BUKAN masalah yang perlu
  // ditindaklanjuti), jadi TIDAK dapat tanda eskalasi ⚠️ seperti item lain.
  const cj = completedJobsToday.get(sales.id);
  if (cj?.length) item.push(`🚚 ${cj.length} pengiriman/pengambilan berhasil hari ini`);

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
  const unpaidDelivered = await loadUnpaidDeliveredBySales(salesConfig);
  const completedJobsToday = await loadJobsCompletedTodayBySales(now);

  const barisTim = salesList.map((sales) => baris1Sales({
    sales, unread, hanging, incomplete, processing, followUp, zeroClosingIds, remindedTodaySet,
    unpaidDelivered, completedJobsToday,
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

// ─── REKAP SUSULAN PAGI (9 September 2026, permintaan owner) ───────────────
// "just in case rekap ke novi kan setiap jam 5 sore ya, ada job selesai
// diatas jam 5 sore kirim ke novi besok jam 7 pagi" — rekap sore (di atas)
// dihitung SEKALI di 17:30 WIB, jadi job yang baru selesai SETELAH momen
// itu (mis. driver pulang malam) tidak pernah muncul di rekap manapun
// sampai skema ini ada. Cakupan SEMPIT (BUKAN rekap ulang semua 7 topik) —
// cuma job delivery/armada yang selesai di jendela [kemarin 17:30, sekarang
// WIB), pakai loadJobsCompletedBetweenBySales() yang sama dgn rekap sore.
// DIAM kalau kosong (tidak ada job selesai di jendela itu) — konsisten dgn
// prinsip "hindari notifikasi berlebihan" yang sudah dipegang di seluruh
// sistem broadcast ini (lihat header salesReminderDigestJob.js).
export async function buildMorningCatchup({ referenceNow = new Date() } = {}) {
  const config = readConfig();
  const now = referenceNow.getTime();
  const { year, month, day } = nowPartsWIB(new Date(now));
  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const cutoffKemarin = new Date(
    startOfDayWIB(todayStr).getTime() - 86_400_000 + EVENING_RECAP_CUTOFF_MINUTES * 60_000
  );

  const completedBySales = await loadJobsCompletedBetweenBySales(cutoffKemarin, referenceNow);
  const salesList = await daftarSalesAktif();

  const barisTim = salesList
    .map((sales) => {
      const items = completedBySales.get(sales.id);
      if (!items?.length) return null;
      return `*${sales.name}*\n${items.map((i) => `- ${i.tipe}: ${i.nama} (${i.orderNumber})`).join("\n")}`;
    })
    .filter(Boolean);

  if (barisTim.length === 0) return { config, pesan: null, leaders: [] }; // tidak ada yang perlu dilaporkan — diam

  const pesan = [
    `🌙 *Rekap Susulan* — pengiriman/pengambilan yang selesai setelah rekap sore kemarin:`,
    "",
    barisTim.join("\n\n"),
  ].join("\n");

  const leaders = await prisma.user.findMany({
    where: { isSalesTeamLead: true, active: true },
    select: { id: true, name: true },
  });

  return { config, pesan, leaders };
}

export async function runMorningCatchupCycle({ referenceNow = new Date(), dryRun = false } = {}) {
  const { config, pesan, leaders } = await buildMorningCatchup({ referenceNow });
  const summary = { enabled: config.enabled, leaders: leaders.length, sent: 0, skippedNoPhone: 0, skippedAlreadySent: 0, skippedEmpty: !pesan };
  if (!pesan) return summary; // tidak ada job susulan — diam, tidak kirim apa pun

  const directory = readSalesPhoneDirectory();

  let sudahDikirimHariIni = new Set();
  if (!dryRun && config.enabled) {
    const { year, month, day } = nowPartsWIB(referenceNow);
    const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const existing = await prisma.staffBroadcast.findMany({
      where: { kind: "AUTO_REMINDER", topic: "leaderRecapMorningCatchup", createdAt: { gte: startOfDayWIB(todayStr) } },
      select: { recipientIds: true },
    });
    for (const row of existing) for (const id of row.recipientIds) sudahDikirimHariIni.add(id);
  }

  for (const leader of leaders) {
    const phone = resolveSalesPhone(leader.name, directory);
    if (dryRun) {
      console.log(`[leader-recap] (dryRun, catch-up pagi) TIDAK dikirim ke ${leader.name} (${phone || "no phone"}):\n${pesan}\n`);
      continue;
    }
    if (!config.enabled) continue;
    if (sudahDikirimHariIni.has(leader.id)) { summary.skippedAlreadySent++; continue; }
    if (!phone) { summary.skippedNoPhone++; continue; }

    const ok = await kirimWA(phone, pesan, `Rekap Susulan Pagi — ${leader.name}`);
    await prisma.staffBroadcast.create({
      data: {
        message: pesan,
        recipientIds: [leader.id],
        scheduledAt: referenceNow,
        status: "SENT",
        sentAt: new Date(),
        kind: "AUTO_REMINDER",
        topic: "leaderRecapMorningCatchup",
        results: { [leader.id]: { nama: leader.name, phone, status: ok ? "TERKIRIM" : "GAGAL" } },
      },
    }).catch((err) => console.error("[leader-recap] Gagal catat riwayat (catch-up pagi):", err.message));
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
  cron.schedule(config.morningCatchupCronExpression, async () => {
    console.log("[leader-recap] Cron (catch-up pagi) fired");
    await runMorningCatchupCycle();
  }, { timezone: "Asia/Jakarta" });
  console.log(`[leader-recap] Job terdaftar — jadwal "${config.cronExpression}" + catch-up pagi "${config.morningCatchupCronExpression}" (Asia/Jakarta), enabled=${config.enabled}`);
}
