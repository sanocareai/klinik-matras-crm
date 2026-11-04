// Paket rilis spu3 (redesain visual Pembelian & Supplier: ikon Apple, tombol menyala, kartu KPI berwarna, daftar selaras): FRONTEND-SAJA dengan ALLOWLIST EKSPLISIT.
// Dikunci: himpunan berkas persis, berkas lain (backend, package, main.jsx, Layout.jsx, berkas Produksi) ditolak generator, skrip identik dengan hasil bangkitan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").replace(/\r\n/g, "\n");
const skrip = baca("scripts/release-finance-apple.sh");
const { bangkitkan } = createRequire(import.meta.url)(path.join(akar, "scripts", "gen-release-finance-apple.cjs"));

const APLIKASI = [
  "frontend/src/components/ikApple.jsx", "frontend/src/features/finance/DaftarGaya.jsx", "frontend/src/features/finance/JadwalAgingUtang.jsx", "frontend/src/features/finance/RowActions.jsx", "frontend/src/features/finance/UangMukaPO.jsx", "frontend/src/features/finance/UangMukaSupplierTabel.jsx", "frontend/src/features/finance/po/DaftarPO.jsx", "frontend/src/features/finance/po/EditorPO.jsx", "frontend/src/features/finance/po/FakturSupplierPO.jsx", "frontend/src/features/finance/po/KontrolPO.jsx", "frontend/src/features/finance/po/RincianPO.jsx", "frontend/src/features/finance/tagihan/CatatTagihan.jsx", "frontend/src/features/finance/tagihan/DaftarTagihan.jsx", "frontend/src/features/finance/tagihan/RincianTagihan.jsx", "frontend/src/features/finance/tagihan/UbahTagihan.jsx", "frontend/src/features/finance/uangMukaFaktur/PenerapanUangMuka.jsx", "frontend/src/pages/finance/FinancePurchases.jsx", "frontend/src/pages/finance/FinanceSuppliers.jsx", "frontend/src/styles/ik-apple.css", "frontend/src/styles/sanss-finance-daftar.css", "frontend/tests/financeDetailCoverage.test.js", "frontend/tests/ikonApplePembelianSupplier.test.js", "frontend/tests/releaseSpu3Paket.test.js", "frontend/tests/supplierEdit.test.js", "frontend/tests/tagihanTabelLayout.test.js"
];
const TPL = ["bandingkan-kode", "build-only", "container-baru", "fitur-dist", "header", "verifikasi-hotfix"].map((n) => `scripts/templates/release-finance-apple/${n}.txt`);
const TPL_P = ["gerbang-kode-live", "hitung-pasca", "hitung-pra"].map((n) => `scripts/templates/release-penjadwalan-langsung/${n}.txt`);
const TETAP = ["scripts/gen-release-finance-apple.cjs", "scripts/release-finance-apple.sh", ...TPL, ...TPL_P];
const blok = () => Object.fromEntries([...TPL, ...TPL_P].map((f) => [path.basename(f, ".txt"), baca(f)]));
const bangun = (daftar) => bangkitkan({ baseScript: baca("scripts/release-gudang-pintu-masuk.sh"), blok: blok(), berkasList: daftar });

test("allowlist skrip = 25 berkas aplikasi/tes yang disetujui + berkas rilis sendiri, tidak ada yang lain", () => {
  const baris = skrip.split("\n").find((l) => l.startsWith("ALLOWED_RE="));
  const isi = baris.slice("ALLOWED_RE='^(".length, -")$'".length).split("|").map((x) => x.replace(/\\\./g, "."));
  assert.deepEqual([...isi].sort(), [...APLIKASI, ...TETAP].sort());
  assert.doesNotMatch(baris, /backend\/|package|docker|\.env|main\.jsx|Layout\.jsx/);
  const fe = skrip.split("\n").find((l) => l.startsWith("FRONTEND_SRC_EXPECT=")).slice('FRONTEND_SRC_EXPECT="'.length, -1).split(" ");
  assert.deepEqual(fe, APLIKASI.filter((f) => f.startsWith("frontend/src/")));
});

