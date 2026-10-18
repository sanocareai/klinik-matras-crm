// UX GUDANG TAHAP 3 (lanjutan) — FLEKSIBILITAS STATUS Penerimaan Barang. DB terisolasi. Matriks perpindahan maju & mundur, alasan wajib + jejak (pelaku/waktu/asal/tujuan/alasan), idempoten, revisi basi,
// dua pengguna bersamaan, tanpa efek stok/jurnal selama belum diposting, terposting hanya lewat Koreksi Gudang, dan kasus dua GR Ocean (bentuk data production, DB uji).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const GR = "/api/inventory/goods-receipts";
const kunci = () => ({ "Idempotency-Key": `mu-${randomUUID()}` });
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const [fin, g1, g2, lead] = await Promise.all(["FINANCE", "WAREHOUSE", "WAREHOUSE", "PRODUCTION_LEAD"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-OCEAN", name: "PT OCEAN CENTRA FURNINDO", paymentTermType: "HARI", paymentTermDays: 30 } });
  const o120 = await createTestMaterial({ code: "BUSA-OCEAN-D18-120X200X2CM", name: "Busa Ocean D18 120x200x2", unit: "SHEET" });
  const o160 = await createTestMaterial({ code: "BUSA-OCEAN-D18-160X200X2CM", name: "Busa Ocean D18 160x200x2", unit: "SHEET" });
  return { f: c(fin), g: c(g1), g2: c(g2), p: c(lead), g1Id: g1.user.id, supplier, o120, o160 };
}
async function poOcean(w) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: geser(-20), expectedDate: geser(-1), lines: [{ materialId: w.o120.id, qty: 10, unitPrice: 100_000 }, { materialId: w.o160.id, qty: 40, unitPrice: 150_000 }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {}); assert.equal(s.status, 200, JSON.stringify(s.body)); return s.body;
}
const draf = async (w, po, jadwal = geser(-1)) => { const c = await w.g.post(GR, { purchaseOrderId: po.id, expectedDate: jadwal }); assert.equal(c.status, 201, JSON.stringify(c.body)); return c.body; };
const detail = async (w, id) => (await w.g.get(`${GR}/${id}`)).body;
const maju = (w, id, status, revisi) => w.g.patch(`${GR}/${id}`, { status, ...(revisi && { revisi }) });
const mundur = (w, id, ke, alasan = "Salah klik status", revisi) => w.g.post(`${GR}/${id}/mundur`, { ke, alasan, ...(revisi && { revisi }) });
const tiba = async (w, po, g) => { const baris = (await detail(w, g.id)).lines; const r = await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, { receiptId: g.id, tanggalTiba: geser(-1), penerima: "Budi Gudang", catatan: "Barang tiba (uji)", lines: baris.map((l) => ({ purchaseOrderLineId: l.purchaseOrderLineId, jumlahDatang: Number(l.orderedQty) })) }, kunci()); assert.equal(r.status, 201, JSON.stringify(r.body)); };
const manual = async (w) => { const m = await createTestMaterial({ code: "BHN-" + randomUUID().slice(0, 5), name: "Bahan Manual", unit: "PCS" }); const c = await w.g.post(GR, { sourceType: "MANUAL", supplier: "Toko Uji", expectedDate: geser(1), lines: [{ materialId: m.id, orderedQty: 5 }] }); assert.equal(c.status, 201, JSON.stringify(c.body)); return c.body; };
const snap = async () => ({
  mov: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), jurnalBaris: await testPrisma.finJournalLine.count(), gr: await testPrisma.goodsReceipt.count(),
  saldo: Number((await testPrisma.stockMovement.aggregate({ _sum: { qty: true } }))._sum.qty ?? 0), po: JSON.stringify((await testPrisma.finPurchaseOrderLine.findMany({ orderBy: { id: "asc" }, select: { id: true, qty: true } })).map((l) => [l.id, String(l.qty)])),
  tagihan: await testPrisma.finSupplierBill.count(),
});
const barisAngka = async (id) => JSON.stringify((await testPrisma.goodsReceiptLine.findMany({ where: { goodsReceiptId: id }, orderBy: { id: "asc" }, select: { id: true, materialId: true, orderedQty: true, receivedQty: true, acceptedQty: true, rejectedQty: true } })).map((l) => [l.id, l.materialId, String(l.orderedQty), String(l.receivedQty), String(l.acceptedQty), String(l.rejectedQty)]));
const dok = async (id) => { const d = await testPrisma.goodsReceipt.findUnique({ where: { id } }); return JSON.stringify({ n: d.receiptNumber, s: d.status, po: d.purchaseOrderId, u: d.updatedAt.toISOString(), ex: d.expectedDate?.toISOString() ?? null }); };
const pindah = (d) => d.tampilan.pipeline.pindah.map((x) => `${x.jenis}:${x.ke}`).sort();

