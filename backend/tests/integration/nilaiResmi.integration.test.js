// NILAI RESMI BAHAN (Stok → Bahan tanpa harga): satu sumber nilai per stok dan periode.
//   Saldo pembuka 1 Sep → Persediaan Awal (DIPERIKSA/DIPOSTING; draf tidak dihitung); penerimaan setelahnya → GR berharga; harga ketikan/referensi/harga hari ini TIDAK dipakai.
// Yang dikunci: tiga kelompok pratinjau terpisah (kelompok 3 hanya perkiraan); harga berbeda menurut waktu; tentatif = bukti kedatangan DAN harga disetujui; klik ulang/serentak; satu pengajuan aktif; manual ditolak bila sumber resmi ada;
// koreksi sumber di kemudian hari → selaraskan ulang (append-only); stok/ISSUE/catatan/valuasi beku/jurnal tidak berubah; HPP per order tetap PARSIAL bila masih ada yang belum pasti.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { postStockMovement } from "../../src/services/inventoryLedger.js";
import { buatDraf, isiBaris, periksa, bukaKembali, postingPembuka, balikPembuka } from "../../src/services/finance/persediaanAwal.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { pratinjauPenetapan, ajukanPenetapan, setujuiPenetapan, tolakPenetapan, batalkanPenetapan, daftarBahanTanpaHarga, daftarPenetapan } from "../../src/services/finance/penetapanNilai.js";
import { hargaResmi, penyelesaiHarga, rekonsiliasiKuantitas } from "../../src/services/finance/nilaiResmi.js";
import { dasarHargaRataRata } from "../../src/services/finance/posting/inventory.js";
import { bacaJejakUnit } from "../../src/services/finance/biayaBahan.js";
import { koreksiValuasiPergerakan } from "../../src/services/finance/koreksiValuasi.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const WIB = (tgl, jam = "01:00:00") => new Date(`${tgl}T${jam}+08:00`);
let seq = 0; const kunci = (p = "nr") => `${p}-${Date.now()}-${++seq}-uji`;
const BASELINE = "Stock Count CC-01092026-BASELINE";
const keluar = (materialId, unitId, qty, tgl, createdById) => testPrisma.$transaction((tx) => postStockMovement(tx, { materialId, type: "ISSUE", qty: -Math.abs(qty), unitId, reason: "uji", note: `pemakaian ${tgl}`, createdAt: WIB(tgl), createdById }));
const issueLama = (materialId, unitId, qty, tgl) => testPrisma.stockMovement.create({ data: { materialId, type: "ISSUE", qty: -Math.abs(qty), unitId, note: `ISSUE lama tanpa nilai ${tgl}`, createdAt: WIB(tgl) } });

