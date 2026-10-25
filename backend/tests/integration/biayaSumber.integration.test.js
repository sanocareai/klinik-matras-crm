// Tes integrasi BIAYA IKLAN TINGKAT SUMBER — router ASLI + PostgreSQL sekali pakai (migrasi 20261230090000 dijalankan oleh runIsolated), lewat HTTP.
// Membuktikan: RBAC (401/403), PUT idempoten + revisi + audit append-only, dry-run tidak menulis, konflik 409, batal & aktifkan kembali, GET baca-saja,
// manual tidak bocor ke meta_ad_daily_spend/campaign, Windsor/API vs manual tidak dijumlah ganda (detail Ad menang; override eksplisit), total rentang tidak diprorata,
// /sumber memuat biaya sumber berlabel "Atribusi label CRM", dan CPA/ROAS null bila cakupan belum lengkap.
process.env.JWT_SECRET ||= "rahasia-uji-biaya-sumber";
await import("./setup/env.js");
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { default: jwt } = await import("jsonwebtoken");
const { testPrisma, truncateAll } = await import("./setup/testDb.js");
const { startTestServer } = await import("./setup/testApp.js");
const { attributionAdsRouter } = await import("../../src/routes/attributionAds.js");

const T = (s) => new Date(s);
let server, admin, sales, tokenAdmin, tokenSales, imp;
const api = async (method, p, { token = tokenAdmin, body } = {}) => {
  const res = await fetch(`${server.baseUrl}/api/atribusi/iklan${p}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const teks = await res.text(); let json = null; try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  return { status: res.status, json, teks };
};
const hitung = async () => ({
  entri: Number((await testPrisma.$queryRawUnsafe("select count(*)::int c from ad_source_spend_entries"))[0].c),
  revisi: Number((await testPrisma.$queryRawUnsafe("select count(*)::int c from ad_source_spend_revisions"))[0].c),
  adSpend: await testPrisma.metaAdDailySpend.count(), imports: await testPrisma.metaSpendImport.count(), cust: await testPrisma.customer.count(), ord: await testPrisma.order.count(), pay: await testPrisma.payment.count(),
});
const bersih = () => testPrisma.$executeRawUnsafe("TRUNCATE TABLE ad_source_spend_revisions, ad_source_spend_entries");
const harian = (o = {}) => ({ sumber: "TIKTOK", jenis: "HARIAN", dari: "2026-08-01", nominal: "150000", alasan: "Invoice TikTok Ads 1 Agustus", ...o });

test.before(async () => {
  await truncateAll();
  for (const m of ["metaAdSpendRevision", "metaAdDailySpend", "metaSpendImport"]) await testPrisma[m].deleteMany({});
  await bersih();
  admin = await testPrisma.user.create({ data: { name: "Admin Biaya", email: `adm-bs-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  sales = await testPrisma.user.create({ data: { name: "Sales Biaya", email: `sls-bs-${Date.now()}@example.test`, passwordHash: "x", role: "SALES" } });
  const tok = (u, roles) => jwt.sign({ id: u.id, name: u.name, role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: "1h" });
  tokenAdmin = tok(admin, ["ADMIN"]); tokenSales = tok(sales, ["SALES"]);
  imp = await testPrisma.metaSpendImport.create({ data: { source: "WINDSOR_API", accountId: "1234567890", contentSha256: "a".repeat(64), rowsTotal: 0, rowsAccepted: 0, rowsRejected: 0, rowsNew: 0, rowsUpdated: 0, rowsUnchanged: 0, spendTotal: 0 } });
  const app = express(); app.use(express.json({ limit: "1mb" })); app.use("/api/atribusi/iklan", attributionAdsRouter);
  server = await startTestServer(app);
});
test.after(async () => {
  await bersih().catch(() => {});
  for (const m of ["metaAdSpendRevision", "metaAdDailySpend", "metaSpendImport"]) await testPrisma[m].deleteMany({}).catch(() => {});
  await server?.close?.(); await testPrisma.$disconnect();
});

