// ─── DETEKSI NOMOR STAF INTERNAL ────────────────────────────────────────────
// Ditambahkan 30 Agustus 2026, dari investigasi laporan Traffic: owner
// bertanya apakah 494 lead "WhatsApp Langsung" bulan itu BENAR semua
// organik. Jawabannya tidak — sebagian ternyata nomor pribadi TIM INTERNAL
// (bukan pelanggan sama sekali) yang kena "Customer" gara-gara otomasi
// (services/slaAlertJob.js, mis. "Eskalasi SLA"/"Lead Urgent") mengirim WA
// ke nomor itu lewat sesi CS yang sama dipakai untuk pelanggan asli.
// Contoh nyata yang diverifikasi manual: 2 nomor TANPA nama sama sekali,
// isi percakapannya 100% pesan bot eskalasi (0 balasan asli) — jelas bukan
// lead, hanya kebetulan lolos jadi Customer karena webhooks.js men-treat
// SEMUA pesan OUTBOUND ke nomor baru sebagai "sales mulai chat duluan"
// (lihat handleOutboundFromPhone).
//
// ⚠️ TIDAK semua nomor yang PERNAH kena pesan bot otomatis berarti murni
// sampah — ditemukan juga staf (mis. sales) yang nomornya SAMA dipakai
// untuk percakapan bisnis asli (ratusan pesan, ada yang sampai closing).
// Fungsi ini HANYA mencegah PEMBUATAN Customer BARU dari nomor staf yang
// belum pernah jadi pelanggan — customer yang SUDAH ADA (édisi kasus di
// atas) TIDAK disentuh/dihapus sama sekali, itu keputusan manual terpisah.
//
// Sumber daftar nomor staf: PERSIS yang sudah dipakai slaAlertJob.js untuk
// mengirim notifikasi (data/settings.json key "slaAlert.salesPhoneDirectory"
// + env BACKUP_NOTIFY_PHONE) — bukan daftar baru, supaya tidak ada 2 sumber
// kebenaran "siapa staf internal" yang bisa saling drift.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, "../../data/settings.json");

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

// Cache sederhana berbasis mtime file — dibaca ulang otomatis kalau admin
// mengubah salesPhoneDirectory lewat Pengaturan, tanpa perlu restart backend
// (pola sama seperti slaAlertJob.js yang sengaja TIDAK cache config-nya).
let cache = { mtimeMs: -1, set: new Set() };

function loadStaffPhoneSet() {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(SETTINGS_FILE).mtimeMs; } catch { /* file belum ada */ }

  if (mtimeMs === cache.mtimeMs) return cache.set;

  const set = new Set();
  const backupPhone = onlyDigits(process.env.BACKUP_NOTIFY_PHONE);
  if (backupPhone) set.add(backupPhone);

  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    const directory = raw?.slaAlert?.salesPhoneDirectory || [];
    for (const entry of directory) {
      const digits = onlyDigits(entry?.phone);
      if (digits) set.add(digits);
    }
  } catch { /* settings.json belum ada / rusak — anggap direktori kosong */ }

  cache = { mtimeMs, set };
  return set;
}

/** True kalau `phone` (format apa pun, akan dibersihkan ke digit saja)
 * terdaftar sebagai nomor notifikasi internal (sales/admin), BUKAN pelanggan. */
export function isInternalStaffPhone(phone) {
  const digits = onlyDigits(phone);
  if (!digits) return false;
  return loadStaffPhoneSet().has(digits);
}
