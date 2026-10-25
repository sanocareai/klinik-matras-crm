// Biaya iklan tingkat SUMBER (input manual harian / total rentang) — logika murni tanpa DB.
// Aturan yang dikunci: validasi masukan, idempotensi/konflik (rencanakan), cakupan per hari (detail Ad vs manual tidak dijumlah ganda, total rentang tidak diproporsikan),
// Rp0 ≠ belum diisi, KPI null bila cakupan tidak lengkap, CPA = biaya ÷ customer lunas unik, organik tanpa biaya, integrasi ke susunSumber.
import test from "node:test";
import assert from "node:assert/strict";
import { validasiMasukan, rencanakan, hitungCakupan, biayaKpiSumber, hariRentang, tambahHari, entriBulananSemu } from "../src/services/attribution/biayaSumber.js";
import { hitungSumber, susunSumber } from "../src/services/attribution/sumber.js";

const HARI_INI = "2026-10-26";
const dasar = { sumber: "TIKTOK", jenis: "HARIAN", dari: "2026-10-20", nominal: "150000", alasan: "Invoice TikTok Ads 20 Okt" };
const ok = (b) => validasiMasukan(b, { hariIni: HARI_INI });
const E = (o) => ({ id: "e" + Math.random().toString(36).slice(2, 8), sourceId: "TIKTOK", kind: "HARIAN", dateFrom: "2026-10-20", dateTo: "2026-10-20", accountId: "", amount: 100, override: false, status: "AKTIF", ...o });

test("validasi: sumber organik ditolak; jenis/tanggal/nominal/alasan divalidasi; Rp0 harus dikonfirmasi; hari berjalan ditolak", () => {
  assert.equal(ok(dasar).data.nominal, 150000);
  assert.equal(ok({ ...dasar, sumber: "WHATSAPP" }).kode, "SUMBER_TIDAK_BERBIAYA");
  assert.equal(ok({ ...dasar, sumber: "instagram" }).kode, "SUMBER_TIDAK_BERBIAYA");
  assert.equal(ok({ ...dasar, jenis: "BULANAN" }).kode, "JENIS_TIDAK_VALID");
  assert.equal(ok({ ...dasar, dari: "2026-02-30" }).kode, "TANGGAL_TIDAK_VALID");
  assert.equal(ok({ ...dasar, dari: "26/10/2026" }).kode, "TANGGAL_TIDAK_VALID");
  assert.equal(ok({ ...dasar, dari: HARI_INI }).kode, "HARI_BERJALAN");
  assert.equal(ok({ ...dasar, jenis: "TOTAL_RENTANG", dari: "2026-10-20", sampai: "2026-10-19" }).kode, "TANGGAL_TIDAK_VALID");
  assert.equal(ok({ ...dasar, jenis: "TOTAL_RENTANG", dari: "2026-01-01", sampai: "2026-10-01" }).kode, "RENTANG_TERLALU_PANJANG");
  for (const [n, kode] of [["-5", "NOMINAL_NEGATIF"], [-5, "NOMINAL_NEGATIF"], ["1,500,000", "NOMINAL_TIDAK_VALID"], ["1.500.000", "NOMINAL_TIDAK_VALID"], ["1e6", "NOMINAL_TIDAK_VALID"], ["abc", "NOMINAL_TIDAK_VALID"], ["", "NOMINAL_KOSONG"], [null, "NOMINAL_KOSONG"], [NaN, "NOMINAL_TIDAK_VALID"], [{}, "NOMINAL_TIDAK_VALID"], ["1.234", "NOMINAL_TIDAK_VALID"]]) assert.equal(ok({ ...dasar, nominal: n }).kode, kode, String(n));
  assert.equal(ok({ ...dasar, nominal: "1500000.50" }).data.nominal, 1500000.5);
  assert.equal(ok({ ...dasar, nominal: "0" }).kode, "NOL_BELUM_DIKONFIRMASI");
  assert.equal(ok({ ...dasar, nominal: 0, konfirmasiNol: true }).data.nominal, 0);
  assert.equal(ok({ ...dasar, alasan: "ok" }).kode, "ALASAN_WAJIB");
  assert.equal(ok({ ...dasar, alasan: "x".repeat(301) }).kode, "ALASAN_WAJIB");
  assert.equal(ok({ ...dasar, akun: "abc" }).kode, "AKUN_TIDAK_VALID");
  assert.equal(ok({ ...dasar, akun: "act_123456789" }).data.akun, "123456789");
  assert.equal(ok({ ...dasar, gantiDetailAd: true }).kode, "OVERRIDE_TIDAK_VALID", "override detail Ad hanya META");
  assert.equal(ok({ ...dasar, sumber: "META", gantiDetailAd: true }).data.override, true);
  assert.equal(ok(null).kode, "BIAYA_TIDAK_VALID");
});