async function psa(w, rows, { periksaDua = true, posting = false } = {}) {
  await testPrisma.finSetting.upsert({ where: { key: "inventory_perpetual_cutover_date" }, update: { value: "2026-10-01" }, create: { key: "inventory_perpetual_cutover_date", value: "2026-10-01" } });
  const o = await testPrisma.$transaction((tx) => buatDraf(tx, { userId: w.finA.user.id }));
  await testPrisma.$transaction((tx) => isiBaris(tx, { openingId: o.id, rows, mode: "ganti", userId: w.finA.user.id }));
  if (periksaDua) { await testPrisma.$transaction((tx) => periksa(tx, { openingId: o.id, peran: "FINANCE", userId: w.finA.user.id })); await testPrisma.$transaction((tx) => periksa(tx, { openingId: o.id, peran: "GUDANG", userId: w.gudang.user.id })); }
  if (posting) { await ensureDefaultChartOfAccounts(testPrisma); await testPrisma.$transaction((tx) => postingPembuka(tx, { openingId: o.id, userId: w.finA.user.id, reason: "uji: Persediaan Awal diposting (nilai hanya ditulis setelah PSA diposting)" })); }
  return o;
}
async function dunia() {
  const finA = await createTestUser({ roles: ["FINANCE"] }); const finB = await createTestUser({ roles: ["FINANCE"] }); const gudang = await createTestUser({ roles: ["WAREHOUSE"] }); const sales = await createTestUser({ roles: ["SALES"] });
  const c = (u) => makeClient(server.baseUrl, u.token);
  const sp = await createTestMaterial({ code: "SPANBON-UJI", name: "SPANBON UJI", unit: "METER" }); const pe = await createTestMaterial({ code: "PE-ENC-UJI", name: "PE ENCASEMENT UJI", unit: "PCS" });
  await testPrisma.material.update({ where: { id: sp.id }, data: { referenceUnitCost: 6200, referenceUnitCostMonth: "2026-08" } }); await testPrisma.material.update({ where: { id: pe.id }, data: { referenceUnitCost: 24601, referenceUnitCostMonth: "2026-08" } });
  await testPrisma.stockMovement.create({ data: { materialId: sp.id, type: "ADJUSTMENT", qty: 100, note: BASELINE, createdAt: WIB("2026-09-01", "00:00:00") } });
  await testPrisma.stockMovement.create({ data: { materialId: pe.id, type: "ADJUSTMENT", qty: 329, note: BASELINE, createdAt: WIB("2026-09-01", "00:00:00") } });
  const sup = await testPrisma.finSupplier.create({ data: { code: "SUP-UJI", name: "SUPPLIER UJI" } });
  const po = (n, status) => testPrisma.finPurchaseOrder.create({ data: { poNumber: n, supplierId: sup.id, orderDate: new Date("2026-10-01"), status } });
  const po1 = await po("PO-UJI-001", "DISETUJUI"); const po2 = await po("PO-UJI-002", "DRAFT");
  const gr = (n, poId, extra = {}) => testPrisma.goodsReceipt.create({ data: { receiptNumber: n, sourceType: "PURCHASE_ORDER", status: "COMPLETED", supplier: "SUPPLIER UJI", purchaseOrderId: poId, createdById: finA.user.id, ...extra } });
  const kedatangan = { arrivedDate: new Date("2026-10-13"), arrivalReceiver: "IMAM", arrivalNote: "diterima baik", arrivalWorkspace: "GUDANG", arrivalRevision: 1, arrivalRecordedAt: new Date("2026-10-14T01:00:00Z") };
  const gr1 = await gr("GR-UJI-01", po1.id, kedatangan); // kedatangan + harga disetujui → LENGKAP
  const gr2 = await gr("GR-UJI-02", po2.id); // tanpa kedatangan, PO belum disetujui → TENTATIF
  await testPrisma.stockMovement.create({ data: { materialId: sp.id, type: "RECEIPT", qty: 100, unitCost: 6700, goodsReceiptId: gr1.id, note: "Simpan ke Stok GR-UJI-01", createdAt: WIB("2026-10-15") } });
  await testPrisma.stockMovement.create({ data: { materialId: sp.id, type: "RECEIPT", qty: 100, unitCost: 7000, goodsReceiptId: gr2.id, note: "Simpan ke Stok GR-UJI-02", createdAt: WIB("2026-10-20") } });
  const mk = async (n) => { const { unit } = await createTestUnit(); await testPrisma.order.update({ where: { id: unit.orderId }, data: { orderNumber: n } }); return unit; };
  const u1 = await mk("UJI-ORD-001"); const u2 = await mk("UJI-ORD-002"); const u3 = await mk("UJI-ORD-003"); const u4 = await mk("UJI-ORD-004"); const u5 = await mk("UJI-ORD-005");
  const m = {};
  m.a = await keluar(sp.id, u1.id, 4, "2026-10-05", finA.user.id); // beku TANPA_HARGA (sebelum penerimaan berharga)
  m.b = await keluar(sp.id, u2.id, 4, "2026-10-08", finA.user.id); // beku TANPA_HARGA
  m.c = await keluar(sp.id, u3.id, 1, "2026-10-17", finA.user.id); // beku DINILAI 6700 (receipts-only)
  m.d = await issueLama(sp.id, u4.id, 2, "2026-09-20"); // ISSUE lama: tanpa baris valuasi
  m.e = await issueLama(sp.id, u5.id, 3, "2026-10-21"); // ISSUE lama sesudah GR2 masuk stok
  m.p = await keluar(pe.id, u1.id, 4, "2026-10-06", finA.user.id); // PE: beku TANPA_HARGA (order yang sama dengan SPANBON a)
  return { finA, finB, gudang, sales, a: c(finA), b: c(finB), g: c(gudang), s: c(sales), sp, pe, u1, u2, u3, u4, u5, m, gr1, gr2, po1, po2 };
}
const rowsPSA = (w, hargaSP = 6000, hargaPE = 24000) => [{ kode: "SPANBON-UJI", qty: 98, satuan: "METER", harga: hargaSP, sumber: "FAKTUR", referensi: "FKT-SP-01" }, { kode: "PE-ENC-UJI", qty: 329, satuan: "PCS", harga: hargaPE, sumber: "FAKTUR", referensi: "FKT-PE-01" }];
const snap = async () => ({
  stok: await testPrisma.stockMovement.count(), saldo: JSON.stringify((await testPrisma.stockMovement.groupBy({ by: ["materialId"], _sum: { qty: true }, orderBy: { materialId: "asc" } })).map((r) => [r.materialId, String(r._sum.qty)])),
  issue: JSON.stringify((await testPrisma.stockMovement.findMany({ where: { type: "ISSUE" }, orderBy: { id: "asc" }, select: { id: true, qty: true, createdAt: true } }))),
  catatan: await testPrisma.unitUsageNote.count(), beku: JSON.stringify(await testPrisma.finStockMovementValuation.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, value: true } })), jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(),
});
const aj = async (w, m = {}, aktor = w.finA.user) => { const p = await pratinjauPenetapan(testPrisma, { materialId: w.sp.id, ...m }); return { p, b: await ajukanPenetapan(testPrisma, { materialId: w.sp.id, ...m, hashPratinjau: p.hash }, { aktor, kunci: kunci() }) }; };

test("N1. TANPA sumber resmi: Persediaan Awal DRAFT tidak dihitung; pemakaian sebelum penerimaan berharga tetap TANPA_HARGA (bukan Rp0); harga referensi/hari ini tidak dipakai", async () => {
  const w = await dunia(); await psa(w, rowsPSA(w), { periksaDua: false }); const f0 = await snap();
  const p = await pratinjauPenetapan(testPrisma, { materialId: w.sp.id });
  assert.equal(p.sumberResmi.persediaanAwal, null, "draf tidak dihitung");
  assert.equal(p.tanpaSumberResmi.jumlah, 4, "5 Okt, 8 Okt, 20 Sep, 21 Okt: saldo 30 Sep > 0 tetapi PSA belum resmi → GAP (bukan harga dari GR saja yang mengabaikan lapisan pembuka)"); assert.equal(p.penerapan.jumlah, 0); assert.deepEqual(p.tanpaSumberResmi.perGap, { PSA_BELUM_RESMI: 4 });
  assert.equal(await hargaResmi(testPrisma, w.pe.id, WIB("2026-10-06")), null, "PE: tak pernah ada penerimaan berharga & PSA draf → tidak ada sumber (referensi Rp24.601 TIDAK dipakai)");
  assert.deepEqual(await snap(), f0, "pratinjau baca-saja");
  const sPE = await pratinjauPenetapan(testPrisma, { materialId: w.pe.id }); assert.equal(sPE.penerapan.jumlah, 0); await assert.rejects(() => ajukanPenetapan(testPrisma, { materialId: w.pe.id, hashPratinjau: sPE.hash }, { aktor: w.finA.user, kunci: kunci() }), (e) => e.code === "TIDAK_ADA_TRANSAKSI");
});

