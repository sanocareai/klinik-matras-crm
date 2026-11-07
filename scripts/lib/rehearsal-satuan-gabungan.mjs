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
if (!/^rehearsal_/.test(nm)) { cek("uji kandidat gabungan hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "kandidat gabungan satuan" (pembaca + biaya + koreksi + drawer): kode BARU berjalan sebagai SERVER sungguhan (index.js, port 4103, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production yang SUDAH bermigrasi (e45e35f4 live).
// Bagian A = kode SMOKE yang sama dengan fase 8b (tidak menulis). Bagian B MENULIS — HANYA pada salinan restore (DB rehearsal_*, dibuang, dijaga di atas): transisi pada DATA NYATA lalu uji pembaca (satuan asal), referensi Agustus, harga rata-rata, koreksi tanpa tanggal, transfer, catatan historis.
// (jejak tabel bisnis dibandingkan sebelum vs sesudah uji)
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
const penyetuju = infoU.find((x) => bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE) && bisa(x.rs, P.INVENTORY_WRITE))?.u ?? await prisma.user.create({ data: { name: "REH Penyetuju", email: `reh-sgb-a-${stamp}@example.test`, passwordHash: "x", role: "OWNER" } });
const bukan = infoU.find((x) => !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u ?? await prisma.user.create({ data: { name: "REH Gudang", email: `reh-sgb-g-${stamp}@example.test`, passwordHash: "x", role: "WAREHOUSE" } });
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
  const dasar = { sumber: "Uji rehearsal (salinan restore): hasil SO final", alasan: "Uji rehearsal transisi satuan pada data nyata salinan restore", rujukanHash: "rehearsal-transisi-satuan-0001", tautan: { soTanggal: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10), sumber: "Uji rehearsal (salinan restore)", alasan: "Tautan SO dipasang bersama transisi satuan (rehearsal)", rujukanHash: "rehearsal-transisi-satuan-0001" } };
  const body = (hashes) => ({ ...dasar, transisi: mintaBody.map((m, i) => ({ ...m, hashPratinjau: hashes[i] })) });
  const hashes = (pr.json?.transisi ?? []).map((t) => t.hash);
  const k1 = `reh-sgb-${stamp}-0001`;
  // keadaan SEBELUM transisi (untuk pembanding): snapshot stok (referensi/harga terakhir), harga rata-rata, waktu acuan
  const { computeStockSnapshot } = await imp("src/services/inventoryLedger.js"); const { dasarHargaRataRata } = await imp("src/services/finance/posting/inventory.js"); const { ringkasanBahan } = await imp("src/services/finance/hargaBerlaku.js");
  const { ambilPemakaianAktual } = await imp("src/services/productionAdoptionService.js"); const { bacaJejakUnit } = await imp("src/services/finance/biayaBahan.js"); const { ajukanKoreksiPemakaian } = await imp("src/services/koreksiPemakaian.js");
  const snap0 = new Map((await computeStockSnapshot(prisma)).map((r) => [r.materialId, r])); const hargaRata0 = {}; for (const m of ada) hargaRata0[m.code] = (await dasarHargaRataRata(prisma, m.id)).harga?.toString() ?? null; const wkt0 = new Date(Date.now() - 2000);
  const t1 = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tA, body(hashes), { "Idempotency-Key": k1 });
  cek("terapkan batch data nyata: 201, semua bahan bertransisi dalam satu transaksi", t1.status === 201 && t1.json?.transisi?.length === ada.length, `${t1.status} ${JSON.stringify(t1.json).slice(0, 160)}`);
  if (t1.status === 201) {
    const idList = ada.map((m) => m.id); const kodeById = new Map(ada.map((m) => [m.id, m.code]));
    // ── B1. PEMBACA: satuan ASAL pada riwayat lama (bukan satuan master baru) ──
    const unitPakai = await prisma.$queryRawUnsafe("select s.material_id::text mid, s.unit_id::text uid from stock_movements s where s.unit_id is not null and s.material_id = any($1::uuid[]) and s.type::text in ('ISSUE','RETURN') group by 1, 2 order by 1, 2 limit 40", idList);
    const asalSatuan = new Map(); for (const m of ada) asalSatuan.set(m.id, m.unit);
    if (!unitPakai.length) info("B1 pembaca pemakaian per unit", "tidak ada pemakaian bertaut unit pada bahan rencana di salinan restore");
    else {
      const unitUji = [...new Set(unitPakai.map((x) => x.uid))].slice(0, 12); let salah = 0; let diperiksa = 0; let labelBaruTertimpa = 0;
      for (const uid of unitUji) {
        const aktual = await ambilPemakaianAktual(prisma, uid); const barisA = Array.isArray(aktual) ? aktual : (aktual.baris ?? []);
        for (const b of barisA) { if (!asalSatuan.has(b.materialId)) continue; diperiksa += 1; if (b.satuan !== asalSatuan.get(b.materialId)) { salah += 1; if (ada.some((m) => m.id === b.materialId && b.satuan === m.baru)) labelBaruTertimpa += 1; } }
        const jejakU = await bacaJejakUnit(prisma, uid, { izinHarga: false });
        for (const bh of jejakU?.bahan ?? []) for (const r of bh.pergerakan ?? []) { if (!asalSatuan.has(r.materialId)) continue; diperiksa += 1; if (r.satuan !== asalSatuan.get(r.materialId)) { salah += 1; if (ada.some((m) => m.id === r.materialId && r.satuan === m.baru)) labelBaruTertimpa += 1; } }
      }
      cek("B1 pembaca pemakaian aktual unit + jejak biaya bahan: SEMUA baris lama (sebelum transisi) berlabel satuan ASAL, tidak ada yang tertimpa label satuan master baru", diperiksa > 0 && salah === 0, `diperiksa ${diperiksa} baris pada ${unitUji.length} unit; salah ${salah}; tertimpa label baru ${labelBaruTertimpa}`);
    }
    // ── B2. REFERENSI Agustus: tidak berlaku pada satuan baru ──
    { const snap1 = (await computeStockSnapshot(prisma)); const peta1 = new Map(snap1.map((r) => [r.materialId, r])); let denganRef = 0; let salahRef = 0; const detail = [];
      for (const m of ada) { const a = snap0.get(m.id); const b = peta1.get(m.id); if (a?.referenceUnitCost == null) continue; denganRef += 1;
        const ok = b.referenceUnitCost === null && b.referensiTidakCocok?.satuanReferensi === m.unit && b.referensiTidakCocok?.satuanSekarang === m.baru; if (!ok) { salahRef += 1; detail.push(m.code); } }
      cek("B2 referensi harga Agustus bahan bertransisi: tidak ada angka pembanding (null) + penanda satuan tidak cocok pada setiap bahan yang punya referensi", salahRef === 0, `bahan dengan referensi ${denganRef}; salah ${salahRef} ${detail.join(",")}`);
      const lainTetap = snap1.filter((r) => !idList.includes(r.materialId) && r.referenceUnitCost != null).length; const lain0 = [...snap0.values()].filter((r) => !idList.includes(r.materialId) && r.referenceUnitCost != null).length;
      cek("B2 bahan tanpa transisi: referensi Agustus dan harga terakhir tidak berubah", lainTetap === lain0 && snap1.filter((r) => !idList.includes(r.materialId)).every((r) => { const a = snap0.get(r.materialId); return a && String(a.latestUnitCost) === String(r.latestUnitCost) && String(a.referenceUnitCost) === String(r.referenceUnitCost); }), `${lainTetap}/${lain0}`);
      const adaRb = ada.find((m) => snap0.get(m.id)?.referenceUnitCost != null); if (adaRb) { const rb = await ringkasanBahan(prisma, adaRb.id); cek(`B2 Harga Berlaku ${adaRb.code}: pembanding Agustus null + penanda satuan; harga GR terakhir hanya dari satuan baru`, rb.pembanding.referensiAgustus === null && rb.pembanding.referensiAgustusTidakCocok?.satuanReferensi === adaRb.unit && rb.pembanding.biayaPerolehanGRTerakhir === null, JSON.stringify(rb.pembanding.referensiAgustusTidakCocok)); } }
    // ── B3. BIAYA: tidak mencampur harga satuan lama dan baru; celah Finance tetap null ──
    { let campur = 0; const rincian = [];
      for (const m of ada) { const sesudah = await dasarHargaRataRata(prisma, m.id); const h0 = hargaRata0[m.code]; const sebelumTransisi = await dasarHargaRataRata(prisma, m.id, { asOf: wkt0 }); const ok = sesudah.harga === null && String(sebelumTransisi.harga?.toString() ?? null) === String(h0);
        if (!ok) { campur += 1; rincian.push(`${m.code}: sesudah=${sesudah.harga} asOf=${sebelumTransisi.harga} awal=${h0}`); } }
      cek("B3 harga rata-rata sesudah transisi = null (gap TANPA_HARGA_PEROLEHAN, bukan harga per satuan lama); menilai pergerakan lama (asOf sebelum transisi) tetap = harga sebelum transisi", campur === 0, rincian.join(" | ")); }
    // ── B4. KOREKSI penambahan atas pemakaian asal pra-SO tanpa tanggal (tautan SO dipasang pada SALINAN bila belum ada) ──
    { const { tautanSOAktif, tautkanSO } = await imp("src/services/pengamanHistorisPascaSO.js");
      const pilih = (await prisma.$queryRawUnsafe("select s.unit_id::text uid, s.material_id::text mid, -sum(s.qty)::float bersih from stock_movements s where s.unit_id is not null and s.type::text in ('ISSUE','RETURN') and s.material_id = any($1::uuid[]) group by 1, 2 having -sum(s.qty) > 0 order by 1, 2 limit 1", idList))[0];
      if (!pilih) info("B4 koreksi penambahan tanpa tanggal", "tidak ada pemakaian bertaut unit pada bahan rencana di salinan restore");
      else { const aktorK = { id: penyetuju.id, name: penyetuju.name, roles: [...(await rolesDari(penyetuju))] };
        if (!(await tautanSOAktif(prisma, [pilih.mid])).get(pilih.mid)) await tautkanSO(prisma, { aktor: aktorK, materialId: pilih.mid, soTanggal: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10), sumber: "Uji rehearsal (salinan restore)", alasan: "Tautan SO dipasang pada salinan restore untuk uji koreksi pra-SO", rujukanHash: "rehearsal-gabungan-0001", kunci: `reh-sgb-${stamp}-taut` });
        const mv0 = await num("select count(*)::int n from stock_movements"); const kor0 = await num("select count(*)::int n from warehouse_corrections");
        const gagalK = await ajukanKoreksiPemakaian(prisma, { unitId: pilih.uid, materialId: pilih.mid, qtyBaru: Number(pilih.bersih) + 1, alasan: "Uji rehearsal: koreksi penambahan tanpa tanggal pemakaian", kunci: `reh-sgb-${stamp}-k1`, aktor: aktorK }).then(() => null, (e) => e);
        cek(`B4 koreksi penambahan ${kodeById.get(pilih.mid)} atas pemakaian asal pra-SO tanpa tanggal ditahan (KOREKSI_PRA_SO), tanpa pergerakan atau koreksi tertulis`, !!gagalK && (gagalK.code ?? gagalK.kode) === "KOREKSI_PRA_SO" && (await num("select count(*)::int n from stock_movements")) === mv0 && (await num("select count(*)::int n from warehouse_corrections")) === kor0, `${gagalK?.code ?? gagalK?.kode ?? "tidak ditahan"} ${String(gagalK?.message ?? "").slice(0, 120)}`);
        const kurang = await ajukanKoreksiPemakaian(prisma, { unitId: pilih.uid, materialId: pilih.mid, qtyBaru: Math.max(0, Number(pilih.bersih) - 0.5), alasan: "Uji rehearsal: koreksi pengurangan tidak disentuh aturan pra-SO", kunci: `reh-sgb-${stamp}-k2`, aktor: aktorK }).then((x) => x, (e) => e);
        cek("B4 koreksi PENGURANGAN (retur) atas pemakaian pra-SO tidak ditahan oleh aturan pra-SO (diajukan, belum mengubah stok)", !!kurang?.id && (await num("select count(*)::int n from stock_movements")) === mv0, `${kurang?.id ? "diajukan" : (kurang?.code ?? kurang?.message)}`); } }
    // ── B5. TRANSFER: penghalang transisi dan label saldo transfer ──
    { const trf = await num("select count(*)::int n from stock_transfer_lines l join stock_transfers t on t.id = l.stock_transfer_id where l.material_id = any($1::uuid[])", idList);
      info("B5 transfer stok yang memuat bahan rencana (di salinan restore)", `${trf} baris; penghalang TRANSFER_BERJALAN/SELISIH_TRANSFER_TERBUKA dievaluasi pada pratinjau transisi (hasil di atas)`);
      const penghalangTrf = (pr.json?.transisi ?? []).flatMap((t) => (t.penghalang ?? []).map((x) => x.kode)).filter((k) => /TRANSFER/.test(k)); cek("B5 tidak ada bahan rencana yang tertahan transfer berjalan / selisih transfer terbuka (sebab transisi lolos pada batch ini)", penghalangTrf.length === 0, penghalangTrf.join(",")); }
    // ── B6. CATATAN HISTORIS lintas satuan: tidak dijumlahkan ──
    { const mvB6 = await num("select count(*)::int n from stock_movements"); const { evaluasiUlang } = await imp("src/services/catatanPemakaianHistoris.js"); await evaluasiUlang(prisma, {});
      const lintas = await num("select count(*)::int n from unit_usage_notes where material_id = any($1::uuid[]) and flags::text like '%ISSUE_LAMA_LINTAS_SATUAN%'", idList); const catatanBahan = await num("select count(*)::int n from unit_usage_notes where material_id = any($1::uuid[]) and origin::text = 'EXCEL'", idList);
      info("B6 catatan historis bahan bertransisi", `${catatanBahan} catatan EXCEL; ditandai tidak dapat dibandingkan lintas satuan: ${lintas}`);
      cek("B6 evaluasi ulang catatan historis berjalan pada data nyata tanpa galat dan tanpa pergerakan stok baru", (await num("select count(*)::int n from stock_movements")) === mvB6, `${mvB6}`); }
    const j2 = await jejak(); cek("B7 uji pembaca/biaya/koreksi tidak membuat ISSUE, jurnal, valuasi, harga, PO/GR, penyesuaian, hasil SO, deklarasi, atau posting historis", sama(j0, j2), JSON.stringify({ j0, j2 }));
  }
}

