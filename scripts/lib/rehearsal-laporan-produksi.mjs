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
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-laporan-produksi.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji Laporan Produksi hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Laporan Produksi terpadu": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4102, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Tulisan hanya di DB sementara ini (satu ISSUE SANO GUARD + satu serah barang jadi uji). Endpoint laporan tidak boleh mengubah apa pun; angka harus konsisten antar tab dan sama dengan hitungan langsung tabel.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4102); const BASE = `http://127.0.0.1:${PORT}`;
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
const pembaca = info.find((x) => bisa(x.rs, P.PRODUCTION_REPORT_READ) && bisa(x.rs, P.FINANCE_READ))?.u ?? await prisma.user.create({ data: { name: "REH Pembaca", email: `reh-lpr-r-${stamp}@example.test`, passwordHash: "x", role: "OWNER" } });
const tanpa = info.find((x) => !bisa(x.rs, P.PRODUCTION_REPORT_READ) && !bisa(x.rs, P.PRODUCTION_REPORT_WAREHOUSE) && !bisa(x.rs, P.FINANCE_READ))?.u ?? await prisma.user.create({ data: { name: "REH Tanpa Izin", email: `reh-lpr-x-${stamp}@example.test`, passwordHash: "x", role: "DRIVER" } });
cek("akun uji tersedia: pembaca penuh (laporan + finance:read) dan akun tanpa izin", !!pembaca && !!tanpa && pembaca.id !== tanpa.id && !bisa(await rolesDari(tanpa), P.PRODUCTION_REPORT_READ));
const tP = await token(pembaca); const tX = await token(tanpa);
const get = async (url, tok = tP) => { const t0 = process.hrtime.bigint(); const r = await fetch(BASE + url, { headers: tok ? { Authorization: "Bearer " + tok } : {} }); let j = null; try { if (/json/.test(r.headers.get("content-type") ?? "")) j = await r.json(); else await r.arrayBuffer(); } catch { /* bukan JSON */ } return { status: r.status, json: j, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; };
const wib = (d) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10); const sampai = wib(new Date());
const per = (hari) => `from=${wib(new Date(Date.now() - (hari - 1) * 86400_000))}&to=${sampai}`;
const L = "/api/production-v2/laporan";
const TABEL = ["stock_movements", "stock_movement_biaya_operasional", "material_harga_berlaku", "material_issues", "fin_journal_entries", "units", "unit_material_declarations", "production_runs_v2", "unit_custody_handoffs_v2", "production_unit_work_progress"];
const jejak = async () => Object.fromEntries(await Promise.all(TABEL.map(async (t) => [t, await num(`select count(*)::int n from ${t}`)])));
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

