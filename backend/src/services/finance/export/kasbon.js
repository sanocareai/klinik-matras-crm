// EXPORT EXCEL — KASBON. Sumber data = services/finance/kasbonRead.js (query yang SAMA dengan layar). Filter layar (server): q, status, karyawan, from, to.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { ambilDaftarKasbon, bentukKasbon, kasbonInclude } from "../kasbonRead.js";
import { susunLabelFilter } from "./excel.js";
import { labelStatus, labelCaraBayar, labelMetodeTransfer } from "./label.js";

const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

async function ambil(db, { filter, periode, ids, filterLabel }) {
  const query = { q: filter.q, status: filter.status, karyawan: filter.karyawan, from: periode.from ?? filter.from, to: periode.to ?? filter.to };
  const mentah = ids
    ? await db.finKasbon.findMany({ where: { id: { in: ids } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], include: kasbonInclude })
    : await ambilDaftarKasbon(db, query, { take: 50_001 });
  const rows = mentah.map(bentukKasbon);

  const baris = rows.map((k) => ({
    nomor: k.kasbonNumber, tanggal: k.date, karyawan: k.employeeName, urgensi: k.urgency || "", nominal: k.amount,
    terlunasi: k.terlunasi, sisa: k.sisa, status: labelStatus(k.status),
    rekening: k.cashAccount?.name || "", caraBayar: labelCaraBayar(k.paymentMethod), metodeTransfer: labelMetodeTransfer(k.transferFeeType),
    biayaAdmin: k.biayaAdmin, dicatat: k.createdBy?.name || "", historis: k.historis ? "Ya" : "Tidak",
    alasanBatal: k.status === "DIBATALKAN" ? (k.cancelReason || "") : "", catatan: k.notes || "",
  }));

  const pemotongan = rows.flatMap((k) => k.repayments.map((r) => ({
    nomor: k.kasbonNumber, karyawan: k.employeeName, tanggal: r.date, nominal: r.amount, cara: r.method === "POTONG_GAJI" ? "Potong gaji" : String(r.method || ""),
    status: r.cancelledAt ? "Dibatalkan" : "Aktif", rekening: r.cashAccount?.name || "", dicatat: r.createdBy?.name || "",
    alasanBatal: r.cancelledAt ? (r.cancelReason || "") : "", catatan: r.notes || "",
  })));
  const aktif = pemotongan.filter((p) => p.status === "Aktif");

  return {
    nama: "Kasbon",
    filterLabel: filterLabel || susunLabelFilter([["Status", filter.status && labelStatus(filter.status)], ["Karyawan", filter.karyawan], ["Pencarian", filter.q]]),
    sheets: [
      {
        nama: "Kasbon", judul: "Kasbon Karyawan",
        kolom: [
          { key: "nomor", header: "No. Kasbon", tipe: "teks", lebar: 18 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" },
          { key: "karyawan", header: "Karyawan", tipe: "teks", lebar: 22 }, { key: "urgensi", header: "Urgensi / Alasan", tipe: "teks", lebar: 30 },
          { key: "nominal", header: "Nominal (Rp)", tipe: "uang" }, { key: "terlunasi", header: "Terpotong (Rp)", tipe: "uang" },
          { key: "sisa", header: "Sisa (Rp)", tipe: "uang" }, { key: "status", header: "Status", tipe: "teks", lebar: 14 },
          { key: "rekening", header: "Rekening Sumber", tipe: "teks", lebar: 20 }, { key: "caraBayar", header: "Cara Bayar", tipe: "teks", lebar: 12 },
          { key: "metodeTransfer", header: "Metode Transfer", tipe: "teks", lebar: 16 }, { key: "biayaAdmin", header: "Biaya Admin (Rp)", tipe: "uang" },
          { key: "dicatat", header: "Dicatat Oleh", tipe: "teks", lebar: 18 }, { key: "historis", header: "Data Historis", tipe: "teks", lebar: 12 },
          { key: "alasanBatal", header: "Alasan Pembatalan", tipe: "teks", lebar: 28, sensitif: true },
          { key: "catatan", header: "Catatan Internal", tipe: "teks", lebar: 30, sensitif: true },
        ],
        baris,
        total: { label: `TOTAL (${baris.length} kasbon)`, nilai: { nominal: jumlah(baris, "nominal"), terlunasi: jumlah(baris, "terlunasi"), sisa: jumlah(baris, "sisa"), biayaAdmin: jumlah(baris, "biayaAdmin") } },
        catatan: ["Sisa hanya dihitung untuk kasbon berstatus Aktif. Kasbon = gaji dicairkan lebih awal, dipotong dari gaji (bukan pinjaman)."],
      },
      {
        nama: "Pemotongan", judul: "Riwayat Pemotongan Kasbon",
        kolom: [
          { key: "nomor", header: "No. Kasbon", tipe: "teks", lebar: 18 }, { key: "karyawan", header: "Karyawan", tipe: "teks", lebar: 22 },
          { key: "tanggal", header: "Tanggal", tipe: "tanggal" }, { key: "nominal", header: "Nominal (Rp)", tipe: "uang" },
          { key: "cara", header: "Cara", tipe: "teks", lebar: 14 }, { key: "status", header: "Status", tipe: "teks", lebar: 12 },
          { key: "rekening", header: "Rekening", tipe: "teks", lebar: 20 }, { key: "dicatat", header: "Dicatat Oleh", tipe: "teks", lebar: 18 },
          { key: "alasanBatal", header: "Alasan Pembatalan", tipe: "teks", lebar: 28, sensitif: true },
          { key: "catatan", header: "Catatan Internal", tipe: "teks", lebar: 30, sensitif: true },
        ],
        baris: pemotongan,
        total: { label: `TOTAL pemotongan aktif (${aktif.length})`, nilai: { nominal: aktif.reduce((a, p) => a + (Number(p.nominal) || 0), 0) } },
      },
    ].filter((s) => s.nama === "Kasbon" || s.baris.length > 0),
  };
}

export default { kunci: "kasbon", nama: "Kasbon", izin: [P.FINANCE_READ], ambil };
