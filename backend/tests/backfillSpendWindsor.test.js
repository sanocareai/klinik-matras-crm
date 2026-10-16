// Tes perkakas backfill spend Windsor 1–14 Okt (scripts/backfill-spend-windsor.cjs). Data di sini SINTETIS (hanya untuk menguji logika), bukan data Meta.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { barisSpendDariCsv, rencanaSpend } from "../src/services/attribution/spend.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const B = require(path.join(root, "scripts/backfill-spend-windsor.cjs"));
const KEPALA = fs.readFileSync(path.join(root, "docs/templates/windsor-spend-ad-harian.template.csv"), "utf8").trim();
const AKUN = "2081614415911241";
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;

// dataset SINTETIS: 14 hari x 2 Ad, satu hari Rp0 dengan percakapan
function sintetis({ ubah = () => {} } = {}) {
  const baris = []; const kontrol = { akun: AKUN, zona: "Asia/Jakarta", mata_uang: "IDR", harian: {} };
  B.hariRentang().forEach((h, i) => {
    const ads = [["52597175089484", "52597175090484", "52597175090084", i === 5 ? 0 : 10000 + i, i === 5 ? 0 : 100 + i, i === 5 ? 0 : 5, i === 5 ? 1 : 2], ["52694481763084", "52694481763284", "52694481763484", 20000 + i, 200 + i, 8, 3]];
    const k = { spend: 0, impressions: 0, link_clicks: 0, conversations: 0, campaign: {} };
    for (const [c, s, a, sp, im, lk, kv] of ads) {
      const r = { date: h, account_id: AKUN, currency: "IDR", timezone: "Asia/Jakarta", campaign_id: c, campaign_name: "C " + c, adset_id: s, adset_name: "S", ad_id: a, ad_name: "A", spend: sp, impressions: im, reach: 99999, clicks: 1, link_clicks: lk, conv: kv, first_reply: 0, new_conn: 0 };
      ubah(r, h); baris.push(r);
      k.spend += Number(r.spend) || 0; k.impressions += r.impressions; k.link_clicks += r.link_clicks; k.conversations += r.conv;
      const kc = (k.campaign[c] ||= { spend: 0, impressions: 0, link_clicks: 0, conversations: 0 });
      kc.spend += Number(r.spend) || 0; kc.impressions += r.impressions; kc.link_clicks += r.link_clicks; kc.conversations += r.conv;
    }
    kontrol.harian[h] = k;
  });
  const csv = [KEPALA, baris.map((r) => [r.date, r.account_id, r.currency, r.timezone, r.campaign_id, r.campaign_name, r.adset_id, r.adset_name, r.ad_id, r.ad_name, r.spend, r.impressions, r.reach, r.clicks, r.link_clicks, r.conv, r.first_reply, r.new_conn].join(",")).join("\n")].join("\n");
  return { csv, kontrol };
}

test("template CSV: header memenuhi kontrak importer produksi (kolom wajib terpetakan) dan TIDAK memuat baris data", () => {
  const p = barisSpendDariCsv(KEPALA + "\n");
  assert.equal(p.galat, null);
  assert.equal(p.baris.length, 0);
  assert.equal(fs.readFileSync(path.join(root, "docs/templates/windsor-spend-ad-harian.template.csv"), "utf8").trim().split("\n").length, 1, "header saja");
  const r = rencanaSpend([{ baris: 2, tanggal: "2026-10-01", accountId: AKUN, campaignId: "52597175089484", adSetId: "52597175090484", adId: "52597175090084", spend: "0", currency: "IDR" }], { ctx: { accountId: AKUN } });
  assert.equal(r.baru.length, 1, "spend Rp0 diterima importer");
});

test("template control total: 14 hari 1–14 Okt, semua angka null -> TIDAK PERNAH lolos gerbang; zona/mata uang tertulis", () => {
  const t = JSON.parse(fs.readFileSync(path.join(root, "docs/templates/windsor-kontrol-total-1-14okt.template.json"), "utf8"));
  assert.deepEqual(Object.keys(t.harian), B.hariRentang());
  assert.equal(Object.keys(t.harian).length, 14);
  assert.deepEqual([t.zona, t.mata_uang, t.akun], ["Asia/Jakarta", "IDR", AKUN]);
  assert.ok(Object.values(t.harian).every((h) => h.spend === null && h.impressions === null && h.link_clicks === null && h.conversations === null));
  const { csv } = sintetis();
  const c = B.periksaCsv(csv, { akun: AKUN });
  const kb = B.bandingkanKontrol(c.agregat, t);
  assert.deepEqual([kb.lengkap, kb.cocok], [false, false]);
  assert.ok(kb.selisih.some((x) => /belum diisi/.test(x)));
  assert.equal(B.bandingkanKontrol(c.agregat, null).cocok, false);
});

