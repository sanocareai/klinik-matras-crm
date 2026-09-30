// EXPORT EXCEL — PENGELUARAN & REIMBURSEMENT. Sumber data = services/finance/expenseRead.js (query yang SAMA dengan layar).
// Layar memfilter di SERVER: periode (from/to), status, q, categoryId, division, mode, cashAccountId, bukti — export menjalankan
// fungsi baca yang sama dengan parameter yang sama. Bila klien mengirim `ids`, baris itu dimuat ulang (urutan mengikuti `ids`).
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { ambilDaftarPengeluaran, ambilPengeluaranByIds, STATUS_TIDAK_DIHITUNG } from "../expenseRead.js";
import { susunLabelFilter, labelPeriode, ExportError } from "./excel.js";
import { labelStatus, labelCaraBayar, labelMetodeTransfer } from "./label.js";

export const LABEL_DIVISI_EXPORT = Object.freeze({
  SALES: "Sales", PRODUKSI: "Produksi", GUDANG: "Gudang", DELIVERY: "Delivery", DIGITAL_TECHNOLOGY: "D&T (Digital & Technology)",
  OFFICE: "Office", MANAGEMENT: "Management", UMUM: "Umum", MARKETING: "Marketing", HR_GA: "HR & GA",
});
export const labelDivisi = (d) => (d == null ? "" : LABEL_DIVISI_EXPORT[d] || String(d));

// Sama dengan teksMode() di layar; UANG_MUKA hanya ada di Pengeluaran (dipertanggungjawabkan dari uang muka operasional).
export const LABEL_MODE_EXPORT = Object.freeze({ LANGSUNG: "Bayar langsung", REIMBURSEMENT: "Reimbursement", UTANG: "Utang", UANG_MUKA: "Uang muka operasional" });
export const labelMode = (m) => (m == null ? "" : LABEL_MODE_EXPORT[m] || String(m));

export const LABEL_BUKTI_EXPORT = Object.freeze({ ada: "Ada nota", tanpa: "Tanpa nota", terverifikasi: "Terverifikasi", belum: "Belum diverifikasi" });

// Sama dengan teksSumberDana() di layar.
export function sumberDana(d) {
  if (d.cashAccount) return d.cashAccount.name;
  const belumDibayar = ["DRAFT", "MENUNGGU_APPROVAL", "DISETUJUI"].includes(d.status) && d.mode !== "LANGSUNG";
  return belumDibayar ? "belum dibayar" : "—";
}

export const STATUS_URUT = ["DRAFT", "MENUNGGU_APPROVAL", "DISETUJUI", "DIBAYAR", "DITOLAK", "DIBATALKAN"];
export const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

/** Nama pihak yang menerima uang: supplier terdaftar, atau nama bebas (toko/tukang). */
export const pihakPenerima = (d) => d.supplier?.name || d.payeeName || "";

export function statusBukti(d) {
  if (!d.receiptUrl) return "Tanpa bukti";
  return d.receiptVerifiedAt ? "Terverifikasi" : "Belum diverifikasi";
}

/** Kolom & baris yang sama untuk Pengeluaran dan Pembelian (beda hanya nomor, akun, dan kolom khusus). */
export function barisDokumen(d, nomor) {
  return {
    nomor: d[nomor], tanggal: d.date, keterangan: d.description, kategori: d.category?.name || "",
    akun: d.category?.account ? `${d.category.account.code} ${d.category.account.name}` : "",
    divisi: labelDivisi(d.division), caraBayar: labelMode(d.mode), sumberDana: sumberDana(d),
    penalang: d.reimburseTo?.name || "", penerima: pihakPenerima(d),
    nominal: d.amount, metodeBayar: labelCaraBayar(d.paymentMethod), metodeTransfer: labelMetodeTransfer(d.transferFeeType),
    biayaAdmin: d.biayaAdmin, totalKeluar: d.totalKeluarRekening,
    status: labelStatus(d.status), bukti: d.receiptUrl ? "Ada" : "Tidak ada", verifikasi: statusBukti(d),
    diajukanOleh: d.createdBy?.name || "", diajukanPada: d.createdAt,
    disetujuiOleh: d.approvedBy?.name || "", disetujuiPada: d.approvedAt,
    dibayarOleh: d.paidBy?.name || "", dibayarPada: d.paidAt,
    alasanTolak: d.status === "DITOLAK" ? (d.rejectReason || "") : "", catatan: d.notes || "", tautanBukti: d.receiptUrl || "",
  };
}

