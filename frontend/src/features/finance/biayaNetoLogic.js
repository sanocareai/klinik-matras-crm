// PENYAJIAN BIAYA NETO — logika murni (tanpa React) supaya bisa dites node --test. Teks penanda DARI SERVER (penanda di respons laporan; sumber tunggal backend/services/finance/penandaBiaya.js);
// nilai tiruan di bawah hanya cadangan bila server lama belum mengirimnya.
//
// Akun biaya dilaporkan sebagai biaya NETO (debit − kredit). Bila kredit melebihi debit nilainya NEGATIF = "pembalik beban bersih": mengurangi biaya dan MENAIKKAN laba.
// Tidak ada angka yang dihitung ulang di sini; tanda jurnal dan rumus laba tidak berubah.

export const PENANDA_CADANGAN = Object.freeze({
  pembalikBebanBersih: { label: "Pembalik beban bersih", penjelasan: "Akun biaya ini bersaldo kredit bersih pada periode: ia mengurangi total biaya dan menaikkan laba. Bukan biaya biasa; nominal ditulis dalam kurung." },
  pembalikReturBersih: { label: "Pembalik retur bersih", penjelasan: "Akun retur & potongan ini bersaldo kredit bersih pada periode: ia menambah pendapatan bersih (retur dibalik)." },
  rumusLaba: "Laba Bersih = Pendapatan Bersih − Beban Pokok − Beban Operasional. Pembalik beban bersih bernilai negatif di dalam beban, sehingga mengurangi total beban dan menaikkan laba.",
});

export const penandaDari = (data) => ({
  pembalikBebanBersih: data?.penanda?.pembalikBebanBersih ?? PENANDA_CADANGAN.pembalikBebanBersih,
  pembalikReturBersih: data?.penanda?.pembalikReturBersih ?? PENANDA_CADANGAN.pembalikReturBersih,
  rumusLaba: data?.penanda?.rumusLaba ?? PENANDA_CADANGAN.rumusLaba,
});

/** Apakah nilai biaya neto ini pembalik (kredit bersih)? Nol bukan pembalik. */
export const adalahPembalik = (nilai) => Number(nilai) < 0;

/** Ringkasan pembalik dari ringkasan Laba Rugi: { pokok, operasional, ada } — nilai ≤ 0. */
export function ringkasPembalik(ringkasan) {
  const pokok = Number(ringkasan?.pembalikBebanPokok) || 0; const operasional = Number(ringkasan?.pembalikBebanOperasional) || 0;
  return { pokok, operasional, ada: pokok < 0 || operasional < 0 };
}

/** Kalimat pendek di bawah kartu Beban Pokok / Beban Operasional bila ada pembalik di dalamnya (null = tidak perlu). */
export function subKartuBiaya(nilaiPembalik, formatUang) {
  const v = Number(nilaiPembalik) || 0;
  return v < 0 ? `Termasuk pembalik beban bersih ${formatUang(v)} — mengurangi biaya, menaikkan laba` : null;
}

/**
 * Baris akun Laba Rugi untuk ditampilkan. Beban/biaya tampil sebagai biaya NETO (nilai apa adanya; negatif → kurung + label). Retur tampil sebagai pengurang (−nilai);
 * retur bersaldo kredit (pembalik retur) tampil positif + label supaya tidak terbaca sebagai pendapatan biasa.
 * @returns {{ nilaiTampil:number, label:string|null }}
 */
export function barisLabaRugi(row, jenis, penanda) {
  const nilai = Number(row?.nilai) || 0;
  if (jenis === "retur") return { nilaiTampil: -nilai, label: nilai < 0 ? penanda.pembalikReturBersih.label : null };
  if (jenis === "beban") return { nilaiTampil: nilai, label: nilai < 0 ? penanda.pembalikBebanBersih.label : null };
  return { nilaiTampil: nilai, label: null };
}

