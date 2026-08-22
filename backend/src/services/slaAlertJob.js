// ─── SLA & BACKLOG ALERT (real-time) ─────────────────────────────────────────
//
// Dua kondisi breach yang dideteksi tiap siklus cron (pola sama seperti
// services/reconciliation.js — node-cron, timezone Asia/Jakarta):
//
//   1. Lead unassigned  — Conversation INDIVIDUAL, belum RESOLVED, belum
//      punya assignedToId, sudah lebih dari N menit sejak dibuat.
//   2. FRT breach       — Conversation INDIVIDUAL, belum RESOLVED, pesan
//      TERAKHIR arahnya INBOUND (customer menunggu balasan) sudah lebih dari
//      SLA menit (15 jam kerja / 30 luar jam kerja, default) sejak masuk.
//      Kalau tetap tidak ditangani sampai 2x SLA → eskalasi ke supervisor.
//
// KENAPA KONDISI 1 DI-AGREGASI (BUKAN PER-LEAD): backlog unassigned nyata di
// production ada di kisaran 800-900 percakapan (kondisi awal, bukan kasus
// langka) — notifikasi PER-LEAD di volume itu akan membanjiri WA admin setiap
// siklus cron. Sebagai gantinya kirim SATU ringkasan (jumlah + beberapa
// contoh tertua) dengan cooldown-nya sendiri.
//
// CHANNEL (revisi 23 Agustus 2026 — grup WA "SANO SALES" sempat dicoba lalu
// diminta dihentikan tim): SEMUA notifikasi kirim ke NOMOR PRIBADI, bukan
// grup. Eskalasi 2x SLA dikelompokkan PER PENERIMA (1 pesan konsolidasi per
// sales pemegang, bukan 1 grup/1 admin) — kalau pemegangnya jelas & nomornya
// ada di config.salesPhoneDirectory, kirim langsung ke sales itu; kalau
// belum di-assign atau nomornya tidak terdaftar, jatuh ke config.adminName
// (default "Novi"). Lead-unassigned selalu ke admin (tidak ada pemegang
// untuk dikelompokkan).
//
// KONFIGURASI: dibaca dari data/settings.json key "slaAlert" (lihat
// DEFAULT_CONFIG di bawah untuk nilai default) — admin bisa ubah lewat
// PATCH /api/settings tanpa redeploy. File sama yang dipakai routes/settings.js,
// dibaca ulang tiap siklus cron (TIDAK di-cache) supaya perubahan langsung
// kepakai di siklus berikutnya.
//
// DEDUP: in-memory Map per proses (bukan tabel DB — lihat catatan di README
// kalau butuh proposal field baru untuk versi yang tahan restart). Konsekuensi
// yang disadari: restart backend bisa memicu SATU notifikasi ulang untuk
// breach yang sudah pernah dinotif sebelum restart. Cukup untuk 1 backend
// instance yang jarang restart di luar jam deploy.

import cron from "node-cron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { sendText, getDefaultOpsSession } from "./wahaClient.js";
import { sendEmailAlert } from "./emailAlert.js";
import { sendPushToUser } from "./expoPush.js";
import { formatWIB, isWorkingHoursWIB } from "../utils/wib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, "../../data/settings.json");

// Nomor admin/supervisor — SAMA dengan yang sudah dipakai routes/internal.js
// untuk alert ops lain (backup gagal, WAHA putus), supaya tidak menambah
// channel/nomor baru yang belum dikonfirmasi tim.
const ADMIN_PHONE = process.env.BACKUP_NOTIFY_PHONE;

const DEFAULT_CONFIG = {
  enabled: true,
  cronExpression: "*/5 * * * *", // tiap 5 menit
  unassignedThresholdMinutes: 10,
  frtWorkingHoursMinutes: 15,
  frtOffHoursMinutes: 30,
  workingHourStart: 8, // WIB, inklusif
  workingHourEnd: 17, // WIB, eksklusif
  escalationMultiplier: 2, // eskalasi setelah 2x SLA
  reNotifyCooldownMinutes: 30, // jangan notif ulang breach yang sama dalam window ini
  maxFrtNotificationsPerCycle: 20, // batas push/notif individual per siklus — sisanya diproses siklus berikutnya (oldest-first)
  salesPhoneDirectory: [], // [{ name: "Ervina", phone: "6285710834203" }, ...] — resolusi nomor WA sales dari nama
  adminName: "Novi", // penerima default notifikasi admin (lead unassigned, eskalasi tanpa pemegang) — harus ada di salesPhoneDirectory
};

function readSlaConfig() {
  let stored = {};
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    stored = raw.slaAlert || {};
  } catch {
    stored = {};
  }
  return { ...DEFAULT_CONFIG, ...stored };
}

