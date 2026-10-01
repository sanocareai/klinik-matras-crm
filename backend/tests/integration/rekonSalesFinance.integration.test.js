// REKONSILIASI SALES–FINANCE (30 Sep 2026). Yang dikunci:
//  - bridge Uang Masuk Terverifikasi → Nilai Order yang Menjadi Lunas: residual 0, komponen DP / ongkir / Tanpa Sales / DP periode sebelumnya /
//    refund / batal / Lunas-tanpa-Payment tepat, dan angka akhir SAMA dengan Total Tim di /analytics/sales-report (satu definisi);
//  - Tanpa Sales tidak diberikan ke Sales mana pun (leaderboard individu), tetapi ikut Total Perusahaan; pemilik eksplisit (salesOwnerId) menang;
//  - batas tanggal WIB; Payment dibatalkan/diganti/belum terverifikasi tidak dihitung;
//  - izin Sales/Finance/Admin/lainnya; drill-down hanya Finance/Admin; penugasan ulang diaudit; pemilik order baru stabil.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { createOrderForCustomer } from "../../src/services/orderCreation.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server; let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const PERIODE = "from=2026-09-01&to=2026-09-30";
let seq = 0;

async function login(roles, nama) {
  const u = await createLoginUser({ roles });
  if (nama) await testPrisma.user.update({ where: { id: u.user.id }, data: { name: nama } });
  const r = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  assert.equal(r.status, 200);
  return { ...u, token: r.body.token };
}
async function pelanggan(nama, { sales = null, tambahan = [] } = {}) {
  seq += 1;
  const c = await testPrisma.customer.create({ data: { phone: `62812000${String(seq).padStart(5, "0")}`, name: nama, pipelineStage: "TRANSACTION" } });
  // Satu percakapan per (pelanggan, channel): Sales kedua memegang percakapan di channel lain (mis. Instagram).
  const daftar = [sales, ...tambahan].filter(Boolean);
  for (let i = 0; i < daftar.length; i++) await testPrisma.conversation.create({ data: { customerId: c.id, channel: i === 0 ? "WHATSAPP" : "INSTAGRAM", assignedToId: daftar[i], type: "INDIVIDUAL" } });
  return c;
}
async function order(c, { nilai, ongkir = null, status = "DELIVERED", paidAt = null, ps = "LUNAS", owner = null }) {
  seq += 1;
  return testPrisma.order.create({ data: { customerId: c.id, orderNumber: `RK-${Date.now()}-${seq}`, category: "LAYANAN", status, value: nilai, ongkir, paymentStatus: ps, paidAt, salesOwnerId: owner } });
}
async function bayar(o, amount, tgl, { verif = true, batal = false, oleh, verifikator } = {}) {
  const p = await testPrisma.payment.create({ data: { orderId: o.id, amount, method: "TRANSFER", recordedById: oleh, createdAt: new Date(tgl), ...(batal && { cancelledAt: new Date(), cancelReason: "uji" }) } });
  if (verif) await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: verifikator } });
  return p;
}
const garis = (r, k) => r.bridge.find((b) => b.kunci === k);

async function dunia() {
  const admin = await login(["ADMIN"], "Admin Uji");
  const finance = await login(["FINANCE"], "Finance Uji");
  const kiki = await login(["SALES"], "Kiki");
  const fadlan = await login(["SALES"], "Fadlan");
  const driver = await login(["DRIVER"], "Driver Uji");
  const kw = { oleh: kiki.user.id, verifikator: finance.user.id };
  return { admin, finance, kiki, fadlan, driver, kw };
}

