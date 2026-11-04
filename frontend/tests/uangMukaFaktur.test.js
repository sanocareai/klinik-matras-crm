// Uang muka PO → penerapan ke faktur supplier: logika murni (kelayakan dari kontrak server, sen, kesiapan, risiko pembayaran kedua) + pemasangan di layar.
// Angka & kelayakan datang dari server; di sini hanya dikunci cara layar MEMILIH dan MENYAJIKANNYA, bukan rumus keuangan baru.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ringkasKelayakan, teksPeringatanUangMuka, pilihanAwal, maksimalPenerapan, pratinjauPenerapan, perluKonfirmasiPasangan,
  kesiapanPenerapan, bodyPenerapan, cekNominalBayar, fakturPerluPeriksaUangMuka, fakturBerisikoBayarKedua, KODE_PERLU_MUAT_ULANG,
} from "../src/features/finance/uangMukaFaktur/kelayakanLogika.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8").replace(/\r\n/g, "\n");

const faktur = (o = {}) => ({ id: "b1", nomor: "BILL-1", status: "DISETUJUI", supplier: "SHOPEE", po: "PO-1", nilai: 443760, sisaUtang: 443760, bolehDiterapkan: true, ...o });
const dp = (o = {}) => ({ id: "u1", nomor: "PUR-1", nominal: 443760, saldoBelumDiterapkan: 443760, saran: 443760, samaPO: true, bedaPO: false, purchaseOrder: { id: "po1", nomor: "PO-1" }, ...o });
const data = (uangMuka, f = {}) => ({ faktur: faktur(f), uangMuka });

test("kelayakan: hanya uang muka yang tertaut ke PO faktur yang sama memicu peringatan; yang lain tidak pernah dipasangkan otomatis", () => {
  const r = ringkasKelayakan(data([dp(), dp({ id: "u2", nomor: "PUR-2", samaPO: false, bedaPO: true, saldoBelumDiterapkan: 600000, saran: 443760 }), dp({ id: "u3", nomor: "PUR-3", samaPO: false, bedaPO: false, purchaseOrder: null })]));
  assert.equal(r.ada, true);
  assert.deepEqual(r.sesuai.map((d) => d.nomor), ["PUR-1"]);
  assert.deepEqual(r.lain.map((d) => d.nomor), ["PUR-2", "PUR-3"]);
  assert.equal(r.saldoPO, 443760, "saldo supplier lain TIDAK dijumlahkan ke PO ini");
  assert.equal(r.jumlah, 443760);
  // supplier punya uang muka tetapi tak satu pun milik PO ini → tidak ada peringatan
  const lain = ringkasKelayakan(data([dp({ samaPO: false, bedaPO: true })]));
  assert.equal(lain.ada, false); assert.equal(lain.sebab, "tanpa-uang-muka-po"); assert.equal(lain.lain.length, 1);
  // tanpa uang muka sama sekali, faktur lunas/belum disetujui, tanpa data
  assert.equal(ringkasKelayakan(data([])).ada, false);
  assert.equal(ringkasKelayakan(data([dp()], { sisaUtang: 0 })).ada, false);
  assert.equal(ringkasKelayakan(data([dp()], { bolehDiterapkan: false, status: "MENUNGGU_APPROVAL" })).sebab, "status-faktur");
  assert.equal(ringkasKelayakan(null).ada, false);
});

test("kelayakan: jumlah = min(saldo uang muka PO, sisa faktur) dalam sen; beberapa uang muka satu PO dijumlah hanya untuk PO itu", () => {
  const a = ringkasKelayakan(data([dp({ saldoBelumDiterapkan: 1000000 })], { sisaUtang: 443760.37 }));
  assert.equal(a.jumlah, 443760.37); assert.equal(a.saldoPO, 1000000);
  const b = ringkasKelayakan(data([dp({ saldoBelumDiterapkan: 100000.1 }), dp({ id: "u2", nomor: "PUR-2", saldoBelumDiterapkan: 200000.2 })], { sisaUtang: 900000 }));
  assert.equal(b.saldoPO, 300000.3, "tanpa galat floating point (0.1 + 0.2)"); assert.equal(b.jumlah, 300000.3);
  assert.equal(maksimalPenerapan(dp({ saldoBelumDiterapkan: 5 }), 3), 3);
  assert.equal(maksimalPenerapan(dp({ saldoBelumDiterapkan: 2.55 }), 3), 2.55);
  assert.equal(maksimalPenerapan(null, 3), 0);
});

