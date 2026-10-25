// Performa Akuisisi per sumber (murni, tanpa DB): pemetaan label, dedupe customer, overlap DP/lunas vs kategori eksklusif, pembayaran batal/refund, sorotan dari data, sampel kecil, biaya null.
import test from "node:test";
import assert from "node:assert/strict";
import { hitungSumber, susunSumber, sorotan, sumberDariLabel, AMBANG_SAMPEL, SUMBER } from "../src/services/attribution/sumber.js";

const T0 = new Date("2026-10-05T03:00:00Z");
let n = 0;
const cust = (leadSource, o = {}) => ({ id: "c" + ++n, createdAt: T0, pipelineStage: "NEW", leadSource, isInternalStaff: false, staffUserId: null, ...o });
const ord = (customerId, o = {}) => ({ id: "o" + ++n, customerId, status: "PROCESSING", value: 1_000_000, tagihan: 1_000_000, penjualanKaryawanId: null, ...o });
const bayar = (orderId, amount, at = T0) => ({ id: "p" + ++n, orderId, amount, createdAt: at });
const param = { dari: "2026-10-01", sampai: "2026-10-25", hariIni: "2026-10-26", termasukHariBerjalan: false, bawaan: false };
const hitung = (customers, orders = [], kontribusi = [], refunds = []) => hitungSumber({ customers, orders, kontribusi, refunds });
const g = (h, id) => h.per.get(id);

test("pemetaan label CRM → sumber; B2B/penjualan karyawan bukan lead pemasaran; label tak dikenal/null → Lainnya", () => {
  assert.deepEqual(["META_ADS", "TIKTOK_ADS", "WHATSAPP_DIRECT", "INSTAGRAM", "WEBSITE_ORGANIC", "WEBSITE", "OTHER", "GOOGLE_ADS", "REFERRAL", null, "ZZZ"].map(sumberDariLabel), ["META", "TIKTOK", "WHATSAPP", "INSTAGRAM", "WEBSITE", "WEBSITE", "LAINNYA", "LAINNYA", "LAINNYA", "LAINNYA", "LAINNYA"]);
  assert.equal(sumberDariLabel("B2B_DIRECT"), null); assert.equal(sumberDariLabel("PENJUALAN_KARYAWAN"), null);
  const h = hitung([cust("B2B_DIRECT"), cust("PENJUALAN_KARYAWAN"), cust("META_ADS")]);
  assert.equal(h.bukanLeadPemasaran, 2); assert.equal(g(h, "META").lead, 1);
});

test("lead/spam/lead sah per sumber; internal/profil karyawan dikeluarkan dari lead sah tetapi tetap lead unik", () => {
  const h = hitung([cust("META_ADS"), cust("META_ADS", { pipelineStage: "SPAM" }), cust("META_ADS", { isInternalStaff: true }), cust("TIKTOK_ADS")]);
  assert.deepEqual([g(h, "META").lead, g(h, "META").spam, g(h, "META").dikecualianLain, g(h, "META").leadSah], [3, 1, 1, 1]); assert.equal(g(h, "TIKTOK").leadSah, 1);
});

test("dedupe customer + overlap: customer dengan 2 order dihitung SEKALI; DP→lunas = pernahDp 1 DAN lunas 1 (overlap) tetapi kategori eksklusif hanya 'lunas'; jumlah eksklusif = ber-order", () => {
  const a = cust("META_ADS"), b = cust("META_ADS"), c = cust("META_ADS"), d = cust("META_ADS");
  const oa1 = ord(a.id), oa2 = ord(a.id), ob = ord(b.id), oc = ord(c.id);
  const kontribusi = [bayar(oa1.id, 300_000, new Date("2026-10-05T04:00:00Z")), bayar(oa1.id, 700_000, new Date("2026-10-08T04:00:00Z")), bayar(oa2.id, 1_000_000), bayar(ob.id, 400_000)];
  const h = hitung([a, b, c, d], [oa1, oa2, ob, oc], kontribusi); const m = g(h, "META");
  assert.deepEqual([m.berOrder, m.membayar, m.lunas, m.pernahDp, m.dpSaatIni], [3, 2, 1, 2, 1]);
  assert.deepEqual(m.eksklusif, { belumBayar: 1, dpSaatIni: 1, lunas: 1, tidakDiketahui: 0 }); assert.equal(m.eksklusif.belumBayar + m.eksklusif.dpSaatIni + m.eksklusif.lunas + m.eksklusif.tidakDiketahui, m.berOrder);
  assert.equal(m.orderEligible, 4); assert.equal(m.orderLunas, 2); assert.equal(m.orderBerLedger, 3);
});

