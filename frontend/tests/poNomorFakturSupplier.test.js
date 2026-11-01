// Nomor faktur supplier pada PO: atribut FAKTUR/TAGIHAN (fin_supplier_bills.supplier_ref), bukan header PO.
// Dikunci: (1) nomor dipertahankan apa adanya (nol di depan, garis miring, tanda hubung; hanya trim), (2) "---" dianggap belum diisi,
// (3) duplikat hanya pada supplier yang sama & dokumen sendiri tidak dihitung, (4) semua faktur terkait PO tampil (termasuk tagihan lama via penerimaan),
// (5) pengubahan nomor memakai endpoint yang sudah ada dan hanya mengirim supplierRef + reason (tanpa nilai/status/jatuh tempo).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  nomorSupplierBermakna, daftarFakturPO, ringkasKelengkapanFaktur, periksaNomorSupplier, cariDuplikatNomor,
  STATUS_FAKTUR_AKTIF, NOMOR_SUPPLIER_MAKS, TEKS_NOMOR_BELUM_DIISI,
} from "../src/features/finance/po/poTampilan.js";

const baca = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("nomorSupplierBermakna: isian pengisi dianggap belum diisi; nomor asli dipertahankan apa adanya", () => {
  for (const kosong of [null, undefined, "", "   ", "---", "-", "—", "///", "  . . "]) assert.equal(nomorSupplierBermakna(kosong), null, JSON.stringify(kosong));
  assert.equal(nomorSupplierBermakna("000123/IV/2026"), "000123/IV/2026", "nol di depan & garis miring tetap");
  assert.equal(nomorSupplierBermakna("  INV-0042  "), "INV-0042", "hanya spasi luar dipangkas");
  assert.equal(nomorSupplierBermakna("A-0-B"), "A-0-B");
});

test("periksaNomorSupplier: trim saja, tanpa mengubah isi; menolak kosong/pengisi/terlalu panjang; mengenali tidak berubah", () => {
  assert.equal(periksaNomorSupplier("  000123/IV/2026 ").nilai, "000123/IV/2026");
  assert.equal(periksaNomorSupplier("000123/IV/2026").galat, null);
  assert.ok(periksaNomorSupplier("").galat);
  assert.ok(periksaNomorSupplier("   ").galat);
  assert.ok(periksaNomorSupplier("---").galat);
  assert.ok(periksaNomorSupplier("x".repeat(NOMOR_SUPPLIER_MAKS + 1)).galat);
  assert.equal(periksaNomorSupplier("x".repeat(NOMOR_SUPPLIER_MAKS)).galat, null);
  assert.equal(periksaNomorSupplier("INV-1", "INV-1").sama, true, "sama dengan nilai awal → tidak perlu simpan");
  assert.equal(periksaNomorSupplier("INV-2", "INV-1").sama, false);
  assert.equal(periksaNomorSupplier("0123", "123").sama, false, "nol di depan membedakan nomor (bukan angka)");
});

test("cariDuplikatNomor: hanya supplier yang sama, dokumen sendiri dikecualikan, tidak peka huruf besar/kecil, faktur batal/ditolak diabaikan", () => {
  const tagihan = [
    { id: "a", supplierId: "S1", supplierRef: "INV-7", status: "DISETUJUI", billNumber: "BILL-1" },
    { id: "b", supplierId: "S2", supplierRef: "INV-7", status: "DISETUJUI", billNumber: "BILL-2" },
    { id: "c", supplierId: "S1", supplierRef: "inv-7", status: "LUNAS", billNumber: "BILL-3" },
    { id: "d", supplierId: "S1", supplierRef: "INV-7", status: "DIBATALKAN", billNumber: "BILL-4" },
    { id: "e", supplierId: "S1", supplierRef: "INV-7", status: "DITOLAK", billNumber: "BILL-5" },
    { id: "f", supplierId: "S1", supplierRef: "INV-8", status: "DRAFT", billNumber: "BILL-6" },
  ];
  assert.deepEqual(cariDuplikatNomor({ tagihan, supplierId: "S1", nomor: "INV-7" }).map((x) => x.id), ["a", "c"]);
  assert.deepEqual(cariDuplikatNomor({ tagihan, supplierId: "S1", nomor: "INV-7", kecualiId: "a" }).map((x) => x.id), ["c"], "dokumen sendiri tidak dihitung");
  assert.deepEqual(cariDuplikatNomor({ tagihan, supplierId: "S2", nomor: "INV-7" }).map((x) => x.id), ["b"], "tidak unik global: supplier lain boleh sama");
  assert.deepEqual(cariDuplikatNomor({ tagihan, supplierId: "S3", nomor: "INV-7" }), []);
  assert.deepEqual(cariDuplikatNomor({ tagihan, supplierId: "S1", nomor: "---" }), [], "pengisi tidak dianggap duplikat");
  assert.deepEqual(cariDuplikatNomor({ tagihan: null, supplierId: "S1", nomor: "INV-7" }), []);
  assert.ok(!STATUS_FAKTUR_AKTIF.includes("DIBATALKAN") && !STATUS_FAKTUR_AKTIF.includes("DITOLAK"));
});