test("peringatan: kalimat baku memuat nominal dengan sen bila ada; menyebut yang bisa mengurangi tagihan hanya bila berbeda", () => {
  assert.equal(teksPeringatanUangMuka(ringkasKelayakan(data([dp()]))), "Ada uang muka Rp443.760 untuk PO ini yang belum diterapkan. Periksa sebelum mencatat pembayaran baru.");
  assert.match(teksPeringatanUangMuka(ringkasKelayakan(data([dp({ saldoBelumDiterapkan: 1000000 })]))), /Rp1\.000\.000 untuk PO ini.*Yang bisa mengurangi sisa tagihan ini: Rp443\.760\./);
  assert.match(teksPeringatanUangMuka(ringkasKelayakan(data([dp({ saldoBelumDiterapkan: 443760.37 })], { sisaUtang: 443760.37 }))), /Rp443\.760,37/);
});

test("pilihan awal: hanya uang muka PO yang sama; tanpa kecocokan jelas TIDAK ada yang dipilih (tidak menebak pasangan)", () => {
  assert.deepEqual(pilihanAwal(data([dp({ samaPO: false, bedaPO: true, id: "x" }), dp({ id: "u1", saran: 123.45 })])), { id: "u1", nominal: "123.45" });
  assert.deepEqual(pilihanAwal(data([dp({ samaPO: false, bedaPO: true })])), { id: null, nominal: "" });
  assert.deepEqual(pilihanAwal(data([dp({ samaPO: false, bedaPO: false, purchaseOrder: null })])), { id: null, nominal: "" });
  assert.deepEqual(pilihanAwal(null), { id: null, nominal: "" });
});

test("pratinjau: sebelum → sesudah dalam sen, melunasi bila sisa nol; tidak pernah negatif", () => {
  const p = pratinjauPenerapan({ sisaFaktur: 443760.37, uangMuka: dp({ saldoBelumDiterapkan: 600000 }), nominal: 443760.37 });
  assert.deepEqual(p, { sisaSebelum: 443760.37, sisaSesudah: 0, saldoSebelum: 600000, saldoSesudah: 156239.63, melunasi: true });
  const q = pratinjauPenerapan({ sisaFaktur: 1000, uangMuka: dp({ saldoBelumDiterapkan: 400 }), nominal: 400 });
  assert.equal(q.sisaSesudah, 600); assert.equal(q.saldoSesudah, 0); assert.equal(q.melunasi, false);
  assert.equal(pratinjauPenerapan({ sisaFaktur: 10, uangMuka: dp({ saldoBelumDiterapkan: 10 }), nominal: 50 }).sisaSesudah, 0);
});

test("kesiapan & body: pasangan non-PO-sama wajib dikonfirmasi; body hanya membawa kolom kontrak server", () => {
  const sama = dp(); const beda = dp({ samaPO: false, bedaPO: true }); const tanpa = dp({ samaPO: false, bedaPO: false, purchaseOrder: null });
  assert.equal(perluKonfirmasiPasangan(sama), false); assert.equal(perluKonfirmasiPasangan(beda), true); assert.equal(perluKonfirmasiPasangan(tanpa), true);
  const dasar = { nominal: 100, sisaFaktur: 500, konfirmasi: true };
  assert.equal(kesiapanPenerapan({ uangMuka: sama, ...dasar }).siap, true);
  assert.match(kesiapanPenerapan({ uangMuka: beda, ...dasar }).pesan, /PO lain/);
  assert.match(kesiapanPenerapan({ uangMuka: tanpa, ...dasar }).pesan, /tidak tertaut ke PO/);
  assert.equal(kesiapanPenerapan({ uangMuka: tanpa, ...dasar, konfirmasiPasangan: true }).siap, true);
  assert.match(kesiapanPenerapan({ uangMuka: sama, ...dasar, konfirmasi: false }).pesan, /konfirmasi/);
  assert.match(kesiapanPenerapan({ uangMuka: sama, nominal: 600, sisaFaktur: 500, konfirmasi: true }).pesan, /sisa faktur/);
  assert.deepEqual(bodyPenerapan({ uangMuka: sama, billId: "b1", nominal: "443760.37", sisaFaktur: 443760.37 }), { advanceId: "u1", billId: "b1", amount: 443760.37, konfirmasi: true, sisaFakturDilihat: 443760.37 });
  const bb = bodyPenerapan({ uangMuka: beda, billId: "b1", nominal: 1, sisaFaktur: 1, konfirmasiPasangan: true, catatan: " pindah " });
  assert.equal(bb.konfirmasiBedaPO, true); assert.equal(bb.catatan, "pindah");
  assert.equal("konfirmasiBedaPO" in bodyPenerapan({ uangMuka: tanpa, billId: "b1", nominal: 1, sisaFaktur: 1, konfirmasiPasangan: true }), false, "tanpa PO: kontrak server tidak meminta konfirmasiBedaPO");
});

