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
  for (const t of pr.json?.transisi ?? []) info(`PRATINJAU-TINJAUAN ${t.kode}: ${t.satuanLama}→${t.satuanBaru}; saldo ${t.saldoLama}→${t.saldoBaru ?? "-"}; pergerakan ${t.pergerakan.jumlah}; catatan EXCEL ${t.catatanHistoris.excelBelumDiposting} (tautan ${t.catatanHistoris.tautanSOAktif}); cakupan ${t.cakupan}; kewajiban terbuka ${(t.kewajibanTerbuka ?? []).length}; harga tidak dibawa ${t.hargaTidakDibawa ? "ya" : "-"}; penghalang ${t.penghalang.map((p) => p.kode).join(",") || "-"}; setara ${JSON.stringify((t.kewajibanTerbuka ?? []).map((k) => (k.setara ? k.setara.jumlah + " " + k.setara.satuan + " @" + k.setara.faktor + " (" + k.setara.dasar + ")" : null)))}; perkiraan setelah kewajiban ${t.perkiraanSetelahKewajiban ? t.perkiraanSetelahKewajiban.saldo + " " + t.perkiraanSetelahKewajiban.satuan : "-"}; hash ${String(t.hash).slice(0, 12)}`);
  { const kayu = await kodeAda("KAYU-RACUK-2X5"); if (!kayu) info("PRATINJAU-TINJAUAN KAYU-RACUK-2X5", "tidak ada di salinan restore"); else {
    const kp = await http("POST", "/api/inventory/adjustments/koreksi-saldo/pratinjau", tA, { materialId: kayu.id, jumlahFisik: 149 });
    cek("KAYU-RACUK-2X5 tetap ROD (batang utuh, tanpa faktor): pratinjau Koreksi Saldo menuju 149 terbaca (200), tanpa menulis", kp.status === 200 && kayu.unit === "ROD" && sama(await jejak(), j0), `${kp.status} satuan ${kayu.unit}`);
    info("PRATINJAU-TINJAUAN KAYU-RACUK-2X5 Koreksi Saldo", JSON.stringify({ satuan: kayu.unit, saldoSebelum: kp.json?.saldoSebelum ?? kp.json?.saldo ?? null, jumlahBaru: kp.json?.jumlahBaru ?? kp.json?.jumlahFisik ?? 149, selisih: kp.json?.selisih ?? null }));
  } }
  const dasar = { sumber: "Uji rehearsal (salinan restore): hasil SO final", alasan: "Uji rehearsal transisi satuan pada data nyata salinan restore", rujukanHash: "rehearsal-transisi-satuan-0001", tautan: { soTanggal: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10), sumber: "Uji rehearsal (salinan restore)", alasan: "Tautan SO dipasang bersama transisi satuan (rehearsal)", rujukanHash: "rehearsal-transisi-satuan-0001" } };
  const body = (hashes) => ({ ...dasar, transisi: mintaBody.map((m, i) => ({ ...m, hashPratinjau: hashes[i] })) });
  const hashes = (pr.json?.transisi ?? []).map((t) => t.hash);
  const k1 = `reh-tsb-${stamp}-0001`;
  const buruk = hashes.map((h, i) => (i === hashes.length - 1 ? "f".repeat(64) : h));
  const g1 = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tA, body(buruk), { "Idempotency-Key": `reh-tsb-${stamp}-0000` });
  cek("satu hash tidak cocok membatalkan SELURUH batch: 409, tidak ada satuan berubah, tidak ada dokumen/tautan baru", g1.status === 409 && (await num("select count(*)::int n from material_unit_transitions")) === 0 && (await num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN'")) === tt0 && (await Promise.all(ada.map(async (m) => (await kodeAda(m.code)).unit === m.unit))).every(Boolean), `${g1.status} ${g1.json?.code}`);
  const g2 = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tB, body(hashes), { "Idempotency-Key": k1 }); cek("bukan penyetuju: 403, tidak menulis", g2.status === 403 && (await num("select count(*)::int n from material_unit_transitions")) === 0, `${g2.status}`);
  { // KEGAGALAN DI LANGKAH TERAKHIR pada data nyata (salinan restore): semua bahan dalam batch batal, tanpa sisa
    const terakhir = ada[ada.length - 1];
    const sebelum = ({ unit: Object.fromEntries(await Promise.all(ada.map(async (m) => [m.code, (await kodeAda(m.code)).unit]))), gerak: Object.fromEntries(await Promise.all(ada.map(async (m) => [m.code, await num("select count(*)::int n from stock_movements where material_id = $1::uuid", m.id)]))), tautan: await num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN'"), j: await jejak() });
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION reh_gagal_transisi() RETURNS trigger AS $$ BEGIN IF NEW.material_id = '${terakhir.id}'::uuid THEN RAISE EXCEPTION 'gagal uji rehearsal di dokumen terakhir'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe("CREATE TRIGGER reh_gagal_trg BEFORE INSERT ON material_unit_transitions FOR EACH ROW EXECUTE FUNCTION reh_gagal_transisi()");
    let gx; try { gx = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tA, body(hashes), { "Idempotency-Key": `reh-tsb-${stamp}-gagal` }); } finally { await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS reh_gagal_trg ON material_unit_transitions"); await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS reh_gagal_transisi()"); }
    const sesudah = ({ unit: Object.fromEntries(await Promise.all(ada.map(async (m) => [m.code, (await kodeAda(m.code)).unit]))), gerak: Object.fromEntries(await Promise.all(ada.map(async (m) => [m.code, await num("select count(*)::int n from stock_movements where material_id = $1::uuid", m.id)]))), tautan: await num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN'"), j: await jejak() });
    cek("gagal di dokumen TERAKHIR dari batch data nyata: galat (>=400), TIDAK ada satuan/pergerakan/dokumen/tautan/tabel bisnis yang berubah pada bahan mana pun", gx.status >= 400 && JSON.stringify(sebelum.unit) === JSON.stringify(sesudah.unit) && JSON.stringify(sebelum.gerak) === JSON.stringify(sesudah.gerak) && sebelum.tautan === sesudah.tautan && sama(sebelum.j, sesudah.j) && (await num("select count(*)::int n from material_unit_transitions")) === 0, `${gx.status}`);
  }
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
// ── C. jalur stok resmi tetap berfungsi dan bertanda satuan (setelah semua pembanding jejak di atas) ──
{ const { postStockMovement } = await imp("src/services/inventoryLedger.js"); const bertransisi = (await prisma.$queryRawUnsafe("select distinct material_id::text id from material_unit_transitions")).map((r) => r.id);
  const cobaTulis = async (m, label) => { const s0 = await num("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", m.id);
    const a = await prisma.$transaction(async (tx) => postStockMovement(tx, { materialId: m.id, type: "RECEIPT", qty: 1, note: "uji rehearsal jalur stok", createdById: penyetuju.id })); const b = await prisma.$transaction(async (tx) => postStockMovement(tx, { materialId: m.id, type: "ISSUE", qty: -1, note: "uji rehearsal jalur stok (balik)", createdById: penyetuju.id }));
    const ra = (await prisma.$queryRawUnsafe("select unit_at_entry::text u, unit_transition_id from stock_movements where id = $1::uuid", a.id))[0]; const rb = (await prisma.$queryRawUnsafe("select unit_at_entry::text u from stock_movements where id = $1::uuid", b.id))[0]; const s1 = await num("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", m.id);
    cek(`jalur stok resmi (${label} ${m.code}): penerimaan +1 dan pengeluaran -1 berfungsi, saldo kembali, kedua pergerakan bertanda satuan ${m.unit} oleh trigger`, Math.abs(s1 - s0) < 1e-9 && ra?.u === m.unit && rb?.u === m.unit && ra.unit_transition_id === null, `${s0}→${s1} ${ra?.u}/${rb?.u}`); };
  const bt = bertransisi.length ? (await prisma.$queryRawUnsafe("select m.id::text id, m.code, m.unit::text unit from materials m where m.id::text = any($1::text[]) and (select coalesce(sum(qty),0) from stock_movements s where s.material_id = m.id) >= 1 order by m.code limit 1", bertransisi))[0] ?? null : null; if (bt) await cobaTulis(bt, "bertransisi");
  const bs = (await prisma.$queryRawUnsafe("select m.id::text id, m.code, m.unit::text unit from materials m where m.active and m.id::text <> all($1::text[]) and (select coalesce(sum(qty),0) from stock_movements s where s.material_id = m.id) >= 1 order by m.code limit 1", bertransisi))[0]; if (bs) await cobaTulis(bs, "tanpa transisi");
  const sasaran = bt ?? bs; let ditolakMinus = false; const sDulu = await num("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", sasaran.id);
  try { await prisma.$transaction(async (tx) => postStockMovement(tx, { materialId: sasaran.id, type: "ISSUE", qty: -1e9, note: "uji rehearsal: melebihi saldo harus ditolak", createdById: penyetuju.id })); } catch (e) { ditolakMinus = true; }
  cek("pengaman saldo minus penulis resmi tetap bekerja: pengeluaran melebihi saldo ditolak, saldo tidak berubah", ditolakMinus && (await num("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", sasaran.id)) === sDulu); }
// ── C2. celah 'Tetap catat' terhadap tautan SO (diperbaiki di kandidat) ──
{ const post = (url, body, header = {}) => http("POST", url, tA, body, header);
{ // PEMAKAIAN PRA-SO × TAUTAN SO ('Tetap catat meskipun stok tidak cukup') pada DATA NYATA (salinan restore): bahan LIST-WIBING-PUTIH bertransisi ⇒ tautan SO aktif (tanggal SO = hari uji)
  const kodeUji = "LIST-WIBING-PUTIH"; const bahanUji = (await prisma.$queryRawUnsafe("select id::text id, unit::text unit from materials where code = $1", kodeUji))[0];
  const unitUji = (await prisma.$queryRawUnsafe("select id::text id, (created_at at time zone 'Asia/Jakarta')::date::text d from units where status::text = 'DELIVERED' order by created_at desc limit 1"))[0];
  if (!bahanUji || !unitUji) info("uji pemakaian pra-SO dilewati", "bahan atau unit TERKIRIM tidak ada di salinan restore"); else {
    const s0 = await num("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", bahanUji.id); const i0 = await num("select count(*)::int n from stock_movements where type::text = 'ISSUE' and material_id = $1::uuid", bahanUji.id); const qty = Math.round(Math.abs(s0) + 500);
    const pra = await post(`/api/production/units/${unitUji.id}/pembetulan-bahan/pratinjau`, { materialId: bahanUji.id, jenis: "TAMBAH", qty, tanggalPemakaian: unitUji.d, pengecualianStokTidakCukup: true });
    const res = await post(`/api/units/${unitUji.id}/materials`, { materialId: bahanUji.id, qty, alasanPembetulan: "Uji rehearsal: pemakaian pra-SO", tanggalPemakaian: unitUji.d, saldoDilihat: pra.json?.stok?.saldoDilihat, hppSidik: pra.json?.hppOperasional?.sidik, pengecualianStokTidakCukup: true, alasanPengecualianStok: "Uji rehearsal: pemakaian pra-SO tidak boleh lolos", konfirmasiSaldoMinus: true, konfirmasiBukanGanda: true }, { "Idempotency-Key": `reh-praso-baru-${stamp}-0001` });
    const s1 = await num("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", bahanUji.id); const i1 = await num("select count(*)::int n from stock_movements where type::text = 'ISSUE' and material_id = $1::uuid", bahanUji.id);
    const penghalang = (pra.json?.penghalang ?? []).map((x) => x.kode + (x.bisaDikecualikan === false ? "(tidak bisa dikecualikan)" : "")).join(",") || "-";
    cek("kode BARU: pemakaian pra-SO + 'Tetap catat' pada bahan bertautan SO DITOLAK (409), saldo hasil SO tidak berkurang, tidak ada ISSUE baru", res.status === 409 && s1 === s0 && i1 === i0 && /SALDO_KURANG\(tidak bisa dikecualikan\)/.test(penghalang), `pratinjau ${pra.status} penghalang ${penghalang}; POST ${res.status} ${res.json?.code ?? ""}; saldo ${s0}→${s1}`);
  }
}
}
// ── D. TEMUAN BASELINE (bukan dampak kandidat): kebocoran nominal Laporan Nilai Persediaan untuk peran tanpa izin finance:read — hanya dilaporkan (INFO), tanpa mengutip data ──
{ const peranTanpa = Object.entries(ROLE_PERMISSIONS).filter(([, izin]) => izin.includes(P.INVENTORY_READ) && !izin.includes(P.FINANCE_READ)).map(([r]) => r).sort(); const peranDengan = Object.entries(ROLE_PERMISSIONS).filter(([, izin]) => izin.includes(P.INVENTORY_READ) && izin.includes(P.FINANCE_READ)).map(([r]) => r).sort();
  if (peranTanpa.length) { const uTanpa = infoU.find((x) => [...x.rs].every((r) => peranTanpa.includes(r)) && bisa(x.rs, P.INVENTORY_READ))?.u ?? await prisma.user.create({ data: { name: "REH Tanpa Finance", email: `reh-tsb-nf-${stamp}@example.test`, passwordHash: "x", role: peranTanpa[0] } });
    const tNf = await token(uTanpa); const lf = await http("GET", "/api/inventory/nilai-persediaan", tNf); const lo = await http("GET", "/api/inventory/nilai-persediaan", tA); const alasanNf = JSON.stringify(lf.json?.finance?.alasan ?? []); const alasanOwner = JSON.stringify(lo.json?.finance?.alasan ?? []); const rupiah = /Rp\s?[0-9]/;
    info("TEMUAN-BASELINE kebocoran nominal GET /api/inventory/nilai-persediaan", JSON.stringify({ status: lf.status, izinNominalResponsTanpaFinance: lf.json?.izin?.nominal ?? null, peranTerdampak: peranTanpa, peranPelihatNominal: peranDengan, finance_alasan_memuat_nominal_Rp_tanpaFinance: rupiah.test(alasanNf), finance_alasan_memuat_nominal_Rp_denganFinance: rupiah.test(alasanOwner), saldoAkunNullTanpaFinance: lf.json?.finance?.saldo === null, barisHargaNullTanpaFinance: (lf.json?.baris ?? []).every((b) => b.harga === null) })); }
  else info("TEMUAN-BASELINE kebocoran nominal", "tidak ada peran inventory:read tanpa finance:read"); }
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
