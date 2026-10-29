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
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-komplain-redesign.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji Komplain hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Redesign Kasus Komplain": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Semua tulisan hanya di DB sementara ini: 340 kasus aktif + 20 riwayat uji (lebih dari batas 300). Endpoint daftar/ringkasan tidak boleh mengubah apa pun; total/hasMore harus jujur; Aktif dan Riwayat terpisah.
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
const pembaca = info.find((x) => bisa(x.rs, P.COMPLAINT_READ) && bisa(x.rs, P.COMPLAINT_WRITE))?.u ?? await prisma.user.create({ data: { name: "REH Pembaca", email: `reh-kmp-r-${stamp}@example.test`, passwordHash: "x", role: "ADMIN" } });
const tanpa = info.find((x) => !bisa(x.rs, P.COMPLAINT_READ))?.u ?? await prisma.user.create({ data: { name: "REH Tanpa Izin", email: `reh-kmp-x-${stamp}@example.test`, passwordHash: "x", role: "DRIVER" } });
cek("akun uji tersedia: dengan dan tanpa izin complaint:read", !!pembaca && !!tanpa && pembaca.id !== tanpa.id && !bisa(await rolesDari(tanpa), P.COMPLAINT_READ));
const tP = await token(pembaca); const tX = await token(tanpa);
const get = async (url, tok = tP) => { const r = await fetch(BASE + url, { headers: tok ? { Authorization: "Bearer " + tok } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const TUTUP = "('SELESAI','DIBATALKAN')";
const jejak = async () => ({ kasus: await num("select count(*)::int n from complaint_cases"), aktivitas: await num("select count(*)::int n from activity_events"), job: await num("select count(*)::int n from jobs"), unit: await num("select count(*)::int n from units"), order: await num('select count(*)::int n from "Order"'), jurnal: await num("select count(*)::int n from fin_journal_entries"), baris: await num("select count(*)::int n from fin_journal_lines"), stok: await num("select count(*)::int n from stock_movements") });
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

// ── A. data NYATA di salinan: total jujur dan sama dengan tabel; endpoint tidak menulis apa pun
const j0 = await jejak();
const tot0 = j0.kasus; const akt0 = await num(`select count(*)::int n from complaint_cases where status::text not in ${TUTUP}`);
const a1 = await get("/api/complaints?limit=1"); const a2 = await get("/api/complaints?scope=aktif&limit=1");
cek(`data nyata: total daftar = hitungan tabel (${tot0} kasus) dan total aktif = ${akt0}`, a1.status === 200 && a1.json?.total === tot0 && a2.status === 200 && a2.json?.total === akt0, `${a1.json?.total}/${a2.json?.total}`);
cek("daftar dan ringkasan pada data nyata tidak mengubah kasus, aktivitas, job, unit, order, jurnal, atau stok", (await get("/api/complaints/ringkasan")).status === 200 && sama(await jejak(), j0));

// ── B. data uji (HANYA di salinan): 340 kasus aktif + 20 riwayat, tersebar di status/keparahan; order dipinjam dari salinan restore
const order = await prisma.order.findFirst({ orderBy: { id: "asc" } });
if (!order) { cek("salinan restore memuat setidaknya satu order untuk kasus uji", false); berhenti(); await prisma.$disconnect(); process.exit(1); }
const tag = `KMP-REH-${stamp}`; const sev = ["RENDAH", "SEDANG", "TINGGI", "KRITIS"]; const stAktif = ["BARU", "VERIFIKASI", "INVESTIGASI", "ACTION_REQUIRED", "DALAM_PENANGANAN", "QC", "SIAP_DIKIRIM", "KONFIRMASI_CUSTOMER", "MENUNGGU_MATERIAL", "MENUNGGU_CUSTOMER"];
const baris = [];
for (let i = 0; i < 340; i++) baris.push({ id: crypto.randomUUID(), caseNumber: `${tag}-A${String(i + 1).padStart(4, "0")}`, orderId: order.id, category: "KENYAMANAN", severity: sev[i % 4], description: `Uji ${tag} aktif ${i + 1}`, status: stAktif[i % stAktif.length], currentOwner: "SALES", createdAt: new Date(Date.UTC(2026, 9, 1 + (i % 28), 3, 0, i % 60)) });
for (let i = 0; i < 20; i++) baris.push({ id: crypto.randomUUID(), caseNumber: `${tag}-R${String(i + 1).padStart(4, "0")}`, orderId: order.id, category: "KENYAMANAN", severity: "SEDANG", description: `Uji ${tag} riwayat ${i + 1}`, status: i % 2 ? "SELESAI" : "DIBATALKAN", currentOwner: "SALES", ...(i % 2 ? { resolution: "uji", customerConfirmedAt: new Date("2026-10-20T05:00:00Z") } : { cancelReason: "uji rehearsal" }), createdAt: new Date(Date.UTC(2026, 9, 2 + (i % 20), 4, 0, 0)) });
await prisma.complaintCase.createMany({ data: baris });
const j1 = await jejak(); cek("data uji tertulis di salinan: 360 kasus (340 aktif + 20 riwayat)", j1.kasus === j0.kasus + 360, `${j1.kasus - j0.kasus}`);
const q = encodeURIComponent(tag);
const dBawaan = await get(`/api/complaints?q=${q}`);
cek("TANPA limit: dikembalikan 300 kasus tetapi total=360 dan hasMore=true (pemotongan TIDAK diam-diam, tidak seperti sebelum redesign)", dBawaan.status === 200 && dBawaan.json.cases.length === 300 && dBawaan.json.total === 360 && dBawaan.json.hasMore === true, `${dBawaan.json?.cases?.length}/${dBawaan.json?.total}/${dBawaan.json?.hasMore}`);
const dAktif = await get(`/api/complaints?scope=aktif&q=${q}&limit=1`); const dRiw = await get(`/api/complaints?scope=riwayat&q=${q}&limit=1`);
cek("scope aktif = 340 dan riwayat = 20 (SELESAI/DIBATALKAN terpisah)", dAktif.json?.total === 340 && dRiw.json?.total === 20, `${dAktif.json?.total}/${dRiw.json?.total}`);
const kumpul = async (scope, ukuran) => { const ids = []; let off = 0; let rank = 99; let urut = true; let hm = null; const RANK = { RENDAH: 0, SEDANG: 1, TINGGI: 2, KRITIS: 3 };
  for (let h = 0; h < 40; h++) { const r = await get(`/api/complaints?scope=${scope}&q=${q}&limit=${ukuran}&offset=${off}`); if (r.status !== 200) return { ids, urut: false, hm: null, status: r.status };
    for (const c of r.json.cases) { ids.push(c.id); const rk = RANK[c.severity]; if (scope === "aktif" && rk > rank) urut = false; rank = rk; } hm = r.json.hasMore; off += r.json.cases.length; if (!r.json.hasMore || !r.json.cases.length) break; }
  return { ids, urut, hm }; };
const h1 = await kumpul("aktif", 30);
cek("menelusuri halaman aktif @30: 340 kasus, tanpa ganda, hasMore=false di akhir, keparahan menurun (Kritis dulu)", h1.ids.length === 340 && new Set(h1.ids).size === 340 && h1.hm === false && h1.urut, `${h1.ids.length}/${new Set(h1.ids).size}/${h1.hm}/${h1.urut}`);
const h2 = await kumpul("aktif", 300); cek("halaman @300 (batas maksimum): 2 halaman, 340 kasus, tanpa ganda", h2.ids.length === 340 && new Set(h2.ids).size === 340 && h2.hm === false);
const hr = await kumpul("riwayat", 7); cek("menelusuri riwayat @7: 20 kasus, tanpa ganda", hr.ids.length === 20 && new Set(hr.ids).size === 20 && hr.hm === false);
cek("tidak ada kasus aktif di riwayat dan sebaliknya", !h1.ids.some((i) => hr.ids.includes(i)));
const fSt = await get(`/api/complaints?statuses=BARU,QC&q=${q}&limit=1`); const harapSt = baris.filter((b) => ["BARU", "QC"].includes(b.status)).length;
cek(`filter statuses=BARU,QC: total ${harapSt}`, fSt.status === 200 && fSt.json.total === harapSt, fSt.json?.total);
const fQ = await get(`/api/complaints?q=${encodeURIComponent(tag + "-A0007")}&limit=5`); cek("pencarian nomor kasus tunggal", fQ.status === 200 && fQ.json.total === 1 && fQ.json.cases[0].caseNumber === `${tag}-A0007`, fQ.json?.total);
const rg = await get("/api/complaints/ringkasan"); const aktifSql = await num(`select count(*)::int n from complaint_cases where status::text not in ${TUTUP}`); const prioSql = await num(`select count(*)::int n from complaint_cases where status::text not in ${TUTUP} and severity::text in ('TINGGI','KRITIS')`);
cek("ringkasan sama dengan hitungan langsung tabel (aktif, riwayat, prioritas, jumlah semua status = semua kasus)", rg.status === 200 && rg.json.aktif === aktifSql && rg.json.riwayat === j1.kasus - aktifSql && rg.json.prioritas === prioSql && Object.values(rg.json.perStatus).reduce((a, b) => a + b, 0) === j1.kasus, rg.json ? JSON.stringify([rg.json.aktif, rg.json.riwayat, rg.json.prioritas]) : rg.status);
for (const [nama, url] of [["scope tidak dikenal", "/api/complaints?scope=semua"], ["limit 0", "/api/complaints?limit=0"], ["limit 301", "/api/complaints?limit=301"], ["limit bukan angka", "/api/complaints?limit=abc"], ["offset negatif", "/api/complaints?offset=-1"], ["status tidak dikenal", "/api/complaints?status=BUKAN_STATUS"], ["ringkasan pemegang tidak valid", "/api/complaints/ringkasan?currentOwner=BUKAN_DIVISI"]]) {
  const r = await get(url); cek(`${nama} = 400 (bukan 500)`, r.status === 400, r.status); }
cek("izin: tanpa token 401; tanpa complaint:read 403 (daftar dan ringkasan)", (await get("/api/complaints?limit=1", null)).status === 401 && (await get("/api/complaints?limit=1", tX)).status === 403 && (await get("/api/complaints/ringkasan", tX)).status === 403);
// gerbang konfirmasi pelanggan tidak berubah: tidak ada jalan ke SELESAI selain /confirm-customer
const kBaru = baris.find((b) => b.status === "BARU");
const trans = await fetch(BASE + `/api/complaints/${kBaru.id}/status`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tP }, body: JSON.stringify({ status: "SELESAI" }) });
cek("gerbang konfirmasi pelanggan tetap: mengubah status langsung ke SELESAI DITOLAK (4xx) dan status kasus tidak berubah", (trans.status === 400 || trans.status === 409 || trans.status === 422) && (await num("select count(*)::int n from complaint_cases where id = $1::uuid and status::text = 'BARU'", kBaru.id)) === 1, trans.status);
const j2 = await jejak(); cek("setelah semua panggilan daftar/ringkasan: kasus, aktivitas, job, unit, order, jurnal, baris jurnal, stok TIDAK berubah dari kondisi sesudah data uji", sama(j2, j1), JSON.stringify(j2));

// ── G. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), BASE_GANDA: "0", ORDER_N: String(await num('select count(*)::int n from "Order"')), JOB_N: String(await num("select count(*)::int n from jobs")) } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
