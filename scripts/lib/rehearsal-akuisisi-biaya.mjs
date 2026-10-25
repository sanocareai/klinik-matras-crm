import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const express = require("express");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { attributionAdsRouter } = await import("/app/src/routes/attributionAds.js");
let gagal = 0; let n = 0; let dilewati = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const skip = (nama, alasan) => { dilewati += 1; console.log(`SKIP  ${nama} — DILEWATI: ${alasan}`); };
const num = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const DARI = process.env.PER_DARI, SAMPAI = process.env.PER_SAMPAI;
if (!/^\d{4}-\d{2}-\d{2}$/.test(DARI || "") || !/^\d{4}-\d{2}-\d{2}$/.test(SAMPAI || "")) { console.log("GAGAL periode tidak diberikan"); process.exit(1); }
const ALASAN = "FIXTURE UJI rehearsal (angka fiktif; DB sementara)";
const hariDari = (a, b) => { const o = []; for (let d = Date.parse(a + "T00:00:00Z"); d <= Date.parse(b + "T00:00:00Z"); d += 864e5) o.push(new Date(d).toISOString().slice(0, 10)); return o; };

// A. struktur baru kosong; tabel tidak berpengaruh pada tabel lama
cek("tabel rilis kosong setelah migrasi (tidak ada backfill)", (await num("select (select count(*) from ad_source_spend_entries) + (select count(*) from ad_source_spend_revisions) as n")) === 0);
const TABEL = ["Customer", "Order", "payments", "AdSpend", "meta_ad_daily_spend", "meta_spend_imports", "attribution_touches", "fin_journal_entries", "fin_journal_lines", "stock_movements", "units"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const bedaTabel = (a, b) => TABEL.filter((t) => a[t].n !== b[t].n || a[t].h !== b[t].h);
const fp0 = await fp();

// B. server dengan router ASLI + sesi ADMIN nyata (token ditandatangani dengan JWT_SECRET lingkungan)
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER", "PRODUCTION_LEAD", "WAREHOUSE"]);
let adm = null, sales = null;
for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if (!adm && rs.has("ADMIN")) adm = u; if (!sales && rs.has("SALES") && ![...rs].some((r) => BERIZIN.has(r))) sales = u; }
if (!adm) { cek("akun ADMIN tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm); const tS = sales ? await tokenUntuk(sales) : null;
const app = express(); app.use(express.json()); app.use("/api/atribusi/iklan", attributionAdsRouter);
const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); }); const BASE = `http://127.0.0.1:${srv.address().port}/api/atribusi/iklan`;
const call = async (m, p, { token = tA, body } = {}) => { const r = await fetch(BASE + p, { method: m, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { s: r.status, j }; };

// C. izin
for (const [m, p] of [["GET", `/biaya-sumber?dari=${DARI}&sampai=${SAMPAI}`], ["PUT", "/biaya-sumber"], ["POST", "/biaya-sumber/00000000-0000-4000-8000-000000000000/batalkan"], ["GET", "/biaya-sumber/00000000-0000-4000-8000-000000000000/riwayat"], ["GET", `/sumber?dari=${DARI}&sampai=${SAMPAI}`]]) {
  cek(`${m} ${p.split("?")[0]}: tanpa token 401`, (await call(m, p, { token: null, body: m === "GET" ? undefined : {} })).s === 401);
  if (tS) cek(`${m} ${p.split("?")[0]}: SALES 403`, (await call(m, p, { token: tS, body: m === "GET" ? undefined : {} })).s === 403); else skip(`${m} ${p.split("?")[0]}: SALES 403`, "tidak ada akun SALES murni aktif");
}
cek("validasi: nominal negatif 400, sumber organik 400, hari berjalan 400 (sebelum menyentuh data)",
  (await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: SAMPAI, nominal: "-1", alasan: ALASAN } })).s === 400
  && (await call("PUT", "/biaya-sumber", { body: { sumber: "WHATSAPP", jenis: "HARIAN", dari: SAMPAI, nominal: "1", alasan: ALASAN } })).s === 400
  && (await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), nominal: "1", alasan: ALASAN } })).s === 400);
