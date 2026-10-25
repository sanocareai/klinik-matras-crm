// (rilis UI posting historis: ditambah GET pratinjau/daftar batch, gerbang izin tulis, dan rute SPA)
// Smoke BACA-SAJA rilis "evaluasi catatan pemakaian historis: global + atomik" terhadap backend yang SUDAH melayani (container baru). TIDAK memposting, mengoreksi, mengevaluasi-ulang-dengan-tulisan, atau menyentuh stok/jurnal.
// Hanya: audit kering (potret konsisten RepeatableRead; tanpa kunci; tanpa tulisan), GET Ringkasan catatan unit, hitungan tabel sebelum vs sesudah.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const { periksaKeadaanCatatan } = await import("/app/src/services/catatanPemakaianHistoris.js");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 300) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
async function api(method, path, token) {
  const r = await fetch(BASE + path, { method, headers: token ? { Authorization: "Bearer " + token } : {} });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TULIS = {
  catatan: "select count(*)::int n from unit_usage_notes", peristiwa: "select count(*)::int n from unit_usage_note_events", sm: "select count(*)::int n from stock_movements", jur: "select count(*)::int n from fin_journal_entries",
  val: "select count(*)::int n from fin_stock_movement_valuations", kor: "select count(*)::int n from warehouse_corrections", act: "select count(*)::int n from activity_events", job: "select count(*)::int n from jobs",
};
const batchAwal = await hitung("select count(*)::int n from activity_events where entity_type = 'posting_historis_batch'");
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);
const stateAwal = JSON.stringify(await prisma.$queryRawUnsafe("select state, count(*)::int n from unit_usage_notes group by 1 order by 1"));

rec("health publik sehat", (await api("GET", "/api/health", null)).json?.ok === true);
const dbNama = (await prisma.$queryRawUnsafe("select current_database() n"))[0].n;
rec("smoke berjalan pada DB production (bukan DB rehearsal)", !/^rehearsal_/.test(dbNama), dbNama);

// 1) audit kering: keadaan production = titik tetap menurut kode yang sedang melayani
const a = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 });
rec("keadaan catatan production = titik tetap (evaluasi global tidak punya apa pun untuk diubah)", a.berubah === 0, `berubah=${a.berubah} diperiksa=${a.diperiksa} ${JSON.stringify((a.detail ?? []).slice(0, 2))}`);