// Cari nomor sales dari config.salesPhoneDirectory (data/settings.json) —
// matching case-insensitive by name karena User model TIDAK punya kolom
// phone (lihat CLAUDE.md), jadi mapping ini disimpan terpisah, admin-editable
// tanpa migration. Balikin null kalau tidak ketemu.
function resolveSalesPhone(name, directory) {
  if (!name || !Array.isArray(directory)) return null;
  const match = directory.find((d) => d.name?.toLowerCase() === name.toLowerCase());
  return match?.phone || null;
}

// ── Notifikasi WA individual (BUKAN grup — keputusan tim 23 Agustus 2026:
// grup WA dicoba sebentar lalu diminta dihentikan) ──────────────────────────
// Kirim ke NOMOR PRIBADI satu orang. Dipakai untuk 2 kasus:
//   (a) admin/leader (default: Novi, config.adminName) — lead unassigned,
//       eskalasi tanpa pemegang jelas / nomornya tidak terdaftar
//   (b) sales pemegang percakapan langsung — eskalasi yang JELAS pemegangnya
// Fallback: BACKUP_NOTIFY_PHONE (.env) kalau nomor dari directory tidak ada,
// lalu email — pola sama seperti routes/internal.js waha-alert.
async function notifyPhone(phone, pesan, label) {
  const target = phone || ADMIN_PHONE;
  if (!target) {
    console.warn(`[sla-alert] Tidak ada nomor tujuan (directory kosong & BACKUP_NOTIFY_PHONE belum diisi) — skip WA (${label})`);
  } else {
    try {
      await sendText(target, pesan, null, getDefaultOpsSession());
      console.log(`[sla-alert] Notifikasi WA (${label}) terkirim ke`, target);
      return;
    } catch (err) {
      console.warn(`[sla-alert] Gagal kirim WA (${label}) ke ${target}, coba email fallback:`, err.message);
    }
  }

  try {
    await sendEmailAlert({ subject: `⚠️ ${label} — Klinik Matras CRM`, text: pesan });
    console.log(`[sla-alert] Fallback email (${label}) terkirim`);
  } catch (err) {
    console.warn(`[sla-alert] Email fallback juga gagal (${label}):`, err.message);
  }
}

// Kirim ke admin/leader default (config.adminName, default "Novi").
async function notifyAdmin(config, pesan, label) {
  const adminPhone = resolveSalesPhone(config.adminName, config.salesPhoneDirectory);
  await notifyPhone(adminPhone, pesan, label);
}

// ── State dedup in-memory — lihat catatan header soal batasan restart ───────
const unassignedAlertState = { lastNotifiedAt: 0 };
// Eskalasi 2x SLA DIAGREGASI PER PENERIMA (bukan per-conversation) — alasan:
// begitu backlog nyata di-deploy pertama kali, production langsung punya
// 300+ conversation yang sudah lewat 2x SLA SEKALIGUS (diverifikasi 22
// Agustus 2026 — 363 escalation attempt dalam 1 siklus cron kalau dikirim
// per-conversation). Sekarang dikelompokkan per SALES PEMEGANG — 1 sales
// dengan 40 percakapan overdue dapat 1 pesan konsolidasi, bukan 40. Yang
// tidak jelas pemegangnya (belum di-assign / nomornya tidak ada di
// directory) masuk ke bucket "ADMIN" (Novi).
const escalationRecipientState = new Map(); // key: userId | "ADMIN" -> lastNotifiedAt
const frtNotified = new Map(); // conversationId -> { notifiedAt }

let cycleRunning = false; // cegah tumpang tindih siklus kalau job lambat

