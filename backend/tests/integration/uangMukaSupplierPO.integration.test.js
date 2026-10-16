// UANG MUKA SUPPLIER SEBELUM BARANG DATANG — terhadap PostgreSQL sungguhan. Yang dikunci:
// (1) kasus utama: PO 6 jt, uang muka 4 jt, barang belum datang → bank −4 jt, uang muka +4 jt; stok/Persediaan/GRNI/Utang Usaha NOL; detail PO: sisa komitmen 2 jt (BUKAN utang);
// (2) barang datang sebagian & disimpan: stok sebesar barang baik, uang muka tidak berubah; (3) faktur 6 jt disetujui + uang muka 4 jt diterapkan → sisa utang 2 jt; (4) pelunasan 2 jt → utang & uang muka nol;
// (5) biaya admin terpisah; (6) split delivery + beberapa faktur + beberapa/sebagian uang muka; (7) batal PO tidak menghapus kas/jurnal; (8) replay/paralel/periode tertutup/rekonsiliasi/koreksi/retur/Debit Note;
// (9) Gudang tidak melihat nilai keuangan; (10) kartu, detail, aging, Kas & Bank, dan Excel memakai angka server yang sama. Setiap tahap: jurnal seimbang dan tanpa residual.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const H = 60_000; // harga per KG; PO 100 KG = Rp6.000.000
const kunci = () => ({ "Idempotency-Key": `um-${randomUUID()}` });
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
const hariIni = () => geser(0);
const BUKTI = `/media/finance-receipts/${"a".repeat(40)}.jpg`;
let nomorFaktur = 0;
const ref = () => `FAK-UM-${String(++nomorFaktur).padStart(4, "0")}`;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const bank2 = await testPrisma.finCashAccount.create({ data: { name: "Bank Kedua", kind: "BANK", accountId: akunBank.id } });
  const [fin, admin, gudang, approver, sales] = await Promise.all(["FINANCE", "ADMIN", "WAREHOUSE", "APPROVER", "SALES"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO", paymentTermType: "HARI", paymentTermDays: 30 } });
  const supplier2 = await testPrisma.finSupplier.create({ data: { code: "SUP-LAIN", name: "PT LAIN" } });
  const busa = await createTestMaterial({ code: "BUSA-R50", name: "Busa Rebonded R50", unit: "KG" });
  return { f: c(fin), a: c(admin), g: c(gudang), ap: c(approver), s: c(sales), fin, admin, gudang, bank, bank2, supplier, supplier2, busa };
}
async function poDisetujui(w, { qty = 100, harga = H, supplier = null } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: (supplier ?? w.supplier).id, orderDate: geser(-20), lines: [{ materialId: w.busa.id, qty, unitPrice: harga }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
const tiba = (w, poId, body) => w.g.post(`/api/inventory/barang-akan-datang/${poId}/kedatangan`, { penerima: "Budi Gudang", catatan: "Barang tiba utuh", tanggalTiba: geser(-5), ...body }, kunci());
async function terimaDanSimpan(w, po, qty, { tanggal = geser(-5), simpan = true } = {}) {
  const t = await tiba(w, po.id, { tanggalTiba: tanggal, lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: qty }] });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const id = t.body.receiptId;
  if (!simpan) return { receiptId: id };
  const gr = (await w.g.get(`/api/inventory/goods-receipts/${id}`)).body;
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}`, { status: "INSPECTION" })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}/lines/${gr.lines[0].id}`, { acceptedQty: qty, rejectedQty: 0 })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}`, { status: "READY_FOR_PUTAWAY" })).status, 200);
  const p = await w.g.post(`/api/inventory/goods-receipts/${id}/putaway`, {});
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return { receiptId: id, lineId: gr.lines[0].id };
}
async function faktur(w, po, qty, { setuju = true, harga = H } = {}) {
  const r = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: geser(-1), lines: [{ purchaseOrderLineId: po.lines[0].id, qty, unitPrice: harga }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (setuju) { const a = await w.ap.post(`/api/finance/bills/${r.body.billId}/approve`, {}); assert.equal(a.status, 200, JSON.stringify(a.body)); }
  return r.body.billId;
}
const bayarSupplier = (w, supplierId, billId, amount) => w.a.post("/api/finance/supplier-payments", { supplierId, date: hariIni(), cashAccountId: w.bank.id, allocations: [{ billId, amount }] }, kunci());

const bayarDP = (w, po, { amount = 4_000_000, klien = null, headers = kunci(), extra = {}, rekening = null } = {}) =>
  (klien ?? w.f).post(`/api/finance/purchase-orders/${po.id}/uang-muka`, { amount, date: hariIni(), cashAccountId: (rekening ?? w.bank).id, receiptUrl: BUKTI, reference: "TRF-UM-001", notes: "Permintaan supplier sebelum kirim", ...extra }, headers);
const terapkan = (w, advanceId, billId, amount, { klien = null, headers = kunci(), extra = {} } = {}) =>
  (klien ?? w.f).post("/api/finance/purchase-orders/uang-muka/terapkan", { advanceId, billId, amount, konfirmasi: true, ...extra }, headers);

async function saldo(systemKey) {
  const a = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0); // debit − kredit
}
async function saldoBank(w) {
  const agg = await testPrisma.finJournalLine.aggregate({ where: { cashAccountId: w.bank.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
}
const stokTotal = async () => Number((await testPrisma.stockMovement.aggregate({ _sum: { qty: true } }))._sum.qty ?? 0);
async function bukuSeimbang() {
  const lines = await testPrisma.finJournalLine.findMany({ select: { debit: true, credit: true } });
  const d = lines.reduce((a, l) => a + Number(l.debit), 0); const k = lines.reduce((a, l) => a + Number(l.credit), 0);
  assert.equal(d, k, "buku besar harus seimbang (debit = kredit), tanpa residual");
  for (const e of await testPrisma.finJournalEntry.findMany({ include: { lines: true } })) {
    assert.equal(e.lines.reduce((a, l) => a + Number(l.debit), 0), e.lines.reduce((a, l) => a + Number(l.credit), 0), `jurnal ${e.entryNumber} seimbang`);
  }
}
const potret = async (w) => ({
  bank: await saldoBank(w), uangMuka: await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), utang: await saldo(SYSTEM_KEYS.UTANG_USAHA), grni: await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH),
  persediaan: await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), bebanAdmin: await saldo(SYSTEM_KEYS.BEBAN_ADMIN_BANK), stok: await stokTotal(), gerakan: await testPrisma.stockMovement.count(),
});
const keu = async (w, po) => (await w.f.get(`/api/finance/purchase-orders/${po.id}`)).body;

// ═══ 1. Kasus utama ═══
test("PO 6 jt + uang muka 4 jt, barang belum datang: bank −4 jt, Dr Uang Muka / Cr Bank 4 jt; stok, Persediaan, GRNI, Utang Usaha NOL; detail PO: sisa komitmen 2 jt, ditagih 0, utang 0", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  assert.equal(po.totalDipesan, 6_000_000);
  const awal = await potret(w);
  const jurnalAwal = await testPrisma.finJournalEntry.count();

  const r = await bayarDP(w, po);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const k = r.body.keuangan;
  assert.deepEqual([k.nilaiPO, k.uangMukaDibayar, k.sisaKomitmen, k.sudahDitagih, k.utangTercatat, k.sisaUtang, k.uangMukaDiterapkan, k.uangMukaBelumDiterapkan, k.kelebihanPembayaran], [6_000_000, 4_000_000, 2_000_000, 0, 0, 0, 0, 4_000_000, 0]);

  const sesudah = await potret(w);
  assert.equal(sesudah.bank - awal.bank, -4_000_000, "bank turun 4 jt");
  assert.equal(sesudah.uangMuka - awal.uangMuka, 4_000_000, "Uang Muka Supplier bertambah 4 jt");
  for (const f of ["utang", "grni", "persediaan", "stok", "gerakan", "bebanAdmin"]) assert.equal(sesudah[f], awal[f], `${f} TIDAK berubah`);
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalAwal + 1, "tepat satu jurnal");
  const jurnal = await testPrisma.finJournalEntry.findFirst({ where: { source: "PEMBELIAN" }, include: { lines: { include: { account: true } } } });
  assert.deepEqual(jurnal.lines.map((l) => [l.account.systemKey, Number(l.debit), Number(l.credit)]).sort(), [["BANK", 0, 4_000_000], ["UANG_MUKA_PEMBELIAN", 4_000_000, 0]].sort());
  const dp = await testPrisma.finPurchase.findUnique({ where: { id: r.body.dp } });
  assert.deepEqual([dp.status, dp.mode, dp.purchaseOrderId, dp.supplierId, dp.receiptUrl, dp.paymentReference], ["DIBAYAR", "LANGSUNG", po.id, w.supplier.id, BUKTI, "TRF-UM-001"]);

  // detail PO (dua kelompok): pemenuhan barang & keuangan
  const d = await keu(w, po);
  assert.deepEqual([d.totalDipesan, d.totalDatang, d.totalBelumDatang, d.totalDiterima, d.totalDitagih], [6_000_000, 0, 6_000_000, 0, 0], "barang datang Rp0, masuk stok Rp0, ditagih Rp0");
  assert.equal(d.keuangan.sisaKomitmen, 2_000_000); assert.equal(d.keuangan.utangTercatat, 0);
  assert.deepEqual(d.keuangan.definisi.map((x) => x.kunci), ["totalFakturDisetujui", "sudahDibayar", "nilaiPO", "uangMukaDibayar", "sudahDitagih", "uangMukaDiterapkan", "uangMukaBelumDiterapkan", "utangTercatat", "dibayarAtasFaktur", "sisaUtang", "sisaKomitmen"]);
  assert.ok(d.keuangan.definisi.every((x) => x.definisi.length > 20), "tiap angka punya definisi (tooltip)");
  assert.match(d.keuangan.definisi.find((x) => x.kunci === "sisaKomitmen").definisi, /BUKAN utang/);
  assert.equal(d.riwayat.some((e) => e.type === "UANG_MUKA_DIBAYAR"), true);
  // belum jadi utang: kartu Supplier & Utang & aging tetap nol
  const aging = (await w.f.get("/api/finance/utang/aging")).body;
  assert.equal(aging.ringkasan.kartu.totalUtangAktif, 0); assert.equal(aging.baris.length, 0);
  const ring = (await w.f.get("/api/finance/purchase-orders/uang-muka/ringkasan-supplier")).body;
  assert.deepEqual([ring.kartu.totalUangMuka, ring.kartu.uangMukaBelumDiterapkan, ring.kartu.utangAktif, ring.kartu.saldoBersih], [4_000_000, 4_000_000, 0, -4_000_000]);
  await bukuSeimbang();
});

// ═══ 2. Barang datang sebagian dan disimpan ═══
test("barang datang sebagian (40 KG) dan disimpan: stok +40 KG, Persediaan/GRNI 2,4 jt; uang muka dan bank TIDAK berubah; pembayaran tidak menambah stok", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  assert.equal((await bayarDP(w, po)).status, 201);
  const sebelum = await potret(w);
  await terimaDanSimpan(w, po, 40);
  const sesudah = await potret(w);
  assert.equal(sesudah.stok, 40); assert.equal(sesudah.persediaan - sebelum.persediaan, 2_400_000); assert.equal(sesudah.grni - sebelum.grni, -2_400_000, "GRNI dikredit 2,4 jt");
  assert.equal(sesudah.uangMuka, sebelum.uangMuka, "uang muka tidak berubah"); assert.equal(sesudah.bank, sebelum.bank); assert.equal(sesudah.utang, 0);
  const d = await keu(w, po);
  assert.deepEqual([d.totalDatang, d.totalDiterima, d.totalBelumDatang, d.keuangan.uangMukaDibayar, d.keuangan.sisaKomitmen, d.keuangan.utangTercatat], [2_400_000, 2_400_000, 3_600_000, 4_000_000, 2_000_000, 0]);
  // bayar uang muka lagi (kedua) TIDAK menambah stok
  const stokSebelum = await stokTotal();
  assert.equal((await bayarDP(w, po, { amount: 1_000_000 })).status, 201);
  assert.equal(await stokTotal(), stokSebelum, "pembayaran tidak pernah menambah stok");
  assert.equal((await keu(w, po)).keuangan.uangMukaDibayar, 5_000_000);
  await bukuSeimbang();
});

// ═══ 3 + 4. Faktur 6 jt + terapkan 4 jt → utang 2 jt; pelunasan 2 jt → nol ═══
test("faktur 6 jt disetujui: utang 6 jt; uang muka 4 jt diterapkan (Dr Utang / Cr Uang Muka) → sisa utang 2 jt; pelunasan 2 jt → utang dan uang muka nol; angka layar = aging = supplier = Excel", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const dp = (await bayarDP(w, po)).body;
  await terimaDanSimpan(w, po, 100);
  const billId = await faktur(w, po, 100);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -6_000_000, "utang 6 jt setelah faktur disetujui"); assert.equal(await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH), 0);
  const jurnalSebelum = await testPrisma.finJournalEntry.count();
  const bankSebelum = await saldoBank(w);

  // penerapan harus dikonfirmasi + Idempotency-Key + header
  assert.equal((await terapkan(w, dp.dp, billId, 4_000_000, { extra: { konfirmasi: false } })).status, 409);
  assert.equal((await w.f.post("/api/finance/purchase-orders/uang-muka/terapkan", { advanceId: dp.dp, billId, amount: 4_000_000, konfirmasi: true })).status, 428, "tanpa Idempotency-Key");
  const kand = (await w.f.get(`/api/finance/purchase-orders/uang-muka/faktur/${billId}/kandidat`)).body;
  assert.deepEqual([kand.faktur.sisaUtang, kand.uangMuka.length, kand.uangMuka[0].saldoBelumDiterapkan, kand.uangMuka[0].saran, kand.uangMuka[0].samaPO], [6_000_000, 1, 4_000_000, 4_000_000, true]);

  const t = await terapkan(w, dp.dp, billId, 4_000_000, { extra: { sisaFakturDilihat: 6_000_000 } });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalSebelum + 1);
  const jn = await testPrisma.finJournalEntry.findFirst({ where: { source: "TERAPKAN_UANG_MUKA", sourceId: t.body.id }, include: { lines: { include: { account: true } } } });
  assert.deepEqual(jn.lines.map((l) => [l.account.systemKey, Number(l.debit), Number(l.credit)]).sort(), [["UANG_MUKA_PEMBELIAN", 0, 4_000_000], ["UTANG_USAHA", 4_000_000, 0]].sort());
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -2_000_000, "utang tersisa 2 jt"); assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 0, "uang muka habis diterapkan");
  assert.equal(await saldoBank(w), bankSebelum, "penerapan tidak menyentuh kas");
  const bill = await testPrisma.finSupplierBill.findUnique({ where: { id: billId } });
  assert.deepEqual([bill.status, Number(bill.amount), Number(bill.creditApplied)], ["DISETUJUI", 6_000_000, 4_000_000]);

  // satu angka di semua pembaca
  const d = await keu(w, po);
  assert.deepEqual([d.keuangan.sudahDitagih, d.keuangan.uangMukaDiterapkan, d.keuangan.utangTercatat, d.keuangan.dibayarAtasFaktur, d.keuangan.sisaUtang, d.keuangan.sisaKomitmen, d.keuangan.uangMukaBelumDiterapkan], [6_000_000, 4_000_000, 2_000_000, 0, 2_000_000, 2_000_000, 0]);
  const aging = (await w.f.get("/api/finance/utang/aging")).body;
  assert.equal(aging.ringkasan.kartu.totalUtangAktif, 2_000_000); assert.equal(aging.baris.reduce((s, b) => s + b.sisaUtang, 0), 2_000_000);
  const sup = (await w.f.get("/api/finance/suppliers")).body.suppliers.find((s) => s.id === w.supplier.id);
  assert.equal(sup.sisaUtang, 2_000_000);
  const ring = (await w.f.get("/api/finance/purchase-orders/uang-muka/ringkasan-supplier")).body;
  const baris = ring.suppliers.find((s) => s.supplierId === w.supplier.id);
  assert.deepEqual([baris.totalUangMuka, baris.uangMukaTerpakai, baris.uangMukaBelumDiterapkan, baris.utangAktif, baris.saldoBersih], [4_000_000, 4_000_000, 0, 2_000_000, 2_000_000]);
  const mut = (await w.a.get(`/api/finance/buku/rekening/${w.bank.id}/mutasi?from=2020-01-01&to=2099-12-31&limit=100`)).body;
  assert.ok(JSON.stringify(mut).includes("4000000"), "Kas & Bank memuat uang keluar 4 jt");
  const x = await unduhExport(server.baseUrl, (await createTestUser({ roles: ["FINANCE"] })).token, "uang-muka-supplier", {});
  assert.equal(x.status, 200);
  const kom = bacaSheet(x.wb, "Sisa Komitmen PO").baris.find((b) => b["PO"] === po.poNumber);
  assert.deepEqual([kom["Nilai PO (Rp)"], kom["Uang Muka Dibayar (Rp)"], kom["Uang Muka Diterapkan (Rp)"], kom["Sudah Ditagih (Rp)"], kom["Utang Tercatat (Rp)"], kom["Sisa Utang (Rp)"], kom["Sisa Komitmen PO (Rp)"]], [6_000_000, 4_000_000, 4_000_000, 6_000_000, 2_000_000, 2_000_000, 2_000_000], "Excel = layar");
  const pen = bacaSheet(x.wb, "Penerapan ke Faktur"); assert.equal(pen.baris.length, 1); assert.equal(pen.total["Jumlah (Rp)"], 4_000_000);
  const um = bacaSheet(x.wb, "Uang Muka"); assert.deepEqual([um.baris[0]["Uang Muka (Rp)"], um.baris[0]["Diterapkan ke Faktur (Rp)"], um.baris[0]["Belum Diterapkan (Rp)"], um.baris[0]["Total Keluar Rekening (Rp)"]], [4_000_000, 4_000_000, 0, 4_000_000]);
  const sx = await unduhExport(server.baseUrl, (await createTestUser({ roles: ["FINANCE"] })).token, "supplier-utang", { filter: { tab: "tagihan" } });
  assert.equal(bacaSheet(sx.wb, "Tagihan").total["Sisa (Rp)"], 2_000_000, "Excel Supplier & Utang: sisa 2 jt");

  // pelunasan sisa 2 jt: Dr Utang / Cr Bank; stok tidak berubah
  const stok = await stokTotal();
  const p = await bayarSupplier(w, w.supplier.id, billId, 2_000_000);
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), 0, "utang nol"); assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 0);
  assert.equal(await saldoBank(w), bankSebelum - 2_000_000); assert.equal(await stokTotal(), stok, "pembayaran tidak menambah stok");
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: billId } })).status, "LUNAS");
  const akhir = await keu(w, po);
  assert.deepEqual([akhir.keuangan.sisaUtang, akhir.keuangan.sisaKomitmen, akhir.keuangan.dibayarAtasFaktur, akhir.keuangan.uangMukaBelumDiterapkan], [0, 0, 2_000_000, 0]);
  await bukuSeimbang();
});

// ═══ 5. Biaya admin ═══
test("biaya admin dijurnal terpisah (Dr Beban Administrasi Bank): tidak menambah uang muka, stok, atau nilai faktur; mutasi rekening = nominal + biaya", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r = await bayarDP(w, po, { amount: 1_000_000, extra: { paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: 2_500 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await saldoBank(w), -1_002_500, "mutasi rekening = nominal + biaya admin");
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 1_000_000, "uang muka TIDAK memuat biaya admin");
  assert.equal(await saldo(SYSTEM_KEYS.BEBAN_ADMIN_BANK), 2_500);
  assert.equal(await stokTotal(), 0); assert.equal(await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), 0);
  assert.equal(r.body.keuangan.uangMukaDibayar, 1_000_000);
  const dp = (await w.f.get("/api/finance/purchase-orders/uang-muka")).body.uangMuka[0];
  assert.deepEqual([dp.nominal, dp.biayaAdmin, dp.totalKeluarRekening], [1_000_000, 2_500, 1_002_500]);
  // faktur tidak terpengaruh biaya admin
  await terimaDanSimpan(w, po, 100);
  const billId = await faktur(w, po, 100);
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: billId } })).amount), 6_000_000);
  assert.equal((await terapkan(w, r.body.dp, billId, 1_002_500)).status, 400, "yang bisa diterapkan hanya nominal uang muka, bukan biaya admin");
  assert.equal((await terapkan(w, r.body.dp, billId, 1_000_000)).status, 201);
  assert.equal(await saldo(SYSTEM_KEYS.BEBAN_ADMIN_BANK), 2_500, "biaya admin tidak ikut diterapkan");
  await bukuSeimbang();
});

// ═══ 6. Split delivery, beberapa faktur, uang muka sebagian/berkali-kali ═══
test("split delivery + dua faktur + dua uang muka: penerapan sebagian berkali-kali tidak menggandakan nilai; sisa utang & sisa komitmen konsisten; melebihi saldo/sisa ditolak", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const dp1 = (await bayarDP(w, po, { amount: 2_500_000 })).body; // beberapa kali
  const dp2 = (await bayarDP(w, po, { amount: 1_500_000 })).body;
  assert.equal((await keu(w, po)).keuangan.uangMukaDibayar, 4_000_000);
  await terimaDanSimpan(w, po, 50);
  const f1 = await faktur(w, po, 50); // 3 jt
  await terimaDanSimpan(w, po, 50, { tanggal: geser(-2) });
  const f2 = await faktur(w, po, 50); // 3 jt
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -6_000_000);

  assert.equal((await terapkan(w, dp1.dp, f1, 2_600_000)).status, 400, "melebihi saldo uang muka");
  assert.equal((await terapkan(w, dp1.dp, f1, 2_500_000)).status, 201); // f1 sisa 500rb
  assert.equal((await terapkan(w, dp2.dp, f1, 600_000)).status, 400, "melebihi sisa faktur f1");
  assert.equal((await terapkan(w, dp2.dp, f1, 500_000)).status, 201); // f1 sisa 0 → LUNAS (kredit saja)
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: f1 } })).status, "LUNAS");
  assert.equal((await terapkan(w, dp2.dp, f2, 1_000_000)).status, 201); // dp2 habis
  assert.equal((await terapkan(w, dp2.dp, f2, 1)).status, 400, "saldo dp2 habis");
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 0);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -2_000_000, "utang sebenarnya = 6 jt − 4 jt, tidak ada hitung ganda");
  const d = await keu(w, po);
  assert.deepEqual([d.keuangan.sudahDitagih, d.keuangan.uangMukaDiterapkan, d.keuangan.utangTercatat, d.keuangan.sisaUtang, d.keuangan.sisaKomitmen], [6_000_000, 4_000_000, 2_000_000, 2_000_000, 2_000_000]);
  assert.equal(d.keuangan.penerapan.filter((a) => a.status === "ACTIVE").length, 3);
  assert.equal(await stokTotal(), 100);
  await bukuSeimbang();
});

test("uang muka milik supplier lain / faktur belum disetujui / faktur lunas ditolak; uang muka PO lain butuh konfirmasi; kelebihan uang muka tetap tersimpan sebagai saldo supplier (Kredit Supplier tanpa refund kas)", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const poLain = await poDisetujui(w, { qty: 10 }); // 600 rb, supplier sama
  const dpA = (await bayarDP(w, po, { amount: 4_000_000 })).body;
  const poS2 = await poDisetujui(w, { supplier: w.supplier2, qty: 10 });
  await terimaDanSimpan(w, poLain, 10);
  const fLain = await faktur(w, poLain, 10); // 600 rb, PO lain
  const beda = await terapkan(w, dpA.dp, fLain, 600_000);
  assert.equal(beda.status, 409); assert.equal(beda.body.code, "UANG_MUKA_BEDA_PO");
  const oke = await terapkan(w, dpA.dp, fLain, 600_000, { extra: { konfirmasiBedaPO: true } });
  assert.equal(oke.status, 201, JSON.stringify(oke.body));
  // sisa 3,4 jt menjadi saldo supplier: PO asli belum ada faktur → tetap aset, bukan utang, bukan refund
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 3_400_000);
  const ring = (await w.f.get("/api/finance/purchase-orders/uang-muka/ringkasan-supplier")).body;
  assert.equal(ring.suppliers.find((s) => s.supplierId === w.supplier.id).uangMukaBelumDiterapkan, 3_400_000);
  // lintas supplier ditolak
  await terimaDanSimpan(w, poS2, 10);
  const fS2 = await faktur(w, poS2, 10);
  const lintas = await terapkan(w, dpA.dp, fS2, 100_000);
  assert.equal(lintas.status, 400); assert.match(lintas.body.error, /supplier yang sama/);
  // faktur lunas tidak menerima uang muka
  assert.equal((await terapkan(w, dpA.dp, fLain, 1_000)).status, 409);
  await bukuSeimbang();
});

// ═══ 7. Batal PO ═══
test("batal PO setelah uang muka: kas dan jurnal TIDAK dihapus; uang muka tetap DIBAYAR; detail menampilkan 'perlu dikembalikan atau dialihkan'; bisa dialihkan ke faktur supplier yang sama", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const dp = (await bayarDP(w, po)).body;
  const sebelum = await potret(w);
  const jurnal = await testPrisma.finJournalEntry.count();
  const batal = await w.a.post(`/api/finance/purchase-orders/${po.id}/cancel`, { reason: "Supplier tidak sanggup produksi" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.deepEqual(await potret(w), sebelum, "kas, uang muka, stok tidak berubah");
  assert.equal(await testPrisma.finJournalEntry.count(), jurnal, "tidak ada jurnal dihapus/ditambah");
  assert.equal((await testPrisma.finPurchase.findUnique({ where: { id: dp.dp } })).status, "DIBAYAR");
  const d = await keu(w, po);
  assert.equal(d.status, "DIBATALKAN"); assert.equal(d.keuangan.peringatan.kode, "UANG_MUKA_PERLU_DIKEMBALIKAN_ATAU_DIALIHKAN");
  assert.match(d.keuangan.peringatan.pesan, /dikembalikan.*dialihkan/);
  assert.equal(d.keuangan.uangMukaBelumDiterapkan, 4_000_000);
  assert.equal((await bayarDP(w, po, { amount: 100 })).status, 409, "PO dibatalkan tidak bisa dibayar uang muka lagi");
  // dialihkan ke faktur lain milik supplier yang sama
  const po2 = await poDisetujui(w, { qty: 50 }); await terimaDanSimpan(w, po2, 50);
  const f2 = await faktur(w, po2, 50);
  assert.equal((await terapkan(w, dp.dp, f2, 3_000_000, { extra: { konfirmasiBedaPO: true } })).status, 201);
  assert.equal((await keu(w, po)).keuangan.uangMukaBelumDiterapkan, 1_000_000);
  await bukuSeimbang();
});

// ═══ 8. Pengaman ═══
test("pengaman bayar: wajib bukti/rekening/jumlah, PO draf/selesai ditolak, Idempotency-Key wajib; replay = satu dokumen; isi beda dengan kunci sama 422; paralel tidak melampaui nilai PO", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  assert.equal((await bayarDP(w, po, { extra: { receiptUrl: "" } })).status, 422, "bukti wajib");
  assert.equal((await bayarDP(w, po, { extra: { receiptUrl: "https://contoh.invalid/x.jpg" } })).status, 400);
  assert.equal((await bayarDP(w, po, { extra: { cashAccountId: "" } })).status, 400);
  assert.equal((await bayarDP(w, po, { amount: 0 })).status, 400);
  assert.equal((await w.f.post(`/api/finance/purchase-orders/${po.id}/uang-muka`, { amount: 1000, date: hariIni(), cashAccountId: w.bank.id, receiptUrl: BUKTI })).status, 428);
  const draf = (await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.busa.id, qty: 10, unitPrice: H }] })).body;
  assert.equal((await bayarDP(w, draf)).status, 409, "PO draf");
  assert.equal(await testPrisma.finPurchase.count(), 0, "tidak ada dokumen dari percobaan gagal");

  const h = kunci();
  const a = await bayarDP(w, po, { amount: 1_000_000, headers: h });
  const b = await bayarDP(w, po, { amount: 1_000_000, headers: h });
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.deepEqual(b.body.dp, a.body.dp, "replay = respons pertama");
  assert.equal(await testPrisma.finPurchase.count(), 1); assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 1_000_000);
  assert.equal((await bayarDP(w, po, { amount: 2_000_000, headers: h })).status, 422, "kunci sama, isi beda");

  // paralel: dua pembayaran 4 jt (sisa kapasitas 5 jt) → hanya satu yang lolos tanpa izin melebihi
  const [x, y] = await Promise.all([bayarDP(w, po, { amount: 4_000_000 }), bayarDP(w, po, { amount: 4_000_000 })]);
  assert.deepEqual([x.status, y.status].sort(), [201, 403], JSON.stringify([x.body, y.body]));
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 5_000_000);
  assert.equal(await testPrisma.finPurchase.count(), 2);
  await bukuSeimbang();
});

test("melebihi nilai PO: hanya Admin Finance, dengan peringatan eksplisit + alasan; kelebihan dicatat dan terlihat; tanpa refund kas otomatis", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  assert.equal((await bayarDP(w, po, { amount: 6_500_000 })).status, 403, "Finance biasa ditolak");
  const tanpaKonfirmasi = await bayarDP(w, po, { amount: 6_500_000, klien: w.a });
  assert.equal(tanpaKonfirmasi.status, 409); assert.equal(tanpaKonfirmasi.body.code, "UANG_MUKA_MELEBIHI_PO"); assert.equal(tanpaKonfirmasi.body.kelebihan, 500_000);
  assert.equal((await bayarDP(w, po, { amount: 6_500_000, klien: w.a, extra: { konfirmasiMelebihi: true, alasanMelebihi: "abc" } })).status, 409, "alasan minimal 5 karakter");
  const ok = await bayarDP(w, po, { amount: 6_500_000, klien: w.a, extra: { konfirmasiMelebihi: true, alasanMelebihi: "Supplier minta dibayar lunas + titip pesanan berikutnya" } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.keuangan.kelebihanPembayaran, 500_000); assert.equal(ok.body.keuangan.sisaKomitmen, 0);
  const dp = await testPrisma.finPurchase.findUnique({ where: { id: ok.body.dp } });
  assert.match(dp.advanceOverPoReason, /titip pesanan/);
  assert.equal(await saldoBank(w), -6_500_000, "uang keluar nyata; tidak ada refund otomatis");
  await bukuSeimbang();
});

test("penerapan: replay Idempotency-Key = satu penerapan; kunci sama isi beda 422; dua penerapan PARALEL atas saldo yang sama → satu berhasil; satu pembayaran tidak diterapkan dua kali", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const dp = (await bayarDP(w, po, { amount: 3_000_000 })).body;
  await terimaDanSimpan(w, po, 100);
  const billId = await faktur(w, po, 100);
  const h = kunci();
  const a = await terapkan(w, dp.dp, billId, 2_000_000, { headers: h });
  const b = await terapkan(w, dp.dp, billId, 2_000_000, { headers: h });
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(b.body.id, a.body.id, "replay = respons pertama (id sama)");
  assert.equal(await testPrisma.finSupplierBillAdvanceApplication.count(), 1);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TERAPKAN_UANG_MUKA" } }), 1);
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: billId } })).creditApplied), 2_000_000, "creditApplied bertambah sekali");
  assert.equal((await terapkan(w, dp.dp, billId, 1_000_000, { headers: h })).status, 422);
  // paralel: saldo tersisa 1 jt; dua penerapan 800 rb → hanya satu
  const [x, y] = await Promise.all([terapkan(w, dp.dp, billId, 800_000), terapkan(w, dp.dp, billId, 800_000)]);
  assert.deepEqual([x.status, y.status].sort(), [201, 400], JSON.stringify([x.body, y.body]));
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 200_000);
  // paralel dengan Idempotency-Key YANG SAMA (double-click): tidak ada jurnal/baris ganda — untuk penerapan DAN pembayaran uang muka
  const hp = kunci();
  const [p1, p2] = await Promise.all([terapkan(w, dp.dp, billId, 100_000, { headers: hp }), terapkan(w, dp.dp, billId, 100_000, { headers: hp })]);
  assert.ok([p1.status, p2.status].every((c) => c === 201 || c === 409), JSON.stringify([p1.body, p2.body]));
  assert.equal(await testPrisma.finSupplierBillAdvanceApplication.count({ where: { idempotencyKey: hp["Idempotency-Key"] } }), 1);
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 100_000, "hanya satu penerapan 100 rb");
  const hb = kunci(); const before = await testPrisma.finPurchase.count(); const poBaru = await poDisetujui(w, { qty: 10 });
  const [b1, b2] = await Promise.all([bayarDP(w, poBaru, { amount: 100_000, headers: hb }), bayarDP(w, poBaru, { amount: 100_000, headers: hb })]);
  assert.ok([b1.status, b2.status].every((c) => c === 201 || c === 409), JSON.stringify([b1.body, b2.body]));
  assert.ok([b1.status, b2.status].includes(201), "salah satu berhasil");
  assert.equal(await testPrisma.finPurchase.count(), before + 1, "double-click membayar uang muka hanya sekali");
  await bukuSeimbang();
});

test("periode tertutup & rekonsiliasi: bayar dan terapkan diblokir di periode tertutup; pembatalan penerapan diblokir bila jurnal sudah dicocokkan ke mutasi bank; pembatalan sah membalik jurnal dan mengembalikan sisa faktur", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const dp = (await bayarDP(w, po)).body;
  await terimaDanSimpan(w, po, 100);
  const billId = await faktur(w, po, 100);
  const t = (await terapkan(w, dp.dp, billId, 4_000_000)).body;

  // rekonsiliasi: jurnal penerapan dicocokkan → batal ditolak
  const baris = await testPrisma.finJournalLine.findFirst({ where: { entry: { source: "TERAPKAN_UANG_MUKA", sourceId: t.id } } });
  const st = await testPrisma.finBankStatement.create({ data: { cashAccountId: w.bank.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-12-31"), openingBalance: 0, closingBalance: 0, status: "DRAFT" } });
  const sl = await testPrisma.finBankStatementLine.create({ data: { statementId: st.id, date: new Date("2026-10-10"), description: "x", amount: 1, status: "COCOK", matchedLineId: baris.id } });
  const ditolak = await w.a.post(`/api/finance/purchase-orders/uang-muka/penerapan/${t.id}/batal`, { reason: "salah faktur" }, kunci());
  assert.equal(ditolak.status, 409); assert.equal(ditolak.body.code, "SUDAH_DIREKONSILIASI");
  assert.equal((await w.f.post(`/api/finance/purchase-orders/uang-muka/penerapan/${t.id}/batal`, { reason: "salah faktur" }, kunci())).status, 403, "hanya finance:admin");
  await testPrisma.finBankStatementLine.delete({ where: { id: sl.id } });

  // pembatalan sah
  const jurnal = await testPrisma.finJournalEntry.count();
  const ok = await w.a.post(`/api/finance/purchase-orders/uang-muka/penerapan/${t.id}/batal`, { reason: "Salah faktur, akan diterapkan ulang" }, kunci());
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await testPrisma.finJournalEntry.count(), jurnal + 1, "satu jurnal pembalik (bukan edit)");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -6_000_000); assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 4_000_000);
  const ap = await testPrisma.finSupplierBillAdvanceApplication.findUnique({ where: { id: t.id } });
  assert.deepEqual([ap.status, !!ap.reversalJournalId, ap.reverseReason], ["REVERSED", true, "Salah faktur, akan diterapkan ulang"]);
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: billId } })).creditApplied), 0);
  assert.equal((await w.a.post(`/api/finance/purchase-orders/uang-muka/penerapan/${t.id}/batal`, { reason: "dua kali" }, kunci())).status, 409);

  // periode tertutup
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  await testPrisma.finPeriod.upsert({ where: { year_month: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 } }, update: { status: "CLOSED" }, create: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, status: "CLOSED" } });
  const jurnalTutup = await testPrisma.finJournalEntry.count();
  assert.equal((await terapkan(w, dp.dp, billId, 1_000_000)).status >= 400, true, "terapkan di periode tertutup diblokir");
  assert.equal((await bayarDP(w, po, { amount: 1_000_000 })).status >= 400, true, "bayar uang muka di periode tertutup diblokir");
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalTutup, "tidak ada jurnal baru");
  assert.equal(await testPrisma.finPurchase.count(), 1, "tidak ada dokumen setengah jadi");
});

test("koreksi dan pembatalan uang muka: diblokir selama ada penerapan aktif; supplier/kategori DP terikat PO tidak bisa dikoreksi; setelah penerapan dibatalkan, koreksi nominal membalik jurnal lama lalu memposting ulang (bukan edit jurnal)", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const dp = (await bayarDP(w, po)).body;
  await terimaDanSimpan(w, po, 100);
  const billId = await faktur(w, po, 100);
  const t = (await terapkan(w, dp.dp, billId, 4_000_000)).body;
  const k1 = await w.a.post(`/api/finance/purchases/${dp.dp}/koreksi`, { reason: "Nominal salah ketik", amount: 4_500_000 });
  assert.equal(k1.status, 409); assert.match(k1.body.error, /penerapan uang muka yang aktif/);
  const c1 = await w.a.post(`/api/finance/purchases/${dp.dp}/cancel`, { reason: "salah" });
  assert.equal(c1.status, 409); assert.match(c1.body.error, /penerapan uang muka yang aktif/);
  const kSup = await w.a.post(`/api/finance/purchases/${dp.dp}/koreksi`, { reason: "ganti supplier", supplierId: w.supplier2.id });
  assert.equal(kSup.status, 409); assert.match(kSup.body.error, /terikat ke sebuah PO/);
  assert.equal((await w.a.post(`/api/finance/purchase-orders/uang-muka/penerapan/${t.id}/batal`, { reason: "dibatalkan untuk koreksi" }, kunci())).status, 200);
  const jurnalSebelum = await testPrisma.finJournalEntry.count();
  const k2 = await w.a.post(`/api/finance/purchases/${dp.dp}/koreksi`, { reason: "Nominal salah ketik", amount: 4_500_000 });
  assert.equal(k2.status, 200, JSON.stringify(k2.body));
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 4_500_000); assert.equal(await saldoBank(w), -4_500_000);
  assert.ok(await testPrisma.finJournalEntry.count() >= jurnalSebelum + 2, "jurnal lama dibalik + jurnal baru (tidak ada edit)");
  const lama = await testPrisma.finJournalEntry.count({ where: { source: "PEMBELIAN", status: "REVERSED" } });
  assert.equal(lama, 1);
  assert.equal((await testPrisma.finPurchase.findUnique({ where: { id: dp.dp } })).purchaseOrderId, po.id, "tautan PO tetap");
  // uang muka tanpa penerapan boleh dibatalkan total
  const po2 = await poDisetujui(w, { qty: 10 });
  const dp2 = (await bayarDP(w, po2, { amount: 100_000 })).body;
  assert.equal((await w.a.post(`/api/finance/purchases/${dp2.dp}/cancel`, { reason: "supplier mengembalikan uang muka" })).status, 200);
  assert.equal((await keu(w, po2)).keuangan.uangMukaDibayar, 0, "DP yang dibatalkan tidak dihitung");
  await bukuSeimbang();
});

test("retur dan Debit Note tidak menghitung uang muka dua kali: uang muka 4 jt + Debit Note 600 rb pada faktur 6 jt → sisa utang 1,4 jt (bukan 1 jt atau 2 jt)", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const dp = (await bayarDP(w, po)).body;
  const r = await terimaDanSimpan(w, po, 100);
  const billId = await faktur(w, po, 100);
  assert.equal((await terapkan(w, dp.dp, billId, 4_000_000)).status, 201);
  const retur = await w.g.post("/api/inventory/retur-supplier", { reasonCode: "RUSAK", reason: "Busa pecah-pecah saat dibongkar", evidenceUrls: ["https://contoh.invalid/foto.jpg"], lines: [{ goodsReceiptLineId: r.lineId, qty: 10 }] }, kunci());
  assert.equal(retur.status, 201, JSON.stringify(retur.body));
  const k = await w.g.post(`/api/inventory/retur-supplier/${retur.body.returnId}/keluar`, { pic: "Budi Gudang", note: "Diserahkan ke kurir", proofUrls: ["https://contoh.invalid/bukti.jpg"] }, kunci());
  assert.equal(k.status, 200, JSON.stringify(k.body));
  const pv = (await w.f.get(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/pratinjau`)).body;
  assert.deepEqual([pv.nilai, pv.kurangiSisaUtang, pv.jadiSaldoKredit], [600_000, 600_000, 0], "pratinjau DN memakai sisa SETELAH uang muka");
  const setuju = await w.ap.post(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/setujui`, { note: "Sesuai retur", kurangiSisaDiharapkan: 600_000 }, kunci());
  assert.equal(setuju.status, 200, JSON.stringify(setuju.body));
  const bill = await testPrisma.finSupplierBill.findUnique({ where: { id: billId } });
  assert.equal(Number(bill.creditApplied), 4_600_000, "uang muka 4 jt + Debit Note 600 rb");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -1_400_000, "buku: 6 jt − 4 jt (uang muka) − 600 rb (DN)");
  const d = await keu(w, po);
  assert.deepEqual([d.keuangan.uangMukaDiterapkan, d.keuangan.pengurangLain, d.keuangan.utangTercatat, d.keuangan.sisaUtang], [4_000_000, 600_000, 1_400_000, 1_400_000]);
  const aging = (await w.f.get("/api/finance/utang/aging")).body;
  assert.equal(aging.ringkasan.kartu.totalUtangAktif, 1_400_000);
  // membatalkan penerapan uang muka tidak ikut membatalkan Debit Note
  const ap = await testPrisma.finSupplierBillAdvanceApplication.findFirst({ where: { billId } });
  assert.equal((await w.a.post(`/api/finance/purchase-orders/uang-muka/penerapan/${ap.id}/batal`, { reason: "diterapkan ke faktur lain" }, kunci())).status, 200);
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: billId } })).creditApplied), 600_000, "hanya bagian uang muka yang kembali");
  await bukuSeimbang();
});

// ═══ 9. Gudang & izin ═══
test("Gudang tidak melihat uang muka, rekening, biaya admin, harga, atau utang; tidak bisa membayar uang muka atau menerapkannya; Sales juga tidak; baca uang muka butuh finance:read", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const dp = (await bayarDP(w, po, { extra: { paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: 2_500 } })).body;
  await terimaDanSimpan(w, po, 100);
  const billId = await faktur(w, po, 100);
  await terapkan(w, dp.dp, billId, 1_000_000);
  const g = (await w.g.get(`/api/inventory/purchase-orders/${po.id}`)).body;
  const mentah = JSON.stringify(g);
  for (const kata of ["keuangan", "uangMuka", "biayaAdmin", "transferFee", "paymentReference", "rekening", "Bank Uji", "hargaSatuan", "nilaiPO", "utangTercatat", "creditApplied", "4000000", "TRF-UM-001"]) {
    assert.equal(mentah.includes(kata), false, `Gudang tidak boleh melihat "${kata}"`);
  }
  const gd = (await w.g.get(`/api/inventory/barang-akan-datang/${po.id}`)).body;
  for (const kata of ["uangMuka", "keuangan", "biayaAdmin", "Bank Uji", "TRF-UM"]) assert.equal(JSON.stringify(gd).includes(kata), false, `Barang Akan Datang (Gudang): tanpa "${kata}"`);
  for (const [klien, nama] of [[w.g, "Gudang"], [w.s, "Sales"]]) {
    for (const [metode, path, body] of [
      ["get", `/api/finance/purchase-orders/${po.id}/uang-muka`], ["get", "/api/finance/purchase-orders/uang-muka"], ["get", "/api/finance/purchase-orders/uang-muka/ringkasan-supplier"],
      ["get", `/api/finance/purchase-orders/uang-muka/faktur/${billId}/kandidat`],
      ["post", `/api/finance/purchase-orders/${po.id}/uang-muka`, { amount: 1000, date: hariIni(), cashAccountId: w.bank.id, receiptUrl: BUKTI }],
      ["post", "/api/finance/purchase-orders/uang-muka/terapkan", { advanceId: dp.dp, billId, amount: 1000, konfirmasi: true }],
    ]) {
      const r = metode === "get" ? await klien.get(path) : await klien.post(path, body, kunci());
      assert.equal(r.status, 403, `${nama} ${metode.toUpperCase()} ${path} → ${r.status}`);
    }
  }
  assert.equal((await unduhExport(server.baseUrl, (await createTestUser({ roles: ["WAREHOUSE"] })).token, "uang-muka-supplier", {})).status, 403, "export uang muka: finance:read");
  // finance:read saja tidak boleh menulis
  const akuntan = makeClient(server.baseUrl, (await createTestUser({ roles: ["APPROVER"] })).token);
  assert.equal((await bayarDP(w, po, { klien: akuntan, amount: 1000 })).status, 403, "Approver tidak punya finance:post");
  // ID bukan UUID → 400 bersih
  assert.equal((await w.f.get("/api/finance/purchase-orders/bukan-uuid/uang-muka")).status, 400);
  assert.equal((await terapkan(w, "bukan-uuid", billId, 1000)).status, 400);
});

// ═══ 10. Konsistensi kartu/detail/export setelah banyak tahap ═══
test("PO dengan uang muka di kartu Supplier & Utang: Utang Aktif hanya faktur disetujui; Uang Muka Belum Diterapkan terpisah; aging hanya faktur; neraca: uang muka = aset", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  await bayarDP(w, po, { amount: 2_000_000 });
  await terimaDanSimpan(w, po, 100);
  await faktur(w, po, 100, { setuju: false }); // faktur belum disetujui → bukan utang
  let ring = (await w.f.get("/api/finance/purchase-orders/uang-muka/ringkasan-supplier")).body;
  assert.deepEqual([ring.kartu.utangAktif, ring.kartu.uangMukaBelumDiterapkan], [0, 2_000_000]);
  const aging = (await w.f.get("/api/finance/utang/aging")).body;
  assert.equal(aging.baris.length, 0, "aging hanya faktur disetujui");
  const neraca = (await w.a.get("/api/finance/reports/balance-sheet")).body;
  const teks = JSON.stringify(neraca);
  assert.ok(/Uang Muka Pembelian|Uang Muka Supplier/i.test(teks), "Uang Muka tampil di neraca");
  const aset = neraca.aset ?? neraca.assets ?? null;
  if (aset) assert.ok(JSON.stringify(aset).includes("2000000"), "uang muka berada di sisi aset");
  await bukuSeimbang();
});
