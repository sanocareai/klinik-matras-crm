// Laporan Marketing — patch "lengkap": (1) Google Ads sumber sendiri (bukan dilebur ke Lainnya), (2) hitungan prospek DESKRIPTIF per sumber
// (keputusan manual sales; tanpa kriteria baru), (3) biaya per prospek, (4) aturan total sumber berbayar untuk Google, (5) pemetaan biaya bulanan lama GOOGLE_ADS,
// (6) rekonsiliasi SILANG: hasil hitungSumber dibandingkan dengan perhitungan independen (JS sederhana) pada fixture yang sama. Murni, tanpa DB, tanpa jaringan.
import test from "node:test";
import assert from "node:assert/strict";
import { hitungSumber, susunSumber, SUMBER, sumberDariLabel } from "../src/services/attribution/sumber.js";
import { biayaKpiSumber, SUMBER_BERBIAYA, muatAdSpendBulanan } from "../src/services/attribution/biayaSumber.js";

const T0 = new Date("2026-11-02T03:00:00Z");
let n = 0;
const cust = (leadSource, o = {}) => ({ id: "c" + ++n, createdAt: T0, pipelineStage: "NEW", leadSource, isInternalStaff: false, staffUserId: null, transitions: [], ...o });
const tr = (...stages) => stages.map((toStage, i) => ({ toStage, createdAt: new Date(T0.getTime() + (i + 1) * 3600e3) }));
const ord = (customerId, o = {}) => ({ id: "o" + ++n, customerId, status: "PROCESSING", value: 1_000_000, tagihan: 1_000_000, paymentStatus: "BELUM_BAYAR", penjualanKaryawanId: null, ...o });
const bayar = (orderId, amount) => ({ id: "p" + ++n, orderId, amount, createdAt: T0 });
const param = { dari: "2026-11-01", sampai: "2026-11-05", hariIni: "2026-11-05", termasukHariBerjalan: true, bawaan: false };
const lengkap = (spend) => ({ cakupan: { status: "LENGKAP", spend, hariHilang: [], hariRentangTidakCocok: [], manualDiabaikanHari: [], entriTerpakai: [] }, entries: [{ id: "e", kind: "TOTAL_RENTANG", dateFrom: "2026-11-01", dateTo: "2026-11-05", accountId: "", amount: spend, override: false, reason: "uji", revision: 1 }] });
const belum = { cakupan: { status: "BELUM_DIISI", spend: null, hariHilang: [], hariRentangTidakCocok: [], manualDiabaikanHari: [], entriTerpakai: [] }, entries: [] };
const susun = (hasil, biayaSumber = null) => susunSumber({ parameter: param, hasil, biayaMeta: null, biayaSumber, asOf: "2026-11-05T01:00:00Z", hariIni: "2026-11-05" });
const sumber = (r, id) => r.sumber.find((x) => x.id === id);

test("Google Ads adalah sumber SENDIRI dan bukan lagi bagian dari Lainnya; Lainnya tetap memuat OTHER/ADS/REFERRAL", () => {
  assert.equal(sumberDariLabel("GOOGLE_ADS"), "GOOGLE");
  for (const l of ["OTHER", "ADS", "REFERRAL", null, "XYZ"]) assert.equal(sumberDariLabel(l), "LAINNYA", String(l));
  assert.equal(sumberDariLabel("WEBSITE_ORGANIC"), "WEBSITE");   // website organik TIDAK disatukan dengan Google Ads
  const s = SUMBER.find((x) => x.id === "GOOGLE");
  assert.deepEqual([s.label, s.jenis, s.labelCrm], ["Google Ads", "IKLAN", ["GOOGLE_ADS"]]);
  assert.ok(!SUMBER.find((x) => x.id === "LAINNYA").labelCrm.includes("GOOGLE_ADS"));
  const h = hitungSumber({ customers: [cust("GOOGLE_ADS"), cust("GOOGLE_ADS", { pipelineStage: "SPAM" }), cust("WEBSITE_ORGANIC"), cust("OTHER")], orders: [], kontribusi: [], refunds: [] });
  assert.deepEqual([h.per.get("GOOGLE").lead, h.per.get("GOOGLE").spam, h.per.get("WEBSITE").lead, h.per.get("LAINNYA").lead], [2, 1, 1, 1]);
});

