// HARGA BERLAKU BAHAN (HPP operasional) — logika murni layar Stok. Tidak ada angka yang dihitung di klien selain pemformatan:
// pratinjau, selisih, dampak, dan label bukti SEMUA datang dari server. Murni (bisa dites di Node).
export const TEKS = Object.freeze({
  judul: "Harga Berlaku (HPP operasional)",
  bukan: "Ini harga kerja untuk HPP operasional per satuan stok. Bukan nilai buku dan bukan HPP final Finance.",
  finance: "Nilai persediaan/jurnal Finance memakai biaya perolehan Persediaan Awal/GR dan tidak berubah karena harga ini.",
  aturanWaktu: "Dasar harga = waktu pemakaian aktual, bukan tanggal order dibuat. Pemakaian yang sudah dibekukan tidak berubah.",
  aturanTanpaMundur: "Perubahan harga hanya berlaku mulai saat disimpan atau waktu mendatang — tidak boleh mundur. Salah input historis dibetulkan lewat Koreksi (tindakan khusus).",
  izinLihat: "Anda hanya dapat melihat harga berlaku. Mengubah, mengoreksi, dan mengajukan penerapan khusus untuk peran Finance dan Owner; akun Admin tanpa peran itu belum diberi izin (menunggu keputusan Owner).",
  belumBukti: "Belum didukung bukti",
  adaCatatan: "Ada catatan bukti — belum diverifikasi Finance",
});

/** Rupiah hingga 4 desimal (harga per satuan bisa pecahan); tanpa pembulatan diam-diam. */
export function rp(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  return "Rp" + v.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}
/** Rupiah bulat untuk nilai (HPP) — 2 desimal bila ada. */
export function rpNilai(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return "Rp" + Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function tanggalJam(v) {
  if (!v) return "—";
  return new Date(v).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Nilai awal <input type=datetime-local> (waktu setempat) untuk sebuah Date. */
export function keInputLokal(d = new Date()) {
  const t = new Date(d); const p = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`;
}
/** datetime-local (waktu setempat) → ISO UTC; null bila kosong/tidak valid. */
export function dariInputLokal(v) {
  if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Angka harga dari ketikan pengguna: terima "6.350,5" (id-ID) maupun "6350.5"; tolak yang ambigu. Kembalikan string desimal bertitik atau null. */
export function bacaHarga(teks) {
  const s = String(teks ?? "").trim().replace(/\s/g, "").replace(/^Rp/i, "");
  if (!s) return null;
  let n;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) n = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d+$/.test(s)) n = s.replace(",", ".");
  else if (/^\d+(\.\d+)?$/.test(s)) n = s;
  else return null;
  return Number(n) > 0 ? n : null;
}

/** Payload pratinjau/simpan. Satuan SELALU satuan stok bahan (tidak bisa diganti dari UI). Mode "SEKARANG" = tanpa berlakuMulai (server memakai waktu simpan); "JADWAL" = waktu mendatang; koreksi selalu membawa waktu baris yang dikoreksi. */
export function susunMasukan({ bahan, harga, mode = "SEKARANG", mulaiLokal, alasan, catatanBukti, koreksiId = null }) {
  const bawaWaktu = koreksiId || mode === "JADWAL";
  return {
    materialId: bahan.id, hargaBaru: bacaHarga(harga), satuan: bahan.satuan, ...(bawaWaktu ? { berlakuMulai: dariInputLokal(mulaiLokal) } : {}),
    alasan: String(alasan ?? "").trim(), catatanBukti: String(catatanBukti ?? "").trim() || undefined, ...(koreksiId ? { koreksiId } : {}),
  };
}

/** Validasi ringan sebelum minta pratinjau (server tetap memutuskan). Mengembalikan pesan per kolom. */
export function periksaIsian({ harga, mode = "SEKARANG", mulaiLokal, alasan, koreksi = false, sekarang = new Date() }) {
  const e = {};
  if (!bacaHarga(harga)) e.harga = "Isi harga lebih dari 0 (angka; desimal pakai koma atau titik).";
  if (koreksi || mode === "JADWAL") {
    const iso = dariInputLokal(mulaiLokal);
    if (!iso) e.mulai = "Isi tanggal dan jam mulai berlaku.";
    else if (!koreksi && new Date(iso) <= sekarang) e.mulai = "Waktu terjadwal harus di masa depan. Untuk berlaku mulai sekarang pilih “Saat disimpan”.";
  }
  const min = koreksi ? 10 : 5;
  if (String(alasan ?? "").trim().length < min) e.alasan = `Alasan wajib diisi (minimal ${min} karakter${koreksi ? "; koreksi historis butuh alasan yang jelas" : ""}).`;
  return e;
}

export const STATUS_RIWAYAT = Object.freeze({
  BERLAKU_SEKARANG: { teks: "Berlaku sekarang", varian: "green" },
  TERJADWAL: { teks: "Terjadwal", varian: "accent" },
  BERAKHIR_DIGANTI_HARGA_BARU: { teks: "Sudah diganti harga baru", varian: "neutral" },
  DIGANTI_KOREKSI: { teks: "Diganti koreksi (salah input)", varian: "orange" },
});
export const varianBukti = (label) => (label === "ADA_CATATAN_BUKTI" ? "accent" : "orange");
export const BASIS_TEKS = Object.freeze({
  WAKTU_PEMAKAIAN: "Harga berlaku saat pemakaian", WAKTU_WASTE: "Harga berlaku saat waste dicatat", WAKTU_PENYESUAIAN: "Harga berlaku saat penyesuaian",
  HARGA_ISSUE_ASAL: "Harga operasional ISSUE asal (bukan harga saat retur)", WAKTU_RETUR_TANPA_ISSUE: "Harga berlaku saat retur — tidak tertaut ISSUE asal",
});
export const KELOMPOK_PENERAPAN_TEKS = Object.freeze({
  BELUM_DIBEKUKAN: "Pemakaian lama belum punya harga operasional",
  TANPA_HARGA_BERLAKU: "Dibekukan tanpa harga (saat itu belum ada harga berlaku)",
  SELARAS_ULANG: "Harga beku berbeda dari harga berlaku saat pemakaian",
});
export const GAP_TEKS = Object.freeze({
  BELUM_ADA_HARGA_PADA_WAKTU_PEMAKAIAN: "Belum ada harga berlaku pada waktu pemakaian — tidak diberi harga rekaan",
  HARGA_BERLAKU_HILANG: "Harga beku ada tetapi harga berlaku saat itu hilang — tinjau manual",
  ISSUE_ASAL_BELUM_BERHARGA: "Retur tertaut ISSUE asal yang belum punya harga operasional — beri harga ISSUE asal dulu",
});
