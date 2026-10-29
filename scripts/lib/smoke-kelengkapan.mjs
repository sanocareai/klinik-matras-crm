import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000"; // SMOKE_BASE/REH_SRC hanya untuk uji lokal skrip ini
const imp = (p) => import(process.env.REH_SRC ? pathToFileURL(path.join(process.env.REH_SRC, p)).href : "/app/src/" + p);
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const { ROLE_PERMISSIONS } = await imp("constants/permissions.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function userDengan(rolesAda, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if ([...rolesAda].some((r) => rs.has(r)) && ![...rs].some((r) => tanpa.has(r))) return u; }
  return null;
}
const admin = await userDengan(["ADMIN", "OWNER"], new Set());
const sales = await userDengan(["SALES"], new Set(["ADMIN", "OWNER", "FINANCE", "WAREHOUSE", "PRODUCTION_LEAD"]));
if (!admin) { rec("akun ADMIN/OWNER tersedia", false); process.exit(1); }
const tA = await tokenUntuk(admin); const tS = sales ? await tokenUntuk(sales) : null;
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const get = async (p, token) => { const t0 = Date.now(); const r = await fetch(BASE + p, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j, ms: Date.now() - t0 }; };
const post = async (p, token, body = {}, headers = {}) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...headers }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const TABEL = ["stock_movements", "material_issues", "material_issue_lines", "fin_journal_entries", "fin_journal_lines", "material_harga_berlaku", "stock_movement_biaya_operasional", "production_unit_schedules", "production_unit_schedule_events", "production_runs_v2", "unit_provisional_usages", "unit_material_declarations", "units", "Order"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const sebelum = await fp();
const evt0 = await hitung("select count(*) as n from activity_events");

rec("tabel pernyataan ada dan KOSONG (tidak ada pernyataan massal/backfill saat rilis)", (await hitung("select count(*) as n from unit_material_declarations")) === 0);
rec("izin kode berjalan: pernyataan memakai izin Rute Unit (Admin/Owner/Kepala Produksi), bukan Sales", (ROLE_PERMISSIONS.ADMIN ?? []).includes("unit:routing:write") && !(ROLE_PERMISSIONS.SALES ?? []).includes("unit:routing:write"));
// tanpa token
for (const [m, p] of [["GET", "/api/production/work-orders/kelengkapan-hitung"], ["GET", "/api/production/work-orders?kelengkapan=BAHAN_BELUM_DICATAT"], ["GET", "/api/production/units/00000000-0000-4000-8000-000000000000/pernyataan-tanpa-bahan"]]) rec(`${m} ${p.split("?")[0]} tanpa token = 401`, (await get(p)).status === 401);
rec("POST pernyataan tanpa token = 401", (await post("/api/production/units/00000000-0000-4000-8000-000000000000/pernyataan-tanpa-bahan", null, { alasan: "tanpa token" }, { "Idempotency-Key": "smoke-tanpa-token-0001" })).status === 401);
// hitungan + konsistensi dengan daftar
const AKTIF = "displayStatus=PENGAMBILAN,DIPROSES,SIAP_KIRIM";
const h = await get(`/api/production/work-orders/kelengkapan-hitung?${AKTIF}`, tA);
rec(`hitungan kelengkapan (Aktif) terbaca dalam ${h.ms} ms`, h.status === 200 && !!h.json?.counts && Number.isInteger(h.json.unik) && !!h.json.dataOrder, `unik=${h.json?.unik} counts=${JSON.stringify(h.json?.counts)}`);
if (h.status === 200) {
  let sama = true; for (const k of ["BAHAN_BELUM_DICATAT", "BAHAN_PERLU_DICEK", "HPP_BELUM_LENGKAP", "DATA_ORDER_KURANG"]) { const l = await get(`/api/production/work-orders?${AKTIF}&kelengkapan=${k}&pageSize=1`, tA); if (l.status !== 200 || l.json.total !== h.json.counts[k]) { sama = false; console.log(`        ${k}: daftar=${l.json?.total} hitung=${h.json.counts[k]}`); } }
  rec("total filter di daftar = hitungan server untuk setiap kategori", sama);
  const g = await get(`/api/production/work-orders?${AKTIF}&kelengkapan=BAHAN_BELUM_DICATAT,BAHAN_PERLU_DICEK,HPP_BELUM_LENGKAP,DATA_ORDER_KURANG&pageSize=50&urut=terlama`, tA);
  rec(`filter gabungan + urut terlama dalam ${g.ms} ms: total = unit unik (${h.json.unik}), halaman ≤ 50`, g.status === 200 && g.json.total === h.json.unik && g.json.units.length <= 50);
  const satu = g.json?.units?.[0];
  if (satu) { const d = await get(`/api/production/units/${satu.id}/adopsi`, tA); rec("drawer unit memuat klasifikasi yang SAMA dengan daftar + pernyataan (kosong)", d.status === 200 && JSON.stringify(d.json.adopsi.kelengkapan.keys) === JSON.stringify(satu.adopsi.kelengkapan.keys) && d.json.pernyataanTanpaBahan?.aktif === null && d.json.izin?.pernyataanTanpaBahan === true); }
  else skip("drawer unit", "tidak ada unit berkekurangan pada lingkup Aktif");
  const x = await fetch(BASE + `/api/production/work-orders/export.xlsx?${AKTIF}&kelengkapan=HPP_BELUM_LENGKAP`, { headers: { Authorization: "Bearer " + tA } }); const b = Buffer.from(await x.arrayBuffer());
  rec(`ekspor Excel dengan filter kelengkapan terunduh (${b.length} byte, berkas xlsx)`, x.status === 200 && b.length > 1000 && b.slice(0, 2).toString() === "PK");
}
rec("periode terbalik ditolak 400 (bukan diabaikan)", (await get("/api/production/work-orders?dari=2026-10-10&sampai=2026-10-01", tA)).status === 400);
// penulisan: ditolak SEBELUM menyentuh data
const unitContoh = (await get("/api/production/work-orders?pageSize=1", tA)).json?.units?.[0];
if (unitContoh) {
  rec("POST pernyataan tanpa Idempotency-Key = 400 (ditolak sebelum menulis)", (await post(`/api/production/units/${unitContoh.id}/pernyataan-tanpa-bahan`, tA, { alasan: "Smoke: tanpa kunci idempotensi" })).status === 400);
  rec("POST pernyataan dengan alasan terlalu pendek = 400 (ditolak sebelum menulis)", (await post(`/api/production/units/${unitContoh.id}/pernyataan-tanpa-bahan`, tA, { alasan: "ok" }, { "Idempotency-Key": "smoke-alasan-pendek-0001" })).status === 400);
  if (tS) rec("POST pernyataan oleh Sales = 403 (izin)", (await post(`/api/production/units/${unitContoh.id}/pernyataan-tanpa-bahan`, tS, { alasan: "Smoke: Sales mencoba menyatakan" }, { "Idempotency-Key": "smoke-sales-tolak-0001" })).status === 403);
  else skip("POST pernyataan oleh Sales = 403", "tidak ada akun Sales murni");
  rec("POST cabut tanpa pernyataan aktif = 404 (tidak menulis)", (await post(`/api/production/units/${unitContoh.id}/pernyataan-tanpa-bahan/cabut`, tA, { alasan: "Smoke: cabut tanpa pernyataan" })).status === 404);
} else skip("pengujian penulisan yang ditolak", "tidak ada unit");
// invarian: tidak ada jejak tulis
const sesudah = await fp(); const beda = Object.keys(sebelum).filter((t) => sebelum[t].n !== sesudah[t].n || sebelum[t].h !== sesudah[t].h);
rec("tidak ada jejak tulis: stok, Material Issue, jurnal, harga, biaya operasional, jadwal/Run, pemakaian sementara, pernyataan, unit, order IDENTIK", beda.length === 0, beda.join(","));
rec("tidak ada peristiwa audit baru dari smoke", (await hitung("select count(*) as n from activity_events")) === evt0);
console.log(`\nSMOKE: gagal=${fail} dilewati=${dilewati}`);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
