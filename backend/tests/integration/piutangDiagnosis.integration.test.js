// DIAGNOSIS PIUTANG — setiap order bersaldo di akun Piutang Usaha masuk SATU kategori dengan alasan + tindakan, dan seluruh kategori menjumlah kembali
// ke saldo neraca (selisih 0). Yang dikunci: kelima kategori (termasuk saldo KREDIT yang tidak tampil di umurPiutang), pemisahan "belum diakui", izin
// (SALES 403), dan kontrak umurPiutang() tidak berubah.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postRevenueRecognition, postPaymentReceived } from "../../src/services/finance/posting/orderRevenue.js";
import { umurPiutang } from "../../src/services/finance/reports.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { resolveAccount } from "../../src/services/finance/accounts.js";
import { PREFIX_KUNCI_PENYESUAIAN } from "../../src/services/finance/piutangDiagnosis.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let n = 0;
async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const kelola = async (nama, { value, status = "DELIVERED", paymentStatus = "BELUM_BAYAR" }) => {
    const customer = await testPrisma.customer.create({ data: { name: nama, assignedSalesId: sales.user.id } });
    return testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `DGN-${String(++n).padStart(3, "0")}`, status, paymentStatus } });
  };
  const diakui = (o) => testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: admin.user.id }));
  const bayar = async (o, amount, { jurnal = true, verifikasi = false, createdAt } = {}) => {
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount, method: "TRANSFER", cashAccountId: bank.id, recordedById: admin.user.id, ...(createdAt && { createdAt }) } });
    if (verifikasi) await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: admin.user.id } });
    if (jurnal) await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: admin.user.id }));
    return p;
  };
  return { admin, sales, kelola, diakui, bayar, a: makeClient(server.baseUrl, admin.token), s: makeClient(server.baseUrl, sales.token) };
}

