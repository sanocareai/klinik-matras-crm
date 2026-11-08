// Adapter Composio → Meta: pagination, retry, timeout, token, akun/zona/mata uang, null vs nol, rekonsiliasi, hook rate, kerahasiaan. Tanpa jaringan dan tanpa DB.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TOOL_BACA, buatKlien, hookRate, kelasGalat, konfigurasiKurang, konfigurasiComposio, rekonsiliasiHarian, barisDelivery, barisImporter, ATRIBUSI } from "../src/services/attribution/composioMeta.js";
import { daftarHari, jalankanSinkronComposio, potongRentang, rentangRolling } from "../src/services/attribution/composioMetaSync.js";

const AKUN = "2081614415911241";
const RAHASIA = "kunci-rahasia-uji";
const ENV = { COMPOSIO_API_KEY: RAHASIA, COMPOSIO_META_CONNECTED_ACCOUNT_ID: "ca_uji", COMPOSIO_META_TOOL_VERSION: "20261101_00", META_ADS_ACCOUNT_ID: AKUN };
const ok = (data) => ({ ok: true, status: 200, json: async () => ({ successful: true, data, error: null }) });
const klien = (fetchFn, o = {}) => buatKlien({ env: ENV, fetchFn, tidurFn: async () => {}, ...o });
const baris = (t, ad, spend = "100") => ({ account_id: AKUN, account_currency: "IDR", ad_id: ad, adset_id: "222222", campaign_id: "333333", spend, impressions: "10", inline_link_clicks: "1", date_start: t, date_stop: t });

