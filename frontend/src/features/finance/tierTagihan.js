// Tier & lebar kolom tabel Tagihan Supplier (B3.3.1). Logika MURNI (tanpa React) supaya bisa dites dengan `node --test`.
//
// Akar masalah sebelumnya: kolom Nomor hanya 124px padahal "BILL-01092026-001" (monospace 12px) butuh ±146px, dan selnya
// tidak punya batas potong — teks meluber ke kolom Ref Supplier. Sekarang lebar tiap kolom eksplisit lewat <colgroup> per tier,
// dan tier dihitung dari lebar CONTAINER (bukan viewport), jadi sidebar/tab yang makan ruang ikut diperhitungkan.
//
//   full    : semua kolom (Ref Supplier, Supplier, Tanggal, Nilai, Terbayar terpisah)
//   reduced : Ref Supplier pindah jadi teks kedua di bawah Keterangan; Tanggal/Nilai/Terbayar disembunyikan
//   minimal : Supplier juga pindah ke teks kedua; tersisa Nomor, Keterangan, Sisa, Status, Aksi
//   card    : <768 — daftar kartu

export const AMBANG_TIER_TAGIHAN = Object.freeze({ full: 1480, reduced: 1000, minimal: 768 });
export const LEBAR_NOMOR = 168; // BILL-DDMMYYYY-NNN monospace 12px ≈ 146px + padding 24px
export const KETERANGAN_MIN = 200; // sisa ruang minimal untuk kolom fleksibel Keterangan

export function tierTagihan(lebarContainer) {
  if (lebarContainer >= AMBANG_TIER_TAGIHAN.full) return "full";
  if (lebarContainer >= AMBANG_TIER_TAGIHAN.reduced) return "reduced";
  if (lebarContainer >= AMBANG_TIER_TAGIHAN.minimal) return "minimal";
  return "card";
}

/** Urutan kolom per tier: [kunci, lebar px | null (fleksibel)]. Sumber tunggal untuk <colgroup>, TH, dan tes geometri. */
export function kolomTagihan(tier, lebarAksi) {
  const nomor = ["nomor", LEBAR_NOMOR];
  const ket = ["keterangan", null];
  const sisa = ["sisa", 112];
  const status = ["status", 112];
  const aksi = ["aksi", lebarAksi];
  if (tier === "full") {
    return [nomor, ["ref", 132], ["supplier", 150], ket, ["tanggal", 92], ["tempo", 96], ["nilai", 108], ["terbayar", 108], sisa, status, aksi];
  }
  if (tier === "reduced") return [nomor, ["supplier", 150], ket, ["tempo", 96], sisa, status, aksi];
  if (tier === "minimal") return [nomor, ket, sisa, status, aksi];
  return [];
}

export const lebarKolom = (tier, lebarAksi) => kolomTagihan(tier, lebarAksi).map(([, w]) => w);
export const adaKolom = (tier, kunci, lebarAksi = 148) => kolomTagihan(tier, lebarAksi).some(([k]) => k === kunci);

/** Teks kedua di bawah Keterangan: kolom yang disembunyikan pada tier sempit pindah ke sini (bukan hilang). */
export function teksKedua(b, tier) {
  const bagian = [];
  if (tier === "minimal" && b.supplier?.name) bagian.push(b.supplier.name);
  if (tier !== "full" && b.supplierRef) bagian.push(`Ref ${b.supplierRef}`);
  if (b.jenisTagihan?.label) bagian.push(b.jenisTagihan.label);
  if (b.goodsReceipt?.receiptNumber) bagian.push(`penerimaan ${b.goodsReceipt.receiptNumber}`);
  return bagian.join(" · ");
}