test("HARIAN memaksa sampai = dari (nilai 'sampai' kiriman klien diabaikan)", () => {
  const r = ok({ ...dasar, sampai: "2026-10-24" }).data; assert.equal(r.dari, r.sampai);
});

test("rencanakan: BARU, TIDAK_BERUBAH (idempoten), UBAH, KONFLIK tumpang tindih, AKTIFKAN kembali entri batal", () => {
  const i = ok(dasar).data;
  assert.equal(rencanakan(i, []).aksi, "BARU");
  const ada = E({ amount: 150000 });
  assert.equal(rencanakan(i, [ada]).aksi, "TIDAK_BERUBAH");
  assert.equal(rencanakan({ ...i, nominal: 200000 }, [ada]).aksi, "UBAH");
  assert.equal(rencanakan(i, [{ ...ada, status: "DIBATALKAN" }]).aksi, "AKTIFKAN");
  const blok = E({ kind: "TOTAL_RENTANG", dateFrom: "2026-10-15", dateTo: "2026-10-25", amount: 9_000_000 });
  const k = rencanakan(i, [blok]); assert.equal(k.aksi, "KONFLIK"); assert.equal(k.konflik.length, 1);
  assert.equal(rencanakan(i, [{ ...blok, status: "DIBATALKAN" }]).aksi, "BARU", "entri batal tidak menimbulkan konflik");
  assert.equal(rencanakan(i, [E({ sourceId: "META", amount: 5 })]).aksi, "BARU", "sumber lain tidak konflik");
  assert.equal(rencanakan(i, [E({ dateFrom: "2026-10-19", dateTo: "2026-10-19" })]).aksi, "BARU", "hari lain tidak konflik");
  assert.equal(rencanakan({ ...i, akun: "111" }, [E({ accountId: "222" })]).aksi, "BARU", "akun berbeda tidak konflik");
  assert.equal(rencanakan({ ...i, akun: "111" }, [E({ accountId: "" })]).aksi, "KONFLIK", "akun kosong (semua akun) bentrok dengan akun spesifik");
});

test("cakupan: semua hari terisi manual harian → LENGKAP; hari hilang → SPEND_TIDAK_LENGKAP + daftar hari; tidak ada entri → BELUM_DIISI (bukan Rp0)", () => {
  const dari = "2026-10-20", sampai = "2026-10-22";
  const penuh = hariRentang(dari, sampai).map((d) => E({ dateFrom: d, dateTo: d, amount: 100 }));
  const c1 = hitungCakupan({ dari, sampai, hariIni: HARI_INI, entries: penuh });
  assert.deepEqual([c1.status, c1.spend, c1.spendLengkap], ["LENGKAP", 300, true]);
  const c2 = hitungCakupan({ dari, sampai, hariIni: HARI_INI, entries: penuh.slice(0, 2) });
  assert.deepEqual([c2.status, c2.spend, c2.hariHilang], ["SPEND_TIDAK_LENGKAP", 200, ["2026-10-22"]]);
  const c3 = hitungCakupan({ dari, sampai, hariIni: HARI_INI, entries: [] });
  assert.deepEqual([c3.status, c3.spend], ["BELUM_DIISI", null]);
});

test("Rp0 terkonfirmasi = hari terisi dengan biaya 0 (LENGKAP, spend 0), berbeda dari hari belum diisi", () => {
  const c = hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-20", hariIni: HARI_INI, entries: [E({ amount: 0 })] });
  assert.deepEqual([c.status, c.spend], ["LENGKAP", 0]);
});

test("total rentang: dipakai hanya bila dimuat penuh oleh rentang laporan; TIDAK diproporsikan ke sub-rentang", () => {
  const blok = E({ kind: "TOTAL_RENTANG", dateFrom: "2026-10-10", dateTo: "2026-10-19", amount: 1_000_000 });
  const pas = hitungCakupan({ dari: "2026-10-10", sampai: "2026-10-19", hariIni: HARI_INI, entries: [blok] });
  assert.deepEqual([pas.status, pas.spend], ["LENGKAP", 1_000_000], "dihitung SEKALI, bukan × jumlah hari");
  const lebih = hitungCakupan({ dari: "2026-10-01", sampai: "2026-10-25", hariIni: HARI_INI, entries: [blok] });
  assert.equal(lebih.status, "SPEND_TIDAK_LENGKAP", "rentang laporan lebih lebar: hari di luar blok hilang"); assert.equal(lebih.spend, 1_000_000);
  const sub = hitungCakupan({ dari: "2026-10-12", sampai: "2026-10-15", hariIni: HARI_INI, entries: [blok] });
  assert.equal(sub.status, "RENTANG_TIDAK_COCOK", "sub-rentang dari total rentang → tidak dipakai"); assert.equal(sub.spend, null); assert.equal(sub.hariRentangTidakCocok.length, 4);
  const sebagian = hitungCakupan({ dari: "2026-10-15", sampai: "2026-10-25", hariIni: HARI_INI, entries: [blok] });
  assert.equal(sebagian.status, "RENTANG_TIDAK_COCOK", "blok menjulur keluar rentang laporan");
});

