// Invarian laporan Marketing (scripts/lib/invarian-marketing-lengkap.mjs) — dipakai smoke pasca-switch dan rehearsal rilis "marketing-lengkap".
// Tes ini membuktikan (1) invarian LULUS pada laporan nyata hasil kode (fixture kaya), (2) setiap invarian PEKA: mutasi yang disengaja terdeteksi, (3) pembanding SQL mendeteksi selisih, (4) SQL independen memuat aturan inti.
// Murni, tanpa DB dan tanpa jaringan.
import test from "node:test";
import assert from "node:assert/strict";
import { hitungSumber, susunSumber } from "../src/services/attribution/sumber.js";
import { hitungCakupan } from "../src/services/attribution/biayaSumber.js";
import { periksaLaporan, banding, petaSql, SQL_BANDING, URUTAN_SUMBER } from "../../scripts/lib/invarian-marketing-lengkap.mjs";

const T0 = new Date("2026-11-02T03:00:00Z");
let n = 0;
const cust = (leadSource, o = {}) => ({ id: "c" + ++n, createdAt: T0, pipelineStage: "NEW", leadSource, isInternalStaff: false, staffUserId: null, transitions: [], ...o });
const tr = (...st) => st.map((toStage, i) => ({ toStage, createdAt: new Date(T0.getTime() + (i + 1) * 3600e3) }));
const ord = (customerId, o = {}) => ({ id: "o" + ++n, customerId, status: "PROCESSING", value: 1_000_000, tagihan: 1_000_000, paymentStatus: "BELUM_BAYAR", penjualanKaryawanId: null, ...o });
const param = { dari: "2026-11-01", sampai: "2026-11-04", hariIni: "2026-11-05", termasukHariBerjalan: false, bawaan: false };
const cak = (spend = null, entries = []) => ({ cakupan: hitungCakupan({ dari: "2026-11-01", sampai: "2026-11-04", hariIni: "2026-11-05", entries }), entries });
const buat = (customers, orders = []) => {
  const h = hitungSumber({ customers, orders, kontribusi: [], refunds: [] });
  return susunSumber({ parameter: param, hasil: h, biayaMeta: { status: "BELUM_TERHUBUNG", spend: null, cpa: null, cpl: null, bookedRoas: null, cashRoas: null, alasanNull: {} }, provenMeta: { akuisisiTerbukti: 0 },
    biayaSumber: new Map([["META", cak()], ["TIKTOK", cak()], ["GOOGLE", cak()], ["LAINNYA", cak()]]), asOf: "2026-11-05T01:00:00Z", hariIni: "2026-11-05" });
};
const fixture = () => {
  const c = [
    cust("META_ADS", { pipelineStage: "PROSPECT", transitions: tr("PROSPECT") }), cust("META_ADS", { pipelineStage: "TRANSACTION", transitions: tr("TRANSACTION") }),   // eksplisit vs lompat langsung
    cust("META_ADS", { pipelineStage: "SPAM" }), cust("META_ADS"), cust("TIKTOK_ADS", { pipelineStage: "PROSPECT", transitions: tr("PROSPECT", "TRANSACTION") }),
    cust("GOOGLE_ADS"), cust("GOOGLE_ADS", { pipelineStage: "SPAM" }), cust("WHATSAPP_DIRECT"), cust("OTHER", { pipelineStage: "REVIEWED", transitions: tr("REVIEWED") }), cust("INSTAGRAM"), cust("WEBSITE_ORGANIC"),
    cust("META_ADS", { isInternalStaff: true }),
  ];
  const o = [ord(c[0].id), ord(c[1].id, { paymentStatus: "LUNAS" }), ord(c[4].id)];
  return buat(c, o);
};
const gagal = (hasil) => hasil.filter((x) => !x.ok).map((x) => x.n);
const salin = (x) => JSON.parse(JSON.stringify(x));

test("invarian LULUS pada laporan nyata hasil kode (fixture kaya: eksplisit vs lompat, spam, internal, Google terpisah)", () => {
  const r = fixture(); const h = periksaLaporan(r);
  assert.ok(h.length >= 17, "jumlah pemeriksaan terlalu sedikit: " + h.length);
  assert.deepEqual(gagal(h), []);
  assert.equal(r.sumber.find((x) => x.id === "META").prospek.prospekEksplisit.jumlah, 1);          // hanya yang dipindah ke PROSPECT
  assert.equal(r.sumber.find((x) => x.id === "META").prospek.pernahProspekAtauLanjut.jumlah, 2);    // + lompat langsung
});

