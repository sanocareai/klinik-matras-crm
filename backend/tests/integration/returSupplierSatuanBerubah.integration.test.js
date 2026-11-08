// PENJAGA SATUAN BERUBAH SEJAK PENERIMAAN (Nov 2026). Risiko: dokumen yang jumlahnya dicatat dalam satuan LAMA (penerimaan LIST WIBING dalam ROLL) memasukkan/mengeluarkan ANGKA MENTAH ke saldo yang sudah berganti satuan (METER).
// Dikunci terhadap PostgreSQL sungguhan: (1) empat baris LIST WIBING hasil reproduksi production (PUTIH ×1, ABU ×2, COKLAT ×1) ditolak di pratinjau, draf, dan konfirmasi keluar; (2) draf sebelum transisi tidak bisa diposting sesudahnya;
// (3) penerimaan BARU sesudah transisi tetap bisa diretur dalam satuan baru; (4) pembatalan retur yang keluar sebelum transisi ditolak; (5) koreksi penerimaan Finance menolak; (6) retur pelanggan atas catatan satuan lama tidak masuk stok.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { pratinjauTransisi, terapkanTransisi } from "../../src/services/transisiSatuanBahan.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const KODE = "SATUAN_BERUBAH_SEJAK_PENERIMAAN";
const HARGA_PO = 85_000;
const HASH_REF = "f5d08fab2c0b38a0b84ebbf712a1655723133af599c69b64b758a626f5033a9d";
const kunci = () => ({ "Idempotency-Key": `rsb-${randomUUID()}` });
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
const BUKTI = ["https://contoh.invalid/foto-kondisi-1.jpg"];
let seq = 0;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const [fin, admin, gudang, owner] = await Promise.all(["FINANCE", "ADMIN", "WAREHOUSE", "OWNER"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-UJI", name: "PT UJI SATUAN", paymentTermType: "HARI", paymentTermDays: 30 } });
  return { f: c(fin), a: c(admin), g: c(gudang), B: { id: owner.user.id, name: owner.user.name, roles: ["OWNER"] }, supplier };
}
const bahan = (kode) => createTestMaterial({ code: kode, name: kode.replaceAll("-", " "), unit: "ROLL" });
async function poDisetujui(w, material, qty, harga = HARGA_PO) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: geser(-20), lines: [{ materialId: material.id, qty, unitPrice: harga }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
async function terimaSimpan(w, po, qty) {
  const t = await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, { penerima: "Budi Gudang", catatan: "Barang tiba utuh", tanggalTiba: geser(-5), lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: qty }] }, kunci());
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const id = t.body.receiptId; const gr = (await w.g.get(`/api/inventory/goods-receipts/${id}`)).body;
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}`, { status: "INSPECTION" })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}/lines/${gr.lines[0].id}`, { acceptedQty: qty, rejectedQty: 0 })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}`, { status: "READY_FOR_PUTAWAY" })).status, 200);
  const p = await w.g.post(`/api/inventory/goods-receipts/${id}/putaway`, {}); assert.equal(p.status, 200, JSON.stringify(p.body));
  return { receiptId: id, lineId: gr.lines[0].id };
}
const pratinjauRetur = (w, lineId, qty) => w.g.post("/api/inventory/retur-supplier/pratinjau", { reasonCode: "RUSAK", reason: "Gulungan rusak saat dibongkar", evidenceUrls: BUKTI, lines: [{ goodsReceiptLineId: lineId, qty }] });
const buatRetur = (w, lineId, qty) => w.g.post("/api/inventory/retur-supplier", { reasonCode: "RUSAK", reason: "Gulungan rusak saat dibongkar", evidenceUrls: BUKTI, lines: [{ goodsReceiptLineId: lineId, qty }] }, kunci());
const keluar = (w, id) => w.g.post(`/api/inventory/retur-supplier/${id}/keluar`, { pic: "Budi Gudang", note: "Diserahkan ke kurir", proofUrls: BUKTI }, kunci());
const batal = (w, id) => w.g.post(`/api/inventory/retur-supplier/${id}/batal`, { reason: "Barang kembali ke gudang" }, kunci());
const pakaiSebelumTerima = (materialId, qty, detik) => testPrisma.stockMovement.create({ data: { materialId, type: "ISSUE", qty: -qty, reason: "Pemakaian lama (uji): terjadi SEBELUM penerimaan, seperti production", createdAt: new Date(Date.now() - 2 * 86_400_000 + detik * 1000) } });
const saldo = async (id) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: id }, _sum: { qty: true } }))._sum.qty ?? 0);
const jejak = async () => ({ gerak: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), retur: await testPrisma.supplierReturn.count(), returRec: await testPrisma.returnRecord.count() });
async function transisi(w, bahanSaldo, satuanBaru = "METER") { // bahanSaldo: [[material, saldoBaru], ...] — satu transaksi
  const minta = bahanSaldo.map(([m, s]) => ({ materialId: m.id, satuanBaru, saldoBaru: s, kewajibanTerbuka: [] }));
  const p = await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: minta });
  assert.equal(p.bolehDiterapkan, true, JSON.stringify(p.transisi.map((t) => t.penghalang)));
  return terapkanTransisi(testPrisma, { aktor: w.B, transisi: minta.map((x, i) => ({ ...x, hashPratinjau: p.transisi[i].hash })), sumber: "KIRIM GILANG.xlsx lembar GILANG (uji)", alasan: "Satuan operasional mengikuti Excel SO; saldo awal satuan baru = hasil SO", rujukanHash: HASH_REF, kunci: `rsb-tr-${++seq}-abcdefgh` });
}
const kodeDari = (r) => r.body?.code ?? r.body?.kode ?? null;

test("R1. empat baris LIST WIBING (PUTIH, ABU×2, COKLAT; saldo lama negatif): sebelum transisi retur terblokir stok; SESUDAH transisi pratinjau/draf tetap ditolak SATUAN_BERUBAH, tanpa pergerakan/jurnal", async () => {
  const w = await dunia();
  const spesifikasi = [["LIST-UJI-PUTIH", [10], 360, 1080], ["LIST-UJI-ABU", [5, 10], 400, 540], ["LIST-UJI-COKLAT", [10], 120, 270]]; // penerimaan ROLL, pemakaian lama (angka meter) membuat saldo negatif, hasil SO METER
  const dunia4 = []; let detik = 10;
  for (const [kode, terima, pemakaian] of spesifikasi) {
    const m = await bahan(kode); const baris = [];
    await pakaiSebelumTerima(m.id, pemakaian, ++detik);
    for (const q of terima) { const po = await poDisetujui(w, m, q); baris.push({ ...(await terimaSimpan(w, po, q)), q }); }
    dunia4.push({ m, baris });
  }
  assert.ok(dunia4.every((d) => true)); for (const d of dunia4) assert.ok((await saldo(d.m.id)) < 0, "saldo lama negatif (meniru production)");
  // SEBELUM transisi: retur tidak mungkin (saldo tidak cukup)
  for (const d of dunia4) for (const b of d.baris) { const pv = await pratinjauRetur(w, b.lineId, b.q); assert.equal(pv.status, 200); assert.equal(pv.body.boleh, false); assert.ok(!pv.body.baris[0].blokir.some((x) => x.kode === KODE)); }
  await transisi(w, [[dunia4[0].m, 1080], [dunia4[1].m, 540], [dunia4[2].m, 270]]);
  for (const d of dunia4) assert.equal(await saldo(d.m.id), d.m.code === "LIST-UJI-PUTIH" ? 1080 : d.m.code === "LIST-UJI-ABU" ? 540 : 270);
  const j0 = await jejak(); let diperiksa = 0;
  for (const d of dunia4) for (const b of d.baris) {
    const pv = await pratinjauRetur(w, b.lineId, b.q);
    assert.equal(pv.status, 200); assert.equal(pv.body.boleh, false); assert.equal(pv.body.baris[0].bolehDiretur, 0);
    assert.equal(pv.body.baris[0].blokir[0].kode, KODE, "alasan pertama = satuan berubah"); assert.match(pv.body.baris[0].blokir[0].pesan, /satuan lama \(ROLL\).*METER.*tidak dikonversi otomatis/s);
    const draf = await buatRetur(w, b.lineId, b.q); assert.equal(draf.status, 409, JSON.stringify(draf.body)); assert.equal(kodeDari(draf), KODE);
    diperiksa += 1;
  }
  assert.equal(diperiksa, 4);
  assert.deepEqual(await jejak(), j0, "tidak ada retur, pergerakan, atau jurnal yang tertulis");
});

test("R2. draf retur dibuat SEBELUM transisi lalu dikeluarkan SESUDAHNYA: ditolak di transaksi pengeluaran; draf tetap DRAFT, stok/jurnal tak tersentuh; draf masih bisa dibatalkan", async () => {
  const w = await dunia(); const m = await bahan("LIST-UJI-DRAF"); await pakaiSebelumTerima(m.id, 50, 1); const po = await poDisetujui(w, m, 10); const r = await terimaSimpan(w, po, 10);
  const draf = await buatRetur(w, r.lineId, 2); assert.equal(draf.status, 201, JSON.stringify(draf.body));
  await transisi(w, [[m, 900]]);
  const j0 = await jejak(); const s0 = await saldo(m.id);
  const k = await keluar(w, draf.body.returnId); assert.equal(k.status, 409, JSON.stringify(k.body)); assert.equal(kodeDari(k), KODE); assert.match(k.body.error ?? k.body.message ?? "", /satuan lama/);
  assert.deepEqual(await jejak(), j0); assert.equal(await saldo(m.id), s0); assert.equal(s0, 900);
  assert.equal((await testPrisma.supplierReturn.findUnique({ where: { id: draf.body.returnId } })).status, "DRAFT");
  assert.equal((await batal(w, draf.body.returnId)).status, 200, "draf tetap dapat dibatalkan"); assert.equal(await saldo(m.id), 900);
});

test("R3. penerimaan BARU sesudah transisi tetap bisa diretur dalam satuan baru; penerimaan lama pada bahan yang sama tetap ditolak", async () => {
  const w = await dunia(); const m = await bahan("LIST-UJI-BARU"); await pakaiSebelumTerima(m.id, 50, 1); const poLama = await poDisetujui(w, m, 10); const lama = await terimaSimpan(w, poLama, 10);
  await transisi(w, [[m, 900]]);
  assert.equal((await pratinjauRetur(w, lama.lineId, 2)).body.baris[0].blokir[0].kode, KODE);
  const poBaru = await poDisetujui(w, m, 20, 940); const baru = await terimaSimpan(w, poBaru, 20); // METER = satuan master sekarang (tanpa konversi)
  assert.equal(await saldo(m.id), 920);
  const pv = await pratinjauRetur(w, baru.lineId, 5); assert.equal(pv.status, 200, JSON.stringify(pv.body)); assert.equal(pv.body.boleh, true, JSON.stringify(pv.body.baris[0].blokir)); assert.equal(pv.body.baris[0].satuan, "METER");
  const draf = await buatRetur(w, baru.lineId, 5); assert.equal(draf.status, 201, JSON.stringify(draf.body));
  const k = await keluar(w, draf.body.returnId); assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(await saldo(m.id), 915, "−5 METER dari penerimaan baru");
  const mv = await testPrisma.stockMovement.findFirst({ where: { materialId: m.id, type: "SUPPLIER_RETURN" } }); assert.equal(Number(mv.qty), -5); assert.equal(mv.unitAtEntry, "METER");
});

test("R4. pembatalan retur yang barangnya KELUAR sebelum transisi ditolak (tidak menambah jumlah mentah ke saldo satuan baru)", async () => {
  const w = await dunia(); const m = await bahan("LIST-UJI-BATAL"); const po = await poDisetujui(w, m, 10); const r = await terimaSimpan(w, po, 10);
  const draf = await buatRetur(w, r.lineId, 2); assert.equal(draf.status, 201); const k = await keluar(w, draf.body.returnId); assert.equal(k.status, 200, JSON.stringify(k.body)); assert.equal(await saldo(m.id), 8);
  await transisi(w, [[m, 720]]); const j0 = await jejak();
  const b = await batal(w, draf.body.returnId); assert.equal(b.status, 409, JSON.stringify(b.body)); assert.equal(kodeDari(b), KODE);
  assert.deepEqual(await jejak(), j0); assert.equal(await saldo(m.id), 720);
  assert.equal((await testPrisma.supplierReturn.findUnique({ where: { id: draf.body.returnId } })).status !== "DIBATALKAN", true);
});

test("R5. koreksi penerimaan Finance atas penerimaan bersatuan lama ditolak dengan sebab satuan, tanpa pergerakan/jurnal; sebelum transisi koreksi normal jalan", async () => {
  const w = await dunia(); const m = await bahan("LIST-UJI-KOR"); const po = await poDisetujui(w, m, 6); const r = await terimaSimpan(w, po, 6);
  const koreksi = (rev, perubahan) => w.f.post(`/api/finance/purchase-orders/penerimaan/${r.receiptId}/koreksi-kedatangan`, { revisi: rev, alasan: "Dus keenam salah hitung di surat jalan", perubahan, pratinjau: true });
  const body = { lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: 5, jumlahBaik: 5 }] };
  const sebelum = await koreksi(1, body); assert.equal(sebelum.status, 200, JSON.stringify(sebelum.body)); // jalur normal masih berfungsi sebelum transisi
  await transisi(w, [[m, 450]]); const j0 = await jejak();
  const sesudah = await w.f.post(`/api/finance/purchase-orders/penerimaan/${r.receiptId}/koreksi-kedatangan`, { revisi: 1, alasan: "Dus keenam salah hitung di surat jalan", perubahan: body }, kunci());
  assert.equal(sesudah.status, 409, JSON.stringify(sesudah.body)); assert.equal(kodeDari(sesudah), KODE);
  const pv = await koreksi(1, body); // desain yang ada: pratinjau terblokir = HTTP 200 + boleh:false + daftar blokir
  assert.equal(pv.status, 200, JSON.stringify(pv.body)); assert.equal(pv.body.boleh, false, "pratinjau juga menolak"); assert.equal(pv.body.blokir[0].kode, KODE);
  assert.deepEqual(await jejak(), j0); assert.equal(await saldo(m.id), 450);
});

test("R6. retur pelanggan dicatat dalam satuan lama lalu diselesaikan SESUDAH transisi: ditolak, tidak masuk stok; retur yang dicatat sesudah transisi masuk dalam satuan baru", async () => {
  const w = await dunia(); const m = await bahan("LIST-UJI-RETPEL"); const po = await poDisetujui(w, m, 10); await terimaSimpan(w, po, 10);
  const buat = async (qty) => { const c = await w.g.post("/api/inventory/returns", { returnType: "CUSTOMER_RETURN", materialId: m.id, qty }); assert.equal(c.status, 201, JSON.stringify(c.body)); for (const st of ["RECEIVED", "INSPECTION"]) { const p = await w.g.patch(`/api/inventory/returns/${c.body.id}`, { status: st }); assert.equal(p.status, 200, JSON.stringify(p.body)); } return c.body.id; };
  const lama = await buat(2); // dicatat saat satuan masih ROLL
  await transisi(w, [[m, 900]]); const j0 = await jejak();
  const sel = await w.g.post(`/api/inventory/returns/${lama}/complete`, { resolution: "RETURN_TO_AVAILABLE" });
  assert.equal(sel.status, 409, JSON.stringify(sel.body)); assert.match(sel.body.error, /satuan lama \(ROLL\).*METER.*tidak dikonversi otomatis/s);
  assert.deepEqual(await jejak(), j0); assert.equal(await saldo(m.id), 900); assert.equal((await testPrisma.returnRecord.findUnique({ where: { id: lama } })).status, "INSPECTION");
  assert.equal((await w.g.post(`/api/inventory/returns/${lama}/complete`, { resolution: "DISPOSE" })).status, 200, "resolusi tanpa stok tidak terblokir");
  const baru = await buat(3); const ok = await w.g.post(`/api/inventory/returns/${baru}/complete`, { resolution: "RETURN_TO_AVAILABLE" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(await saldo(m.id), 903);
  const mv = await testPrisma.stockMovement.findFirst({ where: { materialId: m.id, type: "RETURN" } }); assert.equal(Number(mv.qty), 3); assert.equal(mv.unitAtEntry, "METER");
});
