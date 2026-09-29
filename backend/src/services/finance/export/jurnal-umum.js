// EXPORT EXCEL — JURNAL UMUM. Sumber data = ambilDaftarJurnal() di services/finance/jurnalRead.js (query yang SAMA dengan layar
// GET /api/finance/journal; layar memakai take 100, export memakai batas besar). Filter layar (server): source, status, search + periode.
// Sheet 1 "Baris Jurnal": satu baris per BARIS jurnal (debit/kredit + dimensi order/pelanggan/supplier/rekening).
// Alasan pembalikan (kolom "Alasan Pembalikan" dan bagian sesudah " — " pada keterangan jurnal balik) SENSITIF: hanya untuk finance:admin.
// Sheet 2 "Daftar Jurnal": satu baris per jurnal = tabel layar (Nomor, Tanggal, Keterangan, Sumber, Nilai, Status).
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { ambilDaftarJurnal, bentukJurnal, labelSumberJurnal, labelStatusJurnal } from "../jurnalRead.js";
import { MAKS_BARIS, susunLabelFilter, labelPeriode } from "./excel.js";
import { keteranganTanpaAlasan } from "./label.js";

const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

async function ambil(db, { filter, periode, filterLabel, bolehSensitif }) {
  const rentang = rentangDariQuery({ from: periode.from ?? filter.from, to: periode.to ?? filter.to });
  const { entries, total } = await ambilDaftarJurnal(
    db,
    { from: rentang.from, to: rentang.to, source: filter.source, status: filter.status, search: filter.search ?? filter.q },
    { take: MAKS_BARIS + 1, dimensi: true },
  );
  const jurnal = entries.map(bentukJurnal);

  const daftar = jurnal.map((e) => ({
    nomor: e.entryNumber, tanggal: e.date, keterangan: keteranganTanpaAlasan(e.description, bolehSensitif), sumber: labelSumberJurnal(e.source), nilai: e.totalDebit, status: labelStatusJurnal(e.status),
    dibuat: e.createdBy?.name || "", membalik: e.reversalOf?.entryNumber || "", dibalikOleh: e.reversedBy?.entryNumber || "",
    alasanBalik: e.reversalReason || "",
  }));

  const barisJurnal = jurnal.flatMap((e) => e.lines.map((l) => ({
    nomor: e.entryNumber, tanggal: e.date, sumber: labelSumberJurnal(e.source), status: labelStatusJurnal(e.status), keterangan: keteranganTanpaAlasan(e.description, bolehSensitif),
    noBaris: l.lineNo, kodeAkun: l.account?.code || "", namaAkun: l.account?.name || "", keteranganBaris: l.description || "",
    debit: l.debit, kredit: l.credit, rekening: l.cashAccount?.name || "", order: l.order?.orderNumber || "", pelanggan: l.customer?.name || "", supplier: l.supplier?.name || "",
  })));

  return {
    nama: "Jurnal Umum",
    periodeLabel: labelPeriode({ from: rentang.fromStr, to: rentang.toStr }),
    filterLabel: filterLabel || susunLabelFilter([["Sumber", filter.source && labelSumberJurnal(filter.source)], ["Status", filter.status && labelStatusJurnal(filter.status)], ["Pencarian", filter.search ?? filter.q]]),
    sheets: [
      {
        nama: "Baris Jurnal", judul: "Jurnal Umum — Baris Jurnal",
        kolom: [
          { key: "nomor", header: "No. Jurnal", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" },
          { key: "sumber", header: "Sumber", tipe: "teks", lebar: 22 }, { key: "status", header: "Status", tipe: "teks", lebar: 13 },
          { key: "keterangan", header: "Keterangan Jurnal", tipe: "teks", lebar: 40 }, { key: "noBaris", header: "No. Baris", tipe: "angka", lebar: 9 },
          { key: "kodeAkun", header: "Kode Akun", tipe: "teks", lebar: 11 }, { key: "namaAkun", header: "Nama Akun", tipe: "teks", lebar: 30 },
          { key: "keteranganBaris", header: "Keterangan Baris", tipe: "teks", lebar: 34 },
          { key: "debit", header: "Debit (Rp)", tipe: "uang" }, { key: "kredit", header: "Kredit (Rp)", tipe: "uang" },
          { key: "rekening", header: "Rekening Kas/Bank", tipe: "teks", lebar: 20 }, { key: "order", header: "Order", tipe: "teks", lebar: 20 },
          { key: "pelanggan", header: "Pelanggan", tipe: "teks", lebar: 22 }, { key: "supplier", header: "Supplier", tipe: "teks", lebar: 22 },
        ],
        baris: barisJurnal,
        total: { label: `TOTAL (${jurnal.length} jurnal, ${barisJurnal.length} baris)`, nilai: { debit: jumlah(barisJurnal, "debit"), kredit: jumlah(barisJurnal, "kredit") } },
        catatan: ["Total Debit harus sama dengan Total Kredit (pembukuan berpasangan). Jurnal berstatus Dibalik tetap tampil; jurnal baliknya adalah jurnal tersendiri."],
      },
      {
        nama: "Daftar Jurnal", judul: "Jurnal Umum — Daftar Jurnal",
        kolom: [
          { key: "nomor", header: "No. Jurnal", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" },
          { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 44 }, { key: "sumber", header: "Sumber", tipe: "teks", lebar: 22 },
          { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "status", header: "Status", tipe: "teks", lebar: 13 },
          { key: "dibuat", header: "Dibuat Oleh", tipe: "teks", lebar: 18 }, { key: "membalik", header: "Membalik Jurnal", tipe: "teks", lebar: 20 },
          { key: "dibalikOleh", header: "Dibalik Oleh Jurnal", tipe: "teks", lebar: 20 },
          { key: "alasanBalik", header: "Alasan Pembalikan", tipe: "teks", lebar: 30, sensitif: true },
        ],
        baris: daftar,
        total: { label: `TOTAL (${daftar.length} jurnal)`, nilai: { nilai: jumlah(daftar, "nilai") } },
        catatan: [`Nilai = total debit jurnal (sama dengan kolom Nilai di layar). Jumlah jurnal pada filter ini: ${total}.`],
      },
    ].filter((s) => s.baris.length > 0 || s.nama === "Baris Jurnal"),
  };
}

export default { kunci: "jurnal-umum", nama: "Jurnal Umum", izin: [P.FINANCE_READ], ambil };
