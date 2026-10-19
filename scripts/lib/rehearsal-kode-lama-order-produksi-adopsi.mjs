// ROLLBACK KODE terbukti pada data: dijalankan DI DALAM image LAMA (baseline live, TANPA kode adopsi) terhadap KLON DB rehearsal yang SUDAH berisi data adopsi (status kerja manual, rencana bahan + revisi, pemakaian aktual beridempotensi).
// Membuktikan kode lama TIDAK salah membaca data baru: bacaan lama (daftar Order Produksi, riwayat unit, bahan unit, daftar order, saldo stok) tetap 200 dan isinya benar; stok tidak berubah. Satu probe tulis pada KLON:
// hapus unit berjejak lewat jalur lama → dicatat apa adanya (kode lama tidak tahu itu jejak); data harus tetap utuh. Server = app Express MINIMAL image lama (tanpa cron/worker/WAHA). Pagar: nama DB wajib mengandung "test".
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

// kondisi: klon memang berisi data adopsi, dan image ini benar-benar LAMA (tidak punya rute adopsi)
const unitIds = (await prisma.$queryRawUnsafe("select distinct unit_id::text id from production_unit_work_progress union select unit_id::text from production_unit_material_plans")).map((x) => x.id);
cek("klon berisi data adopsi (status kerja manual + rencana bahan)", unitIds.length >= 1 && (await n("select count(*)::int n from production_unit_material_plan_revisions")) >= 1, `unit berjejak=${unitIds.length}`);
cek("image ini LAMA: rute adopsi tidak ada (404)", (await call("GET", `/api/production/units/${unitIds[0]}/adopsi`)).status === 404);
const sm0 = await n("select count(*)::int n from stock_movements"); const saldo0 = (await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float8 s from stock_movements"))[0].s;

// bacaan lama pada data baru
const wo = await call("GET", "/api/production/work-orders?pageSize=200");
cek("kode lama: daftar Order Produksi tetap 200 dan memuat semua unit", wo.status === 200 && wo.body.total === (await n("select count(*)::int n from units")), `${wo.status} total=${wo.body?.total}`);
cek("kode lama: unit berjejak adopsi terbaca normal di daftar (status turunan lama, tanpa galat)", unitIds.every((id) => wo.body.units.some((u) => u.id === id && u.globalStatus && u.unitStatusDisplay)));
for (const id of unitIds) {
  const tl = await call("GET", `/api/units/${id}/timeline`); cek(`kode lama: riwayat unit ${id.slice(0, 8)} → 200`, tl.status === 200, tl.status);
  const mt = await call("GET", `/api/units/${id}/materials`);
  const issue = (await n(`select count(*)::int n from stock_movements where unit_id = '${id}' and type::text = 'ISSUE'`));
  cek(`kode lama: bahan unit ${id.slice(0, 8)} → 200 dan memuat ${issue} pemakaian aktual (pergerakan stok resmi) apa adanya`, mt.status === 200 && JSON.stringify(mt.body).length > 2 && (issue === 0 || (Array.isArray(mt.body) ? mt.body : mt.body.rows ?? mt.body.items ?? mt.body.movements ?? []).length >= issue), `${mt.status} issue=${issue}`);
}
cek("kode lama: daftar order (Sales) → 200", (await call("GET", "/api/orders?limit=20")).status === 200);
cek("kode lama: bacaan tidak mengubah stok", (await n("select count(*)::int n from stock_movements")) === sm0 && (await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float8 s from stock_movements"))[0].s === saldo0);

// probe tulis (di klon): hapus unit berjejak lewat jalur LAMA — data harus tetap utuh apa pun jawabannya
const u0 = unitIds[0]; const prog0 = await n("select count(*)::int n from production_unit_work_progress");
const del = await call("DELETE", `/api/orders/units/${u0}`);
const ada = (await n(`select count(*)::int n from units where id = '${u0}'`)) === 1 && (await n("select count(*)::int n from production_unit_work_progress")) === prog0;
cek("kode lama: hapus unit berjejak ditolak (tidak 200) dan data TETAP utuh (FK RESTRICT + trigger append-only)", del.status !== 200 && ada, `status=${del.status}${del.status === 500 ? " (galat mentah: kode lama tidak tahu catatan adopsi itu jejak; tidak ada data hilang)" : ""}`);
console.log(`INFO rollback: hapus unit berjejak lewat kode lama → HTTP ${del.status}`);
console.log(`RH_KODE_LAMA gagal=${gagal}`);
await sv.close(); await prisma.$disconnect(); process.exit(gagal ? 1 : 0);