test("RBAC: tanpa token 401, SALES 403 untuk semua rute biaya-sumber; parameter salah 400", async () => {
  for (const [m, p] of [["GET", "/biaya-sumber?dari=2026-08-01&sampai=2026-08-03"], ["PUT", "/biaya-sumber"], ["POST", "/biaya-sumber/00000000-0000-4000-8000-000000000000/batalkan"], ["GET", "/biaya-sumber/00000000-0000-4000-8000-000000000000/riwayat"]]) {
    assert.equal((await api(m, p, { token: null, body: m === "GET" ? undefined : {} })).status, 401, `${m} ${p} tanpa token`);
    assert.equal((await api(m, p, { token: tokenSales, body: m === "GET" ? undefined : {} })).status, 403, `${m} ${p} SALES`);
  }
  assert.equal((await api("GET", "/biaya-sumber")).status, 400);
  assert.equal((await api("GET", "/biaya-sumber?dari=2026-08-05&sampai=2026-08-01")).status, 400);
  assert.equal((await api("GET", "/biaya-sumber?dari=2026-01-01&sampai=2026-08-01")).status, 400, "lebih dari 93 hari");
  assert.equal((await api("GET", "/biaya-sumber?dari=2026-08-01&sampai=2026-08-03&sumber=WHATSAPP")).status, 400);
  assert.equal((await api("PUT", "/biaya-sumber", { body: harian({ nominal: "-1" }) })).json.code, "NOMINAL_NEGATIF");
  assert.equal((await api("PUT", "/biaya-sumber", { body: harian({ sumber: "INSTAGRAM" }) })).json.code, "SUMBER_TIDAK_BERBIAYA");
  assert.equal((await api("PUT", "/biaya-sumber", { body: harian({ dari: "2099-01-01" }) })).json.code, "HARI_BERJALAN");
  assert.equal((await hitung()).entri, 0);
});

test("PUT: dry-run tidak menulis; buat 201; ulang IDENTIK = 200 TIDAK_BERUBAH tanpa revisi baru (idempoten); ubah nominal → revisi 2 + riwayat lama/baru/siapa/alasan", async () => {
  const dry = await api("PUT", "/biaya-sumber", { body: harian({ dryRun: true }) });
  assert.deepEqual([dry.status, dry.json.aksi, dry.json.ditulis], [200, "BARU", false]); assert.equal((await hitung()).entri, 0);
  const a = await api("PUT", "/biaya-sumber", { body: harian() });
  assert.deepEqual([a.status, a.json.aksi, a.json.ditulis, a.json.revisi], [201, "BARU", true, 1]);
  const ulang = await api("PUT", "/biaya-sumber", { body: harian() });
  assert.deepEqual([ulang.status, ulang.json.aksi, ulang.json.ditulis, ulang.json.id], [200, "TIDAK_BERUBAH", false, a.json.id]);
  const paralel = await Promise.all([api("PUT", "/biaya-sumber", { body: harian({ dari: "2026-08-02" }) }), api("PUT", "/biaya-sumber", { body: harian({ dari: "2026-08-02" }) })]);
  assert.equal(paralel.filter((r) => r.json.ditulis).length, 1, "dua permintaan bersamaan menulis tepat SATU entri");
  assert.deepEqual([(await hitung()).entri, (await hitung()).revisi], [2, 2]);
  const ubah = await api("PUT", "/biaya-sumber", { body: harian({ nominal: "175000.50", alasan: "Koreksi sesuai invoice final" }) });
  assert.deepEqual([ubah.status, ubah.json.aksi, ubah.json.revisi, ubah.json.id], [200, "UBAH", 2, a.json.id]);
  const rw = await api("GET", `/biaya-sumber/${a.json.id}/riwayat`);
  assert.equal(rw.json.riwayat.length, 2);
  assert.deepEqual(rw.json.riwayat.map((r) => [r.revisi, r.aksi, r.nominalLama, r.nominalBaru, r.olehId]), [[1, "BUAT", null, 150000, admin.id], [2, "UBAH", 150000, 175000.5, admin.id]]);
  assert.equal(rw.json.riwayat[1].alasan, "Koreksi sesuai invoice final");
  assert.equal(JSON.stringify(rw.json).includes("token"), false);
  assert.equal((await api("GET", "/biaya-sumber/bukan-uuid/riwayat")).status, 404);
});

