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
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const info = (nama, d = "") => console.log(`INFO  ${nama}${d ? " — " + String(d).slice(0, 260) : ""}`);
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-master-bertautan.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji master bertautan hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "master baru + tautan SO atomik": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4103, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Bagian A = kode SMOKE yang sama dengan fase 8b (tidak menulis). Bagian B MENULIS — HANYA pada salinan restore (DB rehearsal_*, dibuang sesudahnya, dijaga di atas): rute atomik, rollback, idempotensi, dan
// UJI NYATA: master KAYU-RACUK-2X5X200 / 2X6X200 dibuat lewat rute atomik, lalu evaluasi ulang memetakan 18 catatan historis nyata dan SEMUANYA langsung TERTAHAN_PASCA_SO (tidak ada ISSUE, tidak ada rencana posting).
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4103); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const infoU = []; for (const u of semua) infoU.push({ u, rs: await rolesDari(u) });
const stamp = Date.now().toString(36);
const penyetuju = infoU.find((x) => bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE) && bisa(x.rs, P.INVENTORY_WRITE))?.u ?? await prisma.user.create({ data: { name: "REH Penyetuju", email: `reh-mba-a-${stamp}@example.test`, passwordHash: "x", role: "OWNER" } });
const bukan = infoU.find((x) => !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u ?? await prisma.user.create({ data: { name: "REH Gudang", email: `reh-mba-g-${stamp}@example.test`, passwordHash: "x", role: "WAREHOUSE" } });
const tA = await token(penyetuju); const tB = await token(bukan);
const TABEL = [["stock_movements", "select count(*)::int n from stock_movements"], ["biaya_beku", "select count(*)::int n from stock_movement_biaya_operasional"], ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["jurnal", "select count(*)::int n from fin_journal_entries"],
  ["penyesuaian", "select count(*)::int n from stock_adjustment_requests"], ["goods_receipts", "select count(*)::int n from goods_receipts"], ["persediaan_awal", "select count(*)::int n from fin_inventory_openings"], ["hasil_so", "select count(*)::int n from activity_events where entity_type = 'hasil_so_bahan'"], ["pernyataan", "select count(*)::int n from activity_events where event_type = 'SO_HISTORIS_DINYATAKAN'"]];
const jejak = async () => Object.fromEntries(await Promise.all(TABEL.map(async ([k, q]) => [k, await num(q)])));
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
const hitMat = () => num("select count(*)::int n from materials");
const hitTaut = () => num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN'");
const j0 = await jejak();

// ── A. SMOKE pasca-switch (kode yang sama dengan fase 8b) terhadap server rehearsal ──
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP|INFO)/.test(l)).join("\n"));
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));