test("order batal/pending/penjualan karyawan tidak dihitung ber-order; spam dengan order tidak dihitung; refund disetujui menurunkan lunas; refund DITOLAK diabaikan", () => {
  const a = cust("TIKTOK_ADS"), b = cust("TIKTOK_ADS"), s = cust("TIKTOK_ADS", { pipelineStage: "SPAM" }), e = cust("TIKTOK_ADS"), r = cust("TIKTOK_ADS");
  const oBatal = ord(a.id, { status: "CANCELLED" }), oPend = ord(b.id, { status: "PENDING" }), oSpam = ord(s.id), oKar = ord(e.id, { penjualanKaryawanId: "u1" }), oR = ord(r.id);
  const kontribusi = [bayar(oBatal.id, 1_000_000), bayar(oSpam.id, 1_000_000), bayar(oR.id, 1_000_000)];
  const refunds = [{ orderId: oR.id, amount: 400_000, status: "DISETUJUI", approvedAt: T0 }, { orderId: oR.id, amount: 999, status: "DITOLAK", approvedAt: T0 }];
  const h = hitung([a, b, s, e, r], [oBatal, oPend, oSpam, oKar, oR], kontribusi, refunds); const t = g(h, "TIKTOK");
  assert.deepEqual([t.berOrder, t.lunas, t.membayar, t.refund, t.uangBersih], [1, 0, 1, 400_000, 600_000], "satu-satunya order eligible punya refund → bukan lunas");
});

test("konversi: pembilang & penyebut ditampilkan; sampel kecil bila lead sah < ambang; biaya non-Meta null TIDAK_ADA_SUMBER_SPEND; Meta null bila biaya belum dihitung", () => {
  const cs = Array.from({ length: AMBANG_SAMPEL }, () => cust("WHATSAPP_DIRECT")); const kecil = [cust("INSTAGRAM"), cust("INSTAGRAM")];
  const os = [ord(cs[0].id), ord(cs[1].id), ord(kecil[0].id)];
  const r = susunSumber({ parameter: param, hasil: hitung([...cs, ...kecil], os), biayaMeta: null, asOf: new Date("2026-10-26T00:00:00Z"), hariIni: "2026-10-26" });
  const wa = r.sumber.find((x) => x.id === "WHATSAPP"), ig = r.sumber.find((x) => x.id === "INSTAGRAM"), meta = r.sumber.find((x) => x.id === "META");
  assert.equal(wa.sampelKecil, false); assert.deepEqual(wa.konversiOrder, { nilai: 6.67, pembilang: 2, penyebut: 30, penyebutJenis: "TOTAL_LEAD_TERMASUK_SPAM" }); assert.equal(ig.sampelKecil, true);
  assert.deepEqual([wa.biaya.cpa, wa.biaya.cashRoas, wa.biaya.status], [null, null, "TIDAK_ADA_SUMBER_SPEND"]); assert.equal(meta.biaya.status, "BELUM_DIHITUNG"); assert.equal(meta.biaya.cpa, null);
  assert.equal(meta.konversiOrder.nilai, null, "tanpa lead sah → null, bukan 0%"); assert.equal(meta.konversiOrder.penyebut, 0);
  assert.ok(r.peringatan.some((p) => p.kode === "SUMBER_LABEL_CRM")); assert.ok(r.total.lead === 32);
});

test("sorotan dihitung dari data, bukan hardcode: konversi tertinggi hanya di antara sumber ber-sampel layak; mengikuti perubahan data", () => {
  const mk = (id, lead, leadSah, berOrder, lunas = 0, kecil = lead < AMBANG_SAMPEL) => ({ id, lead, leadSah, berOrder, lunas, sampelKecil: kecil, konversiOrder: { nilai: lead ? Math.round((berOrder / lead) * 10000) / 100 : null, pembilang: berOrder, penyebut: lead } });
  const a = [mk("META", 2000, 1500, 30, 20), mk("TIKTOK", 300, 250, 20, 8), mk("LAIN", 15, 12, 6, 6)];
  const s1 = sorotan(a); const by = (x, id) => x.find((y) => y.id === id);
  assert.equal(by(s1, "VOLUME").sumberId, "META"); assert.equal(by(s1, "KONVERSI_ORDER").sumberId, "TIKTOK", "LAIN 50% diabaikan: sampel kecil");
  const b = a.map((x) => (x.id === "TIKTOK" ? mk("TIKTOK", 300, 250, 2, 8) : x)); assert.equal(by(sorotan(b), "KONVERSI_ORDER").sumberId, "META", "pemenang berpindah mengikuti data");
  assert.equal(by(sorotan([mk("A", 5, 5, 0)]), "KONVERSI_ORDER"), undefined, "tanpa sampel layak → tidak ada sorotan konversi");
});

