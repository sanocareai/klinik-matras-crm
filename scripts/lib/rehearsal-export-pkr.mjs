import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-export-pkr.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji export PKR hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Export Excel Penjualan Karyawan": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Semua tulisan hanya di DB sementara ini: 524 dokumen uji (lebih dari batas 500 layar) + dokumen batal + pembayaran batal. Export tidak boleh mengubah apa pun; angka harus sama dengan hitungan langsung dan daftar layar.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4101); const BASE = `http://127.0.0.1:${PORT}`;
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
const adm = info.find((x) => bisa(x.rs, P.FINANCE_ADMIN))?.u ?? await prisma.user.create({ data: { name: "REH Admin", email: `reh-adm-${stamp}@example.test`, passwordHash: "x", role: "ADMIN" } });
const fin = info.find((x) => bisa(x.rs, P.FINANCE_READ) && !bisa(x.rs, P.FINANCE_ADMIN))?.u ?? await prisma.user.create({ data: { name: "REH Finance", email: `reh-fin-${stamp}@example.test`, passwordHash: "x", role: "FINANCE" } });
const sls = info.find((x) => !bisa(x.rs, P.FINANCE_READ))?.u ?? await prisma.user.create({ data: { name: "REH Sales", email: `reh-sls-${stamp}@example.test`, passwordHash: "x", role: "SALES" } });
cek("akun uji tersedia: Finance Admin, Finance non-Admin, dan akun tanpa izin Finance", !!adm && !!fin && !!sls && adm.id !== fin.id && fin.id !== sls.id);
const tA = await token(adm); const tF = await token(fin); const tS = await token(sls);
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const unduh = async (tok, body) => { const r = await fetch(BASE + "/api/finance/export/penjualan-karyawan", { method: "POST", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) });
  const tipe = r.headers.get("content-type") || ""; if (!tipe.includes("spreadsheetml")) { let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, wb: null, json: j }; }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); return { status: r.status, wb, json: null }; };
const sel = (c) => (c.value && typeof c.value === "object" && !(c.value instanceof Date) && "text" in c.value ? c.value.text : c.value);
const sheet = (wb, nama) => { const ws = wb.getWorksheet(nama); const header = []; ws.getRow(6).eachCell({ includeEmpty: false }, (c, i) => { header[i - 1] = sel(c); }); const baris = []; let total = null;
  for (let r = 7; r <= ws.rowCount; r++) { const row = ws.getRow(r); if (row.actualCellCount === 0) continue; const o = {}; header.forEach((h, i) => { o[h] = sel(row.getCell(i + 1)) ?? null; });
    if (typeof o[header[0]] === "string" && /^Tidak ada data sesuai/.test(o[header[0]])) continue; // pesan sheet kosong, bukan baris data
    if (typeof o[header[0]] === "string" && /^TOTAL/i.test(o[header[0]])) { total = o; break; } baris.push(o); } return { header, baris, total }; };
const layar = async (q) => { const r = await fetch(BASE + "/api/finance/penjualan-karyawan?" + new URLSearchParams(q).toString(), { headers: { Authorization: "Bearer " + tA } }); return { status: r.status, json: r.status === 200 ? await r.json() : null }; };
const jejak = async () => ({ dok: await num("select count(*)::int n from fin_penjualan_karyawan"), bayar: await num("select count(*)::int n from fin_penjualan_karyawan_payments"), jurnal: await num("select count(*)::int n from fin_journal_entries"), baris: await num("select count(*)::int n from fin_journal_lines") });
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

// ── A. data NYATA di salinan: export tidak menulis apa pun dan sama dengan layar
const j0 = await jejak();
const eksNyata = await unduh(tA, { periode: { from: "2025-01-01", to: "2026-12-31" }, filter: {} });
const dNyata = eksNyata.wb ? sheet(eksNyata.wb, "Daftar Penjualan") : { baris: [] };
cek(`export seluruh data nyata di salinan: 200 dan memuat ${j0.dok} dokumen (semua dokumen PKR yang ada)`, eksNyata.status === 200 && dNyata.baris.length === j0.dok, `${dNyata.baris.length}/${j0.dok}`);
cek("export pada data nyata tidak mengubah dokumen, pembayaran, atau jurnal", sama(await jejak(), j0));

