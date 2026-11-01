// Kas & Bank — logika penyajian murni (tanpa React). Tidak mengubah rumus saldo/selisih/status; tampilan diperiksa di browser terpisah.
import test from "node:test";
import assert from "node:assert/strict";
import {
  tabAktifKas, nomorSamar, warnaKartu, saringRekening, statusPencocokan, catatanKartu, cakupanTotal, kalimatRekening,
  kalimatMutasi, catatanPosisiMutasi, pencocokanBaris, statusTransfer, komponenTransfer, saringTransfer, kalimatTransfer, BATAS_TRANSFER,
} from "../src/features/finance/kasbank/kasBankTampilan.js";

test("deep link lama ?tab=mutasi menampilkan daftar rekening yang sama; tab lain tetap", () => {
  assert.equal(tabAktifKas("mutasi"), "rekening");
  assert.equal(tabAktifKas("rekening"), "rekening");
  assert.equal(tabAktifKas("transfer"), "transfer");
  assert.equal(tabAktifKas("pemasukan"), "pemasukan");
});

test("nomor rekening disamarkan di kartu; nomor pendek/kosong tidak dirusak", () => {
  assert.equal(nomorSamar("8830123900"), "••••3900");
  assert.equal(nomorSamar("8830 1239 00"), "••••3900");
  assert.equal(nomorSamar("1234"), "1234");
  assert.equal(nomorSamar(null), "");
});

test("warna kartu hanya identitas jenis (bank dikenali dari data rekening, bukan nama)", () => {
  assert.equal(warnaKartu({ kind: "KAS" }), "lime");
  assert.equal(warnaKartu({ kind: "EWALLET" }), "muda");
  assert.equal(warnaKartu({ kind: "BANK", bankName: "BCA" }), "putih");
  assert.equal(warnaKartu({ kind: "BANK", bankName: "Mandiri" }), "lavender");
  assert.equal(warnaKartu({ kind: "BANK", bankName: "Bank X", name: "BCA Operasional" }), "lavender"); // nama rekening tidak dipakai menebak bank
});

test("status pencocokan: data tidak tersedia bukan Rp0, dan 0 baris belum dipasangkan bukan 'semua diperiksa'", () => {
  const bank = (k, ekstra = {}) => statusPencocokan({ kind: "BANK", k, sakelarAktif: true, ...ekstra });
  assert.equal(bank({ saldoBank: null, selisih: null, belumCocok: 0 }).kode, "koran-belum-diimpor");
  assert.equal(statusPencocokan({ kind: "KAS", k: { saldoBank: null, selisih: null }, sakelarAktif: true }).kode, "kas-belum-dihitung");
  assert.equal(statusPencocokan({ kind: "KAS", k: { saldoBank: null, selisih: null }, sakelarAktif: false }).kode, "kas-belum-dihitung"); // fitur mati tidak mengubah fakta "belum dihitung"
  const sama = bank({ saldoBank: "1000000.00", selisih: "0.00", tanggalSaldoBank: "2026-10-30", sumberSaldoBank: "REKENING_KORAN" });
  assert.equal(sama.kode, "sama"); assert.equal(sama.tanggal, "2026-10-30"); assert.equal(sama.sumber, "rekening koran");
  const beda = bank({ saldoBank: "5100000.00", selisih: "-82537.00", tanggalSaldoBank: "2026-10-29", sumberSaldoBank: "REKENING_KORAN" });
  assert.equal(beda.kode, "selisih"); assert.equal(beda.selisih, "-82537.00");
  const fisik = statusPencocokan({ kind: "KAS", k: { saldoBank: "391500.00", selisih: "0.00", tanggalSaldoBank: "2026-10-31", sumberSaldoBank: "OPNAME_FISIK" }, sakelarAktif: true });
  assert.equal(fisik.sumber, "hitung fisik"); assert.match(fisik.label, /hitung fisik/); // sumber benar: bukan "saldo bank terverifikasi"
  assert.equal(bank(null, { kartuTermuat: false }).kode, "memuat");
  assert.equal(bank(null, { kartuGagal: true }).kode, "gagal");
  assert.equal(bank(null).kode, "tidak-tersedia");
  // selisih kecil Rp0,01 bukan "sama"
  assert.equal(bank({ saldoBank: "10.00", selisih: "0.01", tanggalSaldoBank: "2026-10-30" }).kode, "selisih");
});

test("catatan kartu: baris belum dipasangkan hanya bila >0; rekonsiliasi hanya dibicarakan bila fitur aktif", () => {
  assert.deepEqual(catatanKartu({ k: { belumCocok: 0, terakhirDirekonsiliasi: null }, sakelarAktif: false }), []);
  assert.deepEqual(catatanKartu({ k: { belumCocok: 14, terakhirDirekonsiliasi: "2026-10-12" }, sakelarAktif: true }).map((c) => c.kode), ["belum-dipasangkan", "rekon"]);
  assert.equal(catatanKartu({ k: { belumCocok: 0, terakhirDirekonsiliasi: null }, sakelarAktif: true })[0].kode, "rekon-belum");
  assert.deepEqual(catatanKartu({ k: null, sakelarAktif: true }), []);
});

