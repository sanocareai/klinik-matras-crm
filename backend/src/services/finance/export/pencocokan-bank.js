// EXPORT EXCEL — PENCOCOKAN BANK ↔ BUKU. Sumber data = daftarPencocokan() (services/finance/bankRekon/pencocokan.js), fungsi yang SAMA dengan layar tab Pencocokan.
// Sheet: Bank Belum Dicocokkan, Buku Belum Dicocokkan, Saran Kombinasi, Pencocokan Aktif (satu baris per anggota kelompok), Ringkasan.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { daftarPencocokan } from "../bankRekon/pencocokan.js";
import { POLA_UUID } from "../bankRekon/shared.js";
import { ExportError, susunLabelFilter, labelPeriode } from "./excel.js";

async function ambil(db, { filter, periode }) {
  const cashAccountId = String(filter.cashAccountId || "");
  if (!POLA_UUID.test(cashAccountId)) throw new ExportError("Pilih rekening yang akan diekspor", 400, "REKENING_WAJIB");
  const rentang = rentangDariQuery({ from: periode.from ?? filter.from, to: periode.to ?? filter.to });
  const h = await daftarPencocokan(db, { cashAccountId, to: rentang.toStr, from: filter.from || periode.from || null });
  const nama = h.rekening.nama;
  const kandidatBank = (k) => (k || []).map((x) => `${x.nomor} (${x.selisihHari >= 0 ? "+" : ""}${x.selisihHari} hari)`).join("; ");
  const kandidatBuku = (k) => (k || []).map((x) => `${x.tanggal} ${x.deskripsi} (${x.selisihHari >= 0 ? "+" : ""}${x.selisihHari} hari)`).join("; ");
  const anggota = [];
  for (const g of h.kelompok) {
    for (const b of g.bank) anggota.push({ jenis: g.jenis === "KECUALI" ? "Dikecualikan" : g.jenis === "OTOMATIS" ? "Cocok otomatis" : "Cocok manual", bentuk: g.bentuk, kategori: g.kategoriLabel || "", sisi: "Bank", tanggal: b.tanggal, rujukan: b.referensi || "", keterangan: b.deskripsi, masuk: b.masuk, keluar: b.keluar, alasan: g.alasan || "" });
    for (const j of g.buku) anggota.push({ jenis: g.jenis === "KECUALI" ? "Dikecualikan" : g.jenis === "OTOMATIS" ? "Cocok otomatis" : "Cocok manual", bentuk: g.bentuk, kategori: g.kategoriLabel || "", sisi: "Buku", tanggal: j.tanggalBuku, rujukan: j.nomor, keterangan: j.deskripsi, masuk: j.masuk, keluar: j.keluar, alasan: g.alasan || "" });
  }
  const KOL_BANK = [
    { key: "tanggal", header: "Tanggal Bank", tipe: "tanggal" }, { key: "deskripsi", header: "Keterangan Bank", tipe: "teks", lebar: 48 }, { key: "referensi", header: "Referensi", tipe: "teks", lebar: 20 },
    { key: "masuk", header: "Masuk (Rp)", tipe: "uang" }, { key: "keluar", header: "Keluar (Rp)", tipe: "uang" }, { key: "status", header: "Status", tipe: "teks", lebar: 20 }, { key: "kandidat", header: "Kandidat di buku", tipe: "teks", lebar: 44 },
  ];
  const KOL_BUKU = [
    { key: "tanggal", header: "Tanggal Buku", tipe: "tanggal" }, { key: "dibuat", header: "Dibuat Pada", tipe: "waktu" }, { key: "nomor", header: "No. Jurnal", tipe: "teks", lebar: 20 }, { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 44 },
    { key: "sumber", header: "Sumber", tipe: "teks", lebar: 22 }, { key: "aktor", header: "Dibuat Oleh", tipe: "teks", lebar: 18 }, { key: "masuk", header: "Masuk (Rp)", tipe: "uang" }, { key: "keluar", header: "Keluar (Rp)", tipe: "uang" },
    { key: "status", header: "Status", tipe: "teks", lebar: 20 }, { key: "kandidat", header: "Kandidat di bank", tipe: "teks", lebar: 44 },
  ];
  const jum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const barisBank = h.bank.map((b) => ({ tanggal: b.tanggal, deskripsi: b.deskripsi, referensi: b.referensi || "", masuk: b.masuk, keluar: b.keluar, status: b.statusLabel, kandidat: kandidatBank(b.kandidat) }));
  const barisBuku = h.buku.map((j) => ({ tanggal: j.tanggalBuku, dibuat: j.dibuatPada, nomor: j.nomor, keterangan: j.deskripsi, sumber: j.sumberLabel, aktor: j.aktor || "", masuk: j.masuk, keluar: j.keluar, status: j.statusLabel, kandidat: kandidatBuku(j.kandidat) }));
  return {
    nama: "Pencocokan Bank",
    periodeLabel: labelPeriode({ from: h.dari, to: rentang.toStr }),
    filterLabel: susunLabelFilter([["Rekening", nama]]),
    sheets: [
      { nama: "Bank Belum Dicocokkan", judul: `Baris bank belum dicocokkan — ${nama}`, kolom: KOL_BANK, baris: barisBank, total: { label: `TOTAL (${barisBank.length})`, nilai: { masuk: jum(barisBank, "masuk"), keluar: jum(barisBank, "keluar") } }, catatan: ["Baris bank yang belum ada padanannya di buku. Pencatatan ke buku dilakukan lewat dokumen normal (pengeluaran, pemasukan, transfer) — tidak otomatis dari bank."] },
      { nama: "Buku Belum Dicocokkan", judul: `Baris buku belum dicocokkan — ${nama}`, kolom: KOL_BUKU, baris: barisBuku, total: { label: `TOTAL (${barisBuku.length})`, nilai: { masuk: jum(barisBuku, "masuk"), keluar: jum(barisBuku, "keluar") } }, catatan: ["Jurnal beserta pembaliknya yang saling meniadakan tidak ikut daftar ini."] },
      {
        nama: "Saran Kombinasi", judul: `Saran pencocokan 1:N / N:1 — ${nama}`,
        kolom: [{ key: "bentuk", header: "Bentuk", tipe: "teks", lebar: 9 }, { key: "ambigu", header: "Ambigu?", tipe: "teks", lebar: 9 }, { key: "bank", header: "Baris Bank", tipe: "teks", lebar: 56 }, { key: "buku", header: "Baris Buku", tipe: "teks", lebar: 56 }],
        baris: h.kombinasi.map((k) => ({ bentuk: k.bentuk, ambigu: k.ambigu ? "Ya" : "Tidak", bank: k.bank.map((b) => `${b.tanggal} ${b.deskripsi} ${b.masuk ? `+${b.masuk}` : `-${b.keluar}`}`).join(" | "), buku: k.buku.map((j) => `${j.nomor} ${j.masuk ? `+${j.masuk}` : `-${j.keluar}`}`).join(" | ") })),
        catatan: ["Saran kombinasi tidak pernah dicocokkan otomatis — wajib dikonfirmasi manual dengan alasan."],
      },
      { nama: "Pencocokan Aktif", judul: `Pencocokan & pengecualian aktif — ${nama}`, kolom: [
        { key: "jenis", header: "Jenis", tipe: "teks", lebar: 16 }, { key: "bentuk", header: "Bentuk", tipe: "teks", lebar: 11 }, { key: "kategori", header: "Kategori", tipe: "teks", lebar: 22 }, { key: "sisi", header: "Sisi", tipe: "teks", lebar: 7 },
        { key: "tanggal", header: "Tanggal", tipe: "tanggal" }, { key: "rujukan", header: "Referensi / No. Jurnal", tipe: "teks", lebar: 22 }, { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 44 },
        { key: "masuk", header: "Masuk (Rp)", tipe: "uang" }, { key: "keluar", header: "Keluar (Rp)", tipe: "uang" }, { key: "alasan", header: "Alasan", tipe: "teks", lebar: 44 },
      ], baris: anggota },
      {
        nama: "Ringkasan", judul: `Ringkasan Pencocokan — ${nama}`, kolom: [{ key: "uraian", header: "Uraian", tipe: "teks", lebar: 44 }, { key: "nilai", header: "Nilai", tipe: "angka" }],
        baris: [
          { uraian: "Baris bank belum dicocokkan", nilai: h.ringkasan.bankBelumDicocokkan }, { uraian: "Nilai bersih bank belum dicocokkan (masuk − keluar)", nilai: h.ringkasan.nilaiBankBelum },
          { uraian: "Baris buku belum dicocokkan", nilai: h.ringkasan.bukuBelumDicocokkan }, { uraian: "Nilai bersih buku belum dicocokkan (masuk − keluar)", nilai: h.ringkasan.nilaiBukuBelum },
          { uraian: "Baris berstatus Disarankan", nilai: h.ringkasan.disarankan }, { uraian: "Bisa dicocokkan otomatis (1:1 tidak ambigu)", nilai: h.ringkasan.bisaOtomatis },
          { uraian: "Kelompok cocok", nilai: h.ringkasan.cocok }, { uraian: "Kelompok dikecualikan", nilai: h.ringkasan.dikecualikan },
        ],
      },
    ],
  };
}

export default { kunci: "pencocokan-bank", nama: "Pencocokan Bank", izin: [P.FINANCE_READ], ambil };
