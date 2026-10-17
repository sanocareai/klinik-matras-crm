import test from "node:test";
import assert from "node:assert/strict";
import { parseTanggalId, bacaPemakaian, bacaRekapOrder, bacaPembelian, rekonsiliasiRiwayat, TIER } from "../src/services/stokRiwayatOktober.js";
import { kesiapanPencatatanBaru, KESIAPAN , RUANG_PENAHAN } from "../src/services/stokKesiapanCatat.js";
import { rekonsiliasiCatatan } from "../src/services/stokRekonCatatan.js";

test("tanggal Indonesia/estimasi: aktual vs EST/estimasi; bulan Inggris singkat", () => {
  assert.deepEqual(parseTanggalId("9 Oktober 2026"), { iso: "2026-10-09", estimasi: false, tahunDiasumsikan: false });
  assert.equal(parseTanggalId("25 Desember 2025").iso, "2025-12-25");
  assert.deepEqual(parseTanggalId("EST 9 oct"), { iso: "2026-10-09", estimasi: true, tahunDiasumsikan: true });
  assert.equal(parseTanggalId("estimasi 12 OCT").estimasi, true);
  assert.equal(parseTanggalId(""), null); assert.equal(parseTanggalId("segera"), null);
});

// ---- fixture pemakaian: tanggal ISO di kolom 9 (header menyebutnya PIC), label bulan di kolom 10
const kol = (o) => { const r = Array(22).fill(""); r[0] = o.no; r[1] = o.resi; r[2] = "DONE F"; r[3] = "PIC"; r[4] = "Pelanggan"; r[8] = o.tgl; r[9] = o.label; r[10] = "Bahan"; r[11] = o.nama; r[14] = o.qty; r[15] = o.sat; r[21] = "QC OK"; return r.join(","); };
const pemakaianCsv = ["JURNAL", "x", ["No", "No. Resi / Order", "Tgl Selesai", "Bulan Selesai", "Nama Pelanggan"].join(","),
  kol({ no: 1, resi: "RES-30082026-208", tgl: "2026-08-30", label: "SEP", nama: "KAIN A", qty: '"1,7"', sat: "METER" }),
  kol({ no: 2, resi: "RES-23092026-145", tgl: "2026-09-23", label: "OKT", nama: "KAIN A", qty: '"2,0"', sat: "METER" }),
  kol({ no: 3, resi: "RES-05102026-010", tgl: "2026-10-05", label: "OKT", nama: "KAIN A", qty: "3", sat: "METER" }),
  kol({ no: 4, resi: "RES-20102026-011", tgl: "2026-10-20", label: "OKT", nama: "KAIN A", qty: "9", sat: "METER" }),
  "bukan,baris,data", kol({ no: 5, resi: "RES-01102026-001", tgl: "TGL?", label: "OKT", nama: "KAIN A", qty: "1", sat: "METER" })].join("\n");

test("pemakaian: struktur dibaca dari isi (tanggal di kolom 9), label bulan tidak dipercaya, baris rusak dilaporkan", () => {
  const p = bacaPemakaian(pemakaianCsv);
  assert.equal(p.baris.length, 4); assert.equal(p.tidakDikenal.length, 2, "baris non-data dan baris tanggal rusak dilaporkan");
  assert.deepEqual(Object.keys(p.struktur.kolomTanggalPosisi), ["9"]);
  assert.equal(p.baris[0].qty, 1.7); assert.equal(p.baris[0].labelCocokTanggal, false, "label SEP untuk tanggal 30 Agustus");
  assert.equal(p.baris[1].labelCocokTanggal, false, "label OKT untuk tanggal 23 September");
  assert.equal(p.struktur.labelBulanTidakDipercaya, 2); assert.equal(p.struktur.tanggalSamaDenganNomorResi, 4);
  assert.equal(p.cakupan.sampai, "2026-10-20");
});

test("rekap order: tanggal dari isi", () => {
  const r = Array(33).fill(""); r[0] = "1"; r[1] = "RES-30082026-208"; r[2] = "DONE F"; r[8] = "2026-08-30";
  const o = bacaRekapOrder(["a", "b", r.join(",")].join("\n"));
  assert.equal(o.orders.length, 1); assert.equal(o.cakupan.sampai, "2026-08-30");
});

