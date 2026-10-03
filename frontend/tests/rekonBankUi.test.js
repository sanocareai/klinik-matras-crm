// REKONSILIASI BANK V2 — kontrak UI (15 Okt 2026). Angka resmi dari server; di sini logika murni (penjumlahan sen, kelayakan tombol, pemetaan impor) dan pemasangan komponen lewat pembacaan berkas.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  keSen, dariSen, nilaiBaris, ringkasPilihan, bisaCocokkan, bisaKecualikan, urutKomponen, kalimatSelisih, pemetaanValid, pemetaanUntukServer, statusTampil, hariIniWib, TAB_DETAIL,
} from "../src/features/finance/rekonBankLogic.js";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").split("\r\n").join("\n");

test("sen: konversi tanpa pembulatan float (2.790,07 + 13.000 dst.)", () => {
  assert.equal(keSen("2790.07"), 279007);
  assert.equal(keSen("-13000.00"), -1300000);
  assert.equal(keSen(null), 0);
  assert.equal(keSen("6715170.00") + keSen("7225019.00"), keSen("13940189.00"));
  assert.equal(dariSen(279007), "2790.07");
  assert.equal(dariSen(-1300000), "-13000.00");
  assert.equal(dariSen(5), "0.05");
  assert.equal(nilaiBaris({ masuk: "100.00", keluar: null }), 10000);
  assert.equal(nilaiBaris({ masuk: null, keluar: "6496000.00" }), -649600000);
});

test("ringkasPilihan: N:1 supplier + biaya seimbang persis; selisih sekecil Rp0,01 = tidak seimbang; bentuk dihitung", () => {
  const bank = [{ keluar: "6493500.00" }, { keluar: "2500.00" }];
  const buku = [{ keluar: "6496000.00" }];
  const r = ringkasPilihan(bank, buku);
  assert.equal(r.seimbang, true);
  assert.equal(r.bentuk, "N:1");
  assert.equal(r.totalBank, -649600000);
  const tidak = ringkasPilihan([{ keluar: "6493500.00" }], buku);
  assert.equal(tidak.seimbang, false);
  assert.match(tidak.teksSelisih, /2500\.00/);
  assert.equal(ringkasPilihan([{ masuk: "0.01" }], [{ masuk: "0.02" }]).seimbang, false);
  assert.equal(ringkasPilihan([{ masuk: "5.00" }], []).seimbang, false, "satu sisi kosong tidak pernah seimbang");
  assert.equal(ringkasPilihan([{ masuk: "1.00" }], [{ masuk: "1.00" }]).bentuk, "1:1");
  assert.equal(ringkasPilihan([{ masuk: "1.00" }], [{ masuk: "0.50" }, { masuk: "0.50" }]).bentuk, "1:N");
});

test("bisaCocokkan/bisaKecualikan: butuh dua sisi, seimbang, dan alasan ≥10 karakter", () => {
  const ok = ringkasPilihan([{ masuk: "10.00" }], [{ masuk: "10.00" }]);
  assert.equal(bisaCocokkan(ok, "x").ok, false);
  assert.equal(bisaCocokkan(ok, "alasan cukup panjang").ok, true);
  assert.equal(bisaCocokkan(ringkasPilihan([{ masuk: "10.00" }], []), "alasan cukup panjang").ok, false);
  assert.equal(bisaCocokkan(ringkasPilihan([{ masuk: "10.00" }], [{ masuk: "9.00" }]), "alasan cukup panjang").ok, false);
  assert.equal(bisaKecualikan(1, "pendek"), false);
  assert.equal(bisaKecualikan(0, "alasan cukup panjang"), false);
  assert.equal(bisaKecualikan(2, "menunggu keterangan Owner"), true);
});