/** Nilai batang grafik Laba Rugi: apa adanya (bertanda); batang pembalik diwarnai hijau dan diberi label di tooltip. */
export function barisGrafikLabaRugi(r, penanda) {
  const baris = (name, value, warna, ciri = null) => ({ name, value, color: warna, label: ciri });
  return [
    baris("Pendapatan Bersih", r.pendapatanBersih, "var(--green)"),
    baris("Beban Pokok", r.bebanPokok, r.bebanPokok < 0 ? "var(--green)" : "var(--orange)", r.bebanPokok < 0 ? penanda.pembalikBebanBersih.label : null),
    baris("Beban Operasional", r.bebanOperasional, r.bebanOperasional < 0 ? "var(--green)" : "var(--orange)", r.bebanOperasional < 0 ? penanda.pembalikBebanBersih.label : null),
    baris("Laba Bersih", r.labaBersih, r.labaBersih < 0 ? "var(--red)" : "var(--accent)"),
  ];
}

/** Penanda Neraca Saldo: saldo berlawanan dengan saldo normal akun (sisi sudah dibetulkan server; angka positif). */
export const labelSaldoTerbalik = (b) => (b?.saldoTidakNormal ? `Saldo terbalik (berlawanan dengan saldo normal ${b.normalBalance === "DEBIT" ? "debit" : "kredit"})` : null);

/** Pesan Neraca tidak seimbang — melaporkan selisih dan LANGKAH PEMERIKSAAN tanpa menebak satu penyebab. */
export function pesanNeracaTakSeimbang(selisih, formatUang) {
  return {
    judul: "Neraca tidak seimbang",
    isi: `Selisih ${formatUang(selisih)} antara Total Aset dan Total Kewajiban + Ekuitas. Penyebabnya belum bisa dipastikan dari satu angka ini.`,
    langkah: [
      "Periksa Neraca Saldo: apakah Total Mutasi Debit = Total Mutasi Kredit (bila tidak, ada jurnal yang tidak seimbang).",
      "Periksa saldo awal dan migrasi: apakah saldo awal sudah diinput lengkap dan seimbang, dan tanggal mulai pembukuan benar.",
      "Periksa klasifikasi akun (aset/kewajiban/ekuitas/kontra) pada akun-akun yang bersaldo tidak wajar di Neraca Saldo.",
      "Periksa jurnal penutup / laba ditahan dan pergantian tahun: laba atau rugi tahun-tahun sebelumnya yang belum ditutup.",
    ],
  };
}

/** Penjelasan Neraca: laba tahun berjalan dihitung dari akun pendapatan & beban — TANPA klaim bahwa neraca selalu seimbang. */
export const PENJELASAN_LABA_BERJALAN = "Laba tahun berjalan dihitung langsung dari akun pendapatan & beban sejak 1 Januari — tidak bergantung pada proses tutup buku tahunan. Neraca seharusnya seimbang; bila tidak, jangan menyimpulkan penyebabnya dari satu angka — ikuti langkah pemeriksaan yang ditampilkan.";

/** Drilldown: hasil sudah disaring SERVER. Label jumlah/total + peringatan parsial bila daftar dipotong. */
export function ringkasDrilldown(data) {
  const jumlah = Number(data?.jumlah) || 0; const tampil = Number(data?.jumlahDitampilkan ?? data?.baris?.length) || 0;
  const aktif = !!(data?.filter && (data.filter.akun || data.filter.divisi || data.filter.sumber || data.filter.q));
  return {
    jumlah, tampil, aktif, parsial: !!data?.terpotong,
    labelDaftar: data?.terpotong ? `Menampilkan ${tampil.toLocaleString("id-ID")} dari ${jumlah.toLocaleString("id-ID")} baris — total di atas dihitung dari SEMUA ${jumlah.toLocaleString("id-ID")} baris (Excel memuat semuanya)` : `Menampilkan semua ${jumlah.toLocaleString("id-ID")} baris`,
  };
}
