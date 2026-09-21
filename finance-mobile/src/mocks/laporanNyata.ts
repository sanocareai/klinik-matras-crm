// SERVER LAPORAN PALSU (mode contoh saja). Menghasilkan payload berbentuk respons backend (uang sebagai string desimal) lalu melewatkannya lewat pemeta yang SAMA
// dengan mode nyata (mapLaporan), sehingga tampilan diuji melalui jalur yang sama. Angka di sini "hasil server" — layar tidak menghitung apa pun.
// Skenario: `negatif` (rugi & saldo negatif utuh), `parsial` (ringkasan hilang), `kosong` (tanpa data), `panjang` (nominal sangat panjang), `basi`/`galat`/`offline`.

import { mapLaporan } from "@/api/laporan";
import { getSkenario, simulasiBaca } from "./skenario";
import type { JenisLaporanNyata, LaporanNyata } from "@/api/types";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const akun = (n: number, code: string, name: string, nilai: string, extra: object = {}) => ({ accountId: id(n), code, name, normalBalance: "DEBIT", nilai, ...extra });

function payload(jenis: JenisLaporanNyata, periode: { from: string; to: string }): unknown {
  const k = getSkenario();
  const negatif = k === "negatif";
  const panjang = k === "panjang";
  const kosong = k === "kosong";
  const catatan = { gapTerbuka: 2, saldoAwalTerisi: true, mulaiPembukuan: "2025-12-01", periodeTerbuka: 1, pesan: ["2 transaksi belum bisa dibukukan (lihat Data Belum Lengkap). Angka laporan ini KURANG dari kenyataan."] };
  const p = { from: `${periode.from}T00:00:00.000Z`, to: `${periode.to}T00:00:00.000Z` };
  if (jenis === "laba-rugi") {
    if (kosong) return { periode: p, pendapatan: [], retur: [], bebanPokok: [], bebanOperasional: [], ringkasan: { pendapatanBruto: "0.00", retur: "0.00", pendapatanBersih: "0.00", bebanPokok: "0.00", labaKotor: "0.00", marginKotor: null, bebanOperasional: "0.00", labaBersih: "0.00", marginBersih: null }, catatan };
    return {
      periode: p,
      pendapatan: [akun(1, "4-1100", "Pendapatan Jasa Layanan", panjang ? "123456789012345.67" : "85950000.00"), akun(2, "4-1200", "Pendapatan Penjualan Produk", "42000000.00")],
      retur: [akun(3, "4-2100", "Retur & Potongan Penjualan", "1500000.00")],
      bebanPokok: [akun(4, "5-1100", "Beban Pokok Bahan Baku", negatif ? "150000000.00" : "38000000.00")],
      bebanOperasional: [akun(5, "6-1200", "Beban Iklan & Pemasaran", "27000000.00"), akun(6, "6-1300", "Beban BBM", "6500000.00")],
      ringkasan: negatif
        ? { pendapatanBruto: "127950000.00", retur: "1500000.00", pendapatanBersih: "126450000.00", bebanPokok: "150000000.00", labaKotor: "-23550000.00", marginKotor: -18.62, bebanOperasional: "33500000.00", labaBersih: "-57050000.00", marginBersih: -45.12 }
        : k === "parsial" ? null
          : { pendapatanBruto: "127950000.00", retur: "1500000.00", pendapatanBersih: "126450000.00", bebanPokok: "38000000.00", labaKotor: "88450000.00", marginKotor: 69.95, bebanOperasional: "33500000.00", labaBersih: "54950000.00", marginBersih: 43.45 },
      catatan,
    };
  }
  if (jenis === "neraca") {
    const seimbang = k !== "parsial" && !negatif;
    return {
      perTanggal: `${periode.to}T00:00:00.000Z`,
      aset: kosong ? [] : [akun(10, "1-1200", "Bank", negatif ? "-12351254.00" : "52875000.50"), akun(11, "1-1100", "Kas", "104500.00"), akun(12, "1-1300", "Piutang Usaha", "24500000.00")],
      kewajiban: kosong ? [] : [{ ...akun(13, "2-1600", "Utang Pihak Ketiga", "-42398335.00"), normalBalance: "KREDIT" }, { ...akun(14, "2-1100", "Utang Usaha", "8500000.00"), normalBalance: "KREDIT" }],
      ekuitas: kosong ? [] : [{ ...akun(15, "3-1100", "Modal Disetor", "50000000.00"), normalBalance: "KREDIT" }, { ...akun(16, "3-4100", "Koreksi Saldo Awal", "-90397439.10"), normalBalance: "KREDIT" }, { accountId: "laba-tahun-sebelumnya", code: "—", name: "Laba/rugi tahun-tahun sebelumnya (belum ditutup ke Laba Ditahan)", normalBalance: "KREDIT", nilai: "-45834231.00" }],
      labaTahunSebelumnya: "-45834231.00", labaTahunBerjalan: "120000000.00",
      ringkasan: k === "parsial" ? null : { totalAset: "77479500.50", totalKewajiban: "-33898335.00", totalEkuitas: "111377835.50", totalPasiva: "77479500.50", seimbang, selisih: seimbang ? "0.00" : "1500000.00" },
      catatan,
    };
  }
  if (jenis === "arus-kas") {
    return {
      periode: p, operasi: kosong ? [] : [{ accountId: id(20), code: "4-1100", name: "Pendapatan Jasa Layanan", nilai: "85950000.00" }, { accountId: id(21), code: "6-1200", name: "Beban Iklan & Pemasaran", nilai: "-27000000.00" }],
      investasi: kosong ? [] : [{ accountId: id(22), code: "1-2200", name: "Aset Peralatan", nilai: "-4500000.00" }], pendanaan: [], takTerkategori: kosong ? [] : [{ accountId: id(23), code: "6-1900", name: "Beban Lain-lain", nilai: "-100000.00" }],
      ringkasan: k === "parsial" ? null : { saldoAwal: "20000000.00", masuk: "85950000.00", keluar: "31600000.00", arusBersih: "54350000.00", saldoAkhir: "74350000.00" }, catatan,
    };
  }
  if (jenis === "neraca-saldo") {
    const seimbang = k !== "parsial" && !negatif;
    return {
      periode: p,
      baris: kosong ? [] : [
        { accountId: id(10), code: "1-1200", name: "Bank", type: "ASET", normalBalance: "DEBIT", mutasiDebit: "30000000.00", mutasiKredit: "3200000.00", saldoDebit: "26800000.00", saldoKredit: "0.00", saldo: "26800000.00" },
        { accountId: id(15), code: "3-1100", name: "Modal Disetor", type: "EKUITAS", normalBalance: "KREDIT", mutasiDebit: "0.00", mutasiKredit: "30000000.00", saldoDebit: "0.00", saldoKredit: "30000000.00", saldo: "30000000.00" },
        { accountId: id(6), code: "6-1300", name: "Beban BBM", type: "BEBAN", normalBalance: "DEBIT", mutasiDebit: "3200000.00", mutasiKredit: "0.00", saldoDebit: "3200000.00", saldoKredit: "0.00", saldo: "3200000.00" },
      ],
      total: k === "parsial" ? null : { mutasiDebit: "33200000.00", mutasiKredit: seimbang ? "33200000.00" : "33170000.00", seimbang, selisih: seimbang ? "0.00" : "30000.00" }, catatan,
    };
  }
  const per = periode.to;
  if (jenis === "umur-piutang") {
    return {
      perTanggal: per, total: kosong ? "0.00" : "5500000.00", ember: [], menungguVerifikasi: { jumlah: 1, total: "700000.00" },
      ringkasan: { belum_jatuh_tempo: "3500000.00", "1_30": "1500000.00", "31_60": "500000.00", "61_90": "0.00", "90_plus": "0.00" },
      baris: kosong ? [] : [
        { orderId: id(31), orderNumber: "SAN-0001", invoiceNumber: "INV-01092026-004", customerName: "Ibu Sari", sisaTagihan: "1500000.00", nilaiOrder: "2000000.00", hariLewat: 12, ember: "1_30", sumberJatuhTempo: "invoice" },
        { orderId: id(32), orderNumber: "SAN-0002", invoiceNumber: null, customerName: "Bapak Budi", sisaTagihan: "3500000.00", nilaiOrder: "3500000.00", hariLewat: -10, ember: "belum_jatuh_tempo", sumberJatuhTempo: "tanggal_order" },
        { orderId: id(33), orderNumber: "SAN-0003", invoiceNumber: "INV-05082026-002", customerName: "Ibu Wati", sisaTagihan: "500000.00", nilaiOrder: "500000.00", hariLewat: 45, ember: "31_60", sumberJatuhTempo: "invoice" },
      ], catatan,
    };
  }
  return {
    perTanggal: per, total: kosong ? "0.00" : "1000000.00", ember: [], ringkasan: { belum_jatuh_tempo: "0.00", "1_30": "0.00", "31_60": "600000.00", "61_90": "400000.00", "90_plus": "0.00" },
    baris: kosong ? [] : [
      { billId: id(41), billNumber: "BILL-01082026-001", supplierName: "CV Busa Jaya", nilaiTagihan: "1000000.00", terbayar: "400000.00", sisa: "600000.00", hariLewat: 40, ember: "31_60", sumberJatuhTempo: "tagihan" },
      { billId: id(42), billNumber: "BILL-15072026-003", supplierName: "Toko Kain Makmur", nilaiTagihan: "400000.00", terbayar: "0.00", sisa: "400000.00", hariLewat: 70, ember: "61_90", sumberJatuhTempo: "tanggal_tagihan" },
    ], catatan,
  };
}

export async function mockLaporanNyata(jenis: JenisLaporanNyata, periode: { from: string; to: string }): Promise<LaporanNyata> {
  await simulasiBaca(`laporan:${jenis}`);
  return mapLaporan(jenis, payload(jenis, periode), periode.to);
}