test("pembayaran: nominal dibanding sisa TERKINI dalam sen; risiko pembayaran kedua hanya untuk faktur yang diisi DAN punya uang muka PO belum diterapkan", () => {
  assert.equal(cekNominalBayar(100.01, 100).lebih, true); assert.equal(cekNominalBayar(100, 100).lebih, false); assert.equal(cekNominalBayar(0.37, 0.37).lebih, false);
  assert.equal(cekNominalBayar(443760.37, 443760.37).lebih, false, "tanpa galat floating point");
  const terbuka = [{ id: "b1", billNumber: "BILL-1" }, { id: "b2", billNumber: "BILL-2" }, { id: "b3", billNumber: "BILL-3" }];
  const peta = new Map([["b1", ringkasKelayakan(data([dp()]))], ["b2", ringkasKelayakan(data([]))]]);
  const r = fakturBerisikoBayarKedua(terbuka, { b1: "443760", b2: "10", b3: "5" }, peta);
  assert.deepEqual(r, [{ id: "b1", nomor: "BILL-1", nominalKas: 443760, uangMuka: 443760, bisaDiterapkan: 443760 }]);
  assert.deepEqual(fakturBerisikoBayarKedua(terbuka, { b1: "" }, peta), [], "nominal kosong = tidak ada risiko");
  assert.deepEqual(fakturBerisikoBayarKedua(terbuka, { b1: "1" }, new Map()), [], "pemeriksaan belum selesai/gagal: tidak memblokir pembayaran");
});

test("faktur yang diperiksa & kode muat-ulang", () => {
  assert.equal(fakturPerluPeriksaUangMuka({ purchaseOrderId: "p", status: "DISETUJUI", sisa: 1 }), true);
  assert.equal(fakturPerluPeriksaUangMuka({ purchaseOrderId: "p", status: "DIBAYAR_SEBAGIAN", sisa: 0.37 }), true);
  assert.equal(fakturPerluPeriksaUangMuka({ purchaseOrderId: "p", status: "LUNAS", sisa: 0 }), false);
  assert.equal(fakturPerluPeriksaUangMuka({ purchaseOrderId: null, status: "DISETUJUI", sisa: 5 }), false, "tanpa PO tidak ada kaitan yang jelas");
  assert.ok(KODE_PERLU_MUAT_ULANG.includes("SISA_FAKTUR_BERUBAH") && KODE_PERLU_MUAT_ULANG.includes("MELEBIHI_SALDO_UANG_MUKA"));
});