const beliCsv = (rows) => ["BULAN KRM,TGL PO,TANGGAL KIRIM,NO SURAT JALAN,NO INVOICE,JENIS,Product Code,Product Description,VENDOR NAME,HARGA EXC,harga inc,satuan,PACK,PO,QTY kirim,PURCHASE INC,PURCHASE EXC,CATATAN,CAT BARANG,BRAND,FOTO,TOP,JATUH TEMPO,BULAN TEMPO,PEMBAYARAN", ...rows].join("\n");
const brs = (o) => { const r = Array(25).fill(""); r[0] = "OKT"; r[1] = o.po || o.kirim; r[2] = o.kirim; r[3] = o.sj || ""; r[5] = o.jenis || "BAHAN BAKU"; r[7] = o.nama; r[8] = "VENDOR"; r[11] = o.sat; r[13] = o.qtyPO ?? ""; r[14] = o.qty; r[17] = o.cat || ""; return r.join(","); };
test("pembelian: tier bukti — aktual+SJ (A), aktual tanpa SJ (B), estimasi (C), PO saja (D)", () => {
  const b = bacaPembelian(beliCsv([brs({ kirim: "6 Oktober 2026", sj: "SJ-1", nama: "KAIN A", qty: 10, sat: "METER" }), brs({ kirim: "9 Oktober 2026", nama: "KAIN B", qty: 5, sat: "METER" }), brs({ kirim: "EST 12 oct", nama: "KAIN C", qty: 5, sat: "METER" }), brs({ kirim: "", po: "3 Oktober 2026", nama: "KAIN D", qty: "", qtyPO: 10, sat: "METER" })]));
  assert.deepEqual(b.events.map((e) => e.tier), [TIER.A, TIER.B, TIER.C, TIER.D]);
  assert.equal(b.cakupan.aktualSampai, "2026-10-09"); assert.equal(b.cakupan.estimasi, 1);
});

// ---- rekonsiliasi
const M = (id, code, name, unit) => ({ id, code, name, unit, active: true });
const mats = [M("a", "KAIN-A", "KAIN A", "METER"), M("b", "KAIN-B", "KAIN B", "METER"), M("d", "KAIN-D", "KAIN D", "METER"), M("k", "KAYU", "KAYU K", "ROD")];
const peta = (nama) => { const m = mats.find((x) => x.name === String(nama).toUpperCase().replace(/\s+/g, " ").trim()); return m ? { material: m, kelas: "NAMA_SAMA" } : { material: null, kelas: "TANPA_PASANGAN" }; };
const mv = (id, qty, at, extra = {}) => ({ id, type: qty > 0 ? "RECEIPT" : "ISSUE", qty, createdAt: new Date(at), dokumen: null, jalur: "GR", ...extra });
const ledger = new Map([["a", [mv("a1", 100, "2026-09-05T00:00:00Z"), mv("a2", -1.7, "2026-08-31T17:00:00Z", { jalur: "UNIT_LEPAS" }), mv("a3", 10, "2026-10-16T06:00:00Z", { dokumen: "GR-A" })]], ["b", []], ["d", []], ["k", []]]);
const issueLedger = [{ materialCode: "KAIN-A", qty: -1.7, unitCode: "RES-30082026-208-U1", note: "Impor", createdAt: new Date("2026-08-31T17:00:00Z") }];
const grLines = [{ receiptNumber: "GR-A", status: "COMPLETED", arrivedDate: "2026-10-06", receivedDate: "2026-10-16", suratJalan: "SJ-1", buktiFoto: 0, materialCode: "KAIN-A", orderedQty: 10, receivedQty: 10, acceptedQty: 10, poNumber: "PO-1" }];
const poLines = [{ poNumber: "PO-9", status: "DISETUJUI", supplier: "V", materialCode: "KAIN-D", qty: 10, unit: "METER" }];
const stok = new Map([["a", { sep: 90, sepMentah: "90", qtyOkt: null, satuanSep: "METER", barisCsv: 7 }]]);
const beli = bacaPembelian(beliCsv([brs({ kirim: "6 Oktober 2026", sj: "SJ-1", nama: "KAIN A", qty: 10, sat: "METER" }), brs({ kirim: "9 Oktober 2026", sj: "SJ-2", nama: "KAIN B", qty: 5, sat: "METER" }), brs({ kirim: "EST 12 oct", nama: "KAIN D", qty: 5, sat: "METER" }), brs({ kirim: "10 Oktober 2026", nama: "KAYU K", qty: 2, sat: "KUBIK", cat: "750 BATANG" }), brs({ kirim: "20 Oktober 2026", sj: "SJ-9", nama: "KAIN B", qty: 7, sat: "METER" })]));
const jalan = (extra = {}) => rekonsiliasiRiwayat({ pemetaanNama: peta, materials: mats, ledger, issueLedger, grLines, poLines, stok, pakai: bacaPemakaian(pemakaianCsv), beli, rekap: bacaRekapOrder(""), ...extra });
const get = (h, k) => h.bahan.find((x) => x.kode === k);

