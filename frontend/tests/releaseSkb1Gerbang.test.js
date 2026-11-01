// Gerbang rilis Kas & Bank (skb1): perbandingan kode container vs folder release hanya boleh mengabaikan DUA berkas tes pemeriksa kontrak metrik (jalur persis).
// Selisih kode runtime, berkas tambahan, atau tes lain harus MENOLAK. Menjalankan fungsi/perintah asli dari skrip rilis yang dihasilkan lewat bash.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const skrip = fs.readFileSync(path.join(akar, "scripts", "release-finance-kas-bank.sh"), "utf8").replace(/\r\n/g, "\n");
const bashAda = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" }).stdout?.trim() === "ok";
const opsi = { skip: bashAda ? false : "bash tidak tersedia" };

const ambilFungsi = () => {
  const i = skrip.indexOf("bandingkan_kode() {");
  assert.ok(i > 0, "fungsi bandingkan_kode ada di skrip");
  const j = skrip.indexOf("\n}\n", i);
  return skrip.slice(i, j + 3);
};
const hasil = (tmp, daftarA, daftarB) => {
  const a = path.join(tmp, "a.txt"), b = path.join(tmp, "b.txt");
  fs.writeFileSync(a, daftarA.join("\n") + "\n"); fs.writeFileSync(b, daftarB.join("\n") + "\n");
  const r = spawnSync("bash", ["-c", `${ambilFungsi()}\nbandingkan_kode "${a.replace(/\\/g, "/")}" "${b.replace(/\\/g, "/")}"`], { encoding: "utf8" });
  return r.status === 0;
};
const H = (n) => String(n).repeat(64).slice(0, 64);
const DASAR = [`${H(1)}  package-lock.json`, `${H(2)}  package.json`, `${H(3)}  prisma/schema.prisma`, `${H(4)}  src/a.js`, `${H(5)}  tests/x.test.js`];
const METRIK = `  tests/financeKontrakMetrik.test.js`, HELPER = `  tests/helpers/pemeriksaMetrikUi.js`;