test("OCEAN: dua GR satu PO tetap dua dokumen; GR uji Draf → Terjadwal → Draf → Terjadwal (diulang); GR lain, jumlah, PO, stok, movement, jurnal TIDAK berubah; nomor & riwayat status jelas", async () => {
  const w = await dunia(); const po = await poOcean(w);
  const a = await draf(w, po, geser(-1)); const b = await draf(w, po, geser(1));
  assert.notEqual(a.receiptNumber, b.receiptNumber); assert.equal(a.purchaseOrderId, b.purchaseOrderId);
  const awal = await snap(); const barisA0 = await barisAngka(a.id); const barisB0 = await barisAngka(b.id); const dokB0 = await dok(b.id);
  // Draf → Terjadwal → Draf → Terjadwal → Draf → Terjadwal (tiga putaran), memakai revisi dari layar
  let d = await detail(w, a.id); assert.equal(d.status, "DRAFT");
  const urut = [];
  for (let i = 0; i < 3; i++) {
    let r = await maju(w, a.id, "SCHEDULED", d.revisi); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, "SCHEDULED"); assert.equal(r.body.ulang, false); urut.push("SCHEDULED");
    d = await detail(w, a.id); assert.ok(pindah(d).includes("mundur:DRAF"), "Terjadwal menawarkan kembali ke Draf");
    r = await mundur(w, a.id, "DRAFT", `Salah jadwalkan putaran ${i + 1}`, d.revisi); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, "DRAFT"); assert.equal(r.body.ulang, false); urut.push("DRAFT");
    d = await detail(w, a.id);
  }
  assert.equal((await maju(w, a.id, "SCHEDULED", d.revisi)).status, 200); d = await detail(w, a.id); assert.equal(d.status, "SCHEDULED");
  assert.equal(await dok(b.id), dokB0, "GR lain di PO yang sama TIDAK berubah (status, jadwal, updatedAt)");
  assert.equal(await barisAngka(b.id), barisB0); assert.equal(await barisAngka(a.id), barisA0, "jumlah baris GR yang diubah statusnya tidak berubah");
  assert.deepEqual(await snap(), awal, "PO, stok, movement, jurnal, tagihan tidak berubah selama belum diposting");
  // dua dokumen tetap berbeda di daftar, nomor jelas
  const lst = (await w.g.get(GR)).body.receipts.filter((x) => x.purchaseOrderId === po.id); assert.deepEqual(lst.map((x) => x.receiptNumber).sort(), [a.receiptNumber, b.receiptNumber].sort());
  assert.equal(lst.find((x) => x.id === b.id).status, "DRAFT"); assert.equal(lst.find((x) => x.id === a.id).status, "SCHEDULED");
  // riwayat status: setiap perpindahan tercatat dengan pelaku, waktu, asal → tujuan, alasan
  const j = d.jejak.filter((x) => ["STATUS_MAJU", "KEMBALI_KE_DRAF"].includes(x.aksi)); assert.equal(j.length, 7, "4 maju + 3 mundur");
  assert.deepEqual(j.map((x) => `${x.dari}>${x.ke}`), ["Draf>Terjadwal", "Terjadwal>Draf", "Draf>Terjadwal", "Terjadwal>Draf", "Draf>Terjadwal", "Terjadwal>Draf", "Draf>Terjadwal"]);
  for (const x of j.filter((y) => y.aksi === "KEMBALI_KE_DRAF")) { assert.ok(x.oleh, "pelaku"); assert.ok(x.waktu, "waktu"); assert.match(x.alasan, /Salah jadwalkan putaran/); }
  assert.equal((await detail(w, b.id)).jejak.filter((x) => x.aksi === "KEMBALI_KE_DRAF" || x.aksi === "STATUS_MAJU").length, 0, "riwayat GR lain kosong");
  // jadwal GR lain tetap sendiri: ubah jadwal B tidak menyentuh A
  const dokA1 = await dok(a.id); assert.equal((await w.g.patch(`${GR}/${b.id}`, { expectedDate: geser(7) })).status, 200); assert.equal(await dok(a.id), dokA1);
  // GR Ocean kedua juga bisa Draf → Terjadwal → Draf, dan GR pertama tetap
  const dB = await detail(w, b.id); assert.equal((await maju(w, b.id, "SCHEDULED", dB.revisi)).status, 200); assert.equal((await mundur(w, b.id, "DRAFT")).status, 200); assert.equal(await dok(a.id), dokA1);
  assert.deepEqual(await snap(), awal);
});

