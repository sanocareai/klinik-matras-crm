// Parser rekening koran + saran pencocokan (murni, tanpa database).
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseTanggal, parseNominal, parseCsv, telaahBerkas, sidikJariBaris, periksaRantaiSaldo, ParseError } from "../src/services/finance/bankRekon/parse.js";
import { cariSaran, tebakKategori, bentukKelompok } from "../src/services/finance/bankRekon/saran.js";
import { toMoney } from "../src/services/finance/money.js";

test("parseTanggal: format Indonesia & Excel, menolak tanggal mustahil", () => {
  assert.equal(parseTanggal("01/10/2026"), "2026-10-01");
  assert.equal(parseTanggal("1-10-2026"), "2026-10-01");
  assert.equal(parseTanggal("2026-10-01"), "2026-10-01");
  assert.equal(parseTanggal("01 Okt 2026"), "2026-10-01");
  assert.equal(parseTanggal("1 October 2026 10:15:00"), "2026-10-01");
  assert.equal(parseTanggal("30/09/2026 23:59:59"), "2026-09-30");
  assert.equal(parseTanggal(new Date(Date.UTC(2026, 9, 1))), "2026-10-01");
  assert.equal(parseTanggal(46296), "2026-10-01"); // serial Excel (2026-10-01)
  assert.equal(parseTanggal("31/02/2026"), null);
  assert.equal(parseTanggal("bukan tanggal"), null);
  assert.equal(parseTanggal(""), null);
  assert.equal(parseTanggal("02/10/2026"), "2026-10-02", "dd/mm — bukan mm/dd");
});

test("parseNominal: gaya Indonesia/Inggris, tanda, DB/CR, Rp, kurung", () => {
  const v = (x) => parseNominal(x);
  assert.deepEqual(v("1.234.567,89"), { nilai: "1234567.89", tanda: 1 });
  assert.deepEqual(v("1,234,567.89"), { nilai: "1234567.89", tanda: 1 });
  assert.deepEqual(v("6.496.000"), { nilai: "6496000.00", tanda: 1 });
  assert.deepEqual(v("2.500,00"), { nilai: "2500.00", tanda: 1 });
  assert.deepEqual(v("2790,07"), { nilai: "2790.07", tanda: 1 });
  assert.deepEqual(v("2790.07"), { nilai: "2790.07", tanda: 1 });
  assert.deepEqual(v("Rp 5.000.000"), { nilai: "5000000.00", tanda: 1 });
  assert.deepEqual(v("-400.000"), { nilai: "400000.00", tanda: -1 });
  assert.deepEqual(v("(400.000,00)"), { nilai: "400000.00", tanda: -1 });
  assert.deepEqual(v("13.000 DB"), { nilai: "13000.00", tanda: -1 });
  assert.deepEqual(v("1.750.000 CR"), { nilai: "1750000.00", tanda: 1 });
  assert.deepEqual(v(5000000), { nilai: "5000000.00", tanda: 1 });
  assert.deepEqual(v(-13000), { nilai: "13000.00", tanda: -1 });
  assert.deepEqual(v("0,00"), { nilai: "0.00", tanda: 0 });
  assert.equal(v("abc"), null);
  assert.equal(v(""), null);
  assert.equal(v("12.3.4x"), null);
});

test("parseCsv: deteksi pemisah, tanda kutip, baris baru dalam sel, BOM", () => {
  const { baris, pemisah } = parseCsv('﻿Tanggal;Keterangan;Debit;Kredit\n01/10/2026;"Transfer; ke KEM";5.000.000,00;0,00\n02/10/2026;"a ""b""\nc";0;100\n');
  assert.equal(pemisah, ";");
  assert.equal(baris.length, 3);
  assert.equal(baris[1][1], "Transfer; ke KEM");
  assert.equal(baris[2][1], 'a "b"\nc');
});

const CSV_MANDIRI = [
  "Rekening Koran PT SANO KREASI UTAMA",
  "Periode 01/10/2026 - 02/10/2026",
  "",
  "Tanggal;Keterangan;Referensi;Debit;Kredit;Saldo",
  "01/10/2026;TRF KE KEM;REF001;5.000.000,00;0,00;62.000.000,00",
  "01/10/2026;PEMBAYARAN PT ESA BUMINDO;REF002;6.496.000,00;0,00;55.504.000,00",
  "01/10/2026;BIAYA TRANSFER BI-FAST;REF003;2.500,00;0,00;55.501.500,00",
  "01/10/2026;SETORAN CUSTOMER;REF004;0,00;1.100.000,00;56.601.500,00",
  "TOTAL;;;11.498.500,00;1.100.000,00;",
].join("\n");

