// Tes unit (tanpa DB): parser/validasi spend, rencana impor, KPI biaya, status, evaluasi target, monitoring, adapter Meta (fetch dipalsukan).
import test from "node:test";
import assert from "node:assert/strict";
import { barisSpendDariCsv, validasiBarisSpend, rencanaSpend, checksumBaris, ZONA_WIB } from "../src/services/attribution/spend.js";
import { hitungBiayaBaris, terapkanBiaya, evaluasiTarget, normalisasiTarget, kesegaranSpend, STATUS_BIAYA, EVALUASI, TARGET_KOSONG, barisKosong } from "../src/services/attribution/biayaKpi.js";
import { evaluasiAlarm, levelGabungan, rencanaNotifikasi, CFG_BAWAAN } from "../src/services/attribution/monitor.js";
import { periksaKesiapan, sinkronkanSpendMeta, barisDariInsights, ambilGet, ACTION_PERCAKAPAN } from "../src/services/attribution/spendSyncMeta.js";
import { validasiTarget, rentangSpend } from "../src/routes/attributionSpend.js";

const AKUN = "1234567890123";
const AD1 = "52694481763484", SET1 = "52694481763284", CAMP1 = "52694481763084";
const AD2 = "52689767293284", SET2 = "52689767293084", CAMP2 = "52689735916884";
const csv = (baris, judulSpend = "Amount spent (IDR)") => [`Day,Account ID,Campaign name,Campaign ID,Ad set name,Ad set ID,Ad name,Ad ID,${judulSpend},Impressions,Reach,Link clicks,Messaging conversations started`, ...baris].join("\n");
const b1 = (o = {}) => ({ tanggal: "2026-10-16", accountId: AKUN, campaignId: CAMP1, adSetId: SET1, adId: AD1, spend: "150000", currency: "IDR", ...o });

// ───────────── parser + validasi ─────────────
test("CSV Ads Manager: kolom dikenali, mata uang dari judul kolom, ID tetap string", () => {
  const p = barisSpendDariCsv(csv([`2026-10-16,${AKUN},"KM | ACQ",${CAMP1},"Set A",${SET1},"Teardown",${AD1},150000.50,12000,9000,300,42`]));
  assert.equal(p.galat, null);
  assert.equal(p.mataUangKolom, "IDR");
  const v = validasiBarisSpend(p.baris[0], { accountId: AKUN, mataUangKolom: p.mataUangKolom });
  assert.equal(v.ok, true);
  assert.deepEqual([v.row.adId, v.row.spend, v.row.impressions, v.row.platformConversations, v.row.currency], [AD1, 150000.5, 12000, 42, "IDR"]);
  assert.equal(typeof v.row.adId, "string");
});

test("ditolak: notasi ilmiah (ID dan spend), mata uang bukan IDR, spend negatif, format ribuan/koma, tanggal salah, kolom wajib hilang", () => {
  const alasan = (o, ctx) => validasiBarisSpend(b1(o), ctx).alasan;
  assert.match(alasan({ adId: "5.26944817634E+13" }), /AD_ID_NOTASI_ILMIAH/);
  assert.match(alasan({ spend: "1.5E+5" }), /SPEND_NOTASI_ILMIAH/);
  assert.equal(alasan({ spend: "-1" }), "SPEND_NEGATIF");
  assert.equal(alasan({ spend: "1.500,50" }), "SPEND_FORMAT_TIDAK_DIKENAL");
  assert.equal(alasan({ spend: "150,000" }), "SPEND_FORMAT_TIDAK_DIKENAL");
  assert.equal(alasan({ spend: "" }), "SPEND_KOSONG");
  assert.equal(alasan({ currency: "USD" }), "MATA_UANG_BUKAN_IDR");
  assert.equal(validasiBarisSpend(b1({}), { mataUangKolom: "USD" }).alasan, "MATA_UANG_BUKAN_IDR");
  assert.equal(alasan({ tanggal: "16/10/2026" }), "TANGGAL_TIDAK_VALID_ISO");
  assert.equal(alasan({ tanggal: "2026-02-30" }), "TANGGAL_TIDAK_VALID_ISO");
  assert.equal(alasan({ adSetId: SET1.slice(0, 3) }), "AD_SET_ID_BUKAN_ID_DIGIT");
  assert.equal(alasan({ adSetId: AD1 }), "ID_BERTINGKAT_SAMA");
  assert.equal(alasan({ impressions: "12,5" }), "IMPRESSIONS_TIDAK_VALID");
  assert.equal(barisSpendDariCsv("Day,Ad ID\n2026-10-16,1").galat, "KOLOM_WAJIB_HILANG:adSetId");
  assert.equal(barisSpendDariCsv("").galat, "BERKAS_KOSONG");
  assert.equal(validasiBarisSpend(b1({ accountId: "act_" + AKUN }), { accountId: AKUN }).ok, true, "awalan act_ dibersihkan");
  assert.equal(validasiBarisSpend(b1({ accountId: "999999" }), { accountId: AKUN }).alasan, "ACCOUNT_ID_BEDA_DARI_PARAMETER");
});

test("zona WIB: hanya Asia/Jakarta dan Asia/Pontianak", () => { assert.deepEqual([...ZONA_WIB], ["Asia/Jakarta", "Asia/Pontianak"]); });

