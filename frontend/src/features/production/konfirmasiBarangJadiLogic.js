// Logika murni Konfirmasi Barang Jadi (tanpa React/DOM) — keputusan resmi tetap di server; ini hanya penentu kapan panel tampil, validasi alasan, dan kunci idempotensi.
export const KBJ_ALASAN_MIN = 10;
export const KBJ_ALASAN_MAKS = 500;

const rapat = (v) => (v === null || v === undefined ? "" : String(v)).trim().replace(/\s+/g, " ");

/** Alasan sah: 10–500 karakter setelah spasi dirapatkan (sama dengan server). */
export const kbjAlasanValid = (alasan) => rapat(alasan).length >= KBJ_ALASAN_MIN && rapat(alasan).length <= KBJ_ALASAN_MAKS;

/** Panel hanya tampil untuk run ADAPTASI yang masih berjalan dan unit yang masih dikerjakan Produksi, bagi peran berwenang. Server tetap menegakkan izin. */
export function kbjBolehKonfirmasi({ adaptation, runStatus, unitStatus, canConfirm }) {
  return !!adaptation && !!canConfirm && runStatus === "ACTIVE" && ["RECEIVED", "IN_PRODUCTION"].includes(unitStatus);
}

/** Kunci idempotensi per niat (pola server). Dibuat ulang setelah galat. */
export const kbjKunciBaru = () => (globalThis.crypto?.randomUUID ? `kbj-${globalThis.crypto.randomUUID()}` : `kbj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
