// EXPORT EXCEL LAPORAN DIVISI (Fase 2) — dibangun dari payload yang SAMA dengan layar (bangunLaporan): angka, urutan, filter, tanggal WIB, dan tunduk pada izin pengguna.
// Tab: ringkasan | kategori | tren | dokumen | komitmen | anggaran | semua. Sheet "Definisi Angka" memuat definisi dari kontrak metrik Fase 1 (+ metrik Laporan Divisi).
// Sheet tanpa data otomatis memuat "Tidak ada data sesuai periode dan filter" (excel.js). Nominal numerik; kolom sensitif dikeluarkan untuk non-Finance (laporan.js sudah menyaring baris sensitif).
import { bangunLaporan, BASIS_LAPORAN, TIDAK_TERMASUK } from "./laporan.js";
import { bolehRinci, bolehSensitif } from "./akses.js";
import { LABEL_DIVISI } from "./divisi.js";
import { metrikUntukModulExport, metrik } from "../kontrakMetrik.js";
import { labelPeriode, susunLabelFilter } from "../export/excel.js";

export const TAB_EXPORT = Object.freeze(["ringkasan", "kategori", "tren", "dokumen", "komitmen", "anggaran", "semua"]);
const STATUS_ANGGARAN = (a) => (a == null ? "Belum ada anggaran" : "Ada anggaran");
const LABEL_TAHAP = { EKSPLISIT: "Divisi tertulis pada dokumen", RELASI: "Relasi dokumen sumber", KATEGORI: "Pemetaan kategori", SHARED: "Biaya bersama", TIDAK_TERKLASIFIKASI: "Tidak terklasifikasi", BUKAN_BIAYA: "Bukan biaya divisi" };
const LABEL_JENIS = { BELUM_DIBUKUKAN: "Menunggu persetujuan (belum beban, belum kas keluar)", DIBUKUKAN_BELUM_DIBAYAR: "Dibukukan, belum dibayar (sudah beban, belum kas keluar)" };
const LABEL_MODUL = { pengeluaran: "Pengeluaran", pembelian: "Pembelian", "supplier-utang": "Tagihan/Pembayaran Supplier", "uang-muka": "Uang Muka Operasional", "armada-biaya": "Biaya Kendaraan (Armada)", "ad-spend": "Belanja Iklan", "material-issue": "Material Issue", "stock-movement": "Pergerakan Stok", "stock-count": "Stock Opname", "goods-receipt": "Penerimaan Barang" };

const uang = (key, header, lebar) => ({ key, header, tipe: "uang", ...(lebar ? { lebar } : {}) });
const teks = (key, header, lebar) => ({ key, header, tipe: "teks", ...(lebar ? { lebar } : {}) });
const jml = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

function sheetRingkasan(lap) {
  const baris = lap.divisi.map((d) => ({
    divisi: d.label, statusAnggaran: STATUS_ANGGARAN(d.anggaran), anggaran: d.anggaran, aktual: d.aktual, kasKeluar: d.kasKeluar,
    komitmenBelum: d.komitmen.belumDibukukan, komitmenBayar: d.komitmen.dibukukanBelumDibayar, sisa: d.sisaAnggaran, persen: d.persenTerpakai, proyeksi: d.proyeksi.nilai, dokumen: d.nDokumen,
    peringatan: d.alert?.pesan ?? "",
  }));
  return {
    nama: "Ringkasan", judul: "Ringkasan Biaya per Divisi",
    kolom: [teks("divisi", "Divisi", 26), teks("statusAnggaran", "Status Anggaran", 20), uang("anggaran", "Anggaran (Rp)"), uang("aktual", "Aktual / Beban Diakui (Rp)"), uang("kasKeluar", "Kas Keluar (Rp)"),
      uang("komitmenBelum", "Komitmen Menunggu Persetujuan (Rp)"), uang("komitmenBayar", "Komitmen Dibukukan Belum Dibayar (Rp)"), uang("sisa", "Sisa Anggaran (Rp)"),
      { key: "persen", header: "Terpakai (%)", tipe: "angka" }, uang("proyeksi", "Proyeksi Akhir Bulan (Rp)"), { key: "dokumen", header: "Jumlah Dokumen", tipe: "angka" }, teks("peringatan", "Peringatan", 40)],
    baris,
    total: { label: "TOTAL", nilai: { aktual: jml(baris, "aktual"), kasKeluar: jml(baris, "kasKeluar"), komitmenBelum: jml(baris, "komitmenBelum"), komitmenBayar: jml(baris, "komitmenBayar"), dokumen: jml(baris, "dokumen") } },
    catatan: ["Aktual (Beban Diakui), Kas Keluar, dan Komitmen adalah tiga konsep terpisah — satu transaksi sumber hanya berkontribusi sekali pada tiap konsep.", "Anggaran kosong = 'Belum ada anggaran' (bukan Rp0)."],
  };
}

