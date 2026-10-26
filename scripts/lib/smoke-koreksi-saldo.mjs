import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000"; // SMOKE_BASE/REH_SRC hanya untuk uji lokal skrip ini
const imp = (p) => import(process.env.REH_SRC ? pathToFileURL(path.join(process.env.REH_SRC, p)).href : "/app/src/" + p);
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const { ROLE_PERMISSIONS } = await imp("constants/permissions.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function userDengan(rolesAda, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if ([...rolesAda].some((r) => rs.has(r)) && ![...rs].some((r) => tanpa.has(r))) return u; }
  return null;
}
// Owner = pengaju+penyetuju potensial; Finance murni = penyetuju tanpa izin tulis ledger; Gudang murni; Sales murni (tanpa izin inventory)
const owner = await userDengan(["OWNER"], new Set());
const finMurni = await userDengan(["FINANCE"], new Set(["OWNER", "ADMIN", "WAREHOUSE"]));
const gudang = await userDengan(["WAREHOUSE"], new Set(["ADMIN", "OWNER", "FINANCE"]));
const sales = await userDengan(["SALES"], new Set(["ADMIN", "OWNER", "FINANCE", "WAREHOUSE", "PRODUCTION_LEAD"]));
if (!owner) { rec("akun OWNER tersedia", false); process.exit(1); }
const tO = await tokenUntuk(owner); const tF = finMurni ? await tokenUntuk(finMurni) : null; const tG = gudang ? await tokenUntuk(gudang) : null; const tS = sales ? await tokenUntuk(sales) : null;
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const B = (k) => Number(process.env[k]);
const get = async (p, token) => { const r = await fetch(BASE + p, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const post = async (p, token, body = {}, headers = {}) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...headers }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* */ } return { status: r.status, json: j }; };
const TABEL = ["stock_movements", "stock_adjustment_requests", "koreksi_saldo_bahan", "material_issues", "goods_receipts", "fin_journal_entries", "fin_journal_lines", "fin_stock_movement_valuations", "fin_stock_movement_valuation_corrections", "fin_inventory_openings", "fin_inventory_opening_lines", "materials", "units", "unit_usage_notes", "material_harga_berlaku", "stock_movement_biaya_operasional", "biaya_operasional_penerapan"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const sebelum = await fp();

// kode yang berjalan = kode kandidat
rec("kode berjalan: pengaju = inventory:write (Gudang/Admin/Owner); penyetuju = inventory:adjustment_approve (Owner/Finance); Finance tidak menulis ledger", (ROLE_PERMISSIONS.WAREHOUSE ?? []).includes("inventory:write") && (ROLE_PERMISSIONS.OWNER ?? []).includes("inventory:adjustment_approve") && (ROLE_PERMISSIONS.FINANCE ?? []).includes("inventory:adjustment_approve") && !(ROLE_PERMISSIONS.FINANCE ?? []).includes("inventory:write"));
rec("tabel konteks koreksi saldo ada dan kosong (tidak ada yang diajukan saat rilis)", (await hitung("select count(*) as n from koreksi_saldo_bahan")) === 0);
const mat = await prisma.material.findFirst({ where: { active: true }, select: { id: true, unit: true } });
const KS = "/api/inventory/adjustments/koreksi-saldo"; const ID0 = "00000000-0000-4000-8000-000000000000";

// izin: ditolak SEBELUM menyentuh data
rec("keadaan bahan: tanpa token 401", (await get(`${KS}/bahan/${mat.id}`, null)).status === 401);
rec("pratinjau: tanpa token 401", (await post(`${KS}/pratinjau`, null)).status === 401);
rec("ajukan: tanpa token 401", (await post(`${KS}/ajukan`, null, {}, { "Idempotency-Key": "smoke-tanpa-token-1" })).status === 401);
if (tS) { rec("keadaan bahan: SALES 403 (tanpa inventory:read)", (await get(`${KS}/bahan/${mat.id}`, tS)).status === 403); rec("ajukan: SALES 403", (await post(`${KS}/ajukan`, tS, {}, { "Idempotency-Key": "smoke-sales-aaaa" })).status === 403); } else skip("SALES 403", "tidak ada akun SALES murni aktif (diuji di tes integrasi)");
if (tF) {
  const rf = await get(`${KS}/bahan/${mat.id}`, tF);
  rec("Finance murni: keadaan bahan 200 tetapi izin hanya-lihat (bolehMengajukan=false) + teks izin", rf.status === 200 && rf.json?.izin?.bolehMengajukan === false && /hanya dapat melihat/.test(rf.json?.izin?.teks ?? ""), String(rf.status));
  rec("Finance murni: ajukan 403 (penyetuju tidak menulis ledger)", (await post(`${KS}/ajukan`, tF, { materialId: mat.id }, { "Idempotency-Key": "smoke-finance-aaaa" })).status === 403);
} else skip("Finance murni hanya-lihat", "tidak ada akun FINANCE murni aktif (diuji di tes integrasi)");
if (tG) { const rg = await get(`${KS}/bahan/${mat.id}`, tG); rec("Gudang: keadaan bahan 200 dan boleh mengajukan; tidak boleh menyetujui", rg.status === 200 && rg.json?.izin?.bolehMengajukan === true && rg.json?.izin?.bolehMenyetujui === false, String(rg.status)); } else skip("Gudang boleh mengajukan", "tidak ada akun Gudang murni aktif (diuji di tes integrasi)");

// baca-saja untuk Owner: keadaan, pratinjau, daftar Stok & Lokasi, ringkasan harga
const ro = await get(`${KS}/bahan/${mat.id}`, tO);
const KEADAAN = ["BELUM_ADA_CATATAN", "NOL_MENURUT_PERGERAKAN", "NOL_TERVERIFIKASI", "POSITIF", "MINUS"];
rec("Owner: keadaan bahan 200 dengan keadaan saldo valid + riwayat (array)", ro.status === 200 && KEADAAN.includes(ro.json?.keadaanSaldo) && Array.isArray(ro.json?.riwayat), `${ro.status} ${ro.json?.keadaanSaldo}`);
const pos = await prisma.$queryRawUnsafe("select m.id::text id, sum(s.qty)::float bal from materials m join stock_movements s on s.material_id = m.id where m.active group by m.id having sum(s.qty) > 0 order by m.code limit 1");
if (pos[0]) {
  const pr = await post(`${KS}/pratinjau`, tO, { materialId: pos[0].id, jumlahFisik: pos[0].bal + 1 });
  rec("pratinjau (baca-saja): saldo sebelum = ledger, selisih +1, arah NAIK, dampak data memuat 'tidak disentuh', izin", pr.status === 200 && Math.abs(pr.json?.saldoSebelum - pos[0].bal) < 1e-6 && pr.json?.selisih === 1 && pr.json?.arah === "NAIK" && (pr.json?.dampakData?.tidakDisentuh ?? []).some((x) => /Harga Berlaku/.test(x)) && !!pr.json?.izin, `${pr.status}`);
} else skip("pratinjau bahan bersaldo positif", "tidak ada bahan bersaldo positif");
const pm = await post(`${KS}/pratinjau`, tO, { materialId: mat.id, jumlahFisik: -1 }); rec("pratinjau jumlah minus ditolak 400 JUMLAH_MINUS (tanpa menulis)", pm.status === 400 && pm.json?.code === "JUMLAH_MINUS", `${pm.status} ${pm.json?.code}`);
const nk = await post(`${KS}/ajukan`, tO, { materialId: mat.id, jumlahFisik: 1, saldoDilihat: 0, alasan: "smoke tanpa kunci" }); rec("ajukan tanpa Idempotency-Key ditolak 400 KUNCI_WAJIB SEBELUM menyentuh data", nk.status === 400 && nk.json?.code === "KUNCI_WAJIB", `${nk.status} ${nk.json?.code}`);
const na = await post(`${KS}/ajukan`, tO, { materialId: mat.id, jumlahFisik: 1, saldoDilihat: 0, alasan: "" }, { "Idempotency-Key": "smoke-tanpa-alasan-1" }); rec("ajukan tanpa alasan ditolak 400 ALASAN_WAJIB SEBELUM menyentuh data", na.status === 400 && na.json?.code === "ALASAN_WAJIB", `${na.status} ${na.json?.code}`);
const nb = await get(`${KS}/bahan/${ID0}`, tO); rec("bahan tidak ada → 404 (bukan 500)", nb.status === 404, String(nb.status));
const sl = await get("/api/inventory/beranda/stok", tO);
const barisSl = sl.json?.rows ?? [];
rec(`Stok & Lokasi: ${barisSl.length} bahan memuat keadaanSaldo valid; saldo null ⇔ BELUM_ADA_CATATAN (belum ada catatan ≠ nol)`, sl.status === 200 && barisSl.length > 0 && barisSl.every((r) => KEADAAN.includes(r.keadaanSaldo)) && barisSl.every((r) => (r.saldo === null) === (r.keadaanSaldo === "BELUM_ADA_CATATAN")), `${sl.status}`);
rec("Stok & Lokasi: nol terverifikasi hanya bila ada bukti (nomor sumber); nol menurut pergerakan tidak punya bukti", barisSl.filter((r) => r.keadaanSaldo === "NOL_TERVERIFIKASI").every((r) => !!r.nolTerverifikasi?.nomor) && barisSl.filter((r) => r.keadaanSaldo === "NOL_MENURUT_PERGERAKAN").every((r) => !r.nolTerverifikasi));
const rh = await get("/api/finance/biaya-bahan/harga-berlaku/ringkasan-daftar", tO);
rec("ringkasan harga per satuan untuk daftar (Owner) 200; jumlah konsisten; bahan tanpa harga tidak muncul sebagai Rp0", rh.status === 200 && rh.json?.jumlah === Object.keys(rh.json?.harga ?? {}).length && Object.values(rh.json?.harga ?? {}).every((h) => h.harga === null || Number(h.harga) > 0), `${rh.status}`);
if (tG) rec("ringkasan harga: Gudang 403 (tanpa finance:read) — kolom harga tidak tampil bagi Gudang", (await get("/api/finance/biaya-bahan/harga-berlaku/ringkasan-daftar", tG)).status === 403);

// tak ada jejak tulis: semua tabel (lama + baru) sama persis sebelum vs sesudah smoke
const sesudah = await fp(); const beda = TABEL.filter((t) => sebelum[t].n !== sesudah[t].n || sebelum[t].h !== sesudah[t].h);
rec("TIDAK ada jejak tulis: stok, permintaan penyesuaian, konteks koreksi, Material Issue, penerimaan, jurnal, valuasi/koreksi Finance, PSA, katalog, catatan pemakaian, Harga Berlaku sama persis sebelum vs sesudah smoke", beda.length === 0, beda.join(",") || "identik");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