test("pencarian & filter rekening sama dengan halaman lama; rekening nonaktif tidak dicari lewat saldo", () => {
  const daftar = [
    { id: "1", name: "BCA PT SANO", kind: "BANK", bankName: "BCA", accountNumber: "8830123900", active: true, saldo: 1000000, account: { code: "1-1110", name: "Bank BCA" } },
    { id: "2", name: "Uang Kas", kind: "KAS", active: true, saldo: 391500 },
    { id: "3", name: "BNI lama", kind: "BANK", bankName: "BNI", active: false, saldo: 0 },
  ];
  const id = (f) => saringRekening(daftar, { q: "", jenis: "", status: "", ...f }).map((a) => a.id);
  assert.deepEqual(id({}), ["1", "2", "3"]);
  assert.deepEqual(id({ jenis: "KAS" }), ["2"]);
  assert.deepEqual(id({ status: "nonaktif" }), ["3"]);
  assert.deepEqual(id({ status: "aktif" }), ["1", "2"]);
  assert.deepEqual(id({ q: "1-1110" }), ["1"]);
  assert.deepEqual(id({ q: "1.000.000" }), ["1"]);
  assert.deepEqual(id({ q: "kas tunai" }), ["2"]);
  assert.deepEqual(id({ q: "nonaktif" }), ["3"]);
  assert.equal(kalimatRekening({ tampil: 2, total: 3 }), "2 dari 3 rekening");
  assert.equal(kalimatRekening({ tampil: 3, total: 3 }), "3 rekening");
  assert.deepEqual(cakupanTotal({ accounts: daftar, hariIni: "2026-11-01" }), { aktif: 2, nonaktif: 1, posisi: "2026-11-01" });
});

test("mutasi: saldo berjalan dijelaskan saat disaring; saldo akhir periode lama tidak dikira saldo terbaru", () => {
  assert.equal(kalimatMutasi({ total: 5, jumlahMutasi: 40, disaring: true }).teks, "5 dari 40 mutasi");
  assert.match(kalimatMutasi({ total: 5, jumlahMutasi: 40, disaring: true }).catatSaldo, /seluruh urutan transaksi/);
  assert.equal(kalimatMutasi({ total: 40, jumlahMutasi: 40, disaring: false }).catatSaldo, null);
  assert.equal(catatanPosisiMutasi({ periodeTo: "2026-11-30", hariIni: "2026-11-01" }), null); // akhir periode di masa depan = posisi hari ini
  assert.match(catatanPosisiMutasi({ periodeTo: "2026-09-30", hariIni: "2026-11-01" }), /posisi per 2026-09-30/);
  assert.equal(catatanPosisiMutasi({ periodeTo: "2026-11-01", hariIni: "2026-11-01" }), null);
  assert.equal(pencocokanBaris({ statusCocok: "COCOK_MANUAL" }).label, "Cocok manual");
  assert.equal(pencocokanBaris({ statusCocok: null }).label, "Belum dipasangkan");
});

test("transfer: komponen persis dari server (tidak ditebak), status posting/dibatalkan, batas muat 200 hanya diaku bila tercapai", () => {
  assert.deepEqual(komponenTransfer({ amount: 125000000, feeAmount: 6500, biayaAdmin: 6500, totalKeluarRekening: 125006500, nominalDiterima: 125000000 }), { nilai: 125000000, biaya: 6500, totalKeluar: 125006500, diterima: 125000000 });
  assert.deepEqual(komponenTransfer({ amount: 5000000, feeAmount: 0 }), { nilai: 5000000, biaya: 0, totalKeluar: null, diterima: null }); // tidak ada angka total → tidak dikarang
  assert.equal(statusTransfer({ cancelledAt: null }).kode, "posting");
  assert.equal(statusTransfer({ cancelledAt: "2026-11-02T03:00:00Z" }).label, "Dibatalkan");
  const daftar = [
    { transferNumber: "TRF-1", date: "2026-11-02", fromAccount: { name: "PT Sano" }, toAccount: { name: "KEM" }, amount: 10000000, feeAmount: 2500, cancelledAt: null },
    { transferNumber: "TRF-2", date: "2026-11-05", fromAccount: { name: "Kas" }, toAccount: { name: "PT Sano" }, amount: 391500, feeAmount: 0, cancelledAt: "2026-11-06" },
  ];
  const nomor = (f) => saringTransfer(daftar, { q: "", dari: "", ke: "", status: "", ...f }).map((t) => t.transferNumber);
  assert.deepEqual(nomor({ dari: "PT Sano" }), ["TRF-1"]);
  assert.deepEqual(nomor({ ke: "PT Sano" }), ["TRF-2"]);
  assert.deepEqual(nomor({ status: "batal" }), ["TRF-2"]);
  assert.deepEqual(nomor({ q: "10.000.000" }), ["TRF-1"]);
  assert.equal(kalimatTransfer({ tampil: 2, termuat: 2 }).catatan, null);
  assert.match(kalimatTransfer({ tampil: BATAS_TRANSFER, termuat: BATAS_TRANSFER }).catatan, /^Menampilkan maksimal 200 transfer terbaru; hasil mungkin belum mencakup seluruh data.$/);
  assert.doesNotMatch(kalimatTransfer({ tampil: BATAS_TRANSFER, termuat: BATAS_TRANSFER }).catatan, /pasti|terpotong/);
  assert.equal(kalimatTransfer({ tampil: 1, termuat: 2 }).teks, "1 dari 2 transfer");
});