function sheetKelompok(lap) {
  const baris = lap.divisi.flatMap((d) => [
    ...d.kelompok.map((g) => ({ divisi: d.label, kelompok: g.label, aktual: g.aktual, kasKeluar: g.kasKeluar, dokumen: g.nDokumen })),
    ...(d.komponenLain.aktual !== 0 || d.komponenLain.kasKeluar !== 0 || d.komponenLain.daftar.length ? [{ divisi: d.label, kelompok: `Komponen lain${d.komponenLain.daftar.length ? ` (${d.komponenLain.daftar.join(", ")})` : ""}`, aktual: d.komponenLain.aktual, kasKeluar: d.komponenLain.kasKeluar, dokumen: 0 }] : []),
  ]);
  return {
    nama: "Kelompok", judul: "Rincian Kelompok Biaya per Divisi",
    kolom: [teks("divisi", "Divisi", 26), teks("kelompok", "Kelompok", 48), uang("aktual", "Aktual (Rp)"), uang("kasKeluar", "Kas Keluar (Rp)"), { key: "dokumen", header: "Jumlah Dokumen", tipe: "angka" }],
    baris, total: { label: "TOTAL", nilai: { aktual: jml(baris, "aktual"), kasKeluar: jml(baris, "kasKeluar"), dokumen: jml(baris, "dokumen") } },
    catatan: ["Kelompok bernilai nol tidak ditampilkan satu per satu; namanya tercantum pada 'Komponen lain'."],
  };
}

function sheetKategori(lap) {
  const baris = lap.divisi.flatMap((d) => d.perKategori.map((k) => ({ divisi: d.label, kategori: k.nama, kode: k.kode, aktual: k.aktual, kasKeluar: k.kasKeluar, dokumen: k.nDokumen, anggaran: k.anggaran })));
  return {
    nama: "Kategori", judul: "Rincian per Kategori",
    kolom: [teks("divisi", "Divisi", 26), teks("kategori", "Kategori", 40), teks("kode", "Kode", 22), uang("aktual", "Aktual (Rp)"), uang("kasKeluar", "Kas Keluar (Rp)"), { key: "dokumen", header: "Jumlah Dokumen", tipe: "angka" }, uang("anggaran", "Anggaran Kategori (Rp)")],
    baris, total: { label: "TOTAL", nilai: { aktual: jml(baris, "aktual"), kasKeluar: jml(baris, "kasKeluar"), dokumen: jml(baris, "dokumen") } },
    catatan: ["Rincian kategori hanya untuk Finance dan leader divisi."],
  };
}

function sheetTren(lap) {
  const baris = lap.divisi.flatMap((d) => d.tren.map((t) => ({ divisi: d.label, bulan: t.bulan, aktual: t.aktual, kasKeluar: t.kasKeluar, anggaran: t.anggaran })));
  return {
    nama: "Tren Bulanan", judul: "Tren Bulanan",
    kolom: [teks("divisi", "Divisi", 26), teks("bulan", "Bulan (WIB)", 14), uang("aktual", "Aktual (Rp)"), uang("kasKeluar", "Kas Keluar (Rp)"), uang("anggaran", "Anggaran (Rp)")],
    baris, total: { label: "TOTAL", nilai: { aktual: jml(baris, "aktual"), kasKeluar: jml(baris, "kasKeluar") } },
  };
}

