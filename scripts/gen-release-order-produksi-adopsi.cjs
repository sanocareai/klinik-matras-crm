// Generator skrip rilis bergerbang "Order Produksi adopsi Admin" (backend + web + 1 migrasi ADITIF: 3 tabel baru kosong + 3 indeks + 3 FK RESTRICT + fungsi/trigger append-only pada 2 tabel baru; tanpa ALTER pada tabel lama).
//
// Hasilnya: scripts/release-order-produksi-adopsi.sh — diturunkan dari templat scripts/templates/release-order-produksi-adopsi.sh.tpl; semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend/frontend, pin sha256 migrasi,
// pin diff schema.prisma, hasil pemindai DDL, commit live yang wajib leluhur, berkas pelindung, berkas + jumlah tes integrasi terarah) dihitung dari git terhadap --base. Tidak ada nilai manual selain konstanta di bawah.
//
//   node scripts/gen-release-order-produksi-adopsi.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif; default origin/main)
//   node scripts/gen-release-order-produksi-adopsi.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const MIG_SUFIKS = "_production_adopsi_admin";
const TPL = "scripts/templates/release-order-produksi-adopsi.sh.tpl";
const OUT = "scripts/release-order-produksi-adopsi.sh";
const GUARD = "scripts/rollback-guard-order-produksi-adopsi.sh";
const LIB_SCAN = "scripts/lib/scan-migrasi-order-produksi-adopsi.mjs";
const LIB_REH = "scripts/lib/rehearsal-kode-order-produksi-adopsi.mjs";
const LIB_SMOKE = "scripts/lib/smoke-order-produksi-adopsi.mjs";
const GENERATOR = "scripts/gen-release-order-produksi-adopsi.cjs";
const CAND_BRANCH = "feat/order-produksi-adopsi-admin";
const LIB_SKEN = "scripts/lib/rehearsal-skenario-order-produksi-adopsi.mjs";
const FILE_TETAP = [OUT, GUARD, LIB_SCAN, LIB_REH, LIB_SMOKE, LIB_SKEN, GENERATOR, TPL];
// Berkas yang HARUS identik antara base dan kandidat (rilis ini tidak boleh menyentuhnya): ledger stok (postStockMovement), pembaca stok per lokasi + kelompok bahan, jurnal Finance, otorisasi/izin, FUNGSI STATUS LINTAS WORKSPACE (satu-satunya jalur ubah status unit/order),
// tahap/QC Produksi V2, Produksi override, Delivery override, Stock Count. (units.js, orders.js, production.js SENGAJA berubah di rilis ini — perubahannya diaudit lewat allowlist eksplisit dan tes.)
const GUARD_UNCHANGED = [
  "backend/src/services/inventoryLedger.js", "backend/src/services/stokLokasi.js", "backend/src/constants/kelompokBahan.js", "backend/src/services/statusUnitLintasWorkspace.js",
  "backend/src/services/finance/journal.js", "backend/src/middleware/authorize.js", "backend/src/middleware/auth.js", "backend/src/constants/permissions.js", "backend/src/routes/stockCount.js",
  "backend/src/services/adminOverrideSwitch.js", "backend/src/services/deliveryOverrideAdmin.js", "backend/src/services/productionStepCommandService.js", "backend/src/services/finance/kedatangan.js",
];
// Commit live yang wajib leluhur kandidat: Produksi (admin override siap kirim), Gudang (Riwayat Referensi, Koreksi Gudang, UX Tahap 4, Sidebar), Finance (bukti serah). Diselesaikan ke SHA penuh.
const LIVE_ANCESTORS_REF = ["799d3e93", "56b87721", "e5a32cd2", "e47f37e2", "57198ad6", "cb33a07d"];
const UJI_TOLAK = 12, UJI_LOLOS = 5; // harus cocok dengan blok uji perilaku di templat
const DIST_BARU = ["Rencana · tidak mengurangi stok", "Aktual · mengurangi stok", "Catat status kerja", "Belum ada catatan pekerjaan"];
const DIST_LAMA = ["Ajukan Koreksi Stok", "Koreksi Penerimaan", "Konfirmasi Barang Jadi", "Selesaikan Produksi", "Rencana Produksi", "Uang muka dialokasikan ke faktur", "Tetapkan Siap Kirim (override)", "Riwayat referensi dari file (bukan transaksi)", "Simpan ke Stok", "Barang Akan Datang"];
// Tes integrasi terarah (rehearsal-penuh): pola nama berkas (backend/tests/integration) + jumlah tes yang HARUS lulus semuanya. TES_N_EXPECT diperbarui manual setelah dijalankan penuh pada commit final.
const TES_POLA = /^(production|unit|statusUnit|workshop|pkr|penjualanKaryawanOrderCrm|gudangStatus|gudangKoreksi|gudangPusat|deliveryUnitLoad|deliveryWriterCohort\.|deliveryCrossBoundary|ordersStatus|orderStatus|unitStatus|stok|material).*\.integration\.test\.js$/;
const TES_N_EXPECT = 581;

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const git = (args, opsi = {}) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opsi });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bashDq = (s) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

