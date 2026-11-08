// Akar hariAdaSpend, nol terverifikasi vs data hilang, KPI spend nol/penyebut nol, endpoint service = MCP, hook rate dari DB, referensi Ad ber-touch, keadaan panel.
import "./setup/env.js";
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { testPrisma: db, truncateAll } = await import("./setup/testDb.js");
const { jalankanSinkronComposio, statusSinkronMeta, ringkasHookRate, keadaanSinkron } = await import("../../src/services/attribution/composioMetaSync.js");
const { hitungLaporanIklan, parseParameterIklan } = await import("../../src/services/attribution/iklanReport.js");
const { laporanPerforma, ringkasTotal } = await import("../../src/services/attribution/laporanMeta.js");

const AKUN = "2081614415911241", H1 = "2026-11-03", H2 = "2026-11-04", H3 = "2026-11-05";
const ENV = { COMPOSIO_API_KEY: "k", COMPOSIO_META_CONNECTED_ACCOUNT_ID: "ca", COMPOSIO_META_USER_ID: "u_uji", COMPOSIO_META_TOOL_VERSION: "20261101_00", META_ADS_ACCOUNT_ID: AKUN, COMPOSIO_META_SYNC_ENABLED: "true" };
const NOW = new Date("2026-11-08T05:00:00Z");
const ad = (t, id, spend, v = "40") => ({ account_id: AKUN, account_currency: "IDR", ad_id: id, adset_id: "20001", campaign_id: "30001", spend, impressions: "100", inline_link_clicks: "5", date_start: t, date_stop: t, actions: v === null ? [] : [{ action_type: "video_view", value: v }] });
const kontrol = (t, spend, n = 1) => ({ account_id: AKUN, account_currency: "IDR", spend, impressions: String(100 * n), inline_link_clicks: String(5 * n), date_start: t, date_stop: t });
function meta(w) {
  return async (u, o) => {
    const tool = u.split("/").pop(), a = JSON.parse(o.body).arguments;
    const res = (data) => ({ ok: true, status: 200, json: async () => ({ successful: true, data, error: null }) });
    if (tool === "METAADS_GET_OBJECT") return res({ account_id: AKUN, currency: "IDR", timezone_name: "Asia/Jakarta" });
    if (tool === "METAADS_GET_MULTIPLE_OBJECTS") return a.fields.includes("adset_id") ? res({ results: w.hier || {} }) : res({ results: Object.fromEntries(a.object_ids.map((id) => [id, { id, creative: { id: `9${id}`, ...(w.gambar?.includes(id) ? {} : { video_id: "777" }) } }])) });
    if (w.gagalUlang && a.time_range.since === a.time_range.until && a.level === "account") return { ok: false, status: 400 };
    const dalam = (x) => x.date_start >= a.time_range.since && x.date_start <= a.time_range.until;
    if (a.breakdowns) return res({ data: [] });
    if (w.ulangMuncul && a.time_range.since === a.time_range.until && a.level === "account") return res({ data: [kontrol(a.time_range.since, "5")] });
    if (w.adUlangMuncul && a.level === "ad" && (w.n = (w.n || 0) + 1) > 1) return res({ data: [ad(a.time_range.since, "10009", "5")] });
    return res({ data: (a.level === "ad" ? w.ad : w.kontrol).filter(dalam) });
  };
}
const jalan = (w, dari = H1, sampai = H3, mode = "commit") => jalankanSinkronComposio(db, { mode, dari, sampai, env: ENV, fetchFn: meta(w), tidurFn: async () => {}, now: NOW });
const lap = (dari, sampai) => hitungLaporanIklan(db, parseParameterIklan({ dari, sampai, level: "campaign" }), { now: NOW });
const bersih = async () => { await truncateAll(); for (const t of ["meta_ad_spend_revisions", "meta_ad_daily_spend", "meta_spend_imports", "meta_ad_references", "meta_ad_reference_imports", "meta_account_daily_breakdowns", "meta_ad_daily_delivery", "meta_account_daily_control", "meta_sync_runs", "meta_ad_creatives"]) await db.$executeRawUnsafe(`truncate ${t} cascade`); };
test.beforeEach(bersih);
test.after(async () => { await bersih(); await db.$disconnect(); });

