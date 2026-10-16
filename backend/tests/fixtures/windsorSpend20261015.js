// FIXTURE VERIFIKASI spend: dataset Windsor Meta (akun 2081614415911241, Asia/Jakarta, IDR), satu hari penuh 15 Okt 2026, level Ad, ditarik 16 Okt 2026.
// Sumber validasi pipeline spend dan rekonsiliasi — BUKAN data performa CRM (attribution touch belum aktif pada tanggal ini). Tanpa data pelanggan.
// Header kolom percakapan diberi nama sesuai kontrak importer ("Messaging conversations started"); nilai TIDAK diubah.
export const WINDSOR_20261015 = Object.freeze([
  { campaign_id: "52597175089484", campaign_name: "KM | ACQ | WA | JABODETABEK", adset_id: "52597175090484", adset_name: "BROAD | 25+ | JABO", ad_id: "52597175090084", ad_name: "Teardown Rp20 juta", spend: 81036, impressions: 3650, reach: 3542, clicks: 81, link_clicks: 41, conv: 10, first_reply: 7, new_conn: 10 },
  { campaign_id: "52597175089484", campaign_name: "KM | ACQ | WA | JABODETABEK", adset_id: "52597175090484", adset_name: "BROAD | 25+ | JABO", ad_id: "52675464776684", ad_name: "Teardown King Koil 40JT", spend: 959, impressions: 63, reach: 61, clicks: 0, link_clicks: 0, conv: 0, first_reply: 0, new_conn: 0 },
  { campaign_id: "52597175089484", campaign_name: "KM | ACQ | WA | JABODETABEK", adset_id: "52597175090484", adset_name: "BROAD | 25+ | JABO", ad_id: "52685547746884", ad_name: "Teardown Untuk Ibu", spend: 341389, impressions: 22554, reach: 21864, clicks: 252, link_clicks: 157, conv: 27, first_reply: 25, new_conn: 28 },
  { campaign_id: "52689735916884", campaign_name: "KM | ACQ | IG-Only | Jabodetabek-Bandung", adset_id: "52689767293084", adset_name: "IG ONLY | BROAD | 25+ | JABO-BDG 2", ad_id: "52689767293284", ad_name: "Teardown 20jt", spend: 176869, impressions: 5471, reach: 5072, clicks: 83, link_clicks: 31, conv: 9, first_reply: 7, new_conn: 9 },
  { campaign_id: "52597175089484", campaign_name: "KM | ACQ | WA | JABODETABEK", adset_id: "52690997586684", adset_name: "BROAD | 25+ | JABODETABEK | IG ONLY", ad_id: "52690997586884", ad_name: "ADS", spend: 45162, impressions: 2075, reach: 1739, clicks: 25, link_clicks: 16, conv: 5, first_reply: 3, new_conn: 5 },
  { campaign_id: "52694481763084", campaign_name: "KM | ACQ | WA | JABO | IG ONLY | OCT26", adset_id: "52694481763284", adset_name: "JABO | BROAD | IG | WA | 25-65", ad_id: "52694481763484", ad_name: "JABO | IG | WA | Teardown Untuk Ibu | OCT26", spend: 400301, impressions: 29402, reach: 27793, clicks: 248, link_clicks: 110, conv: 16, first_reply: 16, new_conn: 16 },
  { campaign_id: "52694481763084", campaign_name: "KM | ACQ | WA | JABO | IG ONLY | OCT26", adset_id: "52694481763284", adset_name: "JABO | BROAD | IG | WA | 25-65", ad_id: "52694485574084", ad_name: "JABO | IG | WA | Teardown 20JT | OCT26", spend: 16592, impressions: 690, reach: 682, clicks: 5, link_clicks: 3, conv: 1, first_reply: 0, new_conn: 1 },
  { campaign_id: "52694489679884", campaign_name: "KM | RTG | WA | JABO-BDG | IG ONLY | OCT26", adset_id: "52694489680284", adset_name: "RTG | IG ENGAGERS 90D + WEB 90D | IG | WA", ad_id: "52694489680084", ad_name: "RTG | IG | WA | Teardown 20JT | OCT26", spend: 89280, impressions: 3145, reach: 2972, clicks: 31, link_clicks: 13, conv: 3, first_reply: 3, new_conn: 4 },
  { campaign_id: "52696128518884", campaign_name: "KM | PROMO 10.10 | LEADS | WA | JABO | IG | OCT26", adset_id: "52696128519284", adset_name: "JABO | BROAD | IG | WA | LEADS | 25-65 | 10.10", ad_id: "52696128519084", ad_name: "10.10 | IG | WA LEADS | Kasur Sehat dari Dalam | OCT26", spend: 0, impressions: 0, reach: 0, clicks: 0, link_clicks: 0, conv: 0, first_reply: 0, new_conn: 1 },
  { campaign_id: "52696131903884", campaign_name: "KM | TEST | FB BROAD | WA | JABO | OCT26", adset_id: "52696131903484", adset_name: "JABO | BROAD | FB | WA | CONV | 25-65 | OCT26", ad_id: "52696131903684", ad_name: "FB | WA | Teardown Untuk Ibu | BROAD | OCT26", spend: 0, impressions: 0, reach: 0, clicks: 0, link_clicks: 0, conv: 1, first_reply: 0, new_conn: 1 },
]);

// Control total level akun (dari sumber). Reach akun (60020) TIDAK sama dengan Σ reach baris Ad: reach non-additive.
export const CONTROL_TOTAL = Object.freeze({ spend: 1151588, impressions: 67050, reach: 60020, clicks: 725, link_clicks: 371, conversation_started_7d: 72, first_reply: 61, new_messaging_connections: 75 });
export const CONTROL_CAMPAIGN = Object.freeze({
  "52597175089484": { spend: 468546, impressions: 28342, link_clicks: 214, conversations: 42 },
  "52689735916884": { spend: 176869, impressions: 5471, link_clicks: 31, conversations: 9 },
  "52694481763084": { spend: 416893, impressions: 30092, link_clicks: 113, conversations: 17 },
  "52694489679884": { spend: 89280, impressions: 3145, link_clicks: 13, conversations: 3 },
  "52696128518884": { spend: 0, impressions: 0, link_clicks: 0, conversations: 0 },
  "52696131903884": { spend: 0, impressions: 0, link_clicks: 0, conversations: 1 },
});

const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
export function csvWindsor(rows = WINDSOR_20261015) {
  const kepala = "date,account_id,currency,timezone,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,link_clicks,Messaging conversations started,first_reply,new_messaging_connections";
  return [kepala, ...rows.map((r) => ["2026-10-15", "2081614415911241", "IDR", "Asia/Jakarta", r.campaign_id, q(r.campaign_name), r.adset_id, q(r.adset_name), r.ad_id, q(r.ad_name), r.spend, r.impressions, r.reach, r.clicks, r.link_clicks, r.conv, r.first_reply, r.new_conn].join(","))].join("\n");
}
