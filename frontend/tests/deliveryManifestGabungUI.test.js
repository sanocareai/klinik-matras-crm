// Manifest Delivery (stop ≠ unit ≠ jenis produk) + "Gabungkan Order Duplikat" + baris CRM PKR yang rapi — logika murni & kontrak UI statis.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { manifestOf, angkaManifest, ringkasManifest, teksBaris, produkRingkasKartu, penjualPkrOf, teksLengkap } from "../src/features/armada/manifest.js";
import { rapikanUkuran, ringkasIndukTeks, kelompokProduk, produkUtamaTeks, ukuranUtamaTeks, statusTerpisah } from "../src/features/orders/pkrUnitLogic.js";

const baca = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

const job = {
  id: "j1", type: "DELIVERY", status: "ASSIGNED",
  manifest: {
    stop: 1, unit: 3, jenisProduk: 1, ringkas: "1 stop • 3 unit • 1 jenis produk",
    baris: [{ qty: 3, nama: "Kasur Sorong 3in1 Custom", ukuran: "100 × 200 cm", spesifikasi: null, unitLabel: ["U1", "U2", "U3"], unit: [{ label: "U1" }, { label: "U2" }, { label: "U3" }] }],
    sumber: { jenis: "PENJUALAN_KARYAWAN", penjual: "Kemal", label: "Penjualan Karyawan — dijual oleh Kemal" },
    muat: { dimuat: 0, total: 3, lengkap: false, label: "Barang dimuat 0/3 unit" },
  },
};

test("manifest: stop, unit, dan jenis produk adalah TIGA angka terpisah — '1 stop' bukan jumlah barang", () => {
  assert.deepEqual(angkaManifest(job), { stop: 1, unit: 3, jenisProduk: 1 });
  assert.equal(ringkasManifest(job), "1 stop • 3 unit • 1 jenis produk");
  assert.equal(teksBaris(job.manifest.baris[0]), "3× Kasur Sorong 3in1 Custom — 100 × 200 cm");
  assert.equal(produkRingkasKartu(job), "3× Kasur Sorong 3in1 Custom — 100 × 200 cm");
  assert.equal(penjualPkrOf(job), "Kemal");
  assert.equal(angkaManifest({}), null);
  assert.equal(manifestOf(null), null);
});

test("manifest: salinan teks lengkap memuat Unit ID dan sumber; tanpa harga", () => {
  const t = teksLengkap(job).join("\n");
  assert.match(t, /1 stop • 3 unit • 1 jenis produk/);
  assert.match(t, /Unit: U1, U2, U3/);
  assert.match(t, /Sumber: Penjualan Karyawan — dijual oleh Kemal/);
  assert.doesNotMatch(t, /Rp|harga|nominal/i);
});

test("baris CRM PKR: ringkasan satu baris, produk utama & ukuran dari unit nyata, status Produksi ≠ Delivery", () => {
  const u = (n, produksi) => ({ id: `u${n}`, item: { no: 1, nama: "Kasur Sorong 3in1 Custom" }, ukuran: "100 x 200", produksi: { kode: produksi } });
  const pkr = { unitBaris: [u(1, "READY_FOR_DELIVERY"), u(2, "READY_FOR_DELIVERY"), u(3, "READY_FOR_DELIVERY")], ringkasUnit: { total: 3, siap: 3, terkirim: 0 } };
  assert.equal(ringkasIndukTeks(pkr), "1 item • 3 unit • 3 siap • 0 terkirim");
  assert.equal(produkUtamaTeks(pkr), "3× Kasur Sorong 3in1 Custom");
  assert.equal(ukuranUtamaTeks(pkr), "100 × 200 cm");
  assert.equal(kelompokProduk(pkr).length, 1);
  const s = statusTerpisah(pkr);
  assert.equal(s.produksi, "Produksi 3/3 selesai");
  assert.equal(s.delivery, "Delivery 0/3 terkirim");
  assert.equal(ringkasIndukTeks({ ringkasUnit: { total: 0 } }), null);
  assert.equal(rapikanUkuran("160x200"), "160 × 200 cm");
  assert.equal(rapikanUkuran("Custom ±"), "Custom ±");
});

