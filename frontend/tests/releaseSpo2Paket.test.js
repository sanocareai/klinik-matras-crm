// Paket rilis spo2 (nomor faktur supplier PO + tautan Catat pemasukan lain): FRONTEND-SAJA dengan ALLOWLIST EKSPLISIT.
// Dikunci: himpunan berkas persis, berkas lain (mis. dari branch lain di remote, backend, package, main.jsx, financeHubs.js) ditolak generator, skrip tidak berubah dari hasil bangkitan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").replace(/\r\n/g, "\n");
const skrip = baca("scripts/release-finance-po-faktur.sh");
const { bangkitkan } = createRequire(import.meta.url)(path.join(akar, "scripts", "gen-release-finance-po-faktur.cjs"));

const APLIKASI = [
  "frontend/src/features/finance/po/FakturSupplierPO.jsx", "frontend/src/features/finance/po/RincianPO.jsx", "frontend/src/features/finance/po/poTampilan.js",
  "frontend/src/pages/finance/FinancePemasukan.jsx", "frontend/src/pages/finance/FinanceSuppliers.jsx", "frontend/src/styles/sanss-finance-po.css",
  "frontend/tests/pemasukanTautanRute.test.js", "frontend/tests/poNomorFakturSupplier.test.js", "frontend/tests/releaseSpo2Paket.test.js",
];
const TPL = ["bandingkan-kode", "build-only", "container-baru", "fitur-dist", "header", "verifikasi-hotfix"].map((n) => `scripts/templates/release-finance-po-faktur/${n}.txt`);
const TPL_P = ["gerbang-kode-live", "hitung-pasca", "hitung-pra"].map((n) => `scripts/templates/release-penjadwalan-langsung/${n}.txt`);
const TETAP = ["scripts/gen-release-finance-po-faktur.cjs", "scripts/release-finance-po-faktur.sh", ...TPL, ...TPL_P];
const blok = () => Object.fromEntries([...TPL, ...TPL_P].map((f) => [path.basename(f, ".txt"), baca(f)]));
const baseScript = () => baca("scripts/release-gudang-pintu-masuk.sh");
const bangun = (daftar) => bangkitkan({ baseScript: baseScript(), blok: blok(), berkasList: daftar });

test("allowlist skrip = sembilan berkas aplikasi yang disetujui + berkas rilis sendiri, tidak ada yang lain", () => {
  const baris = skrip.split("\n").find((l) => l.startsWith("ALLOWED_RE="));
  const isi = baris.slice("ALLOWED_RE='^(".length, -")$'".length).split("|").map((x) => x.replace(/\\\./g, "."));
  assert.deepEqual([...isi].sort(), [...APLIKASI, ...TETAP].sort());
  assert.doesNotMatch(baris, /backend\/|package|docker|\.env|main\.jsx|financeHubs|FinanceCash|kasbank/);
  const fe = skrip.split("\n").find((l) => l.startsWith("FRONTEND_SRC_EXPECT=")).slice('FRONTEND_SRC_EXPECT="'.length, -1).split(" ");
  assert.deepEqual(fe, APLIKASI.filter((f) => f.startsWith("frontend/src/")));
});

test("generator MENOLAK berkas di luar allowlist (branch lain, backend, package, main.jsx, financeHubs.js, FinanceCash.jsx) dan berkas yang kurang", () => {
  assert.doesNotThrow(() => bangun(APLIKASI));
  for (const ekstra of ["frontend/src/pages/finance/FinanceCash.jsx", "frontend/src/lib/financeHubs.js", "frontend/src/main.jsx", "frontend/src/pages/finance/FinanceInvoices.jsx", "frontend/src/features/finance/po/EditorPO.jsx", "backend/src/routes/financeTransactions.js", "frontend/package.json", "frontend/tests/lain.test.js"]) {
    assert.throws(() => bangun([...APLIKASI, ekstra]), /allowlist|FRONTEND-SAJA|dependensi/, ekstra);
  }
  assert.throws(() => bangun(APLIKASI.slice(1)), /allowlist eksplisit/, "berkas yang disetujui hilang dari diff");
});

test("skrip: kode spo2, bandingkan_kode dua berkas persis, tanpa pengecualian seluruh tests/, backend/ di diff dilarang, tanpa penghapusan di luar release dir sementara", () => {
  assert.match(skrip, /\/tmp\/spo2\.sh/);
  assert.match(skrip, /bandingkan_kode "\$BK_DIR\/container-sha\.txt" "\$BK_DIR\/dir-sha\.txt" \|\|/);
  assert.doesNotMatch(skrip, /grep -v[xE]* ['"]?(\^?tests\/?|tests\/helpers\/?)['"]?(\s|$)/);
  const pola = skrip.match(/tests\/\(financeKontrakMetrik[^)]*\)/g) || [];
  assert.ok(pola.length >= 3);
  for (const p of pola) assert.equal(p.replace(/\\\./g, "."), "tests/(financeKontrakMetrik.test.js|helpers/pemeriksaMetrikUi.js)");
  assert.match(skrip, /\^\(backend\//);
  assert.doesNotMatch(skrip.replace('rm -rf -- "$NEW_DIR"', ""), /rm -rf[^\n]*(RELEASES\b|PREV_DIR|backups|volume)/);
  assert.doesNotMatch(skrip.split("\n").filter((l) => !l.startsWith("#")).join("\n"), /spo1|skb1|gpm\b|pjl\\\|/, "tidak ada sisa nama rilis lain di luar komentar");
});

test("penanda dist: teks/CSS baru harus ada di dist baru dan TIDAK di dist aktif; Kas & Bank + PO spo1 harus tetap ada", () => {
  const fd = baca("scripts/templates/release-finance-po-faktur/fitur-dist.txt");
  for (const t of ["Belum ada faktur tercatat", "Lengkapi nomor faktur supplier", "Nomor supplier belum diisi", "Hanya nomor faktur supplier yang berubah"]) assert.ok(fd.split("for s0 in")[1].split("; do")[0].includes(`"${t}"`), t);
  assert.ok(fd.split("for c1 in")[1].split("; do")[0].includes('".fin-pof-tabel"'));
  const lama = fd.split("for s2 in")[1].split("; do")[0];
  for (const t of ["Pencocokan bank belum aktif", "Rincian perhitungan"]) assert.ok(lama.includes(`"${t}"`), t);
  assert.ok(fd.split("for c0 in")[1].split("; do")[0].includes('".fin-ks-kartu"'));
});

test("skrip tersimpan identik dengan hasil bangkitan ulang (tak diedit tangan)", () => {
  assert.equal(bangun(APLIKASI).script, skrip);
});