function sheetAnggaran(lap) {
  const baris = lap.divisi.map((d) => ({
    divisi: d.label, status: STATUS_ANGGARAN(d.anggaran), anggaran: d.anggaran, aktual: d.aktual, sisa: d.sisaAnggaran, persen: d.persenTerpakai,
    proyeksi: d.proyeksi.nilai, alasanProyeksi: d.proyeksi.nilai == null ? d.proyeksi.alasan : "", alert: d.alert?.pesan ?? "",
  }));
  return {
    nama: "Anggaran vs Aktual", judul: "Anggaran vs Aktual",
    kolom: [teks("divisi", "Divisi", 26), teks("status", "Status Anggaran", 20), uang("anggaran", "Anggaran (Rp)"), uang("aktual", "Aktual (Rp)"), uang("sisa", "Sisa Anggaran (Rp)"), { key: "persen", header: "Terpakai (%)", tipe: "angka" },
      uang("proyeksi", "Proyeksi Akhir Bulan (Rp)"), teks("alasanProyeksi", "Keterangan Proyeksi", 44), teks("alert", "Peringatan", 44)],
    baris,
    total: { label: "TOTAL (divisi beranggaran)", nilai: { anggaran: jml(baris.filter((b) => b.anggaran != null), "anggaran"), aktual: jml(baris.filter((b) => b.anggaran != null), "aktual"), sisa: jml(baris.filter((b) => b.sisa != null), "sisa") } },
    catatan: ["Merah hanya untuk over-budget. Divisi tanpa versi anggaran DISETUJUI ditulis 'Belum ada anggaran', bukan Rp0."],
  };
}

function sheetDokumen(lap, akses, semua) {
  const baris = (lap.baris ?? []).filter((b) => bolehRinci(akses, b.scope)).map((b) => ({
    tanggal: b.tanggal, divisi: LABEL_DIVISI[b.scope] ?? b.scope, jurnal: b.nomor, sumber: LABEL_MODUL[b.dokumen?.modul] ?? b.sumber, dokumen: b.dokumen?.nomor ?? "", kategori: b.kategori?.nama ?? "",
    deskripsi: b.deskripsi, aktual: b.aktual, kasKeluar: b.kasKeluar, atribusi: LABEL_TAHAP[b.tahap] ?? b.tahap, aturan: b.aturan, konflik: (b.konflik || []).map((s) => LABEL_DIVISI[s] ?? s).join(", "),
  }));
  baris.sort((a, b) => (a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0));
  return {
    nama: "Rincian Transaksi", judul: "Rincian Transaksi (dokumen sumber)",
    kolom: [{ key: "tanggal", header: "Tanggal Buku", tipe: "tanggal" }, teks("divisi", "Divisi", 22), teks("jurnal", "No. Jurnal", 18), teks("sumber", "Jenis Dokumen", 24), teks("dokumen", "No. Dokumen", 20), teks("kategori", "Kategori", 28), teks("deskripsi", "Deskripsi", 44),
      uang("aktual", "Aktual (Rp)"), uang("kasKeluar", "Kas Keluar (Rp)"), teks("atribusi", "Dasar Atribusi", 26), teks("aturan", "Aturan Atribusi", 56), ...(semua ? [teks("konflik", "Petunjuk Divisi Bertentangan", 28)] : [])],
    baris, total: { label: "TOTAL", nilai: { aktual: jml(baris, "aktual"), kasKeluar: jml(baris, "kasKeluar") } },
    catatan: ["Hanya divisi yang rincinya boleh Anda lihat (Finance dan leader divisi). Baris sensitif (gaji, kasbon, investor) tidak disertakan untuk non-Finance."],
  };
}