test("N2. tiga kelompok TERPISAH; PSA resmi + penerimaan berharga; harga berbeda menurut tanggal; nilai beku DINILAI tidak diganti (hanya dilaporkan)", async () => {
  const w = await dunia(); await psa(w, rowsPSA(w)); // SPANBON 6000, PE 24000
  const p = await pratinjauPenetapan(testPrisma, { materialId: w.sp.id, groups: ["DIPOSTING_TANPA_HARGA", "ISSUE_LAMA"] });
  assert.equal(p.sumberResmi.persediaanAwal.status, "DIPERIKSA"); assert.equal(p.kelompok1.tersedia, 2); assert.equal(p.kelompok2.tersedia, 2); assert.equal(p.kelompok1.diterapkan, 2); assert.equal(p.kelompok2.diterapkan, 2);
  const per = Object.fromEntries(p.penerapan.baris.map((x) => [x.tanggal, x]));
  assert.equal(per["2026-10-05"].harga, 6000); assert.equal(per["2026-10-08"].harga, 6000); assert.equal(per["2026-09-20"].harga, 6000); assert.equal(per["2026-10-05"].kelompok, "DIPOSTING_TANPA_HARGA"); assert.equal(per["2026-09-20"].kelompok, "ISSUE_LAMA");
  // 21 Okt (≥ cutover): lapisan = BARIS PSA 98@6000 (saldo 30 Sep, bukan baseline 100) + GR1 100@6700 + GR2 100@7000 → 1.958.000/298 = 6570,4698. 20 Sep (< cutover): lapisan baseline 100@6000 → 6000.
  assert.ok(Math.abs(per["2026-10-21"].harga - 6570.46979866) < 1e-6, String(per["2026-10-21"].harga)); assert.equal(per["2026-10-21"].nilaiBaru, 19711.41); assert.equal(per["2026-10-05"].tertunda, true, "PSA baru DIPERIKSA → hanya pratinjau"); assert.equal(p.penerapan.dapatDitulis, 0);
  assert.equal(per["2026-10-21"].tentatif.sebab, "BUKTI_GR_BELUM_LENGKAP"); assert.match(per["2026-10-21"].tentatif.alasan, /GR-UJI-02/); assert.equal(per["2026-10-05"].tentatif, null, "hanya lapisan pembuka → tanpa GR");
  assert.equal(p.dikecualikan.baris.find((x) => x.alasan === "SUDAH_BERNILAI_BEKU").order, "UJI-ORD-003"); assert.equal(p.informasi.dinilaiBekuBedaDariResmi.length, 1); assert.equal(p.informasi.dinilaiBekuBedaDariResmi[0].hargaBeku, 6700); assert.ok(Math.abs(p.informasi.dinilaiBekuBedaDariResmi[0].hargaResmi - 6353.5354) < 1e-3, String(p.informasi.dinilaiBekuBedaDariResmi[0].hargaResmi));
  assert.equal(p.kelompok3.bukanHppResmi, true); assert.match(p.kelompok3.catatan, /tidak membuka blokir/); assert.ok(p.hash && !("_terapkan" in (await import("../../src/services/finance/penetapanNilai.js")).tanpaInternal(p)));
});

test("N3. satuan & konversi: Persediaan Awal hanya menerima satuan stok (satuan beda ditolak saat diperiksa) — konversi dilakukan di sumber, bukan di sini", async () => {
  const w = await dunia();
  await testPrisma.finSetting.upsert({ where: { key: "inventory_perpetual_cutover_date" }, update: { value: "2026-10-01" }, create: { key: "inventory_perpetual_cutover_date", value: "2026-10-01" } });
  const o = await testPrisma.$transaction((tx) => buatDraf(tx, { userId: w.finA.user.id }));
  await testPrisma.$transaction((tx) => isiBaris(tx, { openingId: o.id, rows: [{ kode: "PE-ENC-UJI", qty: 329, satuan: "PAK", harga: 240000, sumber: "FAKTUR", referensi: "FKT-PAK" }], userId: w.finA.user.id }));
  await assert.rejects(() => testPrisma.$transaction((tx) => periksa(tx, { openingId: o.id, peran: "FINANCE", userId: w.finA.user.id })), (e) => e.code === "SNAPSHOT_TIDAK_VALID" && JSON.stringify(e.detail ?? e).includes("SATUAN_BEDA"));
  assert.equal(await hargaResmi(testPrisma, w.pe.id, WIB("2026-10-06")), null, "satuan salah → tidak ada sumber resmi");
  await testPrisma.$transaction((tx) => isiBaris(tx, { openingId: o.id, rows: [{ kode: "PE-ENC-UJI", qty: 329, satuan: "PCS", harga: 24000, sumber: "FAKTUR", referensi: "FKT-PAK (240000/10)" }], userId: w.finA.user.id }));
  await testPrisma.$transaction((tx) => periksa(tx, { openingId: o.id, peran: "FINANCE", userId: w.finA.user.id })); await testPrisma.$transaction((tx) => periksa(tx, { openingId: o.id, peran: "GUDANG", userId: w.gudang.user.id }));
  const h = await hargaResmi(testPrisma, w.pe.id, WIB("2026-10-06")); assert.equal(Number(h.harga), 24000); assert.equal(h.sumber.pembuka.persediaanAwal.startsWith("PSA-"), true);
});

test("N4. ajukan/setujui: dua orang, hash, klik ulang & serentak = satu penerapan; satu pengajuan aktif per bahan; invarian stok/ISSUE/catatan/valuasi beku/jurnal", async () => {
  const w = await dunia(); await psa(w, rowsPSA(w), { posting: true }); const f0 = await snap();
  const { p, b } = await aj(w); assert.equal(b.status, "DIAJUKAN"); assert.equal(b.pratinjau.transaksi, 4); assert.deepEqual(await snap(), f0, "mengajukan tidak mengubah apa pun");
  const k = kunci("ulang"); const a1 = await ajukanPenetapan(testPrisma, { materialId: w.sp.id, hashPratinjau: p.hash }, { aktor: w.finA.user, kunci: k }).catch((e) => e); assert.equal(a1.code, "SATU_PENGAJUAN_AKTIF", "dua pengajuan aktif untuk bahan sama ditolak (satu sumber nilai)");
  await assert.rejects(() => setujuiPenetapan(testPrisma, { id: b.id, hashPratinjau: b.pratinjau.hash, aktor: w.finA.user }), (e) => e.code === "PEMOHON_SAMA" && e.statusCode === 403);
  await assert.rejects(() => setujuiPenetapan(testPrisma, { id: b.id, hashPratinjau: "salah", aktor: w.finB.user }), (e) => e.code === "PRATINJAU_BERBEDA");
  const hasil = await Promise.allSettled([1, 2, 3].map(() => setujuiPenetapan(testPrisma, { id: b.id, hashPratinjau: b.pratinjau.hash, aktor: w.finB.user })));
  assert.ok(hasil.every((x) => x.status === "fulfilled"), JSON.stringify(hasil.filter((x) => x.status === "rejected").map((x) => x.reason?.message))); assert.equal(hasil.filter((x) => x.value.ulang === false).length, 1);
  const kor = await testPrisma.finStockMovementValuationCorrection.findMany({ orderBy: { createdAt: "asc" } }); assert.equal(kor.length, 4); assert.ok(kor.every((x) => x.settlementId === b.id && x.after.sumber === "NILAI_RESMI" && x.after.dasar));
  assert.equal(kor.find((x) => Math.abs(Number(x.unitCostBasis) - 6570.46979866) < 1e-6)?.after.dasar.penerimaan.length, 2, "dasar memuat GR1 + GR2"); assert.equal(kor.find((x) => Math.abs(Number(x.unitCostBasis) - 6570.46979866) < 1e-6)?.after.dasar.pembuka.qty, "98", "lapisan pembuka = kuantitas baris PSA (saldo 30 Sep), bukan baseline");
  assert.deepEqual(await snap(), f0, "stok, ISSUE, catatan, valuasi beku, jurnal TIDAK berubah"); assert.equal((await setujuiPenetapan(testPrisma, { id: b.id, hashPratinjau: b.pratinjau.hash, aktor: w.finB.user })).ulang, true);
  assert.equal(await testPrisma.finStockMovementValuationCorrection.count(), 4, "klik ulang tidak menggandakan");
  const p2 = await pratinjauPenetapan(testPrisma, { materialId: w.sp.id }); assert.equal(p2.penerapan.jumlah, 0); assert.equal(p2.selarasUlang.sudahSelaras, 4);
});

