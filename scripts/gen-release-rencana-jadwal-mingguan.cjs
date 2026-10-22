// Generator skrip rilis bergerbang "Rencana Produksi — jadwal mingguan" (backend + web + 1 migrasi ADITIF: 2 tabel baru kosong + 5 indeks + 4 FK RESTRICT + 1 trigger append-only yang memakai fungsi lama; tanpa ALTER pada tabel lama).
//
// Hasilnya: scripts/release-rencana-jadwal-mingguan.sh — diturunkan dari templat scripts/templates/release-rencana-jadwal-mingguan.sh.tpl; semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend/frontend, pin sha256 migrasi,
// pin diff schema.prisma, hasil pemindai DDL, commit live yang wajib leluhur, berkas pelindung, berkas + jumlah tes integrasi terarah) dihitung dari git terhadap --base. Tidak ada nilai manual selain konstanta di bawah.
//
//   node scripts/gen-release-rencana-jadwal-mingguan.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif; default origin/main)
//   node scripts/gen-release-rencana-jadwal-mingguan.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const MIG_SUFIKS_LIST = ["_production_unit_schedules", "_production_unit_component_reuse"]; // dua migrasi ADITIF (jadwal Admin; komponen lama dari unit pelanggan), terurut menurut nama
const TPL = "scripts/templates/release-rencana-jadwal-mingguan.sh.tpl";
const OUT = "scripts/release-rencana-jadwal-mingguan.sh";
const GUARD = "scripts/rollback-guard-rencana-jadwal-mingguan.sh";
const LIB_SCAN = "scripts/lib/scan-migrasi-rencana-jadwal-mingguan.mjs";
const LIB_REH = "scripts/lib/rehearsal-kode-rencana-jadwal-mingguan.mjs";
const LIB_SMOKE = "scripts/lib/smoke-rencana-jadwal-mingguan.mjs";
const GENERATOR = "scripts/gen-release-rencana-jadwal-mingguan.cjs";
const CAND_BRANCH = "feat/rencana-produksi-jadwal-mingguan";
const LIB_SKEN = "scripts/lib/rehearsal-skenario-rencana-jadwal-mingguan.mjs";
const LIB_LAMA = "scripts/lib/rehearsal-kode-lama-rencana-jadwal-mingguan.mjs";
const LIB_GUARD = "scripts/lib/rehearsal-guard-rencana-jadwal-mingguan.mjs"; // pembuktian aturan guard rollback (fase g1..g5) pada klon
const LIB_GUARD_LAMA = "scripts/lib/rehearsal-guard-kode-lama-rencana-jadwal-mingguan.mjs"; // kode LAMA pada klon guard: bukti bahaya jadwal ACTIVE + keadaan yang diizinkan
const FILE_TETAP = [OUT, GUARD, LIB_SCAN, LIB_REH, LIB_SMOKE, LIB_SKEN, LIB_LAMA, LIB_GUARD, LIB_GUARD_LAMA, GENERATOR, TPL];
// Berkas yang HARUS identik antara base dan kandidat (rilis ini tidak boleh menyentuhnya): ledger stok (postStockMovement), pembaca stok per lokasi + kelompok bahan, jurnal Finance, otorisasi/izin, FUNGSI STATUS LINTAS WORKSPACE (satu-satunya jalur ubah status unit/order),
// tahap/QC Produksi V2, Produksi override, Delivery override, Stock Count. (Stock Opname penuh live abf2b75e: stockCount*, opnameSesi, pergerakanSesiHitung, stokFisik, dokumenGudangLain dijaga identik). (orders.js, productionAdopsi.js, unitCustodyCommandService.js, customerNotifications.js SENGAJA berubah di rilis ini — diaudit lewat allowlist eksplisit dan tes.)
const GUARD_UNCHANGED = [
  "backend/src/services/inventoryLedger.js", "backend/src/services/stokLokasi.js", "backend/src/constants/kelompokBahan.js", "backend/src/services/statusUnitLintasWorkspace.js",
  "backend/src/services/finance/journal.js", "backend/src/middleware/authorize.js", "backend/src/middleware/auth.js", "backend/src/constants/permissions.js", "backend/src/routes/stockCount.js", "backend/src/routes/stockCountSesi.js", "backend/src/services/opnameSesi.js", "backend/src/services/pergerakanSesiHitung.js", "backend/src/services/stokFisik.js", "backend/src/services/dokumenGudangLain.js",
  "backend/src/services/adminOverrideSwitch.js", "backend/src/services/deliveryOverrideAdmin.js", "backend/src/services/productionStepCommandService.js", "backend/src/services/finance/kedatangan.js",
];
// Commit live yang wajib leluhur kandidat: Produksi (admin override siap kirim), Gudang (Riwayat Referensi, Koreksi Gudang, UX Tahap 4, Sidebar), Finance (bukti serah). Diselesaikan ke SHA penuh.
const LIVE_ANCESTORS_REF = ["799d3e93", "56b87721", "e5a32cd2", "e47f37e2", "57198ad6", "cb33a07d", "abf2b75e", "c332fcad", "661cf30f"];
const UJI_TOLAK = 32, UJI_LOLOS = 12; // harus cocok dengan blok uji perilaku di templat
const DIST_BARU = ["Jadwal mingguan", "Pelaksanaan Meja", "Papan Meja", "Jadwalkan lebih awal", "Hari Minggu libur", "Catat pemakaian aktual", "Komponen lama dari unit ini", "Bahan baru dari Gudang", "Gunakan sebagai isian awal"];
const DIST_LAMA = ["Ruang Kerja Unit", "Menunggu dicatat diterima", "Catat diterima", "Ternyata belum diterima fisik", "Muat ulang ruang kerja", "Rencana · tidak mengurangi stok", "Aktual · mengurangi stok", "Catat status kerja", "Belum ada catatan pekerjaan", "Ajukan Koreksi Stok", "Koreksi Penerimaan", "Konfirmasi Barang Jadi", "Selesaikan Produksi", "Rencana Produksi", "Uang muka dialokasikan ke faktur", "Tetapkan Siap Kirim (override)", "Riwayat referensi dari file (bukan transaksi)", "Simpan ke Stok", "Barang Akan Datang"];
// Tes integrasi terarah (rehearsal-penuh): pola nama berkas (backend/tests/integration) = jadwal/rencana Meja/papan/daftar kerja/penerimaan/ekspor/adopsi yang tersentuh rilis ini + jumlah tes yang HARUS lulus semuanya (dihitung dengan menjalankan himpunan berkas pinned lokal).
const TES_POLA = /^(rencana|productionPlanning|productionExperience|productionPlanStationPicTarget|productionWorkList|productionAdopsi|productionCommandCenter|productionWorkshopExecution|workshopMilestone|workshopReceipt|statusProduksiPenerimaan|komponenLama|pemakaianBahanLepas|unitV2Ownership).*\.integration\.test\.js$/;
const TES_N_EXPECT = 205; // dihitung dari menjalankan 21 berkas pinned secara terarah pada SHA kandidat (3 shard: 64+67+74; 0 gagal)

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const git = (args, opsi = {}) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opsi });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bashDq = (s) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