test("Windsor/API detail Ad vs manual: tidak dijumlah ganda; detail Ad menang; override eksplisit mengganti", () => {
  const dari = "2026-10-20", sampai = "2026-10-22";
  const ad = new Map([["2026-10-20", 50], ["2026-10-21", 60], ["2026-10-22", 70]]);
  const manual = hariRentang(dari, sampai).map((d) => E({ sourceId: "META", dateFrom: d, dateTo: d, amount: 1000 }));
  const a = hitungCakupan({ dari, sampai, hariIni: HARI_INI, entries: manual, adHarian: ad });
  assert.deepEqual([a.status, a.spend, a.hari.adDetail], ["DETAIL_AD_SELISIH", 180, 3], "manual (1000) > detail (50..70): detail dianggap mungkin PARSIAL → bukan LENGKAP; tetap tidak dijumlah");
  const kecil = hitungCakupan({ dari, sampai, hariIni: HARI_INI, entries: hariRentang(dari, sampai).map((d) => E({ sourceId: "META", dateFrom: d, dateTo: d, amount: 10 })), adHarian: ad });
  assert.deepEqual([kecil.status, kecil.spend, kecil.manualDiabaikanHari.length], ["LENGKAP", 180, 3], "manual lebih KECIL dari detail: detail dipakai, hanya informasi");
  assert.ok(kecil.pemilihan.some((p) => p.kode === "MANUAL_LEBIH_KECIL"));
  const ov = hitungCakupan({ dari, sampai, hariIni: HARI_INI, entries: manual.map((e) => ({ ...e, override: true })), adHarian: ad });
  assert.deepEqual([ov.status, ov.spend, ov.overrideMenggantikanDetailHari.length], ["LENGKAP", 3000, 3], "override: manual menggantikan detail, tidak ditambah");
  const campur = hitungCakupan({ dari, sampai, hariIni: HARI_INI, entries: [manual[2]], adHarian: new Map([["2026-10-20", 50], ["2026-10-21", 60]]) });
  assert.deepEqual([campur.status, campur.spend], ["LENGKAP", 1110], "hari tanpa detail Ad diisi manual; hari lain detail Ad");
  const blok = E({ sourceId: "META", kind: "TOTAL_RENTANG", dateFrom: dari, dateTo: sampai, amount: 9000 });
  const b = hitungCakupan({ dari, sampai, hariIni: HARI_INI, entries: [blok], adHarian: new Map([["2026-10-21", 60]]) });
  assert.equal(b.status, "SPEND_TIDAK_LENGKAP", "blok yang bersinggungan dengan detail Ad tidak dipakai (hindari ganda); hari tanpa detail hilang");
  assert.equal(b.spend, 60);
});

test("hari berjalan: rentang yang memuat hari ini → HARI_BERJALAN_PARSIAL (KPI null); entri dibatalkan diabaikan", () => {
  const dari = "2026-10-24", sampai = HARI_INI;
  const c = hitungCakupan({ dari, sampai, hariIni: HARI_INI, entries: hariRentang(dari, tambahHari(HARI_INI, -1)).map((d) => E({ dateFrom: d, dateTo: d })) });
  assert.equal(c.status, "HARI_BERJALAN_PARSIAL"); assert.equal(c.termasukHariBerjalan, true);
  const k = biayaKpiSumber({ cakupan: c, jenis: "IKLAN", lead: 10, leadSah: 9, lunas: 2, nilaiOrder: 1e6, uangBersih: 5e5, ledger: { orderEligible: 2, orderBerLedger: 2 }, hariIni: HARI_INI, sampai });
  assert.deepEqual([k.cpa, k.cpl, k.bookedRoas, k.cashRoas, k.alasanNull.cpa], [null, null, null, null, "HARI_BERJALAN_PARSIAL"]);
  const batal = hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-20", hariIni: HARI_INI, entries: [E({ status: "DIBATALKAN" })] });
  assert.equal(batal.status, "BELUM_DIISI");
});