test("hariAdaSpend: total = gabungan tanggal antar-Ad; layanan = MCP", async () => {
  await jalan({ ad: [ad(H1, "10001", "100"), ad(H2, "10002", "50"), ad(H3, "10001", "70")], kontrol: [kontrol(H1, "100"), kontrol(H2, "50"), kontrol(H3, "70")] });
  const l = await lap(H1, H3);
  assert.equal(l.biaya.hariAdaSpend, 3, "regresi: dulu selalu 0 pada total");
  assert.equal(l.grup.find((g) => g.status === "MAPPED").biaya.hariAdaSpend, 3, "regresi: dulu maksimum per Ad = 2");
  assert.equal(ringkasTotal(l).biaya.hariAdaSpend, 3);
  const mcp = await laporanPerforma(db, { dari: H1, sampai: H3, level: "campaign" }, { now: NOW });
  assert.equal(mcp.total.biaya.hariAdaSpend, l.biaya.hariAdaSpend); assert.equal(mcp.total.biaya.spend, l.biaya.spend);
});
test("respons kosong konsisten: TIDAK_ADA_DELIVERY_TERAMATI, hari lengkap, kontrol_spend null, dasar tersimpan; total dari hari lain", async () => {
  const r = await jalan({ ad: [ad(H1, "10001", "100")], kontrol: [kontrol(H1, "100")] });
  assert.equal(r.status, "SUKSES"); assert.deepEqual(r.ringkas.hari.map((h) => h.s), ["DELIVERY_TERVERIFIKASI", "TIDAK_ADA_DELIVERY_TERAMATI", "TIDAK_ADA_DELIVERY_TERAMATI"]);
  const [e] = await db.$queryRaw`select control_spend, evidence from meta_account_daily_control where date_wib=${new Date(`${H2}T00:00:00Z`)}`;
  assert.equal(e.control_spend, null, "bukan angka nol"); assert.equal(e.evidence.dasar, "RESPONS_KOSONG_KONSISTEN"); assert.equal(e.evidence.akun.zonaWaktu, "Asia/Jakarta"); assert.equal(e.evidence.seluruhHalaman, true); assert.equal(e.evidence.spendTersimpan, 0);
  const l = await lap(H1, H3);
  assert.deepEqual(l.biaya.kesegaran.hariHilang, [], "hari tervalidasi tidak hilang"); assert.equal(l.biaya.kesegaran.hariTanpaDeliveryTeramati.length, 2); assert.equal(l.biaya.kesegaran.hariNolTerverifikasi.length, 0); assert.equal(l.biaya.spend, 100); assert.equal(l.biaya.hariAdaSpend, 1);
  assert.equal(await db.metaAdDailySpend.count(), 1, "tidak ada baris spend Rp0 rekaan");
});
test("baris kontrol spend 0 eksplisit = nol terverifikasi", async () => {
  const r = await jalan({ ad: [], kontrol: [{ ...kontrol(H1, "0"), impressions: "0", inline_link_clicks: "0" }] }, H1, H1);
  assert.equal(r.ringkas.hari[0].s, "NOL_TERVERIFIKASI");
  const [e] = await db.$queryRaw`select control_spend::text s, evidence from meta_account_daily_control`; assert.equal(Number(e.s), 0); assert.equal(e.evidence.dasar, "BARIS_KONTROL_SPEND_0");
});
test("seluruh periode kosong: spend null, bukan Rp0; campuran nol eksplisit + kosong juga null", async () => {
  await jalan({ ad: [], kontrol: [] });
  assert.equal((await lap(H1, H3)).biaya.spend ?? null, null);
  await jalan({ ad: [], kontrol: [{ ...kontrol(H1, "0"), impressions: "0", inline_link_clicks: "0" }] }, H1, H1);
  assert.equal((await lap(H1, H3)).biaya.spend ?? null, null);
});
test("seluruh periode nol eksplisit: spend Rp0, CPL/CPA penyebut nol null dengan alasan, ROAS SPEND_NOL", async () => {
  await jalan({ ad: [], kontrol: [H1, H2, H3].map((t) => ({ ...kontrol(t, "0"), impressions: "0", inline_link_clicks: "0" })) });
  const l = await lap(H1, H3);
  assert.equal(l.biaya.spend, 0, "Rp0 terbukti, bukan null"); assert.equal(l.biaya.cpl, null); assert.equal(l.biaya.bookedRoas, null); assert.equal(l.biaya.alasanNull.cpl, "SEBELUM_ATRIBUSI", "tanpa touch: pengaman atribusi tetap menang");
});
test("data hilang tetap null: kontrol tidak dikonfirmasi, gagal tarik, atau tanpa kontrol tidak menjadi Rp0", async () => {
  const a = await jalan({ ad: [], kontrol: [], gagalUlang: true }, H1, H1);
  assert.equal(a.status, "GAGAL"); let l = await lap(H1, H1); assert.equal(l.biaya.spend ?? null, null);
  const [c] = await db.$queryRaw`select status, reconciled, control_spend from meta_account_daily_control where date_wib=${new Date(`${H1}T00:00:00Z`)}`; assert.deepEqual([c.status, c.reconciled, c.control_spend], ["DATA_TIDAK_LENGKAP", false, null]);
  const b = await jalan({ ad: [], kontrol: [], ulangMuncul: true }, H2, H3);
  assert.equal(b.status, "BELUM_DIREKONSILIASI"); assert.equal(b.ringkas.hari[0].s, "DATA_TIDAK_LENGKAP");
  const d = await jalan({ ad: [ad(H3, "10001", "100")], kontrol: [] }, H3, H3);
  assert.equal(d.ringkas.hari[0].s, "BELUM_REKONSILIASI"); assert.equal(await db.metaAdDailySpend.count(), 0);
  l = await lap(H1, H3); assert.equal(l.biaya.spend ?? null, null); assert.equal(l.biaya.kesegaran?.hariHilang?.length ?? 3, 3);
});
test("bukti lama tidak diturunkan: nol eksplisit dan delivery tidak ditimpa respons kosong; spend tersimpan tetap", async () => {
  await jalan({ ad: [], kontrol: [{ ...kontrol(H1, "0"), impressions: "0", inline_link_clicks: "0" }] }, H1, H1);
  await jalan({ ad: [], kontrol: [] }, H1, H1);
  let [c] = await db.$queryRaw`select status from meta_account_daily_control where date_wib=${new Date(`${H1}T00:00:00Z`)}`; assert.equal(c.status, "NOL_TERVERIFIKASI");
  await jalan({ ad: [ad(H2, "10001", "100")], kontrol: [kontrol(H2, "100")] }, H2, H2);
  const r = await jalan({ ad: [], kontrol: [] }, H2, H2);
  assert.equal(r.status, "BELUM_DIREKONSILIASI"); assert.equal(r.ringkas.hari[0].s, "DATA_TIDAK_LENGKAP");
  [c] = await db.$queryRaw`select status, reconciled from meta_account_daily_control where date_wib=${new Date(`${H2}T00:00:00Z`)}`; assert.deepEqual([c.status, c.reconciled], ["DELIVERY_TERVERIFIKASI", true]);
  assert.equal(await db.metaAdDailySpend.count(), 1);
});
test("tarikan Ad harian tidak konsisten dengan kosong: tidak lengkap", async () => {
  const r = await jalan({ ad: [], kontrol: [], adUlangMuncul: true }, H1, H1);
  assert.equal(r.ringkas.hari[0].s, "DATA_TIDAK_LENGKAP");
});
test("hari terbukti tidak ditimpa oleh kegagalan berikutnya", async () => {
  await jalan({ ad: [ad(H1, "10001", "100")], kontrol: [kontrol(H1, "100")] }, H1, H1);
  const r = await jalan({ ad: [], kontrol: [], gagalUlang: true }, H1, H1); assert.equal(r.status, "GAGAL");
  const [c] = await db.$queryRaw`select status, reconciled from meta_account_daily_control where date_wib=${new Date(`${H1}T00:00:00Z`)}`; assert.deepEqual([c.status, c.reconciled], ["DELIVERY_TERVERIFIKASI", true]);
});
test("hook rate dari DB: video, image, null, lintas Ad; total dan per campaign; definisi tercatat di run", async () => {
  await jalan({ gambar: ["10003"], ad: [ad(H1, "10001", "100", "10"), ad(H1, "10002", "100", "90"), ad(H1, "10003", "100", null), ad(H1, "10004", "100", null)], kontrol: [kontrol(H1, "400", 4)] }, H1, H1);
  const h = await ringkasHookRate(db, { dari: H1, sampai: H1 });
  assert.equal(h.total.pembilang, 100); assert.equal(h.total.penyebut, 200); assert.equal(h.total.nilai, 50); assert.equal(h.total.coverage.impressionsBukanVideo, 100); assert.equal(h.total.coverage.impressionsVideoTanpaMetrik, 100);
  assert.equal(h.perCampaign["30001"].nilai, 50); assert.equal(h.definisi.versi, "HOOK_V1_3S_PER_IMPRESSION_VIDEO");
  const [r] = await db.$queryRaw`select attribution->'hookRate'->>'versi' v from meta_sync_runs order by started_at desc limit 1`; assert.equal(r.v, h.definisi.versi);
});
test("Ad ber-touch tanpa spend mendapat referensi resmi; konflik tidak ditimpa; Ad tak terbaca dilaporkan", async () => {
  await db.metaAdReference.create({ data: { adId: "50001", adSetId: "60001", campaignId: "70001", source: "MANUAL", syncedAt: NOW } });
  const { lengkapiReferensiTouch } = await import("../../src/services/attribution/composioMetaSync.js");
  const { buatKlien } = await import("../../src/services/attribution/composioMeta.js");
  const hier = { "50002": { id: "50002", account_id: AKUN, adset_id: "60009", campaign_id: "70001", name: "Tanpa spend" }, "50003": { id: "50003", account_id: AKUN, adset_id: "60001", campaign_id: "70009" } };
  const klien = buatKlien({ env: ENV, fetchFn: meta({ hier }), tidurFn: async () => {} });
  const palsu = { $queryRaw: async () => [{ ad_id: "50002" }, { ad_id: "50003" }, { ad_id: "50004" }], metaAdReference: db.metaAdReference, metaAdReferenceImport: db.metaAdReferenceImport, $transaction: (f) => db.$transaction(f), $executeRaw: (...a) => db.$executeRaw(...a) };
  const r = await lengkapiReferensiTouch(palsu, klien, { commit: true, now: NOW });
  assert.equal(r.kandidat, 3); assert.equal(r.terbaca, 2); assert.equal(r.tidakTerbaca, 1); assert.equal(r.ringkasan.baru, 1); assert.equal(r.ringkasan.konflik, 1, "ad set 60001 sudah di campaign lain");
  assert.equal((await db.metaAdReference.findUnique({ where: { adId: "50002" } })).adName, "Tanpa spend"); assert.equal(await db.metaAdReference.findUnique({ where: { adId: "50003" } }), null);
});
test("keadaan panel: OFF, belum dikonfigurasi, berjalan, gagal, sukses, selisih, terlambat", async () => {
  const k = (o) => keadaanSinkron({ konfigKurang: [], aktif: true, coba: { status: "SUKSES" }, lengkapSampai: "2026-11-07", kemarin: "2026-11-07", adaBelumRekon: false, ...o });
  assert.equal(k({}), "SUKSES"); assert.equal(k({ aktif: false }), "NONAKTIF"); assert.equal(k({ konfigKurang: ["X"] }), "BELUM_DIKONFIGURASI"); assert.equal(k({ coba: { status: "RUNNING" } }), "BERJALAN");
  assert.equal(k({ coba: { status: "GAGAL" } }), "GAGAL"); assert.equal(k({ coba: { status: "BELUM_DIREKONSILIASI" } }), "SELISIH_KONTROL"); assert.equal(k({ lengkapSampai: "2026-11-01" }), "DATA_TERLAMBAT"); assert.equal(k({ coba: null }), "BELUM_PERNAH_BERJALAN");
  const s = await statusSinkronMeta(db, { env: {}, now: NOW }); assert.equal(s.keadaan, "BELUM_DIKONFIGURASI"); assert.ok(s.konfigurasiKurang.includes("COMPOSIO_API_KEY")); assert.ok(!JSON.stringify(s).includes("ca_"));
});

