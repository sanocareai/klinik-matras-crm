// Logika murni "Tandai Siap Kirim berdasarkan pemeriksaan fisik" (PENGECUALIAN Admin/Owner) — tanpa React/DOM. Keputusan resmi tetap di server; ini hanya penentu kapan tombol ditawarkan,
// validasi isian, dan kunci idempotensi.
import { kbjAlasanValid } from "./konfirmasiBarangJadiLogic.js";

export const PF_STATUS_BISA_DILEPAS = Object.freeze(["RECEIVED", "IN_PRODUCTION"]);
export const PF_LABEL_RUN_BELUM_DITUTUP = "Run belum ditutup — unit dilepas untuk pengiriman lewat pengecualian";

/** Peran berwenang (Admin/Owner; multi-role). Server menegakkan ulang. */
export const pfBolehAdmin = (roles) => (roles ?? []).some((r) => r === "ADMIN" || r === "OWNER");

/** Unit order yang boleh ditawari tombol: masih dikerjakan Produksi (bukan batal/siap/berangkat/terkirim). */
export const pfUnitBisaDilepas = (unit) => PF_STATUS_BISA_DILEPAS.includes(unit?.status);

/** Tombol konfirmasi aktif bila semua syarat isian terpenuhi dan pratinjau server menyatakan layak. */
export function pfBolehKirim({ eligible, kodeDiketik, kodeUnit, locationId, alasan, verif, sibuk }) {
  return !sibuk && !!eligible && String(kodeDiketik ?? "").trim() === String(kodeUnit ?? "") && !!locationId && kbjAlasanValid(alasan) && !!verif;
}

/** Kunci idempotensi per niat (pola server). Dibuat ulang setelah galat. */
export const pfKunciBaru = () => (globalThis.crypto?.randomUUID ? `pf-${globalThis.crypto.randomUUID()}` : `pf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