// ── D. TEMUAN BASELINE (bukan dampak kandidat): kebocoran nominal Laporan Nilai Persediaan untuk peran tanpa izin finance:read — hanya dilaporkan (INFO), tanpa mengutip data ──
{ const peranTanpa = Object.entries(ROLE_PERMISSIONS).filter(([, izin]) => izin.includes(P.INVENTORY_READ) && !izin.includes(P.FINANCE_READ)).map(([r]) => r).sort(); const peranDengan = Object.entries(ROLE_PERMISSIONS).filter(([, izin]) => izin.includes(P.INVENTORY_READ) && izin.includes(P.FINANCE_READ)).map(([r]) => r).sort();
  if (peranTanpa.length) { const uTanpa = infoU.find((x) => [...x.rs].every((r) => peranTanpa.includes(r)) && bisa(x.rs, P.INVENTORY_READ))?.u ?? await prisma.user.create({ data: { name: "REH Tanpa Finance", email: `reh-sgb-nf-${stamp}@example.test`, passwordHash: "x", role: peranTanpa[0] } });
    const tNf = await token(uTanpa); const lf = await http("GET", "/api/inventory/nilai-persediaan", tNf); const lo = await http("GET", "/api/inventory/nilai-persediaan", tA); const alasanNf = JSON.stringify(lf.json?.finance?.alasan ?? []); const alasanOwner = JSON.stringify(lo.json?.finance?.alasan ?? []); const rupiah = /Rp\s?[0-9]/;
    cek("kebocoran nominal DIPERBAIKI: peran tanpa finance:read (" + peranTanpa.join(", ") + ") tidak menerima 'Rp<angka>' pada finance.alasan; pemegang finance:read tetap menerima", !rupiah.test(alasanNf) && rupiah.test(alasanOwner), `status ${lf.status}`);
    info("kebocoran nominal GET /api/inventory/nilai-persediaan (sesudah perbaikan)", JSON.stringify({ status: lf.status, izinNominalResponsTanpaFinance: lf.json?.izin?.nominal ?? null, peranTerdampak: peranTanpa, peranPelihatNominal: peranDengan, finance_alasan_memuat_nominal_Rp_tanpaFinance: rupiah.test(alasanNf), finance_alasan_memuat_nominal_Rp_denganFinance: rupiah.test(alasanOwner), saldoAkunNullTanpaFinance: lf.json?.finance?.saldo === null, barisHargaNullTanpaFinance: (lf.json?.baris ?? []).every((b) => b.harga === null) })); }
  else info("TEMUAN-BASELINE kebocoran nominal", "tidak ada peran inventory:read tanpa finance:read"); }
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
