// KILOAN = cara beli (per kg), BUKAN asal bahan. Komponen lama hanya bila ada penanda asal eksplisit (LAMA / BUANG KASUR). Asal tak jelas = "perlu dicek". Sumber pembelian tertulis = bukti asal (bukan penerimaan stok).
// Tidak menulis stok, jurnal, valuasi, harga, maupun mengubah catatan yang sudah ada.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { rencanakanImpor, terapkanImpor } from "../../src/services/catatanPemakaianHistoris.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, spek, qty, sat) => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},${spek},BAHAN,"${qty}",${sat},,,,,,QC OK`;
const csv = (rows) => ["JURNAL RINCIAN", "Data", HDR, ...rows].join("\n");
const flagKode = (n) => (n.flags ?? []).map((f) => f.kode).sort();

async function dunia({ pembelian = true } = {}) {
  const { order, unit } = await createTestUnit({ status: "DELIVERED" });
  await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: "RES-24092026-701", status: "DELIVERED" } });
  const katalog = await createTestMaterial({ code: "T-FOAM-KG", name: "FOAM BELI KILOAN KATALOG", unit: "KG" }); // bahan KILOAN yang SUDAH ada di katalog
  await seedBalance(katalog.id, 20, { createdAt: new Date("2026-09-01T00:00:00+07:00") });
  if (pembelian) {
    await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
    const akun = await testPrisma.finAccount.findFirst();
    const kategori = (await testPrisma.finPurchaseCategory.findFirst()) ?? await testPrisma.finPurchaseCategory.create({ data: { code: "UJI-KILOAN", name: "Kategori Uji", accountId: akun.id } });
    await testPrisma.finPurchase.create({ data: { purchaseNumber: "PUR-23092026-035", date: new Date("2026-09-23"), amount: 1_680_000, description: "Memory foam kiloan", categoryId: kategori.id, status: "DIBAYAR" } });
  }
  return { unit, katalog };
}
const CSV = csv([
  baris(1, "RES-24092026-701", "25 Sep 26", "Bahan Lapisan", "MEMORY FOAM KILOAN", "MEMORY FOAM", "4,0", "KG"),       // ada bukti pembelian tertulis
  baris(2, "RES-24092026-701", "25 Sep 26", "Bahan Lapisan", "KARET BUSA KILOAN", "", "2,0", "KG"),                     // KILOAN tanpa bukti asal
  baris(3, "RES-24092026-701", "25 Sep 26", "Bahan Lapisan", "BUSA LAMA", "", "1,0", "LEMBAR"),                          // komponen lama eksplisit
  baris(4, "RES-24092026-701", "25 Sep 26", "Bahan Lapisan", "KAIN KILOAN LAMA", "", "3,0", "KG"),                       // KILOAN + LAMA: asal eksplisit menang
  baris(5, "RES-24092026-701", "25 Sep 26", "Bahan Lapisan", "BUANG KASUR", "", "1,0", "PCS"),                            // komponen lama eksplisit
  baris(6, "RES-24092026-701", "25 Sep 26", "Bahan Lapisan", "FOAM BELI KILOAN KATALOG", "", "1,0", "KG"),             // sudah ada di katalog: alur biasa
]);
const byRow = async () => Object.fromEntries((await testPrisma.unitUsageNote.findMany({ where: { origin: "EXCEL" } })).map((n) => [n.sourceRow - 3, n]));

