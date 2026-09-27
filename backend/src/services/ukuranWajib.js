// Ukuran Kasur Custom — status PENEGAKAN di server. DEFAULT MATI. Dinyalakan lewat pengaturan (PATCH /api/finance/settings, FINANCE_ADMIN)
// SETELAH aplikasi mobile terbaru (yang mengirim Lebar/Panjang) terverifikasi terpasang; tanggal mulai dikunci otomatis saat dinyalakan.
import { prisma } from "../db.js";
import { getSettingRaw, parseBool, SETTING_KEYS } from "./finance/settings.js";

/** ISO tanggal mulai penegakan, atau null bila MATI / tanggal mulai tidak valid (gagal-aman: tanpa penegakan). */
export async function ukuranCustomWajibSejak(db = prisma) {
  if (!parseBool(await getSettingRaw(db, SETTING_KEYS.UKURAN_CUSTOM_WAJIB))) return null;
  const d = new Date(await getSettingRaw(db, SETTING_KEYS.UKURAN_CUSTOM_WAJIB_SEJAK));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
