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
// SMOKE "TIDAK MENULIS" kandidat gabungan (pembaca satuan asal, referensi Agustus, pengaman pra-SO, biaya): hanya GET dan pratinjau (baca-saja). Tidak ada tulisan; dibuktikan hitung baris sebelum vs sesudah.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pembaca = info.find((x) => bisa(x.rs, P.INVENTORY_READ))?.u;
const pengelola = info.find((x) => bisa(x.rs, P.UNIT_MATERIAL_WRITE) && bisa(x.rs, P.UNIT_READ))?.u;
const http = async (method, url, token, body = null, header = {}) => { const r = await fetch(BASE + url, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...header }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; if (/json/.test(r.headers.get("content-type") ?? "")) { try { j = await r.json(); } catch { j = null; } } return { status: r.status, json: j }; };
const JEJAK = [["materials", "select count(*)::int n from materials"], ["transisi", "select count(*)::int n from material_unit_transitions"], ["tautan_so", "select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so'"], ["stock_movements", "select count(*)::int n from stock_movements"],
  ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["valuasi", "select count(*)::int n from fin_stock_movement_valuations"], ["penyesuaian", "select count(*)::int n from stock_adjustment_requests"], ["koreksi", "select count(*)::int n from warehouse_corrections"],
  ["goods_receipts", "select count(*)::int n from goods_receipts"], ["persediaan_awal", "select count(*)::int n from fin_inventory_openings"], ["satuan_master", "select md5(coalesce(string_agg(code || ':' || unit::text, ',' order by code), '')) n from materials"]];
