// Logika murni layar Tagihan supplier (Supplier & Utang): kelompok status, sisa utang yang jujur, asal dokumen, pencocokan penerimaan↔supplier, KPI.
// Tanpa React/DOM; impor relatif supaya bisa diuji langsung di Node. Semua angka uang berasal dari server (b.amount, b.terbayar, b.sisa, aging.total);
// di sini hanya memilih apa yang ditampilkan dan bagaimana mengelompokkannya.
import { hariIniWIB } from "../po/poKontrol.js";
import { nomorSupplierBermakna } from "../po/poTampilan.js";

/** Status yang sudah menjadi UTANG resmi di buku besar (jurnal sudah ada). */
export const STATUS_UTANG = Object.freeze(["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"]);
/** Status utang yang masih punya sisa untuk dibayar. */
export const STATUS_TERBUKA = Object.freeze(["DISETUJUI", "DIBAYAR_SEBAGIAN"]);
/** Belum menjadi utang: menunggu keputusan (belum ada jurnal). */
export const STATUS_BELUM_UTANG = Object.freeze(["DRAFT", "MENUNGGU_APPROVAL"]);
/** Dokumen nonaktif: tidak pernah/tidak lagi menjadi utang. */
export const STATUS_NONAKTIF = Object.freeze(["DITOLAK", "DIBATALKAN"]);

export const BATAS_DAFTAR_TAGIHAN = 300; // take server pada GET /finance/bills (tanpa penanda terpotong)
export const BATAS_PENERIMAAN_BELUM_DITAGIH = 100; // take server pada GET /finance/bills/unbilled-receipts

export const KETERANGAN_TANPA_SISA = Object.freeze({
  DRAFT: "Draf: belum menjadi utang. Nilai dokumen ada di rincian.",
  MENUNGGU_APPROVAL: "Menunggu persetujuan: belum menjadi utang sampai disetujui.",
  DITOLAK: "Ditolak: tidak menjadi utang.",
  DIBATALKAN: "Dibatalkan: jurnal utangnya sudah dibalik; tidak menjadi utang.",
});

/** Kolom "Sisa utang": angka server hanya untuk dokumen yang memang utang; selainnya "—" dengan penjelasan (angka backend/ekspor tidak diubah). */
export function tampilSisa(b) {
  if (STATUS_UTANG.includes(b?.status)) return { tampil: true, nilai: Number(b.sisa) || 0, alasan: "" };
  return { tampil: false, nilai: null, alasan: KETERANGAN_TANPA_SISA[b?.status] || "Belum menjadi utang." };
}

const tanggal10 = (v) => (v ? String(v).slice(0, 10) : "");
/** "lewat" hanya bila tagihan masih punya sisa utang dan jatuh tempo sebelum hari ini (WIB). Kunci tanggal murni "YYYY-MM-DD": tidak ada konversi zona. */
export function statusTempo(b, hariIni = hariIniWIB()) {
  const due = tanggal10(b?.dueDate);
  if (!due) return "tanpa";
  return STATUS_TERBUKA.includes(b.status) && Number(b.sisa) > 0 && due < hariIni ? "lewat" : "belum";
}
export const LABEL_TEMPO = Object.freeze({ lewat: "Lewat jatuh tempo", belum: "Belum jatuh tempo", tanpa: "Tanpa tanggal" });

export const TAB_TAGIHAN = Object.freeze([
  { key: "proses", label: "Perlu diproses", ket: "Draf, menunggu persetujuan, dan tagihan disetujui yang sudah lewat jatuh tempo." },
  { key: "belum", label: "Belum lunas", ket: "Tagihan disetujui yang masih punya sisa utang." },
  { key: "lunas", label: "Lunas", ket: "Tagihan yang sudah lunas." },
  { key: "semua", label: "Semua", ket: "Semua tagihan yang dimuat, termasuk ditolak dan dibatalkan." },
]);

