// Logika murni tampilan Termin Pembayaran & Aging Utang Supplier. Server yang menghitung jatuh tempo, kelompok aging, dan status — klien hanya memformat & memetakan pilihan.

export const PILIHAN_TERMIN = [
  { nilai: "", label: "Belum diatur" },
  { nilai: "TUNAI", label: "Tunai/COD" },
  { nilai: "HARI:7", label: "7 hari" },
  { nilai: "HARI:14", label: "14 hari" },
  { nilai: "HARI:30", label: "30 hari" },
  { nilai: "HARI:45", label: "45 hari" },
  { nilai: "HARI:60", label: "60 hari" },
  { nilai: "TANGGAL_KHUSUS", label: "Tanggal khusus" },
];

/** Nilai <select> dari baris supplier/dokumen. Data lama (hanya paymentTermDays di luar pilihan resmi) → "LAMA:<n>". */
export function nilaiPilihanTermin(jenis, hari) {
  if (jenis === "TUNAI") return "TUNAI";
  if (jenis === "TANGGAL_KHUSUS") return "TANGGAL_KHUSUS";
  const n = Number(hari);
  if (jenis === "HARI" || (!jenis && n > 0)) return PILIHAN_TERMIN.some((p) => p.nilai === `HARI:${n}`) ? `HARI:${n}` : `LAMA:${n}`;
  return "";
}

/** Pilihan <select> yang ditampilkan (menambahkan "N hari (data lama)" bila supplier lama punya hari non-standar). */
export function daftarPilihanTermin(nilaiSaatIni) {
  if (String(nilaiSaatIni).startsWith("LAMA:")) return [...PILIHAN_TERMIN, { nilai: nilaiSaatIni, label: `${nilaiSaatIni.slice(5)} hari (data lama)` }];
  return PILIHAN_TERMIN;
}

/** "HARI:30" → { jenis: "HARI", hari: 30 }; "" → null. */
export function uraiPilihanTermin(nilai) {
  if (!nilai) return null;
  if (nilai.startsWith("LAMA:")) return { jenis: "HARI", hari: Number(nilai.slice(5)), lama: true };
  if (nilai.startsWith("HARI:")) return { jenis: "HARI", hari: Number(nilai.slice(5)) };
  return { jenis: nilai, hari: null };
}

export const LABEL_SUMBER_TERMIN = { MASTER_SUPPLIER: "master supplier", PO: "PO", OVERRIDE_FAKTUR: "diganti pada faktur", DATA_LAMA: "data lama (diisi manual)" };

export const NADA_INDIKATOR = {
  merah: { variant: "red", teks: "Terlambat" },
  jingga: { variant: "orange", teks: "Segera" },
  biru: { variant: "accent", teks: "Terjadwal" },
  hijau: { variant: "green", teks: "Lunas" },
  netral: { variant: "neutral", teks: "—" },
};
export const VARIAN_STATUS_PEMBAYARAN = {
  TERLAMBAT: "red", JATUH_TEMPO_HARI_INI: "orange", JATUH_TEMPO_7_HARI: "orange", BELUM_JATUH_TEMPO: "neutral", DIBAYAR_SEBAGIAN: "accent", LUNAS: "green", TANPA_JATUH_TEMPO: "neutral",
};
export const VARIAN_STATUS_BARANG = { BELUM_DATANG: "neutral", DITERIMA_SEBAGIAN: "accent", SIAP_DISIMPAN: "accent", SUDAH_MASUK_STOK: "green", SELESAI: "green" };
export const VARIAN_STATUS_FAKTUR = { BELUM_ADA_FAKTUR: "neutral", FAKTUR_DITERIMA: "accent", PERLU_DITINJAU: "orange", DISETUJUI: "green", DIBATALKAN: "neutral" };

