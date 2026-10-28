// LOGIKA MURNI tampilan ringkas drawer bahan (Stok & Lokasi) — diuji node --test tanpa React/DOM.
// Hanya MENYUSUN tampilan dari data yang sudah dikirim layanan live (koreksi saldo, harga berlaku, item stok). Tidak ada angka stok/harga yang dihitung di sini
// dan tidak ada aturan stok, harga, izin, persetujuan, atau audit yang diubah: yang berubah hanya apa yang tampil di awal dan apa yang dilipat.

export const ISTILAH = Object.freeze({
  tersedia: "Tersedia", saldo: "Saldo", dipesan: "Dipesan",
  rumusStok: "Tersedia = Saldo − Dipesan. Saldo dihitung dari penjumlahan seluruh baris riwayat pergerakan stok (tidak disimpan sebagai kolom). Dipesan adalah bahan dari Material Issue yang sudah disetujui tetapi belum dikeluarkan.",
});

/** Peringatan yang butuh TINDAKAN pada stok. keadaan = keadaanSaldo dari layanan Koreksi Saldo; aktif = koreksi yang belum selesai (atau null). Nol menurut pergerakan hanya informasi, bukan peringatan. */
export function peringatanStok({ keadaan, aktif = null } = {}) {
  const out = [];
  if (keadaan === "MINUS") out.push({ kode: "SALDO_MINUS", nada: "red", teks: "Saldo minus. Hitung fisik, lalu ajukan Koreksi saldo." });
  if (keadaan === "BELUM_ADA_CATATAN") out.push({ kode: "STOK_BELUM_DIKETAHUI", nada: "orange", teks: "Stok belum diketahui: belum ada catatan pergerakan. Ini bukan nol." });
  if (aktif) out.push({ kode: "KOREKSI_MENUNGGU", nada: "orange", teks: `Koreksi saldo ${aktif.nomor} ${String(aktif.statusTeks ?? "belum selesai").toLowerCase()}.`, nomor: aktif.nomor, id: aktif.id, kedaluwarsa: !!aktif.kedaluwarsa, tambahan: aktif.kedaluwarsa ? "Saldo sudah bergeser. Batalkan lalu ajukan ulang." : null });
  return out;
}

/** Peringatan harga. h = hargaBerlaku (null bila belum ada); dampak = ringkasan dampak dari layanan. Belum ada harga TIDAK PERNAH ditulis sebagai Rp0. */
export function peringatanHarga({ h, dampak = null } = {}) {
  const out = [];
  if (!h) out.push({ kode: "HARGA_BELUM_DIISI", nada: "orange", teks: "Pemakaian dicatat tanpa harga operasional (bukan Rp0)." });
  if (dampak?.gagalPembekuan?.pemakaian > 0) out.push({ kode: "PEMBEKUAN_GAGAL", nada: "red", teks: `${dampak.gagalPembekuan.pemakaian} pembekuan harga gagal dan perlu diperbaiki.` });
  return out;
}

/** Tampilan harga untuk kartu ringkas. rp = pemformat rupiah dari hargaBerlakuLogic (diteruskan agar modul ini tidak bergantung pada React). */
export function ringkasHarga(h, satuan, rp) {
  if (!h) return { ada: false, angka: "Belum diisi", satuan: null, label: null };
  return { ada: true, angka: rp(h.harga), satuan: String(satuan ?? "").toLowerCase(), label: h.teksLabelBukti ?? null, labelBukti: h.labelBukti ?? null, sejak: h.berlakuMulai ?? null };
}

/** Rincian pemakaian terdampak: hanya baris BERNILAI (bukan nol). Bila semuanya nol → daftar kosong (tampilan memakai satu kalimat). nilai = pemformat rupiah. */
export function barisDampakBermakna(dm, rpNilai) {
  if (!dm) return [];
  const out = [];
  if (dm.akanMemakai?.order > 0) out.push({ k: "order", label: "Order belum memakai bahan ini", nilai: `${dm.akanMemakai.order} order · ${dm.akanMemakai.unit} unit` });
  if (dm.sudahDibekukanSejakMulai?.pemakaian > 0) out.push({ k: "beku", label: "Pemakaian sudah dibekukan sejak harga berlaku", nilai: `${dm.sudahDibekukanSejakMulai.pemakaian} · ${rpNilai(dm.sudahDibekukanSejakMulai.nilai)}` });
  if (dm.belumDibekukan?.pemakaian > 0) out.push({ k: "tanpa-harga", label: "Pemakaian lama tanpa harga operasional", nilai: `${dm.belumDibekukan.pemakaian} · ${dm.belumDibekukan.unit} unit` });
  return out;
}

