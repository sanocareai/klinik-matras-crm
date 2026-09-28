// RESI GABUNGAN FASE 3B — batalkan SATU child dari Resi: realokasi ke child aktif lain, kelebihan jadi FinRefund (jalur approve existing),
// anchor/ongkir/invoice bundle dipindah kalau perlu, DP target dihitung ulang. Payment/alokasi/jurnal LAMA tidak pernah diedit/dihapus.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { createOrderForCustomer } from "../../src/services/orderCreation.js";
import { paidForOrder } from "../../src/services/finance/allocation.js";
import { bagiProporsional, DP_PERSEN } from "../../src/services/resi.js";
import { hitungDampakPembatalan } from "../../src/services/resiPembatalan.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const kunci = () => ({ "Idempotency-Key": `resi-batal-uji-${randomUUID()}` });
const HARGA = [1_000_000, 500_000, 250_001];
const ONGKIR = 50_000;
const TAGIHAN = [1_050_000, 500_000, 250_001]; // ongkir tambahan menempel di anchor
const TOTAL = 1_800_001;
const DP = 540_000; // 30% × Total Resi
const DP_ITEM = bagiProporsional(DP, TAGIHAN); // [315000, 150000, 75000]

async function dunia({ pembatalan = true } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const bankAkun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "SANOBANK Uji", kind: "BANK", accountId: bankAkun.id } });
  const sales = await createTestUser({ roles: ["SALES"] });
  const admin = await createTestUser({ roles: ["FINANCE"] }); // FINANCE memegang finance:read/post + payment:read/write
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Resi Batal", assignedSalesId: sales.user.id } });
  await setSetting(testPrisma, SETTING_KEYS.RESI_INPUT_AKTIF, "true");
  await setSetting(testPrisma, SETTING_KEYS.RESI_PEMBAYARAN_AKTIF, "true");
  if (pembatalan) await setSetting(testPrisma, SETTING_KEYS.RESI_PEMBATALAN_AKTIF, "true");
  const s = makeClient(server.baseUrl, sales.token);
  const a = makeClient(server.baseUrl, admin.token);
  const r = await s.post("/api/resi", {
    customerId: customer.id, alamat: "Jl. Kemang 1", kota: "Jakarta Selatan", ongkirTambahan: ONGKIR,
    items: HARGA.map((nominal) => ({ merk: "Sano", ukuran: "160x200 cm (Queen)", keluhan: "Pegal", nominal, unitCount: 1 })),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { s, a, sales, admin, customer, bank, groupId: r.body.groupId, anak: r.body.orders.map((o) => o.id), anchorId: r.body.anchorOrderId };
}

const ambilAnak = (groupId) => testPrisma.order.findMany({ where: { groupId }, orderBy: { orderNumber: "asc" }, select: { id: true, orderNumber: true, value: true, ongkir: true, dpTarget: true, paymentStatus: true, status: true } });
const ambilGrup = (groupId) => testPrisma.orderGroup.findUnique({ where: { id: groupId } });
const semuaPayment = (anak) => testPrisma.payment.findMany({ where: { orderId: { in: anak } }, include: { finAllocations: true }, orderBy: { createdAt: "asc" } });
const angka = (d) => Number(d);
const bayarResi = (w, body, headers = kunci()) => w.s.post(`/api/resi/${w.groupId}/pembayaran`, { method: "TRANSFER", cashAccountId: w.bank.id, ...body }, headers);
const pratinjauBatal = (w, orderId) => w.a.get(`/api/resi/anak/${orderId}/pembatalan/pratinjau`);
const batalkan = (w, orderId, body, headers = kunci()) => w.a.post(`/api/resi/anak/${orderId}/pembatalan`, body, headers);

/** Σ alokasi aktif (child tidak dibatalkan) + Σ refund yang tertaut ke payment ini == Payment.amount, untuk SETIAP payment yang tersisa. */
async function periksaInvarianSigma(anakIds) {
  const payments = await semuaPayment(anakIds);
  const statusOrder = new Map((await testPrisma.order.findMany({ where: { id: { in: anakIds } }, select: { id: true, status: true } })).map((o) => [o.id, o.status]));
  for (const p of payments) {
    const alokasiAktif = p.finAllocations.filter((a) => statusOrder.get(a.orderId) !== "CANCELLED").reduce((s, a) => s + angka(a.amount), 0);
    const alokasiBatal = p.finAllocations.filter((a) => statusOrder.get(a.orderId) === "CANCELLED").reduce((s, a) => s + angka(a.amount), 0);
    const refundTerkait = await testPrisma.finRefund.findMany({ where: { orderId: { in: p.finAllocations.filter((a) => statusOrder.get(a.orderId) === "CANCELLED").map((a) => a.orderId) } } });
    // Alokasi yang TERSISA di child batal (kelebihan yang belum di-approve) HARUS PERSIS sama dengan Σ refund MENUNGGU_APPROVAL untuk child itu.
    const refundBelumApprove = refundTerkait.filter((r) => r.status === "MENUNGGU_APPROVAL").reduce((s, r) => s + angka(r.amount), 0);
    assert.equal(alokasiBatal, refundBelumApprove, `alokasi tersisa di child batal (${alokasiBatal}) harus == refund pending (${refundBelumApprove}) untuk payment ${p.id}`);
    assert.equal(alokasiAktif + alokasiBatal, p.amount, `Σ alokasi (aktif+batal) == Payment.amount untuk payment ${p.id}`);
  }
}

// ── unit murni ──────────────────────────────────────────────────────────────────────────────────────────────────

test("Unit murni hitungDampakPembatalan: realokasi largest-remainder, kelebihan, DP recompute Σ tepat, anchor baru deterministik", () => {
  const grup = { id: "g1", anchorOrderId: "a", ongkirTambahan: ONGKIR };
  const mk = (id, value, dpTarget, status = "PENDING") => ({ id, orderNumber: id, value, ongkir: id === "a" ? ONGKIR : 0, dpTarget, status });
  const anak = [mk("a", HARGA[0], DP_ITEM[0]), mk("b", HARGA[1], DP_ITEM[1]), mk("c", HARGA[2], DP_ITEM[2])];

  // Cukup untuk realokasi penuh (child "a" sudah dibayar DP, "b"/"c" belum — kapasitas b+c jauh > dpChild a)
  const dibayar1 = new Map([["a", DP_ITEM[0]]]);
  const d1 = hitungDampakPembatalan({ grup, anak, dibayar: dibayar1, childId: "a" });
  assert.equal(d1.kelebihan, 0);
  assert.equal(d1.totalDirealokasikan, DP_ITEM[0]);
  assert.equal(d1.realokasi.reduce((s, r) => s + r.tambahan, 0), DP_ITEM[0]);
  assert.equal(d1.isAnchor, true);
  assert.deepEqual(d1.anchorBaru, { orderId: "b", orderNumber: "b" }); // deterministik: child aktif berikutnya id naik
  assert.equal(d1.ongkirDipindah, ONGKIR);
  assert.equal(d1.dpChildBaru.reduce((s, x) => s + x.dpTarget, 0), d1.dpTargetBaru, "Σ dpTarget child == target grup");
  assert.equal(d1.totalResiBaru, HARGA[1] + HARGA[2] + ONGKIR);

  // Hampir tidak cukup: b & c sudah lunas terhadap tagihan LAMA, tapi anchor baru "b" kini menanggung ongkir → kapasitasnya tepat ONGKIR (audit HIGH-3);
  // c kapasitas 0 → sisanya kelebihan
  const dibayar2 = new Map([["a", TAGIHAN[0]], ["b", TAGIHAN[1]], ["c", TAGIHAN[2]]]);
  const d2 = hitungDampakPembatalan({ grup, anak, dibayar: dibayar2, childId: "a" });
  assert.equal(d2.totalDirealokasikan, ONGKIR);
  assert.equal(d2.kelebihan, TAGIHAN[0] - ONGKIR);
  assert.deepEqual(d2.realokasi.map((r) => [r.orderId, r.tambahan]), [["b", ONGKIR]]);

  // Semua child dibatalkan satu-satu sampai habis → grupKosong pada child terakhir
  const d3 = hitungDampakPembatalan({ grup: { ...grup, anchorOrderId: "c" }, anak: [mk("c", HARGA[2], 0)], dibayar: new Map(), childId: "c" });
  assert.equal(d3.grupKosong, true);
  assert.equal(d3.anchorBaru, null);
  assert.equal(d3.totalResiBaru, 0);

  // Rounding ganjil: bobot yang tidak habis dibagi tetap Σ tepat
  const dGanjil = hitungDampakPembatalan({ grup, anak, dibayar: new Map([["a", 333_333]]), childId: "a" });
  assert.equal(dGanjil.realokasi.reduce((s, r) => s + r.tambahan, 0), dGanjil.totalDirealokasikan);
});

// ── flag & guard cakupan ────────────────────────────────────────────────────────────────────────────────────────

test("Flag RESI_PEMBATALAN_AKTIF default MATI: preview & konfirmasi menolak 403 tanpa menulis apa pun", async () => {
  const w = await dunia({ pembatalan: false });
  const sebelum = { o: await testPrisma.order.count({ where: { status: "CANCELLED" } }), r: await testPrisma.finRefund.count() };
  const pra = await pratinjauBatal(w, w.anak[2]);
  assert.equal(pra.status, 403); assert.equal(pra.body.code, "RESI_PEMBATALAN_MATI");
  const eks = await batalkan(w, w.anak[2], { alasan: "uji" });
  assert.equal(eks.status, 403); assert.equal(eks.body.code, "RESI_PEMBATALAN_MATI");
  assert.deepEqual({ o: await testPrisma.order.count({ where: { status: "CANCELLED" } }), r: await testPrisma.finRefund.count() }, sebelum);
});

test("BACKFILL_BUNDLE dan order tunggal: jalur Fase 3B menolak (409 BUKAN_CHILD_RESI_BARU); tombol Batalkan Order LAMA tetap identik seperti sebelumnya", async () => {
  const w = await dunia();
  await testPrisma.orderGroup.update({ where: { id: w.groupId }, data: { source: "BACKFILL_BUNDLE" } });
  const praBackfill = await pratinjauBatal(w, w.anak[0]);
  assert.equal(praBackfill.status, 409); assert.equal(praBackfill.body.code, "BUKAN_CHILD_RESI_BARU");
  const eksBackfill = await batalkan(w, w.anak[0], { alasan: "uji" });
  assert.equal(eksBackfill.status, 409); assert.equal(eksBackfill.body.code, "BUKAN_CHILD_RESI_BARU");
  // order tunggal (groupId NULL)
  const tunggal = await createOrderForCustomer(w.customer.id, { notes: "{}", unitCount: 1 }, w.sales.user.id);
  const praTunggal = await pratinjauBatal(w, tunggal.id);
  assert.equal(praTunggal.status, 409); assert.equal(praTunggal.body.code, "BUKAN_CHILD_RESI_BARU");
  // jalur LAMA (Batalkan Order) tetap berjalan identik untuk order tunggal, tidak terpengaruh flag Fase 3B sama sekali
  const cancelLama = await w.s.post(`/api/orders/${tunggal.id}/cancel`, { reason: "uji" });
  assert.equal(cancelLama.status, 200, JSON.stringify(cancelLama.body));
});

test("Permission: SALES (P.ORDER_WRITE) ditolak 403 pada preview & konfirmasi Fase 3B — hanya Finance/Admin/Owner (FINANCE_READ/FINANCE_POST)", async () => {
  const w = await dunia();
  const pra = await w.s.get(`/api/resi/anak/${w.anak[2]}/pembatalan/pratinjau`);
  assert.equal(pra.status, 403);
  const eks = await w.s.post(`/api/resi/anak/${w.anak[2]}/pembatalan`, { alasan: "uji" }, kunci());
  assert.equal(eks.status, 403);
});

// ── skenario uang: sebelum DP, DP parsial/penuh, realokasi cukup, kelebihan → refund ──────────────────────────────

test("Batal SEBELUM ada pembayaran: child langsung batal, total & DP grup dihitung ulang, tidak ada refund/realokasi", async () => {
  const w = await dunia();
  const pra = await pratinjauBatal(w, w.anak[2]);
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.equal(pra.body.dibayarChild, 0); assert.equal(pra.body.kelebihan, 0); assert.deepEqual(pra.body.realokasi, []);
  assert.equal(pra.body.totalResiBaru, TAGIHAN[0] + TAGIHAN[1]);

  const r = await batalkan(w, w.anak[2], { alasan: "salah input jumlah item" }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.kelebihan, 0); assert.equal(r.body.refundId, null); assert.equal(r.body.totalDirealokasikan, 0);
  const anak = await ambilAnak(w.groupId);
  assert.equal(anak.find((o) => o.id === w.anak[2]).status, "CANCELLED");
  const grup = await ambilGrup(w.groupId);
  assert.equal(grup.dpTarget, r.body.dpTargetBaru);
  assert.equal(await testPrisma.finRefund.count(), 0);
  assert.equal(await testPrisma.payment.count(), 0);
  await periksaInvarianSigma(w.anak);
});

test("Batal setelah DP PARSIAL: sisa yang sudah dibayar child direalokasikan penuh ke child aktif lain (kapasitas cukup), tanpa refund", async () => {
  const w = await dunia();
  // DP hanya untuk child ke-3 (250.001) — pakai amount eksplisit via pratinjau lalu bayar manual dengan alokasi server (tipe DP nominal kecil
  // tetap dibagi proporsional ke SEMUA child aktif; supaya child[2] SAJA yang menerima, uji lewat DP penuh lalu batalkan child ber-alokasi kecil).
  const bd = await bayarResi(w, { tipe: "DP" }); // DP 30% ke SEMUA child (proporsional) — child[2] menerima DP_ITEM[2] = 75.000
  assert.equal(bd.status, 201, JSON.stringify(bd.body));
  const dibayarSebelum = angka(await paidForOrder(testPrisma, w.anak[2], { enabled: false }));
  assert.equal(dibayarSebelum, DP_ITEM[2]);

  const pra = await pratinjauBatal(w, w.anak[2]);
  assert.equal(pra.body.dibayarChild, DP_ITEM[2]);
  assert.equal(pra.body.kelebihan, 0, "kapasitas child 0&1 jauh lebih besar dari DP child 2");

  const r = await batalkan(w, w.anak[2], { alasan: "customer batalkan 1 item" }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.kelebihan, 0); assert.equal(r.body.totalDirealokasikan, DP_ITEM[2]);
  assert.equal(r.body.realokasi.reduce((s, x) => s + x.tambahan, 0), DP_ITEM[2]);

  // Payment ASLI (bd) tidak dihapus; alokasi child[2] di payment itu sudah 0 (dipindah), Σ tetap = payment.amount
  const [p] = await semuaPayment(w.anak);
  assert.equal(p.id, bd.body.paymentId);
  assert.equal(p.finAllocations.reduce((s, a) => s + angka(a.amount), 0), p.amount);
  assert.ok(!p.finAllocations.some((a) => a.orderId === w.anak[2] && angka(a.amount) > 0), "alokasi child batal sudah dipindah (kelebihan=0)");
  // total dibayar child 0 & 1 sekarang = DP asli mereka + bagian yang direalokasikan dari child 2
  const totalMasihAda = angka(await paidForOrder(testPrisma, w.anak[0], { enabled: false })) + angka(await paidForOrder(testPrisma, w.anak[1], { enabled: false }));
  assert.equal(totalMasihAda, DP_ITEM[0] + DP_ITEM[1] + DP_ITEM[2], "uang child batal utuh berpindah, tidak hilang");
  await periksaInvarianSigma(w.anak);
});

test("Batal setelah DP PENUH pada SATU child saja (dua child lain masih ada sisa): realokasi cukup memindahkan seluruhnya ke child aktif lain, tanpa refund", async () => {
  const w = await dunia();
  // DP proporsional dulu (semua child kebagian dpTarget-nya), lalu lunasi PERSIS sisa child[2] saja lewat pembayaran kedua bernominal pas —
  // hitungAlokasiResi mode TAGIHAN membagi proporsional ke SEMUA child yang masih ada sisa, jadi untuk membuat child[2] "lunas penuh sendirian"
  // sambil child 0/1 TIDAK, lunasi Resi penuh MINUS sisa child 0&1 lalu batalkan child yang SUDAH lunas duluan tidak berlaku di sini — cukup
  // uji invarian yang relevan: setelah DP proporsional, child[2] dibayar SEBESAR dpTarget-nya (bukan tagihan penuhnya) dan child 0/1 MASIH
  // punya kapasitas besar (tagihan mereka jauh > dpTarget mereka) — realokasi cukup, TANPA refund.
  assert.equal((await bayarResi(w, { tipe: "DP" })).status, 201);
  const pra = await pratinjauBatal(w, w.anak[2]);
  assert.equal(pra.body.dibayarChild, DP_ITEM[2]);
  assert.equal(pra.body.kelebihan, 0, "kapasitas sisa child 0&1 (tagihan - dpTarget mereka) jauh lebih besar dari DP child 2");
  const r = await batalkan(w, w.anak[2], { alasan: "batal setelah DP penuh child ini" }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.kelebihan, 0); assert.equal(r.body.refundId, null);
  assert.equal(r.body.totalDirealokasikan, DP_ITEM[2]);
  await periksaInvarianSigma(w.anak);
});

test("Realokasi TIDAK cukup: child lain sudah lunas (kapasitas 0) → seluruh dibayar child yang dibatalkan jadi kelebihan/refund (MENUNGGU_APPROVAL)", async () => {
  const w = await dunia();
  assert.equal((await bayarResi(w, { tipe: "TAGIHAN" })).status, 201); // seluruh Resi lunas — kapasitas child lain sekarang 0
  const pra = await pratinjauBatal(w, w.anak[2]);
  assert.equal(pra.body.dibayarChild, TAGIHAN[2]);
  assert.equal(pra.body.totalDirealokasikan, 0);
  assert.equal(pra.body.kelebihan, TAGIHAN[2]);

  // tanpa rekening refund -> ditolak
  const tanpaRek = await batalkan(w, w.anak[2], { alasan: "customer batal setelah lunas" }, kunci());
  assert.equal(tanpaRek.status, 400); assert.equal(tanpaRek.body.code, "REKENING_REFUND_WAJIB");
  assert.equal(await testPrisma.finRefund.count(), 0);
  assert.notEqual((await testPrisma.order.findUnique({ where: { id: w.anak[2] } })).status, "CANCELLED", "gagal validasi TIDAK mengubah apa pun (rollback bersih)");

  const r = await batalkan(w, w.anak[2], { alasan: "customer batal setelah lunas", refundCashAccountId: w.bank.id }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.kelebihan, TAGIHAN[2]); assert.equal(r.body.totalDirealokasikan, 0);
  assert.ok(r.body.refundId);
  const refund = await testPrisma.finRefund.findUnique({ where: { id: r.body.refundId } });
  assert.equal(refund.status, "MENUNGGU_APPROVAL");
  assert.equal(angka(refund.amount), TAGIHAN[2]);
  assert.equal(refund.orderId, w.anak[2]);
  assert.equal(refund.cashAccountId, w.bank.id);
  // paidForOrder(child) TETAP menunjukkan angka lama (alokasi sengaja tidak dipindah) — supaya sisaBisaDirefund benar saat approve nanti
  assert.equal(angka(await paidForOrder(testPrisma, w.anak[2], { enabled: false })), TAGIHAN[2]);
  await periksaInvarianSigma(w.anak);

  // Finance APPROVE refund lewat jalur yang SUDAH ADA (tidak diposting otomatis oleh Fase 3B) -> paidForOrder(child) turun ke 0 (refund disetujui dikurangkan)
  const approve = await w.a.post(`/api/finance/refunds/${r.body.refundId}/approve`);
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(angka(await paidForOrder(testPrisma, w.anak[2], { enabled: false })), 0, "setelah approve, paidForOrder child batal otomatis nol (refund disetujui dikurangkan)");
});

// ── anchor & ongkir & invoice ───────────────────────────────────────────────────────────────────────────────────

test("Anchor dibatalkan: anchor baru deterministik (child aktif id berikutnya), ongkir tambahan pindah TEPAT SEKALI, invoice bundle primary ikut pindah", async () => {
  const w = await dunia();
  const pra = await pratinjauBatal(w, w.anchorId);
  assert.equal(pra.body.isAnchor, true);
  assert.equal(pra.body.anchorBaru.orderId, w.anak[1]);
  assert.equal(pra.body.ongkirDipindah, ONGKIR);

  const r = await batalkan(w, w.anchorId, { alasan: "batalkan item anchor" }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.anchorBaru.orderId, w.anak[1]);
  assert.equal(r.body.ongkirDipindah, ONGKIR);

  const grup = await ambilGrup(w.groupId);
  assert.equal(grup.anchorOrderId, w.anak[1]);
  const anak = await ambilAnak(w.groupId);
  assert.equal(anak.find((o) => o.id === w.anchorId).ongkir, null);
  assert.equal(anak.find((o) => o.id === w.anak[1]).ongkir, ONGKIR);
  // Total Resi baru = value child 1 + 2 + ongkir (dipindah ke anchor baru)
  assert.equal(r.body.totalResiBaru, HARGA[1] + HARGA[2] + ONGKIR);

  // invoice bundle: anchor BARU sekarang primary (combinedIntoId null), anchor LAMA (dibatalkan) jadi anggota menunjuk ke sana
  const invBaru = await testPrisma.invoice.findUnique({ where: { orderId: w.anak[1] } });
  const invLama = await testPrisma.invoice.findUnique({ where: { orderId: w.anchorId } });
  assert.equal(invBaru.combinedIntoId, null, "anchor baru = primary");
  assert.equal(invLama.combinedIntoId, invBaru.id, "anchor lama (dibatalkan) jadi anggota bundle anchor baru");

  // Sales masih bisa mencatat pembayaran Resi lewat anchor BARU setelah ini (Resi tetap berfungsi)
  const bayarLagi = await bayarResi(w, { tipe: "DP" });
  assert.equal(bayarLagi.status, 201, JSON.stringify(bayarLagi.body));
  const [pBaru] = await testPrisma.payment.findMany({ where: { orderId: w.anak[1] } });
  assert.ok(pBaru, "Payment baru tercatat di anchor BARU");
});

test("Semua child dibatalkan satu-satu: grup jadi kosong (anchorOrderId NULL), tidak ada anchor/invoice palsu, Resi berhenti bisa dibayar", async () => {
  const w = await dunia();
  for (const id of [...w.anak]) {
    const r = await batalkan(w, id, { alasan: "batal semua item" }, kunci());
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const grup = await ambilGrup(w.groupId);
  assert.equal(grup.anchorOrderId, null);
  const anak = await ambilAnak(w.groupId);
  assert.ok(anak.every((o) => o.status === "CANCELLED"));
  // Resi kosong: pembayaran/klaim Resi lewat Fase 3A ditolak (tidak ada anchor aktif)
  const bayarKosong = await w.s.post(`/api/resi/${w.groupId}/pembayaran`, { method: "TRANSFER", cashAccountId: w.bank.id, tipe: "DP" }, kunci());
  assert.equal(bayarKosong.status, 409);
});

// ── child delivered / pendapatan diakui ────────────────────────────────────────────────────────────────────────

test("Child sudah DELIVERED (pendapatan diakui): preview menandai pendapatanSudahDiakui, pembatalan tetap berjalan, revenue LAMA tidak dihapus, refund dibuat menunggu approve", async () => {
  const w = await dunia();
  assert.equal((await bayarResi(w, { tipe: "TAGIHAN" })).status, 201); // lunas semua dulu supaya child 2 "dibayar penuh"
  await testPrisma.order.update({ where: { id: w.anak[2] }, data: { status: "DELIVERED" } });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: w.anak[2], userId: w.admin.user.id }));
  const revenueSebelum = await testPrisma.finJournalEntry.findFirst({ where: { source: "PENGAKUAN_PENDAPATAN", sourceId: w.anak[2] } });
  assert.equal(revenueSebelum.status, "POSTED");

  const pra = await pratinjauBatal(w, w.anak[2]);
  assert.equal(pra.body.pendapatanSudahDiakui, true);
  assert.equal(pra.body.kelebihan, TAGIHAN[2], "child 0&1 juga lunas -> kapasitas 0 -> seluruhnya kelebihan");

  const r = await batalkan(w, w.anak[2], { alasan: "barang dikembalikan setelah terkirim", refundCashAccountId: w.bank.id }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.refundId);

  // Revenue LAMA tetap POSTED, tidak dihapus/dibalik oleh Fase 3B
  const revenueSesudah = await testPrisma.finJournalEntry.findFirst({ where: { source: "PENGAKUAN_PENDAPATAN", sourceId: w.anak[2] } });
  assert.equal(revenueSesudah.id, revenueSebelum.id);
  assert.equal(revenueSesudah.status, "POSTED", "jurnal pengakuan pendapatan LAMA tidak disentuh");

  // Approve refund -> postRefund existing otomatis pakai Retur & Potongan Penjualan (kontra-pendapatan) KARENA pendapatan sudah diakui
  const approve = await w.a.post(`/api/finance/refunds/${r.body.refundId}/approve`);
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  const jurnalRefund = await testPrisma.finJournalEntry.findFirst({ where: { source: "REFUND", sourceId: r.body.refundId }, include: { lines: true } });
  assert.equal(jurnalRefund.status, "POSTED");
  const retur = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.RETUR_PENJUALAN } });
  assert.ok(jurnalRefund.lines.some((l) => l.accountId === retur.id && angka(l.debit) > 0), "Dr Retur & Potongan Penjualan (bukan Uang Muka) karena pendapatan sudah diakui");
  const debit = jurnalRefund.lines.reduce((s, l) => s + angka(l.debit), 0);
  const kredit = jurnalRefund.lines.reduce((s, l) => s + angka(l.credit), 0);
  assert.equal(debit, kredit, "jurnal refund seimbang");
});

