import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Skrip rilis Audit Selisih Laporan: kode saja, fail-closed, backup + rehearsal pada restore, gerbang kode live, smoke baca-saja pasca-switch, tanpa pembersihan otomatis.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const sh = baca("scripts/release-selisih-laporan.sh");

test("skrip: fail-fast, kandidat benar, TANPA migrasi/dependensi/compose, tanpa perintah destruktif atau sisa nama rilis lain", () => {
  assert.match(sh, /^#!\/usr\/bin\/env bash\n/); assert.match(sh, /set -Eeuo pipefail/);
  assert.match(sh, /CAND_BRANCH="\$\{CAND_BRANCH:-fix\/audit-selisih-laporan-okt-on-a0dbe2fb\}"/);
  assert.doesNotMatch(sh, /@@[A-Z_]+@@/, "tidak ada placeholder generator tersisa");
  assert.doesNotMatch(sh, /git (reset|stash|push --force|checkout --)|--force-with-lease|docker (system|volume) prune|rm -rf (\/|\$HOME|"\$HOME")(\s|$)/m);
  assert.doesNotMatch(sh, /po-barang-mirip|\bpbm\b|export-pkr|\bxpk\b/, "tidak ada sisa nama rilis lain");
  assert.match(sh, /pre-selisih-laporan-/); assert.match(sh, /rollback-pre-sel-/); assert.match(sh, /rehearsal_sel_/); assert.match(sh, /release-selisih-laporan\.lock/);
});

test("gerbang: preflight/rehearsal-only, backup + RESTORE rehearsal sebelum switch, gerbang identitas kode live, smoke baca-saja SETELAH switch, tanpa rollback otomatis dan tanpa pembersihan", () => {
  for (const kata of ["--preflight-only", "--rehearsal-only", "Backup produksi", "REHEARSAL", "IDENTITAS KODE LIVE", "7. Switch backend", "8b-smoke", "INSTRUKSI ROLLBACK"]) assert.ok(sh.toLowerCase().includes(kata.toLowerCase()), `gerbang hilang: ${kata}`);
  assert.match(sh, /die "uji audit selisih laporan terhadap salinan restore GAGAL/);
  assert.match(sh, /Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya/);
});

test("pustaka tertanam: rehearsal memakai DB rehearsal_ + server kode baru pada data nyata tanpa menulis; smoke baca-saja membandingkan API, Excel, dan SQL", () => {
  const reh = baca("scripts/lib/rehearsal-selisih-laporan.mjs"); const sm = baca("scripts/lib/smoke-selisih-laporan.mjs");
  assert.match(reh, /\^rehearsal_/); assert.match(reh, /spawnSync\(process\.execPath, \["--input-type=module", "-"\], \{ input: SMOKE_SRC/); assert.match(reh, /2026-10-01/); assert.match(reh, /identik persis/);
  assert.match(sm, /SMOKE_HASIL fail=/); assert.match(sm, /Dihitung ke Total\?/); assert.match(sm, /jembatan kohort menutup persis/); assert.match(sm, /TIDAK ada jejak tulis/); assert.match(sm, /SUM kolom 'Nilai yang Dihitung' = TOTAL Excel = total layar = SQL/);
  assert.doesNotMatch(sm, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|INSERT |UPDATE |DELETE /, "smoke produksi BACA-SAJA: tanpa pemanggilan tulis");
  assert.doesNotMatch(sm, /method:\s*"(PATCH|PUT|DELETE)"/, "smoke tidak memakai PATCH/PUT/DELETE");
  assert.deepEqual([...sm.matchAll(/method:\s*"(\w+)"/g)].map((x) => x[1]).filter((x, i, a) => a.indexOf(x) === i), ["POST"], "satu-satunya POST = unduh export (baca-saja)");
  assert.ok(sh.includes("SMOKE_HASIL fail="), "smoke tertanam di skrip rilis");
  assert.ok(sh.includes("PEMERIKSAAN=") || sh.includes("rehearsal"), "rehearsal tertanam");
});

test("allowlist: hanya berkas rilis ini (pemasukan, rekonsiliasi, export, kontrak metrik, laporan, tes, dokumen, skrip); tanpa migrasi, dependensi, index.js, atau berkas hotfix performa", () => {
  const allow = (sh.match(/^ALLOWED_RE='(.*)'$/m) ?? [])[1] ?? "";
  assert.ok(allow.includes("backend/src/services/finance/pemasukan"), "pemasukan"); assert.ok(allow.includes("rekonSalesFinance"), "rekon"); assert.ok(allow.includes("frontend/src/pages/finance/FinancePemasukan"), "halaman pemasukan");
  assert.ok(!/backend\/prisma/.test(allow), "tanpa migrasi/schema"); assert.ok(!/package(-lock)?/.test(allow), "tanpa dependensi"); assert.ok(!allow.includes("backend/src/index"), "tanpa index.js");
  assert.ok(!/routes\\\/(analytics|conversations)|cacheSingkat|pages\\\/Laporan/.test(allow), "tanpa berkas hotfix performa");
});

test("COUNT_SQL: dievaluasi bash menghasilkan SQL utuh (tanda kutip nama tabel \"Order\" ter-escape) — cacat ini pernah lolos bash -n dan baru tertangkap gerbang VPS", async () => {
  const { spawnSync } = await import("node:child_process");
  const baris = sh.split("\n").find((l) => l.startsWith("COUNT_SQL=")); assert.ok(baris, "baris COUNT_SQL ada");
  const r = spawnSync("bash", ["-c", `${baris}\nprintf '%s' "$COUNT_SQL"`], { encoding: "utf8" });
  if (r.error) return; // tanpa bash di lingkungan ini: tes dilewati (VPS selalu punya bash)
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /from "Order" union all/, "nama tabel Order berkutip utuh di SQL hasil evaluasi");
  assert.ok(r.stdout.startsWith("select 'payments'") && r.stdout.endsWith("from fin_penjualan_karyawan"), "SQL tidak terpotong");
});

// ── Garis dasar (cacat 1 Nov 2026): PAY_N tidak pernah dicatat → smoke membandingkan dengan NaN → gagal SETELAH switch.
test("garis dasar: PAY_N dicatat bersama baseline lain, divalidasi SEBELUM switch (fase 2 dan tepat sebelum fase 7), dan diteruskan ke smoke", () => {
  assert.match(sh, /PAY_N="\$\(psql_live -At -c "select count\(\*\) from payments"\)"/);
  assert.match(sh, /for v in "\$ORDER_N" "\$JOB_N" "\$PKR_N" "\$EVT_N" "\$PAY_N"; do/);
  assert.match(sh, /EVT_N=%q\\nPAY_N=%q\\n' .* "\$PAY_N" > "\$BK_DIR\/garis-dasar\.env"/);
  assert.match(sh, /BASELINE_KUNCI="BASE_TIDAK_SEIMBANG BASE_GANDA ORDER_N JOB_N PKR_N EVT_N PAY_N"/);
  const iFase7 = sh.indexOf('PHASE="7-switch"'); const iSwitch = sh.indexOf('dcp "$NEW_DIR" up -d --no-deps backend');
  const cek = [...sh.matchAll(/cek_garis_dasar "\$BK_DIR\/garis-dasar\.env" \|\| die/g)].map((m) => m.index);
  assert.equal(cek.length, 2, "dipanggil dua kali: sesudah ditulis (fase 2) dan tepat sebelum switch");
  assert.ok(cek[0] < iFase7 && cek[1] > iFase7 && cek[1] < iSwitch, "pemeriksaan kedua berada di fase 7 SEBELUM compose up (produksi belum berganti)");
  assert.match(sh, /-e ORDER_N="\$ORDER_N" -e JOB_N="\$JOB_N" -e PAY_N="\$PAY_N" backend node/, "PAY_N diteruskan ke container smoke");
});

test("garis dasar: cek_garis_dasar menerima baseline lengkap dan MENOLAK nilai hilang, bukan angka (NaN), kosong, atau ganda", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs"); const os = await import("node:os");
  const awal = sh.indexOf("BASELINE_KUNCI="); const akhir = sh.indexOf("\n}\n", sh.indexOf("cek_garis_dasar() {")) + 3;
  assert.ok(awal > 0 && akhir > awal, "fungsi cek_garis_dasar ada di skrip");
  const fungsi = sh.slice(awal, akhir);
  const dir = mkdtempSync(path.join(os.tmpdir(), "gd-"));
  const LENGKAP = { BASE_TIDAK_SEIMBANG: "0", BASE_GANDA: "0", ORDER_N: "844", JOB_N: "1384", PKR_N: "28", EVT_N: "1673", PAY_N: "441" };
  const tulis = (nama, o, tambah = "") => { const f = path.join(dir, nama); writeFileSync(f, Object.entries(o).map(([k, v]) => `${k}=${v}`).join("\n") + "\n" + tambah); return f; };
  const jalankan = (f) => spawnSync("bash", ["-c", `${fungsi}\ncek_garis_dasar "$1"`, "x", f], { encoding: "utf8" });
  try {
    const coba = jalankan(tulis("ok.env", LENGKAP)); if (coba.error) return; // tanpa bash di lingkungan ini: dilewati (VPS selalu punya bash)
    assert.equal(coba.status, 0, "baseline lengkap lulus: " + coba.stderr);
    const { PAY_N, ...tanpaPay } = LENGKAP;
    const hilang = jalankan(tulis("tanpa-pay.env", tanpaPay)); assert.notEqual(hilang.status, 0, "PAY_N hilang HARUS ditolak"); assert.match(hilang.stderr, /PAY_N.*0x/);
    const nan = jalankan(tulis("nan.env", { ...LENGKAP, PAY_N: "NaN" })); assert.notEqual(nan.status, 0, "NaN HARUS ditolak"); assert.match(nan.stderr, /PAY_N.*bukan angka/);
    assert.notEqual(jalankan(tulis("kosong.env", { ...LENGKAP, ORDER_N: "" })).status, 0, "nilai kosong HARUS ditolak");
    assert.notEqual(jalankan(tulis("negatif.env", { ...LENGKAP, JOB_N: "-1" })).status, 0, "negatif HARUS ditolak");
    assert.notEqual(jalankan(tulis("ganda.env", LENGKAP, "PAY_N=1\n")).status, 0, "kunci ganda HARUS ditolak");
    assert.notEqual(jalankan(path.join(dir, "tidak-ada.env")).status, 0, "berkas tidak ada HARUS ditolak");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("garis dasar: smoke menolak baseline hilang/NaN (melempar galat), bukan membandingkan dengan NaN lalu gagal diam-diam", () => {
  const sm = baca("scripts/lib/smoke-selisih-laporan.mjs");
  const def = sm.split("\n").find((l) => l.startsWith("const B = ")); assert.ok(def, "definisi B() ada");
  assert.doesNotMatch(def, /^const B = \(k\) => Number\(process\.env\[k\]\);$/, "bukan pembungkus Number() polos");
  const B = new Function("process", `${def}\nreturn B;`)({ env: { ORDER_N: "844", PAY_N: "441", RUSAK: "NaN", KOSONG: "" } });
  assert.equal(B("PAY_N"), 441); assert.equal(B("ORDER_N"), 844);
  for (const k of ["HILANG", "RUSAK", "KOSONG"]) assert.throws(() => B(k), /hilang atau bukan angka/, k);
  assert.match(sm, /B\("PAY_N"\)/, "pemeriksaan jumlah Payment masih memakai PAY_N");
});
