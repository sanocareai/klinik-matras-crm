// Generator skrip rilis bergerbang "Rekonsiliasi pemakaian historis" (backend + web + 1 migrasi ADITIF: 4 tabel baru kosong + 5 pernyataan pada 2 tabel lama). RILIS KODE SAJA: tidak mengimpor, tidak memposting. Hasil: scripts/release-rekon-pemakaian.sh dari templat scripts/templates/release-rekon-pemakaian.sh.tpl.
// Semua nilai bergantung-commit (allowlist, daftar berkas backend/frontend, migrasi live terakhir + jumlahnya, commit live wajib leluhur, berkas pelindung) dihitung dari git terhadap --base. Tidak ada nilai manual.
//
//   node scripts/gen-release-rekon-pemakaian.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-rekon-pemakaian.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung. Skrip rilis menolak berkas di luar allowlist dan menolak perubahan backend/prisma (tanpa migrasi).
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TPL = "scripts/templates/release-rekon-pemakaian.sh.tpl";
const OUT = "scripts/release-rekon-pemakaian.sh";
const LIB_REH = "scripts/lib/rehearsal-rekon-pemakaian.mjs";
const LIB_SMOKE = "scripts/lib/smoke-rekon-pemakaian.mjs"; const LIB_SCAN = "scripts/lib/scan-migrasi-rekon-pemakaian.mjs"; const MIG_SUFIKS = "_catatan_pemakaian_historis";
const GENERATOR = "scripts/gen-release-rekon-pemakaian.cjs";
const CAND_BRANCH = "feat/rekon-pemakaian-historis";
const PRASYARAT = "rilis UX Bahan katalog (fix/ux-bahan-drawer-pemakaian, commit 693b8c52, migrasi 20261227090000) HARUS sudah live; baseline (BASE_SHA) = commit release aktif itu";
// Diff berkas yang menyentuh stok/penyesuaian terhadap baseline dipatok sha256-nya (diff --no-abbrev antar-commit; independen dari pengaturan abbrev repo).
const DIFF_PIN_FILES = ["backend/src/services/inventoryLedger.js", "backend/src/routes/stockAdjustment.js"];
const FILE_TETAP = [OUT, LIB_REH, LIB_SMOKE, LIB_SCAN, GENERATOR, TPL];
// Berkas yang HARUS identik antara base dan kandidat: inti Koreksi Gudang, ledger, jurnal/posting persediaan, otorisasi/izin, pemisahan tugas, Stock Count (opname) inti, command Produksi (rencana, material issue V2, step), override.
const GUARD_UNCHANGED = [
  "backend/src/services/warehouseCorrection.js", "backend/src/routes/gudangKoreksi.js", "backend/src/services/inventorySegregation.js",
  "backend/src/services/opnameCutover.js", "backend/src/services/opnameMatriks.js", "backend/src/services/pergerakanSesiHitung.js", "backend/src/services/identitasHitung.js",
  "backend/src/services/finance/journal.js", "backend/src/services/finance/posting/inventory.js", "backend/src/middleware/authorize.js", "backend/src/middleware/auth.js", "backend/src/constants/permissions.js",
  "backend/src/lib/activityLog.js", "backend/src/lib/jejakPerubahan.js", "backend/src/services/gudangBeranda.js",
  "backend/src/services/adminOverrideSwitch.js", "backend/src/services/deliveryOverrideAdmin.js", "backend/src/services/productionStepCommandService.js",
  "backend/src/services/productionMaterialIssueCommandService.js", "backend/src/routes/productionPlanning.js",
];
// Commit live yang wajib leluhur: UX Gudang Tahap 1 (bcf8b770), manifest Sofa/Divan (20606872), token geser (10294dcb), Koreksi Gudang (08d62e7d), Produksi override, Riwayat Referensi, bukti serah, manifest merk (229755d6), UX Gudang Tahap 2 (f293c587), pintu masuk Gudang (ca9bdea7), status bayar PKR Delivery (694f2184).
const LIVE_ANCESTORS_REF = ["693b8c52", "fa6beb86", "0cd0262b", "4394c828", "1f79ddd2", "624f08d8", "d82e6e3d", "fd38f6c2", "96cced3f", "e47f37e2", "57198ad6", "58cbc284", "bcf8b770", "20606872", "10294dcb", "08d62e7d", "799d3e93", "56b87721", "e5a32cd2", "229755d6", "f293c587", "ca9bdea7", "694f2184"];
// Teks yang HARUS ada di dist baru (fitur rilis ini) dan teks fitur live yang tidak boleh hilang.
const DIST_BARU = ["Catatan pemakaian historis", "Koreksi pemakaian menunggu persetujuan", "Setujui & terapkan", "Saldo yang benar", "HPP bahan PARSIAL", "Ajukan koreksi pemakaian", "Kecualikan dari perhitungan"];
const DIST_LAMA = ["Bahan belum ada di katalog", "Catat sementara — stok belum diketahui", "Yang saya pakai bukan bahan ini", "Simpan pemakaian lagi", "Ada yang belum selesai", "Tidak bisa dicatat sebagai bahan baru", "Perlu rekonsiliasi Gudang", "Konfirmasi & kurangi stok", "Rencana bahan (opsional, belum mengurangi stok)", "Usulkan ke Gudang", "Beranda Gudang", "Selesaikan Produksi", "Tetapkan Siap Kirim", "Pembalik beban bersih", "Dibatalkan — tidak ditagih"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bashDq = (s) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

/** Murni: dari masukan → { script, ringkasan }. */
function bangkitkan({ tplSrc, berkasList, liveMigTerakhir, liveMigJumlah, liveAncestors, rehNode, smokeNode, mig, scanJs, scanExpect, diffPins }) {
  let s = lf(tplSrc);
  const isi = (k, v) => { must(s.includes(k), "placeholder " + k); s = s.split(k).join(v); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const backendSrc = berkas.filter((f) => f.startsWith("backend/src/")); const frontendSrc = berkas.filter((f) => f.startsWith("frontend/src/"));
  const prismaOk = [`backend/prisma/migrations/${mig.name}/migration.sql`, "backend/prisma/schema.prisma"];
  for (const p of prismaOk) must(berkas.includes(p), "berkas prisma tidak ada di diff: " + p);
  must(!berkas.some((f) => /^backend\/prisma\//.test(f) && !prismaOk.includes(f)), "perubahan prisma lain di luar migrasi rilis + schema.prisma");
  must(berkas.some((f) => /^backend\/src\//.test(f)), "backend/src tidak berubah — rilis ini membawa perubahan backend");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.some((f) => GUARD_UNCHANGED.includes(f)), "berkas pelindung ikut berubah: " + berkas.filter((f) => GUARD_UNCHANGED.includes(f)).join(","));
  const tplSha = sha(lf(tplSrc));
  isi("@@TEMPLATE_SHA@@", tplSha.slice(0, 12) + "…"); isi("@@CAND_BRANCH@@", CAND_BRANCH);
  isi("@@MIG_NAME@@", mig.name); isi("@@MIG_PIN@@", sha(lf(mig.sql))); isi("@@SCAN_JS@@", lf(scanJs).trimEnd()); isi("@@SCAN_EXPECT@@", scanExpect); isi("@@PRASYARAT@@", PRASYARAT); isi("@@DIFF_PINS@@", diffPins.map(([f, h]) => f + ":" + h).join(" "));
  must(!lf(scanJs).split("\n").some((l) => l === "SCANJS"), "pemindai mengandung penanda heredoc");
  isi("@@LIVE_MIG_TERAKHIR@@", liveMigTerakhir); isi("@@LIVE_MIG_JUMLAH@@", String(liveMigJumlah));
  isi("@@ALLOWED_RE@@", `^(${berkas.map(esc).join("|")})$`); isi("@@BACKEND_SRC@@", backendSrc.join(" ")); isi("@@FRONTEND_SRC@@", frontendSrc.join(" "));
  isi("@@GUARD_UNCHANGED@@", GUARD_UNCHANGED.join(" ")); isi("@@LIVE_ANCESTORS@@", liveAncestors.join(" "));
  isi("@@DIST_BARU@@", DIST_BARU.map(bashDq).join(" ")); isi("@@DIST_LAMA@@", DIST_LAMA.map(bashDq).join(" "));
  isi("@@REH_NODE@@", lf(rehNode).trimEnd()); isi("@@SMOKE_NODE@@", lf(smokeNode).trimEnd());
  for (const lib of [rehNode, smokeNode]) must(!lf(lib).split("\n").some((l) => l === "REHNODE" || l === "NODE"), "pustaka mengandung penanda heredoc");
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: backendSrc.length, frontendSrc: frontendSrc.length, liveMigJumlah, liveMigTerakhir, tplSha } };
}

function berkasBerbeda(base) {
  let ref = base, belumGabung = false;
  try { execFileSync("git", ["merge-base", "--is-ancestor", base, "HEAD"], { cwd: REPO, stdio: "ignore" }); } catch { ref = gitLines(["merge-base", "HEAD", base])[0]; belumGabung = true; }
  return { list: [...new Set([...gitLines(["diff", "--name-only", ref]), ...gitLines(["ls-files", "-o", "--exclude-standard"])])], ref, belumGabung };
}

function main() {
  const arg = process.argv.slice(2); const iBase = arg.indexOf("--base"); const base = iBase >= 0 ? arg[iBase + 1] : "origin/main"; const cek = arg.includes("--check");
  const { list, ref, belumGabung } = berkasBerbeda(base);
  must(!belumGabung, `HEAD belum memuat ${base}: gabungkan baseline live terlebih dulu`);
  const migs = gitLines(["ls-tree", "--name-only", ref, "backend/prisma/migrations/"]).map((x) => x.replace(/.*\//, "")).filter((n) => /^\d{14}_/.test(n)).sort();
  const semuaMig = fs.readdirSync(path.join(REPO, "backend/prisma/migrations")); const d = semuaMig.filter((n) => n.endsWith(MIG_SUFIKS) && /^\d{14}_/.test(n)); must(d.length === 1, `harus tepat 1 migrasi *${MIG_SUFIKS}, ditemukan: ${d.join(",") || "tidak ada"}`);
  must(!migs.includes(d[0]), "migrasi rilis sudah ada di baseline");
  const mig = { name: d[0], sql: fs.readFileSync(path.join(REPO, "backend/prisma/migrations", d[0], "migration.sql"), "utf8") };
  const scanJs = fs.readFileSync(path.join(REPO, LIB_SCAN), "utf8");
  // pemindai dijalankan SAAT BANGKIT: hasilnya menjadi SCAN_EXPECT yang dipatok di skrip (komentar baris "--" dan baris kosong dibuang seperti di skrip rilis)
  const bersih = lf(mig.sql).split("\n").filter((l) => !/^\s*--/.test(l) && !/^\s*$/.test(l)).join("\n") + "\n";
  const scanExpect = execFileSync("node", [path.join(REPO, LIB_SCAN)], { input: bersih, encoding: "utf8" }).trim();
  const diffPins = DIFF_PIN_FILES.map((f2) => [f2, sha(lf(git(["diff", "--no-abbrev", "--no-color", "--no-ext-diff", ref, "HEAD", "--", f2])))]);
  const liveAncestors = LIVE_ANCESTORS_REF.map((r2) => git(["rev-parse", "--verify", r2 + "^{commit}"]).trim());
  for (const a of liveAncestors) execFileSync("git", ["merge-base", "--is-ancestor", a, "HEAD"], { cwd: REPO });
  const hasil = bangkitkan({
    tplSrc: fs.readFileSync(path.join(REPO, TPL), "utf8"), berkasList: list, liveMigTerakhir: migs[migs.length - 1], liveMigJumlah: migs.length, liveAncestors,
    rehNode: fs.readFileSync(path.join(REPO, LIB_REH), "utf8"), smokeNode: fs.readFileSync(path.join(REPO, LIB_SMOKE), "utf8"), mig, scanJs, scanExpect, diffPins,
  });
  const keluar = path.join(REPO, OUT);
  if (cek) {
    const ada = fs.existsSync(keluar) ? lf(fs.readFileSync(keluar, "utf8")) : "";
    if (ada !== hasil.script) { console.error("TIDAK SAMA: " + OUT + " berbeda dari hasil bangkitan ulang. Jalankan tanpa --check lalu commit."); process.exit(1); }
    console.log("SAMA: " + OUT + " identik dengan hasil bangkitan ulang (" + JSON.stringify(hasil.ringkasan) + ")"); return;
  }
  fs.writeFileSync(keluar, hasil.script); console.log("ditulis", OUT, hasil.script.split("\n").length, "baris;", JSON.stringify(hasil.ringkasan));
}
module.exports = { bangkitkan };
if (require.main === module) main();