test("pemakaian yang sudah ada di ledger (order+material) tidak dicatat dua kali; yang belum ditandai; qty beda dilaporkan", () => {
  const a = get(jalan(), "KAIN-A");
  const p208 = a.pemakaian.find((p) => p.resi === "RES-30082026-208"); assert.equal(p208.status, "SUDAH_DI_LEDGER_SAMA"); assert.equal(p208.qtyLedger, 1.7);
  assert.equal(a.pemakaian.find((p) => p.resi === "RES-05102026-010").status, "BELUM_DI_LEDGER");
  assert.equal(a.pemakaianOktBelumDiLedger, 2, "order 05 Okt dan 20 Okt (fixture melewati 9 Okt)");
  assert.equal(a.pemakaianLabelOktSebelumBelumDiLedger, 1, "23 Sep berlabel OKT = batas atas");
  assert.equal(a.qtyPemakaianOktBelumDiLedger, 12); assert.equal(a.qtyPemakaianBatasAtasBelumDiLedger, 14);
  const beda = jalan({ issueLedger: [{ ...issueLedger[0], qty: -2.1 }] });
  assert.ok(get(beda, "KAIN-A").isu.some((i) => i.kode === "PEMAKAIAN_QTY_BEDA_DENGAN_LEDGER"));
});

test("penerimaan: GR yang sama tidak dihitung dua kali; terbukti tiba tanpa GR ditandai; estimasi & PO saja bukan stok", () => {
  const h = jalan(); const a = get(h, "KAIN-A"); const b = get(h, "KAIN-B"); const d = get(h, "KAIN-D");
  assert.equal(a.penerimaan[0].status, "SUDAH_DI_LEDGER_VIA_GR"); assert.equal(a.penerimaan[0].gr.nomor, "GR-A");
  assert.equal(b.penerimaan.find((t) => t.suratJalan === "SJ-2").status, "TERBUKTI_TIBA_BELUM_ADA_GR");
  assert.equal(d.penerimaan[0].status, "ESTIMASI_BUKAN_BUKTI"); assert.ok(d.isu.some((i) => i.kode === "PO_TERBUKA_BUKAN_STOK"));
  assert.equal(d.perkiraan9Okt, null, "tanpa hitung parsial: kosong bukan nol");
  assert.equal(d.status, "TANPA_TITIK_HITUNG");
});

test("T0 TIDAK menyaring baris: tanggal order bukan tanggal pemakaian; hanya ditandai dan diperiksa terhadap Material Issue resmi", () => {
  const h = jalan({ mulai: new Date("2026-10-09T17:00:00Z") }); // 10 Okt 00:00 WIB
  const a = get(h, "KAIN-A"); const p = a.pemakaian.find((x) => x.resi === "RES-20102026-011");
  assert.ok(p, "pemakaian 20 Okt tetap tersimpan sebagai referensi"); assert.equal(p.tanggalOrderSetelahT0, true);
  assert.ok(a.isu.some((i) => i.kode === "ORDER_SETELAH_T0_BELUM_DI_LEDGER"));
  assert.deepEqual(a.setelahMulai, []); assert.equal(a.pemakaianOktBelumDiLedger, 2);
  const b = get(h, "KAIN-B"); assert.ok(b.penerimaan.some((t) => t.suratJalan === "SJ-9" && t.tanggalKirimSetelahT0 === true), "penerimaan setelah T0 tetap ada dan ditandai");
});