test("audit append-only: UPDATE/DELETE pada revisi ditolak trigger; entri tidak dapat dihapus selagi punya revisi (RESTRICT)", async () => {
  await assert.rejects(testPrisma.$executeRawUnsafe("update ad_source_spend_revisions set reason = 'diubah'"), /append|tidak|trigger|only/i);
  await assert.rejects(testPrisma.$executeRawUnsafe("delete from ad_source_spend_revisions"), /append|tidak|trigger|only/i);
  await assert.rejects(testPrisma.$executeRawUnsafe("delete from ad_source_spend_entries"), /foreign|violates|restrict|key/i);
  await assert.rejects(testPrisma.$executeRawUnsafe("insert into ad_source_spend_entries (id,source_id,kind,date_from,date_to,account_id,amount,status,revision,reason,updated_at) values (gen_random_uuid(),'WHATSAPP','HARIAN','2026-08-05','2026-08-05','',1,'AKTIF',1,'x',now())"), /check|violates/i, "sumber organik ditolak di level DB");
  await assert.rejects(testPrisma.$executeRawUnsafe("insert into ad_source_spend_entries (id,source_id,kind,date_from,date_to,account_id,amount,status,revision,reason,updated_at) values (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-05','2026-08-05','',-1,'AKTIF',1,'x',now())"), /check|violates/i, "nominal negatif ditolak di level DB");
  await assert.rejects(testPrisma.$executeRawUnsafe("insert into ad_source_spend_entries (id,source_id,kind,date_from,date_to,account_id,amount,status,revision,reason,updated_at) values (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-05','2026-08-06','',1,'AKTIF',1,'x',now())"), /check|violates/i, "HARIAN dengan 2 tanggal ditolak di level DB");
});

test("konflik: total rentang yang menimpa entri aktif → 409 tanpa menulis; setelah entri lama dibatalkan baru diterima; batal tak menghapus, bisa diaktifkan kembali lewat input ulang", async () => {
  const sebelum = await hitung();
  const blok = { sumber: "TIKTOK", jenis: "TOTAL_RENTANG", dari: "2026-08-01", sampai: "2026-08-03", nominal: "900000", alasan: "Invoice bulanan TikTok" };
  const k = await api("PUT", "/biaya-sumber", { body: blok });
  assert.deepEqual([k.status, k.json.code], [409, "BIAYA_KONFLIK"]); assert.equal(k.json.data.konflik.length, 2); assert.deepEqual(await hitung(), sebelum);
  const list = await api("GET", "/biaya-sumber?dari=2026-08-01&sampai=2026-08-03&sumber=TIKTOK");
  for (const e of list.json.entri) { const b = await api("POST", `/biaya-sumber/${e.id}/batalkan`, { body: { alasan: "Diganti total rentang" } }); assert.deepEqual([b.status, b.json.status, b.json.ditulis], [200, "DIBATALKAN", true]); }
  assert.equal((await api("POST", `/biaya-sumber/${list.json.entri[0].id}/batalkan`, { body: { alasan: "Diganti total rentang" } })).json.ditulis, false, "batal ulang idempoten");
  assert.equal((await api("POST", `/biaya-sumber/${list.json.entri[0].id}/batalkan`, { body: { alasan: "x" } })).json.code, "ALASAN_WAJIB");
  assert.equal((await api("POST", "/biaya-sumber/00000000-0000-4000-8000-000000000000/batalkan", { body: { alasan: "tidak ada" } })).status, 404);
  assert.equal((await api("GET", "/biaya-sumber?dari=2026-08-01&sampai=2026-08-03&sumber=TIKTOK")).json.entri.length, 0, "entri batal tidak tampil default");
  assert.equal((await api("GET", "/biaya-sumber?dari=2026-08-01&sampai=2026-08-03&sumber=TIKTOK&batal=1")).json.entri.length, 2);
  const b = await api("PUT", "/biaya-sumber", { body: blok }); assert.deepEqual([b.status, b.json.aksi], [201, "BARU"]);
  const lagi = await api("PUT", "/biaya-sumber", { body: harian({ nominal: "150000" }) });
  assert.equal(lagi.status, 409, "harian di dalam total rentang aktif ditolak");
  const kembali = await api("POST", `/biaya-sumber/${b.json.id}/batalkan`, { body: { alasan: "Kembali ke harian" } }); assert.equal(kembali.status, 200);
  const akt = await api("PUT", "/biaya-sumber", { body: harian({ alasan: "Aktifkan kembali entri harian" }) });
  assert.deepEqual([akt.json.aksi, akt.json.revisi], ["AKTIFKAN", 4], "entri batal diaktifkan kembali (revisi berlanjut), bukan entri ganda");
  assert.equal(Number((await testPrisma.$queryRawUnsafe("select count(*)::int c from ad_source_spend_entries where source_id='TIKTOK' and kind='HARIAN' and date_from='2026-08-01'"))[0].c), 1);
});