/** Apakah tagihan termasuk dalam tab. Pengelompokan sisi-klien dari status server; tidak ada status baru yang disimpan. */
export function masukTab(b, tab, hariIni = hariIniWIB()) {
  if (tab === "semua") return true;
  if (tab === "proses") return STATUS_BELUM_UTANG.includes(b.status) || statusTempo(b, hariIni) === "lewat";
  if (tab === "belum") return STATUS_TERBUKA.includes(b.status);
  if (tab === "lunas") return b.status === "LUNAS";
  return true;
}
export function hitungTab(bills, hariIni = hariIniWIB()) {
  return Object.fromEntries(TAB_TAGIHAN.map((t) => [t.key, (bills || []).filter((b) => masukTab(b, t.key, hariIni)).length]));
}

/** Nomor faktur supplier yang bermakna (placeholder "---" dianggap belum diisi) — aturan sama dengan Rincian PO. */
export const nomorFakturTampil = (b) => nomorSupplierBermakna(b?.supplierRef);

/** Dokumen asal tagihan: PO (faktur atas PO), penerimaan barang (tagihan lama/manual yang menaut satu penerimaan), atau tanpa PO. */
export function asalTagihan(b) {
  if (b?.purchaseOrder?.poNumber || b?.purchaseOrderId) return { jenis: "PO", nomor: b.purchaseOrder?.poNumber || "PO", id: b.purchaseOrder?.id || b.purchaseOrderId, label: "Dari PO" };
  if (b?.goodsReceipt?.receiptNumber) return { jenis: "PENERIMAAN", nomor: b.goodsReceipt.receiptNumber, id: b.goodsReceipt.id, label: "Dari penerimaan" };
  return { jenis: "TANPA_PO", nomor: "", id: null, label: "Tanpa PO", jenisTagihan: b?.jenisTagihan?.label || "" };
}

/** Teks pencarian satu baris (nomor faktur supplier, BILL, supplier, asal, nominal polos & berformat). */
export function teksCari(b, angka) {
  const asal = asalTagihan(b);
  return [b.billNumber, b.supplierRef, b.supplier?.name, b.description, asal.nomor, asal.label, b.jenisTagihan?.label, b.billDate, b.dueDate, angka(b.amount), angka(b.terbayar), angka(b.sisa), b.status];
}

// ── KPI (angka server; kami hanya memilih populasi yang ditampilkan) ──────────
/** Lewat jatuh tempo mengikuti populasi aging server (baris dengan hariLewat > 0), sama seperti sebelumnya. */
export function ringkasKpi({ aging, bills, uangMuka, unbilled }) {
  const lewat = (aging?.baris || []).filter((x) => x.hariLewat > 0);
  const menunggu = (bills || []).filter((b) => b.status === "MENUNGGU_APPROVAL");
  const terpotong = (bills || []).length >= BATAS_DAFTAR_TAGIHAN;
  const penerimaan = (unbilled || []).length;
  return {
    sisaUtang: { nilai: aging?.total ?? 0, jumlah: aging?.baris?.length ?? 0 },
    lewatTempo: { nilai: lewat.reduce((s, x) => s + (Number(x.sisa) || 0), 0), jumlah: lewat.length },
    menunggu: { jumlah: menunggu.length, terpotong },
    uangMuka: { nilai: uangMuka?.kartu?.uangMukaBelumDiterapkan ?? 0, supplier: (uangMuka?.suppliers || []).filter((s) => s.uangMukaBelumDiterapkan > 0).length },
    penerimaan: { jumlah: penerimaan, terpotong: penerimaan >= BATAS_PENERIMAAN_BELUM_DITAGIH },
  };
}

// ── Pencocokan penerimaan ↔ supplier ─────────────────────────────────────────
/** Daftar penerimaan dari server hanya membawa NAMA supplier bebas (teks gudang), tanpa id supplier. Normalisasi untuk dibandingkan dengan nama master + alias. */
export const normalisasiNama = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** "cocok": nama penerimaan sama dengan nama/alias master; "beda": terisi tetapi tidak sama; "kosong": penerimaan tanpa nama supplier. */
export function cocokSupplierPenerimaan(namaPenerimaan, supplier) {
  const n = normalisasiNama(namaPenerimaan);
  if (!n) return "kosong";
  const kandidat = [supplier?.name, ...(supplier?.aliases || [])].map(normalisasiNama).filter(Boolean);
  return kandidat.includes(n) ? "cocok" : "beda";
}

