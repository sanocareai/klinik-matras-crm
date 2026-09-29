// TANGGAL CUTOFF SALDO AWAL — satu sumber (keputusan Owner 29 Sep 2026: 18 September 2026 WIB).
//
// Uang yang benar-benar DITERIMA sebelum cutoff sudah tercakup dalam saldo riil kas/bank yang dimasukkan lewat penyesuaian SALDO_AWAL
// (lawannya Laba Ditahan). Menjurnalnya ke rekening lagi = menghitung kas dua kali. Semua jalur yang membukukan penerimaan uang
// (verifikasi penerimaan, posting pembayaran, koreksi pembayaran) wajib bertanya ke sini.

import { getSettingRaw, SETTING_KEYS } from "./settings.js";

export const CUTOFF_BAWAAN = "2026-09-18";

/** Tanggal WIB (YYYY-MM-DD) dari sebuah instant. */
export function tanggalWIB(instant) {
  return new Date(new Date(instant).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function tanggalCutoff(db) {
  const raw = await getSettingRaw(db, SETTING_KEYS.SALDO_AWAL_CUTOFF);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : CUTOFF_BAWAAN;
}

/** true bila instant (tanggal uang diterima) jatuh SEBELUM cutoff. Tanggal cutoff sendiri dan sesudahnya = uang berjalan. */
export const sebelumCutoff = (instantAtauTanggal, cutoff) => {
  const t = typeof instantAtauTanggal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(instantAtauTanggal) ? instantAtauTanggal : tanggalWIB(instantAtauTanggal);
  return t < cutoff;
};

export const tampilCutoff = (cutoff) => {
  const [y, m, d] = cutoff.split("-").map(Number);
  const bulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return `${d} ${bulan[m - 1]} ${y}`;
};