/** Murni: dari masukan → { script, ringkasan }. Tidak menyentuh git/disk. */
function bangkitkan({ tplSrc, berkasList, migs, schemaDiffSha, scanJs, scanExpect, liveMigTerakhir, liveAncestors, rehNode, smokeNode, tesFiles = [] }) {
  let s = lf(tplSrc);
  const isi = (k, v) => { must(s.includes(k), "placeholder " + k); s = s.split(k).join(v); };
  must(Array.isArray(migs) && migs.length >= 1, "daftar migrasi kosong");
  for (const m of migs) must(/^\d{14}_[a-z0-9_]+$/.test(m.name), "nama migrasi tidak valid: " + m.name);
  must(new Set(migs.map((m) => m.name)).size === migs.length, "nama migrasi ganda");
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const backendSrc = berkas.filter((f) => f.startsWith("backend/src/"));
  const frontendSrc = berkas.filter((f) => f.startsWith("frontend/src/"));
  const prismaOk = ["backend/prisma/schema.prisma", ...migs.map((m) => `backend/prisma/migrations/${m.name}/migration.sql`)];
  for (const p of prismaOk) must(berkas.includes(p), "berkas prisma tidak ada di diff: " + p);
  must(!berkas.some((f) => /^backend\/prisma\//.test(f) && !prismaOk.includes(f)), "perubahan prisma lain di luar schema + migrasi rilis");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.some((f) => GUARD_UNCHANGED.includes(f)), "berkas pelindung ikut berubah: " + berkas.filter((f) => GUARD_UNCHANGED.includes(f)).join(","));
  const tplSha = sha(lf(tplSrc));
  isi("@@TEMPLATE_SHA@@", tplSha.slice(0, 12) + "…");
  isi("@@CAND_BRANCH@@", CAND_BRANCH);
  isi("@@MIGS@@", migs.map((m) => `${m.name}:${sha(lf(m.sql))}`).join(" "));
  isi("@@MIG_OOO@@", migs.filter((m) => m.name < liveMigTerakhir).map((m) => m.name).join(" "));
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
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: backendSrc.length, frontendSrc: frontendSrc.length, migNames: migs.map((m) => m.name), migShas: migs.map((m) => sha(lf(m.sql))), tplSha, scanExpect, schemaDiffSha } };
}