test("dataset sintetis valid + control total cocok: lengkap dan cocok per hari dan per campaign; agregat tidak memuat reach", () => {
  const { csv, kontrol } = sintetis();
  const c = B.periksaCsv(csv, { akun: AKUN });
  assert.deepEqual(c.galat, []);
  assert.equal(c.baris.length, 28);
  assert.equal(c.agregat.harian["2026-10-06"].spend, 20005, "hari ke-6: satu Ad Rp0 diterima");
  const kb = B.bandingkanKontrol(c.agregat, kontrol);
  assert.deepEqual([kb.lengkap, kb.cocok, kb.selisih], [true, true, []]);
  assert.ok(!JSON.stringify(c.agregat).toLowerCase().includes("reach"));
  // Σ Ad = Σ Ad Set = Σ Campaign = akun
  for (const h of B.hariRentang()) {
    const jml = (o) => Object.values(o).reduce((s, x) => s + x.spend, 0);
    assert.equal(jml(c.agregat.ad[h]), c.agregat.harian[h].spend); assert.equal(jml(c.agregat.adset[h]), c.agregat.harian[h].spend); assert.equal(jml(c.agregat.campaign[h]), c.agregat.harian[h].spend);
  }
  assert.equal(c.agregat.akun.spend, B.hariRentang().reduce((s, h) => s + c.agregat.harian[h].spend, 0));
});

test("pemeriksa menolak: notasi ilmiah, spend negatif/format, tanggal di luar 1–14 Okt (termasuk 15 Okt), USD, zona lain, akun lain, duplikat, ID bukan digit, hierarki ganda, kolom hilang", () => {
  const galatUntuk = (ubah) => B.periksaCsv(sintetis({ ubah }).csv, { akun: AKUN }).galat.join(" | ");
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02") r.ad_id = "5.2E+13"; }), /ad_id_NOTASI_ILMIAH/);
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02") r.spend = "1.5E+4"; }), /SPEND_NOTASI_ILMIAH/);
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02") r.spend = "-1"; }), /SPEND_NEGATIF/);
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02") r.spend = "1.500,50"; }), /SPEND_FORMAT_TIDAK_DIKENAL/);
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02") r.date = "2026-10-15"; }), /TANGGAL_DI_LUAR/);
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02") r.date = "2026-09-30"; }), /TANGGAL_DI_LUAR/);
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02") r.currency = "USD"; }), /MATA_UANG_BUKAN_IDR/);
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02") r.timezone = "America/Los_Angeles"; }), /ZONA_WAKTU_BUKAN_ASIA_JAKARTA/);
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02") r.account_id = "999999"; }), /ACCOUNT_ID_BEDA/);
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02") r.ad_id = "abc"; }), /ad_id_BUKAN_ID_DIGIT/);
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02") r.impressions = 1.5; }), /IMPRESSIONS_TIDAK_VALID/);
  assert.match(galatUntuk((r, h) => { if (h === "2026-10-02" && r.ad_id === "52694481763484") r.adset_id = "52597175090484"; }), /AD_SET_52597175090484_DI_DUA_CAMPAIGN/);
  const dup = sintetis().csv.split("\n"); dup.push(dup[1]);
  assert.match(B.periksaCsv(dup.join("\n"), { akun: AKUN }).galat.join(" | "), /DUPLIKAT_HARI_AD/);
  assert.match(B.periksaCsv("date,ad_id\n2026-10-01,1", { akun: AKUN }).galat.join(" | "), /KOLOM_WAJIB_HILANG/);
  assert.deepEqual(B.periksaCsv("", {}).galat, ["CSV_KOSONG"]);
});