// ───────────── rencana impor ─────────────
const rencana = (rows, o = {}) => rencanaSpend(rows, { ctx: { accountId: AKUN }, ...o });
test("rencana: baru; Ad ID baru tanpa referensi = tidakTerpetakan; reimport identik = sama; nilai berubah = berubah; nama campaign berubah (ID sama) TIDAK menggandakan", () => {
  const r0 = rencana([b1({ baris: 2 }), b1({ baris: 3, adId: AD2, adSetId: SET2, campaignId: CAMP2, spend: "100" })], { referensi: new Map([[AD1, { adSetId: SET1, campaignId: CAMP1 }]]) });
  assert.equal(r0.baru.length, 2);
  assert.deepEqual([...r0.tidakTerpetakan], [AD2]);
  const lama = new Map([[`2026-10-16|${AKUN}|${AD1}`, { id: "x", rowChecksum: checksumBaris(validasiBarisSpend(b1()).row), spend: 150000 }]]);
  const r1 = rencana([b1({ campaignName: "Nama Baru Campaign" })], { ada: lama });
  assert.deepEqual([r1.baru.length, r1.sama.length, r1.berubah.length], [0, 1, 0], "nama = label: tidak mengubah checksum dan tidak menggandakan");
  const r2 = rencana([b1({ spend: "175000" })], { ada: lama });
  assert.deepEqual([r2.baru.length, r2.sama.length, r2.berubah.length], [0, 0, 1]);
});

test("rencana: duplikat dalam berkas identik = satu; bertentangan = keduanya ditolak; hierarki beda dari referensi/spend tersimpan = konflik", () => {
  assert.equal(rencana([b1({ baris: 2 }), b1({ baris: 3 })]).baru.length, 1);
  const bent = rencana([b1({ baris: 2 }), b1({ baris: 3, spend: "1" })]);
  assert.deepEqual([bent.baru.length, bent.ditolak.map((x) => x.alasan)], [0, ["DUPLIKAT_BERTENTANGAN", "DUPLIKAT_BERTENTANGAN"]]);
  const k1 = rencana([b1()], { referensi: new Map([[AD1, { adSetId: SET2, campaignId: CAMP2 }]]) });
  assert.equal(k1.konflik[0].alasan, "HIERARKI_BEDA_DARI_REFERENSI");
  const k2 = rencana([b1()], { hierarkiTersimpan: new Map([[AD1, { adSetId: SET2, campaignId: CAMP1 }]]) });
  assert.equal(k2.konflik[0].alasan, "HIERARKI_BEDA_DARI_SPEND_TERSIMPAN");
});

// ───────────── KPI biaya ─────────────
const baris = (o = {}) => ({
  kunci: CAMP1, level: "campaign", status: "MAPPED",
  lead: { unik: 10, spam: 1, bukanSpam: 9, leadSah: 9 }, pernahDitandaiProspek: { jumlah: 4 }, customerDenganOrder: 2, orderEligible: 3,
  closingUtama: { customerLunasTerbuktiLedger: 1 }, bookedValue: 6_000_000, uangBersihLedger: 3_000_000,
  kematangan: { hari7: { leadMatang: 9 }, hari30: { leadMatang: 9 }, hari60: { leadMatang: 9 } }, ...o,
});
const kes = (o = {}) => ({ tersedia: true, terakhirTanggal: "2026-10-16", tertinggalHari: 0, terlambat: false, ...o });
const kon = (o = {}) => ({ sumberTerhubung: true, kesegaran: kes(), target: normalisasiTarget(null), ...o });
const spend = (s, o = {}) => ({ spend: s, platformConversations: 25, impressions: 5000, linkClicks: 90, hariAdaSpend: 3, ...o });

test("rumus: CPL, cost per qualified, cost per customer order, CPA utama, booked ROAS, cash ROAS (spend Rp1.000.000)", () => {
  const b = hitungBiayaBaris({ baris: baris(), spend: spend(1_000_000), konteks: kon() });
  assert.deepEqual([b.cpl, b.costPerQualifiedLead, b.costPerCustomerOrder, b.cpa, b.bookedRoas, b.cashRoas], [100000, 250000, 500000, 1000000, 6, 3]);
  assert.equal(b.status, STATUS_BIAYA.SIAP_DIEVALUASI);
  assert.equal(b.platformConversations, 25);
  assert.notEqual(b.cpl, 1_000_000 / b.platformConversations, "CPL tidak memakai platform conversation");
  assert.match(b.platformConversationsCatatan, /BUKAN lead CRM/);
});

test("penyebut nol → null + BELUM_ADA_KONVERSI (bukan 0/Infinity); spend nol → ROAS null", () => {
  const b = hitungBiayaBaris({ baris: baris({ customerDenganOrder: 0, closingUtama: { customerLunasTerbuktiLedger: 0 }, pernahDitandaiProspek: { jumlah: 0 } }), spend: spend(500_000), konteks: kon() });
  assert.deepEqual([b.cpl, b.costPerQualifiedLead, b.costPerCustomerOrder, b.cpa], [50000, null, null, null]);
  assert.deepEqual([b.alasanNull.cpa, b.alasanNull.costPerQualifiedLead, b.alasanNull.costPerCustomerOrder], ["BELUM_ADA_KONVERSI", "BELUM_ADA_KONVERSI", "BELUM_ADA_KONVERSI"]);
  const nol = hitungBiayaBaris({ baris: baris(), spend: spend(0), konteks: kon() });
  assert.deepEqual([nol.cpl, nol.bookedRoas, nol.cashRoas, nol.alasanNull.bookedRoas], [0, null, null, "SPEND_NOL"]);
  for (const v of Object.values(b)) assert.ok(v === null || typeof v !== "number" || Number.isFinite(v));
});

