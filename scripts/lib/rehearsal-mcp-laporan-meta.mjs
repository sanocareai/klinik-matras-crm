import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-mcp-laporan-meta.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji MCP laporan Meta Ads hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "MCP laporan Meta Ads": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Tool bersifat BACA-SAJA, jadi tidak ada skenario tulis; yang dibuktikan di sini: server hidup, tiga tool terlihat lewat TIGA jalur auth (OAuth ChatGPT, OAuth Claude, token statis) dengan
// rahasia khusus rehearsal, hasil tool == endpoint pada data produksi nyata (salinan), dan tidak ada satu baris pun berubah.
// INI UJI HANDLER/SERVER LOKAL. Discovery oleh klien konektor (claude.ai / ChatGPT) BARU bisa dibuktikan setelah rilis, lewat langkah refresh manual — lihat instruksi rilis.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4101); const BASE = `http://127.0.0.1:${PORT}`;
const REH_ENV = { MCP_API_TOKEN: "rehearsal-token-statis-0123456789", MCP_OAUTH_JWT_SECRET: "rehearsal-rahasia-oauth-0123456789abcdef", MCP_PUBLIC_URL: BASE };
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, ...REH_ENV, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const TABEL = ["Customer", "Order", "payments", "attribution_touches", "meta_ad_daily_spend", "meta_spend_imports", "meta_ad_references", "ad_source_spend_entries", "fin_journal_entries", "fin_journal_lines", "stock_movements", "units"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const fp0 = await fp();
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...REH_ENV, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), BASE_GANDA: "0", ORDER_N: String(await num('select count(*)::int n from "Order"')), JOB_N: String(await num("select count(*)::int n from jobs")) } });
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP)/.test(l)).join("\n"));
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE (kode yang sama dengan fase 8b) lulus terhadap server rehearsal lewat jalur OAuth ChatGPT, OAuth Claude, dan token statis: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
cek("tiga jalur auth benar-benar diuji di rehearsal (tidak ada yang dilewati)", /skip=0$/.test(smokeLine), smokeLine);
const fp1 = await fp(); const bedaTabel = TABEL.filter((t) => fp0[t].n !== fp1[t].n || fp0[t].h !== fp1[t].h);
cek(`isi ${TABEL.length} tabel kunci IDENTIK (jumlah baris + sidik isi) sebelum vs sesudah seluruh uji`, bedaTabel.length === 0, bedaTabel.join(","));
cek("log server tanpa galat tak tertangani selama uji", !/UnhandledPromiseRejection|Cannot find module|ERR_MODULE_NOT_FOUND/.test(log), log.slice(-200));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
