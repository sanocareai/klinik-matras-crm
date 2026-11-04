// Paket rilis spu1 (Finance: uang muka PO → penerapan ke faktur supplier): FRONTEND-SAJA dengan ALLOWLIST EKSPLISIT.
// Dikunci: himpunan berkas persis, berkas lain (backend, package, main.jsx, Layout.jsx, ui/*, berkas Produksi/Gudang) ditolak generator, skrip identik dengan hasil bangkitan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").replace(/\r\n/g, "\n");
const skrip = baca("scripts/release-finance-uang-muka.sh");
const { bangkitkan } = createRequire(import.meta.url)(path.join(akar, "scripts", "gen-release-finance-uang-muka.cjs"));

const APLIKASI = [
  "frontend/src/api.js",
  "frontend/src/features/finance/UangMukaPO.jsx",
  "frontend/src/features/finance/po/FakturSupplierPO.jsx", "frontend/src/features/finance/po/RincianPO.jsx",
  "frontend/src/features/finance/tagihan/DaftarTagihan.jsx", "frontend/src/features/finance/tagihan/RincianTagihan.jsx",
  "frontend/src/features/finance/uangMukaFaktur/PenerapanUangMuka.jsx", "frontend/src/features/finance/uangMukaFaktur/kelayakanLogika.js",
  "frontend/src/pages/finance/FinanceSuppliers.jsx", "frontend/src/styles/sanss-finance-tagihan.css",
  "frontend/tests/releaseSpu1Paket.test.js", "frontend/tests/ubahTagihan.test.js", "frontend/tests/uangMukaFaktur.test.js", "frontend/tests/uangMukaSupplier.test.js",
];
const TPL = ["bandingkan-kode", "build-only", "container-baru", "fitur-dist", "header", "verifikasi-hotfix"].map((n) => `scripts/templates/release-finance-uang-muka/${n}.txt`);
const TPL_P = ["gerbang-kode-live", "hitung-pasca", "hitung-pra"].map((n) => `scripts/templates/release-penjadwalan-langsung/${n}.txt`);
const TETAP = ["scripts/gen-release-finance-uang-muka.cjs", "scripts/release-finance-uang-muka.sh", ...TPL, ...TPL_P];
const blok = () => Object.fromEntries([...TPL, ...TPL_P].map((f) => [path.basename(f, ".txt"), baca(f)]));
const bangun = (daftar) => bangkitkan({ baseScript: baca("scripts/release-gudang-pintu-masuk.sh"), blok: blok(), berkasList: daftar });

test("allowlist skrip = empat belas berkas aplikasi/tes yang disetujui + berkas rilis sendiri, tidak ada yang lain", () => {
  const baris = skrip.split("\n").find((l) => l.startsWith("ALLOWED_RE="));
  const isi = baris.slice("ALLOWED_RE='^(".length, -")$'".length).split("|").map((x) => x.replace(/\\\./g, "."));
  assert.deepEqual([...isi].sort(), [...APLIKASI, ...TETAP].sort());
  assert.doesNotMatch(baris, /backend\/|package|docker|\.env|main\.jsx|Layout\.jsx|components\/ui\/|produksi|bengkel|Production|gudang|warehouse/i);
  const fe = skrip.split("\n").find((l) => l.startsWith("FRONTEND_SRC_EXPECT=")).slice('FRONTEND_SRC_EXPECT="'.length, -1).split(" ");
  assert.deepEqual(fe, APLIKASI.filter((f) => f.startsWith("frontend/src/")));
});