test("MATRIKS: tiap status menawarkan tepat perpindahan sah (maju & mundur) dari server; terposting dan alur berhenti sesuai aturan", async () => {
  const w = await dunia(); const g = await manual(w); let d = await detail(w, g.id);
  assert.deepEqual(pindah(d), ["maju:TERJADWAL", "tutup:DIBATALKAN"].sort());
  await maju(w, g.id, "SCHEDULED"); d = await detail(w, g.id); assert.deepEqual(pindah(d), ["maju:TIBA", "mundur:DRAF", "tutup:DIBATALKAN"].sort());
  await maju(w, g.id, "ARRIVED"); d = await detail(w, g.id); assert.deepEqual(pindah(d), ["maju:PERIKSA", "mundur:TERJADWAL", "tutup:DITOLAK"].sort());
  await maju(w, g.id, "INSPECTION"); d = await detail(w, g.id); assert.deepEqual(pindah(d), ["maju:SIAP", "mundur:TIBA", "tutup:DITOLAK"].sort());
  await maju(w, g.id, "READY_FOR_PUTAWAY"); d = await detail(w, g.id); assert.deepEqual(pindah(d), ["maju:STOK", "mundur:PERIKSA", "tutup:DITOLAK"].sort());
  // akun baca-saja tidak ditawari apa pun
  const ro = await w.p.get(`${GR}/${g.id}`); assert.deepEqual(ro.body.tampilan.pipeline.pindah, []); assert.deepEqual(ro.body.tampilan.aksi, []);
  assert.equal((await w.p.post(`${GR}/${g.id}/mundur`, { ke: "INSPECTION", alasan: "tidak boleh" })).status, 403);
});