test("baris Google Ads tetap tampil pada lead 0 (tidak disembunyikan) dan tidak membuat total berbayar semu", () => {
  const r = susun(hitungSumber({ customers: [cust("META_ADS")], orders: [], kontribusi: [], refunds: [] }));
  const gg = sumber(r, "GOOGLE");
  assert.ok(gg, "baris GOOGLE ada walau lead 0"); assert.equal(gg.lead, 0); assert.equal(gg.jenis, "IKLAN");
  assert.equal(gg.prospek.pernahProspekAtauLanjut.persenDariLeadSah, null);   // denominator 0 -> null, bukan 0
  assert.ok(!r.total.berbayar.sumber.includes("GOOGLE"), "Google tanpa lead/entri tidak menjadi sumber wajib");
});

test("total sumber berbayar: Google dengan lead tetapi tanpa biaya MEMBLOKIR total (tidak ada total semu); lengkap semua -> total dihitung dari rasio total", () => {
  const g1 = cust("GOOGLE_ADS"), m1 = cust("META_ADS"), t1 = cust("TIKTOK_ADS");
  const o1 = ord(g1.id), o2 = ord(m1.id, { value: 3_000_000, tagihan: 3_000_000 });
  const hasil = hitungSumber({ customers: [g1, m1, t1], orders: [o1, o2], kontribusi: [bayar(o1.id, 1_000_000), bayar(o2.id, 3_000_000)], refunds: [] });
  // Google punya lead, biaya belum diisi
  const a = susun(hasil, new Map([["META", lengkap(1_000_000)], ["TIKTOK", lengkap(500_000)], ["GOOGLE", belum], ["LAINNYA", belum]]));
  assert.equal(a.total.berbayar.lengkap, false); assert.equal(a.total.berbayar.spend, null); assert.equal(a.total.berbayar.cpa, null);
  assert.ok(a.total.berbayar.belumLengkap.some((x) => x.id === "GOOGLE"));
  assert.equal(a.total.berbayar.alasanNull, "SPEND_TIDAK_LENGKAP_PADA_SUMBER_WAJIB");
  assert.equal(sumber(a, "GOOGLE").biaya.cpl, null);   // biaya belum diisi -> null, BUKAN 0
  // semua lengkap
  const b = susun(hasil, new Map([["META", lengkap(1_000_000)], ["TIKTOK", lengkap(500_000)], ["GOOGLE", lengkap(250_000)], ["LAINNYA", belum]]));
  const bb = b.total.berbayar; assert.equal(bb.lengkap, true); assert.equal(bb.spend, 1_750_000);
  assert.equal(bb.lead, 3); assert.equal(bb.nilaiOrderSaatIni, 4_000_000);
  assert.equal(bb.bookedRoas, Math.round((4_000_000 / 1_750_000) * 100) / 100);   // rasio TOTAL (nilai total / biaya total), bukan rata-rata ROAS baris
  const rataBaris = (sumber(b, "META").biaya.bookedRoas + sumber(b, "TIKTOK").biaya.bookedRoas + sumber(b, "GOOGLE").biaya.bookedRoas) / 3;
  assert.notEqual(bb.bookedRoas, Math.round(rataBaris * 100) / 100);
});

test("biaya manual Google Ads diterima sebagai sumber berbiaya; biaya bulanan lama GOOGLE_ADS dipetakan ke GOOGLE (bukan Lainnya)", async () => {
  assert.deepEqual([...SUMBER_BERBIAYA], ["META", "TIKTOK", "GOOGLE", "LAINNYA"]);
  const db = { $queryRaw: async () => [{ source: "GOOGLE_ADS", year: 2026, month: 8, amount: 12_500_000 }, { source: "META_ADS", year: 2026, month: 8, amount: 22_000_000 }, { source: "TIKTOK_ADS", year: 2026, month: 9, amount: 0 }, { source: "REFERRAL", year: 2026, month: 8, amount: 1 }] };
  const rows = await muatAdSpendBulanan(db, { dari: "2026-08-01", sampai: "2026-09-30" });
  assert.deepEqual(rows.map((r) => [r.source, r.sumberId]), [["GOOGLE_ADS", "GOOGLE"], ["META_ADS", "META"], ["TIKTOK_ADS", "TIKTOK"]]);   // sumber tak dikenal diabaikan
});