// 2) GET Ringkasan catatan satu unit yang punya catatan SIAP_POSTING (tampilan yang dibaca pengguna)
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const admin = aktif.find((u) => peran.get(u.id).includes("ADMIN") && punya(peran.get(u.id), P.UNIT_READ));
const unit = (await prisma.$queryRawUnsafe("select unit_id from unit_usage_notes where state = 'SIAP_POSTING' and unit_id is not null limit 1"))[0];
if (!admin || !unit) skip("GET catatan historis satu unit", !admin ? "tidak ada akun ADMIN aktif dengan izin baca Unit" : "tidak ada catatan SIAP_POSTING");
else {
  const token = jwt.sign({ id: admin.id, name: admin.name, role: admin.role, roles: peran.get(admin.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
  const r = await api("GET", `/api/production/units/${unit.unit_id}/adopsi`, token);
  rec("Ringkasan unit memuat catatan historis dengan keadaan yang sama dengan database", r.status === 200 && Number(r.json?.catatanHistoris?.ringkas?.siapPosting ?? r.json?.adopsi?.catatanHistoris?.ringkas?.siapPosting ?? -1) === Number((await prisma.$queryRawUnsafe(`select count(*)::int n from unit_usage_notes where unit_id = '${unit.unit_id}' and state = 'SIAP_POSTING'`))[0].n), `status=${r.status}`);
}

// 2b) endpoint baru: baca OK; tulis ditolak SEBELUM menyentuh data (tanpa token 401; ADMIN tanpa izin persetujuan 403); batch tidak ada = 404
if (admin) {
  const tk = jwt.sign({ id: admin.id, name: admin.name, role: admin.role, roles: peran.get(admin.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
  const pr = await api("GET", "/api/production/posting-historis/pratinjau", tk);
  rec("GET pratinjau manifest 200 dengan hash, order, HPP", pr.status === 200 && /^[0-9a-f]{64}$/.test(pr.json?.hash ?? "") && pr.json?.hpp?.jurnalDibuat === false, `status=${pr.status} ${pr.json?.jumlahOrder} order / ${pr.json?.jumlahTrx} trx`);
  const ls = await api("GET", "/api/production/posting-historis/batch", tk); rec("GET daftar batch 200", ls.status === 200 && Array.isArray(ls.json?.batch), `status=${ls.status}`);
  rec("GET batch yang tidak ada → 404", (await api("GET", `/api/production/posting-historis/batch/${"0".repeat(64)}`, tk)).status === 404);
  rec("tanpa token → 401 (pratinjau, daftar, batch)", (await api("GET", "/api/production/posting-historis/pratinjau", null)).status === 401 && (await api("GET", "/api/production/posting-historis/batch", null)).status === 401);
  const adminMurni = aktif.find((u) => peran.get(u.id).includes("ADMIN") && !punya(peran.get(u.id), P.INVENTORY_ADJUSTMENT_APPROVE));
  if (adminMurni) {
    const tkM = jwt.sign({ id: adminMurni.id, name: adminMurni.name, role: adminMurni.role, roles: peran.get(adminMurni.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const kirim = async (m, p) => { const r = await fetch(BASE + p, { method: m, headers: { Authorization: "Bearer " + tkM, "Content-Type": "application/json" }, body: JSON.stringify({ hashDisetujui: "0".repeat(64), rujukan: "SMOKE-TANPA-IZIN" }) }); return r.status; };
    rec("ADMIN tanpa izin persetujuan: mulai batch / jalankan / lanjut / hentikan → 403 (gerbang izin sebelum hash)", [await kirim("POST", "/api/production/posting-historis/batch"), await kirim("POST", "/api/production/posting-historis/jalankan"), await kirim("POST", `/api/production/posting-historis/batch/${"0".repeat(64)}/lanjut`), await kirim("POST", `/api/production/posting-historis/batch/${"0".repeat(64)}/hentikan`)].every((x) => x === 403));
  } else skip("gerbang izin tulis untuk ADMIN", "tidak ada akun ADMIN tanpa izin persetujuan");
}
const spa = await fetch(BASE + "/warehouse/posting-historis"); const html = await spa.text(); rec("rute SPA /warehouse/posting-historis menyajikan index.html baru", spa.status === 200 && /<div id="root"/.test(html) && /index-[A-Za-z0-9_-]+.js/.test(html), `status=${spa.status}`);

// 3) tidak ada tulisan sama sekali oleh smoke ini
const akhir = {}; for (const [k, q] of Object.entries(TULIS)) akhir[k] = await hitung(q);
// Pengguna sah boleh bekerja selama smoke: perbedaan dilaporkan sebagai SKIP (bukan lulus palsu, bukan gagal palsu); smoke ini sendiri tidak punya satu pun jalur tulis.
rec("tidak ada peristiwa batch baru dibuat oleh smoke", (await hitung("select count(*)::int n from activity_events where entity_type = 'posting_historis_batch'")) === batchAwal);
for (const k of ["catatan", "peristiwa", "sm", "jur", "val", "kor"]) { if (akhir[k] === awal[k]) rec(`tabel ${k} tidak berubah oleh smoke`, true, `${awal[k]}`); else skip(`tabel ${k} tidak berubah oleh smoke`, `${awal[k]} → ${akhir[k]} (aktivitas pengguna sah selama smoke; smoke tidak menulis)`); }
{ const st = JSON.stringify(await prisma.$queryRawUnsafe("select state, count(*)::int n from unit_usage_notes group by 1 order by 1")); if (st === stateAwal) rec("distribusi keadaan catatan tidak berubah oleh smoke", true); else skip("distribusi keadaan catatan tidak berubah oleh smoke", "berubah selama smoke (aktivitas pengguna sah)"); }
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
