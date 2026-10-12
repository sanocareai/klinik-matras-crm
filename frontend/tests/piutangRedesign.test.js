// Layar "Piutang & Refund" yang didesain ulang: filter/urut murni, kelompok Perlu Tindakan, scope export, pemasangan (tab, kartu, drawer, mobile).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TAB_PIUTANG, cocokUmur, barisUntukTab, saringPiutang, jumlahFilterAktif, ringkasDiagnosis, kelompokPerluTindakan, alasanOrder, labelScopeExport, periodeBawaanPiutang,
} from "../src/features/finance/piutangLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

const BARIS = [
  { orderId: "a", orderNumber: "RES-1", customerName: "Ani", salesName: "Kiki", tagihanDiakui: 1_000_000, sudahDilunasi: 0, sisaTagihan: 1_000_000, hariLewat: 45, statusBayar: "BELUM_BAYAR" },
  { orderId: "b", orderNumber: "RES-2", customerName: "Budi", salesName: "Risel", tagihanDiakui: 2_000_000, sudahDilunasi: 500_000, sisaTagihan: 1_500_000, hariLewat: -3, statusBayar: "DIBAYAR_SEBAGIAN" },
  { orderId: "c", orderNumber: "RES-3", customerName: "Citra", salesName: "Kiki", tagihanDiakui: 300_000, sudahDilunasi: 0, sisaTagihan: 300_000, hariLewat: 90, statusBayar: "BELUM_BAYAR" },
  { orderId: "d", orderNumber: "RES-4", customerName: "Dedi", salesName: null, tagihanDiakui: 800_000, sudahDilunasi: 100_000, sisaTagihan: 700_000, hariLewat: 0, statusBayar: "DIBAYAR_SEBAGIAN", invoiceNumber: "INV-9" },
];

test("lima tab dengan Daftar Piutang sebagai bawaan", () => {
  assert.deepEqual(TAB_PIUTANG.map((t) => t.key), ["daftar", "jatuh-tempo", "perlu-tindakan", "refund", "diagnosis"]);
  assert.equal(TAB_PIUTANG[0].label, "Daftar Piutang");
});

test("kelompok umur sama dengan definisi server; tab Jatuh Tempo = hariLewat > 0", () => {
  assert.equal(cocokUmur(0, "belum"), true); assert.equal(cocokUmur(1, "belum"), false);
  assert.equal(cocokUmur(-7, "tujuh_hari"), true); assert.equal(cocokUmur(-8, "tujuh_hari"), false); assert.equal(cocokUmur(1, "tujuh_hari"), false);
  assert.equal(cocokUmur(30, "1_30"), true); assert.equal(cocokUmur(31, "1_30"), false); assert.equal(cocokUmur(61, "60_plus"), true);
  assert.deepEqual(barisUntukTab(BARIS, "jatuh-tempo").map((b) => b.orderId), ["a", "c"]);
  assert.equal(barisUntukTab(BARIS, "daftar").length, 4);
});

test("saring: pencarian (order/pelanggan/sales/nominal), status, umur, sales; urut sisa terbesar atau paling lama; angka baris tidak berubah", () => {
  const ids = (r) => r.map((b) => b.orderId).join("");
  assert.equal(ids(saringPiutang(BARIS, {})), "badc", "bawaan: sisa terbesar");
  assert.equal(ids(saringPiutang(BARIS, { urut: "lama" })), "cadb");
  assert.equal(ids(saringPiutang(BARIS, { q: "kiki" })), "ac");
  assert.equal(ids(saringPiutang(BARIS, { q: "ani" })), "a");
  assert.equal(ids(saringPiutang(BARIS, { q: "1.500.000" })), "b");
  assert.equal(ids(saringPiutang(BARIS, { q: "inv-9" })), "d");
  assert.equal(ids(saringPiutang(BARIS, { status: "BELUM_BAYAR" })), "ac");
  assert.equal(ids(saringPiutang(BARIS, { status: "DIBAYAR_SEBAGIAN" })), "bd");
  assert.equal(ids(saringPiutang(BARIS, { umur: "tujuh_hari" })), "bd");
  assert.equal(ids(saringPiutang(BARIS, { umur: "60_plus" })), "c");
  assert.equal(ids(saringPiutang(BARIS, { sales: "Risel", status: "DIBAYAR_SEBAGIAN" })), "b");
  assert.equal(saringPiutang(BARIS, {})[0].sisaTagihan, 1_500_000);
  assert.equal(jumlahFilterAktif({ status: "x", umur: "", sales: "Kiki", urut: "sisa" }), 2);
  assert.equal(jumlahFilterAktif({ status: "", umur: "", sales: "", urut: "lama" }), 1);
});

