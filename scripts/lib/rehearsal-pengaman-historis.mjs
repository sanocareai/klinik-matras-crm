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
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-pengaman-historis.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji pengaman historis hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Pengaman posting historis pasca-SO": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4103, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Bagian A hanya membaca (kode SMOKE yang sama dengan fase 8b). Bagian B MENULIS — HANYA pada salinan restore (DB rehearsal_*, dibuang sesudahnya, dijaga di atas): tautan SO → tertahan → pernyataan per catatan →
// pembatalan, dengan bukti bahwa hash rencana KEMBALI IDENTIK setelah semua dibatalkan dan tidak ada tulisan ke ledger, harga, jurnal, penyesuaian, GR, persediaan awal, pengaturan Finance, maupun catatan pemakaian.
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
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const stamp = Date.now().toString(36);
const penyetuju = info.find((x) => bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE) && bisa(x.rs, P.INVENTORY_READ))?.u ?? await prisma.user.create({ data: { name: "REH Penyetuju", email: `reh-pph-a-${stamp}@example.test`, passwordHash: "x", role: "OWNER" } });
const bukanPenyetuju = info.find((x) => bisa(x.rs, P.INVENTORY_WRITE) && !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u ?? await prisma.user.create({ data: { name: "REH Penulis", email: `reh-pph-w-${stamp}@example.test`, passwordHash: "x", role: "ADMIN" } });
const tA = await token(penyetuju); const tW = await token(bukanPenyetuju);
const TABEL = [["stock_movements", "select count(*)::int n from stock_movements"], ["biaya_beku", "select count(*)::int n from stock_movement_biaya_operasional"], ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["penyesuaian", "select count(*)::int n from stock_adjustment_requests"], ["goods_receipts", "select count(*)::int n from goods_receipts"], ["persediaan_awal", "select count(*)::int n from fin_inventory_openings"], ["pengaturan_finance", "select count(*)::int n from fin_settings"], ["hasil_so", "select count(*)::int n from activity_events where entity_type = 'hasil_so_bahan'"], ["catatan_pemakaian", "select count(*)::int n from unit_usage_notes"], ["catatan_state", "select count(*)::int n from unit_usage_notes where state in ('SIAP_POSTING','PERLU_DICEK')"]];
const jejak = async () => Object.fromEntries(await Promise.all(TABEL.map(async ([k, q]) => [k, await num(q)])));
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
const pernyataanN = () => num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so'");
const j0 = await jejak();

// ── A. SMOKE pasca-switch (kode yang sama dengan fase 8b) terhadap server rehearsal ──
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP|INFO)/.test(l)).join("\n"));
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
cek("bagian A (baca) tidak mengubah stok, biaya beku, harga, jurnal, penyesuaian, GR, persediaan awal, pengaturan Finance, hasil SO, catatan pemakaian", sama(await jejak(), j0));