test("lima kategori + saldo kredit + belum diakui, semuanya menjumlah ke saldo neraca", async () => {
  const { kelola, diakui, bayar, a } = await siapkan();

  const sah = await kelola("Tagihan Sah", { value: 1_000_000 });
  await diakui(sah);

  const dp = await kelola("Tagihan DP", { value: 2_000_000, paymentStatus: "DP" });
  await bayar(dp, 500_000);
  await diakui(dp);

  const lunasTanpa = await kelola("Lunas Tanpa Payment", { value: 3_000_000, paymentStatus: "LUNAS" });
  await diakui(lunasTanpa);

  // Payment historis (sebelum cutoff 2026-09-18) yang terverifikasi tetapi TIDAK PERNAH dijurnal; pendapatan diakui sesudahnya (kasus Stanley).
  const historis = await kelola("Payment Belum Menutup", { value: 1_500_000, paymentStatus: "LUNAS" });
  await bayar(historis, 1_500_000, { jurnal: false, verifikasi: true, createdAt: new Date("2026-09-10T05:00:00Z") });
  await diakui(historis);

  // Nilai order dikurangi SETELAH diakui: diakui 2.000.000, kini 1.200.000, sudah dibayar 1.200.000 → piutang tersisa 800.000.
  const turun = await kelola("Nilai Turun", { value: 2_000_000, paymentStatus: "LUNAS" });
  await diakui(turun);
  await testPrisma.order.update({ where: { id: turun.id }, data: { value: 1_200_000 } });
  await bayar(turun, 1_200_000);

  // Nilai order dinaikkan SETELAH diakui: diakui 250.000, kini 1.250.000, dibayar 1.250.000 → saldo KREDIT −1.000.000 (tidak tampil di umurPiutang).
  const naik = await kelola("Nilai Naik", { value: 250_000, paymentStatus: "LUNAS" });
  await diakui(naik);
  await testPrisma.order.update({ where: { id: naik.id }, data: { value: 1_250_000 } });
  await bayar(naik, 1_250_000);

  // Saldo kredit tanpa selisih nilai: dibayar melebihi tagihan.
  const lebih = await kelola("Lebih Bayar", { value: 1_000_000, paymentStatus: "LUNAS" });
  await diakui(lebih);
  await bayar(lebih, 1_500_000);

  // Belum diakui: belum diserahkan (wajar) dan sudah diserahkan tetapi pendapatan belum pernah diakui (perlu dicek).
  await kelola("Belum Diserahkan", { value: 5_000_000, status: "PROCESSING" });
  const terlewat = await kelola("Terkirim Belum Diakui", { value: 700_000, status: "DELIVERED" });

  const r = await a.get("/api/finance/reports/receivables/diagnosis");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body;

  const per = Object.fromEntries(d.baris.map((b) => [b.customerName, b]));
  assert.equal(per["Tagihan Sah"].kategori, "TAGIHAN_SAH");
  assert.equal(per["Tagihan Sah"].saldoPiutang, 1_000_000);
  assert.equal(per["Tagihan DP"].kategori, "TAGIHAN_SAH");
  assert.equal(per["Tagihan DP"].saldoPiutang, 1_500_000);
  assert.equal(per["Lunas Tanpa Payment"].kategori, "LUNAS_TANPA_PAYMENT");
  assert.match(per["Lunas Tanpa Payment"].tindakan, /Lunas di CRM/);
  assert.equal(per["Payment Belum Menutup"].kategori, "PAYMENT_BELUM_MENUTUP");
  assert.match(per["Payment Belum Menutup"].tindakan, /historis/i, "payment sebelum saldo awal → arahkan ke penuntasan historis");
  assert.equal(per["Nilai Turun"].kategori, "NILAI_BEDA_PENGAKUAN");
  assert.equal(per["Nilai Turun"].saldoPiutang, 800_000);
  assert.match(per["Nilai Turun"].penjelasan, /kelebihan diakui/);
  assert.equal(per["Nilai Naik"].kategori, "NILAI_BEDA_PENGAKUAN");
  assert.equal(per["Nilai Naik"].saldoPiutang, -1_000_000);
  assert.match(per["Nilai Naik"].penjelasan, /kurang diakui/);
  assert.equal(per["Lebih Bayar"].kategori, "KREDIT_LAINNYA");
  assert.equal(per["Lebih Bayar"].saldoPiutang, -500_000);

  // Rekonsiliasi: Σ kategori = saldo neraca = Σ saldo semua baris.
  assert.equal(d.rekonsiliasi.selisih, 0);
  const jumlahBaris = d.baris.reduce((s, b) => s + b.saldoPiutang, 0);
  assert.equal(d.neraca, jumlahBaris);
  assert.equal(d.neraca, 1_000_000 + 1_500_000 + 3_000_000 + 1_500_000 + 800_000 - 1_000_000 - 500_000);
  assert.equal(d.rekonsiliasi.perKategori.TAGIHAN_SAH.jumlah, 2);
  assert.equal(d.rekonsiliasi.perKategori.NILAI_BEDA_PENGAKUAN.total, -200_000);

  // Saldo neraca di buku besar sama dengan angka diagnosis (sumber yang sama dengan neraca).
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_USAHA } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: akun.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  assert.equal(Number(agg._sum.debit) - Number(agg._sum.credit), d.neraca);

  // Belum diakui: 2 order; yang sudah diserahkan tetapi belum diakui disebut sendiri.
  assert.equal(d.belumDiakui.jumlah, 2);
  assert.equal(d.belumDiakui.total, 5_700_000);
  assert.deepEqual(d.belumDiakui.sudahDiserahBelumDiakui.map((x) => x.orderNumber), [terlewat.orderNumber]);

  // Kontrak umurPiutang TIDAK berubah: saldo kredit tidak muncul di daftar lamanya (itulah celah yang ditutup diagnosis).
  const lama = await umurPiutang(testPrisma, {});
  assert.ok(!lama.baris.some((b) => b.sisaTagihan < 0));
});

