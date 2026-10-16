// Logika murni "Admin override: Siap Kirim saat pencatatan produksi belum selesai" — tanpa React/DOM. Ini KEPUTUSAN Admin/Owner, bukan hasil pemeriksaan atau QC: tidak ada klaim
// pemeriksaan fisik di sini. Keputusan resmi tetap di server; ini hanya penentu kapan tombol ditawarkan, validasi isian, dan kunci idempotensi.
import { kbjAlasanValid } from "./konfirmasiBarangJadiLogic.js";

export const AO_STATUS_BISA_DI_OVERRIDE = Object.freeze(["RECEIVED", "IN_PRODUCTION"]);
export const AO_JUDUL = "Admin override: Siap Kirim saat pencatatan produksi belum selesai";
export const AO_LABEL_RUN_BELUM_DITUTUP = "Admin override: Siap Kirim — pencatatan produksi belum selesai (Run belum ditutup)";
export const AO_PERNYATAAN = "Saya (Admin) menetapkan unit ini siap untuk proses pengiriman saat pencatatan produksi belum selesai. Ini keputusan override Admin, bukan hasil pemeriksaan atau QC.";

/** Peran berwenang (Admin/Owner; multi-role). Server menegakkan ulang. */
export const aoBolehAdmin = (roles) => (roles ?? []).some((r) => r === "ADMIN" || r === "OWNER");

/** Unit order yang boleh ditawari tombol: masih dikerjakan Produksi (bukan batal/siap/berangkat/terkirim). */
export const aoUnitBisaDiOverride = (unit) => AO_STATUS_BISA_DI_OVERRIDE.includes(unit?.status);

/** Tombol aktif bila pratinjau server menyatakan layak, kode diketik ulang persis, lokasi pengambilan dipilih, alasan sah, dan pernyataan override dicentang. */
export function aoBolehKirim({ eligible, kodeDiketik, kodeUnit, locationId, alasan, konfirmasi, sibuk }) {
  return !sibuk && !!eligible && String(kodeDiketik ?? "").trim() === String(kodeUnit ?? "") && !!locationId && kbjAlasanValid(alasan) && !!konfirmasi;
}

/** Kunci idempotensi per niat (pola server). Dibuat ulang setelah galat. */
export const aoKunciBaru = () => (globalThis.crypto?.randomUUID ? `ao-${globalThis.crypto.randomUUID()}` : `ao-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