test("urutKomponen & kalimatSelisih: urutan tetap, definisi dari server, arah selisih jelas", () => {
  const panel = {
    definisi: { bankBelumDibukukan: "B", bukuBelumMuncul: "M", perbedaanCutoff: "C", penyesuaianBuku: "P", dikecualikan: "D" },
    komponen: {
      selisihSaldoAwal: { diketahui: true, efek: "0.00", catatan: "awal" }, bankBelumDibukukan: { efek: "13940189.00", jumlah: 2 }, bukuBelumMuncul: { efek: "0.00", jumlah: 0 },
      perbedaanCutoff: { efek: "0.00", jumlah: 0 }, penyesuaianBuku: { efek: "0.00", jumlah: 0 }, dikecualikan: { efek: "0.00", jumlahBank: 0, jumlahBuku: 0 },
    },
  };
  assert.deepEqual(urutKomponen(panel).map((k) => k.kunci), ["selisihSaldoAwal", "bankBelumDibukukan", "bukuBelumMuncul", "perbedaanCutoff", "penyesuaianBuku", "dikecualikan"]);
  assert.equal(urutKomponen(panel)[1].efek, "13940189.00");
  assert.deepEqual(urutKomponen({ komponen: null }), []);
  const fmt = (v) => `Rp${v}`;
  assert.match(kalimatSelisih({ selisih: "13940189.00" }, fmt), /LEBIH TINGGI/);
  assert.match(kalimatSelisih({ selisih: "-5.00" }, fmt), /LEBIH RENDAH/);
  assert.match(kalimatSelisih({ selisih: "0.00" }, fmt), /sama/);
  assert.match(kalimatSelisih({ selisih: null }, fmt), /belum diketahui/);
});

test("pemetaan impor: wajib tanggal + keterangan + (debit/kredit atau jumlah); satu kolom tidak boleh dua bidang; dikirim sebagai angka", () => {
  assert.equal(pemetaanValid({ tanggal: "0", deskripsi: "1", debit: "3", kredit: "4" }).ok, true);
  assert.equal(pemetaanValid({ tanggal: "0", deskripsi: "1", jumlah: "2" }).ok, true);
  assert.equal(pemetaanValid({ tanggal: "0", deskripsi: "1" }).ok, false);
  assert.equal(pemetaanValid({ tanggal: "0", deskripsi: "0", debit: "3" }).ok, false);
  assert.equal(pemetaanValid({ deskripsi: "1", debit: "3" }).ok, false);
  assert.deepEqual(pemetaanUntukServer({ tanggal: "0", deskripsi: "1", debit: "3", kredit: "", saldo: "5" }, 2), { barisJudul: 2, kolom: { tanggal: 0, deskripsi: 1, debit: 3, saldo: 5 } });
});

test("status: enam status resmi punya label & warna; hari ini WIB", () => {
  for (const k of ["COCOK_OTOMATIS", "COCOK_MANUAL", "DISARANKAN", "BELUM_ADA_DI_BUKU", "BELUM_ADA_DI_BANK", "DIKECUALIKAN"]) assert.ok(statusTampil(k).label && statusTampil(k).variant, k);
  assert.equal(statusTampil("BELUM_ADA_DI_BUKU").variant, "red");
  assert.equal(statusTampil("TIDAK_DIKENAL").label, "TIDAK_DIKENAL");
  assert.equal(hariIniWib(new Date("2026-10-01T18:00:00Z")), "2026-10-02", "WIB = UTC+7");
  assert.deepEqual(TAB_DETAIL.map((t) => t.label), ["Mutasi Buku", "Mutasi Rekening", "Pencocokan", "Rekonsiliasi"]);
});

test("Pemasangan: Kas & Bank memakai kartu per rekening dengan 4 tab; tombol export per tab; kartu memuat saldo buku, saldo bank, selisih, belum cocok, terakhir direkonsiliasi", () => {
  const cash = baca("src/pages/finance/FinanceCash.jsx");
  assert.match(cash, /<RekonRekening rekening=\{semuaRekening\} periode=\{periode\} \/>/);
  const rek = baca("src/features/finance/RekonRekening.jsx");
  for (const t of ["Saldo buku", "Saldo bank", "Selisih", "Belum cocok", "Terakhir direkonsiliasi"]) assert.ok(rek.includes(t), `kartu: ${t}`);
  assert.match(rek, /<MutasiRekening[^>]*rekeningTetap/);
  assert.match(rek, /<MutasiBank /); assert.match(rek, /<PencocokanBank /); assert.match(rek, /<PanelRekon /);
  assert.match(rek, /banner-exception-tanpa-rekening/, "exception jurnal lama (Fee Farhan) tampil di kartu");
  assert.match(baca("src/features/finance/MutasiBank.jsx"), /<TombolExportExcel[^>]*modul="mutasi-bank"/s);
  assert.match(baca("src/features/finance/PencocokanBank.jsx"), /<TombolExportExcel[^>]*modul="pencocokan-bank"/s);
  assert.match(baca("src/features/finance/PanelRekon.jsx"), /<TombolExportExcel[^>]*modul="rekonsiliasi-rekening"/s);
});

