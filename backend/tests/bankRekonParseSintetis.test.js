// Uji parser rekening koran dengan data SINTETIS (nama, nominal, dan rekening karangan — bukan data produksi).
// Tujuannya memastikan bentuk berkas nyata Mandiri tidak mengejutkan saat rekening koran pertama diimpor.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { telaahBerkas, sidikJariBaris } from "../src/services/finance/bankRekon/parse.js";
import { tebakKategori } from "../src/services/finance/bankRekon/saran.js";

const telaah = (csv, nama = "s.csv") => telaahBerkas(Buffer.from(csv), nama);

test("sintetis: tanggal efektif (Val Date) berbeda dari tanggal transaksi dibaca terpisah", async () => {
  const t = await telaah([
    "Tanggal;Val Date;Keterangan;Debit;Kredit;Saldo",
    "30/09/2026;01/10/2026;SETORAN TUNAI;0,00;1.000.000,00;1.000.000,00",
    "01/10/2026;01/10/2026;TRF MASUK;0,00;500.000,00;1.500.000,00",
  ].join("\n"));
  assert.equal(t.galat.length, 0);
  assert.equal(t.baris[0].tanggal, "2026-09-30");
  assert.equal(t.baris[0].tanggalEfektif, "2026-10-01", "kredit bertanggal 30 Sep tetapi efektif 1 Okt");
  assert.equal(t.baris[1].tanggalEfektif, "2026-10-01");
});

test("sintetis: BI-FAST + biaya admin + bunga + pajak bunga terbaca, tebakan kategori benar, rantai saldo konsisten", async () => {
  const t = await telaah([
    "Tanggal;Keterangan;Referensi;Debit;Kredit;Saldo",
    "01/10/2026;BI-FAST DB KE PT CONTOH SUPPLIER;BF0001;6.496.000,00;0,00;93.504.000,00",
    "01/10/2026;BIAYA BI-FAST;BF0001B;2.500,00;0,00;93.501.500,00",
    "02/10/2026;BIAYA ADM BULANAN;ADM01;13.000,00;0,00;93.488.500,00",
    "02/10/2026;BUNGA TABUNGAN;BG01;0,00;24.500,00;93.513.000,00",
    "02/10/2026;PAJAK BUNGA;PJ01;4.900,00;0,00;93.508.100,00",
  ].join("\n"));
  assert.equal(t.galat.length, 0);
  assert.equal(t.baris.length, 5);
  assert.equal(t.rantaiSaldo.konsisten, true);
  const kat = (i) => tebakKategori({ deskripsiBank: [t.baris[i].deskripsi] });
  assert.equal(kat(2), "BIAYA_BANK");
  assert.equal(kat(3), "BUNGA");
  assert.equal(kat(4), "PAJAK_BUNGA");
  assert.equal(t.baris[0].debit, "6496000.00");
});

test("sintetis: transfer antar-rekening (keluar di satu rekening, masuk di yang lain) tidak digabung — parser hanya membaca per berkas", async () => {
  const keluar = await telaah("Tanggal,Keterangan,Debit,Kredit\n03/10/2026,TRF KE KEM,5000000,0");
  const masuk = await telaah("Tanggal,Keterangan,Debit,Kredit\n03/10/2026,TRF DARI PT SANO,0,5000000");
  assert.equal(keluar.baris[0].debit, "5000000.00");
  assert.equal(masuk.baris[0].kredit, "5000000.00");
  assert.equal(tebakKategori({ sumberJurnal: ["TRANSFER_KAS"], deskripsiBank: ["TRF KE KEM"] }), "TRANSFER_ANTAR_REKENING");
});

test("sintetis: debit & kredit kosong — baris nominal nol dilewati dengan catatan, bukan galat; sel kosong di satu sisi = 0", async () => {
  const t = await telaah([
    "Tanggal,Keterangan,Debit,Kredit",
    "01/10/2026,KOSONG DUA-DUANYA,,",
    "01/10/2026,HANYA KREDIT,,1000",
    "01/10/2026,HANYA DEBIT,2000,",
    "01/10/2026,NOL,0,0",
  ].join("\n"));
  assert.equal(t.galat.length, 0);
  assert.equal(t.baris.length, 2);
  assert.equal(t.baris[0].kredit, "1000.00"); assert.equal(t.baris[0].debit, "0.00");
  assert.equal(t.baris[1].debit, "2000.00"); assert.equal(t.baris[1].kredit, "0.00");
  assert.equal(t.dilewati.length, 2);
  assert.ok(t.dilewati.every((d) => /nominal nol/.test(d.alasan)));
});