test("peringatan: hari berjalan, ledger tidak lengkap (batas bawah), spend belum lengkap (dari status biaya Meta), rentang sebelum atribusi", () => {
  const a = cust("META_ADS"), o = ord(a.id);
  const r = susunSumber({ parameter: { ...param, termasukHariBerjalan: true }, hasil: hitung([a], [o, ord(a.id)], [bayar(o.id, 1_000_000)]), biayaMeta: { status: "SPEND_TIDAK_LENGKAP", spend: 100, cpa: null, cpl: null, bookedRoas: null, cashRoas: null, alasanNull: { cpa: "SPEND_TIDAK_LENGKAP" } }, provenMeta: { akuisisiTerbukti: 1 }, asOf: "x", mulaiHari: "2026-10-16", hariIni: "2026-10-26" });
  const k = r.peringatan.map((p) => p.kode);
  for (const w of ["HARI_BERJALAN", "LEDGER_TIDAK_LENGKAP", "SPEND_BELUM_LENGKAP", "RENTANG_SEBELUM_ATRIBUSI"]) assert.ok(k.includes(w), w);
  const meta = r.sumber[0]; assert.equal(meta.biaya.cpa, null); assert.equal(meta.biaya.alasanNull.cpa, "SPEND_TIDAK_LENGKAP"); assert.equal(meta.biaya.spend, 100);
  assert.equal(r.status.ledger.persen, 50);
  assert.equal(SUMBER.length, 6); assert.ok(r.definisi.overlap.includes("tidak eksklusif"));
});

test("konversi UTAMA = ber-order ÷ TOTAL lead (termasuk spam); konversi non-spam terpisah berlabel; spam menurunkan konversi utama; sorotan menyebut denominator & jenis & ambang sementara", () => {
  const cs = [cust("TIKTOK_ADS"), cust("TIKTOK_ADS"), cust("TIKTOK_ADS", { pipelineStage: "SPAM" }), cust("TIKTOK_ADS", { pipelineStage: "SPAM" })]; const os = [ord(cs[0].id)];
  const h = hitung([...cs, ...Array.from({ length: 26 }, () => cust("TIKTOK_ADS"))], [...os]);
  const r = susunSumber({ parameter: param, hasil: h, biayaMeta: null, asOf: "x", hariIni: "2026-10-26" }); const t = r.sumber.find((x) => x.id === "TIKTOK");
  assert.deepEqual([t.lead, t.spam, t.leadSah], [30, 2, 28]);
  assert.deepEqual(t.konversiOrder, { nilai: 3.33, pembilang: 1, penyebut: 30, penyebutJenis: "TOTAL_LEAD_TERMASUK_SPAM" });
  assert.deepEqual(t.konversiOrderNonSpam, { nilai: 3.57, pembilang: 1, penyebut: 28, penyebutJenis: "LEAD_SAH_NON_SPAM" });
  assert.equal(t.sampelKecil, false, "30 lead = ambang terpenuhi (sampel kecil bila < 30)"); assert.equal(t.sampelKecilNonSpam, true, "28 lead sah < 30");
  const so = r.sorotan.find((x) => x.id === "KONVERSI_ORDER"); assert.equal(so.sumberId, "TIKTOK"); assert.deepEqual([so.pembilang, so.penyebut], [1, 30]);
  assert.match(so.jenisTeks, /total lead \(termasuk spam\)/); assert.match(so.catatan, /aturan tampilan sementara/); assert.match(so.catatan, /bukan uji signifikansi/); assert.match(so.catatan, /bukan pemenang pasti/);
  assert.match(r.definisi.ambang, /bukan uji signifikansi statistik/); assert.ok(r.batasan.some((b) => /tidak ada klaim signifikansi statistik/.test(b)));
});