test("GET baca-saja: tidak mengubah tabel biaya, spend Meta, customer, order, pembayaran; respons no-store", async () => {
  const s = await hitung();
  for (const p of ["/biaya-sumber?dari=2026-08-01&sampai=2026-08-03", "/sumber?dari=2026-08-01&sampai=2026-08-03", "/biaya-sumber?dari=2026-08-01&sampai=2026-08-03&batal=1"]) { const r = await api("GET", p); assert.equal(r.status, 200, p); }
  assert.deepEqual(await hitung(), s);
  const r = await fetch(`${server.baseUrl}/api/atribusi/iklan/biaya-sumber?dari=2026-08-01&sampai=2026-08-03`, { headers: { Authorization: `Bearer ${tokenAdmin}` } });
  assert.match(r.headers.get("cache-control") || "", /no-store/);
});

test("/sumber: biaya sumber TikTok dari manual berlabel Atribusi label CRM; dua hari kosong → SPEND_TIDAK_LENGKAP + CPA/ROAS null; setelah diisi LENGKAP; organik tidak punya biaya; spend manual TIDAK masuk laporan campaign/meta_ad_daily_spend", async () => {
  await bersih();
  await testPrisma.customer.create({ data: { name: "Lead TikTok Uji", phone: "6285300000501", createdAt: T("2026-08-02T03:00:00Z"), leadSource: "TIKTOK_ADS" } });
  assert.equal((await api("PUT", "/biaya-sumber", { body: harian({ dari: "2026-08-01" }) })).status, 201);
  let r = await api("GET", "/sumber?dari=2026-08-01&sampai=2026-08-03"); assert.equal(r.status, 200);
  let tt = r.json.sumber.find((x) => x.id === "TIKTOK");
  assert.deepEqual([tt.biaya.dasar, tt.biaya.status, tt.biaya.spend, tt.biaya.cpa, tt.biaya.cashRoas], ["ATRIBUSI_LABEL_CRM", "SPEND_TIDAK_LENGKAP", 150000, null, null]);
  assert.deepEqual(tt.biaya.cakupan.hariHilang, ["2026-08-02", "2026-08-03"]);
  assert.equal(r.json.total.berbayar.lengkap, false); assert.equal(r.json.total.berbayar.spend, null);
  assert.ok(r.json.peringatan.some((p) => p.kode === "SPEND_BELUM_LENGKAP" && p.data.sumber === "TIKTOK"));
  await api("PUT", "/biaya-sumber", { body: harian({ dari: "2026-08-02" }) }); await api("PUT", "/biaya-sumber", { body: harian({ dari: "2026-08-03" }) });
  r = await api("GET", "/sumber?dari=2026-08-01&sampai=2026-08-03"); tt = r.json.sumber.find((x) => x.id === "TIKTOK");
  assert.deepEqual([tt.biaya.status, tt.biaya.spend, tt.biaya.cpl, tt.biaya.cpa, tt.biaya.alasanNull.cpa, tt.lead], ["LENGKAP", 450000, 450000, null, "BELUM_ADA_KONVERSI", 1], "lead 1, tanpa lunas → CPA null 'belum ada konversi'");
  assert.equal(r.json.sumber.find((x) => x.id === "WHATSAPP").biaya.status, "TIDAK_TERSEDIA_ORGANIK");
  assert.equal(r.json.sumber.find((x) => x.id === "META").biaya.status, "BELUM_DIISI", "Meta tanpa Ad/manual → belum diisi (bukan Rp0)");
  assert.equal(r.json.total.berbayar.lengkap, false, "Meta masih belum diisi → total berbayar null");
  assert.equal(await testPrisma.metaAdDailySpend.count(), 0, "manual tidak membuat baris spend Ad");
  const camp = await api("GET", "/?dari=2026-08-01&sampai=2026-08-03&level=campaign");
  assert.equal(camp.status, 200); assert.equal(camp.json.biaya?.spend ?? null, null, "laporan campaign tidak melihat biaya sumber manual");
});

