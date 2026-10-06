// Logika murni layar Diagnosis Piutang (tanpa React/DOM supaya bisa dites langsung). Semua angka & kategori dihitung SERVER (GET /finance/reports/receivables/diagnosis);
// klien hanya menyaring dan memberi label — tidak menghitung ulang saldo.

/** Urutan tampil kategori di tabel rekonsiliasi: yang butuh tindakan di atas, tagihan sah terakhir. */
export const URUTAN_KATEGORI = ["ORDER_DIBATALKAN", "NILAI_BEDA_PENGAKUAN", "PAYMENT_BELUM_MENUTUP", "LUNAS_TANPA_PAYMENT", "KREDIT_LAINNYA", "TAGIHAN_SAH"];

/** Warna Badge menurut tingkat tindakan dari server: tagih = netral (normal), periksa = oranye, koreksi = merah. */
export const VARIAN_TINGKAT = { tagih: "neutral", periksa: "orange", koreksi: "red" };

/** Baris tabel rekonsiliasi: satu per kategori yang punya order, ditambah total yang harus sama dengan saldo neraca. */
export function barisRekonsiliasi(data) {
  const per = data?.rekonsiliasi?.perKategori ?? {};
  const meta = data?.kategori ?? {};
  const baris = URUTAN_KATEGORI
    .filter((k) => (per[k]?.jumlah ?? 0) > 0)
    .map((k) => ({ kode: k, label: meta[k]?.label ?? k, tingkat: meta[k]?.tingkat ?? "periksa", jumlah: per[k].jumlah, total: per[k].total }));
  const total = baris.reduce((s, b) => s + b.total, 0);
  return { baris, total, neraca: data?.neraca ?? 0, cocok: Math.abs((data?.rekonsiliasi?.selisih ?? 0)) < 0.5 && Math.abs(total - (data?.neraca ?? 0)) < 0.5 };
}

/** Daftar order untuk kartu penjelasan. `hanyaTindakan` = sembunyikan tagihan sah (sudah ada di daftar piutang di bawah). `kategori` = filter satu kategori. */
export function saringDiagnosis(baris, { hanyaTindakan = true, kategori = "" } = {}) {
  return (baris ?? []).filter((b) => (!kategori || b.kategori === kategori) && (kategori || !hanyaTindakan || b.kategori !== "TAGIHAN_SAH"));
}

/** Posisi order keringanan-lunas di buku besar (dari server): apakah tagihannya sudah tercatat sebagai piutang. */
export const LABEL_POSISI_BUKU = {
  BELUM_DI_BUKU: { label: "Belum tercatat di buku", varian: "red", catatan: "Sudah diserahkan sebelum pembukuan; pendapatan/piutangnya tidak pernah dijurnal." },
  SUDAH_DI_BUKU: { label: "Sudah tercatat sebagai piutang", varian: "neutral", catatan: "Termasuk saldo Piutang Usaha di neraca." },
  BELUM_DISERAHKAN: { label: "Belum diserahkan", varian: "neutral", catatan: "Belum jadi piutang menurut buku (pendapatan diakui saat diserahkan)." },
  DIAKUI_TANPA_SALDO: { label: "Diakui, saldo piutang 0", varian: "orange", catatan: "Pendapatan sudah diakui tetapi piutangnya sudah nol — periksa." },
};

/** Teks umur pengakuan, mis. "diakui 12 hari lalu" / "diakui hari ini"; null kalau tidak diketahui. */
export function teksUmurPengakuan(hari) {
  if (hari == null || !Number.isFinite(hari)) return null;
  if (hari <= 0) return "diakui hari ini";
  return `diakui ${hari} hari lalu`;
}
