import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA: HPP pada pencatatan bahan Produksi. (1) GET /api/production/material-catalog membawa Harga Berlaku (HPP operasional) per bahan HANYA untuk peran berizin (finance:read atau unit_material:write);
// (2) GET /api/production/units/:id/adopsi membawa HPP BEKU per baris pemakaian. Kebenaran = invarian atas data nyata terhadap TABEL (bukan angka tetap): harga katalog = baris Harga Berlaku terbaru yang sudah berlaku
// dan belum dikoreksi; bahan tanpa harga = null (bukan 0); nilai beku = tabel biaya operasional. Tidak ada tulisan dan tidak ada data percobaan.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const berizin = info.find((x) => bisa(x.rs, P.UNIT_READ) && (bisa(x.rs, P.FINANCE_READ) || bisa(x.rs, P.UNIT_MATERIAL_WRITE)))?.u;
const tanpaIzin = info.find((x) => bisa(x.rs, P.UNIT_READ) && !bisa(x.rs, P.FINANCE_READ) && !bisa(x.rs, P.UNIT_MATERIAL_WRITE))?.u;
if (!berizin) { rec("akun dengan unit:read + (finance:read atau unit_material:write) tersedia", false); process.exit(1); }
const tok = await tokenUntuk(berizin);
const get = async (url, token = tok) => { const r = await fetch(BASE + url, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; if (/json/.test(r.headers.get("content-type") ?? "")) { try { j = await r.json(); } catch { /* bukan JSON */ } } else await r.arrayBuffer(); return { status: r.status, json: j }; };
const JEJAK = [["stock_movements", "select count(*)::int n from stock_movements"], ["biaya_beku", "select count(*)::int n from stock_movement_biaya_operasional"], ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["material_issues", "select count(*)::int n from material_issues"],
  ["jurnal", "select count(*)::int n from fin_journal_entries"], ["units", "select count(*)::int n from units"], ["pernyataan", "select count(*)::int n from unit_material_declarations"], ["runs", "select count(*)::int n from production_runs_v2"]];
const jejak = async () => Object.fromEntries(await Promise.all(JEJAK.map(async ([k, q]) => [k, await hitung(q)])));
const s0 = await jejak();
const C = "/api/production/material-catalog";
// harga berlaku SEKARANG menurut tabel: baris terbaru dengan effective_from <= now yang belum digantikan koreksi
const hargaTabel = async (materialId) => { const r = await prisma.$queryRawUnsafe(`select h.unit_price::float p from material_harga_berlaku h where h.material_id = $1::uuid and h.effective_from <= now() and not exists (select 1 from material_harga_berlaku k where k.corrects_id = h.id) order by h.effective_from desc, h.created_at desc, h.id desc limit 1`, materialId); return r.length ? r[0].p : null; };

// ── izin ──
rec("katalog tanpa token = 401", (await get(`${C}?limit=5`, null)).status === 401);
rec("adopsi unit tanpa token = 401", (await get(`/api/production/units/00000000-0000-4000-8000-000000000000/adopsi`, null)).status === 401);

// ── katalog: harga = tabel ──
const k = await get(`${C}?limit=300`);
rec("katalog 200 untuk peran berizin; izinHarga=true; tiap baris punya kunci harga", k.status === 200 && k.json.izinHarga === true && k.json.rows.every((r) => "harga" in r && r.harga !== undefined), `${k.status} ${k.json?.rows?.length} baris`);
const adaHarga = k.json.rows.filter((r) => r.harga?.harga != null); const tanpaHarga = k.json.rows.filter((r) => r.harga && r.harga.harga == null);
console.log(`  INFO  katalog: ${k.json.rows.length} bahan; berharga ${adaHarga.length}; tanpa Harga Berlaku ${tanpaHarga.length}`);
let salah = 0; for (const r of adaHarga.slice(0, 60)) { const t = await hargaTabel(r.materialId); if (t === null || Math.abs(t - r.harga.harga) > 0.00005) salah++; }
if (adaHarga.length) rec(`harga katalog = Harga Berlaku terbaru menurut tabel (${Math.min(60, adaHarga.length)} bahan diperiksa)`, salah === 0, `${salah} berbeda`); else skip("harga katalog = tabel", "tidak ada bahan berharga pada katalog ini");
let palsu = 0; for (const r of tanpaHarga.slice(0, 60)) { if ((await hargaTabel(r.materialId)) !== null) palsu++; }
rec("bahan tanpa harga di katalog benar-benar belum punya Harga Berlaku (null, bukan 0)", palsu === 0 && tanpaHarga.every((r) => r.harga.harga === null), `${palsu} keliru`);
rec("tidak ada harga 0 atau negatif yang dikirim sebagai harga berlaku", adaHarga.every((r) => r.harga.harga > 0), adaHarga.filter((r) => !(r.harga.harga > 0)).map((r) => r.kode).join(","));
const b = adaHarga[0]; if (b) { const cari = await get(`${C}?q=${encodeURIComponent(b.kode)}&limit=5`); rec("pencarian kode tetap membawa harga yang sama", cari.status === 200 && cari.json.rows.some((r) => r.materialId === b.materialId && r.harga.harga === b.harga.harga)); }
// ── tanpa izin ──
if (tanpaIzin) { const kx = await get(`${C}?limit=300`, await tokenUntuk(tanpaIzin)); rec("peran tanpa izin harga: katalog 200, izinHarga=false, semua harga null", kx.status === 200 && kx.json.izinHarga === false && kx.json.rows.every((r) => r.harga === null), `${kx.status}`); } else skip("peran tanpa izin harga", "semua akun aktif berizin harga");

// ── HPP beku per baris pemakaian = tabel biaya operasional ──
const unit = (await prisma.$queryRawUnsafe(`select distinct b.unit_id::text id from stock_movement_biaya_operasional b where b.status = 'DINILAI' and b.value is not null order by 1 limit 1`))[0];
if (unit) {
  const a = await get(`/api/production/units/${unit.id}/adopsi`); const baris = a.json?.pemakaianAktual?.baris ?? [];
  rec("adopsi unit berpemakaian berharga: 200 dan baris pemakaian membawa hppBeku", a.status === 200 && baris.length > 0 && baris.every((r) => r.hppBeku && typeof r.hppBeku.status === "string"), `${a.status} ${baris.length} baris`);
  let beda = 0; let diperiksa = 0; for (const r of baris.filter((x) => x.hppBeku.status === "DINILAI").slice(0, 40)) { const t = (await prisma.$queryRawUnsafe(`select value::float v, unit_cost::float c from stock_movement_biaya_operasional where movement_id = $1::uuid order by created_at desc, id desc limit 1`, r.id))[0]; diperiksa++; if (!t || Math.abs(t.v - r.hppBeku.nilai) > 0.005 || Math.abs(t.c - r.hppBeku.harga) > 0.00005) beda++; }
  rec(`nilai dan harga beku di baris = tabel biaya operasional (${diperiksa} baris diperiksa)`, diperiksa > 0 && beda === 0, `${beda} berbeda`);
  if (tanpaIzin) { const ax = await get(`/api/production/units/${unit.id}/adopsi`, await tokenUntuk(tanpaIzin)); const bx = ax.json?.pemakaianAktual?.baris ?? []; rec("peran tanpa izin: hppBeku tanpa nominal (null) dan ditandai tersembunyi", ax.status === 200 && bx.filter((r) => r.hppBeku.status === "DINILAI").every((r) => r.hppBeku.nilai === null && r.hppBeku.harga === null && r.hppBeku.hargaTersembunyi === true)); } else skip("hppBeku tanpa izin", "semua akun aktif berizin harga");
} else skip("HPP beku per baris", "belum ada pemakaian berharga beku pada data ini");
const unitTanpa = (await prisma.$queryRawUnsafe(`select distinct b.unit_id::text id from stock_movement_biaya_operasional b where b.status <> 'DINILAI' order by 1 limit 1`))[0];
if (unitTanpa) { const a = await get(`/api/production/units/${unitTanpa.id}/adopsi`); const x = (a.json?.pemakaianAktual?.baris ?? []).filter((r) => r.hppBeku.status !== "DINILAI"); rec("pemakaian tanpa harga saat dicatat: hppBeku berstatus apa adanya, nilai null (bukan 0)", a.status === 200 && x.length > 0 && x.every((r) => r.hppBeku.nilai === null && r.hppBeku.harga === null), `${x.length} baris`); } else skip("pemakaian tanpa harga", "tidak ada pemakaian tanpa harga beku pada data ini");

// ── tanpa jejak tulis ──
const s1 = await jejak(); const turun = Object.keys(s0).filter((kk) => s1[kk] < s0[kk]);
rec("TIDAK ada jejak tulis destruktif: stok, biaya beku, harga berlaku, Material Issue, jurnal, unit, pernyataan, run tidak berkurang selama smoke", turun.length === 0, turun.map((kk) => `${kk}:${s0[kk]}→${s1[kk]}`).join(" "));
const naik = Object.keys(s0).filter((kk) => s1[kk] > s0[kk]); if (naik.length) console.log("  (info: bertambah selama smoke karena pengguna lain/aplikasi hidup — smoke ini hanya GET: " + naik.map((kk) => `${kk}:${s0[kk]}→${s1[kk]}`).join(" ") + ")");
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