test("Keamanan UI: tidak ada jalur 'buat jurnal dari mutasi bank'; impor memberi tahu bahwa buku tidak berubah; alasan wajib di setiap tindakan; semua teks Indonesia", () => {
  const semua = ["ImporRekeningKoran", "MutasiBank", "PencocokanBank", "PanelRekon", "RekonRekening"].map((f) => baca(`src/features/finance/${f}.jsx`)).join("\n");
  assert.doesNotMatch(semua, /postJournal|createJournal|buatJurnal|api\.postFinanceJournal/i, "tidak membuat jurnal dari bank");
  assert.match(baca("src/features/finance/ImporRekeningKoran.jsx"), /tidak pernah membuat jurnal atau mengubah saldo buku/);
  assert.match(baca("src/features/finance/PencocokanBank.jsx"), /Tidak membuat jurnal/);
  for (const f of ["PencocokanBank", "PanelRekon", "MutasiBank"]) assert.match(baca(`src/features/finance/${f}.jsx`), /minimal 10 karakter/i, `${f}: alasan wajib`);
  const api = baca("src/api.js");
  for (const m of ["pratinjauImporKoran", "imporKoran", "cocokkanBank", "cocokkanOtomatisBank", "kecualikanBank", "lepasPencocokanBank", "selesaikanPeriodeRekon", "catatOpnameKas"]) assert.ok(api.includes(`${m}:`), `api.${m}`);
  assert.doesNotMatch(semua, /\b(Reconciliation|Unmatched|Upload file|Submit|Cancel import)\b/, "label Inggris tidak boleh tampil");
});

test("Layout aman: tanpa lebar tetap yang memaksa scroll horizontal; mobile memakai kartu (CardList) untuk daftar bank; modal impor tidak melebihi viewport", () => {
  const bank = baca("src/features/finance/MutasiBank.jsx");
  assert.match(bank, /CARD_VIEW_CLASS/); assert.match(bank, /TABLE_VIEW_CLASS/);
  const impor = baca("src/features/finance/ImporRekeningKoran.jsx");
  assert.match(impor, /sm:grid-cols-2/, "pemetaan kolom satu kolom di HP");
  const panel = baca("src/features/finance/PanelRekon.jsx");
  assert.match(panel, /grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4/);
  for (const f of ["MutasiBank", "PencocokanBank", "PanelRekon", "RekonRekening", "ImporRekeningKoran"]) assert.doesNotMatch(baca(`src/features/finance/${f}.jsx`), /min-w-\[(?:[6-9]\d\d|\d{4})px\]/, `${f}: min-width besar memaksa scroll di HP`);
});

import { pecahUrut, angkaSaring, paramSaring, adaSaringanAktif, OPSI_URUT, OPSI_ARAH } from "../src/features/finance/rekonBankLogic.js";

test("Saring & urut: opsi urut dipecah, nominal diketik gaya Indonesia, parameter bersih; Mutasi Buku & Bank memasang filter arah, urutan, nominal dan mengirimnya ke export", () => {
  assert.deepEqual(pecahUrut("nominal:desc"), { urut: "nominal", arahUrut: "desc" });
  assert.deepEqual(pecahUrut(""), {});
  assert.equal(angkaSaring("1.500.000"), "1500000");
  assert.equal(angkaSaring("2500,50"), "2500.50");
  assert.equal(angkaSaring("abc"), "");
  assert.equal(angkaSaring("-5"), "");
  assert.deepEqual(paramSaring({ arah: "KELUAR", urut: "saldo:asc", min: "1.000", maks: "", sumber: "", cocok: "" }), { arah: "KELUAR", urut: "saldo", arahUrut: "asc", nominalMin: "1000", nominalMaks: "", sumber: "", cocok: "" });
  assert.equal(adaSaringanAktif({}), false);
  assert.equal(adaSaringanAktif({ min: "5" }), true);
  assert.deepEqual(OPSI_ARAH.map(([k]) => k), ["MASUK", "KELUAR"]);
  assert.ok(OPSI_URUT.every(([k]) => /^(tanggal|nominal|saldo):(asc|desc)$/.test(k)));
  for (const f of ["MutasiRekening", "MutasiBank"]) {
    const s = baca(`src/features/finance/${f}.jsx`);
    assert.match(s, /\.\.\.saring \}/, `${f}: parameter saring dikirim ke API`);
    assert.match(s, /filter: \{[^}]*\.\.\.saring/, `${f}: export membawa saringan layar`);
    assert.match(s, /<SaringNominal/, `${f}: rentang nominal`);
    assert.match(s, /key: "arah"/); assert.match(s, /key: "urut"/);
  }
  assert.match(baca("src/features/finance/MutasiRekening.jsx"), /key: "sumber"/);
});