test("setiap invarian PEKA: mutasi yang disengaja terdeteksi (bukan lulus karena longgar)", () => {
  const dasar = fixture();
  const mut = (nama, f, harapan) => { const r = salin(dasar); f(r); const g = gagal(periksaLaporan(r)); assert.ok(g.some((x) => harapan.test(x)), `${nama}: tidak terdeteksi; gagal=${JSON.stringify(g)}`); };
  mut("sumber hilang (Google dilebur lagi)", (r) => { r.sumber = r.sumber.filter((x) => x.id !== "GOOGLE"); }, /delapan sumber/);
  mut("Lainnya memuat GOOGLE_ADS lagi", (r) => { r.sumber.find((x) => x.id === "LAINNYA").labelCrm.push("GOOGLE_ADS"); }, /Google Ads = sumber berbayar/);
  mut("total lead tidak sama dengan jumlah sumber", (r) => { r.total.lead += 1; }, /total\.lead/);
  mut("total ber-order tidak sama", (r) => { r.total.berOrder += 1; }, /total\.berOrder/);
  mut("lead ≠ spam + dikecualikan + sah", (r) => { r.sumber[0].spam += 1; }, /lead = spam/);
  mut("membayar > ber-order", (r) => { r.sumber[0].membayar = r.sumber[0].berOrder + 1; }, /ber-order ≤ lead/);
  mut("prospek eksplisit > atau-lanjut", (r) => { const p = r.sumber[0].prospek; p.prospekEksplisit.jumlah = p.pernahProspekAtauLanjut.jumlah + 1; }, /eksplisit ≤ prospek atau lanjut/);
  mut("selisih tidak konsisten", (r) => { r.sumber[0].prospek.selisihAtauLanjutMinusEksplisit += 1; }, /selisih/);
  mut("total prospek eksplisit salah", (r) => { r.total.prospek.prospekEksplisit += 1; }, /total prospek eksplisit/);
  mut("penyebut prospek ≠ total lead sah", (r) => { r.total.prospek.penyebut += 1; }, /total prospek eksplisit/);
  mut("biaya per prospek BOCOR saat biaya belum lengkap", (r) => { r.sumber[0].biaya.costPerProspekEksplisit = 100; }, /pengaman biaya/);
  mut("CPA bocor saat hari berjalan parsial", (r) => { const b = r.sumber[0].biaya; b.spendLengkap = true; b.sementara = true; b.cpa = 5; }, /pengaman biaya/);
  mut("biaya per prospek ≠ spend ÷ eksplisit", (r) => { const s = r.sumber[0]; s.biaya.spendLengkap = true; s.biaya.sementara = false; s.biaya.spend = 1000; s.biaya.costPerProspekEksplisit = 900; }, /biaya per prospek eksplisit = spend/);
  mut("kunci biaya per prospek hilang tanpa alasan", (r) => { const s = r.sumber[3]; delete s.biaya.costPerProspekEksplisit; delete s.biaya.alasanNull.costPerProspekEksplisit; }, /bila kosong ada alasan/);
  mut("total berbayar bocor CPA padahal belum lengkap", (r) => { r.total.berbayar.lengkap = false; r.total.berbayar.cpa = 7; }, /total berbayar kosong/);
  mut("nilai order total ≠ jumlah sumber", (r) => { r.total.nilaiOrderSaatIni += 5000; }, /total nilai order/);
  mut("uang bersih bukan ledger − refund", (r) => { r.sumber[0].uang.uangBersih += 10; }, /uang bersih = uang ledger/);
  mut("total uang bersih tidak sama dengan jumlah sumber", (r) => { r.total.uangBersih += 10; }, /uang bersih = uang ledger/);
});

test("pembanding SQL: sama → lulus; selisih satu angka mana pun (lead/spam/sah/eksplisit/atau-lanjut) → terdeteksi; urutan delapan sumber tetap", () => {
  const r = fixture();
  const sql = Object.fromEntries(r.sumber.map((x) => [x.id, { lead: x.lead, spam: x.spam, leadSah: x.leadSah, eksplisit: x.prospek.prospekEksplisit.jumlah, atauLanjut: x.prospek.pernahProspekAtauLanjut.jumlah }]));
  assert.deepEqual(gagal(banding(r, sql)), []);
  for (const k of ["lead", "spam", "leadSah", "eksplisit", "atauLanjut"]) { const s2 = salin(sql); s2.META[k] += 1; assert.equal(gagal(banding(r, s2)).length, 1, k); }
  const s3 = salin(sql); delete s3.GOOGLE; r.sumber.find((x) => x.id === "GOOGLE").lead = 1; assert.equal(gagal(banding(r, s3)).length, 1, "sumber tak ada di SQL = 0");
  assert.deepEqual(URUTAN_SUMBER, ["META", "TIKTOK", "GOOGLE", "WHATSAPP", "INSTAGRAM", "WEBSITE", "DIMULAI_SALES", "LAINNYA"]);
  const peta = petaSql([{ sid: "META", lead: "3", spam: "1", lead_sah: "2", eksplisit: "1", atau_lanjut: "2" }]);
  assert.deepEqual(peta.META, { lead: 3, spam: 1, leadSah: 2, eksplisit: 1, atauLanjut: 2 }); assert.deepEqual(peta.GOOGLE, { lead: 0, spam: 0, leadSah: 0, eksplisit: 0, atauLanjut: 0 });
});

test("SQL independen memuat aturan inti: Google terpisah, B2B/penjualan karyawan bukan lead, spam/internal/profil karyawan bukan lead sah, prospek dari transisi, hanya baca (tanpa kata tulis)", () => {
  for (const s of ["'GOOGLE_ADS'", "'B2B_DIRECT','PENJUALAN_KARYAWAN'", "is_internal_staff", "staff_user_id IS NOT NULL", "pipeline_transitions", "to_stage::text='PROSPECT'", "$1::timestamp", "$2::timestamp"]) assert.ok(SQL_BANDING.includes(s), "tidak memuat: " + s);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i.test(SQL_BANDING), "SQL pembanding tidak boleh memuat kata tulis");
});