// ── A. data NYATA: konsistensi antar tab, lingkup penuh, selesai posisi/bertanggal, PIC penugasan ──
const j0 = await jejak();
for (const hari of [30, 90, 366]) {
  const rg = await get(`${L}/ringkasan?${per(hari)}`); const bo = await get(`${L}/biaya-order?${per(hari)}&pageSize=100`); const bs = await get(`${L}/biaya-order?${per(hari)}&hanyaPemakaian=1&pageSize=1`); const kn = await get(`${L}/kinerja?${per(hari)}`);
  cek(`${hari} hari: ringkasan/biaya-order/kinerja 200`, rg.status === 200 && bo.status === 200 && kn.status === 200, `${rg.status}/${bo.status}/${kn.status}`);
  if (!(rg.status === 200 && bo.status === 200 && kn.status === 200)) continue;
  const r = bo.json.ringkas;
  cek(`${hari} hari: lingkup PENUH ${r.order} order (${r.orderDenganPemakaian} dengan pemakaian + ${r.orderTanpaPemakaian} tanpa); 'hanya pemakaian' = ${bs.json.total}; kartu Ringkasan = tabel`, r.orderDenganPemakaian === bs.json.total && r.order === r.orderDenganPemakaian + r.orderTanpaPemakaian && rg.json.kartu.orderDalamLingkup.order === r.order && rg.json.kartu.orderDalamLingkup.tanpaPemakaian === r.orderTanpaPemakaian, `${r.order}/${bs.json.total}`);
  cek(`${hari} hari: Σ Lengkap+Parsial+Belum = order; HPP diketahui ${r.nilaiDiketahui}; pemakaian lama TIDAK dihitung dengan harga terbaru (nilai hanya dari baris beku)`, r.perStatus.LENGKAP + r.perStatus.PARSIAL + r.perStatus.BELUM_DIKETAHUI === r.order);
  const s = kn.json.selesai; const posisiSql = await num("select count(*)::int n from units where status in ('READY_FOR_DELIVERY','READY_ON_CUSTOMER_HOLD','IN_TRANSIT_OUT','DELIVERED')");
  cek(`${hari} hari: selesai posisi saat ini = tabel (${posisiSql}); bertanggal ${s.bertanggalPeriode}; tanpa tanggal tercatat ${s.tanpaTanggal} (dilaporkan, TIDAK 0 palsu); tren hanya yang bertanggal; terkirim ${s.terkirimPeriode}`, s.posisiSaatIni === posisiSql && s.tanpaTanggal <= s.posisiSaatIni && s.perHari.reduce((a, x) => a + x.nilai, 0) === s.bertanggalPeriode, JSON.stringify(s.perSumber));
}
const knA = (await get(`${L}/kinerja?${per(30)}`)).json; const planPic = await num("select count(*)::int n from production_run_plans_v2 where status <> 'CANCELLED' and (operator_id is not null or corner_operator_id is not null)");
cek(`PIC = penugasan: label dasar, cakupan memuat rencana ber-PIC (${planPic}) = tabel; Σ baris PIC = total selesai bertanggal`, knA.pic.dasar === "PENUGASAN" && knA.pic.cakupan.rencanaBerPicTotal === planPic && knA.pic.baris.reduce((a, p) => a + p.selesai, 0) === knA.selesai.bertanggalPeriode && /bukan pelaku posting bahan/.test(knA.pic.catatan), JSON.stringify(knA.pic.cakupan));
const nGuardData = await num("select count(*)::int n from stock_movements s join materials m on m.id = s.material_id where s.unit_id is not null and upper(m.code) like 'SANO-GUARD%'");
console.log(`INFO  salinan restore: pemakaian SANO GUARD nyata = ${nGuardData}; selesai posisi/bertanggal/tanpa tanggal pada 366 hari dicetak di atas`);
cek("endpoint laporan pada data nyata tidak mengubah stok, biaya beku, harga, Material Issue, jurnal, unit, pernyataan, run, custody, status kerja", sama(await jejak(), j0));

// ── B. WAKTU RESPONS (HTTP ke server kode baru; dingin/hangat/maks) ──
const ukur = async (nama, url, batas, n3 = 3) => { const t = []; let st = 0; for (let i = 0; i < n3; i++) { const r = await get(url); st = r.status; t.push(r.ms); } const h = t.slice(1).sort((a, b) => a - b);
  console.log(`WAKTU ${nama.padEnd(60)} dingin=${String(Math.round(t[0])).padStart(5)} ms | hangat p50=${String(Math.round(h[Math.floor(h.length / 2)])).padStart(5)} ms maks=${String(Math.round(Math.max(...h))).padStart(5)} ms`);
  cek(`waktu ${nama} di bawah batas ${batas} ms (maks ${Math.round(Math.max(...t))} ms)`, st === 200 && Math.max(...t) < batas); };
for (const hari of [30, 366]) {
  await ukur(`Ringkasan (${hari} hari)`, `${L}/ringkasan?${per(hari)}`, 10000);
  await ukur(`Biaya per Order halaman 1 (${hari} hari, lingkup penuh)`, `${L}/biaya-order?${per(hari)}&pageSize=25`, 10000);
  await ukur(`Biaya per Order filter gabungan (${hari} hari)`, `${L}/biaya-order?${per(hari)}&status=PARSIAL,BELUM_DIKETAHUI&masalah=ada&urut=nilai&page=2&pageSize=25`, 10000);
  await ukur(`Kinerja (${hari} hari)`, `${L}/kinerja?${per(hari)}`, 10000);
  await ukur(`Bahan & Gudang (${hari} hari)`, `${L}/bahan-gudang?${per(hari)}`, 10000);
}
for (const tab of ["ringkasan", "biaya-order", "kinerja", "bahan-gudang"]) await ukur(`Ekspor Excel ${tab} (366 hari, semua hasil)`, `${L}/export?tab=${tab}&${per(366)}`, 30000, 2);

