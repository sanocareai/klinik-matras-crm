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
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-transisi-satuan.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji transisi satuan hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "transisi satuan bahan": kode BARU berjalan sebagai SERVER sungguhan (index.js, port 4103, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production yang SUDAH dimigrasi.
// Bagian A = kode SMOKE yang sama dengan fase 8b (tidak menulis). Bagian B MENULIS — HANYA pada salinan restore (DB rehearsal_*, dibuang sesudahnya, dijaga di atas): transisi pada DATA NYATA (bahan, saldo, riwayat, catatan,
// PO/GR/harga asli): atomik, hash pratinjau, pengaman historis, riwayat per satuan, harga lama tidak dibawa, tanpa ISSUE/jurnal/valuasi/posting.
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
const penyetuju = infoU.find((x) => bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE) && bisa(x.rs, P.INVENTORY_WRITE))?.u ?? await prisma.user.create({ data: { name: "REH Penyetuju", email: `reh-tsb-a-${stamp}@example.test`, passwordHash: "x", role: "OWNER" } });
const bukan = infoU.find((x) => !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u ?? await prisma.user.create({ data: { name: "REH Gudang", email: `reh-tsb-g-${stamp}@example.test`, passwordHash: "x", role: "WAREHOUSE" } });
const tA = await token(penyetuju); const tB = await token(bukan);
const TABEL = [["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["valuasi", "select count(*)::int n from fin_stock_movement_valuations"], ["penyesuaian", "select count(*)::int n from stock_adjustment_requests"],
  ["goods_receipts", "select count(*)::int n from goods_receipts"], ["gr_lines", "select count(*)::int n from goods_receipt_lines"], ["po_lines", "select count(*)::int n from fin_purchase_order_lines"], ["persediaan_awal", "select count(*)::int n from fin_inventory_openings"], ["hasil_so", "select count(*)::int n from activity_events where entity_type = 'hasil_so_bahan'"],
  ["pernyataan", "select count(*)::int n from activity_events where event_type = 'SO_HISTORIS_DINYATAKAN'"], ["issue", "select count(*)::int n from stock_movements where type::text = 'ISSUE'"], ["catatan_diposting", "select count(*)::int n from unit_usage_notes where state::text = 'DIPOSTING'"]];
const jejak = async () => Object.fromEntries(await Promise.all(TABEL.map(async ([k, q]) => [k, await num(q)])));
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
const j0 = await jejak();

// ── A. SMOKE pasca-switch (kode yang sama dengan fase 8b) terhadap server rehearsal ──
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP|INFO)/.test(l)).join("\n"));
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));