test("telaahBerkas CSV Mandiri-like: kop dilewati, header & pemetaan otomatis, total dilewati, rantai saldo konsisten", async () => {
  const t = await telaahBerkas(Buffer.from(CSV_MANDIRI), "mutasi.csv");
  assert.equal(t.format, "CSV");
  assert.equal(t.barisJudul, 3, "baris kosong tetap dihitung (nomor baris = nomor di berkas)");
  assert.deepEqual(Object.keys(t.pemetaan).sort(), ["debit", "deskripsi", "kredit", "referensi", "saldo", "tanggal"]);
  assert.equal(t.baris.length, 4);
  assert.equal(t.galat.length, 0);
  assert.equal(t.baris[0].debit, "5000000.00");
  assert.equal(t.baris[3].kredit, "1100000.00");
  assert.equal(t.rantaiSaldo.konsisten, true);
  assert.equal(t.dilewati.length, 1, "baris TOTAL dilewati, bukan galat");
});

test("telaahBerkas: berkas terurut terbaru→terlama dibalik; rantai saldo tetap konsisten", async () => {
  const csv = ["Tanggal,Keterangan,Debit,Kredit,Saldo", "02/10/2026,B,0,100,300", "01/10/2026,A,0,200,200"].join("\n");
  const t = await telaahBerkas(Buffer.from(csv), "x.csv");
  assert.equal(t.urutan, "TERBARU_DULU");
  assert.deepEqual(t.baris.map((b) => b.deskripsi), ["A", "B"]);
  assert.equal(t.rantaiSaldo.diperiksa, true);
  assert.equal(t.rantaiSaldo.konsisten, true);
});

test("telaahBerkas: satu kolom Jumlah bertanda dan Jumlah+DB/CR", async () => {
  const a = await telaahBerkas(Buffer.from("Tanggal,Keterangan,Jumlah\n01/10/2026,Keluar,-5.000\n02/10/2026,Masuk,7.000"), "a.csv");
  assert.equal(a.baris[0].debit, "5000.00"); assert.equal(a.baris[0].kredit, "0.00");
  assert.equal(a.baris[1].kredit, "7000.00");
  const b = await telaahBerkas(Buffer.from("Tanggal,Keterangan,Jumlah,Tipe\n01/10/2026,Keluar,5.000,DB\n02/10/2026,Masuk,7.000,CR"), "b.csv");
  assert.equal(b.baris[0].debit, "5000.00"); assert.equal(b.baris[1].kredit, "7000.00");
});

test("telaahBerkas: nominal rusak / debit-kredit bersamaan = GALAT dengan nomor baris (tidak dibuang diam-diam)", async () => {
  const t = await telaahBerkas(Buffer.from("Tanggal,Keterangan,Debit,Kredit\n01/10/2026,A,abc,0\n02/10/2026,B,10,20\n03/10/2026,C,5,0"), "g.csv");
  assert.equal(t.baris.length, 1);
  assert.equal(t.galat.length, 2);
  assert.match(t.galat[0].pesan, /Debit/);
  assert.match(t.galat[1].pesan, /bersamaan/);
});

test("telaahBerkas: tanpa header yang dikenal → ParseError jelas; berkas kosong ditolak", async () => {
  await assert.rejects(() => telaahBerkas(Buffer.from("a,b,c\n1,2,3"), "x.csv"), (e) => e instanceof ParseError && e.code === "HEADER_TIDAK_ADA");
  await assert.rejects(() => telaahBerkas(Buffer.alloc(0), "x.csv"), (e) => e instanceof ParseError && e.code === "BERKAS_KOSONG");
  await assert.rejects(() => telaahBerkas(Buffer.from("x"), "lama.xls"), (e) => e instanceof ParseError && e.code === "FORMAT_TIDAK_DIDUKUNG");
});