/**
 * Kelompokkan penerimaan belum ditagih untuk supplier terpilih. Tidak ada pemasangan otomatis: "cocok" hanya dipromosikan sebagai saran;
 * "beda"/"kosong" tetap bisa dipilih tetapi mewajibkan pernyataan eksplisit (lihat perluKonfirmasiPenerimaan).
 */
export function kelompokPenerimaan(receipts, supplier) {
  const cocok = [], beda = [], kosong = [];
  for (const r of receipts || []) {
    const k = cocokSupplierPenerimaan(r.supplier, supplier);
    (k === "cocok" ? cocok : k === "beda" ? beda : kosong).push(r);
  }
  return { cocok, beda, kosong, terpotong: (receipts || []).length >= BATAS_PENERIMAAN_BELUM_DITAGIH };
}
export const perluKonfirmasiPenerimaan = (receipt, supplier) => !!receipt && cocokSupplierPenerimaan(receipt.supplier, supplier) !== "cocok";

/** Penjelasan keterbatasan kelompok bagi pengguna. */
export function ketPenerimaan(kelompok, supplier) {
  if (!supplier) return "Pilih supplier dulu.";
  if (kelompok.cocok.length === 0 && kelompok.beda.length === 0 && kelompok.kosong.length === 0) return "Tidak ada penerimaan yang belum ditagih.";
  return "Daftar penerimaan hanya membawa nama supplier dari dokumen Gudang, bukan identitas supplier. Yang namanya sama dengan master (atau aliasnya) ditandai cocok; selainnya harus Anda pilih dan konfirmasi sendiri.";
}

// ── Jalur "Dari PO" ──────────────────────────────────────────────────────────
export const STATUS_PO_BISA_DIFAKTURKAN = Object.freeze(["DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI"]);
export const FILTER_STATUS_PO = STATUS_PO_BISA_DIFAKTURKAN.join(",");

/** Ringkasan satu PO untuk pemilih: hanya angka yang memang ada di daftar PO (progres penerimaan); "belum ditagih" per baris baru tersedia setelah PO dipilih (penagihan). */
export function ringkasPOPemilih(po) {
  const t = po?.progres?.total;
  const datang = Number(t?.datang) || 0, masuk = Number(t?.masukStok) || 0;
  return {
    adaBarang: datang > 0,
    teks: po?.progres?.dijumlah === false ? "Satuan berbeda: lihat rincian per item." : (po?.progres?.teks || "Belum ada penerimaan"),
    peringatan: datang > 0 || masuk > 0 ? "" : "Belum ada barang diterima: faktur akan tertahan sampai ada barang baik yang bisa ditagih.",
  };
}

// ── Kunci idempoten / respons lambat ─────────────────────────────────────────
/** Penjaga respons usang: panggil mulai() sebelum request; sahkan(id) sebelum memakai hasilnya. */
export function penjagaPermintaan() {
  let n = 0;
  return { mulai: () => ++n, sahkan: (id) => id === n, batalkan: () => { n += 1; } };
}

