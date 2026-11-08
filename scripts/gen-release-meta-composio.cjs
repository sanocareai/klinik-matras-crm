// Generator skrip rilis "Sinkronisasi Meta lewat Composio". Allowlist, pin migrasi, dan sidik jari isi diff dihitung dari git terhadap --base.
//   node scripts/gen-release-meta-composio.cjs --base <SHA_LIVE> [--check]
// Skrip hasil dan generator dikecualikan dari sidik jari karena sidik jari hanya mencakup backend/ dan frontend/.
"use strict";
const fs = require("fs"); const path = require("path"); const crypto = require("crypto"); const { execFileSync } = require("child_process");
const REPO = path.resolve(__dirname, ".."); const OUT = "scripts/release-meta-composio.sh"; const TPL = "scripts/templates/release-meta-composio";
const MIG = "20261231140000_meta_composio_sync";
const git = (...a) => execFileSync("git", a, { cwd: REPO, maxBuffer: 1 << 29 });
const lf = (s) => s.replace(/\r\n/g, "\n"); const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
const arg = process.argv.slice(2); const base = arg[arg.indexOf("--base") + 1]; if (!arg.includes("--base") || !base) throw new Error("wajib --base");
const tetap = [OUT, "scripts/gen-release-meta-composio.cjs", `${TPL}/rilis.txt`, `${TPL}/gerbang-data.txt`, "scripts/meta-composio-sync-cron.sh", "scripts/lib/skema-hash.sh", "docs/META-COMPOSIO-SYNC.md"];
const berkas = [...new Set([...git("diff", "--name-only", base, "HEAD").toString().split("\n").filter(Boolean), ...tetap])].sort();
for (const f of berkas) if (/package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env|^frontend\/dist/.test(f)) throw new Error("berkas terlarang: " + f);
const migSql = git("show", `HEAD:backend/prisma/migrations/${MIG}/migration.sql`);
if (/\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i.test(lf(migSql.toString()).replace(/--.*$/gm, ""))) throw new Error("migrasi harus aditif");
const diff = git("-c", "core.quotepath=false", "diff", "--no-renames", "--no-color", "--no-ext-diff", "--binary", "--full-index", base, "HEAD", "--", "backend", "frontend");
const baca = (f) => lf(fs.readFileSync(path.join(REPO, f), "utf8"));
const skrip = baca(`${TPL}/rilis.txt`).replace("@@ALLOWED_RE@@", () => `^(${berkas.map(esc).join("|")})$`).replace("@@MIG_NAME@@", MIG).replace("@@MIG_SHA@@", sha(migSql)).replace("@@DIFF_SHA@@", sha(diff)).replace("@@SKEMA_LIB@@", () => baca("scripts/lib/skema-hash.sh").trimEnd()).replace("@@GERBANG_DATA@@", () => baca(`${TPL}/gerbang-data.txt`).trimEnd());
if (/@@[A-Z_]+@@/.test(skrip)) throw new Error("placeholder tersisa");
const keluar = path.join(REPO, OUT);
if (arg.includes("--check")) { if (!fs.existsSync(keluar) || lf(fs.readFileSync(keluar, "utf8")) !== skrip) { console.error("TIDAK SAMA"); process.exit(1); } console.log("SAMA"); }
else { fs.writeFileSync(keluar, skrip); console.log("ditulis", OUT, berkas.length, "berkas"); }
