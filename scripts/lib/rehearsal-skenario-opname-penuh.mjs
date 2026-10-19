// REHEARSAL PENUH Stock Opname — dijalankan DI DALAM container image kandidat terhadap DB REHEARSAL (hasil restore backup production, SUDAH dimigrasi). TIDAK pernah menyentuh database production.
// Server yang dipakai adalah app Express MINIMAL (buildTestApp: router asli tanpa cron/worker/WAHA/Socket.IO) — TIDAK memuat src/index.js, jadi tidak ada pesan WhatsApp, job, atau efek samping luar.
// Pagar: nama database WAJIB mengandung "test" (tests/integration/setup/env.js); skrip rilis menamai DB rehearsal rehearsal_op_test_*.
// FASE (env FASE): smoke | skenario | tutup | ui
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
await import("/app/tests/integration/setup/env.js");
const { prisma } = await import("/app/src/db.js");
const { buildTestApp, startTestServer } = await import("/app/tests/integration/setup/testApp.js");
const { postStockMovement } = await import("/app/src/services/inventoryLedger.js");
const FASE = process.env.FASE || "skenario";
const SC = "/api/inventory/stock-counts";
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d !== "" ? " — " + String(d).slice(0, 240) : ""}`); };
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const menitLalu = (n) => new Date(Date.now() - n * 60_000); const iso = (d) => new Date(d).toISOString();

// ── server sementara
const app = buildTestApp();
let base;
if (FASE === "ui") {
  const express = require("express");
  app.get("/__rh/tokens", (_q, r) => r.json(Object.fromEntries(Object.entries(U).map(([k, v]) => [k, { token: v.token, id: v.user.id, name: v.user.name, role: v.user.role }])))); // hanya di FASE ui; JWT_SECRET rehearsal acak (bukan production) → token tak berlaku di production
  app.use(express.static("/dist"));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile("/dist/index.html"));
  await new Promise((r) => { const sv = app.listen(4100, "0.0.0.0", r); sv.on("error", (e) => { console.error(e); process.exit(2); }); }); base = "http://127.0.0.1:4100";
} else { const sv = await startTestServer(app); base = sv.baseUrl; }

// ── pengguna rehearsal (dibuat di DB rehearsal; bukan akun nyata)
async function pengguna(nama, roles) {
  const email = `rh-${nama}@rehearsal.invalid`; let u = await prisma.user.findUnique({ where: { email } });
  if (!u) u = await prisma.user.create({ data: { name: `Rehearsal ${nama}`, email, passwordHash: "x", role: roles[0] } });
  return { user: u, token: jwt.sign({ id: u.id, name: u.name, role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: "6h" }) };
}
const U = { A: await pengguna("hitung-a", ["WAREHOUSE"]), B: await pengguna("hitung-b", ["WAREHOUSE"]), C: await pengguna("pemeriksa-c", ["WAREHOUSE"]), O: await pengguna("penyetuju-o", ["OWNER"]), L: await pengguna("baca-l", ["PRODUCTION_LEAD"]) };
async function call(u, method, path, body) {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Authorization: "Bearer " + u.token }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j };
}
const G = (u, p) => call(u, "GET", p); const P = (u, p, b = {}) => call(u, "POST", p, b); const PU = (u, p, b) => call(u, "PUT", p, b); const PA = (u, p, b) => call(u, "PATCH", p, b);

if (FASE === "ui") {
  console.log("RH_UI_SIAP"); // token TIDAK dicetak: diambil lewat /__rh/tokens (loopback + terowongan SSH)
  const stop = "/rhctl/stop"; const batas = Date.now() + Number(process.env.RH_UI_MENIT || 40) * 60_000;
  while (Date.now() < batas && !fs.existsSync(stop)) await tidur(2000);
  console.log("RH_UI_SELESAI"); process.exit(0);
}

if (FASE === "smoke") { // smoke baca-saja (lib terpisah) terhadap server sementara
  const kode = await new Promise((res) => { const c = spawn(process.execPath, ["/rh/smoke-opname-penuh.mjs"], { env: { ...process.env, SMOKE_BASE: base }, stdio: "inherit" }); c.on("exit", res); });
  console.log(`RH_SMOKE kode=${kode}`); process.exit(kode === 0 ? 0 : 1);
}

if (FASE === "tutup") { // batalkan semua sesi model baru yang masih terbuka (untuk pembuktian guard rollback lulus)
  const terbuka = await prisma.stockCount.findMany({ where: { modelVersion: 2, status: { in: ["SCHEDULED", "IN_PROGRESS", "WAITING_REVIEW"] } }, select: { id: true, countNumber: true } });
  for (const s of terbuka) { const r = await PA(U.A, `${SC}/${s.id}/cancel`, { reason: "rehearsal: ditutup untuk uji guard rollback" }); cek(`sesi ${s.countNumber} dibatalkan`, r.status === 200, r.status); }
  console.log(`RH_TUTUP gagal=${gagal}`); process.exit(gagal ? 1 : 0);
}

// ═════════════ FASE skenario ═════════════
// Bahan NYATA berlokasi di ledger production (salinan): saldo positif besar, tiap skenario memakai bahan sendiri supaya tidak saling mengganggu.
const kandidat = await prisma.$queryRaw`SELECT m.id, m.code, SUM(s.qty)::float AS saldo FROM materials m JOIN stock_movements s ON s.material_id = m.id WHERE m.active GROUP BY m.id, m.code HAVING SUM(s.qty) >= 60 ORDER BY SUM(s.qty) DESC, m.code LIMIT 40`;
cek("data restore memuat >= 25 bahan aktif berledger dengan saldo >= 60 untuk skenario", kandidat.length >= 25, `n=${kandidat.length}`);
const pakai = (n) => kandidat.splice(0, n);
const saldo = async (m) => Number((await prisma.stockMovement.aggregate({ where: { materialId: m }, _sum: { qty: true } }))._sum.qty ?? 0);
const gerak = (materialId, qty, at, note = "rehearsal") => prisma.stockMovement.create({ data: { materialId, type: qty > 0 ? "RECEIPT" : "ISSUE", qty, note, createdAt: at } });
const kosong = async () => prisma.stockCount.findFirst({ where: { modelVersion: 2, scopeMode: "FULL", status: { in: ["SCHEDULED", "IN_PROGRESS", "WAITING_REVIEW"] } } });
async function sesiItems(ids) {
  const s = (await P(U.A, SC, { mode: "ITEMS", materialIds: ids, blindCount: true })).body; const st = await P(U.A, `${SC}/${s.id}/start`, {}); if (st.status !== 200) throw new Error("start gagal " + JSON.stringify(st.body));
  await prisma.stockCount.update({ where: { id: s.id }, data: { startedAt: menitLalu(360) } }); const k = (await G(U.A, `${SC}/${s.id}/kerja`)).body;
  return { s, L: Object.fromEntries(k.baris.map((b) => [b.materialId, b])) };
}
const simpan = (id, items) => PU(U.A, `${SC}/${id}/hasil`, { items });
const detail = async (id) => (await G(U.B, `${SC}/${id}`)).body;
const tj = (d, m) => d.lines.find((l) => l.materialId === m).tinjau;
const tandai = (u, id, mv, tercermin) => P(u, `${SC}/${id}/pergerakan/${mv}/tanda`, { tercermin });
const periksa = async (id) => (await P(U.C, `${SC}/${id}/periksa`, {})).status === 200;
async function grResmi(materialId, qty, receivedDate) {
  const c = await P(U.A, "/api/inventory/goods-receipts", { sourceType: "SUPPLIER_DELIVERY", supplier: "Rehearsal", lines: [{ materialId, orderedQty: qty }] }); if (c.status !== 201) throw new Error("GR " + JSON.stringify(c.body));
  if (receivedDate) await PA(U.A, `/api/inventory/goods-receipts/${c.body.id}`, { receivedDate });
  for (const status of ["SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"]) await PA(U.A, `/api/inventory/goods-receipts/${c.body.id}`, { status });
  await PA(U.A, `/api/inventory/goods-receipts/${c.body.id}/lines/${c.body.lines[0].id}`, { acceptedQty: qty }); const p = await P(U.A, `/api/inventory/goods-receipts/${c.body.id}/putaway`, {}); if (p.status !== 200) throw new Error("putaway " + JSON.stringify(p.body)); return c.body.id;
}
let unitUji; async function miResmi(materialId, qty) {
  if (!unitUji) unitUji = (await (await import("/app/tests/integration/setup/fixtures.js")).createTestUnit()).unit;
  const c = await P(U.A, "/api/inventory/material-issues", { sourceType: "PRODUCTION_WORK_ORDER", unitId: unitUji.id, lines: [{ materialId, requestedQty: qty }] }); if (c.status !== 201) throw new Error("MI " + JSON.stringify(c.body));
  for (const status of ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"]) await PA(U.A, `/api/inventory/material-issues/${c.body.id}`, { status });
  const i = await P(U.A, `/api/inventory/material-issues/${c.body.id}/issue`, {}); if (i.status !== 200) throw new Error("issue " + JSON.stringify(i.body)); return c.body.id;
}
const hitungAdj = (sid) => prisma.stockMovement.count({ where: { stockCountId: sid } });
async function skenario(nama, fn) { try { await fn(); } catch (e) { gagal += 1; console.log(`FAIL ${nama} — GALAT: ${String(e.stack || e.message).split("\n").slice(0, 3).join(" | ").slice(0, 300)}`); } }
const sebelumTotal = { mov: await prisma.stockMovement.count(), je: Number((await prisma.$queryRawUnsafe("select count(*)::int n from fin_journal_entries"))[0].n) };

// S1 — model waktu: dihitung 10.00, disimpan 40+ menit kemudian, GR 10.05; tiga waktu terpisah; tanpa jendela 30 menit
await skenario("S1 tiga waktu", async () => {
  const [a, b, c] = pakai(3).map((x) => x.id); const { s, L } = await sesiItems([a, b, c]); const O = menitLalu(50); const s0 = { a: await saldo(a), b: await saldo(b), c: await saldo(c) };
  await gerak(a, 7, new Date(O.getTime() - 20 * 60_000), "20 menit sebelum dihitung"); for (const m of [a, b, c]) await gerak(m, 20, new Date(O.getTime() + 5 * 60_000), "GR 10.05");
  const r = (await simpan(s.id, [[a, s0.a + 7], [b, s0.b + 20], [c, s0.c + 20]].map(([m, q]) => ({ lineId: L[m].id, revision: 0, countedQty: q, observedAt: iso(O) })))).body;
  cek("S1 angka tersimpan dengan waktu hitung dinyatakan (jeda > 30 menit dari waktu simpan)", r.hasil.every((x) => x.status === "DISIMPAN" && x.observedSource === "DINYATAKAN"));
  const k = (await G(U.A, `${SC}/${s.id}/kerja`)).body.baris.find((x) => x.materialId === a); cek("S1 waktu hitung ≠ waktu simpan (selisih > 45 menit)", new Date(k.savedAt) - new Date(k.observedAt) > 45 * 60_000);
  await P(U.A, `${SC}/${s.id}/submit`, {}); await periksa(s.id); const d = await detail(s.id);
  cek("S1 +7 yang 20 menit SEBELUM dihitung ikut pembanding otomatis; GR 10.05 berkelas SAAT_HITUNG dan TIDAK masuk pembanding", tj(d, a).saldoSebelum === s0.a + 7 && tj(d, a).pembanding === s0.a + 7 && tj(d, a).transaksi.sejakPengamatan.length === 1 && tj(d, a).transaksi.sejakPengamatan[0].kelas === "SAAT_HITUNG" && tj(d, a).selisih === 0);
  const id = async (m) => tj(await detail(s.id), m).transaksi.sejakPengamatan[0].id;
  await tandai(U.C, s.id, await id(a), false); await tandai(U.C, s.id, await id(b), true); await tandai(U.C, s.id, await id(c), false);
  const d2 = await detail(s.id); cek("S1 keputusan pemeriksa menentukan pembanding (b: sudah ikut terhitung → selisih 0; c: belum → selisih +20)", tj(d2, b).selisih === 0 && tj(d2, c).selisih === 20);
  await PA(U.C, `${SC}/${s.id}/lines/${L[c].id}`, { reason: "rehearsal selisih nyata" }); const sel = await P(U.O, `${SC}/${s.id}/complete`, {});
  cek("S1 Selesaikan lulus; tepat satu penyesuaian (+20 pada c); saldo akhir = fisik + yang diputuskan belum", sel.status === 200 && (await hitungAdj(s.id)) === 1 && (await saldo(a)) === s0.a + 27 && (await saldo(b)) === s0.b + 20 && (await saldo(c)) === s0.c + 40, `${sel.status} adj=${await hitungAdj(s.id)}`);
});

// S2 — dokumen bertanggal mundur (GR resmi bertanggal kemarin diposting sesudah dihitung) dan Material Issue resmi sesudah dihitung
await skenario("S2 mundur + MI", async () => {
  const [a, b] = pakai(2).map((x) => x.id); const { s, L } = await sesiItems([a, b]); const sa = await saldo(a), sb = await saldo(b); const kemarin = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await simpan(s.id, [{ lineId: L[a].id, revision: 0, countedQty: sa + 20, observedAt: iso(menitLalu(30)) }, { lineId: L[b].id, revision: 0, countedQty: sb, observedAt: iso(menitLalu(30)) }]);
  await grResmi(a, 20, kemarin); await miResmi(b, 6); await P(U.A, `${SC}/${s.id}/submit`, {}); await periksa(s.id); const d = await detail(s.id);
  const ga = tj(d, a).transaksi.sejakPengamatan[0], mb = tj(d, b).transaksi.sejakPengamatan[0];
  cek("S2 GR bertanggal kemarin = BERTANGGAL_MUNDUR dengan tanggal kejadian; MI resmi = SESUDAH_DISIMPAN", ga.kelas === "BERTANGGAL_MUNDUR" && ga.tanggalKejadian === kemarin && mb.kelas === "SESUDAH_DISIMPAN" && !!ga.dokumen && !!mb.dokumen);
  const massal = await P(U.C, `${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false }); cek("S2 massal hanya menyentuh MI (GR mundur tidak ikut)", massal.body.ditandai === 1);
  cek("S2 Selesaikan ditolak selama GR mundur belum diputuskan", (await P(U.O, `${SC}/${s.id}/complete`, {})).body.code === "PERGERAKAN_SESI_BELUM_DITANDAI");
  await tandai(U.C, s.id, ga.id, true); const sel = await P(U.O, `${SC}/${s.id}/complete`, {});
  cek("S2 keputusan 'sudah ikut terhitung' mencegah hitung ganda: tanpa penyesuaian; saldo a = fisik; saldo b = saldo awal − MI", sel.status === 200 && (await hitungAdj(s.id)) === 0 && (await saldo(a)) === sa + 20 && (await saldo(b)) === sb - 6, `${sel.status}`);
});

