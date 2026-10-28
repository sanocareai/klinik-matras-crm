import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang diuji hanya bacaan jadwal bentuk baru dan PENOLAKAN sebelum menyentuh data (tanpa token, tanpa izin, kunci/bentuk/jumlah/tanggal tidak sah, unit tidak ada).
// Jejak tulis (jadwal, riwayat jadwal, Run, tahap, stok, Material Issue, jurnal, aktivitas) harus identik sebelum vs sesudah.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const post = async (p, token, body = {}, hdr = {}) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...hdr }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const get = async (p, token) => { const r = await fetch(BASE + p, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const penjadwal = info.find((x) => bisa(x.rs, P.UNIT_ROUTING_WRITE))?.u; const hanyaLihat = info.find((x) => !bisa(x.rs, P.UNIT_ROUTING_WRITE) && bisa(x.rs, P.UNIT_READ))?.u;
if (!penjadwal) { rec("akun penjadwal (unit:routing_write) tersedia", false); process.exit(1); }
const tW = await tokenUntuk(penjadwal); const tL = hanyaLihat ? await tokenUntuk(hanyaLihat) : null;
const jejak = async () => ({
  jadwal: await hitung("select count(*)::int n from production_unit_schedules"), riwayat: await hitung("select count(*)::int n from production_unit_schedule_events"), run: await hitung("select count(*)::int n from production_runs_v2"),
  tahap: await hitung("select count(*)::int n from unit_stage_logs"), mov: await hitung("select count(*)::int n from stock_movements"), mi: await hitung("select count(*)::int n from material_issues"), jur: await hitung("select count(*)::int n from fin_journal_entries"),
  akt: await hitung("select count(*)::int n from activity_events where event_type = 'PRODUCTION_ADMIN_SCHEDULE_SET'"), plan: await hitung("select count(*)::int n from production_run_plans_v2"),
});
const s0 = await jejak();
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const PRD = "/api/production";

// ── bacaan bentuk baru
const mg = await get(`${PRD}/rencana/minggu?start=${hariIni}`, tW); rec("kalender minggu 200: 7 hari, kapasitas per meja, izin jadwalkan", mg.status === 200 && mg.json?.days?.length === 7 && mg.json?.days?.every((d) => d.stations?.length === 4) && mg.json?.izin?.jadwalkan === true, `${mg.status}`);
const hr = await get(`${PRD}/rencana/hari?date=${hariIni}`, tW); rec("rincian hari 200: empat meja + tanpaMeja", hr.status === 200 && hr.json?.stations?.length === 4 && Array.isArray(hr.json?.tanpaMeja), `${hr.status}`);
const bl = await get(`${PRD}/rencana/antrean?tab=BELUM&pageSize=50`, tW); const c = bl.json?.counts ?? {};
rec(`antrean satu daftar (BELUM) 200: BELUM = SIAP + MENUNGGU_TIBA (${c.BELUM} = ${c.SIAP} + ${c.MENUNGGU_TIBA})`, bl.status === 200 && c.BELUM === c.SIAP + c.MENUNGGU_TIBA, `${bl.status}`);
rec("kartu antrean memuat jumlahUnitOrder/unitKe/saudaraSiap/jalur/revisiJadwal/unitCas", (bl.json?.items ?? []).length === 0 || (bl.json.items.every((i) => Number.isInteger(i.jumlahUnitOrder) && Number.isInteger(i.unitKe) && Array.isArray(i.saudaraSiap) && ["ADMIN", "V2"].includes(i.jalur) && "unitCas" in i && Number.isInteger(i.revisiJadwal))));
for (const tab of ["TERJADWAL", "KEPUTUSAN", "SIAP", "MENUNGGU_TIBA"]) { const r = await get(`${PRD}/rencana/antrean?tab=${tab}&pageSize=5`, tW); rec(`antrean ${tab} 200`, r.status === 200 && Array.isArray(r.json?.items), `${r.status}`); }
const kep = await get(`${PRD}/rencana/antrean?tab=KEPUTUSAN&pageSize=100`, tW); rec("Butuh keputusan tidak memuat hambatan 'Run lama di luar cohort'", (kep.json?.items ?? []).every((i) => !/di luar cohort/i.test(i.alasan ?? "")));
if (tL) { const r = await get(`${PRD}/rencana/minggu?start=${hariIni}`, tL); rec("akun hanya-lihat: kalender 200 dengan izin.jadwalkan=false", r.status === 200 && r.json?.izin?.jadwalkan === false, `${r.status}`); } else skip("akun hanya-lihat membaca kalender", "tidak ada akun hanya-lihat aktif (diuji di rehearsal)");

