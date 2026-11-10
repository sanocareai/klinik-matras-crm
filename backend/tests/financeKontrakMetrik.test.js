// KONTRAK METRIK FINANCE (Fase 1) — tata-kelola: setiap metrik lengkap, pasangan/ekspor menunjuk yang nyata, glosarium konsisten. Tanpa database.
import test from "node:test";
import assert from "node:assert/strict";
import { METRIK, BASIS, KELOMPOK, GLOSARIUM, metrik, metrikUntukHalaman, metrikUntukModulExport, kontrakUntukKlien } from "../src/services/finance/kontrakMetrik.js";
import { MODUL_EXPORT } from "../src/services/finance/export/registry.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ekstrakDeklarasiMetrik, periksaHalamanMetrik, periksaSemuaHalaman } from "./helpers/pemeriksaMetrikUi.js";

test("Setiap metrik punya definisi, rumus, sumber, status, basis valid, kelompok valid, dan halaman", () => {
  for (const x of METRIK) {
    for (const f of ["kunci", "nama", "definisi", "rumus", "sumber", "status"]) assert.ok(typeof x[f] === "string" && x[f].trim().length > 3, `${x.kunci}.${f} kosong`);
    assert.ok(BASIS[x.basis], `${x.kunci}: basis ${x.basis} tidak dikenal`);
    assert.ok(KELOMPOK[x.kelompok], `${x.kunci}: kelompok ${x.kelompok} tidak dikenal`);
    assert.ok(Array.isArray(x.halaman) && x.halaman.length > 0, `${x.kunci}: halaman kosong`);
    assert.ok(Array.isArray(x.termasuk) && Array.isArray(x.tidakTermasuk) && Array.isArray(x.pasangan), `${x.kunci}: daftar tidak berbentuk array`);
    assert.ok(x.definisi.length >= 40, `${x.kunci}: definisi terlalu pendek untuk awam`);
  }
});

test("Kunci metrik unik dan snake_case", () => {
  const kunci = METRIK.map((x) => x.kunci);
  assert.equal(new Set(kunci).size, kunci.length);
  for (const k of kunci) assert.match(k, /^[a-z][a-z0-9_]*$/);
});

test("Pasangan rekonsiliasi menunjuk metrik yang ada dan tidak menunjuk dirinya sendiri", () => {
  for (const x of METRIK) for (const p of x.pasangan) {
    assert.ok(metrik(p), `${x.kunci} → pasangan '${p}' tidak ada`);
    assert.notEqual(p, x.kunci);
  }
});

test("Modul ekspor yang disebut metrik benar-benar terdaftar di registry export", () => {
  // "laporan-divisi" diekspor lewat endpoint tersendiri (/api/laporan-divisi/export — izin per divisi), bukan registry Finance.
  for (const x of METRIK) for (const e of x.ekspor) assert.ok(MODUL_EXPORT[e] || e === "laporan-divisi", `${x.kunci} → modul ekspor '${e}' tidak ada`);
  assert.ok(metrikUntukModulExport("pembayaran").length > 0);
});

test("Dua belas istilah wajib ada di glosarium dan menunjuk metrik nyata", () => {
  const wajib = ["Payment tercatat", "Uang masuk terverifikasi", "Klaim Lunas", "Order Lunas terverifikasi", "Pendapatan diakui", "Piutang", "Uang muka pelanggan", "Beban diakui", "Uang keluar", "Utang supplier", "Persediaan / aset", "Komitmen belum dibayar"];
  assert.deepEqual(GLOSARIUM.map((g) => g[0]), wajib);
  for (const [, kunci, arti] of GLOSARIUM) { assert.ok(metrik(kunci), kunci); assert.ok(arti.length > 10); }
});

test("Metrik pembeda uang vs pembukuan memakai basis tanggal yang BENAR (sumber utama selisih antar angka)", () => {
  assert.equal(metrik("uang_masuk_terverifikasi").basis, "TGL_PEMBAYARAN");
  assert.equal(metrik("nilai_order_lunas_perusahaan").basis, "TGL_LUNAS");
  assert.equal(metrik("nilai_lunas_tim_sales").basis, "TGL_LUNAS");
  assert.equal(metrik("pendapatan_diakui").basis, "TGL_BUKU");
  assert.equal(metrik("arus_kas_masuk").basis, "TGL_BUKU");
  assert.equal(metrik("piutang_usaha").basis, "POSISI");
  assert.equal(metrik("utang_supplier").basis, "POSISI");
  assert.equal(metrik("pengeluaran_aktif").basis, "TGL_DOKUMEN");
});

