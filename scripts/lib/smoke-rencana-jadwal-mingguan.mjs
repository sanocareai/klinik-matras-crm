// Smoke BACA-SAJA rilis "Rencana Produksi — jadwal mingguan" terhadap backend yang SUDAH melayani (container baru; atau server rehearsal bila SMOKE_BASE diisi). TIDAK membuat jadwal, riwayat, Run, penerimaan, serah-terima, stok, job, jurnal, atau pesan.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, kunci idempotensi/tanggal/hari libur tidak valid).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
async function api(method, path, token, body, headers = {}, mentah = false) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  if (mentah) return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const cari = (fn) => aktif.find((u) => fn(peran.get(u.id)));
const admin = cari((r) => r.includes("ADMIN") && punya(r, P.UNIT_READ) && punya(r, P.UNIT_ROUTING_WRITE));
const hanyaLihat = cari((r) => punya(r, P.UNIT_READ) && !punya(r, P.UNIT_ROUTING_WRITE));
const tanpaBaca = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.UNIT_READ));
if (!admin) { rec("akun ADMIN aktif dengan izin Produksi lengkap tersedia", false); process.exit(1); }
const tA = tokenUntuk(admin);
const nol = "00000000-0000-4000-8000-000000000000";
const PR = "/api/production";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TULIS = {
  sm: "select count(*)::int n from stock_movements", cmd: "select count(*)::int n from v2_commands", jad: "select count(*)::int n from production_unit_schedules", ev: "select count(*)::int n from production_unit_schedule_events", plan: "select count(*)::int n from production_run_plans_v2",
  job: "select count(*)::int n from jobs", run: "select count(*)::int n from production_runs_v2", qc: "select count(*)::int n from quality_inspections_v2", jur: "select count(*)::int n from fin_journal_entries", rec: "select count(*)::int n from unit_workshop_receipts",
  serah: "select count(*)::int n from unit_custody_handoffs_v2", act: "select count(*)::int n from activity_events", outbox: "select count(*)::int n from domain_outbox", komp: "select count(*)::int n from unit_component_reuse_entries", unit: "select count(*)::int n from units", order: "select count(*)::int n from \"Order\"",
};
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);
const nUnit = awal.unit;
const hari = (n) => new Date(Date.now() + 7 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const minggu = (() => { let k = hari(1); while (new Date(`${k}T00:00:00Z`).getUTCDay() !== 0) k = new Date(new Date(`${k}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10); return k; })(); // Minggu terdekat (>= besok)

// ── Pintu: tanpa token / tanpa izin / bentuk salah — gagal SEBELUM menyentuh data ──
rec("kalender minggu tanpa token → 401", (await api("GET", `${PR}/rencana/minggu`, null)).status === 401);
rec("antrean tanpa token → 401", (await api("GET", `${PR}/rencana/antrean`, null)).status === 401);
rec("jadwalkan tanpa token → 401", (await api("POST", `${PR}/units/${nol}/jadwal`, null, { productionDate: hari(2) })).status === 401);
if (tanpaBaca) rec("kalender akun tanpa izin baca Unit → 403", (await api("GET", `${PR}/rencana/minggu`, tokenUntuk(tanpaBaca))).status === 403); else skip("kalender 403", "tidak ada akun aktif tanpa izin baca Unit");
if (hanyaLihat) {
  const t = tokenUntuk(hanyaLihat);
  rec("jadwalkan akun hanya-lihat → 403 (tidak menulis)", (await api("POST", `${PR}/units/${nol}/jadwal`, t, { productionDate: hari(2) }, { "Idempotency-Key": "smoke-lihat-00000001" })).status === 403);
  rec("akun hanya-lihat membaca kalender → 200 dan izin.jadwalkan=false", await (async () => { const r = await api("GET", `${PR}/rencana/minggu`, t); return r.status === 200 && r.json?.izin?.jadwalkan === false; })());
} else skip("akun hanya-lihat", "tidak ada akun aktif dengan izin baca tetapi tanpa izin tulis");
rec("jadwalkan tanpa Idempotency-Key → 400 IDEMPOTENCY_KEY_INVALID (tidak menulis)", await (async () => { const r = await api("POST", `${PR}/units/${nol}/jadwal`, tA, { productionDate: hari(2) }); return r.status === 400 && r.json?.code === "IDEMPOTENCY_KEY_INVALID"; })());
rec("jadwalkan tanggal tidak valid → 400 JADWAL_TANGGAL_INVALID", await (async () => { const r = await api("POST", `${PR}/units/${nol}/jadwal`, tA, { productionDate: "bukan-tanggal" }, { "Idempotency-Key": "smoke-tgl-000000001" }); return r.status === 400 && r.json?.code === "JADWAL_TANGGAL_INVALID"; })());
rec("jadwalkan hari Minggu → 422 JADWAL_HARI_LIBUR (ditolak sebelum menyentuh data)", await (async () => { const r = await api("POST", `${PR}/units/${nol}/jadwal`, tA, { productionDate: minggu, stationCode: "TABLE_1" }, { "Idempotency-Key": "smoke-minggu-000001" }); return r.status === 422 && r.json?.code === "JADWAL_HARI_LIBUR"; })());
rec("jadwalkan UUID unit tidak valid → 400", (await api("POST", `${PR}/units/bukan-uuid/jadwal`, tA, { productionDate: hari(2) }, { "Idempotency-Key": "smoke-uuid-0000001" })).status === 400);
rec("undo tanpa Idempotency-Key → 400", (await api("POST", `${PR}/units/${nol}/jadwal/undo`, tA, { eventId: nol })).status === 400);

// ── Baca: kalender, hari, antrean, riwayat, Status Produksi, ekspor ──
const mg = await api("GET", `${PR}/rencana/minggu`, tA);
rec("kalender minggu: 200, 7 hari, kapasitas Senin–Sabtu 72 slot, Minggu libur kapasitas 0", mg.status === 200 && mg.json?.days?.length === 7 && mg.json?.kapasitas?.totalMinggu === 72 && mg.json?.ringkasan?.slotKerja === 72 && mg.json.days.filter((d) => !d.hariKerja).every((d) => d.kapasitas === 0 && d.libur === true) && mg.json.days.filter((d) => d.hariKerja).every((d) => d.kapasitas === 12), `${mg.status} hariKerja=${mg.json?.ringkasan?.hariKerja}`);
rec("kalender: izin.jadwalkan terbaca untuk Admin", mg.json?.izin?.jadwalkan === true);
const hr = await api("GET", `${PR}/rencana/hari?date=${hari(1)}`, tA);
rec("rincian hari: 200 dengan 4 meja + kapasitas", hr.status === 200 && hr.json?.stations?.length === 4 && hr.json?.kapasitas?.perMeja === 3, String(hr.status));
let ant = null;
for (const tab of ["SIAP", "KEPUTUSAN", "MENUNGGU_TIBA", "TERJADWAL", "SEMUA"]) { const r = await api("GET", `${PR}/rencana/antrean?tab=${tab}&pageSize=20`, tA); if (tab === "SEMUA") ant = r; rec(`antrean ${tab}: 200 dengan hitungan per tab`, r.status === 200 && r.json?.counts && typeof r.json.total === "number", `${r.status} total=${r.json?.total}`); }
rec("antrean: tab liar jatuh ke bawaan (tidak galat); pencarian server", (await api("GET", `${PR}/rencana/antrean?tab=LIAR&q=a`, tA)).status === 200);
const u1 = ant?.json?.items?.[0];
if (u1) {
  const jd = await api("GET", `${PR}/units/${u1.unitId}/jadwal`, tA); rec(`riwayat jadwal unit ${u1.unitCode}: 200 (kosong bila belum pernah dijadwalkan)`, jd.status === 200 && Array.isArray(jd.json?.events), String(jd.status));
  const ad = await api("GET", `${PR}/units/${u1.unitId}/adopsi`, tA); rec(`panel unit ${u1.unitCode}: 200 + jadwal terbaca (null bila belum dijadwalkan)`, ad.status === 200 && ("jadwal" in (ad.json?.adopsi ?? {})), String(ad.status));
} else skip("riwayat jadwal + panel unit nyata", "tidak ada unit aktif");
const wl = await api("GET", `${PR}/work-list?pageSize=20`, tA); rec("daftar kerja Status Produksi: 200 dengan jadwal per unit", wl.status === 200 && wl.json?.orders?.every((o) => o.units.every((x) => "jadwal" in x)), String(wl.status));
rec("daftar Order Produksi (kontrak lama) tetap 200", (await api("GET", `${PR}/work-orders?pageSize=20`, tA)).status === 200);
rec("papan Produksi lama tetap 200", (await api("GET", `${PR}/board`, tA)).status === 200);
rec("daftar order (Sales) tetap 200", (await api("GET", "/api/orders?limit=5", tA)).status === 200);
const ex = await api("POST", "/api/production-v2/rencana/export", tA, { from: hari(0), to: hari(6), stations: [], includeUnscheduled: true });
let exInfo = "";
if (ex.status === 200) { const kolom = (ex.json?.columns ?? []).map((c) => c.key); exInfo = `${kolom.length} kolom; baris=${ex.json?.rows?.length}`; rec("ekspor xlsx: 200, kolom Tanggal Jadwal + Status Rencana + Mode pelaksanaan, data terbaca", kolom.length === 29 && ["tanggal", "sumberJadwal", "modePelaksanaan"].every((k) => kolom.includes(k)) && Array.isArray(ex.json?.rows), exInfo); } else rec("ekspor xlsx: 200", false, String(ex.status));
void ExcelJS;

// ── Komponen lama dari unit pelanggan (BUKAN stok): bacaan + penolakan yang terjadi SEBELUM menyentuh data ──
const kompBody = { name: "Pegas bongkaran", qty: 1, uom: "PCS", condition: "bagus", outcome: "REUSED", workPart: "rangka" };
rec("komponen lama: tanpa token → 401", (await api("GET", `${PR}/units/${nol}/komponen-lama`, null)).status === 401);
rec("komponen lama: catat tanpa Idempotency-Key → 400 IDEMPOTENCY_KEY_INVALID (tidak menulis)", await (async () => { const r = await api("POST", `${PR}/units/${nol}/komponen-lama`, tA, kompBody); return r.status === 400 && r.json?.code === "IDEMPOTENCY_KEY_INVALID"; })());
rec("komponen lama: jumlah 0 → 400 KOMPONEN_JUMLAH_INVALID (ditolak sebelum menyentuh data)", await (async () => { const r = await api("POST", `${PR}/units/${nol}/komponen-lama`, tA, { ...kompBody, qty: 0 }, { "Idempotency-Key": "smoke-komp-00000001" }); return r.status === 400 && r.json?.code === "KOMPONEN_JUMLAH_INVALID"; })());
rec("komponen lama: unit tidak ada → 404 UNIT_TIDAK_ADA (tidak menulis)", await (async () => { const r = await api("POST", `${PR}/units/${nol}/komponen-lama`, tA, kompBody, { "Idempotency-Key": "smoke-komp-00000002" }); return r.status === 404 && r.json?.code === "UNIT_TIDAK_ADA"; })());
rec("komponen lama: foto bukan alamat bukti resmi → 400 KOMPONEN_FOTO_INVALID", await (async () => { const r = await api("POST", `${PR}/units/${nol}/komponen-lama`, tA, { ...kompBody, photoUrls: ["https://evil.example/x.jpg"] }, { "Idempotency-Key": "smoke-komp-00000003" }); return r.status === 400 && r.json?.code === "KOMPONEN_FOTO_INVALID"; })());
if (u1) {
  const kl = await api("GET", `${PR}/units/${u1.unitId}/komponen-lama`, tA);
  rec(`komponen lama unit ${u1.unitCode}: 200, asal 'Dari kasur pelanggan — kode unit', total terpisah, dampak stok 'Tidak ada'`, kl.status === 200 && Array.isArray(kl.json?.items) && kl.json?.asal === `Dari kasur pelanggan — ${u1.unitCode}` && !!kl.json?.total?.pemakaianKembali && /Tidak ada/.test(kl.json?.dampakStok ?? ""), String(kl.status));
  const ad2 = await api("GET", `${PR}/units/${u1.unitId}/adopsi`, tA);
  rec("panel unit memuat komponenLama (dua sumber terpisah: pemakaianAktual vs komponenLama)", ad2.status === 200 && !!ad2.json?.komponenLama && !!ad2.json?.pemakaianAktual, String(ad2.status));
  const rk = await api("GET", `${PR}/units/${u1.unitId}/ruang-kerja`, tA);
  rec("ruang kerja unit: detail order (kondisi pelanggan, catatan produksi, komplain) terbaca", rk.status === 200 && !!rk.json?.order?.detail?.kondisiPelanggan, String(rk.status));
} else skip("komponen lama + ruang kerja unit nyata", "tidak ada unit aktif");
const exo = await api("GET", `${PR}/work-orders/export.xlsx`, tA, undefined, {}, true);
if (exo.status === 200) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(exo.buf);
  const kolomAkt = (wb.getWorksheet("Pemakaian Aktual")?.getRow(1).values ?? []).slice(1);
  rec("ekspor Order Produksi: sheet Pemakaian Aktual memuat Sumber + Dampak Stok, sheet Komponen Lama ada dan dibedakan", kolomAkt.includes("Sumber") && kolomAkt.includes("Dampak Stok") && !!wb.getWorksheet("Komponen Lama"), `${kolomAkt.length} kolom aktual`);
} else rec("ekspor Order Produksi (.xlsx): 200", false, String(exo.status));

// ── Tidak ada tulisan ──
for (const [k, q] of Object.entries(TULIS)) rec(`smoke tidak menulis: ${k} tetap ${awal[k]}`, (await hitung(q)) === awal[k]);
void nUnit;
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