// S3 — PEMBUKTIAN WAJIB: semua keputusan selesai + pemeriksa memeriksa → GR dan Material Issue RESMI baru → Selesaikan ditolak → keputusan → lanjut
await skenario("S3 pergerakan baru setelah review", async () => {
  const [a, b, c] = pakai(3).map((x) => x.id); const { s, L } = await sesiItems([a, b, c]); const O = menitLalu(40); const sa = await saldo(a), sb = await saldo(b), sc = await saldo(c);
  await gerak(a, 20, new Date(O.getTime() + 5 * 60_000), "GR saat dihitung");
  await simpan(s.id, [[a, sa], [b, sb - 3], [c, sc]].map(([m, q]) => ({ lineId: L[m].id, revision: 0, countedQty: q, observedAt: iso(O) }))); await PA(U.A, `${SC}/${s.id}/lines/${L[b].id}`, { reason: "rehearsal selisih nyata" });
  await P(U.A, `${SC}/${s.id}/submit`, {}); await periksa(s.id); const g0 = tj(await detail(s.id), a).transaksi.sejakPengamatan[0]; await tandai(U.C, s.id, g0.id, false);
  const d = await detail(s.id); cek("S3 semua keputusan selesai dan pemeriksaan sah sebelum transaksi baru", d.sesi.belumDitandai === 0 && d.identitas.pemeriksa.length === 1);
  await grResmi(a, 15); await miResmi(b, 6); const sebelum = { a: await saldo(a), b: await saldo(b), c: await saldo(c) }; const adj0 = await hitungAdj(s.id); const mov0 = await prisma.stockMovement.count();
  const tolak = await P(U.O, `${SC}/${s.id}/complete`, {});
  cek("S3 Selesaikan DITOLAK (409 PERGERAKAN_SESI_BELUM_DITANDAI) karena ada pergerakan baru yang belum diputuskan", tolak.status === 409 && tolak.body.code === "PERGERAKAN_SESI_BELUM_DITANDAI" && /2 pergerakan/.test(tolak.body.error), `${tolak.status} ${tolak.body?.error}`);
  cek("S3 tidak ada penyesuaian, ledger tidak bergeser, saldo tidak basi/berubah, sesi tetap menunggu tinjauan", (await hitungAdj(s.id)) === adj0 && (await prisma.stockMovement.count()) === mov0 && (await saldo(a)) === sebelum.a && (await saldo(b)) === sebelum.b && (await prisma.stockCount.findUnique({ where: { id: s.id } })).status === "WAITING_REVIEW");
  const d2 = await detail(s.id); const baruA = tj(d2, a).transaksi.sejakPengamatan.find((x) => x.id !== g0.id), baruB = tj(d2, b).transaksi.sejakPengamatan[0];
  cek("S3 tidak ada keputusan bawaan: GR baru (BERTANGGAL_MUNDUR) dan MI baru (SESUDAH_DISIMPAN) bertanda null; keputusan lama tetap", baruA.tanda === null && baruB.tanda === null && baruA.kelas === "BERTANGGAL_MUNDUR" && baruB.kelas === "SESUDAH_DISIMPAN" && d2.sesi.belumDitandai === 2);
  cek("S3 penolakan berulang tetap menolak", (await P(U.O, `${SC}/${s.id}/complete`, {})).status === 409);
  await P(U.C, `${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false }); cek("S3 GR bertanggal mundur masih menahan (tidak ikut massal)", (await P(U.O, `${SC}/${s.id}/complete`, {})).status === 409);
  await tandai(U.C, s.id, baruA.id, false); const sel = await P(U.O, `${SC}/${s.id}/complete`, {}); const adj = await prisma.stockMovement.findMany({ where: { stockCountId: s.id } });
  cek("S3 setelah diputuskan Selesaikan lulus: TEPAT SATU penyesuaian (−3 pada b); saldo a = fisik + GR 20 + GR 15; saldo b = fisik − MI 6", sel.status === 200 && adj.length === 1 && adj[0].materialId === b && Number(adj[0].qty) === -3 && (await saldo(a)) === sa + 35 && (await saldo(b)) === sb - 9 && (await saldo(c)) === sc, `${sel.status} adj=${adj.length}`);
  const ulang = await P(U.O, `${SC}/${s.id}/complete`, {}); cek("S3 klik ganda Selesaikan: ulang:true, tetap satu penyesuaian, satu audit posting", ulang.body.ulang === true && (await hitungAdj(s.id)) === 1 && (await prisma.activityEvent.count({ where: { entityId: s.id, eventType: "DOCUMENT_POSTED" } })) === 1);
});

// S4 — konkurensi: (a) transaksi memegang kunci saat Selesaikan; (b) transaksi bersamaan tepat saat Selesaikan, 3 ronde
await skenario("S4a kunci", async () => {
  const ids = pakai(3).map((x) => x.id); const { s, L } = await sesiItems(ids); const base = await Promise.all(ids.map(saldo));
  await simpan(s.id, ids.map((m, i) => ({ lineId: L[m].id, revision: 0, countedQty: base[i] - 2, observedAt: iso(menitLalu(30)) }))); for (const m of ids) await PA(U.A, `${SC}/${s.id}/lines/${L[m].id}`, { reason: "rehearsal selisih" });
  await P(U.A, `${SC}/${s.id}/submit`, {}); await periksa(s.id);
  let lepas; const gerbang = new Promise((r) => { lepas = r; }); const tahan = prisma.$transaction(async (tx) => { await postStockMovement(tx, { materialId: ids[1], type: "RECEIPT", qty: 7, note: "rehearsal memegang kunci" }); await gerbang; }, { timeout: 30000, maxWait: 30000 });
  await tidur(400); const pc = P(U.O, `${SC}/${s.id}/complete`, {}); const status = await Promise.race([pc.then(() => "selesai"), tidur(1500).then(() => "menunggu")]);
  cek("S4a Selesaikan MENUNGGU kunci bahan (tidak memakai saldo lama)", status === "menunggu"); lepas(); await tahan; const h1 = await pc;
  cek("S4a setelah transaksi commit, Selesaikan menolak sampai pergerakan itu diputuskan; tidak menulis apa pun", h1.status === 409 && h1.body.code === "PERGERAKAN_SESI_BELUM_DITANDAI" && (await hitungAdj(s.id)) === 0);
  await P(U.C, `${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false }); const h2 = await P(U.O, `${SC}/${s.id}/complete`, {});
  cek("S4a setelah diputuskan lulus: 3 penyesuaian −2 tepat sekali; saldo akhir = fisik + 7 pada bahan yang diposting", h2.status === 200 && (await hitungAdj(s.id)) === 3 && (await saldo(ids[1])) === base[1] - 2 + 7 + 0 && (await saldo(ids[0])) === base[0] - 2, `${h2.status}`);
});
await skenario("S4b serentak", async () => {
  const post = (m, q) => prisma.$transaction((tx) => postStockMovement(tx, { materialId: m, type: "RECEIPT", qty: q, note: "rehearsal serentak dengan Selesaikan" }), { timeout: 30000 }); let ronde409 = 0;
  for (let r = 0; r < 3; r++) {
    const ids = pakai(3).map((x) => x.id); const { s, L } = await sesiItems(ids); const base = await Promise.all(ids.map(saldo));
    await simpan(s.id, ids.map((m, i) => ({ lineId: L[m].id, revision: 0, countedQty: base[i] - 2, observedAt: iso(menitLalu(30)) }))); for (const m of ids) await PA(U.A, `${SC}/${s.id}/lines/${L[m].id}`, { reason: "rehearsal selisih" });
    await P(U.A, `${SC}/${s.id}/submit`, {}); await periksa(s.id); const nol = (await detail(s.id)).sesi.belumDitandai;
    const [rc] = await Promise.all([P(U.O, `${SC}/${s.id}/complete`, {}), post(ids[0], 3), post(ids[1], 4), post(ids[2], 5)]);
    if (rc.status === 409) { ronde409 += 1; await P(U.C, `${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false }); const lagi = await P(U.O, `${SC}/${s.id}/complete`, {}); cek(`S4b ronde ${r}: 409 lalu diputuskan lalu lulus`, lagi.status === 200); } else cek(`S4b ronde ${r}: Selesaikan lebih dulu, transaksi menyusul`, rc.status === 200);
    const tambah = [3, 4, 5]; const sesuai = (await Promise.all(ids.map(saldo))).every((v, i) => v === base[i] - 2 + tambah[i]); const adj = await prisma.stockMovement.findMany({ where: { stockCountId: s.id } });
    const tAdj = Math.min(...adj.map((a) => a.createdAt.getTime())); const posting = await prisma.stockMovement.findMany({ where: { materialId: { in: ids }, note: "rehearsal serentak dengan Selesaikan" } });
    const tanda = (await prisma.activityEvent.findMany({ where: { entityId: s.id, eventType: "DOCUMENT_EDITED" } })).filter((e) => e.metadata?.aksi === "PERGERAKAN_SESI_DITANDAI").map((e) => e.metadata.movementId);
    const konsisten = posting.every((p) => (p.createdAt.getTime() < tAdj ? tanda.includes(p.id) : !tanda.includes(p.id)));
    cek(`S4b ronde ${r}: saldo akhir = fisik + posting; tepat 3 penyesuaian; tiap posting sebelum penyesuaian punya keputusan, yang menyusul tidak mendapat keputusan bawaan; awal tanpa tanda=${nol}`, sesuai && adj.length === 3 && adj.every((a) => Number(a.qty) === -2) && konsisten, `sesuai=${sesuai} adj=${adj.length} konsisten=${konsisten}`);
  }
  console.log(`INFO S4b ronde dengan 409 = ${ronde409} dari 3`);
});

// S5 — klik ganda: Mulai hitung, simpan, tanda, Selesaikan
await skenario("S5 klik ganda", async () => {
  const [a] = pakai(1).map((x) => x.id); const s = (await P(U.A, SC, { mode: "ITEMS", materialIds: [a], blindCount: true })).body; await P(U.A, `${SC}/${s.id}/start`, {}); await prisma.stockCount.update({ where: { id: s.id }, data: { startedAt: menitLalu(360) } });
  const L = (await G(U.A, `${SC}/${s.id}/kerja`)).body.baris[0]; const [m1, m2] = await Promise.all([P(U.A, `${SC}/${s.id}/lines/mulai`, { lineIds: [L.id] }), P(U.B, `${SC}/${s.id}/lines/mulai`, { lineIds: [L.id] })]);
  const st = [m1.body.hasil[0].status, m2.body.hasil[0].status].sort(); cek("S5 Mulai hitung ganda/bersamaan: satu DIMULAI dan satu SUDAH_DIMULAI, waktu tidak bergeser", st[0] === "DIMULAI" && st[1] === "SUDAH_DIMULAI" && m1.body.hasil[0].observedAt === m2.body.hasil[0].observedAt);
  const sa = await saldo(a); const [p1, p2] = await Promise.all([simpan(s.id, [{ lineId: L.id, revision: 0, countedQty: sa }]), simpan(s.id, [{ lineId: L.id, revision: 0, countedQty: sa }])]);
  cek("S5 simpan ganda dengan revisi sama: satu DISIMPAN, satu KONFLIK (tidak dua kali simpan)", [p1.body.hasil[0].status, p2.body.hasil[0].status].sort().join() === "DISIMPAN,KONFLIK");
  await P(U.A, `${SC}/${s.id}/submit`, {}); await periksa(s.id); const [c1, c2] = await Promise.all([P(U.O, `${SC}/${s.id}/complete`, {}), P(U.O, `${SC}/${s.id}/complete`, {})]);
  cek("S5 Selesaikan ganda bersamaan: keduanya 200, tepat satu eksekusi (satu audit posting, nol/satu penyesuaian)", c1.status === 200 && c2.status === 200 && (await prisma.activityEvent.count({ where: { entityId: s.id, eventType: "DOCUMENT_POSTED" } })) === 1 && (await hitungAdj(s.id)) === 0 && [c1.body.ulang, c2.body.ulang].filter(Boolean).length === 1);
});

// S6 — Opname Penuh nyata pada data restore: cakupan dilacak, simpan 200 baris/permintaan, Selesaikan; fisik = saldo (tidak negatif)
await skenario("S6 sesi penuh", async () => {
  const aktif = Number((await prisma.$queryRawUnsafe("select count(*)::int n from materials where active"))[0].n); const pr = await P(U.A, `${SC}/scope-preview`, { mode: "FULL" }); const r = pr.body.ringkasan;
  cek("S6 pratinjau: masuk + tidak dilacak = seluruh bahan aktif", pr.status === 200 && r.masuk + r.tidakDilacak.jumlah === aktif, `masuk=${r?.masuk} tak dilacak=${r?.tidakDilacak?.jumlah} aktif=${aktif}`);
  if (process.env.EXPECT_MASUK) cek(`S6 jumlah bahan masuk = perkiraan preflight (${process.env.EXPECT_MASUK})`, r.masuk === Number(process.env.EXPECT_MASUK));
  const t0 = Date.now(); const c = await P(U.A, SC, { mode: "FULL", blindCount: true }); cek("S6 sesi penuh dibuat sekali pilih", c.status === 201 && c.body.jumlahBahan === r.masuk && Date.now() - t0 < 15000, `${c.status} ${Date.now() - t0}ms`); const id = c.body.id;
  cek("S6 sesi penuh kedua ditolak (409)", (await P(U.A, SC, { mode: "FULL" })).status === 409);
  await P(U.A, `${SC}/${id}/start`, {}); await prisma.stockCount.update({ where: { id }, data: { startedAt: menitLalu(360) } }); const k = (await G(U.A, `${SC}/${id}/kerja`)).body;
  const sal = new Map((await prisma.$queryRaw`SELECT material_id AS id, COALESCE(SUM(qty),0)::float AS s FROM stock_movements GROUP BY material_id`).map((x) => [x.id, x.s])); const O = iso(new Date()); const t1 = Date.now(); let berselisih = 0; // dihitung SEKARANG: pergerakan skenario S1–S5 yang lebih awal sudah ada saat barang dihitung (otomatis masuk pembanding)
  for (let i = 0; i < k.baris.length; i += 200) { const items = k.baris.slice(i, i + 200).map((b) => { const sa = sal.get(b.materialId) ?? 0; if (sa < 0) berselisih += 1; return { lineId: b.id, revision: 0, countedQty: Math.max(0, sa), observedAt: O }; }); const rr = await simpan(id, items); if (rr.status !== 200) throw new Error("simpan " + JSON.stringify(rr.body)); }
  cek(`S6 ${k.baris.length} bahan disimpan bertahap (≤200/permintaan)`, true, `${Date.now() - t1}ms; saldo minus (butuh alasan) = ${berselisih}`);
  for (const b of k.baris) if ((sal.get(b.materialId) ?? 0) < 0) await PA(U.C, `${SC}/${id}/lines/${b.id}`, { reason: "rehearsal: saldo minus lama dikoreksi ke fisik" });
  const sub = await P(U.A, `${SC}/${id}/submit`, {}); cek("S6 hitungan diserahkan", sub.status === 200, sub.body?.error); cek("S6 pemeriksa (petugas lain) memeriksa", await periksa(id));
  const d = (await G(U.B, `${SC}/${id}`)).body; cek("S6 tidak ada pergerakan sejak dihitung yang menunggu", d.sesi.belumDitandai === 0, d.sesi.belumDitandai);
  const t2 = Date.now(); const sel = await P(U.O, `${SC}/${id}/complete`, {}); const adj = await hitungAdj(id);
  cek("S6 Selesaikan sesi penuh lulus; jumlah penyesuaian = jumlah bahan bersaldo minus; semua saldo ≥ 0 sesudahnya untuk bahan sesi", sel.status === 200 && adj === berselisih, `${sel.status} ${sel.body?.error ?? ""} adj=${adj} minus=${berselisih} ${Date.now() - t2}ms`);
  const sesudah = new Map((await prisma.$queryRaw`SELECT material_id AS id, COALESCE(SUM(qty),0)::float AS s FROM stock_movements GROUP BY material_id`).map((x) => [x.id, x.s]));
  cek("S6 saldo akhir tiap bahan sesi = fisik (Math.max(0, saldo awal))", k.baris.every((b) => Math.abs((sesudah.get(b.materialId) ?? 0) - Math.max(0, sal.get(b.materialId) ?? 0)) < 1e-6));
});

// S7 — sesi terbuka dibiarkan supaya guard rollback dapat diuji dari luar (harus menolak); fase "tutup" membatalkannya
await skenario("S7 sesi terbuka untuk guard", async () => { const [a] = pakai(1).map((x) => x.id); const { s } = await sesiItems([a]); cek("S7 sesi model baru terbuka (IN_PROGRESS) dibiarkan untuk uji guard rollback", !!s.id); });

// catatan: GR resmi pada skenario dapat membuat jurnal persediaan (alur Penerimaan yang sudah ada); penyesuaian opname sendiri tidak menulis jurnal
const jeAkhir = Number((await prisma.$queryRawUnsafe("select count(*)::int n from fin_journal_entries"))[0].n);
console.log(`INFO jurnal Finance di DB rehearsal: ${sebelumTotal.je} → ${jeAkhir} (selisih dari GR resmi skenario)`);
console.log(`RH_SKENARIO gagal=${gagal}`); await prisma.$disconnect(); process.exit(gagal ? 1 : 0);