const jejak = async () => { const o = {}; for (const [k, q] of JEJAK) { try { const r = (await prisma.$queryRawUnsafe(q))[0].n; o[k] = typeof r === "string" ? r : Number(r); } catch { o[k] = null; } } return o; };
const s0 = await jejak();
rec("health 200", (await http("GET", "/api/health")).status === 200);
rec("modul referensi satuan terpasang di kode baru (referensiHargaSatuan.js)", await import(pathToFileURL(path.join(APP, "src/services/referensiHargaSatuan.js")).href).then((m) => typeof m.referensiTidakCocok === "function", () => false));
if (pembaca) {
  const t = await tokenUntuk(pembaca);
  // referensi Agustus: bahan tanpa transisi = nilai master apa adanya; bahan bertransisi (satuan berganti dari satuan referensi) = null + penanda
  const st = await http("GET", "/api/inventory/stock", t); const baris = Array.isArray(st.json) ? st.json : (st.json?.items ?? st.json?.rows ?? []);
  const master = new Map((await prisma.$queryRawUnsafe("select id::text id, reference_unit_cost::text rc from materials")).map((r) => [r.id, r.rc]));
  const { referensiTidakCocok } = await import(pathToFileURL(path.join(APP, "src/services/referensiHargaSatuan.js")).href); const tdk = await referensiTidakCocok(prisma);
  const tidakSesuai = (r) => { if (tdk.has(r.materialId)) return !(r.referenceUnitCost === null && r.referensiTidakCocok); const rc = master.get(r.materialId) ?? null; const v = r.referenceUnitCost ?? null; if (r.referensiTidakCocok !== undefined) return true; if (v === null || rc === null) return v !== rc; return Math.abs(Number(v) - Number(rc)) > 1e-6; };
  const salah = baris.filter(tidakSesuai).length;
  rec("GET /inventory/stock: referensi Agustus = nilai master untuk bahan tanpa transisi; null + penanda untuk bahan bertransisi", st.status === 200 && baris.length > 0 && salah === 0, `${st.status} baris=${baris.length} salah=${salah} bertransisi=${tdk.size}`);
  const contoh = (await prisma.$queryRawUnsafe("select m.id::text id from materials m join stock_movements s on s.material_id = m.id where m.active group by m.id order by count(*) desc limit 1"))[0];
  if (contoh) { const mv = await http("GET", `/api/inventory/movements?materialId=${contoh.id}&limit=5`, t); rec("daftar pergerakan menyebut satuan saat dicatat (satuanCatat) pada setiap baris", mv.status === 200 && Array.isArray(mv.json) && mv.json.length > 0 && mv.json.every((x) => typeof x.satuanCatat === "string"), `${mv.status}`); }
  const lap = await http("GET", "/api/inventory/nilai-persediaan", t); rec("laporan Nilai Persediaan tetap 200", lap.status === 200 && Array.isArray(lap.json?.baris), `${lap.status}`);
  const trf = (await prisma.$queryRawUnsafe("select t.id::text id from stock_transfers t where t.status::text = 'COMPLETED' order by t.created_at desc limit 1"))[0];
  if (trf) { const d = await http("GET", `/api/inventory/transfers/${trf.id}`, t); rec("detail transfer selesai (perjalanan saldo + selisih) tetap 200", d.status === 200, `${d.status}`); } else skip("detail transfer selesai", "tidak ada transfer selesai");
} else skip("pemeriksaan pembaca", "tidak ada akun aktif dengan inventory:read");
// pengaman pra-SO pada PRATINJAU (baca-saja): tanggal SO ditahan, tanggal sesudah SO tidak
if (pengelola) {
  const t = await tokenUntuk(pengelola);
  const pg = await http("GET", "/api/production/posting-historis/pengaman", t); const tautan = pg.json?.tautan ?? [];
  const sasaran = tautan[0];
  if (pg.status === 200 && sasaran) {
    const unit = (await prisma.$queryRawUnsafe("select u.id::text id from units u where u.status::text = 'DELIVERED' and (u.created_at at time zone 'Asia/Jakarta')::date < $1::date order by u.created_at desc limit 1", sasaran.soTanggal))[0];
    if (unit) {
      const pra = (tgl, jenis = "TAMBAH") => http("POST", `/api/production/units/${unit.id}/pembetulan-bahan/pratinjau`, t, { materialId: sasaran.materialId, jenis, qty: 1, tanggalPemakaian: tgl });
      const a = await pra(sasaran.soTanggal); rec("pratinjau pemakaian bertanggal SO pada bahan bertautan SO: PEMAKAIAN_PRA_SO", a.status === 200 && (a.json?.penghalang ?? []).some((x) => x.kode === "PEMAKAIAN_PRA_SO"), `${a.status} ${(a.json?.penghalang ?? []).map((x) => x.kode).join(",")}`);
      const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); const sesudah = hariIni > sasaran.soTanggal ? await pra(hariIni) : null;
      if (sesudah) rec("pratinjau pemakaian bertanggal SESUDAH SO tidak ditahan oleh PEMAKAIAN_PRA_SO", sesudah.status === 200 && !(sesudah.json?.penghalang ?? []).some((x) => x.kode === "PEMAKAIAN_PRA_SO"), `${sesudah.status}`); else skip("pratinjau sesudah SO", "tanggal SO = hari ini");
      const k = await pra(sasaran.soTanggal, "KURANGI"); rec("pratinjau pengurangan/retur pada tanggal SO tidak ditahan oleh PEMAKAIAN_PRA_SO", k.status === 200 && !(k.json?.penghalang ?? []).some((x) => x.kode === "PEMAKAIAN_PRA_SO"), `${k.status}`);
    } else skip("pengaman pra-SO pada pratinjau", "tidak ada unit TERKIRIM yang dibuat sebelum tanggal SO");
  } else skip("pengaman pra-SO pada pratinjau", `tidak ada tautan SO aktif (status ${pg.status})`);
} else skip("pengaman pra-SO pada pratinjau", "tidak ada akun pengelola (unit_material:write + unit:read)");
const s1 = await jejak(); rec("SMOKE tidak menulis: master, satuan master, transisi, tautan SO, stok, harga, jurnal, valuasi, penyesuaian, koreksi, GR, persediaan awal — sama", Object.keys(s0).every((k) => s0[k] === s1[k]), JSON.stringify({ s0, s1 }));
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