test("MUNDUR berantai tanpa dampak: Siap → Pemeriksaan → Barang tiba → Terjadwal → Draf, lalu maju lagi sampai Simpan ke Stok; data pemeriksaan terjaga; satu pergerakan stok saja", async () => {
  const w = await dunia(); const g = await manual(w); await maju(w, g.id, "SCHEDULED"); await maju(w, g.id, "ARRIVED"); await maju(w, g.id, "INSPECTION");
  const baris = (await detail(w, g.id)).lines[0]; assert.equal((await w.g.patch(`${GR}/${g.id}/lines/${baris.id}`, { receivedQty: 5, acceptedQty: 4, rejectedQty: 1 })).status, 200);
  await maju(w, g.id, "READY_FOR_PUTAWAY"); const awal = await snap(); assert.equal(awal.mov, 0);
  let r = await mundur(w, g.id, "INSPECTION", "Jumlah baik masih perlu dicek"); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, "INSPECTION");
  assert.equal((await mundur(w, g.id, "INSPECTION")).body.ulang, true, "klik ganda: hasil sama");
  r = await mundur(w, g.id, "ARRIVED", "Periksa ulang dari awal"); assert.equal(r.status, 200); assert.equal(r.body.status, "ARRIVED");
  const sesudahBaris = await testPrisma.goodsReceiptLine.findUnique({ where: { id: baris.id } }); assert.deepEqual([Number(sesudahBaris.acceptedQty), Number(sesudahBaris.rejectedQty)], [4, 1], "data pemeriksaan tidak dibuang");
  // ARRIVED → Terjadwal diblok selama ada hasil pemeriksaan (data tidak dibuang diam-diam)
  r = await mundur(w, g.id, "SCHEDULED", "Salah klik"); assert.equal(r.status, 409); assert.equal(r.body.code, "SUDAH_ADA_HASIL_PEMERIKSAAN");
  assert.equal((await w.g.patch(`${GR}/${g.id}/lines/${baris.id}`, { acceptedQty: null, rejectedQty: null })).status, 200);
  r = await mundur(w, g.id, "SCHEDULED", "Barang ternyata belum datang"); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, "SCHEDULED");
  r = await mundur(w, g.id, "DRAFT", "Jadwal salah"); assert.equal(r.status, 200); assert.equal(r.body.status, "DRAFT");
  assert.deepEqual({ ...(await snap()), saldo: 0 }, { ...awal, saldo: 0 }, "tanpa movement/jurnal/PO berubah sepanjang mundur");
  // maju lagi, sampai masuk stok
  for (const s of ["SCHEDULED", "ARRIVED", "INSPECTION"]) assert.equal((await maju(w, g.id, s)).status, 200, s);
  assert.equal((await w.g.patch(`${GR}/${g.id}/lines/${baris.id}`, { receivedQty: 5, acceptedQty: 5, rejectedQty: 0 })).status, 200);
  assert.equal((await maju(w, g.id, "READY_FOR_PUTAWAY")).status, 200);
  const put = await w.g.post(`${GR}/${g.id}/putaway`, { location: "RAK-A1" }); assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal((await snap()).mov, 1, "tepat satu pergerakan stok");
  // sesudah masuk stok: tidak ada perpindahan langsung; Koreksi Gudang
  for (const ke of ["INSPECTION", "ARRIVED", "SCHEDULED", "DRAFT"]) { const x = await mundur(w, g.id, ke, "mau ubah"); assert.equal(x.status, 409, ke); assert.equal(x.body.code, "PERPINDAHAN_TIDAK_SAH"); assert.match(x.body.error, /Koreksi Gudang/); }
  const pm = await w.g.patch(`${GR}/${g.id}`, { status: "READY_FOR_PUTAWAY" }); assert.ok(pm.status >= 400, "PATCH status pada terposting ditolak");
  const dd = await detail(w, g.id); assert.deepEqual(dd.tampilan.pipeline.pindah, []); assert.ok(dd.tampilan.aksi.every((a) => a.kode.startsWith("KOREKSI")));
  assert.equal((await snap()).mov, 1); assert.equal((await mundur(w, g.id, "INSPECTION", "mau ubah")).status, 409);
});

