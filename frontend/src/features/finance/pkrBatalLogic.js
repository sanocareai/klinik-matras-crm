// Logika murni modal pembatalan Penjualan Karyawan (PKR) — tanpa React/DOM supaya bisa dites langsung. Keputusan resmi (boleh/tidak, hambatan, pembayaran aktif) SELALU dari server
// (GET /:id/pembatalan); di sini hanya pengelompokan hambatan, validasi alasan, dan kunci idempotensi.

export const ALASAN_MIN = 5;
export const ALASAN_MAKS = 500;

const rapat = (v) => (v === null || v === undefined ? "" : String(v)).trim().replace(/\s+/g, " ");

/** Alasan sah: setelah spasi dirapikan, 5–500 karakter. (Kontrak server hanya "tidak kosong" — klien lama tetap diterima.) */
export const alasanValid = (alasan) => rapat(alasan).length >= ALASAN_MIN && rapat(alasan).length <= ALASAN_MAKS;
export const rapikanAlasan = rapat;

/** Kunci idempotensi per niat (pola server: 8–128 karakter A-Za-z0-9_-:.). Dibuat ulang setelah galat supaya percobaan baru tidak memutar balik jawaban lama. */
export const kunciBaru = (prefix = "pkr-batal") => (globalThis.crypto?.randomUUID
  ? `${prefix}-${globalThis.crypto.randomUUID()}`
  : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Pecah hambatan pratinjau menurut tindakan: yang perlu Riwayat Pembayaran, yang perlu alur order resmi, yang sudah final, dan lainnya. */
export function kelompokHambatan(pv) {
  const h = pv?.hambatan ?? [];
  const dikenal = ["PEMBAYARAN_AKTIF", "PRODUKSI_DELIVERY_BERJALAN", "SUDAH_DIBATALKAN"];
  return {
    bayar: h.filter((x) => x.kode === "PEMBAYARAN_AKTIF"),
    produksi: h.filter((x) => x.kode === "PRODUKSI_DELIVERY_BERJALAN"),
    sudah: h.filter((x) => x.kode === "SUDAH_DIBATALKAN"),
    lain: h.filter((x) => !dikenal.includes(x.kode)),
  };
}