// ── Uang yang jujur terhadap sen ─────────────────────────────────────────────
// Nominal server berpresisi 2 desimal (Decimal(18,2)); qty × harga faktur bisa menghasilkan sen. Tampilan rupiah bulat menyembunyikan sen itu
// ("Rp0" padahal sisa Rp0,37) — di area Tagihan supplier sen DITAMPILKAN bila ada, dan tidak ditampilkan bila bulat. formatUang bersama tidak diubah.
const SEN_MIN = 0.005;
export function adaSen(n) { const v = Number(n) || 0; return Math.abs(v - Math.round(v)) >= SEN_MIN; }
export function formatUangTepat(n, { kurung = true } = {}) {
  const v = Number(n) || 0;
  const sen = adaSen(v);
  const teks = Math.abs(v).toLocaleString("id-ID", { minimumFractionDigits: sen ? 2 : 0, maximumFractionDigits: sen ? 2 : 0 });
  if (v >= 0 || Math.abs(v) < SEN_MIN) return `Rp${teks}`;
  return kurung ? `(Rp${teks})` : `-Rp${teks}`;
}
/** Sisa utang positif tetapi kurang dari Rp1: hampir pasti selisih sen dari pembulatan nominal, bukan utang nyata berukuran rupiah. */
export const sisaKurangSatuRupiah = (b) => STATUS_TERBUKA.includes(b?.status) && Number(b.sisa) > 0 && Number(b.sisa) < 1;
export const KET_SISA_SEN = "Sisa kurang dari Rp1: selisih sen dari nominal faktur yang tidak bulat. Tagihan baru lunas bila dibayar tepat sisa ini (Catat Pembayaran → Lunasi).";

// ── Matriks kemampuan "Ubah tagihan" ─────────────────────────────────────────
// Mengikuti kontrak server yang SUDAH ADA (tidak ada jalur transaksi kedua):
//   belum disetujui, bukan faktur PO : PATCH /finance/bills/:id        (finance:post, pembuat atau admin, alasan wajib; supplier/jenis/penerimaan/nominal/tanggal/termin/keterangan)
//   belum disetujui, faktur atas PO  : PATCH /finance/purchase-orders/faktur/:billId (editor faktur PO: nomor, tanggal, termin, baris/jumlah/harga, penerimaan)
//   sudah disetujui, informasi       : POST  /finance/bills/:id/info   (finance:post; nomor faktur supplier, jatuh tempo; tanpa jurnal; alasan wajib)
//   sudah disetujui, koreksi         : POST  /finance/bills/:id/koreksi (finance:admin; supplier/tanggal/nominal/keterangan/kategori; jurnal dibalik + versi pengganti;
//                                      diblokir server bila faktur PO, ada pembayaran aktif, sudah direkonsiliasi, atau periode tutup — alasan datang dari `b.koreksi`)
//   ditolak/dibatalkan               : tidak ada edit; riwayat saja
export const ALASAN_TANPA_IZIN_POST = "Akun Anda tidak punya izin mengubah tagihan (Finance/Akuntan).";
export const ALASAN_TANPA_IZIN_ADMIN = "Koreksi transaksi hanya untuk admin keuangan.";