test("pemasangan: satu komponen bersama dipakai Tagihan supplier, rincian PO, tawaran setelah persetujuan, dan form pembayaran; tanpa dialog bawaan peramban", () => {
  const um = baca("../src/features/finance/uangMukaFaktur/PenerapanUangMuka.jsx");
  const sup = baca("../src/pages/finance/FinanceSuppliers.jsx");
  const po = baca("../src/features/finance/po/RincianPO.jsx");
  const rin = baca("../src/features/finance/tagihan/RincianTagihan.jsx");
  const daftar = baca("../src/features/finance/tagihan/DaftarTagihan.jsx");
  assert.doesNotMatch(um, /window\.(confirm|prompt|alert)|confirmText/, "penerapan memakai dialog aplikasi");
  assert.doesNotMatch(baca("../src/features/finance/uangMukaFaktur/kelayakanLogika.js"), /window\./);
  // kontrak server yang SUDAH ADA — tidak ada jalur transaksi kedua
  for (const s of ["api.getKandidatUangMukaFaktur(", "api.terapkanUangMukaFaktur(body, kunciTerapkan(body))", "sisaFaktur: sisa", "Tidak ada uang keluar baru dari bank", "data-testid=\"pratinjau-penerapan\"", "Faktur disetujui", "Gunakan uang muka untuk mengurangi sisa tagihan?", "Nanti saja", "Coba lagi"]) assert.ok(um.includes(s), s);
  assert.doesNotMatch(um, /api\.(createFinanceSupplierPayment|bayarUangMukaPO|batalkanPenerapanUangMuka)/, "dialog penerapan hanya memanggil kandidat dan terapkan");
  assert.match(um, /konfirmasi: true|bodyPenerapan/);
  // gagal menyimpan: isian tetap, pesan galat, tidak ada keberhasilan palsu; muat ulang menjaga isian
  assert.match(um, /Isian Anda tetap ada; coba lagi/); assert.match(um, /muat\(\{ pertahankan: true \}\)/); assert.match(um, /try \{ await onSaved\?\.\(\); \} catch/);
  // tidak ada penerapan otomatis: tawaran hanya membuka dialog; menutup tidak memanggil API
  assert.match(um, /Menutup tawaran ini tidak membatalkan persetujuan dan tidak menulis jurnal apa pun/);
  assert.doesNotMatch(um.split("function TawaranUangMuka")[1], /api\./, "tawaran tidak memanggil API sendiri");
  // pemanggil
  assert.match(sup, /useTawaranUangMuka\(/); assert.match(sup, /tawaran\.mulai\(b\.id,/); assert.match(sup, /\{tawaran\.elemen\}/);
  assert.match(sup, /kelayakanUm=\{kelayakan\.peta\}/); assert.match(sup, /onTerapkanUm=\{dariBaris\(setUangMukaUntuk\)\}/);
  assert.match(po, /useTawaranUangMuka\(/); assert.equal((po.match(/tawaran\.mulai\(/g) || []).length, 2, "dua jalur persetujuan di rincian PO (tinjauan harga) + kartu faktur via onSetelahSetuju");
  assert.match(po, /onSetelahSetuju\?\.\(fk\)/); assert.match(po, /renderPeringatan=\{\(f\) =>/); assert.match(po, /<PeringatanUangMukaFaktur billId=\{f\.id\}/);
  assert.match(baca("../src/features/finance/po/FakturSupplierPO.jsx"), /data-testid="peringatan-baris-faktur"/, "peringatan terlihat di BARIS faktur, bukan hanya di Rincian yang terlipat");
  assert.match(rin, /<BannerUangMuka/); assert.match(rin, /data-testid="penyelesaian-faktur"/);
  assert.match(daftar, /data-testid="chip-uang-muka"/); assert.match(daftar, /kelayakanUm\?\.get\(b\.id\)/);
  // PO yang sama: kelayakan dari server, bukan saldo supplier
  assert.match(sup, /fakturPerluPeriksaUangMuka\(b\) && supplierAdaUangMuka\.has\(b\.supplierId\)/);
  assert.doesNotMatch(daftar + rin, /uangMukaBelumDiterapkan[^\n]{0,80}supplier/i, "tidak menjumlah uang muka seluruh supplier sebagai milik PO ini");
});

test("form pembayaran: periksa ulang uang muka, validasi ulang nominal setelah sisa berubah, konfirmasi risiko, galat di dalam dialog", () => {
  const sup = baca("../src/pages/finance/FinanceSuppliers.jsx");
  const f = sup.split("function ModalBayarSupplierIsi(")[1].split("// Edit tagihan yang BELUM disetujui")[0];
  for (const s of ["useKelayakanFaktur(idKelayakan)", "fakturBerisikoBayarKedua(", "cekNominalBayar(", "data-testid=\"konfirmasi-risiko-bayar\"", "data-testid=\"paham-risiko\"", "Tetap catat pembayaran", "Terapkan uang muka dulu", "sisaDilihat", "Nominal dikosongkan", "Total dibayar dari kas", "Menerapkan uang muka ke faktur tidak termasuk di sini", "<Galat pesan={galat}"]) assert.ok(f.includes(s), s);
  assert.doesNotMatch(f, /window\.(confirm|prompt)|confirmText/);
  // hanya faktur yang masih terbuka yang dikirim (faktur yang baru lunas oleh uang muka tidak ikut)
  assert.match(f, /tagihanTerbuka\.some\(\(b\) => b\.id === id\)/);
  // tombol Simpan membuka konfirmasi risiko dulu; pembayaran tidak diblokir
  assert.match(f, /function simpan\(\)[\s\S]*berisiko\.length > 0[\s\S]*return kirim\(\)/);
  assert.match(f, /disabled=\{!paham\}/);
  // penyegaran senyap agar form tidak dibongkar saat uang muka diterapkan dari dalamnya
  assert.match(sup, /onRefresh=\{\(\) => muat\(\{ senyap: true \}\)\}/); assert.match(sup, /if \(!senyap\) setLoading\(true\)/);
  // galat simpan dilempar ke dialog (bukan ditelan pemanggil) supaya isian tetap
  assert.match(sup, /onSubmit=\{async \(d, kunci\) => \{ await api\.createFinanceSupplierPayment\(d, kunci\); setModal\(null\); await muat\(\); \}\}/);
});

test("aturan akuntansi UI: tiga status berbeda dan kalimat penerapan tidak menyebut uang keluar", () => {
  const rin = baca("../src/features/finance/tagihan/RincianTagihan.jsx");
  assert.ok(rin.includes("“Uang muka dibayar”, “faktur disetujui”, dan “uang muka diterapkan” adalah tiga langkah terpisah"));
  assert.ok(rin.includes("penerapan tidak mengeluarkan uang dari bank"));
  assert.match(rin, /Kredit \/ penyesuaian lain/); assert.match(rin, /sen\(b\.kredit\) - sen\(dpDiterapkan\)/, "kredit lain = pengurang server − uang muka diterapkan (tidak dihitung dua kali)");
});