test("perkiraan 9 Okt: SEP + penerimaan terbukti − pemakaian (batas bawah/atas); penerimaan sekitar hitung tidak ditambah; satuan beda ditandai", () => {
  const a = get(jalan(), "KAIN-A"); assert.equal(a.titikHitung[0].tingkat, "TANPA_TANGGAL");
  assert.equal(a.perkiraan9Okt, 90 + 10 - 12); assert.equal(a.perkiraan9OktAtas, 90 + 10 - 14);
  const kayu = get(jalan(), "KAYU"); assert.ok(kayu.isu.some((i) => i.kode === "SATUAN_PENERIMAAN_BEDA"));
  const cur = rekonsiliasiRiwayat({ pemetaanNama: peta, materials: mats, ledger, issueLedger, grLines: [], poLines, stok, pakai: bacaPemakaian(pemakaianCsv), beli: bacaPembelian(beliCsv([brs({ kirim: "1 Oktober 2026", sj: "SJ-0", nama: "KAIN A", qty: 40, sat: "METER" })])), rekap: bacaRekapOrder("") });
  const ak = get(cur, "KAIN-A"); assert.ok(ak.isu.some((i) => i.kode === "PENERIMAAN_SEKITAR_HITUNG")); assert.equal(ak.perkiraan9Okt, 90 - 12, "40 tidak ditambahkan");
});

test("kesiapan pencatatan baru: negatif/dokumen menahan; yang bersih SIAP", () => {
  const mats2 = [M("a", "KAIN-A", "KAIN A", "METER"), M("b", "KAIN-B", "KAIN B", "METER")];
  const led = new Map([["a", [mv("a1", 100, "2026-09-05T00:00:00Z")]], ["b", [mv("b1", -3, "2026-09-05T00:00:00Z")]]]);
  const catatan = rekonsiliasiCatatan({ pemetaan: [], materials: mats2, ledger: led });
  const riw = { bahan: [] };
  const k = kesiapanPencatatanBaru({ catatan, riwayat: riw, materials: mats2, ledger: led, pending: [{ materialCode: "KAIN-A", dok: "GR-X", status: "DRAFT" }] });
  assert.equal(k.bahan.find((x) => x.kode === "KAIN-A").kesiapan, KESIAPAN.TAHAN_DOKUMEN); assert.equal(k.bahan.find((x) => x.kode === "KAIN-B").kesiapan, KESIAPAN.TAHAN_NEGATIF);
  const k2 = kesiapanPencatatanBaru({ catatan, riwayat: riw, materials: mats2.slice(0, 1), ledger: led, pending: [] }); assert.equal(k2.bahan[0].kesiapan, KESIAPAN.SIAP);
});

test("kesiapan: bahan P1 yang juga punya dokumen tertunda TETAP P1 (cek fisik mendesak) dan keputusan GR tetap dibutuhkan; 'SIAP' bukan bukti jumlah", async () => {
  const { petakan, bacaStockCsv } = await import("../src/services/stokFileImport.js");
  const H = Array(70).fill(""); [[0, "KODE BANG"], [1, "NAMA BARANG"], [2, "SATUAN"], [3, "JENIS"], [4, "BARANG"], [5, "VENDOR"], [43, "HARGA ACT"], [44, "MASUK"], [45, "KELUAR"], [46, "SISA"], [47, "QTY SEP"], [48, "QTY Selisih"], [49, "SATUAN"], [52, "HARGA ACT"], [53, "MASUK"], [54, "KELUAR"], [55, "SISA"], [56, "QTY OKT"], [57, "QTY SELISIH"], [58, "SATUAN"]].forEach(([i, v]) => { H[i] = v; });
  const r = Array(70).fill(""); r[1] = "BUSA OCEAN"; r[2] = "LEMBAR"; r[3] = "MATERIAL"; r[47] = "40"; r[49] = "LEMBAR"; r[54] = "14"; r[55] = "26";
  const mats2 = [M("o", "OCEAN", "BUSA OCEAN", "SHEET"), M("z", "ZZ", "ZZ", "PCS")];
  const led = new Map([["o", [mv("o1", -3, "2026-09-05T00:00:00Z")]], ["z", [mv("z1", 5, "2026-09-05T00:00:00Z")]]]);
  const cat = rekonsiliasiCatatan({ pemetaan: petakan(bacaStockCsv(["x", H.join(","), r.join(",")].join("\n")), mats2), materials: mats2, ledger: led, pending: [{ materialCode: "OCEAN", dok: "GR-OCEAN", status: "SCHEDULED" }] });
  const k = kesiapanPencatatanBaru({ catatan: cat, riwayat: { bahan: [] }, materials: mats2, ledger: led, pending: [{ materialCode: "OCEAN", dok: "GR-OCEAN", status: "SCHEDULED" }] });
  const o = k.bahan.find((x) => x.kode === "OCEAN"); assert.equal(o.kesiapan, KESIAPAN.TAHAN_CEK_FISIK_P1); assert.equal(o.cekFisikMendesakP1, true); assert.equal(o.dokumenTertunda, true); assert.match(o.alasan, /keputusan GR TETAP dibutuhkan/);
  assert.match(k.bahan.find((x) => x.kode === "ZZ").alasan, /BUKAN bukti jumlah tersedia/);
});