// Skenario mirip audit produksi (angka diperkecil): uang masuk vs nilai lunas dengan DP, ongkir, Tanpa Sales, DP sebelumnya, refund, batal, Lunas tanpa Payment.
async function skenario(w) {
  const { kiki, fadlan, kw } = w;
  const cKiki = await pelanggan("Pelanggan Kiki", { sales: kiki.user.id });
  const cFadlan = await pelanggan("Pelanggan Fadlan", { sales: fadlan.user.id });
  const cTanpa = await pelanggan("Order Internal KML");                       // tanpa percakapan atribusi
  const cPemilik = await pelanggan("Pelanggan Pemilik Eksplisit");             // tanpa percakapan TETAPI order punya salesOwnerId = Kiki

  const o1 = await order(cKiki, { nilai: 1_000_000, paidAt: new Date("2026-09-10T05:00:00Z") });                 // normal, cocok persis
  await bayar(o1, 1_000_000, "2026-09-10T05:00:00Z", kw);
  const o2 = await order(cFadlan, { nilai: 500_000, ongkir: 200_000, paidAt: new Date("2026-09-12T05:00:00Z") }); // ongkir ikut Payment
  await bayar(o2, 700_000, "2026-09-12T05:00:00Z", kw);
  const o3 = await order(cKiki, { nilai: 4_500_000, status: "READY", ps: "DP" });                                // DP belum lunas
  await bayar(o3, 2_250_000, "2026-09-05T05:00:00Z", kw);
  const o4 = await order(cTanpa, { nilai: 4_000_000, paidAt: new Date("2026-09-20T05:00:00Z") });                // Tanpa Sales
  await bayar(o4, 4_000_000, "2026-09-20T05:00:00Z", kw);
  const o5 = await order(cFadlan, { nilai: 800_000, paidAt: new Date("2026-09-25T05:00:00Z") });                // DP Agustus + pelunasan September
  await bayar(o5, 300_000, "2026-08-20T05:00:00Z", kw);
  await bayar(o5, 500_000, "2026-09-25T05:00:00Z", kw);
  const o6 = await order(cKiki, { nilai: 600_000, paidAt: new Date("2026-09-03T05:00:00Z") });                   // Lunas menurut Sales tanpa Payment
  const o7 = await order(cPemilik, { nilai: 700_000, paidAt: new Date("2026-09-15T05:00:00Z"), owner: kiki.user.id }); // pemilik eksplisit
  await bayar(o7, 700_000, "2026-09-15T05:00:00Z", kw);
  const o8 = await order(cFadlan, { nilai: 900_000, paidAt: new Date("2026-09-18T05:00:00Z") });                 // refund atas order lunas
  await bayar(o8, 1_000_000, "2026-09-18T05:00:00Z", kw);
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const rek = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  await testPrisma.finRefund.create({ data: { refundNumber: `RF-${seq}`, orderId: o8.id, amount: 100_000, status: "DISETUJUI", reason: "uji", cashAccountId: rek.id, createdById: kw.verifikator, date: new Date("2026-09-19T00:00:00Z") } });
  const o9 = await order(cKiki, { nilai: 300_000, status: "CANCELLED", ps: "DP" });                              // batal tetapi ada uang
  await bayar(o9, 150_000, "2026-09-06T05:00:00Z", kw);
  // Yang TIDAK boleh ikut: belum diverifikasi, dibatalkan/diganti, dan di luar batas WIB
  const o10 = await order(cKiki, { nilai: 111_000, paidAt: new Date("2026-09-08T05:00:00Z") });
  await bayar(o10, 111_000, "2026-09-08T05:00:00Z", { ...kw, verif: false });
  await bayar(o10, 111_000, "2026-09-08T06:00:00Z", { ...kw, batal: true });
  await bayar(o1, 999_000, "2026-09-30T17:00:00Z", kw);   // 1 Okt 00:00 WIB → di luar
  await bayar(o1, 888_000, "2026-08-31T16:59:59Z", kw);   // 31 Agu 23:59:59 WIB → di luar (dan bukan DP karena order sudah lunas Sep)
  return { o1, o2, o3, o4, o5, o6, o7, o8, o9, o10 };
}

