import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-produksi-filter.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji filter Order Produksi hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Filter Order Produksi + Ringkasan": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4102, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// TIDAK ada tulisan sama sekali (smoke dan ukur waktu hanya GET). Endpoint daftar/hitungan/ekspor tidak boleh mengubah apa pun; hasil filter harus memenuhi invarian (partisi, hitungan = daftar, baris memenuhi filter, halaman bertahap lengkap).
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4102); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const stamp = Date.now().toString(36);
const pembaca = info.find((x) => bisa(x.rs, P.UNIT_READ))?.u ?? await prisma.user.create({ data: { name: "REH Pembaca", email: `reh-pof-r-${stamp}@example.test`, passwordHash: "x", role: "OWNER" } });
cek("akun uji dengan unit:read tersedia", !!pembaca && bisa(await rolesDari(pembaca), P.UNIT_READ));
const tP = await token(pembaca);
const get = async (url, tok = tP) => { const t0 = process.hrtime.bigint(); const r = await fetch(BASE + url, { headers: tok ? { Authorization: "Bearer " + tok } : {} }); let j = null; try { if (/json/.test(r.headers.get("content-type") ?? "")) j = await r.json(); else await r.arrayBuffer(); } catch { /* bukan JSON */ } return { status: r.status, json: j, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; };
const W = "/api/production/work-orders";
const TABEL = ["stock_movements", "stock_movement_biaya_operasional", "material_harga_berlaku", "material_issues", "fin_journal_entries", "units", "unit_material_declarations", "production_runs_v2", "unit_custody_handoffs_v2", "production_unit_work_progress"];
const jejak = async () => Object.fromEntries(await Promise.all(TABEL.map(async (t) => [t, await num(`select count(*)::int n from ${t}`)])));
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

// ── A. jalur lama tetap: daftar tanpa filter dan hitungan kelengkapan masih sama bentuknya (aditif) ──
const j0 = await jejak();
const dasar = await get(`${W}?page=1&pageSize=50`); const hit = await get(`${W}/kelengkapan-hitung`);
cek("daftar tanpa filter: 200, bentuk lama utuh (units, total, hasMore, displayStatusCounts, filterDipakai)", dasar.status === 200 && Array.isArray(dasar.json.units) && typeof dasar.json.total === "number" && "hasMore" in dasar.json && !!dasar.json.displayStatusCounts && !!dasar.json.filterDipakai, `${dasar.status}`);
cek("hitungan kelengkapan: 200, bentuk lama utuh + faset PIC aditif", hit.status === 200 && !!hit.json.counts && typeof hit.json.unik === "number" && !!hit.json.dataOrder && Array.isArray(hit.json.pic), `${hit.status}`);
cek("filterDipakai mencatat posisi/pic/target (kosong bila tak dipakai)", Array.isArray(dasar.json.filterDipakai.posisi) && dasar.json.filterDipakai.pic === null && dasar.json.filterDipakai.target === null);

// ── B. WAKTU RESPONS pada data nyata (jalur penuh: pengayaan seluruh unit lalu saring) ──
const ukur = async (nama, url, batas, n3 = 3) => { const t = []; let st = 0; for (let i = 0; i < n3; i++) { const r = await get(url); st = r.status; t.push(r.ms); } const h = t.slice(1).sort((a, b) => a - b);
  console.log(`WAKTU ${nama.padEnd(60)} dingin=${String(Math.round(t[0])).padStart(5)} ms | hangat p50=${String(Math.round(h[Math.floor(h.length / 2)])).padStart(5)} ms maks=${String(Math.round(Math.max(...h))).padStart(5)} ms`);
  cek(`waktu ${nama} di bawah batas ${batas} ms (maks ${Math.round(Math.max(...t))} ms)`, st === 200 && Math.max(...t) < batas); };
await ukur("daftar tanpa filter (halaman 1)", `${W}?page=1&pageSize=50`, 10000);
await ukur("daftar filter posisi Di workshop", `${W}?posisi=DI_WORKSHOP&page=1&pageSize=50`, 20000);
await ukur("daftar filter target terlambat", `${W}?target=terlambat&page=1&pageSize=50`, 20000);
await ukur("daftar filter gabungan posisi+target (halaman 2)", `${W}?posisi=DI_WORKSHOP,SUDAH_DIJEMPUT&target=tujuh_hari&page=2&pageSize=50`, 20000);
await ukur("hitungan kelengkapan + faset PIC", `${W}/kelengkapan-hitung?target=terlambat`, 20000);
await ukur("ekspor Excel dengan filter PIC kosong", `${W}/export.xlsx?pic=${encodeURIComponent("~tanpa")}`, 40000, 2);
cek("endpoint daftar/hitungan/ekspor tidak mengubah stok, biaya beku, harga, Material Issue, jurnal, unit, pernyataan, run, custody, status kerja", sama(await jejak(), j0));

// ── C. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP)/.test(l)).join("\n"));
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
