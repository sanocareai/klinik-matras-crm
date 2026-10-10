// KONTRAK METRIK FINANCE (Fase 1) — tata-kelola: setiap metrik lengkap, pasangan/ekspor menunjuk yang nyata, glosarium konsisten. Tanpa database.
import test from "node:test";
import assert from "node:assert/strict";
import { METRIK, BASIS, KELOMPOK, GLOSARIUM, metrik, metrikUntukHalaman, metrikUntukModulExport, kontrakUntukKlien } from "../src/services/finance/kontrakMetrik.js";
import { MODUL_EXPORT } from "../src/services/finance/export/registry.js";

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

test("COVERAGE TAB: setiap halaman Finance diklasifikasi — punya metrik di kontrak atau dinyatakan tanpa angka uang; kartu UI hanya memakai kunci metrik yang ada", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src/pages/finance");
  // Halaman tanpa kartu angka uang (daftar/pengaturan/buku) — dinyatakan eksplisit supaya halaman baru tidak lolos tanpa klasifikasi.
  const TANPA_ANGKA = new Set(["FinanceAccounts.jsx", "FinanceInvoices.jsx", "FinanceJournal.jsx", "FinanceLedger.jsx", "FinancePersediaanAwal.jsx", "FinanceSettings.jsx", "FinancePengecualianLunas.jsx", "FinancePenjualanKaryawan.jsx",
    // Purchase Order: nilai PO/ditunggu adalah KOMITMEN dokumen (harga × jumlah), bukan angka buku besar — PO tidak menjurnal apa pun, jadi tidak ada metrik kontrak untuknya.
    "FinancePurchaseOrders.jsx",
    // Biaya Bahan per Unit: kartu angkanya hidup di komponen JejakBiayaBahan (read-model nilai beku); definisinya tetap di kontrak (biaya_bahan_*) dan dipakai panel KenapaBeda halaman ini.
    "FinanceBiayaBahan.jsx",
    // Retur Supplier & Debit Note: pembungkus tipis ke features/returSupplier (daftar dokumen retur / debit note / saldo kredit). Nilai di layar adalah nilai DOKUMEN; belum ada metrik kontrak untuk
    // retur/debit note. Klasifikasi SEMENTARA saat rilis 11 Okt 2026 agar halaman baru tidak lolos tanpa klasifikasi — pemilik kontrak Finance menentukan bila ingin metrik retur_supplier_*.
    "FinanceReturSupplier.jsx"]);
  // Halaman tipis yang seluruh kartunya hidup di komponen fitur: kunci metrik dibaca dari komponen itu (tetap divalidasi terhadap kontrak).
  const DELEGASI_FITUR = { "FinanceLaporanDivisi.jsx": "../features/laporanDivisi/LaporanDivisi.jsx" };
  const kunci = new Set(METRIK.map((m) => m.kunci));
  for (const f of fs.readdirSync(akar).filter((x) => x.endsWith(".jsx"))) {
    const src = fs.readFileSync(path.join(akar, DELEGASI_FITUR[f] ? path.join("..", DELEGASI_FITUR[f]) : f), "utf8");
    const dipakai = [...src.matchAll(/metrik[=:]\s*\{?\s*"([a-z_]+)"/g)].map((m) => m[1]);
    for (const d of dipakai) assert.ok(kunci.has(d), `${f}: metrik="${d}" tidak ada di kontrak`);
    for (const m of src.matchAll(/metrik=\{\[([^\]]+)\]\}/g)) for (const d of m[1].match(/"([a-z_]+)"/g) ?? []) assert.ok(kunci.has(d.replace(/"/g, "")), `${f}: ${d} tidak ada di kontrak`);
    assert.ok(dipakai.length > 0 || TANPA_ANGKA.has(f), `${f}: halaman Finance tidak punya metrik kontrak dan belum dinyatakan tanpa angka uang`);
  }
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