// ── B. data uji (HANYA di salinan): 520 dokumen + P1 lunas + P2 sebagian (1 pembayaran batal) + P3 batal (pembayaran batal) + P4 karyawan lain + P5 September
const tag = `PKR-REH-${stamp}`; const D = (s) => new Date(`${s}T00:00:00.000Z`);
const s2 = await prisma.user.create({ data: { name: `REH Penjual B ${stamp}`, email: `reh-pb-${stamp}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
const ids = Array.from({ length: 520 }, () => crypto.randomUUID());
await prisma.finPenjualanKaryawan.createMany({ data: ids.map((id, i) => ({ id, nomor: `${tag}-M${String(i + 1).padStart(4, "0")}`, date: D("2026-10-05"), sellerId: adm.id, buyerName: `Pembeli Masal ${i + 1}`, total: 100, status: "AKTIF" })) });
await prisma.finPenjualanKaryawanItem.createMany({ data: ids.map((id) => ({ penjualanId: id, name: "Kasur Masal", quantity: 1, unitPrice: 100, sortOrder: 0 })) });
const doc = async (kode, date, seller, buyer, total, status = "AKTIF", payments = []) => { const id = crypto.randomUUID();
  await prisma.finPenjualanKaryawan.create({ data: { id, nomor: `${tag}-${kode}`, date: D(date), sellerId: seller.id, buyerName: buyer, total, status, ...(status === "DIBATALKAN" && { cancelledAt: new Date("2026-10-20T05:00:00Z"), cancelReason: "uji rehearsal" }), items: { create: [{ name: "Kasur Uji", quantity: 1, unitPrice: total, sortOrder: 0 }] } } });
  for (const p of payments) await prisma.finPenjualanKaryawanPayment.create({ data: { penjualanId: id, date: D(date), amount: p.amount, method: "TUNAI", ...(p.batal && { cancelledAt: new Date("2026-10-21T05:00:00Z"), cancelReason: "uji rehearsal" }) } }); return id; };
await doc("P1", "2026-10-10", adm, "Lunas Uji", 200, "AKTIF", [{ amount: 200 }]);
await doc("P2", "2026-10-11", adm, "Sebagian Uji", 300, "AKTIF", [{ amount: 100 }, { amount: 50, batal: true }]);
await doc("P3", "2026-10-12", adm, "Batal Uji", 400, "DIBATALKAN", [{ amount: 150, batal: true }]);
await doc("P4", "2026-10-13", s2, `Kerabat Cari ${stamp}`, 250);
await doc("P5", "2026-09-15", adm, "September Uji", 700);
const OKT = { from: "2026-10-01", to: "2026-10-31" };
const sc = await layar({ ...OKT, q: tag });
cek("layar memotong di 500 baris (524 dokumen uji) — pembanding", sc.status === 200 && sc.json.penjualan.length === 500 && sc.json.terpotong === true, sc.json ? `${sc.json.penjualan.length}/${sc.json.terpotong}` : sc.status);
const ex = await unduh(tA, { periode: OKT, filter: { q: tag } }); const d = ex.wb ? sheet(ex.wb, "Daftar Penjualan") : { baris: [], total: null, header: [] };
cek("export memuat SELURUH hasil filter: 524 dokumen uji periode Oktober (520 masal + P1..P4; P5 September tidak ikut) — lebih dari batas 500 layar", ex.status === 200 && d.baris.length === 524, d.baris.length);
const p3 = d.baris.find((b) => b["Nomor PKR"] === `${tag}-P3`);
cek("dokumen batal: status 'Dibatalkan — tidak ditagih', sisa Rp0, nilai historis Rp400 tetap", !!p3 && p3.Status === "Dibatalkan — tidak ditagih" && Number(p3["Sisa Ditagih (Rp)"]) === 0 && Number(p3["Nilai (Rp)"]) === 400, p3 ? p3.Status : "tidak ada");
cek("TOTAL aktif: 523 dari 524 dokumen; nilai tanpa dokumen batal (52.000 + 200 + 300 + 250); dibayar hanya pembayaran aktif (300)", !!d.total && /523 dari 524/.test(String(d.total["Nomor PKR"])) && Number(d.total["Nilai (Rp)"]) === 52750 && Number(d.total["Dibayar (Rp)"]) === 300, d.total ? JSON.stringify([d.total["Nomor PKR"], d.total["Nilai (Rp)"], d.total["Dibayar (Rp)"]]) : "tanpa total");
const by = ex.wb ? sheet(ex.wb, "Pembayaran") : { baris: [], total: null };
cek("sheet Pembayaran: 4 pembayaran, 2 berstatus Dibatalkan (50 dan 150) TIDAK masuk total aktif Rp300", by.baris.length === 4 && by.baris.filter((r) => r.Status === "Dibatalkan").length === 2 && !!by.total && Number(by.total["Nominal (Rp)"]) === 300, by.total ? by.total["Nominal (Rp)"] : "tanpa total");
let sk = 0; for (const p of sc.json?.penjualan ?? []) { const b = d.baris.find((r) => r["Nomor PKR"] === p.nomor); if (!b || r2(b["Nilai (Rp)"]) !== r2(p.total) || r2(b["Dibayar (Rp)"]) !== r2(p.terbayar) || r2(b["Sisa Ditagih (Rp)"]) !== r2(p.sisa)) sk++; }
cek("500 baris layar adalah himpunan bagian Excel dengan angka identik", sk === 0, sk ? `${sk} berbeda` : "identik");
for (const [nama, filter, harap] of [["status LUNAS", { status: "LUNAS" }, [`${tag}-P1`]], ["status SEBAGIAN", { status: "SEBAGIAN" }, [`${tag}-P2`]], ["status DIBATALKAN", { status: "DIBATALKAN" }, [`${tag}-P3`]], ["pencarian", { q: `Kerabat Cari ${stamp}` }, [`${tag}-P4`]], ["karyawan lain", { sellerId: s2.id, q: tag }, [`${tag}-P4`]]]) {
  const e = await unduh(tA, { periode: OKT, filter: { q: tag, ...filter } }); const baris = e.wb ? sheet(e.wb, "Daftar Penjualan").baris.map((b) => b["Nomor PKR"]) : [];
  cek(`filter ${nama}: tepat dokumen yang diharapkan`, e.status === 200 && JSON.stringify(baris.sort()) === JSON.stringify([...harap].sort()), baris.slice(0, 3).join(","));
}
const eS = await unduh(tA, { periode: { from: "2026-09-01", to: "2026-09-30" }, filter: { q: tag } }); cek("filter periode September: hanya P5", eS.status === 200 && JSON.stringify(sheet(eS.wb, "Daftar Penjualan").baris.map((b) => b["Nomor PKR"])) === JSON.stringify([`${tag}-P5`]));
const eK = await unduh(tA, { periode: OKT, filter: { sellerId: s2.id, q: tag } }); const kep = eK.wb ? JSON.stringify([1, 2, 3, 4].map((i) => sel(eK.wb.getWorksheet("Daftar Penjualan").getCell(`A${i}`)))) : "";
cek("label filter memakai NAMA karyawan, bukan id", eK.status === 200 && kep.includes(`REH Penjual B ${stamp}`) && !kep.includes(s2.id), kep.slice(0, 120));
const pk = eK.wb ? sheet(eK.wb, "Per Karyawan").baris.filter((b) => b["Penjualan Aktif"] != null) : [];
cek("sheet Per Karyawan mengikuti filter karyawan dan periode (aktif saja)", pk.length === 1 && Number(pk[0]["Nilai (Rp)"]) === 250, JSON.stringify(pk).slice(0, 120));
const adminKolom = d.header.includes("Catatan Internal"); const eF = await unduh(tF, { periode: OKT, filter: { q: tag } });
cek("izin: Finance Admin menerima Catatan Internal; Finance non-Admin 200 TANPA kolom sensitif; tanpa izin 403; tanpa token 401", adminKolom && eF.status === 200 && !sheet(eF.wb, "Daftar Penjualan").header.includes("Catatan Internal") && (await unduh(tS, { periode: OKT, filter: {} })).status === 403 && (await unduh(null, { periode: OKT, filter: {} })).status === 401);
cek("status tidak valid 400 FILTER_TIDAK_VALID", await (async () => { const r = await unduh(tA, { periode: OKT, filter: { status: "APA_SAJA" } }); return r.status === 400 && r.json?.code === "FILTER_TIDAK_VALID"; })());
const j1 = await jejak(); cek("setelah seluruh export: jumlah dokumen/pembayaran/jurnal hanya bertambah oleh data uji (jurnal dan baris jurnal TIDAK berubah)", j1.dok === j0.dok + 525 && j1.bayar === j0.bayar + 4 && j1.jurnal === j0.jurnal && j1.baris === j0.baris, JSON.stringify(j1));

// ── G. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), BASE_GANDA: "0", ORDER_N: String(await num('select count(*)::int n from "Order"')), JOB_N: String(await num("select count(*)::int n from jobs")) } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