// ── B. UJI TULIS pada SALINAN RESTORE (DB rehearsal_*) ──
const RUTE = "/api/production/posting-historis/pengaman/master-bertautan";
const post = async (body, tok, kunci = null) => { const r = await fetch(BASE + RUTE, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok, ...(kunci ? { "Idempotency-Key": kunci } : {}) }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { j = null; } return { status: r.status, json: j }; };
const HARI_INI = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const dasar = { soTanggal: HARI_INI, sumber: "Uji rehearsal (salinan restore)", alasan: "Uji rehearsal master baru bersama tautan SO", rujukanHash: "rehearsal-master-bertautan-0001" };
const uji = [{ code: `REH-MBA-${stamp.toUpperCase()}-A`, name: `REH MASTER UJI ${stamp} A`, unit: "PCS", category: "RAW_MATERIAL" }, { code: `REH-MBA-${stamp.toUpperCase()}-B`, name: `REH MASTER UJI ${stamp} B`, unit: "SHEET", category: "RAW_MATERIAL" }];
const k1 = `reh-mba-${stamp}-0001`; const m0 = await hitMat(); const t0 = await hitTaut();
const b1 = await post({ ...dasar, bahan: uji }, tB, k1); cek("bukan penyetuju: 403, tidak ada master/tautan", b1.status === 403 && (await hitMat()) === m0 && (await hitTaut()) === t0, `${b1.status}`);
const b2 = await post({ ...dasar, bahan: uji }, tA); cek("tanpa Idempotency-Key: 428, tidak ada master/tautan", b2.status === 428 && (await hitMat()) === m0 && (await hitTaut()) === t0, `${b2.status}`);
const b3 = await post({ ...dasar, bahan: uji }, tA, k1); cek("penyetuju: 201, dua master dan dua tautan lahir bersama", b3.status === 201 && b3.json?.bahan?.length === 2 && (await hitMat()) === m0 + 2 && (await hitTaut()) === t0 + 2, `${b3.status} ${JSON.stringify(b3.json).slice(0, 160)}`);
const ids = (b3.json?.bahan ?? []).map((x) => x.materialId);
cek("setiap master baru punya tautan aktif (tanggal SO, rujukan sama) dan belum punya pergerakan stok/catatan terpetakan", ids.length === 2 && (await num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN' and entity_id = any($1::text[]) and metadata->>'rujukanHash' = $2", ids, dasar.rujukanHash)) === 2 && (await num("select count(*)::int n from stock_movements where material_id::text = any($1::text[])", ids)) === 0 && (await num("select count(*)::int n from unit_usage_notes where material_id::text = any($1::text[])", ids)) === 0);
const b4 = await post({ ...dasar, bahan: uji }, tA, k1); cek("ulang kunci+isi sama: 200 ulang, tidak ada master/tautan baru", b4.status === 200 && b4.json?.ulang === true && (await hitMat()) === m0 + 2 && (await hitTaut()) === t0 + 2, `${b4.status}`);
const b5 = await post({ ...dasar, bahan: [uji[0]] }, tA, `reh-mba-${stamp}-0002`); cek("kode sudah ada dengan kunci lain: 409, tidak menautkan ke bahan lama", b5.status === 409 && (await hitMat()) === m0 + 2 && (await hitTaut()) === t0 + 2, `${b5.status}`);
const ada = (await prisma.$queryRawUnsafe("select code, name from materials where code not like 'REH-MBA-%' order by code limit 1"))[0];
const b6 = await post({ ...dasar, bahan: [{ code: `REH-MBA-${stamp.toUpperCase()}-C`, name: `REH MASTER UJI ${stamp} C`, unit: "PCS", category: "RAW_MATERIAL" }, { code: `REH-MBA-${stamp.toUpperCase()}-D`, name: ada.name, unit: "PCS", category: "RAW_MATERIAL" }] }, tA, `reh-mba-${stamp}-0003`);
cek("satu nama kembar bahan lama membatalkan SELURUH permintaan (tidak ada master C yang tersisa)", b6.status === 409 && (await num("select count(*)::int n from materials where code = $1", `REH-MBA-${stamp.toUpperCase()}-C`)) === 0 && (await hitMat()) === m0 + 2, `${b6.status}`);
const b7 = await post({ ...dasar, bahan: [{ code: `REH-MBA-${stamp.toUpperCase()}-E`, name: `REH MASTER UJI ${stamp} E`, unit: "PCS", category: "RAW_MATERIAL" }, { code: `REH-MBA-${stamp.toUpperCase()}-F`, name: "REH\u0000RUSAK", unit: "PCS", category: "RAW_MATERIAL" }] }, tA, `reh-mba-${stamp}-0004`);
cek("galat di tengah transaksi (setelah master pertama dibuat): ROLLBACK, tidak ada master/tautan tersisa", b7.status >= 400 && (await num("select count(*)::int n from materials where code like $1", `REH-MBA-${stamp.toUpperCase()}-%`)) === 2 && (await hitTaut()) === t0 + 2, `${b7.status}`);

// ── C. UJI NYATA: 18 catatan historis nyata (KAYU RACUK 2X5X200 / 2X6X200) belum bermaster di salinan restore ──
const { evaluasiUlang } = await imp("src/services/catatanPemakaianHistoris.js"); const { daftarPengaman } = await imp("src/services/pengamanHistorisPascaSO.js"); const { rencanakanPosting } = await imp("src/services/postingPemakaianHistoris.js");
const nyata = await prisma.$queryRawUnsafe("select upper(trim(raw_name)) nama, count(*)::int n from unit_usage_notes where material_id is null and origin = 'EXCEL' and state in ('SIAP_POSTING','PERLU_DICEK') and upper(trim(raw_name)) in ('KAYU RACUK 2X5X200','KAYU RACUK 2X6X200') group by 1 order by 1");
const adaMaster = await num("select count(*)::int n from materials where code in ('KAYU-RACUK-2X5X200','KAYU-RACUK-2X6X200')");
if (adaMaster === 0 && nyata.length) {
  const total = nyata.reduce((s, x) => s + x.n, 0); info("catatan nyata belum bermaster", JSON.stringify(nyata));
  const ib0 = await jejak(); const tt0 = await hitTaut();
  const kayu = [{ code: "KAYU-RACUK-2X5X200", name: "KAYU RACUK 2X5X200", unit: "PCS", category: "RAW_MATERIAL" }, { code: "KAYU-RACUK-2X6X200", name: "KAYU RACUK 2X6X200", unit: "PCS", category: "RAW_MATERIAL" }];
  const bk = await post({ ...dasar, rujukanHash: "rehearsal-kayu-atomik-0001", bahan: kayu }, tA, `reh-kayu-${stamp}-0001`);
  cek("rute atomik membuat master KAYU RACUK 2X5X200 dan 2X6X200 bersama tautan SO (salinan restore)", bk.status === 201 && (await hitTaut()) === tt0 + 2, `${bk.status}`);
  cek("pembuatan master TIDAK memetakan catatan nyata (masih tanpa bahan)", (await num("select count(*)::int n from unit_usage_notes where raw_name ilike 'KAYU RACUK 2X%X200' and material_id is null")) >= total);
  await evaluasiUlang(prisma, {}); // evaluasi otomatis sistem (perilaku lama: nama persis -> dipetakan)
  const idm = (bk.json?.bahan ?? []).map((x) => x.materialId);
  const dipetakan = await num("select count(*)::int n from unit_usage_notes where material_id::text = any($1::text[])", idm);
  cek("evaluasi otomatis memetakan catatan nyata ke master baru (perilaku sistem yang sudah ada)", dipetakan === total, `${dipetakan} dari ${total}`);
  const d = await daftarPengaman(prisma); const baris = d.baris.filter((b) => ["KAYU-RACUK-2X5X200", "KAYU-RACUK-2X6X200"].includes(b.kodeBahan));
  cek("SEMUA catatan yang terpetakan langsung TERTAHAN_PASCA_SO (pengaman efektif sejak pemetaan pertama)", baris.length === dipetakan && baris.every((b) => b.keadaan === "TERTAHAN_PASCA_SO"), `${baris.length} baris`);
  const rp = await rencanakanPosting(prisma); cek("rencana posting historis TIDAK memuat master baru itu", !rp.transaksi.some((t) => ["KAYU-RACUK-2X5X200", "KAYU-RACUK-2X6X200"].includes(t.kodeBahan)), `${rp.transaksi.length} transaksi`);
  cek("tidak ada ISSUE atau pergerakan stok baru akibat pembuatan, pemetaan, dan evaluasi", (await num("select count(*)::int n from stock_movements")) === ib0.stock_movements);
  info("catatan 'RING' nyata tetap tanpa bahan (nama master RING generik berbeda; tidak dipetakan otomatis)", String(await num("select count(*)::int n from unit_usage_notes where material_id is null and upper(trim(raw_name)) = 'RING' and state in ('SIAP_POSTING','PERLU_DICEK')")));
} else info("uji nyata KAYU RACUK dilewati", adaMaster ? "master sudah ada di production (pengaman sudah tidak relevan)" : "tidak ada catatan nyata bernama KAYU RACUK 2X5X200/2X6X200");

const j1 = await jejak(); cek("seluruh uji tidak mengubah stok, biaya beku, harga, jurnal, penyesuaian, GR, persediaan awal, hasil SO, maupun pernyataan SO (hanya master, tautan, dan pemetaan catatan pada salinan restore)", sama(j0, j1), JSON.stringify({ j0, j1 }));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
