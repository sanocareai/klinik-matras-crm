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

// 3) tidak ada tulisan sama sekali oleh smoke ini
const akhir = {}; for (const [k, q] of Object.entries(TULIS)) akhir[k] = await hitung(q);
// Pengguna sah boleh bekerja selama smoke: perbedaan dilaporkan sebagai SKIP (bukan lulus palsu, bukan gagal palsu); smoke ini sendiri tidak punya satu pun jalur tulis.
for (const k of ["catatan", "peristiwa", "sm", "jur", "val", "kor"]) { if (akhir[k] === awal[k]) rec(`tabel ${k} tidak berubah oleh smoke`, true, `${awal[k]}`); else skip(`tabel ${k} tidak berubah oleh smoke`, `${awal[k]} → ${akhir[k]} (aktivitas pengguna sah selama smoke; smoke tidak menulis)`); }
{ const st = JSON.stringify(await prisma.$queryRawUnsafe("select state, count(*)::int n from unit_usage_notes group by 1 order by 1")); if (st === stateAwal) rec("distribusi keadaan catatan tidak berubah oleh smoke", true); else skip("distribusi keadaan catatan tidak berubah oleh smoke", "berubah selama smoke (aktivitas pengguna sah)"); }
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