test("K1. KILOAN bukan komponen lama: bukti pembelian tertulis → PERLU_DICEK + info asal dibeli; tanpa bukti → penanda BLOK 'asal perlu dicek'; LAMA/BUANG KASUR tetap bukan stok", async () => {
  const { katalog } = await dunia();
  const mv0 = await testPrisma.stockMovement.count(); const jur0 = await testPrisma.finJournalEntry.count(); const val0 = await testPrisma.finStockMovementValuation.count(); const hb0 = await testPrisma.materialHargaBerlaku.count(); const mat0 = await testPrisma.material.count();
  const r = await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: CSV, namaBerkas: "kiloan.csv" }), {});
  assert.equal(r.batchBaru, true);
  const n = await byRow();
  // 1) bukti pembelian tertulis
  assert.equal(n[1].state, "PERLU_DICEK"); assert.deepEqual(flagKode(n[1]), ["ASAL_PEMBELIAN_BERTULIS", "NAMA_TIDAK_DI_KATALOG"]);
  const info = n[1].flags.find((f) => f.kode === "ASAL_PEMBELIAN_BERTULIS"); assert.equal(info.tingkat, "INFO"); assert.equal(info.data.bukti[0].nomor, "PUR-23092026-035"); assert.equal(info.data.bukti[0].jumlah, 1_680_000); assert.match(info.teks, /bukan penerimaan stok/);
  assert.equal(n[1].materialId, null, "tidak ada bahan dibuat/ditebak"); assert.equal(n[1].stockMovementId, null);
  // 2) tanpa bukti → perlu dicek, memblok
  assert.equal(n[2].state, "PERLU_DICEK"); assert.deepEqual(flagKode(n[2]), ["ASAL_BAHAN_PERLU_DICEK", "NAMA_TIDAK_DI_KATALOG"]);
  const blok = n[2].flags.find((f) => f.kode === "ASAL_BAHAN_PERLU_DICEK"); assert.equal(blok.tingkat, "BLOK"); assert.match(blok.aksi, /Tidak ditebak dari nama/);
  // 3-5) komponen lama dengan penanda asal EKSPLISIT tetap bukan stok (termasuk KILOAN + LAMA)
  for (const i of [3, 4, 5]) { assert.equal(n[i].state, "BUKAN_STOK", `baris ${i}`); assert.deepEqual(flagKode(n[i]), ["KOMPONEN_LAMA"]); }
  // 6) sudah di katalog: alur biasa (tidak ada penanda asal)
  assert.equal(n[6].materialId, katalog.id); assert.ok(!flagKode(n[6]).includes("ASAL_BAHAN_PERLU_DICEK") && !flagKode(n[6]).includes("ASAL_PEMBELIAN_BERTULIS"));
  // tanpa efek samping
  assert.equal(await testPrisma.stockMovement.count(), mv0); assert.equal(await testPrisma.finJournalEntry.count(), jur0); assert.equal(await testPrisma.finStockMovementValuation.count(), val0);
  assert.equal(await testPrisma.materialHargaBerlaku.count(), hb0); assert.equal(await testPrisma.material.count(), mat0, "tidak ada master bahan dibuat otomatis");
});

test("K2. pembelian KILOAN SESUDAH tanggal pakai atau bahan lain bukan bukti asal", async () => {
  await dunia({ pembelian: false });
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akun = await testPrisma.finAccount.findFirst();
  const kategori = await testPrisma.finPurchaseCategory.create({ data: { code: "UJI-KILOAN2", name: "Kategori Uji", accountId: akun.id } });
  await testPrisma.finPurchase.create({ data: { purchaseNumber: "PUR-10102026-001", date: new Date("2026-10-10"), amount: 900_000, description: "Memory foam kiloan", categoryId: kategori.id, status: "DIBAYAR" } }); // sesudah 25 Sep
  await testPrisma.finPurchase.create({ data: { purchaseNumber: "PUR-20092026-001", date: new Date("2026-09-20"), amount: 500_000, description: "Kain kiloan Hikaron", categoryId: kategori.id, status: "DIBAYAR" } }); // bahan lain
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: CSV, namaBerkas: "kiloan2.csv" }), {});
  const n = await byRow();
  assert.deepEqual(flagKode(n[1]), ["ASAL_BAHAN_PERLU_DICEK", "NAMA_TIDAK_DI_KATALOG"], "pembelian setelah tanggal pakai / bahan lain tidak dihitung bukti");
});