test("izin: SALES 403, tanpa login 401; tanpa data → bentuk respons tetap utuh", async () => {
  const { s } = await siapkan();
  assert.equal((await s.get("/api/finance/reports/receivables/diagnosis")).status, 403);
  assert.equal((await makeClient(server.baseUrl, null).get("/api/finance/reports/receivables/diagnosis")).status, 401);

  await truncateAll();
  const { a } = await siapkan();
  const r = await a.get("/api/finance/reports/receivables/diagnosis");
  assert.equal(r.status, 200);
  assert.equal(r.body.neraca, 0);
  assert.deepEqual(r.body.baris, []);
  assert.equal(r.body.rekonsiliasi.selisih, 0);
  assert.equal(r.body.belumDiakui.jumlah, 0);
  assert.ok(r.body.kategori.TAGIHAN_SAH);
});

test("keringanan lunas (pengecualian): sisa tagihan riil tampil walau status CRM LUNAS, dengan posisi di buku yang jujur", async () => {
  const { kelola, diakui, bayar, a, admin } = await siapkan();
  const kunci = (o, dicabutAt = null) => testPrisma.orderPaidAtPengecualian.create({ data: { orderId: o.id, paidAtDikunci: new Date("2026-09-30T05:00:00Z"), alasan: "Keringanan target September (uji)", createdById: admin.user.id, dicabutAt } });

  // (a) diserahkan sebelum pembukuan: tanpa jurnal sama sekali, belum bayar → piutang riil yang TIDAK ada di buku (kasus Hotel Discovery)
  const hotel = await kelola("Hotel", { value: 1_000_000, paymentStatus: "LUNAS" });
  await kunci(hotel);
  // (b) belum diserahkan, baru dibayar separuh (terverifikasi) → belum jadi piutang menurut buku (kasus Susi)
  const susi = await kelola("Susi", { value: 4_500_000, status: "SHIPPING", paymentStatus: "LUNAS" });
  await bayar(susi, 2_250_000, { verifikasi: true });
  await kunci(susi);
  // (c) pendapatan sudah diakui, belum dibayar → sudah tercatat sebagai piutang
  const diakuiBelumBayar = await kelola("Diakui", { value: 800_000, paymentStatus: "LUNAS" });
  await diakui(diakuiBelumBayar);
  await kunci(diakuiBelumBayar);
  // (d) sudah dibayar penuh & terverifikasi → bukan keringanan yang tersisa; (e) pengecualian sudah dicabut → tidak dihitung
  const lunasPenuh = await kelola("Lunas Penuh", { value: 600_000, paymentStatus: "LUNAS" });
  await bayar(lunasPenuh, 600_000, { verifikasi: true });
  await kunci(lunasPenuh);
  const dicabut = await kelola("Dicabut", { value: 900_000, paymentStatus: "LUNAS" });
  await kunci(dicabut, new Date());

  const r = await a.get("/api/finance/reports/receivables/diagnosis");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const k = r.body.keringananLunas;
  const per = Object.fromEntries(k.baris.map((b) => [b.customerName, b]));
  assert.deepEqual(Object.keys(per).sort(), ["Diakui", "Hotel", "Susi"]);
  assert.equal(per.Hotel.posisiBuku, "BELUM_DI_BUKU");
  assert.equal(per.Hotel.sisaTagihan, 1_000_000);
  assert.equal(per.Susi.posisiBuku, "BELUM_DISERAHKAN");
  assert.equal(per.Susi.sisaTagihan, 2_250_000);
  assert.equal(per.Susi.terbayarTerverifikasi, 2_250_000);
  assert.equal(per.Diakui.posisiBuku, "SUDAH_DI_BUKU");
  assert.equal(per.Diakui.sisaTagihan, 800_000);
  assert.equal(k.jumlah, 3);
  assert.equal(k.totalSisa, 4_050_000);
  assert.equal(k.totalBelumDiBuku, 1_000_000);
  assert.equal(k.totalSudahDiBuku, 800_000);
  assert.equal(k.totalBelumDiserahkan, 2_250_000);
});

