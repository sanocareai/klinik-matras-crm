// EXPORT EXCEL — PEMBELIAN. Sumber data = services/finance/purchaseRead.js (query yang SAMA dengan layar, termasuk indikator
// uang muka DP/Sisa). Layar memfilter di SERVER (periode, status, q, categoryId, division, mode, cashAccountId, bukti) — export
// menjalankan fungsi baca yang sama. Bila klien mengirim `ids`, baris itu dimuat ulang (urutan mengikuti `ids`).
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { ambilDaftarPembelian, ambilPembelianByIds } from "../purchaseRead.js";
import { labelPeriode } from "./excel.js";
import { barisDokumen, kolomDokumen, sheetRingkasanStatus, bersihkanFilter, labelFilterServer, jumlah } from "./pengeluaran.js";

async function ambil(db, { user, filter: filterMentah, periode, ids, filterLabel }) {
  const filter = bersihkanFilter(filterMentah);
  const rentang = rentangDariQuery({ from: periode.from ?? filter.from, to: periode.to ?? filter.to }); // default bulan berjalan — persis seperti layar
  const hasil = ids
    ? { purchases: await ambilPembelianByIds(db, ids, { user }) }
    : await ambilDaftarPembelian(db, { rentang, status: filter.status, division: filter.division, categoryId: filter.categoryId, mode: filter.mode, q: filter.q, bukti: filter.bukti, cashAccountId: filter.cashAccountId }, { user, take: 50_001 });
  const rows = hasil.purchases;

  // dp* / sisaUtang hanya ada untuk baris yang relevan (lihat purchaseRead.js) — baris lain dibiarkan kosong, bukan nol.
  const baris = rows.map((d) => ({
    ...barisDokumen(d, "purchaseNumber"),
    dpDiterapkan: d.dpDiterapkan ?? null, sisaUtang: d.sisaUtang ?? null, dpDigunakan: d.dpDigunakan ?? null, dpTersedia: d.dpTersedia ?? null,
  }));

  const menunggu = rows.filter((p) => p.status === "MENUNGGU_APPROVAL").length;
  const disetujui = rows.filter((p) => p.status === "DISETUJUI").length;
  const catatan = [
    `Ringkasan seperti kartu di layar: ${baris.length} pembelian · ${menunggu} menunggu persetujuan · ${disetujui} disetujui (belum dibayar).`,
    "Total nominal menjumlahkan semua baris yang tampil sesuai filter (termasuk yang ditolak/dibatalkan bila filter status = Semua), sama seperti kartu \"Total di Filter Ini\" di layar.",
    "Kolom uang muka: \"DP Diterapkan/Sisa Utang\" untuk pembelian mode Utang yang menerima DP; \"DP Digunakan/DP Tersedia\" untuk pembelian berjenis Uang Muka Pembelian. Baris lain dikosongkan.",
    ...(!ids && baris.length > 300 ? [`Layar hanya menampilkan 300 baris teratas; berkas ini memuat seluruh ${baris.length} baris yang cocok dengan filter.`] : []),
  ];

  return {
    nama: "Pembelian",
    ...(!ids ? { periodeLabel: labelPeriode({ from: rentang.fromStr, to: rentang.toStr }) } : {}),
    filterLabel: filterLabel || await labelFilterServer(db, { filter, modelKategori: "finPurchaseCategory", namaKategori: "Jenis" }),
    sheets: [
      {
        nama: "Pembelian", judul: "Pembelian (Bahan Baku, Aset, Uang Muka)",
        kolom: kolomDokumen({
          noHeader: "No. Pembelian", kategoriHeader: "Jenis Pembelian",
          sisip: [
            { key: "dpDiterapkan", header: "DP Diterapkan (Rp)", tipe: "uang" }, { key: "sisaUtang", header: "Sisa Utang Setelah DP (Rp)", tipe: "uang" },
            { key: "dpDigunakan", header: "DP Digunakan (Rp)", tipe: "uang" }, { key: "dpTersedia", header: "DP Tersedia (Rp)", tipe: "uang" },
          ],
        }),
        baris,
        total: {
          label: `TOTAL (${baris.length} pembelian)`,
          nilai: {
            nominal: jumlah(baris, "nominal"), biayaAdmin: jumlah(baris, "biayaAdmin"), totalKeluar: jumlah(baris, "totalKeluar"),
            dpDiterapkan: jumlah(baris, "dpDiterapkan"), sisaUtang: jumlah(baris, "sisaUtang"), dpDigunakan: jumlah(baris, "dpDigunakan"), dpTersedia: jumlah(baris, "dpTersedia"),
          },
        },
        catatan,
      },
      ...(baris.length > 0 ? [sheetRingkasanStatus(baris, "Ringkasan Pembelian per Status")] : []),
    ],
  };
}

// Izin = endpoint daftar layar minus jalur "milik sendiri" (FINANCE_EXPENSE_SUBMIT): export cukup FINANCE_READ.
export default { kunci: "pembelian", nama: "Pembelian", izin: [P.FINANCE_READ], ambil };
