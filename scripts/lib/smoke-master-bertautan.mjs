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
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE "TIDAK MENULIS" master baru + tautan SO atomik: hanya GET dan POST yang DITOLAK sebelum menulis (tanpa token = 401, tanpa izin = 403, isi tidak valid = 400/428).
// TIDAK ada master yang dibuat dan tidak ada tautan yang dipasang: dibuktikan hitung baris sebelum vs sesudah.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const penyetuju = info.find((x) => bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE) && bisa(x.rs, P.INVENTORY_WRITE))?.u;
const bukanPenyetuju = info.find((x) => !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u;
const http = async (method, url, token, body = null, header = {}) => { const r = await fetch(BASE + url, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...header }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; if (/json/.test(r.headers.get("content-type") ?? "")) { try { j = await r.json(); } catch { j = null; } } return { status: r.status, json: j }; };
const JEJAK = [["materials", "select count(*)::int n from materials"], ["tautan_so", "select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so'"], ["stock_movements", "select count(*)::int n from stock_movements"],
  ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["penyesuaian", "select count(*)::int n from stock_adjustment_requests"], ["goods_receipts", "select count(*)::int n from goods_receipts"], ["persediaan_awal", "select count(*)::int n from fin_inventory_openings"]];
const jejak = async () => { const o = {}; for (const [k, q] of JEJAK) { try { o[k] = await hitung(q); } catch { o[k] = null; } } return o; };
const s0 = await jejak(); const RUTE = "/api/production/posting-historis/pengaman/master-bertautan";
const badan = { bahan: [{ code: "SMOKE-TIDAK-DIBUAT", name: "SMOKE TIDAK DIBUAT", unit: "PCS", category: "RAW_MATERIAL" }], soTanggal: "2026-11-04", sumber: "Smoke rilis (tidak boleh menulis)", alasan: "Smoke rilis: permintaan ini harus ditolak sebelum menulis", rujukanHash: "smoke-tidak-menulis-0001" };
rec("health 200", (await http("GET", "/api/health")).status === 200);
const r1 = await http("POST", RUTE, null, badan, { "Idempotency-Key": "smoke-mba-0001" }); rec("rute master-bertautan ada dan dijaga login: tanpa token = 401 (bukan 404)", r1.status === 401, `${r1.status}`);
if (bukanPenyetuju) { const r2 = await http("POST", RUTE, await tokenUntuk(bukanPenyetuju), badan, { "Idempotency-Key": "smoke-mba-0002" }); rec("akun tanpa inventory:adjustment_approve ditolak 403", r2.status === 403, `${r2.status}`); } else skip("akun bukan penyetuju ditolak", "tidak ada akun aktif tanpa inventory:adjustment_approve");
if (penyetuju) {
  const t = await tokenUntuk(penyetuju);
  const r3 = await http("POST", RUTE, t, badan); rec("penyetuju tanpa Idempotency-Key ditolak 428, tidak menulis", r3.status === 428, `${r3.status}`);
  const r4 = await http("POST", RUTE, t, { ...badan, bahan: [] }, { "Idempotency-Key": "smoke-mba-0004" }); rec("penyetuju dengan daftar bahan kosong ditolak 400 (validasi sebelum transaksi)", r4.status === 400, `${r4.status} ${JSON.stringify(r4.json)}`);
  const r5 = await http("POST", RUTE, t, { ...badan, bahan: [{ ...badan.bahan[0], unit: "TIDAK-ADA" }] }, { "Idempotency-Key": "smoke-mba-0005" }); rec("satuan tidak valid ditolak 400", r5.status === 400, `${r5.status}`);
  const r6 = await http("POST", RUTE, t, { ...badan, soTanggal: "2099-01-01" }, { "Idempotency-Key": "smoke-mba-0006" }); rec("tanggal SO masa depan ditolak 400", r6.status === 400, `${r6.status}`);
  const dp = await http("GET", "/api/production/posting-historis/pengaman", t); rec("daftar pengaman (baca) 200 dengan tautan aktif dan angka tertahan", dp.status === 200 && Array.isArray(dp.json?.tautan) && dp.json.tautan.length >= 1 && Number.isInteger(dp.json.tertahan) && dp.json.tertahan >= 1, `${dp.status} tautan=${dp.json?.tautan?.length} tertahan=${dp.json?.tertahan}`);
  rec("pengaman historis tidak memuat pernyataan TERCERMIN/BELUM_TERCERMIN yang tidak dibuat Owner (tercermin = 0)", dp.json?.tercermin === 0, `tercermin=${dp.json?.tercermin} dilepas=${dp.json?.dilepas}`);
} else skip("pemeriksaan penyetuju", "tidak ada akun aktif dengan inventory:adjustment_approve + inventory:write");
rec("tidak ada master SMOKE yang dibuat", (await hitung("select count(*)::int n from materials where code = 'SMOKE-TIDAK-DIBUAT'")) === 0);
const s1 = await jejak(); rec("SMOKE tidak menulis: master, tautan SO, stok, harga, jurnal, penyesuaian, GR, persediaan awal — jumlah baris sama", Object.keys(s0).every((k) => s0[k] === s1[k]), JSON.stringify({ s0, s1 }));
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