test("status: BELUM_TERHUBUNG, MAPPING_BELUM_ADA, DATA_TERLAMBAT, TANPA_SPEND_DI_RENTANG, BELUM_ADA_KONVERSI, DATA_BELUM_MATANG, SIAP_DIEVALUASI — dan tidak ada nol palsu", () => {
  const st = (b, s, k) => hitungBiayaBaris({ baris: b, spend: s, konteks: k }).status;
  assert.equal(st(baris(), null, kon({ sumberTerhubung: false })), STATUS_BIAYA.BELUM_TERHUBUNG);
  const tidak = hitungBiayaBaris({ baris: baris(), spend: null, konteks: kon({ sumberTerhubung: false }) });
  assert.deepEqual([tidak.spend, tidak.cpl, tidak.cpa, tidak.bookedRoas, tidak.cashRoas], [null, null, null, null, null]);
  assert.equal(st(baris({ status: "UNMAPPED" }), spend(1), kon()), STATUS_BIAYA.MAPPING_BELUM_ADA);
  assert.equal(st(baris({ status: "UNKNOWN" }), null, kon()), STATUS_BIAYA.MAPPING_BELUM_ADA);
  assert.equal(st(baris(), spend(1), kon({ kesegaran: kes({ terlambat: true, tertinggalHari: 5 }) })), STATUS_BIAYA.DATA_TERLAMBAT);
  assert.equal(st(baris(), null, kon()), STATUS_BIAYA.TANPA_SPEND_DI_RENTANG);
  assert.equal(st(baris({ lead: { unik: 0, spam: 0, bukanSpam: 0, leadSah: 0 } }), spend(1000), kon()), STATUS_BIAYA.BELUM_ADA_KONVERSI);
  assert.equal(st(baris({ kematangan: { hari30: { leadMatang: 3 } } }), spend(1000), kon()), STATUS_BIAYA.DATA_BELUM_MATANG);
  assert.equal(st(baris(), spend(1000), kon()), STATUS_BIAYA.SIAP_DIEVALUASI);
  // umur kohort dari target mengubah jendela
  assert.equal(st(baris({ kematangan: { hari7: { leadMatang: 9 }, hari30: { leadMatang: 2 }, hari60: { leadMatang: 1 } } }), spend(1000), kon({ target: normalisasiTarget({ minCohortAgeDays: 7 }) })), STATUS_BIAYA.SIAP_DIEVALUASI);
});

test("kesegaran: terlambat hanya bila rentang meminta hari tanpa data dan tertinggal > 2 hari", () => {
  assert.equal(kesegaranSpend({ terakhirTanggal: "2026-10-10", hariIni: "2026-10-16", sampai: "2026-10-16", adaDataDiRentang: true }).terlambat, true);
  assert.equal(kesegaranSpend({ terakhirTanggal: "2026-10-10", hariIni: "2026-10-16", sampai: "2026-10-09", adaDataDiRentang: true }).terlambat, false);
  assert.equal(kesegaranSpend({ terakhirTanggal: "2026-10-15", hariIni: "2026-10-16", sampai: "2026-10-16" }).terlambat, false);
  assert.equal(kesegaranSpend({ terakhirTanggal: null, hariIni: "2026-10-16", sampai: "2026-10-16" }).tersedia, false);
});

test("evaluasi target: default semua null → tanpa status/warna; DATA_KURANG; BAIK; PERLU_REVIEW; PANTAU; tidak ada aksi otomatis", () => {
  assert.deepEqual(TARGET_KOSONG, normalisasiTarget(null));
  const b0 = hitungBiayaBaris({ baris: baris(), spend: spend(1_000_000), konteks: kon() });
  assert.equal(b0.evaluasi.status, null);
  assert.equal(b0.evaluasi.alasan, "TARGET_BELUM_DIATUR");
  const ev = (target, s = 1_000_000, o = {}) => hitungBiayaBaris({ baris: baris(o), spend: spend(s), konteks: kon({ target: normalisasiTarget(target) }) }).evaluasi;
  assert.equal(ev({ maxCpl: 150000 }).status, EVALUASI.BAIK);
  assert.equal(ev({ maxCpl: 50000 }).status, EVALUASI.PERLU_REVIEW);
  assert.deepEqual(ev({ maxCpl: 50000 }).pelanggaran.map((p) => p.metrik), ["cpl"]);
  assert.equal(ev({ maxCpl: 150000, minAcquisitionLeads: 50 }).status, EVALUASI.DATA_KURANG);
  assert.equal(ev({ maxCpl: 150000, minClosings: 5 }).status, EVALUASI.DATA_KURANG);
  assert.equal(ev({ maxCpl: 150000, maxCpaClosing: 100 }, 1_000_000, { closingUtama: { customerLunasTerbuktiLedger: 0 } }).status, EVALUASI.PANTAU);
  assert.equal(ev({ minBookedRoas: 8 }).status, EVALUASI.PERLU_REVIEW);
  assert.equal(ev({ maxSpamSharePercent: 5 }).status, EVALUASI.PERLU_REVIEW, "spam 10% > 5%");
  assert.equal(ev({ maxCpl: 150000 }, 1_000_000, { kematangan: { hari30: { leadMatang: 1 } } }).status, EVALUASI.DATA_KURANG, "belum matang → data kurang");
  assert.ok(!("aksi" in b0.evaluasi) && !("matikanIklan" in b0.evaluasi));
});

