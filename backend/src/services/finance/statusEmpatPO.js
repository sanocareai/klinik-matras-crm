// EMPAT STATUS TERPISAH PADA DETAIL PO (Okt 2026): progres barang, faktur, utang, pembayaran — dihitung SERVER, murni dari angka yang sudah ada (tidak ada sumber kebenaran baru).
// Frontend hanya menampilkan kode/label/rincian dari sini. Fungsi ini MURNI (tanpa DB) supaya bisa diuji tabel-demi-tabel.
//
// Prinsip yang ditegakkan lewat kalimat tiap status:
//   • Simpan ke Stok hanya menambah stok — TIDAK menyetujui faktur. Catat Faktur dan Setujui adalah aksi Finance yang terpisah.
//   • Faktur disetujui = utang resmi. Pembayaran (termasuk uang muka) TIDAK menambah stok dan uang muka bukan utang.
//   • "Sudah dibayar" = kas yang benar-benar keluar ke supplier untuk PO ini (uang muka + pembayaran atas faktur). Penerapan uang muka ke faktur bukan kas keluar kedua.

const NOL = 1e-9;
const tepat = (n) => Math.round(Number(n ?? 0) * 100) / 100;

export const STATUS_BARANG = Object.freeze({
  PO_DRAFT: "PO belum disetujui",
  PO_DIBATALKAN: "PO dibatalkan",
  BELUM_DATANG: "Barang belum datang",
  DATANG_SEBAGIAN: "Datang sebagian",
  LENGKAP: "Semua barang sudah masuk stok",
});
export const STATUS_FAKTUR = Object.freeze({
  BELUM_ADA: "Belum ada faktur",
  MENUNGGU_PERSETUJUAN: "Menunggu persetujuan Finance",
  DISETUJUI_SEBAGIAN: "Sebagian disetujui",
  DISETUJUI_LENGKAP: "Faktur disetujui lengkap",
});
export const STATUS_UTANG = Object.freeze({
  BELUM_ADA: "Belum ada utang",
  ADA_UTANG: "Ada utang berjalan",
  LUNAS: "Utang lunas",
});
export const STATUS_PEMBAYARAN = Object.freeze({
  BELUM_ADA: "Belum ada pembayaran",
  UANG_MUKA_SAJA: "Baru uang muka",
  DIBAYAR_SEBAGIAN: "Dibayar sebagian",
  LUNAS: "Lunas",
  KELEBIHAN: "Kelebihan bayar",
});

/**
 * @param {object} p
 *   statusPO         status PO (DRAFT|DISETUJUI|DITERIMA_SEBAGIAN|SELESAI|DIBATALKAN)
 *   barang           [{ dipesan, datang, masukStok, baikBelumDisimpan, belumDiperiksa, menungguPengganti, belumMasukStok }]  (progres per baris, kuantitas)
 *   nilaiPO          nilai PO (rupiah)
 *   fakturSemua      [{ status }]  semua faktur atas PO (semua status)
 *   sudahDitagih     Σ faktur DISETUJUI/DIBAYAR_SEBAGIAN/LUNAS
 *   utangTercatat    sudahDitagih − pengurang (uang muka diterapkan, debit note)
 *   uangMukaDibayar, uangMukaBelumDiterapkan, dibayarAtasFaktur, sisaUtang
 */
