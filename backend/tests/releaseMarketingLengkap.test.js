// GERBANG RILIS "marketing-lengkap": pin skrip rilis (hasil generator), allowlist, bukti build, pustaka rehearsal/smoke, dan keputusan gerbang tes (kegagalan baru = blokir).
// Baseline = release live saat kandidat disiapkan (BASE_LIVE). NAIKKAN BASE_LIVE dan bangkitkan ulang skrip bila baseline live berganti.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { uraiJunit, putuskan, kunci, ringkas } from "../../scripts/gerbang-tes-marketing-lengkap.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE_LIVE = "5cd1a5fa";
const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const adaBase = git(["cat-file", "-e", `${BASE_LIVE}^{commit}`]).status === 0;
const SKRIP = path.join(root, "scripts/release-marketing-lengkap.sh");
const baca = (p) => fs.readFileSync(p, "utf8");
const nilai = (nama) => (baca(SKRIP).match(new RegExp(`^${nama}="([^"]*)"`, "m")) ?? [])[1];
const BACKEND_SRC = ["backend/src/services/attribution/biayaSumber.js", "backend/src/services/attribution/sumber.js"];
const FRONTEND_SRC = ["frontend/src/features/laporan/akuisisiLogic.js", "frontend/src/features/laporan/biayaIklanLogic.js", "frontend/src/features/laporan/components/LogoSumber.jsx", "frontend/src/features/laporan/components/marketing/TabelSumber.jsx",
  "frontend/src/features/laporan/marketingLogic.js", "frontend/src/features/laporan/periodeLaporan.js", "frontend/src/utils/marketingXlsx.js"];

test("skrip rilis = hasil bangkitan ulang generator terhadap baseline live (templat, pustaka, allowlist tidak menyimpang)", { skip: adaBase ? false : `commit ${BASE_LIVE} tidak ada di klon ini` }, () => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/gen-release-marketing-lengkap.cjs"), "--base", BASE_LIVE, "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, (r.stdout + r.stderr).split("\n").filter((l) => !/^warning:/.test(l)).join("\n").slice(0, 600));
});

test("allowlist = persis berkas kandidat; backend/src dan frontend/src yang berubah = tepat yang diaudit; prisma/paket/compose/Dockerfile/.env/index.js/rute/kohort/Finance ditolak", () => {
  const s = baca(SKRIP);
  assert.deepEqual(nilai("BACKEND_SRC_EXPECT").split(" "), BACKEND_SRC);
  assert.deepEqual(nilai("FRONTEND_SRC_EXPECT").split(" "), FRONTEND_SRC);
  const allow = (s.match(/^ALLOWED_RE='\^\((.*)\)\$'$/m) ?? [])[1];
  assert.ok(allow, "ALLOWED_RE tidak ditemukan");
  const daftar = allow.split("|").map((x) => x.replace(/\\\./g, "."));
  for (const f of [...BACKEND_SRC, ...FRONTEND_SRC, "scripts/release-marketing-lengkap.sh", "scripts/gen-release-marketing-lengkap.cjs", "scripts/gerbang-tes-marketing-lengkap.mjs", "scripts/gerbang-marketing-lengkap/kegagalan-bawaan.json",
    "scripts/lib/invarian-marketing-lengkap.mjs", "scripts/lib/smoke-marketing-lengkap.mjs", "scripts/lib/rehearsal-marketing-lengkap.mjs", "backend/tests/releaseMarketingLengkap.test.js", "backend/tests/marketingLaporanInvarian.test.js", "backend/tests/marketingLaporanLengkap.test.js", "frontend/tests/marketingEksporProspek.test.js"])
    assert.ok(daftar.includes(f), `allowlist tidak memuat ${f}`);
  const terlarang = daftar.filter((f) => /^backend\/prisma\/|package(-lock)?\.json$|docker-compose|Dockerfile|(^|\/)\.env|^backend\/src\/index\.js$|^backend\/src\/routes\/|attribution\/(cohort|cohortLoader|cohortDefinitions|biayaKpi|spend|iklanReport|d7)\.js$|^backend\/src\/services\/finance\/|^frontend\/dist\/|^frontend\/src\/pages\/Laporan\.jsx$/.test(f));
  assert.deepEqual(terlarang, [], "allowlist memuat berkas terlarang");
  assert.ok(daftar.length >= 20 && daftar.length <= 40, "jumlah allowlist tidak masuk akal: " + daftar.length);
});