const laporanDasar = (grup, lvl = "campaign", filter = null) => ({
  rentangLead: { dari: "2026-10-16", sampai: "2026-10-16", level: lvl, filter }, grup, peringatan: [{ kode: "BIAYA_BELUM_TERHUBUNG", pesan: "x" }], rekonsiliasi: { ok: true, cek: [] }, definisi: [{ id: "biaya" }],
  jumlahTeratribusi: { leadUnik: 12, leadSah: 11, customerDenganOrder: 2, closingUtama: { customerLunasTerbuktiLedger: 1 }, bookedValue: 6_000_000, uangBersihLedger: 3_000_000 },
});
test("terapkanBiaya: Σ spend baris = total; spend-only → baris kosong tampil; Ad tanpa referensi → SPEND_UNMAPPED; UNKNOWN tanpa spend; ringkasan total", () => {
  const ref = new Map([[AD1, { adId: AD1, adSetId: SET1, campaignId: CAMP1, campaignName: "C1" }], [AD2, { adId: AD2, adSetId: SET2, campaignId: CAMP2, campaignName: "C2" }]]);
  const lap = laporanDasar([baris(), baris({ kunci: "UNKNOWN", status: "UNKNOWN", lead: { unik: 2, spam: 0, bukanSpam: 2, leadSah: 2 } })]);
  const spendPerAd = [{ adId: AD1, spend: 600000, hariAdaSpend: 1 }, { adId: AD2, spend: 400000, hariAdaSpend: 1 }, { adId: "52699999999999", spend: 50000, hariAdaSpend: 1 }];
  terapkanBiaya(lap, { spendPerAd, referensi: ref, kesegaran: kes(), target: normalisasiTarget(null), hariIni: "2026-10-16" });
  const per = Object.fromEntries(lap.grup.map((g) => [g.kunci, g.biaya]));
  assert.equal(per[CAMP1].spend, 600000);
  assert.equal(per[CAMP2].spend, 400000);
  assert.equal(per[CAMP2].status, STATUS_BIAYA.BELUM_ADA_KONVERSI, "campaign hanya-spend tetap tampil (lead 0)");
  assert.equal(per.UNMAPPED.spend, 50000);
  assert.equal(per.UNMAPPED.status, STATUS_BIAYA.MAPPING_BELUM_ADA);
  assert.equal(per.UNKNOWN.spend, null);
  assert.equal(lap.biaya.spendTotal, 1050000);
  assert.equal(lap.biaya.spendTidakTerpetakan, 50000);
  assert.equal(lap.rekonsiliasi.ok, true);
  assert.equal(lap.biaya.cpl, 87500, "total spend / acquisition lead teratribusi (12)");
  assert.ok(lap.peringatan.some((w) => w.kode === "SPEND_UNMAPPED"));
  assert.ok(!lap.peringatan.some((w) => w.kode === "BIAYA_BELUM_TERHUBUNG"));
  assert.equal(lap.biaya.roas, null);
});
test("terapkanBiaya: level ad/adset sama totalnya; drilldown hanya Ad cocok filter; tanpa spend sama sekali = BELUM_TERHUBUNG, semua null", () => {
  const ref = new Map([[AD1, { adId: AD1, adSetId: SET1, campaignId: CAMP1 }], [AD2, { adId: AD2, adSetId: SET2, campaignId: CAMP2 }]]);
  const sp = [{ adId: AD1, spend: 300, hariAdaSpend: 1 }, { adId: AD2, spend: 200, hariAdaSpend: 1 }];
  const tot = (lvl) => terapkanBiaya(laporanDasar([], lvl), { spendPerAd: sp, referensi: ref, kesegaran: kes(), target: normalisasiTarget(null) }).biaya.spendTotal;
  assert.deepEqual([tot("campaign"), tot("adset"), tot("ad")], [500, 500, 500]);
  const f = terapkanBiaya(laporanDasar([], "ad", { campaignId: CAMP1, adSetId: null }), { spendPerAd: [...sp, { adId: "52699999999999", spend: 9, hariAdaSpend: 1 }], referensi: ref, kesegaran: kes(), target: normalisasiTarget(null) });
  assert.equal(f.biaya.spendTotal, 300);
  assert.deepEqual(f.grup.map((g) => g.kunci), [AD1]);
  const kosong = terapkanBiaya(laporanDasar([baris()]), { spendPerAd: [], referensi: new Map(), kesegaran: kesegaranSpend({ terakhirTanggal: null, hariIni: "2026-10-16", sampai: "2026-10-16" }), target: normalisasiTarget(null) });
  assert.equal(kosong.biaya.status, STATUS_BIAYA.BELUM_TERHUBUNG);
  assert.deepEqual([kosong.biaya.spend, kosong.biaya.cpl, kosong.biaya.cpa, kosong.biaya.bookedRoas, kosong.biaya.roas], [null, null, null, null, null]);
  assert.equal(kosong.grup[0].biaya.spend, null);
  assert.ok(kosong.peringatan.some((w) => w.kode === "BIAYA_BELUM_TERHUBUNG"));
});
test("barisKosong memiliki bentuk lengkap (UI aman) dan nol", () => {
  const g = barisKosong({ level: "campaign", kunci: CAMP1, ref: null });
  assert.deepEqual([g.lead.unik, g.customerDenganOrder, g.closingUtama.customerLunasTerbuktiLedger, g.bookedValue, g.uangBersihLedger], [0, 0, 0, 0, 0]);
});

// ───────────── target + rentang ─────────────
test("validasi target: null boleh, negatif/bukan angka/kunci asing/pct > 100/int pecahan ditolak", () => {
  assert.deepEqual(validasiTarget({ maxCpl: 120000.456, minClosings: 3, maxSpamSharePercent: null }).data, { maxCpl: 120000.46, minClosings: 3, maxSpamSharePercent: null });
  for (const bad of [{ maxCpl: -1 }, { maxCpl: "abc" }, { aksi: 1 }, { maxSpamSharePercent: 101 }, { minClosings: 1.5 }, {}, { maxCpl: 1e13 }]) assert.ok(validasiTarget(bad).galat, JSON.stringify(bad));
});
test("rentang /spend: bawaan 7 hari WIB; maks 93 hari; format ketat", () => {
  const r = rentangSpend({}, new Date("2026-10-16T18:00:00Z"));
  assert.deepEqual(r, { dari: "2026-10-11", sampai: "2026-10-17" }, "18:00Z = 01:00 WIB 17 Okt");
  assert.equal(rentangSpend({ dari: "2026-01-01", sampai: "2026-10-16" }), null);
  assert.equal(rentangSpend({ dari: "x", sampai: "2026-10-16" }), null);
  assert.equal(rentangSpend({ dari: "2026-10-17", sampai: "2026-10-16" }), null);
});

