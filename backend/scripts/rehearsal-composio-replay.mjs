// Rehearsal lokal: memutar ulang satu hari data Meta (CSV di luar repo) lewat adapter + importer + laporan ASLI di atas SALINAN backup (nama DB wajib mengandung "test"). Tidak menyentuh produksi atau Composio.
//   TEST_DATABASE_URL=... REPLAY_CSV=<berkas> REPLAY_TANGGAL=2026-11-07 node scripts/rehearsal-composio-replay.mjs
// Kolom CSV: ad,adset,campaign,spend,impressions,klik,percakapan,video3s. Keluaran agregat saja.
import fs from "node:fs";
import "../tests/integration/setup/env.js";
const { testPrisma: db } = await import("../tests/integration/setup/testDb.js");
const { jalankanSinkronComposio, statusSinkronMeta } = await import("../src/services/attribution/composioMetaSync.js");
const { hitungLaporanIklan, parseParameterIklan } = await import("../src/services/attribution/iklanReport.js");
const { laporanPerforma, rekapHarian, kesehatanAtribusi } = await import("../src/services/attribution/laporanMeta.js");

const T = process.env.REPLAY_TANGGAL, AKUN = "2081614415911241";
const ENV = { COMPOSIO_API_KEY: "k", COMPOSIO_META_CONNECTED_ACCOUNT_ID: "ca", COMPOSIO_META_TOOL_VERSION: "replay", META_ADS_ACCOUNT_ID: AKUN, COMPOSIO_META_SYNC_ENABLED: "true" };
const AKSI = "onsite_conversion.messaging_conversation_started_7d";
const ad = fs.readFileSync(process.env.REPLAY_CSV, "utf8").trim().split(/\r?\n/).map((l) => {
  const [a, s, c, sp, i, k, p, v] = l.split(",");
  return { account_id: AKUN, account_currency: "IDR", ad_id: a, adset_id: s, campaign_id: c, spend: sp, impressions: i, inline_link_clicks: k, date_start: T, date_stop: T, actions: [...(p ? [{ action_type: AKSI, value: p }] : []), ...(v ? [{ action_type: "video_view", value: v }] : [])] };
});
const jum = (f) => String(ad.reduce((n, x) => n + Number(x[f]), 0));
const kontrol = [{ account_id: AKUN, account_currency: "IDR", spend: jum("spend"), impressions: jum("impressions"), inline_link_clicks: jum("inline_link_clicks"), date_start: T, date_stop: T, actions: [{ action_type: AKSI, value: "79" }] }];
const fetchFn = async (u, o) => {
  const tool = u.split("/").pop(), a = JSON.parse(o.body).arguments;
  const data = tool === "METAADS_GET_OBJECT" ? { account_id: AKUN, currency: "IDR", timezone_name: "Asia/Jakarta" } : tool === "METAADS_GET_MULTIPLE_OBJECTS" ? { results: {} } : a.breakdowns ? { data: [] } : { data: a.level === "ad" ? ad : kontrol };
  return { ok: true, status: 200, json: async () => ({ successful: true, data }) };
};
const opsi = { dari: T, sampai: T, env: ENV, fetchFn, tidurFn: async () => {}, now: new Date("2026-11-08T05:00:00Z") };
const hitungTabel = async () => Object.fromEntries(await Promise.all(["Customer", "Message", "Order", "payments", "attribution_touches", "meta_ad_references", "meta_ad_daily_spend", "meta_spend_imports", "meta_ad_spend_revisions"].map(async (t) => [t, Number((await db.$queryRawUnsafe(`select count(*)::int c from "${t}"`))[0].c)])));
const singkat = (h) => ({ status: h.status, kontrol: h.kontrolSpend, ad: h.adSpend, selisih: h.selisih, hariDitahan: h.hariDitahan, gagal: h.failureCode, unmapped: h.unmapped, ref: h.ringkas?.referensi, spend: h.ringkas?.spend, selisihKonv: h.ringkas?.hari?.[0]?.selisihKonversasi });
const lapor = async () => { const r = {}; for (const level of ["campaign", "adset", "ad"]) { const l = await hitungLaporanIklan(db, parseParameterIklan({ dari: T, sampai: T, level }), { now: opsi.now }); r[level] = { baris: l.grup.length, spend: l.grup.reduce((s, g) => s + (g.biaya?.spend ?? 0), 0), lead: l.jumlahTeratribusi?.leadUnik, rekon: l.rekonsiliasi?.ok, biayaTotal: l.biaya?.spend ?? null, status: l.biaya?.status ?? null }; } return r; };

const awal = await hitungTabel();
const sebelum = await lapor();
console.log("DRY", JSON.stringify(singkat(await jalankanSinkronComposio(db, { ...opsi, mode: "dry" }))));
const setelahDry = await hitungTabel();
console.log("DRY_TIDAK_MENULIS", JSON.stringify(awal) === JSON.stringify(setelahDry));
console.log("COMMIT", JSON.stringify(singkat(await jalankanSinkronComposio(db, { ...opsi, mode: "commit" }))));
console.log("VERIFY", JSON.stringify((await jalankanSinkronComposio(db, { ...opsi, mode: "verify" })).hari));
const c1 = await hitungTabel();
console.log("ULANG", JSON.stringify(singkat(await jalankanSinkronComposio(db, { ...opsi, mode: "commit" }))));
const c2 = await hitungTabel();
console.log("IDEMPOTEN", JSON.stringify(c1) === JSON.stringify(c2));
console.log("TABEL", JSON.stringify({ awal, akhir: c2 }));
const sesudah = await lapor();
console.log("LAPORAN_SEBELUM", JSON.stringify(sebelum)); console.log("LAPORAN_SESUDAH", JSON.stringify(sesudah));
const [d] = await db.$queryRaw`select sum(video_3s_views)::text v, sum(impressions) filter (where video_3s_views is not null)::text i from meta_ad_daily_delivery where date_wib=${new Date(`${T}T00:00:00Z`)}`;
console.log("HOOK", JSON.stringify(d));
const per = await laporanPerforma(db, { dari: T, sampai: T, level: "campaign" }, { now: opsi.now });
const rek = await rekapHarian(db, { dari: T, sampai: T, level: "campaign" }, { now: opsi.now });
const kes = await kesehatanAtribusi(db, { dari: T, sampai: T }, { now: opsi.now });
console.log("MCP_PERFORMA", JSON.stringify({ total: per.total?.biaya ?? null, lead: per.total?.leadBaruTerbukti ?? per.total?.lead ?? null, baris: per.baris?.length }).slice(0, 500));
console.log("MCP_REKAP_KUNCI", Object.keys(rek).join(","));
console.log("MCP_KESEHATAN", JSON.stringify(kes.sinkronMeta));
console.log("STATUS", JSON.stringify(await statusSinkronMeta(db)).slice(0, 400));
await db.$disconnect();
