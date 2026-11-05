// GERBANG TES rilis "marketing-lengkap" (dijalankan di LAPTOP/CI pada pohon kerja kandidat, sebelum skrip rilis disalin ke server).
//   node scripts/gerbang-tes-marketing-lengkap.mjs jalankan <label> [--keluar <dir>]   # jalankan suite backend + frontend PENUH (node --test, reporter JUnit) dan simpan hasil per tes: <dir>/<label>-{backend,frontend}.json
//   node scripts/gerbang-tes-marketing-lengkap.mjs gerbang <label> [--keluar <dir>]    # bandingkan hasil <label> dengan scripts/gerbang-marketing-lengkap/kegagalan-bawaan.json
//   node scripts/gerbang-tes-marketing-lengkap.mjs bangun-bawaan <label> <sha-baseline> [--keluar <dir>]   # tulis ulang daftar kegagalan bawaan dari hasil run pada BASELINE (tinjau manual sebelum commit)
// ATURAN GERBANG (exit 1 = BLOKIR rilis):
//   1. setiap tes GAGAL yang tidak ada di daftar kegagalan bawaan = kegagalan BARU = blokir (tanpa kecuali);
//   2. tes yang gagal di daftar bawaan tetapi sekarang lulus = diperbaiki (dilaporkan; daftar harus dirapikan, tidak memblokir);
//   3. tes cancelled / todo / skipped di luar daftar skip bawaan = blokir (tidak ada tes yang boleh menghilang dari hitungan diam-diam);
//   4. jumlah tes tidak boleh lebih sedikit dari baseline (tes hilang = blokir) dan seluruh tes kandidat Marketing HARUS lulus (daftar WAJIB_LULUS);
//   5. berkas JUnit tidak lengkap / suite crash (jumlah tes 0 atau tanpa ringkasan) = blokir.
// Kegagalan bawaan TIDAK diluluskan: daftar hanya mengakui kegagalan yang sudah ada di baseline live dan bukan bagian scope; pemiliknya memutuskan perbaikannya terpisah.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAFTAR = path.join(REPO, "scripts/gerbang-marketing-lengkap/kegagalan-bawaan.json");
const WAJIB_LULUS = {
  backend: ["tests/marketingLaporanLengkap.test.js", "tests/marketingLaporanInvarian.test.js", "tests/atribusiSumber.test.js", "tests/atribusiSumberKontrak.test.js", "tests/releaseMarketingLengkap.test.js", "tests/biayaSumber.test.js"],
  frontend: ["tests/marketingEksporProspek.test.js", "tests/marketingLogic.test.js", "tests/periodeLaporan.test.js", "tests/biayaIklanLogic.test.js"],
};
// Berkas tes DALAM scope Marketing: tidak pernah masuk daftar kegagalan bawaan (kegagalan di sini = tugas kandidat, bukan utang baseline).
export const DALAM_SCOPE = /^tests\/(marketing[A-Za-z]*|atribusiSumber[A-Za-z]*|biayaSumber|releaseMarketingLengkap|biayaIklanLogic|periodeLaporan)\.test\.js$/;
const dec = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Urai JUnit node --test. Atribut dibaca sadar-kutip (nama tes dapat memuat ">"). */
export function uraiJunit(xml) {
  const hasil = []; const re = /<testcase\b((?:[^>"]|"[^"]*")*?)(\/>|>([\s\S]*?)<\/testcase>)/g; let m;
  while ((m = re.exec(xml))) {
    const at = m[1]; const body = m[3] || ""; const g = (k) => { const q = new RegExp(k + '="([^"]*)"').exec(at); return q ? dec(q[1]) : ""; };
    let status = "pass";
    if (/<skipped\b/.test(body)) status = /todo/i.test((/<skipped[^>]*>/.exec(body) || [""])[0]) ? "todo" : "skipped";
    if (/<failure\b/.test(body)) status = /cancelled/i.test(body) ? "cancelled" : "fail";
    if (/<error\b/.test(body)) status = "fail";
    const pesan = status === "fail" ? dec((/<failure[^>]*message="([^"]*)"/.exec(body) || /<error[^>]*message="([^"]*)"/.exec(body) || [])[1] || "").replace(/\s+/g, " ").slice(0, 300) : "";
    hasil.push({ file: g("file").replace(/^.*[\\/](tests[\\/])/, "$1").replace(/\\/g, "/"), name: g("name"), status, pesan });
  }
  return hasil;
}
export const kunci = (t) => `${t.file} :: ${t.name}`;
export const ringkas = (h) => { const r = { total: h.length, pass: 0, fail: 0, skipped: 0, cancelled: 0, todo: 0 }; for (const t of h) r[t.status]++; return r; };

/** Keputusan gerbang (murni, diuji): `hasil` = { backend:[...], frontend:[...] }, `daftar` = isi kegagalan-bawaan.json. Kembalikan { blokir: bool, alasan: [...], info: [...] }. */
export function putuskan(hasil, daftar) {
  const alasan = []; const info = [];
  for (const suite of ["backend", "frontend"]) {
    const h = hasil[suite] ?? []; const d = daftar[suite] ?? { gagal: [], skip: [], totalBaseline: 0 };
    const gagalOk = new Set(d.gagal.map((x) => x.kunci)); const skipOk = new Set(d.skip.map((x) => x.kunci));
    if (h.length === 0) { alasan.push(`${suite}: hasil kosong (suite crash / JUnit tidak lengkap)`); continue; }
    if (h.length < d.totalBaseline) alasan.push(`${suite}: jumlah tes ${h.length} < baseline ${d.totalBaseline} (tes hilang)`);
    const baru = h.filter((t) => t.status === "fail" && !gagalOk.has(kunci(t)));
    for (const t of baru) alasan.push(`${suite}: KEGAGALAN BARU: ${kunci(t)} — ${t.pesan.slice(0, 160)}`);
    for (const t of h.filter((x) => (x.status === "cancelled" || x.status === "todo"))) alasan.push(`${suite}: tes ${t.status}: ${kunci(t)}`);
    for (const t of h.filter((x) => x.status === "skipped" && !skipOk.has(kunci(x)))) alasan.push(`${suite}: SKIP baru di luar daftar: ${kunci(t)}`);
    const sekarang = new Map(h.map((t) => [kunci(t), t]));
    for (const g of d.gagal) { const t = sekarang.get(g.kunci); if (!t) info.push(`${suite}: tes bawaan-gagal tidak ada lagi: ${g.kunci}`); else if (t.status === "pass") info.push(`${suite}: DIPERBAIKI (rapikan daftar): ${g.kunci}`); }
    for (const f of WAJIB_LULUS[suite]) { const tf = h.filter((t) => t.file === f); if (tf.length === 0) alasan.push(`${suite}: berkas tes wajib tidak berjalan: ${f}`); else for (const t of tf.filter((x) => x.status !== "pass")) alasan.push(`${suite}: tes WAJIB-LULUS tidak lulus (${t.status}): ${kunci(t)}`); }
  }
  return { blokir: alasan.length > 0, alasan, info };
}

function jalankanSuite(suite, keluar, label) {
  const cwd = path.join(REPO, suite); const xml = path.join(keluar, `${label}-${suite}.junit.xml`); const spec = path.join(keluar, `${label}-${suite}.spec.txt`);
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=junit", `--test-reporter-destination=${xml}`, "--test-reporter=spec", `--test-reporter-destination=${spec}`, "tests/*.test.js"], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, shell: false });
  if (!fs.existsSync(xml)) throw new Error(`${suite}: JUnit tidak dibuat (kode ${r.status}): ${String(r.stderr).slice(-300)}`);
  const h = uraiJunit(fs.readFileSync(xml, "utf8")); fs.writeFileSync(path.join(keluar, `${label}-${suite}.json`), JSON.stringify(h, null, 1));
  return h;
}

function main() {
  const arg = process.argv.slice(2); const [perintah, label] = arg; const iK = arg.indexOf("--keluar"); const keluar = path.resolve(iK >= 0 ? arg[iK + 1] : path.join(REPO, "..", "gerbang-tes-keluar")); fs.mkdirSync(keluar, { recursive: true });
  if (perintah === "jalankan") {
    for (const suite of ["backend", "frontend"]) { const h = jalankanSuite(suite, keluar, label); console.log(suite, JSON.stringify(ringkas(h))); }
    return;
  }
  const muat = () => Object.fromEntries(["backend", "frontend"].map((s) => [s, JSON.parse(fs.readFileSync(path.join(keluar, `${label}-${s}.json`), "utf8"))]));
  if (perintah === "bangun-bawaan") {
    const sha = arg[2]; const h = muat(); const lama = fs.existsSync(DAFTAR) ? JSON.parse(fs.readFileSync(DAFTAR, "utf8")) : null; const alasanLama = new Map((lama ? [...lama.backend.gagal, ...lama.frontend.gagal] : []).map((x) => [x.kunci, x.alasan]));
    const o = { dibuat: new Date().toISOString(), baseline: sha, catatan: "Kegagalan yang SUDAH ada di baseline live dan bukan bagian scope Marketing. Bukan izin: perbaikan diputuskan pemilik terpisah. Kegagalan di luar daftar ini = BLOKIR rilis." };
    for (const s of ["backend", "frontend"]) o[s] = { totalBaseline: h[s].length, ringkas: { ...ringkas(h[s]), failDalamScope: h[s].filter((t) => t.status === "fail" && DALAM_SCOPE.test(t.file)).length }, gagal: h[s].filter((t) => t.status === "fail" && !DALAM_SCOPE.test(t.file)).map((t) => ({ kunci: kunci(t), pesan: t.pesan, alasan: alasanLama.get(kunci(t)) ?? "(isi alasan)" })), skip: h[s].filter((t) => t.status === "skipped").map((t) => ({ kunci: kunci(t) })) };
    fs.mkdirSync(path.dirname(DAFTAR), { recursive: true }); fs.writeFileSync(DAFTAR, JSON.stringify(o, null, 1) + "\n"); console.log("ditulis", DAFTAR, JSON.stringify({ backend: o.backend.ringkas, frontend: o.frontend.ringkas })); return;
  }
  if (perintah === "gerbang") {
    const h = muat(); const daftar = JSON.parse(fs.readFileSync(DAFTAR, "utf8")); const k = putuskan(h, daftar);
    for (const s of ["backend", "frontend"]) console.log(s, JSON.stringify(ringkas(h[s])), "| bawaan-gagal", daftar[s].gagal.length, "| baseline total", daftar[s].totalBaseline);
    for (const x of k.info) console.log("INFO  ", x); for (const x of k.alasan) console.log("BLOKIR", x);
    console.log(k.blokir ? "GERBANG TES: BLOKIR" : "GERBANG TES: LULUS (tidak ada kegagalan baru)"); process.exit(k.blokir ? 1 : 0);
  }
  console.error("pemakaian: jalankan|gerbang|bangun-bawaan <label> [...]"); process.exit(2);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