test("pagination: mengikuti paging.next; cursors.after tanpa next = halaman terakhir", async () => {
  const dipanggil = [];
  const f = async (_u, o) => { const a = JSON.parse(o.body).arguments; dipanggil.push(a.after ?? null); return !a.after ? ok({ data: [baris("2026-11-07", "111111")], paging: { next: "https://x", cursors: { after: "C1" } } }) : ok({ data: [baris("2026-11-07", "111112")], paging: { cursors: { after: "C2" } } }); };
  const r = await klien(f).insightsAd("2026-11-07", "2026-11-07");
  assert.equal(r.length, 2); assert.deepEqual(dipanggil, [null, "C1"]);
});
test("pagination: kegagalan halaman ke-2, cursor berulang, batas halaman, next tanpa cursor → galat, tidak ada hasil parsial", async () => {
  let n = 0;
  await assert.rejects(klien(async () => (++n === 1 ? ok({ data: [baris("2026-11-07", "111111")], paging: { next: "x", cursors: { after: "C1" } } }) : { ok: false, status: 400 })).insightsAd("2026-11-07", "2026-11-07"), (e) => e.kode === "HTTP_400");
  await assert.rejects(klien(async () => ok({ data: [], paging: { next: "x", cursors: { after: "SAMA" } } })).insightsAd("2026-11-07", "2026-11-07"), (e) => e.kode === "CURSOR_BERULANG");
  let m = 0;
  await assert.rejects(klien(async () => ok({ data: [], paging: { next: "x", cursors: { after: `C${++m}` } } }), { maksHalaman: 3 }).insightsAd("2026-11-07", "2026-11-07"), (e) => e.kode === "HALAMAN_TERPOTONG");
  await assert.rejects(klien(async () => ok({ data: [], paging: { next: "x" } })).insightsAd("2026-11-07", "2026-11-07"), (e) => e.kode === "HALAMAN_TERPOTONG");
  await assert.rejects(klien(async () => ok({ pesan: "bukan data" })).insightsAd("2026-11-07", "2026-11-07"), (e) => e.kode === "RESPONS_TIDAK_VALID");
});
test("retry terbatas: 429/5xx/jaringan/timeout diulang lalu berhenti; 4xx dan token kedaluwarsa tidak diulang", async () => {
  let n = 0;
  const r = await klien(async () => (++n < 3 ? { ok: false, status: 429 } : ok({ data: [] }))).kontrolAkun("2026-11-07", "2026-11-07");
  assert.deepEqual(r, []); assert.equal(n, 3);
  n = 0;
  await assert.rejects(klien(async () => { n++; return { ok: false, status: 503 }; }).kontrolAkun("2026-11-07", "2026-11-07"), (e) => e.kode === "HTTP_503"); assert.equal(n, 4);
  n = 0;
  await assert.rejects(klien(async () => { n++; throw Object.assign(new Error("x"), { name: "TimeoutError" }); }).kontrolAkun("2026-11-07", "2026-11-07"), (e) => e.kode === "TIMEOUT"); assert.equal(n, 4);
  n = 0;
  await assert.rejects(klien(async () => { n++; return { ok: true, status: 200, json: async () => ({ successful: false, error: '{"code":190,"message":"Error validating access token"}' }) }; }).kontrolAkun("2026-11-07", "2026-11-07"), (e) => e.kode === "TOKEN_KEDALUWARSA"); assert.equal(n, 1);
  n = 0;
  await assert.rejects(klien(async () => { n++; return { ok: false, status: 401 }; }).kontrolAkun("2026-11-07", "2026-11-07"), (e) => e.kode === "AKSES_COMPOSIO_DITOLAK"); assert.equal(n, 1);
  assert.equal(kelasGalat("code: 17 limit").ulang, true);
});
test("timeout eksplisit dipasang pada tiap panggilan", async () => {
  let sinyal; await klien(async (_u, o) => { sinyal = o.signal; return ok({ data: [] }); }).kontrolAkun("2026-11-07", "2026-11-07");
  assert.ok(sinyal instanceof AbortSignal);
});
test("akun, zona, mata uang, tanggal salah ditolak", async () => {
  const akun = (a) => klien(async () => ok(a)).verifikasiAkun();
  await assert.rejects(akun({ account_id: "999999", currency: "IDR", timezone_name: "Asia/Jakarta" }), (e) => e.kode === "AKUN_SALAH");
  await assert.rejects(akun({ account_id: AKUN, currency: "USD", timezone_name: "Asia/Jakarta" }), (e) => e.kode === "MATA_UANG_SALAH");
  await assert.rejects(akun({ account_id: AKUN, currency: "IDR", timezone_name: "America/Los_Angeles" }), (e) => e.kode === "ZONA_WAKTU_SALAH");
  assert.equal((await akun({ account_id: AKUN, currency: "IDR", timezone_name: "Asia/Jakarta" })).zonaWaktu, "Asia/Jakarta");
  await assert.rejects(klien(async () => ok({ data: [{ ...baris("2026-11-07", "111111"), account_id: "999999" }] })).insightsAd("2026-11-07", "2026-11-07"), (e) => e.kode === "AKUN_SALAH");
  await assert.rejects(klien(async () => ok({ data: [baris("2026-11-08", "111111")] })).insightsAd("2026-11-07", "2026-11-07"), (e) => e.kode === "TANGGAL_DI_LUAR_RENTANG");
});
test("hanya tool baca: tool tulis ditolak tanpa permintaan jaringan; daftar tidak memuat tool tulis", async () => {
  let n = 0;
  await assert.rejects(klien(async () => { n++; return ok({}); }).panggil("METAADS_SET_AD_OBJECT_STATUS", {}), (e) => e.kode === "TOOL_TIDAK_DIIZINKAN");
  assert.equal(n, 0);
  for (const t of TOOL_BACA) assert.match(t, /_GET_/);
});
test("permintaan: kunci hanya di header, versi tool tetap, connected account dikirim; versi 'latest' tidak diterima", async () => {
  let cap; await klien(async (u, o) => { cap = { u, o }; return ok({ data: [] }); }).kontrolAkun("2026-11-07", "2026-11-07");
  assert.equal(cap.o.headers["x-api-key"], RAHASIA); assert.ok(!cap.o.body.includes(RAHASIA)); assert.ok(!cap.u.includes(RAHASIA));
  const b = JSON.parse(cap.o.body); assert.equal(b.version, "20261101_00"); assert.equal(b.connected_account_id, "ca_uji"); assert.equal(b.arguments.time_increment, 1); assert.equal(b.arguments.level, "account");
  assert.ok(konfigurasiKurang(konfigurasiComposio({ ...ENV, COMPOSIO_META_TOOL_VERSION: "latest" })).some((x) => x.startsWith("COMPOSIO_META_TOOL_VERSION")));
  assert.deepEqual(konfigurasiKurang(konfigurasiComposio({})).length, 4);
});
test("rekonsiliasi: cocok, nol sah, tanpa delivery, selisih 1 rupiah, kontrol hilang", () => {
  const k = (t, s) => ({ date_start: t, spend: s, impressions: "10", inline_link_clicks: "1" });
  const h = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];
  const [a, b, c, d, e] = rekonsiliasiHarian(h, [baris(h[0], "1"), baris(h[3], "1", "100"), baris(h[4], "1")], [k(h[0], "100"), { date_start: h[1], spend: "0" }, k(h[3], "101")]);
  assert.equal(a.status, "DELIVERY_TERVERIFIKASI"); assert.equal(a.rekonsiliasi, true);
  assert.equal(b.status, "NOL_TERVERIFIKASI"); assert.equal(b.kontrolSpend, "0.00");
  assert.equal(c.status, "TANPA_DELIVERY"); assert.equal(c.kontrolSpend, null, "tanpa delivery bukan Rp0");
  assert.equal(d.status, "BELUM_REKONSILIASI"); assert.equal(d.selisihSpend, "1.00");
  assert.equal(e.status, "BELUM_REKONSILIASI", "baris Ad tanpa kontrol");
});
test("nominal presisi tanpa galat float: Σ 0.1 + 0.2 = 0.3", () => {
  const h = "2026-11-01";
  const [a] = rekonsiliasiHarian([h], [{ ...baris(h, "1", "0.10"), impressions: "1", inline_link_clicks: "0" }, { ...baris(h, "2", "0.20"), impressions: "1", inline_link_clicks: "0" }], [{ date_start: h, spend: "0.30", impressions: "2", inline_link_clicks: "0" }]);
  assert.equal(a.rekonsiliasi, true); assert.equal(a.adSpend, "0.30");
});
test("ID string, percakapan pakai value (bukan 7d_click) dan tipe yang sama; null ≠ nol", () => {
  const x = { ...baris("2026-11-07", "52699675952484"), actions: [{ action_type: ATRIBUSI.actionType, value: "79", "7d_click": "77" }, { action_type: "onsite_conversion.total_messaging_connection", value: "84" }, { action_type: "video_view", value: "500" }], video_thruplay_watched_actions: [{ action_type: "video_view", value: "20" }] };
  const [r] = barisImporter([x]);
  assert.equal(r.adId, "52699675952484"); assert.equal(typeof r.adId, "string"); assert.equal(r.platformConversations, "79", "tidak dijumlah dengan aksi lain");
  const [tanpa] = barisImporter([baris("2026-11-07", "1")]); assert.equal(tanpa.platformConversations, "");
  const [d] = barisDelivery([x]); assert.equal(d.video3s, 500n); assert.equal(d.thruplay, 20n);
  assert.equal(barisDelivery([baris("2026-11-07", "1")])[0].video3s, null);
});
test("hook rate dari agregat, bukan rata-rata persentase; Ad tanpa video tidak masuk penyebut; tanpa penyebut = null + alasan", () => {
  const r = hookRate([{ video3s: 1n, impressions: 1n }, { video3s: 100n, impressions: 1000n }, { video3s: null, impressions: 5000n }]);
  assert.equal(r.pembilang, 101); assert.equal(r.penyebut, 1001); assert.equal(r.nilai, 10.08);
  assert.deepEqual(hookRate([{ video3s: null, impressions: 9n }]).nilai, null);
  assert.equal(hookRate([]).alasan, "TANPA_IMPRESSIONS_VIDEO");
});
test("tanggal WIB: rolling 7 hari penuh sampai kemarin; lewat tengah malam WIB sudah berganti; potongan rentang utuh", () => {
  assert.deepEqual(rentangRolling(new Date("2026-11-07T17:30:00Z")), { dari: "2026-11-01", sampai: "2026-11-07" }, "00.30 WIB 8 Nov");
  assert.deepEqual(rentangRolling(new Date("2026-11-07T16:30:00Z")), { dari: "2026-10-31", sampai: "2026-11-06" }, "23.30 WIB 7 Nov");
  assert.equal(daftarHari("2026-10-30", "2026-11-02").length, 4);
  const p = potongRentang("2026-10-01", "2026-11-07"); assert.equal(p[0].sampai, "2026-10-07"); assert.equal(p.at(-1).sampai, "2026-11-07"); assert.equal(p.flatMap((x) => daftarHari(x.dari, x.sampai)).length, 38);
});
test("gerbang mode: konfigurasi kurang, flag OFF menolak commit, hari berjalan ditolak (tanpa DB dan jaringan)", async () => {
  const mati = async () => { throw new Error("tidak boleh menyentuh"); };
  assert.equal((await jalankanSinkronComposio(null, { mode: "commit", env: {}, fetchFn: mati })).status, "TIDAK_SIAP");
  assert.match((await jalankanSinkronComposio(null, { mode: "commit", env: ENV, fetchFn: mati })).alasan, /COMPOSIO_META_SYNC_ENABLED/);
  assert.equal((await jalankanSinkronComposio(null, { mode: "dry", env: ENV, fetchFn: mati, dari: "2026-11-07", sampai: "2026-11-08", now: new Date("2026-11-08T05:00:00Z") })).alasan, "HARI_BERJALAN_TIDAK_BOLEH_MASUK_KPI");
});
test("log aman: berkas adapter tidak mencetak ke console; galat tidak memuat kunci atau isi respons", async () => {
  for (const f of ["composioMeta.js", "composioMetaSync.js"]) assert.ok(!/console\./.test(fs.readFileSync(new URL(`../src/services/attribution/${f}`, import.meta.url), "utf8")), f);
  const e = await klien(async () => ({ ok: true, status: 200, json: async () => ({ successful: false, error: `gagal untuk ${RAHASIA} nomor 6281234` }) })).kontrolAkun("2026-11-07", "2026-11-07").catch((x) => x);
  assert.ok(!String(e.message).includes(RAHASIA)); assert.ok(!String(e.message).includes("6281234")); assert.equal(e.kode, "TOOL_GAGAL");
});