test("jurnal penyesuaian pengakuan ikut dihitung sebagai 'diakui' — order yang sudah disesuaikan tidak lagi dituduh nilai-berubah", async () => {
  const { kelola, diakui, admin, a } = await siapkan();
  const o = await kelola("Sudah Disesuaikan", { value: 2_000_000 });
  await diakui(o);
  await testPrisma.order.update({ where: { id: o.id }, data: { value: 1_200_000 } });
  const sebelum = (await a.get("/api/finance/reports/receivables/diagnosis")).body.baris.find((b) => b.orderId === o.id);
  assert.equal(sebelum.kategori, "NILAI_BEDA_PENGAKUAN");

  await testPrisma.$transaction(async (tx) => {
    const piutang = await resolveAccount(tx, SYSTEM_KEYS.PIUTANG_USAHA);
    const pendapatan = await resolveAccount(tx, SYSTEM_KEYS.PENDAPATAN_LAYANAN);
    await postJournal(tx, { date: new Date("2026-10-06"), description: "uji penyesuaian", source: "MANUAL", idempotencyKey: `${PREFIX_KUNCI_PENYESUAIAN}${o.id}:1200000`, userId: admin.user.id,
      lines: [{ accountId: pendapatan.id, debit: 800_000, orderId: o.id }, { accountId: piutang.id, credit: 800_000, orderId: o.id }] });
  });
  const sesudah = (await a.get("/api/finance/reports/receivables/diagnosis")).body.baris.find((b) => b.orderId === o.id);
  assert.equal(sesudah.saldoPiutang, 1_200_000);
  assert.equal(sesudah.diakui, 1_200_000);
  assert.equal(sesudah.kategori, "TAGIHAN_SAH");
});

// ── Kontrak layar Piutang yang didesain ulang (Okt 2026): field AKSI ADITIF; angka lama TIDAK berubah ─────────────────────────────────────────────
test("umurPiutang: field lama identik; tambahan aditif (tagihanDiakui/sudahDilunasi/statusBayar/jatuhTempo) konsisten dengan saldo ledger yang sama", async () => {
  const { kelola, diakui, bayar, a } = await siapkan();
  const belum = await kelola("Belum Bayar", { value: 1_000_000 });
  await diakui(belum);
  const dp = await kelola("Dibayar Sebagian", { value: 2_000_000, paymentStatus: "DP" });
  await diakui(dp);
  await bayar(dp, 500_000);
  // order dengan invoice jatuh tempo 3 hari lagi (dalam 7 hari) dan satu lewat 10 hari
  const hariIni = new Date();
  const inv = async (o, hari, no) => testPrisma.invoice.create({ data: { invoiceNumber: no, orderId: o.id, dueDate: new Date(Date.UTC(hariIni.getUTCFullYear(), hariIni.getUTCMonth(), hariIni.getUTCDate() + hari)) } });
  await inv(belum, 3, "INV-UJI-001");
  await inv(dp, -10, "INV-UJI-002");

  // Posisi = HARI INI (seperti layar Piutang): tanpa ?to= server memakai akhir bulan, yang menggeser acuan "jatuh tempo ≤7 hari".
  const hariIniWib = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const r = await a.get(`/api/finance/reports/receivables?to=${hariIniWib}`);
  assert.equal(r.status, 200);
  const langsung = await umurPiutang(testPrisma, { to: new Date(`${hariIniWib}T00:00:00.000Z`) });
  // kontrak lama: kunci & isi baris yang sudah ada tidak berubah
  const kunciLama = ["orderId", "orderNumber", "invoiceNumber", "customerId", "customerName", "salesName", "nilaiOrder", "sisaTagihan", "dueDate", "sumberJatuhTempo", "hariLewat", "ember", "orderStatus"];
  for (const b of r.body.baris) for (const k of kunciLama) assert.ok(k in b, `kunci lama ${k} hilang`);
  assert.equal(r.body.total, langsung.total);
  assert.equal(r.body.baris.reduce((s, b) => s + b.sisaTagihan, 0), r.body.total);

  const byNo = Object.fromEntries(r.body.baris.map((b) => [b.orderNumber, b]));
  const bb = byNo[belum.orderNumber]; const ds = byNo[dp.orderNumber];
  assert.deepEqual([bb.tagihanDiakui, bb.sudahDilunasi, bb.sisaTagihan, bb.statusBayar], [1_000_000, 0, 1_000_000, "BELUM_BAYAR"]);
  assert.deepEqual([ds.tagihanDiakui, ds.sudahDilunasi, ds.sisaTagihan, ds.statusBayar], [2_000_000, 500_000, 1_500_000, "DIBAYAR_SEBAGIAN"]);
  assert.ok(bb.tanggalOrder);
  // ringkas jatuh tempo dari baris yang sama
  assert.equal(r.body.jatuhTempo.lewat.jumlah, r.body.baris.filter((b) => b.hariLewat > 0).length);
  assert.equal(r.body.jatuhTempo.lewat.total, r.body.baris.filter((b) => b.hariLewat > 0).reduce((s, b) => s + b.sisaTagihan, 0));
  assert.equal(r.body.jatuhTempo.tujuhHari.jumlah, r.body.baris.filter((b) => b.hariLewat <= 0 && b.hariLewat >= -7).length);
  assert.equal(r.body.jatuhTempo.tujuhHari.jumlah, 1, "order dengan invoice jatuh tempo 3 hari lagi");
  assert.equal(r.body.jatuhTempo.tujuhHari.total, 1_000_000);
});

