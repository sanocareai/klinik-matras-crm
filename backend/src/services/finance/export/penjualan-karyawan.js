// Export PKR memakai pembentuk angka yang sama dengan daftar Finance; tidak memakai 500 baris pertama dari UI.
// Aturan angka: TOTAL hanya menjumlahkan dokumen AKTIF; dokumen dibatalkan tampil sebagai riwayat ("Dibatalkan — tidak ditagih", sisa Rp0) dan dirangkum terpisah.
// Pembayaran yang dibatalkan tampil berstatus "Dibatalkan" dan TIDAK masuk total pembayaran aktif. Nilai historis tidak diubah.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { bentukPenjualan, penjualanInclude, ringkasanPerKaryawan, STATUS_LABEL, whereDaftar } from "../penjualanKaryawanManual.js";
import { ExportError, susunLabelFilter } from "./excel.js";

async function ambil(db, { periode, filter }) {
  const pilihan = { from: periode?.from, to: periode?.to, q: filter.q, status: filter.status, sellerId: filter.sellerId };
  if (pilihan.status && !Object.hasOwn(STATUS_LABEL, pilihan.status)) throw new ExportError("Status penjualan tidak valid", 400, "FILTER_TIDAK_VALID");
  const mentah = await db.finPenjualanKaryawan.findMany({ where: whereDaftar(pilihan), orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 50_001, include: penjualanInclude });
  if (mentah.length > 50_000) throw new ExportError("Terlalu banyak penjualan untuk satu Excel. Persempit periode atau filter.", 413, "TERLALU_BESAR");
  const semua = mentah.map(bentukPenjualan);
  const daftar = ["LUNAS", "SEBAGIAN", "BELUM_BAYAR"].includes(pilihan.status) ? semua.filter((p) => p.statusTampil === pilihan.status) : semua;
  // Kartu layar dan tabel per karyawan bersifat sepanjang waktu; sheet ini secara eksplisit mengikuti periode.
  const rekap = await ringkasanPerKaryawan(db, { from: periode.from, to: periode.to });
  const aktif = daftar.filter((p) => p.statusTampil !== "DIBATALKAN");
  const batal = daftar.filter((p) => p.statusTampil === "DIBATALKAN");
  // Label karyawan memakai NAMA (bukan id): dari hasil filter bila ada, kalau tidak dari tabel pengguna.
  const namaKaryawan = filter.sellerId ? (daftar.find((p) => p.sellerId === filter.sellerId)?.seller?.name || (await db.user?.findUnique?.({ where: { id: filter.sellerId }, select: { name: true } }))?.name || filter.sellerId) : "";
  const jumlah = (rows, key) => rows.reduce((n, r) => n + Number(r[key] || 0), 0);
  const pembayaranSemua = daftar.flatMap((p) => p.payments);
  const pembayaranAktif = pembayaranSemua.filter((x) => !x.cancelledAt);
  return {
    nama: "Penjualan Karyawan",
    basisTanggalLabel: "Tanggal dokumen penjualan (WIB); pembayaran bisa terjadi di luar periode",
    filterLabel: susunLabelFilter([["Status", STATUS_LABEL[filter.status]], ["Karyawan", namaKaryawan], ["Pencarian", filter.q]]),
    sheets: [
      {
        nama: "Daftar Penjualan", judul: "Daftar Penjualan Karyawan",
        kolom: [
          { key: "nomor", header: "Nomor PKR", lebar: 22 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" },
          { key: "karyawan", header: "Karyawan", lebar: 24 }, { key: "pembeli", header: "Pembeli", lebar: 30 },
          { key: "item", header: "Item / Produk", lebar: 42 }, { key: "total", header: "Nilai (Rp)", tipe: "uang" },
          { key: "terbayar", header: "Dibayar (Rp)", tipe: "uang" }, { key: "sisa", header: "Sisa Ditagih (Rp)", tipe: "uang" },
          { key: "status", header: "Status", lebar: 20 }, { key: "catatan", header: "Catatan Internal", lebar: 35, sensitif: true },
        ],
        baris: daftar.map((p) => ({ nomor: p.nomor, tanggal: p.date, karyawan: p.seller?.name || "", pembeli: p.buyerName,
          item: p.items.map((i) => `${i.quantity}× ${i.name}`).join("; "), total: p.total, terbayar: p.terbayar, sisa: p.sisa,
          status: p.statusTampil === "DIBATALKAN" ? "Dibatalkan — tidak ditagih" : p.statusLabel, catatan: p.notes || "" })),
        total: { label: `TOTAL AKTIF (${aktif.length} dari ${daftar.length} dokumen)`, nilai: { total: jumlah(aktif, "total"), terbayar: jumlah(aktif, "terbayar"), sisa: jumlah(aktif, "sisa") } },
        catatan: ["Total hanya menjumlahkan dokumen aktif dalam hasil filter. Dokumen batal tetap ada sebagai riwayat dan tidak ditagih.",
          `Dokumen dibatalkan dalam hasil filter (tidak termasuk total): ${batal.length} dokumen, nilai historis ${jumlah(batal, "total")}.`,
          `Seluruh hasil filter dimuat (${daftar.length} dokumen), tanpa batas 500 baris layar.`],
      },
      {
        nama: "Per Karyawan", judul: "Rekap Penjualan per Karyawan",
        kolom: [
          { key: "nama", header: "Karyawan", lebar: 28 }, { key: "jumlah", header: "Penjualan Aktif", tipe: "angka" },
          { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "terbayar", header: "Dibayar (Rp)", tipe: "uang" },
          { key: "sisa", header: "Sisa Ditagih (Rp)", tipe: "uang" },
        ],
        baris: rekap.karyawan.filter((k) => !pilihan.sellerId || k.sellerId === pilihan.sellerId).map(({ nama, jumlah, nilai, terbayar, sisa }) => ({ nama, jumlah, nilai, terbayar, sisa })),
        catatan: ["Rekap ini mencakup semua penjualan aktif pada periode yang dipilih; pencarian dan tab status daftar tidak mengubah rekap."],
      },
      {
        nama: "Pembayaran", judul: "Riwayat Pembayaran Penjualan Karyawan",
        kolom: [
          { key: "nomor", header: "Nomor PKR", lebar: 22 }, { key: "tanggal", header: "Tanggal Pembayaran", tipe: "tanggal" },
          { key: "karyawan", header: "Karyawan", lebar: 25 }, { key: "metode", header: "Metode", lebar: 18 },
          { key: "nominal", header: "Nominal (Rp)", tipe: "uang" }, { key: "status", header: "Status", lebar: 16 },
          { key: "rekening", header: "Rekening", lebar: 26, sensitif: true },
        ],
        total: { label: `TOTAL PEMBAYARAN AKTIF (${pembayaranAktif.length} dari ${pembayaranSemua.length} pembayaran)`, nilai: { nominal: jumlah(pembayaranAktif.map((x) => ({ n: x.amount })), "n") } },
        baris: daftar.flatMap((p) => p.payments.map((bayar) => ({ nomor: p.nomor, tanggal: bayar.date, karyawan: p.seller?.name || "",
          metode: bayar.method === "POTONG_GAJI" ? "Potong gaji" : bayar.method === "TRANSFER" ? "Transfer" : "Tunai",
          nominal: bayar.amount, status: bayar.cancelledAt ? "Dibatalkan" : "Aktif", rekening: bayar.cashAccount?.name || "" }))),
        catatan: ["Pembayaran ditampilkan untuk dokumen hasil filter, termasuk yang dibatalkan. Pembayaran berstatus Dibatalkan TIDAK masuk total pembayaran aktif. Tanggal pembayaran dapat berada di luar periode tanggal dokumen."],
      },
    ],
  };
}

export default { kunci: "penjualan-karyawan", nama: "Penjualan Karyawan", izin: [P.FINANCE_READ], ambil };
