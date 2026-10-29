// Aturan murni catatan pemakaian historis (tanpa database): angka/tanggal Indonesia, kunci idempoten, pemetaan tanpa menebak, penanda "Perlu dicek".
import test from "node:test";
import assert from "node:assert/strict";
import { MaterialUnit } from "@prisma/client";
import { angkaId, tanggalId, awalHariWIB, satuanBaku, parseCsv, bacaCsvPemakaian, kunciSumber, petakanBahan, FLAG, flagMemblok, catatanSingkat, petunjukKemasanKg, uang, KOMPONEN_LAMA_RE, KILOAN_RE, buktiPembelianKiloan } from "../src/lib/domain/pemakaianHistoris.js";

test("angkaId: format Indonesia tanpa menebak; teks aneh tetap teks", () => {
  assert.deepEqual(angkaId("1,7"), { v: 1.7, jenis: "angka" });
  assert.deepEqual(angkaId("1.250,5"), { v: 1250.5, jenis: "angka" });
  assert.deepEqual(angkaId("30,0"), { v: 30, jenis: "angka" });
  assert.equal(angkaId("0,0").v, 0);
  assert.equal(angkaId("").jenis, "kosong");
  assert.equal(angkaId("#N/A").jenis, "na");
  assert.equal(angkaId("2 roll").jenis, "teks");
  assert.equal(uang("Rp 43.590"), 43590);
});

test("tanggalId + awalHariWIB: '1 Sep 26' = 2026-09-01 00:00 WIB = 2026-08-31T17:00Z", () => {
  assert.equal(tanggalId("1 Sep 26"), "2026-09-01"); assert.equal(tanggalId("17 Okt 26"), "2026-10-17"); assert.equal(tanggalId("besok"), "");
  assert.equal(awalHariWIB("2026-09-01").toISOString(), "2026-08-31T17:00:00.000Z");
});

test("satuanBaku hanya alias baku (LEMBAR=SHEET); tidak ada konversi jumlah; semua hasil adalah enum satuan Gudang", () => {
  assert.equal(satuanBaku("LEMBAR"), "SHEET"); assert.equal(satuanBaku("KG"), "KG"); assert.equal(satuanBaku("xyz"), null);
  for (const s of ["PCS", "METER", "LEMBAR", "KG", "ROLL", "BLEK", "PAK", "BATANG"]) assert.ok(Object.values(MaterialUnit).includes(satuanBaku(s)), s);
});

test("parseCsv: kutip ganda, koma dan baris baru di dalam sel", () => {
  const r = parseCsv('a,b\n"x,1","y\nz"\n');
  assert.deepEqual(r, [["a", "b"], ["x,1", "y\nz"]]);
});

const CSV = [
  "JURNAL,,,,,,,,,,,,,,,,,,,,,,,", ",,,,,,,,,,,,,,,,,,,,,,,",
  'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),"Total Biaya Bahan (Rp)","Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC',
  '1,RES-30082026-208,1 Sep 26,SEP,Hafied,Rifki,200 x 160,Paket,,,RISDI,,Bahan Lapisan,KAIN LAVA B-GRADE,KAIN COVER PREMIUM,KAIN,"1,7",METER,Rp 25.641,Rp 43.590,,,,QC OK',
  '2,RES-30082026-208,1 Sep 26,SEP,Hafied,Rifki,200 x 160,Paket,,,RISDI,,Lain-lain,LEM I-SR 1037 13 KG,LEM BUSA SEMPROT,LEM,"1,5",KG,Rp 3.842,Rp 5.763,,,,QC OK',
  "3,#N/A,#N/A,,,,,,,,,,,,,,,,,,,,,",
].join("\n");

test("bacaCsvPemakaian: kolom dikenali dari header; baris #N/A dipisah; nilai asli (teks) dipertahankan", () => {
  const h = bacaCsvPemakaian(CSV);
  assert.equal(h.baris.length, 2); assert.equal(h.tanpaOrder.length, 1);
  assert.equal(h.baris[0].qtyTeks, "1,7"); assert.equal(h.baris[1].satuan, "KG"); assert.equal(h.baris[1].kategori, "Lain-lain"); assert.equal(h.baris[0].raw.length >= 20, true);
  assert.throws(() => bacaCsvPemakaian("a,b\n1,2"), /Header/);
});

test("kunciSumber: stabil, bergantung isi; baris identik berulang punya kunci berbeda lewat urutan kemunculan", () => {
  const h = bacaCsvPemakaian(CSV).baris[0];
  assert.equal(kunciSumber(h, 1), kunciSumber({ ...h, baris: 999 }, 1), "nomor baris di berkas tidak ikut kunci");
  assert.notEqual(kunciSumber(h, 1), kunciSumber(h, 2));
  assert.notEqual(kunciSumber(h, 1), kunciSumber({ ...h, qtyTeks: "1,8" }, 1));
});