test("N5. TENTATIF baru 'didukung bukti' bila kedatangan DAN harga disetujui — bukan sekadar tanggal tiba terisi; dihitung ulang saat dibaca", async () => {
  const w = await dunia(); await psa(w, rowsPSA(w), { posting: true }); const { b } = await aj(w); await setujuiPenetapan(testPrisma, { id: b.id, hashPratinjau: b.pratinjau.hash, aktor: w.finB.user });
  const baca = async () => { const j = await bacaJejakUnit(testPrisma, w.u5.id, { izinHarga: true }); return { r: j.bahan[0].pergerakan[0], ring: j.ringkasan.biayaPersediaan, j }; };
  let x = await baca(); assert.equal(x.r.nilai, 19711.41); assert.equal(x.r.tentatif.sebab, "BUKTI_GR_BELUM_LENGKAP"); assert.equal(x.ring.nilaiTentatif, 19711.41); assert.equal(x.ring.nilaiDidukungBukti, 0); assert.notEqual(x.j.statusBiaya, "FINAL_MENURUT_HARGA_PO"); assert.ok(x.j.belumFinal.some((g) => g.jenis === "HARGA_TENTATIF"));
  // tanggal tiba + penerima terisi, TETAPI harga belum disetujui (PO draft) → masih tentatif
  await testPrisma.goodsReceipt.update({ where: { id: w.gr2.id }, data: { arrivedDate: new Date("2026-10-19"), arrivalReceiver: "IMAM", arrivalNote: "diterima", arrivalWorkspace: "GUDANG", arrivalRevision: 1, arrivalRecordedAt: new Date("2026-10-26T01:00:00Z") } });
  x = await baca(); assert.equal(x.r.tentatif?.sebab, "BUKTI_GR_BELUM_LENGKAP", "kedatangan saja tidak cukup"); assert.match(x.r.tentatif.alasan, /harga belum disetujui/); assert.equal(x.ring.nilaiDidukungBukti, 0);
  // harga disetujui (PO disetujui) → lengkap → didukung bukti (tanpa tindakan data lain)
  await testPrisma.finPurchaseOrder.update({ where: { id: w.po2.id }, data: { status: "DISETUJUI" } });
  x = await baca(); assert.equal(x.r.tentatif, null); assert.equal(x.ring.nilaiTentatif, 0); assert.equal(x.ring.nilaiDidukungBukti, 19711.41);
  const j3 = await bacaJejakUnit(testPrisma, w.u3.id, { izinHarga: true }); assert.equal(j3.ringkasan.biayaPersediaan.nilaiTentatif, 0, "nilai beku dari GR1 (lengkap) tidak tentatif");
});

test("N6. HPP per order: nilai resmi naik, status tetap PARSIAL bila masih ada bahan tanpa harga / catatan belum ISSUE; nilai tentatif dipisah", async () => {
  const w = await dunia(); await psa(w, rowsPSA(w), { posting: true }); const p = await pratinjauPenetapan(testPrisma, { materialId: w.sp.id });
  const o1 = p.perOrder.find((x) => x.order === "UJI-ORD-001"); assert.equal(o1.nilaiSebelum, 0); assert.equal(o1.nilaiTambah, 24000); assert.equal(o1.nilaiSesudah, 24000); assert.equal(o1.sisaTanpaHarga, 1, "PE di order yang sama masih tanpa harga"); assert.match(o1.statusHppSesudah, /^PARSIAL/);
  const o5 = p.perOrder.find((x) => x.order === "UJI-ORD-005"); assert.equal(o5.nilaiTambah, 19711.41); assert.equal(o5.nilaiTentatifTambah, 19711.41); assert.match(o5.statusHppSesudah, /ada nilai tentatif/); assert.equal(o5.nilaiDidukungBuktiTambahan, 0);
  const o4 = p.perOrder.find((x) => x.order === "UJI-ORD-004"); assert.equal(o4.sisaTanpaHarga, 0); assert.equal(o4.nilaiTambah, 12000, "20 Sep: 2 m × baseline 6000"); assert.equal(o4.nilaiTentatifTambah, 0); assert.match(o4.statusHppSesudah, /^LENGKAP/, "order tanpa sisa dan tanpa tentatif → lengkap menurut nilai resmi");
  // setelah PE ditetapkan juga → order 001 tidak lagi punya sisa tanpa harga
  const { b: bSP } = await aj(w); await setujuiPenetapan(testPrisma, { id: bSP.id, hashPratinjau: bSP.pratinjau.hash, aktor: w.finB.user });
  const pPE = await pratinjauPenetapan(testPrisma, { materialId: w.pe.id }); assert.equal(pPE.penerapan.jumlah, 1); assert.equal(pPE.penerapan.baris[0].harga, 24000); assert.equal(pPE.penerapan.nilai, 96000); assert.equal(pPE.perOrder[0].sisaTanpaHarga, 0); assert.match(pPE.perOrder[0].statusHppSesudah, /^LENGKAP/);
  const bPE = await ajukanPenetapan(testPrisma, { materialId: w.pe.id, hashPratinjau: pPE.hash }, { aktor: w.finA.user, kunci: kunci() }); await setujuiPenetapan(testPrisma, { id: bPE.id, hashPratinjau: pPE.hash, aktor: w.finB.user });
  const j = await bacaJejakUnit(testPrisma, w.u1.id, { izinHarga: true }); assert.equal(j.ringkasan.biayaPersediaan.nilai, 24000 + 96000); assert.equal(j.ringkasan.jumlahTanpaHarga, 0);
});

