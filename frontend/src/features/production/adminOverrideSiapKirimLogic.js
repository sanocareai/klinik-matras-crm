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
export function aoBolehKirim({ eligible, aktif = false, kodeDiketik, kodeUnit, locationId, alasan, konfirmasi, sibuk }) {
  return !sibuk && !!eligible && aktif === true && String(kodeDiketik ?? "").trim() === String(kodeUnit ?? "") && !!locationId && kbjAlasanValid(alasan) && !!konfirmasi;
}

/** Kunci idempotensi per niat (pola server). Dibuat ulang setelah galat. */
export const aoKunciBaru = () => (globalThis.crypto?.randomUUID ? `ao-${globalThis.crypto.randomUUID()}` : `ao-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Dialog override: tombol aktif hanya bila saklar server menyatakan override aktif untuk unit ini (`overrideAktif`). */
export const aoSaklarMengizinkan = (pv) => pv?.overrideAktif === true;

/** Alasan perubahan saklar: 10–300 karakter setelah spasi dirapatkan (sama dengan server). */
export const aoAlasanSaklarValid = (alasan) => { const t = String(alasan ?? "").trim().replace(/\s+/g, " "); return t.length >= 10 && t.length <= 300; };

/** "A-U1, B-U2" → ["A-U1","B-U2"] (unik, rapi, maksimal 50 seperti server). */
export const aoParseKodeUnit = (teks) => [...new Set(String(teks ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 50);

/** Ringkasan saklar untuk label: nonaktif / aktif semua unit / aktif dibatasi. */
export function aoRingkasSaklar(sw) {
  if (!sw || sw.enabled !== true) return { aktif: false, label: "Nonaktif" };
  return (sw.unitCodes ?? []).length ? { aktif: true, label: `Aktif — dibatasi: ${sw.unitCodes.join(", ")}` } : { aktif: true, label: "Aktif — semua unit yang memenuhi syarat" };
}
