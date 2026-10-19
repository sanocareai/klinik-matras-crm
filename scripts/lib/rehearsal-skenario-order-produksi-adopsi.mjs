// REHEARSAL PENUH Order Produksi adopsi Admin — dijalankan DI DALAM container image kandidat terhadap KLON DB rehearsal (hasil restore backup production, SUDAH dimigrasi). TIDAK pernah menyentuh database production.
// Server yang dipakai adalah app Express MINIMAL (buildTestApp: router asli tanpa cron/worker/WAHA/Socket.IO) — TIDAK memuat src/index.js, jadi tidak ada pesan WhatsApp, job, atau efek samping luar.
// Pagar: nama database WAJIB mengandung "test" (tests/integration/setup/env.js); skrip rilis menamai DB rehearsal rehearsal_opa_test_*.
// FASE (env FASE): smoke | skenario
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
await import("/app/tests/integration/setup/env.js");
const { prisma } = await import("/app/src/db.js");
const { buildTestApp, startTestServer } = await import("/app/tests/integration/setup/testApp.js");
const FASE = process.env.FASE || "skenario";
const PR = "/api/production";
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d !== "" ? " — " + String(d).slice(0, 240) : ""}`); };
const sv = await startTestServer(buildTestApp()); const base = sv.baseUrl;

async function pengguna(nama, roles) {
  const email = `rh-${nama}@rehearsal.invalid`; let u = await prisma.user.findUnique({ where: { email } });
  if (!u) u = await prisma.user.create({ data: { name: `Rehearsal ${nama}`, email, passwordHash: "x", role: roles[0] } });
  return { user: u, token: jwt.sign({ id: u.id, name: u.name, role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: "6h" }) };
}
const U = { A: await pengguna("admin-a", ["ADMIN"]), S: await pengguna("sales-s", ["SALES"]), W: await pengguna("worker-w", ["PRODUCTION_WORKER"]) };
async function call(u, method, path, body, headers = {}) {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(u ? { Authorization: "Bearer " + u.token } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j, headers: r.headers };
}
const G = (u, p) => call(u, "GET", p); const P = (u, p, b = {}, h) => call(u, "POST", p, b, h); const PU = (u, p, b) => call(u, "PUT", p, b); const PA = (u, p, b) => call(u, "PATCH", p, b); const D = (u, p) => call(u, "DELETE", p);
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const efek = async () => ({
  sm: await n("select count(*)::int n from stock_movements"), job: await n("select count(*)::int n from jobs"), run: await n("select count(*)::int n from production_runs_v2"), qc: await n("select count(*)::int n from quality_inspections_v2"),
  jur: await n("select count(*)::int n from fin_journal_entries"), stg: await n("select count(*)::int n from unit_stage_logs"), cust: await n("select count(*)::int n from unit_custody_handoffs_v2"), rsv: await n("select count(*)::int n from material_reservations_v2"), mi: await n("select count(*)::int n from material_issues"),
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (FASE === "smoke") { // smoke baca-saja (lib terpisah) terhadap server sementara
  const kode = await new Promise((res) => { const c = spawn(process.execPath, ["/rh/smoke-order-produksi-adopsi.mjs"], { env: { ...process.env, SMOKE_BASE: base }, stdio: "inherit" }); c.on("exit", res); });
  console.log(`RH_SMOKE kode=${kode}`); await sv.close(); process.exit(kode === 0 ? 0 : 1);
}

// ═════════ SKENARIO (menulis ke KLON DB rehearsal; dibuang di akhir) ═════════
const jumlahUnit0 = await n("select count(*)::int n from units");
cek("klon rehearsal memuat data production nyata (unit + bahan + pergerakan stok)", jumlahUnit0 > 0 && (await n("select count(*)::int n from materials")) > 0 && (await n("select count(*)::int n from stock_movements")) > 0, `unit=${jumlahUnit0}`);

// Bahan nyata dengan saldo positif (untuk rencana + pemakaian aktual), dua kelompok berbeda bila ada
const kat = await G(U.A, `${PR}/material-catalog?limit=300`);
cek("katalog bahan nyata: terbaca, per kelompok Gudang", kat.status === 200 && kat.body.rows.length > 0, `bahan=${kat.body?.total}`);
const berStok = kat.body.rows.filter((r) => r.saldoDiketahui && Number(r.tersedia) >= 5);
const m1 = berStok[0]; const m2 = berStok.find((r) => r.kelompok.kode !== m1?.kelompok.kode) ?? berStok[1];
cek("ada bahan nyata ber-stok untuk skenario (min. 2)", !!m1 && !!m2, `${m1?.kode} / ${m2?.kode}`);
const saldo = async (id) => Number((await prisma.$queryRawUnsafe(`select coalesce(sum(qty),0)::float8 s from stock_movements where material_id = '${id}'`))[0].s);

// Unit sintetis (di KLON) untuk skenario yang mengubah status order / bukti aplikasi
const cust = await prisma.customer.create({ data: { name: "Rehearsal Pelanggan Sintetis" } });
const ord = await prisma.order.create({ data: { customerId: cust.id, orderNumber: `RH-OPA-${Date.now()}`, value: 100, category: "LAYANAN", status: "PROCESSING", deliveryConfirmedDate: new Date(Date.now() + 5 * 864e5), pickupConfirmedDate: new Date(), items: { create: [{ layananName: "Service Fondasi", harga: 100, sortOrder: 1 }] } } });
const uS = await prisma.unit.create({ data: { unitCode: `RH-OPA-U-${Date.now() % 1e6}`, orderId: ord.id, seq: 1, status: "RECEIVED" } });
// Unit NYATA (bila ada) yang belum dikerjakan lewat aplikasi: dipakai untuk catatan manual + rencana pada data production sungguhan
const daftar = await G(U.A, `${PR}/work-orders?pageSize=200`);
const nyata = (daftar.body?.units ?? []).find((u) => !["CANCELLED", "DELIVERED"].includes(u.status) && !u.adopsi.buktiAplikasi && u.id !== uS.id && !String(u.unitCode).startsWith("RH-OPA"));

async function skenarioUnit(label, unit, { orderId }) {
  const e0 = await efek();
  const p0 = await G(U.A, `${PR}/units/${unit.id}/adopsi`);
  cek(`${label}: panel unit terbaca (tiga status + tindakan berikutnya)`, p0.status === 200 && p0.body.adopsi.statusOrder.label && p0.body.adopsi.posisi.key && p0.body.adopsi.kerja.key && p0.body.adopsi.tindakan.label, p0.status);
  // status kerja manual — tanpa bukti palsu
  const r1 = await P(U.A, `${PR}/units/${unit.id}/work-progress`, { status: "DIKERJAKAN", note: "Rehearsal: dikerjakan Admin tanpa aplikasi Meja", expectedLatestId: p0.body.kerjaManual.terakhirId });
  cek(`${label}: catat status kerja manual → 201`, r1.status === 201 && r1.body.dicatat === true, `${r1.status} ${JSON.stringify(r1.body).slice(0, 90)}`);
  const e1 = await efek();
  cek(`${label}: catatan manual TIDAK membuat stok/job/Run/QC/jurnal/tahap/serah/reservasi/Material Issue`, same(e0, e1), JSON.stringify(e1));
  const p1 = await G(U.A, `${PR}/units/${unit.id}/adopsi`);
  cek(`${label}: status kerja = Dikerjakan, sumber MANUAL, 'Dicatat manual oleh <nama>' + waktu`, p1.body.adopsi.kerja.key === "DIKERJAKAN" && p1.body.adopsi.kerja.source === "MANUAL" && /Dicatat manual oleh Rehearsal admin-a, .* WIB/.test(p1.body.adopsi.kerja.detail), p1.body.adopsi.kerja.detail);
  const r2 = await P(U.A, `${PR}/units/${unit.id}/work-progress`, { status: "DIKERJAKAN", note: "Rehearsal: dikerjakan Admin tanpa aplikasi Meja" });
  cek(`${label}: ulang persis sama → tidak menulis lagi`, r2.status === 200 && r2.body.dicatat === false);
  const k = await P(U.A, `${PR}/units/${unit.id}/work-progress`, { status: "SELESAI", expectedLatestId: p0.body.kerjaManual.terakhirId });
  cek(`${label}: riwayat yang dilihat basi → 409 RIWAYAT_BERUBAH (tanpa menulis)`, k.status === 409 && k.body.code === "RIWAYAT_BERUBAH", `${k.status}`);
  // rencana bahan vs pemakaian aktual
  const s0 = [await saldo(m1.materialId), await saldo(m2.materialId)]; const ef = await efek();
  const pl1 = await PU(U.A, `${PR}/units/${unit.id}/material-plan`, { expectedRevision: 0, lines: [{ materialId: m1.materialId, qty: 2 }, { materialId: m2.materialId, qty: 3 }] });
  cek(`${label}: simpan rencana bahan (2 bahan, kelompok ${m1.kelompok.label}/${m2.kelompok.label}) → 200 revisi 1`, pl1.status === 200 && pl1.body.rencana.plan.revision === 1 && pl1.body.rencana.plan.lines.length === 2, pl1.status);
  cek(`${label}: rencana TIDAK mengubah stok/reservasi/jurnal (saldo bahan + semua tabel efek identik)`, same(await efek(), ef) && same(s0, [await saldo(m1.materialId), await saldo(m2.materialId)]));
  const pl2 = await PU(U.A, `${PR}/units/${unit.id}/material-plan`, { expectedRevision: 0, lines: [{ materialId: m1.materialId, qty: 9 }] });
  cek(`${label}: revisi bentrok (revisi yang dilihat basi) → 409 RIWAYAT_BERUBAH`, pl2.status === 409 && pl2.body.code === "RIWAYAT_BERUBAH", pl2.status);
  const pl3 = await PU(U.A, `${PR}/units/${unit.id}/material-plan`, { expectedRevision: 1, reason: "Rehearsal: tambah busa", lines: [{ materialId: m1.materialId, qty: 4 }, { materialId: m2.materialId, qty: 3 }] });
  cek(`${label}: revisi 2 dengan riwayat perubahan`, pl3.status === 200 && pl3.body.rencana.plan.revision === 2 && pl3.body.rencana.revisi.length === 2 && pl3.body.rencana.revisi[1].perubahan.some((c) => c.aksi === "UBAH"), pl3.status);
  // pemakaian aktual: tepat sekali (kunci sama, serentak, isian beda)
  const RUN = Date.now().toString(36); const K1 = `rh-opa-${unit.id.slice(0, 8)}-${RUN}-aaaa-0001`; const m = { materialId: m1.materialId, qty: 1, note: "Rehearsal pemakaian" };
  const a1 = await call(U.A, "POST", `/api/units/${unit.id}/materials`, m, { "Idempotency-Key": K1 });
  cek(`${label}: pemakaian aktual → 201, satu pergerakan ISSUE bertaut unit + pelaku`, a1.status === 201 && a1.body.type === "ISSUE" && a1.body.unitId === unit.id && a1.body.createdById === U.A.user.id, a1.status);
  const a2 = await call(U.A, "POST", `/api/units/${unit.id}/materials`, m, { "Idempotency-Key": K1 });
  cek(`${label}: kirim ulang (klik ganda/retry) kunci sama → 200 Idempotent-Replay, pergerakan sama`, a2.status === 200 && a2.headers.get("idempotent-replay") === "true" && a2.body.id === a1.body.id);
  const K2 = `rh-opa-${unit.id.slice(0, 8)}-${RUN}-bbbb-0002`;
  const [b1, b2] = await Promise.all([call(U.A, "POST", `/api/units/${unit.id}/materials`, m, { "Idempotency-Key": K2 }), call(U.A, "POST", `/api/units/${unit.id}/materials`, m, { "Idempotency-Key": K2 })]);
  cek(`${label}: dua permintaan BERSAMAAN kunci sama → tepat satu pergerakan`, [b1.status, b2.status].filter((s) => s === 201).length === 1 && (await n(`select count(*)::int n from stock_movements where unit_id = '${unit.id}' and type::text = 'ISSUE'`)) === 2, `${b1.status}/${b2.status}`);
  const c1 = await call(U.A, "POST", `/api/units/${unit.id}/materials`, { ...m, qty: 7 }, { "Idempotency-Key": K1 });
  cek(`${label}: kunci sama dengan isian berbeda → 409 IDEMPOTENCY_KEY_REUSED`, c1.status === 409 && c1.body.code === "IDEMPOTENCY_KEY_REUSED", c1.status);
  cek(`${label}: stok berkurang TEPAT 2 (dua pemakaian aktual), bukan karena rencana`, Math.abs((s0[0] - await saldo(m1.materialId)) - 2) < 1e-6, `${s0[0]} → ${await saldo(m1.materialId)}`);
  const p2 = await G(U.A, `${PR}/units/${unit.id}/adopsi`);
  const cmp = p2.body.perbandingan.find((x) => x.materialId === m1.materialId);
  cek(`${label}: panel membandingkan rencana (4) vs aktual (2) dengan dokumen sumber + pelaku`, cmp?.rencana === 4 && cmp?.aktual === 2 && p2.body.pemakaianAktual.baris.every((b) => b.dokumen?.jenis && b.pelaku), JSON.stringify(cmp));
  // akun hanya-lihat
  const v = await G(U.S, `${PR}/units/${unit.id}/adopsi`);
  cek(`${label}: Sales (hanya-lihat) membaca panel tetapi izin tulis kerja/rencana/aktual = false`, v.status === 200 && v.body.izin.statusKerja === false && v.body.izin.rencanaBahan === false && v.body.izin.pemakaianAktual === false);
  cek(`${label}: Sales tidak bisa mencatat status kerja / rencana → 403`, (await P(U.S, `${PR}/units/${unit.id}/work-progress`, { status: "SELESAI" })).status === 403 && (await PU(U.S, `${PR}/units/${unit.id}/material-plan`, { expectedRevision: 2, lines: [] })).status === 403);
  // hapus unit/order = ditolak ramah (jejak operasional)
  const del = await D(U.A, `/api/orders/units/${unit.id}`);
  cek(`${label}: hapus unit yang punya jejak → 409 (bukan 500)`, del.status === 409, del.status);
  // ekspor xlsx memuat unit ini
  const ex = await fetch(base + `${PR}/work-orders/export.xlsx`, { headers: { Authorization: "Bearer " + U.A.token } }); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ex.arrayBuffer()));
  const ws = wb.getWorksheet("Ringkasan Unit"); const hdr = ws.getRow(1).values.slice(1); const iK = hdr.indexOf("Kode Unit") + 1; const iS = hdr.indexOf("Status Kerja") + 1; const iSum = hdr.indexOf("Sumber Status Kerja") + 1; let br = null;
  ws.eachRow((row, i) => { if (i > 1 && String(row.getCell(iK).value) === p0.body.unit.unitCode) br = row; });
  cek(`${label}: ekspor xlsx memuat unit ini dengan Status Kerja Dikerjakan + sumber Dicatat manual`, !!br && /Dikerjakan/.test(String(br.getCell(iS).value)) && /manual/i.test(String(br.getCell(iSum).value)), br ? `${br.getCell(iS).value}|${br.getCell(iSum).value}` : "baris tidak ada");
  return p2;
}

if (m1 && m2) {
  await skenarioUnit("SINTETIS", uS, { orderId: ord.id });
  if (nyata) await skenarioUnit(`NYATA ${nyata.unitCode}`, nyata, { orderId: nyata.order?.id });
  else console.log("INFO tidak ada unit nyata yang belum dikerjakan lewat aplikasi di data restore; skenario unit nyata dilewati");
}

// status order dari Produksi = jalur Sales/Delivery yang SAMA (unit sintetis)
{
  const jobSebelum = await n(`select count(*)::int n from jobs where order_id = '${ord.id}'`);
  const r = await PA(U.A, `/api/orders/${ord.id}`, { status: "READY", statusOverrideNote: "Rehearsal: diubah dari Order Produksi" });
  cek("STATUS ORDER dari Produksi: PATCH /api/orders (jalur Sales) → 200 READY", r.status === 200 && r.body.status === "READY", `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
  const u = await prisma.unit.findUnique({ where: { id: uS.id } });
  cek("status unit ikut Siap Kirim; tepat satu job pengiriman terbentuk (bukan ganda)", u.status === "READY_FOR_DELIVERY" && (await n(`select count(*)::int n from jobs where order_id = '${ord.id}'`)) === jobSebelum + 1, `unit=${u.status}`);
  const sales = await G(U.S, `/api/orders?search=${ord.orderNumber}`); const dt = sales.body; const arr = Array.isArray(dt) ? dt : (dt.items ?? dt.orders ?? dt.data ?? []);
  cek("Sales melihat status yang SAMA (READY) untuk order yang diubah dari Produksi", arr.find((o) => o.id === ord.id)?.status === "READY");
  const p = await G(U.A, `${PR}/units/${uS.id}/adopsi`);
  cek("Produksi: status order Siap Kirim → status kerja efektif Selesai (mengikuti status order; catatan manual 'Dikerjakan' tetap di riwayat, tidak bertentangan)", p.body.adopsi.statusOrder.label === "Siap Kirim" && p.body.adopsi.kerja.key === "SELESAI" && p.body.adopsi.kerja.source === "STATUS_ORDER" && p.body.kerjaManual.riwayat.length === 1, `${p.body.adopsi.statusOrder.label}/${p.body.adopsi.kerja.key}/${p.body.adopsi.kerja.source}`);
}
// bukti aplikasi menang: setelah ada log tahap nyata, catatan manual baru DITOLAK dan status kerja mengikuti aplikasi
{
  const cust2 = await prisma.customer.create({ data: { name: "Rehearsal Pelanggan Aplikasi" } });
  const ord2 = await prisma.order.create({ data: { customerId: cust2.id, orderNumber: `RH-OPA2-${Date.now()}`, value: 100, category: "LAYANAN", status: "PROCESSING", items: { create: [{ layananName: "Service Fondasi", harga: 100, sortOrder: 1 }] } } });
  const u2 = await prisma.unit.create({ data: { unitCode: `RH-OPA-V-${Date.now() % 1e6}`, orderId: ord2.id, seq: 1, status: "IN_PRODUCTION" } });
  const stage = await prisma.routingStage.findFirst({ orderBy: { code: "asc" } });
  await G(U.A, `${PR}/units/${u2.id}/adopsi`);
  await prisma.unitStageLog.create({ data: { unitId: u2.id, stageId: stage.id, action: "START", actorId: U.W.user.id, startedAt: new Date() } });
  const r = await P(U.A, `${PR}/units/${u2.id}/work-progress`, { status: "SELESAI", expectedLatestId: null });
  cek("bukti aplikasi ada → catatan manual DITOLAK 409 KERJA_DIPEGANG_APLIKASI (satu unit tidak punya dua status kerja)", r.status === 409 && r.body.code === "KERJA_DIPEGANG_APLIKASI", `${r.status} ${r.body?.code}`);
  const p = await G(U.A, `${PR}/units/${u2.id}/adopsi`);
  cek("status kerja efektif bersumber APLIKASI; panel menandai kerja dikunci aplikasi", p.body.adopsi.kerja.source === "APLIKASI" && p.body.kerjaManual.dikunciAplikasi === true, `${p.body.adopsi.kerja.key}/${p.body.adopsi.kerja.source}`);
}
// daftar akhir tetap konsisten: satu status kerja per unit, total = tabel units
{
  const d = await G(U.A, `${PR}/work-orders?pageSize=200`); const total = await n("select count(*)::int n from units");
  cek("daftar akhir: total = jumlah unit, tiap unit tepat satu status kerja berkamus", d.status === 200 && d.body.total === total && d.body.units.every((u) => u.adopsi.kerja.key && u.adopsi.statusOrder.label), `${d.body.total}/${total}`);
}
console.log(`INFO data klon: unit=${jumlahUnit0}; bahan skenario=${m1?.kode}/${m2?.kode}; unit nyata=${nyata?.unitCode ?? "-"}`);
console.log(`RH_SKENARIO gagal=${gagal}`);
await sv.close(); await prisma.$disconnect(); process.exit(gagal ? 1 : 0);
