// EXPORT EXCEL — PEMASUKAN. Sumber data = pemasukanTersaring() di services/finance/pemasukan.js (fungsi yang SAMA dengan layar
// GET /api/finance/pemasukan; layar hanya memotong halaman). Filter layar (server): kategori (tab), q, pihak, rekening, status,
// statusBayar, sumber + periode. Total = "total {nilai}" yang tampil di FilterBar layar (tanpa Dikecualikan/Ditolak/Dibatalkan).
// KOLOM "Dihitung ke Total?" + "Nilai yang Dihitung (Rp)" + "Alasan Tidak Dihitung" (audit 1 Nov 2026): kolom "Nilai (Rp)" TETAP nilai historis tiap baris (termasuk yang
// tidak dihitung), jadi SUM mentah kolom itu lebih besar dari TOTAL. SUM kolom "Nilai yang Dihitung" SAMA PERSIS dengan TOTAL dan dengan angka di layar — keduanya diturunkan
// dari satu aturan (statusHitungTotal di services/finance/pemasukan.js), bukan dihitung ulang di sini.
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
    nilai: angka(b.nilai), dihitung: b.dihitung ? "Ya" : "Tidak", nilaiDihitung: angka(b.nilaiDihitung), alasanTidakDihitung: b.alasanTidakDihitung || "", status: b.statusLabel || "", klasifikasi: b.kategoriLabel || "", subKlasifikasi: b.subLabel || "",
    perluTinjau: b.perluTinjau ? "Ya" : "Tidak", catatan: b.catatan || "",
  }));

  // Rekap per klasifikasi (dari baris yang sama): membantu membaca kenapa total layar tidak sama dengan jumlah semua baris.
  const grup = new Map();
  for (const b of tampil) {
    const k = `${b.kategoriLabel}|${b.subLabel}`;
    const g = grup.get(k) || { klasifikasi: b.kategoriLabel, subKlasifikasi: b.subLabel, jumlah: 0, nilai: [], dihitung: [], tidak: 0 };
    g.jumlah += 1; g.nilai.push(toMoney(b._nilai ?? 0));
    if (b.dihitung) g.dihitung.push(toMoney(b._nilai ?? 0)); else g.tidak += 1;
    grup.set(k, g);
  }
  const rekap = [...grup.values()].map((g) => ({ klasifikasi: g.klasifikasi, subKlasifikasi: g.subKlasifikasi, jumlah: g.jumlah, nilai: sumMoney(g.nilai), nilaiDihitung: g.dihitung.length ? sumMoney(g.dihitung) : ZERO, tidakDihitung: g.tidak }));
  const dihitungN = tampil.filter((b) => b.dihitung).length;
  const mentah = tampil.length ? sumMoney(tampil.map((b) => toMoney(b._nilai ?? 0))) : ZERO;
  const tidakNilai = toMoney(mentah).minus(toMoney(totalNilai));

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
          { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "dihitung", header: "Dihitung ke Total?", tipe: "teks", lebar: 14 },
          { key: "nilaiDihitung", header: "Nilai yang Dihitung (Rp)", tipe: "uang", lebar: 20 }, { key: "alasanTidakDihitung", header: "Alasan Tidak Dihitung", tipe: "teks", lebar: 54 },
          { key: "status", header: "Status", tipe: "teks", lebar: 18 },
          { key: "klasifikasi", header: "Klasifikasi", tipe: "teks", lebar: 26 }, { key: "subKlasifikasi", header: "Sub-klasifikasi", tipe: "teks", lebar: 30 },
          { key: "perluTinjau", header: "Perlu Ditinjau", tipe: "teks", lebar: 14 }, { key: "catatan", header: "Catatan Tinjauan", tipe: "teks", lebar: 40 },
        ],
        baris,
        // Sama dengan "total …" di layar: baris Dikecualikan, Ditolak, dan Dibatalkan TIDAK dijumlahkan (tetap tampil sebagai baris).
        // TOTAL berada di kolom "Nilai yang Dihitung (Rp)" (bukan "Nilai (Rp)") supaya SUM kolom itu sama persis dengan baris ini dan dengan layar.
        total: { label: `TOTAL DIHITUNG (${dihitungN} dari ${baris.length} baris)`, nilai: { nilaiDihitung: Number(totalNilai) } },
        catatan: [
          "Total tidak menjumlahkan baris berklasifikasi Dikecualikan (transfer, saldo awal, pembalikan pengeluaran) serta pembayaran Ditolak/Dibatalkan — sama dengan total di layar.",
          `Cara membaca: kolom "Nilai (Rp)" memuat nilai tiap baris apa adanya (termasuk yang tidak dihitung). Jumlah mentah kolom itu = ${Number(mentah).toLocaleString("id-ID")}; baris tidak dihitung = ${(tampil.length - dihitungN).toLocaleString("id-ID")} baris senilai ${Number(tidakNilai).toLocaleString("id-ID")}; selisihnya = TOTAL ${Number(totalNilai).toLocaleString("id-ID")}. Jumlahkan kolom "Nilai yang Dihitung (Rp)" untuk mendapat TOTAL; alasan tiap baris yang tidak dihitung ada di kolom "Alasan Tidak Dihitung".`,
          "Pendapatan Diakui dan Uang Masuk adalah dua metrik berbeda; jangan dijumlahkan (menghitung penjualan yang sama dua kali).",
          ...(terpotong ? ["PERINGATAN: data sangat besar, sebagian dipotong server. Persempit periode."] : []),
        ],
      },
      {
        nama: "Rekap Klasifikasi", judul: "Rekap per Klasifikasi",
        kolom: [
          { key: "klasifikasi", header: "Klasifikasi", tipe: "teks", lebar: 30 }, { key: "subKlasifikasi", header: "Sub-klasifikasi", tipe: "teks", lebar: 36 },
          { key: "jumlah", header: "Jumlah Baris", tipe: "angka" }, { key: "nilai", header: "Nilai Semua Baris (Rp)", tipe: "uang" },
          { key: "tidakDihitung", header: "Baris Tidak Dihitung", tipe: "angka" }, { key: "nilaiDihitung", header: "Nilai yang Dihitung (Rp)", tipe: "uang" },
        ],
        baris: rekap,
        total: { label: "TOTAL", nilai: { jumlah: rekap.reduce((a, r) => a + r.jumlah, 0), nilai: Number(rekap.length ? sumMoney(rekap.map((r) => r.nilai)) : ZERO), tidakDihitung: rekap.reduce((a, r) => a + r.tidakDihitung, 0), nilaiDihitung: Number(rekap.length ? sumMoney(rekap.map((r) => r.nilaiDihitung)) : ZERO) } },
        catatan: ["Rekap ini memuat SEMUA baris di sheet Pemasukan per klasifikasi: kolom \"Nilai Semua Baris\" = jumlah mentah, kolom \"Nilai yang Dihitung\" = bagian yang masuk TOTAL layar (jumlahnya sama dengan kolom \"Nilai yang Dihitung\" di sheet Pemasukan)."],
      },
    ].filter((s) => s.nama === "Pemasukan" || s.baris.length > 0),
  };
}

export default { kunci: "pemasukan", nama: "Pemasukan", izin: [P.FINANCE_READ], ambil };
