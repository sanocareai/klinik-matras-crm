// D7: kohort observasi 7 hari PENUH dari HISTORI (murni, tanpa DB). Spend hilang, nol spend sah, hari parsial, pembayaran batal, refund, dedupe, rekonsiliasi.
import test from "node:test";
import assert from "node:assert/strict";
import { susunD7, hariMatangTerakhir, statusPada, D7_JAM } from "../src/services/attribution/d7.js";

const NOW = new Date("2026-10-30T05:00:00Z");          // 12:00 WIB 30 Okt → hari matang terakhir = 22 Okt
const LEAD = new Date("2026-10-20T03:00:00Z");           // 10:00 WIB 20 Okt; akhir D7 = 27 Okt 03:00Z
const plus = (h) => new Date(LEAD.getTime() + h * 3600e3);
const hari = (n) => plus(n * 24);
const CAMP = "52694481763084", AD = "52694481763484", ADX = "52699999999999";
const ref = new Map([[AD, { adId: AD, campaignId: CAMP, campaignName: "C-OCT26" }]]);
const cust = (id, o = {}) => ({ id, createdAt: LEAD, pipelineStage: "NEW", leadSource: "META_ADS", isInternalStaff: false, staffUserId: null, transitions: [], ...o });
const order = (id, customerId, o = {}) => ({ id, customerId, createdAt: hari(1), status: "CONFIRMED", value: 1_000_000, tagihan: 1_000_000, penjualanKaryawanId: null, ...o });
const bayar = (id, orderId, amount, at, o = {}) => ({ id, orderId, amount, createdAt: at, cancelledAt: null, verifiedAt: null, alokasi: [], ...o });
const dasar = (o = {}) => ({ now: NOW, dari: "2026-10-20", sampai: "2026-10-25", hariIni: "2026-10-30", mulaiHari: "2026-10-16", referensi: ref, orders: [], transisi: new Map(), payments: [], refunds: [], gate: { enabled: false, since: null }, spend: null, touchLain: [], akuisisi: new Map(), customers: [], ...o });
// riwayat status default: tiap order non-PENDING punya satu transisi PENDING→status pada saat dibuat (kecuali riwayat diberikan eksplisit)
const transisiDefault = (orders, eksplisit = new Map()) => { const m = new Map(eksplisit); for (const o of orders || []) if (!m.has(o.id) && o.status !== "PENDING") m.set(o.id, [{ fromStatus: "PENDING", toStatus: o.status, createdAt: o.createdAt }]); return m; };
const dengan = (customers, o = {}) => dasar({ customers, akuisisi: new Map(customers.map((c) => [c.id, AD])), leadSemua: customers.length, ...o, transisi: o.tanpaRiwayat ? (o.transisi ?? new Map()) : transisiDefault(o.orders, o.transisi) });
const SPEND_LENGKAP = { terhubung: true, spendPerAd: [{ adId: AD, spend: 600_000 }], hariTersedia: ["2026-10-20", "2026-10-21", "2026-10-22"] };

test("hariMatangTerakhir: hanya hari yang SELURUHNYA berumur ≥ 7 hari; tidak ada → null", () => {
  assert.equal(hariMatangTerakhir({ dari: "2026-10-20", sampai: "2026-10-25", now: NOW }), "2026-10-22");
  assert.equal(hariMatangTerakhir({ dari: "2026-10-23", sampai: "2026-10-25", now: NOW }), null);
  assert.equal(hariMatangTerakhir({ dari: "2026-10-20", sampai: "2026-10-20", now: new Date("2026-10-27T16:59:00Z") }), null, "20 Okt baru matang 28 Okt 00:00 WIB + ... ");
  assert.equal(hariMatangTerakhir({ dari: "2026-10-20", sampai: "2026-10-20", now: new Date("2026-10-27T17:00:00Z") }), "2026-10-20");
});

test("statusPada: dibaca dari riwayat transisi, bukan status sekarang; tanpa riwayat = status sekarang ditandai", () => {
  const o = { id: "o", status: "CANCELLED" };
  const tr = [{ fromStatus: "PENDING", toStatus: "PICKUP", createdAt: hari(1) }, { fromStatus: "PICKUP", toStatus: "CANCELLED", createdAt: hari(9) }];
  assert.deepEqual(statusPada(o, tr, hari(0).getTime()), { status: "PENDING", riwayat: true, tidakDiketahui: false });
  assert.deepEqual(statusPada(o, tr, hari(5).getTime()), { status: "PICKUP", riwayat: true, tidakDiketahui: false });
  assert.deepEqual(statusPada(o, tr, hari(10).getTime()), { status: "CANCELLED", riwayat: true, tidakDiketahui: false });
  assert.deepEqual(statusPada(o, [], hari(5).getTime()), { status: "CANCELLED", riwayat: false, tidakDiketahui: true });
});

