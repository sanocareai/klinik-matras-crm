// ─── STALE LEAD ALERT (harian) ────────────────────────────────────────────
//
// Men-surface pelanggan urgency TINGGI (skorUrgensi.urgensi dari Sano
// Intelligence Engine — sama persis yang dilihat sales lewat tool MCP
// detail_pelanggan) yang BELUM ada tindak lanjut (pesan OUTBOUND dari sales)
// dalam N hari — supaya kasus seperti Ivan Syahridwan (kirim shareloc,
// urgency HIGH, tidak di-follow-up 18 hari) tidak terkubur di profil
// pelanggan satu-satu, ketahuan lewat agregasi harian lintas semua sales.
//
// REUSE, BUKAN REIMPLEMENTASI:
//   - Skor urgensi & alasan: buildCustomerIntelligence() dari
//     services/intelligence/ (PERSIS logic yang sudah dipakai CRM & tool MCP
//     detail_pelanggan — file ini TIDAK mengubah/menyentuh logic itu sama
//     sekali, cuma MEMBACA hasilnya).
//   - Channel notifikasi: primitif WA (sendText/getDefaultOpsSession) + email
//     fallback (sendEmailAlert) yang SAMA dengan services/slaAlertJob.js,
//     termasuk pola resolusi nomor sales dari config.slaAlert.salesPhoneDirectory
//     (BUKAN channel/directory baru — sengaja dibaca dari key settings yang
//     sama supaya 1 sumber kebenaran nomor WA sales, tidak dobel-maintain).
//   - Pola job: cron + runXCycle()/startXJob() terpisah, config dari
//     data/settings.json, in-memory dedup/escalation state — SAMA arsitektur
//     dengan slaAlertJob.js (bukan pola baru).
//
// KENAPA "BELUM DI-FOLLOW-UP" = "belum ada OUTBOUND dalam N hari" (BUKAN
// tabel/state baru "kapan pertama kali ditandai urgent"): pesan
// OUTBOUND/INBOUND sudah otomatis ter-load lewat CUSTOMER_SELECT (dipakai
// intelligence engine), jadi dihitung LANGSUNG dari data yang sudah di-fetch
// — TIDAK ADA query tambahan per pelanggan (no N+1), dan TIDAK butuh
// schema/tabel baru (stop condition: jangan ubah schema intelligence engine;
// prinsip yang sama diperluas ke: jangan tambah state persisten kalau bisa
// dihitung langsung dari data yang ada, sama seperti slaAlertJob.js memilih
// in-memory Map dibanding tabel DB baru).
//
// KETERBATASAN YANG DISADARI: CUSTOMER_SELECT cuma memuat 3 percakapan
// TERBARU x 20 pesan TERBARU per percakapan (dibatasi utk widget on-demand
// di intelligence engine). "Pesan OUTBOUND terakhir" dihitung dari jendela
// itu — kalau customer mengirim 20+ pesan INBOUND beruntun TANPA balasan
// SAMA SEKALI di antaranya (skenario yang sangat tidak wajar), outbound
// lebih lama bisa tidak terhitung. Diterima sebagai trade-off (sama filosofi
// dengan MAX_MESSAGES_PER_TRANSCRIPT di Quality Scorer) — bukan bug, akurat
// utk 99%+ kasus nyata.
//
// ESKALASI: sama pola dgn slaAlertJob.js — kalau X hari sejak alert PERTAMA
// customer itu masih urgency tinggi & masih belum ada OUTBOUND baru sejak
// alert pertama, eskalasi ke supervisor/admin (config.slaAlert.adminName).

import cron from "node-cron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { buildCustomerIntelligence, loadAllPriorityCandidates } from "./intelligence/index.js";
import { sendText, getDefaultOpsSession } from "./wahaClient.js";
import { sendEmailAlert } from "./emailAlert.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, "../../data/settings.json");

const ADMIN_PHONE = process.env.BACKUP_NOTIFY_PHONE;