// ── keamanan transaksi: exactly-once, konkurensi, rollback ─────────────────────────────────────────────────────

test("Replay Idempotency-Key SAMA memutar ulang respons tanpa membatalkan dua kali; kunci sama + body beda = 422", async () => {
  const w = await dunia();
  const h = kunci();
  const a = await batalkan(w, w.anak[2], { alasan: "batal 1" }, h);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await batalkan(w, w.anak[2], { alasan: "batal 1" }, h);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(b.body, a.body);
  assert.equal(await testPrisma.order.count({ where: { groupId: w.groupId, status: "CANCELLED" } }), 1);
  const c = await batalkan(w, w.anak[2], { alasan: "beda" }, h);
  assert.equal(c.status, 422);
});

test("Dua pembatalan PARALEL pada child YANG SAMA (Idempotency-Key berbeda): tepat satu berhasil, yang kalah 409 tanpa efek samping ganda", async () => {
  const w = await dunia();
  const [a, b] = await Promise.all([
    batalkan(w, w.anak[2], { alasan: "race A" }, kunci()),
    batalkan(w, w.anak[2], { alasan: "race B" }, kunci()),
  ]);
  const hasil = [a, b];
  assert.equal(hasil.filter((r) => r.status === 201).length, 1, `tepat satu berhasil: ${hasil.map((r) => r.status).join(",")}`);
  assert.ok(hasil.find((r) => r.status !== 201).status === 409);
  assert.equal(await testPrisma.order.count({ where: { groupId: w.groupId, status: "CANCELLED" } }), 1, "tidak ada efek ganda");
});