test("diagnosis: perluTindakan (aditif) = baris selain Tagihan sah + sudah diserahkan belum diakui + keringanan belum di buku; kategori lama identik", async () => {
  const { kelola, diakui, bayar, a } = await siapkan();
  const sah = await kelola("Tagihan Sah", { value: 1_000_000 }); await diakui(sah);
  const lunasTanpa = await kelola("Lunas Tanpa Payment", { value: 3_000_000, paymentStatus: "LUNAS" }); await diakui(lunasTanpa);
  const lebih = await kelola("Lebih Bayar", { value: 1_000_000, paymentStatus: "LUNAS" }); await diakui(lebih); await bayar(lebih, 1_500_000);
  await kelola("Diserahkan Belum Diakui", { value: 700_000, status: "DELIVERED" });
  await kelola("Belum Diserahkan", { value: 5_000_000, status: "PROCESSING" });

  const d = await a.get("/api/finance/reports/receivables/diagnosis");
  assert.equal(d.status, 200);
  const per = d.body.rekonsiliasi.perKategori;
  const nonSah = ["ORDER_DIBATALKAN", "NILAI_BEDA_PENGAKUAN", "PAYMENT_BELUM_MENUTUP", "LUNAS_TANPA_PAYMENT", "KREDIT_LAINNYA"].reduce((s, k) => s + (per[k]?.jumlah ?? 0), 0);
  assert.equal(per.TAGIHAN_SAH.jumlah, 1);
  assert.equal(d.body.perluTindakan.perSumber.ledger.jumlah, nonSah);
  assert.equal(d.body.perluTindakan.perSumber.sudahDiserahBelumDiakui.jumlah, d.body.belumDiakui.sudahDiserahBelumDiakui.length);
  assert.equal(d.body.perluTindakan.perSumber.sudahDiserahBelumDiakui.jumlah, 1);
  // jumlah = ORDER UNIK; pada data ini tiap order hanya punya satu alasan sehingga sama dengan jumlah per sumber
  assert.equal(d.body.perluTindakan.jumlah, d.body.perluTindakanOrder.length);
  assert.equal(d.body.perluTindakan.jumlah, d.body.perluTindakan.perSumber.ledger.jumlah + d.body.perluTindakan.perSumber.sudahDiserahBelumDiakui.jumlah + d.body.perluTindakan.perSumber.keringananBelumDiBuku.jumlah + d.body.perluTindakan.perSumber.tanggalLunasBeda.jumlah);
  assert.ok(d.body.perluTindakan.jumlah >= 3);
  // saldo neraca & rekonsiliasi tetap cocok
  assert.equal(d.body.rekonsiliasi.selisih, 0);
});

