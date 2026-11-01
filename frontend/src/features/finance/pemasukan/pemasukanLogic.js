// Logika PENYAJIAN halaman Pemasukan Finance (murni, tanpa React). Hanya menata angka/teks yang SUDAH dikirim server
// (GET /api/finance/pemasukan/{ringkasan,opsi,…}). Tidak ada perhitungan akuntansi baru, tidak ada total gabungan baru.

/** Kategori/halaman. `id` = kunci tab lama (tidak berubah). `kategori` = kategori server. `utama` = tampil sebagai pilihan utama; sisanya masuk "Kategori lainnya". */
export const TAB = Object.freeze([
  { id: "ringkasan", label: "Ringkasan", judul: "Ringkasan", utama: true },
  { id: "pendapatan", label: "Pendapatan", judul: "Pendapatan diakui", kategori: "PENDAPATAN", utama: true,
    ringkas: "Penjualan yang sudah diakui di buku besar; belum tentu sudah dibayar." },
  { id: "pembayaran", label: "Uang masuk", judul: "Uang masuk", kategori: "PEMBAYARAN", utama: true,
    ringkas: "Pembayaran pelanggan yang tercatat, lengkap dengan status verifikasinya." },
  { id: "verifikasi", label: "Menunggu verifikasi", judul: "Menunggu verifikasi",
    ringkas: "Dua antrean berbeda yang perlu diperiksa Finance: klaim lunas dari Sales dan pembayaran yang belum diverifikasi." },
  { id: "lain", label: "Pemasukan lain", judul: "Pemasukan lain", kategori: "LAIN",
    ringkas: "Pendapatan di luar penjualan order yang dicatat lewat Pemasukan Lain." },
  { id: "dana", label: "Dana masuk bukan pendapatan", judul: "Dana masuk bukan pendapatan", kategori: "DANA",
    ringkas: "Setoran modal dan pendanaan pihak ketiga; tidak masuk laba." },
  { id: "historis", label: "Data sebelum penggunaan sistem", judul: "Data sebelum penggunaan sistem", kategori: "HISTORIS",
    ringkas: "Arsip pendapatan dari sebelum sistem dipakai; belum memengaruhi buku besar." },
]);

export const tabDari = (id) => TAB.find((t) => t.id === id) ?? TAB[0];

/** Nomor halaman dengan elipsis, mis. [1, "…", 4, 5, 6, "…", 19]. */
export function nomorHalaman(total, limit, halaman) {
  const n = Math.max(1, Math.ceil((Number(total) || 0) / (Number(limit) || 25)));
  const h = Math.min(Math.max(1, halaman), n);
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
  const set = new Set([1, 2, n - 1, n, h - 1, h, h + 1]);
  const urut = [...set].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b);
  const hasil = [];
  urut.forEach((x, i) => { if (i > 0 && x - urut[i - 1] > 1) hasil.push("…"); hasil.push(x); });
  return hasil;
}

/** Rentang baris yang tampil: { dari, sampai } (1-berbasis). */
export function rentangBaris(total, limit, halaman) {
  if (!total) return { dari: 0, sampai: 0 };
  const dari = (halaman - 1) * limit + 1;
  return { dari, sampai: Math.min(halaman * limit, total) };
}

/**
 * Indeks rekening (kas/bank/e-wallet) menurut NAMA yang dikirim baris daftar. Baris daftar hanya membawa nama rekening, bukan id/bank.
 * Nama yang cocok dengan TEPAT satu rekening aktif → rekening itu; nama ganda atau gabungan beberapa rekening (", ") → null (logo netral).
 * Bank TIDAK PERNAH ditebak dari nama pelanggan atau dari isi nama rekening — hanya dari kind/bankName rekening yang cocok (lihat jenisRekening).
 */
export function indeksRekening(daftar) {
  const per = new Map();
  for (const a of daftar ?? []) {
    const k = String(a?.name ?? "").trim();
    if (!k) continue;
    per.set(k, per.has(k) ? null : a);
  }
  return per;
}
export const akunDariNama = (indeks, nama) => (nama ? indeks?.get(String(nama).trim()) ?? null : null);