/** Murni: dari masukan → { script, ringkasan }. Tidak menyentuh git/disk. */
function bangkitkan({ tplSrc, berkasList, migName, migSql, schemaDiffSha, scanJs, scanExpect, liveMigTerakhir, liveAncestors, rehNode, smokeNode, tesFiles = [] }) {
  let s = lf(tplSrc);
  const isi = (k, v) => { must(s.includes(k), "placeholder " + k); s = s.split(k).join(v); };
  must(/^\d{14}_[a-z0-9_]+$/.test(migName), "nama migrasi tidak valid: " + migName);
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const backendSrc = berkas.filter((f) => f.startsWith("backend/src/"));
  const frontendSrc = berkas.filter((f) => f.startsWith("frontend/src/"));
  const prismaOk = ["backend/prisma/schema.prisma", `backend/prisma/migrations/${migName}/migration.sql`];
  for (const p of prismaOk) must(berkas.includes(p), "berkas prisma tidak ada di diff: " + p);
  must(!berkas.some((f) => /^backend\/prisma\//.test(f) && !prismaOk.includes(f)), "perubahan prisma lain di luar schema + migrasi rilis");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.some((f) => GUARD_UNCHANGED.includes(f)), "berkas pelindung ikut berubah: " + berkas.filter((f) => GUARD_UNCHANGED.includes(f)).join(","));
  const tplSha = sha(lf(tplSrc));
  isi("@@TEMPLATE_SHA@@", tplSha.slice(0, 12) + "…");
  isi("@@CAND_BRANCH@@", CAND_BRANCH);
  isi("@@MIG_NAME@@", migName);
  isi("@@MIG_SHA@@", sha(lf(migSql)));
  isi("@@SCAN_EXPECT@@", scanExpect);
  isi("@@SCHEMA_DIFF_SHA@@", schemaDiffSha);
  isi("@@LIVE_MIG_TERAKHIR@@", liveMigTerakhir);
  isi("@@ALLOWED_RE@@", `^(${berkas.map(esc).join("|")})$`);
  isi("@@BACKEND_SRC@@", backendSrc.join(" "));
  isi("@@FRONTEND_SRC@@", frontendSrc.join(" "));
  isi("@@GUARD_UNCHANGED@@", GUARD_UNCHANGED.join(" "));
  must(tesFiles.length > 0 && tesFiles.every((f) => /^tests\/integration\/[A-Za-z0-9]+\.integration\.test\.js$/.test(f)), "daftar berkas tes integrasi kosong/tidak valid");
  isi("@@TES_FILES@@", tesFiles.join(" ")); isi("@@TES_N_EXPECT@@", String(TES_N_EXPECT));
  isi("@@LIVE_ANCESTORS@@", liveAncestors.join(" "));
  isi("@@UJI_TOLAK@@", String(UJI_TOLAK)); isi("@@UJI_LOLOS@@", String(UJI_LOLOS));
  isi("@@DIST_BARU@@", DIST_BARU.map(bashDq).join(" ")); isi("@@DIST_LAMA@@", DIST_LAMA.map(bashDq).join(" "));
  isi("@@SCAN_JS@@", lf(scanJs).trimEnd()); isi("@@REH_NODE@@", lf(rehNode).trimEnd()); isi("@@SMOKE_NODE@@", lf(smokeNode).trimEnd());
  for (const lib of [scanJs, rehNode, smokeNode]) must(!lf(lib).split("\n").some((l) => l === "SCANJS" || l === "REHNODE" || l === "NODE"), "pustaka mengandung penanda heredoc");
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: backendSrc.length, frontendSrc: frontendSrc.length, migName, migSha: sha(lf(migSql)), tplSha, scanExpect, schemaDiffSha } };
}