// ───────────── monitoring ─────────────
const snap = (o = {}) => ({
  waha: { terjangkau: true, kode: null, sesi: [{ nama: "CS-1", status: "WORKING" }, { nama: "CS-2", status: "WORKING" }] },
  inbound: { per15Menit: 10, perJam: 40, jendelaSepi: 20, menitSejakTerakhir: 2, basisPer30Menit: 18 },
  touch: { gagal: 0, gagalPulih: 0, tertunda: 0, usiaTertundaTertuaDetik: 0, unmapped: 0, adIdUnmapped: 0, duplikat: 0, ctwa7Hari: 100, unknownPersen: 2, coveragePemetaanPersen: 100 },
  capture: { ctwaValidTanpaTouch: 0, ctwaValidTercatat: 5, touchCtwaDalamJendela: 5 },
  spend: { terakhirTanggal: null, tertinggalHari: null }, ...o,
});
const adaLevel = (daftar, key) => daftar.find((x) => x.key === key).level;
test("alarm: kondisi sehat → semua OK, level 0", () => { const d = evaluasiAlarm(snap()); assert.ok(d.every((x) => x.level === "OK")); assert.equal(levelGabungan(d), 0); });
test("alarm: sepuluh kondisi awal", () => {
  assert.equal(adaLevel(evaluasiAlarm(snap({ waha: { terjangkau: true, sesi: [{ nama: "CS-1", status: "FAILED" }, { nama: "CS-2", status: "WORKING" }] } })), "waha_session"), "CRIT");
  assert.equal(adaLevel(evaluasiAlarm(snap({ waha: { terjangkau: false, kode: "TIMEOUT", sesi: [] } })), "waha_session"), "CRIT");
  assert.equal(adaLevel(evaluasiAlarm(snap({ inbound: { jendelaSepi: 0, basisPer30Menit: 12, menitSejakTerakhir: 41 } })), "inbound_sepi"), "WARN");
  assert.equal(adaLevel(evaluasiAlarm(snap({ inbound: { jendelaSepi: 0, basisPer30Menit: 0.4, menitSejakTerakhir: 400 } })), "inbound_sepi"), "OK", "malam hari: basis rendah → tanpa alarm palsu");
  const t = (o) => snap({ touch: { ...snap().touch, ...o } });
  assert.equal(adaLevel(evaluasiAlarm(t({ gagal: 1 })), "touch_gagal"), "CRIT");
  assert.equal(adaLevel(evaluasiAlarm(t({ gagalPulih: 1 })), "touch_gagal_pulih"), "CRIT");
  assert.equal(adaLevel(evaluasiAlarm(t({ tertunda: 2, usiaTertundaTertuaDetik: 601 })), "touch_tertunda"), "CRIT");
  assert.equal(adaLevel(evaluasiAlarm(t({ tertunda: 2, usiaTertundaTertuaDetik: 120 })), "touch_tertunda"), "OK");
  assert.equal(adaLevel(evaluasiAlarm(t({ unmapped: 3, adIdUnmapped: 1 })), "ad_unmapped"), "WARN");
  assert.equal(adaLevel(evaluasiAlarm(t({ duplikat: 1 })), "touch_duplikat"), "CRIT");
  assert.equal(adaLevel(evaluasiAlarm(snap({ capture: { ctwaValidTanpaTouch: 2, ctwaValidTercatat: 7, touchCtwaDalamJendela: 5 } })), "ctwa_tanpa_touch"), "CRIT");
  assert.equal(adaLevel(evaluasiAlarm(t({ unknownPersen: 12 })), "unknown_tinggi"), "WARN");
  assert.equal(adaLevel(evaluasiAlarm(t({ unknownPersen: 50, ctwa7Hari: 10 })), "unknown_tinggi"), "OK", "sampel < 30: belum dinilai");
  assert.equal(adaLevel(evaluasiAlarm(t({ coveragePemetaanPersen: 90 })), "coverage_pemetaan"), "WARN");
  assert.equal(adaLevel(evaluasiAlarm(t({ coveragePemetaanPersen: 90, ctwa7Hari: 29 })), "coverage_pemetaan"), "OK");
  assert.equal(levelGabungan(evaluasiAlarm(t({ unmapped: 1, adIdUnmapped: 1 }))), 1);
  assert.equal(levelGabungan(evaluasiAlarm(t({ gagal: 1, unmapped: 1, adIdUnmapped: 1 }))), 2);
  assert.equal(adaLevel(evaluasiAlarm(snap({ spend: { terakhirTanggal: "2026-10-10", tertinggalHari: 6 } })), "spend_terlambat"), "WARN");
});
test("alarm: tidak ada nomor/JID/chat/clid pada keluaran evaluasi", () => {
  const teks = JSON.stringify(evaluasiAlarm(snap({ touch: { ...snap().touch, gagal: 1, unmapped: 2, adIdUnmapped: 1 } })));
  assert.doesNotMatch(teks, /\b62\d{9,13}\b|@c\.us|@lid|ctwa_clid|ctwaClid|payload/i);
});
test("notifikasi: ALERT sekali, tidak berulang sebelum cooldown, ULANG sesudah cooldown, PULIH sekali; kondisi OK yang tak pernah bermasalah diam", () => {
  const t0 = new Date("2026-10-16T10:00:00Z");
  const buruk = [{ key: "touch_gagal", level: "CRIT", pesan: "1 gagal" }, { key: "ad_unmapped", level: "OK", pesan: "ok" }];
  const r0 = rencanaNotifikasi(buruk, new Map(), t0);
  assert.deepEqual(r0.notifikasi.map((n) => `${n.jenis}:${n.key}`), ["ALERT:touch_gagal"]);
  const r1 = rencanaNotifikasi(buruk, r0.stateBaru, new Date(t0.getTime() + 5 * 60_000));
  assert.equal(r1.notifikasi.length, 0, "cek tiap menit tidak mengulang alarm");
  const r2 = rencanaNotifikasi(buruk, r1.stateBaru, new Date(t0.getTime() + 61 * 60_000));
  assert.deepEqual(r2.notifikasi.map((n) => n.jenis), ["ULANG"]);
  const pulih = rencanaNotifikasi([{ key: "touch_gagal", level: "OK", pesan: "ok" }, buruk[1]], r2.stateBaru, new Date(t0.getTime() + 70 * 60_000));
  assert.deepEqual(pulih.notifikasi.map((n) => `${n.jenis}:${n.key}`), ["PULIH:touch_gagal"]);
  const lagi = rencanaNotifikasi([{ key: "touch_gagal", level: "OK", pesan: "ok" }], pulih.stateBaru, new Date(t0.getTime() + 80 * 60_000));
  assert.equal(lagi.notifikasi.length, 0, "PULIH hanya sekali");
  const naik = rencanaNotifikasi([{ key: "x", level: "CRIT", pesan: "p" }], new Map([["x", { status: "WARN", since: t0, lastNotifiedAt: t0 }]]), new Date(t0.getTime() + 60_000));
  assert.deepEqual(naik.notifikasi.map((n) => n.jenis), ["ALERT"], "WARN → CRIT segera diberitahukan walau cooldown");
  assert.equal(CFG_BAWAAN.cooldownMenit, 60);
});