test("KPI sumber: CPA = biaya ÷ customer lunas; Booked/Cash ROAS terpisah; sementara bila ledger parsial / kohort belum matang; 0 lunas → null 'belum ada konversi'", () => {
  const cak = hitungCakupan({ dari: "2026-08-01", sampai: "2026-08-03", hariIni: HARI_INI, entries: ["2026-08-01", "2026-08-02", "2026-08-03"].map((d) => E({ dateFrom: d, dateTo: d, amount: 100000 })) });
  const k = biayaKpiSumber({ cakupan: cak, jenis: "IKLAN", lead: 30, leadSah: 25, lunas: 3, nilaiOrder: 3_000_000, uangBersih: 1_500_000, ledger: { orderEligible: 4, orderBerLedger: 4 }, hariIni: HARI_INI, sampai: "2026-08-03" });
  assert.deepEqual([k.status, k.spend, k.cpa, k.cpl, k.bookedRoas, k.cashRoas, k.sementara, k.dasar], ["LENGKAP", 300000, 100000, 10000, 10, 5, false, "ATRIBUSI_LABEL_CRM"]);
  const k2 = biayaKpiSumber({ cakupan: cak, jenis: "IKLAN", lead: 30, leadSah: 25, lunas: 3, nilaiOrder: 3_000_000, uangBersih: 1_500_000, ledger: { orderEligible: 4, orderBerLedger: 2 }, hariIni: HARI_INI, sampai: "2026-08-03" });
  assert.equal(k2.sementara, true); assert.ok(k2.alasanSementara.some((a) => a.startsWith("LEDGER_PARSIAL")));
  const mudaCak = hitungCakupan({ dari: "2026-10-18", sampai: "2026-10-20", hariIni: HARI_INI, entries: ["2026-10-18", "2026-10-19", "2026-10-20"].map((d) => E({ dateFrom: d, dateTo: d })) });
  const k3 = biayaKpiSumber({ cakupan: mudaCak, jenis: "IKLAN", lead: 5, leadSah: 5, lunas: 1, nilaiOrder: 1, uangBersih: 1, ledger: { orderEligible: 1, orderBerLedger: 1 }, hariIni: HARI_INI, sampai: "2026-10-20" });
  assert.equal(k3.sementara, true); assert.ok(k3.alasanSementara.some((a) => a.startsWith("KOHORT_BELUM_MATANG")));
  const k0 = biayaKpiSumber({ cakupan: cak, jenis: "IKLAN", lead: 30, leadSah: 25, lunas: 0, nilaiOrder: 0, uangBersih: 0, ledger: { orderEligible: 0, orderBerLedger: 0 }, hariIni: HARI_INI, sampai: "2026-08-03" });
  assert.deepEqual([k0.cpa, k0.alasanNull.cpa, k0.spend], [null, "BELUM_ADA_KONVERSI", 300000]);
  const nol = hitungCakupan({ dari: "2026-08-01", sampai: "2026-08-01", hariIni: HARI_INI, entries: [E({ dateFrom: "2026-08-01", dateTo: "2026-08-01", amount: 0 })] });
  const kn = biayaKpiSumber({ cakupan: nol, jenis: "IKLAN", lead: 3, leadSah: 3, lunas: 1, nilaiOrder: 100, uangBersih: 100, ledger: null, hariIni: HARI_INI, sampai: "2026-08-01" });
  assert.deepEqual([kn.spend, kn.cpa, kn.bookedRoas, kn.alasanNull.bookedRoas], [0, 0, null, "SPEND_NOL"], "spend Rp0 terkonfirmasi: CPA 0, ROAS tidak terdefinisi (null)");
});

test("KPI sumber: organik → 'biaya tidak tersedia' (bukan Rp0), semua KPI null", () => {
  const k = biayaKpiSumber({ jenis: "ORGANIK" });
  assert.equal(k.status, "TIDAK_TERSEDIA_ORGANIK"); assert.equal(k.spend, null); assert.equal(k.cpa, null); assert.notEqual(k.spend, 0);
});