/** Berkas tes integrasi terarah (dari pohon git HEAD, terurut) yang cocok dengan TES_POLA. */
function tesFilesDari() {
  return gitLines(["ls-tree", "--name-only", "HEAD", "backend/tests/integration/"]).map((x) => x.replace(/.*\//, "")).filter((n) => TES_POLA.test(n)).sort().map((n) => `tests/integration/${n}`);
}

function berkasBerbeda(base) {
  let ref = base, belumGabung = false;
  try { execFileSync("git", ["merge-base", "--is-ancestor", base, "HEAD"], { cwd: REPO, stdio: "ignore" }); } catch { ref = gitLines(["merge-base", "HEAD", base])[0]; belumGabung = true; }
  const list = new Set([...gitLines(["diff", "--name-only", ref]), ...gitLines(["ls-files", "-o", "--exclude-standard"])]);
  return { list: [...list], ref, belumGabung };
}

/** Pin diff schema.prisma — HARUS identik dengan perhitungan di skrip rilis (U0, tanpa baris index, tanpa nomor hunk). */
function schemaDiffSha(ref) {
  const keluar = git(["diff", "-U0", "--no-color", ref, "HEAD", "--", "backend/prisma/schema.prisma"]); // blob vs blob (sama dengan skrip rilis di server)
  const d = keluar.split("\n").filter((l) => !l.startsWith("index ")).map((l) => l.replace(/^@@ [^@]*@@.*$/, "@@")).join("\n");
  return sha(d + "\n"); // skrip rilis: { cat; echo; } menambah SATU baris kosong setelah keluaran
}

function main() {
  const arg = process.argv.slice(2); const iBase = arg.indexOf("--base"); const base = iBase >= 0 ? arg[iBase + 1] : "origin/main"; const cek = arg.includes("--check");
  const migDir = fs.readdirSync(path.join(REPO, "backend/prisma/migrations")).filter((n) => n.endsWith(MIG_SUFIKS) && /^\d{14}_/.test(n));
  must(migDir.length === 1, `harus tepat 1 migrasi *${MIG_SUFIKS}, ditemukan: ${migDir.join(",") || "tidak ada"}`);
  const { list, ref, belumGabung } = berkasBerbeda(base);
  must(!belumGabung, `HEAD belum memuat ${base}: gabungkan baseline live terlebih dulu`);
  const liveMig = gitLines(["ls-tree", "--name-only", ref, "backend/prisma/migrations/"]).map((x) => x.replace(/.*\//, "")).filter((n) => /^\d{14}_/.test(n)).sort().pop();
  const liveAncestors = LIVE_ANCESTORS_REF.map((r2) => git(["rev-parse", "--verify", r2 + "^{commit}"]).trim());
  for (const a of liveAncestors) execFileSync("git", ["merge-base", "--is-ancestor", a, "HEAD"], { cwd: REPO });
  const migSql = fs.readFileSync(path.join(REPO, "backend/prisma/migrations", migDir[0], "migration.sql"), "utf8");
  const scanJs = fs.readFileSync(path.join(REPO, LIB_SCAN), "utf8");
  const bersih = lf(migSql).split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n");
  const scanExpect = execFileSync(process.execPath, ["--input-type=module", "-e", scanJs.replace(/fs\.readFileSync\(0, "utf8"\)/, "process.env.SQL_UJI")], { cwd: REPO, encoding: "utf8", env: { ...process.env, SQL_UJI: bersih } }).trim();
  const hasil = bangkitkan({
    tplSrc: fs.readFileSync(path.join(REPO, TPL), "utf8"), berkasList: list, migName: migDir[0], migSql, schemaDiffSha: schemaDiffSha(ref), scanJs, scanExpect, liveMigTerakhir: liveMig, liveAncestors,
    rehNode: fs.readFileSync(path.join(REPO, LIB_REH), "utf8"), smokeNode: fs.readFileSync(path.join(REPO, LIB_SMOKE), "utf8"),
    tesFiles: tesFilesDari(),
  });
  const keluar = path.join(REPO, OUT);
  if (cek) {
    const ada = fs.existsSync(keluar) ? lf(fs.readFileSync(keluar, "utf8")) : "";
    if (ada !== hasil.script) { console.error("TIDAK SAMA: " + OUT + " berbeda dari hasil bangkitan ulang. Jalankan tanpa --check lalu commit."); process.exit(1); }
    console.log("SAMA: " + OUT + " identik dengan hasil bangkitan ulang (" + JSON.stringify(hasil.ringkasan) + ")");
    return;
  }
  fs.writeFileSync(keluar, hasil.script);
  console.log("ditulis", OUT, hasil.script.split("\n").length, "baris;", JSON.stringify(hasil.ringkasan));
}
module.exports = { bangkitkan, schemaDiffSha, tesFilesDari, TES_N_EXPECT };
if (require.main === module) main();