test("kesiapan: penahan HANYA per bahan/dokumen terkait — P1, konflik satuan, GR tertunda satu bahan tidak mengubah bahan lain yang valid; tidak ada blokir global", async () => {
  const { petakan, bacaStockCsv } = await import("../src/services/stokFileImport.js");
  const H = Array(70).fill(""); [[0, "KODE BANG"], [1, "NAMA BARANG"], [2, "SATUAN"], [3, "JENIS"], [4, "BARANG"], [5, "VENDOR"], [43, "HARGA ACT"], [44, "MASUK"], [45, "KELUAR"], [46, "SISA"], [47, "QTY SEP"], [48, "QTY Selisih"], [49, "SATUAN"], [52, "HARGA ACT"], [53, "MASUK"], [54, "KELUAR"], [55, "SISA"], [56, "QTY OKT"], [57, "QTY SELISIH"], [58, "SATUAN"]].forEach(([i, v]) => { H[i] = v; });
  const r = Array(70).fill(""); r[1] = "BUSA OCEAN"; r[2] = "LEMBAR"; r[3] = "MATERIAL"; r[47] = "40"; r[49] = "LEMBAR"; r[54] = "14"; r[55] = "26";
  const pend = [{ materialCode: "OCEAN", dok: "GR-OCEAN", status: "SCHEDULED" }];
  const semua = [M("o", "OCEAN", "BUSA OCEAN", "SHEET"), M("z", "ZZ", "ZZ", "PCS"), M("y", "YY", "YY", "PCS")];
  const led = new Map([["o", [mv("o1", -3, "2026-09-05T00:00:00Z")]], ["z", [mv("z1", 5, "2026-09-05T00:00:00Z")]], ["y", [mv("y1", 9, "2026-09-05T00:00:00Z")]]]);
  const hitung = (mats, p) => { const cat = rekonsiliasiCatatan({ pemetaan: petakan(bacaStockCsv(["x", H.join(","), r.join(",")].join("\n")), mats), materials: mats, ledger: led, pending: p }); return kesiapanPencatatanBaru({ catatan: cat, riwayat: { bahan: [] }, materials: mats, ledger: led, pending: p }); };
  const penuh = hitung(semua, pend); const tanpaOcean = hitung(semua.filter((m) => m.id !== "o"), []);
  const o = penuh.bahan.find((x) => x.kode === "OCEAN"); assert.equal(o.kesiapan, KESIAPAN.TAHAN_CEK_FISIK_P1); assert.equal(o.ruangPenahan, RUANG_PENAHAN.BAHAN_INI); assert.deepEqual(o.dokumenTerkait, ["GR-OCEAN"]);
  for (const kode of ["ZZ", "YY"]) {
    const a = penuh.bahan.find((x) => x.kode === kode); const b = tanpaOcean.bahan.find((x) => x.kode === kode);
    assert.equal(a.kesiapan, KESIAPAN.SIAP, kode + " tidak ikut tertahan"); assert.equal(a.ruangPenahan, RUANG_PENAHAN.TIDAK_ADA); assert.deepEqual(a.dokumenTerkait, []);
    assert.deepEqual(a, b, kode + " identik ada/tidaknya bahan P1 + GR tertunda lain");
  }
  assert.match(penuh.catatanRuang, /per bahan\/dokumen terkait saja/); assert.match(penuh.catatanRuang, /alur koreksi stok, bukan transaksi rutin/);
  assert.ok(!("globalTahan" in penuh) && !penuh.bahan.some((x) => x.ruangPenahan !== RUANG_PENAHAN.BAHAN_INI && x.kesiapan.startsWith("TAHAN_")), "tidak ada blokir global");
});