test("ATURAN: tanpa lompatan, alasan wajib, tujuan valid, PO butuh Catat Barang Tiba; mundur memeriksa faktur/retur; Dibatalkan pulih ke status terakhir yang aman atau buat ulang tertaut", async () => {
  const w = await dunia(); const po = await poOcean(w); const g = await draf(w, po); await maju(w, g.id, "SCHEDULED");
  assert.equal((await mundur(w, g.id, "ARRIVED")).status, 409, "Terjadwal tidak punya langkah mundur ke Barang tiba (itu maju)");
  assert.equal((await mundur(w, g.id, "INSPECTION")).body.code, "PERPINDAHAN_TIDAK_SAH");
  assert.equal((await mundur(w, g.id, "COMPLETED")).status, 400); assert.equal((await mundur(w, g.id, "")).body.code, "TUJUAN_TIDAK_VALID");
  assert.equal((await w.g.post(`${GR}/${g.id}/mundur`, { ke: "DRAFT" })).status, 400, "alasan wajib");
  assert.equal((await w.g.post(`${GR}/${g.id}/mundur`, { ke: "DRAFT", alasan: "x" })).status, 400);
  for (const lompat of ["INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"]) assert.ok((await maju(w, g.id, lompat)).status >= 400, lompat);
  const poTiba = await maju(w, g.id, "ARRIVED"); assert.equal(poTiba.status, 400); assert.match(poTiba.body.error, /Catat Barang Tiba/, "PO: tiba hanya lewat Catat Barang Tiba (data wajib)");
  await tiba(w, po, g); let d = await detail(w, g.id); assert.equal(d.status, "ARRIVED"); assert.ok(pindah(d).includes("mundur:TERJADWAL"));
  const sebelum = await snap(); const r = await mundur(w, g.id, "SCHEDULED", "Salah catat tiba"); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, "SCHEDULED"); assert.equal(r.body.arrivedDate, null);
  assert.deepEqual(await snap(), sebelum); d = await detail(w, g.id); const jt = d.jejak.find((x) => x.aksi === "TIBA_DIBATALKAN"); assert.ok(jt && jt.alasan === "Salah catat tiba" && jt.dari === "Barang tiba" && jt.ke === "Terjadwal");
  assert.ok(d.jejak.some((x) => x.aksi === "TIBA_DICATAT"), "kedatangan yang dicatat tetap ada di riwayat");
  // Dibatalkan dari Terjadwal → pulih ke Terjadwal; dari Draf → pulih ke Draf
  assert.equal((await w.g.post(`${GR}/${g.id}/batalkan-jadwal`, { alasan: "Uji batal dari Terjadwal" })).status, 200);
  d = await detail(w, g.id); assert.equal(d.tampilan.kode, "DIBATALKAN"); assert.deepEqual(d.tampilan.aksi.map((a) => a.label), ["Pulihkan ke Terjadwal", "Buat penerimaan baru dari dokumen ini"]); assert.deepEqual(pindah(d), ["mundur:TERJADWAL"]);
  assert.equal((await w.g.post(`${GR}/${g.id}/pulihkan`, {})).status, 400, "alasan wajib");
  let p = await w.g.post(`${GR}/${g.id}/pulihkan`, { alasan: "Salah batal", revisi: d.revisi }); assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.status, "SCHEDULED"); assert.equal(p.body.ulang, false);
  assert.equal((await w.g.post(`${GR}/${g.id}/pulihkan`, { alasan: "klik ganda" })).body.ulang, true);
  assert.equal((await mundur(w, g.id, "DRAFT")).status, 200); assert.equal((await w.g.post(`${GR}/${g.id}/batalkan-jadwal`, { alasan: "Uji batal dari Draf" })).status, 200);
  d = await detail(w, g.id); assert.deepEqual(d.tampilan.aksi.map((a) => a.label)[0], "Pulihkan ke Draf"); p = await w.g.post(`${GR}/${g.id}/pulihkan`, { alasan: "Salah batal lagi" }); assert.equal(p.body.status, "DRAFT");
  assert.deepEqual((await snap()).mov, 0);
  // PO membatasi pemulihan (selain Draf/Terjadwal yang sah): buat ulang tertaut tersedia
  assert.equal((await w.g.post(`${GR}/${g.id}/batalkan-jadwal`, { alasan: "Batal untuk uji buat ulang" })).status, 200);
  const bu = await w.g.post(`${GR}/${g.id}/buat-ulang`, { alasan: "Dibuat ulang tertaut" }); assert.equal(bu.status, 201, JSON.stringify(bu.body)); assert.equal(bu.body.dariId, g.id);
});

