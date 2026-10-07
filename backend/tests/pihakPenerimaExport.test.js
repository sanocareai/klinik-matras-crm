// Export Excel pembelian/pengeluaran: kolom penerima memuat supplier terdaftar DAN "dibeli dari" bila berbeda (sebelumnya payeeName hilang dari berkas bila supplier ada —
// PUR-07102026-009: YULIUS vs NELI SEUBELAN - EKA TUNGGAL). Padanan frontend: features/finance/pembelianPihak.js.
import test from "node:test";
import assert from "node:assert/strict";
import { pihakPenerima } from "../src/services/finance/export/pengeluaran.js";

test("supplier + payee berbeda → keduanya disebut", () => {
  assert.equal(pihakPenerima({ supplier: { name: "YULIUS" }, payeeName: "NELI SEUBELAN - EKA TUNGGAL" }), "YULIUS (dibeli dari: NELI SEUBELAN - EKA TUNGGAL)");
});
test("payee berkaitan dengan supplier (saling memuat, huruf besar/kecil/spasi diabaikan) → hanya supplier", () => {
  assert.equal(pihakPenerima({ supplier: { name: "YULIUS" }, payeeName: "yulius  - Toko Busa" }), "YULIUS");
  assert.equal(pihakPenerima({ supplier: { name: "PT ESA BUMINDO" }, payeeName: "esa bumindo" }), "PT ESA BUMINDO");
});
test("hanya salah satu terisi / tidak ada → perilaku lama", () => {
  assert.equal(pihakPenerima({ supplier: { name: "YULIUS" }, payeeName: null }), "YULIUS");
  assert.equal(pihakPenerima({ supplier: { name: "YULIUS" }, payeeName: "   " }), "YULIUS");
  assert.equal(pihakPenerima({ supplier: null, payeeName: "TOKO SUMBER MAS" }), "TOKO SUMBER MAS");
  assert.equal(pihakPenerima({}), "");
});
