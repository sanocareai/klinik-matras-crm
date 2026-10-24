// Model murni Catatan Pemakaian Historis (tanpa React/DOM).
import test from "node:test";
import assert from "node:assert/strict";
import { kelompokkanCatatan, teksNilai, ringkasCatatan, aksiCatatan, badgeHpp, validasiKoreksiCatatan, validasiKoreksiPemakaian, validasiKoreksiSaldo, NADA_STATE, SATUAN_KOREKSI } from "../src/features/production/bahan/catatanHistorisModel.js";
import { SATUAN_KOMPONEN } from "../src/features/production/bahan/bahanModel.js";

const item = (o = {}) => ({ id: "n1", origin: "EXCEL", state: "PERLU_DICEK", qtyAsli: "1,5", satuanAsli: "KG", qty: 1.5, satuan: "KG", flags: [], bahan: { id: "m1", kode: "LEM", satuan: "CAN" }, ...o });

test("nilai asli ditampilkan apa adanya (tidak dikonversi): '1,5 KG' tetap '1,5 KG'", () => {
  assert.equal(teksNilai(item()), "1,5 KG");
  assert.equal(teksNilai(item({ origin: "LEDGER", qty: 3, satuan: "CAN" })), "3 CAN");
  assert.equal(teksNilai(item({ qtyAsli: null, satuanAsli: null })), "—");
});
test("kelompok: Perlu dicek di atas; sudah di stok ringkas; keadaan lain terpisah", () => {
  const g = kelompokkanCatatan([item({ id: "a" }), item({ id: "b", state: "SIAP_POSTING" }), item({ id: "c", state: "TERCATAT_DI_STOK" }), item({ id: "d", state: "DIPOSTING" }), item({ id: "e", state: "BUKAN_STOK" })]);
  assert.deepEqual([g.perluDicek.length, g.siap.length, g.sudah.length, g.lain.length], [1, 1, 2, 1]);
});
test("ringkasan teks tanpa istilah teknis", () => {
  assert.equal(ringkasCatatan({ perluDicek: 7, tercatatDiStok: 5, diposting: 1, siapPosting: 2 }), "7 perlu dicek · 2 siap jadi pengeluaran stok · 6 sudah di stok");
  assert.equal(ringkasCatatan({}), "Tidak ada catatan");
});
test("aksi: hanya untuk yang boleh menulis bahan; konfirmasi hanya untuk penanda yang memang bisa dikonfirmasi; koreksi pemakaian untuk selisih ISSUE lama", () => {
  assert.deepEqual(aksiCatatan(item(), {}), [], "tanpa izin = tanpa aksi");
  const izin = { catatanHistoris: true };
  assert.deepEqual(aksiCatatan(item(), izin).map((a) => a.key), ["koreksi", "kecualikan", "koreksiSaldo"]);
  assert.ok(aksiCatatan(item({ flags: [{ kode: "BARIS_BERULANG" }] }), izin).some((a) => a.key === "konfirmasi"));
  assert.ok(!aksiCatatan(item({ flags: [{ kode: "SATUAN_BEDA_MASTER" }] }), izin).some((a) => a.key === "konfirmasi"), "satuan beda tidak bisa 'dikonfirmasi wajar' — harus dikoreksi");
  assert.ok(aksiCatatan(item({ flags: [{ kode: "ISSUE_LAMA_BERBEDA" }] }), izin).some((a) => a.key === "koreksiPemakaian"));
  assert.deepEqual(aksiCatatan(item({ state: "DIPOSTING" }), izin).map((a) => a.key), ["koreksiSaldo"], "yang sudah jadi pengeluaran stok tidak dikoreksi lewat catatan; hanya saldo bahan yang boleh dikoreksi (Penyesuaian Stok)");
  assert.deepEqual(aksiCatatan(item({ origin: "LEDGER", flags: [{ kode: "ISSUE_TANPA_PASANGAN" }] }), izin).map((a) => a.key), ["koreksiPemakaian", "koreksiSaldo"]);
  assert.ok(aksiCatatan(item({ state: "DIPOSTING" }), izin).some((a) => a.key === "koreksiSaldo"), "saldo bahan bisa dikoreksi walau catatan sudah diposting");
  assert.ok(!aksiCatatan(item({ bahan: null }), izin).some((a) => a.key === "koreksiSaldo"), "tanpa bahan katalog tidak ada koreksi saldo");
  assert.ok(!aksiCatatan(item({ state: "TIDAK_DIHITUNG" }), izin).some((a) => a.key === "koreksiSaldo"));
});
test("HPP: PARSIAL bila ada gap — tidak pernah tampil final; final hanya bila tidak parsial", () => {
  assert.equal(badgeHpp(null), null);
  const p = badgeHpp({ final: false, parsial: true, gap: [{ jenis: "CATATAN_BELUM_JADI_STOK", pesan: "3 catatan belum jadi stok" }], lihatNilai: true, nilaiTerhitung: 1000 });
  assert.equal(p.label, "HPP bahan PARSIAL"); assert.equal(p.tone, "orange"); assert.match(p.detail, /3 catatan belum jadi stok/); assert.equal(p.nilai, 1000);
  assert.equal(badgeHpp({ final: false, parsial: true, gap: [], lihatNilai: false, nilaiTerhitung: 5 }).nilai, null, "tanpa izin lihat nilai tidak ada angka");
  assert.equal(badgeHpp({ final: true, gap: [] }).label, "HPP bahan final");
});
test("validasi koreksi: jumlah > 0, satuan dikenal, alasan wajib ≥5 karakter; koreksi pemakaian boleh 0", () => {
  assert.equal(validasiKoreksiCatatan({ qty: "1,7", uom: "KG", alasan: "konfirmasi PIC" }).ok, true);
  assert.equal(validasiKoreksiCatatan({ qty: "0", alasan: "konfirmasi PIC" }).ok, false);
  assert.equal(validasiKoreksiCatatan({ qty: "1", uom: "XYZ", alasan: "konfirmasi PIC" }).ok, false);
  assert.equal(validasiKoreksiCatatan({ qty: "1", alasan: "x" }).ok, false);
  assert.equal(validasiKoreksiPemakaian({ qtyBaru: "0", alasan: "pembatalan salah ketik" }).ok, true);
  assert.equal(validasiKoreksiPemakaian({ qtyBaru: "-1", alasan: "pembatalan salah ketik" }).ok, false);
});
test("nada keadaan konsisten dan satuan koreksi = daftar satuan komponen Gudang", () => {
  assert.equal(NADA_STATE.PERLU_DICEK, "orange"); assert.equal(NADA_STATE.TERCATAT_DI_STOK, "green");
  assert.deepEqual([...SATUAN_KOREKSI], [...SATUAN_KOMPONEN]);
});
test("validasi koreksi saldo: saldo benar >= 0 (koma/titik), alasan >= 5 karakter", () => {
  assert.deepEqual(validasiKoreksiSaldo({ saldoBaru: "12,5", alasan: "hitung fisik 24 Okt" }), { ok: true, saldo: 12.5 });
  assert.equal(validasiKoreksiSaldo({ saldoBaru: "0", alasan: "hitung fisik" }).ok, true);
  assert.equal(validasiKoreksiSaldo({ saldoBaru: "-1", alasan: "hitung fisik" }).ok, false);
  assert.equal(validasiKoreksiSaldo({ saldoBaru: "", alasan: "hitung fisik" }).ok, false);
  assert.equal(validasiKoreksiSaldo({ saldoBaru: "abc", alasan: "hitung fisik" }).ok, false);
  assert.equal(validasiKoreksiSaldo({ saldoBaru: "3", alasan: "x" }).ok, false);
});
