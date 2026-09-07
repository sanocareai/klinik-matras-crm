// Helper BERSAMA (7 September 2026) untuk baca directory nomor WA sales dari
// data/settings.json > slaAlert.salesPhoneDirectory — SATU-SATUNYA sumber
// mapping nama sales -> nomor WA pribadi (User model TIDAK punya kolom
// phone, lihat catatan panjang di CLAUDE.md/slaAlertJob.js).
//
// ⚠️ slaAlertJob.js, staleLeadAlertJob.js, dan salesReminderDigestJob.js
// MASING-MASING PUNYA SALINAN LOKAL fungsi yang PERSIS sama dengan ini —
// SENGAJA TIDAK direfactor ke sini (7 Sep 2026) karena dua di antaranya
// (slaAlertJob/staleLeadAlertJob) SUDAH LIVE mengirim WA sungguhan di
// production; menyentuhnya demi DRY murni bukan risiko yang sepadan
// untuk perubahan kosmetik. File ini HANYA dipakai kode BARU (routes/
// staffBroadcast.js, services/staffBroadcastWorker.js). Kalau nanti ada
// keperluan nyata mengubah LOGIKA resolusi nomor (bukan cuma lokasinya),
// perbarui SEMUA 4 tempat sekaligus, atau jadikan momentum refactor
// menyeluruh dengan testing penuh di 2 job yang live itu.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, "../../data/settings.json");

export function readSalesPhoneDirectory() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    return raw.slaAlert?.salesPhoneDirectory || [];
  } catch {
    return [];
  }
}

export function resolveSalesPhone(name, directory) {
  if (!name || !Array.isArray(directory)) return null;
  const match = directory.find((d) => d.name?.toLowerCase() === name.toLowerCase());
  return match?.phone || null;
}
