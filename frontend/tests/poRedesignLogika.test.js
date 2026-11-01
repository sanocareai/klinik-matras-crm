// Redesain Pesanan Pembelian (PO): logika tampilan murni + kesetaraan payload/angka dengan perilaku lama. Tanpa React/DOM.
// Yang dikunci: (1) angka & populasi KPI tidak berubah, (2) satuan berbeda TIDAK dijumlahkan, (3) izin per peran/status, (4) payload ke server identik.
import test from "node:test";
import assert from "node:assert/strict";
import {
  izinPO, aksiRincian, kpiPO, kalimatCakupan, kalimatHasil, ringkasPenerimaan, angkaBaris, statusTampil, langkahBerikut,
  TAB_PO_TAMPIL, keteranganTermin, DAMPAK_HARGA_SINGKAT, DAMPAK_HARGA_RINCI, ALUR_PEMBELIAN,
} from "../src/features/finance/po/poTampilan.js";
import fs from "node:fs";
import { galatTermin, bodyTermin, TERMIN_AWAL } from "../src/features/finance/terminLogic.js";
import {
  TAB_PO, STATUS_PO, baris0, subtotal, totalIsian, galatBaris, galatFormulir, bodyDariForm, aksiPO, nilaiBelumDiterima, ringkasProgres,
} from "../src/features/finance/purchaseOrderLogic.js";

const progres = (o = {}) => ({ dipesan: 0, datang: 0, masukStok: 0, belumMasukStok: 0, belumDatang: 0, menungguPengganti: 0, diretur: 0, diterimaBersih: 0, ditolak: 0, ...o });
const po = (o = {}) => ({ id: "x", poNumber: "PO-1", status: "DISETUJUI", totalBelumMasukStok: 0, lines: [], progres: null, ...o });

test("tab status: semua nilai ke server sama dengan daftar lama (tidak ada status yang hilang)", () => {
  assert.deepEqual(TAB_PO_TAMPIL.map((t) => t.key), TAB_PO.map((t) => t.key));
  for (const s of Object.keys(STATUS_PO)) assert.ok(statusTampil(s).label, s);
});

test("KPI: rumus & populasi lama — berjalan = Disetujui + Diterima Sebagian; nilai belum masuk stok hanya PO berjalan; draf dihitung terpisah", () => {
  const daftar = [
    po({ status: "DISETUJUI", totalBelumMasukStok: 1000 }), po({ status: "DITERIMA_SEBAGIAN", totalBelumMasukStok: 250 }),
    po({ status: "DRAFT", totalBelumMasukStok: 9999 }), po({ status: "SELESAI", totalBelumMasukStok: 0 }), po({ status: "DIBATALKAN", totalBelumMasukStok: 777 }),
  ];
  assert.deepEqual(kpiPO(daftar), { berjalan: 2, draf: 1, nilaiBelumMasukStok: 1250 });
  assert.equal(kpiPO(daftar).nilaiBelumMasukStok, daftar.reduce((s, p) => s + nilaiBelumDiterima(p), 0), "sama dengan fungsi lama");
  assert.deepEqual(kpiPO([]), { berjalan: 0, draf: 0, nilaiBelumMasukStok: 0 });
});

test("cakupan angka jujur: menyebut saringan aktif dan batas 300 PO terbaru", () => {
  assert.match(kalimatCakupan({ tab: "", q: "", jumlah: 5 }), /maksimal 300 PO terbaru, jadi ini bukan total seluruh PO/);
  assert.doesNotMatch(kalimatCakupan({ tab: "", q: "", jumlah: 5 }), /Batas sudah tercapai/);
  assert.match(kalimatCakupan({ tab: "DRAFT", q: "", jumlah: 5 }), /tahap Draf/);
  assert.match(kalimatCakupan({ tab: "", q: " sinar ", jumlah: 5 }), /pencarian “sinar”/);
  assert.match(kalimatCakupan({ tab: "", q: "", jumlah: 300 }), /Batas sudah tercapai/);
  assert.match(kalimatHasil({ jumlah: 0, tab: "", q: "" }), /Belum ada PO/);
  assert.match(kalimatHasil({ jumlah: 0, tab: "SELESAI", q: "" }), /Tidak ada PO yang cocok/);
  assert.match(kalimatHasil({ jumlah: 12, tab: "", q: "" }), /^Menampilkan 12 PO$/);
});