test("Windsor/API detail Ad vs manual META: tidak dijumlah ganda (detail Ad menang), override eksplisit mengganti; total rentang tidak diprorata ke sub-rentang", async () => {
  await bersih();
  for (const [d, s] of [["2026-08-01", 100000], ["2026-08-02", 110000], ["2026-08-03", 120000]]) await testPrisma.metaAdDailySpend.create({ data: { dateWib: T(`${d}T00:00:00Z`), accountId: "1234567890", campaignId: "52690000000011", adSetId: "52690000000012", adId: "52690000000001", currency: "IDR", spend: s, source: "WINDSOR_API", importedAt: new Date(), importId: imp.id, rowChecksum: d.replace(/-/g, "").padEnd(64, "a") } });
  const meta = (o) => ({ sumber: "META", jenis: "HARIAN", dari: "2026-08-01", nominal: "999999", alasan: "Angka Ads Manager (uji)", ...o });
  for (const d of ["2026-08-01", "2026-08-02", "2026-08-03"]) assert.equal((await api("PUT", "/biaya-sumber", { body: meta({ dari: d }) })).status, 201);
  let me = (await api("GET", "/sumber?dari=2026-08-01&sampai=2026-08-03")).json.sumber.find((x) => x.id === "META");
  assert.deepEqual([me.biaya.status, me.biaya.spend], ["LENGKAP", 330000], "hanya detail Ad (100+110+120 rb); manual 999999×3 diabaikan");
  assert.equal(me.biaya.cakupan.manualDiabaikanHari.length, 3);
  const cetak = (await api("GET", "/sumber?dari=2026-08-01&sampai=2026-08-03")).json;
  assert.ok(cetak.peringatan.some((p) => p.kode === "MANUAL_DIABAIKAN"));
  assert.equal(cetak.sumber.find((x) => x.id === "META").biayaCampaignTerbukti.dasar, "ATRIBUSI_TERBUKTI", "angka campaign tetap dihitung terpisah dari detail Ad");
  await bersih();
  const ov = await api("PUT", "/biaya-sumber", { body: { sumber: "META", jenis: "TOTAL_RENTANG", dari: "2026-08-01", sampai: "2026-08-03", nominal: "400000", gantiDetailAd: true, alasan: "Total Ads Manager lebih benar dari Windsor" } });
  assert.equal(ov.status, 201);
  me = (await api("GET", "/sumber?dari=2026-08-01&sampai=2026-08-03")).json.sumber.find((x) => x.id === "META");
  assert.deepEqual([me.biaya.status, me.biaya.spend, me.biaya.cakupan.overrideMenggantikanDetailHari.length], ["LENGKAP", 400000, 3], "override menggantikan, tidak menambah (330000 + 400000 salah)");
  const sub = (await api("GET", "/sumber?dari=2026-08-01&sampai=2026-08-02")).json.sumber.find((x) => x.id === "META");
  assert.deepEqual([sub.biaya.status, sub.biaya.cpa], ["RENTANG_TIDAK_COCOK", null], "total rentang tidak dipakai untuk sub-rentang, tanpa prorata");
  assert.equal(sub.biaya.spend, null);
  const lebar = (await api("GET", "/sumber?dari=2026-07-30&sampai=2026-08-03")).json.sumber.find((x) => x.id === "META");
  assert.deepEqual([lebar.biaya.status, lebar.biaya.spend, lebar.biaya.cpa, lebar.biaya.cakupan.hariHilang], ["SPEND_TIDAK_LENGKAP", 400000, null, ["2026-07-30", "2026-07-31"]], "rentang lebih lebar memuat blok penuh (dihitung sekali), 2 hari di luar blok hilang → KPI null, tanpa prorata");
});

