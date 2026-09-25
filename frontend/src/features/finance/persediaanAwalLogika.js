// Logika murni halaman Tutup Stok & Persediaan Awal (B3.6) — dites langsung (tests/persediaanAwal.test.js).
// Aturan sebenarnya ditegakkan server (backend/src/services/finance/persediaanAwal.js); di sini hanya membaca tempelan
// spreadsheet dan menyusun teks tampilan.

export const CATATAN_PERIODIK = "Metode periodik — nilai persediaan akhir ditentukan melalui stok opname.";

export const KOLOM_TEMPEL = ["kode", "qty", "satuan", "harga", "sumber", "referensi", "penjelasanHarga", "catatan"];
export const JUDUL_KOLOM = ["Kode material", "Qty fisik", "Satuan", "Harga/unit", "Sumber harga", "No. dokumen harga", "Penjelasan harga", "Catatan"];

const BARIS_JUDUL = /^(kode|kode material|material)$/i;

/**
 * Tempelan dari spreadsheet (tab), CSV (koma) atau titik-koma → baris untuk API. Baris judul & baris kosong dilewati.
 * Angka dikirim apa adanya (server yang membaca "1.234,5" maupun "1234.5").
 */
export function bacaTempelan(teks) {
  const baris = String(teks || "").split(/\r?\n/).map((b) => b.trim()).filter(Boolean);
  const hasil = [];
  for (const b of baris) {
    const pemisah = b.includes("\t") ? "\t" : b.includes(";") ? ";" : ",";
    const sel = b.split(pemisah).map((s) => s.trim().replace(/^"(.*)"$/, "$1"));
    if (BARIS_JUDUL.test(sel[0] || "")) continue;
    const r = {};
    KOLOM_TEMPEL.forEach((k, i) => { r[k] = sel[i] ?? ""; });
    // CSV berkoma memecah "20,5" menjadi dua sel — tolak dengan jelas daripada salah baca.
    if (pemisah === "," && sel.length > KOLOM_TEMPEL.length) r.galatTempel = "Terlalu banyak kolom — gunakan tab (salin dari spreadsheet) atau titik-koma bila angka memakai koma desimal.";
    hasil.push(r);
  }
  return hasil;
}

export const LABEL_STATUS_SNAPSHOT = {
  DRAFT: ["Draf", "neutral"], DIPERIKSA: ["Sudah diperiksa", "info"], DIPOSTING: ["Sudah diposting", "success"],
  DIBALIK: ["Dibalik", "warning"], DIBATALKAN: ["Dibatalkan", "neutral"],
};

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function tanggalIndonesia(kunci) {
  const [y, m, d] = String(kunci || "").slice(0, 10).split("-");
  return y && m && d ? `${Number(d)} ${BULAN[Number(m) - 1]} ${y}` : "—";
}

/** Tindakan yang boleh ditampilkan untuk snapshot & pengguna ini (server tetap memeriksa ulang). */
export function tindakanTersedia(snap, bisa = {}) {
  if (!snap) return [];
  const t = [];
  if (snap.status === "DRAFT") {
    if (bisa.tulis) t.push("isi", "batal");
    if (bisa.periksaFinance && !snap.financeCheckedById) t.push("periksaFinance");
    if (bisa.periksaGudang && !snap.warehouseCheckedById) t.push("periksaGudang");
  }
  if (snap.status === "DIPERIKSA") {
    if (bisa.periksaFinance) t.push("bukaKembali");
    if (bisa.posting) t.push("posting");
  }
  if (snap.status === "DIPOSTING" && bisa.posting) t.push("balik");
  return t;
}

export function ringkasPenyesuaian(pr) {
  if (!pr) return "";
  const n = Number(pr.penyesuaian);
  if (n === 0) return "Saldo buku sudah sama dengan stok fisik — tidak ada jurnal yang perlu dibuat.";
  return n > 0
    ? "Stok fisik lebih besar dari saldo buku: Persediaan Bahan Baku bertambah, Beban Bahan Baku berkurang."
    : "Stok fisik lebih kecil dari saldo buku: Persediaan Bahan Baku berkurang, Beban Bahan Baku bertambah.";
}