const DIAG = {
  neraca: 1500, rekonsiliasi: { selisih: 0, perKategori: { TAGIHAN_SAH: { jumlah: 1, total: 1000 }, LUNAS_TANPA_PAYMENT: { jumlah: 1, total: 500 }, KREDIT_LAINNYA: { jumlah: 0, total: 0 } } },
  perluTindakan: { jumlah: 3 },
  alasanTindakan: { PAYMENT_BELUM_MENUTUP: "x", LUNAS_TANPA_PAYMENT: "y", SUDAH_DISERAHKAN_BELUM_DIAKUI: "z", TANGGAL_LUNAS_BEDA: "w" },
  kategori: { LUNAS_TANPA_PAYMENT: { label: "Lunas di CRM, belum ada pembayaran", tingkat: "periksa" }, TAGIHAN_SAH: { label: "Tagihan sah", tingkat: "tagih" } },
  // SATU entri per order; order "g" punya dua alasan
  perluTindakanOrder: [
    { orderId: "g", orderNumber: "G-1", customerName: "Ganda", salesName: "Kiki", nilai: 1500, alasanUtama: "PAYMENT_BELUM_MENUTUP", alasan: [
      { kode: "PAYMENT_BELUM_MENUTUP", label: "Pembayaran belum menutup piutang", tingkat: "periksa", penjelasan: "p1", tindakan: "t1" },
      { kode: "TANGGAL_LUNAS_BEDA", label: "Tanggal lunas berbeda dari tanggal pembayaran yang melunasi", tingkat: "periksa", penjelasan: "p2", tindakan: "t2" },
    ] },
    { orderId: "l", orderNumber: "L-1", customerName: "Lunas", salesName: null, nilai: 500, alasanUtama: "LUNAS_TANPA_PAYMENT", alasan: [
      { kode: "LUNAS_TANPA_PAYMENT", label: "Lunas di CRM, belum ada pembayaran", tingkat: "periksa", penjelasan: "Lunas tanpa payment", tindakan: "Catat pembayaran" },
    ] },
    { orderId: "u", orderNumber: "U-1", customerName: "Belum", salesName: null, nilai: 700, alasanUtama: "SUDAH_DISERAHKAN_BELUM_DIAKUI", alasan: [
      { kode: "SUDAH_DISERAHKAN_BELUM_DIAKUI", label: "Sudah diserahkan, belum tercatat di buku", tingkat: "periksa", penjelasan: "pu", tindakan: "tu" },
    ] },
  ],
};

test("strip diagnosis + kelompok Perlu Tindakan: satu order satu entri, alasan lain terhitung, urutan prioritas server, tagihan sah tidak dicampur", () => {
  assert.deepEqual(ringkasDiagnosis(DIAG), { cocok: true, perluTindakan: 3, neraca: 1500 });
  assert.equal(ringkasDiagnosis({ ...DIAG, rekonsiliasi: { ...DIAG.rekonsiliasi, selisih: 40 } }).cocok, false);
  assert.equal(ringkasDiagnosis(null), null);
  const g = kelompokPerluTindakan(DIAG);
  assert.deepEqual(g.map((x) => x.kode), ["PAYMENT_BELUM_MENUTUP", "LUNAS_TANPA_PAYMENT", "SUDAH_DISERAHKAN_BELUM_DIAKUI"]);
  const semua = g.flatMap((x) => x.baris);
  assert.equal(new Set(semua.map((b) => b.orderId)).size, semua.length, "tidak ada order ganda");
  assert.equal(semua.length, 3);
  const ganda = semua.find((b) => b.orderId === "g");
  assert.equal(ganda.alasanLain, 1); assert.equal(ganda.alasan.length, 2); assert.equal(ganda.penjelasan, "p1");
  assert.equal(g[1].label, "Lunas di CRM, belum ada pembayaran", "label dari server");
  assert.deepEqual(kelompokPerluTindakan(null), []);
  assert.deepEqual(alasanOrder(DIAG, "g").map((a) => a.kode), ["PAYMENT_BELUM_MENUTUP", "TANGGAL_LUNAS_BEDA"]);
  assert.deepEqual(alasanOrder(DIAG, "tidak-ada"), []);
});