test("BELUM_TERSEDIA bila tidak ada hari berumur 7 hari penuh; lead belum matang tidak dihitung (tanpa sensor)", () => {
  const r = susunD7(dengan([cust("c1", { createdAt: new Date("2026-10-28T03:00:00Z") })], { dari: "2026-10-28", sampai: "2026-10-29" }));
  assert.equal(r.status, "BELUM_TERSEDIA"); assert.equal(r.alasan, "BELUM_ADA_LEAD_BERUMUR_7_HARI"); assert.equal(r.total, null);
  const p = susunD7(dengan([cust("a"), cust("b", { createdAt: new Date("2026-10-25T03:00:00Z") })]));
  assert.equal(p.status, "TERSEDIA"); assert.equal(p.total.leadUnik, 1, "hanya hari matang (≤ 22 Okt)"); assert.equal(p.coverage.belumMatang.lead, 1);
});

test("histori: pembayaran sampai D7, bayar setelah D7 diabaikan, batal SESUDAH D7 tetap sah, batal SEBELUM D7 tidak, order batal sesudah D7 tetap dihitung, batal sebelum D7 tidak", () => {
  const cs = ["lunas", "telat", "batalLambat", "batalAwal", "ordBatalLambat", "ordBatalAwal"].map((n) => cust(n));
  const orders = cs.map((c) => order("o-" + c.id, c.id, c.id === "ordBatalLambat" ? { status: "CANCELLED" } : c.id === "ordBatalAwal" ? { status: "CANCELLED" } : {}));
  const transisi = new Map([
    ["o-ordBatalLambat", [{ fromStatus: "PENDING", toStatus: "CONFIRMED", createdAt: hari(1) }, { fromStatus: "CONFIRMED", toStatus: "CANCELLED", createdAt: hari(9) }]],
    ["o-ordBatalAwal", [{ fromStatus: "PENDING", toStatus: "CONFIRMED", createdAt: hari(1) }, { fromStatus: "CONFIRMED", toStatus: "CANCELLED", createdAt: hari(3) }]],
  ]);
  const payments = [
    bayar("p1", "o-lunas", 300_000, hari(3)), bayar("p2", "o-lunas", 700_000, hari(6)),       // DP lalu lunas dalam D7
    bayar("p3", "o-telat", 1_000_000, hari(9)),                                              // setelah D7
    bayar("p4", "o-batalLambat", 1_000_000, hari(2), { cancelledAt: hari(10) }),             // batal setelah D7 → tetap sah
    bayar("p5", "o-batalAwal", 1_000_000, hari(2), { cancelledAt: hari(3) }),                // batal sebelum D7 → tidak
    bayar("p6", "o-ordBatalLambat", 1_000_000, hari(2)),
  ];
  const r = susunD7(dengan(cs, { orders, transisi, payments }));
  const t = r.total;
  assert.equal(t.leadUnik, 6); assert.equal(t.leadSah, 6);
  assert.equal(t.customerLunas, 3, "lunas, batalLambat, ordBatalLambat (order batal pada hari 9 masih sah di D7)");
  assert.equal(t.customerPernahBayar, 3); assert.equal(t.customerDp, 1, "hanya yang pembayaran pertamanya belum menutup tagihan");
  assert.equal(t.customerOrder, 5, "ordBatalAwal tidak eligible; telat tetap ber-order tanpa pembayaran D7");
  assert.equal(t.uangLedger, 3_000_000);
  const c = r.coverage.histori;
  assert.deepEqual([c.paymentSetelahD7Diabaikan, c.paymentDibatalkanSebelumD7, c.paymentBatalSetelahD7TetapSah, c.orderBatalSebelumD7, c.orderBatalSetelahD7TetapDihitung], [1, 1, 1, 1, 1]);
  assert.equal(r.rekonsiliasi.ok, true);
});

