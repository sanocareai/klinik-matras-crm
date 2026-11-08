// Sinkronisasi Composio di atas PostgreSQL sekali pakai + importer dan laporan ASLI: idempotensi, revisi, konflik, kontrol, Windsor+Composio tidak ganda, Σ Ad = ad set = campaign = akun, breakdown terpisah, kunci paralel.
import "./setup/env.js";
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { testPrisma: db, truncateAll } = await import("./setup/testDb.js");
const { jalankanSinkronComposio, statusSinkronMeta } = await import("../../src/services/attribution/composioMetaSync.js");
const { jalankanImporSpend, ringkasanSpendHarian, muatSpendPerAd } = await import("../../src/services/attribution/spend.js");

const AKUN = "2081614415911241", H1 = "2026-11-05", H2 = "2026-11-06";
const ENV = { COMPOSIO_API_KEY: "k", COMPOSIO_META_CONNECTED_ACCOUNT_ID: "ca", COMPOSIO_META_TOOL_VERSION: "20261101_00", META_ADS_ACCOUNT_ID: AKUN, COMPOSIO_META_SYNC_ENABLED: "true" };
const NOW = new Date("2026-11-08T05:00:00Z");
const ad = (t, adId, spend, o = {}) => ({ account_id: AKUN, account_currency: "IDR", ad_id: adId, ad_name: `Ad ${adId}`, adset_id: o.set ?? "20001", adset_name: "Set", campaign_id: o.camp ?? "30001", campaign_name: "Camp", spend, impressions: "100", reach: "90", inline_link_clicks: "5", date_start: t, date_stop: t, actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "2" }, { action_type: "video_view", value: "40" }] });
const kontrol = (t, spend, n) => ({ account_id: AKUN, account_currency: "IDR", spend, impressions: String(100 * n), inline_link_clicks: String(5 * n), date_start: t, date_stop: t });

/** Meta palsu di belakang transport Composio; `dunia` dapat diubah antar-run. */
function meta(dunia) {
  return async (u, o) => {
    const tool = u.split("/").pop(); const a = JSON.parse(o.body).arguments;
    const res = (data) => ({ ok: true, status: 200, json: async () => ({ successful: true, data, error: null }) });
    if (dunia.gagal?.(tool, a)) return { ok: false, status: 400, json: async () => ({}) };
    if (tool === "METAADS_GET_OBJECT") return res({ account_id: AKUN, currency: "IDR", timezone_name: "Asia/Jakarta", account_status: 1 });
    if (tool === "METAADS_GET_MULTIPLE_OBJECTS") return res({ results: Object.fromEntries(a.object_ids.map((id) => [id, { id, account_id: AKUN, creative: { id: `9${id}`, name: "Kreatif", video_id: "777777" } }])) });
    const dalam = (x) => x.date_start >= a.time_range.since && x.date_start <= a.time_range.until;
    if (a.breakdowns) return res({ data: dunia.kontrol.filter(dalam).map((k) => ({ ...k, publisher_platform: "instagram", platform_position: "feed", age: "25-34", gender: "female", reach: "50" })) });
    return res({ data: (a.level === "ad" ? dunia.ad : dunia.kontrol).filter(dalam) });
  };
}
const jalan = (dunia, mode = "commit", o = {}) => jalankanSinkronComposio(db, { mode, dari: H1, sampai: H2, env: ENV, fetchFn: meta(dunia), tidurFn: async () => {}, now: NOW, ...o });
const hit = async (t) => Number((await db.$queryRawUnsafe(`select count(*)::int c from ${t}`))[0].c);
const dunia0 = () => ({ ad: [ad(H1, "10001", "1000"), ad(H1, "10002", "500.50"), ad(H2, "10001", "700")], kontrol: [kontrol(H1, "1500.50", 2), kontrol(H2, "700", 1)] });

const bersihkan = async () => { await truncateAll(); for (const t of ["meta_ad_spend_revisions", "meta_ad_daily_spend", "meta_spend_imports", "meta_ad_references", "meta_ad_reference_imports", "meta_account_daily_breakdowns", "meta_ad_daily_delivery", "meta_account_daily_control", "meta_sync_runs", "meta_ad_creatives"]) await db.$executeRawUnsafe(`truncate ${t} cascade`); };
test.beforeEach(bersihkan);
test.after(async () => { await bersihkan(); await db.$disconnect(); });   // truncateAll tidak mencakup tabel Meta: jangan bocor ke berkas tes lain

