// EXPORT EXCEL — MUTASI BANK (rekening koran yang diimpor, Rekonsiliasi Bank V2). Sumber data = mutasiBank() di services/finance/bankRekon/pencocokan.js — fungsi yang SAMA dengan layar
// (GET /api/finance/rekon-bank/:id/mutasi-bank; layar memakai halaman, export memakai semua baris). Filter layar (periode, pencarian, status) ikut persis.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { mutasiBank } from "../bankRekon/pencocokan.js";
import { POLA_UUID, STATUS_BANK } from "../bankRekon/shared.js";
import { ExportError, MAKS_BARIS, susunLabelFilter, labelPeriode } from "./excel.js";

const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

async function ambil(db, { filter, periode }) {
  const cashAccountId = String(filter.cashAccountId || "");
  if (!POLA_UUID.test(cashAccountId)) throw new ExportError("Pilih rekening yang akan diekspor", 400, "REKENING_WAJIB");
  const rentang = rentangDariQuery({ from: periode.from ?? filter.from, to: periode.to ?? filter.to });
  const status = filter.status && STATUS_BANK[filter.status] ? filter.status : null;
  const hasil = await mutasiBank(db, { cashAccountId, from: rentang.fromStr, to: rentang.toStr, q: filter.q, status, semua: true });
  if (hasil.baris.length > MAKS_BARIS) throw new ExportError(`Mutasi bank melebihi ${MAKS_BARIS.toLocaleString("id-ID")} baris pada periode tersebut. Persempit periode lalu coba lagi.`, 413, "TERLALU_BESAR");
  const nama = hasil.rekening.nama;
  return {
    nama: "Mutasi Bank",
    periodeLabel: labelPeriode({ from: rentang.fromStr, to: rentang.toStr }),
    filterLabel: susunLabelFilter([["Rekening", nama], ["Status", status ? STATUS_BANK[status] : null], ["Pencarian", filter.q]]),
    sheets: [
      {
        nama: "Mutasi Bank", judul: `Mutasi Rekening Koran — ${nama}`,
        kolom: [
          { key: "tanggal", header: "Tanggal Transaksi", tipe: "tanggal" }, { key: "efektif", header: "Tanggal Efektif", tipe: "tanggal" },
          { key: "deskripsi", header: "Keterangan Bank", tipe: "teks", lebar: 48 }, { key: "referensi", header: "Referensi", tipe: "teks", lebar: 22 },
          { key: "masuk", header: "Masuk (Rp)", tipe: "uang" }, { key: "keluar", header: "Keluar (Rp)", tipe: "uang" }, { key: "saldo", header: "Saldo Bank (Rp)", tipe: "uang" },
          { key: "status", header: "Status", tipe: "teks", lebar: 20 }, { key: "bentuk", header: "Bentuk", tipe: "teks", lebar: 9 }, { key: "kategori", header: "Kategori", tipe: "teks", lebar: 22 }, { key: "alasan", header: "Alasan", tipe: "teks", lebar: 40 },
        ],
        baris: hasil.baris.map((b) => ({
          tanggal: b.tanggal, efektif: b.tanggalEfektif, deskripsi: b.deskripsi, referensi: b.referensi || "", masuk: b.masuk, keluar: b.keluar, saldo: b.saldo,
          status: b.statusLabel, bentuk: b.pencocokan?.bentuk || "", kategori: b.pencocokan?.kategoriLabel || "", alasan: b.pencocokan?.alasan || "",
        })),
        total: { label: `TOTAL MUTASI BANK (${hasil.baris.length})`, nilai: { masuk: jumlah(hasil.baris, "masuk"), keluar: jumlah(hasil.baris, "keluar") } },
        catatan: [
          "Baris ini adalah salinan rekening koran yang diimpor (immutable) — bukan jurnal. Status menunjukkan apakah baris sudah dicocokkan dengan buku.",
          "Masuk/Keluar menurut BANK: Kredit = uang masuk rekening, Debit = uang keluar rekening.",
          ...(hasil.total !== hasil.jumlahBaris ? [`Hanya ${hasil.baris.length} dari ${hasil.jumlahBaris} baris yang diekspor (sesuai filter).`] : []),
        ],
      },
      {
        nama: "Ringkasan", judul: `Ringkasan Mutasi Bank — ${nama}`,
        kolom: [{ key: "uraian", header: "Uraian", tipe: "teks", lebar: 44 }, { key: "nilai", header: "Nilai", tipe: "uang" }],
        baris: [
          { uraian: "Saldo bank awal periode (dari kolom saldo berkas)", nilai: hasil.saldoAwalBank },
          { uraian: "Total masuk (kredit)", nilai: hasil.totalMasuk },
          { uraian: "Total keluar (debit)", nilai: hasil.totalKeluar },
          { uraian: "Saldo bank akhir periode (dari kolom saldo berkas)", nilai: hasil.saldoAkhirBank },
          ...Object.entries(STATUS_BANK).map(([k, v]) => ({ uraian: `Jumlah baris — ${v}`, nilai: hasil.perStatus[k] ?? 0 })),
        ],
        catatan: ["Saldo bank kosong berarti berkas impor tidak memiliki kolom saldo."],
      },
    ],
  };
}

export default { kunci: "mutasi-bank", nama: "Mutasi Bank", izin: [P.FINANCE_READ], ambil };