test("refund: disetujui ≤ D7 mengurangi uang bersih & lunas; disetujui sesudah D7 tidak; PENDING saat D7 (dikonfirmasi sesudahnya) bukan order D7", () => {
  const cs = [cust("rf1"), cust("rf2"), cust("pend")];
  const orders = [order("o-rf1", "rf1"), order("o-rf2", "rf2"), order("o-pend", "pend", { status: "CONFIRMED" })];
  const transisi = new Map([["o-pend", [{ fromStatus: "PENDING", toStatus: "CONFIRMED", createdAt: hari(9) }]]]);
  const payments = [bayar("a", "o-rf1", 1_000_000, hari(2)), bayar("b", "o-rf2", 1_000_000, hari(2)), bayar("c", "o-pend", 1_000_000, hari(2))];
  const refunds = [{ orderId: "o-rf1", amount: 400_000, approvedAt: hari(4), status: "DISETUJUI" }, { orderId: "o-rf2", amount: 400_000, approvedAt: hari(10), status: "DISETUJUI" }, { orderId: "o-rf2", amount: 999, approvedAt: hari(3), status: "DITOLAK" }];
  const r = susunD7(dengan(cs, { orders, transisi, payments, refunds }));
  assert.equal(r.total.customerLunas, 1, "rf1 turun di bawah tagihan setelah refund → bukan lunas; rf2 refund sesudah D7 → lunas; pend tidak eligible");
  assert.equal(r.total.refund, 400_000); assert.equal(r.total.uangBersih, 600_000 + 1_000_000);
  assert.equal(r.total.customerOrder, 2);
});

test("gerbang verifikasi: pembayaran sesudah tanggal mulai harus diverifikasi ≤ D7; diverifikasi sesudahnya tidak dihitung di D7 (dilaporkan)", () => {
  const cs = [cust("v1"), cust("v2"), cust("v3")];
  const orders = cs.map((c) => order("o-" + c.id, c.id));
  const payments = [bayar("1", "o-v1", 1_000_000, hari(2), { verifiedAt: hari(3) }), bayar("2", "o-v2", 1_000_000, hari(2), { verifiedAt: hari(12) }), bayar("3", "o-v3", 1_000_000, hari(2))];
  const r = susunD7(dengan(cs, { orders, payments, gate: { enabled: true, since: new Date("2026-10-01T00:00:00Z") } }));
  assert.equal(r.total.customerLunas, 1); assert.equal(r.coverage.histori.paymentBelumTerverifikasiPadaD7, 2);
  const lama = susunD7(dengan(cs, { orders, payments, gate: { enabled: true, since: new Date("2026-11-01T00:00:00Z") } }));
  assert.equal(lama.total.customerLunas, 3, "pembayaran sebelum tanggal mulai gerbang dihitung apa adanya");
});

test("prospek D7 = transisi bertanggal ≤ D7; stage sekarang tanpa riwayat tidak dihitung (dilaporkan); spam dikecualikan dari lead sah tetapi tetap lead unik", () => {
  const cs = [cust("pr1", { transitions: [{ toStage: "PROSPECT", createdAt: hari(3) }], pipelineStage: "PROSPECT" }), cust("pr2", { transitions: [{ toStage: "PROSPECT", createdAt: hari(10) }], pipelineStage: "PROSPECT" }), cust("pr3", { pipelineStage: "PROSPECT" }), cust("sp", { pipelineStage: "SPAM" })];
  const r = susunD7(dengan(cs));
  assert.deepEqual([r.total.leadUnik, r.total.spam, r.total.leadSah, r.total.prospek, r.total.prospekTanpaTanggal], [4, 1, 3, 1, 1]);
});

test("pemisahan: akuisisi per campaign vs UNMAPPED; UNKNOWN & reaktivasi di luar kohort; coverage atribusi", () => {
  const cs = [cust("m1"), cust("m2")];
  const r = susunD7(dasar({ customers: cs, akuisisi: new Map([["m1", AD], ["m2", ADX]]), leadSemua: 10, touchLain: [{ customerId: "u1", customerStatusAtTouch: "UNKNOWN" }, { customerId: "u2", customerStatusAtTouch: "EXISTING" }], reaktivasiCustomer: 4 }));
  assert.deepEqual(r.grup.map((x) => [x.kunci, x.leadUnik]).sort(), [[CAMP, 1], ["UNMAPPED", 1]]);
  assert.equal(r.unknown.lead, 2); assert.equal(r.reaktivasi.customerUnik, 4);
  assert.deepEqual([r.coverage.atribusi.leadDiRentang, r.coverage.atribusi.akuisisiTerbukti, r.coverage.atribusi.touchTanpaBukti, r.coverage.atribusi.tanpaTouch], [10, 2, 2, 6]);
  assert.equal(r.total.leadUnik, 2, "UNKNOWN/reaktivasi tidak masuk total kohort");
});

