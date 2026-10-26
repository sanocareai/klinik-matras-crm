// KOREKSI SALDO PER BAHAN (Stok & Lokasi) — logika murni. Tidak ada angka stok yang dihitung di klien selain pemformatan dan pemeriksaan isian:
// saldo sebelum/sesudah, selisih, dampak, dan izin SEMUA datang dari pratinjau server (jalur resmi Penyesuaian Stok).
export const TEKS = Object.freeze({
  judul: "Koreksi saldo",
  jalur: "Koreksi saldo tidak menimpa angka. Ini mengajukan Penyesuaian Stok resmi: stok baru berubah setelah disetujui ORANG LAIN (Owner atau Finance) lalu diposting.",
  tidakDisentuh: "Harga Berlaku, nilai persediaan/jurnal Finance, dan pemakaian lama tidak berubah oleh koreksi ini.",
  fisikBantuan: "Isi jumlah yang benar-benar ada di gudang menurut hitung fisik (isi 0 bila memang kosong). Bukan selisihnya.",
});

export const STATUS_KOREKSI = Object.freeze({
  DRAFT: { teks: "Draf", varian: "neutral" },
  WAITING_APPROVAL: { teks: "Menunggu persetujuan orang lain", varian: "orange" },
  APPROVED: { teks: "Disetujui — menunggu posting", varian: "accent" },
  POSTED: { teks: "Sudah diposting ke stok", varian: "green" },
  CANCELLED: { teks: "Dibatalkan", varian: "neutral" },
  REJECTED: { teks: "Ditolak", varian: "red" },
});

/** Keadaan saldo -> label singkat + varian badge. Tiga "nol" yang berbeda artinya TIDAK PERNAH digabung. */
export const KEADAAN_SALDO_UI = Object.freeze({
  BELUM_ADA_CATATAN: { singkat: "belum diketahui", varian: "neutral", penjelasan: "Belum ada catatan pergerakan stok — saldo belum diketahui, BUKAN nol." },
  NOL_MENURUT_PERGERAKAN: { singkat: "0 menurut pergerakan", varian: "neutral", penjelasan: "Ada catatan dan hasilnya nol, tetapi belum diverifikasi hitung fisik." },
  NOL_TERVERIFIKASI: { singkat: "0 terverifikasi", varian: "green", penjelasan: "Hitung fisik atau koreksi resmi menyatakan 0 dan tidak ada pergerakan sesudahnya." },
  POSITIF: { singkat: "ada stok", varian: "green", penjelasan: "Ada stok menurut catatan." },
  MINUS: { singkat: "catatan minus", varian: "red", penjelasan: "Catatan minus — perlu dihitung fisik dan dikoreksi resmi." },
});

const angka = (v) => Number(v).toLocaleString("id-ID", { maximumFractionDigits: 4 });
export const fmt = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : angka(v));
export const tanda = (v) => `${Number(v) > 0 ? "+" : ""}${fmt(v)}`;

/**
 * Baca isian jumlah fisik (boleh koma desimal Indonesia). Mengembalikan { nilai, galat }. Kosong BUKAN nol: harus diisi (0 ditulis eksplisit).
 * Aturan sama dengan server (bacaJumlahFisik): angka, tidak minus, maksimum 4 desimal.
 */
export function bacaJumlah(teks) {
  const t = String(teks ?? "").trim().replace(/\s/g, "");
  if (t === "") return { nilai: null, galat: "Isi jumlah fisik yang benar (isi 0 bila memang kosong)." };
  // "1.234,5" (id) atau "1234.5"/"1234,5": titik ribuan hanya bila ada koma desimal.
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d+)?$/.test(norm)) return { nilai: null, galat: t.startsWith("-") ? "Jumlah fisik tidak boleh minus." : "Jumlah fisik harus berupa angka." };
  const n = Number(norm);
  if (n > 10_000_000) return { nilai: null, galat: "Jumlah fisik tidak masuk akal (maksimum 10.000.000)." };
  if ((norm.split(".")[1] ?? "").length > 4) return { nilai: null, galat: "Maksimum 4 angka di belakang koma." };
  return { nilai: n, galat: null };
}

export const ALASAN_MIN = 5; export const ALASAN_MAKS = 500;
export function periksaAlasan(teks) {
  const t = String(teks ?? "").trim();
  if (t.length < ALASAN_MIN) return `Alasan wajib diisi (minimal ${ALASAN_MIN} karakter), mis. "Hitung fisik 26 Okt: sisa 7 kg".`;
  if (t.length > ALASAN_MAKS) return `Alasan terlalu panjang (maksimum ${ALASAN_MAKS} karakter).`;
  return null;
}

/** Saldo yang ditampilkan di pratinjau: null = belum diketahui (BUKAN 0). */
export const teksSaldoSebelum = (pra) => (pra.saldoSebelum === null ? "belum diketahui" : fmt(pra.saldoSebelum));

/** Kunci anti klik ganda: satu kunci per "niat" (bahan + jumlah + alasan); berubah bila isian berubah, tetap sama untuk klik berulang. */
export const niatKoreksi = ({ materialId, jumlahFisik, alasan }) => `${materialId}|${jumlahFisik}|${String(alasan).trim()}`;

/** Tampilan sel Saldo di Stok & Lokasi yang membedakan tiga keadaan nol. `r.keadaanSaldo` dari server; bila tidak ada (server lama) jatuh ke perilaku lama. */
export function tampilSaldoKeadaan(r) {
  const k = r.keadaanSaldo; const info = KEADAAN_SALDO_UI[k];
  if (!info) return null;
  if (k === "BELUM_ADA_CATATAN") return { jenis: "BELUM_DIKETAHUI", teks: "belum diketahui", keterangan: info.penjelasan };
  if (k === "MINUS") return { jenis: "MINUS", teks: angka(r.saldo), keterangan: info.penjelasan };
  if (k === "NOL_TERVERIFIKASI") return { jenis: "NOL_TERVERIFIKASI", teks: "0", label: "terverifikasi", keterangan: `${info.penjelasan}${r.nolTerverifikasi?.nomor ? ` (${r.nolTerverifikasi.nomor})` : ""}` };
  if (k === "NOL_MENURUT_PERGERAKAN") return { jenis: "NOL", teks: "0", label: "menurut pergerakan", keterangan: info.penjelasan };
  return { jenis: "ADA", teks: angka(r.saldo), keterangan: "" };
}

/** Harga berlaku per bahan untuk kolom daftar. `peta` = respons ringkasan-daftar (`harga` per materialId) atau null (tanpa izin / gagal muat -> kolom disembunyikan). */
export function tampilHargaDaftar(peta, materialId) {
  if (!peta) return null;
  const h = peta.harga?.[materialId];
  if (!h || h.harga === null || h.harga === undefined) {
    return h?.terjadwal ? { ada: false, teks: "Belum berlaku", sub: `terjadwal ${Number(h.terjadwal.harga).toLocaleString("id-ID")}` } : { ada: false, teks: "Belum ada harga berlaku", sub: null };
  }
  return { ada: true, harga: h.harga, satuan: String(h.satuan ?? "").toLowerCase(), label: h.teksLabelBukti, labelBukti: h.labelBukti, terjadwal: h.terjadwal ?? null };
}