test("pengecualian eksplisit: staf internal & profil karyawan per sumber; B2B/penjualan karyawan dikeluarkan dari semua sumber dengan rincian per label", () => {
  const h = hitung([cust("META_ADS"), cust("META_ADS", { isInternalStaff: true }), cust("META_ADS", { staffUserId: "u1" }), cust("META_ADS", { pipelineStage: "SPAM" }), cust("B2B_DIRECT"), cust("B2B_DIRECT"), cust("PENJUALAN_KARYAWAN")]);
  const r = susunSumber({ parameter: param, hasil: h, biayaMeta: null, asOf: "x", hariIni: "2026-10-26" }); const m = r.sumber[0];
  assert.deepEqual([m.lead, m.leadSah, m.pengecualian.spam, m.pengecualian.internalStaff, m.pengecualian.profilKaryawan, m.pengecualian.jumlahDikeluarkanDariLeadSah], [4, 1, 1, 1, 1, 3]);
  assert.deepEqual(r.pengecualianTotal.dikeluarkanDariSemuaSumber, { total: 3, perLabel: { B2B_DIRECT: 2, PENJUALAN_KARYAWAN: 1 }, catatan: r.pengecualianTotal.dikeluarkanDariSemuaSumber.catatan });
  assert.deepEqual([r.pengecualianTotal.spam, r.pengecualianTotal.internalStaff, r.pengecualianTotal.profilKaryawan], [1, 1, 1]);
});

test("UNKNOWN pada kategori eksklusif sumber: LUNAS/DP tersimpan tanpa pembayaran di ledger = TIDAK DIKETAHUI (bukan belum bayar); jumlah = ber-order", () => {
  const a = cust("TIKTOK_ADS"), b = cust("TIKTOK_ADS"), c = cust("TIKTOK_ADS"), d = cust("TIKTOK_ADS");
  const oa = ord(a.id, { paymentStatus: "LUNAS" }), ob = ord(b.id, { paymentStatus: "DP" }), oc = ord(c.id, { paymentStatus: "BELUM_BAYAR" }), od = ord(d.id, { paymentStatus: "LUNAS" });
  const h = hitung([a, b, c, d], [oa, ob, oc, od], [bayar(od.id, 1_000_000)]); const m = g(h, "TIKTOK");
  assert.deepEqual(m.eksklusif, { belumBayar: 1, dpSaatIni: 0, lunas: 1, tidakDiketahui: 2 }); assert.equal(m.eksklusif.belumBayar + m.eksklusif.dpSaatIni + m.eksklusif.lunas + m.eksklusif.tidakDiketahui, m.berOrder);
  const r = susunSumber({ parameter: param, hasil: h, biayaMeta: null, asOf: "x", hariIni: "2026-10-26" }); assert.equal(r.sumber.find((x) => x.id === "TIKTOK").kategoriEksklusif.jumlah, 4);
});

test("konsistensi persentase: setiap konversi (utama & non-spam, order & lunas) = pembilang ÷ penyebut × 100 dibulatkan 2 desimal; penyebut utama = lead, non-spam = lead sah", () => {
  const cs = [...Array.from({ length: 1958 }, () => cust("META_ADS")), ...Array.from({ length: 407 }, () => cust("META_ADS", { pipelineStage: "SPAM" }))];
  const meta = cs.slice(0, 1958); const os = meta.slice(0, 33).map((c) => ord(c.id));
  const h = hitung(cs.slice(0, 1958 - 0), os);
  const r = susunSumber({ parameter: param, hasil: h, biayaMeta: null, asOf: "x", hariIni: "2026-10-26" });
  for (const s of r.sumber) {
    for (const [k, penyebut] of [["konversiOrder", s.lead], ["konversiLunas", s.lead], ["konversiMembayar", s.lead], ["konversiOrderNonSpam", s.leadSah], ["konversiLunasNonSpam", s.leadSah]]) {
      const x = s[k]; assert.equal(x.penyebut, penyebut, `${s.id}.${k} penyebut`);
      assert.equal(x.nilai, penyebut > 0 ? Math.round((x.pembilang / penyebut) * 10000) / 100 : null, `${s.id}.${k} nilai`);
    }
  }
  const m = r.sumber[0]; assert.deepEqual([m.konversiOrder.pembilang, m.konversiOrder.penyebut, m.konversiOrder.nilai], [33, 1958, 1.69]);
});
