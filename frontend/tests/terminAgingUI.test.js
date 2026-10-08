// Termin & Aging Utang Supplier — logika tampilan murni + pemasangan (tab, ekspor, indikator). Angka & kelompok dihitung SERVER; klien hanya memformat.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PILIHAN_TERMIN, nilaiPilihanTermin, daftarPilihanTermin, uraiPilihanTermin, payloadTerminSupplier, bodyTermin, galatTermin, teksJatuhTempo, teksTermin,
  NADA_INDIKATOR, TAB_AGING, TERMIN_AWAL, bolehMencatatFinance,
} from "../src/features/finance/terminLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

test("pilihan termin resmi: Tunai/COD, 7/14/30/45/60 hari, tanggal khusus; data lama di luar pilihan tetap terbaca", () => {
  assert.deepEqual(PILIHAN_TERMIN.map((p) => p.label), ["Belum diatur", "Tunai/COD", "7 hari", "14 hari", "30 hari", "45 hari", "60 hari", "Tanggal khusus"]);
  assert.equal(nilaiPilihanTermin("HARI", 30), "HARI:30");
  assert.equal(nilaiPilihanTermin(null, 30), "HARI:30", "data lama: hanya hari");
  assert.equal(nilaiPilihanTermin(null, 21), "LAMA:21");
  assert.ok(daftarPilihanTermin("LAMA:21").some((p) => p.label === "21 hari (data lama)"));
  assert.equal(nilaiPilihanTermin(null, null), "");
  assert.deepEqual(uraiPilihanTermin("HARI:45"), { jenis: "HARI", hari: 45 });
  assert.deepEqual(payloadTerminSupplier("TUNAI"), { paymentTermType: "TUNAI", paymentTermDays: null });
  assert.deepEqual(payloadTerminSupplier("HARI:14"), { paymentTermType: "HARI", paymentTermDays: 14 });
  assert.deepEqual(payloadTerminSupplier(""), { paymentTermType: null, paymentTermDays: null });
});

test("body termin: tanpa ganti hanya tanggal yang diketik; ganti = jenis/hari + alasan; tanggal khusus membawa tanggal; galat lokal", () => {
  assert.deepEqual(bodyTermin(TERMIN_AWAL), {});
  assert.deepEqual(bodyTermin({ ...TERMIN_AWAL, dueDate: "2026-11-02" }), { dueDate: "2026-11-02" });
  assert.deepEqual(bodyTermin({ ganti: true, pilihan: "HARI:14", dueDate: "", alasan: " Nego " }), { terminJenis: "HARI", terminHari: 14, alasanTermin: "Nego" });
  assert.deepEqual(bodyTermin({ ganti: true, pilihan: "TANGGAL_KHUSUS", dueDate: "2026-12-01", alasan: "Kontrak" }), { terminJenis: "TANGGAL_KHUSUS", dueDate: "2026-12-01", alasanTermin: "Kontrak" });
  assert.match(galatTermin({ ganti: true, pilihan: "HARI:14", dueDate: "", alasan: "" }), /Alasan/);
  assert.match(galatTermin({ ganti: true, pilihan: "TANGGAL_KHUSUS", dueDate: "", alasan: "x" }), /tanggal/i);
  assert.equal(galatTermin(TERMIN_AWAL), null);
});

test("teks jatuh tempo & termin jujur: terlambat, hari ini, lagi, belum diisi (tidak ditebak), lunas; indikator warna sesuai kontrak", () => {
  assert.equal(teksJatuhTempo({ statusPembayaran: "TERLAMBAT", hariKeJatuhTempo: -3 }), "Terlambat 3 hari");
  assert.equal(teksJatuhTempo({ statusPembayaran: "JATUH_TEMPO_HARI_INI", hariKeJatuhTempo: 0 }), "Hari ini");
  assert.equal(teksJatuhTempo({ statusPembayaran: "BELUM_JATUH_TEMPO", hariKeJatuhTempo: 12 }), "12 hari lagi");
  assert.equal(teksJatuhTempo({ statusPembayaran: "TANPA_JATUH_TEMPO", hariKeJatuhTempo: null }), "Belum diisi");
  assert.equal(teksJatuhTempo({ statusPembayaran: "LUNAS", hariKeJatuhTempo: -9 }), "Lunas");
  assert.equal(teksTermin({ label: null }), "Belum ditetapkan");
  assert.equal(teksTermin({ label: "30 hari", sumber: "OVERRIDE_FAKTUR" }), "30 hari · diganti pada faktur");
  assert.deepEqual(["merah", "jingga", "biru", "netral", "hijau"].map((k) => NADA_INDIKATOR[k].variant), ["red", "orange", "accent", "neutral", "green"]);
  assert.deepEqual(TAB_AGING.map((t) => t.kunci), ["AKTIF", "TERLAMBAT", "HARI_INI", "H1_7", "H8_14", "H15_30", "LEBIH_30", "DIBAYAR_SEBAGIAN", "TANPA_JATUH_TEMPO", "LUNAS"]);
});

test("izin cermin klien: hanya peran pencatat Finance yang boleh mengatur jadwal; Gudang/Produksi/Sales tidak", () => {
  assert.equal(bolehMencatatFinance({ roles: ["FINANCE"] }), true);
  assert.equal(bolehMencatatFinance({ role: "ADMIN" }), true);
  for (const r of ["WAREHOUSE", "PRODUCTION_LEAD", "SALES", "APPROVER"]) assert.equal(bolehMencatatFinance({ roles: [r] }), false);
});

test("pemasangan: tab Jadwal & Aging di Supplier & Utang, export aging-utang, pembayaran supplier membawa Idempotency-Key, tiga status terpisah, form memakai termin server", () => {
  const sup = baca("../src/pages/finance/FinanceSuppliers.jsx");
  assert.match(sup, /key: "aging", label: "Jadwal & Aging"/);
  assert.match(sup, /<JadwalAgingUtang /);
  assert.match(sup, /<TerminFaktur /);
  assert.match(sup, /createFinanceSupplierPayment\(d, kunci\)/);
  const aging = baca("../src/features/finance/JadwalAgingUtang.jsx");
  assert.match(aging, /modul="aging-utang"/);
  assert.match(aging, /Barang: /); assert.match(aging, /Faktur: /); assert.match(aging, /Bayar: /);
  assert.doesNotMatch(aging, /api\.createFinanceSupplierPayment/, "layar jadwal tidak membayar");
  const api = baca("../src/api.js");
  assert.match(api, /createFinanceSupplierPayment: \(data, idempotencyKey = mutationKey\("sp"\)\)/);
  assert.match(api, /getAgingUtang:/);
  // Gudang & Produksi tidak melihat utang: halaman penerimaan Gudang tidak memanggil API utang
  for (const f of ["../src/features/warehouse/components/GoodsReceiptDetailDrawer.jsx", "../src/features/warehouse/components/JejakPemakaianPenerimaan.jsx"]) assert.doesNotMatch(baca(f), /Aging|getAgingUtang|utang/i);
});