// ── integrasi ke susunSumber ────────────────────────────────────────────────────────────────────────────────────
const T0 = new Date("2026-08-05T03:00:00Z"); let n = 0;
const cust = (leadSource, o = {}) => ({ id: "c" + ++n, createdAt: T0, pipelineStage: "NEW", leadSource, isInternalStaff: false, staffUserId: null, ...o });
const ord = (customerId, o = {}) => ({ id: "o" + ++n, customerId, status: "PROCESSING", value: 1_000_000, tagihan: 1_000_000, penjualanKaryawanId: null, ...o });
const bayar = (orderId, amount) => ({ id: "p" + ++n, orderId, amount, createdAt: T0 });
const param = { dari: "2026-08-01", sampai: "2026-08-03", hariIni: HARI_INI, termasukHariBerjalan: false, bawaan: false };
const peta = (obj) => new Map(Object.entries(obj).map(([id, entries]) => [id, { cakupan: hitungCakupan({ dari: param.dari, sampai: param.sampai, hariIni: HARI_INI, entries: entries.filter((e) => e.sourceId === id), adHarian: null }), entries }]));
const harian = (sourceId, jumlah) => hariRentang(param.dari, param.sampai).map((d) => E({ sourceId, dateFrom: d, dateTo: d, amount: jumlah }));

test("susunSumber: CPA sumber = biaya ÷ CUSTOMER lunas unik (bukan jumlah order); Booked & Cash ROAS terpisah; label 'Atribusi label CRM'; campaign Meta tidak ikut tercampur", () => {
  const tt = cust("TIKTOK_ADS"), tt2 = cust("TIKTOK_ADS"), tt3 = cust("TIKTOK_ADS");
  const o1 = ord(tt.id), o2 = ord(tt.id), o3 = ord(tt2.id);   // tt: 2 order, 1 customer lunas
  const h = hitungSumber({ customers: [tt, tt2, tt3], orders: [o1, o2, o3], kontribusi: [bayar(o1.id, 1_000_000), bayar(o2.id, 1_000_000), bayar(o3.id, 400_000)], refunds: [] });
  const r = susunSumber({ parameter: param, hasil: h, biayaSumber: peta({ META: harian("META", 1000), TIKTOK: harian("TIKTOK", 200_000), LAINNYA: [] }), asOf: new Date("2026-10-26T00:00:00Z"), hariIni: HARI_INI });
  const t = r.sumber.find((x) => x.id === "TIKTOK");
  assert.equal(t.lunas, 1, "hanya tt yang lunas penuh (2 order Rp1jt), tt2 hanya DP");
  assert.equal(t.biaya.spend, 600_000); assert.equal(t.biaya.cpa, 600_000); assert.equal(t.biaya.dasar, "ATRIBUSI_LABEL_CRM");
  assert.equal(t.uang.nilaiOrderSaatIni, 3_000_000); assert.equal(t.uang.uangBersih, 2_400_000);
  assert.equal(t.biaya.bookedRoas, 5); assert.equal(t.biaya.cashRoas, 4);
  assert.equal(t.biayaCampaignTerbukti, null, "TikTok tidak punya angka campaign terbukti");
  const w = r.sumber.find((x) => x.id === "WHATSAPP"); assert.equal(w.biaya.status, "TIDAK_TERSEDIA_ORGANIK"); assert.equal(w.biaya.spend, null);
});

test("susunSumber: total berbayar hanya bila SEMUA sumber wajib lengkap; satu sumber hilang → seluruh total null + peringatan; Lainnya tanpa entri tidak diwajibkan", () => {
  const m = cust("META_ADS"), t = cust("TIKTOK_ADS"); const om = ord(m.id), ot = ord(t.id);
  const h = hitungSumber({ customers: [m, t], orders: [om, ot], kontribusi: [bayar(om.id, 1_000_000), bayar(ot.id, 1_000_000)], refunds: [] });
  const lengkap = susunSumber({ parameter: param, hasil: h, biayaSumber: peta({ META: harian("META", 100_000), TIKTOK: harian("TIKTOK", 50_000), LAINNYA: [] }), asOf: new Date(), hariIni: HARI_INI });
  const b = lengkap.total.berbayar;
  assert.deepEqual([b.lengkap, b.spend, b.lunas, b.cpa], [true, 450_000, 2, 225_000]);
  assert.deepEqual(b.sumber, ["META", "TIKTOK"]);
  const kurang = susunSumber({ parameter: param, hasil: h, biayaSumber: peta({ META: harian("META", 100_000), TIKTOK: harian("TIKTOK", 50_000).slice(0, 2), LAINNYA: [] }), asOf: new Date(), hariIni: HARI_INI });
  const b2 = kurang.total.berbayar;
  assert.deepEqual([b2.lengkap, b2.spend, b2.cpa, b2.bookedRoas, b2.cashRoas, b2.alasanNull], [false, null, null, null, null, "SPEND_TIDAK_LENGKAP_PADA_SUMBER_WAJIB"]);
  assert.deepEqual(b2.belumLengkap, [{ id: "TIKTOK", status: "SPEND_TIDAK_LENGKAP" }]);
  const pw = kurang.peringatan.find((p) => p.kode === "SPEND_BELUM_LENGKAP"); assert.ok(pw && pw.data.sumber === "TIKTOK" && pw.data.hariHilang.length === 1);
  assert.equal(kurang.sumber.find((x) => x.id === "TIKTOK").biaya.cpa, null);
  assert.equal(kurang.sumber.find((x) => x.id === "META").biaya.cpa, 300_000, "sumber lain tetap dihitung sendiri");
  const adaLainnya = susunSumber({ parameter: param, hasil: h, biayaSumber: peta({ META: harian("META", 100_000), TIKTOK: harian("TIKTOK", 50_000), LAINNYA: harian("LAINNYA", 10) }), asOf: new Date(), hariIni: HARI_INI });
  assert.deepEqual(adaLainnya.total.berbayar.sumber, ["META", "TIKTOK", "LAINNYA"], "Lainnya diwajibkan begitu punya entri");
});