// ── C. data uji (HANYA di salinan): SANO GUARD ber-snapshot resmi + selesai bertanggal ──
const { catatBiayaOperasional } = await imp("src/services/finance/hargaBerlaku.js");
const guard = await prisma.material.findFirst({ where: { code: { startsWith: "SANO-GUARD" }, hargaBerlaku: { some: {} } }, include: { hargaBerlaku: { orderBy: { effectiveFrom: "asc" }, take: 1 } } });
const unitUji = await prisma.unit.findFirst({ where: { status: "READY_FOR_DELIVERY" }, orderBy: { id: "asc" }, include: { order: true } }) ?? await prisma.unit.findFirst({ where: { status: "DELIVERED" }, orderBy: { id: "asc" }, include: { order: true } });
const unitSelesaiId = unitUji ? (await prisma.$queryRawUnsafe(`select u.id::text id from units u where u.status in ('READY_FOR_DELIVERY','DELIVERED') and u.id <> $1::uuid and not exists (select 1 from unit_custody_handoffs_v2 h where h.unit_id = u.id and h.direction = 'FINISHED_GOODS') and not exists (select 1 from production_runs_v2 r where r.unit_id = u.id and r.delivery_released_at is not null) and not exists (select 1 from production_unit_work_progress w where w.unit_id = u.id and w.status = 'SELESAI') and not exists (select 1 from production_runs_v2 r join production_phase_runs_v2 ph on ph.run_id = r.id where r.unit_id = u.id and ph.phase = 'HANDOFF' and ph.started_at is not null) order by u.id desc limit 1`, unitUji.id))[0]?.id ?? null : null; const unitSelesai = unitSelesaiId ? { id: unitSelesaiId } : null;
if (!guard || !unitUji) cek("bahan SANO GUARD ber-Harga Berlaku dan unit uji tersedia di salinan", false, `${guard?.code}/${unitUji?.unitCode}`);
else {
  const harga = Number(guard.hargaBerlaku[0].unitPrice);
  const kn0 = (await get(`${L}/kinerja?${per(30)}`)).json.selesai;
  const mv = await prisma.stockMovement.create({ data: { materialId: guard.id, type: "ISSUE", qty: -1, unitId: unitUji.id, note: "REH uji SANO GUARD", reason: "uji rehearsal" } });
  await prisma.$transaction((tx) => catatBiayaOperasional(tx, mv));
  const bo = (await get(`${L}/biaya-order?${per(30)}&q=${encodeURIComponent(unitUji.order.orderNumber ?? unitUji.unitCode)}&pageSize=50`)).json; const o = bo.rows.find((x) => x.orderId === unitUji.orderId);
  cek(`SANO GUARD: ISSUE ber-snapshot resmi IKUT dihitung (nilai ${harga}), nilaiGuard terpisah, gap perakitan GUARD≥1, status bukan Lengkap`, !!o && o.nilaiGuard === harga && o.nilaiDiketahui >= harga && o.masalah.GUARD >= 1 && o.status !== "LENGKAP", JSON.stringify(o && { s: o.status, n: o.nilaiDiketahui, g: o.nilaiGuard, m: o.masalah.GUARD }));
  const det = (await get(`${L}/biaya-order/${encodeURIComponent(unitUji.orderId)}?${per(30)}`)).json;
  cek("SANO GUARD: rincian menandai baris guard + catatan potensi hitung ganda; total order = Σ unit", !!det.catatanGuard && /hitung ganda/.test(det.catatanGuard) && det.unit.some((u) => u.bahan.some((b) => b.guard && b.status === "DIBEKUKAN")) && det.total.nilaiDiketahui === det.unit.reduce((a, u) => a + u.ringkas.nilaiDiketahui, 0));
  if (unitSelesai) {
    await prisma.unitCustodyHandoff.create({ data: { unitId: unitSelesai.id, direction: "FINISHED_GOODS", status: "OFFERED", offeredAt: new Date() } });
    const kn1 = (await get(`${L}/kinerja?${per(30)}`)).json.selesai;
    cek("selesai bertanggal: serah barang jadi uji menambah 'bertanggal' +1 dan mengurangi 'tanpa tanggal' −1 (posisi saat ini tetap); tren hari ini +1", kn1.bertanggalPeriode === kn0.bertanggalPeriode + 1 && kn1.tanpaTanggal === kn0.tanpaTanggal - 1 && kn1.posisiSaatIni === kn0.posisiSaatIni && kn1.perHari.at(-1).nilai === kn0.perHari.at(-1).nilai + 1, `${kn0.bertanggalPeriode}→${kn1.bertanggalPeriode}; ${kn0.tanpaTanggal}→${kn1.tanpaTanggal}`);
  } else cek("unit selesai tanpa bukti tanggal tersedia untuk uji serah barang jadi", false);
}
cek("izin: tanpa token 401; akun tanpa izin 403 pada semua tab", (await get(`${L}/ringkasan?${per(30)}`, null)).status === 401 && (await Promise.all(["ringkasan", "biaya-order", "kinerja", "bahan-gudang"].map((k) => get(`${L}/${k}?${per(30)}`, tX)))).every((r) => r.status === 403));

// ── D. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