test("N7. koreksi sumber di kemudian hari: PSA diposting lalu DIBALIK resmi → nilai lama TIDAK diubah diam-diam; PSA baru (harga 6.100) diposting → 'selaraskan ulang' append-only (baris lama tetap, nilai terakhir berlaku); tanpa jurnal dari penetapan", async () => {
  const w = await dunia(); const o = await psa(w, rowsPSA(w, 6000), { posting: true }); const { b } = await aj(w); await setujuiPenetapan(testPrisma, { id: b.id, hashPratinjau: b.pratinjau.hash, aktor: w.finB.user }); const f0 = await snap();
  await testPrisma.$transaction((tx) => balikPembuka(tx, { openingId: o.id, userId: w.finA.user.id, reason: "uji: harga PSA salah, dibalik resmi" })); const jurnalSetelahBalik = await testPrisma.finJournalEntry.count();
  let p = await pratinjauPenetapan(testPrisma, { materialId: w.sp.id, groups: ["SELARAS_ULANG"] }); assert.equal(p.dikecualikan.baris.filter((x) => x.alasan === "SUMBER_RESMI_HILANG_PERLU_TINJAUAN").length, 4, "semua nilai bersandar pada lapisan pembuka: sumber hilang → dilaporkan, nilai lama TIDAK diubah diam-diam"); assert.equal(p.penerapan.jumlah, 0);
  const o2 = await psa(w, rowsPSA(w, 6100), { posting: true });
  p = await pratinjauPenetapan(testPrisma, { materialId: w.sp.id, groups: ["SELARAS_ULANG"] }); assert.equal(p.selarasUlang.tersedia, 4); assert.equal(p.penerapan.jumlah, 4); const x5 = p.penerapan.baris.find((r) => r.tanggal === "2026-10-05"); assert.equal(x5.nilaiSebelum, 24000); assert.equal(x5.nilaiBaru, 24400); assert.equal(x5.kelompok, "SELARAS_ULANG");
  const { b: b2 } = await aj(w, { groups: ["SELARAS_ULANG"] }); await setujuiPenetapan(testPrisma, { id: b2.id, hashPratinjau: b2.pratinjau.hash, aktor: w.finB.user });
  assert.equal(await testPrisma.finStockMovementValuationCorrection.count({ where: { movementId: w.m.a.id } }), 2, "baris lama tetap, baris baru ditambahkan");
  const j = await bacaJejakUnit(testPrisma, w.u1.id, { izinHarga: true }); assert.equal(j.bahan.find((q) => q.kode === "SPANBON-75GRAM" || q.kode === "SPANBON-UJI").pergerakan[0].nilai, 24400);
  const f1 = await snap(); assert.equal(f1.stok, f0.stok); assert.equal(f1.saldo, f0.saldo); assert.equal(f1.beku, f0.beku); assert.equal(f1.jurnal - jurnalSetelahBalik, 1, "satu-satunya jurnal baru = jurnal PSA kedua; penetapan nilai tidak membuat jurnal"); assert.ok(o2.id !== o.id);
  assert.equal((await pratinjauPenetapan(testPrisma, { materialId: w.sp.id, groups: ["SELARAS_ULANG"] })).penerapan.jumlah, 0, "sudah selaras");
});

test("N8. pencegahan DUA sumber nilai: koreksi harga manual ditolak bila sumber resmi ada (juga pada nilai hasil penetapan); batalkan/tolak melepaskan kunci; pratinjau basi ditolak", async () => {
  const w = await dunia(); await psa(w, rowsPSA(w), { posting: true });
  await assert.rejects(() => koreksiValuasiPergerakan(testPrisma, { movementId: w.m.a.id, hargaBaru: 5000, alasan: "ketikan manual", kunci: kunci("man"), aktor: w.finA.user }), (e) => e.code === "SUMBER_RESMI_ADA");
  await assert.rejects(() => koreksiValuasiPergerakan(testPrisma, { movementId: w.m.c.id, hargaBaru: 5000, alasan: "ketikan manual pada nilai beku", kunci: kunci("man"), aktor: w.finA.user }), (e) => e.code === "SUMBER_RESMI_ADA");
  const { b } = await aj(w); await assert.rejects(() => batalkanPenetapan(testPrisma, { id: b.id, aktor: w.finB.user }), (e) => e.code === "BUKAN_PEMOHON"); await assert.rejects(() => tolakPenetapan(testPrisma, { id: b.id, aktor: w.finB.user, catatan: "x" }), (e) => e.code === "ALASAN_WAJIB");
  assert.equal((await batalkanPenetapan(testPrisma, { id: b.id, aktor: w.finA.user })).status, "DIBATALKAN"); const { b: b2 } = await aj(w); assert.equal(b2.status, "DIAJUKAN");
  await issueLama(w.sp.id, w.u2.id, 1, "2026-10-09"); // ISSUE lama tanpa nilai muncul sesudah diajukan (ISSUE baru sesudah PSA diposting sudah dibekukan DINILAI, jadi tidak masuk pratinjau)
  await assert.rejects(() => setujuiPenetapan(testPrisma, { id: b2.id, hashPratinjau: b2.pratinjau.hash, aktor: w.finB.user }), (e) => e.code === "PRATINJAU_BERUBAH" && e.statusCode === 409); assert.equal(await testPrisma.finStockMovementValuationCorrection.count(), 0);
  assert.equal((await tolakPenetapan(testPrisma, { id: b2.id, aktor: w.finB.user, catatan: "pratinjau basi, ajukan ulang" })).status, "DITOLAK");
  assert.deepEqual((await daftarPenetapan(testPrisma, { materialId: w.sp.id })).map((x) => x.status).sort(), ["DIBATALKAN", "DITOLAK"]);
});