test("susunSumber: nol lunas → CPA null alasan 'belum ada konversi' (bukan 0); status.spend mengikuti Meta; cutoff evaluasi WIB tampil", () => {
  const m = cust("META_ADS"); const h = hitungSumber({ customers: [m], orders: [], kontribusi: [], refunds: [] });
  const r = susunSumber({ parameter: param, hasil: h, biayaSumber: peta({ META: harian("META", 100_000), TIKTOK: [], LAINNYA: [] }), asOf: new Date("2026-10-26T03:00:00Z"), hariIni: HARI_INI });
  const me = r.sumber.find((x) => x.id === "META"); assert.deepEqual([me.biaya.cpa, me.biaya.alasanNull.cpa, me.biaya.spend], [null, "BELUM_ADA_KONVERSI", 300_000]);
  assert.equal(r.status.spend, "LENGKAP"); assert.match(r.cutoffEvaluasi.waktuWib, /^2026-10-26 10:00:00 WIB$/);
  const tt = r.sumber.find((x) => x.id === "TIKTOK"); assert.equal(tt.biaya.status, "BELUM_DIISI"); assert.equal(tt.biaya.spend, null);
});

test("AdSpend bulanan (Pengaturan Sales) dibaca sebagai total rentang prioritas terendah: bulan penuh dipakai; sub-rentang tidak cocok; nominal 0 = belum diisi; entri sumber menang (tanpa hitung ganda)", () => {
  const baris = [{ source: "TIKTOK_ADS", sumberId: "TIKTOK", tahun: 2026, bulan: 8, amount: 31_000_000 }, { source: "META_ADS", sumberId: "META", tahun: 2026, bulan: 8, amount: 0 }];
  const pakai = (dari, sampai, nyata = []) => { const { semu, diabaikan } = entriBulananSemu(baris, { dari, sampai, entriNyata: nyata }); return { semu, diabaikan, cak: hitungCakupan({ dari, sampai, hariIni: HARI_INI, entries: [...nyata, ...semu.filter((e) => e.sourceId === "TIKTOK")] }) }; };
  const penuh = pakai("2026-08-01", "2026-08-31");
  assert.deepEqual([penuh.cak.status, penuh.cak.spend], ["LENGKAP", 31_000_000], "dihitung sekali, bukan × 31 hari");
  assert.equal(penuh.diabaikan[0].alasan, "NOMINAL_NOL_DIANGGAP_BELUM_DIISI");
  const sub = pakai("2026-08-01", "2026-08-15"); assert.deepEqual([sub.cak.status, sub.cak.spend], ["RENTANG_TIDAK_COCOK", null], "tidak diprorata ke 15 hari");
  const lebar = pakai("2026-07-25", "2026-08-31"); assert.equal(lebar.cak.status, "SPEND_TIDAK_LENGKAP"); assert.equal(lebar.cak.hariHilang.length, 7);
  const nyata = [E({ dateFrom: "2026-08-05", dateTo: "2026-08-05", amount: 150000 })];
  const menang = pakai("2026-08-01", "2026-08-31", nyata);
  assert.equal(menang.diabaikan.some((d) => d.alasan === "ADA_ENTRI_SUMBER_PADA_BULAN_INI"), true);
  assert.deepEqual([menang.cak.status, menang.cak.spend, menang.cak.hariHilang.length], ["SPEND_TIDAK_LENGKAP", 150000, 30], "hanya entri sumber; bulanan 31 jt TIDAK ikut");
  const tanpa = entriBulananSemu([{ source: "GOOGLE_ADS", sumberId: "LAINNYA", tahun: 2026, bulan: 8, amount: 5 }], { dari: "2026-09-01", sampai: "2026-09-02", entriNyata: [] });
  assert.equal(tanpa.semu.length, 1, "baris dikirim pemanggil; penyaringan bulan dilakukan query");
});