// ── B. UJI TULIS pada SALINAN RESTORE (DB rehearsal_*): tautan SO → tertahan → pernyataan → pembatalan ──
const http = async (method, url, tok, body = null, header = {}) => { const r = await fetch(BASE + url, { method, headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...header }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* kosong */ } return { status: r.status, json: j }; };
const PL = "/api/production/posting-historis";
const rencana = async () => (await http("GET", `${PL}/rencana`, tA)).json;
const r0 = await rencana(); cek("rencana posting terbaca; belum ada tautan: tertahan/tercermin/dilepas = 0 (rencana memakai rumus hash lama)", !!r0?.hash && /^[0-9a-f]{64}$/.test(r0.hash) && r0.tertahanPascaSO === 0 && r0.tercerminDiSO === 0 && r0.dilepasBelumTercermin === 0, JSON.stringify({ jumlah: r0?.jumlah, tertahan: r0?.tertahanPascaSO }));
const perBahan = new Map(); for (const t of r0?.transaksi ?? []) { const g = perBahan.get(t.materialId) ?? { kode: t.kodeBahan, catatan: [] }; g.catatan.push(...t.catatanIds); perBahan.set(t.materialId, g); }
const pilih = [...perBahan.entries()].map(([id, g]) => ({ id, ...g })).filter((g) => g.catatan.length >= 2).sort((a, b) => b.catatan.length - a.catatan.length || a.kode.localeCompare(b.kode))[0];
cek("data nyata tersedia: bahan dengan ≥2 catatan siap posting di rencana", !!pilih, pilih ? `${pilih.kode} (${pilih.catatan.length} catatan)` : "tidak ada");
if (pilih) {
  const hari = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); const HASH = "46cd9bcd0d763d9e5a2661d431ed998042257bb9eedc69eb9c1614cb5111a356"; const kunci = `reh-pph-${stamp}`;
  const bt = { materialId: pilih.id, soTanggal: hari, sumber: "Uji rehearsal (salinan restore)", alasan: "Uji rehearsal tautan SO ke bahan", rujukanHash: HASH };
  const t0 = await http("POST", `${PL}/pengaman/tautan`, tA, bt); cek("tautan tanpa Idempotency-Key: 428, tidak ada peristiwa", t0.status === 428 && (await pernyataanN()) === 0, `${t0.status}`);
  const t1 = await http("POST", `${PL}/pengaman/tautan`, tW, bt, { "Idempotency-Key": `${kunci}-w` }); cek("akun tanpa inventory:adjustment_approve: 403, tidak ada peristiwa", t1.status === 403 && (await pernyataanN()) === 0, `${t1.status}`);
  const t2 = await http("POST", `${PL}/pengaman/tautan`, tA, { ...bt, soTanggal: "2099-01-01" }, { "Idempotency-Key": `${kunci}-f` }); cek("tanggal SO masa depan ditolak 400", t2.status === 400 && t2.json?.code === "TANGGAL_SO_MASA_DEPAN", `${t2.status}`);
  const t3 = await http("POST", `${PL}/pengaman/tautan`, tA, bt, { "Idempotency-Key": `${kunci}-1` }); cek("tautan SO sah: 201 (berlaku sejak dibuat; batas = akhir hari tanggal SO WIB)", t3.status === 201 && /T16:59:59\.999Z$/.test(t3.json?.batas ?? ""), `${t3.status} ${JSON.stringify(t3.json).slice(0, 160)}`);
  const ulang = await http("POST", `${PL}/pengaman/tautan`, tA, bt, { "Idempotency-Key": `${kunci}-1` }); cek("retry kunci sama: 200, tidak ada peristiwa kedua", ulang.status === 200 && ulang.json?.ulang === true && (await pernyataanN()) === 1, `${ulang.status}`);
  const dua = await http("POST", `${PL}/pengaman/tautan`, tA, bt, { "Idempotency-Key": `${kunci}-2` }); cek("tautan kedua tanpa menggantikanId ditolak 409", dua.status === 409 && dua.json?.code === "SUDAH_ADA_TAUTAN", `${dua.status}`);
  const r1 = await rencana(); cek("setelah tautan: catatan bahan itu TERTAHAN, keluar dari rencana; hash berubah", r1.tertahanPascaSO >= 2 && r1.hash !== r0.hash && r1.jumlah < r0.jumlah && !r1.transaksi.some((t) => t.materialId === pilih.id), JSON.stringify({ tertahan: r1.tertahanPascaSO, jumlah: `${r0.jumlah}→${r1.jumlah}` }));
  const dp = (await http("GET", `${PL}/pengaman?materialId=${pilih.id}`, tA)).json; cek("daftar pengaman memuat tautan dan catatan TERTAHAN_PASCA_SO bahan itu", dp?.tautan?.length === 1 && dp.baris.length >= 2 && dp.baris.every((b) => b.keadaan === "TERTAHAN_PASCA_SO" && b.materialId === pilih.id), `${dp?.baris?.length}`);
  const [idA, idB] = pilih.catatan; const nyata = (arah, ids, k, h = tA) => http("POST", `${PL}/pengaman/nyatakan`, h, { materialId: pilih.id, arah, catatanIds: ids, alasan: "Telaah catatan terhadap hasil SO (uji rehearsal)", rujukanHash: HASH }, { "Idempotency-Key": k });
  const n1 = await nyata("TERCERMIN", [idA], `${kunci}-n1`, tW); cek("pernyataan oleh akun tanpa izin menyetujui: 403", n1.status === 403, `${n1.status}`);
  const n2 = await nyata("TERCERMIN", [idA], `${kunci}-n2`); cek("TERCERMIN untuk SATU catatan: 201 (tidak otomatis seluruh catatan bahan)", n2.status === 201 && n2.json?.catatanIds?.length === 1, `${n2.status}`);
  const n3 = await nyata("BELUM_TERCERMIN", [idB], `${kunci}-n3`); cek("BELUM_TERCERMIN untuk catatan lain: 201 (jalur penyelesaian aman)", n3.status === 201, `${n3.status}`);
  const r2 = await rencana(); cek("rencana: 1 tercermin (tanpa ISSUE), 1 dilepas ikut rencana, sisanya tetap tertahan; hash mengikat pernyataan", r2.tercerminDiSO === 1 && r2.dilepasBelumTercermin === 1 && r2.tertahanPascaSO === r1.tertahanPascaSO - 2 && r2.hash !== r1.hash && r2.transaksi.some((t) => t.materialId === pilih.id && t.catatanIds.includes(idB) && !t.catatanIds.includes(idA)), JSON.stringify({ tc: r2.tercerminDiSO, dl: r2.dilepasBelumTercermin, th: r2.tertahanPascaSO }));
  cek("pernyataan TIDAK menulis ledger, harga, jurnal, penyesuaian, GR, PSA, fin_settings, maupun catatan pemakaian", sama(await jejak(), j0), JSON.stringify(await jejak()));
  const peristiwa = await prisma.$queryRawUnsafe("select event_type, actor_id::text actor, metadata from activity_events where entity_type = 'pernyataan_historis_so' order by created_at asc");
  cek("jejak append-only: SO_DITAUTKAN + 2× SO_HISTORIS_DINYATAKAN dengan pelaku, alasan, rujukan hash", peristiwa.length === 3 && peristiwa[0].event_type === "SO_DITAUTKAN" && peristiwa.slice(1).every((e) => e.event_type === "SO_HISTORIS_DINYATAKAN" && e.actor === penyetuju.id && e.metadata?.rujukanHash === HASH), peristiwa.map((e) => e.event_type).join(","));
  // pembatalan → semuanya kembali; hash rencana IDENTIK dengan semula
  const idPern = [n2.json?.id, n3.json?.id]; for (const [i, id] of idPern.entries()) { const b = await http("POST", `${PL}/pengaman/${id}/batalkan`, tA, { alasan: "Pembatalan uji rehearsal" }); cek(`pembatalan pernyataan ${i + 1}: 201`, b.status === 201, `${b.status}`); }
  const bt1 = await http("POST", `${PL}/pengaman/tautan/${t3.json?.id}/batalkan`, tA, { alasan: "Pembatalan uji rehearsal" }); cek("pembatalan tautan: 201", bt1.status === 201, `${bt1.status}`);
  const r3 = await rencana(); cek("setelah semua dibatalkan: rencana & HASH IDENTIK dengan sebelum uji (rumus lama kembali)", r3.hash === r0.hash && r3.jumlah === r0.jumlah && r3.tertahanPascaSO === 0 && r3.tercerminDiSO === 0 && r3.dilepasBelumTercermin === 0, `${r3.hash?.slice(0, 12)} vs ${r0.hash?.slice(0, 12)}`);
  cek("riwayat utuh: 3 + 3 peristiwa (tidak ada yang dihapus); TIDAK ada tulisan ke ledger, harga, jurnal, penyesuaian, GR, PSA, fin_settings, catatan pemakaian", (await pernyataanN()) === 6 && sama(await jejak(), j0), JSON.stringify(await jejak()));
}
// label nol di laporan menurut sumber bukti (data restore nyata)
const lapT = await http("GET", "/api/inventory/nilai-persediaan", tA); const nolV = (lapT.json?.baris ?? []).filter((b) => b.keadaanSaldo === "NOL_TERVERIFIKASI");
cek("laporan: setiap nol terverifikasi berlabel menurut SUMBER (Koreksi Saldo + dokumen, atau Stock Count); tanggal SO hanya dari tautan eksplisit; tidak ada label lama 'hitung fisik'", lapT.status === 200 && nolV.every((b) => b.verifikasiNol?.sumber && /^Nol terverifikasi — (Koreksi Saldo|Stock Count) \S+/.test(b.keterangan) && !/hitung fisik/.test(b.keterangan) && (b.verifikasiNol.sumber !== "KOREKSI_SALDO" || (b.verifikasiNol.nomor && b.verifikasiNol.soTanggal === null))), `${nolV.length} bahan; contoh: ${nolV[0]?.keterangan ?? "(tidak ada)"}`);
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