test("penerimaan satu satuan: jumlah aktual + satuan, persentase dari server; 'masuk stok' tidak diberi label 'diterima'", () => {
  const p = po({
    lines: [{ satuan: "KG" }],
    progres: { satuan: "KG", dijumlah: true, persenMasukStok: 44, total: progres({ dipesan: 224.79, datang: 130.5, ditolak: 2.25, masukStok: 98.25, belumMasukStok: 126.54 }) },
  });
  const r = ringkasPenerimaan(p);
  assert.equal(r.jenis, "satuan");
  assert.equal(r.judul, "98,25 / 224,79 kg masuk stok");
  assert.match(r.sub, /tiba 130,5/); assert.match(r.sub, /ditolak 2,25/);
  assert.equal(r.persen, 44);
  assert.doesNotMatch(r.judul + r.sub, /diterima/i, "tahap masuk stok dan tahap diterima tidak disamakan");
});

test("penerimaan satuan CAMPURAN: tidak dijumlah; hitung baris yang masuk stok penuh; satu segmen per baris", () => {
  const p = po({
    status: "DITERIMA_SEBAGIAN",
    lines: [
      { satuan: "METER", kode: "A", dipesan: 25, progres: progres({ dipesan: 25, masukStok: 25, belumMasukStok: 0 }) },
      { satuan: "SHEET", kode: "B", dipesan: 10, progres: progres({ dipesan: 10, masukStok: 4, belumMasukStok: 6 }) },
      { satuan: "PCS", kode: "C", dipesan: 500, progres: progres({ dipesan: 500, masukStok: 0, belumMasukStok: 500 }) },
    ],
    progres: { satuan: null, dijumlah: false, total: null, persenMasukStok: 40 },
  });
  const r = ringkasPenerimaan(p);
  assert.equal(r.jenis, "campuran");
  assert.equal(r.judul, "1 dari 3 baris masuk stok penuh");
  assert.match(r.sub, /tidak dijumlahkan/);
  assert.deepEqual(r.segmen.map((s) => Math.round(s.frac * 100)), [100, 40, 0]);
  assert.deepEqual(r.segmen.map((s) => s.penuh), [true, false, false]);
  assert.equal(r.persen, null, "tidak ada satu persentase kuantitas untuk satuan campuran");
});

test("draf & dibatalkan: tidak menampilkan progres seolah ada penerimaan", () => {
  assert.equal(ringkasPenerimaan(po({ status: "DRAFT", lines: [{ satuan: "KG" }] })).jenis, "draf");
  assert.equal(ringkasPenerimaan(po({ status: "DIBATALKAN", lines: [{ satuan: "KG" }] })).jenis, "batal");
  assert.equal(ringkasPenerimaan(po({ status: "DISETUJUI", lines: [] })).jenis, "kosong");
});

test("angka baris di Rincian: lima angka dibedakan dan dibaca dari progres server (bukan dihitung ulang)", () => {
  const a = angkaBaris({ dipesan: 10, ditagih: 3, progres: progres({ dipesan: 10, datang: 9, masukStok: 6, belumMasukStok: 4, belumDatang: 1, menungguPengganti: 2, diretur: 1, diterimaBersih: 5 }) });
  assert.deepEqual([a.dipesan, a.sudahDatang, a.masukStok, a.belumMasukStok], [10, 9, 6, 4]);
  assert.deepEqual([a.belumDatang, a.menungguPengganti, a.diretur, a.diterimaBersih, a.ditagih], [1, 2, 1, 5, 3]);
  assert.notEqual(a.sudahDatang, a.masukStok, "datang (fisik) berbeda dari masuk stok");
});