test("prospek EKSPLISIT (utama) vs prospek-atau-lanjut (rincian): keputusan manual sales; pernah != saat ini; maju ke order tidak dianggap tidak pernah prospek; lompat langsung dipisah; spam/staf tidak dihitung", () => {
  const eksplisit = cust("META_ADS", { pipelineStage: "TRANSACTION", transitions: tr("PROSPECT", "TRANSACTION") });   // NEW->PROSPECT->TRANSACTION
  const langsung = cust("META_ADS", { pipelineStage: "TRANSACTION", transitions: tr("TRANSACTION") });               // NEW->TRANSACTION (tanpa PROSPECT)
  const kini = cust("META_ADS", { pipelineStage: "PROSPECT", transitions: tr("PROSPECT") });
  const tanpaRiwayat = cust("META_ADS", { pipelineStage: "PROSPECT", transitions: [] });                              // lead lama: hanya stage saat ini
  const mundur = cust("META_ADS", { pipelineStage: "NEW", transitions: tr("PROSPECT") });                             // pernah PROSPECT lalu kembali ke NEW
  const baru = cust("META_ADS");
  const spam = cust("META_ADS", { pipelineStage: "SPAM", transitions: tr("PROSPECT", "SPAM") });                     // spam: bukan lead sah
  const staf = cust("META_ADS", { isInternalStaff: true, pipelineStage: "PROSPECT", transitions: tr("PROSPECT") });
  const lamaTransaksi = cust("META_ADS", { pipelineStage: "TRANSACTION", transitions: [] });                         // lead lama: stage TRANSACTION tanpa riwayat -> atau-lanjut, BUKAN eksplisit
  const h = hitungSumber({ customers: [eksplisit, langsung, kini, tanpaRiwayat, mundur, baru, spam, staf, lamaTransaksi], orders: [ord(eksplisit.id), ord(langsung.id)], kontribusi: [], refunds: [] });
  const p = sumber(susun(h), "META").prospek;
  assert.equal(sumber(susun(h), "META").leadSah, 7);
  // UTAMA: eksplisit = eksplisit, kini, mundur (bertanggal) + tanpaRiwayat (stage kini PROSPECT, lead lama) = 4
  assert.deepEqual(p.prospekEksplisit, { jumlah: 4, berTanggal: 3, tanpaRiwayat: 1, persenDariLeadSah: 57.14, penyebut: 7, label: p.prospekEksplisit.label });
  // RINCIAN (definisi lama): eksplisit, langsung, kini, mundur + tanpaRiwayat(PROSPECT) + lamaTransaksi = 6
  assert.deepEqual([p.pernahProspekAtauLanjut.jumlah, p.pernahProspekAtauLanjut.berTanggal, p.pernahProspekAtauLanjut.tanpaRiwayat, p.pernahProspekAtauLanjut.persenDariLeadSah], [6, 4, 2, 85.71]);
  assert.equal(p.selisihAtauLanjutMinusEksplisit, 2);        // langsung + lamaTransaksi: lanjut tanpa catatan PROSPECT
  assert.ok(p.prospekEksplisit.jumlah <= p.pernahProspekAtauLanjut.jumlah, "eksplisit tidak pernah melebihi atau-lanjut");
  assert.equal(p.langsungKeTransaksiTanpaProspect, 1);        // langsung (transisi ke TRANSACTION tanpa catatan PROSPECT)
  assert.equal(p.saatIniProspect, 2);                         // kini + tanpaRiwayat
  assert.equal(p.saatIniProspekAtauLanjut, 5);                // eksplisit, langsung, kini, tanpaRiwayat, lamaTransaksi
  assert.match(p.catatan, /MANUAL sales/);                    // tidak diklaim sebagai qualified lead objektif
  assert.equal(susun(h).total.prospek.prospekEksplisit, 4);
  assert.equal(susun(h).total.prospek.pernahProspekAtauLanjut, 6);
  assert.equal(susun(h).total.prospek.selisihAtauLanjutMinusEksplisit, 2);
  assert.equal(susun(h).total.prospek.penyebut, 7);
  assert.match(p.prospekEksplisit.label, /eksplisit/i); assert.match(p.pernahProspekAtauLanjut.label, /lompat ke transaksi/);   // label berbeda
});

test("biaya per prospek EKSPLISIT: spend / prospek eksplisit; null dengan alasan (belum ada prospek, biaya tidak lengkap, pemanggil lama); tidak pernah 0/Infinity", () => {
  const L = { status: "LENGKAP", spend: 1_000_000, hariHilang: [], hariRentangTidakCocok: [], manualDiabaikanHari: [] };
  const base = { jenis: "IKLAN", lead: 10, leadSah: 8, lunas: 1, nilaiOrder: 2_000_000, uangBersih: 0, hariIni: "2026-11-05", sampai: "2026-11-04" };
  const a = biayaKpiSumber({ ...base, cakupan: L, prospek: 4 }); assert.equal(a.costPerProspekEksplisit, 250_000); assert.equal(a.alasanNull.costPerProspekEksplisit, undefined);
  const b = biayaKpiSumber({ ...base, cakupan: L, prospek: 0 }); assert.equal(b.costPerProspekEksplisit, null); assert.equal(b.alasanNull.costPerProspekEksplisit, "BELUM_ADA_PROSPEK");
  const c = biayaKpiSumber({ ...base, cakupan: { ...L, status: "SPEND_TIDAK_LENGKAP" }, prospek: 4 }); assert.equal(c.costPerProspekEksplisit, null); assert.equal(c.alasanNull.costPerProspekEksplisit, "SPEND_TIDAK_LENGKAP");
  const d = biayaKpiSumber({ ...base, cakupan: L }); assert.equal(d.costPerProspekEksplisit, null); assert.equal(d.alasanNull.costPerProspekEksplisit, "TIDAK_DIHITUNG");
  for (const x of [a, b, c, d]) assert.ok(x.costPerProspekEksplisit === null || Number.isFinite(x.costPerProspekEksplisit));
});