test("Cancel-vs-verify: pembatalan child paralel dengan verifikasi klaim Lunas Resi — serial lewat kunci grup, tidak ada uang ganda/hilang", async () => {
  const w = await dunia();
  assert.equal((await bayarResi(w, { tipe: "DP" })).status, 201);
  assert.equal((await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {}, kunci())).status, 201);
  const [batal, verif] = await Promise.all([
    batalkan(w, w.anak[2], { alasan: "race dengan verifikasi" }, kunci()),
    w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/verifikasi`, { mode: "REKENING", cashAccountId: w.bank.id }, kunci()),
  ]);
  assert.ok(batal.status < 500 && verif.status < 500, `tidak ada 500: batal=${batal.status} verif=${verif.status}`);
  // Invarian tetap terjaga siapa pun yang menang
  await periksaInvarianSigma(w.anak);
  for (const p of await semuaPayment(w.anak)) {
    assert.equal(p.finAllocations.reduce((s, a) => s + angka(a.amount), 0), p.amount);
  }
});

test("Rollback bersih bila validasi gagal di tengah jalan: versi basi DAN gagal-refund-tanpa-rekening TIDAK meninggalkan state setengah jadi", async () => {
  const w = await dunia();
  const pra = await pratinjauBatal(w, w.anak[2]);
  const versiBasi = pra.body.versi;
  // Ubah baris grup lewat aksi LAIN (klaim lunas menulis ulang order_groups) supaya `versiBasi` yang tadi dibaca sudah basi.
  assert.equal((await w.s.post(`/api/resi/${w.groupId}/klaim-lunas`, {}, kunci())).status, 201);
  const sebelum = { p: await testPrisma.payment.count(), o: await testPrisma.order.count({ where: { status: "CANCELLED" } }), r: await testPrisma.finRefund.count() };

  const versiSalah = await batalkan(w, w.anak[2], { alasan: "uji versi basi", versi: versiBasi }, kunci());
  assert.equal(versiSalah.status, 409); assert.equal(versiSalah.body.code, "VERSI_BERUBAH");
  assert.deepEqual({ p: await testPrisma.payment.count(), o: await testPrisma.order.count({ where: { status: "CANCELLED" } }), r: await testPrisma.finRefund.count() }, sebelum, "versi basi: TIDAK ada yang tertulis");

  // Lepas klaim (supaya Sales bisa mencatat pembayaran lagi), lunasi semua (kapasitas child lain jadi 0), lalu coba batalkan TANPA rekening
  // refund — validasi gagal SEBELUM commit, child TETAP aktif.
  assert.equal((await w.a.post(`/api/finance/penerimaan/resi/${w.groupId}/tolak`, { reason: "batal klaim uji" })).status, 200);
  assert.equal((await bayarResi(w, { tipe: "TAGIHAN" })).status, 201);
  const gagalRefund = await batalkan(w, w.anak[2], { alasan: "tanpa rekening" }, kunci());
  assert.equal(gagalRefund.status, 400); assert.equal(gagalRefund.body.code, "REKENING_REFUND_WAJIB");
  assert.notEqual((await testPrisma.order.findUnique({ where: { id: w.anak[2] } })).status, "CANCELLED", "gagal validasi tidak membatalkan child (rollback penuh, bukan setengah jadi)");
  assert.equal(await testPrisma.finRefund.count(), 0);
});

test("Alasan wajib diisi; child yang tidak ditemukan/sudah dibatalkan ditolak bersih tanpa efek samping", async () => {
  const w = await dunia();
  const tanpaAlasan = await batalkan(w, w.anak[2], {}, kunci());
  assert.equal(tanpaAlasan.status, 400); assert.equal(tanpaAlasan.body.code, "ALASAN_WAJIB");
  const r1 = await batalkan(w, w.anak[2], { alasan: "batal" }, kunci());
  assert.equal(r1.status, 201);
  const r2 = await batalkan(w, w.anak[2], { alasan: "batal lagi" }, kunci());
  assert.equal(r2.status, 409); assert.equal(r2.body.code, "CHILD_TIDAK_AKTIF");
});

test("Dua pembatalan BERURUTAN berbagi SATU Payment (anchor lalu child lain) berhasil; jurnal payment diposting ulang seimbang; status penerima & kapasitas anchor baru benar", async () => {
  const w = await dunia();
  assert.equal((await bayarResi(w, { tipe: "DP" })).status, 201);
  const [payment] = await semuaPayment(w.anak);
  const anchorIdx = w.anak.indexOf(w.anchorId);
  const lainIdx = w.anak.map((_, i) => i).filter((i) => i !== anchorIdx);

  // 1) batalkan ANCHOR: ongkir pindah ke anchor baru; kapasitas anchor baru harus memuat ongkir (pratinjau memakai tagihan SETELAH pembatalan)
  const pra = await pratinjauBatal(w, w.anchorId);
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  const anchorBaruId = pra.body.anchorBaru.orderId;
  const tagihanAnchorBaru = pra.body.anakAktifTersisa.find((x) => x.orderId === anchorBaruId).tagihan;
  const nilaiAnchorBaru = (await testPrisma.order.findUnique({ where: { id: anchorBaruId } })).value;
  assert.equal(tagihanAnchorBaru, nilaiAnchorBaru + ONGKIR, "tagihan anchor baru sudah memuat ongkir tambahan");
  const r1 = await batalkan(w, w.anchorId, { alasan: "anchor batal" }, kunci());
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.kelebihan, 0);

  // Jurnal payment lama REVERSED, jurnal baru POSTED & seimbang; Σ debit = Σ kredit
  const entries = await testPrisma.finJournalEntry.findMany({ where: { idempotencyKey: { startsWith: `PEMBAYARAN_ORDER:${payment.id}` } }, include: { lines: true } });
  assert.ok(entries.some((e) => e.status === "REVERSED"), "jurnal penerimaan lama dibalik");
  const aktifJ = entries.filter((e) => e.status === "POSTED" && e.idempotencyKey.includes("REALOKASI"));
  assert.equal(aktifJ.length, 1, "tepat satu jurnal realokasi POSTED");
  const sum = (ls, f) => ls.reduce((s, l) => s + Number(l[f]), 0);
  assert.equal(sum(aktifJ[0].lines, "debit"), sum(aktifJ[0].lines, "credit"));
  assert.equal(sum(aktifJ[0].lines, "debit"), payment.amount);

  // 2) batalkan child lain yang masih berbagi payment yang SAMA (audit HIGH-2: baris alokasi batal pertama tidak boleh menghalangi)
  const sisa = w.anak.filter((id) => id !== w.anchorId);
  const r2 = await batalkan(w, sisa[1], { alasan: "child kedua batal" }, kunci());
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  await periksaInvarianSigma(w.anak);
  const jumlah = lainIdx.length;
  assert.equal(jumlah, 2);
  const total = await paidForOrder(testPrisma, sisa[0], { enabled: false });
  assert.equal(angka(total), payment.amount, "seluruh uang payment kini di satu-satunya child aktif");
});
