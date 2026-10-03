// EXPORT EXCEL — REKONSILIASI REKENING (satu workbook lengkap, Rekonsiliasi Bank V2). Isinya = angka panel (hitungPanel) + tiga tab lain (Mutasi Buku, Mutasi Bank, Pencocokan) dari
// FUNGSI YANG SAMA dengan layar, jadi tidak ada angka yang bisa berbeda antara layar dan berkas. Rekening KAS memakai hitung fisik (opname), bukan rekening koran.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { hitungPanel, laporanJurnalTanpaRekening } from "../bankRekon/panel.js";
import { POLA_UUID } from "../bankRekon/shared.js";
import { ExportError, susunLabelFilter, labelPeriode } from "./excel.js";
import mutasiBuku from "./mutasi-rekening.js";
import mutasiBank from "./mutasi-bank.js";
import pencocokan from "./pencocokan-bank.js";

const SUMBER = { REKENING_KORAN: "Rekening koran", OPNAME_FISIK: "Hitung fisik kas", DIISI_PENGGUNA: "Diisi manual", RANTAI_SALDO_KORAN: "Kolom saldo rekening koran" };

async function ambil(db, ctx) {
  const { filter, periode } = ctx;
  const cashAccountId = String(filter.cashAccountId || "");
  if (!POLA_UUID.test(cashAccountId)) throw new ExportError("Pilih rekening yang akan diekspor", 400, "REKENING_WAJIB");
  const rentang = rentangDariQuery({ from: periode.from ?? filter.from, to: periode.to ?? filter.to });
  const panel = await hitungPanel(db, { cashAccountId, to: rentang.toStr, saldoBankAkhir: filter.saldoBankAkhir ?? null, saldoBankAwal: filter.saldoBankAwal ?? null });
  const nama = panel.rekening.nama;
  const kas = panel.jenisSaldo === "OPNAME_FISIK";

  const sheetRingkasan = {
    nama: "Rekonsiliasi", judul: `Rekonsiliasi ${kas ? "Kas" : "Bank"} — ${nama} (sampai ${rentang.toStr})`,
    kolom: [{ key: "uraian", header: "Uraian", tipe: "teks", lebar: 56 }, { key: "nilai", header: "Rp", tipe: "uang" }, { key: "catatan", header: "Keterangan", tipe: "teks", lebar: 70 }],
    baris: [
      { uraian: "Saldo buku", nilai: panel.saldoBuku, catatan: panel.definisi.saldoBuku },
      { uraian: kas ? "Saldo hitung fisik (opname)" : "Saldo rekening koran", nilai: panel.saldoBank, catatan: panel.saldoBank ? `Sumber: ${SUMBER[panel.sumberSaldoBank] || panel.sumberSaldoBank}${panel.tanggalSaldoBank ? `, per ${panel.tanggalSaldoBank}` : ""}` : "Belum diketahui" },
      { uraian: "SELISIH (buku − bank/kas)", nilai: panel.selisih, catatan: panel.definisi.selisih },
      ...(panel.komponen ? [
        { uraian: "Selisih saldo awal", nilai: panel.komponen.selisihSaldoAwal.efek, catatan: panel.komponen.selisihSaldoAwal.catatan },
        { uraian: `Bank belum dibukukan (${panel.komponen.bankBelumDibukukan.jumlah} baris)`, nilai: panel.komponen.bankBelumDibukukan.efek, catatan: panel.definisi.bankBelumDibukukan },
        { uraian: `Buku belum muncul di bank (${panel.komponen.bukuBelumMuncul.jumlah} baris)`, nilai: panel.komponen.bukuBelumMuncul.efek, catatan: panel.definisi.bukuBelumMuncul },
        { uraian: `Perbedaan cutoff (${panel.komponen.perbedaanCutoff.jumlah})`, nilai: panel.komponen.perbedaanCutoff.efek, catatan: panel.definisi.perbedaanCutoff },
        { uraian: `Penyesuaian buku (${panel.komponen.penyesuaianBuku.jumlah})`, nilai: panel.komponen.penyesuaianBuku.efek, catatan: panel.definisi.penyesuaianBuku },
        { uraian: `Dikecualikan (${panel.komponen.dikecualikan.jumlahBank} bank, ${panel.komponen.dikecualikan.jumlahBuku} buku)`, nilai: panel.komponen.dikecualikan.efek, catatan: panel.definisi.dikecualikan },
      ] : []),
      { uraian: "SELISIH BELUM DIJELASKAN", nilai: panel.belumDijelaskan, catatan: panel.definisi.belumDijelaskan },
      { uraian: "Exception terbuka (jumlah)", nilai: panel.exceptionTerbuka, catatan: "Harus 0 untuk menyelesaikan periode." },
      { uraian: "Bisa diselesaikan?", nilai: null, catatan: panel.bisaSelesai ? "Ya" : `Belum: ${panel.alasanBelumBisa.join("; ")}` },
    ],
    catatan: [
      "Angka efek = pengaruh pada selisih (buku − bank). Bank belum dibukukan bernilai positif bila bank mencatat uang KELUAR yang belum ada di buku.",
      ...(panel.paritas.cocok ? [] : ["PERHATIAN: saldo kartu Kas & Bank tidak sama dengan saldo mutasi."]),
    ],
  };
  const sheetException = {
    nama: "Exception", judul: `Exception — ${nama}`,
    kolom: [{ key: "kode", header: "Jenis", tipe: "teks", lebar: 26 }, { key: "pesan", header: "Keterangan", tipe: "teks", lebar: 80 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "status", header: "Status", tipe: "teks", lebar: 14 }],
    baris: panel.exception.map((e) => ({ kode: e.kode, pesan: e.pesan, nilai: e.nilai, status: e.terbuka ? "Terbuka" : "Ditinjau" })),
    catatan: ["Jurnal lama tanpa rekening (mis. Fee Farhan Rp6.715.170) sengaja TIDAK diubah atau ditebak rekeningnya — dilaporkan di sini sampai dikoreksi (jurnal balik + pengganti) atau ditinjau."],
  };
  const lap = await laporanJurnalTanpaRekening(db, { sampai: rentang.toStr });
  const sheetTanpaRekening = {
    nama: "Jurnal Tanpa Rekening", judul: "Jurnal pada akun Kas/Bank tanpa rekening",
    kolom: [{ key: "nomor", header: "No. Jurnal", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal Buku", tipe: "tanggal" }, { key: "dibuat", header: "Dibuat Pada", tipe: "waktu" }, { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 44 }, { key: "aktor", header: "Dibuat Oleh", tipe: "teks", lebar: 18 }, { key: "masuk", header: "Masuk (Rp)", tipe: "uang" }, { key: "keluar", header: "Keluar (Rp)", tipe: "uang" }, { key: "kandidat", header: "Kandidat rekening", tipe: "teks", lebar: 30 }, { key: "status", header: "Status", tipe: "teks", lebar: 12 }],
    baris: lap.items.map((i) => ({ nomor: i.nomor, tanggal: i.tanggalBuku, dibuat: i.dibuatPada, keterangan: i.keterangan, aktor: i.aktor || "", masuk: i.masuk, keluar: i.keluar, kandidat: i.kandidatRekening.map((k) => k.nama).join(", "), status: i.ditinjau ? "Ditinjau" : "Terbuka" })),
    catatan: [lap.catatan],
  };
  const sheetSkenario = panel.skenarioJurnalTanpaRekening.length ? {
    nama: "Skenario Tanpa Rekening", judul: "Skenario: bila jurnal tanpa rekening terbukti milik rekening ini (BELUM ditautkan)",
    kolom: [{ key: "nomor", header: "No. Jurnal", tipe: "teks", lebar: 20 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "buku", header: "Saldo buku jika milik rekening ini", tipe: "uang" }, { key: "selisih", header: "Selisih buku − bank jika milik rekening ini", tipe: "uang" }],
    baris: panel.skenarioJurnalTanpaRekening.map((s) => ({ nomor: s.nomor, nilai: s.nilai, buku: s.jikaMilikRekeningIni.saldoBuku, selisih: s.jikaMilikRekeningIni.selisihBukuMinusBank })),
    catatan: ["Hanya perhitungan 'bagaimana jika'. Sistem tidak menautkan jurnal itu ke rekening mana pun."],
  } : null;

  const sub = { ...ctx, filter: { ...filter, from: filter.from || periode.from || rentang.fromStr, to: rentang.toStr } };
  const sheetsLain = [];
  const tambah = async (modul, prefix) => { const d = await modul.ambil(db, sub); for (const sh of d.sheets) sheetsLain.push({ ...sh, nama: `${prefix} ${sh.nama}`.slice(0, 31) }); };
  await tambah(mutasiBuku, "Buku");
  if (!kas) { await tambah(mutasiBank, "Bank"); await tambah(pencocokan, "Cocok"); }

  return {
    nama: "Rekonsiliasi Rekening",
    periodeLabel: labelPeriode({ from: rentang.fromStr, to: rentang.toStr }),
    filterLabel: ctx.filterLabel || susunLabelFilter([["Rekening", nama]]),
    sheets: [sheetRingkasan, sheetException, sheetTanpaRekening, ...(sheetSkenario ? [sheetSkenario] : []), ...sheetsLain],
  };
}

export default { kunci: "rekonsiliasi-rekening", nama: "Rekonsiliasi Rekening", izin: [P.FINANCE_READ], ambil };
