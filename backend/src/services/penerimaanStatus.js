// STATUS PENERIMAAN BARANG DALAM BAHASA PETUGAS (Okt 2026) — SATU sumber untuk label, tahap alur, pengaruh ke stok, dan aksi yang relevan per status.
// Murni (tanpa DB). Dipakai API (field `tampilan`), Beranda, dan layar Penerimaan Barang. Tidak ada istilah teknis (reversal/idempotensi) di sini.
//
// Alur: PO (Finance) → Jadwal kedatangan → Barang tiba → Pemeriksaan → Masuk stok.
//   Kode status tetap (DRAFT…COMPLETED/REJECTED); yang berubah hanya cara menyebutnya. REJECTED yang tidak pernah berisi barang (tanpa tanggal tiba, tanpa jumlah) disebut "Dibatalkan",
//   bukan "Ditolak" — penolakan berarti barang pernah tiba lalu ditolak.

export const TAHAP = Object.freeze([
  { kode: "PO", label: "PO disetujui" },
  { kode: "JADWAL", label: "Jadwal kedatangan" },
  { kode: "TIBA", label: "Barang tiba" },
  { kode: "PERIKSA", label: "Pemeriksaan" },
  { kode: "STOK", label: "Masuk stok" },
]);
const INDEKS_TAHAP = { DRAFT: 1, SCHEDULED: 1, ARRIVED: 2, INSPECTION: 3, READY_FOR_PUTAWAY: 3, COMPLETED: 4 };

export const AKSI = Object.freeze({
  UBAH_JADWAL: { kode: "UBAH_JADWAL", label: "Ubah jadwal", jenis: "ubah" },
  JADWALKAN: { kode: "JADWALKAN", label: "Jadwalkan", jenis: "maju" },
  KEMBALI_DRAFT: { kode: "KEMBALI_DRAFT", label: "Kembali ke Draf", jenis: "ubah" },
  BATALKAN_JADWAL: { kode: "BATALKAN_JADWAL", label: "Batalkan penerimaan", jenis: "batal" },
  CATAT_TIBA: { kode: "CATAT_TIBA", label: "Catat barang tiba", jenis: "maju" },
  TANDAI_TIBA: { kode: "TANDAI_TIBA", label: "Tandai barang tiba", jenis: "maju" },
  ISI_PEMERIKSAAN: { kode: "ISI_PEMERIKSAAN", label: "Isi hasil pemeriksaan", jenis: "ubah" },
  MAJUKAN: { kode: "MAJUKAN", label: "Lanjut ke tahap berikutnya", jenis: "maju" },
  SIMPAN_KE_STOK: { kode: "SIMPAN_KE_STOK", label: "Simpan ke Stok", jenis: "maju" },
  TOLAK: { kode: "TOLAK", label: "Tolak barang", jenis: "batal" },
  KOREKSI_KEDATANGAN: { kode: "KOREKSI_KEDATANGAN", label: "Koreksi Kedatangan (resmi)", jenis: "koreksi" },
  KOREKSI_PENERIMAAN: { kode: "KOREKSI_PENERIMAAN", label: "Koreksi penerimaan", jenis: "koreksi" },
});

const nol = (v) => v === null || v === undefined || Number(v) === 0;
/** Penerimaan yang tidak pernah berisi barang: belum ada tanggal tiba dan tidak satu pun jumlah terisi. */
export function tidakPernahBerisi(r) {
  if (r?.arrivedDate || Number(r?.arrivalRevision ?? 0) > 0) return false;
  return (r?.lines ?? []).every((l) => nol(l.receivedQty) && nol(l.acceptedQty) && nol(l.rejectedQty));
}

/**
 * @param r  penerimaan: { status, purchaseOrderId, arrivedDate, arrivalRevision, lines[] }
 * @returns { kode, label, warna, tahap, tahapIndeks, pengaruhStok, penjelasan, aksi[] }
 */
