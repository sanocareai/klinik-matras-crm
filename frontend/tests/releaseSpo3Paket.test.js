// Paket rilis spo3 (UX editor & rincian PO): FRONTEND-SAJA dengan ALLOWLIST EKSPLISIT.
// Dikunci: himpunan berkas persis, berkas lain (branch lain, backend, package, main.jsx, Layout.jsx, financeHubs.js, komponen ui/) ditolak generator, skrip identik dengan hasil bangkitan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").replace(/\r\n/g, "\n");
const skrip = baca("scripts/release-finance-po-ux.sh");
const { bangkitkan } = createRequire(import.meta.url)(path.join(akar, "scripts", "gen-release-finance-po-ux.cjs"));

const APLIKASI = [
  "frontend/src/components/financeIconsPO.jsx", "frontend/src/features/finance/po/EditorPO.jsx", "frontend/src/features/finance/po/KontrolPO.jsx", "frontend/src/features/finance/po/RincianPO.jsx",
  "frontend/src/features/finance/po/poKontrol.js", "frontend/src/features/finance/po/poTampilan.js", "frontend/src/pages/finance/FinancePurchaseOrders.jsx", "frontend/src/styles/sanss-finance-po.css",
  "frontend/tests/poEditorUxUI.test.js", "frontend/tests/poKontrolLogika.test.js", "frontend/tests/releaseSpo3Paket.test.js",
];
const TPL = ["bandingkan-kode", "build-only", "container-baru", "fitur-dist", "header", "verifikasi-hotfix"].map((n) => `scripts/templates/release-finance-po-ux/${n}.txt`);
const TPL_P = ["gerbang-kode-live", "hitung-pasca", "hitung-pra"].map((n) => `scripts/templates/release-penjadwalan-langsung/${n}.txt`);
const TETAP = ["scripts/gen-release-finance-po-ux.cjs", "scripts/release-finance-po-ux.sh", ...TPL, ...TPL_P];
const blok = () => Object.fromEntries([...TPL, ...TPL_P].map((f) => [path.basename(f, ".txt"), baca(f)]));
const bangun = (daftar) => bangkitkan({ baseScript: baca("scripts/release-gudang-pintu-masuk.sh"), blok: blok(), berkasList: daftar });

test("allowlist skrip = sebelas berkas aplikasi/tes yang disetujui + berkas rilis sendiri, tidak ada yang lain", () => {
  const baris = skrip.split("\n").find((l) => l.startsWith("ALLOWED_RE="));
  const isi = baris.slice("ALLOWED_RE='^(".length, -")$'".length).split("|").map((x) => x.replace(/\\\./g, "."));
  assert.deepEqual([...isi].sort(), [...APLIKASI, ...TETAP].sort());
  assert.doesNotMatch(baris, /backend\/|package|docker|\.env|main\.jsx|Layout\.jsx|financeHubs|components\/ui\/|FinanceCash|FinancePemasukan|FakturSupplierPO/);
  const fe = skrip.split("\n").find((l) => l.startsWith("FRONTEND_SRC_EXPECT=")).slice('FRONTEND_SRC_EXPECT="'.length, -1).split(" ");
  assert.deepEqual(fe, APLIKASI.filter((f) => f.startsWith("frontend/src/")));
});

test("generator MENOLAK berkas di luar allowlist dan berkas yang kurang", () => {
  assert.doesNotThrow(() => bangun(APLIKASI));
  for (const ekstra of ["frontend/src/main.jsx", "frontend/src/components/Layout.jsx", "frontend/src/components/ui/modal.jsx", "frontend/src/lib/financeHubs.js", "frontend/src/pages/finance/FinanceCash.jsx", "frontend/src/pages/finance/FinancePemasukan.jsx",
    "frontend/src/features/finance/po/FakturSupplierPO.jsx", "frontend/src/pages/bengkel/Produksi.jsx", "backend/src/routes/financeTransactions.js", "frontend/package.json", "frontend/tests/lain.test.js"]) {
    assert.throws(() => bangun([...APLIKASI, ekstra]), /allowlist|FRONTEND-SAJA|dependensi/, ekstra);
  }
  assert.throws(() => bangun(APLIKASI.slice(1)), /allowlist eksplisit/, "berkas yang disetujui hilang dari diff");
});

test("skrip: kode spo3, bandingkan_kode dua berkas persis, tanpa pengecualian seluruh tests/, backend/ di diff dilarang, tanpa penghapusan di luar release dir sementara", () => {
  assert.match(skrip, /\/tmp\/spo3\.sh/);
  assert.match(skrip, /bandingkan_kode "\$BK_DIR\/container-sha\.txt" "\$BK_DIR\/dir-sha\.txt" \|\|/);
  assert.doesNotMatch(skrip, /grep -v[xE]* ['"]?(\^?tests\/?|tests\/helpers\/?)['"]?(\s|$)/);
  const pola = skrip.match(/tests\/\(financeKontrakMetrik[^)]*\)/g) || [];
  assert.ok(pola.length >= 3);
  for (const p of pola) assert.equal(p.replace(/\\\./g, "."), "tests/(financeKontrakMetrik.test.js|helpers/pemeriksaMetrikUi.js)");
  assert.match(skrip, /\^\(backend\//);
  assert.doesNotMatch(skrip.replace('rm -rf -- "$NEW_DIR"', ""), /rm -rf[^\n]*(RELEASES\b|PREV_DIR|backups|volume)/);
  assert.doesNotMatch(skrip.split("\n").filter((l) => !l.startsWith("#")).join("\n"), /spo1|spo2|skb1|gpm\b|pjl\\\|/, "tidak ada sisa nama rilis lain di luar komentar");
});

test("penanda dist: teks/CSS baru ada di dist baru & TIDAK di dist aktif; faktur supplier PO, Kas & Bank, PO harus tetap ada", () => {
  const fd = baca("scripts/templates/release-finance-po-ux/fitur-dist.txt");
  const baru = fd.split("for s0 in")[1].split("; do")[0];
  for (const t of ["Menyimpan draf dapat memperbarui Harga Berlaku bahan.", "Sudah menerima faktur supplier?", "Supplier sudah memberi faktur?", "Cari supplier…", "Tahun sebelumnya", "Pakai termin supplier", "Arti status ini", "Cara membaca kolom item"]) assert.ok(baru.includes(`"${t}"`), t);
  assert.ok(fd.split("for c1 in")[1].split("; do")[0].includes('".fin-tgl-pop"'));
  const lama = fd.split("for s2 in")[1].split("; do")[0];
  for (const t of ["Belum ada faktur tercatat", "Lengkapi nomor faktur supplier", "Nomor supplier belum diisi", "Pencocokan bank belum aktif", "Rincian perhitungan"]) assert.ok(lama.includes(`"${t}"`), t);
  const css = fd.split("for c0 in")[1].split("; do")[0];
  for (const c of [".fin-pof-tabel", ".fin-ks-kartu", ".fin-po-baris"]) assert.ok(css.includes(`"${c}"`), c);
});

test("skrip tersimpan identik dengan hasil bangkitan ulang (tak diedit tangan)", () => {
  assert.equal(bangun(APLIKASI).script, skrip);
});
