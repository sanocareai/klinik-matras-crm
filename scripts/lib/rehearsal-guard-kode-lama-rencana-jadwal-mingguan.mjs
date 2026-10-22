// REHEARSAL: kode LAMA (image baseline live, tanpa kode rilis ini) bekerja di KLON guard yang memuat jadwal Admin. Membuktikan dua hal:
//  (1) mengapa guard WAJIB menolak jadwal ACTIVE: kode lama tidak mengambil alih/menutup jadwal Admin saat unit diaktifkan ke Pelaksanaan Meja → dua sumber (rencana Meja + jadwal Admin ACTIVE) untuk satu unit;
//  (2) pada keadaan yang DIIZINKAN guard (ADOPTED sah, CLEARED): kode lama tidak membuat jadwal kedua — tabel jadwal tidak berubah sama sekali oleh kode lama.
// Hanya menulis di KLON (rencana Meja via API lama). Pagar: nama DB wajib mengandung "test" (env.js). Unit: RH-GRD-X (ADOPTED), RH-GRD-Y (CLEARED), RH-GRD-Z (ACTIVE).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
await import("/app/tests/integration/setup/env.js");
const { prisma } = await import("/app/src/db.js");
const { buildTestApp, startTestServer } = await import("/app/tests/integration/setup/testApp.js");
const { custodyHooks } = await import("/app/src/services/unitCustodyCommandService.js");
custodyHooks.unitReceivedAtWorkshop = () => {};
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d !== "" ? " — " + String(d).slice(0, 240) : ""}`); };
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const sv = await startTestServer(buildTestApp()); const base = sv.baseUrl;
const adm = await prisma.user.findUnique({ where: { email: "rh-grd-admin@rehearsal.invalid" } });
const token = jwt.sign({ id: adm.id, name: adm.name, role: "ADMIN", roles: ["ADMIN"] }, process.env.JWT_SECRET, { expiresIn: "1h" });
let seq = 0; const idem = () => ({ "Idempotency-Key": `rh-grd-lama-${Date.now().toString(36)}-${++seq}-${Math.floor(Math.random() * 1e6)}-aaaa` });
const call = async (method, path, body, headers = {}) => { const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
const dow = (k) => new Date(`${k}T00:00:00Z`).getUTCDay(); const add = (k, d) => new Date(new Date(`${k}T00:00:00Z`).getTime() + d * 86_400_000).toISOString().slice(0, 10);
const HK = (nn) => { let k = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); while (dow(k) === 0) k = add(k, 1); let c = 0; while (c < nn) { k = add(k, 1); if (dow(k) !== 0) c += 1; } return k; };
const U = async (tag) => prisma.unit.findUnique({ where: { unitCode: `RH-GRD-${tag}` } });
const [X, Y, Z] = [await U("X"), await U("Y"), await U("Z")];
const wc = await prisma.workCenter.findUnique({ where: { code: "RH-GRD-WC" } }); const op = await prisma.productionOperator.findFirst({ where: { primaryWorkCenterId: wc.id } });
const sidik = async () => JSON.stringify([await n("select count(*)::int n from production_unit_schedules"), await n("select count(*)::int n from production_unit_schedule_events"), (await prisma.$queryRawUnsafe("select md5(coalesce(string_agg(t::text, ',' order by id), '')) m from production_unit_schedules t"))[0].m, (await prisma.$queryRawUnsafe("select md5(coalesce(string_agg(t::text, ',' order by id), '')) m from production_unit_schedule_events t"))[0].m]);
const rencanaUnit = (u) => n(`select count(*)::int n from production_run_plans_v2 p join production_runs_v2 r on r.id = p.run_id where r.unit_id = '${u.id}' and p.status <> 'CANCELLED'`);
const aktif = (u) => n(`select count(*)::int n from production_unit_schedules where unit_id = '${u.id}' and status = 'ACTIVE'`);
const akt = (u, hari, meja) => call("POST", "/api/production-v2/plans", { unitId: u.id, productionDate: HK(hari), stationCode: meja, priority: 0, workCenterId: wc.id, operatorId: op.id, activateUnit: true }, idem());
cek("kode lama: image ini LAMA (rute Rencana Admin tidak ada, 404)", (await call("GET", "/api/production/rencana/minggu")).status === 404);
const s0 = await sidik();

// (2) keadaan yang DIIZINKAN guard
const rX0 = await rencanaUnit(X); const rX = await akt(X, 12, "TABLE_3");
cek("kode lama: unit X (ADOPTED, rencana Meja sah) tidak mendapat rencana kedua dari kode lama", rX.status >= 400 && (await rencanaUnit(X)) === rX0 && rX0 === 1, `status=${rX.status} rencana=${rX0}->${await rencanaUnit(X)}`);
const rY = await akt(Y, 13, "TABLE_3");
cek("kode lama: unit Y (CLEARED) dijadwalkan lewat Pelaksanaan Meja biasa → tepat SATU rencana, tidak ada jadwal Admin aktif untuk Y", rY.status === 201 && (await rencanaUnit(Y)) === 1 && (await aktif(Y)) === 0, `status=${rY.status}`);
cek("kode lama: pada keadaan yang diizinkan guard (X ADOPTED, Y CLEARED) tabel jadwal + riwayat TIDAK berubah sama sekali (kode lama tidak menulis jadwal Admin)", (await sidik()) === s0);

// (1) keadaan yang DITOLAK guard: jadwal ACTIVE + kode lama
const rZ = await akt(Z, 14, "TABLE_3");
const dua = rZ.status === 201 && (await rencanaUnit(Z)) === 1 && (await aktif(Z)) === 1;
cek("kode lama: BAHAYA yang dicegah guard — unit Z dengan jadwal Admin ACTIVE diaktifkan ke Pelaksanaan Meja oleh kode lama: rencana Meja terbentuk TETAPI jadwal Admin tetap ACTIVE (dua sumber, tidak diambil alih)", dua, `status=${rZ.status} rencana=${await rencanaUnit(Z)} jadwalAktif=${await aktif(Z)}`);
cek("kode lama: bahkan dalam kasus bahaya itu kode lama tidak mengubah baris jadwal Admin (jadwal ACTIVE tetap utuh, tersembunyi)", (await sidik()) === s0);
console.log(`INFO bahaya terbukti=${dua ? "ya" : "tidak"}: tanpa guard, rollback saat jadwal ACTIVE → rencana Meja ganda untuk unit yang sama`);
console.log(`RH_GUARD_LAMA gagal=${gagal}`);
await sv.close(); await prisma.$disconnect(); process.exit(gagal ? 1 : 0);