// ── penolakan SEBELUM menulis
const unitAda = (await prisma.$queryRawUnsafe("select id::text id from units order by created_at desc limit 1"))[0]?.id ?? "00000000-0000-4000-8000-000000000001";
const uBatch = (d, extra = {}) => ({ productionDate: d, stationCode: "TABLE_1", units: [{ unitId: unitAda, expectedRevision: 0 }], ...extra });
const kS = "smoke-pjl-tidak-menulis-0001";
rec("jadwal-batch tanpa token = 401", (await post(`${PRD}/rencana/jadwal-batch`, null, uBatch(hariIni), { "Idempotency-Key": kS })).status === 401);
rec("jadwal-batch/undo tanpa token = 401", (await post(`${PRD}/rencana/jadwal-batch/undo`, null, { items: [{ unitId: unitAda, eventId: "x" }] }, { "Idempotency-Key": kS })).status === 401);
if (tL) { rec("jadwal-batch akun hanya-lihat = 403 (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tL, uBatch(hariIni), { "Idempotency-Key": kS })).status === 403); rec("jadwal-batch/undo akun hanya-lihat = 403", (await post(`${PRD}/rencana/jadwal-batch/undo`, tL, { items: [{ unitId: unitAda, eventId: "x" }] }, { "Idempotency-Key": kS })).status === 403); } else skip("akun hanya-lihat 403 pada jadwal-batch", "tidak ada akun hanya-lihat aktif (diuji di rehearsal)");
rec("jadwal-batch tanpa Idempotency-Key = 400 (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni))).status === 400);
rec("jadwal-batch daftar unit kosong = 400; lebih dari 20 unit = 400", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: [] }), { "Idempotency-Key": kS })).status === 400 && (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: Array.from({ length: 21 }, (_, i) => ({ unitId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, expectedRevision: 0 })) }), { "Idempotency-Key": kS })).status === 400);
const kemarin = new Date(Date.now() + 7 * 3600_000 - 86400_000).toISOString().slice(0, 10);
rec("jadwal-batch tanggal lewat = 422 JADWAL_TANGGAL_LEWAT (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(kemarin), { "Idempotency-Key": kS })).json?.code === "JADWAL_TANGGAL_LEWAT");
let minggu = new Date(Date.now() + 7 * 3600_000 + 86400_000).toISOString().slice(0, 10); while (new Date(`${minggu}T00:00:00Z`).getUTCDay() !== 0) minggu = new Date(new Date(`${minggu}T00:00:00Z`).getTime() + 86400_000).toISOString().slice(0, 10);
rec("jadwal-batch hari Minggu = 422 JADWAL_HARI_LIBUR (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(minggu), { "Idempotency-Key": kS })).json?.code === "JADWAL_HARI_LIBUR");
rec("jadwal-batch meja tidak dikenal = 400 JADWAL_MEJA_INVALID (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { stationCode: "TABLE_9" }), { "Idempotency-Key": kS })).json?.code === "JADWAL_MEJA_INVALID");
rec("jadwal-batch unit tidak ada = 404 (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: [{ unitId: "00000000-0000-4000-8000-0000000000ff", expectedRevision: 0 }] }), { "Idempotency-Key": kS })).status === 404);
rec("jadwal-batch daftar ganda = 400 (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: [{ unitId: unitAda, expectedRevision: 0 }, { unitId: unitAda, expectedRevision: 0 }] }), { "Idempotency-Key": kS })).status === 400);

const s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]);
rec("TIDAK ada jejak tulis: jadwal, riwayat jadwal, Run, tahap, stok, Material Issue, jurnal, aktivitas jadwal, rencana Meja sama persis sebelum vs sesudah smoke", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") || "identik");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