test("telaahBerkas XLSX: tanggal Excel, angka, kop di atas tabel", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Mutasi");
  ws.addRow(["Rekening Koran"]);
  ws.addRow([]);
  ws.addRow(["Tanggal", "Keterangan", "Debit", "Kredit", "Saldo"]);
  ws.addRow([new Date(Date.UTC(2026, 9, 1)), "SETORAN", 0, 1100000, 1100000]);
  ws.addRow([new Date(Date.UTC(2026, 9, 2)), "BIAYA ADM", 13000, 0, 1087000]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const t = await telaahBerkas(buf, "m.xlsx");
  assert.equal(t.format, "XLSX");
  assert.equal(t.baris.length, 2);
  assert.equal(t.baris[0].tanggal, "2026-10-01");
  assert.equal(t.baris[1].debit, "13000.00");
  assert.equal(t.rantaiSaldo.konsisten, true);
});

test("pemetaan manual menggantikan otomatis; pemetaan tidak valid ditolak", async () => {
  const csv = "Tgl,Uraian,Keluar,Masuk\n01/10/2026,A,5,0";
  const t = await telaahBerkas(Buffer.from(csv), "x.csv", { kolom: { tanggal: 0, deskripsi: 1, debit: 2, kredit: 3 } });
  assert.equal(t.baris[0].debit, "5.00");
  await assert.rejects(() => telaahBerkas(Buffer.from(csv), "x.csv", { kolom: { tanggal: 0, deskripsi: 0, debit: 2 } }), (e) => e.code === "PEMETAAN_GANDA");
  await assert.rejects(() => telaahBerkas(Buffer.from(csv), "x.csv", { kolom: { tanggal: 9, deskripsi: 1, debit: 2 } }), (e) => e.code === "PEMETAAN_TIDAK_VALID");
});

test("sidikJariBaris: baris identik dalam satu berkas tidak dianggap ganda; berkas tumpang tindih menghasilkan sidik jari yang sama", () => {
  const b = (d, x) => ({ tanggal: d, deskripsi: x, referensi: null, debit: "2500.00", kredit: "0.00", saldo: null });
  const berkas1 = [b("2026-10-01", "BIAYA"), b("2026-10-01", "BIAYA"), b("2026-10-02", "LAIN")];
  const berkas2 = [b("2026-10-01", "BIAYA"), b("2026-10-01", "BIAYA"), b("2026-10-02", "LAIN"), b("2026-10-03", "BARU")];
  const f1 = sidikJariBaris("rek-1", berkas1), f2 = sidikJariBaris("rek-1", berkas2);
  assert.equal(new Set(f1).size, 3, "dua biaya identik di hari yang sama tetap dua baris berbeda");
  assert.deepEqual(f2.slice(0, 3), f1);
  assert.notEqual(sidikJariBaris("rek-2", berkas1)[0], f1[0], "rekening berbeda → sidik jari berbeda");
});

test("periksaRantaiSaldo: mendeteksi baris hilang", () => {
  const baris = [
    { noBaris: 1, debit: "0.00", kredit: "100.00", saldo: "100.00" },
    { noBaris: 2, debit: "30.00", kredit: "0.00", saldo: "70.00" },
    { noBaris: 3, debit: "10.00", kredit: "0.00", saldo: "40.00" }, // seharusnya 60
  ];
  const r = periksaRantaiSaldo(baris);
  assert.equal(r.konsisten, false);
  assert.equal(r.putus[0].noBaris, 3);
});

// ── Saran pencocokan ──────────────────────────────────────────────────────────────────────────────────────────
const D = (v) => toMoney(v);
const bank = (id, tanggal, nilai, deskripsi = "") => ({ id, tanggal, nilai: D(nilai), deskripsi, referensi: null });
const buku = (id, tanggal, nilai, teks = "") => ({ id, tanggal, nilai: D(nilai), teks });

test("saran: pasangan 1:1 unik & ≤3 hari → otomatis", () => {
  const s = cariSaran({ bank: [bank("b1", "2026-10-01", -5000000)], buku: [buku("j1", "2026-10-01", -5000000)] });
  assert.deepEqual(s.otomatis, [{ bankId: "b1", bukuId: "j1" }]);
});