/** Angka stok di kartu Stok: bila stok BELUM DIKETAHUI (belum ada catatan pergerakan) angka tidak boleh ditampilkan sebagai 0 — ditulis "Belum diketahui". format = pemformat jumlah+satuan. */
export const teksAngkaStok = (nilai, keadaan, format) => (keadaan === "BELUM_ADA_CATATAN" ? "Belum diketahui" : format(nilai));

/**
 * Label status stok di header drawer. TIDAK ada kata "Aman": tidak ada aturan kecukupan yang dihitung dan diuji selain ambang titik restok.
 * "Ada stok" = tersedia > 0 dan di atas titik restok (atau titik restok belum diatur); "Stok menipis" = tersedia <= titik restok (aturan yang memang dihitung).
 * Empat keadaan yang TIDAK boleh tercampur dipertahankan: stok belum diketahui, nol (menurut pergerakan / terverifikasi), saldo minus, dan ada stok.
 * keadaan = keadaanSaldo dari layanan Koreksi Saldo (null bila belum dimuat / tanpa izin).
 */
export function labelStatusStok(item, keadaan = null) {
  if (!item?.active) return { key: "NONAKTIF", label: "Nonaktif", tone: "neutral" };
  if (keadaan === "BELUM_ADA_CATATAN") return { key: "BELUM_DIKETAHUI", label: "Stok belum diketahui", tone: "neutral" };
  if (keadaan === "MINUS") return { key: "MINUS", label: "Saldo minus", tone: "red" };
  if (keadaan === "NOL_TERVERIFIKASI") return { key: "NOL_TERVERIFIKASI", label: "Nol terverifikasi", tone: "neutral" };
  if (keadaan === "NOL_MENURUT_PERGERAKAN") return { key: "NOL_PERGERAKAN", label: "Nol menurut pergerakan", tone: "orange" };
  const tersedia = Number(item.available ?? item.balance); const saldo = Number(item.balance);
  if (tersedia > 0) return item.reorderPoint != null && tersedia <= Number(item.reorderPoint) ? { key: "MENIPIS", label: "Stok menipis", tone: "orange" } : { key: "ADA_STOK", label: "Ada stok", tone: "green" };
  if (saldo > 0) return { key: "SEMUA_DIPESAN", label: "Semua dipesan", tone: "orange" };
  if (saldo < 0) return { key: "MINUS", label: "Saldo minus", tone: "red" };
  return { key: "TIDAK_TERSEDIA", label: "Tidak tersedia", tone: "neutral" };
}

export const TEKS_DRAWER = Object.freeze({
  dampakKosong: "Belum ada pemakaian yang terdampak harga bahan ini.",
  aturanKoreksi: "Koreksi saldo tidak menimpa angka. Ini mengajukan Penyesuaian Stok resmi: stok baru berubah setelah disetujui ORANG LAIN (Owner atau Finance) lalu diposting oleh Gudang.",
  bedaAngka: "Harga Berlaku adalah harga kerja untuk HPP operasional per satuan stok. Nilai persediaan Finance adalah angka terpisah (Persediaan Awal/GR) dan tidak berubah karena harga ini.",
  catatanLokasi: "Lokasi rak/bin, batch dan lot, serta tanggal kedaluwarsa belum tersedia: kolomnya belum ada di database.",
  referensi: "Harga dan nilai stok referensi adalah snapshot satu kali dari stock opname Excel (bulan di kurung; bila bulan diminta kosong, diambil bulan terdekat sebelumnya). Bukan angka hidup dan tidak berubah mengikuti transaksi.",
});