test("BRIDGE: residual 0; komponen tepat (DP, ongkir, Tanpa Sales, DP periode sebelumnya, refund, batal, Lunas tanpa Payment); angka akhir = Total Tim laporan Sales", async () => {
  const w = await dunia();
  await skenario(w);
  const r = await raw("GET", `/api/sales-finance/rekon?${PERIODE}`, { token: w.admin.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body;
  assert.equal(b.residual, 0, "bridge harus menutup persis");

  // Uang masuk periode: o1 1.000.000 + o2 700.000 + o3 2.250.000 + o4 4.000.000 + o5 500.000 + o7 700.000 + o8 1.000.000 + o9 150.000
  assert.equal(garis(b, "UANG_MASUK").jumlah, 10_300_000);
  assert.equal(garis(b, "DP_BELUM_LUNAS").jumlah, 2_250_000, "DP order belum lunas");
  assert.equal(garis(b, "ORDER_TIDAK_DIHITUNG").jumlah, 150_000, "order batal tetapi ada uang");
  // DP sebelum periode: o5 300.000 (DP Agustus) + o1 888.000 (uang diterima 31 Agu 23:59:59 WIB, order-nya lunas September → juga DP periode sebelumnya)
  assert.equal(garis(b, "DP_SEBELUMNYA").jumlah, 1_188_000, "DP periode sebelumnya untuk order yang baru lunas September");
  assert.equal(garis(b, "REFUND_LUNAS").jumlah, 100_000);
  assert.equal(garis(b, "ONGKIR").jumlah, 200_000);
  // Selisih lain: o1 +888.000 (kelebihan: 1.000.000 + 888.000 DP lama vs nilai 1.000.000), o6 −600.000 (Lunas tanpa Payment), o10 −111.000 (Payment belum diverifikasi/dibatalkan).
  // Refund tidak mengubah selisih lain (o8: 1.000.000 − 100.000 = 900.000 = nilai).
  assert.equal(garis(b, "SELISIH_LAIN").jumlah, 888_000 - 600_000 - 111_000);
  // Total perusahaan = Σ nilai order lunas Sep: o1 1.000.000 + o2 500.000 + o4 4.000.000 + o5 800.000 + o6 600.000 + o7 700.000 + o8 900.000 + o10 111.000
  assert.equal(garis(b, "TOTAL_PERUSAHAAN").jumlah, 8_611_000);
  assert.equal(garis(b, "TANPA_SALES").jumlah, 4_000_000, "hanya order tanpa pemilik & tanpa percakapan Sales");
  assert.equal(garis(b, "NILAI_LUNAS_SALES").jumlah, 4_611_000);
  assert.equal(b.kartu.tanpaAtribusiSales, 4_000_000);
  assert.equal(b.kartu.dpBelumLunas, 2_250_000);
  assert.equal(b.kartu.ongkirDiterima, 200_000);
  assert.equal(b.kartu.totalPerusahaan, 8_611_000);

  // SATU definisi dengan laporan Sales: angka akhir bridge == Total Tim /sales-report
  const sr = await raw("GET", `/api/analytics/sales-report?${PERIODE}`, { token: w.admin.token });
  assert.equal(sr.status, 200, JSON.stringify(sr.body).slice(0, 300));
  const kartuTim = (sr.body.total.collectedValue || 0) + sr.body.rows.filter((x) => x.isTeamLead).reduce((s, x) => s + x.collectedValue, 0); // sama dengan computeTeamTarget().teamCollectedAll
  assert.equal(kartuTim, b.kartu.nilaiLunasSales, "bridge == Nilai Lunas Tim di laporan Sales");
  // Leaderboard individu tidak menerima Tanpa Sales; pemilik eksplisit (o7, tanpa percakapan) masuk Kiki
  const baris = Object.fromEntries(sr.body.rows.filter((x) => !x.isTeamLead).map((x) => [x.name, x]));
  assert.equal(baris.Kiki.collectedValue, 1_000_000 + 600_000 + 700_000 + 111_000, "Kiki: o1 + o6 + o7 (pemilik eksplisit) + o10");
  assert.equal(baris.Fadlan.collectedValue, 500_000 + 800_000 + 900_000);
  assert.equal(Object.values(baris).reduce((s, x) => s + x.collectedValue, 0), 4_611_000, "jumlah baris personal = angka akhir; Rp4.000.000 Tanpa Sales tidak dibagikan");
});

test("DRILL-DOWN: daftar order penyusun (DP sampai order & Payment; tiga nilai jasa/ongkir/tagihan) hanya untuk Finance/Admin; Sales hanya angka", async () => {
  const w = await dunia();
  const { o3, o2, o4 } = await skenario(w);
  const f = (await raw("GET", `/api/sales-finance/rekon?${PERIODE}`, { token: w.finance.token })).body;
  assert.equal(f.detailTersedia, true);
  const dp = f.detail.DP_BELUM_LUNAS;
  assert.equal(dp.length, 1);
  assert.equal(dp[0].orderId, o3.id);
  assert.equal(dp[0].pembayaran.length, 1);
  assert.equal(dp[0].pembayaran[0].nominal, 2_250_000);
  assert.equal(dp[0].sisaTagihan, 2_250_000);
  const ong = f.detail.ONGKIR.find((x) => x.orderId === o2.id);
  assert.deepEqual([ong.nilaiJasa, ong.ongkir, ong.totalTagihan], [500_000, 200_000, 700_000], "tiga nilai terpisah");
  assert.equal(f.detail.TANPA_SALES[0].orderId, o4.id);

  const s = await raw("GET", `/api/sales-finance/rekon?${PERIODE}`, { token: w.kiki.token });
  assert.equal(s.status, 200);
  assert.equal(s.body.detailTersedia, false, "Sales tidak melihat daftar order penyusun");
  assert.equal(s.body.detail, undefined);
  assert.equal(s.body.kartu.tanpaAtribusiSales, 4_000_000, "angka ringkasan tetap tampil");
});

test("Kasus tepi: order dipegang 2 Sales dihitung ganda dan dilaporkan; batas WIB awal/akhir periode; pemilik eksplisit non-Sales tidak dihitung ke Sales", async () => {
  const w = await dunia();
  const c = await pelanggan("Dua Sales", { sales: w.kiki.user.id, tambahan: [w.fadlan.user.id] });
  const o = await order(c, { nilai: 1_000_000, paidAt: new Date("2026-08-31T17:00:00Z") });       // tepat 1 Sep 00:00 WIB → masuk
  await bayar(o, 1_000_000, "2026-08-31T17:00:00Z", w.kw);
  const luar = await order(await pelanggan("Batas Luar", { sales: w.kiki.user.id }), { nilai: 2_000_000, paidAt: new Date("2026-09-30T17:00:00Z") }); // 1 Okt 00:00 WIB → di luar
  await bayar(luar, 2_000_000, "2026-09-30T17:00:00Z", w.kw);
  const nonSales = await order(await pelanggan("Pemilik Finance"), { nilai: 400_000, paidAt: new Date("2026-09-09T05:00:00Z"), owner: w.finance.user.id });
  await bayar(nonSales, 400_000, "2026-09-09T05:00:00Z", w.kw);
  const b = (await raw("GET", `/api/sales-finance/rekon?${PERIODE}`, { token: w.admin.token })).body;
  assert.equal(b.residual, 0);
  assert.equal(garis(b, "UANG_MASUK").jumlah, 1_400_000, "batas awal masuk, batas akhir (eksklusif) tidak");
  assert.equal(garis(b, "DIHITUNG_GANDA").jumlah, 1_000_000, "order dipegang 2 Sales dihitung 2x di laporan per-Sales");
  assert.equal(garis(b, "TANPA_SALES").jumlah, 400_000, "pemilik eksplisit bukan Sales aktif → Tanpa Sales");
  const sr = await raw("GET", `/api/analytics/sales-report?${PERIODE}`, { token: w.admin.token });
  assert.equal((sr.body.total.collectedValue || 0) + sr.body.rows.filter((x) => x.isTeamLead).reduce((s, x) => s + x.collectedValue, 0), b.kartu.nilaiLunasSales);
});

test("Izin: tanpa login 401; Driver 403; periode wajib & valid 400; Admin/Finance/Sales 200", async () => {
  const w = await dunia();
  assert.equal((await raw("GET", `/api/sales-finance/rekon?${PERIODE}`)).status, 401);
  assert.equal((await raw("GET", `/api/sales-finance/rekon?${PERIODE}`, { token: w.driver.token })).status, 403);
  assert.equal((await raw("GET", "/api/sales-finance/rekon", { token: w.admin.token })).status, 400);
  assert.equal((await raw("GET", "/api/sales-finance/rekon?from=x&to=y", { token: w.admin.token })).status, 400);
  for (const u of [w.admin, w.finance, w.kiki]) assert.equal((await raw("GET", `/api/sales-finance/rekon?${PERIODE}`, { token: u.token })).status, 200);
});

test("PEMILIK SALES: order baru memakai pembuat bila SALES, atau pemilik lead bila SALES, selain itu kosong (tidak ditebak); penugasan ulang eksplisit, beralasan, diaudit, hanya Admin", async () => {
  const w = await dunia();
  const cLead = await testPrisma.customer.create({ data: { phone: "6281299000001", name: "Lead Milik Fadlan", pipelineStage: "TRANSACTION", assignedSalesId: w.fadlan.user.id } });
  const cKosong = await testPrisma.customer.create({ data: { phone: "6281299000002", name: "Tanpa Pemilik", pipelineStage: "TRANSACTION" } });
  const body = { notes: "{}", unitCount: 1 };
  const a = await createOrderForCustomer(cLead.id, body, w.kiki.user.id);        // pembuat SALES → Kiki (bukan pemilik lead)
  const b = await createOrderForCustomer(cLead.id, body, w.admin.user.id);       // pembuat Admin → pemilik lead (Fadlan)
  const c = await createOrderForCustomer(cKosong.id, body, w.finance.user.id);   // tidak ada sumber → null
  const ambil = async (o) => (await testPrisma.order.findUnique({ where: { id: o.id }, select: { salesOwnerId: true } })).salesOwnerId;
  assert.equal(await ambil(a), w.kiki.user.id);
  assert.equal(await ambil(b), w.fadlan.user.id);
  assert.equal(await ambil(c), null, "tidak ditebak dari percakapan");

  // penugasan ulang
  assert.equal((await raw("POST", `/api/sales-finance/orders/${c.id}/pemilik`, { token: w.kiki.token, body: { userId: w.kiki.user.id, alasan: "coba" } })).status, 403);
  assert.equal((await raw("POST", `/api/sales-finance/orders/${c.id}/pemilik`, { token: w.admin.token, body: { userId: w.kiki.user.id } })).status, 400, "alasan wajib");
  assert.equal((await raw("POST", `/api/sales-finance/orders/${c.id}/pemilik`, { token: w.admin.token, body: { userId: w.finance.user.id, alasan: "x" } })).status, 400, "harus Sales aktif");
  const ok = await raw("POST", `/api/sales-finance/orders/${c.id}/pemilik`, { token: w.admin.token, body: { userId: w.kiki.user.id, alasan: "Order KML dipegang Kiki" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await ambil(c), w.kiki.user.id);
  assert.equal((await raw("POST", `/api/sales-finance/orders/${c.id}/pemilik`, { token: w.admin.token, body: { userId: w.kiki.user.id, alasan: "lagi" } })).status, 409, "sudah sama");
  const ev = await testPrisma.activityEvent.findMany({ where: { entityId: c.id } });
  const audit = ev.find((e) => e.metadata.aksi === "ganti_sales_owner");
  assert.ok(audit && audit.metadata.reason === "Order KML dipegang Kiki");
  assert.equal(audit.metadata.before.salesOwnerId, null);
  assert.equal(audit.metadata.after.salesOwnerId, w.kiki.user.id);
  assert.equal(audit.actorId, w.admin.user.id);
  // kembali ke Tanpa Sales juga eksplisit
  assert.equal((await raw("POST", `/api/sales-finance/orders/${c.id}/pemilik`, { token: w.admin.token, body: { userId: null, alasan: "Salah tetapkan" } })).status, 200);
  assert.equal(await ambil(c), null);
});

test("DUA TAHAP (Fase 1): tahap 1 Uang Masuk→Total Perusahaan & tahap 2 Total Perusahaan→Tim Sales — masing-masing punya pembanding independen, residual Rp0, status 'Perhitungan cocok' TERPISAH dari 'Perlu ditinjau'; baris nol dilipat ke Komponen lain", async () => {
  const w = await dunia();
  await skenario(w);
  const b = (await raw("GET", `/api/sales-finance/rekon?${PERIODE}`, { token: w.admin.token })).body;
  const { tahap1, tahap2 } = b;
  // Tahap 1
  assert.equal(tahap1.mulai.kunci, "UANG_MASUK");
  assert.equal(tahap1.mulai.jumlah, 10_300_000);
  assert.equal(tahap1.akhir.kunci, "TOTAL_PERUSAHAAN");
  assert.equal(tahap1.akhir.jumlah, 8_611_000);
  assert.equal(tahap1.pembanding.jumlah, 8_611_000, "Σ Order.value order lunas periode, dihitung langsung (bukan dari bridge)");
  assert.equal(tahap1.residual, 0);
  assert.equal(tahap1.status.perhitungan, "COCOK");
  assert.equal(tahap1.status.perhitunganLabel, "Perhitungan cocok");
  // Perlu ditinjau ≠ perhitungan: o6 (Lunas tanpa Payment −600.000) + o10 (−111.000) ⇒ ada yang perlu ditinjau walau residual 0
  assert.equal(tahap1.status.perluDitinjau, true);
  const selisih = tahap1.status.alasanTinjau.find((a) => a.kunci === "SELISIH_LAIN");
  assert.equal(selisih.nOrder, 2);
  assert.equal(selisih.jumlah, -711_000);
  // Tahap 2
  assert.equal(tahap2.mulai.kunci, "TOTAL_PERUSAHAAN");
  assert.equal(tahap2.akhir.kunci, "NILAI_LUNAS_SALES");
  assert.equal(tahap2.akhir.jumlah, 4_611_000);
  assert.equal(tahap2.pembanding.jumlah, 4_611_000);
  assert.equal(tahap2.residual, 0);
  assert.equal(tahap2.status.perhitungan, "COCOK");
  assert.equal(tahap2.status.alasanTinjau[0].kunci, "TANPA_SALES");
  assert.equal(tahap2.status.alasanTinjau[0].jumlah, 4_000_000);
  assert.equal(b.status.perhitungan, "COCOK");
  assert.equal(b.status.perluDitinjau, true);
  // Baris nol (mis. Refund pada order yang kembali belum lunas, Dihitung ganda) tidak ditampilkan sendiri, namanya ada di Komponen lain
  assert.ok(!tahap1.langkah.some((l) => l.kunci === "REFUND_NON_LUNAS"));
  assert.ok(tahap1.komponenLain.daftar.some((n) => /Refund pada Order yang Kembali Belum Lunas/.test(n)));
  assert.ok(!tahap2.langkah.some((l) => l.kunci === "DIHITUNG_GANDA"));
  assert.equal(tahap1.komponenLain.jumlah, 0);
  // Penjumlahan langkah yang ditampilkan + komponen lain menutup persis (mulai + Σ tanda×jumlah = akhir)
  const hitung = (t) => t.langkah.slice(1, -1).reduce((s, l) => s + l.tanda * l.jumlah, t.mulai.jumlah);
  assert.equal(hitung(tahap1), tahap1.akhir.jumlah);
  assert.equal(hitung(tahap2), tahap2.akhir.jumlah);
});

test("DUA TAHAP: kasus tepi (dihitung ganda) tetap residual 0 di kedua tahap; periode tanpa data → semua Rp0 'cocok' dan tidak ada yang perlu ditinjau", async () => {
  const w = await dunia();
  const kosong = (await raw("GET", `/api/sales-finance/rekon?from=2026-03-01&to=2026-03-31`, { token: w.admin.token })).body;
  assert.equal(kosong.tahap1.residual, 0);
  assert.equal(kosong.tahap2.residual, 0);
  assert.equal(kosong.status.perluDitinjau, false);
  assert.equal(kosong.tahap1.mulai.jumlah, 0);
  const c = await pelanggan("Dua Sales", { sales: w.kiki.user.id, tambahan: [w.fadlan.user.id] });
  const o = await order(c, { nilai: 1_000_000, paidAt: new Date("2026-09-10T05:00:00Z") });
  await bayar(o, 1_000_000, "2026-09-10T05:00:00Z", w.kw);
  const b = (await raw("GET", `/api/sales-finance/rekon?${PERIODE}`, { token: w.admin.token })).body;
  assert.equal(b.tahap1.residual, 0);
  assert.equal(b.tahap2.residual, 0);
  assert.equal(b.tahap2.akhir.jumlah, 2_000_000, "dipegang 2 Sales → dihitung 2x di laporan per-Sales");
  assert.equal(b.tahap2.status.alasanTinjau.find((a) => a.kunci === "DIHITUNG_GANDA").jumlah, 1_000_000);
  assert.ok(b.tahap2.langkah.some((l) => l.kunci === "DIHITUNG_GANDA"));
});