test("biaya D7: spend pada hari kohort yang sama; lengkap → dihitung; hari hilang → null SPEND_TIDAK_LENGKAP; sebelum/awal atribusi → null; belum terhubung → null; nol spend sah", () => {
  const cs = [cust("b1"), cust("b2")];
  const orders = cs.map((c) => order("o-" + c.id, c.id)); const payments = [bayar("1", "o-b1", 1_000_000, hari(2)), bayar("2", "o-b2", 300_000, hari(2))];
  const lengkap = susunD7(dengan(cs, { orders, payments, spend: SPEND_LENGKAP }));
  assert.equal(lengkap.coverage.spend.status, "LENGKAP");
  assert.equal(lengkap.total.biaya.cpaLunas.nilai, 600_000); assert.equal(lengkap.total.biaya.biayaPerCustomerPernahBayar.nilai, 300_000); assert.equal(lengkap.total.biaya.biayaPerCustomerDp.nilai, 600_000, "hanya b2 yang DP");
  assert.equal(lengkap.total.biaya.roasNilaiOrderSaatIni.nilai, n(2_000_000 / 600_000)); assert.equal(lengkap.total.biaya.cashRoas.nilai, n(1_300_000 / 600_000));
  const hilang = susunD7(dengan(cs, { orders, payments, spend: { ...SPEND_LENGKAP, hariTersedia: ["2026-10-20", "2026-10-22"] } }));
  assert.deepEqual(hilang.coverage.spend.hariHilang, ["2026-10-21"]); assert.equal(hilang.total.biaya.cpaLunas.nilai, null); assert.equal(hilang.total.biaya.cpaLunas.alasan, "SPEND_TIDAK_LENGKAP"); assert.equal(hilang.total.biaya.spend, 600_000, "spend tetap tampil");
  const awal = susunD7(dengan(cs, { orders, payments, spend: SPEND_LENGKAP, mulaiHari: "2026-10-20" })); assert.equal(awal.total.biaya.status, "HARI_ATRIBUSI_PARSIAL"); assert.equal(awal.total.biaya.cpaLunas.nilai, null);
  const sebelum = susunD7(dengan(cs, { orders, payments, spend: SPEND_LENGKAP, mulaiHari: "2026-10-22" })); assert.equal(sebelum.total.biaya.status, "SEBELUM_ATRIBUSI"); assert.equal(sebelum.total.biaya.cpaLunas.alasan, "SEBELUM_ATRIBUSI");
  const tanpa = susunD7(dengan(cs, { orders, payments, spend: null })); assert.equal(tanpa.total.biaya.status, "BELUM_TERHUBUNG"); assert.equal(tanpa.total.biaya.spend, null); assert.equal(tanpa.total.biaya.cpaLunas.alasan, "BELUM_ADA_SPEND");
  const nol = susunD7(dengan(cs, { orders, payments, spend: { ...SPEND_LENGKAP, spendPerAd: [{ adId: AD, spend: 0 }] } }));
  assert.equal(nol.total.biaya.spend, 0, "Rp0 sah (baris spend ada) bukan hilang"); assert.equal(nol.total.biaya.cpaLunas.nilai, 0); assert.equal(nol.total.biaya.roasNilaiOrderSaatIni.nilai, null); assert.equal(nol.total.biaya.roasNilaiOrderSaatIni.alasan, "SPEND_NOL");
});

test("spend UNMAPPED & campaign tanpa lead: baris tetap ada, Σ spend grup = total (rekonsiliasi)", () => {
  const cs = [cust("s1")];
  const r = susunD7(dengan(cs, { spend: { terhubung: true, hariTersedia: ["2026-10-20", "2026-10-21", "2026-10-22"], spendPerAd: [{ adId: AD, spend: 100 }, { adId: ADX, spend: 50 }, { adId: "52600000000001", spend: 25 }] }, referensi: new Map([...ref, ["52600000000001", { adId: "52600000000001", campaignId: "52611111111111", campaignName: "SPEND-ONLY" }]]) }));
  assert.equal(r.rekonsiliasi.ok, true); assert.equal(r.rekonsiliasi.spendTotal, 175); assert.equal(r.rekonsiliasi.spendSigmaGrup, 175);
  assert.deepEqual(r.grup.map((x) => x.kunci).sort(), [CAMP, "52611111111111", "UNMAPPED"].sort());
  assert.equal(r.coverage.spend.spendTidakTerpetakan, 50);
});