test("generator MENOLAK berkas di luar allowlist dan berkas yang kurang", () => {
  assert.doesNotThrow(() => bangun(APLIKASI));
  for (const ekstra of ["frontend/src/main.jsx", "frontend/src/components/Layout.jsx", "frontend/src/components/ui/modal.jsx", "frontend/src/pages/finance/FinanceCash.jsx", "frontend/src/pages/finance/FinancePurchaseOrders.jsx",
    "frontend/src/features/finance/KoreksiAman.jsx", "frontend/src/lib/financeHubs.js", "frontend/src/pages/bengkel/Production.jsx", "frontend/src/styles/sanss-produksi.css", "backend/src/routes/purchaseOrders.js", "backend/src/services/finance/uangMukaSupplier.js", "frontend/package.json", "frontend/tests/lain.test.js"]) {
    assert.throws(() => bangun([...APLIKASI, ekstra]), /allowlist|FRONTEND-SAJA|dependensi/, ekstra);
  }
  assert.throws(() => bangun(APLIKASI.slice(1)), /allowlist eksplisit/, "berkas yang disetujui hilang dari diff");
});

test("skrip: kode spu1, bandingkan_kode dua berkas persis, tanpa pengecualian seluruh tests/, backend/ di diff dilarang, tanpa penghapusan di luar release dir sementara", () => {
  assert.match(skrip, /\/tmp\/spu1\.sh/);
  assert.match(skrip, /bandingkan_kode "\$BK_DIR\/container-sha\.txt" "\$BK_DIR\/dir-sha\.txt" \|\|/);
  assert.doesNotMatch(skrip, /grep -v[xE]* ['"]?(\^?tests\/?|tests\/helpers\/?)['"]?(\s|$)/);
  const pola = skrip.match(/tests\/\(financeKontrakMetrik[^)]*\)/g) || [];
  assert.ok(pola.length >= 3);
  for (const p of pola) assert.equal(p.replace(/\\\./g, "."), "tests/(financeKontrakMetrik.test.js|helpers/pemeriksaMetrikUi.js)");
  assert.match(skrip, /\^\(backend\//);
  assert.doesNotMatch(skrip.replace('rm -rf -- "$NEW_DIR"', ""), /rm -rf[^\n]*(RELEASES\b|PREV_DIR|backups|volume)/);
  assert.doesNotMatch(skrip.split("\n").filter((l) => !l.startsWith("#")).join("\n"), /spo1|spo2|spo3|spt1|spt2|skb1|spr1|sgs\d|gpm\b|pjl\\\|/, "tidak ada sisa nama rilis lain di luar komentar");
});

test("penanda dist: teks/CSS baru ada di dist baru & TIDAK di dist aktif; lapisan sebelumnya (Ubah tagihan spt2, redesain Tagihan supplier, UX PO, Kas & Bank) harus tetap ada", () => {
  const fd = baca("scripts/templates/release-finance-uang-muka/fitur-dist.txt");
  const baru = fd.split("for s0 in")[1].split("; do")[0];
  for (const t of ["Gunakan uang muka untuk mengurangi sisa tagihan?", "Uang muka PO ini belum diterapkan", "Tidak ada uang keluar baru dari bank", "Tetap catat pembayaran", "Total dibayar dari kas", "Penyelesaian faktur"]) assert.ok(baru.includes(`"${t}"`), t);
  assert.ok(fd.split("for c1 in")[1].split("; do")[0].includes('".fin-tg-um-chip"'));
  const lama = fd.split("for s2 in")[1].split("; do")[0];
  for (const t of ["Tidak bisa diubah di sini", "Koreksi transaksi hanya untuk admin keuangan.", "Sisa kurang dari Rp1: selisih sen", "Tentang angka dan pencatatan", "Nomor faktur belum diisi", "Sudah menerima faktur supplier?"]) assert.ok(lama.includes(`"${t}"`), t);
  const css = fd.split("for c0 in")[1].split("; do")[0];
  for (const c of [".fin-tg-ubah-kartu", ".fin-tg-pendukung", ".fin-tg-baris", ".fin-tgl-pop", ".fin-pof-tabel", ".fin-ks-kartu", ".fin-po-baris"]) assert.ok(css.includes(`"${c}"`), c);
});

test("skrip tersimpan identik dengan hasil bangkitan ulang (tak diedit tangan)", () => {
  assert.equal(bangun(APLIKASI).script, skrip);
});