/** Kelompok antrean/pekerjaan pada Ringkasan. Tiap baris punya CAKUPAN sendiri; TIDAK ada total gabungan antar baris (definisinya berbeda). */
export function susunTindakLanjut(r, { tanggal } = {}) {
  if (!r) return [];
  const v = r.perluVerifikasiFinance;
  const bb = r.pembayaranMasuk?.belumDibukukan;
  const celah = r.cutoff?.celahPengakuan;
  const baris = [];
  if (v) {
    baris.push({ id: "klaim", judul: "Klaim lunas dari Sales menunggu verifikasi", jumlah: v.klaimSales.jumlah, satuan: "order", nilai: v.klaimSales.nilai, cakupan: "Semua periode", tujuan: "verifikasi",
      penjelasan: "Status lunas di CRM, tetapi belum ada catatan uang masuk. Belum menjadi pembayaran yang bisa diverifikasi." });
    baris.push({ id: "menunggu", judul: "Pembayaran tercatat menunggu verifikasi", jumlah: v.pembayaranMenunggu.jumlah, satuan: "pembayaran", nilai: v.pembayaranMenunggu.nilai, cakupan: "Semua periode", tujuan: "verifikasi",
      penjelasan: "Catatan pembayaran yang sudah ada tetapi belum diverifikasi Finance." });
  }
  if (bb && bb.jumlah > 0) {
    baris.push({ id: "belumBuku", judul: "Pembayaran terverifikasi belum masuk buku besar", jumlah: bb.jumlah, satuan: "pembayaran", nilai: bb.nilai, cakupan: "Periode terpilih", tujuan: "pembayaran",
      penjelasan: "Rekening kas/bank belum dipetakan, jadi belum ada jurnalnya. Selesaikan lewat Data belum lengkap." });
  }
  if (celah) {
    baris.push({ id: "celah", judul: "Order yang belum masuk pembukuan", jumlah: celah.jumlahOrder, satuan: "order", nilai: celah.nilaiOrder, tujuan: null, cakupanDari: celah.dari, cakupanSampai: celah.sampai,
      penjelasan: "Perlu diperiksa; tidak otomatis diakui sebagai pendapatan.", rincian: celah.catatan, dasar: r.cutoff?.dasar ?? null, tanggalAcuan: r.cutoff?.tanggal ?? tanggal ?? null });
  }
  if (r.perluDitinjau?.jumlah > 0) {
    baris.push({ id: "tinjau", judul: "Baris perlu ditinjau", jumlah: r.perluDitinjau.jumlah, satuan: "baris", nilai: r.perluDitinjau.nilai, cakupan: "Periode terpilih", tujuan: null,
      penjelasan: "Klasifikasinya belum bisa dipastikan dari data yang ada, sehingga tidak dihitung ke kategori mana pun sampai ditinjau." });
  }
  return baris.map((b) => ({ ...b, status: b.jumlah > 0 ? "perlu" : "bersih" }));
}

/** Kelas chip dari nada server (success/warning/danger/neutral/info). */
export const KELAS_NADA = Object.freeze({ success: "green", warning: "orange", danger: "red", neutral: "neutral", info: "neutral" });
export const kelasNada = (nada) => KELAS_NADA[nada] ?? "neutral";

/** Berapa filter di "Filter lainnya" yang sedang aktif. */
export const jumlahFilterLanjutan = ({ pihak }) => (String(pihak ?? "").trim() ? 1 : 0);

/** "-1234567.50" → "(Rp1.234.567,50)" tanpa mengubah ke Number (aman untuk nominal besar). Uang dari server berupa STRING desimal. null/kosong → "—" (tidak tersedia ≠ Rp0). */
export function teksRp(s, { sen = true } = {}) {
  if (s === null || s === undefined || s === "") return "—";
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(s));
  if (!m) return String(s);
  const [, neg, bulat, des = "00"] = m;
  const grup = bulat.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const teks = `Rp${grup}${sen && /[1-9]/.test(des) ? `,${des.padEnd(2, "0").slice(0, 2)}` : ""}`;
  return neg ? `(${teks})` : teks;
}

/** Penjelasan lengkap perbedaan pendapatan dan uang masuk (teks lama halaman ini, dipindah ke tombol info di bawah KPI). */
export const PENJELASAN_BEDA = "Pendapatan adalah omzet yang diakui, bukan bukti uang masuk. Order diakui saat diserahkan dan belum tentu sudah dibayar. Uang masuk = pembayaran yang benar-benar diterima; rekening muncul di uang masuk, bukan selalu di pendapatan. Keduanya dua metrik berbeda dan tidak dijumlahkan (akan menghitung penjualan yang sama dua kali).";
