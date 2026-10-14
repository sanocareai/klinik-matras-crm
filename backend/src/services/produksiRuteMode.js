// MODE RUTE PRODUKSI (transisi) — 14 Okt 2026.
//
// Workspace Produksi masih dikembangkan, jadi katalog item PKR belum seluruhnya memetakan rute Produksi (lini/jenis produk, layanan produksi). Dulu setiap item tanpa rute
// DIBLOKIR di semua pintu (pembuatan PKR, pratinjau, Koreksi Order, Tambah Pesanan) — Finance tidak bisa mencatat penjualan nyata.
//
//   TRANSISI (default) : item/harga/tambahan pesanan TETAP tersimpan walau rute belum dipetakan. Unitnya dibuat (idempoten) TANPA menebak rute dan tanpa menandai Produksi selesai;
//                        statusnya "Menunggu penentuan alur Produksi" (turunan: alur produk unit = UNCONFIRMED). Admin Produksi memetakan rute lalu MENERAPKANNYA ke unit yang belum mulai.
//                        Delivery boleh memakai konfirmasi kesiapan FISIK (pengecualian operasional, diaudit) untuk unit yang nyata siap sementara progres digital Produksi belum ada.
//   KETAT              : seperti perilaku lama — item tanpa rute DITOLAK (RUTE_*), dan konfirmasi kesiapan fisik ditolak (hanya status unit Produksi yang berlaku).
//
// Disimpan di fin_settings (kunci di bawah): tanpa migrasi. Mengubah mode TIDAK mengubah dokumen/unit/status lama — hanya menentukan perilaku penyimpanan/penyiapan berikutnya.
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const KUNCI_MODE_RUTE = "PRODUKSI_RUTE_MODE";
export const MODE_RUTE = Object.freeze({ TRANSISI: "TRANSISI", KETAT: "KETAT" });
export const MODE_RUTE_DEFAULT = MODE_RUTE.TRANSISI;

export class ModeRuteError extends Error {
  constructor(message, statusCode = 400, code = null) { super(message); this.name = "ModeRuteError"; this.statusCode = statusCode; this.code = code; }
}

/** Mode aktif. Baris tidak ada / nilai tidak dikenal → default TRANSISI (jangan menolak penjualan nyata karena konfigurasi hilang). */
export async function bacaModeRute(db) {
  try {
    const r = await db.finSetting.findUnique({ where: { key: KUNCI_MODE_RUTE } });
    const v = String(r?.value ?? "").trim().toUpperCase();
    return v === MODE_RUTE.KETAT ? MODE_RUTE.KETAT : MODE_RUTE.TRANSISI;
  } catch {
    return MODE_RUTE_DEFAULT;
  }
}

export const ruteBelumDipetakanBoleh = async (db) => (await bacaModeRute(db)) === MODE_RUTE.TRANSISI;

/** Informasi mode untuk layar: mode + arti + riwayat singkat. */
export async function infoModeRute(db) {
  const r = await db.finSetting.findUnique({ where: { key: KUNCI_MODE_RUTE }, include: { updatedBy: { select: { id: true, name: true } } } }).catch(() => null);
  const mode = await bacaModeRute(db);
  return {
    mode,
    eksplisit: !!r,
    diubahOleh: r?.updatedBy ? { id: r.updatedBy.id, name: r.updatedBy.name } : null,
    diubahPada: r?.updatedAt ? r.updatedAt.toISOString() : null,
    arti: mode === MODE_RUTE.TRANSISI
      ? "Transisi: item tanpa rute Produksi tetap tersimpan dan berstatus \"Menunggu penentuan alur Produksi\"; konfirmasi kesiapan fisik oleh Delivery/Admin Produksi diizinkan."
      : "Ketat: item tanpa rute Produksi ditolak, dan unit hanya dianggap siap bila Produksi menandainya siap. Dokumen dan unit lama tidak berubah.",
  };
}

/** Ubah mode (Admin). Idempoten: mode sama = tidak menulis. Alasan wajib (≥5) dan dicatat di jejak aktivitas. */
export async function ubahModeRute(tx, { mode, alasan, userId = null }) {
  const m = String(mode ?? "").trim().toUpperCase();
  if (!Object.values(MODE_RUTE).includes(m)) throw new ModeRuteError("Mode harus TRANSISI atau KETAT", 400, "MODE_TIDAK_VALID");
  const teks = String(alasan ?? "").trim().replace(/\s+/g, " ");
  if (teks.length < 5) throw new ModeRuteError("Alasan perubahan mode wajib diisi (minimal 5 karakter)", 400, "ALASAN_WAJIB");
  if (teks.length > 500) throw new ModeRuteError("Alasan maksimal 500 karakter", 400, "ALASAN_TERLALU_PANJANG");
  await tx.$queryRawUnsafe("SELECT key FROM fin_settings WHERE key = $1 FOR UPDATE", KUNCI_MODE_RUTE);
  const lama = await bacaModeRute(tx);
  if (lama === m) return { berubah: false, mode: m, sebelum: lama };
  await tx.finSetting.upsert({
    where: { key: KUNCI_MODE_RUTE },
    create: { key: KUNCI_MODE_RUTE, value: m, updatedById: userId },
    update: { value: m, updatedById: userId },
  });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: KUNCI_MODE_RUTE, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId,
    metadata: { aksi: "mode_rute_produksi", sebelum: lama, sesudah: m, alasan: teks },
  });
  return { berubah: true, mode: m, sebelum: lama };
}
