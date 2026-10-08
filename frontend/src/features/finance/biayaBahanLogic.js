// Logika murni tampilan Jejak Biaya Bahan per Unit. ATURAN: nilai null TIDAK PERNAH ditampilkan sebagai "Rp0" — selalu kata/penanda yang jujur.
// Semua angka datang dari server (dibekukan saat pergerakan diposting); layar ini hanya memformat.

export const STATUS_BIAYA = {
  FINAL_MENURUT_HARGA_PO: { label: "Final menurut harga PO", variant: "green" },
  BELUM_FINAL: { label: "Belum final", variant: "orange" },
  BELUM_ADA_PEMAKAIAN: { label: "Belum ada pemakaian", variant: "neutral" },
};

export const STATUS_BARIS = {
  DINILAI: { label: "Dinilai", variant: "green" },
  TANPA_HARGA: { label: "Tanpa harga", variant: "red" },
  ESTIMASI_HISTORIS: { label: "Estimasi (belum dibekukan)", variant: "orange" },
};

export const JENIS_BIAYA = {
  PEMAKAIAN: "Pemakaian", RETUR: "Retur (mengurangi biaya)", SUSUT: "Susut / waste (di luar biaya unit)", PENYESUAIAN: "Penyesuaian stok",
};

export const STATUS_FAKTUR = {
  FAKTUR_LENGKAP: { label: "Faktur disetujui", variant: "green" },
  FAKTUR_SEBAGIAN: { label: "Faktur sebagian", variant: "orange" },
  FAKTUR_BELUM_ADA: { label: "Faktur belum ada", variant: "orange" },
  TANPA_PO: { label: "Tanpa PO", variant: "neutral" },
};

export const NAMA_BELUM_FINAL = {
  TANPA_HARGA: "Tanpa harga perolehan",
  ESTIMASI_HISTORIS: "Estimasi historis",
  RETUR_BELUM_DITERIMA: "Retur belum diterima Gudang",
  PRODUKSI_BELUM_SELESAI: "Produksi belum selesai",
  ISSUE_BELUM_KELUAR: "Material Issue belum keluar",
  FAKTUR_BELUM_ADA: "Faktur supplier belum ada",
};

export const teksQty = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toLocaleString("id-ID", { maximumFractionDigits: 4 }));

/** Rupiah bertanda (retur negatif) dengan pemisah Indonesia; null/undefined → null (pemanggil menampilkan penanda, BUKAN Rp0). */
export function teksRupiah(n, { tanda = false } = {}) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  const mutlak = Math.abs(v).toLocaleString("id-ID", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(Math.abs(v)) ? 0 : 2 });
  return `${v < 0 ? "−" : tanda && v > 0 ? "+" : ""}Rp${mutlak}`;
}

/** Sel nilai satu baris pergerakan: { teks, ket } — ket menjelaskan mengapa tidak ada angka pasti. */
export function selNilai(r, izinHarga) {
  if (!izinHarga) return { teks: r.status === "DINILAI" ? "Harga disembunyikan" : STATUS_BARIS[r.status]?.label ?? r.status, ket: null, pasti: false };
  if (r.status === "DINILAI") return { teks: teksRupiah(r.nilai, { tanda: true }), ket: null, pasti: true };
  if (r.status === "TANPA_HARGA") return { teks: "Belum bisa dihitung", ket: r.estimasi != null ? `Estimasi harga terkini ${teksRupiah(r.estimasi)} (bukan biaya pasti)` : "Material belum punya harga perolehan", pasti: false };
  return { teks: "Estimasi", ket: r.estimasi != null ? `≈ ${teksRupiah(r.estimasi)} — pergerakan ini terjadi sebelum nilai dibekukan` : "Tidak ada harga untuk memperkirakan", pasti: false };
}

/** Kartu total: nilai pasti hanya bila ada baris DINILAI; sisanya kata. */
export function kartuTotal(ringkasan, statusBiaya) {
  const b = ringkasan.biayaPersediaan;
  if (b.nilai == null) {
    return { judul: "Biaya persediaan", nilai: statusBiaya === "BELUM_ADA_PEMAKAIAN" ? "Belum ada pemakaian" : "Belum bisa dihitung", sub: statusBiaya === "BELUM_ADA_PEMAKAIAN" ? "Belum ada bahan keluar ke unit ini" : "Belum ada baris yang bernilai pasti", pasti: false };
  }
  return {
    judul: "Biaya persediaan", nilai: teksRupiah(b.nilai),
    sub: b.lengkap ? "Final menurut harga PO/perolehan" : "SEBAGIAN — masih ada bagian yang belum final (lihat daftar di bawah)", pasti: b.lengkap,
  };
}

export const jumlahBelumFinal = (d) => (d?.belumFinal ?? []).length;

/** Ringkas satu sumber lot untuk tampilan: "PO-… · GR-… · 6 × Rp43.290". */
export function teksSumber(s, izinHarga) {
  const bagian = [s.poNumber, s.receiptNumber].filter(Boolean);
  const harga = izinHarga && s.unitCost != null ? ` × ${teksRupiah(s.unitCost)}` : "";
  return `${bagian.length ? bagian.join(" · ") : "tanpa PO"} · ${teksQty(s.qty)}${harga}`;
}