test("pembayaran teralokasi ke beberapa order dipecah sesuai alokasi; D7_JAM = 168 jam", () => {
  assert.equal(D7_JAM, 168 * 3600e3);
  const cs = [cust("a1"), cust("a2")]; const orders = [order("o-a1", "a1", { value: 600_000, tagihan: 600_000 }), order("o-a2", "a2", { value: 400_000, tagihan: 400_000 })];
  const payments = [bayar("big", "o-a1", 1_000_000, hari(2), { alokasi: [{ orderId: "o-a1", amount: 600_000 }, { orderId: "o-a2", amount: 400_000 }] })];
  const r = susunD7(dengan(cs, { orders, payments }));
  assert.equal(r.total.customerLunas, 2); assert.equal(r.total.uangLedger, 1_000_000);
});
const n = (x) => Math.round(x * 100) / 100;

test("dedupe customer: satu customer dengan dua order & dua pembayaran dihitung SEKALI sebagai customer ber-order/lunas; order dihitung per order", () => {
  const cs = [cust("dd")]; const orders = [order("o1", "dd", { value: 500_000, tagihan: 500_000 }), order("o2", "dd", { value: 500_000, tagihan: 500_000 })];
  const payments = [bayar("p1", "o1", 500_000, hari(2)), bayar("p2", "o2", 500_000, hari(3))];
  const r = susunD7(dengan(cs, { orders, payments }));
  assert.deepEqual([r.total.leadUnik, r.total.customerOrder, r.total.customerLunas, r.total.orderLunas, r.total.orderEligible], [1, 1, 1, 2, 2]);
});

test("histori TIDAK ada: order non-PENDING tanpa transisi → status D7 TIDAK DIKETAHUI (tidak dihitung, tidak ditebak dari status sekarang), dilaporkan; PENDING tanpa transisi tetap PENDING pasti", () => {
  const cs = [cust("h1"), cust("h2")]; const orders = [order("o-h1", "h1", { status: "DELIVERED" }), order("o-h2", "h2", { status: "PENDING" })];
  const payments = [bayar("p", "o-h1", 1_000_000, hari(2))];
  const r = susunD7(dengan(cs, { orders, payments, tanpaRiwayat: true }));
  assert.equal(r.total.customerOrder, 0, "tidak dihitung"); assert.equal(r.total.orderStatusTidakDiketahui, 1); assert.equal(r.total.customerOrderStatusTidakDiketahui, 1); assert.equal(r.coverage.ledger.orderTanpaRiwayatStatus, 1);
  assert.equal(r.total.uangLedger, 0, "uang pada order berstatus tak diketahui tidak ikut");
  assert.ok(r.batasan.some((b) => /TIDAK DIKETAHUI/.test(b)));
  assert.deepEqual(statusPada({ status: "PENDING" }, [], 1), { status: "PENDING", riwayat: false, tidakDiketahui: false });
  assert.equal(statusPada({ status: "CANCELLED" }, [], 1).tidakDiketahui, true);
});

test("label & overlap: nilai order saat ini BUKAN 'booked'; DP→lunas dalam D7 = customerDp 1 DAN customerLunas 1 (overlap) tetapi kategoriEksklusif menaruhnya hanya di 'lunas'; hari atribusi parsial ditandai", () => {
  const cs = [cust("ov1"), cust("ov2")]; const orders = [order("o-ov1", "ov1"), order("o-ov2", "ov2")];
  const payments = [bayar("a", "o-ov1", 300_000, hari(1)), bayar("b", "o-ov1", 700_000, hari(4)), bayar("c", "o-ov2", 400_000, hari(2))];
  const r = susunD7(dengan(cs, { orders, payments, mulaiHari: "2026-10-20" }));
  assert.deepEqual([r.total.customerDp, r.total.customerLunas], [2, 1], "pernah DP (ov1 & ov2) dan lunas (ov1) tumpang tindih");
  assert.deepEqual(r.total.kategoriEksklusif, { belumBayar: 0, dpSaatD7: 1, lunas: 1 }); assert.equal(r.total.kategoriEksklusif.belumBayar + r.total.kategoriEksklusif.dpSaatD7 + r.total.kategoriEksklusif.lunas, r.total.customerOrder);
  assert.ok("nilaiOrderSaatIni" in r.total && !("bookedValue" in r.total) && !("bookedRoas" in r.total.biaya)); assert.ok(r.batasan.some((b) => /BUKAN nilai historis D7/.test(b)));
  assert.equal(r.periode.hariAtribusiParsial, true); assert.equal(susunD7(dengan(cs, { orders, payments, mulaiHari: "2026-10-10" })).periode.hariAtribusiParsial, false);
});