test("generator MENOLAK berkas di luar allowlist dan berkas yang kurang", () => {
  assert.doesNotThrow(() => bangun(APLIKASI));
  for (const ekstra of ["frontend/src/main.jsx", "frontend/src/components/Layout.jsx", "frontend/src/pages/finance/FinanceCash.jsx", "frontend/src/features/finance/Uang.jsx", "frontend/src/styles/index.css",
    "frontend/src/index.css", "backend/src/routes/purchaseOrders.js", "frontend/package.json", "frontend/tests/lain.test.js"]) {
    assert.throws(() => bangun([...APLIKASI, ekstra]), /allowlist|FRONTEND-SAJA|dependensi/, ekstra);
  }
  assert.throws(() => bangun(APLIKASI.slice(1)), /allowlist eksplisit/, "berkas yang disetujui hilang dari diff");
});

test("skrip: kode spu3, bandingkan_kode dua berkas persis, backend/ di diff dilarang, tanpa penghapusan di luar release dir sementara, tanpa sisa nama rilis lain", () => {
  assert.match(skrip, /\/tmp\/spu3\.sh/);
  assert.match(skrip, /bandingkan_kode "\$BK_DIR\/container-sha\.txt" "\$BK_DIR\/dir-sha\.txt" \|\|/);
  const pola = skrip.match(/tests\/\(financeKontrakMetrik[^)]*\)/g) || [];
  assert.ok(pola.length >= 3);
  for (const p of pola) assert.equal(p.replace(/\\\./g, "."), "tests/(financeKontrakMetrik.test.js|helpers/pemeriksaMetrikUi.js)");
  assert.match(skrip, /\^\(backend\//);
  assert.doesNotMatch(skrip.replace('rm -rf -- "$NEW_DIR"', ""), /rm -rf[^\n]*(RELEASES\b|PREV_DIR|backups|volume)/);
  assert.doesNotMatch(skrip.split("\n").filter((l) => !l.startsWith("#")).join("\n"), /spo1|spo2|spo3|spt1|spt2|spu1|spu2|skb1|spr1|sgs\d|gpm\b|pjl\\\|/, "tidak ada sisa nama rilis lain di luar komentar");
});

test("penanda dist: teks/CSS redesain baru ada di dist baru & TIDAK di dist aktif; lapisan sebelumnya (footer HP, uang muka, Ubah tagihan, redesain Tagihan, UX PO, Kas & Bank) harus tetap ada", () => {
  const fd = baca("scripts/templates/release-finance-apple/fitur-dist.txt");
  const baru = fd.split("for s0 in")[1].split("; do")[0];
  for (const t of ["Total dibayar (terposting)", "Menutup tagihan supplier; satu pembayaran bisa melunasi beberapa tagihan", "Jurnal dibalik dan tagihan kembali terbuka"]) assert.ok(baru.includes(`"${t}"`), t);
  const lama = fd.split("for s2 in")[1].split("; do")[0];
  for (const t of ["Penanda uang muka hanya diperiksa untuk", "BELUM tentu bebas uang muka", "Pembayaran BELUM disimpan", "Gunakan uang muka untuk mengurangi sisa tagihan?", "Tetap catat pembayaran", "Total dibayar dari kas", "Penyelesaian faktur", "Tidak bisa diubah di sini", "Tentang angka dan pencatatan", "Sudah menerima faktur supplier?"]) assert.ok(lama.includes(`"${t}"`), t);
  const cssBaru = fd.split("for c1 in")[1].split("; do")[0];
  for (const c of [".fin-kw-baris", ".fin-dl-tabel", ".fin-dl-baris", ".tb-menyala", ".ik-ubin", ".ik-peringatan-um"]) assert.ok(cssBaru.includes(`"${c}"`), c);
  const css = fd.split("for c0 in")[1].split("; do")[0];
  for (const c of [".fin-tg-um-chip", ".fin-tg-ubah-kartu", ".fin-tg-baris", ".fin-tgl-pop", ".fin-pof-tabel", ".fin-ks-kartu", ".fin-po-baris"]) assert.ok(css.includes(`"${c}"`), c);
});

test("skrip tersimpan identik dengan hasil bangkitan ulang (tak diedit tangan)", () => {
  assert.equal(bangun(APLIKASI).script, skrip);
});
