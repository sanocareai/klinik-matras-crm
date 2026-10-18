// Generator skrip rilis bergerbang "UX Gudang Tahap 1" (backend + web, TANPA migrasi). Hasil: scripts/release-ux-gudang-tahap1.sh dari templat scripts/templates/release-ux-gudang-tahap1.sh.tpl.
// Semua nilai bergantung-commit (allowlist, daftar berkas backend/frontend, migrasi live terakhir + jumlahnya, commit live wajib leluhur, berkas pelindung) dihitung dari git terhadap --base. Tidak ada nilai manual.
//
//   node scripts/gen-release-ux-gudang-tahap1.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif = Koreksi Gudang live)
//   node scripts/gen-release-ux-gudang-tahap1.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung. Skrip rilis menolak berkas di luar allowlist dan menolak perubahan backend/prisma (tanpa migrasi).
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TPL = "scripts/templates/release-ux-gudang-tahap1.sh.tpl";
const OUT = "scripts/release-ux-gudang-tahap1.sh";
const LIB_REH = "scripts/lib/rehearsal-kode-ux-gudang.mjs";
const LIB_SMOKE = "scripts/lib/smoke-ux-gudang-tahap1.mjs";
const GENERATOR = "scripts/gen-release-ux-gudang-tahap1.cjs";
const CAND_BRANCH = "feat/gudang-ux-tahap1";
const FILE_TETAP = [OUT, LIB_REH, LIB_SMOKE, GENERATOR, TPL];
// Berkas yang HARUS identik antara base dan kandidat: inti Koreksi Gudang, jurnal, otorisasi/izin, Stock Count/opname, Produksi override, kedatangan PO (jalur resmi).
const GUARD_UNCHANGED = [
  "backend/src/services/warehouseCorrection.js", "backend/src/routes/gudangKoreksi.js", "backend/src/services/inventoryLedger.js", "backend/src/routes/materialIssue.js", "backend/src/routes/stockAdjustment.js", "backend/src/routes/stockTransfer.js", "backend/src/routes/returnRecord.js",
  "backend/src/routes/stockCount.js", "backend/src/services/opnameCutover.js", "backend/src/services/opnameMatriks.js", "backend/src/services/pergerakanSesiHitung.js",
  "backend/src/services/finance/journal.js", "backend/src/middleware/authorize.js", "backend/src/middleware/auth.js", "backend/src/constants/permissions.js",
  "backend/src/services/adminOverrideSwitch.js", "backend/src/services/deliveryOverrideAdmin.js", "backend/src/services/productionStepCommandService.js",
];
// Commit live yang wajib leluhur: frontend token geser (10294dcb), Koreksi Gudang (08d62e7d), Produksi override, Riwayat Referensi, bukti serah.
const LIVE_ANCESTORS_REF = ["10294dcb", "08d62e7d", "799d3e93", "56b87721", "e5a32cd2"];
const DIST_BARU = ["Beranda Gudang", "Batalkan catatan tiba", "Pulihkan ke Draf", "Riwayat dokumen", "Riwayat penerimaan", "Yang bisa dilakukan sekarang"];
const DIST_LAMA = ["Ajukan Koreksi Stok", "Koreksi Penerimaan", "Simpan Koreksi Data", "Konfirmasi Barang Jadi", "Selesaikan Produksi", "Rencana Produksi", "Uang muka dialokasikan ke faktur", "Tetapkan Siap Kirim (override)", "Riwayat referensi dari file (bukan transaksi)", "Simpan ke Stok"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bashDq = (s) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

/** Murni: dari masukan → { script, ringkasan }. */
function bangkitkan({ tplSrc, berkasList, liveMigTerakhir, liveMigJumlah, liveAncestors, rehNode, smokeNode }) {
  let s = lf(tplSrc);
  const isi = (k, v) => { must(s.includes(k), "placeholder " + k); s = s.split(k).join(v); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const backendSrc = berkas.filter((f) => f.startsWith("backend/src/")); const frontendSrc = berkas.filter((f) => f.startsWith("frontend/src/"));
  must(!berkas.some((f) => /^backend\/prisma\//.test(f)), "backend/prisma berubah — rilis UX harus tanpa migrasi/skema");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.some((f) => GUARD_UNCHANGED.includes(f)), "berkas pelindung ikut berubah: " + berkas.filter((f) => GUARD_UNCHANGED.includes(f)).join(","));
  const tplSha = sha(lf(tplSrc));
  isi("@@TEMPLATE_SHA@@", tplSha.slice(0, 12) + "…"); isi("@@CAND_BRANCH@@", CAND_BRANCH);
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
  const liveAncestors = LIVE_ANCESTORS_REF.map((r2) => git(["rev-parse", "--verify", r2 + "^{commit}"]).trim());
  for (const a of liveAncestors) execFileSync("git", ["merge-base", "--is-ancestor", a, "HEAD"], { cwd: REPO });
  const hasil = bangkitkan({
    tplSrc: fs.readFileSync(path.join(REPO, TPL), "utf8"), berkasList: list, liveMigTerakhir: migs[migs.length - 1], liveMigJumlah: migs.length, liveAncestors,
    rehNode: fs.readFileSync(path.join(REPO, LIB_REH), "utf8"), smokeNode: fs.readFileSync(path.join(REPO, LIB_SMOKE), "utf8"),
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