export function hitungStatusEmpat(p) {
  const nilaiPO = tepat(p.nilaiPO);
  const sudahDitagih = tepat(p.sudahDitagih);
  const sisaUtang = tepat(p.sisaUtang);
  const uangMukaDibayar = tepat(p.uangMukaDibayar);
  const dibayarAtasFaktur = tepat(p.dibayarAtasFaktur);
  const sudahDibayar = tepat(uangMukaDibayar + dibayarAtasFaktur);

  // ── 1. Progres barang ──
  const baris = p.barang ?? [];
  const sum = (f) => baris.reduce((s, b) => s + Number(b[f] ?? 0), 0);
  const adaDatang = sum("datang") > NOL;
  const adaMasukStok = sum("masukStok") > NOL;
  const semuaMasuk = baris.length > 0 && baris.every((b) => Number(b.belumMasukStok ?? 0) <= NOL);
  const baikBelumDisimpan = sum("baikBelumDisimpan") > NOL;
  const belumDiperiksa = sum("belumDiperiksa") > NOL;
  const menungguPengganti = sum("menungguPengganti") > NOL;
  let kodeBarang;
  if (p.statusPO === "DRAFT") kodeBarang = "PO_DRAFT";
  else if (p.statusPO === "DIBATALKAN") kodeBarang = "PO_DIBATALKAN";
  else if (semuaMasuk) kodeBarang = "LENGKAP";
  else if (adaDatang || adaMasukStok) kodeBarang = "DATANG_SEBAGIAN";
  else kodeBarang = "BELUM_DATANG";
  const rincianBarang = [];
  if (kodeBarang === "BELUM_DATANG") rincianBarang.push("Belum ada barang yang tiba. Uang muka (bila ada) tidak menambah stok.");
  if (baikBelumDisimpan) rincianBarang.push("Ada barang baik yang belum disimpan: tekan Simpan ke Stok di Penerimaan Gudang agar masuk stok.");
  if (belumDiperiksa) rincianBarang.push("Ada barang tiba yang belum diperiksa Gudang.");
  if (menungguPengganti) rincianBarang.push("Ada barang ditolak yang menunggu pengganti dari supplier.");
  if (adaDatang || adaMasukStok) rincianBarang.push("Simpan ke Stok hanya menambah stok — tidak menyetujui faktur.");

  // ── 2. Faktur ──
  const semua = p.fakturSemua ?? [];
  const terbuka = semua.filter((f) => ["DRAFT", "MENUNGGU_APPROVAL"].includes(f.status)).length;
  const disetujui = semua.filter((f) => ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"].includes(f.status)).length;
  const ditolak = semua.filter((f) => ["DITOLAK", "DIBATALKAN"].includes(f.status)).length;
  let kodeFaktur;
  if (semua.length - ditolak === 0) kodeFaktur = "BELUM_ADA";
  else if (disetujui === 0) kodeFaktur = "MENUNGGU_PERSETUJUAN";
  else if (terbuka > 0 || sudahDitagih + NOL < nilaiPO) kodeFaktur = "DISETUJUI_SEBAGIAN";
  else kodeFaktur = "DISETUJUI_LENGKAP";
  const rincianFaktur = [];
  if (kodeFaktur === "BELUM_ADA") rincianFaktur.push("Faktur dicatat Finance lewat Catat Faktur setelah faktur supplier diterima — tidak otomatis dari penerimaan barang.");
  if (terbuka > 0) rincianFaktur.push(`${terbuka} faktur belum disetujui. Setujui oleh Finance (aksi terpisah dari Simpan ke Stok) agar menjadi utang.`);
  if (ditolak > 0) rincianFaktur.push(`${ditolak} faktur ditolak/dibatalkan (tidak dihitung).`);

  // ── 3. Utang ──
  let kodeUtang;
  if (sudahDitagih <= NOL) kodeUtang = "BELUM_ADA";
  else if (sisaUtang > NOL) kodeUtang = "ADA_UTANG";
  else kodeUtang = "LUNAS";
  const rincianUtang = [];
  if (kodeUtang === "BELUM_ADA") rincianUtang.push("Utang baru ada setelah faktur disetujui. Pembayaran di muka dan sisa komitmen PO bukan utang.");
  if (tepat(p.uangMukaBelumDiterapkan) > NOL) rincianUtang.push("Ada uang muka yang belum diterapkan: terapkan ke faktur agar sisa utang berkurang.");

  // ── 4. Pembayaran ──
  let kodePembayaran;
  if (sudahDibayar <= NOL) kodePembayaran = "BELUM_ADA";
  else if (nilaiPO > NOL && sudahDibayar > nilaiPO + NOL) kodePembayaran = "KELEBIHAN";
  else if (kodeUtang === "LUNAS" && tepat(p.uangMukaBelumDiterapkan) <= NOL) kodePembayaran = "LUNAS";
  else if (dibayarAtasFaktur <= NOL) kodePembayaran = "UANG_MUKA_SAJA";
  else kodePembayaran = "DIBAYAR_SEBAGIAN";
  const rincianPembayaran = [];
  if (kodePembayaran === "UANG_MUKA_SAJA") rincianPembayaran.push("Baru uang muka (aset). Tidak menambah stok, tidak membuat utang faktur.");
  if (kodePembayaran === "KELEBIHAN") rincianPembayaran.push("Total kas keluar melebihi nilai PO — kelebihan menjadi Kredit Supplier, tanpa refund kas otomatis.");

  return {
    barang: { kode: kodeBarang, label: STATUS_BARANG[kodeBarang], rincian: rincianBarang },
    faktur: { kode: kodeFaktur, label: STATUS_FAKTUR[kodeFaktur], rincian: rincianFaktur, jumlah: { semua: semua.length, disetujui, menunggu: terbuka, ditolakAtauBatal: ditolak } },
    utang: { kode: kodeUtang, label: STATUS_UTANG[kodeUtang], rincian: rincianUtang },
    pembayaran: { kode: kodePembayaran, label: STATUS_PEMBAYARAN[kodePembayaran], rincian: rincianPembayaran },
    sudahDibayar,
  };
}

export const KALIMAT_SIMPAN_KE_STOK = "Simpan ke Stok hanya menambah stok dan tidak menyetujui faktur. Catat Faktur dan Setujui tetap aksi Finance yang terpisah.";