// ── B. TRANSISI pada data nyata (salinan restore) ──
const http = async (method, url, tok, body = null, header = {}) => { const r = await fetch(BASE + url, { method, headers: { Authorization: "Bearer " + tok, ...(body ? { "Content-Type": "application/json" } : {}), ...header }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { j = null; } return { status: r.status, json: j }; };
const kodeAda = async (kode) => (await prisma.$queryRawUnsafe("select id::text id, code, unit::text unit from materials where code = $1", kode))[0];
// rencana percontohan: bahan nyata dari keputusan satuan operasional (target = hasil SO final); dipilih hanya yang ADA di salinan restore
const RENCANA = [["LIST-WIBING-PUTIH", "METER", 180], ["LIST-WIBING-ABU", "METER", 540], ["LIST-WIBING-COKLAT", "METER", 270], ["BUSA-REBONDED-BATU", "SHEET", 22], ["STREPLES-10-13", "ROD", 250], ["BENANG-KATUN-PUTIH", "PCS", 5], ["PE-ENCASEMENT-200X18X4CM", "PCS", 1]];
const ada = []; for (const [kode, baru, saldo] of RENCANA) { const m = await kodeAda(kode); if (m && m.unit !== baru) ada.push({ ...m, baru, saldo }); }
if (!ada.length) { info("uji nyata dilewati", "tidak ada bahan rencana yang masih perlu transisi di salinan restore"); } else {
  const awal = Object.fromEntries(await Promise.all(ada.map(async (m) => [m.code, { unit: m.unit, gerak: await num("select count(*)::int n from stock_movements where material_id = $1::uuid", m.id), saldo: Number((await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", m.id))[0].n), harga: await num("select count(*)::int n from material_harga_berlaku where material_id = $1::uuid", m.id), catatan: await num("select count(*)::int n from unit_usage_notes where material_id = $1::uuid and origin::text = 'EXCEL' and state::text in ('SIAP_POSTING','PERLU_DICEK')", m.id) }])));
  const lama = Object.fromEntries(await Promise.all(ada.map(async (m) => [m.code, JSON.stringify(await prisma.$queryRawUnsafe("select id::text, type::text, qty::float, created_at::text from stock_movements where material_id = $1::uuid order by created_at, id", m.id))])));
  const tt0 = await num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN'");
  const mintaBody = ada.map((m) => ({ materialId: m.id, satuanBaru: m.baru, saldoBaru: m.saldo, kewajibanTerbuka: m.code === "LIST-WIBING-PUTIH" ? [{ rujukan: "GR-051126-02", jumlah: 10, satuan: "ROLL", keterangan: "penerimaan satuan lama belum diterjemahkan" }] : m.code === "BENANG-KATUN-PUTIH" ? [{ rujukan: "GR-051126-02", jumlah: 4, satuan: "PACK", keterangan: "penerimaan satuan lama belum diterjemahkan" }] : [] }));
  const pr = await http("POST", "/api/inventory/materials/transisi-satuan/pratinjau", tA, { transisi: mintaBody });
  cek("pratinjau data nyata: 200, memuat hash untuk setiap bahan, tanpa menulis", pr.status === 200 && pr.json?.transisi?.length === ada.length && (await jejak()) && sama(await jejak(), j0), `${pr.status} bahan=${ada.length} boleh=${pr.json?.bolehDiterapkan}`);
  for (const t of pr.json?.transisi ?? []) info(`pratinjau ${t.kode}: ${t.satuanLama}→${t.satuanBaru} saldo lama ${t.saldoLama}; gerak ${t.pergerakan.jumlah}; catatan EXCEL ${t.catatanHistoris.excelBelumDiposting} (tautan ${t.catatanHistoris.tautanSOAktif}); penghalang ${t.penghalang.map((p) => p.kode).join(",") || "-"}`);
  const dasar = { sumber: "Uji rehearsal (salinan restore): hasil SO final", alasan: "Uji rehearsal transisi satuan pada data nyata salinan restore", rujukanHash: "rehearsal-transisi-satuan-0001", tautan: { soTanggal: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10), sumber: "Uji rehearsal (salinan restore)", alasan: "Tautan SO dipasang bersama transisi satuan (rehearsal)", rujukanHash: "rehearsal-transisi-satuan-0001" } };
  const body = (hashes) => ({ ...dasar, transisi: mintaBody.map((m, i) => ({ ...m, hashPratinjau: hashes[i] })) });
  const hashes = (pr.json?.transisi ?? []).map((t) => t.hash);
  const k1 = `reh-tsb-${stamp}-0001`;
  const buruk = hashes.map((h, i) => (i === hashes.length - 1 ? "f".repeat(64) : h));
  const g1 = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tA, body(buruk), { "Idempotency-Key": `reh-tsb-${stamp}-0000` });
  cek("satu hash tidak cocok membatalkan SELURUH batch: 409, tidak ada satuan berubah, tidak ada dokumen/tautan baru", g1.status === 409 && (await num("select count(*)::int n from material_unit_transitions")) === 0 && (await num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN'")) === tt0 && (await Promise.all(ada.map(async (m) => (await kodeAda(m.code)).unit === m.unit))).every(Boolean), `${g1.status} ${g1.json?.code}`);
  const g2 = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tB, body(hashes), { "Idempotency-Key": k1 }); cek("bukan penyetuju: 403, tidak menulis", g2.status === 403 && (await num("select count(*)::int n from material_unit_transitions")) === 0, `${g2.status}`);
  const t1 = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tA, body(hashes), { "Idempotency-Key": k1 });
  cek("terapkan batch data nyata: 201, semua bahan bertransisi dalam satu transaksi", t1.status === 201 && t1.json?.transisi?.length === ada.length, `${t1.status} ${JSON.stringify(t1.json).slice(0, 160)}`);
  if (t1.status === 201) {
    for (const m of ada) {
      const a0 = awal[m.code]; const sk = await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", m.id); const u = (await kodeAda(m.code)).unit;
      cek(`${m.code}: satuan ${m.unit}→${m.baru}; SUM ledger = hasil SO ${m.saldo} (tidak pernah saldo lama berlabel satuan baru)`, u === m.baru && Math.abs(Number(sk[0].n) - m.saldo) < 1e-6, `${u} ${sk[0].n}`);
      const sekarang = JSON.parse(lama[m.code]); const kini = await prisma.$queryRawUnsafe("select id::text, type::text, qty::float, created_at::text from stock_movements where material_id = $1::uuid order by created_at, id", m.id);
      const kiniMap = new Map(kini.map((x) => [x.id, x])); const utuh = sekarang.every((x) => { const y = kiniMap.get(x.id); return y && y.qty === x.qty && y.type === x.type && y.created_at === x.created_at; });
      cek(`${m.code}: ${a0.gerak} pergerakan lama utuh (id, jenis, qty, waktu); tepat ${kini.length - a0.gerak} pergerakan baru (penutup/pembuka)`, utuh && kini.length - a0.gerak === (Math.abs(a0.saldo) > 1e-9 ? 1 : 0) + (m.saldo !== 0 ? 1 : 0), `${kini.length - a0.gerak}`);
      const rs = await http("GET", `/api/inventory/materials/${m.id}/riwayat-satuan`, tA); const lamaP = rs.json?.periode?.find((p) => p.satuan === m.unit);
      cek(`${m.code}: riwayat satuan membedakan periode ${m.unit} (saldo ditutup 0) dan ${m.baru} (${m.saldo}); konsisten`, rs.status === 200 && rs.json.konsisten === true && rs.json.satuanSekarang === m.baru && (!lamaP || Math.abs(lamaP.saldo) < 1e-6) && Math.abs((rs.json.periode.find((p) => p.satuan === m.baru)?.saldo ?? 0) - m.saldo) < 1e-6, `${rs.status}`);
      if (a0.catatan > 0) cek(`${m.code}: ${a0.catatan} catatan historis EXCEL bertaut SO sebelum satuan baru terlihat`, (await num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN' and entity_id = $1", m.id)) === 1);
    }
    const d1 = await prisma.$queryRawUnsafe("select count(*)::int n from material_unit_transitions"); cek("tepat satu dokumen transisi per bahan", Number(d1[0].n) === ada.length);
    const t2 = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tA, body(hashes), { "Idempotency-Key": k1 }); cek("ulang kunci+isi sama: 200 ulang, tidak ada dokumen/pergerakan baru", t2.status === 200 && t2.json?.ulang === true && (await num("select count(*)::int n from material_unit_transitions")) === ada.length, `${t2.status}`);
    const { evaluasiUlang } = await imp("src/services/catatanPemakaianHistoris.js"); const { daftarPengaman } = await imp("src/services/pengamanHistorisPascaSO.js"); const { rencanakanPosting } = await imp("src/services/postingPemakaianHistoris.js");
    await evaluasiUlang(prisma, {}); const dp = await daftarPengaman(prisma); const idList = ada.map((m) => m.id);
    const sisaTak = await num("select count(*)::int n from unit_usage_notes where material_id::text = any($1::text[]) and origin::text = 'EXCEL' and state::text in ('SIAP_POSTING','PERLU_DICEK')", idList);
    const tertahan = dp.baris.filter((b) => idList.includes(b.materialId)).length;
    cek("sesudah evaluasi otomatis (flag 'satuan beda master' hilang): SEMUA catatan EXCEL bahan bertransisi TERTAHAN_PASCA_SO", tertahan === sisaTak && dp.baris.filter((b) => idList.includes(b.materialId)).every((b) => b.keadaan === "TERTAHAN_PASCA_SO"), `${tertahan} dari ${sisaTak}`);
    const rp = await rencanakanPosting(prisma); cek("rencana posting historis tidak memuat bahan bertransisi", !rp.transaksi.some((x) => ada.some((m) => m.code === x.kodeBahan)), `${rp.transaksi.length} transaksi`);
    const lap = await http("GET", "/api/inventory/nilai-persediaan", tA); const barisLap = lap.json?.baris ?? [];
    cek("laporan: harga bersatuan lama TIDAK dipakai (bahan bertransisi tidak berstatus DINILAI); yang berkewajiban terbuka bertanda cakupan parsial", ada.every((m) => { const b = barisLap.find((x) => x.kode === m.code); return b && b.status !== "DINILAI"; }) && (lap.json?.cakupan?.transisiSatuan?.parsial ?? 0) >= 1, `${lap.status}`);
    const j2 = await jejak(); cek("transisi dan evaluasi TIDAK membuat ISSUE, jurnal, valuasi, harga, PO/GR, penyesuaian, hasil SO, deklarasi, atau posting historis", sama(j0, j2), JSON.stringify({ j0, j2 }));
  }
}
const j3 = await jejak(); cek("seluruh uji: tabel bisnis tidak berubah selain pergerakan penutup/pembuka, dokumen transisi, tautan SO, dan pemetaan/evaluasi catatan pada salinan restore", sama(j0, j3), JSON.stringify({ j0, j3 }));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