test("detail order piutang: invoice, pembayaran (aktif + batal), jurnal akun Piutang Usaha, riwayat; 404 order tak ada; SALES 403", async () => {
  const { kelola, diakui, bayar, a, s } = await siapkan();
  const o = await kelola("Detail Uji", { value: 2_000_000, paymentStatus: "DP" });
  await diakui(o);
  const p = await bayar(o, 600_000);
  const batal = await bayar(o, 100_000);
  await testPrisma.payment.update({ where: { id: batal.id }, data: { cancelledAt: new Date(), cancelReason: "salah input" } });
  await testPrisma.invoice.create({ data: { invoiceNumber: "INV-DET-001", orderId: o.id } });
  const r = await a.get(`/api/finance/reports/receivables/order/${o.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.order.nomor, o.orderNumber);
  assert.equal(r.body.invoice.nomor, "INV-DET-001");
  assert.equal(r.body.pembayaran.length, 2);
  assert.deepEqual(r.body.pembayaran.map((x) => x.dibatalkan), [false, true]);
  assert.equal(r.body.tagihan.tagihanDiakui, 2_000_000); assert.equal(r.body.tagihan.sudahDilunasi, 700_000);
  assert.ok(r.body.jurnal.length >= 2);
  assert.ok(r.body.jurnal.every((j) => typeof j.debit === "number" && typeof j.kredit === "number"));
  assert.ok(Array.isArray(r.body.riwayat));
  assert.ok(!JSON.stringify(r.body).includes("proofPhoto"), "bukti foto mentah tidak dikirim");
  assert.equal((await a.get("/api/finance/reports/receivables/order/tidak-ada")).status, 404);
  assert.equal((await s.get(`/api/finance/reports/receivables/order/${o.id}`)).status, 403);
  void p;
});

// ── Perlu Tindakan: kategori "Tanggal lunas berbeda dari tanggal pembayaran yang melunasi" (read-model server) ────────────────────────────────────
async function lunasDenganTanggal(ctx, nama, { value = 1_000_000, bayarPada, paidAt, nilaiBayar = value }) {
  const o = await ctx.kelola(nama, { value, paymentStatus: "LUNAS" });
  await ctx.diakui(o);
  await ctx.bayar(o, nilaiBayar, { verifikasi: true, createdAt: new Date(bayarPada) });
  if (paidAt) await testPrisma.order.update({ where: { id: o.id }, data: { paidAt: new Date(paidAt) } });
  return o;
}

test("tanggal lunas ≠ tanggal pembayaran melunasi: terdeteksi; sama = tidak; batas hari WIB benar; paidAt & Payment TIDAK diubah; piutang & jurnal tidak berubah", async () => {
  const ctx = await siapkan();
  const { a } = ctx;
  const beda = await lunasDenganTanggal(ctx, "Beda Tanggal", { bayarPada: "2026-10-05T03:00:00Z", paidAt: "2026-10-08T03:00:00Z" });
  const sama = await lunasDenganTanggal(ctx, "Tanggal Sama", { bayarPada: "2026-10-05T03:00:00Z", paidAt: "2026-10-05T09:00:00Z" });
  // WIB: bayar 2026-10-10T17:30Z = 11 Okt 00:30 WIB; paidAt 2026-10-11T03:00Z = 11 Okt WIB → SAMA hari WIB (beda bila dibaca UTC)
  const batasSama = await lunasDenganTanggal(ctx, "Batas WIB Sama", { bayarPada: "2026-10-10T17:30:00Z", paidAt: "2026-10-11T03:00:00Z" });
  // paidAt 2026-10-10T16:00Z = 10 Okt 23:00 WIB; bayar 11 Okt 00:30 WIB → beda 1 hari
  const batasBeda = await lunasDenganTanggal(ctx, "Batas WIB Beda", { bayarPada: "2026-10-10T17:30:00Z", paidAt: "2026-10-10T16:00:00Z" });
  // timestamp backfill 31 Agt 2026 bukan tanggal sungguhan → tidak dituduh
  const backfill = await lunasDenganTanggal(ctx, "Backfill", { bayarPada: "2026-08-20T03:00:00Z", paidAt: "2026-08-31T05:35:57.201Z" });

  const sebelumUmur = await a.get("/api/finance/reports/receivables?to=2026-10-31");
  const sebelumDb = {
    paidAt: (await testPrisma.order.findMany({ where: { id: { in: [beda.id, sama.id, batasSama.id, batasBeda.id, backfill.id] } }, orderBy: { id: "asc" }, select: { id: true, paidAt: true } })).map((o) => [o.id, o.paidAt?.toISOString()]),
    payments: await testPrisma.payment.count(), jurnal: await testPrisma.finJournalEntry.count(),
  };
  const d = await a.get("/api/finance/reports/receivables/diagnosis?to=2026-10-31");
  assert.equal(d.status, 200);
  const ids = d.body.perluTindakanOrder.filter((e) => e.alasan.some((x) => x.kode === "TANGGAL_LUNAS_BEDA")).map((e) => e.orderNumber).sort();
  assert.deepEqual(ids, [beda.orderNumber, batasBeda.orderNumber].sort());
  const e = d.body.perluTindakanOrder.find((x) => x.orderId === beda.id);
  const al = e.alasan.find((x) => x.kode === "TANGGAL_LUNAS_BEDA");
  assert.equal(al.label, "Tanggal lunas berbeda dari tanggal pembayaran yang melunasi");
  assert.deepEqual([al.tanggalLunasCrm, al.tanggalPembayaranMelunasi, al.selisihHari], ["2026-10-08", "2026-10-05", 3]);
  const eb = d.body.perluTindakanOrder.find((x) => x.orderId === batasBeda.id).alasan.find((x) => x.kode === "TANGGAL_LUNAS_BEDA");
  assert.deepEqual([eb.tanggalLunasCrm, eb.tanggalPembayaranMelunasi, eb.selisihHari], ["2026-10-10", "2026-10-11", -1]);
  assert.equal(d.body.perluTindakan.perSumber.tanggalLunasBeda.jumlah, 2);

  // TIDAK mengubah apa pun: paidAt, Payment, jurnal, daftar piutang
  const sesudahDb = {
    paidAt: (await testPrisma.order.findMany({ where: { id: { in: [beda.id, sama.id, batasSama.id, batasBeda.id, backfill.id] } }, orderBy: { id: "asc" }, select: { id: true, paidAt: true } })).map((o) => [o.id, o.paidAt?.toISOString()]),
    payments: await testPrisma.payment.count(), jurnal: await testPrisma.finJournalEntry.count(),
  };
  assert.deepEqual(sesudahDb, sebelumDb);
  const sesudahUmur = await a.get("/api/finance/reports/receivables?to=2026-10-31");
  assert.deepEqual(sesudahUmur.body.baris, sebelumUmur.body.baris, "daftar Piutang tetap berdasarkan ledger");
  assert.equal(sesudahUmur.body.total, sebelumUmur.body.total);
});

test("tanggal lunas dikunci Pengecualian Owner TIDAK masuk Perlu Tindakan (dilaporkan terpisah); pengecualian yang dicabut kembali terdeteksi", async () => {
  const ctx = await siapkan();
  const { a, admin } = ctx;
  const o = await lunasDenganTanggal(ctx, "Dikunci Owner", { bayarPada: "2026-10-05T03:00:00Z", paidAt: "2026-10-09T03:00:00Z" });
  const pe = await testPrisma.orderPaidAtPengecualian.create({ data: { orderId: o.id, paidAtDikunci: new Date("2026-10-09T03:00:00Z"), alasan: "Keputusan Owner target", createdById: admin.user.id } });
  let d = await a.get("/api/finance/reports/receivables/diagnosis?to=2026-10-31");
  assert.equal(d.body.perluTindakanOrder.some((e) => e.orderId === o.id), false);
  assert.equal(d.body.perluTindakan.perSumber.tanggalLunasBeda.dikecualikanPengecualianOwner, 1);
  await testPrisma.orderPaidAtPengecualian.update({ where: { id: pe.id }, data: { dicabutAt: new Date() } });
  d = await a.get("/api/finance/reports/receivables/diagnosis?to=2026-10-31");
  assert.equal(d.body.perluTindakanOrder.some((e) => e.orderId === o.id), true);
});

test("satu order = satu entri Perlu Tindakan walau punya beberapa masalah; semua alasan tercantum; jumlah = order unik", async () => {
  const ctx = await siapkan();
  const { kelola, diakui, bayar, a } = ctx;
  // Kasus Stanley: payment historis terverifikasi tanpa jurnal (PAYMENT_BELUM_MENUTUP) DAN paidAt berbeda dari tanggal pembayaran → dua alasan, satu order
  const ganda = await kelola("Dua Masalah", { value: 1_500_000, paymentStatus: "LUNAS" });
  await bayar(ganda, 1_500_000, { jurnal: false, verifikasi: true, createdAt: new Date("2026-09-10T05:00:00Z") });
  await diakui(ganda);
  await testPrisma.order.update({ where: { id: ganda.id }, data: { paidAt: new Date("2026-09-20T05:00:00Z") } });
  // Order dengan satu masalah saja
  const satu = await kelola("Satu Masalah", { value: 3_000_000, paymentStatus: "LUNAS" });
  await diakui(satu);
  const d = await a.get("/api/finance/reports/receivables/diagnosis?to=2026-10-31");
  const entriGanda = d.body.perluTindakanOrder.filter((e) => e.orderId === ganda.id);
  assert.equal(entriGanda.length, 1, "order muncul sekali");
  assert.deepEqual(entriGanda[0].alasan.map((x) => x.kode), ["PAYMENT_BELUM_MENUTUP", "TANGGAL_LUNAS_BEDA"], "semua alasan, urut prioritas");
  assert.equal(entriGanda[0].alasanUtama, "PAYMENT_BELUM_MENUTUP");
  const semuaId = d.body.perluTindakanOrder.map((e) => e.orderId);
  assert.equal(new Set(semuaId).size, semuaId.length, "tidak ada order ganda");
  assert.equal(d.body.perluTindakan.jumlah, semuaId.length);
  assert.equal(d.body.perluTindakan.perAlasan.TANGGAL_LUNAS_BEDA, 1);
  assert.equal(d.body.perluTindakan.perAlasan.PAYMENT_BELUM_MENUTUP, 1);
  assert.equal(d.body.rekonsiliasi.selisih, 0, "rekonsiliasi saldo tidak terpengaruh kategori baru");
});

test("cutoff WIB posisi: jurnal bertanggal posisi ikut, sesudahnya tidak; paidAt sesudah posisi tidak dihitung kategori tanggal lunas", async () => {
  const ctx = await siapkan();
  const { a } = ctx;
  const o = await lunasDenganTanggal(ctx, "Sesudah Posisi", { bayarPada: "2026-10-05T03:00:00Z", paidAt: "2026-10-20T03:00:00Z" });
  const awal = await a.get("/api/finance/reports/receivables/diagnosis?to=2026-10-10");
  const punyaTglBeda = (r) => r.body.perluTindakanOrder.some((e) => e.orderId === o.id && e.alasan.some((x) => x.kode === "TANGGAL_LUNAS_BEDA"));
  assert.equal(punyaTglBeda(awal), false, "paidAt 20 Okt belum terjadi pada posisi 10 Okt (kategori tanggal lunas tidak dihitung)");
  const akhir = await a.get("/api/finance/reports/receivables/diagnosis?to=2026-10-20");
  assert.equal(punyaTglBeda(akhir), true, "paidAt tepat pada hari posisi ikut (inklusif)");
});