test("daftarFakturPO: faktur atas PO + tagihan lama via penerimaan (tanpa duplikasi, tanpa yang sudah lewat PO); tanpa penautan otomatis", () => {
  const po = {
    faktur: [
      { id: "f1", billNumber: "BILL-1", supplierRef: "000123/IV/2026", status: "DISETUJUI", amount: 1000 },
      { id: "f2", billNumber: "BILL-2", supplierRef: "---", status: "MENUNGGU_APPROVAL", amount: 500 },
      { id: "f3", billNumber: "BILL-3", supplierRef: null, status: "LUNAS", amount: 250 },
    ],
    penerimaan: [
      { receiptNumber: "GR-1", finSupplierBills: [{ id: "f1", billNumber: "BILL-1", supplierRef: "x", status: "DISETUJUI", amount: 1000, lewatPO: true }, { id: "l1", billNumber: "BILL-9", supplierRef: "", status: "DIBAYAR_SEBAGIAN", amount: 700, lewatPO: false }] },
      { receiptNumber: "GR-2", finSupplierBills: [{ id: "l1", billNumber: "BILL-9", supplierRef: "", status: "DIBAYAR_SEBAGIAN", amount: 700 }, { id: "l2", billNumber: "BILL-10", supplierRef: "INV-L2", status: "DISETUJUI", amount: 1, lewatPO: true }] },
    ],
  };
  const d = daftarFakturPO(po);
  assert.deepEqual(d.map((x) => x.id), ["f1", "f2", "f3", "l1"]);
  assert.equal(d[0].nomorSupplier, "000123/IV/2026");
  assert.equal(d[1].nomorSupplier, null); assert.equal(d[1].mentah, "---");
  assert.equal(d[3].sumber, "PENERIMAAN"); assert.equal(d[3].penerimaan, "GR-1");
  const r = ringkasKelengkapanFaktur(d);
  assert.deepEqual(r, { jumlah: 4, aktif: 4, belumBernomor: 3, lengkap: false });
  assert.deepEqual(daftarFakturPO({}), []);
  assert.deepEqual(ringkasKelengkapanFaktur([]), { jumlah: 0, aktif: 0, belumBernomor: 0, lengkap: false }, "belum ada faktur ≠ nomor lengkap");
  assert.equal(ringkasKelengkapanFaktur([{ nomorSupplier: "A", status: "LUNAS" }, { nomorSupplier: null, status: "DITOLAK" }]).lengkap, true, "faktur ditolak tidak menuntut nomor");
});

test("pemasangan: dialog hanya mengirim supplierRef + alasan ke endpoint info yang sudah ada; tanpa nilai/status/jatuh tempo", () => {
  const src = baca("../src/features/finance/po/FakturSupplierPO.jsx");
  assert.match(src, /api\.editInfoFinanceDoc\("bills", faktur\.id, \{ supplierRef: cek\.nilai, reason: alasan\.trim\(\) \}, kunci\.current\)/);
  assert.doesNotMatch(src, /api\.(create|pay|approve|reject|cancel|koreksi|update)\w*/i, "tidak memanggil API keuangan lain");
  assert.equal((src.match(/api\.\w+\(/g) || []).filter((x) => x !== "api.editInfoFinanceDoc(" && x !== "api.getFinanceBills(").length, 0, "hanya dua panggilan API");
  assert.match(src, /Idempotency|kunci\.current \|\|=/, "kunci idempoten dibuat sekali per dialog");
  assert.match(src, /TEKS_NOMOR_BELUM_DIISI/);
  assert.equal(TEKS_NOMOR_BELUM_DIISI, "Nomor supplier belum diisi");
  assert.match(src, /Belum ada faktur tercatat/);
  assert.match(src, /bukan berarti nomornya kosong/, "membedakan belum dicatat vs nomor belum diisi");
  assert.match(src, /data-testid="(lengkapi-nomor-faktur|ubah-nomor-faktur|riwayat-nomor-faktur|catat-faktur-dari-kosong|belum-ada-faktur|seksi-faktur)"/);
});

test("pemasangan: Rincian PO memakai bagian faktur baru, ModalFaktur menjelaskan dampak & asal dokumen; label Ref Supplier diganti", () => {
  const r = baca("../src/features/finance/po/RincianPO.jsx");
  assert.match(r, /<BagianFakturSupplier/);
  assert.match(r, /<DialogNomorFaktur/);
  assert.match(r, /<RiwayatVersiDialog jenis="bills"/);
  assert.match(r, /data-testid="dampak-catat-faktur"/);
  assert.match(r, /data-testid="asal-faktur-po"/);
  assert.match(r, /Bukan nomor tagihan SANSS \(BILL-…\) dan bukan nomor PO/);
  assert.match(r, /<PeringatanDuplikatNomor/);
  const s = baca("../src/pages/finance/FinanceSuppliers.jsx");
  assert.doesNotMatch(s, /"Ref Supplier"/);
  assert.match(s, /label: "Nomor faktur supplier", value: b\.supplierRef/);
});