test("sintetis: saldo berjalan tidak konsisten dilaporkan (baris putus), TIDAK memblokir impor", async () => {
  const t = await telaah([
    "Tanggal,Keterangan,Debit,Kredit,Saldo",
    "01/10/2026,A,0,1000,1000",
    "01/10/2026,B,200,0,800",
    "02/10/2026,C,100,0,500",
    "02/10/2026,D,0,50,550",
  ].join("\n"));
  assert.equal(t.baris.length, 4, "semua baris tetap terbaca");
  assert.equal(t.rantaiSaldo.diperiksa, true);
  assert.equal(t.rantaiSaldo.konsisten, false);
  assert.equal(t.rantaiSaldo.putus[0].noBaris, 4, "putus di baris C (seharusnya 700, tertulis 500)");
  assert.equal(t.rantaiSaldo.putus[0].diharapkan, "700.00");
});

test("sintetis: berkas tumpang tindih (bulanan lalu rentang lain) menghasilkan sidik jari sama → baris ganda terdeteksi, baris baru tidak", async () => {
  const awal = ["Tanggal,Keterangan,Referensi,Debit,Kredit,Saldo",
    "01/10/2026,SETORAN,R1,0,1000,1000", "02/10/2026,BIAYA ADM,R2,13,0,987"].join("\n");
  const lanjut = ["Tanggal,Keterangan,Referensi,Debit,Kredit,Saldo",
    "02/10/2026,BIAYA ADM,R2,13,0,987", "03/10/2026,SETORAN,R3,0,500,1487"].join("\n");
  const a = sidikJariBaris("rek-sintetis", (await telaah(awal)).baris);
  const b = sidikJariBaris("rek-sintetis", (await telaah(lanjut)).baris);
  assert.equal(b[0], a[1], "baris 2 Okt muncul di kedua berkas → ganda");
  assert.equal(a.includes(b[1]), false, "baris 3 Okt baru");
});

test("sintetis: dua biaya identik di hari sama dalam satu berkas BUKAN duplikat", async () => {
  const t = await telaah(["Tanggal,Keterangan,Debit,Kredit", "01/10/2026,BIAYA TRANSFER,2500,0", "01/10/2026,BIAYA TRANSFER,2500,0"].join("\n"));
  const f = sidikJariBaris("rek-sintetis", t.baris);
  assert.equal(new Set(f).size, 2);
});

test("sintetis: nilai Excel-ish — angka bergaya Indonesia berspasi/Rp dan DB/CR di kolom Jumlah", async () => {
  const t = await telaah(["Tanggal;Keterangan;Jumlah;D/K", "01/10/2026;A;Rp 1.250.000,50;CR", "01/10/2026;B;300.000,00;DB"].join("\n"));
  assert.equal(t.baris[0].kredit, "1250000.50");
  assert.equal(t.baris[1].debit, "300000.00");
});

// ── Templat yang dibagikan ke Finance harus lolos parser apa adanya ─────────────────────────────────────────────
const DIR_DOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/rekonsiliasi-bank");

for (const nama of ["template-impor-rekening-koran.csv", "template-impor-rekening-koran.xlsx"]) {
  test(`templat ${nama} lolos parser: tanpa galat, kolom wajib terpetakan, rantai saldo konsisten, baris contoh bertanda`, async () => {
    const buf = fs.readFileSync(path.join(DIR_DOK, nama));
    const t = await telaahBerkas(buf, nama);
    assert.equal(t.galat.length, 0);
    for (const k of ["tanggal", "tanggalEfektif", "deskripsi", "referensi", "debit", "kredit", "saldo"]) assert.notEqual(t.pemetaan[k], undefined, `kolom ${k} terpetakan`);
    assert.ok(t.baris.length >= 3);
    assert.equal(t.rantaiSaldo.konsisten, true);
    assert.ok(t.baris.every((b) => /CONTOH/.test(b.deskripsi)), "setiap baris contoh wajib bertanda CONTOH agar tidak tak sengaja diimpor sebagai data asli");
  });
}
