// Smoke BACA-SAJA rilis "Rekonsiliasi pemakaian historis" terhadap backend BARU yang sudah melayani. Hanya GET (+ penolakan di pintu yang gagal sebelum menyentuh data).
// Memastikan rilis KODE selesai dengan antrean KOSONG: tidak ada batch impor, catatan, peristiwa, koreksi harga; rencana posting 0 transaksi; tidak ada posting 384 transaksi.
// Hitungan tabel bisnis sebelum vs sesudah smoke dibandingkan (smoke tidak menulis).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000"; const PUB = process.env.SMOKE_PUBLIK || "https://app.sanomatrassehat.com";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const BERIZIN = new Set(["ADMIN", "OWNER", "PRODUCTION_WORKER", "PRODUCTION_LEAD", "WAREHOUSE"]);
async function userDengan(role, tanpa) { for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u; } return null; }
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
if (!adm) { rec("akun ADMIN tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm); const tS = sales ? await tokenUntuk(sales) : null;
const get = async (path, token) => { const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const post = async (path, token, body = {}) => { const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "smoke-rekon-0001", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); return r.status; };
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const BARU = { batch: "select count(*)::int n from usage_import_batches", catatan: "select count(*)::int n from unit_usage_notes", peristiwa: "select count(*)::int n from unit_usage_note_events", koreksiHarga: "select count(*)::int n from fin_stock_movement_valuation_corrections", koreksiPemakaian: "select count(*)::int n from warehouse_corrections where doc_type = 'UNIT_USAGE'", penyesuaianAsal: "select count(*)::int n from stock_adjustment_requests where origin_type is not null" };
const TULIS = { sm: "select count(*)::int n from stock_movements", mi: "select count(*)::int n from material_issues", jur: "select count(*)::int n from fin_journal_entries", val: "select count(*)::int n from fin_stock_movement_valuations", bahan: "select count(*)::int n from materials", unit: "select count(*)::int n from units", ...BARU };
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);
const ISI_AWAL = ["batch", "catatan", "peristiwa", "koreksiHarga", "koreksiPemakaian", "penyesuaianAsal"];

rec("health sehat", (await get("/api/health")).json?.ok === true);
// ── ANTREAN KOSONG: inilah bukti "tidak ada impor / tidak ada posting" saat rilis kode ──
rec("tabel impor/catatan/peristiwa/koreksi harga/koreksi pemakaian KOSONG saat rilis (tidak ada manifest yang dijalankan)", ISI_AWAL.every((k) => awal[k] === 0), ISI_AWAL.map((k) => `${k}=${awal[k]}`).join(" "));
const rp = await get("/api/production/posting-historis/rencana", tA);
rec("rencana posting historis (Admin) 200 dan 0 transaksi — tidak ada 384 transaksi yang menunggu", rp.status === 200 && rp.json?.jumlah === 0 && (rp.json?.transaksi ?? []).length === 0, `${rp.status} jumlah=${rp.json?.jumlah}`);
const kd = await get("/api/production/koreksi-pemakaian", tA);
rec("antrean koreksi pemakaian (Admin) 200 dan kosong", kd.status === 200 && Array.isArray(kd.json?.koreksi) && kd.json.koreksi.length === 0, `${kd.status}`);
// ── layar yang dipakai UI baru ──
const wo = await get("/api/production/work-orders?pageSize=5", tA);
rec("daftar Order Produksi (Admin) 200 dan memuat unit", wo.status === 200 && Array.isArray(wo.json?.units) && wo.json.units.length > 0, `${wo.status}`);
const unit = wo.json?.units?.find((u) => !["CANCELLED"].includes(u.status)) ?? wo.json?.units?.[0];
if (unit) {
  const ad = await get(`/api/production/units/${unit.id}/adopsi`, tA); const iz = ad.json?.izin ?? {};
  rec("panel unit (Admin) 200: catatanHistoris kosong (total 0), koreksiMenunggu [], hppBahan ada, izin catatanHistoris + koreksiSetuju", ad.status === 200 && ad.json?.catatanHistoris?.ringkas?.total === 0 && Array.isArray(ad.json?.koreksiMenunggu) && ad.json.koreksiMenunggu.length === 0 && "hppBahan" in ad.json && iz.catatanHistoris === true && "koreksiSetuju" in iz, `${ad.status} ${JSON.stringify(ad.json?.catatanHistoris?.ringkas)}`);
  const ch = await get(`/api/production/units/${unit.id}/catatan-historis`, tA);
  rec("catatan historis unit (Admin) 200, kosong", ch.status === 200 && ch.json?.ringkas?.total === 0, `${ch.status}`);
  if (tS) { const as = await get(`/api/production/units/${unit.id}/adopsi`, tS); rec("panel unit (hanya-lihat/Sales): izin catatanHistoris=false dan koreksiSetuju=false (UI tanpa tombol aksi)", as.status === 200 && as.json?.izin?.catatanHistoris === false && as.json?.izin?.koreksiSetuju === false, `${as.status}`); } else skip("panel unit akun hanya-lihat", "tidak ada akun SALES murni");
} else skip("panel unit", "tidak ada unit");
const ex = await fetch(BASE + "/api/production/work-orders/export.xlsx", { headers: { Authorization: "Bearer " + tA } }).catch(() => null);
if (ex) rec("ekspor Excel Order Produksi (Admin) tetap 200", ex.status === 200, `${ex.status}`); else skip("ekspor Excel", "permintaan gagal");
// ── penolakan di pintu (tidak menyentuh data) ──
const Z = "00000000-0000-4000-8000-000000000000";
rec("koreksi catatan tanpa token → 401", (await post(`/api/production/catatan-historis/${Z}/koreksi`, null, { qty: 1, alasan: "smoke" })) === 401);
rec("posting historis tanpa token → 401", (await post("/api/production/posting-historis/jalankan", null, { hashDisetujui: "x", rujukan: "x" })) === 401);
rec("posting historis Admin dengan hash salah → ditolak (bukan 2xx), tanpa menulis", ![200, 201].includes(await post("/api/production/posting-historis/jalankan", tA, { hashDisetujui: "hash-salah", rujukan: "smoke" })));
if (tS) {
  rec("koreksi catatan akun hanya-lihat → 403", (await post(`/api/production/catatan-historis/${Z}/koreksi`, tS, { qty: 1, alasan: "smoke" })) === 403);
  rec("setujui koreksi pemakaian akun hanya-lihat → 403", (await post(`/api/production/koreksi-pemakaian/${Z}/setujui`, tS, {})) === 403);
  rec("posting historis akun hanya-lihat → 403", (await post("/api/production/posting-historis/jalankan", tS, { hashDisetujui: "x", rujukan: "x" })) === 403);
}
// ── bundel web publik memuat teks UI baru ──
const html = await (await fetch(PUB + "/")).text(); const idx = (html.match(/assets\/index-[A-Za-z0-9_-]*\.js/) || [])[0];
if (idx) {
  const asetPublik = [...html.matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]); let gabung = await (await fetch(PUB + "/" + idx)).text();
  for (const a of asetPublik.slice(0, 6)) { try { gabung += await (await fetch(PUB + "/" + a)).text(); } catch { /* lewati */ } }
  rec("bundel publik terbuka (index + aset)", gabung.length > 10000, `${gabung.length} byte`);
} else rec("bundel publik punya index-*.js", false);
const akhir = {}; for (const [k, q] of Object.entries(TULIS)) akhir[k] = await hitung(q);
const berubah = Object.keys(BARU).filter((k) => awal[k] !== akhir[k]);
rec("smoke tidak menulis: semua tabel/jejak rekonsiliasi (batch, catatan, peristiwa, koreksi harga, koreksi pemakaian, asal penyesuaian) tetap tidak berubah", berubah.length === 0, berubah.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
const info = Object.keys(awal).filter((k) => !(k in BARU) && awal[k] !== akhir[k]); if (info.length) console.log("  INFO  tabel yang juga ditulis pengguna nyata berubah selama smoke (bukan oleh smoke ini): " + info.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