test("ukuran beragam → 'Beragam (lihat unit)'; produk >2 jenis diringkas", () => {
  const u = (n, nama, ukuran) => ({ id: `u${n}`, item: { no: n, nama }, ukuran });
  const pkr = { unitBaris: [u(1, "Kasur", "100 x 200"), u(2, "Divan", "160 x 200"), u(3, "Sandaran", "160 x 100")], ringkasUnit: { total: 3 } };
  assert.equal(ukuranUtamaTeks(pkr), "Beragam (lihat unit)");
  assert.equal(produkUtamaTeks(pkr), "1× Kasur; 1× Divan +1 jenis lain");
});

test("Orders.jsx: sel identitas PKR memakai chip (bukan dropdown yang menimpa foto/nama), unit hanya sekali di bagian diperluas", () => {
  const src = baca("pages/Orders.jsx");
  assert.match(src, /<SumberPkr pkr=\{o\.penjualanKaryawan\} mode="chip"/);
  assert.match(src, /produk-utama-pkr/);
  assert.match(src, /ukuran-utama-pkr/);
  assert.match(src, /status-terpisah-pkr/);
  const chip = baca("features/orders/SumberPkr.jsx");
  assert.match(chip, /Penjualan Karyawan · \{m\.ringkas\}/);
  const sub = baca("features/orders/PkrUnitBaris.jsx");
  assert.match(sub, /PanelIdentitasPkr/);
});

test("Gabungkan Order Duplikat: hanya Admin, alasan ≥5, Idempotency-Key, revisi pratinjau, tanpa tombol hapus", () => {
  const dlg = baca("features/orders/GabungOrderDialog.jsx");
  assert.match(dlg, /alasan\.trim\(\)\.length < 5/);
  assert.match(dlg, /sidikJari: pra\.sidikJari/);
  assert.match(dlg, /gabungkanOrder\(/);
  assert.match(dlg, /bolehDigabung/);
  assert.match(dlg, /DUA_JOB_AKTIF|hambatan/);
  assert.doesNotMatch(dlg, /deleteOrder|hapusOrder|method: "DELETE"/);
  const api = baca("api.js");
  assert.match(api, /gabungkanOrder: \(data, idempotencyKey\) => request\("\/orders\/gabung", \{ method: "POST", headers: \{ "Idempotency-Key"/);
  const drawer = baca("features/orders/OrderTimelineDrawer.jsx");
  assert.match(drawer, /isAdminUser/);
  assert.doesNotMatch(drawer, /user\.role === "ADMIN"/);
  assert.match(drawer, /Order ini telah digabungkan ke/);
  assert.match(drawer, /Histori dari order lama/);
  assert.match(drawer, /!o\.digabungKe/);
});

test("Driver App web: manifest + checklist muat + pengecualian resmi dikirim ke complete; checklist persiapan menampilkan manifest tiap stop", () => {
  const drv = baca("pages/DriverJobs.jsx");
  assert.match(drv, /<ManifestBlock job=\{job\}/);
  assert.match(drv, /<MuatBarangPanel job=\{job\}/);
  assert.match(drv, /pengecualianUnit: \{ alasan: alasanPengecualian\.trim\(\) \}/);
  assert.match(drv, /jobs=\{jobs\}/);
  const sub = baca("utils/submitJobAction.js");
  assert.match(sub, /payload\.pengecualianUnit && \{ pengecualianUnit: payload\.pengecualianUnit \}/);
  assert.match(baca("features/armada/components/RoutePrepChecklistDriverPanel.jsx"), /<ManifestRute jobs=\{jobs\}/);
  assert.match(baca("features/armada/components/RoutePrepChecklistAdminModal.jsx"), /<ManifestRute jobs=\{route\.jobs\}/);
  const muat = baca("features/armada/components/MuatBarangPanel.jsx");
  assert.match(muat, /konfirmasiMuatUnit\(job\.id, \{ semua: true \}\)/);
  // manifest tidak boleh memuat harga di layar driver
  assert.doesNotMatch(baca("features/armada/components/ManifestBlock.jsx"), /formatRupiah|\.price\b|\.harga\b|\.value\b/);
});
