// Logika murni representasi multi-unit Order CRM Penjualan Karyawan (features/orders/pkrUnitLogic.js) + kontrak UI statis.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  UNIT_STATUS_OPSI, tanggalPendekIso, unitBarisOrder, punyaUnitPkr, ringkasUnitTeks, rencanaUnitTeks, ukuranSpesifikasiTeks, varianDeliveryUnit, labelUnit,
} from "../src/features/orders/pkrUnitLogic.js";

const unit = (n, ex = {}) => ({ id: `u${n}`, kode: `NEW-11102026-023-U${n}`, urutanLabel: `${n} dari 3`, item: { nama: "Kasur Sorong 3in1 custom" }, ukuran: "100 x 200", spesifikasi: null, rencana: null, ...ex });
const order3 = { id: "o1", penjualanKaryawan: { unitBaris: [unit(1), unit(2), unit(3)], ringkasUnit: { total: 3, dijadwalkan: 0, sedangDiproduksi: 0, siap: 3, dalamPengiriman: 0, terkirim: 0 } } };

test("ringkasan induk: '3 Unit Produksi · Dijadwalkan 0/3 · Sedang diproduksi 0/3 · Siap 3/3 · Terkirim 0/3'", () => {
  assert.deepEqual(ringkasUnitTeks(order3.penjualanKaryawan.ringkasUnit), ["3 Unit Produksi", "Dijadwalkan 0/3", "Sedang diproduksi 0/3", "Siap 3/3", "Terkirim 0/3"]);
  assert.deepEqual(ringkasUnitTeks(null), []);
  assert.ok(ringkasUnitTeks({ total: 3, dalamPengiriman: 1, terkirim: 0 }).includes("Dalam pengiriman 1/3"));
});

test("unit hanya ada untuk order PKR; order biasa tanpa penjualanKaryawan tidak punya sub-baris", () => {
  assert.equal(unitBarisOrder(order3).length, 3);
  assert.equal(punyaUnitPkr(order3), true);
  assert.equal(punyaUnitPkr({ id: "x" }), false);
  assert.deepEqual(unitBarisOrder(null), []);
});

test("teks rencana & PIC, ukuran/spesifikasi, tanggal pendek", () => {
  assert.equal(rencanaUnitTeks(null), "Belum dijadwalkan");
  assert.equal(rencanaUnitTeks({ target: "2026-10-14", pic: "Budi" }), "Target 14 Okt · PIC Budi");
  assert.equal(rencanaUnitTeks({ tanggalProduksi: "2026-10-13", pic: null, stasiun: "TABLE_2" }), "Target 13 Okt · Meja TABLE_2");
  assert.equal(rencanaUnitTeks({}), "Belum dijadwalkan");
  assert.equal(ukuranSpesifikasiTeks({ ukuran: "100 x 200", spesifikasi: "Kain abu" }), "100 x 200 · Kain abu");
  assert.equal(ukuranSpesifikasiTeks({}), "Belum dilengkapi");
  assert.equal(tanggalPendekIso("2026-12-01"), "1 Des");
  assert.equal(tanggalPendekIso("bukan"), null);
});

test("varian delivery & label aksesibel & opsi status unit", () => {
  assert.equal(varianDeliveryUnit("COMPLETED"), "green");
  assert.equal(varianDeliveryUnit("ASSIGNED"), "accent");
  assert.equal(varianDeliveryUnit("BELUM_ADA_JOB"), "orange");
  assert.equal(varianDeliveryUnit("AMBIL_SENDIRI"), "neutral");
  assert.match(labelUnit(unit(2)), /Buka Unit 360 NEW-11102026-023-U2, Kasur Sorong 3in1 custom, 2 dari 3/);
  assert.ok(UNIT_STATUS_OPSI.every((o) => o.value && o.label));
});

test("UI statis: Orders.jsx memasang sub-baris tabel, daftar kartu, filter status unit, Unit 360 ?unit=; drawer memuat daftar unit", () => {
  const orders = readFileSync(new URL("../src/pages/Orders.jsx", import.meta.url), "utf8");
  assert.match(orders, /SubBarisUnitPkr/);
  assert.match(orders, /DaftarUnitPkr/);
  assert.match(orders, /unitStatus: fStatusUnit \|\| undefined/);
  assert.match(orders, /useOpenParam\("unit"\)/);
  assert.match(orders, /<UnitOverviewDrawer unitId=\{unitId\}/);
  assert.match(orders, /Cari ID, unit, PKR, nama, HP/);
  const drawer = readFileSync(new URL("../src/features/orders/OrderTimelineDrawer.jsx", import.meta.url), "utf8");
  assert.match(drawer, /DaftarUnitPkr pkr=\{o\.penjualanKaryawan\} onBuka=\{onBukaUnit\}/);
  const komponen = readFileSync(new URL("../src/features/orders/PkrUnitBaris.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(komponen, /formatRupiah|nilaiBersih/, "sub-baris unit tidak menampilkan nominal (Finance membaca PKR satu kali)");
});