// ───────────── adapter Meta (fetch dipalsukan; tidak pernah memanggil jaringan) ─────────────
const respons = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fakeMeta = (peta) => { const panggilan = []; const fn = async (url, init) => { panggilan.push({ url, method: init?.method, auth: init?.headers?.Authorization }); for (const [pola, balas] of peta) if (url.includes(pola)) return typeof balas === "function" ? balas(url) : respons(200, balas); return respons(404, {}); }; fn.panggilan = panggilan; return fn; };
const ENV = { SPEND_SYNC_ENABLED: "true", META_ADS_ACCESS_TOKEN: "TOKEN-RAHASIA-UJI", META_ADS_ACCOUNT_ID: `act_${AKUN}` };
const tanpaTidur = async () => {};

test("adapter: bawaan MATI dan tanpa kredensial tidak memanggil jaringan", async () => {
  const f = fakeMeta([]);
  const k = await periksaKesiapan({ env: {}, fetchFn: f });
  assert.equal(k.siap, false);
  assert.equal(f.panggilan.length, 0);
  assert.ok(k.alasan.some((a) => /SPEND_SYNC_ENABLED/.test(a)) && k.alasan.some((a) => /META_ADS_ACCESS_TOKEN/.test(a)));
  assert.equal((await periksaKesiapan({ env: { ...ENV, SPEND_SYNC_ENABLED: "1" }, fetchFn: f })).siap, false);
});
test("adapter: token tanpa ads_read ditolak (scope harus terbukti); zona/mata uang salah ditolak; semua panggilan GET dengan token di header", async () => {
  const tanpaAds = fakeMeta([["/me/permissions", { data: [{ permission: "business_management", status: "granted" }] }], ["/act_", { timezone_name: "Asia/Jakarta", currency: "IDR" }]]);
  const k1 = await periksaKesiapan({ env: ENV, fetchFn: tanpaAds, tidurFn: tanpaTidur });
  assert.equal(k1.siap, false);
  assert.ok(k1.alasan.some((a) => /ads_read/.test(a)));
  const zona = fakeMeta([["/me/permissions", { data: [{ permission: "ads_read", status: "granted" }] }], ["/act_", { timezone_name: "America/Los_Angeles", currency: "USD" }]]);
  const k2 = await periksaKesiapan({ env: ENV, fetchFn: zona, tidurFn: tanpaTidur });
  assert.deepEqual([k2.siap, k2.alasan.some((a) => /WIB/.test(a)), k2.alasan.some((a) => /IDR/.test(a))], [false, true, true]);
  const ok = fakeMeta([["/me/permissions", { data: [{ permission: "ads_read", status: "granted" }] }], ["/act_", { timezone_name: "Asia/Jakarta", currency: "IDR" }]]);
  const k3 = await periksaKesiapan({ env: ENV, fetchFn: ok, tidurFn: tanpaTidur });
  assert.equal(k3.siap, true);
  assert.ok(ok.panggilan.every((p) => p.method === "GET" && p.auth === `Bearer ${ENV.META_ADS_ACCESS_TOKEN}` && !p.url.includes("TOKEN-RAHASIA")), "hanya GET; token tidak masuk URL");
  assert.doesNotMatch(JSON.stringify(k3), /TOKEN-RAHASIA/);
});
test("adapter: retry terbatas pada 429/5xx lalu menyerah; 4xx langsung gagal", async () => {
  let n = 0;
  await assert.rejects(ambilGet("https://x/y", "t", { fetchFn: async () => { n++; return respons(503, {}); }, tidurFn: tanpaTidur }), /3 percobaan/);
  assert.equal(n, 3);
  let m = 0;
  await assert.rejects(ambilGet("https://x/y", "t", { fetchFn: async () => { m++; return respons(400, {}); }, tidurFn: tanpaTidur }), /Meta API 400/);
  assert.equal(m, 1);
  let k = 0;
  const j = await ambilGet("https://x/y", "t", { fetchFn: async () => (++k < 2 ? respons(429, {}) : respons(200, { a: 1 })), tidurFn: tanpaTidur });
  assert.deepEqual(j, { a: 1 });
});
test("adapter: insights → baris internal (percakapan platform dari action_type resmi; ID tetap string)", () => {
  const r = barisDariInsights([{ date_start: "2026-10-16", account_id: AKUN, campaign_id: CAMP1, adset_id: SET1, ad_id: AD1, spend: "150000", impressions: "100", reach: "90", inline_link_clicks: "7", account_currency: "IDR", actions: [{ action_type: "link_click", value: "7" }, { action_type: ACTION_PERCAKAPAN, value: "12" }] }]);
  assert.deepEqual([r[0].platformConversations, r[0].platformResultType, r[0].adId, r[0].linkClicks], ["12", ACTION_PERCAKAPAN, AD1, "7"]);
  assert.equal(validasiBarisSpend(r[0], { accountId: AKUN }).ok, true);
});
test("adapter: sinkronisasi tidak siap → tidak menyentuh DB; data kosong → KOSONG tanpa menulis/menghapus", async () => {
  const db = { $queryRaw: async () => { throw new Error("DB tidak boleh disentuh"); } };
  assert.equal((await sinkronkanSpendMeta(db, { env: {}, fetchFn: fakeMeta([]) })).status, "TIDAK_SIAP");
  const f = fakeMeta([["/me/permissions", { data: [{ permission: "ads_read", status: "granted" }] }], ["fields=timezone_name", { timezone_name: "Asia/Jakarta", currency: "IDR" }], ["/insights", { data: [] }]]);
  const h = await sinkronkanSpendMeta(db, { env: ENV, fetchFn: f, tidurFn: tanpaTidur, now: new Date("2026-10-16T05:00:00Z") });
  assert.equal(h.status, "KOSONG");
  assert.deepEqual(h.rentang, { dari: "2026-10-10", sampai: "2026-10-16" }, "rolling 7 hari");
  assert.ok(f.panggilan.every((p) => p.method === "GET"));
});
test("adapter: paginasi mengikuti paging.next sampai habis", async () => {
  let h = 0;
  const f = fakeMeta([["/me/permissions", { data: [{ permission: "ads_read", status: "granted" }] }], ["fields=timezone_name", { timezone_name: "Asia/Jakarta", currency: "IDR" }],
    ["/insights", (url) => { h++; return respons(200, h === 1 ? { data: [{ ad_id: AD1 }], paging: { next: "https://graph.facebook.com/v21.0/act_1/insights?after=2" } } : { data: [{ ad_id: AD2 }] }); }]]);
  const { tarikInsights } = await import("../src/services/attribution/spendSyncMeta.js");
  const d = await tarikInsights({ akun: AKUN, token: "t", dari: "2026-10-10", sampai: "2026-10-16", fetchFn: f, tidurFn: tanpaTidur });
  assert.deepEqual(d.map((x) => x.ad_id), [AD1, AD2]);
});