const DEFAULT_CONFIG = {
  enabled: true,
  cronExpression: "0 8 * * *", // 08:00 WIB tiap hari — awal jam kerja, sales bisa langsung tindak lanjut
  urgencyThreshold: "high", // skorUrgensi.urgensi minimal ("low"|"medium"|"high") — ordinal, lihat URGENCY_RANK
  followUpDays: 3, // N — dianggap "belum ditindaklanjuti" kalau OUTBOUND terakhir >= N hari lalu (atau belum pernah ada OUTBOUND)
  escalationDays: 3, // X — eskalasi ke supervisor kalau X hari sejak ALERT PERTAMA tanpa OUTBOUND baru
  maxCandidates: 3000, // jaring pengaman query — lihat loadAllPriorityCandidates
};

const URGENCY_RANK = { low: 0, medium: 1, high: 2 };

function readConfig() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")); } catch { raw = {}; }
  return {
    ...DEFAULT_CONFIG,
    ...(raw.staleLeadAlert || {}),
    // Directory nomor WA & nama admin default DIBACA dari key "slaAlert" yang
    // SUDAH ADA — bukan konfigurasi baru yang perlu di-maintain terpisah.
    salesPhoneDirectory: raw.slaAlert?.salesPhoneDirectory || [],
    adminName: raw.slaAlert?.adminName || "Novi",
  };
}

function resolveSalesPhone(name, directory) {
  if (!name || !Array.isArray(directory)) return null;
  const match = directory.find((d) => d.name?.toLowerCase() === name.toLowerCase());
  return match?.phone || null;
}

async function notifyPhone(phone, pesan, label) {
  const target = phone || ADMIN_PHONE;
  if (!target) {
    console.warn(`[stale-lead-alert] Tidak ada nomor tujuan — skip WA (${label})`);
  } else {
    try {
      await sendText(target, pesan, null, getDefaultOpsSession());
      console.log(`[stale-lead-alert] Notifikasi WA (${label}) terkirim ke`, target);
      return;
    } catch (err) {
      console.warn(`[stale-lead-alert] Gagal kirim WA (${label}) ke ${target}, coba email fallback:`, err.message);
    }
  }
  try {
    await sendEmailAlert({ subject: `⚠️ ${label} — Klinik Matras CRM`, text: pesan });
    console.log(`[stale-lead-alert] Fallback email (${label}) terkirim`);
  } catch (err) {
    console.warn(`[stale-lead-alert] Email fallback juga gagal (${label}):`, err.message);
  }
}

async function notifyAdmin(config, pesan, label) {
  const adminPhone = resolveSalesPhone(config.adminName, config.salesPhoneDirectory);
  await notifyPhone(adminPhone, pesan, label);
}

// Pesan OUTBOUND terakhir dari data yang SUDAH dimuat CUSTOMER_SELECT — TIDAK
// ada query tambahan (lihat catatan keterbatasan di header file).
function lastOutboundAt(customer) {
  let latest = null;
  for (const conv of customer.conversations || []) {
    for (const m of conv.messages || []) {
      if (m.direction === "OUTBOUND") {
        const t = new Date(m.createdAt);
        if (!latest || t > latest) latest = t;
      }
    }
  }
  return latest;
}

// Pesan INBOUND (dari customer) TERAKHIR — dipakai filter noise di bawah.
// Sumber data SAMA dgn lastOutboundAt (sudah dimuat CUSTOMER_SELECT).
function lastInboundMessage(customer) {
  let latest = null;
  for (const conv of customer.conversations || []) {
    for (const m of conv.messages || []) {
      if (m.direction === "INBOUND") {
        const t = new Date(m.createdAt);
        if (!latest || t > latest.time) latest = { time: t, content: m.content || "" };
      }
    }
  }
  return latest?.content ?? null;
}

