// EXPORT EXCEL — PEMASUKAN. Sumber data = pemasukanTersaring() di services/finance/pemasukan.js (fungsi yang SAMA dengan layar
// GET /api/finance/pemasukan; layar hanya memotong halaman). Filter layar (server): kategori (tab), q, pihak, rekening, status,
// statusBayar, sumber + periode. Total = "total {nilai}" yang tampil di FilterBar layar (tanpa Dikecualikan/Ditolak/Dibatalkan).
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { pemasukanTersaring, KATEGORI } from "../pemasukan.js";
import { toMoney, sumMoney, ZERO } from "../money.js";
import { susunLabelFilter, labelPeriode } from "./excel.js";
import { keteranganTanpaAlasan } from "./label.js";

// Nilai desimal (string) → number untuk sel Excel; jumlah dihitung server dengan Decimal, bukan float.
const angka = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

async function ambil(db, { filter, periode, filterLabel, bolehSensitif }) {
  const query = {
    from: periode.from ?? filter.from, to: periode.to ?? filter.to,
    kategori: filter.kategori, q: filter.q, pihak: filter.pihak, rekening: filter.rekening,
    status: filter.status, statusBayar: filter.statusBayar, sumber: filter.sumber,
  };
  const { p, kategori, tampil, terpotong, totalNilai } = await pemasukanTersaring(db, query);

  const baris = tampil.map((b) => ({
    tanggal: b.tanggal, nomor: b.nomor, sumber: b.sumberLabel, pihak: b.pihak || "", keterangan: keteranganTanpaAlasan(b.keterangan || "", bolehSensitif), rekening: b.rekening || "",
    statusBayar: b.statusBayar ? `${b.statusBayar.label}${b.statusBayar.rekeningBelumDiketahui ? " (rekening belum diketahui)" : ""}` : (b.payLabel || ""),
    bruto: b.bruto !== undefined ? angka(b.bruto) : null, retur: b.retur !== undefined ? angka(b.retur) : null,
    nilai: angka(b.nilai), status: b.statusLabel || "", klasifikasi: b.kategoriLabel || "", subKlasifikasi: b.subLabel || "",
    perluTinjau: b.perluTinjau ? "Ya" : "Tidak", catatan: b.catatan || "",
  }));

  // Rekap per klasifikasi (dari baris yang sama): membantu membaca kenapa total layar tidak sama dengan jumlah semua baris.
  const grup = new Map();
  for (const b of tampil) {
    const k = `${b.kategoriLabel}|${b.subLabel}`;
    const g = grup.get(k) || { klasifikasi: b.kategoriLabel, subKlasifikasi: b.subLabel, jumlah: 0, nilai: [] };
    g.jumlah += 1; g.nilai.push(toMoney(b._nilai ?? 0));
    grup.set(k, g);
  }
  const rekap = [...grup.values()].map((g) => ({ klasifikasi: g.klasifikasi, subKlasifikasi: g.subKlasifikasi, jumlah: g.jumlah, nilai: sumMoney(g.nilai) }));

  const labelKategori = kategori ? KATEGORI[kategori].label : "";
  return {
    nama: "Pemasukan",
    periodeLabel: labelPeriode({ from: p.from, to: p.to }),
    filterLabel: filterLabel || susunLabelFilter([["Kategori", labelKategori], ["Status", filter.status], ["Status pembayaran", filter.statusBayar], ["Rekening", filter.rekening], ["Pelanggan/pembayar", filter.pihak], ["Pencarian", filter.q]]),
    sheets: [
      {
        nama: "Pemasukan", judul: `Pemasukan${labelKategori ? ` — ${labelKategori}` : ""}`,
        kolom: [
          { key: "tanggal", header: "Tanggal", tipe: "tanggal" }, { key: "nomor", header: "Nomor", tipe: "teks", lebar: 22 },
          { key: "sumber", header: "Sumber", tipe: "teks", lebar: 26 }, { key: "pihak", header: "Pelanggan/Pembayar", tipe: "teks", lebar: 24 },
          { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 40 }, { key: "rekening", header: "Rekening", tipe: "teks", lebar: 20 },
          { key: "statusBayar", header: "Status Pembayaran", tipe: "teks", lebar: 22 },
          { key: "bruto", header: "Penjualan Bruto (Rp)", tipe: "uang" }, { key: "retur", header: "Retur/Potongan (Rp)", tipe: "uang" },
          { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "status", header: "Status", tipe: "teks", lebar: 18 },
          { key: "klasifikasi", header: "Klasifikasi", tipe: "teks", lebar: 26 }, { key: "subKlasifikasi", header: "Sub-klasifikasi", tipe: "teks", lebar: 30 },
          { key: "perluTinjau", header: "Perlu Ditinjau", tipe: "teks", lebar: 14 }, { key: "catatan", header: "Catatan Tinjauan", tipe: "teks", lebar: 40 },
        ],
        baris,
        // Sama dengan "total …" di layar: baris Dikecualikan, Ditolak, dan Dibatalkan TIDAK dijumlahkan (tetap tampil sebagai baris).
        total: { label: `TOTAL (${baris.length} baris)`, nilai: { nilai: Number(totalNilai) } },
        catatan: [
          "Total tidak menjumlahkan baris berklasifikasi Dikecualikan (transfer, saldo awal, pembalikan pengeluaran) serta pembayaran Ditolak/Dibatalkan — sama dengan total di layar.",
          "Pendapatan Diakui dan Uang Masuk adalah dua metrik berbeda; jangan dijumlahkan (menghitung penjualan yang sama dua kali).",
          ...(terpotong ? ["PERINGATAN: data sangat besar, sebagian dipotong server. Persempit periode."] : []),
        ],
      },
      {
        nama: "Rekap Klasifikasi", judul: "Rekap per Klasifikasi",
        kolom: [
          { key: "klasifikasi", header: "Klasifikasi", tipe: "teks", lebar: 30 }, { key: "subKlasifikasi", header: "Sub-klasifikasi", tipe: "teks", lebar: 36 },
          { key: "jumlah", header: "Jumlah Baris", tipe: "angka" }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" },
        ],
        baris: rekap,
        total: { label: "TOTAL semua baris", nilai: { jumlah: rekap.reduce((a, r) => a + r.jumlah, 0), nilai: Number(rekap.length ? sumMoney(rekap.map((r) => r.nilai)) : ZERO) } },
        catatan: ["Rekap ini menjumlahkan SEMUA baris di sheet Pemasukan (termasuk yang dikecualikan dari total layar), dikelompokkan menurut klasifikasi."],
      },
    ].filter((s) => s.nama === "Pemasukan" || s.baris.length > 0),
  };
}

export default { kunci: "pemasukan", nama: "Pemasukan", izin: [P.FINANCE_READ], ambil };
