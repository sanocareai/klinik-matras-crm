import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-selisih-laporan.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Audit Selisih Laporan": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4102, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// TANPA data uji dan TANPA tulisan sama sekali: pemeriksaan memakai data produksi nyata di salinan (Agustus–Oktober 2026), jadi parity dibuktikan pada data sungguhan.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4102); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const JEJAK = ["select count(*)::int n from payments", "select count(*)::int n from payment_verifications", 'select count(*)::int n from "Order"', "select count(*)::int n from fin_journal_entries", "select count(*)::int n from fin_journal_lines", "select count(*)::int n from fin_refunds", "select count(*)::int n from fin_order_credits", "select count(*)::int n from order_paid_at_pengecualian", "select count(*)::int n from activity_events"];
const jejak = async () => { const h = []; for (const q of JEJAK) h.push(await num(q)); return h; };
const j0 = await jejak();
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const env = { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), ORDER_N: String(await num('select count(*)::int n from "Order"')), PAY_N: String(await num("select count(*)::int n from payments")) };

// Smoke pasca-switch yang SAMA dijalankan pada tiga periode nyata: Oktober (lintas bulan: order September lunas Oktober), September (pengecualian lunas dikunci), dan Agustus.
for (const [label, from, to] of [["Oktober 2026", "2026-10-01", "2026-10-31"], ["September 2026", "2026-09-01", "2026-09-30"], ["Agustus 2026", "2026-08-01", "2026-08-31"]]) {
  const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 300000, env: { ...env, SMOKE_FROM: from, SMOKE_TO: to } });
  const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
  cek(`SMOKE (kode yang sama dengan fase 8b) lulus pada salinan restore, periode ${label}: 0 gagal`, sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
}
const j1 = await jejak();
cek("seluruh pemeriksaan (daftar, rekon, export) tidak mengubah payments, verifikasi, order, jurnal, baris jurnal, refund, nota kredit, pengecualian lunas, atau aktivitas — identik persis", JSON.stringify(j0) === JSON.stringify(j1), JSON.stringify([j0, j1]));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