test("izin per peran mengikuti server: FINANCE tidak admin; APPROVER tidak mencatat; ACCOUNTANT tidak menyetujui; ADMIN/OWNER semuanya", () => {
  const f = izinPO({ roles: ["FINANCE"] }), ap = izinPO({ roles: ["APPROVER"] }), ak = izinPO({ roles: ["ACCOUNTANT"] }), ow = izinPO({ roles: ["OWNER", "ADMIN"] }), sales = izinPO({ roles: ["SALES"] });
  assert.deepEqual(f, { catat: true, setujui: true, admin: false });
  assert.deepEqual(ap, { catat: false, setujui: true, admin: false });
  assert.deepEqual(ak, { catat: true, setujui: false, admin: false });
  assert.deepEqual(ow, { catat: true, setujui: true, admin: true });
  assert.deepEqual(sales, { catat: false, setujui: false, admin: false });
  assert.deepEqual(izinPO(null), { catat: false, setujui: false, admin: false });
  assert.deepEqual(izinPO({ role: "FINANCE" }), f, "bentuk lama {role} tetap dikenali");
});

test("tindakan Rincian: aturan status SAMA dengan aksiPO lama; izin hanya menonaktifkan (tidak menyembunyikan tanpa alasan)", () => {
  const izinF = izinPO({ roles: ["FINANCE"] }), izinAdmin = izinPO({ roles: ["ADMIN"] });
  for (const status of Object.keys(STATUS_PO)) {
    const lama = aksiPO({ status }); const baru = aksiRincian({ status }, izinAdmin);
    assert.equal(baru.ubah.tampil, lama.ubah, `ubah ${status}`); assert.equal(baru.setujui.tampil, lama.setujui, `setujui ${status}`);
    assert.equal(baru.revisi.tampil, lama.revisi, `revisi ${status}`);
    assert.equal(baru.batalkan.tampil, lama.batalkan, `batalkan ${status}`);
  }
  assert.equal(aksiRincian({ status: "DISETUJUI" }, izinF).batalkan.aktif, false, "batal PO disetujui butuh admin");
  assert.match(aksiRincian({ status: "DISETUJUI" }, izinF).batalkan.alasan, /Admin Keuangan/);
  assert.equal(aksiRincian({ status: "DRAFT" }, izinF).batalkan.aktif, true, "batal draf cukup finance:post");
  assert.equal(aksiRincian({ status: "DRAFT" }, izinPO({ roles: ["ACCOUNTANT"] })).setujui.aktif, false);
  assert.equal(aksiRincian({ status: "DITERIMA_SEBAGIAN" }, izinPO({ roles: ["APPROVER"] })).revisi.aktif, true);
  assert.equal(aksiRincian({ status: "SELESAI" }, izinF).faktur.tampil, true, "faktur tetap bisa dicatat setelah selesai");
  assert.equal(aksiRincian({ status: "DRAFT" }, izinF).faktur.tampil, false);
  assert.equal(aksiRincian({ status: "DIBATALKAN" }, izinAdmin).faktur.tampil, false);
});

test("status 'Selesai' tidak menyiratkan lunas; status berikutnya dijelaskan", () => {
  assert.match(statusTampil("SELESAI").arti, /tidak berarti faktur sudah dibayar/);
  assert.match(langkahBerikut({ status: "SELESAI" }), /faktur/i);
  assert.match(statusTampil("DISETUJUI").arti, /komitmen/);
});

test("Harga Berlaku: kalimat dampak sesuai perilaku aktual — termasuk saat DRAF; bukan 'hanya draf'", () => {
  assert.match(DAMPAK_HARGA_SINGKAT, /termasuk sebagai draf/);
  assert.match(DAMPAK_HARGA_SINGKAT, /HPP operasional, bukan jurnal atau nilai persediaan Finance/);
  assert.match(DAMPAK_HARGA_SINGKAT, /Membatalkan PO tidak mengembalikan harga/);
  const rinci = DAMPAK_HARGA_RINCI.join(" ");
  assert.match(rinci, /tanpa tanggal mundur/); assert.match(rinci, /tidak menulis harga/); assert.match(rinci, /tidak menambah stok/i);
  assert.match(rinci, /tidak mengembalikan harga/);
  assert.doesNotMatch(DAMPAK_HARGA_SINGKAT + rinci, /hanya draf/i);
  assert.match(ALUR_PEMBELIAN[0].isi, /Harga Berlaku/);
});