test("Pembayaran supplier & pertanggungjawaban uang muka dijelaskan SEBAGAI bukan pengeluaran baru (anti hitung ganda)", () => {
  assert.match(metrik("utang_supplier").definisi, /MENGURANGI utang/);
  assert.match(metrik("uang_muka_operasional_saldo").definisi, /SEKALI/);
  assert.ok(metrik("uang_keluar_kas").tidakTermasuk.some((t) => /Transfer antar rekening/.test(t)));
  assert.ok(metrik("pembelian_aktif").tidakTermasuk.some((t) => /Tagihan supplier/.test(t)));
});

test("Pencarian per halaman & kontrak klien: basis diperluas dengan label, bukan hanya kunci", () => {
  assert.ok(metrikUntukHalaman("Dashboard").length > 0);
  assert.ok(metrikUntukHalaman("Rekonsiliasi Sales").length > 0);
  const k = kontrakUntukKlien();
  assert.equal(k.metrik.length, METRIK.length);
  assert.equal(k.zonaWaktu, "Asia/Jakarta (WIB, UTC+7)");
  for (const x of k.metrik) { assert.ok(x.basisLabel && x.basisLabel !== x.basis); assert.ok(x.kelompokLabel); }
});

test("Kontrak tidak bisa diubah dari luar (beku)", () => {
  assert.ok(Object.isFrozen(METRIK));
  assert.throws(() => { "use strict"; METRIK.push({}); });
});

test("Setiap modul export terdaftar punya ≥1 definisi angka; sheet 'Definisi Angka' memuat kolom wajib & basis tanggal tercetak", async () => {
  const { sheetDefinisiAngka, basisTanggalModul } = await import("../src/services/finance/kontrakMetrik.js");
  for (const kunci of Object.keys(MODUL_EXPORT)) {
    const sh = sheetDefinisiAngka(kunci);
    assert.ok(sh.baris.length > 0, `modul export '${kunci}' tanpa definisi angka`);
    assert.deepEqual(sh.kolom.map((k) => k.key), ["nama", "definisi", "rumus", "sumber", "status", "basis", "termasuk", "tidakTermasuk", "pasangan"]);
    assert.ok(basisTanggalModul(kunci).length > 3);
  }
  assert.match(basisTanggalModul("pembayaran"), /Tanggal pembayaran diterima/);
});

// ── COVERAGE TAB (dipecah PER HALAMAN) ──
// Setiap halaman Finance diklasifikasi: punya deklarasi metrik yang valid di kontrak, atau dinyatakan tanpa angka uang. Satu tes per halaman, jadi kegagalan satu halaman
// TIDAK menghentikan pemeriksaan halaman lain. Aturan baca-teks ada di tests/helpers/pemeriksaMetrikUi.js (dibuktikan oleh tes di bawah).
const AKAR_HALAMAN_FINANCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src/pages/finance");
// Halaman tanpa kartu angka uang (daftar/pengaturan/buku) — dinyatakan eksplisit supaya halaman baru tidak lolos tanpa klasifikasi.
const TANPA_ANGKA = new Set(["FinanceAccounts.jsx", "FinanceInvoices.jsx", "FinanceJournal.jsx", "FinanceLedger.jsx", "FinancePersediaanAwal.jsx", "FinanceSettings.jsx", "FinancePengecualianLunas.jsx", "FinancePenjualanKaryawan.jsx",
  // Purchase Order: nilai PO/ditunggu adalah KOMITMEN dokumen (harga × jumlah), bukan angka buku besar — PO tidak menjurnal apa pun, jadi tidak ada metrik kontrak untuknya.
  "FinancePurchaseOrders.jsx",
  // Biaya Bahan per Unit: kartu angkanya hidup di komponen JejakBiayaBahan (read-model nilai beku); definisinya tetap di kontrak (biaya_bahan_*) dan dipakai panel KenapaBeda halaman ini.
  "FinanceBiayaBahan.jsx",
  // Retur Supplier & Debit Note: pembungkus tipis ke features/returSupplier (daftar dokumen retur / debit note / saldo kredit). Nilai di layar adalah nilai DOKUMEN; belum ada metrik kontrak untuk
  // retur/debit note. Klasifikasi SEMENTARA saat rilis 11 Okt 2026 agar halaman baru tidak lolos tanpa klasifikasi — pemilik kontrak Finance menentukan bila ingin metrik retur_supplier_*.
  "FinanceReturSupplier.jsx",
  // HPP per Order & Laba Sementara (Nov 2026): angka di kartu adalah HPP OPERASIONAL (Harga Berlaku) dan hasil manajemen SEMENTARA (final:false), bukan metrik buku besar; angka jurnal
  // di halaman ini diambil apa adanya dari labaRugi(). Klasifikasi SEMENTARA — pemilik kontrak Finance menentukan bila ingin metrik hpp_order_* / hasil_manajemen_*.
  "FinanceHppOrder.jsx"]);
