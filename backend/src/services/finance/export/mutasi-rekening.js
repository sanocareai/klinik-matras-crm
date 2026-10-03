// EXPORT EXCEL — MUTASI REKENING (satu rekening kas/bank). Sumber data = mutasiRekening() di services/finance/buku.js (fungsi yang SAMA dengan layar
// GET /api/finance/buku/rekening/:id/mutasi; layar memakai halaman, export memakai semua baris). Saldo berjalan TIDAK dihitung ulang di sini.
// Layar memfilter (pencarian) di SERVER lewat `q`, jadi export memakai filter yang sama dan kolom Saldo tetap saldo berjalan seluruh periode.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { mutasiRekening } from "../buku.js";
import { labelSumberJurnal, labelStatusJurnal } from "../jurnalRead.js";
import { ExportError, MAKS_BARIS, susunLabelFilter, labelPeriode } from "./excel.js";
import { keteranganTanpaAlasan } from "./label.js";

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
const LABEL_COCOK = { COCOK_OTOMATIS: "Cocok otomatis", COCOK_MANUAL: "Cocok manual", DIKECUALIKAN: "Dikecualikan" };
const JENIS = { KAS: "Kas tunai", BANK: "Rekening bank", EWALLET: "E-wallet / QRIS" };

async function ambil(db, { filter, periode, filterLabel, bolehSensitif }) {
  const cashAccountId = String(filter.cashAccountId || "");
  if (!POLA_UUID.test(cashAccountId)) throw new ExportError("Pilih rekening yang akan diekspor", 400, "REKENING_WAJIB");
  const rentang = rentangDariQuery({ from: periode.from ?? filter.from, to: periode.to ?? filter.to });
  const hasil = await mutasiRekening(db, { cashAccountId, from: rentang.fromStr, to: rentang.toStr, q: filter.q, arah: filter.arah, urut: filter.urut, arahUrut: filter.arahUrut, nominalMin: filter.nominalMin, nominalMaks: filter.nominalMaks, sumber: filter.sumber, cocok: filter.cocok, semua: true });
  if (!hasil) throw new ExportError("Rekening tidak ditemukan", 404, "REKENING_TIDAK_ADA");
  if (hasil.baris.length > MAKS_BARIS) throw new ExportError(`Mutasi rekening ini melebihi ${MAKS_BARIS.toLocaleString("id-ID")} baris pada periode tersebut. Persempit periode lalu coba lagi.`, 413, "TERLALU_BESAR");

  const baris = [
    { tanggal: rentang.fromStr, dibuat: null, jurnal: "", keterangan: "Saldo awal periode", lawan: "", sumber: "", status: "", dokumen: "", aktor: "", tanggalBank: null, tanggalEfektif: null, cocok: "", masuk: null, keluar: null, saldo: hasil.saldoAwal },
    ...hasil.baris.map((b) => ({
      tanggal: b.tanggalBuku ?? b.tanggal, dibuat: b.dibuatPada, jurnal: b.nomor, keterangan: keteranganTanpaAlasan(b.keterangan || "", bolehSensitif), lawan: b.lawan || "", sumber: labelSumberJurnal(b.sumber),
      status: labelStatusJurnal(b.status), dokumen: b.dokumen?.nomor || "", aktor: b.aktor || "", tanggalBank: b.tanggalBank, tanggalEfektif: b.tanggalEfektif, cocok: LABEL_COCOK[b.statusCocok] || "",
      masuk: b.masuk, keluar: b.keluar, saldo: b.saldo,
    })),
  ];
  const nama = hasil.rekening.nama;
  return {
    nama: "Mutasi Rekening",
    periodeLabel: labelPeriode({ from: rentang.fromStr, to: rentang.toStr }),
    filterLabel: filterLabel || susunLabelFilter([["Rekening", nama], ["Pencarian", filter.q], ["Sumber", filter.sumber], ["Cocok bank", filter.cocok], ["Arah", { MASUK: "Uang masuk", KELUAR: "Uang keluar" }[String(filter.arah || "").toUpperCase()]], ["Nominal", filter.nominalMin || filter.nominalMaks ? `${filter.nominalMin || "0"} – ${filter.nominalMaks || "∞"}` : null], ["Urutan", filter.urut && filter.urut !== "tanggal" || filter.arahUrut === "desc" ? `${filter.urut || "tanggal"} ${filter.arahUrut === "desc" ? "terbesar/terbaru dulu" : "terkecil/terlama dulu"}` : null]]),
    sheets: [
      {
        nama: "Mutasi", judul: `Mutasi Rekening — ${nama}`,
        kolom: [
          { key: "tanggal", header: "Tanggal Buku", tipe: "tanggal" }, { key: "dibuat", header: "Dibuat Pada", tipe: "waktu" }, { key: "jurnal", header: "No. Jurnal", tipe: "teks", lebar: 20 },
          { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 46 }, { key: "lawan", header: "Akun Lawan", tipe: "teks", lebar: 34 },
          { key: "sumber", header: "Sumber", tipe: "teks", lebar: 22 }, { key: "status", header: "Status", tipe: "teks", lebar: 13 }, { key: "dokumen", header: "Dokumen", tipe: "teks", lebar: 22 },
          { key: "aktor", header: "Dibuat Oleh", tipe: "teks", lebar: 18 }, { key: "tanggalBank", header: "Tanggal Bank", tipe: "tanggal" }, { key: "tanggalEfektif", header: "Tanggal Efektif", tipe: "tanggal" }, { key: "cocok", header: "Status Cocok Bank", tipe: "teks", lebar: 18 },
          { key: "masuk", header: "Masuk (Rp)", tipe: "uang" }, { key: "keluar", header: "Keluar (Rp)", tipe: "uang" }, { key: "saldo", header: "Saldo Berjalan (Rp)", tipe: "uang" },
        ],
        baris,
        total: { label: `TOTAL MUTASI (${hasil.baris.length}) · SALDO AKHIR`, nilai: { masuk: jumlah(hasil.baris, "masuk"), keluar: jumlah(hasil.baris, "keluar"), saldo: hasil.saldoAkhir } },
        catatan: [
          "Saldo = menurut buku besar (bukan menurut bank). Cocokkan baris ini dengan rekening koran bank; yang ada di salah satu sisi saja adalah penyebab selisih.",
          "Jurnal pembalik (pembatalan) ikut tampil sebagai baris terpisah supaya saldo berjalan tetap sama dengan layar.",
          "Empat tanggal berbeda: Tanggal Buku (di jurnal), Dibuat Pada (kapan diinput), Tanggal Bank dan Tanggal Efektif (dari rekening koran yang dicocokkan; kosong bila belum dicocokkan).",
          `Paritas: saldo akhir mutasi ${hasil.paritas.saldoAkhir} ${hasil.paritas.cocok ? "SAMA dengan" : "BERBEDA dari"} saldo kartu Kas & Bank ${hasil.paritas.saldoKartu}.`,
          ...(hasil.disaring ? [`Hanya ${hasil.baris.length} dari ${hasil.jumlahMutasi} mutasi yang diekspor (sesuai pencarian/filter); kolom Saldo tetap saldo berjalan seluruh periode.`] : []),
          ...hasil.peringatan.map((p) => `PERHATIAN: ${p.pesan}`),
        ],
      },
      {
        nama: "Ringkasan", judul: `Ringkasan Mutasi — ${nama}`,
        kolom: [{ key: "uraian", header: "Uraian", tipe: "teks", lebar: 44 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }],
        baris: [
          { uraian: `Saldo Awal (per ${rentang.fromStr})`, nilai: hasil.saldoAwal },
          { uraian: `Jumlah Masuk (${hasil.jumlahMasuk} transaksi)`, nilai: hasil.totalMasuk },
          { uraian: `Jumlah Keluar (${hasil.jumlahKeluar} transaksi)`, nilai: hasil.totalKeluar },
          { uraian: `Saldo Akhir (per ${rentang.toStr})`, nilai: hasil.saldoAkhir },
        ],
        catatan: [`Rekening: ${nama} (${JENIS[hasil.rekening.jenis] || hasil.rekening.jenis}${hasil.rekening.nomor ? `, ${hasil.rekening.bank || ""} ${hasil.rekening.nomor}` : ""}).`, "Ringkasan menghitung SEMUA mutasi periode."],
      },
    ],
  };
}

export default { kunci: "mutasi-rekening", nama: "Mutasi Rekening", izin: [P.FINANCE_READ], ambil };