function sheetKomitmen(lap, akses) {
  const baris = (lap.komitmenRinci ?? []).filter((k) => k.atribusi.bagian.some((b) => bolehRinci(akses, b.scope))).flatMap((k) => k.atribusi.bagian.filter((b) => bolehRinci(akses, b.scope)).map((b) => ({
    tanggal: k.tanggal, divisi: LABEL_DIVISI[b.scope] ?? b.scope, jenisDokumen: LABEL_MODUL[k.modul] ?? k.modul, dokumen: k.nomor ?? "", kategori: k.atribusi.kategori?.nama ?? "", status: k.status, jumlah: k.jumlah * b.bobot, jenis: LABEL_JENIS[k.jenis] ?? k.jenis,
  })));
  baris.sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1));
  return {
    nama: "Komitmen", judul: "Komitmen Belum Dibayar",
    kolom: [{ key: "tanggal", header: "Tanggal Dokumen", tipe: "tanggal" }, teks("divisi", "Divisi", 22), teks("jenisDokumen", "Jenis Dokumen", 26), teks("dokumen", "No. Dokumen", 20), teks("kategori", "Kategori", 28), teks("status", "Status Dokumen", 20), uang("jumlah", "Jumlah (Rp)"), teks("jenis", "Jenis Komitmen", 56)],
    baris, total: { label: "TOTAL", nilai: { jumlah: jml(baris, "jumlah") } },
    catatan: ["Komitmen bukan beban dan bukan kas keluar sampai dibukukan/dibayar. Draf tidak dihitung."],
  };
}

export function sheetDefinisiLaporan() {
  const kunci = new Set([...metrikUntukModulExport("laporan-divisi").map((m) => m.kunci), "beban_diakui", "uang_keluar_kas", "komitmen_belum_dibayar", "utang_supplier", "persediaan_nilai", "pengeluaran_aktif", "pembelian_aktif"]);
  const nama = (k) => metrik(k)?.nama ?? k;
  const baris = [...kunci].map((k) => metrik(k)).filter(Boolean).map((m) => ({
    nama: m.nama, definisi: m.definisi, rumus: m.rumus, sumber: m.sumber, status: m.status, basis: m.basisLabel ?? m.basis, termasuk: m.termasuk.join("; "), tidak: m.tidakTermasuk.join("; "), pasangan: m.pasangan.map(nama).join("; "),
  }));
  return {
    nama: "Definisi Angka", judul: "Definisi Angka",
    kolom: [teks("nama", "Angka", 30), teks("definisi", "Definisi", 60), teks("rumus", "Rumus", 44), teks("sumber", "Sumber data", 30), teks("status", "Status yang dihitung", 26), teks("basis", "Basis tanggal", 24), teks("termasuk", "Termasuk", 44), teks("tidak", "Tidak termasuk", 44), teks("pasangan", "Dibandingkan dengan", 36)],
    baris,
    catatan: [`Basis tanggal: ${BASIS_LAPORAN.aktual} · ${BASIS_LAPORAN.zonaWaktu}.`, `Status jurnal: ${BASIS_LAPORAN.status}.`, ...TIDAK_TERMASUK.map((t) => `Tidak termasuk: ${t}`)],
  };
}

/** Data siap pakai untuk buatXlsx. */
export async function dataExportLaporan(db, { akses, from, to, divisi = [], filter = {}, tab = "semua", sekarang = new Date() }) {
  const lap = await bangunLaporan(db, { from, to, scopeDiminta: divisi, filter, akses, sekarang, denganBaris: true });
  const semua = bolehSensitif(akses);
  const pilih = tab === "semua" ? TAB_EXPORT.filter((t) => t !== "semua") : [tab];
  const peta = { ringkasan: () => [sheetRingkasan(lap), sheetKelompok(lap)], kategori: () => [sheetKategori(lap)], tren: () => [sheetTren(lap)], dokumen: () => [sheetDokumen(lap, akses, semua)], komitmen: () => [sheetKomitmen(lap, akses)], anggaran: () => [sheetAnggaran(lap)] };
  const sheets = [...pilih.flatMap((t) => peta[t]()), sheetDefinisiLaporan()];
  const labelDiv = lap.scopeTampil.map((s) => LABEL_DIVISI[s]).join(", ");
  return {
    nama: "Laporan Divisi", periodeLabel: labelPeriode({ from, to }),
    filterLabel: susunLabelFilter([["Divisi", labelDiv], ["Kategori", filter.kategori], ["Status dokumen", filter.status], ["Proyek", filter.proyek], ["Tab", tab === "semua" ? "Semua" : tab]]),
    basisTanggalLabel: `${BASIS_LAPORAN.aktual} (Aktual, Kas Keluar) · ${BASIS_LAPORAN.komitmen} (Komitmen) · ${BASIS_LAPORAN.anggaran}`,
    sheets, laporan: lap,
  };
}