export function kemampuanUbah(b, { admin = false, bolehPost = true } = {}) {
  const s = b?.status;
  const po = !!(b?.purchaseOrderId);
  if (STATUS_NONAKTIF.includes(s)) {
    return {
      mode: "NONAKTIF", bagian: [],
      pesan: s === "DIBATALKAN" && b.replacedBy?.billNumber
        ? `Tagihan ini sudah dikoreksi dan digantikan ${b.replacedBy.billNumber}. Ubah versi terbarunya; dokumen ini tidak bisa diaktifkan kembali.`
        : s === "DITOLAK" ? "Tagihan yang ditolak tidak bisa diubah atau diaktifkan kembali. Catat tagihan baru bila perlu." : "Tagihan yang dibatalkan tidak bisa diubah atau diaktifkan kembali. Catat tagihan baru bila perlu.",
      jalan: b.replacedBy?.billNumber ? [{ kunci: "versi-baru", label: `Buka ${b.replacedBy.billNumber}`, nomor: b.replacedBy.billNumber }] : [{ kunci: "riwayat", label: "Lihat riwayat" }],
    };
  }
  if (STATUS_BELUM_UTANG.includes(s)) {
    return {
      mode: "BELUM_DISETUJUI",
      pesan: "Belum disetujui, jadi belum ada jurnal: isinya boleh diubah. Setiap perubahan butuh alasan dan tercatat di riwayat.",
      bagian: [po
        ? { kunci: "faktur-po", judul: "Ubah faktur atas PO", ket: "Nomor dan tanggal faktur, termin, serta jumlah dan harga per baris dicocokkan ulang dengan PO.", bidang: ["Nomor faktur", "Tanggal faktur", "Termin / jatuh tempo", "Jumlah dan harga per baris", "Penerimaan yang ditagih"], tersedia: bolehPost, alasan: bolehPost ? null : ALASAN_TANPA_IZIN_POST, aksi: "faktur-po", label: "Ubah faktur PO" }
        : { kunci: "isi", judul: "Ubah isi tagihan", ket: "Semua isian boleh diubah sebelum disetujui; server memeriksa ulang jenis dan aturan persediaan.", bidang: ["Supplier", "Nomor dan tanggal faktur", "Keterangan", "Nominal", "Termin / jatuh tempo", "Jenis tagihan dan dokumen asal"], tersedia: bolehPost, alasan: bolehPost ? null : ALASAN_TANPA_IZIN_POST, aksi: "isi", label: "Ubah tagihan" }],
      terkunci: po ? [{ judul: "Supplier dan PO asal", alasan: "Faktur ini melekat ke PO. Untuk mengganti supplier atau PO, tolak faktur ini lalu catat ulang lewat Catat tagihan › Dari PO." }] : [],
      bayar: false,
    };
  }
  // sudah disetujui / dibayar sebagian / lunas
  const bayar = Number(b?.terbayar) > 0 || ["DIBAYAR_SEBAGIAN", "LUNAS"].includes(s);
  const k = b?.koreksi;
  let koreksiAlasan = null; let jalan = [];
  if (!admin) koreksiAlasan = ALASAN_TANPA_IZIN_ADMIN;
  else if (k && k.aktif === false) {
    koreksiAlasan = [k.alasan, k.arah].filter(Boolean).join(" ") || "Tidak bisa dikoreksi saat ini.";
    if (k.kode === "ADA_PEMBAYARAN") jalan = [{ kunci: "pembayaran", label: "Lihat pembayaran terkait" }];
    else if (k.kode === "FAKTUR_ATAS_PO") jalan = [{ kunci: "batalkan", label: "Batalkan & catat ulang" }];
  } else if (admin && bayar && !k) { koreksiAlasan = "Memiliki pembayaran aktif — batalkan pembayarannya dulu di Pembayaran, lalu koreksi."; jalan = [{ kunci: "pembayaran", label: "Lihat pembayaran terkait" }]; }
  return {
    mode: "DISETUJUI",
    pesan: "Sudah masuk buku besar. Perubahan dibedakan: informasi dokumen (tanpa jurnal) dan koreksi transaksi (jurnal dibalik, versi pengganti dibuat).",
    bagian: [
      { kunci: "info", judul: "Informasi dokumen", ket: "Perubahan administratif tanpa jurnal; saldo, stok, dan pembayaran tidak berubah.", bidang: ["Nomor faktur supplier", "Jatuh tempo"], tersedia: bolehPost, alasan: bolehPost ? null : ALASAN_TANPA_IZIN_POST, aksi: "info", label: "Ubah informasi" },
      { kunci: "koreksi", judul: "Koreksi transaksi", ket: "Mengubah nilai atau pembukuan: jurnal lama dibalik, tagihan pengganti dibuat, riwayat tetap tersimpan.", bidang: po ? ["Tidak tersedia untuk faktur atas PO"] : ["Nominal", "Tanggal tagihan", "Supplier", "Keterangan", "Kategori"], tersedia: !koreksiAlasan, alasan: koreksiAlasan, jalan, aksi: "koreksi", label: "Koreksi tagihan" },
    ],
    terkunci: [{ judul: "Jenis tagihan dan dokumen asal", alasan: "Menentukan akun jurnal dan klaim penerimaan, jadi tidak bisa diubah di tagihan yang sudah disetujui. Batalkan lalu catat ulang bila memang salah." }],
    bayar,
  };
}
