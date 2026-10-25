import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER", "PRODUCTION_LEAD", "WAREHOUSE"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u; }
  return null;
}
const adm = await userDengan("ADMIN", new Set());
const sales = await userDengan("SALES", BERIZIN);
if (!adm) { rec("akun ADMIN tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm); const tS = sales ? await tokenUntuk(sales) : null;
const B = (k) => Number(process.env[k]);
const req = async (method, path, token, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.clone().json(); } catch { /* bukan JSON */ } return { status: r.status, json: j, teks: await r.text().catch(() => "") }; };
const get = (p, t) => req("GET", p, t);
const TABEL = ["Customer", "Order", "payments", "AdSpend", "meta_ad_daily_spend", "meta_spend_imports", "attribution_touches", "fin_journal_entries", "fin_journal_lines", "stock_movements", "units", "ad_source_spend_entries", "ad_source_spend_revisions"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const sebelum = await fp();
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);

// periode: 30 hari PENUH berakhir kemarin (WIB)
const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const geser = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const SAMPAI = geser(hariIni, -1), DARI = geser(hariIni, -30);

// tabel rilis terpasang dan KOSONG; kode berjalan memuat modul rilis
rec("2 tabel rilis ada dan KOSONG (rilis tidak mengimpor/menulis biaya)", (await hitung("select (select count(*) from ad_source_spend_entries) + (select count(*) from ad_source_spend_revisions) as n")) === 0 && (await hitung("select count(*) as n from pg_tables where schemaname='public' and tablename in ('ad_source_spend_entries','ad_source_spend_revisions')")) === 2);
const M = await import("/app/src/services/attribution/biayaSumber.js");
rec("kode berjalan = kandidat: modul biayaSumber memuat prioritas 'detail Ad parsial' (DETAIL_AD_SELISIH)", typeof M.hitungCakupan === "function" && M.hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-20", hariIni: "2026-10-26", entries: [{ id: "x", sourceId: "META", kind: "HARIAN", dateFrom: "2026-10-20", dateTo: "2026-10-20", accountId: "", amount: 2000000, override: false, status: "AKTIF" }], adHarian: new Map([["2026-10-20", 500000]]) }).status === "DETAIL_AD_SELISIH");

// izin: ditolak SEBELUM menyentuh data
for (const [m, p] of [["GET", `/api/atribusi/iklan/sumber?dari=${DARI}&sampai=${SAMPAI}`], ["GET", `/api/atribusi/iklan/biaya-sumber?dari=${DARI}&sampai=${SAMPAI}`], ["PUT", "/api/atribusi/iklan/biaya-sumber"], ["POST", "/api/atribusi/iklan/biaya-sumber/00000000-0000-4000-8000-000000000000/batalkan"], ["GET", "/api/atribusi/iklan/biaya-sumber/00000000-0000-4000-8000-000000000000/riwayat"]]) {
  rec(`${m} ${p.split("?")[0].replace("/api/atribusi/iklan", "")}: tanpa token 401`, (await req(m, p, null, m === "GET" ? undefined : {})).status === 401);
  if (tS) rec(`${m} ${p.split("?")[0].replace("/api/atribusi/iklan", "")}: SALES 403`, (await req(m, p, tS, m === "GET" ? undefined : {})).status === 403);
}
if (!tS) skip("izin SALES 403", "tidak ada akun SALES murni aktif (diuji pada rehearsal dan tes integrasi)");
// validasi ditolak sebelum menyentuh data (TIDAK ada penulisan produksi)
rec("PUT biaya: nominal negatif 400; sumber organik 400; hari berjalan 400", (await req("PUT", "/api/atribusi/iklan/biaya-sumber", tA, { sumber: "TIKTOK", jenis: "HARIAN", dari: SAMPAI, nominal: "-5", alasan: "uji smoke" })).status === 400
  && (await req("PUT", "/api/atribusi/iklan/biaya-sumber", tA, { sumber: "INSTAGRAM", jenis: "HARIAN", dari: SAMPAI, nominal: "5", alasan: "uji smoke" })).status === 400
  && (await req("PUT", "/api/atribusi/iklan/biaya-sumber", tA, { sumber: "TIKTOK", jenis: "HARIAN", dari: hariIni, nominal: "5", alasan: "uji smoke" })).status === 400);
const dry = await req("PUT", "/api/atribusi/iklan/biaya-sumber", tA, { sumber: "TIKTOK", jenis: "HARIAN", dari: SAMPAI, nominal: "1", alasan: "uji smoke dry-run", dryRun: true });
rec("PUT biaya dryRun = rencana saja (200, ditulis=false)", dry.status === 200 && dry.json?.ditulis === false && dry.json?.dryRun === true, String(dry.status));

// periode (URL → API): respons memuat periode yang diminta; parameter salah ditolak
const s = await get(`/api/atribusi/iklan/sumber?dari=${DARI}&sampai=${SAMPAI}`, tA);
rec("GET /sumber (ADMIN) 200 dan periode = periode yang diminta", s.status === 200 && s.json?.periode?.dari === DARI && s.json?.periode?.sampai === SAMPAI && s.json?.periode?.termasukHariBerjalan === false, `${DARI}..${SAMPAI}`);
rec("GET /sumber: satu batas / terbalik / masa depan = 400", (await get(`/api/atribusi/iklan/sumber?dari=${DARI}`, tA)).status === 400 && (await get(`/api/atribusi/iklan/sumber?dari=${SAMPAI}&sampai=${DARI}`, tA)).status === 400 && (await get("/api/atribusi/iklan/sumber?dari=2099-01-01&sampai=2099-01-02", tA)).status === 400);
const hi = await get(`/api/atribusi/iklan/sumber?dari=${DARI}&sampai=${hariIni}`, tA);
const meta0 = hi.json?.sumber?.find((x) => x.id === "META");
rec("rentang memuat hari ini: peringatan HARI_BERJALAN dan semua CPA/ROAS null (tidak ada angka semu)", hi.status === 200 && hi.json.periode.termasukHariBerjalan === true && hi.json.peringatan.some((p) => p.kode === "HARI_BERJALAN") && hi.json.sumber.every((x) => x.biaya.cpa === null && x.biaya.cashRoas === null && x.biaya.bookedRoas === null));
const j = s.json;
// kontrak
rec("kontrak: 6 sumber; dasar biaya 'ATRIBUSI_LABEL_CRM'; organik 'TIDAK_TERSEDIA_ORGANIK'; biayaCampaignTerbukti hanya Meta; total.berbayar & cutoffEvaluasi ada",
  j?.sumber?.length === 6 && j.sumber.every((x) => x.biaya.dasar === "ATRIBUSI_LABEL_CRM") && j.sumber.filter((x) => x.jenis === "ORGANIK").every((x) => x.biaya.status === "TIDAK_TERSEDIA_ORGANIK" && x.biaya.spend === null)
  && j.sumber.filter((x) => x.biayaCampaignTerbukti).map((x) => x.id).join() === "META" && !!j.total.berbayar && /WIB$/.test(j.cutoffEvaluasi?.waktuWib || ""));
rec("biaya belum diisi ≠ Rp0: TikTok & Lainnya 'BELUM_DIISI', spend/CPA/ROAS null; total berbayar tidak dihitung (null)", ["TIKTOK", "LAINNYA"].every((id) => { const b = j.sumber.find((x) => x.id === id).biaya; return b.status === "BELUM_DIISI" && b.spend === null && b.cpa === null && b.cashRoas === null; }) && j.total.berbayar.cpa === null && j.total.berbayar.spend === null);
// rekonsiliasi (SQL independen + konsistensi internal); rentang berakhir kemarin → stabil selama rilis
const lo = new Date(Date.parse(DARI + "T00:00:00Z") - 7 * 3600e3), hiT = new Date(Date.parse(SAMPAI + "T00:00:00Z") + 864e5 - 7 * 3600e3);
for (const [id, label] of [["META", "META_ADS"], ["TIKTOK", "TIKTOK_ADS"], ["WHATSAPP", "WHATSAPP_DIRECT"]]) {
  const sql = await prisma.customer.count({ where: { leadSource: label, createdAt: { gte: lo, lt: hiT } } });
  rec(`rekonsiliasi SQL independen: lead ${id} = ${sql}`, j.sumber.find((x) => x.id === id).lead === sql);
}
const jml = (k) => j.sumber.reduce((a, x) => a + x[k], 0);
rec("rekonsiliasi: Σ per sumber = total (lead, spam, ber-order, membayar, lunas); nilai order & pembayaran bersih", ["lead", "spam", "berOrder", "membayar", "lunas"].every((k) => jml(k) === j.total[k]) && Math.abs(j.sumber.reduce((a, x) => a + x.uang.nilaiOrderSaatIni, 0) - j.total.nilaiOrderSaatIni) < 0.01 && Math.abs(j.sumber.reduce((a, x) => a + x.uang.uangBersih, 0) - j.total.uangBersih) < 0.01);
rec("rekonsiliasi: kategori saling lepas = ber-order per sumber", j.sumber.every((x) => x.kategoriEksklusif.jumlah === x.berOrder));
// laporan lain tidak berubah kontraknya
const ik = await get(`/api/atribusi/iklan?level=campaign&dari=${DARI}&sampai=${SAMPAI}`, tA);
rec("laporan iklan per campaign (tab Iklan) 200 dan memakai periode yang sama", ik.status === 200 && ik.json?.periode?.dari === DARI && ik.json?.periode?.sampai === SAMPAI && Array.isArray(ik.json?.grup));
const d7 = await get(`/api/atribusi/iklan/d7?dari=${geser(hariIni, -9)}&sampai=${SAMPAI}`, tA);
rec("D7 200 (kontrak tidak berubah)", d7.status === 200);
// tak ada jejak tulis
const sesudah = await fp(); const beda = TABEL.filter((t) => sebelum[t].n !== sesudah[t].n || sebelum[t].h !== sesudah[t].h);
rec("TIDAK ada jejak tulis: Customer, Order, pembayaran, AdSpend, spend per Ad, touch, jurnal, stok, unit, dan 2 tabel biaya sama persis sebelum vs sesudah smoke", beda.length === 0, beda.join(",") || "identik");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