cek("parameter periode salah 400 (satu batas / terbalik / masa depan)", (await call("GET", `/sumber?dari=${DARI}`)).s === 400 && (await call("GET", `/sumber?dari=${SAMPAI}&sampai=${DARI}`)).s === 400 && (await call("GET", "/sumber?dari=2099-01-01&sampai=2099-01-02")).s === 400);

// D. periode: respons mengembalikan periode yang diminta (URL → API → tampilan)
const ambil = async (d = DARI, s = SAMPAI) => { const r = await call("GET", `/sumber?dari=${d}&sampai=${s}`); if (r.s !== 200) throw new Error("GET /sumber " + r.s); return r.j; };
const agregat = (j) => Object.fromEntries(j.sumber.map((x) => [x.id, [x.lead, x.spam, x.leadSah, x.berOrder, x.membayar, x.lunas, x.pernahDp, x.dpSaatIni, x.uang.nilaiOrderSaatIni, x.uang.uangLedger, x.uang.refund, x.uang.uangBersih]]));
const j0 = await ambil();
cek("periode di respons = periode yang diminta; 6 sumber; organik 'tidak tersedia'; TikTok & Lainnya belum diisi; dasar 'Atribusi label CRM'",
  j0.periode.dari === DARI && j0.periode.sampai === SAMPAI && j0.sumber.length === 6 && j0.sumber.filter((x) => x.jenis === "ORGANIK").every((x) => x.biaya.status === "TIDAK_TERSEDIA_ORGANIK" && x.biaya.spend === null)
  && j0.sumber.find((x) => x.id === "TIKTOK").biaya.status === "BELUM_DIISI" && j0.sumber.every((x) => x.biaya.dasar === "ATRIBUSI_LABEL_CRM"), JSON.stringify(j0.sumber.map((x) => [x.id, x.biaya.status])));
cek("kontrak: biayaCampaignTerbukti hanya Meta; total.berbayar ada dan null selama biaya belum lengkap; cutoff evaluasi ada", j0.sumber.filter((x) => x.biayaCampaignTerbukti).map((x) => x.id).join() === "META" && j0.total.berbayar.lengkap === false && j0.total.berbayar.cpa === null && /WIB$/.test(j0.cutoffEvaluasi?.waktuWib || ""));
// rekonsiliasi independen (SQL) untuk label iklan
const lo = new Date(Date.parse(DARI + "T00:00:00Z") - 7 * 3600e3), hi = new Date(Date.parse(SAMPAI + "T00:00:00Z") + 864e5 - 7 * 3600e3);
for (const [id, label] of [["META", "META_ADS"], ["TIKTOK", "TIKTOK_ADS"], ["WHATSAPP", "WHATSAPP_DIRECT"]]) {
  const sql = await prisma.customer.count({ where: { leadSource: label, createdAt: { gte: lo, lt: hi } } });
  cek(`rekonsiliasi SQL independen: lead ${id} = ${sql}`, j0.sumber.find((x) => x.id === id).lead === sql);
}
const jumlah = (k) => j0.sumber.reduce((a, x) => a + x[k], 0);
cek("rekonsiliasi: jumlah per sumber = total (lead, spam, ber-order, membayar, lunas)", ["lead", "spam", "berOrder", "membayar", "lunas"].every((k) => jumlah(k) === j0.total[k]));
const A0 = agregat(j0);