test("control total salah satu angka -> tidak cocok (selisih per hari/campaign dilaporkan); hari tanpa kontrol -> tidak lengkap; zona kontrol salah", () => {
  const { csv, kontrol } = sintetis();
  const c = B.periksaCsv(csv, { akun: AKUN });
  const k1 = JSON.parse(JSON.stringify(kontrol)); k1.harian["2026-10-07"].spend += 1;
  const r1 = B.bandingkanKontrol(c.agregat, k1);
  assert.equal(r1.cocok, false); assert.ok(r1.selisih.some((x) => /^2026-10-07: spend CSV=/.test(x)));
  const k2 = JSON.parse(JSON.stringify(kontrol)); k2.harian["2026-10-09"].campaign["52597175089484"].conversations += 2;
  assert.ok(B.bandingkanKontrol(c.agregat, k2).selisih.some((x) => /2026-10-09 campaign 52597175089484: conversations/.test(x)));
  const k3 = JSON.parse(JSON.stringify(kontrol)); delete k3.harian["2026-10-13"];
  assert.deepEqual([B.bandingkanKontrol(c.agregat, k3).lengkap, B.bandingkanKontrol(c.agregat, k3).cocok], [false, false]);
  const k4 = JSON.parse(JSON.stringify(kontrol)); k4.zona = "UTC";
  assert.equal(B.bandingkanKontrol(c.agregat, k4).cocok, false);
  assert.equal(B.totalKontrol(kontrol), c.agregat.akun.spend);
});

test("pembungkus: commit TANPA KOMIT=YA ditolak sebelum menyentuh server; mode salah/berkas hilang ditolak; mode cek lokal berjalan tanpa ssh", { skip: !punyaBash }, () => {
  const sh = path.join(root, "scripts/backfill-spend-windsor.sh");
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || "/tmp", "bf-"));
  try {
    const { csv, kontrol } = sintetis();
    const pc = path.join(tmp, "d.csv"), pk = path.join(tmp, "k.json");
    fs.writeFileSync(pc, csv); fs.writeFileSync(pk, JSON.stringify(kontrol));
    const env = { ...process.env, SSH_HOST: "tidak-ada.invalid" }; delete env.KOMIT;
    const toPosix = (p) => p.split(path.sep).join("/");
    const r1 = spawnSync("bash", [toPosix(sh), "commit", toPosix(pc), toPosix(pk)], { encoding: "utf8", env });
    assert.equal(r1.status, 2); assert.match(r1.stderr, /KOMIT=YA/);
    assert.equal(spawnSync("bash", [toPosix(sh), "hapus", toPosix(pc), toPosix(pk)], { encoding: "utf8", env }).status, 2);
    assert.equal(spawnSync("bash", [toPosix(sh), "dry", toPosix(pc) + ".tidakada", toPosix(pk)], { encoding: "utf8", env }).status, 2);
    const r2 = spawnSync("bash", [toPosix(sh), "cek", toPosix(pc), toPosix(pk), AKUN], { encoding: "utf8", env });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    const o = JSON.parse(r2.stdout); assert.deepEqual([o.baris, o.kontrolLengkap, o.kontrolCocok, o.csvGalat.length], [28, true, true, 0]);
    // kontrol dirusak -> exit 1
    const rusak = JSON.parse(JSON.stringify(kontrol)); rusak.harian["2026-10-01"].spend += 5; fs.writeFileSync(pk, JSON.stringify(rusak));
    assert.equal(spawnSync("bash", [toPosix(sh), "cek", toPosix(pc), toPosix(pk), AKUN], { encoding: "utf8", env }).status, 1);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("kode perkakas: sumber WINDSOR_API, zona Asia/Jakarta, IDR; commit hanya lewat jalur aplikasi (/spend) bila semua gerbang lulus; tidak memuat angka data nyata", () => {
  const src = fs.readFileSync(path.join(root, "scripts/backfill-spend-windsor.cjs"), "utf8");
  assert.match(src, /SUMBER = "WINDSOR_API"/); assert.match(src, /ZONA = "Asia\/Jakarta"/); assert.match(src, /MATA_UANG = "IDR"/);
  assert.match(src, /process\.env\.KOMIT === "YA"/);
  assert.ok(/siap = out\.gerbang\.csvValid && out\.gerbang\.kontrolLengkap && out\.gerbang\.kontrolCocok && out\.gerbang\.dryRunBersih && process\.env\.KOMIT === "YA"/.test(src));
  assert.ok(!/prisma\.metaAdDailySpend\.(create|update|upsert|delete)/.test(src), "tidak menulis langsung ke DB");
  assert.ok(!/1151588|2026-10-15/.test(src), "tanpa data/angka 15 Okt di perkakas");
});