/** Definisi kolom bersama; `kolomKhusus` disisipkan sebelum kolom Status (mis. uang muka). */
export function kolomDokumen({ noHeader, kategoriHeader, sisip = [] }) {
  return [
    { key: "nomor", header: noHeader, tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" },
    { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 36 }, { key: "kategori", header: kategoriHeader, tipe: "teks", lebar: 24 },
    { key: "akun", header: "Akun Buku Besar", tipe: "teks", lebar: 28 }, { key: "divisi", header: "Divisi", tipe: "teks", lebar: 18 },
    { key: "caraBayar", header: "Cara Bayar", tipe: "teks", lebar: 18 }, { key: "sumberDana", header: "Sumber Dana", tipe: "teks", lebar: 20 },
    { key: "penalang", header: "Ditalangi Oleh", tipe: "teks", lebar: 18 }, { key: "penerima", header: noHeader === "No. Pembelian" ? "Dibeli Dari" : "Dibayarkan Kepada", tipe: "teks", lebar: 22 },
    { key: "nominal", header: "Nominal (Rp)", tipe: "uang" },
    { key: "metodeBayar", header: "Metode Pembayaran", tipe: "teks", lebar: 16 }, { key: "metodeTransfer", header: "Metode Transfer", tipe: "teks", lebar: 16 },
    { key: "biayaAdmin", header: "Biaya Admin Transfer (Rp)", tipe: "uang" }, { key: "totalKeluar", header: "Total Keluar Rekening (Rp)", tipe: "uang" },
    ...sisip,
    { key: "status", header: "Status", tipe: "teks", lebar: 20 },
    { key: "bukti", header: "Bukti Nota", tipe: "teks", lebar: 12 }, { key: "verifikasi", header: "Verifikasi Bukti", tipe: "teks", lebar: 20 },
    { key: "diajukanOleh", header: "Diajukan Oleh", tipe: "teks", lebar: 18 }, { key: "diajukanPada", header: "Diajukan Pada (WIB)", tipe: "waktu" },
    { key: "disetujuiOleh", header: "Disetujui Oleh", tipe: "teks", lebar: 18 }, { key: "disetujuiPada", header: "Disetujui Pada (WIB)", tipe: "waktu" },
    { key: "dibayarOleh", header: "Dibayar Oleh", tipe: "teks", lebar: 18 }, { key: "dibayarPada", header: "Dibayar Pada (WIB)", tipe: "waktu" },
    { key: "alasanTolak", header: "Alasan Penolakan", tipe: "teks", lebar: 28, sensitif: true },
    { key: "catatan", header: "Catatan Internal", tipe: "teks", lebar: 30, sensitif: true },
    { key: "tautanBukti", header: "Tautan Foto Nota", tipe: "teks", lebar: 34, sensitif: true },
  ];
}

/** Sheet ringkasan per status — mereproduksi kartu layar ("Total di Filter Ini", jumlah Menunggu Persetujuan & Disetujui). */
export function sheetRingkasanStatus(baris, judul) {
  const per = STATUS_URUT.map((s) => {
    const rs = baris.filter((b) => b.status === labelStatus(s));
    return { status: labelStatus(s), jumlah: rs.length, nominal: jumlah(rs, "nominal") };
  }).filter((r) => r.jumlah > 0);
  return {
    nama: "Ringkasan", judul,
    kolom: [
      { key: "status", header: "Status", tipe: "teks", lebar: 24 }, { key: "jumlah", header: "Jumlah Dokumen", tipe: "angka" },
      { key: "nominal", header: "Nominal (Rp)", tipe: "uang" },
    ],
    baris: per,
    total: { label: "TOTAL", nilai: { jumlah: baris.length, nominal: jumlah(baris, "nominal") } },
  };
}

const POLA_UUID_LONGGAR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Filter dari klien → filter aman untuk query: nilai dipaksa teks (objek JSON tidak boleh menyusup jadi operator Prisma),
 * enum & id divalidasi (nilai asing → 400, bukan galat database 500).
 */
export function bersihkanFilter(filter) {
  const f = {};
  for (const [k, v] of Object.entries(filter || {})) {
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "object") throw new ExportError(`Filter "${k}" tidak valid`, 400, "FILTER_TIDAK_VALID");
    f[k] = String(v);
  }
  const salah = (nama) => { throw new ExportError(`Filter ${nama} tidak valid`, 400, "FILTER_TIDAK_VALID"); };
  if (f.status && !STATUS_URUT.includes(f.status)) salah("status");
  if (f.division && !LABEL_DIVISI_EXPORT[f.division]) salah("divisi");
  if (f.mode && !LABEL_MODE_EXPORT[f.mode]) salah("cara bayar");
  if (f.bukti && !LABEL_BUKTI_EXPORT[f.bukti]) salah("bukti");
  for (const k of ["categoryId", "cashAccountId"]) if (f[k] && !POLA_UUID_LONGGAR.test(f[k])) salah(k === "categoryId" ? "kategori" : "rekening");
  return f;
}