/** Berkas tes integrasi terarah (dari pohon git HEAD, terurut) yang cocok dengan TES_POLA. */
function tesFilesDari() {
  return gitLines(["ls-tree", "--name-only", "HEAD", "backend/tests/integration/"]).map((x) => x.replace(/.*\//, "")).filter((n) => TES_POLA.test(n)).sort().map((n) => `tests/integration/${n}`);
}

function berkasBerbeda(base) {
  let ref = base, belumGabung = false;
  try { execFileSync("git", ["merge-base", "--is-ancestor", base, "HEAD"], { cwd: REPO, stdio: "ignore" }); } catch { ref = gitLines(["merge-base", "HEAD", base])[0]; belumGabung = true; }
  const list = new Set([...gitLines(["diff", "--name-only", ref]), ...gitLines(["ls-files", "-o", "--exclude-standard"]).filter((f) => !/^backend\/(data|uploads)\//.test(f))]); // artefak tes (foto/video uji) bukan bagian rilis
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
  const semuaMig = fs.readdirSync(path.join(REPO, "backend/prisma/migrations"));
  const migNames = MIG_SUFIKS_LIST.map((suf) => { const d = semuaMig.filter((n) => n.endsWith(suf) && /^\d{14}_/.test(n)); must(d.length === 1, `harus tepat 1 migrasi *${suf}, ditemukan: ${d.join(",") || "tidak ada"}`); return d[0]; }).sort();
  const { list, ref, belumGabung } = berkasBerbeda(base);
  must(!belumGabung, `HEAD belum memuat ${base}: gabungkan baseline live terlebih dulu`);
  const liveMig = gitLines(["ls-tree", "--name-only", ref, "backend/prisma/migrations/"]).map((x) => x.replace(/.*\//, "")).filter((n) => /^\d{14}_/.test(n)).sort().pop();
  const liveAncestors = LIVE_ANCESTORS_REF.map((r2) => git(["rev-parse", "--verify", r2 + "^{commit}"]).trim());
  for (const a of liveAncestors) execFileSync("git", ["merge-base", "--is-ancestor", a, "HEAD"], { cwd: REPO });
  const migs = migNames.map((name) => ({ name, sql: fs.readFileSync(path.join(REPO, "backend/prisma/migrations", name, "migration.sql"), "utf8") }));
  const scanJs = fs.readFileSync(path.join(REPO, LIB_SCAN), "utf8");
  const bersih = migs.map((m) => lf(m.sql).split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n")).join("\n");
  const scanExpect = execFileSync(process.execPath, ["--input-type=module", "-e", scanJs.replace(/fs\.readFileSync\(0, "utf8"\)/, "process.env.SQL_UJI")], { cwd: REPO, encoding: "utf8", env: { ...process.env, SQL_UJI: bersih } }).trim();
  const hasil = bangkitkan({
    tplSrc: fs.readFileSync(path.join(REPO, TPL), "utf8"), berkasList: list, migs, schemaDiffSha: schemaDiffSha(ref), scanJs, scanExpect, liveMigTerakhir: liveMig, liveAncestors,
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