test("subtotal, total, dan payload: sama dengan perilaku lama (desimal jumlah 3 angka, rupiah bulat, konversi, pendamping)", () => {
  const l1 = { ...baris0(), materialId: "m1", qty: "10", unitPrice: "125000" };
  const l2 = { ...baris0(), materialId: "m2", qty: "3.5", unitPrice: "450000" };
  assert.equal(subtotal(l1), 1250000); assert.equal(subtotal(l2), 1575000); assert.equal(totalIsian([l1, l2]), 2825000);
  assert.equal(subtotal({ qty: "0.001", unitPrice: "3" }), 0); // pembulatan 2 desimal seperti lama
  assert.equal(subtotal({ qty: "", unitPrice: "x" }), 0);
  const f = { supplierId: "s1", orderDate: "2026-11-01", expectedDate: "", notes: " catatan ", lines: [l1, { ...l2, satuanBeli: "BOX", faktorKonversi: "12", pendamping: { satuan: "LEMBAR", mode: "AKTUAL", rasio: "", estimasi: "2" } }] };
  assert.deepEqual(bodyDariForm(f), {
    supplierId: "s1", orderDate: "2026-11-01", expectedDate: null, notes: "catatan",
    lines: [
      { materialId: "m1", qty: 10, unitPrice: 125000 },
      { materialId: "m2", qty: 3.5, unitPrice: 450000, pendamping: { satuan: "LEMBAR", mode: "AKTUAL", estimasi: 2 }, satuanBeli: "BOX", faktorKonversi: 12 },
    ],
  });
});

test("validasi tidak berubah: pesan & aturan sama (jumlah 3 desimal, harga rupiah bulat, baris ganda, estimasi sebelum tanggal PO)", () => {
  assert.match(galatBaris({ ...baris0(), materialId: "m", qty: "1.2345", unitPrice: "100" }), /3 angka/);
  assert.match(galatBaris({ ...baris0(), materialId: "m", qty: "1", unitPrice: "100.5" }), /rupiah bulat/);
  assert.match(galatBaris({ ...baris0(), materialId: "", qty: "1", unitPrice: "100" }), /Pilih item/);
  const l = { ...baris0(), materialId: "m", qty: "1", unitPrice: "100" };
  assert.match(galatFormulir({ supplierId: "s", orderDate: "2026-11-02", expectedDate: "2026-11-01", notes: "", lines: [l] }), /Estimasi/);
  assert.match(galatFormulir({ supplierId: "s", orderDate: "2026-11-01", expectedDate: "", notes: "", lines: [l, { ...l }] }), /Baris 2.*sudah ada/);
  assert.equal(galatFormulir({ supplierId: "s", orderDate: "2026-11-01", expectedDate: "", notes: "", lines: [l] }), null);
});

test("ringkasProgres lama tetap tersedia dan konsisten dengan persentase server", () => {
  assert.deepEqual(ringkasProgres({ progres: { teks: "x", persenMasukStok: 12 } }), { teks: "x", persen: 12 });
});

test("termin & jatuh tempo: PO tidak punya tanggal jatuh tempo — dijelaskan di mana tanggalnya ditentukan (bukan 'perkiraan datang')", () => {
  assert.match(keteranganTermin(null), /diisi saat faktur dicatat/);
  assert.match(keteranganTermin({ jenis: "TANGGAL_KHUSUS" }), /diisi saat faktur dicatat/);
  assert.match(keteranganTermin({ jenis: "HARI", hari: 30 }), /per penerimaan, dari tanggal barang tiba/);
  assert.match(keteranganTermin({ jenis: "HARI", hari: 30, alasan: "nego" }), /Diganti: nego/);
  for (const t of [null, { jenis: "HARI" }, { jenis: "TANGGAL_KHUSUS" }]) assert.doesNotMatch(keteranganTermin(t), /perkiraan datang/i);
});

