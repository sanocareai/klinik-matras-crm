// Logika murni Rekonsiliasi Bank V2 (tab Mutasi Rekening / Pencocokan / Rekonsiliasi). Angka resmi SELALU dari server (GET /api/finance/rekon-bank/*); di sini hanya label, pemetaan status → tampilan,
// penjumlahan pilihan baris (dalam sen, tanpa pembulatan float) untuk memberi tahu pengguna apakah pencocokan seimbang SEBELUM dikirim, dan urutan komponen selisih.

export const STATUS_BANK = {
  COCOK_OTOMATIS: { label: "Cocok otomatis", variant: "green" },
  COCOK_MANUAL: { label: "Cocok manual", variant: "green" },
  DISARANKAN: { label: "Disarankan", variant: "accent" },
  BELUM_ADA_DI_BUKU: { label: "Belum ada di buku", variant: "red" },
  BELUM_ADA_DI_BANK: { label: "Belum ada di bank", variant: "orange" },
  DIKECUALIKAN: { label: "Dikecualikan", variant: "neutral" },
};
export const statusTampil = (s) => STATUS_BANK[s] ?? { label: s || "—", variant: "neutral" };

export const KATEGORI = {
  TRANSFER_ANTAR_REKENING: "Transfer antar-rekening", BIAYA_BANK: "Biaya bank", BUNGA: "Bunga", PAJAK_BUNGA: "Pajak bunga", BEDA_TANGGAL: "Beda tanggal", LAINNYA: "Lainnya",
};

/** Teks desimal "1234.50" / "-12.00" → sen (bilangan bulat). Null/kosong → 0. */
export function keSen(v) {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).trim();
  const neg = s.startsWith("-");
  const [b, d = ""] = s.replace(/^[-+]/, "").split(".");
  const sen = Number(b || 0) * 100 + Number((d + "00").slice(0, 2));
  return neg ? -sen : sen;
}
export const dariSen = (n) => `${n < 0 ? "-" : ""}${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, "0")}`;

/** Nilai bertanda sebuah baris bank/buku dari sudut pandang rekening: masuk positif, keluar negatif (sen). */
export const nilaiBaris = (b) => keSen(b.masuk) - keSen(b.keluar);

/** Ringkasan pilihan pencocokan: total bank, total buku, selisih (sen & teks), dan apakah seimbang persis. */
export function ringkasPilihan(bank, buku) {
  const totalBank = (bank || []).reduce((t, b) => t + nilaiBaris(b), 0);
  const totalBuku = (buku || []).reduce((t, b) => t + nilaiBaris(b), 0);
  const selisih = totalBank - totalBuku;
  const jumlahBank = (bank || []).length, jumlahBuku = (buku || []).length;
  return {
    totalBank, totalBuku, selisih, jumlahBank, jumlahBuku,
    seimbang: jumlahBank > 0 && jumlahBuku > 0 && selisih === 0,
    bentuk: jumlahBank && jumlahBuku ? `${jumlahBank === 1 ? "1" : "N"}:${jumlahBuku === 1 ? "1" : "N"}` : null,
    teksSelisih: selisih === 0 ? "Seimbang" : `Selisih ${dariSen(Math.abs(selisih))} — total bank ${selisih > 0 ? "lebih besar" : "lebih kecil"} dari total buku`,
  };
}

/** Bisakah tombol "Cocokkan" aktif? Butuh dua sisi, seimbang persis, dan alasan ≥10 karakter. */
export function bisaCocokkan(ringkas, alasan) {
  if (!ringkas.jumlahBank || !ringkas.jumlahBuku) return { ok: false, sebab: "Pilih sedikitnya satu baris bank dan satu baris buku" };
  if (!ringkas.seimbang) return { ok: false, sebab: ringkas.teksSelisih };
  if (String(alasan || "").trim().length < 10) return { ok: false, sebab: "Alasan wajib diisi (minimal 10 karakter)" };
  return { ok: true, sebab: null };
}
export const bisaKecualikan = (jumlahDipilih, alasan) => jumlahDipilih > 0 && String(alasan || "").trim().length >= 10;