// E. TikTok: isi setiap hari periode (FIXTURE) → LENGKAP; CPA = biaya ÷ customer lunas unik; idempoten; ubah; konflik; batal
const hari = hariDari(DARI, SAMPAI); let dibuat = 0;
for (const d of hari) { const r = await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: d, nominal: "150000", alasan: ALASAN } }); if (r.s === 201) dibuat++; }
cek(`TikTok: ${hari.length} entri harian dibuat (201) dan satu entri per hari`, dibuat === hari.length && (await num("select count(*) as n from ad_source_spend_entries where source_id='TIKTOK'")) === hari.length);
const ulang = await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: hari[0], nominal: "150000", alasan: ALASAN } });
cek("input ulang identik = TIDAK_BERUBAH, tanpa revisi baru (idempoten)", ulang.s === 200 && ulang.j.aksi === "TIDAK_BERUBAH" && ulang.j.ditulis === false && (await num("select count(*) as n from ad_source_spend_revisions")) === hari.length);
const par = await Promise.all([1, 2, 3, 4].map(() => call("PUT", "/biaya-sumber", { body: { sumber: "LAINNYA", jenis: "HARIAN", dari: hari[0], nominal: "7000", alasan: ALASAN } })));
cek("empat permintaan serentak pada kunci yang sama menulis tepat SATU entri", par.filter((x) => x.j?.ditulis).length === 1 && (await num("select count(*) as n from ad_source_spend_entries where source_id='LAINNYA'")) === 1);
const j1 = await ambil(); const tt = j1.sumber.find((x) => x.id === "TIKTOK");
cek("TikTok LENGKAP: spend = 150000 × hari; CPA = spend ÷ customer lunas unik (atau null 'BELUM_ADA_KONVERSI'); ROAS tanpa spend nol", tt.biaya.status === "LENGKAP" && tt.biaya.spend === 150000 * hari.length
  && (tt.lunas > 0 ? Math.abs(tt.biaya.cpa - Math.round((tt.biaya.spend / tt.lunas) * 100) / 100) < 0.01 : (tt.biaya.cpa === null && tt.biaya.alasanNull.cpa === "BELUM_ADA_KONVERSI")), JSON.stringify([tt.biaya.spend, tt.lunas, tt.biaya.cpa, tt.biaya.bookedRoas, tt.biaya.cashRoas]));
cek("total berbayar tetap null selama Meta belum lengkap (tidak ada total semu)", j1.total.berbayar.lengkap === false || j1.sumber.find((x) => x.id === "META").biaya.status === "LENGKAP");
const ub = await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: hari[0], nominal: "175000.50", alasan: ALASAN + " (koreksi)" } });
cek("ubah nominal: UBAH + revisi 2 + nilai lama/baru", ub.j.aksi === "UBAH" && ub.j.revisi === 2 && ub.j.perubahan.nominalLama === 150000 && ub.j.perubahan.nominalBaru === 175000.5);
cek("konflik: total rentang menimpa entri harian aktif → 409 tanpa menulis", (await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "TOTAL_RENTANG", dari: hari[0], sampai: hari[1] ?? hari[0], nominal: "1", alasan: ALASAN } })).s === 409);
const rw = await call("GET", `/biaya-sumber/${ub.j.id}/riwayat`);
cek("audit: revisi append-only memuat pengubah, alasan, nilai lama→baru", rw.j.riwayat.length === 2 && rw.j.riwayat.every((x) => x.olehId === adm.id && x.alasan) && rw.j.riwayat[1].nominalLama === 150000 && rw.j.riwayat[1].nominalBaru === 175000.5);
const bt = await call("POST", `/biaya-sumber/${ub.j.id}/batalkan`, { body: { alasan: "FIXTURE UJI batal" } });
const j2 = await ambil();
cek("batal: entri tidak dihapus (riwayat tetap), hari itu kembali kosong → SPEND_TIDAK_LENGKAP + KPI null", bt.j.status === "DIBATALKAN" && j2.sumber.find((x) => x.id === "TIKTOK").biaya.status === "SPEND_TIDAK_LENGKAP" && j2.sumber.find((x) => x.id === "TIKTOK").biaya.cpa === null && (await num("select count(*) as n from ad_source_spend_entries where id = '" + ub.j.id + "'")) === 1);
const akt = await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: hari[0], nominal: "150000", alasan: ALASAN + " (aktifkan)" } });
cek("input ulang pada entri batal = AKTIFKAN kembali (bukan entri ganda)", akt.j.aksi === "AKTIFKAN" && (await num("select count(*) as n from ad_source_spend_entries where source_id='TIKTOK' and date_from = '" + hari[0] + "'")) === 1);

