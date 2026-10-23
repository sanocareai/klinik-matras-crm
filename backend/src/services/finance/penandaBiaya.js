// PENANDA PENYAJIAN BIAYA — satu sumber teks untuk layar, dashboard, grafik, dan Excel (audit tanda laporan Finance, 23 Okt 2026).
//
// Akun biaya (beban pokok/operasional) dilaporkan sebagai BIAYA NETO = debit − kredit (saldo normal). Bila kredit melebihi debit pada periode itu, nilainya NEGATIF: itu bukan biaya biasa, melainkan
// PEMBALIK BEBAN BERSIH — ia MENGURANGI total biaya dan MENAIKKAN laba. Penanda ini HANYA penyajian: tanda jurnal, nilai `nilai`, dan rumus laba TIDAK berubah.
// Nominal pembalik ditulis dalam kurung (kebiasaan laporan keuangan Indonesia) dan selalu disertai label ini — tidak pernah muncul sebagai angka positif tanpa keterangan.

export const PEMBALIK_BEBAN_BERSIH = Object.freeze({
  label: "Pembalik beban bersih",
  penjelasan: "Akun biaya ini bersaldo kredit bersih pada periode: ia mengurangi total biaya dan menaikkan laba. Bukan biaya biasa; nominal ditulis dalam kurung.",
});
export const PEMBALIK_RETUR_BERSIH = Object.freeze({
  label: "Pembalik retur bersih",
  penjelasan: "Akun retur & potongan ini bersaldo kredit bersih pada periode: ia menambah pendapatan bersih (retur dibalik).",
});
export const RUMUS_LABA = "Laba Bersih = Pendapatan Bersih − Beban Pokok − Beban Operasional. Pembalik beban bersih bernilai negatif di dalam beban, sehingga mengurangi total beban dan menaikkan laba.";

export const PENANDA_PENYAJIAN = Object.freeze({ pembalikBebanBersih: PEMBALIK_BEBAN_BERSIH, pembalikReturBersih: PEMBALIK_RETUR_BERSIH, rumusLaba: RUMUS_LABA });

/** Sifat satu akun biaya menurut nilai netonya. */
export const sifatBeban = (nilai) => (Number(nilai) < 0 ? PEMBALIK_BEBAN_BERSIH.label : "Beban");
/** Sifat satu BARIS jurnal pada akun biaya (per baris: debit = beban, kredit = pembalik). */
export const sifatBarisBeban = (nilai) => (Number(nilai) < 0 ? "Pembalik beban (baris kredit)" : "Beban (baris debit)");