test("N9. daftar bahan tanpa harga + HTTP: kelompok 1/2/3 terpisah, sumber resmi per bahan, izin (Gudang/Sales ditolak), pengaju ≠ penyetuju", async () => {
  const w = await dunia(); const d0 = await daftarBahanTanpaHarga(testPrisma); const sp0 = d0.find((x) => x.kode === "SPANBON-UJI"); assert.equal(sp0.sebab, "HANYA_PENERIMAAN_BERHARGA"); assert.equal(sp0.kelompok1_dipostingTanpaHarga, 2); assert.equal(sp0.kelompok2_issueLamaBelumDinilai, 2); assert.equal(sp0.sumberResmi.persediaanAwal, null);
  const pe0 = d0.find((x) => x.kode === "PE-ENC-UJI"); assert.equal(pe0.sebab, "SALDO_PEMBUKA_BELUM_PUNYA_HARGA_RESMI"); assert.equal(pe0.pembanding.referensi.catatan, "pembanding saja");
  await psa(w, rowsPSA(w), { posting: true }); assert.equal((await daftarBahanTanpaHarga(testPrisma)).find((x) => x.kode === "PE-ENC-UJI").sebab, "PERSEDIAAN_AWAL_RESMI_ADA");
  const f0 = await snap(); const B = "/api/finance/biaya-bahan/harga-bukti";
  assert.equal((await w.g.get(`${B}/bahan-tanpa-harga`)).status, 403); assert.equal((await w.s.post(`${B}/pratinjau`, { materialId: w.sp.id })).status, 403);
  const pr = await w.a.post(`${B}/pratinjau`, { materialId: w.sp.id }); assert.equal(pr.status, 200); assert.ok(!("_terapkan" in pr.body)); assert.equal(pr.body.penerapan.jumlah, 4); assert.equal(pr.body.kelompok3.bukanHppResmi, true);
  const k = kunci("http"); const aj1 = await w.a.post(B, { materialId: w.sp.id, hashPratinjau: pr.body.hash }, { "Idempotency-Key": k }); assert.equal(aj1.status, 201, JSON.stringify(aj1.body)); assert.equal((await w.a.post(B, { materialId: w.sp.id, hashPratinjau: pr.body.hash }, { "Idempotency-Key": k })).body.id, aj1.body.id);
  assert.equal((await w.a.post(`${B}/${aj1.body.id}/setujui`, { hashPratinjau: aj1.body.pratinjau.hash })).body.code, "PEMOHON_SAMA"); assert.equal((await w.g.post(`${B}/${aj1.body.id}/setujui`, { hashPratinjau: aj1.body.pratinjau.hash })).status, 403);
  const ok = await w.b.post(`${B}/${aj1.body.id}/setujui`, { hashPratinjau: aj1.body.pratinjau.hash }); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.diterapkan, 4);
  const det = await w.a.get(`${B}/${aj1.body.id}`); assert.equal(det.body.koreksi.length, 4); assert.ok(det.body.koreksi.every((x) => x.dasar));
  const f1 = await snap(); assert.equal(f1.stok, f0.stok); assert.equal(f1.saldo, f0.saldo); assert.equal(f1.issue, f0.issue); assert.equal(f1.beku, f0.beku); assert.equal(f1.jurnal, f0.jurnal); assert.equal(f1.catatan, f0.catatan);
  assert.equal((await w.a.get(`${B}/bukan-uuid`)).status, 404);
});

test("N10. celah sisa: koreksi harga manual yang dibuat SAAT belum ada sumber resmi tidak diganti diam-diam; setelah Persediaan Awal resmi ada, selisihnya DILAPORKAN (dua nilai untuk stok yang sama terlihat, bukan tersembunyi)", async () => {
  const w = await dunia();
  const man = await koreksiValuasiPergerakan(testPrisma, { movementId: w.m.p.id, hargaBaru: 25000, alasan: "harga manual sebelum ada sumber resmi", kunci: kunci("man"), aktor: w.finA.user });
  assert.equal(man.koreksi.nilaiBaru, 100000, "jalur lama hanya terbuka bila TIDAK ada sumber resmi");
  await psa(w, rowsPSA(w, 6000, 24000)); const f0 = await snap();
  const p = await pratinjauPenetapan(testPrisma, { materialId: w.pe.id });
  assert.equal(p.penerapan.jumlah, 0, "nilai manual tidak ditimpa");
  assert.equal(p.dikecualikan.baris[0].alasan, "SUDAH_DIKOREKSI_MANUAL"); assert.equal(p.dikecualikan.baris[0].nilaiSekarang, 100000);
  assert.equal(p.informasi.koreksiManualBedaDariResmi.length, 1); assert.equal(p.informasi.koreksiManualBedaDariResmi[0].hargaManual, 25000); assert.equal(p.informasi.koreksiManualBedaDariResmi[0].hargaResmi, 24000); assert.equal(p.informasi.koreksiManualBedaDariResmi[0].nilaiManual, 100000);
  await assert.rejects(() => ajukanPenetapan(testPrisma, { materialId: w.pe.id, hashPratinjau: p.hash }, { aktor: w.finA.user, kunci: kunci() }), (e) => e.code === "TIDAK_ADA_TRANSAKSI");
  assert.deepEqual(await snap(), f0, "pratinjau baca-saja");
});

