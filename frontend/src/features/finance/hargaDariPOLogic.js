// Logika murni bagian "Harga Berlaku otomatis" di formulir PO (tanpa React) — diuji di tests/hargaDariPOLogic.test.js.
// Aturan: harga bahan otomatis menjadi Harga Berlaku operasional SAAT PO BERHASIL DISIMPAN (draf baru/ubah draf); isian yang belum disimpan tidak mengubah harga; tanpa dialog persetujuan harga.

export const STATUS_HARGA_PO = Object.freeze({
  BARU: { teks: "Harga pertama", varian: "accent" },
  NAIK: { teks: "Naik", varian: "orange" },
  TURUN: { teks: "Turun", varian: "green" },
  SAMA: { teks: "Sama — tidak berubah", varian: "neutral" },
  TIDAK_DIUBAH: { teks: "Tidak diubah di penyimpanan ini", varian: "neutral" },
  KONFLIK_HARGA_BEDA: { teks: "Konflik harga", varian: "red" },
  KONVERSI_TIDAK_ADA: { teks: "Tidak ada konversi satuan", varian: "red" },
  KONVERSI_TIDAK_SAH: { teks: "Konversi tidak sah", varian: "red" },
});
const MENULIS = new Set(["BARU", "NAIK", "TURUN"]);

/** Rupiah dengan sampai 4 desimal (harga per satuan stok bisa pecahan); kosong = strip (bukan Rp0). */
export function rpHarga(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `Rp${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 4 })}`;
}

/** Pratinjau server → { [nomorBaris]: info } supaya tiap baris formulir menampilkan dampaknya sendiri (konflik di SEMUA baris bahan yang sama). */
export function petaBarisHarga(pra) {
  const out = {};
  for (const b of pra?.baris ?? []) for (const no of b.barisPO) out[no] = { ...b, ...(b.masalah && { masalahTeks: b.alasan }), tulis: MENULIS.has(b.status) };
  return out;
}

/** Kalimat dampak satu baris — hanya angka dari server. */
export function teksDampakBaris(b) {
  if (!b) return "";
  if (b.masalah) return b.alasan;
  if (b.status === "SAMA") return `Harga sama dengan Harga Berlaku sekarang (${rpHarga(b.hargaBaru)} / ${b.satuanStok}) — tidak ada perubahan.`;
  if (b.status === "TIDAK_DIUBAH") return "Harga baris ini tidak diubah — Harga Berlaku tidak disentuh saat disimpan.";
  const lama = b.hargaLama != null ? `${rpHarga(b.hargaLama)} → ` : "Belum ada harga berlaku → ";
  return `Saat disimpan, Harga Berlaku menjadi ${lama}${rpHarga(b.hargaBaru)} / ${b.satuanStok}${b.faktor ? ` (1 ${b.satuanBeli} = ${b.faktor} ${b.satuanStok})` : ""}.`;
}

/** Ringkasan di atas tombol Simpan; true = ada yang menahan penyimpanan (server tetap memeriksa). */
export function ringkasDampak(pra) {
  if (!pra) return { teks: "", menahan: false };
  if (pra.aktif === false) return { teks: "Pembaruan Harga Berlaku otomatis dari PO sedang dimatikan.", menahan: false };
  const r = pra.ringkas ?? {};
  if (r.masalah) return { teks: `${r.masalah} bahan bermasalah — perbaiki di barisnya sebelum menyimpan.`, menahan: true };
  if (r.akanMenulis) return { teks: `Saat disimpan, ${r.akanMenulis} Harga Berlaku bahan akan diperbarui otomatis.`, menahan: false };
  return { teks: "Tidak ada Harga Berlaku yang berubah saat disimpan.", menahan: false };
}

/** Teks hasil NYATA dari respons simpan (tidak pernah mengklaim harga terbarui bila server tidak mencatatnya). */
export function ringkasHasilSimpan(h) {
  if (!h || h.aktif === false) return "";
  const n = h.diterapkan?.length ?? 0;
  return n ? `PO disimpan · ${n} Harga Berlaku diperbarui otomatis.` : "PO disimpan · tidak ada Harga Berlaku yang berubah.";
}