// ── Termin "Tanggal khusus" pada mode PO ─────────────────────────────────────────────────────────────────────────────
// Server (tentukanTerminPO) hanya menerima terminJenis/terminHari/alasanTermin untuk PO; tanggal jatuh tempo ditentukan saat FAKTUR dicatat / per penerimaan.
const tk = (o = {}) => ({ ...TERMIN_AWAL, ganti: true, pilihan: "TANGGAL_KHUSUS", alasan: "disepakati dengan supplier", ...o });

test("mode PO: Tanggal khusus TIDAK mewajibkan tanggal jatuh tempo; alasan dan pilihan termin tetap wajib", () => {
  assert.equal(galatTermin(tk(), { tanpaTanggal: true }), null, "tanpa dueDate boleh");
  assert.equal(galatTermin(tk({ dueDate: "2026-11-30" }), { tanpaTanggal: true }), null, "tanggal yang diketik tidak dipersoalkan (dibuang dari payload)");
  assert.match(galatTermin(tk({ alasan: "" }), { tanpaTanggal: true }), /Alasan mengganti termin wajib diisi/, "kewajiban alasan tidak berubah");
  assert.equal(galatTermin(tk({ pilihan: "" }), { tanpaTanggal: true }), "Pilih termin baru.", "tanpa pilihan termin tetap galat, tanpa menyarankan mengisi tanggal");
  assert.equal(galatTermin(tk({ pilihan: "HARI:30" }), { tanpaTanggal: true }), null);
  assert.equal(galatTermin({ ...TERMIN_AWAL }, { tanpaTanggal: true }), null, "tidak mengganti termin = tidak ada galat");
});

test("form faktur TIDAK berubah: Tanggal khusus tetap wajib tanggal; pesan lama utuh", () => {
  assert.equal(galatTermin(tk()), "Isi tanggal jatuh tempo untuk termin tanggal khusus.");
  assert.equal(galatTermin(tk(), { perluTanggal: true }), "Isi tanggal jatuh tempo untuk termin tanggal khusus.");
  assert.equal(galatTermin(tk({ dueDate: "2026-11-30" })), null);
  assert.equal(galatTermin(tk({ pilihan: "" })), "Pilih termin baru atau isi tanggal jatuh tempo.");
  assert.equal(galatTermin(tk({ pilihan: "" , dueDate: "2026-11-30" })), null);
  assert.match(galatTermin(tk({ alasan: "" })), /Alasan mengganti termin wajib diisi/);
  assert.equal(galatTermin(tk({ alasan: "" }), { perluTanggal: true }), "Isi tanggal jatuh tempo untuk termin tanggal khusus.", "perluTanggal: alasan tidak diwajibkan (perilaku lama)");
});

test("payload PO Tanggal khusus: terminJenis + alasanTermin saja (tanpa dueDate/terminHari); kontrak server", () => {
  const l = { ...baris0(), materialId: "m", qty: "1", unitPrice: "100" };
  const b = bodyDariForm({ supplierId: "s", orderDate: "2026-11-01", expectedDate: "", notes: "", termin: tk({ dueDate: "2026-11-30" }), lines: [l] });
  assert.equal(b.terminJenis, "TANGGAL_KHUSUS"); assert.equal(b.alasanTermin, "disepakati dengan supplier");
  assert.equal("dueDate" in b, false); assert.equal(b.terminHari, undefined);
  assert.deepEqual(bodyTermin(tk({ dueDate: "2026-11-30" })).dueDate, "2026-11-30", "bodyTermin (dipakai faktur) tetap mengirim dueDate");
});

test("pemasangan: editor PO dan TerminFaktur mode PO memakai tanpaTanggal; form faktur (RincianPO/FinanceSuppliers) tidak", () => {
  const baca = (p) => fs.readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
  assert.match(baca("features/finance/po/EditorPO.jsx"), /galatTermin\(termin, \{ tanpaTanggal: true \}\)/);
  assert.match(baca("features/finance/TerminFaktur.jsx"), /galatTermin\(value, \{ perluTanggal, tanpaTanggal: mode === "po" \}\)/);
  assert.doesNotMatch(baca("features/finance/po/RincianPO.jsx"), /tanpaTanggal/);
  assert.doesNotMatch(baca("pages/finance/FinanceSuppliers.jsx"), /tanpaTanggal/);
});