const KAT = [
  { id: "1", code: "KAIN-LAVA-B-GRADE", name: "KAIN LAVA B-GRADE", unit: "METER", active: true },
  { id: "2", code: "LEM-I-SR-1037-13-KG", name: "LEM I-SR 1037 13 KG", unit: "CAN", active: true },
  { id: "3", code: "BUSA-REBONDED-YL-180X200X2-D50", name: "BUSA REBONDED YL 180X200X2 D50", unit: "SHEET", active: true },
];
test("petakanBahan: nama persis atau penulisan = kode; selain itu TIDAK ditebak (kandidat saja)", () => {
  assert.equal(petakanBahan({ nama: "kain lava b-grade", spek: "" }, KAT).bahan.code, "KAIN-LAVA-B-GRADE");
  assert.equal(petakanBahan({ nama: "KAIN-LAVA-B-GRADE", spek: "" }, KAT).via, "KODE_PERSIS");
  const g = petakanBahan({ nama: "BUSA REBONDED YL 190X200X2 D50", spek: "" }, KAT);
  assert.equal(g.galat, "NAMA_TIDAK_DI_KATALOG"); assert.equal(g.bahan, undefined);
});

test("penanda: LEM 1,5 KG pada bahan CAN = perlu konfirmasi, TIDAK dikonversi; teks singkat bisa ditindaklanjuti", () => {
  assert.equal(petunjukKemasanKg("LEM I-SR 1037 13 KG"), 13); assert.equal(petunjukKemasanKg("KAIN LAVA"), null);
  const f = FLAG.SATUAN_BEDA_MASTER({ rawUom: "KG", rawQty: "1,5", masterUom: "CAN", kemasanKg: 13 });
  assert.equal(f.tingkat, "BLOK"); assert.match(f.teks, /1,5 KG/); assert.match(f.teks, /salah satuan/); assert.match(f.aksi, /Konfirmasi/); assert.match(f.aksi, /Tidak dikonversi otomatis/);
  assert.equal(f.data.rawQty, "1,5", "nilai asli ikut dalam data penanda");
  assert.equal(flagMemblok([FLAG.KATEGORI_KOMPLAIN()]), false); assert.equal(flagMemblok([FLAG.KATEGORI_KOMPLAIN(), f]), true);
  assert.match(catatanSingkat([FLAG.KATEGORI_KOMPLAIN(), f]), /Konfirmasi/); assert.equal(catatanSingkat([FLAG.KATEGORI_KOMPLAIN()]), null);
});

test("komponen lama dikenali dari penanda ASAL eksplisit (LAMA / BUANG KASUR); KILOAN = cara beli, BUKAN penanda asal", () => {
  assert.ok(KOMPONEN_LAMA_RE.test("BUSA LAMA")); assert.ok(KOMPONEN_LAMA_RE.test("BUANG KASUR")); assert.ok(KOMPONEN_LAMA_RE.test("KAIN KILOAN LAMA"), "KILOAN + LAMA: penanda asal eksplisit menang");
  assert.equal(KOMPONEN_LAMA_RE.test("MEMORY FOAM KILOAN"), false); assert.equal(KOMPONEN_LAMA_RE.test("BUSA LAMBAT"), false);
  assert.ok(KILOAN_RE.test("MEMORY FOAM KILOAN"));
});

test("buktiPembelianKiloan: semua kata khas nama + KILOAN harus ada di deskripsi pembelian, bertanggal pada/sebelum pemakaian; bahan lain bukan bukti", () => {
  const P = [{ purchaseNumber: "PUR-A", date: new Date("2026-09-23"), amount: 1_680_000, description: "Memory foam kiloan", status: "DIBAYAR" }, { purchaseNumber: "PUR-B", date: new Date("2026-09-20"), amount: 5, description: "Kain kiloan Hikaron", status: "DIBAYAR" }, { purchaseNumber: "PUR-C", date: new Date("2026-10-30"), amount: 5, description: "Memory foam kiloan", status: "DIBAYAR" }, { purchaseNumber: "PUR-D", date: new Date("2026-09-01"), amount: 5, description: "Memory foam", status: "DIBAYAR" }];
  const b = buktiPembelianKiloan({ rawName: "MEMORY FOAM KILOAN", usedAt: new Date("2026-09-24") }, P);
  assert.deepEqual(b.map((x) => x.nomor), ["PUR-A"], "hanya pembelian KILOAN yang menyebut MEMORY FOAM dan bertanggal sebelum pakai");
  assert.deepEqual(buktiPembelianKiloan({ rawName: "KARET BUSA KILOAN", usedAt: new Date("2026-09-24") }, P), []);
  assert.deepEqual(buktiPembelianKiloan({ rawName: "KILOAN", usedAt: new Date("2026-09-24") }, P), [], "nama hanya KILOAN tidak punya kata khas");
  assert.equal(FLAG.ASAL_BAHAN_PERLU_DICEK({ rawName: "X KILOAN" }).tingkat, "BLOK"); assert.equal(FLAG.ASAL_PEMBELIAN_BERTULIS({ rawName: "X", bukti: b }).tingkat, "INFO");
});