// Halaman tipis yang seluruh kartunya hidup di komponen fitur: kunci metrik dibaca dari komponen itu (tetap divalidasi terhadap kontrak).
const DELEGASI_FITUR = { "FinanceLaporanDivisi.jsx": "../features/laporanDivisi/LaporanDivisi.jsx" };
// Halaman yang sebagian kartunya pindah ke komponen fitur anak (redesain Pemasukan, Nov 2026): halaman + komponen itu dibaca BERSAMA.
const GABUNG_FITUR = { "FinancePemasukan.jsx": ["../features/finance/pemasukan/RingkasanPemasukan.jsx", "../features/finance/pemasukan/DaftarPemasukan.jsx"] };

const sumberHalaman = (f) => (DELEGASI_FITUR[f]
  ? fs.readFileSync(path.join(AKAR_HALAMAN_FINANCE, path.join("..", DELEGASI_FITUR[f])), "utf8")
  : [f, ...(GABUNG_FITUR[f] ?? []).map((p) => path.join("..", p))].map((p) => fs.readFileSync(path.join(AKAR_HALAMAN_FINANCE, p), "utf8")).join("\n"));
const KUNCI_KONTRAK = new Set(METRIK.map((m) => m.kunci));

for (const f of fs.readdirSync(AKAR_HALAMAN_FINANCE).filter((x) => x.endsWith(".jsx")).sort()) {
  test(`COVERAGE TAB ${f}: punya metrik kontrak yang valid atau dinyatakan tanpa angka uang`, () => {
    const masalah = periksaHalamanMetrik({ nama: f, sumber: sumberHalaman(f), kunciKontrak: KUNCI_KONTRAK, tanpaAngka: TANPA_ANGKA.has(f) });
    assert.deepEqual(masalah, [], masalah.join("\n"));
  });
}

test("PEMERIKSA 1: kunci bermasalah (kapital, angka di depan, tanda hubung, spasi) DILAPORKAN — tidak dilewati diam-diam", () => {
  const kontrak = new Set(["piutang_usaha", "metrik_2"]);
  const lap = (sumber) => periksaHalamanMetrik({ nama: "X.jsx", sumber, kunciKontrak: kontrak });
  assert.match(lap('<Kartu metrik="Piutang_Usaha" />').join("\n"), /kunci metrik "Piutang_Usaha" tidak valid/, "kapital");
  assert.match(lap('<Kartu metrik="2piutang" />').join("\n"), /tidak valid/, "diawali angka");
  assert.match(lap('<Kartu metrik="piutang-usaha" />').join("\n"), /tidak valid/, "tanda hubung");
  assert.match(lap('<Kartu metrik={{ a: 1 }} metrik: "salah kunci" />').join("\n"), /tidak valid/, "spasi");
  assert.match(lap('const K = { metrik: "klaim_lunas_SALAH" };').join("\n"), /tidak valid/, "kapital pada bentuk objek");
  // kunci berbentuk benar tetapi tidak ada di kontrak → pesan berbeda; kunci valid (termasuk yang memuat angka) → lolos
  assert.match(lap('<Kartu metrik="tidak_ada" />').join("\n"), /metrik="tidak_ada" tidak ada di kontrak/);
  assert.deepEqual(lap('<Kartu metrik="piutang_usaha" />'), []);
  assert.deepEqual(lap('<Kartu metrik="metrik_2" />'), [], "angka di tengah/akhir kunci sah");
});