// ── Kondisi 1: lead baru belum di-assign ────────────────────────────────────
async function checkUnassignedLeads(config, now) {
  const cutoff = new Date(now - config.unassignedThresholdMinutes * 60_000);

  const breaching = await prisma.conversation.findMany({
    where: {
      type: "INDIVIDUAL",
      assignedToId: null,
      status: { not: "RESOLVED" },
      createdAt: { lte: cutoff },
    },
    select: {
      id: true,
      createdAt: true,
      customer: { select: { name: true, phone: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!breaching.length) return;

  const cooldownMs = config.reNotifyCooldownMinutes * 60_000;
  if (now - unassignedAlertState.lastNotifiedAt < cooldownMs) return;

  const contoh = breaching.slice(0, 5).map((c) => {
    const nama = c.customer?.name || c.customer?.phone || "(tanpa nama)";
    return `- ${nama} — masuk ${formatWIB(c.createdAt)}`;
  });
  const sisa = breaching.length - contoh.length;

  const pesan = [
    `⚠️ *${breaching.length} Lead Belum Di-assign* (>${config.unassignedThresholdMinutes} menit)`,
    "",
    ...contoh,
    sisa > 0 ? `...dan ${sisa} lainnya` : null,
    "",
    "Segera buka CRM > Inbox dan assign sales.",
  ].filter(Boolean).join("\n");

  unassignedAlertState.lastNotifiedAt = now;
  await notifyAdmin(config, pesan, "Lead Belum Di-assign");
}

// ── Kondisi 2: pesan masuk belum dibalas (FRT) + eskalasi 2x SLA ───────────
async function checkUnansweredMessages(config, now) {
  // Pola sama dengan ?unanswered=true di routes/conversations.js — DISTINCT ON
  // per conversationId untuk pesan terakhirnya, lalu saring INBOUND.
  const rows = await prisma.$queryRaw`
    SELECT c.id AS "conversationId", c."assignedToId", c."customerId", m."createdAt" AS "lastInboundAt"
    FROM "Conversation" c
    JOIN LATERAL (
      SELECT direction, "createdAt"
      FROM "Message"
      WHERE "conversationId" = c.id
      ORDER BY "createdAt" DESC
      LIMIT 1
    ) m ON true
    WHERE c.type = 'INDIVIDUAL'
      AND c.status != 'RESOLVED'
      AND m.direction = 'INBOUND'
  `;

  if (!rows.length) {
    frtNotified.clear();
    return;
  }

  const workingHours = isWorkingHoursWIB(new Date(now), {
    start: config.workingHourStart,
    end: config.workingHourEnd,
  });
  const slaMinutes = workingHours ? config.frtWorkingHoursMinutes : config.frtOffHoursMinutes;
  const escalationMinutes = slaMinutes * config.escalationMultiplier;
  const cooldownMs = config.reNotifyCooldownMinutes * 60_000;

  // Pisahkan dulu jadi 2 kelompok berdasarkan elapsed time — escalation
  // (>=2x SLA) diagregasi PER PENERIMA (lihat catatan escalationRecipientState
  // di atas), frt (1x-2x SLA) tetap per-conversation TAPI dibatasi jumlahnya per
  // siklus (maxFrtNotificationsPerCycle) supaya backlog awal yang besar tidak
  // membanjiri sales/admin sekaligus — sisanya diproses siklus-siklus berikutnya,
  // diprioritaskan yang PALING LAMA menunggu (oldest-first).
  const stillBreaching = new Set();
  const escalationBreaches = [];
  const frtBreaches = [];

  for (const row of rows) {
    const elapsedMinutes = (now - new Date(row.lastInboundAt).getTime()) / 60_000;
    if (elapsedMinutes < slaMinutes) continue; // belum breach

    stillBreaching.add(row.conversationId);
    const entry = { ...row, elapsedMinutes };
    if (elapsedMinutes >= escalationMinutes) escalationBreaches.push(entry);
    else frtBreaches.push(entry);
  }

  // ── Eskalasi (agregat PER PENERIMA) ─────────────────────────────────────
  if (escalationBreaches.length) {
    const assignedIds = [...new Set(escalationBreaches.map((r) => r.assignedToId).filter(Boolean))];
    const assignedUsers = assignedIds.length
      ? await prisma.user.findMany({ where: { id: { in: assignedIds } }, select: { id: true, name: true } })
      : [];
    const userMap = new Map(assignedUsers.map((u) => [u.id, u]));

    // Kelompokkan per penerima: sales pemegang (kalau nomornya ada di
    // directory) ATAU bucket "ADMIN" (belum di-assign / nomor tidak terdaftar).
    const groups = new Map(); // key -> { phone, label, items: [] }
    for (const r of escalationBreaches) {
      const sales = r.assignedToId ? userMap.get(r.assignedToId) : null;
      const phone = sales ? resolveSalesPhone(sales.name, config.salesPhoneDirectory) : null;
      const key = phone ? r.assignedToId : "ADMIN";
      if (!groups.has(key)) {
        groups.set(key, {
          phone: phone || null,
          label: phone ? sales.name : config.adminName,
          items: [],
        });
      }
      groups.get(key).items.push(r);
    }

    const contohIds = [...new Set(escalationBreaches.map((r) => r.customerId))];
    const customers = await prisma.customer.findMany({
      where: { id: { in: contohIds } },
      select: { id: true, name: true, phone: true },
    });
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    for (const [key, group] of groups) {
      const lastNotifiedAt = escalationRecipientState.get(key) || 0;
      if (now - lastNotifiedAt < cooldownMs) continue;

      group.items.sort((a, b) => b.elapsedMinutes - a.elapsedMinutes); // paling lama nunggu duluan
      const top5 = group.items.slice(0, 5);
      const contoh = top5.map((r) => {
        const c = customerMap.get(r.customerId);
        const nama = c?.name || c?.phone || "(tanpa nama)";
        return `- ${nama} — ${Math.floor(r.elapsedMinutes)} menit`;
      });
      const sisa = group.items.length - contoh.length;

      const isPersonal = key !== "ADMIN";
      const pesan = [
        isPersonal
          ? `🔴 *Eskalasi SLA — ${group.items.length} Percakapan Anda Belum Dibalas* (>2x SLA, ${escalationMinutes} menit)`
          : `🔴 *${group.items.length} Percakapan Eskalasi SLA* (>2x SLA, ${escalationMinutes} menit) — ${group.label}`,
        "",
        ...contoh,
        sisa > 0 ? `...dan ${sisa} lainnya` : null,
        "",
        isPersonal
          ? "Segera tindak lanjuti atau minta bantuan leader."
          : "Perlu penanganan supervisor segera — buka CRM > Inbox.",
      ].filter(Boolean).join("\n");

      escalationRecipientState.set(key, now);
      if (isPersonal) {
        await notifyPhone(group.phone, pesan, "Eskalasi SLA Belum Dibalas");
      } else {
        await notifyAdmin(config, pesan, "Eskalasi SLA Belum Dibalas");
      }
    }

    // Bersihkan state penerima yang sudah tidak punya breach lagi.
    const activeKeys = new Set(groups.keys());
    for (const key of escalationRecipientState.keys()) {
      if (!activeKeys.has(key)) escalationRecipientState.delete(key);
    }
  }

  // ── FRT breach level pertama (per-conversation, dibatasi per siklus) ────
  frtBreaches.sort((a, b) => b.elapsedMinutes - a.elapsedMinutes); // paling lama nunggu duluan
  let sentThisCycle = 0;

  for (const row of frtBreaches) {
    if (sentThisCycle >= config.maxFrtNotificationsPerCycle) break; // sisanya siklus berikutnya

    const state = frtNotified.get(row.conversationId) || { notifiedAt: 0 };
    if (now - state.notifiedAt < cooldownMs) continue; // sudah dinotif baru-baru ini

    const customer = await prisma.customer.findUnique({
      where: { id: row.customerId },
      select: { name: true, phone: true },
    });
    const nama = customer?.name || customer?.phone || "(tanpa nama)";
    const menit = Math.floor(row.elapsedMinutes);
    const title = "SLA Belum Dibalas";
    const body = `${nama} sudah menunggu ${menit} menit tanpa balasan.`;

    if (row.assignedToId) {
      await sendPushToUser(row.assignedToId, {
        title,
        body,
        data: { type: "sla_breach", conversationId: row.conversationId },
      });
    } else {
      // Belum ada pemegang — fallback ke channel umum (admin), konsisten
      // dengan acceptance criteria "atau ke channel umum kalau belum ada
      // pemegang".
      await notifyAdmin(config, `⚠️ *${title}*\n\n${body}\n\nConversation belum di-assign ke sales manapun.`, title);
    }

    state.notifiedAt = now;
    frtNotified.set(row.conversationId, state);
    sentThisCycle++;
  }

  // Bersihkan entri yang sudah tidak breach lagi (sudah dibalas sales) —
  // supaya kalau nanti breach lagi di conversation yang sama, dianggap
  // kejadian BARU (bukan ketiban cooldown dari breach sebelumnya).
  for (const id of frtNotified.keys()) {
    if (!stillBreaching.has(id)) frtNotified.delete(id);
  }
}

async function runSlaAlertCycle() {
  if (cycleRunning) return; // jangan tumpuk siklus
  cycleRunning = true;
  const config = readSlaConfig();
  if (!config.enabled) {
    cycleRunning = false;
    return;
  }

  const now = Date.now();
  try {
    await checkUnassignedLeads(config, now);
  } catch (err) {
    console.error("[sla-alert] Error checkUnassignedLeads:", err.message);
  }

  try {
    await checkUnansweredMessages(config, now);
  } catch (err) {
    console.error("[sla-alert] Error checkUnansweredMessages:", err.message);
  } finally {
    cycleRunning = false;
  }
}

export function startSlaAlertJob() {
  const config = readSlaConfig();
  cron.schedule(config.cronExpression, async () => {
    await runSlaAlertCycle();
  }, { timezone: "Asia/Jakarta" });
  console.log(`[sla-alert] Job terdaftar — jadwal "${config.cronExpression}" (Asia/Jakarta)`);
}

// Diekspor untuk keperluan test/manual trigger (mis. script verifikasi),
// sama seperti runReconciliation() di reconciliation.js.
export { runSlaAlertCycle };