test("dry-run tidak menulis fakta; commit menulis referensi sebelum spend, transport tercatat, sumber META_MARKETING_API", async () => {
  const d = await jalan(dunia0(), "dry");
  assert.equal(d.status, "DRY_RUN"); assert.equal(await db.metaAdDailySpend.count(), 0); assert.equal(await db.metaAdReference.count(), 0);
  const c = await jalan(dunia0());
  assert.equal(c.status, "SUKSES"); assert.equal(c.kontrolSpend, "2200.50"); assert.equal(c.adSpend, "2200.50"); assert.equal(c.lengkapSampai, H2);
  const refs = await db.metaAdReference.findMany(); assert.equal(refs.length, 2); assert.ok(refs.every((r) => r.source === "MARKETING_API"));
  const rows = await db.metaAdDailySpend.findMany(); assert.equal(rows.length, 3); assert.ok(rows.every((r) => r.source === "META_MARKETING_API")); assert.equal(typeof rows[0].adId, "string");
  const [imp] = await db.$queryRaw`select transport, declared_total::text d from meta_spend_imports`; assert.equal(imp.transport, "COMPOSIO"); assert.equal(Number(imp.d), 2200.5);
  const [ri] = await db.$queryRaw`select transport from meta_ad_reference_imports where transport is not null`; assert.equal(ri.transport, "COMPOSIO");
  const st = await statusSinkronMeta(db); assert.equal(st.dataLengkapSampai, H2); assert.equal(st.terakhirDicoba.status, "SUKSES"); assert.equal(st.hariBelumRekonsiliasi.length, 0);
});
test("idempoten: impor ulang sama tidak menambah impor/revisi; angka berubah menyimpan histori", async () => {
  await jalan(dunia0()); const n = await db.metaSpendImport.count();
  await jalan(dunia0()); assert.equal(await db.metaSpendImport.count(), n); assert.equal(await db.metaAdSpendRevision.count(), 0);
  const w = dunia0(); w.ad[2] = ad(H2, "10001", "800"); w.kontrol[1] = kontrol(H2, "800", 1);
  assert.equal((await jalan(w)).status, "SUKSES");
  const rev = await db.metaAdSpendRevision.findMany(); assert.equal(rev.length, 1); assert.equal(Number(rev[0].prevSpend), 700);
  assert.equal(await db.metaAdDailySpend.count(), 3);
});
test("selisih kontrol: hari itu ditahan utuh, run BELUM_DIREKONSILIASI, hari lain masuk", async () => {
  const w = dunia0(); w.kontrol[1] = kontrol(H2, "701", 1);
  const r = await jalan(w);
  assert.equal(r.status, "BELUM_DIREKONSILIASI"); assert.equal(r.hariDitahan, 1); assert.equal(r.selisih, "1.00"); assert.equal(r.lengkapSampai, H1);
  assert.equal(await db.metaAdDailySpend.count({ where: { dateWib: new Date(`${H2}T00:00:00Z`) } }), 0); assert.equal(await db.metaAdDailySpend.count(), 2);
  assert.equal((await statusSinkronMeta(db)).hariBelumRekonsiliasi[0].tanggal, H2);
});
test("mapping baru otomatis; konflik hierarki tidak ditimpa dan menahan harinya", async () => {
  await jalan(dunia0());
  const w = dunia0(); w.ad.push(ad(H2, "10003", "0")); w.kontrol[1] = { ...kontrol(H2, "700", 2) };
  assert.equal((await jalan(w)).status, "SUKSES"); assert.equal((await db.metaAdReference.findUnique({ where: { adId: "10003" } })).adSetId, "20001");
  const k = dunia0(); k.ad[2] = ad(H2, "10001", "700", { set: "20009" });
  const r = await jalan(k);
  assert.equal(r.status, "BELUM_DIREKONSILIASI"); assert.ok(r.ringkas.hari.some((h) => h.s === "DITAHAN_KONFLIK"));
  assert.equal((await db.metaAdReference.findUnique({ where: { adId: "10001" } })).adSetId, "20001", "tidak tertimpa");
});
test("Windsor + Composio + CSV pada Ad-hari yang sama: laporan memakai satu sumber; histori tetap ada", async () => {
  await jalankanImporSpend(db, { rows: [{ tanggal: H1, adId: "10001", adSetId: "20001", campaignId: "30001", currency: "IDR", spend: "999", baris: 1 }], source: "WINDSOR_API", accountId: AKUN, zonaWaktuAkun: "Asia/Jakarta", dryRun: false });
  await jalankanImporSpend(db, { rows: [{ tanggal: H1, adId: "10001", adSetId: "20001", campaignId: "30001", currency: "IDR", spend: "888", baris: 1 }], source: "ADS_MANAGER_CSV", accountId: AKUN, zonaWaktuAkun: "Asia/Jakarta", dryRun: false });
  await jalan(dunia0());
  assert.equal(await db.metaAdDailySpend.count({ where: { source: "WINDSOR_API" } }), 1);
  const ring = await ringkasanSpendHarian(db, { dari: H1, sampai: H2 }); assert.equal(ring.totalSpend, 2200.5);
  const { spendPerAd } = await db.$transaction((tx) => muatSpendPerAd(tx, { dari: H1, sampai: H2 }));
  assert.equal(spendPerAd.find((x) => x.adId === "10001").spend, 1700);
});
test("Σ spend Ad = ad set = campaign = akun; breakdown di tabel terpisah tidak mengubah total; reach tidak dijumlah di mana pun", async () => {
  await jalan(dunia0());
  const q = async (kol) => Number((await db.$queryRawUnsafe(`select sum(s)::text v from (select ${kol}, sum(spend) s from meta_ad_daily_spend group by 1) x`))[0].v);
  assert.equal(await q("ad_id"), 2200.5); assert.equal(await q("ad_set_id"), 2200.5); assert.equal(await q("campaign_id"), 2200.5);
  const [k] = await db.$queryRaw`select sum(control_spend)::text v from meta_account_daily_control`; assert.equal(Number(k.v), 2200.5);
  assert.ok((await hit("meta_account_daily_breakdowns")) >= 2);
  assert.equal((await ringkasanSpendHarian(db, { dari: H1, sampai: H2 })).totalSpend, 2200.5);
  const [d] = await db.$queryRaw`select count(*)::int c, sum(video_3s_views)::int v from meta_ad_daily_delivery`; assert.equal(d.c, 3); assert.equal(d.v, 120);
  assert.equal(await hit("meta_ad_creatives"), 2);
});
test("kegagalan halaman: run GAGAL, tidak ada impor parsial, histori utuh; respons kosong tidak menghapus", async () => {
  await jalan(dunia0()); const n = await db.metaAdDailySpend.count();
  const w = dunia0(); w.gagal = (t, a) => t === "METAADS_GET_INSIGHTS" && a.level === "account";
  const r = await jalan(w); assert.equal(r.status, "GAGAL"); assert.equal(r.failureCode, "HTTP_400"); assert.equal(await db.metaAdDailySpend.count(), n);
  assert.equal((await statusSinkronMeta(db)).terakhirDicoba.alasanGagal, "HTTP_400");
  const kosong = await jalan({ ad: [], kontrol: [] });
  assert.equal(kosong.status, "SUKSES"); assert.equal(await db.metaAdDailySpend.count(), n);
  const [c] = await db.$queryRaw`select status from meta_account_daily_control where date_wib=${new Date(`${H1}T00:00:00Z`)}`; assert.equal(c.status, "TANPA_DELIVERY");
  assert.equal((await jalan({ ad: [], kontrol: [] }, "verify")).hari[0].status, "DB_ADA_KONTROL_TIDAK", "verify menandai, tidak menyatakan cocok");
});
test("kunci: run kedua ditolak saat ada yang berjalan; run basi diambil alih", async () => {
  await db.$executeRaw`insert into meta_sync_runs (id, account_id, transport, mode, status) values (gen_random_uuid(), ${AKUN}, 'COMPOSIO', 'commit', 'RUNNING')`;
  assert.equal((await jalan(dunia0())).status, "SEDANG_BERJALAN"); assert.equal(await db.metaAdDailySpend.count(), 0);
  await db.$executeRaw`update meta_sync_runs set started_at = now() - interval '2 hours' where status='RUNNING'`;
  assert.equal((await jalan(dunia0())).status, "SUKSES");
});
test("tidak menyentuh customer, order, payment, touch", async () => {
  await jalan(dunia0());
  for (const m of ["customer", "order", "payment", "attributionTouch"]) assert.equal(await db[m].count(), 0, m);
});
test("verify: DB (sumber terpilih) = kontrol", async () => {
  await jalan(dunia0());
  const v = await jalan(dunia0(), "verify"); assert.equal(v.status, "TERVERIFIKASI"); assert.deepEqual(v.hari.map((h) => h.status), ["COCOK", "COCOK"]);
});