export const TAB_AGING = [
  { kunci: "AKTIF", label: "Semua Aktif" },
  { kunci: "TERLAMBAT", label: "Terlambat" },
  { kunci: "HARI_INI", label: "Hari ini" },
  { kunci: "H1_7", label: "1–7 hari" },
  { kunci: "H8_14", label: "8–14 hari" },
  { kunci: "H15_30", label: "15–30 hari" },
  { kunci: "LEBIH_30", label: ">30 hari" },
  { kunci: "DIBAYAR_SEBAGIAN", label: "Dibayar sebagian" },
  { kunci: "TANPA_JATUH_TEMPO", label: "Tanpa jatuh tempo" },
  { kunci: "LUNAS", label: "Lunas" },
];

/** Teks umur terhadap jatuh tempo: "Terlambat 3 hari", "Hari ini", "2 hari lagi", "Belum diisi". */
export function teksJatuhTempo(r) {
  if (r.statusPembayaran === "LUNAS") return "Lunas";
  if (r.hariKeJatuhTempo == null) return "Belum diisi";
  if (r.hariKeJatuhTempo < 0) return `Terlambat ${-r.hariKeJatuhTempo} hari`;
  if (r.hariKeJatuhTempo === 0) return "Hari ini";
  return `${r.hariKeJatuhTempo} hari lagi`;
}

/** Teks termin satu faktur: "30 hari · master supplier" atau "Belum ditetapkan". */
export function teksTermin(termin) {
  if (!termin?.label) return "Belum ditetapkan";
  return termin.sumber ? `${termin.label} · ${LABEL_SUMBER_TERMIN[termin.sumber] ?? termin.sumber}` : termin.label;
}

/** Isian termin pada formulir faktur/PO → bagian body (kosong bila tidak diganti). */
export function bodyTermin(t) {
  if (!t?.ganti) return t?.dueDate ? { dueDate: t.dueDate } : {};
  const u = uraiPilihanTermin(t.pilihan);
  return {
    ...(u && u.jenis !== "TANGGAL_KHUSUS" ? { terminJenis: u.jenis, terminHari: u.hari } : u ? { terminJenis: u.jenis } : {}),
    ...(t.dueDate && (!u || u.jenis === "TANGGAL_KHUSUS") ? { dueDate: t.dueDate } : {}),
    ...(t.alasan?.trim() ? { alasanTermin: t.alasan.trim() } : {}),
  };
}
/** Cermin sisi klien dari finance:post (FINANCE/ACCOUNTANT/ADMIN/OWNER). Server tetap memeriksa ulang. */
export function bolehMencatatFinance(user) {
  const roles = Array.isArray(user?.roles) && user.roles.length ? user.roles : (user?.role ? [user.role] : []);
  return roles.some((r) => ["FINANCE", "ACCOUNTANT", "ADMIN", "OWNER"].includes(r));
}
export const TERMIN_AWAL = { ganti: false, pilihan: "", dueDate: "", alasan: "" };

/** Galat lokal ringan (server tetap penjaga): mengganti termin → alasan wajib; tanggal khusus → tanggal wajib. */
export function galatTermin(t, { perluTanggal = false } = {}) {
  if (t?.ganti) {
    if (!t.alasan?.trim() && !perluTanggal) return "Alasan mengganti termin wajib diisi.";
    const u = uraiPilihanTermin(t.pilihan);
    if (!u && !t.dueDate) return "Pilih termin baru atau isi tanggal jatuh tempo.";
    if (u?.jenis === "TANGGAL_KHUSUS" && !t.dueDate) return "Isi tanggal jatuh tempo untuk termin tanggal khusus.";
  }
  return null;
}

/** Payload termin master supplier dari pilihan <select>. */
export function payloadTerminSupplier(nilai) {
  const u = uraiPilihanTermin(nilai);
  if (!u) return { paymentTermType: null, paymentTermDays: null };
  return { paymentTermType: u.jenis, paymentTermDays: u.jenis === "HARI" ? u.hari : null };
}