test("AdSpend bulanan (Pengaturan Sales) ikut terbaca read-only: bulan penuh → LENGKAP tanpa input ganda; entri sumber pada bulan itu menang; tabel AdSpend tidak berubah", async () => {
  await bersih();
  await testPrisma.adSpend.create({ data: { source: "TIKTOK_ADS", year: 2026, month: 7, amount: 31_000_000 } });
  try {
    const sebelum = JSON.stringify(await testPrisma.adSpend.findMany({ orderBy: { id: "asc" } }));
    let tt = (await api("GET", "/sumber?dari=2026-07-01&sampai=2026-07-31")).json.sumber.find((x) => x.id === "TIKTOK");
    assert.deepEqual([tt.biaya.status, tt.biaya.spend], ["LENGKAP", 31_000_000]);
    assert.deepEqual(tt.biaya.cakupan.biayaBulananPengaturan.map((b) => [b.tahun, b.bulan, b.nominal, b.dipakai]), [[2026, 7, 31_000_000, true]]);
    tt = (await api("GET", "/sumber?dari=2026-07-01&sampai=2026-07-15")).json.sumber.find((x) => x.id === "TIKTOK");
    assert.deepEqual([tt.biaya.status, tt.biaya.spend, tt.biaya.cpa, tt.biaya.cakupan.biayaBulananPengaturan[0].alasan], ["RENTANG_TIDAK_COCOK", null, null, "BULAN_TIDAK_PENUH_DALAM_RENTANG"], "bulanan tidak diprorata ke sub-rentang");
    assert.equal((await api("PUT", "/biaya-sumber", { body: harian({ dari: "2026-07-05" }) })).status, 201);
    tt = (await api("GET", "/sumber?dari=2026-07-01&sampai=2026-07-31")).json.sumber.find((x) => x.id === "TIKTOK");
    assert.deepEqual([tt.biaya.status, tt.biaya.spend], ["SPEND_TIDAK_LENGKAP", 150000], "entri sumber menang; 31 jt bulanan tidak dijumlah");
    assert.equal(tt.biaya.cakupan.biayaBulananPengaturan[0].alasan, "ADA_ENTRI_SUMBER_PADA_BULAN_INI");
    assert.equal(JSON.stringify(await testPrisma.adSpend.findMany({ orderBy: { id: "asc" } })), sebelum, "AdSpend tidak berubah");
  } finally { await testPrisma.adSpend.deleteMany({}); await bersih(); }
});
