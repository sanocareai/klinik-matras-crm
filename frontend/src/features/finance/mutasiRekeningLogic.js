// Logika murni tab Mutasi Rekening. Angka resmi (saldo awal, masuk, keluar, saldo berjalan, saldo akhir) SELALU dari server (GET /api/finance/buku/rekening/:id/mutasi); di sini hanya
// urutan pilihan rekening dan ringkasan teks.

/** Rekening aktif yang ditampilkan sebagai pilihan: bank dulu (nama), kas tunai terakhir. */
export function urutkanRekening(daftar) {
  const bobot = (r) => (r.kind === "KAS" ? 2 : r.kind === "EWALLET" ? 1 : 0);
  return (daftar || []).filter((r) => r.active).slice().sort((a, b) => bobot(a) - bobot(b) || String(a.name).localeCompare(String(b.name), "id"));
}

/** Rekening awal yang dipilih: PT Sano bila ada (rekening operasional utama), kalau tidak yang pertama. */
export function pilihanAwal(daftar) {
  const urut = urutkanRekening(daftar);
  return (urut.find((r) => /pt\s*sano/i.test(r.name)) || urut[0])?.id ?? "";
}

/** Arah baris untuk label/warna: "MASUK" | "KELUAR". */
export const arahBaris = (b) => (b.masuk ? "MASUK" : "KELUAR");
