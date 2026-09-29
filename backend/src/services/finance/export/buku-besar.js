// EXPORT EXCEL — BUKU BESAR (satu akun). Sumber data = bukuBesar() di services/finance/reports.js (fungsi yang SAMA dengan layar
// GET /api/finance/reports/ledger/:accountId; layar memakai limit 500, export memakai batas besar). Layar memfilter (pencarian/sumber/jenis/status)
// di KLIEN atas baris yang sudah termuat, jadi klien mengirim `ids` (lineId baris yang tampil, urutan layar); tanpa `ids` = semua mutasi periode.
// Saldo berjalan TIDAK dihitung ulang: kolom Saldo = saldo berjalan seluruh periode persis seperti layar, walau baris difilter.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { bukuBesar } from "../reports.js";
import { labelSumberJurnal, labelStatusJurnal } from "../jurnalRead.js";
import { ExportError, MAKS_BARIS, susunLabelFilter, labelPeriode } from "./excel.js";
import { keteranganTanpaAlasan } from "./label.js";

const TIPE_AKUN = { ASET: "Aset", KEWAJIBAN: "Kewajiban", EKUITAS: "Ekuitas", PENDAPATAN: "Pendapatan", BEBAN_POKOK: "Beban Pokok", BEBAN: "Beban Operasional" };
const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ambil(db, { filter, periode, ids, filterLabel, bolehSensitif }) {
  const accountId = String(filter.accountId || "");
  if (!POLA_UUID.test(accountId)) throw new ExportError("Pilih akun buku besar yang akan diekspor", 400, "AKUN_WAJIB");
  const rentang = rentangDariQuery({ from: periode.from ?? filter.from, to: periode.to ?? filter.to });
  const hasil = await bukuBesar(db, { accountId, from: rentang.from, to: rentang.to, limit: MAKS_BARIS + 1 });
  if (!hasil) throw new ExportError("Akun tidak ditemukan", 404, "AKUN_TIDAK_ADA");
  // Saldo akhir & ringkasan dihitung dari seluruh mutasi yang dimuat: bila terpotong, angkanya salah — tolak (bukan potong diam-diam).
  if (hasil.terpotong) throw new ExportError(`Mutasi akun ini melebihi ${MAKS_BARIS.toLocaleString("id-ID")} baris pada periode tersebut. Persempit periode lalu coba lagi.`, 413, "TERLALU_BESAR");

  // Baris yang tampil di layar: bila klien memfilter, ambil persis baris itu menurut urutan layar (ids); selain itu semua mutasi periode.
  let mutasi = hasil.baris;
  if (ids) {
    const peta = new Map(hasil.baris.map((b) => [b.lineId, b]));
    mutasi = ids.map((id) => peta.get(id)).filter(Boolean);
  }
  const { account } = hasil;
  const baris = [
    { tanggal: rentang.fromStr, jurnal: "", keterangan: "Saldo awal periode", sumber: "", status: "", order: "", pelanggan: "", supplier: "", rekening: "", debit: null, kredit: null, saldo: hasil.saldoAwal },
    ...mutasi.map((b) => ({
      tanggal: b.tanggal, jurnal: b.entryNumber, keterangan: keteranganTanpaAlasan(b.keterangan || "", bolehSensitif), sumber: labelSumberJurnal(b.source), status: labelStatusJurnal(b.status),
      order: b.orderNumber || "", pelanggan: b.customerName || "", supplier: b.supplierName || "", rekening: b.cashAccountName || "",
      debit: b.debit, kredit: b.kredit, saldo: b.saldo,
    })),
  ];
  const semuaDebit = jumlah(hasil.baris, "debit");
  const semuaKredit = jumlah(hasil.baris, "kredit");
  const disaring = !!ids && mutasi.length !== hasil.baris.length;

  return {
    nama: "Buku Besar",
    periodeLabel: labelPeriode({ from: rentang.fromStr, to: rentang.toStr }),
    filterLabel: filterLabel || susunLabelFilter([["Akun", `${account.code} · ${account.name}`]]),
    sheets: [
      {
        nama: "Buku Besar", judul: `Buku Besar — ${account.code} · ${account.name}`,
        kolom: [
          { key: "tanggal", header: "Tanggal", tipe: "tanggal" }, { key: "jurnal", header: "No. Jurnal", tipe: "teks", lebar: 20 },
          { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 44 }, { key: "sumber", header: "Sumber", tipe: "teks", lebar: 22 },
          { key: "status", header: "Status", tipe: "teks", lebar: 13 }, { key: "order", header: "Order", tipe: "teks", lebar: 20 },
          { key: "pelanggan", header: "Pelanggan", tipe: "teks", lebar: 22 }, { key: "supplier", header: "Supplier", tipe: "teks", lebar: 22 },
          { key: "rekening", header: "Rekening Kas/Bank", tipe: "teks", lebar: 20 },
          { key: "debit", header: "Debit (Rp)", tipe: "uang" }, { key: "kredit", header: "Kredit (Rp)", tipe: "uang" }, { key: "saldo", header: "Saldo Berjalan (Rp)", tipe: "uang" },
        ],
        baris,
        // Debit/Kredit = jumlah mutasi pada baris yang diekspor; Saldo = saldo akhir periode (kolom kanan layar).
        total: { label: `TOTAL MUTASI (${mutasi.length}) · SALDO AKHIR`, nilai: { debit: jumlah(mutasi, "debit"), kredit: jumlah(mutasi, "kredit"), saldo: hasil.saldoAkhir } },
        catatan: [
          `Saldo normal ${account.normalBalance === "DEBIT" ? "debit" : "kredit"} — saldo berjalan sudah mengikuti arah itu.`,
          ...(disaring ? [`Hanya ${mutasi.length} dari ${hasil.baris.length} mutasi yang diekspor (sesuai filter di layar); kolom Saldo tetap saldo berjalan seluruh periode.`] : []),
        ],
      },
      {
        nama: "Ringkasan", judul: `Ringkasan Buku Besar — ${account.code} · ${account.name}`,
        kolom: [{ key: "uraian", header: "Uraian", tipe: "teks", lebar: 40 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }],
        baris: [
          { uraian: `Saldo Awal (per ${rentang.fromStr})`, nilai: hasil.saldoAwal },
          { uraian: "Jumlah Debit periode", nilai: semuaDebit },
          { uraian: "Jumlah Kredit periode", nilai: semuaKredit },
          { uraian: `Saldo Akhir (per ${rentang.toStr})`, nilai: hasil.saldoAkhir },
        ],
        catatan: [
          `Akun: ${account.code} · ${account.name} (${TIPE_AKUN[account.type] || account.type}); saldo normal ${account.normalBalance === "DEBIT" ? "debit" : "kredit"}.`,
          "Ringkasan menghitung SEMUA mutasi periode (bukan hanya baris yang difilter di layar).",
        ],
      },
    ],
  };
}

export default { kunci: "buku-besar", nama: "Buku Besar", izin: [P.FINANCE_READ], ambil };