// ── AUDIT PRIORITAS BIAYA (review kandidat 3abce860) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const M = (o) => E({ sourceId: "META", ...o });
const kode = (c) => c.pemilihan.map((p) => p.kode);

test("audit: detail Ad PARSIAL (hanya sebagian Ad) tidak boleh dianggap lengkap — pembanding manual lebih besar → DETAIL_AD_SELISIH, KPI null, alasan terbaca", () => {
  const c = hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-20", hariIni: HARI_INI, entries: [M({ amount: 2_000_000 })], adHarian: new Map([["2026-10-20", 500_000]]) });
  assert.deepEqual([c.status, c.spend, c.spendLengkap], ["DETAIL_AD_SELISIH", 500_000, false]);
  assert.deepEqual(c.selisihDetailManual.map((x) => [x.detail, x.manual, x.manualLebihBesar]), [[500_000, 2_000_000, true]]);
  assert.match(c.pemilihan.find((p) => p.kode === "DETAIL_AD_SELISIH").alasan, /LEBIH BESAR.*PARSIAL.*ganti detail Ad/s);
  const k = biayaKpiSumber({ cakupan: c, jenis: "IKLAN", lead: 10, leadSah: 9, lunas: 2, nilaiOrder: 1e6, uangBersih: 5e5, ledger: { orderEligible: 2, orderBerLedger: 2 }, hariIni: HARI_INI, sampai: "2026-10-20" });
  assert.deepEqual([k.cpa, k.cpl, k.bookedRoas, k.cashRoas, k.alasanNull.cpa], [null, null, null, null, "DETAIL_AD_SELISIH"]);
});

test("audit: toleransi Rp1 — selisih pembulatan tidak memicu; Rp2 memicu", () => {
  const cek = (man) => hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-20", hariIni: HARI_INI, entries: [M({ amount: man })], adHarian: new Map([["2026-10-20", 1000]]) }).status;
  assert.deepEqual([cek(1000), cek(1001), cek(1002), cek(999)], ["LENGKAP", "LENGKAP", "DETAIL_AD_SELISIH", "LENGKAP"]);
});

test("audit: detail Ad hanya sebagian HARI + entri harian untuk hari lain → campuran sah; jumlah tidak ganda; sumber tiap hari tercatat", () => {
  const ad = new Map([["2026-10-20", 100], ["2026-10-21", 100]]); const src = new Map([["2026-10-20", ["WINDSOR_API"]], ["2026-10-21", ["ADS_MANAGER_CSV", "WINDSOR_API"]]]);
  const c = hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-23", hariIni: HARI_INI, entries: [M({ dateFrom: "2026-10-22", dateTo: "2026-10-22", amount: 70 }), M({ dateFrom: "2026-10-23", dateTo: "2026-10-23", amount: 80 })], adHarian: ad, adSumber: src });
  assert.deepEqual([c.status, c.spend, c.hari.adDetail, c.hari.manualHarian], ["LENGKAP", 350, 2, 2]);
  assert.deepEqual(c.asalDetailAd, { WINDSOR_API: 2, ADS_MANAGER_CSV: 1 });
  assert.deepEqual(kode(c), ["AD_DETAIL", "MANUAL_HARIAN"]);
  assert.match(c.pemilihan[0].alasan, /Windsor 2 hari.*CSV Ads Manager 1 hari.*diutamakan atas entri manual/s);
  assert.match(c.pemilihan[1].alasan, /TIDAK punya detail Ad/);
});

test("audit: detail Ad sebagian hari tanpa manual → SPEND_TIDAK_LENGKAP (bukan lengkap) dan hari hilang terdaftar", () => {
  const c = hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-23", hariIni: HARI_INI, entries: [], adHarian: new Map([["2026-10-20", 1], ["2026-10-22", 1]]) });
  assert.deepEqual([c.status, c.hariHilang], ["SPEND_TIDAK_LENGKAP", ["2026-10-21", "2026-10-23"]]);
});

test("audit: total rentang overlap dengan detail Ad SEBAGIAN hari → total ditolak seluruhnya (tidak dijumlah sebagian), alasan blok terbaca", () => {
  const blok = M({ kind: "TOTAL_RENTANG", dateFrom: "2026-10-20", dateTo: "2026-10-22", amount: 6_000_000 });
  const c = hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-22", hariIni: HARI_INI, entries: [blok], adHarian: new Map([["2026-10-21", 1_000_000]]) });
  assert.deepEqual([c.status, c.spend, c.hariHilang.length, c.blokDitolak.length], ["SPEND_TIDAK_LENGKAP", 1_000_000, 2, 1]);
  assert.match(c.pemilihan.find((p) => p.kode === "BLOK_DITOLAK_DETAIL_SEBAGIAN").alasan, /1 dari 3 harinya sudah punya detail Ad.*tidak dihitung ganda/s);
});

