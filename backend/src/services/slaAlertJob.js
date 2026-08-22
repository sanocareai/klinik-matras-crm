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
// contoh tertua) dengan cooldown-nya sendiri. Kondisi 2 & eskalasi TETAP
// per-conversation (sengaja) karena target notifikasinya beda-beda per sales
// pemegang, jadi volume per sales jauh lebih kecil dan relevan personal.
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

// ── Notifikasi dasar (WA admin dengan fallback email — pola sama persis
// dengan routes/internal.js waha-alert) ─────────────────────────────────────
async function notifyAdmin(pesan, label) {
  if (!ADMIN_PHONE) {
    console.warn(`[sla-alert] BACKUP_NOTIFY_PHONE belum diisi — skip notifikasi WA (${label})`);
  } else {
    try {
      await sendText(ADMIN_PHONE, pesan, null, getDefaultOpsSession());
      console.log(`[sla-alert] Notifikasi WA (${label}) terkirim ke`, ADMIN_PHONE);
      return;
    } catch (err) {
      console.warn(`[sla-alert] Gagal kirim WA (${label}), coba email fallback:`, err.message);
    }
  }

  try {
    await sendEmailAlert({ subject: `⚠️ ${label} — Klinik Matras CRM`, text: pesan });
    console.log(`[sla-alert] Fallback email (${label}) terkirim`);
  } catch (err) {
    console.warn(`[sla-alert] Email fallback juga gagal (${label}):`, err.message);
  }
}

// ── State dedup in-memory — lihat catatan header soal batasan restart ───────
const unassignedAlertState = { lastNotifiedAt: 0 };
const frtNotified = new Map(); // conversationId -> { notifiedAt, escalatedAt }

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
  await notifyAdmin(pesan, "Lead Belum Di-assign");
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

  const stillBreaching = new Set();

  for (const row of rows) {
    const elapsedMinutes = (now - new Date(row.lastInboundAt).getTime()) / 60_000;
    if (elapsedMinutes < slaMinutes) continue; // belum breach

    stillBreaching.add(row.conversationId);
    const state = frtNotified.get(row.conversationId) || { notifiedAt: 0, escalatedAt: 0 };

    const shouldEscalate = elapsedMinutes >= escalationMinutes && now - state.escalatedAt >= cooldownMs;
    const shouldNotify = !shouldEscalate && now - state.notifiedAt >= cooldownMs;

    if (!shouldEscalate && !shouldNotify) continue;

    const customer = await prisma.customer.findUnique({
      where: { id: row.customerId },
      select: { name: true, phone: true },
    });
    const nama = customer?.name || customer?.phone || "(tanpa nama)";
    const menit = Math.floor(elapsedMinutes);

    if (shouldEscalate) {
      const pesan = [
        `🔴 *Eskalasi SLA — Belum Dibalas ${menit} Menit*`,
        "",
        `Pelanggan: ${nama}`,
        `Sudah melewati 2x SLA (${slaMinutes} menit) tanpa balasan sales.`,
        "",
        "Perlu penanganan supervisor segera.",
      ].join("\n");
      await notifyAdmin(pesan, "Eskalasi SLA Belum Dibalas");
      state.escalatedAt = now;
    } else {
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
        await notifyAdmin(`⚠️ *${title}*\n\n${body}\n\nConversation belum di-assign ke sales manapun.`, title);
      }
      state.notifiedAt = now;
    }

    frtNotified.set(row.conversationId, state);
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