test("diterima: identik; atau hanya dua berkas tes pemeriksa yang berbeda/hilang/tambahan (container lama vs folder baru)", opsi, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skb1-"));
  try {
    assert.equal(hasil(tmp, DASAR, DASAR), true, "identik");
    assert.equal(hasil(tmp, [...DASAR, H(6) + METRIK], [...DASAR, H(7) + METRIK, H(8) + HELPER]), true, "tes pemeriksa lama di container, versi baru + helper di folder");
    assert.equal(hasil(tmp, DASAR, [...DASAR, H(7) + METRIK, H(8) + HELPER]), true, "container tanpa dua berkas");
    assert.equal(hasil(tmp, [...DASAR, H(6) + METRIK, H(9) + HELPER], DASAR), true, "folder tanpa dua berkas");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("ditolak: kode runtime berbeda, berkas tambahan, tes lain, helper lain, nama mirip, package/prisma berbeda", opsi, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skb1-"));
  const izin = [H(7) + METRIK, H(8) + HELPER];
  try {
    const ganti = (daftar, path1, hash) => daftar.map((l) => (l.endsWith("  " + path1) ? `${hash}  ${path1}` : l));
    assert.equal(hasil(tmp, [...DASAR, ...izin], [...ganti(DASAR, "src/a.js", H(9)), ...izin]), false, "src/a.js berbeda");
    assert.equal(hasil(tmp, [...DASAR, ...izin], [...ganti(DASAR, "package.json", H(9)), ...izin]), false, "package.json berbeda");
    assert.equal(hasil(tmp, [...DASAR, ...izin], [...ganti(DASAR, "prisma/schema.prisma", H(9)), ...izin]), false, "prisma berbeda");
    assert.equal(hasil(tmp, [...DASAR, ...izin], [...DASAR, ...izin, H(9) + "  src/b.js"]), false, "berkas runtime tambahan di folder");
    assert.equal(hasil(tmp, [...DASAR, ...izin, H(9) + "  src/b.js"], [...DASAR, ...izin]), false, "berkas runtime tambahan di container");
    assert.equal(hasil(tmp, [...DASAR, ...izin], [...DASAR, ...izin, H(9) + "  tests/lain.test.js"]), false, "tes lain tambahan (bukan seluruh tests/ yang dikecualikan)");
    assert.equal(hasil(tmp, [...DASAR, ...izin], [...ganti(DASAR, "tests/x.test.js", H(9)), ...izin]), false, "tes lain berubah");
    assert.equal(hasil(tmp, [...DASAR, ...izin], [...DASAR, ...izin, H(9) + "  tests/helpers/lain.js"]), false, "helper lain (bukan seluruh tests/helpers/)");
    assert.equal(hasil(tmp, [...DASAR, ...izin], [...DASAR, ...izin, H(9) + METRIK + ".bak"]), false, "nama mirip dengan akhiran");
    assert.equal(hasil(tmp, [...DASAR, ...izin], [...DASAR, ...izin, H(9) + "  src/tests/financeKontrakMetrik.test.js"]), false, "nama sama di jalur lain");
    assert.equal(hasil(tmp, [], []), false, "daftar kosong tidak lolos");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("pasca-switch: daftar sha folder release baru mengecualikan HANYA dua jalur persis (perintah asli dari skrip)", opsi, () => {
  const baris = skrip.split("\n").find((l) => l.includes('> "$BK_DIR/dir-sha-baru.txt"'));
  assert.ok(baris, "perintah dir-sha-baru ada");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skb1-"));
  try {
    const be = path.join(tmp, "backend"); const bk = path.join(tmp, "bk"); fs.mkdirSync(bk);
    for (const f of ["src/a.js", "prisma/schema.prisma", "scripts/s.js", "tests/financeKontrakMetrik.test.js", "tests/helpers/pemeriksaMetrikUi.js", "tests/helpers/lain.js", "tests/x.test.js", "package.json", "package-lock.json"]) {
      fs.mkdirSync(path.dirname(path.join(be, f)), { recursive: true }); fs.writeFileSync(path.join(be, f), "isi " + f);
    }
    const jalan = () => spawnSync("bash", ["-c", `NEW_DIR='${tmp.replace(/\\/g, "/")}'; BK_DIR='${bk.replace(/\\/g, "/")}'; ${baris}`], { encoding: "utf8" });
    const r = jalan(); assert.equal(r.status, 0, r.stderr);
    const daftar = fs.readFileSync(path.join(bk, "dir-sha-baru.txt"), "utf8");
    assert.doesNotMatch(daftar, /financeKontrakMetrik\.test\.js/); assert.doesNotMatch(daftar, /pemeriksaMetrikUi\.js/);
    for (const f of ["src/a.js", "prisma/schema.prisma", "scripts/s.js", "tests/x.test.js", "tests/helpers/lain.js", "package.json", "package-lock.json"]) assert.match(daftar, new RegExp("[ *]" + f.replace(/[./]/g, "\\$&") + "$", "m"), f + " tetap diperiksa");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("skrip: tidak ada pengecualian seluruh tests/ atau tests/helpers/; gerbang memakai bandingkan_kode; backend/ di diff tetap dilarang", () => {
  assert.match(skrip, /bandingkan_kode "\$BK_DIR\/container-sha\.txt" "\$BK_DIR\/dir-sha\.txt" \|\|/);
  assert.doesNotMatch(skrip, /grep -v[xE]* ['"]?(\^?tests\/?|tests\/helpers\/?)['"]?(\s|$)/, "tidak ada pengecualian seluruh tests/");
  const pola = skrip.match(/tests\/\(financeKontrakMetrik[^)]*\)/g) || [];
  assert.ok(pola.length >= 3, "pola dua jalur persis dipakai");
  for (const p of pola) assert.equal(p.replace(/\\\./g, "."), "tests/(financeKontrakMetrik.test.js|helpers/pemeriksaMetrikUi.js)");
  const allow = skrip.split("\n").find((l) => l.startsWith("ALLOWED_RE="));
  assert.doesNotMatch(allow, /backend\//, "allowlist tidak memuat berkas backend/");
  assert.match(skrip, /\^\(backend\//, "perubahan backend/ pada diff kandidat tetap ditolak");
});