test("saran: AMBIGU (dua kandidat sama nominal) → tidak ada pencocokan otomatis, tetap disarankan", () => {
  const s = cariSaran({
    bank: [bank("b1", "2026-10-01", -1000000)],
    buku: [buku("j1", "2026-10-01", -1000000), buku("j2", "2026-10-02", -1000000)],
  });
  assert.equal(s.otomatis.length, 0);
  assert.equal(s.kandidatBank.get("b1").length, 2);
  // juga ambigu dari sisi buku: dua bank, satu buku
  const t = cariSaran({ bank: [bank("b1", "2026-10-01", 300000), bank("b2", "2026-10-01", 300000)], buku: [buku("j1", "2026-10-01", 300000)] });
  assert.equal(t.otomatis.length, 0);
});

test("saran: selisih >3 hari tidak otomatis tetapi disarankan (≤7 hari); >7 hari bukan kandidat", () => {
  const s = cariSaran({ bank: [bank("b1", "2026-10-06", 1750000)], buku: [buku("j1", "2026-09-30", 1750000)] });
  assert.equal(s.otomatis.length, 0);
  assert.equal(s.kandidatBank.get("b1").length, 1);
  const t = cariSaran({ bank: [bank("b1", "2026-10-20", 1750000)], buku: [buku("j1", "2026-09-30", 1750000)] });
  assert.equal(t.kandidatBank.get("b1").length, 0);
});

test("saran: arah berlawanan (masuk vs keluar) tidak pernah cocok", () => {
  const s = cariSaran({ bank: [bank("b1", "2026-10-01", 5000000)], buku: [buku("j1", "2026-10-01", -5000000)] });
  assert.equal(s.kandidatBank.get("b1").length, 0);
});

test("saran N:1: transfer Rp6.496.000 + biaya Rp2.500 di bank = satu baris buku Rp6.498.500 (hanya saran)", () => {
  const s = cariSaran({
    bank: [bank("b1", "2026-10-01", -6496000, "PEMBAYARAN"), bank("b2", "2026-10-01", -2500, "BIAYA BI-FAST")],
    buku: [buku("j1", "2026-10-01", -6498500, "Pembayaran supplier PT ESA BUMINDO")],
  });
  assert.equal(s.otomatis.length, 0);
  assert.equal(s.kombinasi.length, 1);
  assert.equal(s.kombinasi[0].bentuk, "N:1");
  assert.deepEqual([...s.kombinasi[0].bankIds].sort(), ["b1", "b2"]);
});

test("saran 1:N: satu baris bank = jumlah beberapa baris buku", () => {
  const s = cariSaran({
    bank: [bank("b1", "2026-10-01", 4395000)],
    buku: [buku("j1", "2026-10-01", 3090000), buku("j2", "2026-10-01", 1200000), buku("j3", "2026-10-01", 105000)],
  });
  assert.equal(s.kombinasi.length, 1);
  assert.equal(s.kombinasi[0].bentuk, "1:N");
  assert.equal(s.kombinasi[0].bukuIds.length, 3);
});

test("saran: kombinasi ambigu ditandai", () => {
  const s = cariSaran({
    bank: [bank("b1", "2026-10-01", 300)],
    buku: [buku("j1", "2026-10-01", 100), buku("j2", "2026-10-01", 200), buku("j3", "2026-10-01", 120), buku("j4", "2026-10-01", 180)],
  });
  assert.ok(s.kombinasi.length >= 2);
  assert.ok(s.kombinasi.every((k) => k.ambigu));
});

test("kategori & bentuk", () => {
  assert.equal(tebakKategori({ sumberJurnal: ["TRANSFER_KAS"], deskripsiBank: [] }), "TRANSFER_ANTAR_REKENING");
  assert.equal(tebakKategori({ deskripsiBank: ["PAJAK BUNGA"] }), "PAJAK_BUNGA");
  assert.equal(tebakKategori({ deskripsiBank: ["BUNGA TABUNGAN"] }), "BUNGA");
  assert.equal(tebakKategori({ deskripsiBank: ["BIAYA ADM BANK"] }), "BIAYA_BANK");
  assert.equal(tebakKategori({ deskripsiBank: ["SETORAN"], bedaHari: 2 }), "BEDA_TANGGAL");
  assert.equal(tebakKategori({ deskripsiBank: ["SETORAN"], bedaHari: 0 }), null);
  assert.equal(bentukKelompok(1, 1), "1:1"); assert.equal(bentukKelompok(2, 1), "N:1"); assert.equal(bentukKelompok(1, 3), "1:N"); assert.equal(bentukKelompok(2, 2), "N:N");
});