// ── Filter NOISE (28 Agustus 2026) — ditemukan lewat spot-check manual thd
// sample OR-logic: sebagian customer yang lolos threshold urgency TERNYATA
// pesan terakhirnya cuma basa-basi penutup ("siap", "baik kak") atau
// penolakan eksplisit ("engga dulu, mahal") — bukan pertanyaan/data yang
// benar-benar menggantung. Follow-up otomatis ke 2 pola ini berisiko
// terasa aneh (menagih respons ke basa-basi) atau memaksa (follow-up ke
// yang sudah bilang tidak). Pattern-matching SEDERHANA (bukan LLM — volume
// ratusan baris per hari, LLM per-baris di tahap filter tidak worth biayanya)
// dan SENGAJA konservatif: kalau tidak yakin, JANGAN exclude (default kirim,
// bukan default skip) — resiko lead terlewat > resiko follow-up ke yang santai.
//
// Pola 1: closing pleasantry TANPA tanda tanya/angka — heuristik "pendek +
// cuma berisi kata penutup umum" (bukan daftar exhaustive, sengaja sempit).
const CLOSING_PLEASANTRY_TOKENS = [
  "siap", "baik", "baik kak", "baik ibu", "baik pak", "ok", "oke", "okay",
  "sip", "noted", "terima kasih", "makasih", "trims", "tks", "thanks",
  "ok terima kasih", "oke terima kasih", "baik terima kasih", "siap kak",
  "siap ibu", "sip kak", "ok sip",
];
function isClosingPleasantry(text) {
  if (!text) return false;
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s?]/gu, "") // buang emoji/tanda baca, PERTAHANKAN "?"
    .trim();
  if (normalized.includes("?")) return false; // ada tanda tanya = jelas bukan penutup
  if (/\d/.test(normalized)) return false; // ada angka (mis. berat badan/harga) = data menggantung, bukan basa-basi
  const stripped = normalized.replace(/\?/g, "").trim();
  if (!stripped || stripped.split(/\s+/).length > 4) return false; // terlalu panjang utk "cuma penutup"
  return CLOSING_PLEASANTRY_TOKENS.includes(stripped);
}

// Pola 2: penolakan eksplisit — "ga jadi"/"batal" berdiri sendiri sudah
// cukup jadi sinyal; "mahal" HANYA dihitung kalau dikombinasikan dengan kata
// negasi di pesan yang sama (sebutan harga polos, mis. "berapa harganya kak"
// bukan penolakan).
const DECLINE_STANDALONE_PATTERN = /\b(g[a]?\s*jadi|tidak\s*jadi|nggak\s*jadi|enggak\s*jadi|batal(in|kan)?|e?ngga\s*dulu|nggak\s*dulu|ga\s*dulu|tidak\s*dulu)\b/i;
const NEGATION_WORD_PATTERN = /\b(ga|gak|nggak|enggak|engga|tidak|blm|belum)\b/i;
const MAHAL_PATTERN = /\bmahal\b/i;
function isExplicitDecline(text) {
  if (!text) return false;
  if (DECLINE_STANDALONE_PATTERN.test(text)) return true;
  return MAHAL_PATTERN.test(text) && NEGATION_WORD_PATTERN.test(text);
}

function wibDateKey(now) {
  return new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
}