/** Label filter untuk kepala berkas bila klien tidak mengirim `filterLabel` (nama kategori/rekening dicari dari id). */
export async function labelFilterServer(db, { filter, modelKategori, namaKategori }) {
  const [kat, rek] = await Promise.all([
    filter.categoryId && /^[0-9a-f-]{36}$/i.test(filter.categoryId) ? db[modelKategori].findUnique({ where: { id: filter.categoryId }, select: { name: true } }) : null,
    filter.cashAccountId && /^[0-9a-f-]{36}$/i.test(filter.cashAccountId) ? db.finCashAccount.findUnique({ where: { id: filter.cashAccountId }, select: { name: true } }) : null,
  ]);
  return susunLabelFilter([
    ["Status", filter.status && labelStatus(filter.status)], [namaKategori, kat?.name || filter.categoryId], ["Divisi", filter.division && labelDivisi(filter.division)],
    ["Cara bayar", filter.mode && labelMode(filter.mode)], ["Rekening", rek?.name || filter.cashAccountId], ["Bukti", filter.bukti && (LABEL_BUKTI_EXPORT[filter.bukti] || filter.bukti)],
    ["Pencarian", filter.q],
  ]);
}

async function ambil(db, { user, filter: filterMentah, periode, ids, filterLabel }) {
  const filter = bersihkanFilter(filterMentah);
  const query = { from: periode.from ?? filter.from, to: periode.to ?? filter.to };
  const rentang = rentangDariQuery(query); // default bulan berjalan — persis seperti layar bila periode tidak dikirim
  const hasil = ids
    ? { expenses: await ambilPengeluaranByIds(db, ids, { user }), terpotong: false }
    : await ambilDaftarPengeluaran(db, { rentang, status: filter.status, division: filter.division, categoryId: filter.categoryId, mode: filter.mode, q: filter.q, bukti: filter.bukti, cashAccountId: filter.cashAccountId }, { user, take: 50_001 });
  const rows = hasil.expenses;
  const baris = rows.map((d) => ({ ...barisDokumen(d, "expenseNumber"), uangMukaDipakai: d.advanceAppliedAmount == null ? 0 : Number(d.advanceAppliedAmount) || 0, uangMuka: d.advance?.advanceNumber || "", order: d.order?.orderNumber || "" }));

  // Bila filter status = Semua, baris TOTAL hanya menjumlahkan pengeluaran NYATA (di luar dibatalkan/ditolak) supaya tidak menggelembung; yang dikecualikan
  // dilaporkan terpisah di catatan dan tetap terlihat sebagai baris + di sheet Ringkasan per status. Filter status tertentu: total apa adanya.
  const kecualikan = !filter.status;
  const labelTidakDihitung = STATUS_TIDAK_DIHITUNG.map(labelStatus);
  const barisHitung = kecualikan ? baris.filter((b) => !labelTidakDihitung.includes(b.status)) : baris;
  const barisTidak = baris.filter((b) => !barisHitung.includes(b));
  const menunggu = rows.filter((e) => e.status === "MENUNGGU_APPROVAL").length;
  const disetujui = rows.filter((e) => e.status === "DISETUJUI").length;
  const catatan = [
    `Ringkasan seperti kartu di layar: ${baris.length} pengeluaran · ${menunggu} menunggu persetujuan · ${disetujui} disetujui (belum dibayar).`,
    barisTidak.length > 0
      ? `Baris TOTAL menjumlahkan pengeluaran nyata saja (${barisHitung.length} baris, di luar dibatalkan/ditolak). ${barisTidak.length} baris dibatalkan/ditolak senilai Rp${jumlah(barisTidak, "nominal").toLocaleString("id-ID")} tetap tercantum di daftar tetapi TIDAK dijumlahkan; rinciannya ada di sheet Ringkasan.`
      : "Total nominal menjumlahkan semua baris yang tampil sesuai filter, sama seperti kartu \"Total di Filter Ini\" di layar.",
    ...(!ids && baris.length > 300 ? [`Layar hanya menampilkan 300 baris teratas; berkas ini memuat seluruh ${baris.length} baris yang cocok dengan filter.`] : []),
  ];

  return {
    nama: "Pengeluaran",
    // Layar melengkapi periode yang kosong dengan bulan berjalan (rentangDariQuery) — label menyebut rentang yang benar-benar dipakai query.
    ...(!ids ? { periodeLabel: labelPeriode({ from: rentang.fromStr, to: rentang.toStr }) } : {}),
    filterLabel: filterLabel || await labelFilterServer(db, { filter, modelKategori: "finExpenseCategory", namaKategori: "Kategori" }),
    sheets: [
      {
        nama: "Pengeluaran", judul: "Pengeluaran & Reimbursement",
        kolom: kolomDokumen({
          noHeader: "No. Pengeluaran", kategoriHeader: "Kategori Biaya",
          sisip: [
            { key: "uangMukaDipakai", header: "Uang Muka Dipakai (Rp)", tipe: "uang" }, { key: "uangMuka", header: "No. Uang Muka", tipe: "teks", lebar: 18 },
            { key: "order", header: "Order Terkait", tipe: "teks", lebar: 18 },
          ],
        }),
        baris,
        total: { label: barisTidak.length > 0 ? `TOTAL AKTIF (${barisHitung.length} pengeluaran, tanpa dibatalkan/ditolak)` : `TOTAL (${baris.length} pengeluaran)`, nilai: { nominal: jumlah(barisHitung, "nominal"), biayaAdmin: jumlah(barisHitung, "biayaAdmin"), totalKeluar: jumlah(barisHitung, "totalKeluar"), uangMukaDipakai: jumlah(barisHitung, "uangMukaDipakai") } },
        catatan,
      },
      ...(baris.length > 0 ? [sheetRingkasanStatus(baris, "Ringkasan Pengeluaran per Status")] : []),
    ],
  };
}

// Izin = endpoint daftar layar minus jalur "milik sendiri" (FINANCE_EXPENSE_SUBMIT): export cukup FINANCE_READ.
export default { kunci: "pengeluaran", nama: "Pengeluaran", izin: [P.FINANCE_READ], ambil };