test("akses HTTP: tanpa token 401, SALES 403, ADMIN 200; ADMIN tidak menerima nilai secret", async () => {
  const { default: express } = await import("express"); const { default: jwt } = await import("jsonwebtoken");
  const { startTestServer } = await import("./setup/testApp.js"); const { attributionAdsRouter } = await import("../../src/routes/attributionAds.js");
  const { createTestUser } = await import("./setup/fixtures.js");
  const app = express(); app.use(express.json()); app.use("/api/atribusi/iklan", attributionAdsRouter);
  const srv = await startTestServer(app); const url = `${srv.baseUrl}/api/atribusi/iklan/sync-meta/status`;
  process.env.COMPOSIO_API_KEY = "rahasia-uji-http";
  try {
    assert.equal((await fetch(url)).status, 401);
    const s = await createTestUser({ roles: ["SALES"] }); assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${s.token}` } })).status, 403);
    const a = await createTestUser({ roles: ["ADMIN"] }); const r = await fetch(url, { headers: { Authorization: `Bearer ${a.token}` } }); assert.equal(r.status, 200);
    const t = await r.text(); assert.ok(!t.includes("rahasia-uji-http")); assert.ok(JSON.parse(t).keadaan);
  } finally { delete process.env.COMPOSIO_API_KEY; await srv.close?.(); }
});