/** Komponen penjelas selisih (urutan tampil). `efek` = pengaruhnya pada selisih buku − bank. */
export function urutKomponen(panel) {
  const k = panel?.komponen;
  if (!k) return [];
  const d = panel.definisi || {};
  return [
    { kunci: "selisihSaldoAwal", label: "Selisih saldo awal", efek: k.selisihSaldoAwal.efek, jumlah: null, definisi: k.selisihSaldoAwal.catatan, diketahui: k.selisihSaldoAwal.diketahui },
    { kunci: "bankBelumDibukukan", label: "Bank belum dibukukan", efek: k.bankBelumDibukukan.efek, jumlah: k.bankBelumDibukukan.jumlah, definisi: d.bankBelumDibukukan },
    { kunci: "bukuBelumMuncul", label: "Buku belum muncul di bank", efek: k.bukuBelumMuncul.efek, jumlah: k.bukuBelumMuncul.jumlah, definisi: d.bukuBelumMuncul },
    { kunci: "perbedaanCutoff", label: "Perbedaan cutoff", efek: k.perbedaanCutoff.efek, jumlah: k.perbedaanCutoff.jumlah, definisi: d.perbedaanCutoff },
    { kunci: "penyesuaianBuku", label: "Penyesuaian buku", efek: k.penyesuaianBuku.efek, jumlah: k.penyesuaianBuku.jumlah, definisi: d.penyesuaianBuku },
    { kunci: "dikecualikan", label: "Dikecualikan", efek: k.dikecualikan.efek, jumlah: (k.dikecualikan.jumlahBank ?? 0) + (k.dikecualikan.jumlahBuku ?? 0), definisi: d.dikecualikan },
  ];
}

/** Kalimat arah selisih untuk judul panel. */
export function kalimatSelisih(panel, formatUang) {
  if (!panel || panel.selisih == null) return "Saldo rekening koran belum diketahui";
  const n = keSen(panel.selisih);
  if (n === 0) return "Saldo buku sama dengan saldo bank";
  return n > 0 ? `Saldo buku ${formatUang(panel.selisih)} LEBIH TINGGI dari bank` : `Saldo buku ${formatUang(dariSen(Math.abs(n)))} LEBIH RENDAH dari bank`;
}

export const LABEL_SUMBER_SALDO = { RANTAI_SALDO_KORAN: "kolom saldo rekening koran", DIISI_PENGGUNA: "diisi manual", OPNAME_FISIK: "hitung fisik kas" };

/** Bidang pemetaan kolom impor (urutan tampil) + apakah wajib. */
export const BIDANG_PEMETAAN = [
  { kunci: "tanggal", label: "Tanggal transaksi", wajib: true },
  { kunci: "deskripsi", label: "Keterangan", wajib: true },
  { kunci: "referensi", label: "Referensi / No. bukti", wajib: false },
  { kunci: "debit", label: "Debit (uang keluar)", wajib: false },
  { kunci: "kredit", label: "Kredit (uang masuk)", wajib: false },
  { kunci: "jumlah", label: "Jumlah (satu kolom)", wajib: false },
  { kunci: "jenis", label: "Jenis DB/CR", wajib: false },
  { kunci: "saldo", label: "Saldo", wajib: false },
  { kunci: "tanggalEfektif", label: "Tanggal efektif / valuta", wajib: false },
];

/** Pemetaan valid untuk dikirim? tanggal + keterangan + (debit/kredit atau jumlah); satu kolom tidak boleh untuk dua bidang. */
export function pemetaanValid(p) {
  const nilai = Object.entries(p || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined);
  const kolom = nilai.map(([, v]) => String(v));
  if (new Set(kolom).size !== kolom.length) return { ok: false, sebab: "Satu kolom tidak boleh dipakai untuk dua bidang" };
  const ada = (k) => p?.[k] !== "" && p?.[k] !== null && p?.[k] !== undefined;
  if (!ada("tanggal")) return { ok: false, sebab: "Pilih kolom tanggal transaksi" };
  if (!ada("deskripsi")) return { ok: false, sebab: "Pilih kolom keterangan" };
  if (!ada("debit") && !ada("kredit") && !ada("jumlah")) return { ok: false, sebab: "Pilih kolom Debit/Kredit, atau satu kolom Jumlah" };
  return { ok: true, sebab: null };
}

/** Ubah pemetaan state (string) → angka untuk dikirim ke server. */
export const pemetaanUntukServer = (p, barisJudul) => ({ barisJudul, kolom: Object.fromEntries(Object.entries(p || {}).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, Number(v)])) });

/** Hari ini menurut WIB (YYYY-MM-DD). */
export function hariIniWib(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export const TAB_DETAIL = [
  { key: "buku", label: "Mutasi Buku", penjelasan: "Mutasi rekening menurut BUKU (jurnal): tanggal buku, kapan dibuat, siapa yang mencatat, sumber dokumen, dan status pencocokannya dengan bank." },
  { key: "bank", label: "Mutasi Rekening", penjelasan: "Rekening koran bank yang diimpor (tidak bisa diubah). Impor tidak pernah membuat jurnal atau mengubah saldo buku." },
  { key: "cocok", label: "Pencocokan", penjelasan: "Pasangkan baris bank dengan baris buku (1:1, 1:N, N:1). Saran tidak pernah dipakai otomatis bila ambigu." },
  { key: "rekon", label: "Rekonsiliasi", penjelasan: "Saldo buku vs saldo bank, selisihnya, dan penjelasan tiap bagian selisih. Periode hanya bisa selesai bila selisih belum dijelaskan Rp0." },
];