// ── rekonsiliasi SILANG: hitungSumber vs perhitungan independen (ditulis terpisah, tanpa memakai kode produksi) ─────────────────────────────────────────
test("rekonsiliasi silang pada fixture kaya: multi order & pembayaran, DP parsial, lunas, refund, batal, pending, penjualan karyawan, spam, staf, label B2B, repeat order", () => {
  const A = { GOOGLE_ADS: "GOOGLE", META_ADS: "META", TIKTOK_ADS: "TIKTOK", WEBSITE_ORGANIC: "WEBSITE", WHATSAPP_DIRECT: "WHATSAPP", OTHER: "LAINNYA" };
  const customers = [], orders = [], kontribusi = [], refunds = [];
  const tambah = (label, o = {}) => { const c = cust(label, o); customers.push(c); return c; };
  const order = (c, o = {}) => { const x = ord(c.id, o); orders.push(x); return x; };
  const pay = (x, amt) => kontribusi.push(bayar(x.id, amt));
  const g1 = tambah("GOOGLE_ADS", { pipelineStage: "PROSPECT", transitions: tr("PROSPECT") }); const og1 = order(g1, { value: 2_000_000, tagihan: 2_000_000 }); pay(og1, 500_000);                  // DP parsial
  const g2 = tambah("GOOGLE_ADS", { pipelineStage: "TRANSACTION", transitions: tr("PROSPECT", "TRANSACTION") }); const og2 = order(g2, { value: 1_500_000, tagihan: 1_500_000 }); pay(og2, 1_500_000); // lunas
  const og2b = order(g2, { value: 700_000, tagihan: 700_000 }); pay(og2b, 700_000); pay(og2b, 100_000 * 0);                                                                                       // order ke-2 customer sama
  const m1 = tambah("META_ADS", { pipelineStage: "TRANSACTION", transitions: tr("TRANSACTION") }); const om1 = order(m1, { value: 3_000_000, tagihan: 3_000_000 }); pay(om1, 3_000_000);
  refunds.push({ orderId: om1.id, amount: 1_000_000, status: "DISETUJUI" }); refunds.push({ orderId: om1.id, amount: 999, status: "MENUNGGU_APPROVAL" });                                         // hanya DISETUJUI berlaku
  const m2 = tambah("META_ADS"); order(m2, { status: "CANCELLED" }); order(m2, { status: "PENDING" });                                                                                              // tidak eligible
  const m3 = tambah("META_ADS", { pipelineStage: "SPAM" }); order(m3);                                                                                                                            // spam: order tidak dihitung
  const m4 = tambah("META_ADS", { isInternalStaff: true }); order(m4);
  const m5 = tambah("META_ADS"); order(m5, { penjualanKaryawanId: "pk1" });
  const m6 = tambah("META_ADS", { paymentStatus: "x" }); order(m6, { paymentStatus: "LUNAS" });                                                                                                   // status LUNAS tanpa ledger
  tambah("B2B_DIRECT"); tambah("PENJUALAN_KARYAWAN");
  const w1 = tambah("WEBSITE_ORGANIC"); order(w1, { value: 900_000, tagihan: 900_000 }); const t1 = tambah("TIKTOK_ADS"); const l1 = tambah("OTHER");
  const hasil = hitungSumber({ customers, orders, kontribusi, refunds });
  const r = susun(hasil);

  // perhitungan independen
  const exp = {}; const e = (id) => (exp[id] ||= { lead: 0, spam: 0, sah: 0, ber: 0, bayar: 0, lunas: 0, nilai: 0, uang: 0, tidakDiketahui: 0 });
  const sah = new Map();
  for (const c of customers) { if (["B2B_DIRECT", "PENJUALAN_KARYAWAN"].includes(c.leadSource)) continue; const id = A[c.leadSource] || "LAINNYA"; e(id).lead++; if (c.pipelineStage === "SPAM") { e(id).spam++; continue; } if (c.isInternalStaff || c.staffUserId) continue; e(id).sah++; sah.set(c.id, id); }
  const adaOrder = new Set(), adaBayar = new Set(), adaLunas = new Set(), tdk = new Set();
  for (const o of orders) {
    const id = sah.get(o.customerId); if (!id || o.penjualanKaryawanId || ["CANCELLED", "PENDING"].includes(o.status)) continue;
    const dibayar = kontribusi.filter((k) => k.orderId === o.id).reduce((s, k) => s + k.amount, 0);
    const refund = refunds.filter((x) => x.orderId === o.id && x.status === "DISETUJUI").reduce((s, x) => s + x.amount, 0);
    const bersih = dibayar - refund; e(id).nilai += o.value; e(id).uang += bersih;
    adaOrder.add(o.customerId); if (kontribusi.some((k) => k.orderId === o.id)) adaBayar.add(o.customerId);
    if (bersih >= o.tagihan) adaLunas.add(o.customerId);
    if (!kontribusi.some((k) => k.orderId === o.id) && ["LUNAS", "DP"].includes(o.paymentStatus)) tdk.add(o.customerId);
  }
  for (const cid of adaOrder) { const id = sah.get(cid); e(id).ber++; if (adaBayar.has(cid)) e(id).bayar++; if (adaLunas.has(cid)) e(id).lunas++; }
  for (const id of ["GOOGLE", "META", "TIKTOK", "WEBSITE", "LAINNYA", "WHATSAPP", "INSTAGRAM"]) {
    const s = sumber(r, id), x = e(id);
    assert.deepEqual([s.lead, s.spam, s.leadSah, s.berOrder, s.membayar, s.lunas, s.uang.nilaiOrderSaatIni, s.uang.uangBersih], [x.lead, x.spam, x.sah, x.ber, x.bayar, x.lunas, x.nilai, x.uang], `sumber ${id}`);
  }
  // nilai konkret yang dihitung tangan: GOOGLE 2 customer ber-order, 1 lunas; META: refund menurunkan uang bersih 3jt-1jt=2jt (tagihan 3jt -> BUKAN lunas)
  assert.deepEqual([sumber(r, "GOOGLE").berOrder, sumber(r, "GOOGLE").lunas, sumber(r, "GOOGLE").uang.uangBersih], [2, 1, 500_000 + 1_500_000 + 700_000]);
  assert.equal(sumber(r, "META").uang.uangBersih, 2_000_000); assert.equal(sumber(r, "META").lunas, 0); assert.equal(sumber(r, "META").membayar, 1);
  assert.equal(sumber(r, "META").kategoriEksklusif.tidakDiketahui, 1);   // m6: status LUNAS tersimpan tanpa ledger -> TIDAK DIKETAHUI (bukan 'belum bayar')
  // agregat total = jumlah sumber (tidak ada hitung ganda lintas baris)
  for (const f of ["lead", "spam", "leadSah", "berOrder", "membayar", "lunas"]) assert.equal(r.total[f], r.sumber.reduce((s, x) => s + x[f], 0), `total ${f}`);
  assert.equal(r.total.nilaiOrderSaatIni, r.sumber.reduce((s, x) => s + x.uang.nilaiOrderSaatIni, 0));
  assert.equal(hasil.bukanLeadPemasaran, 2);
});

test("integrasi: biaya per prospek di baris sumber memakai penyebut EKSPLISIT (bukan atau-lanjut); histori/stage customer tidak diubah oleh pelaporan", () => {
  const a = cust("META_ADS", { pipelineStage: "PROSPECT", transitions: tr("PROSPECT") }), b = cust("META_ADS", { pipelineStage: "TRANSACTION", transitions: tr("TRANSACTION") }), c = cust("META_ADS");
  const beku = JSON.stringify([a, b, c]);
  const r = susun(hitungSumber({ customers: [a, b, c], orders: [], kontribusi: [], refunds: [] }), new Map([["META", lengkap(900_000)], ["TIKTOK", belum], ["GOOGLE", belum], ["LAINNYA", belum]]));
  const m = sumber(r, "META");
  assert.equal(m.prospek.prospekEksplisit.jumlah, 1); assert.equal(m.prospek.pernahProspekAtauLanjut.jumlah, 2);
  assert.equal(m.biaya.costPerProspekEksplisit, 900_000, "900.000 / 1 eksplisit (bukan / 2 atau-lanjut)");
  assert.equal(JSON.stringify([a, b, c]), beku, "masukan tidak dimutasi (hitungan murni, tidak menulis stage/histori)");
});