// ── C1: urutan tanggal EKSPLISIT — baseline 1 Sep → ISSUE September → saldo 30 Sep → penerimaan & pemakaian Okt ──
test("N11. C1 (HR-foam): lapisan 1 Sep ≠ lapisan 30 Sep dimodelkan eksplisit; nilai SEBELUM dan SESUDAH PSA diposting SAMA dan sama dengan jalur jurnal; baseline TIDAK dipakai membuta; kuantitas PSA ≠ saldo 30 Sep → GAP", async () => {
  const w = await dunia();
  const hr = await createTestMaterial({ code: "HR-FOAM-UJI", name: "HR FOAM UJI", unit: "KG" });
  await testPrisma.stockMovement.create({ data: { materialId: hr.id, type: "ADJUSTMENT", qty: 150.9, note: BASELINE, createdAt: WIB("2026-09-01", "00:00:00") } });
  const { unit: uS1 } = await createTestUnit(); const { unit: uS2 } = await createTestUnit(); const { unit: uO } = await createTestUnit();
  const s1 = await issueLama(hr.id, uS1.id, 60, "2026-09-02"); const s2 = await issueLama(hr.id, uS2.id, 45, "2026-09-08"); // 105 kg → saldo 30 Sep = 45,9
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-HR-01", sourceType: "PURCHASE_ORDER", status: "COMPLETED", supplier: "SUPPLIER UJI", purchaseOrderId: w.po1.id, createdById: w.finA.user.id, arrivedDate: new Date("2026-10-09"), arrivalReceiver: "IMAM", arrivalNote: "ok", arrivalWorkspace: "GUDANG", arrivalRevision: 1, arrivalRecordedAt: new Date("2026-10-10T01:00:00Z") } });
  await testPrisma.stockMovement.create({ data: { materialId: hr.id, type: "RECEIPT", qty: 276.7, unitCost: 36000, goodsReceiptId: gr.id, note: "Simpan ke Stok GR-HR-01", createdAt: WIB("2026-10-09") } });
  const o14 = await issueLama(hr.id, uO.id, 2.4, "2026-10-14");
  const PSA_HARGA = 20000; // harga UJI (bukan fakta)
  const rows = (qty) => [{ kode: "HR-FOAM-UJI", qty, satuan: "KG", harga: PSA_HARGA, sumber: "FAKTUR", referensi: "FKT-UJI-HR" }];
  const t14 = WIB("2026-10-14"); const tSep = WIB("2026-09-05");
  // (1) PSA salah: kuantitas = baseline (150,9), bukan saldo 30 Sep → Okt GAP PSA_QTY_BEDA; September tetap dinilai dari lapisan baseline
  const o = await psa(w, rows(150.9)); const sel = penyelesaiHarga(testPrisma);
  assert.equal(await sel(hr.id, t14), null); assert.equal(sel.gap(hr.id, t14), "PSA_QTY_BEDA", "kuantitas baris PSA ≠ saldo sistem 30 Sep → tidak disamakan membuta");
  assert.equal(Number((await hargaResmi(testPrisma, hr.id, tSep)).harga), PSA_HARGA, "September: lapisan baseline 1 Sep × harga PSA");
  // (2) PSA benar: kuantitas = saldo 30 Sep (45,9) — masih DIPERIKSA
  await testPrisma.$transaction((tx) => bukaKembali(tx, { openingId: o.id })); await testPrisma.$transaction((tx) => isiBaris(tx, { openingId: o.id, rows: rows(45.9), mode: "ganti", userId: w.finA.user.id }));
  await testPrisma.$transaction((tx) => periksa(tx, { openingId: o.id, peran: "FINANCE", userId: w.finA.user.id })); await testPrisma.$transaction((tx) => periksa(tx, { openingId: o.id, peran: "GUDANG", userId: w.gudang.user.id }));
  const benar = (45.9 * PSA_HARGA + 276.7 * 36000) / (45.9 + 276.7); const salah = (150.9 * PSA_HARGA + 276.7 * 36000) / (150.9 + 276.7);
  const sebelum = await hargaResmi(testPrisma, hr.id, t14); assert.ok(Math.abs(Number(sebelum.harga) - benar) < 1e-6, `${sebelum.harga} vs ${benar}`); assert.ok(Math.abs(Number(sebelum.harga) - salah) > 1000, "bobot baseline 150,9 TIDAK dipakai untuk Oktober");
  assert.equal(sebelum.sumber.pembuka.qty, "45.9"); assert.equal(sebelum.sumber.pembuka.lapisan, "PSA_30SEP"); assert.equal(sebelum.menungguPSADiposting, true);
  assert.equal(Number((await hargaResmi(testPrisma, hr.id, tSep)).harga), PSA_HARGA); assert.equal((await hargaResmi(testPrisma, hr.id, tSep)).sumber.pembuka.lapisan, "BASELINE_1SEP");
  // (3) tulis ditolak sebelum PSA diposting; pratinjau tetap tampil
  const pra = await pratinjauPenetapan(testPrisma, { materialId: hr.id }); assert.equal(pra.penerapan.jumlah, 3); assert.equal(pra.penerapan.dapatDitulis, 0); assert.equal(pra.penerapan.menungguPSADiposting, 3);
  await assert.rejects(() => ajukanPenetapan(testPrisma, { materialId: hr.id, hashPratinjau: pra.hash }, { aktor: w.finA.user, kunci: kunci() }), (e) => e.code === "PSA_BELUM_DIPOSTING");
  const jurnal0 = await testPrisma.finJournalEntry.count(); const kor0 = await testPrisma.finStockMovementValuationCorrection.count();
  // (4) PSA diposting: nilai Oktober IDENTIK dengan sebelum posting DAN dengan jalur jurnal (dasarHargaRataRata); lapisan tidak dihitung dua kali
  await ensureDefaultChartOfAccounts(testPrisma); await testPrisma.$transaction((tx) => postingPembuka(tx, { openingId: o.id, userId: w.finA.user.id, reason: "uji: PSA benar diposting" }));
  const sesudah = await hargaResmi(testPrisma, hr.id, t14); const jurnalPath = await dasarHargaRataRata(testPrisma, hr.id, { asOf: t14 });
  assert.equal(String(sesudah.harga.toDecimalPlaces(8)), String(sebelum.harga.toDecimalPlaces(8)), "sebelum = sesudah posting"); assert.equal(String(sesudah.harga.toDecimalPlaces(8)), String(jurnalPath.harga.toDecimalPlaces(8)), "= jalur jurnal");
  assert.equal(String(jurnalPath.totalQty), "322.6", "45,9 + 276,7 — kuantitas lapisan dihitung SEKALI"); assert.equal(sesudah.menungguPSADiposting, false);
  assert.equal(await testPrisma.finJournalEntry.count(), jurnal0 + 1, "hanya jurnal PSA");
  // (5) tulis: 3 ISSUE (2 September + 1 Oktober) dinilai; tanpa jurnal baru
  const p2 = await pratinjauPenetapan(testPrisma, { materialId: hr.id }); assert.equal(p2.penerapan.dapatDitulis, 3); assert.equal(p2.kelompok2.diterapkan, 3);
  const bm = await ajukanPenetapan(testPrisma, { materialId: hr.id, hashPratinjau: p2.hash }, { aktor: w.finA.user, kunci: kunci() }); const jurnal1 = await testPrisma.finJournalEntry.count(); await setujuiPenetapan(testPrisma, { id: bm.id, hashPratinjau: p2.hash, aktor: w.finB.user });
  assert.equal(await testPrisma.finJournalEntry.count(), jurnal1, "penetapan nilai tidak menjurnal"); assert.equal(await testPrisma.finStockMovementValuationCorrection.count(), kor0 + 3);
  const kO = await testPrisma.finStockMovementValuationCorrection.findFirst({ where: { movementId: o14.id } }); assert.equal(Number(kO.value), Math.round(2.4 * benar * 100) / 100);
  const kS = await testPrisma.finStockMovementValuationCorrection.findFirst({ where: { movementId: s1.id } }); assert.equal(Number(kS.value), 60 * PSA_HARGA, "pemakaian September = qty × harga PSA (informasi biaya; tidak dijurnal terpisah)");
  assert.ok(s2.id);
});