test("skrip: LF, sintaks bash valid, tanpa placeholder/nama rilis lama; kunci, baseline, identitas kode live, build, rehearsal, switch SATU kali, smoke, tanpa pembersihan", () => {
  const s = baca(SKRIP);
  assert.ok(!s.includes("\r"), "skrip harus LF");
  const b = spawnSync("bash", ["-n", SKRIP], { encoding: "utf8" });
  if (b.error) { assert.ok(true, "bash tidak tersedia di lingkungan ini (dilewati)"); } else assert.equal(b.status, 0, b.stderr);
  assert.ok(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  assert.ok(!/pengaman-historis|\bpph\b|reh-pph|posting-historis|pernyataan_historis|unit_usage_notes|hasil_so/.test(s.split("\n").filter((l) => !l.includes("dibangkitkan oleh scripts/gen-release-marketing-lengkap")).join("\n")), "nama/isi rilis lama tersisa");
  for (const p of ["release-marketing-lengkap.lock", "release-deploy-bersama.lock", "gerbang_kode_live \"fase-6-pra-switch\"", "gerbang_kode_live \"rehearsal-pra-switch\"", "bandingkan_kode", "--rehearsal-only", "--preflight-only", "rollback-pre-mkl-", "rehearsal_mkl_", "SMOKE_HASIL", "bukti-build.txt", "cari_dist()", "tidak_ada_deploy_lain_lagi"]) assert.ok(s.includes(p), `skrip tidak memuat: ${p}`);
  assert.equal(s.split("PHASE=\"7-switch\"").length - 1, 1, "switch harus tepat SATU fase");
  assert.ok(/Pembersihan release lama \(fase 9\) DINONAKTIFKAN|9\. Pembersihan release lama DINONAKTIFKAN/.test(s), "pembersihan release lama harus nonaktif");
  assert.ok(!/docker (image|rmi|volume) (rm|prune)|rm -rf "\$HOME\/(releases|release-backups|backups)/.test(s), "skrip tidak boleh menghapus release/backup/image/volume");
  assert.ok(!/\bmigrate (deploy|dev)\b|prisma db push/.test(s.replace(/#.*$/gm, "")), "rilis ini TANPA migrasi yang dijalankan");
});

test("PENCARIAN TEKS DI DIST: tidak ada grep atas glob assets/*.js|css (dist aktif >21.000 chunk melampaui ARG_MAX); semuanya lewat cari_dist (find|xargs) dan fungsi itu benar-benar berfungsi", () => {
  const s = baca(SKRIP);
  const dieksekusi = s.split("\n").filter((l) => !l.trim().startsWith("#")).filter((l) => /grep[^|]*\/frontend\/dist\/assets\/\*\./.test(l));
  assert.deepEqual(dieksekusi, [], "masih ada grep atas glob assets/*");
  assert.ok(/cari_dist\(\) \{ find "\$1\/frontend\/dist\/assets" -maxdepth 1 -type f -name "\*\.\$2" -print0/.test(s), "definisi cari_dist tidak sesuai");
  // perilaku nyata: fungsi dimuat dari skrip dan dijalankan pada folder sementara dengan 3 berkas
  const tmp = fs.mkdtempSync(path.join(fs.mkdtempSync(path.join(path.resolve(root, ".."), "mkl-")) , "x-"));
  try {
    const a = path.join(tmp, "frontend/dist/assets"); fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(path.join(a, "a.js"), "tidak ada apa-apa"); fs.writeFileSync(path.join(a, "b.js"), 'x "Prospek eksplisit" y'); fs.writeFileSync(path.join(a, "c.css"), ".fin-ks-kartu{}");
    const fungsi = (s.match(/^cari_dist\(\) \{.*\}$/m) ?? [])[0];
    const jalan = (ext, teks) => spawnSync("bash", ["-c", `${fungsi}\ncari_dist "${tmp.replace(/\\/g, "/")}" ${ext} "$1"`, "_", teks], { encoding: "utf8" });
    const j1 = jalan("js", "Prospek eksplisit"); if (!j1.error) { assert.match(j1.stdout.trim(), /b\.js$/); assert.equal(jalan("js", "tidak-ada-di-mana-pun").stdout.trim(), ""); assert.match(jalan("css", ".fin-ks-kartu").stdout.trim(), /c\.css$/); assert.equal(jalan("css", "Prospek eksplisit").stdout.trim(), ""); }
  } finally { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); }
});

test("teks fitur dist: BARU hanya teks Marketing (harus ada di dist baru dan BELUM di dist aktif); fitur live sebelumnya (Rincian verifikasi nol dst.) wajib tetap ada", () => {
  const s = baca(SKRIP);
  const s1 = (s.match(/^for s1 in ([^;]*); do/m) ?? [])[1]; assert.equal(s1, '"Prospek eksplisit" "Prospek atau lanjut" "Biaya / prospek eksplisit"');
  const s2 = (s.match(/^for s2 in ((?:"[^"]*" ?)+); do/m) ?? [])[1]; assert.ok(s2.startsWith('"Rincian verifikasi nol" "Rincian bukti Finance"'), "fitur live sebelumnya harus dijaga");
  assert.ok(s.includes('"$s1" ') || s.includes("[skrip] teks fitur baru"), "pemeriksaan negatif dist aktif hilang");
  for (const c of [".nip-kartu", ".nip-tabel", ".nipf-info", ".nip-so"]) assert.ok(s.includes(`"${c}"`), `aturan CSS live ${c} harus dijaga`);
});

test("pustaka smoke/rehearsal: sintaks valid, hanya GET (tanpa POST/PUT/DELETE/INSERT/UPDATE), invarian disisipkan ke skrip, ADMIN-only dan 401/403 diuji", () => {
  for (const f of ["scripts/lib/smoke-marketing-lengkap.mjs", "scripts/lib/rehearsal-marketing-lengkap.mjs", "scripts/lib/invarian-marketing-lengkap.mjs"]) {
    const r = spawnSync(process.execPath, ["--check", path.join(root, f)], { encoding: "utf8" }); assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    const t = baca(path.join(root, f)).replace(/\/\/.*$/gm, "");
    assert.ok(!/method: "(POST|PUT|PATCH|DELETE)"|\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|TRUNCATE|DROP TABLE|ALTER TABLE)\b/i.test(t.replace(/Order\b/g, "")), `${f} memuat operasi tulis`);
  }
  const sm = baca(path.join(root, "scripts/lib/smoke-marketing-lengkap.mjs"));
  assert.ok(sm.includes("tanpa token = 401") && sm.includes("= 403 (hanya ADMIN)") && sm.includes("periksaLaporan(d)") && sm.includes("SQL_BANDING") && sm.includes("SMOKE_HASIL"));
  const s = baca(SKRIP);
  // ISOLASI rehearsal (bukti dicetak SEBELUM aplikasi rehearsal berjalan; fail-closed)
  for (const p of ["isolasi: DATABASE_URL aplikasi rehearsal menunjuk DB sementara rehearsal_*", "urlDb !== \"klinik_matras\"", "isolasi: tidak ada konfigurasi integrasi eksternal tersisa", "META_ADS_ACCESS_TOKEN", "ATRIBUSI_ALERT_NOTIFY_PHONE", "SPEND_SYNC_ENABLED", "isolasi: server rehearsal sendiri melaporkan job latar & worker pengirim dimatikan", "DISABLE_BACKGROUND_JOBS"]) assert.ok(s.includes(p), `isolasi rehearsal tidak memuat: ${p}`);
  assert.ok(s.indexOf("isolasi: DATABASE_URL aplikasi rehearsal") < s.indexOf("spawn(process.execPath, [\"src/index.js\"]"), "bukti isolasi harus dicetak sebelum aplikasi rehearsal dijalankan");
  assert.ok(s.includes("rehearsal TIDAK terisolasi dari direktori data/uploads production"), "isolasi direktori data/uploads hilang");
  assert.ok(s.includes("function periksaLaporan(d)") && s.includes("function banding(d, sql)") && !/^export /m.test(s.split("<<'NODE'")[1] ?? ""), "invarian harus tersisip tanpa kata kunci export pada smoke");
});

test("gerbang tes: kegagalan BARU memblokir; kegagalan bawaan tidak; skip/cancelled/todo baru, tes hilang, suite kosong, tes wajib tidak jalan, tes wajib gagal = blokir; diperbaiki = hanya informasi", () => {
  const T = (file, name, status = "pass") => ({ file, name, status, pesan: status === "fail" ? "x" : "" });
  const BE = ["tests/marketingLaporanLengkap.test.js", "tests/marketingLaporanInvarian.test.js", "tests/atribusiSumber.test.js", "tests/atribusiSumberKontrak.test.js", "tests/releaseMarketingLengkap.test.js", "tests/biayaSumber.test.js"];
  const FE = ["tests/marketingEksporProspek.test.js", "tests/marketingLogic.test.js", "tests/periodeLaporan.test.js", "tests/biayaIklanLogic.test.js"];
  const dasar = () => ({ backend: [...BE.map((f) => T(f, "ok")), T("tests/lama.test.js", "bawaan gagal", "fail"), T("tests/lama.test.js", "skip lama", "skipped")], frontend: [...FE.map((f) => T(f, "ok")), T("tests/fe.test.js", "fe gagal", "fail")] });
  const daftar = { backend: { totalBaseline: 8, gagal: [{ kunci: "tests/lama.test.js :: bawaan gagal" }], skip: [{ kunci: "tests/lama.test.js :: skip lama" }] }, frontend: { totalBaseline: 5, gagal: [{ kunci: "tests/fe.test.js :: fe gagal" }], skip: [] } };
  const h0 = dasar(); const k0 = putuskan(h0, daftar); assert.equal(k0.blokir, false, k0.alasan.join("\n"));
  const coba = (f, harapan) => { const h = dasar(); f(h); const k = putuskan(h, daftar); assert.equal(k.blokir, true, "harus memblokir: " + harapan); assert.ok(k.alasan.some((a) => harapan.test(a)), `alasan ${harapan}: ${k.alasan.join(" | ")}`); };
  coba((h) => h.backend.push(T("tests/baru.test.js", "gagal baru", "fail")), /KEGAGALAN BARU/);
  coba((h) => h.frontend.push(T("tests/baru.test.js", "gagal baru fe", "fail")), /KEGAGALAN BARU/);
  coba((h) => { h.backend.find((t) => t.name === "ok").status = "fail"; }, /KEGAGALAN BARU/);
  coba((h) => h.backend.push(T("tests/x.test.js", "skip baru", "skipped")), /SKIP baru/);
  coba((h) => h.backend.push(T("tests/x.test.js", "dibatalkan", "cancelled")), /cancelled/);
  coba((h) => h.backend.push(T("tests/x.test.js", "todo", "todo")), /todo/);
  coba((h) => { h.backend = h.backend.slice(0, 5); }, /jumlah tes|tes hilang|wajib/);
  coba((h) => { h.backend = []; }, /hasil kosong/);
  coba((h) => { h.frontend = h.frontend.filter((t) => t.file !== "tests/marketingEksporProspek.test.js"); }, /wajib tidak berjalan/);
  coba((h) => { h.frontend.find((t) => t.file === "tests/marketingLogic.test.js").status = "skipped"; }, /SKIP baru|WAJIB-LULUS/);
  const h2 = dasar(); h2.backend.find((t) => t.name === "bawaan gagal").status = "pass"; const k2 = putuskan(h2, daftar); assert.equal(k2.blokir, false); assert.ok(k2.info.some((x) => /DIPERBAIKI/.test(x)));
});

test("penguraian JUnit: nama tes memuat '>' dan tanda kutip terbaca benar; status fail/skipped/pass; hitungan lengkap", () => {
  const xml = `<testsuites>\n<testcase name="a -&gt; b &quot;q&quot;" time="0.1" classname="test" file="C:\\x\\backend\\tests\\p.test.js"/>\n<testcase name="gagal" time="0.1" classname="test" file="C:\\x\\backend\\tests\\p.test.js">\n<failure type="testCodeFailure" message="galat &gt; x"><![CDATA[ke]]></failure>\n</testcase>\n<testcase name="lewat" time="0" classname="test" file="C:\\x\\backend\\tests\\q.test.js">\n<skipped type="skipped" message="alasan"/>\n</testcase></testsuites>`;
  const h = uraiJunit(xml);
  assert.deepEqual(h.map((t) => t.status), ["pass", "fail", "skipped"]);
  assert.equal(h[0].name, 'a -> b "q"'); assert.equal(h[0].file, "tests/p.test.js"); assert.equal(h[1].pesan, "galat > x");
  assert.deepEqual(ringkas(h), { total: 3, pass: 1, fail: 1, skipped: 1, cancelled: 0, todo: 0 }); assert.equal(kunci(h[0]), 'tests/p.test.js :: a -> b "q"');
});

test("daftar kegagalan bawaan: terstruktur, berbaseline, setiap kegagalan berstatus alasan terisi, tidak memuat tes Marketing, tidak memuat tes wajib-lulus", () => {
  const p = path.join(root, "scripts/gerbang-marketing-lengkap/kegagalan-bawaan.json"); assert.ok(fs.existsSync(p), "kegagalan-bawaan.json tidak ada");
  const d = JSON.parse(baca(p)); assert.match(d.baseline, /^[0-9a-f]{7,40}$/); assert.equal(d.baseline.slice(0, 8), BASE_LIVE);
  for (const s of ["backend", "frontend"]) {
    assert.ok(d[s].totalBaseline > 300 && Array.isArray(d[s].gagal) && Array.isArray(d[s].skip), s);
    assert.equal(d[s].ringkas.fail, d[s].gagal.length + d[s].ringkas.failDalamScope, `${s}: gagal bawaan + gagal dalam-scope (diperbaiki kandidat) != ringkasan baseline`);
    for (const g of d[s].gagal) { assert.ok(g.kunci && g.alasan && !/\(isi alasan\)/.test(g.alasan), `${s}: alasan kosong: ${g.kunci}`); assert.ok(!/marketing|atribusiSumber|biayaSumber|marketingLaporan/i.test(g.kunci.split(" :: ")[0]), `${s}: tes Marketing tidak boleh ada di daftar bawaan: ${g.kunci}`); }
  }
});
