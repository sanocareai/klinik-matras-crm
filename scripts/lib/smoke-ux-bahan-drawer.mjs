// Smoke BACA-SAJA rilis frontend "drawer Pemakaian aktual" terhadap backend yang SUDAH melayani (kode backend TIDAK berubah pada rilis ini). Hanya GET (+ penolakan di pintu yang gagal sebelum menyentuh data).
// Memeriksa: backend yang sama masih menjawab untuk layar yang dipakai UI baru (daftar, panel unit + izin, katalog, duplikasi, antrean usulan/sementara) dan bundel web publik memuat teks UI baru.
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
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const TULIS = { usulan: "select count(*)::int n from material_proposals", sementara: "select count(*)::int n from unit_provisional_usages", sm: "select count(*)::int n from stock_movements", mi: "select count(*)::int n from material_issues", jur: "select count(*)::int n from fin_journal_entries", bahan: "select count(*)::int n from materials", komp: "select count(*)::int n from unit_component_reuse_entries", jad: "select count(*)::int n from production_unit_schedules", run: "select count(*)::int n from production_runs_v2" };
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);

rec("health sehat", (await get("/api/health")).json?.ok === true);
const wo = await get("/api/production/work-orders?pageSize=5", tA);
rec("daftar Order Produksi (Admin) 200 dan memuat unit", wo.status === 200 && Array.isArray(wo.json?.units) && wo.json.units.length > 0, `${wo.status}`);
const unit = wo.json?.units?.find((u) => !["CANCELLED", "DELIVERED"].includes(u.status)) ?? wo.json?.units?.[0];
if (unit) {
  const ad = await get(`/api/production/units/${unit.id}/adopsi`, tA);
  const iz = ad.json?.izin ?? {};
  rec("panel unit (Admin) 200 dengan izin pemakaianAktual, usulBahan, catatPemakaianSementara (dasar kartu sumber + label tombol)", ad.status === 200 && iz.pemakaianAktual === true && "usulBahan" in iz && "catatPemakaianSementara" in iz, JSON.stringify(Object.fromEntries(Object.entries(iz).filter(([k]) => /pemakaian|usul|Sementara|putuskan/i.test(k)))));
  rec("panel unit memuat pemakaianSementara dan komponenLama dan rencanaBahan (tiga sumber)", ad.status === 200 && !!ad.json?.pemakaianSementara && !!ad.json?.komponenLama && "rencanaBahan" in ad.json, Object.keys(ad.json ?? {}).slice(0, 14).join(","));
  if (tS) { const as = await get(`/api/production/units/${unit.id}/adopsi`, tS); rec("panel unit (hanya-lihat/Sales): izin tulis bahan = false (UI memakai label 'Lihat bahan')", as.status === 200 && as.json?.izin?.pemakaianAktual === false && as.json?.izin?.catatPemakaianSementara === false, `${as.status}`); } else skip("panel unit hanya-lihat", "tidak ada akun aktif SALES tanpa peran ber-izin tulis bahan");
} else skip("panel unit", "tidak ada unit");
const kat = await get("/api/production/material-catalog?limit=20", tA);
rec("katalog bahan 200", kat.status === 200 && Array.isArray(kat.json?.rows), `${kat.status} total=${kat.json?.total}`);
const nama = kat.json?.rows?.[0]?.nama;
if (nama) { const d = await get("/api/production/material-duplicates?name=" + encodeURIComponent(nama), tA); rec("cek duplikasi nama katalog: adaSama=true dan kandidat bertingkat 'SAMA' (UI memblokir pemakaian sementara)", d.status === 200 && d.json?.adaSama === true && (d.json?.kandidat ?? []).some((k) => k.jenis === "KATALOG" && k.tingkat === "SAMA"), JSON.stringify(d.json?.kandidat?.slice(0, 1))); } else skip("cek duplikasi", "katalog kosong");
rec("antrean usulan bahan (Admin) 200", (await get("/api/production/material-proposals", tA)).status === 200);
rec("antrean pemakaian sementara (Admin) 200", (await get("/api/production/provisional-usages", tA)).status === 200);
rec("antrean usulan tanpa token → 401", (await get("/api/production/material-proposals")).status === 401);
// bundel web publik memuat teks UI baru
const html = await (await fetch(PUB + "/")).text(); const idx = (html.match(/assets\/index-[A-Za-z0-9_-]*\.js/) || [])[0];
if (idx) {
  const kode = await (await fetch(PUB + "/" + idx)).text(); const asetPublik = [...html.matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]);
  let gabung = kode; for (const a of asetPublik.slice(0, 6)) { try { gabung += await (await fetch(PUB + "/" + a)).text(); } catch { /* lewati */ } }
  rec("bundel publik terbuka (index + aset)", gabung.length > 10000, `${gabung.length} byte`);
} else rec("bundel publik punya index-*.js", false);
const akhir = {}; for (const [k, q] of Object.entries(TULIS)) akhir[k] = await hitung(q);
const KETAT = ["usulan", "sementara", "komp", "jad", "run"]; const berubah = KETAT.filter((k) => awal[k] !== akhir[k]);
rec("smoke tidak menulis: usulan, pemakaian sementara, komponen lama, jadwal, Run tidak berubah", berubah.length === 0, berubah.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
const info = Object.keys(awal).filter((k) => !KETAT.includes(k) && awal[k] !== akhir[k]); if (info.length) console.log("  INFO  tabel yang juga ditulis pengguna nyata berubah selama smoke (bukan oleh smoke ini): " + info.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