test("N12. C1 (gap): bahan tanpa lapisan baseline / pemakaian melebihi baseline TIDAK diberi harga (tanpa harga rekaan, manual pun ditolak); rekonsiliasi kuantitas per bahan menutup; kecocokan PSA ↔ saldo 30 Sep per bahan", async () => {
  const w = await dunia();
  const mk = (code) => createTestMaterial({ code, name: code, unit: "PCS" });
  const cov = await mk("COV-UJI"); const noB = await mk("NOBASE-UJI"); const neg = await mk("NEG-UJI"); const bed = await mk("BEDA-UJI"); const nopsa = await mk("NOPSA-UJI");
  for (const [m, q] of [[cov, 10], [neg, 5], [bed, 20], [nopsa, 7]]) await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ADJUSTMENT", qty: q, note: BASELINE, createdAt: WIB("2026-09-01", "00:00:00") } });
  const U = async () => (await createTestUnit()).unit;
  const iCov = await issueLama(cov.id, (await U()).id, 4, "2026-09-03"); const iNoB = await issueLama(noB.id, (await U()).id, 3, "2026-09-03"); const iNeg = await issueLama(neg.id, (await U()).id, 8, "2026-09-04"); await issueLama(bed.id, (await U()).id, 5, "2026-09-04"); await issueLama(nopsa.id, (await U()).id, 2, "2026-09-04");
  const rows = [{ kode: "COV-UJI", qty: 6, satuan: "PCS", harga: 1000, sumber: "FAKTUR", referensi: "F-1" }, { kode: "BEDA-UJI", qty: 20, satuan: "PCS", harga: 1000, sumber: "FAKTUR", referensi: "F-2" }, { kode: "SPANBON-UJI", qty: 98, satuan: "METER", harga: 6000, sumber: "FAKTUR", referensi: "F-3" }, { kode: "PE-ENC-UJI", qty: 329, satuan: "PCS", harga: 24000, sumber: "FAKTUR", referensi: "F-4" }];
  await psa(w, rows, { posting: true }); // BEDA-UJI: saldo 30 Sep = 15 tetapi baris PSA 20
  // pratinjau: hanya COV yang dinilai; gap berkode
  const pCov = await pratinjauPenetapan(testPrisma, { materialId: cov.id }); assert.equal(pCov.penerapan.dapatDitulis, 1); assert.equal(pCov.penerapan.nilai, 4000);
  const pNoB = await pratinjauPenetapan(testPrisma, { materialId: noB.id }); assert.equal(pNoB.penerapan.jumlah, 0); assert.equal(pNoB.tanpaSumberResmi.baris[0].gap, "TANPA_LAPISAN_BASELINE");
  const pNeg = await pratinjauPenetapan(testPrisma, { materialId: neg.id }); assert.equal(pNeg.penerapan.jumlah, 0); assert.equal(pNeg.tanpaSumberResmi.baris[0].gap, "SALDO_30SEP_NEGATIF");
  const pBed = await pratinjauPenetapan(testPrisma, { materialId: bed.id }); assert.equal(pBed.penerapan.jumlah, 1, "September tetap tercakup baseline (harga PSA berlaku untuk lapisan baseline)");
  const pNo = await pratinjauPenetapan(testPrisma, { materialId: nopsa.id }); assert.equal(pNo.tanpaSumberResmi.baris[0].gap, "PSA_BELUM_RESMI");
  // tidak ada harga rekaan: koreksi manual pada gap struktural ditolak
  for (const m of [iNoB, iNeg]) await assert.rejects(() => koreksiValuasiPergerakan(testPrisma, { movementId: m.id, hargaBaru: 777, alasan: "harga rekaan untuk gap", kunci: kunci("man"), aktor: w.finA.user }), (e) => e.code === "GAP_STOK_PERLU_DIJELASKAN");
  assert.ok(iCov.id);
  // rekonsiliasi kuantitas per bahan
  const rk = await rekonsiliasiKuantitas(testPrisma); const by = Object.fromEntries(rk.bahan.map((b) => [b.kode, b]));
  assert.equal(rk.cutover, "2026-10-01"); assert.ok(rk.bahan.every((b) => b.cekSaldo30 && b.cekSaldoKini), "baseline + penerimaan − ISSUE September = saldo 30 Sep; + Okt = saldo kini");
  assert.deepEqual([by["COV-UJI"].saldo_30sep, by["COV-UJI"].statusPSA, by["COV-UJI"].klasifikasi], [6, "COCOK", "TERCAKUP_BASELINE"]);
  assert.deepEqual([by["BEDA-UJI"].saldo_30sep, by["BEDA-UJI"].qtyPSA, by["BEDA-UJI"].statusPSA], [15, 20, "BEDA"]);
  assert.deepEqual([by["NEG-UJI"].saldo_30sep, by["NEG-UJI"].statusPSA, by["NEG-UJI"].klasifikasi], [-3, "SALDO_NEGATIF", "GAP_MELAMPAUI_BASELINE"]);
  assert.equal(by["NOPSA-UJI"].statusPSA, "TIDAK_ADA_DI_PSA"); assert.equal(by["NOBASE-UJI"].klasifikasi, "GAP_TANPA_LAPISAN_BASELINE"); assert.equal(by["NOBASE-UJI"].saldo_30sep, -3);
});