// F. Meta: detail Ad (data produksi nyata pada salinan) vs manual — parsial/override/pencabutan
const ad = (await prisma.$queryRawUnsafe(`select to_char(date_wib,'YYYY-MM-DD') d, sum(spend)::text s from meta_ad_daily_spend where date_wib < (now() at time zone 'Asia/Jakarta')::date group by date_wib order by date_wib desc limit 1`))[0];
if (!ad) skip("Meta: detail Ad vs manual", "tidak ada detail Ad di salinan restore");
else {
  const det = Number(ad.s); const meta = async () => (await ambil(ad.d, ad.d)).sumber.find((x) => x.id === "META");
  const m0 = await meta(); cek(`Meta ${ad.d}: detail Ad saja → LENGKAP, sumber angka & alasan terbaca`, m0.biaya.status === "LENGKAP" && m0.biaya.spend === det && m0.biaya.cakupan.pemilihan[0].kode === "AD_DETAIL" && /diutamakan atas entri manual/.test(m0.biaya.cakupan.pemilihan[0].alasan), JSON.stringify(m0.biaya.cakupan.asalDetailAd));
  const man = (o) => ({ sumber: "META", jenis: "HARIAN", dari: ad.d, nominal: String(Math.round(det * 3)), alasan: ALASAN, ...o });
  await call("PUT", "/biaya-sumber", { body: man() }); const m1 = await meta();
  cek("manual 3× detail → DETAIL_AD_SELISIH (detail dianggap parsial), spend tetap = detail (tidak dijumlah), KPI null", m1.biaya.status === "DETAIL_AD_SELISIH" && m1.biaya.spend === det && m1.biaya.cpa === null && m1.biaya.cashRoas === null, m1.biaya.status);
  await call("PUT", "/biaya-sumber", { body: man({ gantiDetailAd: true, alasan: ALASAN + " (override)" }) }); const m2 = await meta();
  cek("override → LENGKAP memakai manual (menggantikan, bukan menambah)", m2.biaya.status === "LENGKAP" && m2.biaya.spend === Math.round(det * 3) && m2.biaya.cakupan.pemilihan[0].kode === "MANUAL_OVERRIDE");
  await call("PUT", "/biaya-sumber", { body: man({ alasan: ALASAN + " (cabut override)" }) }); const m3 = await meta();
  cek("pencabutan override → kembali ke detail Ad + selisih muncul lagi", m3.biaya.status === "DETAIL_AD_SELISIH" && m3.biaya.spend === det);
  const d0 = await call("PUT", "/biaya-sumber", { body: man({ nominal: String(det), alasan: ALASAN + " (sama dengan detail)" }) }); const m4 = await meta();
  cek("manual = detail Ad → LENGKAP (tidak ada selisih), detail dipakai", d0.s === 200 && m4.biaya.status === "LENGKAP" && m4.biaya.spend === det);
}

// G. rekonsiliasi sesudah penulisan: hitungan & uang tidak berubah karena biaya; tabel lama tidak tersentuh
const j3 = await ambil(); const A1 = agregat(j3);
cek("rekonsiliasi: lead/ber-order/membayar/lunas/nilai/uang per sumber IDENTIK sebelum vs sesudah menulis biaya", JSON.stringify(A0) === JSON.stringify(A1));
const fp1 = await fp();
cek("TIDAK menyentuh tabel lama: Customer, Order, Payment, AdSpend, spend per Ad, touch, jurnal, stok, unit identik", bedaTabel(fp0, fp1).length === 0, bedaTabel(fp0, fp1).join(","));
cek("jejak audit: setiap entri punya revisi; jumlah revisi ≥ jumlah entri", (await num("select count(*) as n from ad_source_spend_revisions")) >= (await num("select count(*) as n from ad_source_spend_entries")));
const e1 = await prisma.$executeRawUnsafe("update ad_source_spend_revisions set reason = 'x'").then(() => null, (e) => e); const e2 = await prisma.$executeRawUnsafe("delete from ad_source_spend_revisions").then(() => null, (e) => e);
cek("trigger DB: revisi tidak bisa diubah/dihapus", !!e1 && !!e2);
console.log("AGREGAT_BARU=" + JSON.stringify(A1));
srv.close(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal + " dilewati=" + dilewati);
process.exit(gagal === 0 ? 0 : 1);
