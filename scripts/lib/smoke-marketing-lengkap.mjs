import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE "TIDAK MENULIS" laporan Marketing: hanya GET /api/atribusi/iklan/sumber (ADMIN). Fungsi periksaLaporan/banding/petaSql/SQL_BANDING disisipkan generator dari scripts/lib/invarian-marketing-lengkap.mjs.
// Kebenaran = hubungan antar-angka laporan + kecocokan dengan SQL independen pada rentang hari PENUH (berakhir kemarin, WIB), bukan angka tetap. Hitung baris tabel inti sebelum vs sesudah harus identik.
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const admin = info.find((x) => x.rs.has("ADMIN"))?.u; const bukanAdmin = info.find((x) => !x.rs.has("ADMIN"))?.u;
if (!admin) { rec("akun aktif berperan ADMIN tersedia", false); console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`); process.exit(1); }
const http = async (url, token) => { const r = await fetch(BASE + url, { method: "GET", headers: token ? { Authorization: "Bearer " + token } : {} }); let json = null; try { json = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json }; };
const JEJAK = [["customer", 'select count(*)::int n from "Customer"'], ["order", 'select count(*)::int n from "Order"'], ["payments", "select count(*)::int n from payments"], ["kredit_order", "select count(*)::int n from fin_order_credits"], ["refund", "select count(*)::int n from fin_refunds"],
  ["transisi", "select count(*)::int n from pipeline_transitions"], ["touch", "select count(*)::int n from attribution_touches"], ["spend_ad", "select count(*)::int n from meta_ad_daily_spend"], ["impor_spend", "select count(*)::int n from meta_spend_imports"],
  ["biaya_sumber", "select count(*)::int n from ad_source_spend_entries"], ["biaya_sumber_revisi", "select count(*)::int n from ad_source_spend_revisions"]];
const jejak = async () => { const o = {}; for (const [k, q] of JEJAK) { try { o[k] = await hitung(q); } catch { o[k] = null; } } return o; };
const s0 = await jejak(); const URL_API = "/api/atribusi/iklan/sumber"; const tA = await tokenUntuk(admin);

rec("tanpa token = 401", (await http(URL_API)).status === 401);
if (bukanAdmin) rec("akun bukan ADMIN = 403 (hanya ADMIN)", (await http(URL_API, await tokenUntuk(bukanAdmin))).status === 403); else skip("akun bukan ADMIN = 403", "tidak ada akun aktif non-ADMIN");
const bad = await http(`${URL_API}?dari=2026-13-45&sampai=2026-11-01`, tA); rec("tanggal tidak valid ditolak 400 (bukan 500)", bad.status === 400, `${bad.status}`);

// ── rentang hari PENUH: 30 hari berakhir kemarin (WIB) ──
const geser = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); const sampai = geser(hariIni, -1); const dari = geser(sampai, -29);
const naive = (ymd) => new Date(Date.parse(`${ymd}T00:00:00+07:00`)).toISOString().replace("T", " ").slice(0, 19); // WIB 00:00 -> UTC tanpa zona (kolom Customer.createdAt = timestamp UTC naif)
const awal = naive(dari), akhir = naive(geser(sampai, 1)); // batas akhir EKSKLUSIF
let r = await http(`${URL_API}?dari=${dari}&sampai=${sampai}`, tA); let d = r.json;
rec("rentang 30 hari penuh: 200 dan periode sesuai permintaan", r.status === 200 && d?.periode?.dari === dari && d?.periode?.sampai === sampai && d?.periode?.termasukHariBerjalan === false, `${r.status} ${JSON.stringify(d?.periode)}`);
if (r.status !== 200) { console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`); process.exit(1); }
for (const x of periksaLaporan(d)) rec(x.n, x.ok, x.d);
// SQL independen pada data yang sama (coba ulang bila ada perubahan di antara dua pembacaan: stage/transisi bisa bergeser)
let bd = null; for (let i = 0; i < 3; i++) { const sql = petaSql(await prisma.$queryRawUnsafe(SQL_BANDING, awal, akhir)); bd = banding(d, sql); if (bd.every((x) => x.ok)) break; await new Promise((ok) => setTimeout(ok, 1500)); r = await http(`${URL_API}?dari=${dari}&sampai=${sampai}`, tA); d = r.json; }
for (const x of bd) rec(x.n, x.ok, x.d);
// bawaan (tanpa parameter) = 30 hari penuh berakhir kemarin; pembanding = periode sebelumnya
const bw = await http(URL_API, tA); rec("tanpa parameter: 200, periode bawaan = 30 hari penuh berakhir kemarin (WIB)", bw.status === 200 && bw.json?.periode?.bawaan === true && bw.json?.periode?.sampai === sampai && bw.json?.periode?.dari === dari, `${bw.status} ${JSON.stringify(bw.json?.periode)}`);
const pb = await http(`${URL_API}?dari=${dari}&sampai=${sampai}&pembanding=1`, tA); rec("pembanding=1: periode sebelumnya sepanjang sama dan memuat tujuh sumber", pb.status === 200 && pb.json?.pembanding?.sumber?.length === 7 && pb.json?.pembanding?.periode?.sampai === geser(dari, -1), `${pb.status} ${JSON.stringify(pb.json?.pembanding?.periode)}`);
// rentang yang memuat hari berjalan: hari berjalan parsial → biaya per hasil harus kosong (pengaman existing)
const hb = await http(`${URL_API}?dari=${geser(hariIni, -3)}&sampai=${hariIni}`, tA);
rec("rentang termasuk hari berjalan: 200, ditandai berjalan, rasio biaya per sumber berbayar kosong", hb.status === 200 && hb.json?.periode?.termasukHariBerjalan === true && (hb.json?.sumber ?? []).filter((x) => x.jenis === "IKLAN").every((x) => ["cpl", "cpa", "costPerProspekEksplisit", "bookedRoas", "cashRoas"].every((k) => x.biaya?.[k] === null || x.biaya?.[k] === undefined)), `${hb.status}`);
const s1 = await jejak(); rec("laporan hanya membaca: tabel spend Meta, impor spend, dan biaya per sumber (beserta revisi) TIDAK berubah akibat smoke; tabel bisnis dihitung dan dicatat (boleh bergeser oleh aktivitas normal)", Object.values(s0).every((v) => v !== null) && ["biaya_sumber", "biaya_sumber_revisi", "spend_ad", "impor_spend"].every((k) => s1[k] === s0[k]), JSON.stringify({ s0, s1 }).slice(0, 230));
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