export async function runStaleLeadAlertCycle({ referenceNow = new Date() } = {}) {
  const config = readConfig();
  const summary = { enabled: config.enabled, candidatesScanned: 0, staleFound: 0, excludedNoise: 0, orphanedInactiveSales: 0, salesNotified: 0, escalated: 0, errors: [] };
  if (!config.enabled) return summary;

  const now = referenceNow.getTime();
  const todayKey = wibDateKey(now);
  const thresholdRank = URGENCY_RANK[config.urgencyThreshold] ?? URGENCY_RANK.high;

  // Sales NONAKTIF (28 Agustus 2026, ditemukan lewat kasus Mila) — lead yang
  // masih ter-assign ke sales yang sudah `active:false` TIDAK BOLEH dikirim
  // alert WA atas nama sales itu (tidak akan ada yang menindaklanjuti, dan
  // nomor WA-nya mungkin sudah tidak dipakai). Dikumpulkan TERPISAH (orphaned)
  // utk di-reassign MANUAL — bukan auto-reassign (keputusan siapa yang pegang
  // tetap milik admin/Novi, bukan sistem).
  const inactiveSalesIds = new Set(
    (await prisma.user.findMany({ where: { active: false }, select: { id: true } })).map((u) => u.id)
  );

  // Tracking eskalasi DARI DB (28 Agustus 2026) — GANTI Map in-memory yang
  // terbukti reset tiap restart backend (deploy rutin), jadi eskalasi tidak
  // pernah sempat terpicu meski customer sungguhan sudah 3+ hari. Dimuat
  // SEKALI di awal (bukan query per-customer di dalam loop, hindari N+1),
  // dimodifikasi di variabel lokal spt Map biasa selama loop berjalan,
  // ditulis balik ke DB SEKALI di akhir (lihat blok persist di bawah).
  const existingLogs = await prisma.staleLeadAlertLog.findMany();
  const firstAlertedAt = new Map(existingLogs.map((l) => [l.customerId, l.firstAlertedAt.getTime()]));
  const lastNotifiedDay = new Map(existingLogs.map((l) => [l.customerId, l.lastNotifiedDay]).filter(([, v]) => v != null));

  let candidates;
  try {
    candidates = await loadAllPriorityCandidates(prisma, { limit: config.maxCandidates });
  } catch (err) {
    console.error("[stale-lead-alert] Gagal memuat kandidat:", err.message);
    summary.errors.push(`load kandidat: ${err.message}`);
    return summary;
  }
  summary.candidatesScanned = candidates.length;

  const stale = []; // { customer, intel, daysSinceOutbound }
  const toEscalate = []; // { customer, intel, daysSinceOutbound, daysSinceFirstAlert }
  const orphanedInactiveSales = []; // { customer, intel, daysSinceOutbound } — sales-nya nonaktif
  const activeCustomerIds = new Set();

  for (const customer of candidates) {
    const intel = buildCustomerIntelligence({ customer, conversations: customer.conversations });
    // OR-logic (28 Agustus 2026) — ditemukan lewat investigasi Ivan Syahridwan:
    // priority.urgency & nextAction.urgency dihitung dari SINYAL BEDA (priority
    // = skor gabungan multi-faktor, nextAction = aturan single-case "belum
    // dibalas X jam") — kasus nyata: priority.urgency="low" (skor gabungan
    // ketutup faktor lain) TAPI nextAction.urgency="high" (pesan belum dibalas
    // 459 jam), jadi kalau cuma priority.urgency dicek, customer itu TIDAK
    // PERNAH lolos threshold walau ada aksi mendesak. Sekarang lolos kalau
    // SALAH SATU rank-nya penuhi threshold (ambil yang TERTINGGI).
    const priorityRank = URGENCY_RANK[intel.priority.urgency] ?? URGENCY_RANK.low;
    const nextActionRank = URGENCY_RANK[intel.nextAction?.urgency] ?? URGENCY_RANK.low;
    const urgencyRank = Math.max(priorityRank, nextActionRank);
    if (urgencyRank < thresholdRank) continue;

    const lastOut = lastOutboundAt(customer);
    const daysSinceOutbound = lastOut ? Math.floor((now - lastOut.getTime()) / 86_400_000) : null;
    const isStale = daysSinceOutbound == null || daysSinceOutbound >= config.followUpDays;
    if (!isStale) continue;

    if (customer.assignedSalesId && inactiveSalesIds.has(customer.assignedSalesId)) {
      orphanedInactiveSales.push({ customer, intel, daysSinceOutbound });
      summary.orphanedInactiveSales++;
      continue;
    }

    // Filter noise (lihat catatan lengkap di isClosingPleasantry/isExplicitDecline
    // di atas) — SEBELUM dihitung sbg stale. Konservatif: kalau pesan terakhir
    // customer null (belum pernah kirim apa-apa, cuma OUTBOUND awal sales tanpa
    // balasan), TIDAK dianggap noise (tidak match kedua pattern) — tetap masuk.
    const lastInboundContent = lastInboundMessage(customer);
    if (isClosingPleasantry(lastInboundContent) || isExplicitDecline(lastInboundContent)) {
      summary.excludedNoise++;
      continue;
    }

    activeCustomerIds.add(customer.id);
    summary.staleFound++;

    if (!firstAlertedAt.has(customer.id)) firstAlertedAt.set(customer.id, now);
    const daysSinceFirstAlert = Math.floor((now - firstAlertedAt.get(customer.id)) / 86_400_000);

    // Eskalasi HANYA kalau belum ada OUTBOUND baru SEJAK alert pertama —
    // kalau sales sudah balas tapi masih dianggap "stale" karena urgency
    // masih tinggi lagi (kasus baru), firstAlertedAt di-reset di bawah
    // supaya tidak eskalasi berdasarkan alert lama yang sudah "selesai".
    const firstAlertTime = firstAlertedAt.get(customer.id);
    const outboundSinceFirstAlert = lastOut && lastOut.getTime() > firstAlertTime;
    if (outboundSinceFirstAlert) {
      firstAlertedAt.set(customer.id, now); // dianggap kejadian baru
    }

    if (!outboundSinceFirstAlert && daysSinceFirstAlert >= config.escalationDays) {
      toEscalate.push({ customer, intel, daysSinceOutbound, daysSinceFirstAlert });
    } else {
      // Kirim alert biasa ke sales HANYA kalau belum dikirim hari ini
      // (job harian — mestinya cuma jalan 1x/hari, ini jaring pengaman
      // kalau ada trigger manual berulang di hari yang sama).
      if (lastNotifiedDay.get(customer.id) !== todayKey) {
        stale.push({ customer, intel, daysSinceOutbound });
      }
    }
  }

  // ── Alert biasa, dikelompokkan PER SALES (assignedSalesId) ───────────────
  const bySales = new Map(); // key: userId | "UNASSIGNED" -> { name, phone, items: [] }
  for (const item of stale) {
    const salesName = item.customer.assignedSales?.name || null;
    const key = item.customer.assignedSalesId || "UNASSIGNED";
    if (!bySales.has(key)) {
      bySales.set(key, {
        name: salesName,
        phone: salesName ? resolveSalesPhone(salesName, config.salesPhoneDirectory) : null,
        items: [],
      });
    }
    bySales.get(key).items.push(item);
  }

  for (const [key, group] of bySales) {
    group.items.sort((a, b) => (b.daysSinceOutbound ?? 9999) - (a.daysSinceOutbound ?? 9999));
    const top10 = group.items.slice(0, 10);
    const contoh = top10.map(({ customer, intel, daysSinceOutbound }) => {
      const nama = customer.name || customer.phone || "(tanpa nama)";
      const hari = daysSinceOutbound == null ? "belum pernah dibalas" : `${daysSinceOutbound} hari tanpa tindak lanjut`;
      return `- *${nama}* — ${intel.nextAction.reason} (${hari})`;
    });
    const sisa = group.items.length - contoh.length;
    const isPersonal = key !== "UNASSIGNED" && group.phone;

    const pesan = [
      isPersonal
        ? `🟠 *${group.items.length} Lead Urgent Belum Ditindaklanjuti* (>${config.followUpDays} hari)`
        : `🟠 *${group.items.length} Lead Urgent Belum Ditindaklanjuti* (>${config.followUpDays} hari) — ${key === "UNASSIGNED" ? "belum di-assign" : group.name || "(sales tidak diketahui)"}`,
      "",
      ...contoh,
      sisa > 0 ? `...dan ${sisa} lainnya` : null,
      "",
      "Segera follow up sebelum makin dingin.",
    ].filter(Boolean).join("\n");

    if (isPersonal) {
      await notifyPhone(group.phone, pesan, "Lead Urgent Belum Ditindaklanjuti");
    } else {
      await notifyAdmin(config, pesan, "Lead Urgent Belum Ditindaklanjuti");
    }
    for (const item of group.items) lastNotifiedDay.set(item.customer.id, todayKey);
    summary.salesNotified++;
  }

  // ── Eskalasi ke supervisor/admin ─────────────────────────────────────────
  if (toEscalate.length) {
    toEscalate.sort((a, b) => b.daysSinceFirstAlert - a.daysSinceFirstAlert);
    const top10 = toEscalate.slice(0, 10);
    const contoh = top10.map(({ customer, intel, daysSinceFirstAlert }) => {
      const nama = customer.name || customer.phone || "(tanpa nama)";
      const sales = customer.assignedSales?.name || "belum di-assign";
      return `- *${nama}* (${sales}) — ${intel.nextAction.reason}, ${daysSinceFirstAlert} hari sejak alert pertama`;
    });
    const sisa = toEscalate.length - contoh.length;

    const pesan = [
      `🔴 *Eskalasi — ${toEscalate.length} Lead Urgent ${config.escalationDays}+ Hari Tanpa Tindak Lanjut*`,
      "",
      ...contoh,
      sisa > 0 ? `...dan ${sisa} lainnya` : null,
      "",
      "Perlu penanganan supervisor segera.",
    ].filter(Boolean).join("\n");

    await notifyAdmin(config, pesan, "Eskalasi Lead Urgent");
    for (const item of toEscalate) lastNotifiedDay.set(item.customer.id, todayKey);
    summary.escalated = toEscalate.length;
  }

  // Persist state ke DB (28 Agustus 2026) — GANTI cleanup Map in-memory lama.
  // Customer yang sudah TIDAK LAGI di activeCustomerIds (sudah ditindaklanjuti
  // atau urgensinya turun) → baris log dihapus, episode stale-nya dianggap
  // selesai. Yang MASIH aktif di-upsert dgn nilai firstAlertedAt/lastNotifiedDay
  // TERBARU dari Map lokal (sudah dimutasi sepanjang loop di atas + saat WA
  // terkirim di bawah) — inilah yang membuat hitungan hari SELAMAT dari
  // restart backend, beda dari Map in-memory murni sebelumnya.
  const toDeleteIds = existingLogs.map((l) => l.customerId).filter((id) => !activeCustomerIds.has(id));
  if (toDeleteIds.length) {
    await prisma.staleLeadAlertLog.deleteMany({ where: { customerId: { in: toDeleteIds } } }).catch((err) => {
      console.error("[stale-lead-alert] Gagal bersihkan log lama:", err.message);
    });
  }
  await Promise.all(
    [...activeCustomerIds].map((id) =>
      prisma.staleLeadAlertLog.upsert({
        where: { customerId: id },
        create: { customerId: id, firstAlertedAt: new Date(firstAlertedAt.get(id)), lastNotifiedDay: lastNotifiedDay.get(id) ?? null },
        update: { firstAlertedAt: new Date(firstAlertedAt.get(id)), lastNotifiedDay: lastNotifiedDay.get(id) ?? null },
      }).catch((err) => console.error(`[stale-lead-alert] Gagal simpan state utk ${id}:`, err.message))
    )
  );

  if (orphanedInactiveSales.length) {
    console.log(`[stale-lead-alert] ${orphanedInactiveSales.length} lead ter-assign ke sales NONAKTIF — TIDAK dikirim WA, perlu reassign manual:`);
    for (const { customer, daysSinceOutbound } of orphanedInactiveSales) {
      console.log(`  - [${customer.id}] ${customer.name || customer.phone || "(tanpa nama)"} (sales nonaktif: ${customer.assignedSales?.name}, ${daysSinceOutbound ?? "belum pernah dibalas"} hari)`);
    }
  }

  console.log(
    `[stale-lead-alert] Selesai. Kandidat: ${summary.candidatesScanned}, stale ditemukan: ${summary.staleFound}, dikecualikan (noise): ${summary.excludedNoise}, orphaned (sales nonaktif): ${summary.orphanedInactiveSales}, sales dinotif: ${summary.salesNotified}, eskalasi: ${summary.escalated}`
  );
  return summary;
}

export function startStaleLeadAlertJob() {
  const config = readConfig();
  cron.schedule(config.cronExpression, async () => {
    console.log("[stale-lead-alert] Cron fired");
    await runStaleLeadAlertCycle();
  }, { timezone: "Asia/Jakarta" });
  console.log(`[stale-lead-alert] Job terdaftar — jadwal "${config.cronExpression}" (Asia/Jakarta)`);
}