test("PEMERIKSA 2: deklarasi berbentuk LARIK dihitung sebagai deklarasi dan setiap anggotanya divalidasi (kasus FinanceReceivables.jsx)", () => {
  const kontrak = new Set(["piutang_usaha", "refund_diberikan"]);
  const lap = (sumber, tanpaAngka = false) => periksaHalamanMetrik({ nama: "X.jsx", sumber, kunciKontrak: kontrak, tanpaAngka });
  // hanya larik → tidak lagi dianggap "tanpa metrik"
  assert.deepEqual(lap('<KenapaBeda metrik={["piutang_usaha", "refund_diberikan"]} />'), []);
  // anggota salah dilaporkan satu per satu, termasuk kapital
  const m = lap('<KenapaBeda metrik={["piutang_usaha", "tidak_ada", "Refund_Diberikan"]} />').join("\n");
  assert.match(m, /metrik="tidak_ada" tidak ada di kontrak/); assert.match(m, /kunci metrik "Refund_Diberikan" tidak valid/);
  // bentuk objek dengan larik juga dikenali
  assert.deepEqual(lap("const A = { metrik: ['piutang_usaha'] };"), []);
  // halaman tanpa deklarasi apa pun tetap wajib dinyatakan tanpa angka uang
  assert.match(lap("<div>tanpa kartu</div>").join("\n"), /belum dinyatakan tanpa angka uang/);
  assert.deepEqual(lap("<div>tanpa kartu</div>", true), []);
  // ekstraksi: urutan kemunculan + bentuk
  assert.deepEqual(ekstrakDeklarasiMetrik('<A metrik="piutang_usaha" /><B metrik={["x_1", "y_2"]} />'), [{ kunci: "piutang_usaha", bentuk: "tunggal" }, { kunci: "x_1", bentuk: "larik" }, { kunci: "y_2", bentuk: "larik" }]);
  // dan sumber nyata: FinanceReceivables.jsx memang hanya memakai larik, dan kini lolos
  const nyata = fs.readFileSync(path.join(AKAR_HALAMAN_FINANCE, "FinanceReceivables.jsx"), "utf8");
  assert.ok(ekstrakDeklarasiMetrik(nyata).length > 0 && ekstrakDeklarasiMetrik(nyata).every((d) => d.bentuk === "larik"), "FinanceReceivables.jsx hanya memakai deklarasi larik");
  assert.deepEqual(periksaHalamanMetrik({ nama: "FinanceReceivables.jsx", sumber: nyata, kunciKontrak: KUNCI_KONTRAK }), []);
});

test("PEMERIKSA 3: kegagalan dilaporkan PER HALAMAN — halaman bermasalah di awal tidak menghentikan pemeriksaan halaman sesudahnya", () => {
  const kontrak = new Set(["ada"]);
  const hasil = periksaSemuaHalaman([
    { nama: "A.jsx", sumber: '<K metrik="bukan_kontrak" />' },   // gagal (di awal)
    { nama: "B.jsx", sumber: '<K metrik="ada" />' },             // lolos
    { nama: "C.jsx", sumber: "<div/>" },                         // gagal (tanpa metrik, tidak dinyatakan)
    { nama: "D.jsx", sumber: "<div/>" },                         // lolos (dinyatakan tanpa angka)
    { nama: "E.jsx", sumber: '<K metrik="Ada" />' },             // gagal (di akhir, setelah halaman gagal lain)
  ], kontrak, new Set(["D.jsx"]));
  assert.deepEqual(Object.keys(hasil), ["A.jsx", "B.jsx", "C.jsx", "D.jsx", "E.jsx"], "semua halaman diperiksa");
  assert.equal(hasil["A.jsx"].length, 1); assert.deepEqual(hasil["B.jsx"], []); assert.equal(hasil["C.jsx"].length, 1); assert.deepEqual(hasil["D.jsx"], []);
  assert.match(hasil["E.jsx"].join("\n"), /tidak valid/, "halaman terakhir tetap diperiksa setelah beberapa kegagalan");
});

test("COVERAGE METRIK: seluruh metrik kontrak dipakai di UI (kartu/panel Kenapa angkanya berbeda) — tidak ada metrik yatim", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src");
  const berkas = [];
  (function jalan(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) jalan(p); else if (/\.jsx?$/.test(e.name)) berkas.push(p); } })(akar);
  const sumber = berkas.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const yatim = METRIK.filter((m) => !sumber.includes(`"${m.kunci}"`)).map((m) => m.kunci);
  assert.deepEqual(yatim, [], `metrik tanpa pemakaian di UI: ${yatim.join(", ")}`);
});