// ───────────── Fase 3.1: rentang sebelum/awal atribusi ─────────────
import { ketidaksebandingan, EVALUASI_TIDAK_SEBANDING } from "../src/services/attribution/biayaKpi.js";
test("ketidaksebandingan: sebelum hari awal atribusi, hari awal (parsial), sesudahnya; tanpa touch sama sekali = sebelum atribusi", () => {
  assert.equal(ketidaksebandingan({ dari: "2026-10-15", mulaiHari: "2026-10-16" }), "SEBELUM_ATRIBUSI");
  assert.equal(ketidaksebandingan({ dari: "2026-10-16", mulaiHari: "2026-10-16" }), "HARI_ATRIBUSI_PARSIAL");
  assert.equal(ketidaksebandingan({ dari: "2026-10-17", mulaiHari: "2026-10-16" }), null);
  assert.equal(ketidaksebandingan({ dari: "2026-10-17", mulaiHari: null }), "SEBELUM_ATRIBUSI");
});
test("sebelum atribusi: spend + konversasi platform tampil; CPL/CPA/ROAS null dengan alasan SEBELUM_ATRIBUSI; evaluasi TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI walau target diisi; lead 0 bukan 'belum ada konversi'", () => {
  const target = normalisasiTarget({ maxCpl: 1, minAcquisitionLeads: 1 });
  const b = hitungBiayaBaris({ baris: baris({ lead: { unik: 0, spam: 0, bukanSpam: 0, leadSah: 0 }, customerDenganOrder: 0, closingUtama: { customerLunasTerbuktiLedger: 0 }, pernahDitandaiProspek: { jumlah: 0 } }), spend: spend(468546, { platformConversations: 42 }), konteks: kon({ tidakSebanding: "SEBELUM_ATRIBUSI", target }) });
  assert.equal(b.status, "SEBELUM_ATRIBUSI");
  assert.deepEqual([b.spend, b.platformConversations], [468546, 42]);
  assert.deepEqual([b.cpl, b.costPerQualifiedLead, b.costPerCustomerOrder, b.cpa, b.bookedRoas, b.cashRoas], [null, null, null, null, null, null]);
  assert.ok(Object.values(b.alasanNull).every((a) => a === "SEBELUM_ATRIBUSI"));
  assert.equal(b.evaluasi.status, EVALUASI_TIDAK_SEBANDING.SEBELUM_ATRIBUSI);
  assert.equal(b.evaluasi.status, "TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI");
  assert.match(b.catatanPembanding, /BUKAN performa nol/);
  const p = hitungBiayaBaris({ baris: baris(), spend: spend(1000), konteks: kon({ tidakSebanding: "HARI_ATRIBUSI_PARSIAL" }) });
  assert.deepEqual([p.status, p.cpl, p.evaluasi.status], ["HARI_ATRIBUSI_PARSIAL", null, "TIDAK_DAPAT_DIEVALUASI_HARI_ATRIBUSI_PARSIAL"]);
  // sumber belum terhubung tetap BELUM_TERHUBUNG (tidak ada spend untuk dibandingkan)
  assert.equal(hitungBiayaBaris({ baris: baris(), spend: null, konteks: kon({ sumberTerhubung: false, tidakSebanding: "SEBELUM_ATRIBUSI" }) }).status, "BELUM_TERHUBUNG");
});
test("terapkanBiaya sebelum atribusi: peringatan, total tanpa CPL/CPA, rekonsiliasi spend tetap OK, baris Rp0 dengan konversasi platform diterima, reach tidak dijumlah", () => {
  const ref = new Map([[AD1, { adId: AD1, adSetId: SET1, campaignId: CAMP1 }], [AD2, { adId: AD2, adSetId: SET2, campaignId: CAMP2 }]]);
  const lap = laporanDasar([]);
  lap.rentangLead.dari = "2026-10-15"; lap.rentangLead.sampai = "2026-10-15";
  terapkanBiaya(lap, { spendPerAd: [{ adId: AD1, spend: 100, platformConversations: 3, hariAdaSpend: 1 }, { adId: AD2, spend: 0, platformConversations: 1, hariAdaSpend: 1 }], referensi: ref, kesegaran: kes(), target: normalisasiTarget(null), mulaiHari: "2026-10-16" });
  assert.ok(lap.peringatan.some((w) => w.kode === "BIAYA_SEBELUM_ATRIBUSI"));
  assert.equal(lap.biaya.status, "SEBELUM_ATRIBUSI");
  assert.deepEqual([lap.biaya.spendTotal, lap.biaya.cpl, lap.biaya.cpa, lap.biaya.bookedRoas, lap.biaya.evaluasi.status], [100, null, null, null, "TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI"]);
  const g2 = lap.grup.find((g) => g.kunci === CAMP2);
  assert.deepEqual([g2.biaya.spend, g2.biaya.platformConversations], [0, 1], "spend Rp0 dengan percakapan platform > 0 diterima apa adanya");
  assert.equal(lap.rekonsiliasi.ok, true);
  assert.ok(!JSON.stringify(lap).toLowerCase().includes("reach"), "laporan tidak menampilkan reach (non-additive)");
  const ok = laporanDasar([]); ok.rentangLead.dari = "2026-10-17"; ok.rentangLead.sampai = "2026-10-17";
  terapkanBiaya(ok, { spendPerAd: [{ adId: AD1, spend: 100, hariAdaSpend: 1 }], referensi: ref, kesegaran: kes(), target: normalisasiTarget(null), mulaiHari: "2026-10-16" });
  assert.ok(!ok.peringatan.some((w) => /ATRIBUSI/.test(w.kode)), "sesudah hari atribusi: sebanding");
});