test("scope export menyebut tab, jumlah baris, dan filter aktif", () => {
  assert.deepEqual(labelScopeExport("jatuh-tempo", { jumlahTampil: 2, jumlahTotal: 9, filterAktif: true }), [["Tab", "Jatuh Tempo"], ["Piutang", "2 dari 9 order (sesuai filter aktif)"]]);
  assert.deepEqual(labelScopeExport("daftar", { jumlahTampil: 9, jumlahTotal: 9, filterAktif: false }), [["Tab", "Daftar Piutang"], ["Piutang", "9 dari 9 order"]]);
  assert.match(labelScopeExport("diagnosis", { jumlahTampil: 0, jumlahTotal: 9, filterAktif: false })[1][1], /tidak ikut diekspor/);
});

test("pemasangan layar: tab sticky, empat kartu dari server, strip diagnosis, drawer detail, kartu mobile + bottom sheet, export dengan scope, tanpa hitung ulang uang", () => {
  const src = baca("../src/pages/finance/FinanceReceivables.jsx");
  assert.match(src, /useUrlTab\(TAB_PIUTANG_KUNCI, "daftar"\)/);
  assert.match(src, /data-testid="tab-piutang"/);
  for (const label of ["Total Piutang Aktif", "Jatuh Tempo\"", "Jatuh Tempo ≤7 Hari", "Perlu Tindakan\""]) assert.ok(src.includes(`label="${label.replace(/"$/, "")}"`) || src.includes(label), label);
  assert.match(src, /data\?\.jatuhTempo/);
  assert.match(src, /diag\.perluTindakan\?\.jumlah/);
  assert.match(src, /data-testid="strip-diagnosis"/);
  assert.match(src, /Saldo buku cocok/); assert.match(src, /Lihat diagnosis/);
  assert.match(src, /api\.getFinancePiutangOrder\(/);
  assert.match(src, /<PanelDetail spec=\{panelRincian\}/);
  assert.match(src, /data-testid="kartu-daftar-piutang"/);
  assert.match(src, /LembarFilter/); assert.match(src, /slide-in-from-bottom/);
  assert.match(src, /Bagaimana angka ini dihitung\?/);
  assert.match(src, /labelScopeExport\(tab,/);
  assert.match(src, /periode: \{ to: posisi \}/);
  assert.match(src, /data-testid="posisi-piutang"/); assert.match(src, /Posisi per \$\{tanggalPendek\(posisi\)\} \(WIB\)/);
  assert.doesNotMatch(src, /PeriodePicker from=/, "posisi saldo bukan rentang periode transaksi");
  assert.doesNotMatch(src, /Hitung Kas/, "Hitung Kas tidak ditampilkan sebelum halamannya ada");
  assert.match(src, /alasan: alasanOrder\(diag, terpilih\.orderId\)/); assert.match(src, /data-testid="alasan-lain"/);
  // Diagnosis panjang tidak lagi di layar pertama: hanya dirender di tab Diagnosis
  assert.match(src, /tab === "diagnosis" && \(/);
  assert.doesNotMatch(src.slice(0, src.indexOf("function BarFilterPiutang")), /<DiagnosisPiutang \/>/, "DiagnosisPiutang tanpa prop (muat sendiri) tidak ada di tab bawaan");
  // Frontend tidak menghitung ulang angka uang dari baris
  assert.doesNotMatch(src, /\.reduce\(\(\w+, \w+\) => \w+ \+ \w+\.sisaTagihan/);
  assert.doesNotMatch(src, /nilaiOrder - |sisaTagihan - |tagihanDiakui - /);
});

test("DiagnosisPiutang: tanpa prop memuat sendiri (kompatibel); dengan prop memakai data layar", () => {
  const src = baca("../src/features/finance/DiagnosisPiutang.jsx");
  assert.match(src, /dataLuar !== undefined/);
  assert.match(src, /if \(!dikendalikan\) muat\(\)/);
});

test("posisi bawaan = hari ini WIB (batas tengah malam WIB, bukan UTC); scope export menyebut cutoff posisi", () => {
  // 2026-10-11T17:30Z = 12 Okt 00:30 WIB
  assert.equal(periodeBawaanPiutang(new Date("2026-10-11T17:30:00Z")).to, "2026-10-12");
  // 2026-10-11T16:59Z = 11 Okt 23:59 WIB
  assert.equal(periodeBawaanPiutang(new Date("2026-10-11T16:59:00Z")).to, "2026-10-11");
  const l = labelScopeExport("daftar", { jumlahTampil: 3, jumlahTotal: 8, filterAktif: false, posisiTeks: "12 Okt 2026" });
  assert.ok(l.some(([k, v]) => k === "Cutoff posisi" && /12 Okt 2026 \(WIB, inklusif\)/.test(v) && /bukan filter transaksi periode/.test(v)));
});