export function tampilanPenerimaan(r) {
  const status = String(r?.status ?? "");
  const dariPO = !!r?.purchaseOrderId;
  const dibatalkan = status === "REJECTED" && tidakPernahBerisi(r);
  const dasar = (kode, label, warna, penjelasan, pengaruhStok, aksi) => ({ kode, status, label, warna, tahapIndeks: INDEKS_TAHAP[status] ?? null, tahap: TAHAP, pengaruhStok, penjelasan, aksi: aksi.map((a) => ({ ...a })) });
  switch (status) {
    case "DRAFT":
      return dasar("DRAF", "Draf", "neutral", "Belum dijadwalkan. Belum memengaruhi stok. Boleh diubah atau dibatalkan.", "BELUM", [AKSI.UBAH_JADWAL, AKSI.JADWALKAN, AKSI.BATALKAN_JADWAL]);
    case "SCHEDULED":
      return dasar("TERJADWAL", "Terjadwal — menunggu barang tiba", "accent", "Barang belum tiba. Belum memengaruhi stok. Jadwal boleh diubah, dikembalikan ke Draf, atau dibatalkan.", "BELUM",
        [AKSI.UBAH_JADWAL, dariPO ? AKSI.CATAT_TIBA : AKSI.TANDAI_TIBA, AKSI.KEMBALI_DRAFT, AKSI.BATALKAN_JADWAL]);
    case "ARRIVED":
      return dasar("TIBA", "Barang tiba — perlu diperiksa", "orange", "Barang sudah tiba, belum diperiksa. Stok belum bertambah. Isi hasil pemeriksaan (baik/ditolak).", "BELUM",
        [AKSI.ISI_PEMERIKSAAN, AKSI.MAJUKAN, ...(dariPO ? [AKSI.KOREKSI_KEDATANGAN] : []), AKSI.TOLAK]);
    case "INSPECTION":
      return dasar("DIPERIKSA", "Sedang diperiksa", "orange", "Isi jumlah barang baik dan ditolak per item, lalu lanjutkan ke Siap masuk stok. Stok belum bertambah.", "BELUM",
        [AKSI.ISI_PEMERIKSAAN, AKSI.MAJUKAN, ...(dariPO ? [AKSI.KOREKSI_KEDATANGAN] : []), AKSI.TOLAK]);
    case "READY_FOR_PUTAWAY":
      return dasar("SIAP_MASUK_STOK", "Siap masuk stok", "accent", "Hanya barang yang dinyatakan baik yang masuk stok. Stok bertambah saat Simpan ke Stok.", "BELUM",
        [AKSI.SIMPAN_KE_STOK, AKSI.ISI_PEMERIKSAAN, ...(dariPO ? [AKSI.KOREKSI_KEDATANGAN] : []), AKSI.TOLAK]);
    case "COMPLETED":
      return dasar("SUDAH_MASUK_STOK", "Sudah masuk stok", "green", dariPO
        ? "Stok sudah bertambah. Catatan tidak dihapus: jika ada salah input, pakai Koreksi Kedatangan (resmi) — dampaknya ditampilkan dulu."
        : "Stok sudah bertambah. Catatan tidak dihapus: jika ada salah input, pakai Koreksi penerimaan — dampaknya ditampilkan dulu dan koreksi stok disetujui orang lain.", "SUDAH",
      [dariPO ? AKSI.KOREKSI_KEDATANGAN : AKSI.KOREKSI_PENERIMAAN]);
    case "REJECTED":
      return dibatalkan
        ? dasar("DIBATALKAN", "Dibatalkan", "neutral", "Penerimaan ini dibatalkan sebelum barang tiba. Tidak memengaruhi stok. Jika masih perlu, buat jadwal baru dari PO.", "TIDAK", [])
        : dasar("DITOLAK", "Ditolak", "red", "Barang tiba lalu ditolak seluruhnya. Tidak menambah stok.", "TIDAK", []);
    default:
      return dasar("TIDAK_DIKENAL", status || "—", "neutral", "Status tidak dikenal.", "TIDAK", []);
  }
}

/** Mengapa batal/kembali ke Draf tidak aman — dipakai server (409) dan tes. `pergerakan` = jumlah pergerakan stok bertaut penerimaan ini. */
export function penghalangBatalJadwal(r, pergerakan = 0) {
  if (Number(pergerakan) > 0) return { kode: "SUDAH_ADA_PERGERAKAN_STOK", pesan: "Penerimaan ini sudah punya pergerakan stok. Pakai Koreksi (dampaknya ditampilkan dulu), bukan pembatalan." };
  if (r?.arrivedDate || Number(r?.arrivalRevision ?? 0) > 0) return { kode: "BARANG_SUDAH_DICATAT_TIBA", pesan: "Barang sudah dicatat tiba. Jadwal tidak bisa dibatalkan; perbaiki lewat Koreksi Kedatangan atau tolak barang jika memang ditolak." };
  if (!tidakPernahBerisi(r)) return { kode: "SUDAH_ADA_JUMLAH", pesan: "Sudah ada jumlah datang/diterima/ditolak. Jadwal tidak bisa dibatalkan; gunakan Tolak barang atau lanjutkan pemeriksaan." };
  return null;
}