import { WINDSOR_20261015, CONTROL_TOTAL, CONTROL_CAMPAIGN, csvWindsor } from "./fixtures/windsorSpend20261015.js";
test("dataset Windsor 15 Okt: Σ baris Ad = control total akun untuk spend/impressions/clicks/link clicks/percakapan/first reply/koneksi baru; reach TIDAK; per campaign cocok; CSV valid di importer", () => {
  const sum = (k) => WINDSOR_20261015.reduce((s, r) => s + r[k], 0);
  assert.deepEqual([sum("spend"), sum("impressions"), sum("clicks"), sum("link_clicks"), sum("conv"), sum("first_reply"), sum("new_conn")],
    [CONTROL_TOTAL.spend, CONTROL_TOTAL.impressions, CONTROL_TOTAL.clicks, CONTROL_TOTAL.link_clicks, CONTROL_TOTAL.conversation_started_7d, CONTROL_TOTAL.first_reply, CONTROL_TOTAL.new_messaging_connections]);
  assert.notEqual(sum("reach"), CONTROL_TOTAL.reach, "reach non-additive: Σ reach Ad (63725) ≠ reach akun (60020)");
  for (const [c, v] of Object.entries(CONTROL_CAMPAIGN)) {
    const r = WINDSOR_20261015.filter((x) => x.campaign_id === c);
    assert.deepEqual([r.reduce((s, x) => s + x.spend, 0), r.reduce((s, x) => s + x.impressions, 0), r.reduce((s, x) => s + x.link_clicks, 0), r.reduce((s, x) => s + x.conv, 0)], [v.spend, v.impressions, v.link_clicks, v.conversations], c);
  }
  const p = barisSpendDariCsv(csvWindsor());
  assert.equal(p.galat, null);
  const hasil = rencanaSpend(p.baris, { ctx: { accountId: "2081614415911241", mataUangKolom: p.mataUangKolom } });
  assert.deepEqual([hasil.baru.length, hasil.ditolak.length, hasil.konflik.length], [10, 0, 0]);
  const nol = hasil.baru.filter((r) => r.spend === 0);
  assert.deepEqual(nol.map((r) => r.platformConversations).sort(), [0, 1], "baris Rp0: satu dengan percakapan 1 diterima");
  assert.ok(hasil.baru.every((r) => r.currency === "IDR" && typeof r.adId === "string"));
});