test("IDEMPOTEN & KONFLIK: klik ganda tidak menggandakan jejak; revisi basi 409 REVISI_BASI dengan pesan jelas; dua pengguna bersamaan → tepat satu menang; PATCH status sama = hasil sama", async () => {
  const w = await dunia(); const g = await manual(w); await maju(w, g.id, "SCHEDULED"); const d0 = await detail(w, g.id);
  // klik ganda serentak pada aksi yang sama
  const dua = await Promise.all([mundur(w, g.id, "DRAFT", "Salah jadwal", d0.revisi), mundur(w, g.id, "DRAFT", "Salah jadwal", d0.revisi)]);
  assert.deepEqual(dua.map((x) => x.status), [200, 200]); assert.deepEqual(dua.map((x) => x.body.ulang).sort(), [false, true]);
  const ev = (await detail(w, g.id)).jejak.filter((x) => x.aksi === "KEMBALI_KE_DRAF"); assert.equal(ev.length, 1, "tepat satu jejak");
  // maju serentak dua kali: satu perubahan, yang lain hasil sama
  const d1 = await detail(w, g.id); const dua2 = await Promise.all([maju(w, g.id, "SCHEDULED", d1.revisi), maju(w, g.id, "SCHEDULED", d1.revisi)]);
  assert.deepEqual(dua2.map((x) => x.status), [200, 200]); assert.deepEqual(dua2.map((x) => x.body.ulang).sort(), [false, true]); assert.equal((await detail(w, g.id)).jejak.filter((x) => x.aksi === "STATUS_MAJU" && x.ke === "Terjadwal").length, 2, "Draf→Terjadwal dua kali di sepanjang uji, bukan empat");
  // revisi basi: pengguna lain mengubah jadwal setelah layar dimuat
  const layarA = await detail(w, g.id); const ubah = await w.g2.patch(`${GR}/${g.id}`, { expectedDate: geser(9) }); assert.equal(ubah.status, 200);
  const basi = await mundur(w, g.id, "DRAFT", "Salah jadwal", layarA.revisi); assert.equal(basi.status, 409); assert.equal(basi.body.code, "REVISI_BASI"); assert.match(basi.body.error, /diubah pengguna lain|Muat ulang/);
  assert.equal((await detail(w, g.id)).status, "SCHEDULED", "ditolak tanpa efek");
  const basi2 = await maju(w, g.id, "ARRIVED", layarA.revisi); assert.equal(basi2.status, 409); assert.equal(basi2.body.code, "REVISI_BASI");
  const baru = await detail(w, g.id); assert.equal((await mundur(w, g.id, "DRAFT", "Salah jadwal", baru.revisi)).status, 200, "revisi terbaru diterima");
  // dua pengguna bersamaan melakukan aksi BERBEDA: tepat satu menang, dokumen konsisten
  await maju(w, g.id, "SCHEDULED"); const layar = await detail(w, g.id);
  const [a, b] = await Promise.all([w.g.post(`${GR}/${g.id}/mundur`, { ke: "DRAFT", alasan: "Pengguna A mundur", revisi: layar.revisi }), w2(w, g.id, layar.revisi)]);
  const menang = [a.status, b.status].filter((s) => s === 200).length; assert.equal(menang, 1, JSON.stringify([a.status, a.body.code, b.status, b.body.code]));
  const akhir = await detail(w, g.id); assert.ok(["DRAFT", "ARRIVED"].includes(akhir.status)); assert.equal((await snap()).mov, 0);
});
const w2 = (w, id, revisi) => w.g2.patch(`${GR}/${id}`, { status: "ARRIVED", revisi });

test("AKUN: baca-saja ditolak 403 pada semua jalur mundur/pulih; tidak ada perubahan; status tak dikenal ditolak", async () => {
  const w = await dunia(); const g = await manual(w); await maju(w, g.id, "SCHEDULED"); const awal = await dok(g.id);
  for (const [m, u, b] of [["post", "mundur", { ke: "DRAFT", alasan: "uji" }], ["post", "kembali-draft", { alasan: "uji" }], ["post", "batalkan-tiba", { alasan: "uji" }], ["post", "pulihkan", { alasan: "uji" }], ["post", "batalkan-jadwal", { alasan: "uji" }]]) assert.equal((await w.p[m](`${GR}/${g.id}/${u}`, b)).status, 403, u);
  assert.equal((await w.p.patch(`${GR}/${g.id}`, { status: "ARRIVED" })).status, 403); assert.equal(await dok(g.id), awal);
  assert.ok((await w.g.patch(`${GR}/${g.id}`, { status: "ngawur" })).status >= 400);
});