test("audit: total rentang vs detail Ad LENGKAP di semua harinya: sama → LENGKAP (detail dipakai); manual lebih besar → DETAIL_AD_SELISIH", () => {
  const ad = new Map([["2026-10-20", 1e6], ["2026-10-21", 1e6], ["2026-10-22", 1e6]]);
  const pakai = (n) => hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-22", hariIni: HARI_INI, entries: [M({ kind: "TOTAL_RENTANG", dateFrom: "2026-10-20", dateTo: "2026-10-22", amount: n })], adHarian: ad });
  assert.deepEqual([pakai(3e6).status, pakai(3e6).spend], ["LENGKAP", 3e6]);
  assert.deepEqual([pakai(6e6).status, pakai(6e6).spend, pakai(6e6).selisihDetailManual[0].jenis], ["DETAIL_AD_SELISIH", 3e6, "TOTAL_RENTANG"]);
});

test("audit: override menyelesaikan selisih; PENCABUTAN override mengembalikan ke detail Ad (dan memunculkan selisih lagi)", () => {
  const ad = new Map([["2026-10-20", 500_000]]);
  const hitung = (override) => hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-20", hariIni: HARI_INI, entries: [M({ amount: 2_000_000, override })], adHarian: ad });
  const dgOverride = hitung(true), dicabut = hitung(false);
  assert.deepEqual([dgOverride.status, dgOverride.spend, kode(dgOverride)], ["LENGKAP", 2_000_000, ["MANUAL_OVERRIDE"]]);
  assert.match(dgOverride.pemilihan[0].alasan, /pilihan sadar Admin/);
  assert.deepEqual([dicabut.status, dicabut.spend], ["DETAIL_AD_SELISIH", 500_000]);
});

test("audit: override total rentang menggantikan detail Ad pada rentangnya; sub-rentang laporan → RENTANG_TIDAK_COCOK (tanpa prorata)", () => {
  const ad = new Map([["2026-10-20", 1e5], ["2026-10-21", 1e5], ["2026-10-22", 1e5]]);
  const blok = M({ kind: "TOTAL_RENTANG", dateFrom: "2026-10-20", dateTo: "2026-10-22", amount: 900_000, override: true });
  const penuh = hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-22", hariIni: HARI_INI, entries: [blok], adHarian: ad });
  assert.deepEqual([penuh.status, penuh.spend, penuh.overrideMenggantikanDetailHari.length], ["LENGKAP", 900_000, 3]);
  const sub = hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-21", hariIni: HARI_INI, entries: [blok], adHarian: ad });
  assert.deepEqual([sub.status, sub.spend], ["RENTANG_TIDAK_COCOK", null]);
});

test("audit: entri manual akun berbeda pada hari tanpa detail dijumlah (akun terpisah); total semua-akun yang menimpa entri akun = KONFLIK", () => {
  const a = M({ dateFrom: "2026-10-20", dateTo: "2026-10-20", accountId: "111111", amount: 100 }), b = M({ dateFrom: "2026-10-20", dateTo: "2026-10-20", accountId: "222222", amount: 50 });
  assert.equal(rencanakan({ sumber: "META", jenis: "HARIAN", dari: "2026-10-20", sampai: "2026-10-20", akun: "222222", nominal: 50, override: false }, [{ ...a }]).aksi, "BARU");
  assert.equal(hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-20", hariIni: HARI_INI, entries: [a, b] }).spend, 150);
  assert.equal(rencanakan({ sumber: "META", jenis: "TOTAL_RENTANG", dari: "2026-10-19", sampai: "2026-10-21", akun: "", nominal: 1, override: false }, [a]).aksi, "KONFLIK");
});

test("audit: rencanakan — edit override (false→true) = UBAH pada entri yang SAMA; pencabutan (true→false) juga UBAH; nilai sama = TIDAK_BERUBAH", () => {
  const i = { sumber: "META", jenis: "HARIAN", dari: "2026-10-20", sampai: "2026-10-20", akun: "", nominal: 100, override: true };
  const ada = M({ amount: 100, override: false });
  assert.equal(rencanakan(i, [ada]).aksi, "UBAH");
  assert.equal(rencanakan({ ...i, override: false }, [{ ...ada, override: true }]).aksi, "UBAH");
  assert.equal(rencanakan({ ...i, override: false }, [ada]).aksi, "TIDAK_BERUBAH");
});
