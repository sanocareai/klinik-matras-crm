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
// SMOKE "TIDAK MENULIS" transisi satuan: hanya GET, pratinjau (baca-saja), dan POST terapkan yang DITOLAK sebelum menulis (401/403/400/409). Tidak ada satuan yang berubah, tidak ada pergerakan baru.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const penyetuju = info.find((x) => bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE) && bisa(x.rs, P.INVENTORY_WRITE))?.u;
const bukanPenyetuju = info.find((x) => !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u;
const http = async (method, url, token, body = null, header = {}) => { const r = await fetch(BASE + url, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...header }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; if (/json/.test(r.headers.get("content-type") ?? "")) { try { j = await r.json(); } catch { j = null; } } return { status: r.status, json: j }; };
const JEJAK = [["materials", "select count(*)::int n from materials"], ["transisi", "select count(*)::int n from material_unit_transitions"], ["tautan_so", "select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so'"], ["stock_movements", "select count(*)::int n from stock_movements"],
  ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["penyesuaian", "select count(*)::int n from stock_adjustment_requests"], ["goods_receipts", "select count(*)::int n from goods_receipts"], ["persediaan_awal", "select count(*)::int n from fin_inventory_openings"],
  ["satuan_master", "select md5(coalesce(string_agg(code || ':' || unit::text, ',' order by code), '')) n from materials"]];
const jejak = async () => { const o = {}; for (const [k, q] of JEJAK) { try { const r = (await prisma.$queryRawUnsafe(q))[0].n; o[k] = typeof r === "string" ? r : Number(r); } catch { o[k] = null; } } return o; };
const s0 = await jejak(); const BASE_PATH = "/api/inventory/materials";
rec("health 200", (await http("GET", "/api/health")).status === 200);
const strukturOk = (await hitung("select count(*)::int n from information_schema.columns where table_name = 'stock_movements' and column_name in ('unit_at_entry','unit_transition_id')")) === 2
  && (await hitung("select count(*)::int n from pg_trigger t where t.tgname in ('stock_movements_stamp_unit_trg','materials_unit_guard_trg','material_unit_transitions_append_only_trg') and not t.tgisinternal")) === 3;
rec("struktur migrasi ada: 2 kolom penanda satuan + 3 trigger (penanda satuan, pagar satuan master, dokumen append-only)", strukturOk);
const r1 = await http("POST", `${BASE_PATH}/transisi-satuan/terapkan`, null, { transisi: [] }, { "Idempotency-Key": "smoke-tsb-0001" }); rec("rute terapkan ada dan dijaga login: tanpa token = 401 (bukan 404)", r1.status === 401, `${r1.status}`);
const r1b = await http("POST", `${BASE_PATH}/transisi-satuan/pratinjau`, null, { transisi: [] }); rec("rute pratinjau dijaga login: tanpa token = 401", r1b.status === 401, `${r1b.status}`);
if (bukanPenyetuju) { const r2 = await http("POST", `${BASE_PATH}/transisi-satuan/terapkan`, await tokenUntuk(bukanPenyetuju), { transisi: [] }, { "Idempotency-Key": "smoke-tsb-0002" }); rec("akun tanpa inventory:adjustment_approve ditolak 403", r2.status === 403, `${r2.status}`); } else skip("akun bukan penyetuju ditolak", "tidak ada akun aktif tanpa inventory:adjustment_approve");
const contoh = (await prisma.$queryRawUnsafe("select m.id::text id, m.code, m.unit::text unit from materials m join stock_movements s on s.material_id = m.id where m.active group by m.id, m.code, m.unit order by count(*) desc limit 1"))[0];
if (penyetuju && contoh) {
  const t = await tokenUntuk(penyetuju);
  const lain = ["METER", "PCS", "KG"].find((u) => u !== contoh.unit);
  const pr = await http("POST", `${BASE_PATH}/transisi-satuan/pratinjau`, t, { transisi: [{ materialId: contoh.id, satuanBaru: lain, saldoBaru: 1 }] });
  rec("pratinjau (baca-saja) bahan nyata: 200, memuat hash 64 heksadesimal, satuan lama, saldo lama, pergerakan, dan penghalang", pr.status === 200 && /^[0-9a-f]{64}$/.test(pr.json?.transisi?.[0]?.hash ?? "") && pr.json.transisi[0].satuanLama === contoh.unit && typeof pr.json.transisi[0].saldoLama === "number" && Array.isArray(pr.json.transisi[0].penghalang), `${pr.status} ${contoh.code} ${contoh.unit}->${lain}`);
  const base = { transisi: [{ materialId: contoh.id, satuanBaru: lain, saldoBaru: 1, hashPratinjau: "0".repeat(64) }], sumber: "smoke rilis (tidak boleh menulis)", alasan: "Smoke rilis: permintaan ini harus ditolak sebelum menulis", rujukanHash: "smoke-tidak-menulis-0001" };
  const r3 = await http("POST", `${BASE_PATH}/transisi-satuan/terapkan`, t, base); rec("penyetuju tanpa Idempotency-Key ditolak 428, tidak menulis", r3.status === 428, `${r3.status}`);
  const r4 = await http("POST", `${BASE_PATH}/transisi-satuan/terapkan`, t, { ...base, transisi: [{ ...base.transisi[0], hashPratinjau: "bukan-hash" }] }, { "Idempotency-Key": "smoke-tsb-0004" }); rec("hash pratinjau tidak valid ditolak 400", r4.status === 400, `${r4.status}`);
  const r5 = await http("POST", `${BASE_PATH}/transisi-satuan/terapkan`, t, base, { "Idempotency-Key": "smoke-tsb-0005" }); rec("hash pratinjau berformat benar tetapi tidak cocok keadaan = 409 PRATINJAU_BERUBAH (atau ditolak penghalang), tidak menulis", r5.status === 409, `${r5.status} ${r5.json?.code}`);
  const rw = await http("GET", `${BASE_PATH}/${contoh.id}/riwayat-satuan`, t); rec("riwayat satuan (baca): 200 dengan periode per satuan dan pemeriksaan konsistensi", rw.status === 200 && Array.isArray(rw.json?.periode) && rw.json.konsisten === true && rw.json.satuanSekarang === contoh.unit, `${rw.status} konsisten=${rw.json?.konsisten}`);
  const mv = await http("GET", `/api/inventory/movements?materialId=${contoh.id}&limit=5`, t); rec("daftar pergerakan menyebut satuan saat dicatat (satuanCatat) pada setiap baris", mv.status === 200 && Array.isArray(mv.json) && mv.json.length > 0 && mv.json.every((x) => typeof x.satuanCatat === "string"), `${mv.status}`);
  const lap = await http("GET", "/api/inventory/nilai-persediaan", t); rec("laporan Nilai Persediaan tetap 200 dan memuat penanda transisi pada cakupan", lap.status === 200 && lap.json?.cakupan?.transisiSatuan && Number.isInteger(lap.json.cakupan.transisiSatuan.bahan), `${lap.status}`);
} else skip("pemeriksaan penyetuju", "tidak ada akun penyetuju + inventory:write atau tidak ada bahan berpergerakan");
const s1 = await jejak(); rec("SMOKE tidak menulis: master, satuan master, dokumen transisi, tautan SO, stok, harga, jurnal, penyesuaian, GR, persediaan awal — sama", Object.keys(s0).every((k) => s0[k] === s1[k]), JSON.stringify({ s0, s1 }));
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
