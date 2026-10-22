// ROLLBACK KODE terbukti pada data: dijalankan DI DALAM image LAMA (baseline live, TANPA kode Rencana Produksi jadwal mingguan) terhadap KLON DB rehearsal yang SUDAH berisi jadwal Admin (jadwal ACTIVE/CLEARED/ADOPTED + riwayat + Run hasil aktivasi).
// Membuktikan kode lama TIDAK salah membaca data baru: bacaan lama (daftar Order Produksi, panel unit, daftar kerja, riwayat unit, bahan unit, daftar order, papan) tetap 200 dan isinya benar; stok dan Run tidak berubah. Satu probe tulis pada KLON:
// hapus unit berjejak jadwal lewat jalur lama → dicatat apa adanya (kode lama tidak tahu itu jejak); data harus tetap utuh (FK RESTRICT). Server = app Express MINIMAL image lama (tanpa cron/worker/WAHA). Pagar: nama DB wajib mengandung "test".
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
await import("/app/tests/integration/setup/env.js");
const { prisma } = await import("/app/src/db.js");
const { buildTestApp, startTestServer } = await import("/app/tests/integration/setup/testApp.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d !== "" ? " — " + String(d).slice(0, 220) : ""}`); };
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const sv = await startTestServer(buildTestApp()); const base = sv.baseUrl;
const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, select: { id: true, name: true } });
const token = jwt.sign({ id: adm.id, name: adm.name, role: "ADMIN", roles: ["ADMIN"] }, process.env.JWT_SECRET, { expiresIn: "1h" });
const call = async (method, path) => { const r = await fetch(base + path, { method, headers: { Authorization: "Bearer " + token } }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };

// kondisi: klon memang berisi jadwal Admin, dan image ini benar-benar LAMA (tidak punya rute Rencana Admin)
const unitIds = (await prisma.$queryRawUnsafe("select distinct unit_id::text id from production_unit_schedules")).map((x) => x.id);
cek("klon berisi data jadwal Admin (jadwal + riwayat)", unitIds.length >= 1 && (await n("select count(*)::int n from production_unit_schedule_events")) >= 1, `unit berjejak=${unitIds.length}`);
cek("image ini LAMA: rute Rencana Admin tidak ada (404)", (await call("GET", "/api/production/rencana/minggu")).status === 404 && (await call("GET", "/api/production/rencana/antrean")).status === 404 && (await call("POST", `/api/production/units/${unitIds[0]}/jadwal`)).status === 404);
const sm0 = await n("select count(*)::int n from stock_movements"); const saldo0 = (await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float8 s from stock_movements"))[0].s;
const run0 = await n("select count(*)::int n from production_runs_v2"); const sch0 = await n("select count(*)::int n from production_unit_schedules"); const ev0 = await n("select count(*)::int n from production_unit_schedule_events");

// bacaan lama pada data baru
const wo = await call("GET", "/api/production/work-orders?pageSize=200");
cek("kode lama: daftar Order Produksi tetap 200 dan memuat semua unit", wo.status === 200 && wo.body.total === (await n("select count(*)::int n from units")), `${wo.status} total=${wo.body?.total}`);
cek("kode lama: unit berjejak jadwal terbaca normal di daftar (tanpa galat)", unitIds.every((id) => wo.body.units.some((u) => u.id === id && u.globalStatus && u.unitStatusDisplay)));
const wl = await call("GET", "/api/production/work-list?pageSize=100");
cek("kode lama: daftar kerja Status Produksi tetap 200 (jadwal Admin diabaikan)", wl.status === 200 && Array.isArray(wl.body?.orders), String(wl.status));
for (const id of unitIds) {
  const tl = await call("GET", `/api/units/${id}/timeline`); cek(`kode lama: riwayat unit ${id.slice(0, 8)} → 200`, tl.status === 200, tl.status);
  const mt = await call("GET", `/api/units/${id}/materials`); cek(`kode lama: bahan unit ${id.slice(0, 8)} → 200`, mt.status === 200, mt.status);
  const ad = await call("GET", `/api/production/units/${id}/adopsi`); cek(`kode lama: panel unit ${id.slice(0, 8)} → 200 (kode lama tidak membaca jadwal Admin; tampil apa adanya)`, ad.status === 200 && !(ad.body?.adopsi && "jadwal" in ad.body.adopsi), ad.status);
}
cek("kode lama: daftar order (Sales) → 200", (await call("GET", "/api/orders?limit=20")).status === 200);
cek("kode lama: papan Produksi lama → 200", (await call("GET", "/api/production/board")).status === 200);
cek("kode lama: bacaan tidak mengubah stok, Run, maupun jadwal", (await n("select count(*)::int n from stock_movements")) === sm0 && (await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float8 s from stock_movements"))[0].s === saldo0 && (await n("select count(*)::int n from production_runs_v2")) === run0 && (await n("select count(*)::int n from production_unit_schedules")) === sch0 && (await n("select count(*)::int n from production_unit_schedule_events")) === ev0);

// probe tulis (di klon): hapus unit berjejak lewat jalur LAMA — data harus tetap utuh apa pun jawabannya
const u0 = unitIds[0];
const del = await call("DELETE", `/api/orders/units/${u0}`);
const ada = (await n(`select count(*)::int n from units where id = '${u0}'`)) === 1 && (await n("select count(*)::int n from production_unit_schedules")) === sch0 && (await n("select count(*)::int n from production_unit_schedule_events")) === ev0;
cek("kode lama: hapus unit berjejak jadwal ditolak (tidak 200) dan data TETAP utuh (FK RESTRICT + trigger append-only)", del.status !== 200 && ada, `status=${del.status}${del.status === 500 ? " (galat mentah: kode lama tidak tahu jadwal itu jejak; tidak ada data hilang)" : ""}`);
console.log(`INFO rollback: hapus unit berjejak lewat kode lama → HTTP ${del.status}`);
console.log(`RH_KODE_LAMA gagal=${gagal}`);
await sv.close(); await prisma.$disconnect(); process.exit(gagal ? 1 : 0);
